package docs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Operations of a job (docs.jobs.op).
const (
	opConvert  = "convert"
	opOCR      = "ocr"
	opMerge    = "merge"
	opSplit    = "split"
	opCompress = "compress"
	opPDFA     = "pdfa"
	opToDocx   = "to_docx"
	opToXlsx   = "to_xlsx"
	opToPDF    = "to_pdf"
)

// keyPasswordNeeded marks, in the parameters of a failed job, a file that wants a password.
const keyPasswordNeeded = "passwordNeeded"

// mergeMax bounds the files of a merge.
const mergeMax = 20

// jobNames are the names of the jobs in the list «Задания».
var jobNames = map[string]string{
	opConvert: "Преобразование", opOCR: "Распознавание", opMerge: "Объединение", opSplit: "Разделение", opCompress: "Сжатие",
	opPDFA: "PDF/A", opToDocx: "В Текст · DOCX", opToXlsx: "В Таблицу · XLSX", opToPDF: "В PDF",
}

// jobTypes are the content type and the title suffix of the result of a conversion.
var jobTypes = map[string]struct {
	kind, ext, mime, suffix string
}{
	opToDocx: {kindText, extDocx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", " (DOCX)"},
	opToXlsx: {kindSheet, extXlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", " (XLSX)"},
	opToPDF:  {kindPDF, kindPDF, mimePDF, " (PDF)"},
	opPDFA:   {kindPDF, kindPDF, mimePDF, " (PDF/A)"},
}

// queueJob writes a queued job and returns it.
func (r *req) queueJob(ctx context.Context, op string, docs []uuid.UUID, name string, params map[string]any) error {
	if params == nil {
		params = map[string]any{}
	}
	raw, _ := json.Marshal(params)
	if _, err := r.tx.Exec(ctx, `insert into docs.jobs (id, op, doc_ids, name, params, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7)`,
		r.s.newID(), op, docs, name, raw, r.actorID(), r.now); err != nil {
		return fmt.Errorf("docs: queue job: %w", err)
	}
	return nil
}

// checkJob checks that a job of op may run on the documents (the texts of the prototype): the member converts every
// one of them; a scan is recognized before it is converted; a PDF is not converted into PDF.
func (r *req) checkJob(op string, docs []*document, rts []rights) error {
	for i := range docs {
		if !rts[i].convert {
			return forbidden(textNeedEdit)
		}
		if rts[i].locked && !readOnlyJob[op] {
			return locked(textLocked)
		}
	}
	return checkJobKind(op, docs)
}

// readOnlyJob are the jobs that leave the document as it is (the result is a new document).
var readOnlyJob = map[string]bool{opToPDF: true, opToDocx: true, opToXlsx: true, opPDFA: true, opConvert: true}

// jobChecks check the kind and the state of the documents for each operation.
var jobChecks = map[string]func([]*document) error{
	opOCR:      func(docs []*document) error { return checkOCR(docs[0]) },
	opToDocx:   checkFromPDF,
	opToXlsx:   checkFromPDF,
	opConvert:  checkRecognized,
	opToPDF:    checkNotPDF,
	opPDFA:     checkPDFA,
	opCompress: checkPDFOnly,
	opSplit:    checkPDFOnly,
	opMerge:    checkMerge,
}

// checkJobKind checks the kind and the state of the documents for the operation.
func checkJobKind(op string, docs []*document) error {
	if check := jobChecks[op]; check != nil {
		return check(docs)
	}
	return nil
}

// checkFromPDF: a conversion to Word or Excel starts from a PDF, a scan is recognized first.
func checkFromPDF(docs []*document) error {
	if docs[0].kind != kindPDF {
		return failed("Преобразуется только PDF")
	}
	return checkRecognized(docs)
}

// checkRecognized: a scan without personal data is recognized before it is converted («Сначала распознайте скан»).
func checkRecognized(docs []*document) error {
	d := docs[0]
	if ocr := decodeObject[dapi.DocOcr](d.ocr); d.scan && d.sens != sensPDN && (ocr == nil || ocr.Status != dapi.DocOcrStatusDone) {
		return failed("Сначала распознайте скан")
	}
	return nil
}

// checkNotPDF: a PDF is not converted into PDF.
func checkNotPDF(docs []*document) error {
	if docs[0].kind == kindPDF {
		return failed("Это уже PDF")
	}
	return nil
}

// checkPDFA: PDF/A is made from a PDF that is not a PDF/A yet.
func checkPDFA(docs []*document) error {
	switch {
	case docs[0].kind != kindPDF:
		return failed("PDF/A делают из PDF")
	case docs[0].pdfa:
		return failed("Это уже PDF/A")
	}
	return nil
}

// checkPDFOnly: the compression and the split work on a PDF.
func checkPDFOnly(docs []*document) error {
	if docs[0].kind != kindPDF {
		return failed("Это делают только с PDF")
	}
	return nil
}

// checkMerge: only PDF files are merged.
func checkMerge(docs []*document) error {
	if slices.ContainsFunc(docs, func(x *document) bool { return x.kind != kindPDF }) {
		return failed("Объединяются только PDF")
	}
	return nil
}

// checkOCR checks that a document may be recognized: a scan without personal data that is not recognized yet.
func checkOCR(d *document) error {
	ocr := decodeObject[dapi.DocOcr](d.ocr)
	switch {
	case !d.scan:
		return failed("Распознаются только сканы")
	case d.sens == sensPDN:
		return failed("Скан с персональными данными не распознают")
	case ocr != nil && ocr.Status == dapi.DocOcrStatusDone:
		return failed("Текст уже распознан")
	}
	return nil
}

// jobDocuments reads the documents of a job request the member opens, in the order given, and checks their number.
func (r *req) jobDocuments(op string, in []uuid.UUID) ([]uuid.UUID, []*document, []rights, error) {
	ids := slices.Compact(slices.Clone(in))
	switch {
	case len(ids) == 0:
		return nil, nil, nil, invalid("docIds", "Выберите документ")
	case op == opMerge && (len(ids) < 2 || len(ids) > mergeMax):
		return nil, nil, nil, invalid("docIds", "Для объединения нужно от двух до двадцати файлов")
	case op != opMerge && len(ids) != 1:
		return nil, nil, nil, invalid("docIds", "Задание выполняется над одним документом")
	}
	docs := make([]*document, 0, len(ids))
	rts := make([]rights, 0, len(ids))
	for _, id := range ids {
		d, rt, err := r.doc(id)
		if err != nil {
			return nil, nil, nil, err
		}
		docs, rts = append(docs, d), append(rts, rt)
	}
	return ids, docs, rts, nil
}

// CreateJob queues a job of the worker (createDocJob — docJob): convert, ocr, merge, split, compress, pdfa.
func (s *Service) CreateJob(ctx context.Context, tc tenantctx.TenantContext, b dapi.DocJobCreate) (dapi.DocJob, error) {
	var out dapi.DocJob
	err := s.run(ctx, tc, true, func(r *req) error {
		op := string(b.Op)
		ids, docs, rts, err := r.jobDocuments(op, b.DocIds)
		if err != nil {
			return err
		}
		if err := r.checkJob(op, docs, rts); err != nil {
			return err
		}
		var running bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from docs.jobs where op = $1 and doc_ids = $2 and status in ('queued', 'running'))`,
			op, ids).Scan(&running); err != nil {
			return fmt.Errorf("docs: running jobs: %w", err)
		}
		if running {
			return problem.New(codeJobRunning, "Такое задание уже выполняется")
		}
		if op == opMerge {
			if _, a, err := r.folder(docs[0].folder); err != nil || a.level < levelEdit {
				return forbidden(textNoCreateInFolder)
			}
		}
		params := map[string]any{}
		if b.Params != nil {
			params = *b.Params
		}
		raw, _ := json.Marshal(params)
		name := jobNames[op] + ": " + docs[0].title
		j, err := scanJob(r.tx.QueryRow(ctx, `insert into docs.jobs (id, op, doc_ids, name, params, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7)
			returning `+jobCols, r.s.newID(), op, ids, name, raw, r.me.id, r.now))
		if err != nil {
			return fmt.Errorf("docs: job: %w", err)
		}
		if op == opOCR {
			if _, err := r.tx.Exec(ctx, `update docs.documents set ocr = $2 where id = $1`, docs[0].id, ocrState("queued", 0)); err != nil {
				return fmt.Errorf("docs: ocr state: %w", err)
			}
		}
		if err := r.record(ctx, "docs.job.create", docs[0].id, name, false, map[string]any{"jobId": j.id, "op": op}); err != nil {
			return err
		}
		out = jobDTO(j)
		return nil
	})
	return out, err
}

// retryParams are the parameters of a job for its retry: the mark of a file that wants a password is cleared; a file that
// wants one and no password or "drop locked" given is refused (file_password_protected).
func retryParams(stored []byte, password string, drop bool) ([]byte, error) {
	params := decodeObject[map[string]any](stored)
	if params == nil {
		params = &map[string]any{}
	}
	if needed, _ := (*params)[keyPasswordNeeded].(bool); needed && password == "" && !drop {
		return nil, problem.New(codeFileLocked, "Введите пароль файла или уберите файл")
	}
	delete(*params, keyPasswordNeeded)
	if drop {
		(*params)["dropLocked"] = true
	}
	return json.Marshal(params)
}

// RetryJob repeats a failed job (retryDocJob — docJobRetry). A password is used for this run only and never stored,
// so the run happens in the request; dropLocked skips the locked files of a merge.
func (s *Service) RetryJob(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b dapi.DocJobRetry) (dapi.DocJob, error) {
	var out dapi.DocJob
	password := ""
	if b.Password != nil {
		password = *b.Password
	}
	err := s.runOn(ctx, tc, true, onJob(id), func(r *req) error {
		j, err := r.job(ctx, id)
		if err != nil {
			return err
		}
		if j.status != jobFailed {
			return problem.New(codeTransition, "Повторить можно только задание с ошибкой")
		}
		raw, err := retryParams(j.params, password, b.DropLocked != nil && *b.DropLocked)
		if err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update docs.jobs set status = 'queued', progress = 0, error = null, finished_at = null, params = $2 where id = $1`, id, raw); err != nil {
			return fmt.Errorf("docs: retry job: %w", err)
		}
		j.status, j.progress, j.errText, j.finished, j.params = jobQueued, 0, "", nil, raw
		out = jobDTO(j)
		return nil
	})
	if err != nil || password == "" {
		return out, err
	}
	// the password never reaches the queue: the run is done here and its result replaces the answer
	if _, err := s.runJob(ctx, tc.TenantID, id, password); err != nil {
		return out, err
	}
	err = s.runOn(ctx, tc, false, onJob(id), func(r *req) error {
		j, err := r.job(ctx, id)
		out = jobDTO(j)
		return err
	})
	return out, err
}

