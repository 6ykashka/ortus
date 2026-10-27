package chats

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Records the chats of records come from (Q-W4.00-chats-19): a trip of logistics and an object of repairs.
var recordTypes = []string{"trip", "repair_object"}

// RecordSource is a source of the roster of a chat of a record: the driver of the trip, the foreman of the object, a role
// in the area of the record.
type RecordSource struct {
	Who  string // relation, trip_driver, role, member, group
	Ref  *uuid.UUID
	Unit *uuid.UUID
	Trip *uuid.UUID
	Role Role
}

// RecordChat describes the chat of a record for the module that owns the record (fleet, repairs).
type RecordChat struct {
	Record  ObjectRef
	Label   string // «Рейс Р-208», «ЖК Речной · квартира 42»
	Nav     string
	Unit    *uuid.UUID
	Topics  []string
	Sources []RecordSource
}

// EnsureRecordChat creates the chat of a record or, when it exists, brings its sources and topics to the description and
// recomputes the roster: the module of the record calls it when the record appears or changes (a trip is assigned, an object
// goes to the contract). It returns the id of the chat and whether it was created.
func (s *Service) EnsureRecordChat(ctx context.Context, tenant uuid.UUID, in RecordChat) (uuid.UUID, bool, error) { //nolint:gocyclo // one operation of the contract: a chain of checks, each with the text of the reference
	if !slices.Contains(recordTypes, in.Record.Type) || in.Record.ID == uuid.Nil {
		return uuid.Nil, false, failed("Чат записи бывает у рейса и объекта ремонта")
	}
	var (
		id      uuid.UUID
		created bool
	)
	err := s.system(ctx, tenant, func(r *req) error {
		err := r.tx.QueryRow(ctx, `select id from chat.chats where kind = 'record' and record_ref ->> 'type' = $1 and record_ref ->> 'id' = $2 for update`,
			in.Record.Type, in.Record.ID.String()).Scan(&id)
		switch {
		case err == nil:
		case noRows(err):
			id, created = uuid.New(), true
		default:
			return store("record chat", err)
		}
		rec := recordRef{Module: in.Record.Module, Type: in.Record.Type, ID: in.Record.ID, Label: in.Label, Nav: in.Nav}
		raw, _ := json.Marshal(rec)
		if created {
			if _, err := r.tx.Exec(ctx, `insert into chat.chats (id, kind, title, org_unit_id, status, record_ref, created_at, updated_at)
				values ($1, 'record', $2, $3, 'active', $4, $5, $5)`, id, clip(in.Label, 120), in.Unit, raw, r.now); err != nil {
				return store("record chat", err)
			}
		} else if _, err := r.tx.Exec(ctx, `update chat.chats set title = $2, record_ref = $3, updated_at = $4 where id = $1`, id, clip(in.Label, 120), raw, r.now); err != nil {
			return store("record chat", err)
		}
		for i, name := range in.Topics {
			if _, err := r.tx.Exec(ctx, `insert into chat.topics (chat_id, name, position) values ($1, $2, $3) on conflict do nothing`, id, name, i); err != nil {
				return store("topic", err)
			}
		}
		srcs := make([]srcRec, 0, len(in.Sources))
		for _, x := range in.Sources {
			s := srcRec{Who: x.Who, Ref: x.Ref, Unit: x.Unit, Trip: x.Trip, Role: x.Role}
			if x.Who == litRelation {
				s.Object = &objJSON{ModuleKey: in.Record.Module, EntityType: in.Record.Type, EntityID: in.Record.ID}
			}
			srcs = append(srcs, s)
		}
		if err := r.saveSources(ctx, id, srcs); err != nil {
			return err
		}
		chat, err := scanChat(r.tx.QueryRow(ctx, `select `+chatCols+` from chat.chats c where c.id = $1`, id))
		if err != nil {
			return store("record chat", err)
		}
		im, err := r.recompute(ctx, chat)
		if err != nil {
			return err
		}
		if created {
			if _, err := r.service(ctx, chat, chatCard("link", "ok", "Чат создан · "+in.Label, kindOne[KindRecord])); err != nil {
				return err
			}
			if err := r.publish(ctx, "chat.chat.created", "chat.chat", id, map[string]any{litChatID: id, litKind: "record"}); err != nil {
				return err
			}
		}
		if err := r.memberEvents(ctx, id, im.Joined, im.Lose); err != nil {
			return err
		}
		return r.changed(ctx, chat)
	})
	return id, created, err
}

