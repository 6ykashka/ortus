package docs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const (
	titleMin = 2
	titleMax = 200
)

var refRE = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,49}$`)

// checkTitle trims a title and checks its length («Название — не короче 2 символов»).
func checkTitle(title string) (string, error) {
	t := strings.TrimSpace(title)
	switch n := utf8.RuneCountInString(t); {
	case n < titleMin:
		return "", invalid("title", "Название — не короче 2 символов")
	case n > titleMax:
		return "", invalid("title", "Название — не длиннее 200 символов")
	}
	return t, nil
}

// editable checks that the member edits the document and that it is open for editing (on a route, signed or a PDF/A
// copy a document is closed: 409 document_locked).
func editable(rt rights) error {
	if !rt.editL {
		return forbidden(textNeedEdit)
	}
	if rt.locked {
		return locked(textLocked)
	}
	return nil
}

// stale checks If-Match against the revision of a document (412 revision_mismatch).
func stale(ifMatch string, rev int) error {
	if ifMatch != etag(int64(rev)) {
		return problem.New(codeRevision, "Документ уже изменили. Обновите страницу и повторите.")
	}
	return nil
}

// linksJSON checks the link of a new document to a record and renders the stored list.
func linksJSON(l *dapi.ObjectRef) ([]byte, error) {
	if l == nil {
		return []byte("[]"), nil
	}
	if !refRE.MatchString(l.ModuleKey) || !regexp.MustCompile(`^[a-z][a-z0-9_]{1,49}$`).MatchString(l.EntityType) || l.EntityId == uuid.Nil {
		return nil, invalid("link", "Связь с записью указана неверно")
	}
	return json.Marshal([]dapi.DocLink{{Object: *l}})
}

// template is a row of docs.templates the new document is made from.
type template struct {
	id     uuid.UUID
	name   string
	kind   string
	link   string
	fields []byte
}

func (r *req) template(ctx context.Context, id uuid.UUID) (template, error) {
	var t template
	var link *string
	err := r.tx.QueryRow(ctx, `select id, name, kind, link, fields from docs.templates where id = $1`, id).Scan(&t.id, &t.name, &t.kind, &link, &t.fields)
	if errors.Is(err, pgx.ErrNoRows) {
		return t, invalid("templateId", "Шаблон не найден")
	}
	if err != nil {
		return t, fmt.Errorf("docs: template: %w", err)
	}
	if link != nil {
		t.link = *link
	}
	return t, nil
}

// CreateDocument creates a document: version 1, the folder gives the access (docCreate). A scan queues the
// recognition unless the document is marked pdn (DOC-07).
func (s *Service) CreateDocument(ctx context.Context, tc tenantctx.TenantContext, b dapi.DocCreate) (dapi.Document, error) {
	var out dapi.Document
	err := s.runOn(ctx, tc, true, onFolder(b.FolderId), func(r *req) error {
		f, a, err := r.folder(b.FolderId)
		if err != nil {
			return err
		}
		if a.level < levelEdit {
			return forbidden(textNoCreateInFolder)
		}
		d, err := r.newDocument(ctx, b, f)
		if err != nil {
			return err
		}
		if err := r.insertDocument(ctx, d); err != nil {
			return err
		}
		if err := r.firstVersion(ctx, d, b); err != nil {
			return err
		}
		r.w.addDoc(d)
		if d.scan && d.sens != sensPDN {
			if err := r.queueJob(ctx, opOCR, []uuid.UUID{d.id}, jobNames[opOCR]+": "+d.title, nil); err != nil {
				return err
			}
		}
		if _, err := r.publish(ctx, "docs.document.created", aggDocument, d.id, map[string]any{"folderId": f.id, "kind": d.kind, "scan": d.scan}); err != nil {
			return err
		}
		if err := r.record(ctx, "docs.document.create", d.id, "Создан документ «"+d.title+"»", false, map[string]any{"folderId": f.id}); err != nil {
			return err
		}
		out, err = r.document(ctx, d, r.w.rightsFor(r.me, d))
		return err
	})
	return out, err
}

// newDocument checks the request of a new document and makes its row: the title, the label, the link to a record,
// the template with its fields, the files of a PDF and the scan.
func (r *req) newDocument(ctx context.Context, b dapi.DocCreate, f *folder) (*document, error) {
	title, err := checkTitle(b.Title)
	if err != nil {
		return nil, err
	}
	d := &document{id: r.s.newID(), kind: string(b.Kind), title: title, folder: f.id, owner: r.me.id, status: statusDraft, sens: sensNormal,
		mode: modeInherit, version: 1, revision: 1, created: r.now, updated: r.now, fields: []byte("[]"), protect: []byte("[]")}
	if b.Sensitivity != nil {
		d.sens = string(*b.Sensitivity)
	}
	if d.links, err = linksJSON(b.Link); err != nil {
		return nil, err
	}
	if b.TemplateId != nil {
		if err := r.fromTemplate(ctx, d, *b.TemplateId, b.Link != nil); err != nil {
			return nil, err
		}
	}
	if d.kind == kindPDF && (b.FileIds == nil || len(*b.FileIds) == 0) {
		return nil, invalid("fileIds", "Добавьте файлы или фото")
	}
	if b.Scan != nil && *b.Scan {
		if d.kind != kindPDF {
			return nil, invalid("scan", "Скан — это PDF")
		}
		d.scan, d.ocr = true, ocrState("queued", 0)
		if d.sens == sensPDN {
			d.ocr = ocrState("none", 0)
		}
	}
	return d, nil
}

// fromTemplate takes the kind-checked fields of a template; a template that fills from a record needs the link.
func (r *req) fromTemplate(ctx context.Context, d *document, id uuid.UUID, linked bool) error {
	t, err := r.template(ctx, id)
	if err != nil {
		return err
	}
	if t.link != "" && !linked {
		return invalid("link", "Выберите рейс / объект для полей шаблона")
	}
	if d.kind != t.kind {
		return invalid("kind", "Вид документа не совпадает с шаблоном")
	}
	d.template, d.fields = t.id, t.fields
	return nil
}

// firstVersion writes version 1: the first uploaded file, or the CSV of a sheet, or an empty body for the engine.
func (r *req) firstVersion(ctx context.Context, d *document, b dapi.DocCreate) error {
	var ids []uuid.UUID
	if b.FileIds != nil {
		ids = *b.FileIds
	}
	claimed, err := r.claimFiles(ctx, d.id, ids)
	if err != nil {
		return err
	}
	source, first := sourceEdit, uuid.Nil
	var size int64
	var sha string
	switch {
	case len(claimed) > 0:
		source, first, size, sha = "upload", claimed[0].id, claimed[0].bytes, claimed[0].sha256
	case b.Csv != nil && strings.TrimSpace(*b.Csv) != "" && d.kind == kindSheet:
		if first, err = r.storeFile(ctx, d.id, d.title+".csv", "text/csv", []byte(*b.Csv)); err != nil {
			return err
		}
		size = int64(len(*b.Csv))
	}
	return r.insertVersion(ctx, d.id, 1, first, size, sha, source, "", []uuid.UUID{r.me.id}, false, 0, "")
}

// ocrState is the stored state of the text layer (DocOcr).
func ocrState(status string, doubtful int) []byte {
	b, _ := json.Marshal(map[string]any{"status": status, "doubtful": doubtful})
	return b
}

// insertDocument writes the row of a new document.
func (r *req) insertDocument(ctx context.Context, d *document) error {
	_, err := r.tx.Exec(ctx, `insert into docs.documents (id, kind, title, folder_id, owner_id, status, sensitivity, mode, current_version,
		template_id, links, fields, scan, pdfa_copy, protected_ranges, ocr, created_at, updated_at, revision)
		values ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11, $12, $13, $14, $15, $16, $16, 1)`,
		d.id, d.kind, d.title, d.folder, d.owner, d.status, d.sens, d.mode, nullID(d.template), d.links, d.fields, d.scan,
		d.pdfa, d.protect, nullBytes(d.ocr), d.created)
	if err != nil {
		return fmt.Errorf("docs: insert document: %w", err)
	}
	return nil
}

// nullBytes is NULL for an empty jsonb value.
func nullBytes(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return b
}

// insertVersion writes version n of a document.
func (r *req) insertVersion(ctx context.Context, doc uuid.UUID, n int, file uuid.UUID, size int64, sha, source, name string, authors []uuid.UUID,
	forcesave bool, base int, engineKey string) error {
	var shaArg, nameArg, keyArg, baseArg any
	if sha != "" {
		shaArg = sha
	}
	if name != "" {
		nameArg = name
	}
	if engineKey != "" {
		keyArg = engineKey
	}
	if base > 0 {
		baseArg = base
	}
	_, err := r.tx.Exec(ctx, `insert into docs.versions (document_id, number, file_id, size_bytes, sha256, source, name, authors, forcesave,
		base_number, engine_key, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
		doc, n, nullID(file), size, shaArg, source, nameArg, authors, forcesave, baseArg, keyArg, r.now)
	if err != nil {
		return fmt.Errorf("docs: insert version: %w", err)
	}
	return nil
}

