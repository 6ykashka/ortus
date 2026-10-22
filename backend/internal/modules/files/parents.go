package files

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

// IDPlaceholder stands for the id of the parent in ParentKind.Rows.
const IDPlaceholder = "{{id}}"

// HiddenPlaceholder stands in ParentKind.Rows for the ids the Hider of the service closes to the subject (uuid[]; an
// empty array without a Hider): a kind compares its own column with them and has no row for such a parent — its files
// answer 404 and take no upload, whatever the grants of the subject say (W2.57: the trips of the pool transfers of a
// temporary driver outside his grant, AC-06).
const HiddenPlaceholder = "{{hidden}}"

// ContinuedPlaceholder stands in ParentKind.Rows for the ids the Hider leaves to the subject only to finish a started
// work (uuid[]; an empty array without a Hider): a kind of new work on such an id compares with them and has no row —
// W2.57, D09: the reservation of a trip in its continuation (a departure photo is new work, as startTrip is).
const ContinuedPlaceholder = "{{continued}}"

// FilePlaceholder stands in ParentKind.Rows and Share.Rows for the id of the file (uuid) read through the parent
// IDPlaceholder — in getFile, getFileDownload and listFiles the id of that file in both, never a stand-in; null in
// ParentKind.Rows while a file is uploaded (there is none yet; an upload checks the parent only, not its shares).
// A kind whose files are not all open to those who read the parent compares it with HiddenPlaceholder, and the Hider
// names those files by their ids — W4.21: the files of the answers of a form are read by their uploader and by those
// who read the answers, not by everyone who sees the form (Q-W4.00-forms-9). W2.79: a share selects its row by the file.
const FilePlaceholder = "{{file}}"

// ParentKind is a kind of object files attach to (UploadCreate.owner): every file is bound to its parent, and
// reading the file requires reading the parent (files.read «плюс доступ к родительскому объекту»).
type ParentKind struct {
	Module     string    // ObjectRef.moduleKey
	Entity     string    // ObjectRef.entityType
	ReadAction string    // the action that makes a parent visible (fleet.trips.read)
	Purposes   []Purpose // purposes that may attach to it
	// Rows selects the scope row of the parent whose id is IDPlaceholder: unit_id, project_id, person_a, person_b
	// (uuid) and title (text); no row when the parent does not exist or is closed (HiddenPlaceholder,
	// ContinuedPlaceholder and FilePlaceholder, optional). In listFiles it is a lateral subquery next to files.objects f
	// and files.upload_sessions s: its own tables take other aliases.
	Rows string
	// Shares open some files of a parent to readers who do not read the parent itself (getFile, getFileDownload,
	// listFiles; an upload checks the parent only).
	Shares []Share
}

// Share is a further scope of the files of a parent kind: a file is visible to the subject when ReadAction and
// files.read cover the scope row the share selects for it (W2.79: the company of the usual vehicle of a temporary
// driver reads the inspection photos of that vehicle attached to the trip of another company).
type Share struct {
	ReadAction string
	// Rows selects the scope row, as ParentKind.Rows, of the file FilePlaceholder of the parent IDPlaceholder; no
	// row — the share does not open the file.
	Rows string
}

// Key is «module.entity».
func (k ParentKind) Key() string { return k.Module + "." + k.Entity }

// Allows reports whether p may attach to this kind.
func (k ParentKind) Allows(p Purpose) bool { return slices.Contains(k.Purposes, p) }

// scope is a statement of scope rows (ParentKind.Rows, Share.Rows) with the action that reads its rows.
type scope struct{ read, rows string }

// own is the scope of the parent itself.
func (k ParentKind) own() scope { return scope{read: k.ReadAction, rows: k.Rows} }

// shares are the scopes of the shares of the kind.
func (k ParentKind) shares() []scope {
	out := make([]scope, 0, len(k.Shares))
	for _, s := range k.Shares {
		out = append(out, scope{read: s.ReadAction, rows: s.Rows})
	}
	return out
}

// scopes are the scope of the parent and the scopes of its shares, in this order.
func (k ParentKind) scopes() []scope { return append([]scope{k.own()}, k.shares()...) }

// uses reports whether the rows compare with placeholder (HiddenPlaceholder, ContinuedPlaceholder, FilePlaceholder).
func (s scope) uses(placeholder string) bool { return strings.Contains(s.rows, placeholder) }

// hides reports whether the rows leave out ids the Hider closes.
func (s scope) hides() bool { return s.uses(HiddenPlaceholder) || s.uses(ContinuedPlaceholder) }