// claimJob takes the oldest queued job of the tenant (skipping the ones another worker holds) and marks it running;
// false — none.
func (s *Service) claimJob(ctx context.Context, tenant uuid.UUID, only uuid.UUID) (jobRow, bool, error) {
	pool, err := s.Pools.For(ctx, tenant)
	if err != nil {
		return jobRow{}, false, err
	}
	var j jobRow
	found := false
	err = s.inTx(ctx, pool, tenantctx.TenantContext{TenantID: tenant}, pgx.TxOptions{}, func(r *req) error {
		row := r.tx.QueryRow(ctx, `select `+jobCols+` from docs.jobs where status = 'queued' and ($1::uuid is null or id = $1)
			order by created_at, id limit 1 for update skip locked`, nullID(only))
		x, err := scanJob(row)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("docs: claim job: %w", err)
		}
		if _, err := r.tx.Exec(ctx, `update docs.jobs set status = 'running', progress = 5 where id = $1`, x.id); err != nil {
			return fmt.Errorf("docs: claim job: %w", err)
		}
		x.status, x.progress, j, found = jobRunning, 5, x, true
		return nil
	})
	return j, found, err
}

// ProcessJobs runs the queued jobs of the tenant one by one, at most limit of them, and returns how many it ran.
func (s *Service) ProcessJobs(ctx context.Context, tenant uuid.UUID, limit int) (int, error) {
	n := 0
	for n < limit {
		ran, err := s.runJob(ctx, tenant, uuid.Nil, "")
		if err != nil {
			return n, err
		}
		if !ran {
			break
		}
		n++
	}
	return n, nil
}

