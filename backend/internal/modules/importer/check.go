package importer

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actions of the catalog (api/permissions.yaml).
const (
	actionRead      = "members.read"
	actionManage    = "members.manage"
	actionInvite    = "members.invite"
	actionUnitsRead = "org_units.read"
)

// maxName is the length limit of a full name (MemberCreate.displayName).
const maxName = 150

// Codes of row errors (PeopleImportRow.errors[].code).
const (
	codeRequired   = "required"
	codeTooLong    = "too_long"
	codeFormat     = "format"
	codeUnknown    = "unknown"
	codeAmbiguous  = "ambiguous"
	codeDuplicate  = "duplicate"
	codePast       = "past"
	codeNoFunction = "without_function"
	codeExtra      = "extra_values"
	codeInvalidRow = "invalid_row"
)

// fieldRow is the field of an error about the whole row.
const fieldRow = "row"

// textInvalidRow is the error of a row matching a person outside the scope of the actor: it names neither the
// person nor the reason (createPeopleImport: «the same text as an invalid row»).
const textInvalidRow = "Строку нельзя импортировать. Проверьте данные строки или обратитесь к владельцу."

// textUnknownUnit is the error of an unknown unit and of a unit outside the scope of the actor alike.
const textUnknownUnit = "Подразделение не найдено."

// textSoD is the error of the driver function of a person with earnings (the mock, rules.ts).
const textSoD = "Функция «Водитель» несовместима с правом на начисления (правило MVP)."

// violation is an error of a row (ProblemViolation).
type violation struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// checked is a row with its checks: normalized values, the resolved unit, the matched or created person and the
// action.
type checked struct {
	Line       int
	Data       rowData
	Email      string     // lower case
	Phone      string     // digits, 8… → 7…
	Function   string     // people.work_profiles.function
	From       *time.Time // start of the function
	Unit       uuid.UUID  // the home unit of a new person, or the new home unit of an update
	UnitSet    bool       // the row names its unit (an update moves the person only then)
	Person     uuid.UUID  // the matched person (update, skip) or the created one (after commit)
	NewProfile bool       // the row adds a work function
	Action     accessapi.PeopleImportRowAction
	Errors     []violation
}

func (c *checked) fail(field, code, message string) {
	c.Errors = append(c.Errors, violation{Field: field, Code: code, Message: message})
}

// checkStatic checks a record without the database. loc is the zone of the default unit: «today» of valid_from.
func checkStatic(rec record, now time.Time, loc *time.Location) checked {
	c := checked{Line: rec.Line, Data: rec.Data}
	d := rec.Data
	switch n := utf8.RuneCountInString(d.FullName); {
	case n == 0:
		c.fail(colFullName, codeRequired, "Укажите ФИО.")
	case n > maxName:
		c.fail(colFullName, codeTooLong, "ФИО длиннее 150 символов.")
	}
	if d.Email != "" {
		if kit.ValidEmail(d.Email) {
			c.Email = strings.ToLower(d.Email)
		} else {
			c.fail(colEmail, codeFormat, "Проверьте адрес почты.")
		}
	}
	if d.Phone != "" {
		if p, ok := normalizePhone(d.Phone); ok {
			c.Phone = p
		} else {
			c.fail(colPhone, codeFormat, "Проверьте телефон: 10–15 цифр.")
		}
	}
	if d.WorkProfile != "" {
		if fn, ok := kit.FunctionToDB(strings.ToLower(d.WorkProfile)); ok {
			c.Function = fn
		} else {
			c.fail(colWorkProfile, codeUnknown, "Неизвестная функция. Допустимы: driver, practitioner, foreman, manager.")
		}
	}
	checkDate(&c, now, loc)
	if rec.Extra {
		c.fail(fieldRow, codeExtra, "В строке больше значений, чем колонок.")
	}
	return c
}

