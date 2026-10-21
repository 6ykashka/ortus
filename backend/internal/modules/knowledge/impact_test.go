package knowledge

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
)

// The impact before a change is saved (knowledge.js 14.10:183–210, kbImpact and kbMoveImpact of W4.30): the cases of
// impact.test.ts on the same world.

var ilyin = gdef{"x1", "m-ilyin", "r-manager", scopeUnit, "r-msk", ""}

// accessChange is the world after mode and list of node id (and «Как у родителя» of its own subnodes with applyOwn).
func accessChange(w *world, id, m string, list []entry, applyOwn bool) (*world, []uuid.UUID) {
	n := nd(w, id)
	var changed []*node
	c := n.clone()
	c.mode, c.list = m, list
	changed = append(changed, c)
	var ids []uuid.UUID
	for _, x := range w.subtree(n, false) {
		ids = append(ids, x.id)
		if applyOwn && x.id != n.id && x.ownMode() {
			y := x.clone()
			y.mode, y.list = modeInherit, nil
			changed = append(changed, y)
		}
	}
	return w.with(changed, nil), ids
}

func pp(ps []personPages) map[string]int {
	out := map[string]int{}
	for _, p := range ps {
		out[p.m.name] = p.pages
	}
	return out
}

func TestImpactAccess(t *testing.T) {
	t.Parallel()
	w := kbDb(testNow, ilyin)
	after, ids := accessChange(w, "fin", modeInherit, nil, false)
	im := impactOf(w, after, ids)
	assert.Len(t, ids, 2)
	assert.Equal(t, map[string]int{"Сергей Ильин": 2}, pp(im.gainView))
	assert.Empty(t, im.loseView)
	assert.Equal(t, map[string]int{"Вера Котельникова": 2}, pp(im.gainEdit))
	assert.Empty(t, im.loseEdit)

	w = kbDb(testNow)
	after, ids = accessChange(w, "f-drv", modeListed, []entry{ed}, false)
	im = impactOf(w, after, ids)
	assert.Len(t, ids, 3)
	assert.Empty(t, im.gainView)
	assert.Equal(t, map[string]int{"Илья Васильев": 3}, pp(im.loseView))
	assert.Empty(t, im.gainEdit)
	assert.Empty(t, im.loseEdit)

	after, ids = accessChange(w, "f-drv", modeListed, []entry{ed}, true)
	im = impactOf(w, after, ids)
	assert.Equal(t, map[string]int{"Вера Котельникова": 1}, pp(im.gainEdit), "applyOwn drops «Маршруты» to the parent")
	assert.Equal(t, map[string]int{"Илья Васильев": 3}, pp(im.loseView))
	assert.Equal(t, modeEdit, nd(w, "drv-4").mode, "the world itself does not change")

	// PD-60: an assignment that ended gives nothing before and after
	late := kbDb(time.Date(2026, 10, 1, 9, 0, 0, 0, moscow), gdef{"x1", "m-ilyin", "r-manager", scopeUnit, "r-msk", "30.09.2026"})
	after, ids = accessChange(late, "fin", modeInherit, nil, false)
	assert.Empty(t, impactOf(late, after, ids).gainView)
}

func TestImpactMove(t *testing.T) {
	t.Parallel()
	w := kbDb(testNow, ilyin)
	move := func(id, parent string) impact {
		c := nd(w, id).clone()
		c.parent = uuid.Nil
		if parent != "" {
			c.parent = pid(parent)
		}
		var ids []uuid.UUID
		for _, x := range w.subtree(nd(w, id), false) {
			ids = append(ids, x.id)
		}
		return impactOf(w, w.with([]*node{c}, nil), ids)
	}
	im := move("drv-1", "")
	assert.Empty(t, im.loseView)
	assert.Equal(t, map[string]int{"Сергей Ильин": 1}, pp(im.gainView), "out of the folder «Только выбранные»")
	im = move("kb-1", "f-drv")
	assert.Equal(t, map[string]int{"Сергей Ильин": 2}, pp(im.loseView), "into the folder of the drivers")
	assert.Empty(t, im.gainView)
	assert.Equal(t, pid("f-reg"), nd(w, "kb-1").parent)
}