// runJob claims a queued job (the one named, or the oldest), runs the programs on its files and writes the result;
// it reports whether a job ran. A failure of the programs is the failure of the job, not an error of the worker.
func (s *Service) runJob(ctx context.Context, tenant, only uuid.UUID, password string) (bool, error) {
	j, ok, err := s.claimJob(ctx, tenant, only)
	if err != nil || !ok {
		return false, err
	}
	pool, err := s.Pools.For(ctx, tenant)
	if err != nil {
		return true, err
	}
	tc := tenantctx.TenantContext{TenantID: tenant, PersonID: j.by}
	var in JobInput
	err = s.inTx(ctx, pool, tc, pgx.TxOptions{AccessMode: pgx.ReadOnly}, func(r *req) error {
		var err error
		in, err = r.jobInput(ctx, j, password)
		return err
	})
	var out JobOutput
	if err == nil {
		out, err = s.process(ctx, in)
	}
	return true, s.inTx(ctx, pool, tc, pgx.TxOptions{}, func(r *req) error {
		r.tc.PersonID = j.by
		return r.finishJob(ctx, j, out, err)
	})
}

// process runs the programs of the jobs.
func (s *Service) process(ctx context.Context, in JobInput) (JobOutput, error) {
	if s.Processor == nil {
		return JobOutput{}, ErrNoProcessor
	}
	return s.Processor.Run(ctx, in)
}

