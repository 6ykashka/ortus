package repairs

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
)

// Actions of step 6.6 (api/permissions.yaml).
const (
	actCrewAccrue = "repairs.crew.accrue"
	actCrewPay    = "repairs.crew.pay"
	actSubs       = "repairs.subcontractors.manage"
	actClientLink = "repairs.client_link.manage"
)

// States of a crew accrual (repairs.crew_accruals.state) and the kinds of the movements of the money of an object.
const (
	accrualPending  = "pending_act"
	accrualAccrued  = "accrued"
	accrualProposed = "proposed"
	accrualPaid     = "paid"

	moveCodePayment = "payment"
	moveCodeExpense = "expense"
	moveCodeAccrual = "accrual"
)

// defaultCrewSharePct is the share of the sum of an act the crew gets when the service has none of its own (Q-W6.15-1:
// the contract has no rates of the crew).
const defaultCrewSharePct = 40

// maxCabinetPhotos is how many photos of the accepted marks the cabinet of the client shows.
const maxCabinetPhotos = 12

// crewPool is the part of the sum of an act that goes to the crew: pct percent, rounded half up; false — the share
// is not a percentage.
func crewPool(amount int64, pct int) (int64, bool) {
	if pct < 0 || pct > 100 {
		return 0, false
	}
	return (amount*int64(pct) + 50) / 100, true
}

// splitPool divides pool kopecks between the workers by their weights (the accepted marks): the kopecks that do not
// divide go to the first worker with a weight. Nobody has a weight — equal parts. No workers — nil.
func splitPool(pool int64, weights []int) []int64 {
	if len(weights) == 0 {
		return nil
	}
	w := make([]int64, len(weights))
	var all int64
	for i, x := range weights {
		w[i] = int64(x)
		all += w[i]
	}
	if all == 0 {
		for i := range w {
			w[i] = 1
		}
		all = int64(len(w))
	}
	out := make([]int64, len(w))
	var given int64
	first := -1
	for i := range w {
		out[i] = pool * w[i] / all
		given += out[i]
		if first < 0 && w[i] > 0 {
			first = i
		}
	}
	out[first] += pool - given
	return out
}

// newClientToken draws the token of the cabinet of a client: 32 random bytes in base64url without padding. It is shown
// once; the databases keep only its digest.
func newClientToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("repairs: client token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// clientDigest is the stored form of a token (repairs.client_links.token_digest, public_client_links.token_digest).
func clientDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// clientURL is the address the client opens: the public origin of the deployment and the path of the cabinet.
func clientURL(base, token string) string {
	return strings.TrimRight(base, "/") + "/c/" + token
}

// payoutTitle is the title of the proposal to the cash desks.
func payoutTitle(n int, minor int64) string {
	return fmt.Sprintf("Выплата бригаде: %d начисл., %d.%02d ₽", n, minor/100, minor%100)
}
