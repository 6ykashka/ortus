// Package realtime is the realtime channel of Ortus (W1.07, S1-15, ADR-0015, PD-58): one WebSocket gateway in
// cmd/api for permission revocation, the inbox and, later, chats.
//
// The channel carries hints, never data: context.changed, notifications.changed, session.ended and ping. A client
// re-reads getMyContext or getMyNotificationSummary through ordinary operations with their authorization, so a lost
// hint loses nothing (a gap in seq or a reconnection means «re-read everything»).
//
// The path of a hint:
//
//	command transaction (tenant DB): BumpPolicy → access.policy_state.policy_version + 1, outbox access.policy.bumped.v1
//	cmd/worker: Relay (people of the tenant → accounts of its memberships) → Notifier: pg_notify('ortus_realtime')
//	cmd/api:    Listener (LISTEN ortus_realtime) → Fanout → PolicyCache.Invalidate + Hub.Deliver → Gateway → socket
//
// The server never relies on the channel to revoke access: PolicyCache, the authz.Source of the evaluator, compares
// policy_version on every check, so new requests are denied right after the transaction; the channel only makes the
// interface follow within 5 seconds.
package realtime
