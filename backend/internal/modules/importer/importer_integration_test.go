//go:build integration

package importer

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: the clock of the fixtures
)

func preview(ctx context.Context, t *testing.T, e env, unit uuid.UUID, csv string) (accessapi.CreatePeopleImport201JSONResponse, error) {
	t.Helper()
	resp, err := e.srv.CreatePeopleImport(ctx, accessapi.CreatePeopleImportRequestObject{
		TenantId: tenantA(t), Body: &accessapi.PeopleImportCreate{FileName: "people.csv", Csv: csv, DefaultOrgUnitId: unit},
	})
	if err != nil {
		return accessapi.CreatePeopleImport201JSONResponse{}, err
	}
	ok, is := resp.(accessapi.CreatePeopleImport201JSONResponse)
	require.True(t, is, "%T", resp)
	return ok, nil
}

func get(ctx context.Context, t *testing.T, e env, imp uuid.UUID) (accessapi.GetPeopleImport200JSONResponse, error) {
	t.Helper()
	resp, err := e.srv.GetPeopleImport(ctx, accessapi.GetPeopleImportRequestObject{TenantId: tenantA(t), ImportId: imp})
	if err != nil {
		return accessapi.GetPeopleImport200JSONResponse{}, err
	}
	ok, is := resp.(accessapi.GetPeopleImport200JSONResponse)
	require.True(t, is, "%T", resp)
	return ok, nil
}

func commit(ctx context.Context, t *testing.T, e env, imp uuid.UUID, ifMatch string, skip, invite bool) (accessapi.CommitPeopleImport200JSONResponse, error) {
	t.Helper()
	resp, err := e.srv.CommitPeopleImport(ctx, accessapi.CommitPeopleImportRequestObject{
		TenantId: tenantA(t), ImportId: imp, Params: accessapi.CommitPeopleImportParams{IfMatch: ifMatch},
		Body: &accessapi.PeopleImportCommit{SkipInvalidRows: skip, SendInvitations: invite},
	})
	if err != nil {
		return accessapi.CommitPeopleImport200JSONResponse{}, err
	}
	ok, is := resp.(accessapi.CommitPeopleImport200JSONResponse)
	require.True(t, is, "%T", resp)
	return ok, nil
}

func row(t *testing.T, p accessapi.PeopleImport, line int64) accessapi.PeopleImportRow {
	t.Helper()
	for _, r := range p.Rows {
		if r.Line == line {
			return r
		}
	}
	t.Fatalf("no row %d", line)
	return accessapi.PeopleImportRow{}
}

func codes(r accessapi.PeopleImportRow) []string {
	out := make([]string, 0, len(r.Errors))
	for _, v := range r.Errors {
		out = append(out, v.Field+":"+v.Code)
	}
	return out
}

func suffix() string { return uuid.NewString()[:8] }

// phone is a random Russian mobile number.
func phone() string { return fmt.Sprintf("+7 900 %07d", uuid.New().ID()%10000000) }

