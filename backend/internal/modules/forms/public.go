package forms

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"reflect"
	"strconv"
	"time"

	"github.com/google/uuid"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	pfapi "github.com/ortus/ortus-crm/backend/internal/api/publicforms"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Links is the control index of the public links (control 0009 public_form_links, Q-W4.05-22): the route of a guest
// from the digest of his token to the tenant.
type Links interface {
	// Issue writes the index row of a new link (before the row of the tenant).
	Issue(ctx context.Context, l Link) error
	// Drop deletes the index row of a link whose row of the tenant was not written.
	Drop(ctx context.Context, digest string) error
	// Find is the active link of digest of an active tenant (false — none).
	Find(ctx context.Context, digest string) (Link, bool, error)
}

// Link is a row of the control index with the name of its organization.
type Link struct {
	Digest           string
	Tenant, Form, ID uuid.UUID
	KeyVersion       int
	TenantName       string
}

// Uploads is the port of the module of files for the uploads of a guest (purpose form_attachment, the parent
// forms/form): the capability is checked by the module of forms, the module of files owns the session and the scan.
type Uploads interface {
	Initiate(ctx context.Context, tenant, actor, form uuid.UUID, u Upload) (pfapi.UploadTicket, error)
	Complete(ctx context.Context, tenant, actor, upload uuid.UUID, sha256 string) (pfapi.File, error)
	Status(ctx context.Context, tenant, actor, upload uuid.UUID) (pfapi.File, error)
}

// Upload is the file a guest uploads.
type Upload struct {
	FileName, ContentType, SHA256 string
	SizeBytes                     int64
}

// Limits of the uploads of a guest: the size of one file (FormSettings of the module forms, maxPublicUploadBytes) and
// the files of one nonce.
const (
	publicUploadMax   int64 = 10 << 20
	publicUploadFiles       = 20
)

// textLinksOff is 503 of a public link without the key of the server (prod without FORMS_PUBLIC_LINK_KEY).
const textLinksOff = "Публичные ссылки не настроены на сервере"

// issueLink gives a published public form its link when it has none (Q-W4.05-7): the index of the control DB first,
// then the row of the tenant; a failed command deletes the index row.
func (r *req) issueLink(ctx context.Context, f *formRow) error {
	if f.set.access != accessPublic || f.current == nil || f.publicLink != nil {
		return nil
	}
	key, ver, ok := r.s.Keys.current()
	if !ok || r.s.Links == nil {
		return problem.New(problem.CodeDependencyUnavailable, textLinksOff)
	}
	id := uuid.New()
	digest := tokenDigest(linkToken(key, r.tc.TenantID, id))
	if err := r.s.Links.Issue(ctx, Link{Digest: digest, Tenant: r.tc.TenantID, Form: f.id, ID: id, KeyVersion: ver}); err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	r.undo = append(r.undo, func(ctx context.Context) { _ = r.s.Links.Drop(ctx, digest) })
	if _, err := r.tx.Exec(ctx, `insert into forms.public_links (id, form_id, token_digest, key_version, created_by, created_at)
		values ($1, $2, $3, $4, $5, $6)`, id, f.id, digest, ver, nullID(r.me()), r.now); err != nil {
		return store("public link", err)
	}
	f.publicLink, f.publicKeyVer, f.publicDigest = &id, ver, digest
	return nil
}

// guest is the request of a guest: the link, the tenant and its transaction.
type guest struct {
	link Link
	r    *req
	f    *formRow
}

// guestMode is the transaction of a request of a guest.
type guestMode int

const (
	guestRead   guestMode = iota // a read-only snapshot
	guestSerial                  // read committed, the form not locked: the request locks what it serializes itself
	guestWrite                   // a command: the row of the form is locked
)

