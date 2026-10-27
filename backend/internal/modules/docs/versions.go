package docs

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// versionName checks the name of a version (1…80 characters).
func versionName(s string) (string, error) {
	t := strings.TrimSpace(s)
	if n := utf8.RuneCountInString(t); n < 1 || n > 80 {
		return "", invalid("name", "Название версии — от 1 до 80 символов")
	}
	return t, nil
}

// engineKey is the key of the version for the engine: t<tenant>.d<document>.v<version>.
func engineKey(tenant, doc uuid.UUID, version int) string {
	return fmt.Sprintf("t%s.d%s.v%d", tenant, doc, version)
}

// SaveVersion cuts a version now or names the last one (saveDocVersion — docCut). With a document server a cut asks the
// engine to save what is being edited (the file comes back by the callback as the next version); without one nothing
// is edited, so the last version is the answer and the name goes to it (Q-W7.23-3).
func (s *Service) SaveVersion(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b dapi.DocVersionSave) (dapi.DocVersion, error) {
	var out dapi.DocVersion
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if !rt.editL {
			return forbidden(textNeedEdit)
		}
		if rt.locked {
			return locked(textLocked)
		}
		if r.s.Engine != nil && r.s.Engine.Configured() {
			if err := r.s.Engine.ForceSave(ctx, engineKey(tc.TenantID, id, d.version)); err != nil {
				return problem.Wrap(problem.CodeDependencyUnavailable, err)
			}
		}
		v, ok, err := r.version(ctx, id, d.version)
		if err != nil {
			return err
		}
		if !ok {
			return notFound(textVersionNotFound)
		}
		if b.Name != nil {
			name, err := versionName(*b.Name)
			if err != nil {
				return err
			}
			if _, err := r.tx.Exec(ctx, `update docs.versions set name = $3 where document_id = $1 and number = $2`, id, v.number, name); err != nil {
				return fmt.Errorf("docs: name version: %w", err)
			}
			v.name = name
			if err := r.record(ctx, "docs.version.name", id, fmt.Sprintf("Версия v%d названа «%s»", v.number, name), false, nil); err != nil {
				return err
			}
		}
		out = r.versionDTO(v)
		return nil
	})
	return out, err
}

// NameVersion sets the name of a version (nameDocVersion).
func (s *Service) NameVersion(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, number int, b dapi.DocVersionName) (dapi.DocVersion, error) {
	var out dapi.DocVersion
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		_, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if !rt.editL {
			return forbidden(textNeedEdit)
		}
		name, err := versionName(b.Name)
		if err != nil {
			return err
		}
		v, ok, err := r.version(ctx, id, number)
		if err != nil {
			return err
		}
		if !ok {
			return notFound(textVersionNotFound)
		}
		if _, err := r.tx.Exec(ctx, `update docs.versions set name = $3 where document_id = $1 and number = $2`, id, number, name); err != nil {
			return fmt.Errorf("docs: name version: %w", err)
		}
		v.name = name
		if err := r.record(ctx, "docs.version.name", id, fmt.Sprintf("Версия v%d названа «%s»", number, name), false, nil); err != nil {
			return err
		}
		out = r.versionDTO(v)
		return nil
	})
	return out, err
}

// RestoreVersion makes version number the current one as a new version v+1 with the source restore
// (restoreDocVersion — docRestore): the old versions are not changed.
func (s *Service) RestoreVersion(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, number int) (dapi.DocVersion, error) {
	var out dapi.DocVersion
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if err := editable(rt); err != nil {
			return err
		}
		src, ok, err := r.version(ctx, id, number)
		if err != nil {
			return err
		}
		if !ok {
			return notFound(textVersionNotFound)
		}
		next := d.version + 1
		if err := r.insertVersion(ctx, id, next, src.file, src.size, src.sha, "restore", "", []uuid.UUID{r.me.id}, false, number, ""); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update docs.documents set current_version = $2 where id = $1`, id, next); err != nil {
			return fmt.Errorf("docs: current version: %w", err)
		}
		d.version = next
		if err := r.touch(ctx, d); err != nil {
			return err
		}
		if _, err := r.publish(ctx, "docs.version.saved", aggDocument, id, map[string]any{"version": next, "source": "restore", "base": number}); err != nil {
			return err
		}
		if err := r.record(ctx, "docs.version.restore", id, fmt.Sprintf("Восстановлена v%d как v%d", number, next), false, nil); err != nil {
			return err
		}
		v, _, err := r.version(ctx, id, next)
		out = r.versionDTO(v)
		return err
	})
	return out, err
}
