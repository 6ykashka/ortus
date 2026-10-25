//go:build integration

package forms

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	pfapi "github.com/ortus/ortus-crm/backend/internal/api/publicforms"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// countedUploads is fakeUploads that counts every call: a refused guest reaches none.
type countedUploads struct {
	fakeUploads

	calls atomic.Int64
}

func (u *countedUploads) Initiate(ctx context.Context, tenant, actor, form uuid.UUID, x Upload) (pfTicket, error) {
	u.calls.Add(1)
	return u.fakeUploads.Initiate(ctx, tenant, actor, form, x)
}

func (u *countedUploads) Complete(ctx context.Context, tenant, actor, upload uuid.UUID, sha string) (pfFile, error) {
	u.calls.Add(1)
	return u.fakeUploads.Complete(ctx, tenant, actor, upload, sha)
}

func (u *countedUploads) Status(ctx context.Context, tenant, actor, upload uuid.UUID) (pfFile, error) {
	u.calls.Add(1)
	return u.fakeUploads.Status(ctx, tenant, actor, upload)
}

// W4.83 (Q-W4.90-1, contract PublicForms «Origin»): the four commands of a guest that declare Origin —
// submitPublicForm, initiatePublicUpload, completePublicUpload, getPublicUploadStatus — refuse a browser Origin out of
// the allowlist with 403 origin_not_allowed before the token, the nonce and the body: no response, no upload, no
// call of the module of files, nothing of the form in the answer. The allowed origin and a request without Origin (no
// browser) are served as before.
//
//nolint:maintidx // one scenario over the four commands of a guest
func TestPublicOrigin(t *testing.T) {
	t.Parallel()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	up := &countedUploads{}
	s.Uploads = up
	const allowed = "https://app.ortus.example"
	srv := PublicServer{S: s, Origins: Origins{allowed, "http://127.0.0.1:5205"}}

	f := published(t, "a.owner", "Анкета OR", page(qq("q-text", fapi.FormQuestionTypeText, "Отзыв", true),
		qq("q-photo", fapi.FormQuestionTypePhoto, "Фото", false)))
	pub := must(s.UpdateForm(ctx, owner, f.Id, rev(f.Revision), fapi.FormPatch{Settings: &fapi.FormSettingsPatch{
		Access: new(fapi.FormSettingsPatchAccessPublic)}}, nil)).of(t)
	token := *pub.Share.PublicToken
	g := must(s.PublicForm(ctx, token)).of(t)

	submit := func(origin *string, p pfapi.PublicForm) (pfapi.SubmitPublicFormResponseObject, error) {
		return srv.SubmitPublicForm(ctx, pfapi.SubmitPublicFormRequestObject{PublicToken: token,
			Params: pfapi.SubmitPublicFormParams{IdempotencyKey: "w483-" + uuid.NewString(), Origin: origin},
			Body: &pfapi.PublicResponseCreate{VersionId: p.VersionId, SubmissionNonce: p.SubmissionNonce,
				Answers: publicAnswers(t, text("q-text", "Отзыв W483"))}})
	}
	initiate := func(origin *string, p pfapi.PublicForm) (pfapi.InitiatePublicUploadResponseObject, error) {
		return srv.InitiatePublicUpload(ctx, pfapi.InitiatePublicUploadRequestObject{PublicToken: token,
			Params: pfapi.InitiatePublicUploadParams{IdempotencyKey: "w483-" + uuid.NewString(), Origin: origin},
			Body: &pfapi.PublicUploadCreate{VersionId: p.VersionId, SubmissionNonce: p.SubmissionNonce, FieldKey: "q-photo",
				FileName: "w483.jpg", ContentType: "image/jpeg", SizeBytes: 10, Sha256: "00"}})
	}
	complete := func(origin *string, p pfapi.PublicForm, upload uuid.UUID) (pfapi.CompletePublicUploadResponseObject, error) {
		return srv.CompletePublicUpload(ctx, pfapi.CompletePublicUploadRequestObject{PublicToken: token, UploadId: upload,
			Params: pfapi.CompletePublicUploadParams{IdempotencyKey: "w483-" + uuid.NewString(), Origin: origin},
			Body:   &pfapi.PublicUploadComplete{SubmissionNonce: p.SubmissionNonce, Sha256: "00"}})
	}
	status := func(origin *string, p pfapi.PublicForm, upload uuid.UUID) (pfapi.GetPublicUploadStatusResponseObject, error) {
		return srv.GetPublicUploadStatus(ctx, pfapi.GetPublicUploadStatusRequestObject{PublicToken: token, UploadId: upload,
			Params: pfapi.GetPublicUploadStatusParams{Origin: origin},
			Body:   &pfapi.PublicUploadStatusQuery{SubmissionNonce: p.SubmissionNonce}})
	}
	responses := func() int {
		return count(t, `select count(*) from forms.responses where form_id = $1`, f.Id)
	}

	refused := func(name string, res any, err error) {
		t.Helper()
		if !problem.Is(err, problem.CodeOriginNotAllowed) {
			t.Errorf("%s: %#v %v, want %s", name, res, err, problem.CodeOriginNotAllowed)
		}
	}
	for _, origin := range []string{"https://evil.example", "null", "", allowed + ":8443", "http://app.ortus.example", allowed + "/"} {
		res, err := submit(new(origin), g)
		refused("submit from «"+origin+"»", res, err)
		ini, err := initiate(new(origin), g)
		refused("initiate from «"+origin+"»", ini, err)
		cpl, err := complete(new(origin), g, uuid.New())
		refused("complete from «"+origin+"»", cpl, err)
		st, err := status(new(origin), g, uuid.New())
		refused("status from «"+origin+"»", st, err)
	}
	assert.Zero(t, responses(), "a refused guest writes no response")
	assert.Zero(t, up.calls.Load(), "a refused guest reaches no upload")

	// The allowed origin: the whole way of a guest with a file.
	ini, err := initiate(new(allowed), g)
	require.NoError(t, err)
	ticket, ok := ini.(pfapi.InitiatePublicUpload201JSONResponse)
	require.True(t, ok, "initiate from the allowed origin: %#v", ini)
	cpl, err := complete(new(allowed), g, ticket.Body.UploadId)
	require.NoError(t, err)
	assert.IsType(t, pfapi.CompletePublicUpload202JSONResponse{}, cpl)
	st, err := status(new(allowed), g, ticket.Body.UploadId)
	require.NoError(t, err)
	assert.IsType(t, pfapi.GetPublicUploadStatus200JSONResponse{}, st)
	res, err := submit(new(allowed), g)
	require.NoError(t, err)
	assert.IsType(t, pfapi.SubmitPublicForm201JSONResponse{}, res)
	assert.Equal(t, int64(3), up.calls.Load())

	// Without Origin — no browser (the contract requires the header of browser commands only).
	other := must(s.PublicForm(ctx, token)).of(t)
	res, err = submit(nil, other)
	require.NoError(t, err)
	assert.IsType(t, pfapi.SubmitPublicForm201JSONResponse{}, res)
	assert.Equal(t, 2, responses())
}
