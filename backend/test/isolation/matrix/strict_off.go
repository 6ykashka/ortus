//go:build !isolation_pending

package matrix

// strictPending: pending rows accept 501 or their own expectations (default, Suite.checkPending). Build with
// -tags isolation_pending to check their real expectations only.
const strictPending = false
