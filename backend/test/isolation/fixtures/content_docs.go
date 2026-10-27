package fixtures

// docs writes the folder «Договоры» of the objects of the tenant and its document «Договор поставки» with the first
// version (W7.23; docs.folders, docs.documents, docs.versions of tenant 0061). The rows of other tenants carry the same
// keys: «a foreign object in the own tenant» of the matrix docs_w723 is the id of tenant B in the path of tenant A.
func (l *tenantLoader) docs() error {
	folder, doc := l.docsObjects()
	if folder == nil || doc == nil {
		return nil // the objects are in every tenant of the default catalog; a custom catalog may leave them out
	}
	at := l.now.Add(-contentAge)
	folderID, docID := l.kbObjectID(ObjectFolder, folder.Key), l.kbObjectID(ObjectDoc, doc.Key)
	if err := l.exec("docs folder", `insert into docs.folders (id, name, owner_id, created_at, updated_at) values ($1, $2, $3, $4, $4)`,
		folderID, folder.Name, l.owner, at); err != nil {
		return err
	}
	if err := l.exec("docs document", `insert into docs.documents (id, kind, title, folder_id, owner_id, created_at, updated_at)
		values ($1, 'text', $2, $3, $4, $5, $5)`, docID, doc.Name, folderID, l.owner, at); err != nil {
		return err
	}
	return l.exec("docs version", `insert into docs.versions (document_id, number, source, authors, created_at)
		values ($1, 1, 'edit', array[$2::uuid], $3)`, docID, l.owner, at)
}

// docsObjects are the folder «Договоры» and the document «Договор поставки» of the objects of the tenant.
func (l *tenantLoader) docsObjects() (folder, doc *ObjectDef) {
	for i := range l.t.Objects {
		switch o := &l.t.Objects[i]; {
		case o.Kind == ObjectFolder && o.Key == "contracts":
			folder = o
		case o.Kind == ObjectDoc && o.Key == "contract":
			doc = o
		}
	}
	return folder, doc
}
