package chats

import (
	"slices"
	"testing"
)

func none(string) bool { return false }

func granting(actions ...string) func(string) bool {
	return func(a string) bool { return slices.Contains(actions, a) }
}

func TestRoleActionsFollowTheTemplates(t *testing.T) {
	t.Parallel()
	want := map[Role]int{RoleOwner: 9, RoleModerator: 8, RoleMember: 5, RoleReader: 1}
	for role, n := range want {
		if got := RoleActions(role); len(got) != n {
			t.Errorf("%s: %d actions %v, want %d", role, len(got), got, n)
		}
	}
	if len(RoleActions("nobody")) != 0 {
		t.Error("unknown role has actions")
	}
}

func TestRightsByRole(t *testing.T) {
	t.Parallel()
	work := ChatFacts{Kind: KindGroup, Status: "active"}
	pol := DefaultPolicy(KindGroup)
	cases := []struct {
		name  string
		facts ChatFacts
		who   Actor
		role  Role
		pol   Policy
		grant func(string) bool
		want  Can
	}{
		{"reader reads only", work, Actor{}, RoleReader, pol, none, Can{}},
		{"member writes", work, Actor{}, RoleMember, pol, none, Can{Write: true, Files: true, Polls: true}},
		{"moderator moderates", work, Actor{}, RoleModerator, pol, none,
			Can{Write: true, Files: true, Polls: true, Moderate: true, Pin: true, Announce: true, Members: true, ViewOnce: false}},
		{"owner of chat manages settings", work, Actor{}, RoleOwner, pol, none,
			Can{Write: true, Files: true, Polls: true, Moderate: true, Pin: true, Announce: true, Members: true, Settings: true}},
		{"archived chat is read only", ChatFacts{Kind: KindGroup, Status: "archived"}, Actor{}, RoleOwner, pol, none,
			Can{Moderate: true, Pin: true, Members: true, Settings: true}},
		{"announce: member reads", ChatFacts{Kind: KindAnnounce, Status: "active"}, Actor{}, RoleMember, DefaultPolicy(KindAnnounce), none, Can{}},
		{"announce: moderator writes", ChatFacts{Kind: KindAnnounce, Status: "active"}, Actor{}, RoleModerator, DefaultPolicy(KindAnnounce), none,
			Can{Write: true, Files: true, Polls: true, Moderate: true, Pin: true, Announce: true, Members: true}},
		{"direct: temporary allowed, no settings", ChatFacts{Kind: KindDirect, Status: "active"}, Actor{}, RoleMember, DefaultPolicy(KindDirect), none,
			Can{Write: true, Files: true, Polls: true, Ephemeral: true}},
		{"direct: the second member is gone", ChatFacts{Kind: KindDirect, Status: "active", PeerGone: true}, Actor{}, RoleMember, DefaultPolicy(KindDirect), none, Can{}},
		{"record: view-once for the moderator and save to record", ChatFacts{Kind: KindRecord, Status: "active", HasRecord: true}, Actor{}, RoleModerator,
			DefaultPolicy(KindRecord), none,
			Can{Write: true, Files: true, Polls: true, Moderate: true, Pin: true, Announce: true, Members: true, ViewOnce: true, SaveToRecord: true}},
		{"granted actions: pdn, tasks, export, audit", work, Actor{}, RoleMember, pol, granting("chat.pdn.read", "tasks.create", "chat.export", "chat.audit.read"),
			Can{Write: true, Files: true, Polls: true, Pdn: true, Task: true, Export: true, Audit: true}},
		{"driver never reveals the PDn", work, Actor{Driver: true}, RoleMember, pol, granting("chat.pdn.read"), Can{Write: true, Files: true, Polls: true}},
		{"receipts mode who", work, Actor{}, RoleMember, withReceipts(pol, "who"), none, Can{Write: true, Files: true, Polls: true, Receipts: true}},
		{"reader does not see receipts", work, Actor{}, RoleReader, withReceipts(pol, "who"), none, Can{}},
		{"business owner: everything inside the rules", work, Actor{Owner: true}, RoleOwner, withReceipts(pol, "who"), none,
			Can{Write: true, Files: true, Polls: true, Moderate: true, Pin: true, Announce: true, Receipts: true, Pdn: true, Members: true, Settings: true,
				Task: true, Export: true, Audit: true}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := Rights(c.facts, c.who, c.role, c.pol, c.grant); got != c.want {
				t.Fatalf("got  %+v\nwant %+v", got, c.want)
			}
		})
	}
}

func withReceipts(p Policy, mode string) Policy { p.Receipts = mode; return p }

func TestSourceRolesNeedTheBusinessOwner(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name      string
		owner     bool
		who       string
		role      Role
		inOwnUnit bool
		detail    string
	}{
		{"moderator adds a member", false, "member", RoleMember, true, ""},
		{"not owner makes an owner", false, "member", RoleOwner, true, "Владельца чата назначает владелец бизнеса"},
		{"not owner adds everyone", false, "all", RoleMember, true, "«Все сотрудники» добавляет владелец бизнеса"},
		{"role outside the unit", false, "role", RoleMember, false, "Роль добавляется только в вашей области"},
		{"role inside the unit", false, "role", RoleMember, true, ""},
		{"owner of business may all", true, "all", RoleOwner, false, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			err := SourceAllowed(c.owner, c.who, c.role, c.inOwnUnit)
			got := ""
			if err != nil {
				got = err.Error()
			}
			if (c.detail == "") != (err == nil) || (c.detail != "" && !contains(got, c.detail)) {
				t.Fatalf("err = %v, want %q", err, c.detail)
			}
		})
	}
	if err := SourceAllowed(false, "nobody", RoleMember, true); err == nil {
		t.Error("an unknown source must be refused")
	}
	if err := SourceAllowed(false, "member", "boss", true); err == nil {
		t.Error("an unknown role must be refused")
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
