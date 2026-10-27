package fixtures

import (
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
)

// The content of the rows «inside one tenant» (W4.82; Q-W4.40-6, forms.md §6, Q-W4.04-11): TenantDef.InTenant with the
// actors and the roles marked InTenant. Load writes it only WithInTenant (the isolation suite): the integration tests of
// the modules load the catalog without content or WithContent and count the people of A (scopeddb) and the bookings of
// their day (sched/calendar) exactly. References resolve always.
//
// Tenant A gets the calendar of Москва-1 and Москва-2 (a room and a booking of the current day each), the trips of both
// firms, the responses of «Осмотр машины» by their author and about those trips, the form of Москва-2 with a response,
// the closed space «Совет директоров» with its page and, in «Регламенты», the node «Только выбранные» read by
// a.manager-msk2 only.

// Reference kinds of the inside content.
const (
	refTrip        = "trip"
	refCalResource = "cal_resource"
	refBooking     = "booking"
	refKBSpace     = "kb_space"
	refKBNode      = "kb_node"
)

// Keys the fixtures of the content name more than once.
const (
	formInsp        = "insp" // the form «Осмотр машины» of tenant A
	actorDriverMsk1 = "a.driver-msk1"
	actorDriverMsk2 = "a.driver-msk2"
)

// TripDef is a planned trip of a unit (fleet.trips) a response of a form is about. Reference trip:<t>.<key>.
type TripDef struct {
	Key, Unit, Number string
}

// CalendarResourceDef is a room of the calendar of a unit (sched.resources). Reference cal_resource:<t>.<key>.
type CalendarResourceDef struct {
	Key, Unit, Label string
}

// BookingDef is a confirmed manual booking of a unit holding the resources (keys of CalendarResources) from «now» +
// bookingFrom for bookingFor — inside the current day of Moscow at the clock of the suite. Reference booking:<t>.<key>.
type BookingDef struct {
	Key, Unit, Title string
	Resources        []string
}

// KnowledgeSpaceDef is a space of the knowledge base (kb.spaces) of the whole organization at a level (LevelOpen,
// LevelLimited, LevelClosed). Reference kb_space:<t>.<key>.
type KnowledgeSpaceDef struct {
	Key, Name, Access string
}

// KnowledgeNodeDef is a top-level page with its first version in a space: a key of KnowledgeSpaces or spaceRules (the
// space of the objects, written WithContent). Listed — own access «Только выбранные» with the Readers (actors, «читает»).
// Reference kb_node:<t>.<key>.
type KnowledgeNodeDef struct {
	Key, Space, Title, Body string
	Listed                  bool
	Readers                 []string
}

// The window of the bookings of the inside content: 13:00–14:00 MSK at the clock of the suite (01.10.2026 10:30 MSK).
const (
	bookingFrom = 150 * time.Minute
	bookingFor  = time.Hour
)

// tripFrom and tripFor are the plan of the trips: tomorrow, four hours.
const (
	tripFrom = 24 * time.Hour
	tripFor  = 4 * time.Hour
)

// insideContent is the inside content of tenant A (W4.82).
func insideContent() Content {
	return Content{
		RepairProjects: repairsInside(), // W6.11 (content_repairs.go)
		Trips:          []TripDef{{Key: uMsk1, Unit: uMsk1, Number: "W482-1"}, {Key: uMsk2, Unit: uMsk2, Number: "W482-2"}},
		CalendarResources: []CalendarResourceDef{
			{Key: "room-msk1", Unit: uMsk1, Label: "Переговорная Москвы-1"},
			{Key: "room-msk2", Unit: uMsk2, Label: "Переговорная Москвы-2"},
		},
		Bookings: []BookingDef{
			{Key: uMsk1, Unit: uMsk1, Title: "Планёрка Москвы-1", Resources: []string{"room-msk1"}},
			{Key: uMsk2, Unit: uMsk2, Title: "Планёрка Москвы-2", Resources: []string{"room-msk2"}},
		},
		Forms: []FormDef{{Key: "msk2-check", Name: "Проверка Москвы-2", Unit: uMsk2}},
		FormResponses: []FormResponseDef{
			{Key: "insp-self", Form: formInsp, Author: "a.forms-self"},
			{Key: "insp-trip-msk1", Form: formInsp, Author: actorDriverMsk1, Trip: uMsk1},
			{Key: "insp-trip-msk2", Form: formInsp, Author: actorDriverMsk2, Trip: uMsk2},
			{Key: "msk2-1", Form: "msk2-check", Author: actorDriverMsk2},
		},
		KnowledgeSpaces: []KnowledgeSpaceDef{{Key: "closed", Name: "Совет директоров", Access: LevelClosed}},
		KnowledgeNodes: []KnowledgeNodeDef{
			{Key: "closed-page", Space: "closed", Title: "Протокол совета W482", Body: "Решения совета директоров."},
			{Key: "listed", Space: spaceRules, Title: "Только выбранные W482", Body: "Порядок для выбранных.", Listed: true,
				Readers: []string{"a.manager-msk2"}},
		},
	}
}

