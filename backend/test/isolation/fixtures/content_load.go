package fixtures

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"mime"
	"slices"
	"time"

	"github.com/google/uuid"
)

// Option changes what Load writes.
type Option func(*options)

type options struct{ content, inTenant bool }

// WithContent makes Load write the content of the tenants too (TenantDef.Content: imports, vehicles with files,
// notifications). The isolation suite needs it for its positive rows (W1.44). Integration tests of the modules seed
// their own objects and count them, so they load the catalog without it.
func WithContent() Option { return func(o *options) { o.content = true } }

// WithInTenant makes Load write, on top of the content (it implies WithContent), the inside actors and roles
// (ActorDef.InTenant, RoleDef.InTenant) and the inside content (TenantDef.InTenant) of the rows inside one tenant (W4.82,
// content_inside.go). Only the isolation suite loads it: the integration tests of the modules that load WithContent
// (tasks, sched/calendar) count the people and the bookings of A exactly.
func WithInTenant() Option { return func(o *options) { o.content, o.inTenant = true, true } }

// Times of the content relative to the «now» of Load: an import is a preview of a day (people.imports.expires_at),
// files and notifications were made before «now».
const (
	contentAge = time.Hour
	previewFor = 24 * time.Hour
)

// contentSteps are the steps of tenantLoader.load that write the content.
func (l *tenantLoader) contentSteps() []func() error {
	// tasks — W4.11 (content_tasks.go), knowledge — W4.31, forms — W4.21 (content_forms.go); the kinds of W4.82
	// (content_inside.go) before the forms: a response is about a trip.
	return []func() error{l.imports, l.vehicles, l.files, l.notifications, l.tasks, l.knowledge, l.kbSpaces, l.trips, l.calendar,
		l.forms, l.docs}
}

func (l *tenantLoader) contentID(kind, key string) uuid.UUID {
	return nameID(localRef(kind, l.t.Key, key))
}

func (l *tenantLoader) personID(actor string) uuid.UUID {
	return nameID(memberRef(refPerson, actor, l.t.Key))
}

func (l *tenantLoader) actorName(key string) string {
	i := slices.IndexFunc(l.actors, func(a ActorDef) bool { return a.Key == key })
	if i < 0 {
		return key // Validate guarantees the actor
	}
	return l.actors[i].Name
}

// imports writes previews of CSV imports (people.imports) with rows that matched people (action update).
func (l *tenantLoader) imports() error {
	created := l.now.Add(-contentAge)
	for _, i := range l.t.Content.Imports {
		id := l.contentID(refImport, i.Key)
		totals, err := json.Marshal(map[string]int{
			"rows": len(i.Rows), "create": 0, "update": len(i.Rows), "skip": 0, "error": 0, "invited": 0,
		})
		if err != nil {
			return err
		}
		if err := l.exec("import "+i.Key, `insert into people.imports
			(id, state, file_name, default_unit_id, created_by, created_at, expires_at, totals)
			values ($1, 'previewed', $2, $3, $4, $5, $6, $7::jsonb)`,
			id, "people-"+i.Key+".csv", l.unitID(i.DefaultUnit), l.owner, created, created.Add(previewFor), string(totals)); err != nil {
			return err
		}
		for n, r := range i.Rows {
			data, err := json.Marshal(map[string]string{"fullName": l.actorName(r.Person), "orgUnitId": l.unitID(r.Unit).String()})
			if err != nil {
				return err
			}
			if err := l.exec(fmt.Sprintf("import %s row %d", i.Key, n+2), `insert into people.import_rows
				(import_id, line, action, data, person_id) values ($1, $2, 'update', $3::jsonb, $4)`,
				id, n+2, string(data), l.personID(r.Person)); err != nil {
				return err
			}
		}
	}
	return nil
}

// vehicles writes the vehicles files attach to (fleet.vehicles).
func (l *tenantLoader) vehicles() error {
	for _, v := range l.t.Content.Vehicles {
		if err := l.exec("vehicle "+v.Key, `insert into fleet.vehicles
			(id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm) values ($1, $2, $3, 'van', 1500, 12, 3200)`,
			l.contentID(refVehicle, v.Key), l.unitID(v.Unit), v.Plate); err != nil {
			return err
		}
	}
	return nil
}

// files writes checked inspection photos of vehicles (files.objects, state ready). The objects are not in a
// storage: a download only signs a URL (storage.S3.PresignGet). The attachments of tasks follow their tasks
// (tenantLoader.taskFiles, content_tasks.go).
func (l *tenantLoader) files() error {
	at := l.now.Add(-contentAge)
	for _, f := range l.t.Content.Files {
		if f.Task != "" {
			continue
		}
		key := fmt.Sprintf("isolation/%s/%s.jpg", l.t.Key, f.Key)
		sum := sha256.Sum256([]byte(key))
		if err := l.exec("file "+f.Key, `insert into files.objects
			(id, object_key, state, purpose, owner_type, owner_id, declared_mime, detected_mime, bytes, sha256,
			 uploaded_by, created_at, ready_at)
			values ($1, $2, 'ready', 'inspection', 'fleet.vehicle', $3, $4, 'image/jpeg', 2048, $5, $6, $7, $7)`,
			l.contentID(refFile, f.Key), key, l.contentID(refVehicle, f.Vehicle),
			mime.FormatMediaType("image/jpeg", map[string]string{"name": f.Name}), sum[:], l.owner, at); err != nil {
			return err
		}
	}
	return nil
}

// notifications writes the inbox (notify.notifications) with the audience of each notification, newest first in
// the order of the catalog.
func (l *tenantLoader) notifications() error {
	for n, d := range l.t.Content.Notifications {
		kind := "billing.trial.extended" // a system notice
		var perm, unit any
		if d.Permission != "" {
			kind, perm = "fleet.trip.submitted", d.Permission
		}
		if d.Unit != "" {
			unit = l.unitID(d.Unit)
		}
		sens := d.Sensitivity
		if sens == "" {
			sens = "normal"
		}
		if err := l.exec("notification "+d.Key, `insert into notify.notifications
			(id, recipient_person_id, kind, title, unit_id, sensitivity, required_permission, created_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8)`,
			l.contentID(refNotification, d.Key), l.personID(d.Recipient), kind, d.Title, unit, sens, perm,
			l.now.Add(-time.Duration(n+1)*time.Minute)); err != nil {
			return err
		}
	}
	return nil
}
