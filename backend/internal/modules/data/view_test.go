package data

import (
	"encoding/json"
	"reflect"
	"testing"
)

// sameJSON compares v with the JSON want as values (key order and spacing aside).
func sameJSON(t *testing.T, v any, want string) {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	var got, exp any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(want), &exp); err != nil {
		t.Fatalf("want: %v", err)
	}
	if !reflect.DeepEqual(got, exp) {
		t.Fatalf("got\n%s\nwant\n%s", raw, want)
	}
}

// The catalog entry of a member: operators by value type (is_null for a nullable field), aggregatable decimal and
// money, options of a choices field, the closed field only as its label (example listDatasets/ok, MSW W2.51).
func TestViewDataset(t *testing.T) {
	t.Parallel()
	sameJSON(t, itemsView(false).dataset(), `{
		"id": "test.items", "moduleKey": "fleet", "name": "Позиции",
		"fields": [
			{"key": "name", "label": "Название", "valueType": "text", "nullable": false,
			 "filterOperators": ["eq", "ne", "in", "contains"], "sortable": true, "aggregatable": false, "sensitivity": "standard"},
			{"key": "kind", "label": "Вид", "valueType": "choices", "nullable": false,
			 "filterOperators": ["eq", "ne", "in"], "sortable": true, "aggregatable": false, "sensitivity": "standard",
			 "options": [{"key": "a", "label": "Первый"}, {"key": "b", "label": "Второй"}]},
			{"key": "size", "label": "Размер", "valueType": "decimal", "nullable": true,
			 "filterOperators": ["eq", "ne", "lt", "lte", "gt", "gte", "is_null"], "sortable": true, "aggregatable": true, "sensitivity": "standard"},
			{"key": "price", "label": "Цена", "valueType": "money", "nullable": false,
			 "filterOperators": ["eq", "ne", "lt", "lte", "gt", "gte"], "sortable": true, "aggregatable": true, "sensitivity": "standard"},
			{"key": "day", "label": "Дата", "valueType": "date", "nullable": false,
			 "filterOperators": ["eq", "ne", "lt", "lte", "gt", "gte"], "sortable": true, "aggregatable": false, "sensitivity": "standard"}
		],
		"allowedAggregations": ["count", "sum", "avg", "min", "max"],
		"permissionVersion": "7", "permissionKey": "fleet.vehicles.read", "entityType": "item", "exportAllowed": true,
		"hiddenFieldLabels": ["Секрет"],
		"defaultSort": [{"fieldKey": "name", "direction": "asc"}]
	}`)
}

func TestViewDatasetOpenField(t *testing.T) {
	t.Parallel()
	v := itemsView(true)
	v.export = false
	d := v.dataset()
	if d.HiddenFieldLabels == nil || len(*d.HiddenFieldLabels) != 0 {
		t.Fatalf("hiddenFieldLabels %v, want []", d.HiddenFieldLabels)
	}
	if d.ExportAllowed == nil || *d.ExportAllowed {
		t.Fatalf("exportAllowed %v, want false", d.ExportAllowed)
	}
	last := d.Fields[len(d.Fields)-1]
	sameJSON(t, last, `{"key": "secret", "label": "Секрет", "valueType": "money", "nullable": true,
		"filterOperators": ["eq", "ne", "lt", "lte", "gt", "gte", "is_null"], "sortable": true, "aggregatable": true,
		"sensitivity": "financial"}`)
	if f, ok := v.field("secret"); !ok || f.Key != "secret" {
		t.Fatalf("field secret: %v %v", f, ok)
	}
	if _, ok := itemsView(false).field("secret"); ok {
		t.Fatal("a closed field is visible")
	}
}
