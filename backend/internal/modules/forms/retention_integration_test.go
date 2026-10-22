//go:build integration

package forms

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// aged moves the response id days into the past.
func aged(t *testing.T, id uuid.UUID, days int) {
	t.Helper()
	_, err := superA.Exec(t.Context(), `update forms.responses set submitted_at = submitted_at - make_interval(days => $2) where id = $1`, id, days)
	require.NoError(t, err)
}

// «Хранить ответы» (Q-W4.00-forms-22): the worker deletes the responses older than the retention of their form with
// their journal; a shortened retention keeps the older responses for 7 days of grace by the former one.
func TestRetention(t *testing.T) { //nolint:paralleltest // deletes the old responses of the whole tenant
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Хранение RT", page(qq("q-text", fapi.FormQuestionTypeText, "Отзыв", true)))
	answer := func() uuid.UUID {
		return must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: *f.PublishedVersionId,
			Answers: []fapi.FieldEntry{text("q-text", "ок")}})).of(t).Id
	}
	fresh, month, old := answer(), answer(), answer()
	aged(t, month, 100)
	aged(t, old, 400)
	n, err := s.Retain(ctx, ref("tenant:a"))
	require.NoError(t, err)
	assert.GreaterOrEqual(t, n, 1)
	assert.Equal(t, 2, count(t, `select count(*) from forms.responses where form_id = $1`, f.Id), "a year by default")
	assert.Zero(t, count(t, `select count(*) from forms.responses where id = $1`, old))

	short := must(s.UpdateForm(ctx, owner, f.Id, rev(f.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{
		RetainResponsesDays: new(fapi.FormSettingsPatchRetainResponsesDaysN90)}}, nil)).of(t)
	_, err = s.Retain(ctx, ref("tenant:a"))
	require.NoError(t, err)
	assert.Equal(t, 1, count(t, `select count(*) from forms.responses where id = $1`, month), "the grace of a shortened retention")
	_, err = superA.Exec(ctx, `update forms.forms set settings = jsonb_set(settings, '{shortened,at}', to_jsonb($2::timestamptz))
		where id = $1`, f.Id, clock().AddDate(0, 0, -8))
	require.NoError(t, err)
	_, err = s.Retain(ctx, ref("tenant:a"))
	require.NoError(t, err)
	assert.Zero(t, count(t, `select count(*) from forms.responses where id = $1`, month), "after the grace")
	assert.Equal(t, 1, count(t, `select count(*) from forms.responses where id = $1`, fresh))
	assert.Equal(t, fapi.FormSettingsRetainResponsesDaysN90, short.Settings.RetainResponsesDays)
	_, err = s.Retain(ctx, uuid.New())
	require.Error(t, err, "an unknown tenant")
}

// formFile writes a checked file of an answer to form uploaded by actor (the parent forms/form, form_attachment).
func formFile(t *testing.T, form uuid.UUID, actor string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := superA.Exec(t.Context(), `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime,
		detected_mime, bytes, sha256, uploaded_by, ready_at) values ($1, $4, 'ready', 'form_attachment', 'forms.form',
		$2, 'image/jpeg', 'image/jpeg', 2048, sha256(convert_to($4, 'UTF8')), $3, now())`, id, form, person(actor), "forms/rt/"+id.String())
	require.NoError(t, err)
	return id
}

// «Хранить ответы» with what a response left outside the module (Q-W4.00-forms-22, D-26; return 1): the rows and the
// records of the knowledge base of the deleted responses (by their numbers) and the files of their answers go in the
// same transaction — a file another response still holds stays; the bytes are removed after the commit. Without the
// ports the responses are not deleted at all.
func TestRetentionPurge(t *testing.T) { //nolint:paralleltest // deletes the old responses of the whole tenant
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Хранение с файлами RP", page(qq("q-text", fapi.FormQuestionTypeText, "Отзыв", true),
		qq("q-photo", fapi.FormQuestionTypePhoto, "Фото", false)))
	only, shared, kept := formFile(t, f.Id, "a.owner"), formFile(t, f.Id, "a.owner"), formFile(t, f.Id, "a.owner")
	old := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: *f.PublishedVersionId,
		Answers: []fapi.FieldEntry{text("q-text", "старый"), filesOfIDs("q-photo", only, shared)}})).of(t)
	fresh := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: *f.PublishedVersionId,
		Answers: []fapi.FieldEntry{text("q-text", "новый"), filesOfIDs("q-photo", shared, kept)}})).of(t)
	aged(t, old.Id, 400)

	bare := service()
	bare.Purge = nil
	_, err := bare.Retain(ctx, ref("tenant:a"))
	require.Error(t, err, "no ports — nothing is deleted")
	assert.Equal(t, 1, count(t, `select count(*) from forms.responses where id = $1`, old.Id))

	_, err = s.Retain(ctx, ref("tenant:a"))
	require.NoError(t, err)
	assert.Zero(t, count(t, `select count(*) from forms.responses where id = $1`, old.Id))
	numbers, ids, left := purge.of(f.Id)
	assert.Equal(t, []string{old.Number}, numbers, "the rows and the records of the knowledge base of the deleted response")
	assert.Equal(t, []uuid.UUID{only}, ids, "the file the fresh response holds stays")
	assert.Equal(t, 1, left, "the bytes go after the commit")
	assert.Equal(t, 1, count(t, `select count(*) from forms.responses where id = $1`, fresh.Id))
}
