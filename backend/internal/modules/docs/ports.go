package docs

import (
	"context"
	"errors"
	"io"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

// Membership is what the module needs of the membership of a person in the control DB.
type Membership struct {
	Status string // invited | active | suspended | ended
	Owner  bool   // an active owner binding
}

// Memberships reads the memberships of person profiles (people.person_profiles.membership_id) in the control DB.
type Memberships interface {
	Memberships(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]Membership, error)
}

// RepairObject is an object of repairs with its foreman: the relation «прораб объекта» (documents.md §3.2).
type RepairObject struct {
	ID      uuid.UUID
	Foreman uuid.UUID
}

// Relations gives the objects of repairs of an organization with their foremen. The module «Ремонт и стройка»
// provides it from stage 6; until then there are none.
type Relations interface {
	Objects(ctx context.Context, tenantID uuid.UUID) ([]RepairObject, error)
}

// Blobs is the object storage of the files of versions: the standard store plus a write (the engine hands the saved
// file over, a job makes a result), so the bytes never go through a client.
type Blobs interface {
	storage.Store
	// Put writes size bytes of body under key with contentType.
	Put(ctx context.Context, key, contentType string, body io.Reader, size int64) error
}

// Editor modes of a session (OpenDocumentSessionParams.mode, DocSessionConfig.mode).
const (
	modeView    = "view"
	modeEdit    = "edit"
	modeReview  = "review"
	modeComment = "comment"
)

// Permissions are the rights of the member in the engine (the claims of the signed config).
type Permissions struct {
	Edit, Review, Comment, Download, Print, FillForms, ProtectedRanges bool
}

// SessionRequest is what the adapter signs into the configuration of an editor session.
type SessionRequest struct {
	Key         string // t<tenant>.d<document>.v<version>
	Title       string
	Kind        string // text | sheet | pdf
	Extension   string // docx, xlsx, pdf …
	FileURL     string // short-lived signed URL of the file of the version
	CallbackURL string // docServerCallback
	UserID      uuid.UUID
	UserName    string
	Mode        string
	Perms       Permissions
	Watermark   string
	Expires     time.Time
}

// SessionConfig is the answer of the adapter: the URL of the editor and the signed token (JWT, HS256).
type SessionConfig struct {
	Engine    string // r7 | onlyoffice
	EditorURL string
	Token     string
}

// Engine is the document server behind the adapter (D-32, ADR-0016): Р7-Офис or ONLYOFFICE speak one protocol — a
// signed configuration of a session (HS256 JWT of a shared secret) and a callback with the saved file. The contract
// carries no operation of the engine itself.
type Engine interface {
	// Configured reports whether a server is chosen and reachable by configuration; false — the document opens for
	// viewing and downloads, editing is off with the hint «Редактор подключается» (Q-W4.00-documents-1).
	Configured() bool
	// Session signs the configuration of an editor session.
	Session(req SessionRequest) (SessionConfig, error)
	// ForceSave asks the engine to save the version the key names (the command service); the saved file comes back by
	// the callback.
	ForceSave(ctx context.Context, key string) error
	// VerifyCallback checks the JWT of a callback of the document server (Authorization: Bearer).
	VerifyCallback(token string) error
	// Fetch opens the file the engine offers in a callback; only the host of the engine is reachable.
	Fetch(ctx context.Context, rawURL string) (io.ReadCloser, error)
}

// ErrEngineUnavailable is an error of the engine the caller answers with dependency_unavailable.
var ErrEngineUnavailable = errors.New("docs: document server is not available")

// JobFile is an input of a job: the file of the current version of a document.
type JobFile struct {
	Name        string
	ContentType string
	Data        []byte
}

// JobInput is a job for the programs.
type JobInput struct {
	Op       string
	Params   map[string]any
	Inputs   []JobFile
	Password string // the password of a protected file given on a retry
}

// OCRWord is a doubtful word of the text layer.
type OCRWord struct {
	ID         string
	Row        int
	Text       string
	Suggestion string
	Confidence float64
	Why        string
}

