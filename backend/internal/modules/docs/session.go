package docs

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const (
	sessionTTL = time.Hour // the signed configuration of an editor session lives an hour
	fileURLTTL = 15 * time.Minute
	hintNoEdit = "Редактор подключается"
)

// extensions are the file types of the engine by the content type of the file of a version.
var extensions = map[string]string{
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": extDocx,
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":       extXlsx,
	"application/msword":                             "doc",
	"application/vnd.ms-excel":                       "xls",
	"application/vnd.oasis.opendocument.text":        "odt",
	"application/vnd.oasis.opendocument.spreadsheet": "ods",
	mimePDF:      kindPDF,
	"text/plain": "txt",
	"text/csv":   "csv",
}

// modeRank orders the modes of a session from the weakest.
var modeRank = map[string]int{modeView: 0, modeComment: 1, modeReview: 2, modeEdit: 3}

// allowedMode lowers the requested mode to what the rights give (the server decides, the client only asks).
func allowedMode(want string, rt rights, kind string) string {
	best := modeView
	if rt.comment && rt.onlyVersion == 0 {
		best = modeComment
	}
	if rt.suggest && kind != kindSheet {
		best = modeReview
	}
	if rt.edit {
		best = modeEdit
	}
	if _, ok := modeRank[want]; !ok {
		return modeView
	}
	if modeRank[want] < modeRank[best] {
		return want
	}
	return best
}

// permissionsOf are the rights of the member in the engine for the mode (engineCfg of the prototype). Protected ranges
// by role are not promised: the engine has no API for them (DOC-03, Q-W4.00-documents-12).
func permissionsOf(rt rights, mode, kind string) Permissions {
	p := Permissions{Download: rt.export, Print: rt.export}
	switch mode {
	case modeEdit:
		p.Edit, p.Review, p.Comment = true, kind != kindSheet, rt.comment
	case modeReview:
		p.Review, p.Comment = true, rt.comment
	case modeComment:
		p.Comment = true
	}
	return p
}

// OpenSession gives the signed configuration of an editor session (openDocumentSession). Without a server the answer
// is editorAvailable false and the hint: the document opens for viewing and downloads (Q-W4.00-documents-1).
func (s *Service) OpenSession(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, want string) (dapi.DocSessionConfig, error) {
	var out dapi.DocSessionConfig
	err := s.runOn(ctx, tc, false, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		version := d.version
		if rt.onlyVersion > 0 {
			version = rt.onlyVersion
		}
		mode := allowedMode(want, rt, d.kind)
		out = dapi.DocSessionConfig{
			DocumentKey: engineKey(tc.TenantID, id, version), Version: int64(version), Mode: dapi.DocSessionConfigMode(mode),
			Engine: dapi.DocSessionConfigEngineNone, User: r.memberRef(r.me.id), ExpiresAt: instant(r.now.Add(sessionTTL)),
			ProtectedRanges: decodeList[dapi.DocProtectedRange](d.protect),
		}
		perms := permissionsOf(rt, mode, d.kind)
		fileURL, ext, err := r.fileLink(ctx, d, version)
		if err != nil {
			return err
		}
		if fileURL != "" {
			out.FileUrl = &fileURL
		}
		cb := r.s.callbackURL()
		out.CallbackUrl = &cb
		eng := r.s.Engine
		if eng == nil || !eng.Configured() {
			hint := hintNoEdit
			out.Hint, out.Mode = &hint, dapi.DocSessionConfigModeView
			perms.Edit, perms.Review = false, false
			out.Permissions = permissionsDTO(perms)
			return nil
		}
		cfg, err := eng.Session(SessionRequest{
			Key: out.DocumentKey, Title: d.title, Kind: d.kind, Extension: ext, FileURL: fileURL, CallbackURL: cb, UserID: r.me.id, UserName: r.me.name,
			Mode: mode, Perms: perms, Expires: r.now.Add(sessionTTL),
		})
		if err != nil {
			return problem.Wrap(problem.CodeDependencyUnavailable, err)
		}
		out.Engine, out.EditorAvailable = dapi.DocSessionConfigEngine(cfg.Engine), true
		out.EditorUrl, out.Token = &cfg.EditorURL, &cfg.Token
		out.Permissions = permissionsDTO(perms)
		return nil
	})
	return out, err
}

func permissionsDTO(p Permissions) dapi.DocSessionPermissions {
	return dapi.DocSessionPermissions{Edit: p.Edit, Review: p.Review, Comment: p.Comment, Download: p.Download, Print: p.Print,
		FillForms: p.FillForms, ProtectedRanges: p.ProtectedRanges}
}

// callbackURL is the address of docServerCallback the engine calls.
func (s *Service) callbackURL() string {
	if s.CallbackURL != "" {
		return s.CallbackURL
	}
	return strings.TrimRight(s.PublicBase, "/") + "/api/v1/internal/docs/callback"
}