// asGuest runs fn for the public token: the index of the control DB, the tenant DB, the link of the tenant (not
// revoked, the same digest) and its form; an unknown, revoked or orphan token — 404 as unknown; a form no longer
// public — 410 public_token_expired.
func (s *Service) asGuest(ctx context.Context, token string, mode guestMode, fn func(*guest) error) error {
	if s.Links == nil {
		return problem.New(problem.CodeDependencyUnavailable, textLinksOff)
	}
	digest := tokenDigest(token)
	l, ok, err := s.Links.Find(ctx, digest)
	switch {
	case err != nil:
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	case !ok:
		return notFound("")
	}
	tc := tenantctx.TenantContext{TenantID: l.Tenant, Owner: false}
	return s.run(ctx, tc, mode != guestRead, func(r *req) error {
		var form uuid.UUID
		err := r.tx.QueryRow(ctx, `select form_id from forms.public_links where id = $1 and token_digest = $2 and revoked_at is null`,
			l.ID, digest).Scan(&form)
		switch {
		case noRows(err):
			return notFound("")
		case err != nil:
			return store("public link", err)
		}
		f, err := r.form(ctx, form, mode == guestWrite)
		if err != nil {
			return err
		}
		if f == nil || f.current == nil {
			return notFound("")
		}
		if f.set.access != accessPublic {
			return problem.New(codeExpired, "")
		}
		return fn(&guest{link: l, r: r, f: f})
	})
}

// PublicForm answers getPublicForm: the acting version cut for a guest (no scores, no defaults of hidden questions),
// the presentation and a nonce of submission.
func (s *Service) PublicForm(ctx context.Context, token string) (pfapi.PublicForm, error) {
	var out pfapi.PublicForm
	err := s.asGuest(ctx, token, guestRead, func(g *guest) error {
		r, f := g.r, g.f
		v, err := r.version(ctx, f.id, *f.current)
		if err != nil || v == nil {
			return orMissing(err)
		}
		closed, err := r.closedReason(ctx, f)
		if err != nil {
			return err
		}
		key, _, ok := s.Keys.current()
		if !ok {
			return problem.New(problem.CodeDependencyUnavailable, textLinksOff)
		}
		random := make([]byte, nonceRandom)
		s.random(random)
		exp := r.now.Add(nonceTTL)
		nonce := makeNonce(key, nonceClaims{tenant: g.link.Tenant, link: g.link.ID, version: v.number, exp: exp}, random)
		cut, err := guestDefinition(v.def)
		if err != nil {
			return err
		}
		out = pfapi.PublicForm{FormId: f.id, VersionId: v.id, Definition: cut, AcceptingResponses: !closed,
			UploadAllowed: s.Uploads != nil && hasPhoto(v.def), UploadMaxBytes: publicUploadMax, SubmissionNonce: nonce,
			NonceExpiresAt: exp, Presentation: &pfapi.PublicFormPresentation{Title: f.name, ProgressBar: f.set.extra.ProgressBar,
				BackButton: f.set.extra.BackButton, ConfirmationText: f.set.extra.ConfirmationText, ShowScore: f.set.extra.ShowScore}}
		if !out.UploadAllowed {
			out.UploadMaxBytes = 0
		}
		if f.set.extra.ShowLogo {
			out.Presentation.OrganizationName = new(g.link.TenantName)
		}
		return nil
	})
	return out, err
}

// random fills b with the random part of a nonce.
func (s *Service) random(b []byte) {
	if s.Random != nil {
		s.Random(b)
		return
	}
	_, _ = rand.Read(b) // crypto/rand never fails (Go 1.24+)
}

// hasPhoto reports whether d asks for files.
func hasPhoto(d def) bool {
	for _, x := range d.Fields {
		if x.Type == fapi.FormQuestionTypePhoto {
			return true
		}
	}
	return false
}

// guestDefinition is the definition of a version a guest receives (PublicForm.definition): the scores of the options
// and the defaults of the hidden questions removed — the server applies them.
func guestDefinition(d def) (pfapi.FormDefinitionV2, error) {
	c := cloneDef(d)
	for i := range c.Fields {
		x := &c.Fields[i]
		if x.Options != nil {
			for j := range *x.Options {
				(*x.Options)[j].Score = nil
			}
		}
		if deref(x.Hidden) {
			x.DefaultValue = nil
		}
	}
	var out pfapi.FormDefinitionV2
	return out, convert(c, &out)
}

