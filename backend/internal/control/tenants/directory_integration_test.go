//go:build integration

package tenants

import (
	"errors"
	"slices"
	"testing"

	"github.com/google/uuid"
)

// Реестр организаций оператора (listPlatformTenants): страницы по (created_at, id) с курсором; владельцы — аккаунты
// активных owner_bindings; getPlatformTenant неизвестной организации — ErrUnknownTenant.
func TestListAndGetTenants(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	var want []string
	for _, slug := range []string{"aaa", "bbb", "ccc", "ddd", "eee"} {
		s.tenant(slug)
		want = append(want, slug)
	}
	account := s.owner("bbb")

	all := walkPages(t, s, 2)
	if got := slugsOf(all); !slices.Equal(got, want) {
		t.Errorf("pages %v, want %v", got, want)
	}
	for _, tn := range all {
		owners := tn.OwnerAccountIDs
		ownersOK := (tn.Slug == "bbb") == (len(owners) == 1 && owners[0] == account)
		if tn.State != "active" || tn.Revision != 1 || tn.Name != tn.Slug || !ownersOK {
			t.Errorf("tenant %+v (owner of bbb: %s)", tn, account)
		}
	}

	if page := walkPages(t, s, 10); len(page) != 5 {
		t.Errorf("one page: %d items", len(page))
	}
}

// getPlatformTenant: карточка с владельцами; неизвестная организация — ErrUnknownTenant.
func TestGetTenant(t *testing.T) {
	t.Parallel()
	s := newStand(t)
	r := s.tenant("own")
	s.owner("own")
	tn, err := GetTenant(t.Context(), s.control, r.TenantID)
	if err != nil || tn.Slug != "own" || len(tn.OwnerAccountIDs) != 1 {
		t.Errorf("get: %+v %v", tn, err)
	}
	if _, err := GetTenant(t.Context(), s.control, uuid.New()); !errors.Is(err, ErrUnknownTenant) {
		t.Errorf("get unknown: %v", err)
	}
}

// owner makes a new account the active owner of tenant slug and returns the account id.
func (s *stand) owner(slug string) uuid.UUID {
	s.t.Helper()
	account := uuid.New()
	s.exec(`insert into accounts (id, issuer, subject, email_norm, display_name) values ($1, 'urn:ortus:dev', $2, 'x@x', 'X')`, account, account.String())
	s.exec(`with m as (
  insert into memberships (tenant_id, account_id, status, person_profile_id)
  select id, $1, 'active', gen_random_uuid() from tenants where slug = $2 returning id, tenant_id
) insert into owner_bindings (tenant_id, membership_id) select tenant_id, id from m`, account, slug)
	return account
}

// walkPages follows the cursors of ListTenants with pages of size and returns every tenant.
func walkPages(t *testing.T, s *stand, size int) []Tenant {
	t.Helper()
	var (
		all   []Tenant
		after *Cursor
	)
	for range 10 {
		page, next, err := ListTenants(t.Context(), s.control, after, size)
		if err != nil {
			t.Fatal(err)
		}
		all = append(all, page...)
		if next == nil {
			return all
		}
		after = next
	}
	t.Fatal("cursor never ends")
	return nil
}

func slugsOf(ts []Tenant) []string {
	out := make([]string, len(ts))
	for i, tn := range ts {
		out[i] = tn.Slug
	}
	return out
}
