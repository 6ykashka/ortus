package isolation

import (
	"encoding/json"
	"io/fs"
	"os"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
	"github.com/ortus/ortus-crm/backend/test/isolation/matrix"
)

// dateHorizon is how long a successful matrix row with a date must stay valid on the real clock: the fixtures and the
// API under test use time.Now, so a fixed date that is close turns the row red on its own (W4.60, возврат 2).
const dateHorizon = 10 // years

// TestMatrixPriceBookDatesStayFuture checks that every successful publishPriceBookVersion row of the matrix files has an
// effectiveFrom that billing.Draft.Check still accepts dateHorizon years from now («Дата начала — не раньше завтрашнего
// дня»). Runs without the isolation tag: no cluster, only the YAML files.
func TestMatrixPriceBookDatesStayFuture(t *testing.T) {
	t.Parallel()
	dir := os.DirFS(".")
	names, err := fs.Glob(dir, "*.yaml")
	if err != nil {
		t.Fatal(err)
	}
	at := time.Now().AddDate(dateHorizon, 0, 0)
	cat := fixtures.Default()
	rows := 0
	for _, name := range names {
		data, err := fs.ReadFile(dir, name)
		if err != nil {
			t.Fatal(err)
		}
		f, err := matrix.Parse(name, data, cat)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		for _, ep := range f.Endpoints {
			if ep.Op == "publishPriceBookVersion" {
				rows += checkPublishDates(t, name, ep, at)
			}
		}
	}
	if rows == 0 {
		t.Fatal("no successful publishPriceBookVersion rows: the guard checks nothing")
	}
}

// checkPublishDates checks the successful rows of ep on the date of at and returns how many it checked.
func checkPublishDates(t *testing.T, name string, ep matrix.Endpoint, at time.Time) int {
	t.Helper()
	n := 0
	for i, r := range ep.Rows {
		if r.Status < 200 || r.Status > 299 {
			continue
		}
		n++
		var body struct {
			EffectiveFrom string `json:"effectiveFrom"`
		}
		if err := json.Unmarshal([]byte(r.Body), &body); err != nil {
			t.Fatalf("%s %s row %d: body: %v", name, ep.Op, i, err)
		}
		for _, v := range (billing.Draft{EffectiveFrom: body.EffectiveFrom}).Check(at) {
			if v.Field == "effectiveFrom" {
				t.Errorf("%s %s row %d (%s → %d): effectiveFrom %q is refused at %s: %s", name, ep.Op, i, r.Actor, r.Status,
					body.EffectiveFrom, at.Format(time.DateOnly), v.Message)
			}
		}
	}
	return n
}
