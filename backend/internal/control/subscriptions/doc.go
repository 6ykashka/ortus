// Package subscriptions is the subscription of a tenant in the control DB (W1.08, step 1.7, S1-19, AC-11): trial,
// active, grace and read_only of the contract over subscriptions and entitlements of control 0001, the lifecycle
// «trial or paid period ends → grace for 7 days → read_only» (PLAT-05, 02-architecture §11) with tenants.state
// following the subscription, the audited update by an operator and the state shown in /me/context.
//
// Storage (control 0001 has no revision, grace end or cancellation columns — see the brief §10 item 2): one row of
// subscriptions per tenant, state trial | active | grace | ended for trialing | active | grace | read_only, the end
// of the current period in upper(period); every change writes the full set of entitlements under a new version and
// the revision of the subscription is the greatest entitlements.version of the tenant. A tenant without a row has a
// derived trial of TrialDays from tenants.state_changed_at (the provisioner of W1.02 writes no row).
//
// Pilot (D-33): no seats and no plans for owners; past_due, cancelled and cancelAtPeriodEnd are not set.
package subscriptions
