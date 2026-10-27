// Package docs is the server of the tags Docs and PublicDocs (W7.23, card WS of plan v2 §4 «Этап 7»): the documents of an
// organization — folders with inherited access, text, sheet and PDF documents, versions, comments, external links, the
// adapter of the document server (D-32, ADR-0016), the jobs of the worker (recognition, compression, merge, conversion,
// PDF/A) over the schema docs (tenant 0061, control 0011).
//
// The access of a member to a document is the chain of the prototype (documents.js 19.10, docAccess): the organization
// (blocked, invited) → the function «Водитель» on finance → the owner of the business → every folder of the path (the
// role of the area on the top folder, the assignments of folder roles, the access list; «Только выбранные» breaks what
// the levels above gave) → the document (its mode, assignments and list) → the owner of the document → the temporary
// accesses of a route. The module computes it on a snapshot of the documents of the organization read in the
// transaction of the request (world): the chain depends on lists, terms, groups and relations a scope predicate cannot
// express. A document the member does not open answers 404 like a missing one; the finance document of the function
// «Водитель» — 403 function_blocked.
//
// The editor is a document server behind the Engine port (ONLYOFFICE protocol: Р7-Офис and ONLYOFFICE): the module
// signs the configuration of a session (HS256 JWT of a shared secret) and takes the saved file from the callback as the
// next version; the contract has no operation of block editing. Without a server the document opens for viewing.
// The route, the signature and the acknowledgement are W7.24; the module reads a route and its decisions.
package docs
