package provisioning

import (
	"errors"
	"regexp"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func validRequest() Request {
	return Request{
		Name: "Альта Логистика", OwnerEmail: "owner@alta.example", TimeZone: "Europe/Moscow", PlanKey: "pilot",
		ActorID: uuid.MustParse("0281a55e-725e-53b1-920f-4189ab46e08a"), IdempotencyKey: "create-alta-0001-key",
	}
}

// TenantCreate (components/platform/schemas.yaml): name 1…150, ownerEmail — адрес, timeZone — IANA, planKey;
// Idempotency-Key 16…128 [A-Za-z0-9._:-]. Каждое нарушение называет поле.
func TestRequestValidate(t *testing.T) {
	t.Parallel()
	if err := validRequest().Validate(); err != nil {
		t.Fatalf("valid request: %v", err)
	}
	cases := map[string]func(*Request){
		"name":           func(r *Request) { r.Name = "   " },
		"name ":          func(r *Request) { r.Name = strings.Repeat("я", 151) },
		"ownerEmail":     func(r *Request) { r.OwnerEmail = "not-an-address" },
		"ownerEmail ":    func(r *Request) { r.OwnerEmail = "Владелец <owner@alta.example>" },
		"timeZone":       func(r *Request) { r.TimeZone = "Mars/Olympus" },
		"timeZone ":      func(r *Request) { r.TimeZone = "Local" },
		"planKey":        func(r *Request) { r.PlanKey = "" },
		"planKey ":       func(r *Request) { r.PlanKey = "Pilot Plan" },
		"idempotencyKey": func(r *Request) { r.IdempotencyKey = "short" },
	}
	for field, mutate := range cases {
		r := validRequest()
		mutate(&r)
		err := r.Validate()
		var ve *ValidationError
		if !errors.As(err, &ve) || !strings.Contains(ve.Error(), strings.TrimSpace(field)) {
			t.Errorf("%s: %v, want a ValidationError naming the field", field, err)
		}
	}
	if err := (Request{}).Validate(); err == nil || len(err.(*ValidationError).Fields) < 4 { //nolint:errorlint,forcetypeassert // the concrete type is the contract
		t.Errorf("empty request: %v", err)
	}
}

var slugShape = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,39}$`) // tenants.slug check (control 0001)

// slug: транслитерация имени + «-» + 6 hex id — уникален без повторов и проходит проверку tenants.slug; имя БД
// t_<slug> проходит tenantctx.CheckDatabaseName.
func TestSlugAndDatabaseName(t *testing.T) {
	t.Parallel()
	id := uuid.MustParse("3f9a1c00-0000-5000-8000-000000000000")
	cases := map[string]string{
		"Альта Логистика":              "alta-logistika-3f9a1c",
		"ООО «Щука и Ёж» №1":           "ooo-shchuka-i-ezh-1-3f9a1c",
		"Remstroy Group":               "remstroy-group-3f9a1c",
		"!!!":                          "org-3f9a1c",
		"":                             "org-3f9a1c",
		strings.Repeat("Длинное ", 20): "",
	}
	for name, want := range cases {
		got := Slug(name, id)
		if want != "" && got != want {
			t.Errorf("Slug(%q) = %q, want %q", name, got, want)
		}
		if !slugShape.MatchString(got) {
			t.Errorf("Slug(%q) = %q does not fit tenants.slug", name, got)
		}
		db := DatabaseName(got)
		if err := tenantctx.CheckDatabaseName(db); err != nil || !strings.HasPrefix(db, "t_") {
			t.Errorf("DatabaseName(%q) = %q: %v", got, db, err)
		}
	}
}

// Идентификаторы детерминированы: повтор с тем же ключом даёт ту же организацию; другой оператор или ключ — другую.
func TestDeterministicIDs(t *testing.T) {
	t.Parallel()
	actor := uuid.New()
	a, b := TenantID(actor, "key-0000000000000001"), TenantID(actor, "key-0000000000000001")
	if a != b || a == TenantID(actor, "key-0000000000000002") || a == TenantID(uuid.New(), "key-0000000000000001") {
		t.Error("TenantID is not a function of (actor, key)")
	}
	if OwnerPersonID(a) == RootUnitID(a) || OwnerPersonID(a) != OwnerPersonID(b) || OwnerPersonID(a) == OwnerPersonID(uuid.New()) {
		t.Error("OwnerPersonID/RootUnitID are not stable per tenant")
	}
}

// Повтор гранта роли — только при гонке за каталог (XX000 «tuple concurrently …», 23505), не при любой ошибке.
func TestCatalogRace(t *testing.T) {
	t.Parallel()
	for err, want := range map[error]bool{
		&pgconn.PgError{Code: "XX000", Message: "tuple concurrently updated"}: true,
		&pgconn.PgError{Code: "23505", Message: "duplicate key"}:              true,
		&pgconn.PgError{Code: "XX000", Message: "cache lookup failed"}:        false,
		&pgconn.PgError{Code: "42501", Message: "permission denied to grant"}: false,
		errors.New("plain"): false,
	} {
		if got := catalogRace(err); got != want {
			t.Errorf("catalogRace(%v) = %v, want %v", err, got, want)
		}
	}
}
