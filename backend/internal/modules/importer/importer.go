// Package importer is the CSV import of people with a preview (W1.05, S1-10). createPeopleImport parses the file
// and checks every row without changing data; the preview lives a day. commitPeopleImport checks the rows again
// against the current data and scopes of the actor and applies them in one transaction by If-Match: person
// profiles without accounts (S1-09) and work functions with their period. The raw file is not stored; the parsed
// rows of a committed import are deleted after 30 days, the rows of a preview at its expiry after a day and the
// header of an expired preview a week later (Purge, Q-W0.08-5, Q-W1.05-17, 152-FZ).
//
// Rows are checked against members.manage of the actor: a row whose unit is outside the scope is the same error as
// an unknown unit, and a row matching a person outside the scope is an error that names nobody (the contract).
package importer

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// PreviewTTL is how long an uncommitted preview lives.
const PreviewTTL = 24 * time.Hour

// ExpiredTTL is how long the header of an expired preview (without its rows) stays after the expiry: the import
// answers state=expired and 409 on commit instead of 404 (Q-W1.05-17).
const ExpiredTTL = 7 * 24 * time.Hour

// RowsTTL is how long the parsed rows of a committed import live (Q-W0.08-5).
const RowsTTL = 30 * 24 * time.Hour

// targetImport is the audit target type of an import.
const targetImport = "people.import"

// imports are the columns the scope predicate filters imports on: the default unit of the import.
var imports = authz.Columns{Unit: "i.default_unit_id"}

// persons are the columns of person profiles for the scope of members.manage.
var persons = authz.Columns{Unit: "p.home_unit_id", Persons: []string{"p.id"}}

// Invitee is a card of a commit to invite (sendInvitations): the person the row created, its e-mail, its home unit
// and the line of the file.
type Invitee struct {
	Person uuid.UUID
	Email  string
	Unit   uuid.UUID
	Line   int
}

// Inviter invites the people of a commit with sendInvitations (members.invite, Q-W1.05-10): the invitations of W1.03
// of the access module (assignments.Handler.InviteCards, wired by cmd/api). InviteCards runs fn — the commit — in a
// transaction of the tenant DB opened under the lock of the business in the control DB, invites the cards fn returns
// in the control transaction (seats for all of them, free e-mails), commits both databases and only then sends the
// letters (Q-W1.41-1). complete runs in the tenant transaction when no letter leaves the process (the outcome is stored
// with the effect); with a network SMTP the idempotency guard stores the outcome after the letters. It returns how
// many invitations got their letter.
type Inviter interface {
	InviteCards(ctx context.Context, tc tenantctx.TenantContext, fn func(tx pgx.Tx) ([]Invitee, error), complete func(tx pgx.Tx) error) (int, error)
}

