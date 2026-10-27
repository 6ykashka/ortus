//go:build integration

package docs

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
)

// fakeProcessor stands for the programs of the jobs: it answers by the operation of the input.
type fakeProcessor struct {
	mu       sync.Mutex
	runs     []JobInput
	password string // a file is protected until this password is given
}

func (f *fakeProcessor) Run(_ context.Context, in JobInput) (JobOutput, error) {
	f.mu.Lock()
	f.runs = append(f.runs, in)
	f.mu.Unlock()
	if f.password != "" && in.Password != f.password {
		return JobOutput{}, ErrPasswordProtected
	}
	data := []byte("result of " + in.Op + ":" + string(in.Inputs[0].Data))
	switch in.Op {
	case opOCR:
		return JobOutput{Files: []JobFile{{Name: "scan.pdf", ContentType: "application/pdf", Data: data}}, Confidence: 0.97, Lang: "rus", Pages: 2,
			Words: []OCRWord{{ID: "w1", Row: 1, Text: "Скпадская", Suggestion: "Складская", Confidence: 0.58, Why: "похоже на «Складская»"},
				{ID: "w2", Row: 2, Text: "Итого", Confidence: 0.7}}}, nil
	case opSplit:
		return JobOutput{Files: []JobFile{{Name: "1.pdf", ContentType: "application/pdf", Data: data}, {Name: "2.pdf", ContentType: "application/pdf", Data: data}}}, nil
	}
	return JobOutput{Files: []JobFile{{Name: "out", ContentType: "application/pdf", Data: data}}}, nil
}

func withProcessor(t *testing.T, p Processor) {
	t.Helper()
	prev := svc.Processor
	svc.Processor = p
	t.Cleanup(func() { svc.Processor = prev })
}

// seedScan writes a scan: a PDF document marked scan with a file.
func seedScan(t *testing.T, folder, owner uuid.UUID, title string) uuid.UUID {
	t.Helper()
	doc := seedDoc(t, folder, owner, title, "pdf")
	if err := exec(t.Context(), `update docs.documents set scan = true, ocr = '{"status":"queued","doubtful":0}' where id = $1`, doc); err != nil {
		t.Fatal(err)
	}
	seedFile(t, doc, owner, 1, title+".pdf", "application/pdf", []byte("photo of "+title))
	return doc
}

