package data

import (
	"encoding/json"
	"errors"
	"testing"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// testColumns are the scope columns of the dataset of the tests.
var testColumns = authz.Columns{Unit: "x.unit_id"}

// itemsSpec is a dataset of every value type with a restricted money field (as «Начисление» of «Поездки»).
func itemsSpec() Spec {
	return Spec{
		ID: "test.items", Name: "Позиции", Permission: "fleet.vehicles.read", EntityType: "item",
		From: "test.items x", Where: "x.archived_at is null and x.created_at <= " + NowParam + " and x.owner <> " + PersonParam,
		Columns: testColumns, RecordID: "x.id", Order: []string{"x.created_at", "x.id"},
		Fields: []Field{
			{Key: "name", Label: "Название", Type: Text, SQL: "x.name"},
			{Key: "kind", Label: "Вид", Type: Choices, SQL: "x.kind", Options: []Option{{"a", "Первый"}, {"b", "Второй"}}},
			{Key: "size", Label: "Размер", Type: Decimal, Nullable: true, SQL: "x.size"},
			{Key: "price", Label: "Цена", Type: Money, SQL: "x.price_minor", Currency: "x.currency"},
			{Key: "day", Label: "Дата", Type: Date, SQL: "x.day"},
			{
				Key: "secret", Label: "Секрет", Type: Money, Nullable: true, Sensitivity: SensitivityFinancial, SQL: "x.secret_minor",
				Restricted: &Restriction{Permission: "fleet.earnings.read", Columns: testColumns},
			},
		},
		DefaultSort: []Sort{{Field: "name"}},
	}
}

// itemsView is the view of a member to whom the restricted field is open (secret) or closed.
func itemsView(secret bool) view {
	s := itemsSpec()
	v := view{module: "fleet", spec: s, export: true, version: "7"}
	for _, f := range s.Fields {
		if f.Restricted != nil && !secret {
			v.hidden = append(v.hidden, f.Label)
			continue
		}
		v.fields = append(v.fields, f)
	}
	return v
}

// query decodes a DatasetQuery as the strict server does.
func query(t *testing.T, raw string) *dataapi.DatasetQuery {
	t.Helper()
	var q dataapi.DatasetQuery
	if err := json.Unmarshal([]byte(raw), &q); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	return &q
}

// asFieldError returns the field error of err or fails.
func asFieldError(t *testing.T, err error) *fieldError {
	t.Helper()
	fe, ok := errors.AsType[*fieldError](err)
	if !ok {
		t.Fatalf("want a 422 field error, got %v", err)
	}
	return fe
}

// wantMalformed fails unless err is 400 malformed_request.
func wantMalformed(t *testing.T, err error) {
	t.Helper()
	if !problem.Is(err, problem.CodeMalformedRequest) {
		t.Fatalf("want malformed_request, got %v", err)
	}
}

const member = "tenant|membership"
