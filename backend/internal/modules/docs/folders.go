package docs

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// maxDepth bounds the nesting of folders.
const maxDepth = 8

// canFolders reports whether m manages the folders under parent (Q-W4.00-documents-8): the owner of the business, the
// level «Управляет доступом» in the parent folder, or a role with docs.folders.manage over it (the organization, the
// unit of the top folder, the folder). A top-level folder needs the owner or a role of the whole organization.
func (w *world) canFolders(m *member, parent *folder) bool {
	if m.owner {
		return true
	}
	if parent != nil && w.accessToFolder(m, parent).level == levelManage {
		return true
	}
	return slices.ContainsFunc(w.grants[m.id], func(g grant) bool {
		if g.role == nil || !g.role.has(actionFolders) {
			return false
		}
		if parent == nil {
			return g.kind == scopeTenant
		}
		path := w.path(parent)
		switch g.kind {
		case scopeTenant:
			return true
		case scopeUnit:
			return path[0].unit != uuid.Nil && w.covers(g, path[0].unit)
		case scopeFolder:
			return slices.ContainsFunc(path, func(f *folder) bool { return f.id == g.ref })
		}
		return false
	})
}

// folderName checks the name of a folder.
func folderName(name string) (string, error) {
	t := strings.TrimSpace(name)
	switch n := utf8.RuneCountInString(t); {
	case n < 1:
		return "", invalid("name", "Введите название папки")
	case n > 120:
		return "", invalid("name", "Название — не длиннее 120 символов")
	}
	return t, nil
}

// folderUniqueIndex is the unique index of the name of a folder among its siblings (tenant 0061).
const folderUniqueIndex = "folders_name_uq"

// newFolder checks the request of a new folder and makes its row: the name, the parent (visible, not too deep, managed
// by the member), the firm of a top-level folder, the mode, the icon and the label.
func (r *req) newFolder(b dapi.DocFolderCreate) (*folder, error) {
	name, err := folderName(b.Name)
	if err != nil {
		return nil, err
	}
	var parent *folder
	if b.ParentId != nil {
		if parent, _, err = r.folder(*b.ParentId); err != nil {
			return nil, err
		}
		if len(r.w.path(parent)) >= maxDepth {
			return nil, invalid("parentId", "Не больше восьми уровней вложенности")
		}
	}
	if !r.w.canFolders(r.me, parent) {
		return nil, forbidden(textFoldersRight)
	}
	f := &folder{id: r.s.newID(), name: name, mode: modeInherit, owner: r.me.id, icon: "folder", sens: sensNormal, revision: 1,
		created: r.now, updated: r.now}
	if parent != nil {
		f.parent = parent.id
	}
	if f.unit, err = r.folderUnit(b.OrgUnitId, parent != nil); err != nil {
		return nil, err
	}
	if b.Mode != nil {
		f.mode = string(*b.Mode)
	}
	if b.Icon != nil && strings.TrimSpace(*b.Icon) != "" {
		f.icon = strings.TrimSpace(*b.Icon)
	}
	if b.Sensitivity != nil {
		f.sens = string(*b.Sensitivity)
	}
	return f, nil
}

// folderUnit checks the firm of a new folder: only a top-level folder has one, and it exists.
func (r *req) folderUnit(unit *uuid.UUID, nested bool) (uuid.UUID, error) {
	switch {
	case unit == nil:
		return uuid.Nil, nil
	case nested:
		return uuid.Nil, invalid("orgUnitId", "Фирма задаётся у папки верхнего уровня")
	case r.w.units[*unit] == nil:
		return uuid.Nil, invalid("orgUnitId", "Подразделение не найдено")
	}
	return *unit, nil
}

// CreateFolder creates a folder (createDocFolder, Q-W4.00-documents-8).
func (s *Service) CreateFolder(ctx context.Context, tc tenantctx.TenantContext, b dapi.DocFolderCreate) (dapi.DocFolder, error) {
	var out dapi.DocFolder
	probeParent := probe{}
	if b.ParentId != nil {
		probeParent = onFolder(*b.ParentId)
	}
	err := s.runOn(ctx, tc, true, probeParent, func(r *req) error {
		f, err := r.newFolder(b)
		if err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `insert into docs.folders (id, name, parent_id, org_unit_id, mode, owner_id, icon, sensitivity, created_at, updated_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`, f.id, f.name, nullID(f.parent), nullID(f.unit), f.mode, f.owner, f.icon, f.sens, r.now); err != nil {
			if unique(err, folderUniqueIndex) {
				return problem.New(codeConflict, "Папка с таким названием уже есть")
			}
			return fmt.Errorf("docs: insert folder: %w", err)
		}
		r.w.addFolder(f)
		if _, err := r.publish(ctx, "docs.folder.created", aggFolder, f.id, map[string]any{"parentId": nullID(f.parent)}); err != nil {
			return err
		}
		if err := r.recordFolder(ctx, "docs.folder.create", f.id, map[string]any{keyName: f.name}); err != nil {
			return err
		}
		out = r.folderDTO(f, r.w.accessToFolder(r.me, f))
		return nil
	})
	return out, err
}