// readGuestNonce checks the nonce of a guest for the link of g: a forged one or of another link — 422, an expired
// one — 410 nonce_used.
func (g *guest) readNonce(keys Keys, nonce string, now time.Time) (nonceClaims, error) {
	c, err := readNonceOf(keys, nonce, now)
	switch {
	case err == errNonceExpired: //nolint:errorlint // a sentinel of this package, never wrapped
		return c, problem.New(codeNonceUsed, textNonceExpired)
	case err != nil, c.link != g.link.ID, c.tenant != g.link.Tenant:
		return c, invalid("submissionNonce", textNonceInvalid)
	}
	return c, nil
}

// Texts of the nonce of a guest (no-reference).
const (
	textNonceExpired = "Страница формы устарела — откройте ссылку заново"
	textNonceInvalid = "Откройте форму по ссылке заново"
	textNonceUsed    = "Ответ с этой страницы уже отправлен"
)

// SubmitPublic answers submitPublicForm: the response of a guest by the nonce of the acting version — pending, the
// keys of the link parameters recorded; the nonce is single-use: a repeat of the same answers with it answers the
// receipt again (replayed), other answers — 410 nonce_used.
func (s *Service) SubmitPublic(ctx context.Context, token string, b pfapi.PublicResponseCreate) (pfapi.PublicResponseReceipt, bool, error) {
	var (
		out      pfapi.PublicResponseReceipt
		replayed bool
	)
	if _, _, ok := s.Keys.current(); !ok {
		return out, false, problem.New(problem.CodeDependencyUnavailable, textLinksOff)
	}
	err := s.asGuest(ctx, token, guestWrite, func(g *guest) error {
		r, f := g.r, g.f
		c, err := g.readNonce(s.Keys, b.SubmissionNonce, r.now)
		if err != nil {
			return err
		}
		var answers []fapi.FieldEntry
		if err := convert(b.Answers, &answers); err != nil {
			return invalid("answers", textWrongType)
		}
		dedup := nonceKey(b.SubmissionNonce)
		if prev, err := g.repeat(ctx, dedup, answers); err != nil || prev != nil {
			if prev != nil {
				out, replayed = pfapi.PublicResponseReceipt{ReceiptId: prev.id, SubmittedAt: prev.submittedAt, Message: thanks(f, prev)}, true
			}
			return err
		}
		if c.version != *f.current || b.VersionId != f.versionIDs[*f.current] {
			return conflict(reasonVersion, textVersionMoved)
		}
		in := submission{answers: answers, linkParams: b.LinkParams, channel: channelPublic, actor: nonceActor(b.SubmissionNonce),
			dedup: dedup}
		x, err := r.submit(ctx, f, in)
		if err != nil {
			return err
		}
		if err := r.flushNotices(ctx); err != nil {
			return err
		}
		out = pfapi.PublicResponseReceipt{ReceiptId: x.id, SubmittedAt: x.submittedAt, Message: thanks(f, x)}
		return nil
	})
	return out, replayed, err
}

// repeat is the response the nonce of dedup already made when answers repeat it (nil — the nonce is unused); other
// answers with a used nonce — 410 nonce_used.
func (g *guest) repeat(ctx context.Context, dedup string, answers []fapi.FieldEntry) (*responseRow, error) {
	prev, err := g.r.byDedup(ctx, g.f.id, dedup)
	if err != nil || prev == nil {
		return nil, err
	}
	same, err := g.r.sameAnswers(ctx, g.f, prev, answers)
	switch {
	case err != nil:
		return nil, err
	case !same:
		return nil, problemNonceUsed()
	}
	return prev, nil
}

// byDedup is the response of form with the key of deduplication key (nil — none).
func (r *req) byDedup(ctx context.Context, form uuid.UUID, key string) (*responseRow, error) {
	rs, err := r.responsesWhere(ctx, `x.form_id = $1 and x.dedup_key = $2`, form, key)
	if err != nil || len(rs) == 0 {
		return nil, err
	}
	return rs[0], nil
}

// sameJSON reports whether two JSON values are equal (jsonb of the database spaces them otherwise).
func sameJSON(a, b json.RawMessage) bool {
	var x, y any
	return json.Unmarshal(a, &x) == nil && json.Unmarshal(b, &y) == nil && reflect.DeepEqual(x, y)
}