// touch bumps the revision and the time of change of a document and mirrors them in the snapshot.
func (r *req) touch(ctx context.Context, d *document) error {
	if err := r.tx.QueryRow(ctx, `update docs.documents set revision = revision + 1, updated_at = $2 where id = $1 returning revision`,
		d.id, r.now).Scan(&d.revision); err != nil {
		return fmt.Errorf("docs: touch: %w", err)
	}
	d.updated = r.now
	return nil
}

// UpdateDocument renames a document or changes its sensitivity (updateDocument — docRename). The label pdn switches
// the recognition off; a finance or pdn label is set by the one who manages access.
func (s *Service) UpdateDocument(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b dapi.DocPatch) (dapi.Document, error) {
	var out dapi.Document
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if err := stale(ifMatch, d.revision); err != nil {
			return err
		}
		if err := editable(rt); err != nil {
			return err
		}
		changed, err := r.patchDocument(ctx, d, rt, b)
		if err != nil {
			return err
		}
		if changed {
			if err := r.touch(ctx, d); err != nil {
				return err
			}
			if err := r.record(ctx, "docs.document.rename", id, "Документ «"+d.title+"» изменён", false, nil); err != nil {
				return err
			}
		}
		out, err = r.document(ctx, d, r.w.rightsFor(r.me, d))
		return err
	})
	return out, err
}

