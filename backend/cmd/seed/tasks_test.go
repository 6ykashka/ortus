package main

import (
	"reflect"
	"slices"
	"testing"
	"time"
)

// «Альта» (W4.11): tasksSeed of the domain with normProjects — the demo T-66 with its subtasks T-65 and T-58 leads the
// project LOG, then T-61, T-58, T-63, the leads of the funnel and T-64; the rules ar-1 and ar-2, two runs of ar-1.
func TestTasksSeedOfAlta(t *testing.T) {
	t.Parallel()
	d := tasksSeeds[protoAlta]
	keys := make([]string, 0, len(d.tasks))
	for _, x := range d.tasks {
		keys = append(keys, x.key)
	}
	if want := []string{"T-66", "T-65", "T-61", "T-58", "T-63", "L-31", "L-29", "L-27", "L-24", "L-18", "T-64"}; !slices.Equal(keys, want) {
		t.Fatalf("tasks %v, want %v", keys, want)
	}
	parents := map[string]string{}
	for _, x := range d.tasks {
		if x.parent != "" {
			parents[x.key] = x.parent
		}
	}
	if !reflect.DeepEqual(parents, map[string]string{"T-65": "T-66", "T-58": "T-66"}) {
		t.Fatalf("parents %v", parents)
	}
	type head struct{ key, workflow, owner string }
	got := []head{}
	for _, p := range d.projects {
		got = append(got, head{p.key, p.workflow, p.owner})
	}
	if want := []head{{"LOG", "approval", "m-kotova"}, {"ЗАЯ", "leads", "m-owner"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("projects %+v", got)
	}
	fleet := d.projects[0]
	if want := []seedRule{
		{"ar-1", "Срочная задача → назначить руководителю проекта", "created", "", "urgent", "assign", "m-kotova", "m-kotova", true},
		{"ar-2", "Задача готова → напомнить про путевой лист", "status_entered", "s4", "", "comment",
			"Проверьте, что путевой лист сдан в бухгалтерию", "m-owner", false},
	}; !reflect.DeepEqual(fleet.rules, want) || len(fleet.runs) != 2 {
		t.Fatalf("rules %+v, runs %+v", fleet.rules, fleet.runs)
	}
	if want := []seedFile{{"f-1", "Счёт № 418 от 07.10.pdf", "application/pdf", "m-vasiliev", "10:41", 184320}}; !reflect.DeepEqual(d.tasks[1].files, want) {
		t.Fatalf("T-65 files %+v", d.tasks[1].files)
	}
}

// «Лотос»: «Салон · Тверская» without a workflow of buildWf — v1 of the statuses of its tasks (TP-06), as MSW.
func TestTasksSeedOfLotos(t *testing.T) {
	t.Parallel()
	d := tasksSeeds[protoLotos]
	if len(d.projects) != 1 || d.projects[0].key != "SPA" || d.projects[0].workflow != "initial" || len(d.tasks) != 2 {
		t.Fatalf("lotos %+v", d)
	}
	for _, x := range d.tasks {
		if x.project != "salon" || x.assignee != "m-owner" {
			t.Errorf("task %+v", x)
		}
	}
}

// The dates of the prototype: «ДД.ММ» is the end of the day in Moscow (MSW dueOf), «ЧЧ:ММ» of a comment is of 01.10.
func TestTasksSeedDates(t *testing.T) {
	t.Parallel()
	if got := *dueOf("10.10"); !got.Equal(time.Date(2026, 10, 10, 21, 0, 0, 0, time.UTC)) {
		t.Errorf("due 10.10 = %v", got)
	}
	if dueOf("") != nil {
		t.Error("no due")
	}
	if got := stampOf("09:30"); !got.Equal(time.Date(2026, 10, 1, 6, 30, 0, 0, time.UTC)) {
		t.Errorf("09:30 = %v", got)
	}
	if got := stampOf("27.09 10:12"); !got.Equal(time.Date(2026, 9, 27, 7, 12, 0, 0, time.UTC)) {
		t.Errorf("27.09 10:12 = %v", got)
	}
}
