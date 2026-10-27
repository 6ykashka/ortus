package realtime

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"go.yaml.in/yaml/v3"
)

// Тест R-1 брифа W1.07: кадры канала = контракт 0.4.0-stage1 (components/auth/schemas.yaml, x-realtime).

// repoFile reads a file of the repository root (the package is backend/internal/platform/notify/realtime).
func repoFile(t *testing.T, rel string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "..", filepath.FromSlash(rel)))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

type schema struct {
	Required   []string `yaml:"required"`
	Properties map[string]struct {
		Enum  []string `yaml:"enum"`
		Const string   `yaml:"const"`
	} `yaml:"properties"`
}

func authSchemas(t *testing.T) map[string]schema {
	t.Helper()
	var out map[string]schema
	if err := yaml.Unmarshal(repoFile(t, "api/openapi/components/auth/schemas.yaml"), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

// jsonFields returns the JSON names of the fields of v.
func jsonFields(v any) []string {
	var out []string
	rt := reflect.TypeOf(v)
	for f := range rt.Fields() {
		name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		out = append(out, name)
	}
	slices.Sort(out)
	return out
}

func keys[V any](m map[string]V) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}

func sorted(s []string) []string {
	s = slices.Clone(s)
	slices.Sort(s)
	return s
}

func TestFramesMatchContract(t *testing.T) {
	t.Parallel()
	s := authSchemas(t)
	server, client, ticket := s["RealtimeServerMessage"], s["RealtimeClientMessage"], s["RealtimeTicket"]

	if got, want := sorted(ServerTypes()), sorted(server.Properties["type"].Enum); !slices.Equal(got, want) {
		t.Errorf("ServerTypes = %v, contract %v", got, want)
	}
	if got, want := sorted(Reasons()), sorted(server.Properties["reason"].Enum); !slices.Equal(got, want) {
		t.Errorf("Reasons = %v, contract %v", got, want)
	}
	if got, want := sorted(ClientTypes()), sorted(client.Properties["type"].Enum); !slices.Equal(got, want) {
		t.Errorf("ClientTypes = %v, contract %v", got, want)
	}
	if got, want := jsonFields(ServerMessage{}), keys(server.Properties); !slices.Equal(got, want) {
		t.Errorf("ServerMessage fields = %v, contract %v", got, want)
	}
	if got, want := jsonFields(ClientMessage{}), keys(client.Properties); !slices.Equal(got, want) {
		t.Errorf("ClientMessage fields = %v, contract %v", got, want)
	}
	if ticket.Properties["path"].Const != Path || ticket.Properties["protocol"].Const != Protocol {
		t.Errorf("RealtimeTicket path/protocol = %q/%q, want %q/%q",
			ticket.Properties["path"].Const, ticket.Properties["protocol"].Const, Path, Protocol)
	}

	var paths map[string]struct {
		Post struct {
			Realtime struct {
				Path     string `yaml:"path"`
				Protocol string `yaml:"protocol"`
				Auth     string `yaml:"auth"`
			} `yaml:"x-realtime"`
		} `yaml:"post"`
	}
	if err := yaml.Unmarshal(repoFile(t, "api/openapi/paths/auth.yaml"), &paths); err != nil {
		t.Fatal(err)
	}
	rt := paths["/api/v1/auth/realtime-tickets"].Post.Realtime
	if rt.Path != Path || rt.Protocol != Protocol || rt.Auth != "first-frame" {
		t.Errorf("x-realtime = %+v", rt)
	}
}

// Обязательные поля (type, seq, at) есть всегда, необязательные пустые не пишутся; at — UTC с Z (Instant).
func TestServerMessageJSON(t *testing.T) {
	t.Parallel()
	required := authSchemas(t)["RealtimeServerMessage"].Required
	at := time.Date(2026, 10, 15, 9, 30, 0, 0, time.UTC)
	b, err := json.Marshal(ServerMessage{Type: TypePing, Seq: 1, At: at})
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(keys(got), sorted(required)) {
		t.Errorf("ping = %s, want exactly %v", b, required)
	}
	if got["at"] != "2026-10-15T09:30:00Z" {
		t.Errorf("at = %v", got["at"])
	}
	tenant := uuid.MustParse("6a3c3c51-5bb1-4b39-9d3c-0d9d52f8a7aa")
	b, _ = json.Marshal(ServerMessage{Type: TypeContextChanged, TenantID: &tenant, Seq: 2, At: at})
	if want := `{"type":"context.changed","tenantId":"6a3c3c51-5bb1-4b39-9d3c-0d9d52f8a7aa","seq":2,"at":"2026-10-15T09:30:00Z"}`; string(b) != want {
		t.Errorf("context.changed = %s, want %s", b, want)
	}
}

func TestHintValidate(t *testing.T) {
	t.Parallel()
	acc := []uuid.UUID{uuid.New()}
	cases := []struct {
		name string
		h    Hint
		ok   bool
	}{
		{"context.changed to an account", Hint{Type: TypeContextChanged, TenantID: uuid.New(), Accounts: acc}, true},
		{"notifications.changed", Hint{Type: TypeNotificationsChanged, Accounts: acc}, true},
		{"session.ended to a session", Hint{Type: TypeSessionEnded, Reason: ReasonLogout, Sessions: []string{SessionKey("sid")}}, true},
		{"session.ended membership", Hint{Type: TypeSessionEnded, Reason: ReasonMembershipEnded, Accounts: acc}, true},
		{"ping is not a hint", Hint{Type: TypePing, Accounts: acc}, false},
		{"unknown type", Hint{Type: "chat.message", Accounts: acc}, false},
		// W7.00: кадр chat.changed описан контрактом (0.12.0-stage7), но доставка подсказки чата — W7.12 (адресаты — участники
		// чата, ADR-0016): до тех пор шлюз её не принимает.
		{"chat.changed to members", Hint{Type: TypeChatChanged, ChatID: uuid.New(), LastSeq: 7, Accounts: acc}, true},
		{"chat.changed without chat", Hint{Type: TypeChatChanged, LastSeq: 7, Accounts: acc}, false},
		{"chat.changed without seq", Hint{Type: TypeChatChanged, ChatID: uuid.New(), Accounts: acc}, false},
		{"chat.changed to a session", Hint{Type: TypeChatChanged, ChatID: uuid.New(), LastSeq: 1, Sessions: []string{SessionKey("s")}}, false},
		{"chat.changed with reason", Hint{Type: TypeChatChanged, ChatID: uuid.New(), LastSeq: 1, Reason: ReasonLogout, Accounts: acc}, false},
		{"chatId on another type", Hint{Type: TypeContextChanged, ChatID: uuid.New(), Accounts: acc}, false},
		{"lastSeq on another type", Hint{Type: TypeNotificationsChanged, LastSeq: 3, Accounts: acc}, false},
		{"nobody", Hint{Type: TypeContextChanged}, false},
		{"nil account", Hint{Type: TypeContextChanged, Accounts: []uuid.UUID{uuid.Nil}}, false},
		{"empty session key", Hint{Type: TypeContextChanged, Sessions: []string{""}}, false},
		{"session.ended without reason", Hint{Type: TypeSessionEnded, Accounts: acc}, false},
		{"unknown reason", Hint{Type: TypeSessionEnded, Reason: "kicked", Accounts: acc}, false},
		{"reason of another type", Hint{Type: TypeContextChanged, Reason: ReasonLogout, Accounts: acc}, false},
	}
	for _, tc := range cases {
		err := tc.h.Validate()
		if tc.ok && err != nil {
			t.Errorf("%s: %v", tc.name, err)
		}
		if !tc.ok && !errors.Is(err, ErrInvalidHint) {
			t.Errorf("%s: err = %v, want ErrInvalidHint", tc.name, err)
		}
	}
}

// Ключ сессии не раскрывает идентификатор (это значение cookie) и устойчив.
func TestSessionKey(t *testing.T) {
	t.Parallel()
	k := SessionKey("secret-session-id")
	if k == "" || strings.Contains(k, "secret") || k != SessionKey("secret-session-id") || k == SessionKey("other") {
		t.Fatalf("SessionKey = %q", k)
	}
	if len(k) > 64 {
		t.Fatalf("SessionKey too long: %d", len(k))
	}
}

// Pending W7.12 (явный тест вместо молчаливого расхождения): контракт 0.12.0-stage7 и ADR-0016 описывают подсказку
// chat.changed (chatId, lastSeq, адресат — участник чата), а Hint.Validate её пока отвергает (TestHintValidate,
// «chat.changed before W7.12»). Владелец доставки (W7.12) снимает Skip, меняет строку TestHintValidate на ok = true и
// добавляет проверку «chatId и lastSeq обязательны».
func TestHintChatChangedAcceptedPendingW712(t *testing.T) {
	t.Parallel()
	// У Hint пока нет полей chatId и lastSeq (они есть только в кадре): W7.12 добавляет их в Hint и тест дополняет.
	h := Hint{Type: TypeChatChanged, ChatID: uuid.New(), LastSeq: 1, Accounts: []uuid.UUID{uuid.New()}}
	if err := h.Validate(); err != nil {
		t.Fatalf("chat.changed to a chat member: %v", err)
	}
}