// The recognition of a scan: the job runs, the text layer becomes the next version, the doubtful words wait for the
// owner and are decided one by one (docJob, docJobPoll, docOcrWord).
func TestOCRJob(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	withProcessor(t, &fakeProcessor{})
	ctx, tc := as(t, "a.owner")
	folder := newFolder(t, "Сканы")
	doc := seedScan(t, folder, tc.PersonID, "Накладная")

	_, err := svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpToDocx, DocIds: []uuid.UUID{doc}})
	wantCode(t, err, "validation_failed") // «Сначала распознайте скан»
	job, err := svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpOcr, DocIds: []uuid.UUID{doc}})
	if err != nil || job.Status != dapi.DocJobStatusQueued {
		t.Fatalf("create: %v %+v", err, job)
	}
	_, err = svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpOcr, DocIds: []uuid.UUID{doc}})
	wantCode(t, err, "job_in_progress")

	n, err := svc.ProcessJobs(t.Context(), tenantA, 5)
	if err != nil || n < 1 {
		t.Fatalf("process: %v ran %d", err, n)
	}
	got, err := svc.Job(ctx, tc, job.Id)
	if err != nil || got.Status != dapi.DocJobStatusDone || got.ResultDocumentId == nil || *got.ResultDocumentId != doc {
		t.Fatalf("job: %v %+v", err, got)
	}
	card, err := svc.Document(ctx, tc, doc)
	if err != nil || card.Version != 2 || card.Ocr == nil || card.Ocr.Status != dapi.DocOcrStatusDone || card.Ocr.Doubtful != 2 || len(card.Jobs) == 0 {
		t.Fatalf("document: %v version %d ocr %+v", err, card.Version, card.Ocr)
	}
	if len(card.My.Wait) != 1 || card.My.Wait[0].Kind != "ocr" || *card.My.Wait[0].Count != 2 {
		t.Fatalf("wait %+v, want «Проверить распознавание» for the owner", card.My.Wait)
	}
	vers, _ := svc.Versions(ctx, tc, doc)
	if vers.Items[0].Source != dapi.DocVersionSourceOcr || *vers.Items[0].Base != 1 {
		t.Fatalf("version %+v, want the source ocr on top of v1", vers.Items[0])
	}
	_, err = svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpOcr, DocIds: []uuid.UUID{doc}})
	wantCode(t, err, "validation_failed") // already recognized

	w, err := svc.ReviewOcrWord(ctx, tc, doc, "w1", dapi.DocOcrWordReview{Action: dapi.Accept})
	if err != nil || w.State != dapi.Accepted || w.Text != "Складская" {
		t.Fatalf("accept: %v %+v", err, w)
	}
	own := "Итого:"
	_, err = svc.ReviewOcrWord(ctx, tc, doc, "w2", dapi.DocOcrWordReview{Action: dapi.Fix})
	wantCode(t, err, "validation_failed")
	w, err = svc.ReviewOcrWord(ctx, tc, doc, "w2", dapi.DocOcrWordReview{Action: dapi.Fix, Value: &own})
	if err != nil || w.State != dapi.Fixed || w.Text != own {
		t.Fatalf("fix: %v %+v", err, w)
	}
	_, err = svc.ReviewOcrWord(ctx, tc, doc, "nope", dapi.DocOcrWordReview{Action: dapi.Keep})
	wantCode(t, err, "not_found")
	card, _ = svc.Document(ctx, tc, doc)
	if card.Ocr.Doubtful != 0 || len(card.My.Wait) != 0 {
		t.Fatalf("after the check: ocr %+v wait %+v", card.Ocr, card.My.Wait)
	}
}

// A scan with personal data is not recognized (DOC-07).
func TestOCRRefusedForPDN(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	withProcessor(t, &fakeProcessor{})
	ctx, tc := as(t, "a.owner")
	doc := seedScan(t, newFolder(t, "ПДн"), tc.PersonID, "Паспорт")
	if err := exec(t.Context(), `update docs.documents set sensitivity = 'pdn' where id = $1`, doc); err != nil {
		t.Fatal(err)
	}
	_, err := svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpOcr, DocIds: []uuid.UUID{doc}})
	wantCode(t, err, "validation_failed")
}