func TestPreviewAndCommit(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	owner := e.as(t, "a.owner")
	msk1, msk2 := id(t, "unit:a.msk1"), id(t, "unit:a.msk2")
	s := suffix()
	csv := strings.Join([]string{
		"full_name;email;phone;org_unit;work_profile;valid_from",
		"Новый Водитель " + s + ";new." + s + "@alta.example;;;driver;",                 // 2 create
		"Водитель Москва-1 переименован " + s + ";iso-a.driver-msk1@isolation.test;;;;", // 3 update (name)
		"Владелец Холдинга;iso-a.owner@isolation.test;;;;",                              // 4 skip (no change)
		"Плохая почта;bad;;;;",                                                          // 5 error
		"Прораб Москва-2 " + s + ";;" + phone() + ";Москва-2;foreman;",                  // 6 create in Москва-2 by name
		"Повтор;NEW." + s + "@ALTA.EXAMPLE;;;;",                                         // 7 duplicate of row 2
		"Нет фирмы;;;Казань;;",                                                          // 8 unknown unit
	}, "\n")
	got, err := preview(owner, t, e, msk1, csv)
	require.NoError(t, err)
	p := got.Body
	assert.Equal(t, accessapi.PeopleImportStatePreviewed, p.State)
	assert.Equal(t, "people.csv", p.FileName)
	assert.Equal(t, msk1, p.DefaultOrgUnitId)
	assert.Equal(t, kit.ETag(p.Revision), *got.Headers.ETag)
	assert.True(t, p.ExpiresAt.Equal(harness.Now().Add(24*time.Hour)), "a preview lives a day")
	assert.Equal(t, accessapi.PeopleImportTotals{Rows: 7, Create: 2, Update: 1, Skip: 1, Error: 3}, p.Totals)

	r2 := row(t, p, 2)
	assert.Equal(t, accessapi.Create, r2.Action)
	assert.Equal(t, &msk1, r2.OrgUnitId, "the default unit")
	assert.Nil(t, r2.MemberId)
	assert.Equal(t, accessapi.Update, row(t, p, 3).Action)
	assert.Equal(t, id(t, "person:a.driver-msk1@a"), *row(t, p, 3).MemberId)
	assert.Equal(t, accessapi.Skip, row(t, p, 4).Action)
	assert.Contains(t, codes(row(t, p, 5)), "email:format")
	assert.Equal(t, &msk2, row(t, p, 6).OrgUnitId)
	assert.Contains(t, codes(row(t, p, 7)), "email:duplicate")
	assert.Contains(t, codes(row(t, p, 8)), "org_unit:unknown")

	fetched, err := get(owner, t, e, p.Id)
	require.NoError(t, err)
	assert.Equal(t, p, fetched.Body)

	_, err = commit(owner, t, e, p.Id, "", true, false)
	assert.True(t, problem.Is(err, kit.CodeRevisionRequired), "%v", err)
	_, err = commit(owner, t, e, p.Id, kit.ETag(p.Revision+1), true, false)
	assert.True(t, problem.Is(err, kit.CodeRevisionMismatch), "%v", err)
	_, err = commit(owner, t, e, p.Id, kit.ETag(p.Revision), false, false)
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "errors without skipInvalidRows: %v", err)

	done, err := commit(owner, t, e, p.Id, kit.ETag(p.Revision), true, false)
	require.NoError(t, err)
	c := done.Body
	assert.Equal(t, accessapi.PeopleImportStateCommitted, c.State)
	require.NotNil(t, c.CommittedAt)
	assert.Equal(t, accessapi.PeopleImportTotals{Rows: 7, Create: 2, Update: 1, Skip: 1, Error: 3}, c.Totals)
	created := row(t, c, 2).MemberId
	require.NotNil(t, created, "the created person is in the result")

	pool := e.pool(t)
	var name string
	var membership *uuid.UUID
	require.NoError(t, pool.QueryRow(t.Context(), `select full_name, membership_id from people.person_profiles where id = $1`, *created).Scan(&name, &membership))
	assert.Equal(t, "Новый Водитель "+s, name)
	assert.Nil(t, membership, "a card without an account")
	var fn string
	require.NoError(t, pool.QueryRow(t.Context(), `select function from people.work_profiles where person_id = $1`, *created).Scan(&fn))
	assert.Equal(t, "driver", fn)
	require.NoError(t, pool.QueryRow(t.Context(), `select full_name from people.person_profiles where id = $1`,
		id(t, "person:a.driver-msk1@a")).Scan(&name))
	assert.Equal(t, "Водитель Москва-1 переименован "+s, name)

	_, err = commit(owner, t, e, p.Id, *done.Headers.ETag, true, false)
	assert.True(t, problem.Is(err, kit.CodeInvalidTransition), "a committed import: %v", err)
}

