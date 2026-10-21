package fixtures

import (
	"slices"

	"github.com/google/uuid"
)

// knowledge writes the knowledge base of the tenant (W4.31): the space of the objects (kb.spaces, open, the whole
// organization), its page as the first top-level node with its first version, the requests of members to read the page
// and the rules of the space. The rows of other tenants carry the same keys: «a foreign object in the own tenant» of
// the matrix knowledge_w404 is the id of tenant B in the path of tenant A.
func (l *tenantLoader) knowledge() error {
	space, page, ok := l.knowledgeObjects()
	if !ok {
		return nil // Validate guarantees the objects when there are requests or rules
	}
	at := l.now.Add(-contentAge)
	if err := l.exec("kb space", `insert into kb.spaces (id, name, access, created_by, created_at, updated_at)
		values ($1, $2, 'open', $3, $4, $4)`, l.kbObjectID(ObjectSpace, space.Key), space.Name, l.owner, at); err != nil {
		return err
	}
	pageID := l.kbObjectID(ObjectPage, page.Key)
	if err := l.exec("kb page", `insert into kb.nodes (id, space_id, position, depth, kind, title, status, owner_id, created_at, updated_at)
		values ($1, $2, 0, 1, 'page', $3, 'active', $4, $5, $5)`, pageID, l.kbObjectID(ObjectSpace, space.Key), page.Name, l.owner, at); err != nil {
		return err
	}
	if err := l.exec("kb version", `insert into kb.versions (node_id, version, title, body, published_by, author_name, published_at)
		values ($1, 1, $2, '', $3, 'Владелец', $4)`, pageID, page.Name, l.owner, at); err != nil {
		return err
	}
	for _, r := range l.t.Content.KnowledgeRequests {
		if err := l.exec("kb request "+r.Key, `insert into kb.requests (id, node_id, space_id, member_id, can, requested_at)
			values ($1, $2, $3, $4, 'view', $5)`, l.contentID(refKnowledgeRequest, r.Key), pageID, l.kbObjectID(ObjectSpace, space.Key),
			l.personID(r.Member), at); err != nil {
			return err
		}
	}
	for _, r := range l.t.Content.KnowledgeRules {
		if err := l.exec("kb rule "+r.Key, `insert into kb.rules (id, space_id, kind, name, trigger, enabled_by, created_at)
			values ($1, $2, 'review', $3, 'Каждый день', $4, $5)`, l.contentID(refKnowledgeRule, r.Key), l.kbObjectID(ObjectSpace, space.Key),
			r.Name, l.owner, at); err != nil {
			return err
		}
	}
	return nil
}

// knowledgeObjects are the space «Регламенты» and its page of the objects of the tenant.
func (l *tenantLoader) knowledgeObjects() (space, page ObjectDef, ok bool) {
	i := slices.IndexFunc(l.t.Objects, func(o ObjectDef) bool { return o.Kind == ObjectSpace && o.Key == spaceRules })
	j := slices.IndexFunc(l.t.Objects, func(o ObjectDef) bool { return o.Kind == ObjectPage && o.Key == pageRulesIntro })
	if i < 0 || j < 0 {
		return ObjectDef{}, ObjectDef{}, false
	}
	return l.t.Objects[i], l.t.Objects[j], true
}

func (l *tenantLoader) kbObjectID(kind, key string) uuid.UUID {
	return nameID(localRef(kind, l.t.Key, key))
}
