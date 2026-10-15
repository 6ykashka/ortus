package provisioning

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/mail"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata" // IANA zones of TenantCreate.timeZone without a system tz database (containers)
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
)

// Audit actions of the provisioning in platform_audit.
const (
	ActionCreate    = "tenant.create"
	ActionProvision = "tenant.provision"
)

// Defaults of a registration.
const (
	DefaultSecretRef  = "env:TENANT_DB_URL" //nolint:gosec // G101: names a variable, holds no credential
	DefaultClusterRef = "local"
	industryPack      = "custom" // TenantCreate has no industry pack (decision of W1.02)
	stateProvisioning = tenants.StateProvisioning
	stateTrial        = "trial"
)

// ErrIdempotencyConflict: the Idempotency-Key was used for another request (idempotency_key_reused).
var ErrIdempotencyConflict = errors.New("provisioning: idempotency key reused with another request")

// Request is a TenantCreate of an operator (or of the CLI: ActorID uuid.Nil, actor_kind system).
type Request struct {
	Name, OwnerEmail, TimeZone, PlanKey string
	ActorID                             uuid.UUID
	IdempotencyKey                      string
	RequestID                           string // X-Request-Id, platform_audit.request_id
}

// ValidationError lists the invalid fields of a Request (validation_failed).
type ValidationError struct{ Fields []string }

func (e *ValidationError) Error() string {
	return "provisioning: invalid " + strings.Join(e.Fields, ", ")
}

