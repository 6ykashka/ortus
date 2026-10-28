package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func TestOriginsAdmitTheListAndTheRequestWithoutOrigin(t *testing.T) {
	t.Parallel()
	o := Origins{"https://crm.example"}
	good, bad, null := "https://crm.example", "https://evil.example", "null"
	eq(t, "no header", o.Admit(nil) == nil, true)
	eq(t, "listed", o.Admit(&good) == nil, true)
	for _, v := range []*string{&bad, &null} {
		err := o.Admit(v)
		eq(t, *v, problem.Is(err, problem.CodeOriginNotAllowed), true)
	}
	eq(t, "an empty list admits no browser", Origins(nil).Admit(&good) != nil, true)
}

// seen is a handler that tells what the middleware recorded and what body it passes on.
func seen(got *struct {
	unassign bool
	body     string
}) http.Handler {
	return http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		got.unassign, got.body = Unassigns(r.Context()), string(b)
	})
}

func TestNullsMiddlewareNotesTheNullAssigneeAndGivesTheBodyBack(t *testing.T) {
	t.Parallel()
	const path = "/api/v1/tenants/6ca1a9c0-0000-4000-8000-000000000001/service/requests/6ca1a9c0-0000-4000-8000-000000000002"
	for name, c := range map[string]struct {
		method, path, body string
		want               bool
	}{
		"null assignee":         {http.MethodPatch, path, `{"assigneeId": null}`, true},
		"null with a priority":  {http.MethodPatch, path, `{"priority":"high","assigneeId":null}`, true},
		"absent assignee":       {http.MethodPatch, path, `{"priority":"high"}`, false},
		"an assignee":           {http.MethodPatch, path, `{"assigneeId":"6ca1a9c0-0000-4000-8000-000000000003"}`, false},
		"another method":        {http.MethodPost, path, `{"assigneeId":null}`, false},
		"another path":          {http.MethodPatch, "/api/v1/tenants/x/forms/y", `{"assigneeId":null}`, false},
		"a path of the message": {http.MethodPatch, path + "/messages", `{"assigneeId":null}`, false},
		"not a json":            {http.MethodPatch, path, `assigneeId: null`, false},
	} {
		var got struct {
			unassign bool
			body     string
		}
		rec := httptest.NewRecorder()
		NullsMiddleware(seen(&got)).ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), c.method, c.path, strings.NewReader(c.body)))
		eq(t, name, got.unassign, c.want)
		eq(t, name+" body", got.body, c.body)
	}
	var got struct {
		unassign bool
		body     string
	}
	big := `{"assigneeId":null,"pad":"` + strings.Repeat("x", nullsBody) + `"}`
	NullsMiddleware(seen(&got)).ServeHTTP(httptest.NewRecorder(), httptest.NewRequestWithContext(t.Context(), http.MethodPatch, path, strings.NewReader(big)))
	eq(t, "a body over the limit is passed on whole, its nulls unread", got.unassign, false)
	eq(t, "a body over the limit", got.body, big)
}

func TestPagesAreCursorsOverTheSortedList(t *testing.T) {
	t.Parallel()
	off, lim, err := PageQuery{}.window()
	eq(t, "default", [3]any{off, lim, err}, [3]any{0, 50, error(nil)})
	_, _, err = PageQuery{Limit: -1}.window()
	eq(t, "zero is out of range", problem.Is(err, problem.CodeMalformedRequest), true)
	_, _, err = PageQuery{Limit: 201}.window()
	eq(t, "over 200", problem.Is(err, problem.CodeMalformedRequest), true)
	_, _, err = PageQuery{Cursor: "%%%"}.window()
	eq(t, "bad cursor", problem.Is(err, problem.CodeMalformedRequest), true)
	from, to, next := pageOf(0, 3, 7)
	eq(t, "first page", [2]int{from, to}, [2]int{0, 3})
	off, _, err = PageQuery{Cursor: *next, Limit: 3}.window()
	eq(t, "cursor", [2]any{off, err}, [2]any{3, error(nil)})
	from, to, next = pageOf(6, 3, 7)
	eq(t, "last page", [3]any{from, to, next == nil}, [3]any{6, 7, true})
	from, to, next = pageOf(99, 3, 7)
	eq(t, "past the end", [3]any{from, to, next == nil}, [3]any{7, 7, true})
}

