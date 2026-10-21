//go:build integration

package knowledge

import (
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The snapshot of a request carries the text of the current version of each node only (review of W4.31, return 1:
// the cost of a request should not grow with the history of versions, KB-08 keeps them without a term); an old
// version is read by getKnowledgeNodeVersion on demand (read_integration_test.go, «Машина возвращается в пул»).
func TestLoadKeepsCurrentBodies(t *testing.T) { //nolint:paralleltest // reads the seed the commands change
	ctx := t.Context()
	pool, err := pools.For(ctx, tenantA)
	require.NoError(t, err)
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(ctx) }()
	w, err := load(ctx, tx, tenantA, svc.now(), svc.Memberships, svc.Relations)
	require.NoError(t, err)
	n := w.nodeOf(pid("kb-1"))
	require.NotNil(t, n)
	require.GreaterOrEqual(t, len(n.versions), 2, "«Регламент приёмки смены» has two versions in the seed")
	assert.Empty(t, n.versions[0].body, "the text of an old version is not loaded")
	assert.Equal(t, 1, n.versions[0].v)
	assert.Equal(t, "Дарья Зимина", n.versions[0].author, "its number, author and moment are")
	assert.Contains(t, n.last().body, "5 ракурсов", "the current text is")
}
