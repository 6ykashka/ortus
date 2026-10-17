// Package home serves «Главная · Требует решения» (W2.09, S2-18): the operation getMyDecisionQueue of the tag Home.
//
// The queue is a registry of sources (plan v2 §3.5): every module registers a Source that returns the cards of
// the situations the member may decide now — its own permission and scope checks (PD-53), structured fields only
// (kind, tone, params; the client composes the texts). A source of an installable module is asked only while the
// module is installed and not disabled (active, read_only, draining); a core source (no module key) always.
// Cards are ordered by tone (danger → warn → info → neutral), then by the registration order of the sources and
// the order of the source, as homeVM of the prototype; total counts the cards before the limit.
//
// The operation is an identity operation (x-scope identity): the tenant comes from the query and must be an active
// membership of the identity, otherwise 404 not_found — its database is not opened.
package home