// expand is the rows for the expressions of the id of the parent, of the id of the file, and the uuid[] expressions
// hidden and continued of the closed ids.
func (s scope) expand(id, file, hidden, continued string) string {
	return strings.NewReplacer(IDPlaceholder, id, FilePlaceholder, file, HiddenPlaceholder, hidden,
		ContinuedPlaceholder, continued).Replace(s.rows)
}

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
		for i, s := range k.Shares {
			if s.ReadAction == "" || !strings.Contains(s.Rows, IDPlaceholder) || !strings.Contains(s.Rows, FilePlaceholder) {
				return nil, fmt.Errorf("files: parent %s: share %d without a read action, %s or %s", k.Key(), i,
					IDPlaceholder, FilePlaceholder)
			}
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
// departure photos attach to the reservation, return photos and receipts to the trip (UploadCreate). The parents of a
// trip — the trip, its reservation, its inspection, its expense — leave out the trips the Hider closes (W2.57, AC-06:
// the pool closes the trip of a transfer to its driver before and after his grant); the reservation also leaves out
// the trips in their continuation (D09: the return, its photos and the receipts of the trip stay, a departure photo
// is new work). A vehicle is not of a trip. The trip shares the photos of the inspections of the usual vehicle of its
// temporary driver with the company of that vehicle (usualVehiclePhotosSQL).
func FleetParents() []ParentKind {
	const moduleFleet = "fleet"
	inspection := []Purpose{PurposeInspection}
	return []ParentKind{
		{
			Module: moduleFleet, Entity: "trip", ReadAction: "fleet.trips.read",
			Purposes: []Purpose{PurposeInspection, PurposeExpenseReceipt},
			Rows: `select t.unit_id, null::uuid as project_id, t.driver_person_id as person_a, null::uuid as person_b,
       t.number as title from fleet.trips t where t.id = ` + IDPlaceholder + openTrip,
			Shares: []Share{{ReadAction: "fleet.inspections.read", Rows: usualVehiclePhotosSQL}},
		},
		{
			Module: moduleFleet, Entity: "reservation", ReadAction: "fleet.reservations.read", Purposes: inspection,
			Rows: `select s.home_unit_id as unit_id, null::uuid as project_id, r.created_by as person_a,
       null::uuid as person_b, null::text as title
  from sched.reservations r join sched.resources s on s.id = r.resource_id where r.id = ` + IDPlaceholder + `
   and not (r.source_type = 'fleet.trip' and (r.source_id = any(` + HiddenPlaceholder + `)
        or r.source_id = any(` + ContinuedPlaceholder + `)))`,
		},
		{
			Module: moduleFleet, Entity: "vehicle", ReadAction: "fleet.vehicles.read", Purposes: inspection,
			Rows: `select v.unit_id, null::uuid as project_id, null::uuid as person_a, null::uuid as person_b,
       v.plate as title from fleet.vehicles v where v.id = ` + IDPlaceholder,
		},
		{
			Module: moduleFleet, Entity: "inspection", ReadAction: "fleet.inspections.read", Purposes: inspection,
			Rows: `select t.unit_id, null::uuid as project_id, t.driver_person_id as person_a, i.submitted_by as person_b,
       t.number as title from fleet.inspections i join fleet.trips t on t.id = i.trip_id where i.id = ` + IDPlaceholder + openTrip,
		},
		{
			Module: moduleFleet, Entity: "expense", ReadAction: "fleet.expenses.read",
			Purposes: []Purpose{PurposeExpenseReceipt},
			Rows: `select t.unit_id, null::uuid as project_id, e.claimed_by as person_a, t.driver_person_id as person_b,
       t.number as title from fleet.expenses e join fleet.trips t on t.id = e.trip_id where e.id = ` + IDPlaceholder + openTrip,
		},
	}
}

// openTrip leaves out the trips the Hider closes (t — the trip).
const openTrip = " and t.id <> all(" + HiddenPlaceholder + ")"

// usualVehiclePhotosSQL shares the files of a trip that are photos of its submitted inspections — a photo of a role
// (fleet.inspection_photos) or of a damage (answers.photos) — of the usual vehicle of its temporary driver approved
// with the request of the pool for the trip, with the company of that vehicle: fleet.inspections.read over the unit
// of the vehicle (W2.79, Q-W2.72-2; S2-20 rule 6 «Осмотры и дефекты обычной машины видит её фирма», DoR s2-20 §6:
// «осмотры своей машины по рейсу перевода — 200; осмотры других машин фирмы рейса — 404»). The condition of the usual
// vehicle is visibleSQL of the inspections (W2.72). The other files of the trip, its other vehicles and the trips
// without an approved usual vehicle share nothing; the trips the Hider closes are closed here too.
const usualVehiclePhotosSQL = `select v.unit_id, null::uuid as project_id, null::uuid as person_a, null::uuid as person_b,
       t.number as title
  from fleet.trips t
  join fleet.inspections i on i.trip_id = t.id
  join fleet.vehicles v on v.id = i.vehicle_id
 where t.id = ` + IDPlaceholder + openTrip + `
   and exists (select 1 from fleet.driver_transfers x where x.trip_id = t.id and x.home_vehicle_id = i.vehicle_id
                and x.vehicle_decision = 'approved')
   and (exists (select 1 from fleet.inspection_photos ph where ph.inspection_id = i.id
                 and ph.file_id = (` + FilePlaceholder + `)::uuid)
        or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(i.answers->'photos') = 'array'
                                                          then i.answers->'photos' else '[]'::jsonb end) a
                    where a->>'fileId' = (` + FilePlaceholder + `)::uuid::text))
 limit 1`
