package knowledge

import "github.com/google/uuid"

// personPages is how many pages of a branch change for a member.
type personPages struct {
	m     *member
	pages int
}

// impact is who gains and who loses reading and editing of the nodes ids (kbImpact, kbMoveImpact of the domain): the
// access of every member who is not blocked, before and after, node by node. Neither world changes.
type impact struct {
	gainView, loseView, gainEdit, loseEdit []personPages
}

// impactOf compares the access of every member who is not blocked to the nodes ids in before and after.
func impactOf(before, after *world, ids []uuid.UUID) impact {
	var out impact
	for _, m := range before.members {
		if m.status == memberBlocked {
			continue
		}
		var gv, lv, ge, le int
		for _, id := range ids {
			a := before.access(m, before.nodeOf(id))
			b := after.access(after.member[m.id], after.nodeOf(id))
			gv += flag(!a.view && b.view)
			lv += flag(a.view && !b.view)
			ge += flag(!a.edit && b.edit)
			le += flag(a.edit && !b.edit)
		}
		out.gainView = appendPages(out.gainView, m, gv)
		out.loseView = appendPages(out.loseView, m, lv)
		out.gainEdit = appendPages(out.gainEdit, m, ge)
		out.loseEdit = appendPages(out.loseEdit, m, le)
	}
	return out
}

func flag(b bool) int {
	if b {
		return 1
	}
	return 0
}

func appendPages(list []personPages, m *member, n int) []personPages {
	if n == 0 {
		return list
	}
	return append(list, personPages{m, n})
}
