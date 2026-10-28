package service

import "slices"

// Statuses of a request (SVC_ST of service.js 19.10:66–73), channels, kinds and priorities.
const (
	StatusNew      = "new"
	StatusWork     = "work"
	StatusWait     = "wait"
	StatusResolved = "resolved"
	StatusClosed   = "closed"

	PriorityLow    = "low"
	PriorityNormal = "normal"
	PriorityHigh   = "high"

	KindComplaint = "complaint"
	KindClaim     = "claim"
	KindQuestion  = "question"
	KindIdea      = "idea"
	KindThanks    = "thanks"
	KindWarranty  = "warranty"
	KindCargo     = "cargo"

	ChannelSMS     = "sms"
	ChannelBot     = "bot"
	ChannelCabinet = "cabinet"
	ChannelWidget  = "widget"
	ChannelPhone   = "phone"
	ChannelQR      = "qr"
)

// Delivery states of a message of the staff (service.messages.delivery).
const (
	DeliveryQueued = "queued"
	DeliverySent   = "sent"
	DeliveryFailed = "failed"
)

// StatusInfo is the card of a status: the label of the staff and of the client.
type StatusInfo struct{ Label, Client, Tone, Icon string }

var statusOrder = []string{StatusNew, StatusWork, StatusWait, StatusResolved, StatusClosed}

var statusInfo = map[string]StatusInfo{
	StatusNew:      {"Новое", "Получили", "info", "radio_button_unchecked"},
	StatusWork:     {"В работе", "Отвечаем", "neutral", "pending"},
	StatusWait:     {"Ждёт клиента", "Ждём вашего ответа", "warn", "hourglass_top"},
	StatusResolved: {"Решено", "Решено", "ok", "check_circle"},
	StatusClosed:   {"Закрыто", "Закрыто", "neutral", "lock"},
}

var flow = map[string][]string{
	StatusNew:      {StatusWork, StatusWait, StatusResolved},
	StatusWork:     {StatusWait, StatusResolved},
	StatusWait:     {StatusWork, StatusResolved},
	StatusResolved: {StatusWork, StatusClosed},
}

// Statuses are the five statuses in the order of the prototype.
func Statuses() []string { return slices.Clone(statusOrder) }

// StatusOf is the card of a status; an unknown one is the zero card.
func StatusOf(s string) StatusInfo { return statusInfo[s] }

// KnownStatus reports whether s is a status.
func KnownStatus(s string) bool { _, ok := statusInfo[s]; return ok }

// Flow is SVC_FLOW: the statuses reachable from s (nil for closed and unknown).
func Flow(s string) []string { return slices.Clone(flow[s]) }

// FlowError is the text of a refused transition (svcTransition of the prototype) or "".
func FlowError(from, to string) string {
	if slices.Contains(flow[from], to) {
		return ""
	}
	return "Из статуса «" + statusInfo[from].Label + "» в «" + statusInfo[to].Label + "» перейти нельзя"
}

// labelIdea is the label of the kind and of the type «Предложение».
const labelIdea = "Предложение"

var kindLabels = []struct{ key, label string }{
	{KindComplaint, "Жалоба"}, {KindClaim, "Претензия"}, {KindQuestion, "Вопрос"}, {KindIdea, labelIdea},
	{KindThanks, "Благодарность"}, {KindWarranty, "Гарантийный случай"}, {KindCargo, "Повреждение или недостача груза"},
}

// Kinds are the kinds of a request (SVC_KIND); a rating or NPS is not a kind.
func Kinds() []string {
	out := make([]string, 0, len(kindLabels))
	for _, k := range kindLabels {
		out = append(out, k.key)
	}
	return out
}

// KindLabel is the label of a kind ("" for an unknown one).
func KindLabel(kind string) string {
	for _, k := range kindLabels {
		if k.key == kind {
			return k.label
		}
	}
	return ""
}

// Channels are the channels of a request (SVC_CH).
func Channels() []string {
	return []string{ChannelSMS, ChannelBot, ChannelCabinet, ChannelWidget, ChannelPhone, ChannelQR}
}

// PriorityLabel is the label of a priority ("" for an unknown one).
func PriorityLabel(p string) string {
	switch p {
	case PriorityLow:
		return "Низкий"
	case PriorityNormal:
		return "Средний"
	case PriorityHigh:
		return "Высокий"
	}
	return ""
}

// Outcomes are the outcomes of a resolution; a complaint about an employee has only two (OUTCOMES_ABOUT).
func Outcomes(about bool) []string {
	if about {
		return []string{"Подтвердилась", "Не подтвердилась"}
	}
	return []string{"Устранено", "Разъяснено", "Компенсация", "Не подтвердилось", "Дубль"}
}

// OutcomeConfirmed is the outcome that counts a complaint to the employee (FB-05).
const OutcomeConfirmed = "Подтвердилась"

// OutcomeThanks is the outcome of the thanks that go to the employee by themselves (Q-W4.00-service-18).
const OutcomeThanks = "Передано мастеру"

var compensations = []struct{ kind, label string }{
	{"discount20", "Скидка 20% на следующий визит"}, {"discount10", "Скидка 10% на следующую работу"},
	{"repeat_visit", "Бесплатное повторное посещение"}, {"refund", "Возврат денег — через кассу"},
}

// Compensations are the compensations of the prototype (COMPENSATIONS).
func Compensations() []string {
	out := make([]string, 0, len(compensations))
	for _, c := range compensations {
		out = append(out, c.label)
	}
	return out
}

// CompensationOf is the label of a compensation kind of the contract (ServiceCompensationSet.kind).
func CompensationOf(kind string) (string, bool) {
	for _, c := range compensations {
		if c.kind == kind {
			return c.label, true
		}
	}
	return "", false
}

// RefundCompensation is the compensation that is a proposal to the cash.
const RefundCompensation = "Возврат денег — через кассу"
