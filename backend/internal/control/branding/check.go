package branding

import (
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"
)

// The checks of a new version (contract updateTenantBranding, 18-branding «Что можно менять», MSW branding/index.ts).

const (
	detailCheck   = "Проверьте оформление."
	maxName       = 60
	maxShortName  = 16
	maxTermForm   = 40
	maxMenuLabel  = 40
	maxMenuItems  = 80
	codeRequired  = "required"
	codeLength    = "length"
	codePattern   = "pattern"
	codeValidated = "validation_failed"
)

// termLabels are the terms of the catalogue and their names for the texts.
var termLabels = map[string]string{"shift": "смена", "vehicle": "машина", "trip": "рейс", "visit": "визит", "object": "объект"}

// lockedItems are the sections of management that are never hidden.
var lockedItems = set("home", "modules", "users", "billing", "branding")

var (
	accentRE   = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
	menuItemRE = regexp.MustCompile(`^[a-z][a-zA-Z0-9_:-]{0,39}$`)
	iconRE     = regexp.MustCompile(`^[a-z0-9_]{1,40}$`)
)

func refusal(field, code, message string) *RefusalError {
	return &RefusalError{Code: codeValidated, Detail: detailCheck, Violations: []Violation{{Field: field, Code: code, Message: message}}}
}

func runes(s string) int { return utf8.RuneCountInString(s) }

// checkUpdate returns the first refusal of u (in the order of the form), nil when it may be saved.
func checkUpdate(u Update) *RefusalError {
	name := strings.TrimSpace(u.DisplayName)
	switch {
	case name == "":
		return refusal("displayName", codeRequired, "Укажите название")
	case runes(name) > maxName:
		return refusal("displayName", codeLength, "От 1 до 60 символов")
	case u.ShortName != nil && runes(strings.TrimSpace(*u.ShortName)) > maxShortName:
		return refusal("shortName", codeLength, "Не длиннее 16 символов")
	case !accentRE.MatchString(u.AccentHex):
		return refusal("accentHex", codePattern, "Цвет в формате #RRGGBB")
	}
	if r := checkTerms(u.Terms); r != nil {
		return r
	}
	return checkMenu(u.Menu)
}

// checkTerms: only the keys of the catalogue, all four forms non-blank and up to 40 characters.
func checkTerms(terms map[string]Term) *RefusalError {
	keys := make([]string, 0, len(terms))
	for k := range terms {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, key := range keys {
		label, ok := termLabels[key]
		if !ok {
			return refusal("terms."+key, "unknown", "Нет такого термина в каталоге")
		}
		t := terms[key]
		for _, f := range []struct{ form, value string }{{"one", t.One}, {"plural", t.Plural}, {"few", t.Few}, {"many", t.Many}} {
			v := strings.TrimSpace(f.value)
			if v == "" {
				return refusal("terms."+key+"."+f.form, codeRequired, "Термин «"+label+"»: заполните все четыре формы")
			}
			if runes(v) > maxTermForm {
				return refusal("terms."+key+"."+f.form, codeLength, "Не длиннее 40 символов")
			}
		}
	}
	return nil
}

// checkMenu: item ids of the pattern, labels up to 40 characters, icons from the icon set (Material Symbols names),
// the order unique.
func checkMenu(m Menu) *RefusalError {
	if len(m.Items) > maxMenuItems || len(m.Order) > maxMenuItems {
		return refusal("menu", codeLength, "Не больше 80 пунктов")
	}
	ids := make([]string, 0, len(m.Items))
	for id := range m.Items {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		item := m.Items[id]
		switch {
		case !menuItemRE.MatchString(id):
			return refusal("menu.items", codePattern, "Неизвестный пункт меню")
		case runes(strings.TrimSpace(item.Label)) > maxMenuLabel:
			return refusal("menu.items."+id+".label", codeLength, "Не длиннее 40 символов")
		case item.Icon != "" && !iconRE.MatchString(item.Icon):
			return refusal("menu.items."+id+".icon", codePattern, "Иконка из набора модуля")
		}
	}
	seen := map[string]bool{}
	for _, id := range m.Order {
		if !menuItemRE.MatchString(id) {
			return refusal("menu.order", codePattern, "Неизвестный пункт меню")
		}
		if seen[id] {
			return refusal("menu.order", "unique", "Пункт повторяется")
		}
		seen[id] = true
	}
	return nil
}

// normalized is u as stored: trimmed names and terms, a blank short name is none, the menu without empty overrides and
// without hiding the sections of management.
func normalized(u Update) Update {
	u.DisplayName = strings.TrimSpace(u.DisplayName)
	if u.ShortName != nil {
		if s := strings.TrimSpace(*u.ShortName); s != "" {
			u.ShortName = &s
		} else {
			u.ShortName = nil
		}
	}
	terms := make(map[string]Term, len(u.Terms))
	for k, t := range u.Terms {
		terms[k] = Term{One: strings.TrimSpace(t.One), Plural: strings.TrimSpace(t.Plural), Few: strings.TrimSpace(t.Few), Many: strings.TrimSpace(t.Many)}
	}
	u.Terms = terms
	items := map[string]MenuItem{}
	for id, item := range u.Menu.Items {
		out := MenuItem{Label: strings.TrimSpace(item.Label), Icon: item.Icon, Hidden: item.Hidden && !lockedItems[id]}
		if out != (MenuItem{}) {
			items[id] = out
		}
	}
	u.Menu = Menu{Items: items, Order: slices.Clone(u.Menu.Order)}
	if u.Menu.Order == nil {
		u.Menu.Order = []string{}
	}
	return u
}