// JobOutput is the result of a job: files (the first one is the main result), the text layer data of an OCR.
type JobOutput struct {
	Files      []JobFile
	Words      []OCRWord
	Confidence float64
	Lang       string
	Pages      int
}

// Errors of a Processor.
var (
	// ErrPasswordProtected: a file is protected by a password (file_password_protected on the retry).
	ErrPasswordProtected = errors.New("docs: file is protected by a password")
	// ErrNoProcessor: the programs of the jobs are not installed; the job fails with a hint.
	ErrNoProcessor = errors.New("docs: programs of the jobs are not installed")
)

// Processor runs the programs of the jobs: OCRmyPDF with Tesseract, qpdf, the converter of the document server.
type Processor interface {
	Run(ctx context.Context, in JobInput) (JobOutput, error)
}

// Secrets are the keys of the module: the key of the tokens of external links and of their PINs. Without it a
// random key per process is used and the tokens do not survive a restart (tests only).
type Secrets interface {
	LinkKey() []byte
}

// RouteTaskState is what a route tells its mirror task (documents.js syncTask): the step and who waits, the status of
// the route (active, returned, done, cancelled), the person to assign and the term of the step.
type RouteTaskState struct {
	Status       string
	Title        string // the title of the document
	Version      int
	Step         int // the number of the current step, from 1
	Steps        int
	StepName     string
	Waiting      []uuid.UUID
	WaitingNames []string
	Assignee     uuid.UUID  // uuid.Nil: keep the assignee
	Due          *time.Time // nil: keep the term
	Actor        uuid.UUID  // the member whose action moved the route (the author of the line in the task); uuid.Nil — the system
}

// RouteTask is the mirror task of a route (Q-W4.00-documents-3): the project (uuid.Nil — the system project «ДОК ·
// Документы · маршруты»), the starter of the route, the document and the first state.
type RouteTask struct {
	Project     uuid.UUID
	Author      uuid.UUID
	AuthorOwner bool
	AuthorName  string
	Document    uuid.UUID
	Route       uuid.UUID
	Title       string
	Description string
	State       RouteTaskState
}

// RouteTaskResult is the task made — its id, number («ДОК-101») and project — or the cause of a refusal.
type RouteTaskResult struct {
	ID        uuid.UUID
	Key       string
	Project   uuid.UUID
	Refused   string // the text of a refusal; "" — the task is made
	Forbidden bool   // the refusal is «нет права», not «нет проекта»
}

// RouteTasks is the module «Задачи» for the routes: cmd/api adapts tasks.Service (the module imports no other module).
// Every call runs in the transaction tx of the route, so the task and the route stand or fall together.
type RouteTasks interface {
	// MayCreate reports whether member may create tasks in project (uuid.Nil — the system project, always).
	MayCreate(ctx context.Context, tx pgx.Tx, tenant, member uuid.UUID, owner bool, project uuid.UUID) (bool, error)
	// CreateRouteTask makes the mirror task of a route.
	CreateRouteTask(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, t RouteTask) (RouteTaskResult, error)
	// SyncRouteTask moves the task after its route: the status, the assignee, the term, the card of the route and a
	// system comment (note, may be empty).
	SyncRouteTask(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, task uuid.UUID, st RouteTaskState, note string) error
}

// ErrNoDelivery is the answer of a Signer without a channel of the code (D-31: the SMS are put off): the caller
// answers dependency_unavailable.
var ErrNoDelivery = errors.New("docs: the code cannot be delivered")

// Signer is the second confirmation of a signature (PEP, D-31 of the set): the repeated sign-in to Ortus by the
// password or by the code of the second factor, and the code the delivery port sends (SMS to the customer).
type Signer interface {
	// ConfirmLogin checks the password or the one-time code of the second factor of member; false — refused.
	ConfirmLogin(ctx context.Context, tenant, member uuid.UUID, password, totp string) (bool, error)
	// SendCode delivers code to member and returns the masked address («+7 9•• •••-••-42»); ErrNoDelivery without a
	// channel.
	SendCode(ctx context.Context, tenant, member uuid.UUID, code string) (string, error)
}
