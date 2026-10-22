//go:build integration

package main

import (
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	formsapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/modules/forms"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W4.21, return 4 (review: the responses of the seed point at trips the seed has not). R-0988 and R-1012 are about the
// past trips Р-171 and Р-196 of the prototype (ids of PD-30, as subjectOf of MSW); fleet.trips of the seed has only
// Р-208 and Р-211. As MSW sees (msw/forms/state.ts: «рейс сида, которого нет, — fleet.trips.read»), a member with
// forms.responses.read somewhere reads a response about a trip that does not exist when he holds fleet.trips.read
// anywhere: Марина Котова («Менеджер логистики» in her unit, the assignee of «Проверить осмотр Р-196») reads both,
// a member with the key in a unit and no right on the trips reads none. Such a trip still has no label: nobody submits
// a new response about it.
func TestSeedResponsesOfPastTrips(t *testing.T) { //nolint:paralleltest // adds a role to the seed of «Альта»
	pools, ev := formsPorts(t)
	objects := formObjects{pools: pools, ev: ev, hidden: tasks.HiddenTasks{Pools: pools, Authz: ev}, trips: newPoolTrips(pools, time.Now)}
	s := &forms.Service{Pools: pools, Objects: objects, Now: time.Now}
	form := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:fm-insp"))
	owner, kotova, morozova := altaMember(t, "m-owner", true), altaMember(t, "m-kotova", false), altaMember(t, "m-morozova", false)
	trip := seedTrip(t)
	grantDemoManager(t, kotova.PersonID, owner.PersonID, trip)

	if got := responseNumbers(t, s, kotova, form); !slices.Contains(got, "R-0988") || !slices.Contains(got, "R-1012") {
		t.Errorf("responses of «Осмотр машины» Марина Котова reads: %v, want R-0988 and R-1012 (trips of the prototype, fleet.trips.read)", got)
	}
	grantRole(t, morozova.PersonID, owner.PersonID, []string{"forms.read", "forms.responses.read"}, &trip)
	if got := responseNumbers(t, s, morozova, form); slices.Contains(got, "R-0988") || slices.Contains(got, "R-1012") {
		t.Errorf("responses a member without fleet.trips.read reads: %v, want neither R-0988 nor R-1012", got)
	}
	past := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:Р-196"))
	if labels, err := objects.Labels(t.Context(), kotova, []formsapi.ObjectRef{tripRef(past)}); err != nil || len(labels) != 0 {
		t.Errorf("Labels of a trip that does not exist: %v %v, want none (a response is not submitted about it)", labels, err)
	}
}

// grantDemoManager gives person the rights of «Менеджер логистики» that read forms, answers, files and trips over the
// unit of trip with its subtree — the assignment «a-kotova-manager» of `seed demo` (the stand of the show), which the
// base seed of the tests has not.
func grantDemoManager(t *testing.T, person, by, trip uuid.UUID) {
	t.Helper()
	grantRole(t, person, by, []string{"forms.read", "forms.responses.read", "forms.responses.review", "files.read", "files.upload",
		"fleet.trips.read"}, &trip)
}

// responseNumbers are the numbers of the responses of form tc reads.
func responseNumbers(t *testing.T, s *forms.Service, tc tenantctx.TenantContext, form uuid.UUID) []string {
	t.Helper()
	page, err := s.Responses(t.Context(), tc, form, nil, new(200))
	if err != nil {
		t.Fatal(err)
	}
	out := make([]string, 0, len(page.Items))
	for _, x := range page.Items {
		out = append(out, x.Number)
	}
	return out
}

// tripRef is the reference of the trip id as a subject of a response.
func tripRef(id uuid.UUID) formsapi.ObjectRef {
	return formsapi.ObjectRef{ModuleKey: moduleFleet, EntityType: refTrip, EntityId: id}
}
