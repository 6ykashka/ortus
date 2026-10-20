//go:build integration

package main

import (
	"encoding/json"
	"io"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// do sends a request of the browser with extra headers and returns the status, the headers and the body.
func (b *browser) do(method, path, body string, hdr map[string]string) (int, http.Header, map[string]any) {
	b.t.Helper()
	req, err := http.NewRequestWithContext(b.t.Context(), method, b.base+path, strings.NewReader(body))
	if err != nil {
		b.t.Fatal(err)
	}
	req.Header.Set("Origin", "http://127.0.0.1:5213")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", b.csrf)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := b.http.Do(req)
	if err != nil {
		b.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, resp.Header, out
}

func itemsOf(body map[string]any, key string) []string {
	var out []string
	items, _ := body["items"].([]any)
	for _, x := range items {
		m, _ := x.(map[string]any)
		s, _ := m[key].(string)
		out = append(out, s)
	}
	return out
}

// W4.40 end to end: the Go seed writes the calendar of «Альта» on the day of its run (cmd/seed/calendar.go), the
// owner reads the resources and the bookings of the day over HTTP.
func TestStackCalendarDay(t *testing.T) { //nolint:paralleltest // one seeded stack
	srv := server(t)
	owner := newBrowser(t, srv).login("owner")
	base := "/api/v1/tenants/" + seedAlta.String() + "/calendar"
	status, _, res := owner.do(http.MethodGet, base+"/resources", "", nil)
	if want := []string{"Анна Морозова · массажист", "Илья Васильев · водитель", "Кабинет № 2", "Кабинет № 3",
		"Стол с подогревом"}; status != http.StatusOK || !slices.Equal(itemsOf(res, "name"), want) {
		t.Fatalf("resources: %d %v, want %v (the vehicles need «Логистика»)", status, itemsOf(res, "name"), want)
	}
	status, _, bookings := owner.do(http.MethodGet, base+"/bookings", "", nil)
	if want := []string{"Классический массаж · Мария К.", "SPA-ритуал · Ольга Р.", "Перерыв", "Массаж спины · Екатерина Л."}; status != http.StatusOK || !slices.Equal(itemsOf(bookings, "title"), want) {
		t.Fatalf("bookings of the day: %d %v, want %v", status, itemsOf(bookings, "title"), want)
	}
}

// The reschedule of «Классический массаж» over HTTP: to 11:00 — the conflict of the prototype (409 with the violations,
// retryable), to 08:00 — the next ETag; a booking is never created in the calendar (501).
func TestStackCalendarReschedule(t *testing.T) { //nolint:paralleltest // one seeded stack; reschedules a booking of t_alta
	owner := newBrowser(t, server(t)).login("owner")
	base := "/api/v1/tenants/" + seedAlta.String() + "/calendar"
	massage := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:b-a1")).String()
	status, hdr, got := owner.do(http.MethodGet, base+"/bookings/"+massage, "", nil)
	if status != http.StatusOK || hdr.Get("ETag") != `"rev-1"` || hdr.Get("Cache-Control") != "private, no-store" {
		t.Fatalf("booking: %d %v %v", status, hdr, got)
	}
	msk := time.FixedZone("MSK", 3*60*60)
	day := time.Now().In(msk)
	at := func(hh int) string {
		return time.Date(day.Year(), day.Month(), day.Day(), hh, 0, 0, 0, msk).UTC().Format(time.RFC3339)
	}
	member, room := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:res-am")), uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:res-room2"))
	patch := func(hh int) string {
		return `{"action": "reschedule", "window": {"startsAt": "` + at(hh) + `", "endsAt": "` + at(hh+1) +
			`", "timeZone": "Europe/Moscow"}, "resources": [{"kind": "member", "resourceId": "` + member.String() +
			`"}, {"kind": "room", "resourceId": "` + room.String() + `"}]}`
	}
	status, _, conflict := owner.do(http.MethodPatch, base+"/bookings/"+massage, patch(11),
		map[string]string{"Idempotency-Key": "w440-stack-conflict-" + uuid.NewString()[:8], "If-Match": `"rev-1"`})
	violations, _ := conflict["violations"].([]any)
	if status != http.StatusConflict || conflict["code"] != "resources_unavailable" || conflict["retryable"] != true ||
		conflict["detail"] != "Конфликт ресурсов: Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»); Кабинет № 2 занят («SPA-ритуал · Ольга Р.»)" ||
		len(violations) != 2 {
		t.Fatalf("conflict: %d %v", status, conflict)
	}
	status, hdr, moved := owner.do(http.MethodPatch, base+"/bookings/"+massage, patch(8),
		map[string]string{"Idempotency-Key": "w440-stack-move-" + uuid.NewString()[:8], "If-Match": `"rev-1"`})
	if status != http.StatusOK || hdr.Get("ETag") != `"rev-2"` || moved["revision"] != float64(2) {
		t.Fatalf("reschedule: %d %v %v", status, hdr, moved)
	}
	status, _, _ = owner.do(http.MethodPost, base+"/bookings", `{}`, map[string]string{"Idempotency-Key": "w440-stack-create"})
	if status != http.StatusNotImplemented {
		t.Fatalf("create: %d, want 501", status)
	}
}
