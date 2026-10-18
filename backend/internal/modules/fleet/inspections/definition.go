package inspections

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
)

// The checklist is a form (D-30 комплекта, W2.45): fleet.checklist_versions.definition holds the version in the
// FormDefinition format of the contract, so that at step 4.2 the checklist is a form. The definition is the source of
// a version: its single_choice fields are the items (the options are the results of InspectionCheck), its file fields
// photo_<role> the photo roles; items and required_photo_roles are read only for a version whose definition is not a
// checklist form (backward compatibility).

// Results of an item (InspectionCheck.result).
const (
	resultPass          = "pass"
	resultFail          = "fail"
	resultNotApplicable = "not_applicable"
)

// Titles of the forms (Ортус CRM.dc.html) and the limits of a photo field (one JPEG up to 20 MB, D-08 комплекта).
const (
	titleDeparture   = "Осмотр перед выездом"
	titleReturn      = "Осмотр при сдаче"
	photoFieldPrefix = "photo_"
	photoMaxFiles    = 1
	photoMaxBytes    = 20 << 20
	photoMIME        = "image/jpeg"
)

// Limits of FormDefinition and FormField (components/common/schemas.yaml).
const (
	maxFormTitle        = 200
	maxFormDescription  = 5000
	maxFormConfirmation = 1000
	maxFormFields       = 200
	maxFieldLabel       = 500
	maxFieldFiles       = 10
	maxFieldMimeTypes   = 20
	maxFieldFileBytes   = 26214400
	maxBlockingValues   = 20
)

// checkOptions are the options of an item. ВРЕМЕННЫЕ подписи до решения Q-W2.52-8 (в эталоне нет), как в tenant 0017
// fleet.checklist_definition и MSW W2.52.
var checkOptions = []fleetapi.ChoiceOption{
	{Key: resultPass, Label: "Исправно"}, {Key: resultFail, Label: "Неисправно"}, {Key: resultNotApplicable, Label: "Не применимо"},
}

// photoLabels are the labels of the photo fields: PHOTO_SIDES of the prototype; «Груз», «Повреждение» — ВРЕМЕННЫЕ
// (Q-W2.52-8).
var photoLabels = map[string]string{
	roleFront: "Спереди", roleRear: "Сзади", roleLeft: "Слева", roleRight: "Справа", roleOdometer: "Одометр",
	roleCargo: "Груз", roleDamage: "Повреждение",
}

// fieldKeyRE is FormField.key.
var fieldKeyRE = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

// errNotChecklistForm: the definition of a version is not a checklist form — not a FormDefinition of the contract, or
// one an inspection cannot be written by.
var errNotChecklistForm = errors.New("inspections: the definition is not a checklist form")

// options are the results the item takes.
func (it checkItem) options() []fleetapi.ChoiceOption {
	if it.Options == nil {
		return checkOptions
	}
	return it.Options
}

// blocking are the results of the item that do not release the vehicle.
func (it checkItem) blocking() []string {
	if it.Blocking == nil && it.FailureBlocksRelease {
		return []string{resultFail}
	}
	return it.Blocking
}

// option returns the option of the item for a result.
func (it checkItem) option(result string) (fleetapi.ChoiceOption, bool) {
	i := slices.IndexFunc(it.options(), func(o fleetapi.ChoiceOption) bool { return o.Key == result })
	if i < 0 {
		return fleetapi.ChoiceOption{}, false
	}
	return it.options()[i], true
}

// checklistDefinition is the FormDefinition of a version by the rule of tenant 0017 fleet.checklist_definition: the
// items are single_choice fields (blockingValues — the blocking results), then each required role is a required file
// field photo_<role> with one JPEG up to 20 MB.
func checklistDefinition(c checklist) fleetapi.FormDefinition {
	title := titleReturn
	if c.Kind == kindDeparture {
		title = titleDeparture
	}
	fields := make([]fleetapi.FormField, 0, len(c.Items)+len(c.Roles))
	for _, it := range c.Items {
		opts := slices.Clone(it.options())
		f := fleetapi.FormField{Key: it.Key, Label: it.Label, Type: fleetapi.FormFieldTypeSingleChoice, Required: it.Required,
			Options: &opts}
		if b := it.blocking(); len(b) > 0 {
			values := slices.Clone(b)
			f.BlockingValues = &values
		}
		fields = append(fields, f)
	}
	for _, role := range c.Roles {
		files, size, mime := photoMaxFiles, photoMaxBytes, []string{photoMIME}
		fields = append(fields, fleetapi.FormField{Key: photoFieldPrefix + role, Label: photoLabels[role],
			Type: fleetapi.FormFieldTypeFile, Required: true, MaxFiles: &files, AllowedMimeTypes: &mime, MaxFileBytes: &size})
	}
	return fleetapi.FormDefinition{Title: title, Description: "", Fields: fields,
		Visibility: []fleetapi.FieldVisibility{}, ConfirmationText: ""}
}

