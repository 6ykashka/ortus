package main

import (
	"context"
	"database/sql"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/knowledge"
)

// writeKnowledge writes the knowledge base of td (W4.31): the migration v2 of the domain W4.30 for «Альта» and
// «Лотос» — spaces, the tree, versions, lists, acknowledgements, the roles of spaces with their assignments, rules,
// runs and tables; the rows already there are kept (a second run changes nothing).
func writeKnowledge(ctx context.Context, tx *sql.Tx, td tenantData) error {
	return writeKnowledgeWith(ctx, func(ctx context.Context, q string, args ...any) error {
		_, err := tx.ExecContext(ctx, q, args...)
		return err
	}, td)
}

// writeKnowledgeWith writes the knowledge base of td through ex, with the ids of PD-30 and the names of the members.
func writeKnowledgeWith(ctx context.Context, ex knowledge.Exec, td tenantData) error {
	id := func(proto string) uuid.UUID { return seedID(td.tenant.proto, proto) }
	name := func(proto string) string {
		m, _ := td.member(proto)
		return m.name
	}
	// The members of spaces (Марина Котова — lead of «Логистика», Вера Котельникова — editor) wait for the examples of
	// getMyContext: the manager of the mock has no roles of spaces, and /me/context of the stand must match it (П-14).
	return knowledge.WriteDemo(ctx, ex, td.tenant.proto, id, name, knowledge.WithoutSpaceMembers())
}
