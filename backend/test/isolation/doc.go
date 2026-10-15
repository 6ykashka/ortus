// Package isolation is the isolation suite of Ortus (design/docs/15-quality-security.md «Isolation suite»):
// every endpoint adds rows to <module>.yaml, isogen turns them into <module>_test.go, and the suite runs them
// against the API on the fixtures of package fixtures. The suite blocks merge (CI job isolation).
//
//	corepack pnpm run test:isolation                         # = go -C backend test -tags isolation -count=1 ./test/isolation/...
//	go -C backend generate ./test/isolation                  # after editing a YAML file
//	go -C backend test -tags "isolation isolation_pending" ./test/isolation/...   # pending rows red until their handler
//
// The format and the workflow are described in README.md.
package isolation

//go:generate go run ./cmd/isogen -dir .
