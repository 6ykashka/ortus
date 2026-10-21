package main

import (
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	knowledgeapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/modules/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
)

// newKnowledge is the server of the tag Knowledge (W4.31, WS-62): spaces as access areas, the tree with inherited
// access, versions, the access map, access requests, the members of spaces and the review dates — over the tenant
// pools, the memberships and owner bindings of the control DB (the status of a member, the owner of the business),
// the inbox (recipients of the control DB, the evaluator of W1.04 as the audience) and the clock of the application
// (APP_FIXED_NOW outside prod). The objects of repairs come with the module of stage 6 (Relations nil, Q-W4.04-1).
func newKnowledge(pools knowledge.Pools, control *pgxpool.Pool, ev *authz.Evaluator, now func() time.Time) knowledgeapi.StrictServerInterface {
	return knowledge.Server{S: &knowledge.Service{
		Pools: pools, Memberships: knowledge.PGMemberships{DB: control}, Recipients: inbox.PGRecipients{Control: control},
		Audience: inbox.AuthzAudience{E: ev}, Now: now,
	}}
}

// registerKnowledge gives the evaluator the places of spaces and pages and what the actions of the knowledge base
// mean to their lists and levels (explainAccess of knowledge objects, W4.01).
func registerKnowledge(ev *authz.Evaluator, pools knowledge.Pools) {
	knowledge.Register(ev, pools, nil)
}
