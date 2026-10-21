package main

// W4.60: the billing and the branding of the control DB in cmd/api — the notices of the owners and context.changed
// after a decision or a new branding version, the installed modules of the Использование screen, the role of an
// operator for the gateway, the object storage of the branding files and the scheduler of the downgrades.

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	billingapi "github.com/ortus/ortus-crm/backend/internal/api/billing"
	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/accounts"
	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/control/billing/billinghttp"
	"github.com/ortus/ortus-crm/backend/internal/control/branding"
	"github.com/ortus/ortus-crm/backend/internal/control/branding/brandinghttp"
	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions/subshttp"
	"github.com/ortus/ortus-crm/backend/internal/modules/modulesreg"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx/mehttp"
)

// uploadBodies are the body limits of idem.Guard beyond 1 MiB: a branding file of 1 MiB in base64 with its JSON.
var uploadBodies = map[string]int{"uploadBrandingAsset": 2 << 20}

// operatorDomainEnv is the e-mail domain of the invited operators (accounts.DefaultDomain when empty).
const operatorDomainEnv = "OPERATOR_EMAIL_DOMAIN"

// controlParts are the servers of the billing and the branding of the control DB (W4.60).
type controlParts struct {
	billing        billing.Store
	accounts       *accounts.Service
	events         billingEvents
	marks          billinghttp.Marks
	modules        billing.Modules
	now            func() time.Time
	themes         mehttp.Branding
	brandingServer brandinghttp.Server
	public         http.Handler
	roles          platformRoles
}

// newControl wires the billing store over the subscriptions of W1.08, the branding service with the object storage
// of S3_* (without S3_ENDPOINT uploads and public files answer 503), the notices of the owners and context.changed.
func newControl(controlSQL *sql.DB, control *pgxpool.Pool, pools *tenantctx.Pools, subs subscriptions.Store, modules *modulesreg.Service,
	ch channel, ev *authz.Evaluator, cfg config, getenv func(string) string, log *slog.Logger,
) (controlParts, error) {
	blobs, err := newBrandBlobs(getenv)
	if err != nil {
		return controlParts{}, fmt.Errorf("branding storage: %w", err)
	}
	brand := &branding.Service{Control: controlSQL, Now: cfg.clock()}
	if blobs != nil {
		brand.Blobs = blobs
	}
	notices := ownerNotices{owners: pgOwners(control), enqueue: poolInbox(pools, inbox.AuthzAudience{E: ev}), hint: ch.tenantChanged, log: log}
	return controlParts{
		billing:  billing.Store{DB: controlSQL, Subs: subs, Now: cfg.clock()},
		accounts: &accounts.Service{Control: controlSQL, Domain: getenv(operatorDomainEnv), Now: cfg.clock()},
		events:   billingEvents{notices},
		marks:    brandinghttp.Marks{Service: brand},
		modules:  installedModules(modules.Installations),
		now:      cfg.clock(),
		themes:   brandinghttp.Themes{Service: brand},
		brandingServer: brandinghttp.Server{
			Service: brand, Events: brandingEvents{notices},
		},
		public: brandinghttp.Public{Service: brand},
		roles:  pgPlatformRoles{db: controlSQL},
	}, nil
}

// platform is the tag Platform: the billing and the facts of the tenants over the catalogue of accounts and the
// operators over base.
func (c controlParts) platform(base platformapi.StrictServerInterface) platformapi.StrictServerInterface {
	return billinghttp.PlatformServer{
		StrictServerInterface: accounts.Server{StrictServerInterface: base, Service: c.accounts},
		Store:                 c.billing, Events: c.events, Marks: c.marks, Modules: c.modules, ModuleOrder: modulesreg.InstallableKeys(),
		Now: c.now,
	}
}

// tenantBilling is the tag Billing: the price book and the requests of the owner over the subscription of W1.08 with
// its terms over the storage of W1.09.
func (c controlParts) tenantBilling(storage billingapi.StrictServerInterface, subs subscriptions.Store) billingapi.StrictServerInterface {
	sub := subshttp.NewBillingServer(storage, subs)
	sub.Terms = c.billing
	return billinghttp.TenantServer{StrictServerInterface: sub, Store: c.billing, Events: c.events, Now: c.now}
}

// ownerNotices tells the owners of a tenant (the inbox of its DB) and its members (context.changed). It follows a
// committed command: best effort, bounded by hintTimeout, its failures are logged and never fail the command.
type ownerNotices struct {
	owners  func(ctx context.Context, tenantID uuid.UUID) ([]tenantctx.TenantContext, error)
	enqueue func(ctx context.Context, to tenantctx.TenantContext, n inbox.Notice) error
	hint    func(ctx context.Context, tenantID uuid.UUID) error
	log     *slog.Logger
}

