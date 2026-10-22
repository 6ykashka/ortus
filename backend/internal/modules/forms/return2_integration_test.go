//go:build integration

package forms

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	pfapi "github.com/ortus/ortus-crm/backend/internal/api/publicforms"
)

// Return 2 (major): the files of the answers are not open to everyone who sees the form (Q-W4.00-forms-9; DoR forms.md,
// dc:398–400 «файл откроется с проверкой доступа»). HiddenFiles names the files of the answers closed to a member — the
// module of files leaves them out of listFiles and answers 404 (cmd/api): a file is open to its uploader, to a member
// with forms.responses.read in the area of its form and to one who reads a response holding it.
func TestHiddenFiles(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	trip := fapi.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: uuid.New()}
	objects.set(trip, "Рейс Р-903")
	f := published(t, "a.owner", "Фото ответов HF", page(qq("q-text", fapi.FormQuestionTypeText, "Вопрос", true),
		qq("q-photo", fapi.FormQuestionTypePhoto, "Фото", false)))
	v := *f.PublishedVersionId
	about, plain := formFile(t, f.Id, "a.owner"), formFile(t, f.Id, "a.owner")
	must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v, Subject: &trip,
		Answers: []fapi.FieldEntry{text("q-text", "По рейсу"), filesOfIDs("q-photo", about)}})).of(t)
	must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: v,
		Answers: []fapi.FieldEntry{text("q-text", "Без рейса"), filesOfIDs("q-photo", plain)}})).of(t)
	driver := as(t, "a.driver-msk1")
	mine, loose := formFile(t, f.Id, "a.driver-msk1"), formFile(t, f.Id, "a.driver-msk1")
	must(s.Submit(ctx, driver, f.Id, fapi.FormResponseCreate{VersionId: v,
		Answers: []fapi.FieldEntry{text("q-text", "Мой"), filesOfIDs("q-photo", mine)}})).of(t)

	assert.Empty(t, must(s.HiddenFiles(ctx, owner)).of(t), "the owner reads every response")
	hidden := must(s.HiddenFiles(ctx, driver)).of(t)
	assert.Subset(t, hidden, []uuid.UUID{about, plain}, "forms.read without forms.responses.read: the files of the others")
	assert.NotContains(t, hidden, mine, "his own upload in his response")
	assert.NotContains(t, hidden, loose, "his own upload not sent yet")
	hidden = must(s.HiddenFiles(ctx, as(t, "a.manager-msk2"))).of(t)
	assert.Subset(t, hidden, []uuid.UUID{plain, mine, loose}, "the key elsewhere: the responses he does not read")
	assert.NotContains(t, hidden, about, "the file of a response about an object he sees")
}

// slowUploads writes the file of an upload of a guest as the module of files does — in a transaction of its own, after a
// while — so that parallel initiations with one nonce overlap.
type slowUploads struct{ fakeUploads }

func (u *slowUploads) Initiate(ctx context.Context, _, actor, form uuid.UUID, _ Upload) (pfTicket, error) {
	time.Sleep(40 * time.Millisecond)
	id := uuid.New()
	if _, err := superA.Exec(ctx, `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime,
		detected_mime, bytes, sha256, uploaded_by, ready_at) values ($1, $4, 'ready', 'form_attachment', 'forms.form', $2,
		'image/jpeg', 'image/jpeg', 10, sha256(convert_to($4, 'UTF8')), $3, now())`, id, form, actor, "forms/up/"+id.String()); err != nil {
		return pfTicket{}, err
	}
	return pfTicket{UploadId: uuid.New(), FileId: id, Method: "PUT"}, nil
}

// Return 2 (minor): «не больше 20 файлов» of one nonce holds for parallel initiatePublicUpload — the count and the
// upload are serialized per nonce.
func TestPublicUploadLimitParallel(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	s.Uploads = &slowUploads{}
	f := published(t, "a.owner", "Фото гостя UL", page(qq("q-photo", fapi.FormQuestionTypePhoto, "Фото", false)))
	pub := must(s.UpdateForm(ctx, owner, f.Id, rev(f.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{
		Access: new(fapi.FormSettingsPatchAccessPublic)}}, nil)).of(t)
	token := *pub.Share.PublicToken
	g := must(s.PublicForm(ctx, token)).of(t)
	var (
		wg sync.WaitGroup
		ok atomic.Int32
	)
	for range publicUploadFiles + 10 {
		wg.Go(func() {
			if _, err := s.InitiateUpload(ctx, token, pfapi.PublicUploadCreate{VersionId: g.VersionId, SubmissionNonce: g.SubmissionNonce,
				FieldKey: "q-photo", FileName: "a.jpg", ContentType: "image/jpeg", SizeBytes: 10, Sha256: "00"}); err == nil {
				ok.Add(1)
			}
		})
	}
	wg.Wait()
	assert.Equal(t, int32(publicUploadFiles), ok.Load(), "the limit of the files of one nonce")
	assert.Equal(t, publicUploadFiles, count(t, `select count(*) from files.objects where owner_id = $1 and uploaded_by = $2`,
		f.Id, nonceActor(g.SubmissionNonce)))
}

