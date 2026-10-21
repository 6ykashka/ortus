// Package knowledge is the server of the tag Knowledge (W4.31, card WS-62 of plan v2 §4 «Этап 4»): the knowledge base
// of an organization — spaces as access areas, the tree of nodes with inherited access, versions, acknowledgement,
// the access map, access requests, members of spaces, automation (review dates, sections of objects) and the
// projection knowledge/pages kept for the forms core (contract 0.9.0-stage4, W4.04; tenant 0024, schema kb).
//
// The access of a member to a node is the chain of the prototype (knowledge.js 14.10, domain W4.30 kbAccess): the
// organization (blocked, invited) → the owner of the business → the space (a role of the space; a role of the area of
// the space with knowledge.* — all of its verbs in an open space, reading in a limited one, nothing in a closed one;
// a page assignment of an approved request opens its branch) → every parent with its own access («Только выбранные»
// hides the branch from those not listed, «Читают все, правят выбранные» keeps editing to the «правит» entries) → the
// node → the function (a finance node is closed to the function driver whatever the roles). The module computes it on
// a snapshot of the knowledge base of the organization read in the transaction of the request (world): the chain
// depends on lists, terms, functions and the relation «прораб объекта», which a scope predicate cannot express, so
// visibility is filtered in code, as the calendar W4.40 does. Hidden is invisible everywhere: a node or a space the
// member does not see answers 404 like a missing one.
//
// Differences from the prototype are the answers of the product owner of 17.10 (KB-01…KB-08) and the decisions of the
// domain W4.30 (PD-53, PD-60, three roles of a space, six levels); the rest is listed in docs/plan/v2/ws/W4.31.md §10.
package knowledge