// parseDefinition decodes a stored definition (FormDefinition, no unknown properties) and reads the version from it:
// the items and the required photo roles. Anything else is errNotChecklistForm.
func parseDefinition(raw []byte) (fleetapi.FormDefinition, []checkItem, []string, error) {
	var def fleetapi.FormDefinition
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&def); err != nil {
		return fleetapi.FormDefinition{}, nil, nil, fmt.Errorf("%w: %w", errNotChecklistForm, err)
	}
	if def.Visibility == nil {
		def.Visibility = []fleetapi.FieldVisibility{}
	}
	items, roles, err := readForm(def)
	if err != nil {
		return fleetapi.FormDefinition{}, nil, nil, err
	}
	return def, items, roles, nil
}

func notForm(format string, args ...any) error {
	return fmt.Errorf("%w: "+format, append([]any{errNotChecklistForm}, args...)...)
}

// readForm checks a FormDefinition against the schema and the rules of a checklist and reads its items and roles.
// An inspection answers an item by a result and a role by a photo, so a checklist form has only single_choice fields
// with options among the results and file fields photo_<role>, no visibility conditions (step 4.2, W4.24), at least
// one item.
func readForm(def fleetapi.FormDefinition) ([]checkItem, []string, error) {
	if err := checkFormHeader(def); err != nil {
		return nil, nil, err
	}
	var (
		items []checkItem
		roles []string
		keys  = map[string]bool{}
	)
	for _, f := range def.Fields {
		it, role, err := readField(f, keys)
		switch {
		case err != nil:
			return nil, nil, err
		case it != nil:
			items = append(items, *it)
		case f.Required:
			roles = append(roles, role)
		}
	}
	if len(items) == 0 {
		return nil, nil, notForm("no items")
	}
	return items, roles, nil
}

// checkFormHeader checks the title, the texts, the number of fields and the visibility of a checklist form.
func checkFormHeader(def fleetapi.FormDefinition) error {
	switch {
	case blank(def.Title) || tooLong(def.Title, maxFormTitle):
		return notForm("title")
	case tooLong(def.Description, maxFormDescription) || tooLong(def.ConfirmationText, maxFormConfirmation):
		return notForm("description or confirmationText")
	case len(def.Fields) == 0 || len(def.Fields) > maxFormFields:
		return notForm("%d fields", len(def.Fields))
	case len(def.Visibility) > 0:
		return notForm("visibility conditions")
	}
	return nil
}

// readField reads a field of a checklist form, its key not among keys: an item (single_choice) or a photo role (file
// photo_<role>).
func readField(f fleetapi.FormField, keys map[string]bool) (*checkItem, string, error) {
	switch {
	case !fieldKeyRE.MatchString(f.Key) || keys[f.Key]:
		return nil, "", notForm("field key %q", f.Key)
	case blank(f.Label) || tooLong(f.Label, maxFieldLabel):
		return nil, "", notForm("field %q: label", f.Key)
	}
	keys[f.Key] = true
	if f.Type == fleetapi.FormFieldTypeSingleChoice {
		it, err := readItem(f)
		if err != nil {
			return nil, "", err
		}
		return &it, "", nil
	}
	if f.Type == fleetapi.FormFieldTypeFile {
		role, err := readPhoto(f)
		return nil, role, err
	}
	return nil, "", notForm("field %q: type %s", f.Key, f.Type)
}

// readItem reads an item of a single_choice field: options among the results, blockingValues among the options.
func readItem(f fleetapi.FormField) (checkItem, error) {
	if f.Options == nil || len(*f.Options) == 0 {
		return checkItem{}, notForm("field %q: no options", f.Key)
	}
	it := checkItem{Key: f.Key, Label: f.Label, Required: f.Required, Options: slices.Clone(*f.Options)}
	seen := map[string]bool{}
	for _, o := range it.Options {
		if seen[o.Key] || blank(o.Label) || !slices.Contains([]string{resultPass, resultFail, resultNotApplicable}, o.Key) {
			return checkItem{}, notForm("field %q: option %q", f.Key, o.Key)
		}
		seen[o.Key] = true
	}
	if f.BlockingValues != nil {
		if len(*f.BlockingValues) > maxBlockingValues {
			return checkItem{}, notForm("field %q: blockingValues", f.Key)
		}
		for i, v := range *f.BlockingValues {
			if !seen[v] || slices.Contains((*f.BlockingValues)[:i], v) {
				return checkItem{}, notForm("field %q: blocking value %q", f.Key, v)
			}
		}
		it.Blocking = slices.Clone(*f.BlockingValues)
	}
	it.FailureBlocksRelease = slices.Contains(it.Blocking, resultFail)
	return it, nil
}