// plus is c with the items of o appended (every field of Content — keep in step with it).
func (c Content) plus(o Content) Content {
	return Content{
		Imports: slices.Concat(c.Imports, o.Imports), Vehicles: slices.Concat(c.Vehicles, o.Vehicles),
		Files: slices.Concat(c.Files, o.Files), Notifications: slices.Concat(c.Notifications, o.Notifications),
		Projects: slices.Concat(c.Projects, o.Projects), Tasks: slices.Concat(c.Tasks, o.Tasks), Rules: slices.Concat(c.Rules, o.Rules),
		KnowledgeRequests: slices.Concat(c.KnowledgeRequests, o.KnowledgeRequests),
		KnowledgeRules:    slices.Concat(c.KnowledgeRules, o.KnowledgeRules),
		FormGroups:        slices.Concat(c.FormGroups, o.FormGroups), Forms: slices.Concat(c.Forms, o.Forms),
		FormRules: slices.Concat(c.FormRules, o.FormRules), FormResponses: slices.Concat(c.FormResponses, o.FormResponses),
		Trips: slices.Concat(c.Trips, o.Trips), CalendarResources: slices.Concat(c.CalendarResources, o.CalendarResources),
		Bookings: slices.Concat(c.Bookings, o.Bookings), KnowledgeSpaces: slices.Concat(c.KnowledgeSpaces, o.KnowledgeSpaces),
		KnowledgeNodes: slices.Concat(c.KnowledgeNodes, o.KnowledgeNodes),
		RepairProjects: slices.Concat(c.RepairProjects, o.RepairProjects),
	}
}

// people are the actors the content names.
func (c Content) people() []string {
	var out []string
	for _, i := range c.Imports {
		for _, r := range i.Rows {
			out = append(out, r.Person)
		}
	}
	for _, n := range c.Notifications {
		out = append(out, n.Recipient)
	}
	for _, x := range c.Tasks {
		out = append(out, x.Assignee, x.Author)
	}
	for _, r := range c.Rules {
		out = append(out, r.Author)
	}
	for _, r := range c.KnowledgeRequests {
		out = append(out, r.Member)
	}
	for _, r := range c.FormResponses {
		out = append(out, r.Author)
	}
	for _, n := range c.KnowledgeNodes {
		out = append(out, n.Readers...)
	}
	for _, p := range c.RepairProjects {
		out = append(out, p.Foreman)
	}
	return slices.DeleteFunc(out, func(s string) bool { return s == "" })
}

// validateEvery checks what Load writes without WithInTenant: no inside role in the grants of an actor written always
// or of a group, no inside actor in the content.
//
//nolint:gocyclo // a list of independent checks of the catalog
func (c Catalog) validateEvery(t TenantDef, fail failFunc) {
	inside := func(role string) bool {
		return slices.ContainsFunc(t.Roles, func(r RoleDef) bool { return r.Key == role && r.InTenant })
	}
	for _, g := range t.Groups {
		for _, gr := range g.Grants {
			if inside(gr.Role) {
				fail("group %s.%s: inside role %q (written only WithInTenant)", t.Key, g.Key, gr.Role)
			}
		}
	}
	for _, a := range c.Actors {
		for _, m := range a.Memberships {
			for _, g := range m.Grants {
				if m.Tenant == t.Key && !a.InTenant && inside(g.Role) {
					fail("actor %s@%s: inside role %q (written only WithInTenant)", a.Key, t.Key, g.Role)
				}
			}
		}
	}
	for _, p := range t.Content.people() {
		if a, ok := c.actor(p); ok && a.InTenant {
			fail("content of %s: inside actor %q (written only WithInTenant)", t.Key, p)
		}
	}
}