// patchDocument writes the new title and label of a document; it reports whether something changed.
func (r *req) patchDocument(ctx context.Context, d *document, rt rights, b dapi.DocPatch) (bool, error) {
	title, sens := d.title, d.sens
	if b.Title != nil {
		t, err := checkTitle(*b.Title)
		if err != nil {
			return false, err
		}
		title = t
	}
	if b.Sensitivity != nil && string(*b.Sensitivity) != d.sens {
		if !rt.manage {
			return false, forbidden("Метку документа меняет тот, кто управляет доступом")
		}
		sens = string(*b.Sensitivity)
	}
	if title == d.title && sens == d.sens {
		return false, nil
	}
	if _, err := r.tx.Exec(ctx, `update docs.documents set title = $2, sensitivity = $3 where id = $1`, d.id, title, sens); err != nil {
		return false, fmt.Errorf("docs: update document: %w", err)
	}
	if sens == sensPDN && d.sens != sensPDN && d.scan {
		if err := r.dropRecognition(ctx, d); err != nil {
			return false, err
		}
	}
	d.title, d.sens = title, sens
	return true, nil
}

// dropRecognition switches the recognition off for a scan with personal data: the words go, the state says none.
func (r *req) dropRecognition(ctx context.Context, d *document) error {
	if _, err := r.tx.Exec(ctx, `delete from docs.ocr_words where document_id = $1`, d.id); err != nil {
		return fmt.Errorf("docs: ocr words: %w", err)
	}
	if _, err := r.tx.Exec(ctx, `update docs.documents set ocr = $2 where id = $1`, d.id, ocrState("none", 0)); err != nil {
		return fmt.Errorf("docs: ocr state: %w", err)
	}
	r.w.ocrOpen[d.id] = 0
	return nil
}

// impactDTO renders the impact of a change of access.
func (r *req) impactDTO(i impact) dapi.DocAccessImpact {
	conv := func(ps []impactPerson) []dapi.DocImpactPerson {
		out := make([]dapi.DocImpactPerson, 0, len(ps))
		for _, p := range ps {
			x := dapi.DocImpactPerson{Member: r.memberRef(p.member.id), Invited: p.invited}
			if p.from > 0 {
				f := dapi.DocImpactPersonFrom(p.from.code())
				x.From = &f
			}
			if p.to > 0 {
				t := dapi.DocImpactPersonTo(p.to.code())
				x.To = &t
			}
			out = append(out, x)
		}
		return out
	}
	return dapi.DocAccessImpact{Gain: conv(i.gain), Lose: conv(i.lose), Up: conv(i.up), Down: conv(i.down)}
}

// MoveDocument moves a document to another folder (moveDocument — docMove); dryRun moves nothing and answers who
// gains and loses access.
func (s *Service) MoveDocument(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b dapi.DocMove) (dapi.DocMoveResult, error) {
	var out dapi.DocMoveResult
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if !rt.editL {
			return forbidden(textNeedEdit)
		}
		to, a, err := r.folder(b.FolderId)
		if err != nil {
			return err
		}
		switch {
		case a.level < levelEdit:
			return forbidden(textNoCreateInFolder)
		case to.id == d.folder:
			return failed(textSameFolder)
		case rt.locked:
			return locked(textLocked)
		}
		imp := r.w.impactOfMove(d, to)
		out.Impact = r.impactDTO(imp)
		if b.DryRun != nil && *b.DryRun {
			return nil
		}
		if err := r.moveTo(ctx, d, to, imp); err != nil {
			return err
		}
		sum := r.summary(d, r.w.rightsFor(r.me, d))
		out.Applied, out.Document = true, &sum
		return nil
	})
	return out, err
}

