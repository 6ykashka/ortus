//go:build isolation

package fixtures

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	harness "github.com/ortus/ortus-crm/backend/test"
)

// W4.31: WithContent пишет базу знаний каждого тенанта — пространство «Регламенты» (space:<t>.rules) со страницей
// page:<t>.rules-intro, открытый запрос доступа kb_request:<t>.ask и правило kb_rule:<t>.review. Строки «чужой объект в
// своём тенанте» матрицы knowledge_w404 подставляют их id тенанта B в путь тенанта A. Без опции строк kb.* нет.
func TestLoadKnowledgeContent(t *testing.T) {
	t.Parallel()
	w, err := Load(t.Context(), cluster, "fx_kb", harness.Now(), WithContent())
	if err != nil {
		t.Fatal(err)
	}
	for _, tn := range []string{TenantA, TenantB} {
		db := cluster.DB(t, w.TenantDBs[tn], migrations.RoleAPI)
		if n := count(t, db, `select count(*) from kb.spaces where id = $1 and name = 'Регламенты' and access = 'open'`,
			id(t, w, "space:"+tn+".rules")); n != 1 {
			t.Errorf("space:%s.rules = %d, want 1", tn, n)
		}
		if n := count(t, db, `select count(*) from kb.nodes n join kb.versions v on v.node_id = n.id and v.version = 1
			where n.id = $1 and n.space_id = $2 and n.depth = 1 and n.kind = 'page' and n.status = 'active'`,
			id(t, w, "page:"+tn+".rules-intro"), id(t, w, "space:"+tn+".rules")); n != 1 {
			t.Errorf("page:%s.rules-intro with its version = %d, want 1", tn, n)
		}
		if n := count(t, db, `select count(*) from kb.requests where id = $1 and node_id = $2 and status = 'open'`,
			id(t, w, "kb_request:"+tn+".ask"), id(t, w, "page:"+tn+".rules-intro")); n != 1 {
			t.Errorf("kb_request:%s.ask = %d, want 1", tn, n)
		}
		if n := count(t, db, `select count(*) from kb.rules where id = $1 and space_id = $2`,
			id(t, w, "kb_rule:"+tn+".review"), id(t, w, "space:"+tn+".rules")); n != 1 {
			t.Errorf("kb_rule:%s.review = %d, want 1", tn, n)
		}
	}
	_, plain, _ := loadWorld(t, "fx_kb_plain")
	if n := count(t, plain, `select (select count(*) from kb.spaces) + (select count(*) from kb.nodes)`); n != 0 {
		t.Errorf("Load without WithContent wrote %d rows of kb, want 0", n)
	}
}
