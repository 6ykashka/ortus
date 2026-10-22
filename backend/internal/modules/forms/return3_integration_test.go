//go:build integration

package forms

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// queryCounter counts the queries of a pool (pgx.QueryTracer).
type queryCounter struct{ n atomic.Int64 }

func (c *queryCounter) TraceQueryStart(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryStartData) context.Context {
	c.n.Add(1)
	return ctx
}

func (*queryCounter) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// countedPools is the database of tenant A over a pool of its own whose queries the counter counts.
type countedPools struct{ pool *pgxpool.Pool }

func (p countedPools) For(context.Context, uuid.UUID) (*pgxpool.Pool, error) { return p.pool, nil }

// countedService is the module over a pool of tenant A of its own and the counter of its queries.
func countedService(t *testing.T) (*Service, *queryCounter) {
	t.Helper()
	base, err := pools.For(t.Context(), ref("tenant:a"))
	require.NoError(t, err)
	cfg, c := base.Config(), &queryCounter{}
	cfg.ConnConfig.Tracer = c
	p, err := pgxpool.NewWithConfig(t.Context(), cfg)
	require.NoError(t, err)
	t.Cleanup(p.Close)
	s := service()
	s.Pools = countedPools{pool: p}
	return s, c
}

// Return 3 (review, minor): HiddenFiles runs on every file operation of a member in every module (the Hider of the
// files is shared by all parents — the photos of the trips of a driver, the attachments of tasks). A member without
// forms.read anywhere never reaches a file of an answer (the parent forms/form is closed to him by its ReadAction):
// nothing to close, no reading of the answers. A member with forms.read without forms.responses.read anywhere gets the
// files of the others closed at a cost that does not grow with the forms of the tenant.
func TestHiddenFilesCost(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	s, c := countedService(t)
	f := published(t, "a.owner", "Фото HC0", page(qq("q-photo", fapi.FormQuestionTypePhoto, "Фото", false)))
	theirs := formFile(t, f.Id, "a.owner")

	assert.Empty(t, must(s.HiddenFiles(ctx, as(t, "a.driver-msk2"))).of(t), "no forms.read anywhere: nothing to close")

	driver := as(t, "a.driver-msk1")
	at := c.n.Load()
	hidden := must(s.HiddenFiles(ctx, driver)).of(t)
	before := c.n.Load() - at
	assert.Contains(t, hidden, theirs, "forms.read without forms.responses.read: the files of the others")
	for i := range 3 {
		g := published(t, "a.owner", fmt.Sprintf("Фото HC%d", i+1), page(qq("q-photo", fapi.FormQuestionTypePhoto, "Фото", false)))
		formFile(t, g.Id, "a.owner")
	}
	at = c.n.Load()
	must(s.HiddenFiles(ctx, driver)).of(t)
	assert.Equal(t, before, c.n.Load()-at, "the queries of HiddenFiles without forms.responses.read do not grow with the forms")
}

// Return 3 (review, minor): the audit line of «Хранить ответы» stays small when the retention deletes many responses
// of a form — the count of them all and the first numbers only.
func TestRetentionAuditNumbers(t *testing.T) { //nolint:paralleltest // deletes the old responses of the whole tenant
	const shown = 10 // the numbers an audit line keeps
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Хранение RN", page(qq("q-text", fapi.FormQuestionTypeText, "Отзыв", true)))
	for range shown + 2 {
		x := must(s.Submit(ctx, owner, f.Id, fapi.FormResponseCreate{VersionId: *f.PublishedVersionId,
			Answers: []fapi.FieldEntry{text("q-text", "старый")}})).of(t)
		aged(t, x.Id, 400)
	}
	_, err := s.Retain(ctx, ref("tenant:a"))
	require.NoError(t, err)
	assert.Equal(t, 1, count(t, `select count(*) from audit.events where action = 'forms.responses.purged' and target_id = $1
		and (diff->>'count')::int = $2 and jsonb_array_length(diff->'numbers') = $3`, f.Id, shown+2, shown))
}