// sameAnswers reports whether the answers of a guest repeat those of x exactly (return 1): every answer he sends is
// stored the same — an empty one or one to a question its condition hides is not stored — and every stored answer
// to a question he fills (not hidden: those are the link and the defaults) is sent again; a part of them is another
// submission.
func (r *req) sameAnswers(ctx context.Context, f *formRow, x *responseRow, in []fapi.FieldEntry) (bool, error) {
	es, convErr := fromAPI(in)
	if convErr != nil {
		return false, nil //nolint:nilerr // answers that do not decode repeat nothing: the nonce is used
	}
	v, err := r.version(ctx, f.id, x.version)
	if err != nil {
		return false, err
	}
	questions := map[string]question{}
	if v != nil {
		for _, q := range v.def.Fields {
			questions[q.Key] = q
		}
	}
	stored := answersOf(x.answers)
	sent := map[string]bool{}
	for _, e := range es {
		sent[e.FieldKey] = true
		if !storedAs(questions, stored, e) {
			return false, nil
		}
	}
	for k := range stored {
		if q, known := questions[k]; !sent[k] && (!known || !deref(q.Hidden)) {
			return false, nil
		}
	}
	return true, nil
}

// storedAs reports whether the sent answer e is what stored holds: the same value, or none for an empty answer and
// for a question its condition hides.
func storedAs(questions map[string]question, stored answers, e entry) bool {
	got, ok := stored[e.FieldKey]
	if !ok {
		q, known := questions[e.FieldKey]
		return isEmpty(&e.Value) || (known && !shown(q, stored))
	}
	return got.Type == e.Value.Type && sameJSON(got.Value, e.Value.Value)
}

// unused requires the nonce of a guest not to have made a response yet: its uploads end with the submission — 410
// nonce_used (return 1).
func (g *guest) unused(ctx context.Context, nonce string) error {
	prev, err := g.r.byDedup(ctx, g.f.id, nonceKey(nonce))
	if err != nil || prev != nil {
		if err == nil {
			err = problemNonceUsed()
		}
		return err
	}
	return nil
}

// thanks is the text after the submission with the result of a test when the form shows it.
func thanks(f *formRow, x *responseRow) string {
	msg := f.set.extra.ConfirmationText
	if x.score == nil || !f.set.extra.ShowScore {
		return msg
	}
	res := "Результат: " + strconv.Itoa(x.score.Points) + " из " + strconv.Itoa(x.score.MaxPoints) + " " +
		plural(x.score.MaxPoints, "балла", "баллов", "баллов")
	switch {
	case x.score.Passed == nil:
	case *x.score.Passed:
		res += " · тест пройден"
	default:
		res += " · нужно " + strconv.Itoa(deref(f.set.extra.PassScore)) + " для зачёта"
	}
	if msg == "" {
		return res
	}
	return msg + "\n" + res
}

// plural is pl of the reference («Формы и опросы.dc.html»: pl(n, a, b, c)): one — a, two to four — b, otherwise c.
func plural(n int, one, few, many string) string {
	m := n % 100
	if m < 0 {
		m = -m
	}
	k := m % 10
	switch {
	case m > 10 && m < 20:
		return many
	case k > 1 && k < 5:
		return few
	case k == 1:
		return one
	}
	return many
}

// InitiateUpload answers initiatePublicUpload: a file of a question «Файл или фото» of the acting version, owned by
// the nonce.
func (s *Service) InitiateUpload(ctx context.Context, token string, b pfapi.PublicUploadCreate) (pfapi.UploadTicket, error) {
	var out pfapi.UploadTicket
	if _, _, ok := s.Keys.current(); !ok || s.Uploads == nil {
		return out, problem.New(problem.CodeDependencyUnavailable, textLinksOff)
	}
	err := s.asGuest(ctx, token, guestSerial, func(g *guest) error {
		r, f := g.r, g.f
		if err := g.mayUpload(ctx, s.Keys, b); err != nil {
			return err
		}
		actor := nonceActor(b.SubmissionNonce)
		// One initiation of a nonce at a time, until its upload is written (return 2): the next one counts it.
		if _, err := r.tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, "forms.public-upload:"+actor.String()); err != nil {
			return store("uploads", err)
		}
		var n int
		if err := r.tx.QueryRow(ctx, `select count(*) from files.objects where owner_type = 'forms.form' and owner_id = $1
			and uploaded_by = $2 and state <> 'rejected'`, f.id, actor).Scan(&n); err != nil {
			return store("uploads", err)
		}
		if n >= publicUploadFiles {
			return invalid("fieldKey", "Не больше "+strconv.Itoa(publicUploadFiles)+" файлов")
		}
		var err error
		out, err = s.Uploads.Initiate(ctx, g.link.Tenant, actor, f.id, Upload{FileName: b.FileName, ContentType: b.ContentType,
			SHA256: b.Sha256, SizeBytes: b.SizeBytes})
		return err
	})
	return out, err
}