// jobInput reads the files of the documents of a job: the file of the current version of each.
func (r *req) jobInput(ctx context.Context, j jobRow, password string) (JobInput, error) {
	in := JobInput{Op: j.op, Password: password}
	if p := decodeObject[map[string]any](j.params); p != nil {
		in.Params = *p
	}
	for _, id := range j.docs {
		var title string
		var version int
		if err := r.tx.QueryRow(ctx, `select title, current_version from docs.documents where id = $1`, id).Scan(&title, &version); err != nil {
			return in, fmt.Errorf("docs: job document: %w", err)
		}
		v, ok, err := r.version(ctx, id, version)
		if err != nil {
			return in, err
		}
		if !ok || v.file == uuid.Nil {
			return in, errNoFile
		}
		data, f, err := r.readFile(ctx, v.file)
		if err != nil {
			return in, err
		}
		ct, _ := decodeMIME(f.mime)
		in.Inputs = append(in.Inputs, JobFile{Name: title, ContentType: ct, Data: data})
	}
	return in, nil
}

// errNoFile: a document of a job has no file in its current version.
var errNoFile = errors.New("docs: the document has no file")

// jobError is the text of a failed job for the list «Задания».
func jobError(in error, name string) string {
	switch {
	case errors.Is(in, ErrPasswordProtected):
		return name + " защищён паролем: введите пароль или уберите файл"
	case errors.Is(in, ErrNoProcessor):
		return "Программы обработки на сервере не установлены"
	case errors.Is(in, errNoFile):
		return "У документа нет файла"
	}
	var pe *problem.Error
	if errors.As(in, &pe) && pe.Detail != "" {
		return pe.Detail
	}
	return "Не удалось выполнить задание"
}

// finishJob writes the result of a job (a new version, a new document, the words of a recognition) or its failure.
func (r *req) finishJob(ctx context.Context, j jobRow, out JobOutput, runErr error) error {
	if runErr == nil {
		runErr = r.applyJob(ctx, j, out)
	}
	if runErr != nil {
		return r.failJob(ctx, j, runErr)
	}
	return nil
}

// failJob marks a job failed; the transaction of the result is rolled back, so the failure is written on its own.
func (r *req) failJob(ctx context.Context, j jobRow, cause error) error {
	name := j.name
	if n := strings.TrimSpace(strings.TrimPrefix(j.name, jobNames[j.op]+":")); n != "" {
		name = n
	}
	text := jobError(cause, name)
	// a file that wants a password marks the job: a retry without the password is refused (file_password_protected)
	if _, err := r.tx.Exec(ctx, `update docs.jobs set status = 'failed', progress = 0, error = $2, finished_at = $3,
		params = case when $4 then params || jsonb_build_object($5::text, true) else params - $5::text end where id = $1`,
		j.id, text, r.now, errors.Is(cause, ErrPasswordProtected), keyPasswordNeeded); err != nil {
		return fmt.Errorf("docs: fail job: %w", err)
	}
	if j.op == opOCR {
		if _, err := r.tx.Exec(ctx, `update docs.documents set ocr = $2 where id = $1`, j.docs[0], ocrState("failed", 0)); err != nil {
			return fmt.Errorf("docs: ocr state: %w", err)
		}
	}
	ev, err := r.publishService(ctx, "docs.job.failed", aggJob, j.id, map[string]any{"op": j.op, "error": text})
	if err != nil {
		return err
	}
	return r.notify(ctx, "docs.job.failed", "Не выполнено: "+j.name, j.docs[0], ev, []uuid.UUID{j.by})
}

