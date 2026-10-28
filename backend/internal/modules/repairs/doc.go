// Package repairs is the module «Ремонт и стройка» (stage 6, W6.11): objects (RS-08 — the repair object, scope kind
// repair_project) with the draft of a lead (D-17), the foreman and the crew without accounts, the works with the plan
// and the accepted fact, the marks of the foreman and the acceptance of volumes (RS-09 — a return with a reason).
//
// The module answers the operations of steps 6.1–6.3 of the tag Repairs over the tables repairs.* (tenant 0050, 0051,
// 0054): the measurement (versions, recalculation of the draft), the versions of the estimate (a draft from a template,
// a revision before the contract, an additional agreement after it with the change orders of the foreman, sending,
// recall, comparison by the key of the line), the price list, the templates and the code of the signature by SMS (W6.12);
// the later steps (the supply, the schedule, the documents and the finance, the cabinet of the client) are W6.13–W6.15
// and join the same server. ApproveEstimate and SignDocument are what the cabinet of the client (W6.15) calls. Access follows the grants of the member (the organization,
// a unit with its subtree, the object itself, «своё» for the foreman): the office sees every object of its area, the
// foreman only his own that are not drafts; the sums and the phone of the client need repairs.finance.read. Imports
// only the standard library, internal/platform, internal/api and the allowed libraries (depguard).
package repairs