// checkDate checks valid_from: a date with a function, today or later; without a date the function starts now.
func checkDate(c *checked, now time.Time, loc *time.Location) {
	d := c.Data
	switch {
	case d.ValidFrom == "" && d.WorkProfile != "":
		from := now
		c.From = &from
		return
	case d.ValidFrom == "":
		return
	case d.WorkProfile == "":
		c.fail(colValidFrom, codeNoFunction, "Дата начала указана без функции.")
		return
	}
	var from time.Time
	var err error
	for _, layout := range []string{"2006-01-02", "02.01.2006"} {
		if from, err = time.ParseInLocation(layout, d.ValidFrom, loc); err == nil {
			break
		}
	}
	switch {
	case err != nil:
		c.fail(colValidFrom, codeFormat, "Дата — ГГГГ-ММ-ДД или ДД.ММ.ГГГГ.")
	case from.Before(kit.DayStart(now, loc)):
		c.fail(colValidFrom, codePast, "Функция может начаться не раньше сегодняшнего дня.")
	default:
		c.From = &from
	}
}

// normalizePhone keeps the digits of a phone: 10–15 digits, a Russian 8… becomes 7…, ten digits get 7.
func normalizePhone(s string) (string, bool) {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9':
			b.WriteRune(r)
		case strings.ContainsRune(" +-()", r):
		default:
			return "", false
		}
	}
	d := b.String()
	switch {
	case len(d) == 11 && d[0] == '8':
		d = "7" + d[1:]
	case len(d) == 10:
		d = "7" + d
	}
	if len(d) < 10 || len(d) > 15 {
		return "", false
	}
	return d, true
}

// unit is an active unit of the tenant.
type unit struct {
	ID   uuid.UUID
	Name string
}

// match is a person of the tenant found by e-mail or phone.
type match struct {
	ID         uuid.UUID
	Home       uuid.UUID
	Membership *uuid.UUID
	Name       string
	Email      string // lower case
	Phone      string // normalized
}

// checker checks rows against the database and the scope of the actor (members.manage). Answers of the evaluator
// are cached per unit and per person.
type checker struct {
	tc      tenantctx.TenantContext
	authz   kit.Authorizer
	dir     kit.Directory
	q       kit.Querier
	def     uuid.UUID // the default unit of the import
	units   []unit
	byID    map[uuid.UUID]unit
	manages map[uuid.UUID]bool // unit → members.manage over it
	owns    map[uuid.UUID]bool // person → members.manage over it
}

func newChecker(tc tenantctx.TenantContext, az kit.Authorizer, dir kit.Directory, q kit.Querier, def uuid.UUID) *checker {
	return &checker{tc: tc, authz: az, dir: dir, q: q, def: def,
		byID: map[uuid.UUID]unit{}, manages: map[uuid.UUID]bool{}, owns: map[uuid.UUID]bool{}}
}

// manageUnit reports whether the actor has members.manage over the unit.
func (k *checker) manageUnit(ctx context.Context, id uuid.UUID) (bool, error) {
	if v, ok := k.manages[id]; ok {
		return v, nil
	}
	ok, err := allowed(k.authz.Permit(ctx, k.tc, actionManage, authz.Resource{Unit: id}))
	k.manages[id] = ok
	return ok, err
}

// managePerson reports whether the actor has members.manage over the person (its home unit). An owner is within
// the scope of owners only (createPeopleImport: «a match outside the members.manage scope of the actor (another unit,
// an owner, …)»).
func (k *checker) managePerson(ctx context.Context, m match) (bool, error) {
	if v, ok := k.owns[m.ID]; ok {
		return v, nil
	}
	r := authz.Resource{Unit: m.Home, Persons: []uuid.UUID{m.ID}, ReadAction: actionRead}
	ok, err := allowed(k.authz.Permit(ctx, k.tc, actionManage, r))
	if err != nil {
		return false, err
	}
	if ok && !k.tc.Owner {
		owner, err := k.isOwner(ctx, m.Membership)
		if err != nil {
			return false, err
		}
		ok = !owner
	}
	k.owns[m.ID] = ok
	return ok, nil
}

// allowed turns a decision into a boolean; only a failure of a dependency is an error.
func allowed(err error) (bool, error) {
	if err == nil {
		return true, nil
	}
	if isDecision(err) {
		return false, nil
	}
	return false, err
}

