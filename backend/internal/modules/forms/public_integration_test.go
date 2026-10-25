//go:build integration

package forms

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	pfapi "github.com/ortus/ortus-crm/backend/internal/api/publicforms"
)

func publicAnswers(t *testing.T, es ...fapi.FieldEntry) []pfapi.FieldEntry {
	t.Helper()
	var out []pfapi.FieldEntry
	require.NoError(t, convert(es, &out))
	return out
}

// Public links (Q-W4.05-7, -19, -22) and the guest (AC-08 on the side of the module): the link appears with the
// publication of a public form — the index first, then the tenant; the token is derived again, never stored; the guest
// gets the version without scores and defaults of hidden questions and a nonce; his response is pending, the nonce
// single-use; a form no longer public — 410.
func TestPublicLink(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	quiz := qq("q-q1", fapi.FormQuestionTypeChoice, "Вопрос", true, func(x *question) {
		x.Options = &[]fapi.FormOption{{Key: "o1", Label: "А", Score: new(0)}, {Key: "o2", Label: "Б", Score: new(1)}}
	})
	f := published(t, "a.owner", "Опрос PL", page(quiz, qq("q-src", fapi.FormQuestionTypeText, "Источник", false, hidden("сайт")),
		qq("q-photo", fapi.FormQuestionTypePhoto, "Фото", false)))
	assert.Nil(t, f.Share.PublicToken, "a form of the members has no link")
	pub := must(s.UpdateForm(ctx, owner, f.Id, rev(f.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{
		Access: new(fapi.FormSettingsPatchAccessPublic), Scoring: new(true), PassScore: new(1)}}, nil)).of(t)
	require.NotNil(t, pub.Share.PublicToken)
	token := *pub.Share.PublicToken
	assert.GreaterOrEqual(t, len(token), 32)
	assert.Equal(t, token, *must(s.Form(ctx, owner, f.Id)).of(t).Share.PublicToken, "derived again, the same")
	assert.Equal(t, 1, count(t, `select count(*) from forms.public_links where form_id = $1 and token_digest = $2`, f.Id, tokenDigest(token)))
	assert.Zero(t, count(t, `select count(*) from forms.public_links where token_digest like '%'||$1||'%'`, token), "never stored")
	assert.Nil(t, must(s.Form(ctx, as(t, "a.manager-msk2"), f.Id)).of(t).Share.PublicToken, "only with forms.publish")

	g := must(s.PublicForm(ctx, token)).of(t)
	assert.Equal(t, *pub.PublishedVersionId, g.VersionId)
	assert.True(t, g.AcceptingResponses)
	assert.True(t, g.UploadAllowed)
	for _, o := range *g.Definition.Fields[0].Options {
		assert.Nil(t, o.Score, "the scores stay on the server")
	}
	assert.Nil(t, g.Definition.Fields[1].DefaultValue, "the default of a hidden question stays on the server")
	assert.Equal(t, "Холдинг", *g.Presentation.OrganizationName)
	assert.Equal(t, "Опрос PL", g.Presentation.Title, "the name of the form heads the guest page (Q-W4.70-2)")
	_, err := s.PublicForm(ctx, "x"+token)
	wantCode(t, err, codeNotFound, "")

	_, _, err = s.SubmitPublic(ctx, token, pfapi.PublicResponseCreate{VersionId: g.VersionId, SubmissionNonce: g.SubmissionNonce,
		Answers: publicAnswers(t, choice("q-q1", "o2"), text("q-src", "реклама"))})
	wantField(t, err, "q-src", "hidden", "Скрытый вопрос заполняют ссылка и значение по умолчанию")
	_, _, err = s.SubmitPublic(ctx, token, pfapi.PublicResponseCreate{VersionId: g.VersionId, SubmissionNonce: "forged-nonce-of-a-guest",
		Answers: publicAnswers(t, choice("q-q1", "o2"))})
	wantField(t, err, "submissionNonce", "invalid", "Откройте форму по ссылке заново")
	_, _, err = s.SubmitPublic(ctx, token, pfapi.PublicResponseCreate{VersionId: g.VersionId, SubmissionNonce: g.SubmissionNonce,
		Answers: publicAnswers(t, choice("q-q1", "o2"), filesOfIDs("q-photo", uuid.New()))})
	wantField(t, err, "q-photo", "not_found", "Файл не найден")
	ticket := must(s.InitiateUpload(ctx, token, pfapi.PublicUploadCreate{VersionId: g.VersionId, SubmissionNonce: g.SubmissionNonce,
		FieldKey: "q-photo", FileName: "a.jpg", ContentType: "image/jpeg", SizeBytes: 10, Sha256: "00"})).of(t)
	assert.Equal(t, "PUT", string(ticket.Method))
	_, err = s.InitiateUpload(ctx, token, pfapi.PublicUploadCreate{VersionId: g.VersionId, SubmissionNonce: g.SubmissionNonce,
		FieldKey: "q-q1", FileName: "a.jpg", ContentType: "image/jpeg", SizeBytes: 10})
	wantField(t, err, "fieldKey", "invalid", "Вопрос не найден")
	rec, replayed, err := s.SubmitPublic(ctx, token, pfapi.PublicResponseCreate{VersionId: g.VersionId, SubmissionNonce: g.SubmissionNonce,
		Answers: publicAnswers(t, choice("q-q1", "o2")), LinkParams: &map[string]string{"q-src": "email"}})
	require.NoError(t, err)
	assert.False(t, replayed)
	assert.Equal(t, "Спасибо! Ответ отправлен.\nРезультат: 1 из 1 балла · тест пройден", rec.Message, "pl(max, …) of the reference")
	x := must(s.Response(ctx, owner, f.Id, rec.ReceiptId)).of(t)
	assert.Equal(t, fapi.FormResponseReviewStatusPending, x.ReviewStatus, "a guest waits for the review (Q-W4.00-forms-18)")
	assert.Equal(t, fapi.FormResponseChannelPublic, x.Channel)
	assert.Equal(t, "Гость", x.Author.DisplayName)
	assert.Nil(t, x.Author.MemberId)
	assert.Equal(t, []string{"q-src"}, *x.LinkParamKeys)
	assert.Equal(t, fapi.FormResponseScore{Points: 1, MaxPoints: 1, Passed: new(true)}, *x.Score)

	again, replayed, err := s.SubmitPublic(ctx, token, pfapi.PublicResponseCreate{VersionId: g.VersionId, SubmissionNonce: g.SubmissionNonce,
		Answers: publicAnswers(t, choice("q-q1", "o2"))})
	require.NoError(t, err)
	assert.True(t, replayed, "the same answers with the same nonce — the receipt again")
	assert.Equal(t, rec.ReceiptId, again.ReceiptId)
	_, _, err = s.SubmitPublic(ctx, token, pfapi.PublicResponseCreate{VersionId: g.VersionId, SubmissionNonce: g.SubmissionNonce,
		Answers: publicAnswers(t, choice("q-q1", "o1"))})
	wantCode(t, err, codeNonceUsed, "Ответ с этой страницы уже отправлен")
	// Return 1: a repeat is the same answers, not a part of them; the nonce of a sent response uploads nothing more.
	_, _, err = s.SubmitPublic(ctx, token, pfapi.PublicResponseCreate{VersionId: g.VersionId, SubmissionNonce: g.SubmissionNonce,
		Answers: publicAnswers(t)})
	wantCode(t, err, codeNonceUsed, "Ответ с этой страницы уже отправлен")
	_, err = s.InitiateUpload(ctx, token, pfapi.PublicUploadCreate{VersionId: g.VersionId, SubmissionNonce: g.SubmissionNonce,
		FieldKey: "q-photo", FileName: "b.jpg", ContentType: "image/jpeg", SizeBytes: 10, Sha256: "00"})
	wantCode(t, err, codeNonceUsed, "Ответ с этой страницы уже отправлен")
	_, err = s.CompleteUpload(ctx, token, ticket.UploadId, pfapi.PublicUploadComplete{SubmissionNonce: g.SubmissionNonce, Sha256: "00"})
	wantCode(t, err, codeNonceUsed, "Ответ с этой страницы уже отправлен")

	back := must(s.UpdateForm(ctx, owner, f.Id, rev(pub.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{
		Access: new(fapi.FormSettingsPatchAccessMembers)}}, nil)).of(t)
	assert.Nil(t, back.Share.PublicToken)
	_, err = s.PublicForm(ctx, token)
	wantCode(t, err, codeExpired, "")
}