// mayUpload checks an upload of a guest before the module of files: the nonce of the acting version not used by a
// response yet, the form accepting, a question «Файл или фото», the size.
func (g *guest) mayUpload(ctx context.Context, keys Keys, b pfapi.PublicUploadCreate) error {
	r, f := g.r, g.f
	c, err := g.readNonce(keys, b.SubmissionNonce, r.now)
	if err != nil {
		return err
	}
	if err := g.unused(ctx, b.SubmissionNonce); err != nil {
		return err
	}
	if c.version != *f.current || b.VersionId != f.versionIDs[*f.current] {
		return conflict(reasonVersion, textVersionMoved)
	}
	if closed, err := r.closedReason(ctx, f); err != nil || closed {
		if err == nil {
			err = conflict(reasonClosed, textClosed)
		}
		return err
	}
	if err := g.uploadField(ctx, b.FieldKey); err != nil {
		return err
	}
	if b.SizeBytes > publicUploadMax {
		return problem.New("payload_too_large", "Файл больше 10 МБ.")
	}
	return nil
}

// uploadField requires key to be a question «Файл или фото» of the acting version (not hidden).
func (g *guest) uploadField(ctx context.Context, key string) error {
	v, err := g.r.version(ctx, g.f.id, *g.f.current)
	if err != nil || v == nil {
		return orMissing(err)
	}
	for _, x := range v.def.Fields {
		if x.Key == key && x.Type == fapi.FormQuestionTypePhoto && !deref(x.Hidden) {
			return nil
		}
	}
	return invalid("fieldKey", textQuestionGone)
}

// CompleteUpload answers completePublicUpload: only the upload of the nonce, before its response is sent.
func (s *Service) CompleteUpload(ctx context.Context, token string, upload uuid.UUID, b pfapi.PublicUploadComplete) (pfapi.File, error) {
	var out pfapi.File
	if _, _, ok := s.Keys.current(); !ok || s.Uploads == nil {
		return out, problem.New(problem.CodeDependencyUnavailable, textLinksOff)
	}
	err := s.asGuest(ctx, token, guestRead, func(g *guest) error {
		if _, err := g.readNonce(s.Keys, b.SubmissionNonce, g.r.now); err != nil {
			return err
		}
		if err := g.unused(ctx, b.SubmissionNonce); err != nil {
			return err
		}
		var err error
		out, err = s.Uploads.Complete(ctx, g.link.Tenant, nonceActor(b.SubmissionNonce), upload, b.Sha256)
		return err
	})
	return out, err
}

// UploadStatus answers getPublicUploadStatus: only the upload of the nonce.
func (s *Service) UploadStatus(ctx context.Context, token string, upload uuid.UUID, b pfapi.PublicUploadStatusQuery) (pfapi.File, error) {
	var out pfapi.File
	if _, _, ok := s.Keys.current(); !ok || s.Uploads == nil {
		return out, problem.New(problem.CodeDependencyUnavailable, textLinksOff)
	}
	err := s.asGuest(ctx, token, guestRead, func(g *guest) error {
		if _, err := g.readNonce(s.Keys, b.SubmissionNonce, g.r.now); err != nil {
			return err
		}
		var err error
		out, err = s.Uploads.Status(ctx, g.link.Tenant, nonceActor(b.SubmissionNonce), upload)
		return err
	})
	return out, err
}