func TestPreviewHidesPeopleOutsideScope(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	hr, _ := e.hr(t, "unit:a.msk1")
	msk1 := id(t, "unit:a.msk1")
	s := suffix()
	csv := "full_name,email,org_unit\n" +
		"Водитель Москва-2,iso-a.driver-msk2@isolation.test,\n" + // 2 a match in Москва-2: hidden
		"Водитель Москва-1 (импорт),iso-a.driver-msk1@isolation.test,\n" + // 3 a match in scope, a new name
		"Новый " + s + ",n." + s + "@alta.example,Москва-2\n" + // 4 a unit outside the scope
		"Новый " + s + ",m." + s + "@alta.example,Москва-1\n" // 5 a unit in scope
	got, err := preview(hr, t, e, msk1, csv)
	require.NoError(t, err)
	p := got.Body
	hidden := row(t, p, 2)
	assert.Equal(t, accessapi.Error, hidden.Action)
	assert.Nil(t, hidden.MemberId, "the match is not revealed")
	assert.Equal(t, []string{"row:invalid_row"}, codes(hidden))
	assert.Equal(t, accessapi.Update, row(t, p, 3).Action)
	assert.Equal(t, accessapi.Error, row(t, p, 4).Action)
	assert.Equal(t, []string{"org_unit:unknown"}, codes(row(t, p, 4)), "outside the scope — like an unknown unit")
	assert.Equal(t, accessapi.Create, row(t, p, 5).Action)
	for _, r := range p.Rows {
		for _, v := range r.Errors {
			assert.NotContains(t, v.Message, "Москва-2")
		}
	}

	// The default unit must be in the scope: an invisible one is 422, like an unknown one.
	_, err = preview(hr, t, e, id(t, "unit:a.msk2"), "full_name\nИван\n")
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "%v", err)
	_, err = preview(hr, t, e, uuid.New(), "full_name\nИван\n")
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "%v", err)
	// A manager without members.manage sees Москва-1 but cannot import there.
	_, err = preview(e.as(t, "a.manager-msk1"), t, e, msk1, "full_name\nИван\n")
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "%v", err)

	// Another actor with the same scope reads the import; an actor outside it gets 404.
	_, err = get(e.as(t, "a.owner"), t, e, p.Id)
	require.NoError(t, err)
	hrSmr, _ := e.hr(t, "unit:a.smr")
	_, err = get(hrSmr, t, e, p.Id)
	assert.True(t, problem.Is(err, problem.CodeNotFound), "%v", err)
	_, err = get(hr, t, e, uuid.New())
	assert.True(t, problem.Is(err, problem.CodeNotFound), "%v", err)
}

func TestCommitRechecksScope(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	hr, _ := e.hr(t, "unit:a.msk1")
	s := suffix()
	email := "late." + s + "@alta.example"
	got, err := preview(hr, t, e, id(t, "unit:a.msk1"), "full_name,email\nПоздний "+s+","+email+"\n")
	require.NoError(t, err)
	assert.Equal(t, accessapi.Create, row(t, got.Body, 2).Action)

	// Before the commit somebody adds a person with the same e-mail in Самара, outside the scope of hr.
	_, err = e.pool(t).Exec(t.Context(), `insert into people.person_profiles (full_name, email, home_unit_id) values ($1, $2, $3)`,
		"Поздний в Самаре", email, id(t, "unit:a.smr1"))
	require.NoError(t, err)

	_, err = commit(hr, t, e, got.Body.Id, *got.Headers.ETag, false, false)
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "the row became an error: %v", err)
	done, err := commit(hr, t, e, got.Body.Id, *got.Headers.ETag, true, false)
	require.NoError(t, err)
	r := row(t, done.Body, 2)
	assert.Equal(t, accessapi.Error, r.Action)
	assert.Equal(t, []string{"row:invalid_row"}, codes(r))
	assert.Nil(t, r.MemberId)
	assert.Equal(t, int64(0), done.Body.Totals.Create)
}

