package fleetrules

import (
	"encoding/json"
	"io/fs"
	"os"
	"reflect"
	"testing"
)

// fixtures — общие табличные фикстуры testdata/fleet-rules в корне репозитория. Их же читает
// тест паритета TS (@ortus/domain, modules/logistics/fleet-rules.fixtures.test.ts).
var fixtures = os.DirFS("../../../../testdata/fleet-rules")

// loadFixture читает testdata/fleet-rules/<name>.json в v.
func loadFixture(t *testing.T, name string, v any) {
	t.Helper()
	b, err := fs.ReadFile(fixtures, name+".json")
	if err != nil {
		t.Fatalf("фикстура %s: %v", name, err)
	}
	if err := json.Unmarshal(b, v); err != nil {
		t.Fatalf("фикстура %s: %v", name, err)
	}
}

// assertJSON сравнивает got и want как JSON-значения (порядок ключей объекта не важен).
func assertJSON(t *testing.T, got any, want json.RawMessage) {
	t.Helper()
	gotRaw, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var g, w any
	if err := json.Unmarshal(gotRaw, &g); err != nil {
		t.Fatalf("unmarshal got: %v", err)
	}
	if err := json.Unmarshal(want, &w); err != nil {
		t.Fatalf("unmarshal want: %v", err)
	}
	if !reflect.DeepEqual(g, w) {
		t.Errorf("\n got: %s\nwant: %s", gotRaw, want)
	}
}

// pair — строка таблицы фикстуры вида [вход, ожидание].
type pair[T any] struct {
	In   T
	Want string
}

func (p *pair[T]) UnmarshalJSON(b []byte) error {
	var raw [2]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	if err := json.Unmarshal(raw[0], &p.In); err != nil {
		return err
	}
	return json.Unmarshal(raw[1], &p.Want)
}