// A conversion makes a new document next to the source and leaves the source as it was; the rules of the prototype
// («Это уже PDF», «Это уже PDF/A») hold.
func TestConvertAndMerge(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	withProcessor(t, &fakeProcessor{})
	ctx, tc := as(t, "a.owner")
	folder := newFolder(t, "Преобразования")
	a := seedDoc(t, folder, tc.PersonID, "Договор", "pdf")
	seedFile(t, a, tc.PersonID, 1, "a.pdf", "application/pdf", []byte("A"))
	b := seedDoc(t, folder, tc.PersonID, "Приложение", "pdf")
	seedFile(t, b, tc.PersonID, 1, "b.pdf", "application/pdf", []byte("B"))
	text := seedDoc(t, folder, tc.PersonID, "Текст", "text")
	seedFile(t, text, tc.PersonID, 1, "t.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", []byte("T"))

	_, err := svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpToPdf, DocIds: []uuid.UUID{a}})
	wantCode(t, err, "validation_failed") // «Это уже PDF»
	_, err = svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpMerge, DocIds: []uuid.UUID{a}})
	wantCode(t, err, "validation_failed")
	_, err = svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpMerge, DocIds: []uuid.UUID{a, text}})
	wantCode(t, err, "validation_failed")

	merge, err := svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpMerge, DocIds: []uuid.UUID{a, b}})
	if err != nil {
		t.Fatal(err)
	}
	pdf, err := svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpToPdf, DocIds: []uuid.UUID{text}})
	if err != nil {
		t.Fatal(err)
	}
	comp, err := svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpCompress, DocIds: []uuid.UUID{b}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ProcessJobs(t.Context(), tenantA, 10); err != nil {
		t.Fatal(err)
	}
	merged, err := svc.Job(ctx, tc, merge.Id)
	if err != nil || merged.Status != dapi.DocJobStatusDone || merged.ResultDocumentId == nil || *merged.ResultDocumentId == a {
		t.Fatalf("merge: %v %+v", err, merged)
	}
	doc, err := svc.Document(ctx, tc, *merged.ResultDocumentId)
	if err != nil || doc.Title != "Объединение: Договор" || doc.FolderId != mustFolderOf(t, a) || doc.Kind != dapi.DocumentKindPdf || doc.Version != 1 {
		t.Fatalf("merged document: %v %+v", err, doc)
	}
	conv, _ := svc.Job(ctx, tc, pdf.Id)
	res, err := svc.Document(ctx, tc, *conv.ResultDocumentId)
	if err != nil || res.Title != "Текст (PDF)" || res.Kind != dapi.DocumentKindPdf {
		t.Fatalf("converted: %v %+v", err, res)
	}
	if src, _ := svc.Document(ctx, tc, text); src.Version != 1 || src.Kind != dapi.DocumentKindText {
		t.Fatalf("the source changed: %+v", src)
	}
	cj, _ := svc.Job(ctx, tc, comp.Id)
	if cj.Status != dapi.DocJobStatusDone || *cj.ResultDocumentId != b {
		t.Fatalf("compress: %+v", cj)
	}
	if got, _ := svc.Document(ctx, tc, b); got.Version != 2 {
		t.Fatalf("compress made v%d, want a new version", got.Version)
	}
	_, err = svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpPdfa, DocIds: []uuid.UUID{text}})
	wantCode(t, err, "validation_failed")
	pa, err := svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpPdfa, DocIds: []uuid.UUID{a}})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = svc.ProcessJobs(t.Context(), tenantA, 5)
	paj, _ := svc.Job(ctx, tc, pa.Id)
	arch, err := svc.Document(ctx, tc, *paj.ResultDocumentId)
	if err != nil || arch.PdfaCopy == nil || !*arch.PdfaCopy {
		t.Fatalf("PDF/A: %v %+v", err, arch)
	}
	_, err = svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpPdfa, DocIds: []uuid.UUID{arch.Id}})
	wantCode(t, err, "validation_failed") // «Это уже PDF/A»
}

func mustFolderOf(t *testing.T, doc uuid.UUID) uuid.UUID {
	t.Helper()
	var f uuid.UUID
	if err := superA.QueryRow(t.Context(), `select folder_id from docs.documents where id = $1`, doc).Scan(&f); err != nil {
		t.Fatal(err)
	}
	return f
}