// Server implements the people import operations of the tag Access.
type Server struct {
	Pools     kit.Pools
	Authz     kit.Authorizer
	Directory kit.Directory    // owners of the control DB (the driver function and the earnings)
	Inviter   Inviter          // the invitations of the access module (cmd/api, W1.43); nil: sendInvitations is 501
	Now       func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

func (s *Server) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// isDecision reports whether err is a denial of the evaluator rather than a failure.
func isDecision(err error) bool {
	return problem.Is(err, problem.CodeForbiddenAction) || problem.Is(err, problem.CodeNotFound) ||
		problem.Is(err, authz.CodeFunctionBlocked)
}

// dbError keeps Problem errors and hides everything else behind dependency_unavailable.
func dbError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

func rid(ctx context.Context) *string {
	id := requestid.FromContext(ctx)
	return &id
}

func noStore() *string {
	v := kit.NoStore
	return &v
}

// within is the evaluator of a commit over its own transaction (W1.43, Q-W1.47-3): the checks of the commit read the
// grants, the modules and the unit tree through tx and never take a second connection of the pool of the tenant while
// the commit holds its rows — and, with invitations, the tenant row of the control DB (W1.47). An authorizer that is
// not the evaluator of W1.04 (tests) is used as it is.
func within(az kit.Authorizer, tx pgx.Tx) kit.Authorizer {
	ev, ok := az.(*authz.Evaluator)
	if !ok {
		return az
	}
	cp := *ev
	src := authz.TxSource{Q: tx}
	cp.Source = src
	if ev.Units != nil {
		cp.Units = src
	}
	return &cp
}

// defaultUnit checks the default unit of an import and returns its zone: an unknown unit and a unit the actor
// cannot see are the same 422; a visible unit without members.manage is 403; an archived unit is 422.
func defaultUnit(ctx context.Context, az kit.Authorizer, tc tenantctx.TenantContext, q kit.Querier, id uuid.UUID) (*time.Location, error) {
	var (
		zone     string
		archived bool
	)
	err := q.QueryRow(ctx, `select time_zone, archived_at is not null from org.units where id = $1`, id).Scan(&zone, &archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, kit.Invalid(textUnknownUnit)
	}
	if err != nil {
		return nil, err
	}
	err = az.Permit(ctx, tc, actionManage, authz.Resource{Unit: id, ReadAction: actionUnitsRead})
	switch {
	case problem.Is(err, problem.CodeNotFound):
		return nil, kit.Invalid(textUnknownUnit)
	case err != nil:
		return nil, err
	case archived:
		return nil, kit.Invalid("Подразделение в архиве.")
	}
	return time.LoadLocation(zone)
}

// CreatePeopleImport implements accessapi.StrictServerInterface: parses the CSV and returns the row-by-row preview.
func (s *Server) CreatePeopleImport(ctx context.Context, req accessapi.CreatePeopleImportRequestObject) (accessapi.CreatePeopleImportResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	name := strings.TrimSpace(req.Body.FileName)
	if name == "" || utf8.RuneCountInString(name) > 255 {
		return nil, kit.Invalid("Укажите имя файла (до 255 символов).")
	}
	now := s.now()
	rows, err := s.checkFile(ctx, tc, req.Body.Csv, req.Body.DefaultOrgUnitId, now)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256([]byte(req.Body.Csv))
	h := header{
		ID: uuid.New(), State: string(accessapi.PeopleImportStatePreviewed), FileName: name,
		DefaultUnit: req.Body.DefaultOrgUnitId, CreatedAt: now, ExpiresAt: now.Add(PreviewTTL),
		Totals: totals(rows, 0), Revision: 1,
	}
	var body accessapi.PeopleImport
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		// The tenant is cleaned up on every import too, not only by the scheduled purge (Q-W0.08-5).
		if _, err := purge(ctx, tx, now); err != nil {
			return err
		}
		if err := insertImport(ctx, tx, h, sum[:], tc.PersonID, rows); err != nil {
			return err
		}
		if err := kit.Audit(ctx, tx, audit.Event{
			Action: "people.import.create", TargetType: targetImport, TargetID: h.ID, UnitID: h.DefaultUnit,
			Diff: map[string]any{"fileName": name, "totals": h.Totals},
		}); err != nil {
			return err
		}
		body = h.dto(rowsDTO(rows), now)
		return kit.Complete(ctx, tx, http.StatusCreated, kit.ETag(h.Revision), body)
	})
	if err != nil {
		return nil, dbError(err)
	}
	tag, replayed := kit.ETag(h.Revision), false
	return accessapi.CreatePeopleImport201JSONResponse{
		Body: body,
		Headers: accessapi.CreatePeopleImport201ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

// checkFile parses the file and checks every row against the database and the scope of the actor.
func (s *Server) checkFile(ctx context.Context, tc tenantctx.TenantContext, csv string, def uuid.UUID, now time.Time) ([]checked, error) {
	recs, err := parse(csv)
	if err != nil {
		return nil, err
	}
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	loc, err := defaultUnit(ctx, s.Authz, tc, pool, def)
	if err != nil {
		return nil, dbError(err)
	}
	rows := make([]checked, 0, len(recs))
	for _, r := range recs {
		rows = append(rows, checkStatic(r, now, loc))
	}
	if err := newChecker(tc, s.Authz, s.Directory, pool, def).check(ctx, rows); err != nil {
		return nil, dbError(err)
	}
	return rows, nil
}

// GetPeopleImport implements accessapi.StrictServerInterface: an import whose default unit is in the scope of
// members.manage of the actor, else 404. memberId is shown only for people within that scope.
func (s *Server) GetPeopleImport(ctx context.Context, req accessapi.GetPeopleImportRequestObject) (accessapi.GetPeopleImportResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	c, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	h, err := s.visible(ctx, c, req.ImportId)
	if err != nil {
		return nil, dbError(err)
	}
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	rows, err := loadRows(ctx, pool, h.ID)
	if err != nil {
		return nil, dbError(err)
	}
	if err := hideOthers(ctx, c, rows); err != nil {
		return nil, dbError(err)
	}
	if !tc.Owner {
		if err := hideOwners(ctx, pool, s.Directory, tc.TenantID, rows); err != nil {
			return nil, dbError(err)
		}
	}
	tag := kit.ETag(h.Revision)
	return accessapi.GetPeopleImport200JSONResponse{
		Body:    h.dto(rows, s.now()),
		Headers: accessapi.GetPeopleImport200ResponseHeaders{CacheControl: noStore(), ETag: &tag, XRequestId: rid(ctx)},
	}, nil
}

// visible reads the header of an import in the scope of members.manage over its default unit.
func (s *Server) visible(ctx context.Context, c *scopeddb.Conn, id uuid.UUID) (header, error) {
	var h header
	err := c.One(ctx, actionManage, imports, func(r pgx.Row) error {
		var err error
		h, err = scanHeader(r)
		return err
	}, headerSelect+` where i.id = $1 and {{scope}}`, id)
	return h, err
}

// hideOthers removes memberId of the rows whose person is outside members.manage of the actor.
func hideOthers(ctx context.Context, c *scopeddb.Conn, rows []accessapi.PeopleImportRow) error {
	var ids []uuid.UUID
	for _, r := range rows {
		if r.MemberId != nil {
			ids = append(ids, *r.MemberId)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	res, err := c.Query(ctx, actionManage, persons, `select p.id from people.person_profiles p where p.id = any($1) and {{scope}}`, ids)
	if err != nil {
		return err
	}
	mine, err := pgx.CollectRows(res, pgx.RowTo[uuid.UUID])
	if err != nil {
		return err
	}
	in := map[uuid.UUID]bool{}
	for _, id := range mine {
		in[id] = true
	}
	for i := range rows {
		if rows[i].MemberId != nil && !in[*rows[i].MemberId] {
			rows[i].MemberId = nil
		}
	}
	return nil
}

// hideOwners removes memberId of the rows whose person is an owner: an owner is outside members.manage of every
// actor but an owner (createPeopleImport), though an import of an owner may have matched one.
func hideOwners(ctx context.Context, q kit.Querier, dir kit.Directory, tenant uuid.UUID, rows []accessapi.PeopleImportRow) error {
	var ids []uuid.UUID
	for _, r := range rows {
		if r.MemberId != nil {
			ids = append(ids, *r.MemberId)
		}
	}
	if len(ids) == 0 || dir == nil {
		return nil
	}
	res, err := q.Query(ctx, `select id, membership_id from people.person_profiles where id = any($1) and membership_id is not null`, ids)
	if err != nil {
		return err
	}
	type link struct{ Person, Membership uuid.UUID }
	links, err := pgx.CollectRows(res, pgx.RowToStructByPos[link])
	if err != nil {
		return err
	}
	memberships := make([]uuid.UUID, 0, len(links))
	for _, l := range links {
		memberships = append(memberships, l.Membership)
	}
	ms, err := dir.Memberships(ctx, tenant, memberships)
	if err != nil {
		return err
	}
	owners := map[uuid.UUID]bool{}
	for _, l := range links {
		owners[l.Person] = ms[l.Membership].Owner
	}
	for i := range rows {
		if rows[i].MemberId != nil && owners[*rows[i].MemberId] {
			rows[i].MemberId = nil
		}
	}
	return nil
}

// CommitPeopleImport implements accessapi.StrictServerInterface: applies a preview by If-Match in one transaction
// after checking every row again. Rows with errors are skipped only with skipInvalidRows (else 422); a committed or
// expired import is 409; sendInvitations needs members.invite and the invitation service.
func (s *Server) CommitPeopleImport(ctx context.Context, req accessapi.CommitPeopleImportRequestObject) (accessapi.CommitPeopleImportResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	c, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	h, err := s.visible(ctx, c, req.ImportId)
	if err != nil {
		return nil, dbError(err)
	}
	if req.Body.SendInvitations {
		if err := s.Authz.Permit(ctx, tc, actionInvite, authz.Resource{Unit: h.DefaultUnit}); err != nil {
			if problem.Is(err, problem.CodeNotFound) {
				return nil, problem.New(problem.CodeForbiddenAction, "")
			}
			return nil, err
		}
		if s.Inviter == nil {
			return nil, problem.New(problem.CodeNotImplemented, "Приглашения из файла появятся вместе с сервисом приглашений.")
		}
	}
	now := s.now()
	var body accessapi.PeopleImport
	if req.Body.SendInvitations {
		body, err = s.commitInviting(ctx, tc, h.ID, req, now)
	} else {
		err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
			var err error
			if body, _, err = s.commit(ctx, tc, tx, h.ID, req, now, false); err != nil {
				return err
			}
			return kit.Complete(ctx, tx, http.StatusOK, kit.ETag(body.Revision), body)
		})
	}
	if err != nil {
		return nil, dbError(err)
	}
	// The people of the rows are within the scope of the actor by the checks of the commit: no row to hide.
	tag, replayed := kit.ETag(body.Revision), false
	return accessapi.CommitPeopleImport200JSONResponse{
		Body: body,
		Headers: accessapi.CommitPeopleImport200ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

// commitInviting is the commit with sendInvitations (W1.43, Q-W1.05-10): the Inviter runs it under the lock of the
// business in the control DB, invites the cards it created with an e-mail and sends the letters after both databases
// commit. totals.invited is the number of letters sent: a failed letter withdraws its invitation, and the stored totals
// are corrected after the letters (the revision of the import stays). Without letters over the network the outcome is
// stored in the transaction of the commit; with them the idempotency guard stores it after the letters.
func (s *Server) commitInviting(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, req accessapi.CommitPeopleImportRequestObject, now time.Time) (accessapi.PeopleImport, error) {
	var (
		body     accessapi.PeopleImport
		invitees []Invitee
	)
	sent, err := s.Inviter.InviteCards(ctx, tc, func(tx pgx.Tx) ([]Invitee, error) {
		var err error
		body, invitees, err = s.commit(ctx, tc, tx, id, req, now, true)
		return invitees, err
	}, func(tx pgx.Tx) error {
		return kit.Complete(ctx, tx, http.StatusOK, kit.ETag(body.Revision), body)
	})
	if err != nil || sent == len(invitees) {
		return body, err
	}
	body.Totals.Invited = int64(sent)
	done := context.WithoutCancel(ctx) // the import is committed and its letters are sent: the client may be gone
	err = kit.Tx(done, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		_, err := tx.Exec(done, `update people.imports set totals = $2 where id = $1`, id, body.Totals)
		return err
	})
	return body, err
}

// commit re-checks and applies the rows of the locked import id in tx; with invite it returns the cards it created
// with an e-mail (sendInvitations), counted in totals.invited.
func (s *Server) commit(ctx context.Context, tc tenantctx.TenantContext, tx pgx.Tx, id uuid.UUID, req accessapi.CommitPeopleImportRequestObject, now time.Time, invite bool) (accessapi.PeopleImport, []Invitee, error) {
	h, err := lockPreview(ctx, tx, id, req.Params.IfMatch, now)
	if err != nil {
		return accessapi.PeopleImport{}, nil, err
	}
	az := within(s.Authz, tx)
	loc, err := defaultUnit(ctx, az, tc, tx, h.DefaultUnit)
	if err != nil {
		return accessapi.PeopleImport{}, nil, err
	}
	rows, err := recheck(ctx, tx, h.ID, now, loc, newChecker(tc, az, s.Directory, tx, h.DefaultUnit))
	if err != nil {
		return accessapi.PeopleImport{}, nil, err
	}
	t := totals(rows, 0)
	if t.Error > 0 && !req.Body.SkipInvalidRows {
		return accessapi.PeopleImport{}, nil, kit.Invalid(fmt.Sprintf(
			"В файле есть строки с ошибками: %d. Исправьте их или примените импорт без них.", t.Error))
	}
	profiles, err := apply(ctx, tx, rows)
	if err != nil {
		return accessapi.PeopleImport{}, nil, err
	}
	if profiles > 0 {
		if err := kit.BumpPolicy(ctx, tx); err != nil {
			return accessapi.PeopleImport{}, nil, err
		}
	}
	var invitees []Invitee
	if invite {
		invitees = inviteesOf(rows)
		t.Invited = int64(len(invitees))
	}
	h.State, h.Totals, h.CommittedAt = string(accessapi.PeopleImportStateCommitted), t, &now
	if h, err = finishImport(ctx, tx, h, tc.PersonID, rows); err != nil {
		return accessapi.PeopleImport{}, nil, err
	}
	if err := kit.Audit(ctx, tx, audit.Event{
		Action: "people.import.commit", TargetType: targetImport, TargetID: h.ID, UnitID: h.DefaultUnit,
		Sensitivity: audit.Sensitive, Diff: map[string]any{"totals": t, "workProfiles": profiles},
	}); err != nil {
		return accessapi.PeopleImport{}, nil, err
	}
	return h.dto(rowsDTO(rows), now), invitees, nil
}

// inviteesOf are the cards a commit created with an e-mail: only they are invited (the mock invites the created rows;
// a row without an e-mail is a card without an account, a matched person is never invited by an import).
func inviteesOf(rows []checked) []Invitee {
	var out []Invitee
	for _, c := range rows {
		if c.Action == accessapi.Create && c.Email != "" && c.Person != uuid.Nil {
			out = append(out, Invitee{Person: c.Person, Email: c.Email, Unit: c.Unit, Line: c.Line})
		}
	}
	return out
}

// lockPreview locks the import id in tx and checks that it is a live preview at the revision of If-Match.
func lockPreview(ctx context.Context, tx pgx.Tx, id uuid.UUID, ifMatch string, now time.Time) (header, error) {
	h, err := scanHeader(tx.QueryRow(ctx, headerSelect+` where i.id = $1 for update`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return header{}, problem.New(problem.CodeNotFound, "")
	}
	if err != nil {
		return header{}, err
	}
	if err := kit.CheckRevision(ifMatch, h.Revision); err != nil {
		return header{}, err
	}
	switch {
	case h.State == string(accessapi.PeopleImportStateCommitted):
		return header{}, kit.Conflict("Импорт уже применён.")
	case !now.Before(h.ExpiresAt):
		return header{}, kit.Conflict("Предпросмотр устарел. Загрузите файл заново.")
	}
	return h, nil
}

// recheck reads the stored rows of an import and checks them again against the current data and scopes.
func recheck(ctx context.Context, tx pgx.Tx, id uuid.UUID, now time.Time, loc *time.Location, k *checker) ([]checked, error) {
	res, err := tx.Query(ctx, `select line, data from people.import_rows where import_id = $1 order by line`, id)
	if err != nil {
		return nil, err
	}
	defer res.Close()
	var rows []checked
	for res.Next() {
		var (
			line int
			raw  []byte
			d    storedData
		)
		if err := res.Scan(&line, &raw); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &d); err != nil {
			return nil, err
		}
		rows = append(rows, checkStatic(d.record(line), now, loc))
	}
	if err := res.Err(); err != nil {
		return nil, err
	}
	return rows, k.check(ctx, rows)
}
