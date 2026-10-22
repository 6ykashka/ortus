package forms

import (
	"context"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// othersFilesSQL are the files of the answers (the parent forms/form) not uploaded by $1 (nil — by anybody), by form.
const othersFilesSQL = `select owner_id, id from files.objects
 where owner_type = 'forms.form' and purpose = 'form_attachment' and ($1::uuid is null or uploaded_by is distinct from $1::uuid)
 order by owner_id, id`

// withFilesSQL selects the responses of the form $1 whose answers hold files.
const withFilesSQL = `x.form_id = $1 and x.answers @? '$[*] ? (@.value.type == "files")'`

// HiddenFiles are the files of the answers closed to the member of tc (return 2; Q-W4.00-forms-9; DoR forms.md
// «файл откроется с проверкой доступа»): the module of files leaves them out of listFiles and answers 404 for them
// (cmd/api, a Hider of the parent forms/form). forms.read gives the uploads to a form, not its answers: a file is open to
// its uploader, to a member with forms.responses.read in the area of its form and to one who reads a response holding
// it (his own, or one about an object he sees, with the key in any of his roles); every other file is closed. The owner
// reads every answer.
//
// The module of files asks it on every file operation of a member whatever the parent (return 3), so its cost stays
// low where it can: a member without forms.read anywhere never reaches a file of an answer (the parent forms/form is
// closed to him by its ReadAction) — nothing is read but his grants; without forms.responses.read anywhere every file of
// the others is closed by one query; only a member with the key somewhere has the responses of the forms read, and of
// those forms only that he sees outside the area of his key.
func (s *Service) HiddenFiles(ctx context.Context, tc tenantctx.TenantContext) ([]uuid.UUID, error) {
	if tc.Owner {
		return nil, nil
	}
	var out []uuid.UUID
	err := s.run(ctx, tc, false, func(r *req) error {
		if ok, err := r.anywhere(ctx, actRead); err != nil || !ok {
			return err
		}
		var me *uuid.UUID
		if tc.PersonID != uuid.Nil {
			me = &tc.PersonID
		}
		byForm, forms, err := r.othersFiles(ctx, me)
		if err != nil || len(byForm) == 0 {
			return err
		}
		keyed, err := r.anywhere(ctx, actRespRead)
		if err != nil {
			return err
		}
		if me == nil || !keyed { // nobody, or no grant reads an answer: every file of the others
			for _, form := range forms {
				out = append(out, byForm[form]...)
			}
			return nil
		}
		for _, form := range forms {
			closed, err := r.closedFiles(ctx, form, byForm[form])
			if err != nil {
				return err
			}
			out = append(out, closed...)
		}
		return nil
	})
	return out, err
}

// othersFiles are the files of the answers not uploaded by me (nil — by anybody), by form, and the forms in order.
func (r *req) othersFiles(ctx context.Context, me *uuid.UUID) (map[uuid.UUID][]uuid.UUID, []uuid.UUID, error) {
	rows, err := r.tx.Query(ctx, othersFilesSQL, me)
	if err != nil {
		return nil, nil, store("files of answers", err)
	}
	pairs, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) ([2]uuid.UUID, error) {
		var p [2]uuid.UUID
		return p, row.Scan(&p[0], &p[1])
	})
	if err != nil {
		return nil, nil, store("files of answers", err)
	}
	byForm := map[uuid.UUID][]uuid.UUID{}
	var forms []uuid.UUID
	for _, p := range pairs {
		if _, seen := byForm[p[0]]; !seen {
			forms = append(forms, p[0])
		}
		byForm[p[0]] = append(byForm[p[0]], p[1])
	}
	return byForm, forms, nil
}

// closedFiles are the files ids of the answers to form the member holding forms.responses.read somewhere does not read:
// none with the key in the area of the form; all of them of a form he does not see (its parent is closed to him
// anyway); otherwise all but those the responses he reads hold.
func (r *req) closedFiles(ctx context.Context, form uuid.UUID, ids []uuid.UUID) ([]uuid.UUID, error) {
	f, err := r.form(ctx, form, false)
	if err != nil || f == nil {
		return ids, err // a file of no form: its parent has no row anyway
	}
	if ok, err := r.can(ctx, f, actRespRead); err != nil || ok {
		return nil, err
	}
	if ok, err := r.visible(ctx, f); err != nil || !ok {
		return ids, err
	}
	rs, err := r.responsesWhere(ctx, withFilesSQL, f.id)
	if err != nil {
		return nil, err
	}
	seen, err := r.visibleResponses(ctx, f, rs)
	if err != nil {
		return nil, err
	}
	var open []uuid.UUID
	for _, x := range seen {
		open = append(open, entryFiles(x.answers)...)
	}
	return slices.DeleteFunc(slices.Clone(ids), func(id uuid.UUID) bool { return slices.Contains(open, id) }), nil
}