// fileLink is the short-lived signed address of the file of the version and the file type for the engine.
func (r *req) fileLink(ctx context.Context, d *document, version int) (string, string, error) {
	v, ok, err := r.version(ctx, d.id, version)
	if err != nil || !ok || v.file == uuid.Nil {
		return "", defaultExt(d.kind), err
	}
	f, found, err := r.fileOf(ctx, v.file)
	if err != nil || !found || f.state != stateReady {
		return "", defaultExt(d.kind), err
	}
	ct, name := decodeMIME(f.mime)
	ext := extensions[ct]
	if ext == "" {
		ext = defaultExt(d.kind)
	}
	if r.s.Blobs == nil {
		return "", ext, nil
	}
	if name == "" {
		name = d.title + "." + ext
	}
	u, err := r.s.Blobs.PresignGet(f.key, path.Base(name), fileURLTTL)
	if err != nil {
		return "", ext, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return u, ext, nil
}

func defaultExt(kind string) string {
	switch kind {
	case kindSheet:
		return "xlsx"
	case kindPDF:
		return kindPDF
	}
	return "docx"
}

// serverAuthKey marks a context whose request passed the check of the JWT of the document server.
type serverAuthKey struct{}

// ServerAuthed reports whether the request of ctx carries a valid JWT of the document server.
func ServerAuthed(ctx context.Context) bool { v, _ := ctx.Value(serverAuthKey{}).(bool); return v }

// AuthorizeCallback checks the JWT of a callback of the document server (Authorization: Bearer) and marks the context
// of the request (the gateway has no session for it, the operation is classified by the scope docs-server-callback).
func (s *Service) AuthorizeCallback(r *http.Request) (context.Context, error) {
	if s.Engine == nil || !s.Engine.Configured() {
		return r.Context(), problem.New(problem.CodeDependencyUnavailable, "Сервер документов не подключён")
	}
	tok, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok || s.Engine.VerifyCallback(strings.TrimSpace(tok)) != nil {
		return r.Context(), problem.New(codeUnauth, "")
	}
	return context.WithValue(r.Context(), serverAuthKey{}, true), nil
}

// CallbackBody is the call of the document server (DocServerCallback of the contract).
type CallbackBody struct {
	Key      string
	Status   int
	URL      string
	Users    []string
	Lastsave time.Time
}

// dedup tells two forced saves of one key apart: the moment of the save, or the address of the file.
func (b CallbackBody) dedup() string {
	if !b.Lastsave.IsZero() {
		return b.Lastsave.UTC().Format(time.RFC3339Nano)
	}
	sum := sha256.Sum256([]byte(b.URL))
	return hex.EncodeToString(sum[:8])
}

// Callback statuses of the document server.
const (
	cbEditing       = 1
	cbReady         = 2
	cbSaveError     = 3
	cbClosed        = 4
	cbForce         = 6
	cbForceError    = 7
	callbackErrorOK = 0
)

// Callback accepts the call of the document server (docServerCallback, ADR-0016): the tenant, the document and the
// version come from the key after the signature is checked; a ready file becomes the next version, a repeat of the
// same key is accepted without a second version; a key of an old version is 409.
func (s *Service) Callback(ctx context.Context, b CallbackBody) error {
	if !ServerAuthed(ctx) {
		return problem.New(codeUnauth, "")
	}
	tenant, doc, base, err := parseKey(b.Key)
	if err != nil {
		return invalid("key", "Ключ версии указан неверно")
	}
	switch b.Status {
	case cbEditing, cbClosed, cbSaveError, cbForceError:
		return s.noteCallback(ctx, tenant, doc, b)
	case cbReady, cbForce:
	default:
		return invalid("status", "Неизвестный статус сервера документов")
	}
	if b.URL == "" {
		return invalid("url", "Нет адреса сохранённого файла")
	}
	pool, err := s.Pools.For(ctx, tenant)
	if err != nil {
		return notFound("")
	}
	// the file is read before the transaction: the engine host answers slowly and the row stays unlocked meanwhile
	data, err := s.fetch(ctx, b.URL)
	if err != nil {
		return err
	}
	return s.inTx(ctx, pool, tenantctx.TenantContext{TenantID: tenant}, pgx.TxOptions{}, func(r *req) error {
		return r.saveFromEngine(ctx, doc, base, b, data)
	})
}

// engineGuard checks a save of the engine against the document: a repeat of a call (the key is known) is accepted
// without a second version (true), a key of an old version is 409, a document on a route, signed or archived is closed.
func (r *req) engineGuard(ctx context.Context, doc uuid.UUID, key string, base, current int, status string) (bool, error) {
	var exists bool
	if err := r.tx.QueryRow(ctx, `select exists (select 1 from docs.versions where document_id = $1 and engine_key = $2)`, doc, key).Scan(&exists); err != nil {
		return false, fmt.Errorf("docs: callback repeat: %w", err)
	}
	switch {
	case exists:
		return true, nil
	case base < current:
		return false, problem.New(codeTransition, "Версия в ключе устарела")
	case status == statusInRoute || status == statusSigned || status == statusArchived:
		return false, locked(textLocked)
	}
	return false, nil
}

// saveFromEngine makes the file of the engine the next version of the document edited at version base.
func (r *req) saveFromEngine(ctx context.Context, doc uuid.UUID, base int, b CallbackBody, data []byte) error {
	var (
		owner   uuid.UUID
		current int
		status  string
	)
	err := r.tx.QueryRow(ctx, `select owner_id, current_version, status from docs.documents where id = $1 for update`, doc).Scan(&owner, &current, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		return notFound(textDocNotFound)
	}
	if err != nil {
		return fmt.Errorf("docs: callback document: %w", err)
	}
	key := b.Key
	if b.Status == cbForce {
		key += "|fs|" + b.dedup()
	}
	if repeat, err := r.engineGuard(ctx, doc, key, base, current, status); err != nil || repeat {
		return err
	}
	r.tc.PersonID = owner
	fileID, err := r.storeFile(ctx, doc, "Версия.bin", contentTypeFor(ctx, r, doc, current), data)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(data)
	next := current + 1
	if err := r.insertVersion(ctx, doc, next, fileID, int64(len(data)), hex.EncodeToString(sum[:]), sourceEdit, "", authorsOf(b.Users), b.Status == cbForce, base, key); err != nil {
		return err
	}
	if _, err := r.tx.Exec(ctx, `update docs.documents set current_version = $2, revision = revision + 1, updated_at = $3 where id = $1`, doc, next, r.now); err != nil {
		return fmt.Errorf("docs: callback current version: %w", err)
	}
	if _, err := r.publishService(ctx, "docs.version.saved", aggDocument, doc, map[string]any{"version": next, "source": sourceEdit, "forcesave": b.Status == cbForce}); err != nil {
		return err
	}
	return r.recordService(ctx, "docs.version.save", doc, fmt.Sprintf("Сохранена v%d сервером документов", next))
}

// fetch downloads the saved file from the document server (at most maxFileBytes).
func (s *Service) fetch(ctx context.Context, rawURL string) ([]byte, error) {
	if s.Engine == nil {
		return nil, problem.New(problem.CodeDependencyUnavailable, "Сервер документов не подключён")
	}
	rc, err := s.Engine.Fetch(ctx, rawURL)
	if err != nil {
		return nil, problem.Wrap(codeUnprocessable, err)
	}
	defer rc.Close()
	data, err := io.ReadAll(io.LimitReader(rc, maxFileBytes+1))
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if int64(len(data)) > maxFileBytes {
		return nil, problem.New(codeTooLarge, "Файл больше 50 МБ")
	}
	return data, nil
}

// codeUnprocessable: the address of the saved file is refused (validation_failed).
const codeUnprocessable = codeValidation

// contentTypeFor is the content type of the file of the current version (the type of the next one stays the same).
func contentTypeFor(ctx context.Context, r *req, doc uuid.UUID, current int) string {
	if v, ok, err := r.version(ctx, doc, current); err == nil && ok && v.file != uuid.Nil {
		if f, found, err := r.fileOf(ctx, v.file); err == nil && found {
			ct, _ := decodeMIME(f.mime)
			return ct
		}
	}
	return "application/octet-stream"
}

// authorsOf are the users of the call that are people of the organization (ids of the configuration).
func authorsOf(users []string) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(users))
	for _, u := range users {
		if id, err := uuid.Parse(u); err == nil {
			out = append(out, id)
		}
	}
	return out
}