// applyJob writes the result of a job; an error rolls back the writes of the attempt (savepoint).
func (r *req) applyJob(ctx context.Context, j jobRow, out JobOutput) (err error) {
	sp, err := r.tx.Begin(ctx)
	if err != nil {
		return fmt.Errorf("docs: job savepoint: %w", err)
	}
	defer func() {
		if err != nil {
			_ = sp.Rollback(context.WithoutCancel(ctx))
		}
	}()
	inner := *r
	inner.tx = sp
	var result uuid.UUID
	switch j.op {
	case opOCR:
		err = inner.applyOCR(ctx, j, out)
		result = j.docs[0]
	case opCompress:
		err = inner.applyVersion(ctx, j, out, "convert")
		result = j.docs[0]
	case opMerge, opSplit, opConvert, opToDocx, opToXlsx, opToPDF, opPDFA:
		result, err = inner.applyNewDocument(ctx, j, out)
	default:
		err = failed("Неизвестное задание")
	}
	if err != nil {
		return err
	}
	if _, err = inner.tx.Exec(ctx, `update docs.jobs set status = 'done', progress = 100, error = null, finished_at = $2, result_document_id = $3 where id = $1`,
		j.id, r.now, result); err != nil {
		return fmt.Errorf("docs: finish job: %w", err)
	}
	ev, err := inner.publishService(ctx, "docs.job.done", aggJob, j.id, map[string]any{"op": j.op, "resultDocumentId": result})
	if err != nil {
		return err
	}
	if err = inner.notify(ctx, "docs.job.done", "Готово: "+j.name, result, ev, []uuid.UUID{j.by}); err != nil {
		return err
	}
	if err = inner.recordService(ctx, "docs.job.done", j.docs[0], "Готово: "+j.name); err != nil {
		return err
	}
	return sp.Commit(ctx)
}

// firstFile is the main result of a job.
func firstFile(out JobOutput) (JobFile, error) {
	if len(out.Files) == 0 || len(out.Files[0].Data) == 0 {
		return JobFile{}, failed("Программа не вернула файл")
	}
	return out.Files[0], nil
}

// nextVersion writes data as the next version of document id with the source and returns its number.
func (r *req) nextVersion(ctx context.Context, id uuid.UUID, f JobFile, source string, base int) (int, error) {
	var current int
	if err := r.tx.QueryRow(ctx, `select current_version from docs.documents where id = $1 for update`, id).Scan(&current); err != nil {
		return 0, fmt.Errorf("docs: next version: %w", err)
	}
	ct := f.ContentType
	if ct == "" {
		ct = mimePDF
	}
	file, err := r.storeFile(ctx, id, f.Name, ct, f.Data)
	if err != nil {
		return 0, err
	}
	sum := sha256.Sum256(f.Data)
	next := current + 1
	if err := r.insertVersion(ctx, id, next, file, int64(len(f.Data)), hex.EncodeToString(sum[:]), source, "", []uuid.UUID{r.actorID()}, false, base, ""); err != nil {
		return 0, err
	}
	if _, err := r.tx.Exec(ctx, `update docs.documents set current_version = $2, revision = revision + 1, updated_at = $3 where id = $1`, id, next, r.now); err != nil {
		return 0, fmt.Errorf("docs: next version: %w", err)
	}
	if _, err := r.publishService(ctx, "docs.version.saved", aggDocument, id, map[string]any{keyVersion: next, "source": source}); err != nil {
		return 0, err
	}
	return next, nil
}

// applyVersion makes the result the next version of the document (the compression).
func (r *req) applyVersion(ctx context.Context, j jobRow, out JobOutput, source string) error {
	f, err := firstFile(out)
	if err != nil {
		return err
	}
	var base int
	if err := r.tx.QueryRow(ctx, `select current_version from docs.documents where id = $1`, j.docs[0]).Scan(&base); err != nil {
		return fmt.Errorf("docs: base version: %w", err)
	}
	_, err = r.nextVersion(ctx, j.docs[0], f, source, base)
	return err
}

