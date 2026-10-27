package chats

import "slices"

// roleActions are the actions a role in a chat gives inside it (the templates chat_owner, chat_moderator, chat_member,
// chat_reader of api/permissions.yaml). The roster is materialized in chat.chat_members (no assignment of the scope
// «chat» exists in tenant 0001), so the role of the chat plays the part of that assignment.
var roleActions = map[Role][]string{
	RoleOwner: {litChatRead, "chat.write", "chat.files.send", "chat.polls.create", "chat.announce", "chat.moderate",
		"chat.members.manage", "chat.settings.manage", "chat.receipts.read"},
	RoleModerator: {litChatRead, "chat.write", "chat.files.send", "chat.polls.create", "chat.announce", "chat.moderate",
		"chat.members.manage", "chat.receipts.read"},
	RoleMember: {litChatRead, "chat.write", "chat.files.send", "chat.polls.create", "chat.receipts.read"},
	RoleReader: {litChatRead},
}

// RoleActions are the actions of the role in its chat (a copy).
func RoleActions(r Role) []string { return slices.Clone(roleActions[r]) }

// Actor is what the rights of a member depend on besides the role: the owner of the business and the function «driver».
type Actor struct{ Owner, Driver bool }

// ChatFacts are the properties of a chat the rights depend on.
type ChatFacts struct {
	Kind      Kind
	Status    string // active, archived
	HasRecord bool
	// PeerGone: the other side of a direct chat is blocked or dismissed — the chat is read only for the second member
	// (Q-W4.00-chats-23).
	PeerGone bool
}

// Can is what a member may do in a chat (the contract ChatCan plus the rights of the journal and the export).
type Can struct {
	Write, Files, Polls, Moderate, Pin, Announce, Receipts, Pdn, Ephemeral, ViewOnce bool
	Members, Settings, SaveToRecord, Task, Export, Audit                             bool
}

// Rights computes what a member with role may do in the chat: the role in the chat, the policy of the kind, the actions
// granted outside the chat (granted: the evaluator over the organization and the unit) and the function. The owner of the
// business has every action. The chain: roster → role → policy → function (chatRights of the domain).
func Rights(f ChatFacts, who Actor, role Role, pol Policy, granted func(action string) bool) Can { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	if !role.Valid() {
		return Can{}
	}
	has := func(action string) bool {
		return who.Owner || slices.Contains(roleActions[role], action) || (granted != nil && granted(action))
	}
	rank := role.Rank()
	writer := rank >= RoleMember.Rank()
	if f.Kind == KindAnnounce {
		writer = rank >= RoleModerator.Rank()
	}
	write := f.Status != litArchived && !f.PeerGone && writer && has("chat.write")
	moderate := rank >= RoleModerator.Rank() && has("chat.moderate")
	c := Can{
		Write:        write,
		Files:        write && has("chat.files.send"),
		Polls:        write && has("chat.polls.create"),
		Moderate:     moderate,
		Pin:          moderate,
		Announce:     write && moderate && has("chat.announce"),
		Receipts:     pol.Receipts == "who" && rank >= RoleMember.Rank() && has("chat.receipts.read"),
		Pdn:          !who.Driver && (who.Owner || (granted != nil && granted("chat.pdn.read"))),
		Ephemeral:    write && pol.Temp == "allowed",
		ViewOnce:     write && rank >= RoleModerator.Rank() && pol.Temp != litOff,
		Members:      f.Kind != KindDirect && (role == RoleOwner || (moderate && has("chat.members.manage"))),
		Settings:     f.Kind != KindDirect && (role == RoleOwner || who.Owner) && has("chat.settings.manage"),
		SaveToRecord: write && f.HasRecord,
		Task:         write && has("tasks.create"),
		Export:       has("chat.export") && f.Kind != KindDirect,
		Audit:        has("chat.audit.read"),
	}
	return c
}

// sourceKinds are the values of the source of the roster (chat.chat_sources.who).
var sourceKinds = []string{litAll, litGroup, litRole, litMember, litRelation, litTripDriver}

// SourceAllowed checks a source of the roster against the author (chats.js 362–368): the owner of a chat and «all
// employees» are set by the owner of the business only; a role is added in the own unit of the author.
func SourceAllowed(ownerOfBusiness bool, who string, role Role, inOwnUnit bool) error {
	if !slices.Contains(sourceKinds, who) {
		return failed("Неизвестный источник состава")
	}
	if !role.Valid() {
		return failed("Выберите роль в чате")
	}
	if ownerOfBusiness {
		return nil
	}
	if role == RoleOwner {
		return coded(codeOutOfScope, "Владельца чата назначает владелец бизнеса")
	}
	if who == litAll {
		return forbidden("«Все сотрудники» добавляет владелец бизнеса")
	}
	if who == litRole && !inOwnUnit {
		return coded(codeOutOfScope, "Роль добавляется только в вашей области")
	}
	return nil
}