// PostRecordCard puts a service message of a module into the chat of a record (a defect found, a trip given): the button
// of the card is shown by the rights of the reader.
func (s *Service) PostRecordCard(ctx context.Context, tenant uuid.UUID, record ObjectRef, card ServiceCard) error {
	return s.system(ctx, tenant, func(r *req) error {
		chat, err := scanChat(r.tx.QueryRow(ctx, `select `+chatCols+` from chat.chats c where c.kind = 'record' and c.record_ref ->> 'type' = $1
			and c.record_ref ->> 'id' = $2 for update of c`, record.Type, record.ID.String()))
		if noRows(err) {
			return notFound(textChatNotFound)
		}
		if err != nil {
			return store("record chat", err)
		}
		if chat.Status == litArchived {
			return nil
		}
		if _, err := r.service(ctx, chat, card); err != nil {
			return err
		}
		return r.changed(ctx, chat)
	})
}

// CloseRecordChat archives the chat of a record that was closed: it stays readable for the term afterCloseDays.
func (s *Service) CloseRecordChat(ctx context.Context, tenant uuid.UUID, record ObjectRef) error {
	return s.system(ctx, tenant, func(r *req) error {
		var id uuid.UUID
		err := r.tx.QueryRow(ctx, `update chat.chats set status = 'archived', archived_at = $3, revision = revision + 1, updated_at = $3
			where kind = 'record' and record_ref ->> 'type' = $1 and record_ref ->> 'id' = $2 and status = 'active' returning id`,
			record.Type, record.ID.String(), r.now).Scan(&id)
		if noRows(err) {
			return nil
		}
		if err != nil {
			return store("record chat", err)
		}
		if err := r.journal(ctx, id, "Запись закрыта — чат отправлен в архив", nil); err != nil {
			return err
		}
		return r.publish(ctx, "chat.chat.archived", "chat.chat", id, map[string]any{litChatID: id})
	})
}

// Recompute recomputes the roster of a chat from its sources: the consumers of the events of the roster call it
// (a role of the area, a group, a block or dismissal, the foreman of an object, the driver of a trip — chats.md §2.3).
func (s *Service) Recompute(ctx context.Context, tenant, chat uuid.UUID) error {
	return s.system(ctx, tenant, func(r *req) error {
		c, err := scanChat(r.tx.QueryRow(ctx, `select `+chatCols+` from chat.chats c where c.id = $1 for update of c`, chat))
		if noRows(err) {
			return nil
		}
		if err != nil {
			return store(litChat, err)
		}
		im, err := r.recompute(ctx, c)
		if err != nil {
			return err
		}
		if err := r.memberEvents(ctx, c.ID, im.Joined, im.Lose); err != nil {
			return err
		}
		if len(im.Joined)+len(im.Lose) > 0 {
			return r.changed(ctx, c)
		}
		return nil
	})
}

// RecomputeAll recomputes the rosters of the live chats of a tenant; it returns how many chats it went through.
func (s *Service) RecomputeAll(ctx context.Context, tenant uuid.UUID) (int, error) {
	var ids []uuid.UUID
	err := s.run(ctx, tenantctx.TenantContext{TenantID: tenant}, false, func(r *req) error {
		rows, err := r.tx.Query(ctx, `select id from chat.chats where kind <> 'direct' and status = 'active' order by id`)
		if err != nil {
			return store("chats", err)
		}
		defer rows.Close()
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				return store("chats", err)
			}
			ids = append(ids, id)
		}
		return rows.Err()
	})
	if err != nil {
		return 0, err
	}
	for _, id := range ids {
		if err := s.Recompute(ctx, tenant, id); err != nil {
			return 0, err
		}
	}
	return len(ids), nil
}