// The owner is outside members.manage of every actor but an owner (createPeopleImport: «a match outside the
// members.manage scope of the actor (another unit, an owner, …) is a row error»): a non-owner with members.manage over
// the home unit of the owner neither sees nor changes the owner, and never sees the memberId of the owner.
func TestOwnerIsOutsideScope(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	hr, _ := e.hr(t, "unit:a.msk") // members.manage over Москва, the home unit of the owner
	msk, owner := id(t, "unit:a.msk"), id(t, "person:a.owner@a")
	// The same name and e-mail: the row changes nothing even before the fix, the fixture owner stays intact.
	csv := "full_name,email\nВладелец Холдинга,iso-a.owner@isolation.test\n"
	got, err := preview(hr, t, e, msk, csv)
	require.NoError(t, err)
	r := row(t, got.Body, 2)
	assert.Equal(t, accessapi.Error, r.Action, "a match with the owner is a row error")
	assert.Nil(t, r.MemberId, "the owner is not revealed")
	assert.Equal(t, []string{"row:invalid_row"}, codes(r))
	if assert.Len(t, r.Errors, 1) {
		assert.Equal(t, textInvalidRow, r.Errors[0].Message, "the same text as an invalid row")
	}

	done, err := commit(hr, t, e, got.Body.Id, *got.Headers.ETag, true, false)
	require.NoError(t, err)
	c := row(t, done.Body, 2)
	assert.Equal(t, accessapi.Error, c.Action, "the commit checks the owner again")
	assert.Nil(t, c.MemberId)

	// The owner imports themself: a skip with the memberId; another actor reading the import does not see it.
	own, err := preview(e.as(t, "a.owner"), t, e, msk, csv)
	require.NoError(t, err)
	mine := row(t, own.Body, 2)
	assert.Equal(t, accessapi.Skip, mine.Action)
	require.NotNil(t, mine.MemberId)
	assert.Equal(t, owner, *mine.MemberId)
	seen, err := get(hr, t, e, own.Body.Id)
	require.NoError(t, err)
	assert.Nil(t, row(t, seen.Body, 2).MemberId, "the memberId of the owner is hidden from a non-owner")
}

func TestCommitDriverSeparationOfDuties(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	owner := e.as(t, "a.owner")
	s := suffix()
	email := "fin." + s + "@alta.example"
	pool := e.pool(t)
	var person uuid.UUID
	require.NoError(t, pool.QueryRow(t.Context(), `insert into people.person_profiles (full_name, email, home_unit_id)
		values ($1, $2, $3) returning id`, "Финансист "+s, email, id(t, "unit:a.msk1")).Scan(&person))
	_, err := pool.Exec(t.Context(), `insert into access.group_members (group_id, person_id) values ($1, $2)`, id(t, "group:a.finance"), person)
	require.NoError(t, err)

	got, err := preview(owner, t, e, id(t, "unit:a.msk1"), "full_name,email,work_profile\nФинансист "+s+","+email+",driver\n")
	require.NoError(t, err)
	r := row(t, got.Body, 2)
	assert.Equal(t, accessapi.Error, r.Action)
	assert.Equal(t, []string{"work_profile:separation_of_duties_conflict"}, codes(r))
}

func TestExpiredPreview(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	got, err := preview(e.as(t, "a.owner"), t, e, id(t, "unit:a.msk1"), "full_name\nИван "+suffix()+"\n")
	require.NoError(t, err)

	later := newEnv(t, 25*time.Hour)
	owner := later.as(t, "a.owner")
	fetched, err := get(owner, t, later, got.Body.Id)
	require.NoError(t, err)
	assert.Equal(t, accessapi.PeopleImportStateExpired, fetched.Body.State)
	_, err = commit(owner, t, later, got.Body.Id, *got.Headers.ETag, true, false)
	assert.True(t, problem.Is(err, kit.CodeInvalidTransition), "%v", err)
}

func TestSendInvitationsNeedsInviter(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	hr, _ := e.hr(t, "unit:a.msk1")
	got, err := preview(hr, t, e, id(t, "unit:a.msk1"), "full_name,email\nИван,ivan."+suffix()+"@alta.example\n")
	require.NoError(t, err)
	_, err = commit(hr, t, e, got.Body.Id, *got.Headers.ETag, true, true)
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "sendInvitations needs members.invite: %v", err)
	_, err = commit(e.as(t, "a.owner"), t, e, got.Body.Id, *got.Headers.ETag, true, true)
	assert.True(t, problem.Is(err, problem.CodeNotImplemented), "a server without an Inviter: %v", err)
}

func TestRejectsTheFile(t *testing.T) {
	t.Parallel()
	e := newEnv(t, 0)
	owner := e.as(t, "a.owner")
	_, err := preview(owner, t, e, id(t, "unit:a.msk1"), "full_name,salary\nИван,1\n")
	assert.True(t, problem.Is(err, kit.CodeValidationFailed), "%v", err)
	_, err = preview(owner, t, e, id(t, "unit:a.msk1"), "full_name\n"+strings.Repeat("Иван\n", MaxRows+1))
	assert.True(t, problem.Is(err, kit.CodePayloadTooLarge), "%v", err)
}

