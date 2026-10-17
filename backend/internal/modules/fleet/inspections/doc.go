// Package inspections is the inspection part of the tag Fleet (W2.04, step 2.4 of plan 27; stories S2-04, S2-05,
// S2-17; AC-04): checklists by version, departure and return inspections with five ready photos of their parent
// (W1.09), defects, the queue of blocking defects of the manager and its decision.
//
// A blocking defect on departure sends the trip to defect_review: the inspection requires_review, the defect waits
// in_review in the queue (tenant 0010), the vehicle is noted unavailable, the reservation is kept for the trip, the
// managers of the area and the owner are notified through the inbox port (W1.10). allow_departure returns the trip to
// the departure, confirm_out_of_service keeps the vehicle out of service and the trip goes back to planning.
//
// The contract (0.5.0-stage2) and the schema of tenant 0002 differ in their dictionaries; the mapping is in rules.go
// (photo roles, fuel, status) and the exact values sent by the client are kept in fleet.inspections.answers.
//
// Reads go through scopeddb (the scope predicate of the evaluator); a command authorizes its object with Permit and
// writes in one transaction, the checks of the evaluator reading through that transaction (authz.TxSource).
package inspections