// applyOCR makes the searchable PDF the next version and stores the doubtful words and the state of the text layer.
func (r *req) applyOCR(ctx context.Context, j jobRow, out JobOutput) error {
	if err := r.applyVersion(ctx, j, out, "ocr"); err != nil {
		return err
	}
	id := j.docs[0]
	if _, err := r.tx.Exec(ctx, `delete from docs.ocr_words where document_id = $1`, id); err != nil {
		return fmt.Errorf("docs: ocr words: %w", err)
	}
	for _, w := range out.Words {
		if _, err := r.tx.Exec(ctx, `insert into docs.ocr_words (document_id, id, row_number, text, suggestion, confidence, why)
			values ($1, $2, $3, $4, nullif($5, ''), $6, nullif($7, ''))`, id, w.ID, w.Row, w.Text, w.Suggestion, min(max(w.Confidence, 0), 1), w.Why); err != nil {
			return fmt.Errorf("docs: ocr word: %w", err)
		}
	}
	state := map[string]any{"status": "done", "doubtful": len(out.Words), "at": r.now}
	if out.Confidence > 0 {
		state["confidence"] = out.Confidence
	}
	if out.Lang != "" {
		state["lang"] = out.Lang
	}
	raw, _ := json.Marshal(state)
	if _, err := r.tx.Exec(ctx, `update docs.documents set ocr = $2 where id = $1`, id, raw); err != nil {
		return fmt.Errorf("docs: ocr state: %w", err)
	}
	return nil
}

// jobSource is the document a job started from.
type jobSource struct {
	folder, owner uuid.UUID
	title, sens   string
	links         []byte
}

// resultTitle is the title and the content type of the i-th new document of a job.
func resultTitle(j jobRow, src jobSource, i int, ct string) (title, contentType string) {
	switch t, ok := jobTypes[j.op]; {
	case ok:
		return src.title + t.suffix, t.mime
	case j.op == opMerge:
		return mergedTitle(j, src.title), ct
	case j.op == opSplit:
		return fmt.Sprintf("%s (часть %d)", src.title, i+1), ct
	}
	return src.title, ct
}

// applyNewDocument makes a new document next to the source (the conversions, PDF/A, the merge and the split): the
// source does not change. It returns the first new document.
func (r *req) applyNewDocument(ctx context.Context, j jobRow, out JobOutput) (uuid.UUID, error) {
	if len(out.Files) == 0 {
		return uuid.Nil, failed("Программа не вернула файл")
	}
	var src jobSource
	if err := r.tx.QueryRow(ctx, `select folder_id, owner_id, title, sensitivity, links from docs.documents where id = $1`, j.docs[0]).
		Scan(&src.folder, &src.owner, &src.title, &src.sens, &src.links); err != nil {
		return uuid.Nil, fmt.Errorf("docs: job source: %w", err)
	}
	first := uuid.Nil
	for i, f := range out.Files {
		id, err := r.newResult(ctx, j, src, i, f)
		if err != nil {
			return uuid.Nil, err
		}
		if first == uuid.Nil {
			first = id
		}
	}
	return first, nil
}

// newResult writes the i-th new document of a job with its file as version 1.
func (r *req) newResult(ctx context.Context, j jobRow, src jobSource, i int, f JobFile) (uuid.UUID, error) {
	d := &document{id: r.s.newID(), kind: kindPDF, folder: src.folder, owner: j.by, status: statusDraft, sens: src.sens, mode: modeInherit,
		version: 1, revision: 1, created: r.now, updated: r.now, links: src.links, fields: []byte("[]"), protect: []byte("[]")}
	var ct string
	d.title, ct = resultTitle(j, src, i, f.ContentType)
	if t, ok := jobTypes[j.op]; ok {
		d.kind, d.pdfa = t.kind, j.op == opPDFA
	}
	if ct == "" {
		ct = mimePDF
	}
	if err := r.insertDocument(ctx, d); err != nil {
		return uuid.Nil, err
	}
	file, err := r.storeFile(ctx, d.id, f.Name, ct, f.Data)
	if err != nil {
		return uuid.Nil, err
	}
	source := "convert"
	if j.op == opMerge {
		source = "merge"
	}
	sum := sha256.Sum256(f.Data)
	if err := r.insertVersion(ctx, d.id, 1, file, int64(len(f.Data)), hex.EncodeToString(sum[:]), source, "", []uuid.UUID{j.by}, false, 0, ""); err != nil {
		return uuid.Nil, err
	}
	_, err = r.publishService(ctx, "docs.document.created", aggDocument, d.id, map[string]any{"folderId": d.folder, "kind": d.kind, "jobId": j.id})
	return d.id, err
}

