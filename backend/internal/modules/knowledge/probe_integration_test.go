//go:build integration

package knowledge

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	kapi "github.com/ortus/ortus-crm/backend/internal/api/knowledge"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// countingMemberships counts the loads of the snapshot (every load reads the memberships of the people).
type countingMemberships struct {
	inner Memberships
	n     *atomic.Int32
}

func (c countingMemberships) Memberships(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]Membership, error) {
	c.n.Add(1)
	return c.inner.Memberships(ctx, tenantID, ids)
}

// AC-01: an id of a space, a node, a request or a rule the organization has not (another organization's or none)
// answers 404 with the text of the operation before the snapshot of the organization is loaded — as fast as an
// unknown one; an existing one loads it.
func TestMissingObjectAnswersBeforeLoad(t *testing.T) { //nolint:paralleltest // reads the seed the commands change
	var n atomic.Int32
	s := &Service{Pools: pools, Memberships: countingMemberships{inner: svc.Memberships, n: &n}, Relations: relations{}, Now: svc.Now}
	ctx := as(t, "m-owner")
	tc, _ := tenantctx.FromContext(ctx)
	missing := uuid.New()
	for _, c := range []struct {
		name, text string
		call       func() error
	}{
		{"tree", textSpaceNotFound, func() error { _, err := s.Tree(ctx, tc, missing); return err }},
		{"node", textNodeNotFound, func() error { _, err := s.Node(ctx, tc, missing); return err }},
		{"explain", textNodeNotFound, func() error { _, err := s.Explain(ctx, tc, missing, pid("m-owner")); return err }},
		{"create node", textSpaceNotFound, func() error {
			_, err := s.CreateNode(ctx, tc, missing, kapi.KnowledgeNodeCreate{Kind: "page", Title: "Выезд в непогоду"})
			return err
		}},
		{"decide", "Запрос не найден или уже решён", func() error { _, err := s.Decide(ctx, tc, missing, false); return err }},
		{"rule", "Правило не найдено", func() error { _, err := s.SetRule(ctx, tc, missing, false); return err }},
		// Return 1: the page of knowledge/pages, the space of the search, the parent of a page of the forms core.
		{"page", textNodeNotFound, func() error { _, err := s.GetPage(ctx, tc, missing); return err }},
		{"update page", textNodeNotFound, func() error {
			_, err := s.UpdatePage(ctx, tc, missing, `"rev-1"`, kapi.KnowledgePagePatch{Title: new("Выезд в непогоду")})
			return err
		}},
		{"search in a space", textSpaceNotFound, func() error { _, err := s.Search(ctx, tc, "регламент", &missing); return err }},
		{"create page under a parent", textNodeNotFound, func() error {
			_, err := s.CreatePage(ctx, tc, kapi.KnowledgePageCreate{Title: "Выезд в непогоду", BodyMarkdown: "Текст", ParentPageId: &missing})
			return err
		}},
	} {
		err := c.call()
		code, detail := problemOf(err)
		assert.Equal(t, problem.CodeNotFound, code, c.name)
		assert.Equal(t, c.text, detail, c.name)
	}
	assert.Zero(t, n.Load(), "a missing object does not load the snapshot")
	_, err := s.Node(ctx, tc, pid("kb-1"))
	require.NoError(t, err)
	assert.Equal(t, int32(1), n.Load(), "an existing one does")
}
