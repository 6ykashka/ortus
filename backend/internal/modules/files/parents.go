package files

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

// IDPlaceholder stands for the id of the parent in ParentKind.Rows.
const IDPlaceholder = "{{id}}"

// ParentKind is a kind of object files attach to (UploadCreate.owner): every file is bound to its parent, and
// reading the file requires reading the parent (files.read «плюс доступ к родительскому объекту»).
type ParentKind struct {
	Module     string    // ObjectRef.moduleKey
	Entity     string    // ObjectRef.entityType
	ReadAction string    // the action that makes a parent visible (fleet.trips.read)
	Purposes   []Purpose // purposes that may attach to it
	// Rows selects the scope row of the parent whose id is IDPlaceholder: unit_id, project_id, person_a, person_b
	// (uuid) and title (text); no row when the parent does not exist.
	Rows string
}

// Key is «module.entity».
func (k ParentKind) Key() string { return k.Module + "." + k.Entity }

// Allows reports whether p may attach to this kind.
func (k ParentKind) Allows(p Purpose) bool { return slices.Contains(k.Purposes, p) }

// rows is Rows for the id expression id.
func (k ParentKind) rows(id string) string { return strings.ReplaceAll(k.Rows, IDPlaceholder, id) }

// Parents is the explicit registry of parent kinds (no init()); cmd/api builds it.
type Parents struct {
	kinds map[string]ParentKind
	keys  []string
}

// NewParents checks and registers kinds.
func NewParents(kinds ...ParentKind) (*Parents, error) {
	p := &Parents{kinds: map[string]ParentKind{}}
	for _, k := range kinds {
		switch {
		case !moduleRE.MatchString(k.Module) || !entityRE.MatchString(k.Entity):
			return nil, fmt.Errorf("files: parent %q: bad module or entity", k.Key())
		case k.ReadAction == "" || len(k.Purposes) == 0:
			return nil, fmt.Errorf("files: parent %s: no read action or purposes", k.Key())
		case !strings.Contains(k.Rows, IDPlaceholder):
			return nil, fmt.Errorf("files: parent %s: rows without %s", k.Key(), IDPlaceholder)
		}
		if _, dup := p.kinds[k.Key()]; dup {
			return nil, errors.New("files: parent " + k.Key() + " registered twice")
		}
		p.kinds[k.Key()] = k
		p.keys = append(p.keys, k.Key())
	}
	slices.Sort(p.keys)
	return p, nil
}

// Kind returns the kind of module and entity; a nil registry knows no kind (no file attaches anywhere).
func (p *Parents) Kind(module, entity string) (ParentKind, bool) {
	if p == nil {
		return ParentKind{}, false
	}
	k, ok := p.kinds[module+"."+entity]
	return k, ok
}

// Keys returns the registered keys, sorted.
func (p *Parents) Keys() []string {
	if p == nil {
		return nil
	}
	return slices.Clone(p.keys)
}

// FleetParents are the parents of the pilot (tenant 0002) until the fleet module registers them itself (W2.0x):
// departure photos attach to the reservation, return photos and receipts to the trip (UploadCreate).
func FleetParents() []ParentKind {
	const moduleFleet = "fleet"
	inspection := []Purpose{PurposeInspection}
	return []ParentKind{
		{
			Module: moduleFleet, Entity: "trip", ReadAction: "fleet.trips.read",
			Purposes: []Purpose{PurposeInspection, PurposeExpenseReceipt},
			Rows: `select t.unit_id, null::uuid as project_id, t.driver_person_id as person_a, null::uuid as person_b,
       t.number as title from fleet.trips t where t.id = ` + IDPlaceholder,
		},
		{
			Module: moduleFleet, Entity: "reservation", ReadAction: "fleet.reservations.read", Purposes: inspection,
			Rows: `select s.home_unit_id as unit_id, null::uuid as project_id, r.created_by as person_a,
       null::uuid as person_b, null::text as title
  from sched.reservations r join sched.resources s on s.id = r.resource_id where r.id = ` + IDPlaceholder,
		},
		{
			Module: moduleFleet, Entity: "vehicle", ReadAction: "fleet.vehicles.read", Purposes: inspection,
			Rows: `select v.unit_id, null::uuid as project_id, null::uuid as person_a, null::uuid as person_b,
       v.plate as title from fleet.vehicles v where v.id = ` + IDPlaceholder,
		},
		{
			Module: moduleFleet, Entity: "inspection", ReadAction: "fleet.inspections.read", Purposes: inspection,
			Rows: `select t.unit_id, null::uuid as project_id, t.driver_person_id as person_a, i.submitted_by as person_b,
       t.number as title from fleet.inspections i join fleet.trips t on t.id = i.trip_id where i.id = ` + IDPlaceholder,
		},
		{
			Module: moduleFleet, Entity: "expense", ReadAction: "fleet.expenses.read",
			Purposes: []Purpose{PurposeExpenseReceipt},
			Rows: `select t.unit_id, null::uuid as project_id, e.claimed_by as person_a, t.driver_person_id as person_b,
       t.number as title from fleet.expenses e join fleet.trips t on t.id = e.trip_id where e.id = ` + IDPlaceholder,
		},
	}
}
