//go:build integration

package main

// «Обращения» на стенде (W7.31): браузер с cookie → BFF → шлюз (CSRF, право с областью «проект» направления, Idempotency-Key,
// ETag rev-N, 428 и 412) → модуль service → tenant DB «Альты» с сидом 01.10.2026. Владелец видит четыре направления и семь
// открытых обращений, диспетчер ГРЗ (роль «Специалист по обращениям» на проект ГРЗ) — одно направление и два обращения;
// владелец заводит обращение по звонку, снимает исполнителя (assigneeId: null), переводит статус; клиент открывает обращение
// по личной ссылке без сессии.

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/service"
)

// protoID is the id of PD-30 of a prototype entity of «Альта Групп» (cmd/seed seedID).
func protoID(proto string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:t-alta:"+proto))
}

func TestStackService(t *testing.T) { //nolint:paralleltest,gocyclo // one seeded stack; one scenario
	srv := server(t)
	base := "/api/v1/tenants/" + seedAlta.String() + "/service"
	owner := newBrowser(t, srv).login("owner")
	manager := newBrowser(t, srv).login("manager")

	status, _, dirs := owner.fleetCall(http.MethodGet, base+"/directions", "", "", nil)
	if items := asSlice(dirs["items"]); status != http.StatusOK || len(items) != 4 {
		t.Fatalf("listServiceDirections by the owner: %d %v", status, dirs)
	}
	status, _, mine := manager.fleetCall(http.MethodGet, base+"/directions", "", "", nil)
	if items := asSlice(mine["items"]); status != http.StatusOK || len(items) != 1 {
		t.Fatalf("listServiceDirections by the dispatcher: %d %v", status, mine)
	}
	status, _, queue := owner.fleetCall(http.MethodGet, base+"/requests?queue=open", "", "", nil)
	if items := asSlice(queue["items"]); status != http.StatusOK || len(items) < 7 {
		t.Fatalf("the queue of the owner: %d %v", status, queue)
	}
	status, _, theirs := manager.fleetCall(http.MethodGet, base+"/requests?queue=open", "", "", nil)
	if items := asSlice(theirs["items"]); status != http.StatusOK || len(items) != 2 {
		t.Fatalf("the queue of the dispatcher: %d %v", status, theirs)
	}
	if status, _, p := manager.fleetCall(http.MethodGet, base+"/requests/"+protoID("r-40").String(), "", "", nil); status != http.StatusNotFound || p["code"] != "not_found" {
		t.Fatalf("a request of another direction is a missing one: %d %v", status, p)
	}

	// a request by a call: 201, the repeat of the key replays the answer
	body := map[string]any{"directionId": protoID("d-grz"), "typeId": "question", "clientName": "Пётр Новиков", "phone": "8 (903) 123-45-67", "text": "Где мой груз? Жду со вторника"}
	key := "w731-" + uuid.NewString()
	status, h, created := owner.fleetCall(http.MethodPost, base+"/requests", key, "", body)
	if status != http.StatusCreated || h.Get("Idempotency-Replayed") != "false" || created["status"] != "work" || created["channel"] != "phone" {
		t.Fatalf("createServiceRequest: %d %v %v", status, h, created)
	}
	if status, h, again := owner.fleetCall(http.MethodPost, base+"/requests", key, "", body); status != http.StatusCreated || h.Get("Idempotency-Replayed") != "true" || again["id"] != created["id"] {
		t.Fatalf("replay of createServiceRequest: %d %v %v", status, h, again)
	}
	id, _ := created["id"].(string)

	// the status moves by If-Match: missing — 428, stale — 412, the right one — 200 with the next ETag
	move := map[string]any{"to": "wait"}
	if status, _, p := owner.fleetCall(http.MethodPost, base+"/requests/"+id+"/transitions", "w731-"+uuid.NewString(), "", move); status != http.StatusPreconditionRequired || p["code"] != "revision_required" {
		t.Fatalf("a transition without If-Match: %d %v", status, p)
	}
	if status, _, p := owner.fleetCall(http.MethodPost, base+"/requests/"+id+"/transitions", "w731-"+uuid.NewString(), `"rev-9"`, move); status != http.StatusPreconditionFailed || p["code"] != "revision_mismatch" {
		t.Fatalf("a stale transition: %d %v", status, p)
	}
	status, h, waiting := owner.fleetCall(http.MethodPost, base+"/requests/"+id+"/transitions", "w731-"+uuid.NewString(), `"rev-1"`, move)
	if status != http.StatusOK || h.Get("ETag") != `"rev-2"` {
		t.Fatalf("transition: %d %v", status, waiting)
	}
	status, h, got := owner.fleetCall(http.MethodGet, base+"/requests/"+id, "", "", nil)
	if status != http.StatusOK || got["status"] != "wait" || h.Get("ETag") != `"rev-2"` {
		t.Fatalf("getServiceRequest: %d %v %v", status, h, got)
	}

	// the performer is taken off by an explicit null of the body
	assign := map[string]any{"assigneeId": protoID("m-kotelnikova")}
	status, h, assigned := owner.fleetCall(http.MethodPatch, base+"/requests/"+id, "w731-"+uuid.NewString(), h.Get("ETag"), assign)
	if as, _ := assigned["assignee"].(map[string]any); status != http.StatusOK || as["memberId"] != protoID("m-kotelnikova").String() {
		t.Fatalf("assign: %d %v", status, assigned)
	}
	status, _, free := owner.fleetCall(http.MethodPatch, base+"/requests/"+id, "w731-"+uuid.NewString(), h.Get("ETag"), map[string]any{"assigneeId": nil})
	if status != http.StatusOK || free["assignee"] != nil {
		t.Fatalf("unassign by null: %d %v", status, free)
	}

	// the client opens his request by the personal link: no session, no organization in the path, nothing of the staff
	link, err := http.NewRequestWithContext(t.Context(), http.MethodGet, srv.URL+"/api/v1/public/service/requests/"+service.DemoToken(protoID("r-57")), nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(link)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("getPublicServiceRequest: %d", resp.StatusCode)
	}
}
