// Package forms is the module «Формы и опросы» (W4.21, WS-60; contract 0.11.0-stage4 of W4.05: the tags Forms and
// PublicForms, tenant 0026 schema forms, control 0009 public_form_links): forms and groups, the draft with its revision
// and the immutable versions it publishes, the settings of acceptance, the responses of employees and guests by the
// structure of their version (AC-09), the review, the summary and CSV, the actions after a response — a task (the
// port of tasks), a row or a record of the knowledge base (the port of the knowledge base), a notification — run once
// per «response × rule», the public links (a token derived by HMAC, the control index) and the guest (AC-08).
//
// The behaviour is the scenario server of W4.05 (frontend/packages/adapter/src/msw/forms) over the domain W4.20 and
// the descriptions of the contract; the texts are the texts of the reference («Формы и опросы.dc.html», api.js) and of
// msw/forms/no-reference.ts.
package forms
