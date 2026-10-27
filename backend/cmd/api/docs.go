package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	docsapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	publicdocsapi "github.com/ortus/ortus-crm/backend/internal/api/publicdocs"
	"github.com/ortus/ortus-crm/backend/internal/modules/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

// minSecret is the shortest secret of the module: the JWT of the document server and the key of the tokens of links.
const minSecret = 32

// docsWiring is what «Документы» (W7.23) give to the application: the servers of the tags Docs and PublicDocs and the
// check of the call of the document server the gateway makes for it (the call has no session).
type docsWiring struct {
	docs     docsapi.StrictServerInterface
	public   publicdocsapi.StrictServerInterface
	callback func(*http.Request) (context.Context, error)
}

// docsKey is the key of the tokens and PINs of external links of the configuration.
type docsKey []byte

func (k docsKey) LinkKey() []byte { return k }

// newDocs wires «Документы»: the strict servers over the tenant pools, the memberships and the control index of
// external links, the inbox, the object storage of S3_* (without it the files of versions are not reachable), the
// document server behind the adapter (D-32, ADR-0016: DOCS_SERVER_URL, DOCS_SERVER_INTERNAL_URL,
// DOCS_SERVER_JWT_SECRET; without them the document opens for viewing) and the programs of the jobs (DOCS_*). The key
// of links (DOCS_LINK_KEY, at least 32 bytes) is required in prod; elsewhere a key of the process is made.
func newDocs(pools docs.Pools, control *pgxpool.Pool, ev *authz.Evaluator, getenv func(string) string, appEnv string, log *slog.Logger,
	now func() time.Time) (docsWiring, error) {
	svc, err := docsService(pools, control, ev, getenv, appEnv, log, now)
	if err != nil {
		return docsWiring{}, err
	}
	docs.Register(ev, pools) // the places of folders and documents for explainAccess (W4.01)
	return docsWiring{docs: docs.Server{S: svc}, public: docs.PublicServer{S: svc}, callback: svc.AuthorizeCallback}, nil
}

// docsService is the service of «Документы» of the configuration (the API and the worker of jobs build it alike).
func docsService(pools docs.Pools, control *pgxpool.Pool, ev *authz.Evaluator, getenv func(string) string, appEnv string, log *slog.Logger,
	now func() time.Time) (*docs.Service, error) {
	engine, err := docsEngine(getenv, log)
	if err != nil {
		return nil, err
	}
	key, err := docsLinkKey(getenv, appEnv, log)
	if err != nil {
		return nil, err
	}
	svc := &docs.Service{
		Pools: pools, Audience: inbox.AuthzAudience{E: ev}, Engine: engine, Secrets: key,
		PublicBase: strings.TrimSpace(getenv("PUBLIC_ORIGIN")), CallbackURL: strings.TrimSpace(getenv("DOCS_CALLBACK_URL")), Now: now,
	}
	if control != nil { // the control DB: memberships and owner bindings, the index of external links, the inbox
		svc.Memberships, svc.Links, svc.Recipients = docs.PGMemberships{DB: control}, docs.PGLinks{DB: control}, inbox.PGRecipients{Control: control}
	}
	if p := docs.ExecProcessorFromEnv(getenv); p != nil {
		svc.Processor = p
	}
	cfg, ok, err := storage.ConfigFromEnv(getenv)
	switch {
	case err != nil:
		return nil, fmt.Errorf("object storage: %w", err)
	case ok:
		s3, err := storage.NewS3(cfg, nil, nil)
		if err != nil {
			return nil, err
		}
		svc.Blobs = docs.PresignedBlobs{Store: s3}
	default:
		log.Warn("api: S3_ENDPOINT is not set — the files of the versions of documents are not reachable")
	}
	return svc, nil
}

// docsEngine is the adapter of the document server: ONLYOFFICE or Р7-Офис (one protocol), or none.
func docsEngine(getenv func(string) string, log *slog.Logger) (docs.Engine, error) {
	url, internal, secret := strings.TrimSpace(getenv("DOCS_SERVER_URL")), strings.TrimSpace(getenv("DOCS_SERVER_INTERNAL_URL")),
		strings.TrimSpace(getenv("DOCS_SERVER_JWT_SECRET"))
	switch {
	case url == "" && secret == "":
		log.Warn("api: DOCS_SERVER_URL is not set — documents open for viewing, editing is off (D-32)")
		return docs.NoEngine{}, nil
	case url == "" || len(secret) < minSecret:
		return nil, errors.New("document server: DOCS_SERVER_URL and DOCS_SERVER_JWT_SECRET (at least 32 bytes) go together")
	}
	return &docs.OnlyOffice{PublicURL: url, InternalURL: internal, Secret: []byte(secret)}, nil
}

// docsLinkKey reads DOCS_LINK_KEY; outside prod a random key of the process stands in (the tokens of links then do not
// survive a restart).
func docsLinkKey(getenv func(string) string, appEnv string, log *slog.Logger) (docsKey, error) {
	if v := strings.TrimSpace(getenv("DOCS_LINK_KEY")); v != "" {
		if len(v) < minSecret {
			return nil, errors.New("DOCS_LINK_KEY: at least 32 bytes")
		}
		return docsKey(v), nil
	}
	if appEnv == envProd {
		return nil, errors.New("DOCS_LINK_KEY is required with APP_ENV=prod")
	}
	k := make([]byte, minSecret)
	if _, err := rand.Read(k); err != nil {
		return nil, fmt.Errorf("docs link key: %w", err)
	}
	log.Warn("api: DOCS_LINK_KEY is not set — a key of the process is used, external links do not survive a restart")
	return k, nil
}