// UpdateFolder renames a folder or changes its mode, icon and label (updateDocFolder).
func (s *Service) UpdateFolder(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b dapi.DocFolderPatch) (dapi.DocFolder, error) {
	var out dapi.DocFolder
	err := s.runOn(ctx, tc, true, onFolder(id), func(r *req) error {
		f, a, err := r.folder(id)
		if err != nil {
			return err
		}
		if a.level != levelManage {
			return forbidden(textFoldersRight)
		}
		if ifMatch != etag(int64(f.revision)) {
			return problem.New(codeRevision, "Папку уже изменили. Обновите страницу и повторите.")
		}
		if b.Name != nil {
			if f.name, err = folderName(*b.Name); err != nil {
				return err
			}
		}
		if b.Mode != nil {
			f.mode = string(*b.Mode)
		}
		if b.Icon != nil && strings.TrimSpace(*b.Icon) != "" {
			f.icon = strings.TrimSpace(*b.Icon)
		}
		if b.Sensitivity != nil {
			f.sens = string(*b.Sensitivity)
		}
		err = r.tx.QueryRow(ctx, `update docs.folders set name = $2, mode = $3, icon = $4, sensitivity = $5, revision = revision + 1, updated_at = $6
			where id = $1 returning revision`, id, f.name, f.mode, f.icon, f.sens, r.now).Scan(&f.revision)
		if unique(err, folderUniqueIndex) {
			return problem.New(codeConflict, "Папка с таким названием уже есть")
		}
		if err != nil {
			return fmt.Errorf("docs: update folder: %w", err)
		}
		f.updated = r.now
		if err := r.recordFolder(ctx, "docs.folder.update", id, map[string]any{keyName: f.name, keyMode: f.mode}); err != nil {
			return err
		}
		out = r.folderDTO(f, r.w.accessToFolder(r.me, f))
		return nil
	})
	return out, err
}

// DeleteFolder deletes an empty folder (deleteDocFolder): without subfolders, documents (archived ones too) and
// templates.
func (s *Service) DeleteFolder(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) error {
	return s.runOn(ctx, tc, true, onFolder(id), func(r *req) error {
		f, a, err := r.folder(id)
		if err != nil {
			return err
		}
		if a.level != levelManage {
			return forbidden(textFoldersRight)
		}
		var used bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from docs.folders where parent_id = $1)
			or exists (select 1 from docs.documents where folder_id = $1) or exists (select 1 from docs.templates where folder_id = $1)`, id).
			Scan(&used); err != nil {
			return fmt.Errorf("docs: folder usage: %w", err)
		}
		if used {
			return problem.New(codeConflict, "Папка не пустая: перенесите документы и подпапки")
		}
		for _, q := range []string{`delete from docs.shares where folder_id = $1`, `delete from docs.route_templates where folder_id = $1`,
			`delete from docs.folders where id = $1`} {
			if _, err := r.tx.Exec(ctx, q, id); err != nil {
				return fmt.Errorf("docs: delete folder: %w", err)
			}
		}
		delete(r.w.folders, id)
		if _, err := r.publish(ctx, "docs.folder.deleted", aggFolder, id, nil); err != nil {
			return err
		}
		return r.recordFolder(ctx, "docs.folder.delete", id, map[string]any{keyName: f.name})
	})
}

// SetFolderShares replaces the mode and the list of a folder (setDocFolderShares); dryRun answers the impact only.
func (s *Service) SetFolderShares(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b dapi.DocSharesSet) (dapi.DocSharesResult, error) {
	var out dapi.DocSharesResult
	err := s.runOn(ctx, tc, true, onFolder(id), func(r *req) error {
		f, a, err := r.folder(id)
		if err != nil {
			return err
		}
		if a.level != levelManage {
			return forbidden(textNeedShare)
		}
		entries, err := r.entries(b.Entries, levelManage, r.w.shares[id])
		if err != nil {
			return err
		}
		mode := string(b.Mode)
		imp := r.w.impactOfFolderShare(f, mode, entries)
		out.Impact = r.impactDTO(imp)
		current := dapi.DocShares{Mode: dapi.DocSharesMode(f.mode), Revision: int64(f.revision), Entries: r.shareEntries(id)}
		if b.DryRun != nil && *b.DryRun {
			out.Shares = &current
			return nil
		}
		if err := r.replaceShares(ctx, true, id, entries); err != nil {
			return err
		}
		if err := r.tx.QueryRow(ctx, `update docs.folders set mode = $2, revision = revision + 1, updated_at = $3 where id = $1 returning revision`,
			id, mode, r.now).Scan(&f.revision); err != nil {
			return fmt.Errorf("docs: folder mode: %w", err)
		}
		f.mode = mode
		ev, err := r.publish(ctx, "docs.folder.shared", aggFolder, id, map[string]any{keyEntries: len(entries), keyMode: mode})
		if err != nil {
			return err
		}
		var gained []uuid.UUID
		for _, p := range slices.Concat(imp.gain, imp.up) {
			gained = append(gained, p.member.id)
		}
		if err := r.notify(ctx, "docs.access.granted", "Вам открыт доступ к папке «"+f.name+"»", uuid.Nil, ev, gained); err != nil {
			return err
		}
		if err := r.recordFolder(ctx, "docs.folder.share", id, map[string]any{keyEntries: len(entries), keyMode: mode}); err != nil {
			return err
		}
		out.Applied = true
		out.Shares = &dapi.DocShares{Mode: dapi.DocSharesMode(mode), Revision: int64(f.revision), Entries: r.shareEntries(id)}
		return nil
	})
	return out, err
}

var _ = errors.New
