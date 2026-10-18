//go:build integration

package vehicles

import "github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04

// World is the fixture world TestMain loads, for the external tests of the package (trips_after_move_integration_test.go:
// they plan trips through fleet/routes, which imports this package).
func World() *fixtures.World { return world }
