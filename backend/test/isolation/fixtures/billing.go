package fixtures

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// W4.60: the price book of the platform — one version in force since a month before «now», published by p.operator
// (getTenantPriceBook answers it to the owners of both tenants; without a version in force the API has no price
// book to show) — and the tier requests of the positive and cross-tenant rows of billing_w407.yaml and
// platform_w407.yaml (return 1 of W4.60).

// priceBookPublisher is the operator who published the version.
const priceBookPublisher = "p.operator"

// TierTeam is the tier «Команда» of the price book v1 of the fixtures.
const TierTeam = "team"

// Statuses of a fixture request (subscription_change_requests.status).
const (
	RequestPending  = "pending"
	RequestRejected = "rejected"
)

// RequestDef is a tier request of a tenant (subscription_change_requests of the control DB) by an owner of the
// tenant for a tier of the price book v1, term 12 months. Reference subscription_request:<tenant>.<key>. A rejected
// one is decided by p.operator. One pending request per tenant at most (scr_one_pending_uq).
type RequestDef struct {
	Key, Number string
	Owner       string // actor key: an owner of the tenant
	Tier        string // start | team | unl
	Status      string // RequestPending | RequestRejected
}

func (c Catalog) validateRequests(t TenantDef, fail failFunc) {
	keys, pending := map[string]bool{}, 0
	for _, r := range t.Requests {
		switch {
		case r.Key == "" || keys[r.Key]:
			fail("tenant %s: duplicate request %q", t.Key, r.Key)
		case r.Status != RequestPending && r.Status != RequestRejected:
			fail("request %s.%s: status %q", t.Key, r.Key, r.Status)
		case !c.ownsTenant(r.Owner, t.Key):
			fail("request %s.%s: %q is not an owner of the tenant", t.Key, r.Key, r.Owner)
		}
		keys[r.Key] = true
		if r.Status == RequestPending {
			pending++
		}
	}
	if pending > 1 {
		fail("tenant %s: %d pending requests, one at most", t.Key, pending)
	}
}

func (c Catalog) ownsTenant(actor, tenant string) bool {
	a, ok := c.actor(actor)
	if !ok {
		return false
	}
	for _, m := range a.Memberships {
		if m.Tenant == tenant && m.Owner {
			return true
		}
	}
	return false
}

func loadPriceBook(ctx context.Context, tx *sql.Tx, now time.Time) error {
	if _, err := tx.ExecContext(ctx, `insert into price_book_versions (version, effective, note, published_by, published_at)
values (1, tstzrange($1, null), 'Сетка изоляции', $2, $1)`, now.AddDate(0, -1, 0), nameID("operator:"+priceBookPublisher)); err != nil {
		return fmt.Errorf("price book: %w", err)
	}
	for i, t := range []struct {
		code, name  string
		seats       any
		monthAmount any
	}{{"start", "Старт", 10, 390000}, {TierTeam, "Команда", 25, 890000}, {"unl", "Безлимит", nil, nil}} {
		if _, err := tx.ExecContext(ctx, `insert into price_tiers (version, tier_code, name, seats_limit, month_minor, sort) values (1, $1, $2, $3, $4, $5)`,
			t.code, t.name, t.seats, t.monthAmount, i+1); err != nil {
			return fmt.Errorf("price tier %s: %w", t.code, err)
		}
	}
	for _, term := range [][2]int{{1, 0}, {4, 5}, {8, 10}, {12, 20}} {
		if _, err := tx.ExecContext(ctx, `insert into price_terms (version, months, discount_pct) values (1, $1, $2)`, term[0], term[1]); err != nil {
			return fmt.Errorf("price term %d: %w", term[0], err)
		}
	}
	return nil
}

// loadRequests writes the tier requests of the catalog an hour before «now» (after loadPriceBook).
func (w *World) loadRequests(ctx context.Context, tx *sql.Tx) error {
	at := w.Now.Add(-time.Hour)
	for _, t := range w.Catalog.Tenants {
		for _, r := range t.Requests {
			var decidedBy, decidedAt, note any
			if r.Status == RequestRejected {
				decidedBy, decidedAt, note = nameID("operator:"+priceBookPublisher), at, "Проверка изоляции: нет оплаты"
			}
			if _, err := tx.ExecContext(ctx, `insert into subscription_change_requests (id, number, tenant_id, to_tier, term_months,
  price_version, seats_used, requested_by, requested_at, status, decided_by, decided_at, decision_note)
values ($1, $2, $3, $4, 12, 1, 1, $5, $6, $7, $8, $9, $10)`,
				nameID(localRef(refRequest, t.Key, r.Key)), r.Number, nameID(tenantRef(t.Key)), r.Tier,
				nameID(memberRef(refMembership, r.Owner, t.Key)), at, r.Status, decidedBy, decidedAt, note); err != nil {
				return fmt.Errorf("request %s.%s: %w", t.Key, r.Key, err)
			}
		}
	}
	return nil
}
