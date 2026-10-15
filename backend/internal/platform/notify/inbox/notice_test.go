package inbox

import (
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func validNotice() Notice {
	return Notice{Kind: "members.invitation.accepted", Title: "Приглашение принято"}
}

// Уведомление проверяется по контракту (Notification) и CHECK tenant 0003 до записи: ошибка производителя —
// ErrInvalid, а не нарушение ограничения базы.
func TestNoticeValidate(t *testing.T) {
	t.Parallel()
	unit := uuid.New()
	for _, c := range []struct {
		name string
		edit func(n *Notice)
		ok   bool
	}{
		{"минимальное", func(*Notice) {}, true},
		{"все поля", func(n *Notice) {
			n.Kind, n.Severity, n.Body, n.Link = "fleet.trip.submitted", SeverityWarning, "Рейс R-102 сдан", "/fleet/trips/R-102"
			n.Object = &Object{ModuleKey: "fleet", EntityType: "trip", EntityID: uuid.New()}
			n.Unit, n.Permission, n.Sensitivity = unit, "fleet.trips.review", SensitivityNormal
		}, true},
		{"начисление с правом", func(n *Notice) {
			n.Permission, n.Sensitivity, n.Unit = "fleet.earnings.read", SensitivityRestricted, unit
		}, true},
		{"kind без точки", func(n *Notice) { n.Kind = "invitation" }, false},
		{"kind с версией", func(n *Notice) { n.Kind = "fleet.trip.submitted.v1" }, false},
		{"kind с заглавной", func(n *Notice) { n.Kind = "Fleet.trip" }, false},
		{"пустой заголовок", func(n *Notice) { n.Title = "" }, false},
		{"заголовок 300 символов", func(n *Notice) { n.Title = strings.Repeat("я", 300) }, true},
		{"заголовок 301 символ", func(n *Notice) { n.Title = strings.Repeat("я", 301) }, false},
		{"текст 2001 символ", func(n *Notice) { n.Body = strings.Repeat("ж", 2001) }, false},
		{"неизвестная важность", func(n *Notice) { n.Severity = "urgent" }, false},
		{"неизвестная чувствительность", func(n *Notice) { n.Sensitivity, n.Permission = "secret", "fleet.earnings.read" }, false},
		{"подразделение без права", func(n *Notice) { n.Unit = unit }, false},
		{"чувствительное без права", func(n *Notice) { n.Sensitivity = SensitivitySensitive }, false},
		{"объект без id", func(n *Notice) { n.Object = &Object{ModuleKey: "fleet", EntityType: "trip"} }, false},
		{"объект без модуля", func(n *Notice) { n.Object = &Object{EntityType: "trip", EntityID: uuid.New()} }, false},
		{"ссылка на другой сайт", func(n *Notice) { n.Link = "//evil.example/x" }, false},
		{"абсолютная ссылка", func(n *Notice) { n.Link = "https://evil.example/" }, false},
		{"ссылка с обратной косой", func(n *Notice) { n.Link = `/\evil.example` }, false},
		{"ссылка с пробелом", func(n *Notice) { n.Link = "/a b" }, false},
		{"ссылка с неразрывным пробелом", func(n *Notice) { n.Link = "/a b" }, false},
		{"ссылка с управляющим символом", func(n *Notice) { n.Link = "/a\tb" }, false},
		{"корень", func(n *Notice) { n.Link = "/" }, true},
		{"ссылка длиннее 512", func(n *Notice) { n.Link = "/" + strings.Repeat("a", 512) }, false},
	} {
		n := validNotice()
		c.edit(&n)
		err := n.Validate()
		if c.ok && err != nil {
			t.Errorf("%s: %v", c.name, err)
		}
		if !c.ok && !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: %v, want ErrInvalid", c.name, err)
		}
	}
}

// Значения по умолчанию: важность info, чувствительность normal; правило выдачи берётся из уведомления.
func TestNoticeDefaultsAndRule(t *testing.T) {
	t.Parallel()
	n, err := validNotice().normalized()
	if err != nil || n.Severity != SeverityInfo || n.Sensitivity != SensitivityNormal {
		t.Fatalf("normalized = %+v, %v", n, err)
	}
	unit := uuid.New()
	n.Permission, n.Unit = "fleet.trips.read", unit
	if r := n.rule(); r != (Rule{Permission: "fleet.trips.read", Unit: unit, Sensitivity: SensitivityNormal}) {
		t.Fatalf("rule = %+v", r)
	}
}

// Тип события outbox без версии — вид уведомления (Notification.kind).
func TestKindOf(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]string{
		"fleet.trip.submitted.v1":         "fleet.trip.submitted",
		"members.invitation.accepted.v12": "members.invitation.accepted",
		"fleet.trip.submitted":            "fleet.trip.submitted",
	} {
		if got := KindOf(in); got != want {
			t.Errorf("KindOf(%q) = %q, want %q", in, got, want)
		}
	}
}