// mergedTitle is the title of a merge: the name given or «Объединение: <first title>».
func mergedTitle(j jobRow, first string) string {
	if p := decodeObject[map[string]any](j.params); p != nil {
		if n, ok := (*p)[keyName].(string); ok && strings.TrimSpace(n) != "" {
			return clip(strings.TrimSpace(n), titleMax)
		}
	}
	return clip("Объединение: "+first, titleMax)
}

// ocrWord is a row of docs.ocr_words.
type ocrWord struct {
	row         int
	text, state string
	sug, why    *string
	conf        float64
}

// decideWord applies the decision of the member to a word: the new state and the text.
func decideWord(w ocrWord, b dapi.DocOcrWordReview) (state, text string, err error) {
	switch b.Action {
	case dapi.Accept:
		if w.sug == nil {
			return "", "", invalid("action", "У слова нет предложения")
		}
		return "accepted", *w.sug, nil
	case dapi.Keep:
		return "kept", w.text, nil
	case dapi.Fix:
		v := ""
		if b.Value != nil {
			v = strings.TrimSpace(*b.Value)
		}
		if v == "" || len([]rune(v)) > 100 {
			return "", "", invalid("value", "Своё значение — от 1 до 100 символов")
		}
		return "fixed", v, nil
	}
	return "", "", invalid("action", "Выберите действие")
}

// ReviewOcrWord decides on a doubtful word (reviewOcrWord — docOcrWord): accept the suggestion, keep the word, or fix
// it with a value of the member.
func (s *Service) ReviewOcrWord(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, word string, b dapi.DocOcrWordReview) (dapi.DocOcrWord, error) {
	var out dapi.DocOcrWord
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if err := editable(rt); err != nil {
			return err
		}
		var w ocrWord
		err = r.tx.QueryRow(ctx, `select row_number, text, state, suggestion, why, confidence::float8 from docs.ocr_words where document_id = $1 and id = $2 for update`,
			id, word).Scan(&w.row, &w.text, &w.state, &w.sug, &w.why, &w.conf)
		if errors.Is(err, pgx.ErrNoRows) {
			return notFound(textWordNotFound)
		}
		if err != nil {
			return fmt.Errorf("docs: ocr word: %w", err)
		}
		next, text, err := decideWord(w, b)
		if err != nil {
			return err
		}
		if err := r.saveWord(ctx, d, word, next, text); err != nil {
			return err
		}
		if err := r.record(ctx, "docs.ocr.review", id, "Распознавание: слово «"+clip(w.text, 40)+"» — "+next, false, nil); err != nil {
			return err
		}
		out = wordDTO(word, w, next, text)
		return nil
	})
	return out, err
}

// saveWord stores the decision on a word and refreshes the number of doubtful words of the document.
func (r *req) saveWord(ctx context.Context, d *document, word, state, text string) error {
	if _, err := r.tx.Exec(ctx, `update docs.ocr_words set state = $3, text = $4 where document_id = $1 and id = $2`, d.id, word, state, text); err != nil {
		return fmt.Errorf("docs: ocr word: %w", err)
	}
	var left int
	if err := r.tx.QueryRow(ctx, `select count(*) from docs.ocr_words where document_id = $1 and state = 'doubtful'`, d.id).Scan(&left); err != nil {
		return fmt.Errorf("docs: ocr words: %w", err)
	}
	if _, err := r.tx.Exec(ctx, `update docs.documents set ocr = jsonb_set(coalesce(ocr, '{}'::jsonb), '{doubtful}', to_jsonb($2::int)) where id = $1`, d.id, left); err != nil {
		return fmt.Errorf("docs: ocr state: %w", err)
	}
	r.w.ocrOpen[d.id] = left
	return r.touch(ctx, d)
}

// wordDTO is a word after the decision.
func wordDTO(id string, w ocrWord, state, text string) dapi.DocOcrWord {
	row := int64(w.row)
	out := dapi.DocOcrWord{Id: id, Text: text, State: dapi.DocOcrWordState(state), Confidence: float32(w.conf), Row: &row}
	if w.sug != nil {
		out.Suggestion = *w.sug
	}
	if w.why != nil {
		out.Why = *w.why
	}
	return out
}