// check runs the database checks of every row in place: the unit, duplicates in the file, the match by e-mail or
// phone, the scope, the work function and the action.
func (k *checker) check(ctx context.Context, rows []checked) error {
	if err := k.loadUnits(ctx); err != nil {
		return err
	}
	matches, err := k.loadMatches(ctx, rows)
	if err != nil {
		return err
	}
	seenEmail, seenPhone := map[string]int{}, map[string]int{}
	for i := range rows {
		c := &rows[i]
		if err := k.resolveUnit(ctx, c); err != nil {
			return err
		}
		duplicates(c, seenEmail, seenPhone)
		if len(c.Errors) > 0 {
			c.Action = accessapi.Error
			continue
		}
		if err := k.decide(ctx, c, matches); err != nil {
			return err
		}
	}
	return nil
}

// duplicates marks a row repeating the e-mail or phone of an earlier row of the file.
func duplicates(c *checked, seenEmail, seenPhone map[string]int) {
	if c.Email != "" {
		if line, ok := seenEmail[c.Email]; ok {
			c.fail(colEmail, codeDuplicate, fmt.Sprintf("Почта повторяет строку %d.", line))
		} else {
			seenEmail[c.Email] = c.Line
		}
	}
	if c.Phone != "" {
		if line, ok := seenPhone[c.Phone]; ok {
			c.fail(colPhone, codeDuplicate, fmt.Sprintf("Телефон повторяет строку %d.", line))
		} else {
			seenPhone[c.Phone] = c.Line
		}
	}
}

