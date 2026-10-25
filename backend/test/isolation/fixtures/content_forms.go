package fixtures

import (
	"fmt"
	"slices"
)

// Content of «Формы и опросы» (W4.21, integratorNotes of W4.05 п. 3/3а): in every tenant (tenant B mirrors tenant A)
// the group «Проверки», the form «Осмотр машины» of the whole organization in it — published v1 with one text
// question — its rule «уведомить владельца» and an accepted response of the driver of Москва-1. The rows carry the same
// keys in both tenants: «a foreign object in the own tenant» of the matrix forms_w405 is the id of tenant B in the path
// of tenant A. The fixtures do not import the module (its tests load them): the JSON is that of the contract.

// Reference kinds of the content of forms.
const (
	refForm         = "form"
	refFormVersion  = "form_version"
	refFormRule     = "form_rule"
	refFormResponse = "form_response"
	refFormGroup    = "form_group"
)

// FormDef is a form with its published v1 (reference form:<t>.<key>, its version form_version:<t>.<key>) in a group (a
// key of FormGroups, "" — none); its area is the unit Unit ("" — the whole organization; W4.82).
type FormDef struct {
	Key, Name, Group string
	Unit             string
}

// FormGroupDef is a group of forms. Reference form_group:<t>.<key>.
type FormGroupDef struct {
	Key, Name string
}

// FormRuleDef is a rule «уведомить владельца» of a form on behalf of the owner. Reference form_rule:<t>.<key>.
type FormRuleDef struct {
	Key, Form string
}

// FormResponseDef is an accepted response to the v1 of a form by Author (an actor with a membership in the tenant).
// Reference form_response:<t>.<key>. Trip (W4.82) — a key of the trips of the content the response is about ("" — none).
type FormResponseDef struct {
	Key, Form, Author string
	Trip              string
}

// formContent is the content of forms of tenant t.
func formContent(t string) ([]FormGroupDef, []FormDef, []FormRuleDef, []FormResponseDef) {
	return []FormGroupDef{{Key: "checks", Name: "Проверки"}},
		[]FormDef{{Key: formInsp, Name: "Осмотр машины", Group: "checks"}},
		[]FormRuleDef{{Key: "insp-notify", Form: formInsp}},
		[]FormResponseDef{{Key: "insp-1", Form: formInsp, Author: t + ".driver-msk1"}}
}

// formDefinition is the v1 of a form of the fixtures (FormDefinitionV2): one optional text question q-text.
const formDefinition = `{"pages":[{"id":"p1","title":"Страница 1"}],"fields":[{"key":"q-text","pageId":"p1","type":"text",` +
	`"label":"Комментарий","required":false}]}`

// validateForms checks the content of forms of t: forms of known groups, rules and responses of known forms, the
// authors with a membership in t.
func (c Catalog) validateForms(t TenantDef, fail failFunc) {
	hasForm := func(key string) bool {
		return slices.ContainsFunc(t.Content.Forms, func(f FormDef) bool { return f.Key == key })
	}
	for _, f := range t.Content.Forms {
		if f.Name == "" || (f.Group != "" && !t.Content.has(refFormGroup, f.Group)) {
			fail("form %s.%s: no name or unknown group", t.Key, f.Key)
		}
	}
	for _, r := range t.Content.FormRules {
		if !hasForm(r.Form) {
			fail("form rule %s.%s: unknown form", t.Key, r.Key)
		}
	}
	for _, r := range t.Content.FormResponses {
		if !hasForm(r.Form) || !c.hasRef(memberRef(refPerson, r.Author, t.Key)) {
			fail("form response %s.%s: unknown form or author", t.Key, r.Key)
		}
	}
}

// forms writes the groups, the forms with their v1 and drafts, the rules and the responses of the content.
func (l *tenantLoader) forms() error {
	at := l.now.Add(-contentAge)
	for _, g := range l.t.Content.FormGroups {
		if err := l.exec("form group "+g.Key, `insert into forms.groups (id, name, created_by, created_at) values ($1, $2, $3, $4)`,
			l.contentID(refFormGroup, g.Key), g.Name, l.owner, at); err != nil {
			return err
		}
	}
	for _, f := range l.t.Content.Forms {
		if err := l.form(f); err != nil {
			return err
		}
	}
	for _, r := range l.t.Content.FormRules {
		if err := l.exec("form rule "+r.Key, `insert into forms.rules (id, form_id, kind, enabled, version, trigger, config, author_id,
			created_at, updated_at) values ($1, $2, 'notify', true, 1, 'submitted', $3::jsonb, $4, $5, $5)`,
			l.contentID(refFormRule, r.Key), l.contentID(refForm, r.Form), fmt.Sprintf(`{"notify":{"memberId":%q}}`, l.owner), l.owner,
			at); err != nil {
			return err
		}
	}
	for _, r := range l.t.Content.FormResponses {
		var module, kind, subject, label any // W4.82: a response about a trip of the content
		if r.Trip != "" {
			id, name := l.tripRef(r.Trip)
			module, kind, subject, label = "fleet", "trip", id, name
		}
		if err := l.exec("form response "+r.Key, `insert into forms.responses (id, form_id, version_number, channel, author_id, answers,
			review_status, submitted_at, subject_module, subject_type, subject_id, subject_label)
			values ($1, $2, 1, 'member', $3, $4::jsonb, 'accepted', $5, $6, $7, $8, $9)`,
			l.contentID(refFormResponse, r.Key), l.contentID(refForm, r.Form), l.personID(r.Author),
			`[{"fieldKey":"q-text","value":{"type":"text","value":"Без замечаний"}}]`, at, module, kind, subject, label); err != nil {
			return err
		}
	}
	return nil
}

// form writes a published form of the whole organization with its v1 and its draft.
func (l *tenantLoader) form(f FormDef) error {
	at, id := l.now.Add(-contentAge), l.contentID(refForm, f.Key)
	var group, unit any
	if f.Group != "" {
		group = l.contentID(refFormGroup, f.Group)
	}
	if f.Unit != "" {
		unit = l.unitID(f.Unit)
	}
	if err := l.exec("form "+f.Key, `insert into forms.forms (id, name, group_id, org_unit_id, owner_id, status, current_version,
		created_at, updated_at) values ($1, $2, $3, $4, $5, 'published', 1, $6, $6)`, id, f.Name, group, unit, l.owner, at); err != nil {
		return err
	}
	if err := l.exec("form version "+f.Key, `insert into forms.versions (id, form_id, number, definition, question_count,
		published_at, published_by) values ($1, $2, 1, $3::jsonb, 1, $4, $5)`, l.contentID(refFormVersion, f.Key), id,
		formDefinition, at, l.owner); err != nil {
		return err
	}
	return l.exec("form draft "+f.Key, `insert into forms.drafts (form_id, definition, base_version, has_changes, revision)
		values ($1, $2::jsonb, 1, false, 1)`, id, formDefinition)
}