func TestParametersOfTheStrictServer(t *testing.T) {
	t.Parallel()
	c, l := "abc", 0
	q := pageQuery(&c, &l)
	eq(t, "cursor", q.Cursor, "abc")
	eq(t, "an explicit zero is out of range", q.Limit, -1)
	eq(t, "none", pageQuery(nil, nil), PageQuery{})
	id := uuid.New()
	eq(t, "id", idOf(&id), id)
	eq(t, "no id", idOf(nil), uuid.Nil)
	kind := api.ListServiceRequestsParamsKind("cargo")
	eq(t, "str", strOf(&kind), "cargo")
	eq(t, "no str", strOf[api.ListServiceRequestsParamsKind](nil), "")
	_, err := tenant(context.Background())
	eq(t, "no tenant", problem.Is(err, problem.CodeNotFound), true)
	cc, rid := headers(context.Background())
	eq(t, "headers", *cc+"|"+boolStr(rid == nil), "private, no-store|true")
}

func TestPhonesAndTokens(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]string{"8 (903) 123-45-67": "+79031234567", "+7 903 123-45-67": "+79031234567", "903 123 45 67": "+79031234567", "12": "+12"} {
		eq(t, in, NormalizePhone(in), want)
	}
	eq(t, "format", FormatPhone("+79031234567"), "+7 903 123-45-67")
	eq(t, "foreign number as it is", FormatPhone("+4930123456"), "+4930123456")
	id := uuid.MustParse("6ca1a9c0-0000-4000-8000-000000000002")
	eq(t, "demo token", DemoToken(id), "tok_6ca1a9c0000040008000000000000002z")
	eq(t, "digest prefix", TokenDigest("tok_x")[:7], "sha256:")
	eq(t, "digest length", len(TokenDigest("tok_x")), 71)
	tok, err := newToken()
	eq(t, "new token", strings.HasPrefix(tok, "tok_") && len(tok) >= 20 && err == nil, true)
}

func TestLinkOfPicksAnObjectOrAFreeText(t *testing.T) {
	t.Parallel()
	eq(t, "none", func() bool { l, err := linkOf(nil); return l == nil && err == nil }(), true)
	empty := " "
	eq(t, "blank label", func() bool { l, err := linkOf(&api.ServiceLinkInput{Label: &empty}); return l == nil && err == nil }(), true)
	label := "Рейс Р-196"
	l, err := linkOf(&api.ServiceLinkInput{Label: &label})
	eq(t, "free text", [3]any{l.Kind, l.Lines[0], err}, [3]any{"manual", "Привязано вручную при звонке", error(nil)})
	obj := &api.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: uuid.New()}
	l, err = linkOf(&api.ServiceLinkInput{Object: obj})
	eq(t, "object", [4]any{l.Kind, l.Label, l.Object.ModuleKey, err}, [4]any{"object", "Связанная запись", "fleet", error(nil)})
	_, err = linkOf(&api.ServiceLinkInput{Object: &api.ObjectRef{ModuleKey: "fleet"}})
	eq(t, "a broken object", problem.Is(err, "validation_failed"), true)
}

func TestLoadZoneKnowsMoscowSamaraAndTheRegistry(t *testing.T) {
	t.Parallel()
	eq(t, "empty", LoadZone("").String(), "MSK")
	eq(t, "samara", LoadZone("Europe/Samara").String(), "SAMT")
	eq(t, "registry", LoadZone("Asia/Yekaterinburg").String(), "Asia/Yekaterinburg")
	eq(t, "unknown", LoadZone("Mars/Base").String(), "MSK")
}