func (k *checker) loadUnits(ctx context.Context) error {
	rows, err := k.q.Query(ctx, `select id, name from org.units where archived_at is null order by name, id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var u unit
		if err := rows.Scan(&u.ID, &u.Name); err != nil {
			return err
		}
		k.units = append(k.units, u)
		k.byID[u.ID] = u
	}
	return rows.Err()
}

// resolveUnit sets the unit of the row: org_unit by id or by name among the units the actor manages, else the
// default unit. An unknown unit and a unit outside the scope are the same error.
func (k *checker) resolveUnit(ctx context.Context, c *checked) error {
	ref := c.Data.OrgUnit
	if ref == "" {
		c.Unit = k.def
		return nil
	}
	c.UnitSet = true
	var candidates []uuid.UUID
	if id, err := uuid.Parse(ref); err == nil {
		if _, ok := k.byID[id]; ok {
			candidates = append(candidates, id)
		}
	} else {
		for _, u := range k.units {
			if strings.EqualFold(u.Name, ref) {
				candidates = append(candidates, u.ID)
			}
		}
	}
	var mine []uuid.UUID
	for _, id := range candidates {
		ok, err := k.manageUnit(ctx, id)
		if err != nil {
			return err
		}
		if ok {
			mine = append(mine, id)
		}
	}
	switch len(mine) {
	case 0:
		c.fail(colOrgUnit, codeUnknown, textUnknownUnit)
	case 1:
		c.Unit = mine[0]
	default:
		c.fail(colOrgUnit, codeAmbiguous, "Несколько подразделений с таким названием: укажите id подразделения.")
	}
	return nil
}

// loadMatches reads the people with the e-mails or phones of the rows.
func (k *checker) loadMatches(ctx context.Context, rows []checked) ([]match, error) {
	var emails, phones []string
	for _, c := range rows {
		if c.Email != "" {
			emails = append(emails, c.Email)
		}
		if c.Phone != "" {
			phones = append(phones, c.Phone, "8"+c.Phone[1:])
		}
	}
	if len(emails) == 0 && len(phones) == 0 {
		return nil, nil
	}
	res, err := k.q.Query(ctx, `select id, home_unit_id, membership_id, full_name, lower(coalesce(email, '')),
		       regexp_replace(coalesce(phone, ''), '\D', '', 'g')
		  from people.person_profiles
		 where archived_at is null
		   and (lower(email) = any($1) or regexp_replace(coalesce(phone, ''), '\D', '', 'g') = any($2))`, emails, phones)
	if err != nil {
		return nil, err
	}
	defer res.Close()
	var out []match
	for res.Next() {
		var m match
		if err := res.Scan(&m.ID, &m.Home, &m.Membership, &m.Name, &m.Email, &m.Phone); err != nil {
			return nil, err
		}
		if p, ok := normalizePhone(m.Phone); ok {
			m.Phone = p
		}
		out = append(out, m)
	}
	return out, res.Err()
}

// matchOf returns the people a row matches by e-mail or phone (distinct).
func matchOf(c *checked, all []match) []match {
	var out []match
	for _, m := range all {
		if (c.Email != "" && m.Email == c.Email) || (c.Phone != "" && m.Phone == c.Phone) {
			out = append(out, m)
		}
	}
	return out
}

// decide sets the action of a row without errors: create, or update/skip of the person it matches within the
// scope. A match outside the scope, or matches of two people, is an error that names nobody.
func (k *checker) decide(ctx context.Context, c *checked, all []match) error {
	ms := matchOf(c, all)
	if len(ms) == 0 {
		c.Action = accessapi.Create
		c.NewProfile = c.Function != ""
		return nil
	}
	if len(ms) > 1 {
		k.reject(c)
		return nil
	}
	m := ms[0]
	ok, err := k.managePerson(ctx, m)
	if err != nil {
		return err
	}
	if !ok {
		k.reject(c)
		return nil
	}
	return k.update(ctx, c, m)
}

// update sets the action of a row matching the person m within the scope: update when it changes the name, the
// e-mail, the phone, the home unit or adds a work function, else skip.
func (k *checker) update(ctx context.Context, c *checked, m match) error {
	c.Person = m.ID
	if !c.UnitSet {
		c.Unit = m.Home
	}
	if c.Function != "" {
		if err := k.checkProfile(ctx, c, m); err != nil {
			return err
		}
		if len(c.Errors) > 0 {
			c.Action = accessapi.Error
			c.Person = uuid.Nil
			return nil
		}
	}
	changed := c.Data.FullName != m.Name || (c.Email != "" && c.Email != m.Email) ||
		(c.Phone != "" && c.Phone != m.Phone) || c.Unit != m.Home
	c.Action = accessapi.Skip
	if changed || c.NewProfile {
		c.Action = accessapi.Update
	}
	return nil
}

// reject turns the row into the error of a hidden match.
func (k *checker) reject(c *checked) {
	c.fail(fieldRow, codeInvalidRow, textInvalidRow)
	c.Action = accessapi.Error
	c.Person = uuid.Nil
}

// checkProfile decides whether an update adds the work function: not when the person already has it at some
// moment from the start on; a driver function of a person with earnings is an error.
func (k *checker) checkProfile(ctx context.Context, c *checked, m match) error {
	var has bool
	if err := k.q.QueryRow(ctx, `select exists (select 1 from people.work_profiles
		where person_id = $1 and function = $2 and valid && tstzrange($3::timestamptz, null))`,
		m.ID, c.Function, *c.From).Scan(&has); err != nil {
		return err
	}
	if has {
		return nil
	}
	c.NewProfile = true
	if c.Function != kit.FunctionDriver {
		return nil
	}
	owner, err := k.isOwner(ctx, m.Membership)
	if err != nil {
		return err
	}
	conflict, err := kit.DriverConflict(ctx, k.q, m.ID, owner, *c.From, nil)
	if err != nil {
		return err
	}
	if conflict {
		c.fail(colWorkProfile, kit.CodeSeparationOfDuties, textSoD)
		c.NewProfile = false
	}
	return nil
}

func (k *checker) isOwner(ctx context.Context, membership *uuid.UUID) (bool, error) {
	if membership == nil || k.dir == nil {
		return false, nil
	}
	ms, err := k.dir.Memberships(ctx, k.tc.TenantID, []uuid.UUID{*membership})
	if err != nil {
		return false, err
	}
	return ms[*membership].Owner, nil
}

// totals counts the rows by action.
func totals(rows []checked, invited int64) accessapi.PeopleImportTotals {
	t := accessapi.PeopleImportTotals{Rows: int64(len(rows)), Invited: invited}
	for _, c := range rows {
		switch c.Action {
		case accessapi.Create:
			t.Create++
		case accessapi.Update:
			t.Update++
		case accessapi.Skip:
			t.Skip++
		case accessapi.Error:
			t.Error++
		}
	}
	return t
}
