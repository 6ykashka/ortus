// Package concurrency is the concurrency suite of the logistics of Ortus (W2.30, AC-03…AC-06): races of the
// reservation, the start of a trip, the acceptance of a shift, the decision on a defect and the driver pool, and the
// isolation negatives on real objects of a shift. Every request goes through the whole cmd/api (BFF, the gateway of
// the operation, Idempotency-Key, If-Match, the tenant pools) against the isolation fixtures of W1.04.
//
//	go -C backend test -tags concurrency -count=1 ./test/concurrency/...   # CI step isolation/go-concurrency
//
// Docker is required (testcontainers); without it the suite fails instead of skipping. See README.md.
package concurrency