var (
	planKeyShape = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{0,63}$`)
	keyShape     = regexp.MustCompile(`^[A-Za-z0-9._:-]{16,128}$`) // common/parameters.yaml IdempotencyKey
)

// Validate checks a request against TenantCreate and the Idempotency-Key parameter of the contract.
func (r Request) Validate() error {
	var bad []string
	if n := utf8.RuneCountInString(strings.TrimSpace(r.Name)); n < 1 || n > 150 {
		bad = append(bad, "name")
	}
	if a, err := mail.ParseAddress(r.OwnerEmail); err != nil || a.Address != r.OwnerEmail || a.Name != "" || len(r.OwnerEmail) > 254 {
		bad = append(bad, "ownerEmail")
	}
	if r.TimeZone == "" || r.TimeZone == "Local" {
		bad = append(bad, "timeZone")
	} else if _, err := time.LoadLocation(r.TimeZone); err != nil {
		bad = append(bad, "timeZone")
	}
	if !planKeyShape.MatchString(r.PlanKey) {
		bad = append(bad, "planKey")
	}
	if !keyShape.MatchString(r.IdempotencyKey) {
		bad = append(bad, "idempotencyKey")
	}
	if len(bad) > 0 {
		return &ValidationError{Fields: bad}
	}
	return nil
}

// hash identifies the body of a request for the idempotency check.
func (r Request) hash() string {
	sum := sha256.Sum256([]byte(strings.Join([]string{strings.TrimSpace(r.Name), r.OwnerEmail, r.TimeZone, r.PlanKey}, "\x00")))
	return hex.EncodeToString(sum[:])
}

// TenantID is the id of the tenant created by actor with idempotency key: a repeated request finds it again
// (UUID v5, PD-30 namespace URL).
func TenantID(actor uuid.UUID, key string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:platform:tenant-create:"+actor.String()+":"+key))
}

// RootUnitID is the id of the root org unit the provisioner creates in the tenant DB.
func RootUnitID(tenant uuid.UUID) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:"+tenant.String()+":root-unit"))
}

// OwnerPersonID is the id of the person profile of the owner-to-be in the tenant DB: the invitation of the owner
// (W1.03) links the accepted membership to it.
func OwnerPersonID(tenant uuid.UUID) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:"+tenant.String()+":owner"))
}

var translit = map[rune]string{
	'а': "a", 'б': "b", 'в': "v", 'г': "g", 'д': "d", 'е': "e", 'ё': "e", 'ж': "zh", 'з': "z", 'и': "i", 'й': "y",
	'к': "k", 'л': "l", 'м': "m", 'н': "n", 'о': "o", 'п': "p", 'р': "r", 'с': "s", 'т': "t", 'у': "u", 'ф': "f",
	'х': "kh", 'ц': "ts", 'ч': "ch", 'ш': "sh", 'щ': "shch", 'ъ': "", 'ы': "y", 'ь': "", 'э': "e", 'ю': "yu", 'я': "ya",
}

const slugBaseMax = 32

// Slug is the tenants.slug of a new tenant: the transliterated name, then «-» and 6 hex digits of its id, so two
// tenants with one name never collide and no retry is needed.
func Slug(name string, id uuid.UUID) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch s, ok := translit[r]; {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case ok:
			b.WriteString(s)
		default:
			b.WriteByte('-')
		}
	}
	base := strings.Trim(dashes.ReplaceAllString(b.String(), "-"), "-")
	if len(base) > slugBaseMax {
		base = strings.TrimRight(base[:slugBaseMax], "-")
	}
	if base == "" {
		base = "org"
	}
	return base + "-" + strings.ReplaceAll(id.String(), "-", "")[:6]
}

var dashes = regexp.MustCompile(`-+`)

// DatabaseName is the tenant database of slug: t_<slug> with «_» for «-».
func DatabaseName(slug string) string { return "t_" + strings.ReplaceAll(slug, "-", "_") }

// Registrar registers tenants in the control DB. It needs DML only (ortus_api): the database is created later by
// the provisioner process.
type Registrar struct {
	Control    *sql.DB
	SecretRef  string // "": DefaultSecretRef
	ClusterRef string // "": DefaultClusterRef
}

// Register writes the tenant (provisioning), its route (random sentinel, version 0) and the audit record of the
// request, whose details carry the parameters the provisioner needs. A repeated request with the same actor, key
// and body returns the same tenant (replayed); the same key with another body is ErrIdempotencyConflict.
func (g Registrar) Register(ctx context.Context, req Request) (tenants.Tenant, bool, error) {
	if err := req.Validate(); err != nil {
		return tenants.Tenant{}, false, err
	}
	id := TenantID(req.ActorID, req.IdempotencyKey)
	for range 2 { // a concurrent registration of the same key loses the insert race and replays
		if tn, replayed, err := g.replay(ctx, id, req); err != nil || replayed {
			return tn, replayed, err
		}
		err := g.insert(ctx, id, req)
		if pgErr, ok := errors.AsType[*pgconn.PgError](err); ok && pgErr.Code == "23505" {
			continue
		}
		if err != nil {
			return tenants.Tenant{}, false, err
		}
		tn, err := tenants.GetTenant(ctx, g.Control, id)
		return tn, false, err
	}
	return g.replay(ctx, id, req)
}

func (g Registrar) replay(ctx context.Context, id uuid.UUID, req Request) (tenants.Tenant, bool, error) {
	var hash sql.NullString
	err := g.Control.QueryRowContext(ctx, `select details->>'requestHash' from platform_audit
		where action = $1 and target_id = $2 order by id limit 1`, ActionCreate, id).Scan(&hash)
	if errors.Is(err, sql.ErrNoRows) {
		return tenants.Tenant{}, false, nil
	}
	if err != nil {
		return tenants.Tenant{}, false, fmt.Errorf("provisioning: replay: %w", err)
	}
	if hash.String != req.hash() {
		return tenants.Tenant{}, false, ErrIdempotencyConflict
	}
	tn, err := tenants.GetTenant(ctx, g.Control, id)
	return tn, err == nil, err
}

func (g Registrar) insert(ctx context.Context, id uuid.UUID, req Request) (err error) {
	secretRef, clusterRef := g.SecretRef, g.ClusterRef
	if secretRef == "" {
		secretRef = DefaultSecretRef
	}
	if clusterRef == "" {
		clusterRef = DefaultClusterRef
	}
	name := strings.TrimSpace(req.Name)
	slug := Slug(name, id)
	details, err := json.Marshal(map[string]any{
		"name": name, "slug": slug, "database": DatabaseName(slug), "ownerEmail": req.OwnerEmail,
		"timeZone": req.TimeZone, "planKey": req.PlanKey, "requestHash": req.hash(),
	})
	if err != nil {
		return fmt.Errorf("provisioning: details: %w", err)
	}
	actorKind, actorID := "operator", &req.ActorID
	if req.ActorID == uuid.Nil {
		actorKind, actorID = "system", nil
	}
	requestID := req.RequestID
	if requestID == "" {
		requestID = tenants.NewRunID("create")
	}
	tx, err := g.Control.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("provisioning: begin: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	if _, err = tx.ExecContext(ctx, `insert into tenants (id, slug, display_name, industry_pack, state)
		values ($1, $2, $3, $4, $5)`, id, slug, name, industryPack, stateProvisioning); err != nil {
		return fmt.Errorf("provisioning: tenants: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `insert into tenant_routing (tenant_id, cluster_ref, database_name, secret_ref, sentinel)
		values ($1, $2, $3, $4, $5)`, id, clusterRef, DatabaseName(slug), secretRef, uuid.New()); err != nil {
		return fmt.Errorf("provisioning: tenant_routing: %w", err)
	}
	if _, err = tx.ExecContext(ctx, `insert into platform_audit (actor_kind, actor_id, action, target_type, target_id, result, request_id, details)
		values ($1, $2, $3, 'tenant', $4, 'ok', $5, $6::jsonb)`, actorKind, actorID, ActionCreate, id, requestID, string(details)); err != nil {
		return fmt.Errorf("provisioning: platform_audit: %w", err)
	}
	return tx.Commit()
}
