package tasks

import (
	"testing"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
)

// W4.81 · The place of a status on «Главная» (tasks.md Р-27): «Новые» — the category «К выполнению»; «На проверке» — a
// status of the category «В работе» that is not the first one of this category and has its own transition (not «Из
// любого») into «Готово»; «В работе» — the other statuses of the category; the stages of a funnel after «Новая» are
// neither. first — the first status of «К выполнению» (the badge).
func TestPlace(t *testing.T) {
	t.Parallel()
	custom := workflow{
		Statuses: []tasksapi.TaskWorkflowStatus{
			{Id: "s1", Name: "Новая", Category: tasksapi.Todo},
			{Id: "s2", Name: "Запланирована", Category: tasksapi.Todo},
			{Id: "s3", Name: "В работе", Category: tasksapi.Progress},
			{Id: "s4", Name: "Готово", Category: tasksapi.Done},
		},
		Transitions: []tasksapi.TaskWorkflowTransition{
			tr("t1", "Запланировать", []string{"s1"}, "s2"),
			tr("t2", "Взять в работу", []string{"s1", "s2"}, "s3"),
			tr("t3", "Завершить", []string{"s3"}, "s4"),
		},
	}
	tests := []struct {
		name   string
		wf     workflow
		funnel bool
		id     string
		place  string
		first  bool
	}{
		{"«Простой»: «Новая» — новые, первая", template(tmplSimple), false, "s1", PlaceNew, true},
		{"«Простой»: «В работе» — в работе (переход в «Готово» только «Из любого»)", template(tmplSimple), false, "s2", PlaceProgress, false},
		{"«Простой»: «На проверке» — проверка («Принять»)", template(tmplSimple), false, "s3", PlaceReview, false},
		{"«Простой»: «Готово» — нигде", template(tmplSimple), false, "s4", PlaceNone, false},
		{"«Простой»: «Отменена» — нигде", template(tmplSimple), false, "s5", PlaceNone, false},
		{"«С согласованием»: «На проверке» — проверка («Согласовать»)", template(tmplApproval), false, "s3", PlaceReview, false},
		{"«С согласованием»: «В работе» — в работе", template(tmplApproval), false, "s2", PlaceProgress, false},
		{"v1 по TP-06: переходы «все во все» — «На проверке» в работе", initialWorkflow(nil), false, "s3", PlaceProgress, false},
		{"v1 по TP-06: «Новая» — новые, первая", initialWorkflow(nil), false, "s1", PlaceNew, true},
		{"свой процесс: первая «В работе» со своим переходом в «Готово» — в работе", custom, false, "s3", PlaceProgress, false},
		{"свой процесс: вторая «К выполнению» — новые, не первая", custom, false, "s2", PlaceNew, false},
		{"воронка: «Новая» — новые", funnelWorkflow(), true, "new", PlaceNew, true},
		{"воронка: «Замер» — нигде", funnelWorkflow(), true, "measure", PlaceNone, false},
		{"воронка: «Договор» (переход в «Объект») — нигде", funnelWorkflow(), true, "contract", PlaceNone, false},
		{"воронка: «Объект» — нигде", funnelWorkflow(), true, "object", PlaceNone, false},
		{"неизвестный статус — нигде", template(tmplSimple), false, "s9", PlaceNone, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			place, first := tc.wf.place(tc.id, tc.funnel)
			if place != tc.place || first != tc.first {
				t.Fatalf("place(%s) = %q, %v; want %q, %v", tc.id, place, first, tc.place, tc.first)
			}
		})
	}
}