// validateInside checks the trips, the calendar and the knowledge spaces and nodes of the content of t.
//
//nolint:gocyclo // a list of independent checks of the catalog
func (c Catalog) validateInside(t TenantDef, fail failFunc) {
	c.validateRepairs(t, fail) // W6.11
	for _, x := range t.Content.Trips {
		if !t.hasUnit(x.Unit) || x.Number == "" {
			fail("trip %s.%s: unknown unit or no number", t.Key, x.Key)
		}
	}
	for _, r := range t.Content.CalendarResources {
		if !t.hasUnit(r.Unit) || r.Label == "" {
			fail("calendar resource %s.%s: unknown unit or no label", t.Key, r.Key)
		}
	}
	for _, b := range t.Content.Bookings {
		if !t.hasUnit(b.Unit) || b.Title == "" || len(b.Resources) == 0 ||
			slices.ContainsFunc(b.Resources, func(k string) bool { return !t.Content.has(refCalResource, k) }) {
			fail("booking %s.%s: unknown unit or resources, or no title", t.Key, b.Key)
		}
	}
	for _, s := range t.Content.KnowledgeSpaces {
		if s.Name == "" || !slices.Contains([]string{LevelOpen, LevelLimited, LevelClosed}, s.Access) {
			fail("kb space %s.%s: no name or level %q", t.Key, s.Key, s.Access)
		}
	}
	for _, n := range t.Content.KnowledgeNodes {
		known := t.Content.has(refKBSpace, n.Space) || (n.Space == spaceRules && t.hasObject(ObjectSpace, spaceRules))
		if !known || n.Title == "" {
			fail("kb node %s.%s: unknown space %q or no title", t.Key, n.Key, n.Space)
		}
		for _, r := range n.Readers {
			if !c.hasRef(memberRef(refPerson, r, t.Key)) {
				fail("kb node %s.%s: reader %q has no membership in tenant %s", t.Key, n.Key, r, t.Key)
			}
		}
	}
	for _, f := range t.Content.Forms {
		if f.Unit != "" && !t.hasUnit(f.Unit) {
			fail("form %s.%s: unknown unit %q", t.Key, f.Key, f.Unit)
		}
	}
	for _, r := range t.Content.FormResponses {
		if r.Trip != "" && !t.Content.has(refTrip, r.Trip) {
			fail("form response %s.%s: unknown trip %q", t.Key, r.Key, r.Trip)
		}
	}
}

// insideSteps are the steps of tenantLoader.load that write the inside content (WithInTenant): the loader of a copy
// whose content is TenantDef.InTenant, after the content of every tenant.
func (l *tenantLoader) insideSteps() []func() error {
	in := *l
	in.t.Content = l.t.InTenant
	return []func() error{in.kbSpaces, in.trips, in.calendar, in.forms, in.repairs}
}

// trips writes planned trips (fleet.trips) without a driver and a vehicle.
func (l *tenantLoader) trips() error {
	for _, x := range l.t.Content.Trips {
		from := l.now.Add(tripFrom)
		if err := l.exec("trip "+x.Key, `insert into fleet.trips (id, number, unit_id, state, planned, created_at)
			values ($1, $2, $3, 'planned', tstzrange($4, $5, '[)'), $6)`,
			l.contentID(refTrip, x.Key), x.Number, l.unitID(x.Unit), from, from.Add(tripFor), l.now.Add(-contentAge)); err != nil {
			return err
		}
	}
	return nil
}