// A password-protected file fails the job with the text of the prototype; the retry with the password runs at once and
// never stores it (docJobRetry).
func TestJobPasswordAndRetry(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	p := &fakeProcessor{password: "s3cret"}
	withProcessor(t, p)
	ctx, tc := as(t, "a.owner")
	folder := newFolder(t, "Пароль")
	a := seedDoc(t, folder, tc.PersonID, "Закрытый", "pdf")
	seedFile(t, a, tc.PersonID, 1, "a.pdf", "application/pdf", []byte("locked"))
	job, err := svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpCompress, DocIds: []uuid.UUID{a}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ProcessJobs(t.Context(), tenantA, 5); err != nil {
		t.Fatal(err)
	}
	failed, _ := svc.Job(ctx, tc, job.Id)
	if failed.Status != dapi.DocJobStatusFailed || failed.Error == nil || !strings.Contains(*failed.Error, "защищён паролем") {
		t.Fatalf("job %+v, want the password failure", failed)
	}
	_, err = svc.RetryJob(ctx, tc, job.Id, dapi.DocJobRetry{})
	wantCode(t, err, "file_password_protected") // the file asks for the password
	wrong := "nope"
	again, err := svc.RetryJob(ctx, tc, job.Id, dapi.DocJobRetry{Password: &wrong})
	if err != nil || again.Status != dapi.DocJobStatusFailed {
		t.Fatalf("retry with a wrong password: %v %+v, want the job failed again", err, again)
	}
	pw := "s3cret"
	done, err := svc.RetryJob(ctx, tc, job.Id, dapi.DocJobRetry{Password: &pw})
	if err != nil || done.Status != dapi.DocJobStatusDone {
		t.Fatalf("retry with the password: %v %+v", err, done)
	}
	var stored int
	if err := superA.QueryRow(t.Context(), `select count(*) from docs.jobs where params::text like '%s3cret%' or error like '%s3cret%'`).Scan(&stored); err != nil || stored != 0 {
		t.Fatalf("the password is stored: %v %d", err, stored)
	}
	_, err = svc.RetryJob(ctx, tc, job.Id, dapi.DocJobRetry{})
	wantCode(t, err, "invalid_transition") // a done job is not retried
}

// Without the programs the job fails with a hint, the document stays as it was.
func TestJobWithoutProcessor(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	withProcessor(t, nil)
	ctx, tc := as(t, "a.owner")
	doc := seedScan(t, newFolder(t, "Без программ"), tc.PersonID, "Акт")
	job, err := svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpOcr, DocIds: []uuid.UUID{doc}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ProcessJobs(t.Context(), tenantA, 5); err != nil {
		t.Fatal(err)
	}
	got, _ := svc.Job(ctx, tc, job.Id)
	if got.Status != dapi.DocJobStatusFailed || got.Error == nil || !strings.Contains(*got.Error, "не установлены") {
		t.Fatalf("job %+v", got)
	}
	card, _ := svc.Document(ctx, tc, doc)
	if card.Version != 1 || card.Ocr == nil || card.Ocr.Status != dapi.DocOcrStatusFailed {
		t.Fatalf("document %+v ocr %+v", card.Version, card.Ocr)
	}
}

// A job of a document the member does not open is 404; a viewer cannot start one.
func TestJobAccess(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	withProcessor(t, &fakeProcessor{})
	ctx, tc := as(t, "a.owner")
	doc := seedDoc(t, newFolder(t, "Задания"), tc.PersonID, "Закрытый", "pdf")
	seedFile(t, doc, tc.PersonID, 1, "a.pdf", "application/pdf", []byte("x"))
	job, err := svc.CreateJob(ctx, tc, dapi.DocJobCreate{Op: dapi.DocJobCreateOpCompress, DocIds: []uuid.UUID{doc}})
	if err != nil {
		t.Fatal(err)
	}
	sCtx, sTC := as(t, "a.manager-msk2")
	_, err = svc.Job(sCtx, sTC, job.Id)
	wantCode(t, err, "not_found")
	_, err = svc.CreateJob(sCtx, sTC, dapi.DocJobCreate{Op: dapi.DocJobCreateOpCompress, DocIds: []uuid.UUID{doc}})
	wantCode(t, err, "not_found")
	if err := exec(t.Context(), `insert into docs.shares (document_id, who, ref_id, level) values ($1, 'member', $2, 'view')`, doc, sTC.PersonID); err != nil {
		t.Fatal(err)
	}
	_, err = svc.CreateJob(sCtx, sTC, dapi.DocJobCreate{Op: dapi.DocJobCreateOpMerge, DocIds: []uuid.UUID{doc, doc}})
	wantCode(t, err, "validation_failed")
	_, err = svc.CreateJob(sCtx, sTC, dapi.DocJobCreate{Op: dapi.DocJobCreateOpSplit, DocIds: []uuid.UUID{doc}})
	wantCode(t, err, "forbidden_action")
}