// tell sends n to every owner of tenantID (the prototype addresses owners(), the author too), then context.changed
// when hint.
func (o ownerNotices) tell(ctx context.Context, tenantID uuid.UUID, n inbox.Notice, hint bool) {
	tctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), hintTimeout)
	defer cancel()
	if err := o.notify(tctx, tenantID, n); err != nil {
		o.log.WarnContext(ctx, "notices of the owners", slog.String("tenant_id", tenantID.String()), slog.String("kind", n.Kind),
			slog.String("error", err.Error()))
	}
	if !hint || o.hint == nil {
		return
	}
	if err := o.hint(tctx, tenantID); err != nil {
		o.log.WarnContext(ctx, "realtime: context.changed", slog.String("tenant_id", tenantID.String()), slog.String("error", err.Error()))
	}
}

func (o ownerNotices) notify(ctx context.Context, tenantID uuid.UUID, n inbox.Notice) error {
	if o.owners == nil || o.enqueue == nil {
		return nil
	}
	owners, err := o.owners(ctx, tenantID)
	if err != nil {
		return err
	}
	var errs []error
	for _, to := range owners {
		errs = append(errs, o.enqueue(ctx, to, n))
	}
	return errors.Join(errs...)
}

// maxNoticeTitle is the limit of Notification.title (inbox): a longer text is clipped there and kept whole in the body.
const maxNoticeTitle = 300

// titled is n with the text of the prototype as its title; a text over maxNoticeTitle characters (a rejection note
// of up to 500) is clipped with «…» and given whole in the body.
func titled(n inbox.Notice, text string) inbox.Notice {
	n.Title = text
	if r := []rune(text); len(r) > maxNoticeTitle {
		n.Title, n.Body = string(r[:maxNoticeTitle-1])+"…", text
	}
	return n
}

// billingEvents implements billinghttp.Events with the texts of the contract 0.8.0-stage4 (design/ortus/api.js).
type billingEvents struct{ ownerNotices }

// billingNotice is a notice of the requests: for the owners with billing.read, a link to «Тариф и оплата».
func billingNotice(r billing.Request, kind, text string) inbox.Notice {
	return titled(inbox.Notice{Kind: kind, Link: "/t/" + r.TenantID.String() + "/billing", Permission: "billing.read"}, text)
}

// RequestCreated implements billinghttp.Events: the owners learn the request went to the operator. The state of the
// tenant does not change, so no context.changed. The operators have no inbox of the platform: they see the queue and
// its badge (pendingCount).
func (e billingEvents) RequestCreated(ctx context.Context, r billing.Request) {
	e.tell(ctx, r.TenantID, billingNotice(r, "billing.subscription_request.created",
		"Заявка "+r.Number+" на тариф «"+r.ToTierName+"» отправлена оператору"), false)
}

// RequestDecided implements billinghttp.Events: every owner learns the decision; an approval changes the state of the
// tenant (trial, grace and read_only become active), so the members get context.changed.
func (e billingEvents) RequestDecided(ctx context.Context, r billing.Request) {
	if r.Status == billing.StatusRejected {
		n := billingNotice(r, "billing.subscription_request.rejected", "Заявка "+r.Number+" отклонена: "+r.DecisionNote)
		n.Severity = inbox.SeverityWarning
		e.tell(ctx, r.TenantID, n, true)
		return
	}
	seats := "без ограничения мест"
	if r.ToSeatsLimit != nil {
		seats = strconv.Itoa(*r.ToSeatsLimit) + " мест"
	}
	e.tell(ctx, r.TenantID, billingNotice(r, "billing.subscription_request.approved", "Тариф «"+r.ToTierName+"» подключён: "+seats), true)
}

// brandingEvents implements brandinghttp.Events.
type brandingEvents struct{ ownerNotices }

// BrandingUpdated implements brandinghttp.Events: every owner learns the new version (the text of the contract), the
// members get context.changed — the theme of the shell follows.
func (e brandingEvents) BrandingUpdated(ctx context.Context, tenantID uuid.UUID, b branding.Branding) {
	e.tell(ctx, tenantID, titled(inbox.Notice{Kind: "branding.updated", Link: "/t/" + tenantID.String() + "/branding"},
		"Оформление обновлено (версия "+strconv.Itoa(b.Version)+"). Изменения видны всем сотрудникам"), true)
}

// industryModules is the module of the industry of a tenant whose DB is not at hand (tenants.industry_pack).
var industryModules = map[string]string{"logistics": modulesreg.KeyFleet, "spa": modulesreg.KeySpa, "repair": modulesreg.KeyRepairs}

// installedModules is billing.Modules over the module registry: the installable modules of a tenant that are not
// switched off; a tenant whose DB fails gives the module of its industry.
func installedModules(installations func(ctx context.Context, tenantID uuid.UUID) (map[string]modulesreg.Installation, error)) billing.Modules {
	installable := modulesreg.InstallableKeys()
	return func(ctx context.Context, tenantID uuid.UUID, industry string) ([]string, error) {
		inst, err := installations(ctx, tenantID)
		if err != nil {
			if key, ok := industryModules[industry]; ok {
				return []string{key}, nil
			}
			return []string{}, nil
		}
		out := []string{}
		for _, key := range installable {
			if in, ok := inst[key]; ok && in.State != modulesreg.StateDisabled {
				out = append(out, key)
			}
		}
		return out, nil
	}
}