// moveTo moves a document and journals it: the event, the audit and the notice «Вам открыт доступ» of who gained.
func (r *req) moveTo(ctx context.Context, d *document, to *folder, imp impact) error {
	if _, err := r.tx.Exec(ctx, `update docs.documents set folder_id = $2 where id = $1`, d.id, to.id); err != nil {
		return fmt.Errorf("docs: move: %w", err)
	}
	from := r.w.folders[d.folder]
	d.folder = to.id
	if err := r.touch(ctx, d); err != nil {
		return err
	}
	ev, err := r.publish(ctx, "docs.document.moved", aggDocument, d.id, map[string]any{"from": from.id, "to": to.id})
	if err != nil {
		return err
	}
	if err := r.record(ctx, "docs.document.move", d.id, "Перенесён: «"+r.w.label(from)+"» → «"+r.w.label(to)+"»", true,
		map[string]any{"from": from.id, "to": to.id}); err != nil {
		return err
	}
	var gained []uuid.UUID
	for _, p := range imp.gain {
		gained = append(gained, p.member.id)
	}
	return r.notify(ctx, "docs.access.granted", "Вам открыт доступ к документу «"+d.title+"»", d.id, ev, gained)
}

// ArchiveDocument archives a document (archiveDocument): nothing is deleted; a document on a route is not archived.
func (s *Service) ArchiveDocument(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (dapi.Document, error) {
	return s.archive(ctx, tc, id, true)
}

// RestoreDocument returns an archived document to the status it had before (restoreDocument).
func (s *Service) RestoreDocument(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (dapi.Document, error) {
	return s.archive(ctx, tc, id, false)
}

func (s *Service) archive(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, to bool) (dapi.Document, error) {
	var out dapi.Document
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if !rt.editL {
			return forbidden(textNeedEdit)
		}
		if err := archiveRules(d, to); err != nil {
			return err
		}
		prev, next := d.status, statusArchived
		if !to {
			next = r.statusBeforeArchive(ctx, id)
		}
		if err := r.setStatus(ctx, d, next, to); err != nil {
			return err
		}
		action, text := "docs.document.archive", "Документ перенесён в архив"
		if !to {
			action, text = "docs.document.restore", "Документ возвращён из архива"
		}
		if err := r.record(ctx, action, id, text, false, map[string]any{"from": prev, "to": next}); err != nil {
			return err
		}
		out, err = r.document(ctx, d, r.w.rightsFor(r.me, d))
		return err
	})
	return out, err
}

// archiveRules checks the transition: a document is archived once and restored once, a document on a route is not
// archived.
func archiveRules(d *document, toArchive bool) error {
	switch {
	case toArchive && d.status == statusArchived, !toArchive && d.status != statusArchived:
		return problem.New(codeTransition, "Документ уже в этом состоянии")
	case toArchive && (d.status == statusInRoute || (d.route != nil && d.route.status == "active")):
		return problem.New(codeTransition, "Документ на маршруте: сначала завершите или отмените маршрут")
	}
	return nil
}

// setStatus writes the status of a document (the archive keeps the time of archiving).
func (r *req) setStatus(ctx context.Context, d *document, status string, archive bool) error {
	var err error
	if archive {
		_, err = r.tx.Exec(ctx, `update docs.documents set status = 'archived', archived_at = $2 where id = $1`, d.id, r.now)
	} else {
		_, err = r.tx.Exec(ctx, `update docs.documents set status = $2, archived_at = null where id = $1`, d.id, status)
	}
	if err != nil {
		return fmt.Errorf("docs: status: %w", err)
	}
	d.status = status
	return r.touch(ctx, d)
}

// statusBeforeArchive is the status the last archiving of a document recorded (draft when none).
func (r *req) statusBeforeArchive(ctx context.Context, id uuid.UUID) string {
	var prev string
	err := r.tx.QueryRow(ctx, `select coalesce(diff->>'from', '') from audit.events
		where target_type = $2 and target_id = $1 and action = 'docs.document.archive' order by id desc limit 1`, id, aggDocument).Scan(&prev)
	if err != nil || prev == "" || prev == statusArchived || prev == statusInRoute {
		return statusDraft
	}
	return prev
}
