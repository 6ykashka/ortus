//go:build integration

package forms

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	pfapi "github.com/ortus/ortus-crm/backend/internal/api/publicforms"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

type (
	pfTicket = pfapi.UploadTicket
	pfFile   = pfapi.File
)

func asProblem(err error) (*problem.Error, bool) { return errors.AsType[*problem.Error](err) }

func contains(s, sub string) bool { return strings.Contains(strings.ToLower(s), strings.ToLower(sub)) }

// page is a definition of one page «Страница 1».
func page(qs ...question) def {
	return def{Pages: []fapi.FormPageDefinition{{Id: "p1", Title: "Страница 1"}}, Fields: qs}
}

func qq(key string, typ fapi.FormQuestionType, label string, required bool, mod ...func(*question)) question {
	x := question{Key: key, PageId: "p1", Type: typ, Label: label, Required: required}
	for _, m := range mod {
		m(&x)
	}
	return x
}

func withOpts(labels ...string) func(*question) { return withOptions(labels...) }

func hidden(def string) func(*question) {
	return func(x *question) {
		x.Hidden = new(true)
		if def != "" {
			x.DefaultValue = new(def)
		}
	}
}

// published creates a form of the whole organization as actor with the questions of d and publishes v1.
func published(t *testing.T, actor, name string, d def) fapi.Form {
	t.Helper()
	ctx, tc, s := t.Context(), as(t, actor), service()
	f := must(s.CreateForm(ctx, tc, fapi.FormCreate{Name: name})).of(t)
	dr := must(s.Draft(ctx, tc, f.Id)).of(t)
	saved := must(s.SaveDraft(ctx, tc, f.Id, rev(dr.Revision), fapi.FormDraftSave{Definition: d})).of(t)
	return must(s.Publish(ctx, tc, f.Id, rev(f.Revision), fapi.FormPublishRequest{DraftRevision: saved.Revision})).of(t)
}

// text, dec, choice, flag are values of answers.
func text(key, v string) fapi.FieldEntry { return entryOf(key, `{"type":"text","value":`+quote(v)+`}`) }
func dec(key, v string) fapi.FieldEntry {
	return entryOf(key, `{"type":"decimal","value":`+quote(v)+`}`)
}
func flag(key string, b bool) fapi.FieldEntry {
	if b {
		return entryOf(key, `{"type":"boolean","value":true}`)
	}
	return entryOf(key, `{"type":"boolean","value":false}`)
}

func choice(key string, keys ...string) fapi.FieldEntry {
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, quote(k))
	}
	return entryOf(key, `{"type":"choices","value":[`+strings.Join(parts, ",")+`]}`)
}

func refTo(key string, r fapi.ObjectRef) fapi.FieldEntry {
	return entryOf(key, `{"type":"reference","value":{"moduleKey":`+quote(r.ModuleKey)+`,"entityType":`+quote(r.EntityType)+
		`,"entityId":"`+r.EntityId.String()+`"}}`)
}

func filesOfIDs(key string, ids ...uuid.UUID) fapi.FieldEntry {
	parts := make([]string, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, `"`+id.String()+`"`)
	}
	return entryOf(key, `{"type":"files","value":[`+strings.Join(parts, ",")+`]}`)
}

func entryOf(key, raw string) fapi.FieldEntry {
	var v fapi.FieldValue
	if err := v.UnmarshalJSON([]byte(raw)); err != nil {
		panic(err)
	}
	return fapi.FieldEntry{FieldKey: key, Value: v}
}

func quote(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

// valueOf is the stored value of the answer key of a response.
func valueOf(t *testing.T, x fapi.FormResponse, key string) *value {
	t.Helper()
	es, err := fromAPI(x.Answers)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range es {
		if e.FieldKey == key {
			return &e.Value
		}
	}
	return nil
}