// Return 1: a parameter of the link is the text of the guest whatever the type of its hidden question
// (Q-W4.00-forms-20) — a formula in it reaches the export of a column of numbers neutralized.
func TestPublicLinkFormula(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Заявка LF", page(qq("q-text", fapi.FormQuestionTypeText, "Заявка", true),
		qq("q-n", fapi.FormQuestionTypeNumber, "Номер клиента", false, hidden(""))))
	pub := must(s.UpdateForm(ctx, owner, f.Id, rev(f.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{
		Access: new(fapi.FormSettingsPatchAccessPublic)}}, nil)).of(t)
	g := must(s.PublicForm(ctx, *pub.Share.PublicToken)).of(t)
	formula := `=HYPERLINK("http://x","y")`
	_, _, err := s.SubmitPublic(ctx, *pub.Share.PublicToken, pfapi.PublicResponseCreate{VersionId: g.VersionId,
		SubmissionNonce: g.SubmissionNonce, Answers: publicAnswers(t, text("q-text", "Позвоните")),
		LinkParams: &map[string]string{"q-n": formula}})
	require.NoError(t, err)
	csv := must(s.Export(ctx, owner, f.Id)).of(t)
	assert.Contains(t, csv.Content, `;"'=HYPERLINK(""http://x"",""y"")"`, "the formula of the link is neutralized")
	assert.NotContains(t, csv.Content, `;"=HYPERLINK`)
}