// pgOwners are the active owners of a tenant with a person profile (the recipients of the inbox).
func pgOwners(control *pgxpool.Pool) func(ctx context.Context, tenantID uuid.UUID) ([]tenantctx.TenantContext, error) {
	return func(ctx context.Context, tenantID uuid.UUID) ([]tenantctx.TenantContext, error) {
		rows, err := control.Query(ctx, `select m.id, m.account_id, m.person_profile_id from memberships m
 where m.tenant_id = $1 and m.status = 'active' and m.person_profile_id is not null
   and exists (select 1 from owner_bindings o where o.membership_id = m.id and o.revoked_at is null)
 order by m.created_at, m.id`, tenantID)
		if err != nil {
			return nil, fmt.Errorf("owners: %w", err)
		}
		defer rows.Close()
		var out []tenantctx.TenantContext
		for rows.Next() {
			tc := tenantctx.TenantContext{TenantID: tenantID, Owner: true}
			if err := rows.Scan(&tc.MembershipID, &tc.AccountID, &tc.PersonID); err != nil {
				return nil, fmt.Errorf("owners: %w", err)
			}
			out = append(out, tc)
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("owners: %w", err)
		}
		return out, nil
	}
}

// poolInbox enqueues a notice into the tenant DB of its recipient.
func poolInbox(pools *tenantctx.Pools, aud inbox.Audience) func(ctx context.Context, to tenantctx.TenantContext, n inbox.Notice) error {
	return func(ctx context.Context, to tenantctx.TenantContext, n inbox.Notice) error {
		pool, err := pools.For(ctx, to.TenantID)
		if err != nil {
			return err
		}
		_, _, err = inbox.Enqueue(ctx, pool, aud, to, n)
		return err
	}
}

// pgPlatformRoles implements platformRoles over platform_operators of the control DB.
type pgPlatformRoles struct{ db *sql.DB }

// PlatformRole implements platformRoles: the role of an active operator, "" for anyone else.
func (p pgPlatformRoles) PlatformRole(ctx context.Context, account uuid.UUID) (string, error) {
	var role string
	err := p.db.QueryRowContext(ctx, `select role from platform_operators where account_id = $1 and status = 'active'`, account).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("platform role: %w", err)
	}
	return role, nil
}

// brandBlobs is branding.Blobs over the object storage of S3_*: put by a presigned PUT of the internal endpoint (the
// storage client of W1.09 signs requests without a body), read by a signed GET.
type brandBlobs struct {
	s3     *storage.S3 // its public endpoint is the internal one
	client *http.Client
}

// newBrandBlobs is the storage of the branding files over cfg; ok false — S3 is not configured.
func newBrandBlobs(getenv func(string) string) (*brandBlobs, error) {
	cfg, ok, err := storage.ConfigFromEnv(getenv)
	if err != nil || !ok {
		return nil, err
	}
	cfg.PublicEndpoint = cfg.Endpoint
	s3, err := storage.NewS3(cfg, nil, nil)
	if err != nil {
		return nil, err
	}
	return &brandBlobs{s3: s3, client: &http.Client{Timeout: 30 * time.Second}}, nil
}

// blobTTL is the life of the presigned PUT of a branding file.
const blobTTL = 5 * time.Minute

// Put implements branding.Blobs.
func (b *brandBlobs) Put(ctx context.Context, key, contentType string, data []byte) error {
	u, err := b.s3.PresignPut(key, contentType, int64(len(data)), blobTTL)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("branding blob: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = int64(len(data))
	resp, err := b.client.Do(req)
	if err != nil {
		// *url.Error quotes the presigned URL with its signature: the log of dependency_unavailable gets the key only.
		if ue, ok := errors.AsType[*url.Error](err); ok {
			err = ue.Err
		}
		return fmt.Errorf("branding blob: PUT %s: %w", key, err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("branding blob: PUT %s: %s", key, resp.Status)
	}
	return nil
}

// Open implements branding.Blobs.
func (b *brandBlobs) Open(ctx context.Context, key string) (io.ReadCloser, error) {
	rc, _, err := b.s3.Open(ctx, key)
	return rc, err
}

// dueRequests returns the background job of the scheduler of the billing (the approved downgrades whose period
// ended), run with the subscription lifecycle (SUBSCRIPTION_SWEEP_INTERVAL); nil when it is off.
func dueRequests(store billing.Store, every time.Duration, hint func(ctx context.Context, tenantID uuid.UUID) error, log *slog.Logger) func(context.Context) {
	if every <= 0 {
		return nil
	}
	return func(ctx context.Context) {
		t := time.NewTicker(every)
		defer t.Stop()
		for {
			applied, err := store.ApplyDue(ctx)
			if err != nil && ctx.Err() == nil {
				log.ErrorContext(ctx, "billing: apply due requests", slog.String("error", err.Error()))
			}
			for _, id := range slices.Compact(applied) {
				if err := hint(ctx, id); err != nil {
					log.WarnContext(ctx, "realtime: context.changed after a downgrade", slog.String("tenant_id", id.String()),
						slog.String("error", err.Error()))
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-t.C:
			}
		}
	}
}
