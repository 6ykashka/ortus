package pool

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// resourceColumnRe finds a scope column of the kind resource in the authz.Columns of a module.
var resourceColumnRe = regexp.MustCompile(`authz\.KindResource\s*:`)

// resourceColumnOwners are the modules whose objects the scope resource may reach: the vehicle (W2.02, the grant of
// the vehicle of the trip of a transfer, settleVehicle).
var resourceColumnOwners = map[string]bool{filepath.Join("fleet", "vehicles", "vehicles.go"): true}

// TestVehicleGrantOpensOnlyTheVehicle guards the grant of the vehicle of the trip (W2.57, review of return 1): its row
// is the role «Временный водитель» in scope resource on the vehicle, so it carries every action of the role, not only
// TemporaryDriverResourceActions (api/permissions.yaml resource_actions is not enforced by the evaluator). Today only
// the vehicles register a resource column — the row opens the vehicle and nothing else. A module that registers one
// (inspections, files, reservations of a vehicle…) would open its objects of that vehicle to the temporary driver with
// all the actions of the role: this test turns red first — give the vehicle row a role of its own with
// TemporaryDriverResourceActions, then add the module here.
func TestVehicleGrantOpensOnlyTheVehicle(t *testing.T) {
	t.Parallel()
	root := filepath.Join("..", "..")
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return err
		}
		src, err := os.ReadFile(path) //nolint:gosec // G304: a source file of the tree under the test
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, path)
		if resourceColumnRe.Match(src) && !resourceColumnOwners[rel] {
			t.Errorf("%s registers a scope column of the kind resource: the vehicle row of a transfer would open its "+
				"objects with every action of «Временный водитель»", rel)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(TemporaryDriverResourceActions, []string{"fleet.vehicles.read"}) {
		t.Fatalf("resource actions %v", TemporaryDriverResourceActions)
	}
}
