package files

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W7.11, return 1: the files of the chats. The module of chats does not touch files.objects — it asks this module (Release,
// Reparent, Put) and the parents below say who reads and who sends the files of a chat.

// PurposeChatAttachment is the purpose of the attachments of a chat and of the files an export of a chat makes
// (UploadCreate.purpose chat_attachment).
const PurposeChatAttachment Purpose = "chat_attachment"

// Parents of the chats.
const (
	ChatModule     = "chat"
	ChatEntity     = "chat"   // the attachments of a chat: its members read them
	ChatExport     = "export" // the file of an export of a chat: only the one who asked for it and holds chat.export
	chatExportRead = "chat.export"
)

// chatRows is the scope row of a chat: its unit and title; no row when the subject is not a member (and not the owner of the
// business, who sees every working chat) — the chat is closed to him, and so are its files (ChatHider). A new file
// (FilePlaceholder null) takes no row in a chat the subject only reads (archived, reader, an announcement without the
// rank of a moderator).
const chatRows = `select c.org_unit_id as unit_id, null::uuid as project_id, null::uuid as person_a, null::uuid as person_b,
       c.title as title
  from chat.chats c
 where c.id = ` + IDPlaceholder + ` and c.id <> all(` + HiddenPlaceholder + `)
   and (` + FilePlaceholder + ` is not null or c.id <> all(` + ContinuedPlaceholder + `))`

// exportRows is the scope row of an export: the file the export names (an upload takes no row), read as the person who
// asked for it.
const exportRows = `select c.org_unit_id as unit_id, null::uuid as project_id, e.created_by as person_a, null::uuid as person_b,
       c.title as title
  from chat.exports e join chat.chats c on c.id = e.chat_id
 where e.id = ` + IDPlaceholder + ` and e.file_id = ` + FilePlaceholder + ` and c.id <> all(` + HiddenPlaceholder + `)`

// ChatParents are the parents «chat/chat» (attachments, purpose chat_attachment, uploaded by the members who write) and
// «chat/export» (files of exports, written by the server only).
func ChatParents() []ParentKind {
	only := []Purpose{PurposeChatAttachment}
	return []ParentKind{
		{Module: ChatModule, Entity: ChatEntity, ReadAction: actionRead, Purposes: only, Rows: chatRows},
		{Module: ChatModule, Entity: ChatExport, ReadAction: chatExportRead, Purposes: only, Rows: exportRows},
	}
}

// ChatHider closes to the subject the chats he is not a member of (the owner of the business is a member of every working
// chat but a personal one) and, for new files, the chats he only reads. It is a Hider for the parents of ChatParents.
type ChatHider struct{ Pools Pools }

var _ Hider = ChatHider{}

const (
	chatsHiddenSQL = `select c.id from chat.chats c
		 where not exists (select 1 from chat.chat_members m where m.chat_id = c.id and m.member_id = $1 and m.state = 'in')
		   and not ($2 and c.kind <> 'direct')`
	chatsReadOnlySQL = `select c.id from chat.chats c
		 where c.status = 'archived'
		    or (not $2 and exists (select 1 from chat.chat_members m where m.chat_id = c.id and m.member_id = $1 and m.state = 'in'
		        and (m.role = 'reader' or (c.kind = 'announce' and m.role = 'member'))))`
)

// Closed implements Hider.
func (h ChatHider) Closed(ctx context.Context, tc tenantctx.TenantContext) (Closed, error) {
	pool, err := h.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return Closed{}, err
	}
	hidden, err := ids(ctx, pool, chatsHiddenSQL, tc)
	if err != nil {
		return Closed{}, err
	}
	readOnly, err := ids(ctx, pool, chatsReadOnlySQL, tc)
	if err != nil {
		return Closed{}, err
	}
	return Closed{Hidden: hidden, Continued: readOnly}, nil
}

func ids(ctx context.Context, q querier, sql string, tc tenantctx.TenantContext) ([]uuid.UUID, error) {
	rows, err := q.Query(ctx, sql, tc.PersonID, tc.Owner)
	if err != nil {
		return nil, fmt.Errorf("files: chats: %w", err)
	}
	defer rows.Close()
	out := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("files: chats: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
