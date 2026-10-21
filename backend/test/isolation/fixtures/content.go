package fixtures

import (
	"slices"
	"strings"
)

// keys returns the keys of the content of kind (an import, a vehicle, a file or a notification).
func (c Content) keys(kind string) []string {
	var out []string
	switch kind {
	case refImport:
		for _, i := range c.Imports {
			out = append(out, i.Key)
		}
	case refVehicle:
		for _, v := range c.Vehicles {
			out = append(out, v.Key)
		}
	case refFile:
		for _, f := range c.Files {
			out = append(out, f.Key)
		}
	case refNotification:
		for _, n := range c.Notifications {
			out = append(out, n.Key)
		}
	case refTask:
		for _, x := range c.Tasks {
			out = append(out, x.Key)
		}
	case refAutomation:
		for _, r := range c.Rules {
			out = append(out, r.Key)
		}
	}
	return out
}

// contentKinds are the reference kinds of the content, in the order Refs lists them.
var contentKinds = []string{refImport, refVehicle, refFile, refNotification, refTask, refAutomation}

// has reports whether the content holds an object of kind with key.
func (c Content) has(kind, key string) bool { return slices.Contains(c.keys(kind), key) }

// refs returns the references of the content of tenant t.
func (c Content) refs(t string) []string {
	var out []string
	for _, kind := range contentKinds {
		for _, key := range c.keys(kind) {
			out = append(out, localRef(kind, t, key))
		}
	}
	return out
}

// sensitivities are notify.notifications.sensitivity ("" — normal).
var sensitivities = []string{"", "normal", "sensitive", sensRestricted}

// validateContent checks the content of tenant t: keys, units, people with a membership in t, vehicles of files,
// the audience of notifications.
func (c Catalog) validateContent(t TenantDef, fail failFunc) {
	for _, kind := range contentKinds {
		seen := map[string]bool{}
		for _, key := range t.Content.keys(kind) {
			if key == "" || strings.ContainsAny(key, ".:@ ") || seen[key] {
				fail("%s %s.%q: duplicate or malformed key", kind, t.Key, key)
			}
			seen[key] = true
		}
	}
	member := func(actor string) bool { return c.hasRef(memberRef(refPerson, actor, t.Key)) }
	for _, i := range t.Content.Imports {
		validateImport(t, i, member, fail)
	}
	validateFiles(t, fail)
	for _, n := range t.Content.Notifications {
		validateNotification(t, n, member, fail)
	}
	c.validateTasks(t, fail) // W4.11
}

func validateImport(t TenantDef, i ImportDef, member func(string) bool, fail failFunc) {
	at := "import " + t.Key + "." + i.Key
	if !t.hasUnit(i.DefaultUnit) {
		fail("%s: unknown default unit %q", at, i.DefaultUnit)
	}
	for _, r := range i.Rows {
		if !member(r.Person) {
			fail("%s: person %q has no membership in tenant %s", at, r.Person, t.Key)
		}
		if !t.hasUnit(r.Unit) {
			fail("%s: unknown unit %q of a row", at, r.Unit)
		}
	}
}

// validateFiles checks the vehicles of t and the files attached to them or to a task (W4.11).
func validateFiles(t TenantDef, fail failFunc) {
	for _, v := range t.Content.Vehicles {
		switch {
		case !t.hasUnit(v.Unit):
			fail("vehicle %s.%s: unknown unit %q", t.Key, v.Key, v.Unit)
		case v.Plate == "":
			fail("vehicle %s.%s: no plate", t.Key, v.Key)
		}
	}
	for _, f := range t.Content.Files {
		switch {
		case f.Vehicle != "" && f.Task != "":
			fail("file %s.%s: attached to a vehicle or a task, not both", t.Key, f.Key)
		case f.Task != "" && !t.Content.has(refTask, f.Task):
			fail("file %s.%s: unknown task %q", t.Key, f.Key, f.Task)
		case f.Task == "" && !t.Content.has(refVehicle, f.Vehicle):
			fail("file %s.%s: unknown vehicle %q", t.Key, f.Key, f.Vehicle)
		case f.Name == "":
			fail("file %s.%s: no name", t.Key, f.Key)
		}
	}
}

func validateNotification(t TenantDef, n NotificationDef, member func(string) bool, fail failFunc) {
	at := "notification " + t.Key + "." + n.Key
	switch {
	case !member(n.Recipient):
		fail("%s: recipient %q has no membership in tenant %s", at, n.Recipient, t.Key)
	case n.Title == "":
		fail("%s: no title", at)
	case n.Unit != "" && !t.hasUnit(n.Unit):
		fail("%s: unknown unit %q", at, n.Unit)
	case n.Unit != "" && n.Permission == "":
		fail("%s: a unit without a permission (the audience is permission × unit)", at)
	case !slices.Contains(sensitivities, n.Sensitivity):
		fail("%s: sensitivity %q is not one of %q", at, n.Sensitivity, sensitivities)
	}
}