// Return 2 (minor): a key rotation keeps the nonces of the pages already open — a nonce of a former key of
// FORMS_PUBLIC_LINK_PREVIOUS_KEYS is accepted; one of a key the server does not hold is not.
func TestPublicNonceAfterRotation(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Отзыв KR", page(qq("q-text", fapi.FormQuestionTypeText, "Отзыв", true)))
	pub := must(s.UpdateForm(ctx, owner, f.Id, rev(f.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{
		Access: new(fapi.FormSettingsPatchAccessPublic)}}, nil)).of(t)
	token := *pub.Share.PublicToken
	before := must(s.PublicForm(ctx, token)).of(t)
	rotated := service()
	rotated.Keys = Keys{Current: 2, ByVer: map[int][]byte{1: linkKey, 2: []byte("fedcba9876543210fedcba9876543210")}}
	_, _, err := rotated.SubmitPublic(ctx, token, pfapi.PublicResponseCreate{VersionId: before.VersionId, SubmissionNonce: before.SubmissionNonce,
		Answers: publicAnswers(t, text("q-text", "Открыл до смены ключа"))})
	require.NoError(t, err, "the nonce of the former key")
	after := must(rotated.PublicForm(ctx, token)).of(t)
	_, _, err = s.SubmitPublic(ctx, token, pfapi.PublicResponseCreate{VersionId: after.VersionId, SubmissionNonce: after.SubmissionNonce,
		Answers: publicAnswers(t, text("q-text", "Ключа нет"))})
	wantField(t, err, "submissionNonce", "invalid", "Откройте форму по ссылке заново")
}

// Return 2 (minor): «Хранить ответы» leaves an audit line per form — how many responses the retention deleted (no
// content), by the service.
func TestRetentionAudit(t *testing.T) { //nolint:paralleltest // deletes the old responses of the whole tenant
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Хранение RA", page(qq("q-text", fapi.FormQuestionTypeText, "Отзыв", true)))
	for range 2 {
		x := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: *f.PublishedVersionId,
			Answers: []fapi.FieldEntry{text("q-text", "старый")}})).of(t)
		aged(t, x.Id, 400)
	}
	_, err := s.Retain(ctx, ref("tenant:a"))
	require.NoError(t, err)
	assert.Equal(t, 1, count(t, `select count(*) from audit.events where action = 'forms.responses.purged' and actor_kind = 'service'
		and target_type = 'forms.form' and target_id = $1 and (diff->>'count')::int = 2`, f.Id))
}

// Return 2 (minor): a submission does not take a file «Хранить ответы» is removing — it waits for the purge of the file
// and then refuses it; a response never holds a file without bytes.
func TestSubmitWaitsForPurge(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Фото PW", page(qq("q-photo", fapi.FormQuestionTypePhoto, "Фото", true)))
	file := formFile(t, f.Id, "a.owner")
	tx, err := superA.Begin(ctx)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `update files.objects set state = 'rejected', rejected_code = 'retention_deleted' where id = $1`, file)
	require.NoError(t, err)
	done := make(chan error, 1)
	go func() {
		_, err := s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: *f.PublishedVersionId,
			Answers: []fapi.FieldEntry{filesOfIDs("q-photo", file)}})
		done <- err
	}()
	select {
	case err := <-done:
		_ = tx.Rollback(ctx)
		t.Fatalf("the submission did not wait for the purge of its file: %v", err)
	case <-time.After(500 * time.Millisecond):
	}
	require.NoError(t, tx.Commit(ctx))
	wantField(t, <-done, "q-photo", "not_found", "Файл не найден")
	assert.Zero(t, count(t, `select count(*) from forms.responses where form_id = $1`, f.Id))
}