// readPhoto reads the role of a file field photo_<role>: a role of the contract, the limits of a file field.
func readPhoto(f fleetapi.FormField) (string, error) {
	role, ok := strings.CutPrefix(f.Key, photoFieldPrefix)
	switch {
	case !ok || !slices.Contains(apiRoles, role):
		return "", notForm("field %q: not a photo role", f.Key)
	case f.MaxFiles == nil || *f.MaxFiles < 1 || *f.MaxFiles > maxFieldFiles,
		f.MaxFileBytes == nil || *f.MaxFileBytes < 1 || *f.MaxFileBytes > maxFieldFileBytes,
		f.AllowedMimeTypes == nil || len(*f.AllowedMimeTypes) == 0 || len(*f.AllowedMimeTypes) > maxFieldMimeTypes:
		return "", notForm("field %q: file limits", f.Key)
	case f.Options != nil || f.BlockingValues != nil:
		return "", notForm("field %q: options of a file", f.Key)
	}
	return role, nil
}

// readVersion builds a version from its columns: by the definition when it is a checklist form; otherwise
// (backward compatibility) by items and required_photo_roles of tenant 0002 without a definition.
func readVersion(c checklist, items []byte, roles []string, definition []byte) (checklist, error) {
	if def, fromDef, rs, err := parseDefinition(definition); err == nil {
		c.Items, c.Roles, c.Definition = fromDef, rs, &def
		return c, nil
	}
	c.Items, c.Roles, c.Definition = nil, nil, nil
	if err := json.Unmarshal(items, &c.Items); err != nil {
		return checklist{}, fmt.Errorf("inspections: checklist items: %w", err)
	}
	for _, r := range roles {
		if api := apiRole(r); api != "" {
			c.Roles = append(c.Roles, api)
		}
	}
	for i := range c.Items {
		c.Items[i].Options, c.Items[i].Blocking = slices.Clone(checkOptions), c.Items[i].blocking()
	}
	return c, nil
}

// detailUnknownItem is 422 of an item the version does not have.
const detailUnknownItem = "Неверный пункт чек-листа."

// item returns the item of the version with key.
func (c checklist) item(key string) (checkItem, bool) {
	i := slices.IndexFunc(c.Items, func(it checkItem) bool { return it.Key == key })
	if i < 0 {
		return checkItem{}, false
	}
	return c.Items[i], true
}

// checkAnswers checks the answers of an inspection against its version: every item is an item of the version, every
// result an option of the item (422).
func checkAnswers(c checklist, checks []fleetapi.InspectionCheck) error {
	for _, ch := range checks {
		it, ok := c.item(ch.Key)
		if !ok {
			return invalid(detailUnknownItem)
		}
		if _, ok := it.option(string(ch.Result)); !ok {
			return invalid("Для пункта «" + it.Label + "» такого результата нет.")
		}
	}
	return nil
}

// blockingDefects are the defects of the blocking answers of a departure (FormField.blockingValues: the answer does
// not release the vehicle): a blocking defect of the item — the zone is its label, the description the comment of
// the answer or «{option}: {item}». An item whose zone the driver already reported as a blocking defect gives none.
// Criticality is chosen before departure only: a return gives none.
func blockingDefects(c checklist, kind string, checks []fleetapi.InspectionCheck, reported []fleetapi.InspectionDefectReport) []fleetapi.InspectionDefectReport {
	if kind != kindDeparture {
		return nil
	}
	var out []fleetapi.InspectionDefectReport
	for _, ch := range checks {
		it, ok := c.item(ch.Key)
		if !ok || !slices.Contains(it.blocking(), string(ch.Result)) {
			continue
		}
		zone := cut(it.Label, maxZone)
		if slices.ContainsFunc(reported, func(d fleetapi.InspectionDefectReport) bool {
			return d.Severity == severityBlocking && d.Zone == zone
		}) {
			continue
		}
		opt, _ := it.option(string(ch.Result))
		description := opt.Label + ": " + it.Label
		if ch.Comment != nil && !blank(*ch.Comment) {
			description = *ch.Comment
		}
		out = append(out, fleetapi.InspectionDefectReport{Zone: zone, Description: cut(description, maxDescription),
			Severity: severityBlocking})
	}
	return out
}

// cut keeps the first n characters of s.
func cut(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}