// noteCallback writes an error of saving of the engine to the journal (an unknown document is not an error of the
// call: the answer is the same).
func (s *Service) noteCallback(ctx context.Context, tenant, doc uuid.UUID, b CallbackBody) error {
	if b.Status != cbSaveError && b.Status != cbForceError {
		return nil
	}
	pool, err := s.Pools.For(ctx, tenant)
	if err != nil {
		return notFound("")
	}
	return s.inTx(ctx, pool, tenantctx.TenantContext{TenantID: tenant}, pgx.TxOptions{}, func(r *req) error {
		var one int
		if err := r.tx.QueryRow(ctx, `select 1 from docs.documents where id = $1`, doc).Scan(&one); errors.Is(err, pgx.ErrNoRows) {
			return notFound(textDocNotFound)
		} else if err != nil {
			return fmt.Errorf("docs: callback document: %w", err)
		}
		e := audit.ForRequest(ctx)
		e.Action, e.TargetType, e.TargetID, e.Result = "docs.version.save", aggDocument, doc, audit.Failed
		e.Diff = map[string]any{"details": "Сервер документов не смог сохранить документ", "status": b.Status}
		if e.RequestID == "" {
			e.RequestID = "docs-" + uuid.NewString()
		}
		return audit.Record(ctx, r.tx, e)
	})
}