// A guest accepted by «Принять» runs the rules «После принятия ответа»; a version published after the nonce — 409.
func TestPublicVersionAndAccept(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Отзыв PV", page(qq("q-text", fapi.FormQuestionTypeText, "Отзыв", true)))
	pub := must(s.UpdateForm(ctx, owner, f.Id, rev(f.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{
		Access: new(fapi.FormSettingsPatchAccessPublic)}}, nil)).of(t)
	token := *pub.Share.PublicToken
	g := must(s.PublicForm(ctx, token)).of(t)
	d := must(s.Draft(ctx, owner, f.Id)).of(t)
	def2 := cloneDef(d.Definition)
	def2.Fields[0].Label = "Ваш отзыв"
	saved := must(s.SaveDraft(ctx, owner, f.Id, rev(d.Revision), fapi.FormDraftSave{Definition: def2})).of(t)
	must(s.Publish(ctx, owner, f.Id, rev(pub.Revision), fapi.FormPublishRequest{DraftRevision: saved.Revision})).of(t)
	_, _, err := s.SubmitPublic(ctx, token, pfapi.PublicResponseCreate{VersionId: g.VersionId, SubmissionNonce: g.SubmissionNonce,
		Answers: publicAnswers(t, text("q-text", "Хорошо"))})
	wantReason(t, err, reasonVersion, "Форма обновилась — откройте её заново")
	g2 := must(s.PublicForm(ctx, token)).of(t)
	rec, _, err := s.SubmitPublic(ctx, token, pfapi.PublicResponseCreate{VersionId: g2.VersionId, SubmissionNonce: g2.SubmissionNonce,
		Answers: publicAnswers(t, text("q-text", "=1+1"))})
	require.NoError(t, err)
	x := must(s.Response(ctx, owner, f.Id, rec.ReceiptId)).of(t)
	acc := must(s.Review(ctx, owner, f.Id, x.Id, rev(x.Revision), fapi.ResponseReviewPatch{
		ReviewStatus: new(fapi.ResponseReviewPatchReviewStatusAccepted)}, nil)).of(t)
	assert.Equal(t, fapi.FormResponseReviewStatusAccepted, acc.ReviewStatus)
	assert.Equal(t, 1, count(t, `select count(*) from outbox.events where type = 'forms.response.accepted.v1' and aggregate_id = $1`, x.Id))
	csv := must(s.Export(ctx, owner, f.Id)).of(t)
	assert.Contains(t, csv.Content, ";'=1+1", "the formula of a guest is neutralized")
}