// TestPurge runs before the parallel tests: the purge deletes every preview older than its moment.
//
//nolint:paralleltest // the purge would delete the previews of the parallel tests
func TestPurge(t *testing.T) {
	e := newEnv(t, 0)
	owner := e.as(t, "a.owner")
	stale, err := preview(owner, t, e, id(t, "unit:a.msk1"), "full_name\nИван "+suffix()+"\n")
	require.NoError(t, err)
	old, err := preview(owner, t, e, id(t, "unit:a.msk1"), "full_name\nПётр "+suffix()+"\n")
	require.NoError(t, err)
	done, err := commit(owner, t, e, old.Body.Id, *old.Headers.ETag, true, false)
	require.NoError(t, err)
	fresh, err := preview(owner, t, e, id(t, "unit:a.msk1"), "full_name\nСемён "+suffix()+"\n")
	require.NoError(t, err)

	// A month and a day later: the uncommitted previews are gone, the rows of the committed import are deleted.
	at := harness.Now().Add(31 * 24 * time.Hour)
	res, err := Purge(t.Context(), e.pool(t), at)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, res.Expired, int64(2))
	assert.GreaterOrEqual(t, res.Purged, int64(1))

	later := newEnv(t, 31*24*time.Hour)
	ctx := later.as(t, "a.owner")
	for _, gone := range []uuid.UUID{stale.Body.Id, fresh.Body.Id} {
		_, err := get(ctx, t, later, gone)
		assert.True(t, problem.Is(err, problem.CodeNotFound), "%v", err)
	}
	kept, err := get(ctx, t, later, old.Body.Id)
	require.NoError(t, err)
	assert.Empty(t, kept.Body.Rows)
	require.NotNil(t, kept.Body.RowsPurgedAt)
	assert.Equal(t, done.Body.Totals, kept.Body.Totals, "the totals stay")
	var rows int
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `select count(*) from people.import_rows where import_id = $1`, old.Body.Id).Scan(&rows))
	assert.Zero(t, rows)
}

// TestCreatePurges: a new import cleans the tenant up as well (the scheduled purge of the worker is not the only
// one). A preview past its expiry loses its rows (the personal data, Q-W0.08-5) at once, but its header stays
// a week: getPeopleImport shows state=expired and commitPeopleImport answers 409 (the contract), not 404.
//
//nolint:paralleltest // the purge would delete the previews of the parallel tests
func TestCreatePurges(t *testing.T) {
	e := newEnv(t, 0)
	stale, err := preview(e.as(t, "a.owner"), t, e, id(t, "unit:a.msk1"), "full_name\nИван "+suffix()+"\n")
	require.NoError(t, err)

	later := newEnv(t, 25*time.Hour)
	ctx := later.as(t, "a.owner")
	_, err = preview(ctx, t, later, id(t, "unit:a.msk1"), "full_name\nПётр "+suffix()+"\n")
	require.NoError(t, err)
	got, err := get(ctx, t, later, stale.Body.Id)
	require.NoError(t, err, "the header of an expired preview stays")
	assert.Equal(t, accessapi.PeopleImportStateExpired, got.Body.State)
	assert.Empty(t, got.Body.Rows, "the rows are deleted at the expiry")
	var rows int
	require.NoError(t, e.pool(t).QueryRow(t.Context(), `select count(*) from people.import_rows where import_id = $1`, stale.Body.Id).Scan(&rows))
	assert.Zero(t, rows)
	_, err = commit(ctx, t, later, stale.Body.Id, *stale.Headers.ETag, true, false)
	assert.True(t, problem.Is(err, kit.CodeInvalidTransition), "an expired import is 409: %v", err)

	// A week after the expiry the header is deleted too.
	_, err = Purge(t.Context(), e.pool(t), harness.Now().Add(PreviewTTL+7*24*time.Hour+time.Hour))
	require.NoError(t, err)
	_, err = get(ctx, t, later, stale.Body.Id)
	assert.True(t, problem.Is(err, problem.CodeNotFound), "%v", err)
}
