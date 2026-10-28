package service

import "testing"

func TestStatusesAndFlow(t *testing.T) {
	t.Parallel()
	same(t, "statuses", Statuses(), []string{"new", "work", "wait", "resolved", "closed"})
	for st, want := range map[string]StatusInfo{
		"new":      {Label: "Новое", Client: "Получили"},
		"work":     {Label: "В работе", Client: "Отвечаем"},
		"wait":     {Label: "Ждёт клиента", Client: "Ждём вашего ответа"},
		"resolved": {Label: "Решено", Client: "Решено"},
		"closed":   {Label: "Закрыто", Client: "Закрыто"},
	} {
		got := StatusOf(st)
		eq(t, st+" label", got.Label, want.Label)
		eq(t, st+" client", got.Client, want.Client)
	}
	for st, want := range map[string][]string{
		"new": {"work", "wait", "resolved"}, "work": {"wait", "resolved"}, "wait": {"work", "resolved"},
		"resolved": {"work", "closed"}, "closed": nil,
	} {
		same(t, "flow "+st, Flow(st), want)
	}
}

func TestFlowError(t *testing.T) {
	t.Parallel()
	for _, c := range []struct{ from, to, want string }{
		{"new", "work", ""}, {"resolved", "closed", ""},
		{"new", "closed", "Из статуса «Новое» в «Закрыто» перейти нельзя"},
		{"work", "work", "Из статуса «В работе» в «В работе» перейти нельзя"},
		{"closed", "work", "Из статуса «Закрыто» в «В работе» перейти нельзя"},
	} {
		eq(t, c.from+"→"+c.to, FlowError(c.from, c.to), c.want)
	}
}

func TestKindsAndChannels(t *testing.T) {
	t.Parallel()
	same(t, "kinds", Kinds(), []string{"complaint", "claim", "question", "idea", "thanks", "warranty", "cargo"})
	eq(t, "cargo", KindLabel("cargo"), "Повреждение или недостача груза")
	eq(t, "warranty", KindLabel("warranty"), "Гарантийный случай")
	eq(t, "unknown kind", KindLabel("rating"), "")
	same(t, "channels", Channels(), []string{"sms", "bot", "cabinet", "widget", "phone", "qr"})
}

func TestPrioritiesOutcomesCompensations(t *testing.T) {
	t.Parallel()
	for p, want := range map[string]string{"low": "Низкий", "normal": "Средний", "high": "Высокий", "x": ""} {
		eq(t, p, PriorityLabel(p), want)
	}
	same(t, "outcomes", Outcomes(false), []string{"Устранено", "Разъяснено", "Компенсация", "Не подтвердилось", "Дубль"})
	same(t, "outcomes about", Outcomes(true), []string{"Подтвердилась", "Не подтвердилась"})
	same(t, "compensations", Compensations(), []string{"Скидка 20% на следующий визит", "Скидка 10% на следующую работу",
		"Бесплатное повторное посещение", "Возврат денег — через кассу"})
}

func TestCompensationOf(t *testing.T) {
	t.Parallel()
	for kind, want := range map[string]string{"discount20": "Скидка 20% на следующий визит", "discount10": "Скидка 10% на следующую работу",
		"repeat_visit": "Бесплатное повторное посещение", "refund": "Возврат денег — через кассу", "zzz": ""} {
		got, ok := CompensationOf(kind)
		eq(t, kind, got, want)
		eq(t, kind+" known", ok, want != "")
	}
}
