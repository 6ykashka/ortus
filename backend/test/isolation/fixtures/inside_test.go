package fixtures

import (
	"slices"
	"testing"
)

// W4.82: the content of the rows «inside one tenant» (calendar, forms, knowledge base) — references resolve always,
// the actors and the roles behind them are written only WithInTenant (integration tests of the modules count the people
// of A and the bookings of their day exactly).
func TestCatalogInsideRefs(t *testing.T) {
	t.Parallel()
	c := Default()
	for _, ref := range []string{
		"cal_resource:a.room-msk1", "cal_resource:a.room-msk2", "booking:a.msk1", "booking:a.msk2",
		"trip:a.msk1", "trip:a.msk2",
		"form:a.msk2-check", "form_version:a.msk2-check", "form_response:a.insp-self", "form_response:a.insp-trip-msk1",
		"form_response:a.insp-trip-msk2", "form_response:a.msk2-1",
		"kb_space:a.closed", "kb_node:a.closed-page", "kb_node:a.listed",
		"account:a.calendar-msk1", "person:a.forms-self@a", "person:a.forms-logist@a", "person:a.kb-editor@a",
	} {
		if _, err := c.ID(ref); err != nil {
			t.Errorf("%s: %v", ref, err)
		}
	}
	for _, ref := range []string{"booking:b.msk1", "kb_node:b.listed", "trip:a.missing", "cal_resource:a.msk1"} {
		if _, err := c.ID(ref); err == nil {
			t.Errorf("%s resolves, want an unknown reference", ref)
		}
	}
}

// The inside actors are marked: Load writes them (and their roles) only WithInTenant; an actor written always holds no
// inside role, and the content written always names no inside actor (Validate).
func TestCatalogInsideActorsAreMarked(t *testing.T) {
	t.Parallel()
	c := Default()
	for _, key := range []string{"a.calendar-msk1", "a.forms-self", "a.forms-logist", "a.kb-editor"} {
		if a := c.mustActor(t, key); !a.InTenant {
			t.Errorf("%s is written always, want only WithInTenant", key)
		}
	}
	for _, key := range []string{"a.owner", "a.manager-msk1", "a.manager-msk2", "ab.member", "p.operator"} {
		if c.mustActor(t, key).InTenant {
			t.Errorf("%s is an inside actor, want an actor of every load", key)
		}
	}
	bad := Default()
	i := slices.IndexFunc(bad.Actors, func(a ActorDef) bool { return a.Key == "a.manager-msk1" })
	bad.Actors[i].Memberships[0].Grants = append(bad.Actors[i].Memberships[0].Grants, GrantDef{Role: roleCalendar, Scope: uMsk1})
	if err := bad.Validate(); err == nil {
		t.Error("an actor of every load with an inside role must be rejected")
	}
	bad = Default()
	bad.Tenants[0].Content.FormResponses = append(bad.Tenants[0].Content.FormResponses,
		FormResponseDef{Key: "by-inside", Form: "insp", Author: "a.forms-self"})
	if err := bad.Validate(); err == nil {
		t.Error("the content of every load naming an inside actor must be rejected")
	}
}

// The inside content of A: the calendar of Москва-1 and Москва-2, the responses of «Осмотр машины» by their author and
// about the trips of both firms, the form of Москва-2, the closed space and the node «Только выбранные».
//
//nolint:gocyclo // one table of checks of the inside content
func TestCatalogInsideContent(t *testing.T) {
	t.Parallel()
	a := Default().Tenants[0].InTenant
	units := map[string]string{}
	for _, b := range a.Bookings {
		units[b.Key] = b.Unit
	}
	if units["msk1"] != uMsk1 || units["msk2"] != uMsk2 {
		t.Errorf("bookings = %v, want msk1 → Москва-1, msk2 → Москва-2", units)
	}
	trips := map[string]string{}
	for _, r := range a.FormResponses {
		trips[r.Key] = r.Trip
	}
	if trips["insp-trip-msk1"] != "msk1" || trips["insp-trip-msk2"] != "msk2" || trips["insp-self"] != "" {
		t.Errorf("subjects of the responses = %v", trips)
	}
	if i := slices.IndexFunc(a.Forms, func(f FormDef) bool { return f.Key == "msk2-check" }); i < 0 || a.Forms[i].Unit != uMsk2 {
		t.Error("form:a.msk2-check is not a form of Москва-2")
	}
	if i := slices.IndexFunc(a.KnowledgeSpaces, func(s KnowledgeSpaceDef) bool { return s.Key == "closed" }); i < 0 ||
		a.KnowledgeSpaces[i].Access != LevelClosed {
		t.Error("kb_space:a.closed is not a closed space")
	}
	i := slices.IndexFunc(a.KnowledgeNodes, func(n KnowledgeNodeDef) bool { return n.Key == "listed" })
	if i < 0 || !a.KnowledgeNodes[i].Listed || a.KnowledgeNodes[i].Space != spaceRules ||
		!slices.Equal(a.KnowledgeNodes[i].Readers, []string{"a.manager-msk2"}) {
		t.Error("kb_node:a.listed is not a node «Только выбранные» of «Регламенты» read by a.manager-msk2")
	}
}