// calendar writes the rooms (sched.resources) and the confirmed bookings (sched.bookings with a confirmed reservation of
// every resource, the bundle of the booking — as the calendar of W4.40 keeps them).
func (l *tenantLoader) calendar() error {
	for _, r := range l.t.Content.CalendarResources {
		if err := l.exec("calendar resource "+r.Key, `insert into sched.resources (id, kind, ref_id, home_unit_id, label, active)
			values ($1, 'room', null, $2, $3, true)`, l.contentID(refCalResource, r.Key), l.unitID(r.Unit), r.Label); err != nil {
			return err
		}
	}
	at, from := l.now.Add(-contentAge), l.now.Add(bookingFrom)
	until := from.Add(bookingFor)
	for _, b := range l.t.Content.Bookings {
		id := l.contentID(refBooking, b.Key)
		if err := l.exec("booking "+b.Key, `insert into sched.bookings (id, org_unit_id, title, source_kind, during, time_zone,
			status, created_by, created_at) values ($1, $2, $3, 'manual', tstzrange($4, $5, '[)'), $6, 'confirmed', $7, $8)`,
			id, l.unitID(b.Unit), b.Title, from, until, zoneMoscow, l.owner, at); err != nil {
			return err
		}
		for _, r := range b.Resources {
			if err := l.exec("reservation "+b.Key+" "+r, `insert into sched.reservations (resource_id, bundle_id, during, occupied,
				state, source_type, source_id, created_by, created_at)
				values ($1, $2, tstzrange($3, $4, '[)'), tstzrange($3, $4, '[)'), 'confirmed', 'sched.booking', $2, $5, $6)`,
				l.contentID(refCalResource, r), id, from, until, l.owner, at); err != nil {
				return err
			}
		}
	}
	return nil
}

// kbSpaces writes the spaces of the content and the top-level pages with their first version and own access; the pages
// of «Регламенты» follow its page of the objects.
func (l *tenantLoader) kbSpaces() error {
	at := l.now.Add(-contentAge)
	for _, s := range l.t.Content.KnowledgeSpaces {
		if err := l.exec("kb space "+s.Key, `insert into kb.spaces (id, name, access, created_by, created_at, updated_at)
			values ($1, $2, $3, $4, $5, $5)`, l.contentID(refKBSpace, s.Key), s.Name, s.Access, l.owner, at); err != nil {
			return err
		}
	}
	for i, n := range l.t.Content.KnowledgeNodes {
		if err := l.kbNode(n, i+1, at); err != nil {
			return err
		}
	}
	return nil
}

func (l *tenantLoader) kbNode(n KnowledgeNodeDef, position int, at time.Time) error {
	space := l.contentID(refKBSpace, n.Space)
	if n.Space == spaceRules {
		space = l.kbObjectID(ObjectSpace, spaceRules)
	}
	mode := "inherit"
	if n.Listed {
		mode = "listed"
	}
	id := l.contentID(refKBNode, n.Key)
	if err := l.exec("kb node "+n.Key, `insert into kb.nodes (id, space_id, position, depth, kind, title, status, access_mode,
		owner_id, created_at, updated_at) values ($1, $2, $3, 1, 'page', $4, 'active', $5, $6, $7, $7)`,
		id, space, position, n.Title, mode, l.owner, at); err != nil {
		return err
	}
	if err := l.exec("kb version "+n.Key, `insert into kb.versions (node_id, version, title, body, published_by, author_name,
		published_at) values ($1, 1, $2, $3, $4, 'Владелец', $5)`, id, n.Title, n.Body, l.owner, at); err != nil {
		return err
	}
	for j, r := range n.Readers {
		if err := l.exec(fmt.Sprintf("kb access %s %d", n.Key, j), `insert into kb.node_access (node_id, position, who, ref_id, can)
			values ($1, $2, 'member', $3, 'view')`, id, j, l.personID(r)); err != nil {
			return err
		}
	}
	return nil
}

// tripRef is the subject of a response about trip key of the content: the id and the label «Рейс <number>».
func (l *tenantLoader) tripRef(key string) (uuid.UUID, string) {
	for _, x := range l.t.Content.Trips {
		if x.Key == key {
			return l.contentID(refTrip, key), "Рейс " + x.Number
		}
	}
	return l.contentID(refTrip, key), "Рейс" // Validate guarantees the trip
}
