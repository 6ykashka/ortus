// Package chats is the server of the tag Chats (W7.11): chats of five kinds, the roster computed from sources, messages
// with versions, polls and acknowledgements, the policies of the kinds and the storage of a chat, holds, the journal and
// the jobs by term. The data lives in the schema chat (tenant 0060); the module writes only there.
package chats

import "github.com/ortus/ortus-crm/backend/internal/platform/problem"

// Kind is the kind of a chat.
type Kind string

// Kinds of chats (chat.chats.kind).
const (
	KindDirect   Kind = "direct"
	KindGroup    Kind = litGroup
	KindArea     Kind = "area"
	KindRecord   Kind = "record"
	KindAnnounce Kind = "announce"
)

// Kinds lists the kinds in the order of the folders.
var Kinds = []Kind{KindDirect, KindGroup, KindArea, KindRecord, KindAnnounce}

// kindLabels are the plural labels of the kinds (CHAT_KINDS of the domain).
var kindLabels = map[Kind]string{
	KindDirect: "Личные", KindGroup: "Рабочие группы", KindArea: "По роли в области", KindRecord: "Чаты записей", KindAnnounce: "Объявления",
}

// kindOne are the singular labels of the kinds.
var kindOne = map[Kind]string{
	KindDirect: "Личный чат", KindGroup: "Рабочая группа", KindArea: "Чат по роли", KindRecord: "Чат записи", KindAnnounce: "Объявления",
}

// Valid reports whether k is a kind of chats.
func (k Kind) Valid() bool { _, ok := kindLabels[k]; return ok }

// Role is the role of a member in a chat.
type Role string

// Roles in a chat (chat.chat_members.role).
const (
	RoleOwner     Role = "owner"
	RoleModerator Role = "moderator"
	RoleMember    Role = litMember
	RoleReader    Role = "reader"
)

var roleRank = map[Role]int{RoleReader: 1, RoleMember: 2, RoleModerator: 3, RoleOwner: 4}

// Rank is the weight of the role (0 for none or unknown).
func (r Role) Rank() int { return roleRank[r] }

// Valid reports whether r is a role of a chat.
func (r Role) Valid() bool { return roleRank[r] > 0 }

// higher returns the stronger of two roles.
func higher(a, b Role) Role {
	if b.Rank() > a.Rank() {
		return b
	}
	return a
}

// Problem codes of the contract (api/errors.yaml) the module answers.
const (
	codeValidation = "validation_failed"
	codeRevision   = "revision_mismatch"
	codeTransition = "invalid_transition"
	codeQuotaFull  = "chat_quota_full"
	codeTooLarge   = "chat_file_too_large"
	codeContent    = "chat_content_forbidden"
	codeEditWindow = "chat_edit_window_closed"
	codeOutOfScope = "chat_member_out_of_scope"
	codeOnHold     = "chat_on_hold"
	codeEphemeral  = "chat_ephemeral_disabled"
	codeFunction   = "function_blocked"
)

func failed(detail string) error      { return problem.New(codeValidation, detail) }
func forbidden(detail string) error   { return problem.New(problem.CodeForbiddenAction, detail) }
func notFound(detail string) error    { return problem.New(problem.CodeNotFound, detail) }
func coded(code, detail string) error { return problem.New(code, detail) }
