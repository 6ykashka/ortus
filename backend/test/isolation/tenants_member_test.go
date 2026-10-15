//go:build isolation

package isolation

import (
	"maps"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/test/isolation/matrix"
)

// refMissingTenant names a tenant that exists in no database: «ab.member with a nonexistent tenantId» (brief W1.02,
// T-13). ab.member belongs to both tenants of the fixtures, so it has no foreign one; row files reference fixtures
// only, so these rows are built here from the endpoints of tenants.yaml.
const refMissingTenant = "tenant:missing"

var missingTenantID = uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:isolation:tenant:missing"))

// withMissingTenant resolves refMissingTenant on top of the suite's resolver.
type withMissingTenant struct{ matrix.Resolver }

func (m withMissingTenant) ID(ref string) (uuid.UUID, error) {
	if ref == refMissingTenant {
		return missingTenantID, nil
	}
	return m.Resolver.ID(ref)
}

// memberWithMissingTenant: for every operation of tenants.yaml, ab.member asks a tenant that does not exist → 404
// before the handler and before any tenant pool, with no id of A or B in the answer (AC-02).
func memberWithMissingTenant() matrix.File {
	f := matrix.File{Module: "tenants"}
	for _, ep := range tenantsMatrix.Endpoints {
		var src *matrix.Row
		for i, r := range ep.Rows {
			if r.Status == 404 && r.Params["tenantId"] != "" {
				src = &ep.Rows[i]
				break
			}
		}
		if src == nil {
			continue
		}
		params := maps.Clone(src.Params)
		params["tenantId"] = refMissingTenant
		row := matrix.Row{
			Actor:  "ab.member",
			Params: params,
			Status: 404,
			Body:   src.Body,
			Absent: []string{"tenant:a", "tenant:b", "membership:ab.member@a", "membership:ab.member@b"},
			Note:   "участник обеих организаций с несуществующим tenantId",
		}
		ep.Rows = []matrix.Row{row}
		f.Endpoints = append(f.Endpoints, ep)
	}
	return f
}

func TestIsolationTenantsMemberMissingTenant(t *testing.T) {
	t.Parallel()
	f := memberWithMissingTenant()
	if len(f.Endpoints) != len(tenantsMatrix.Endpoints) {
		t.Fatalf("rows for %d of %d operations of tenants.yaml", len(f.Endpoints), len(tenantsMatrix.Endpoints))
	}
	s := &matrix.Suite{Refs: withMissingTenant{suite.Refs}, Target: suite.Target, Strict: suite.Strict}
	matrix.Run(t, s, f)
}
