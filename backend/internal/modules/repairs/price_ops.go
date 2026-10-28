package repairs

import (
	"context"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the price list and of the templates (the prototype, «Ремонт и стройка.dc.html»:1490–1542).
const (
	textNeedCatalog     = "Нужно право «Вести шаблоны и расценки»."
	textNeedCatalogRead = "Нужно право «Вести шаблоны и расценки» или «Составлять сметы»."
	textPriceName       = "Укажите название позиции."
	textPriceSection    = "Укажите раздел."
	textPricePositive   = "Укажите цену больше нуля."
	textPriceDuplicate  = "Такая позиция уже есть в справочнике."
	textPriceNotFound   = "Позиция справочника не найдена."
	textPriceChanged    = "Позицию уже изменили — обновите страницу"
	textUnknownKind     = "Неизвестный вид позиции."
	textUnknownUnit     = "Неизвестная единица."
)

const reasonPriceDuplicate = "price_item_duplicate"

// sectionOrder is the order of the sections of the price list in the prototype; the others follow by name.
var sectionOrder = []string{secDemolition, secElectrics, secWalls, secFloors, secPlumbing, secMaterials}

// PriceQuery is the filter of listPriceItems.
type PriceQuery struct {
	Q      *string
	Kind   *string // work | material
	Cursor *string
	Limit  *int
}

// priceRow is an item of the price list (repairs.price_items).
type priceRow struct {
	id                  uuid.UUID
	section, name, unit string
	kind                string
	price               int64
	archived            bool
	revision            int64
	used                int
}

// catalogRead requires the right to keep the catalog or to estimate (anywhere: the catalog belongs to the organization).
func (r *req) catalogRead(ctx context.Context) error {
	for _, a := range []string{actCatalog, actEstimates} {
		ok, err := r.anywhere(ctx, a)
		if err != nil || ok {
			return err
		}
	}
	return forbidden(textNeedCatalogRead)
}

// catalogWrite requires the right to keep the catalog.
func (r *req) catalogWrite(ctx context.Context) error {
	ok, err := r.anywhere(ctx, actCatalog)
	if err != nil {
		return err
	}
	if !ok {
		return forbidden(textNeedCatalog)
	}
	return nil
}

func priceOut(p priceRow) rapi.PriceItem {
	return rapi.PriceItem{Id: p.id, Section: p.section, Name: p.name, Unit: rapi.RepairUnit(p.unit), Kind: rapi.PriceItemKind(p.kind), Price: moneyOut(p.price),
		UsedInTemplates: p.used, Archived: p.archived, Revision: p.revision}
}

// prices reads the items of the price list with the number of templates each is used in.
func (r *req) prices(ctx context.Context, where string, args ...any) ([]priceRow, error) {
	rows, err := r.tx.Query(ctx, `select pi.id, pi.section, pi.name, pi.unit, pi.kind, pi.price_minor, pi.archived, pi.revision,
		(select count(distinct tl.template_id) from repairs.template_lines tl where tl.price_item_id = pi.id)::int
		from repairs.price_items pi `+where, args...)
	if err != nil {
		return nil, store("price items", err)
	}
	defer rows.Close()
	var out []priceRow
	for rows.Next() {
		var p priceRow
		if err := rows.Scan(&p.id, &p.section, &p.name, &p.unit, &p.kind, &p.price, &p.archived, &p.revision, &p.used); err != nil {
			return nil, store("price items", err)
		}
		out = append(out, p)
	}
	return out, store("price items", rows.Err())
}

func sectionRank(s string) int {
	if i := slices.Index(sectionOrder, s); i >= 0 {
		return i
	}
	return len(sectionOrder)
}

// PriceItems answers listPriceItems: the live items of the price list by section, filtered by a part of the name and by
// the kind. The first read of an organization that keeps the catalog copies the starter set of Ortus.
func (s *Service) PriceItems(ctx context.Context, tc tenantctx.TenantContext, q PriceQuery) (rapi.PriceItemPage, error) {
	out := rapi.PriceItemPage{Items: []rapi.PriceItem{}}
	if q.Kind != nil && *q.Kind != kindWork && *q.Kind != kindMaterial {
		return out, malformed(textUnknownKind)
	}
	if err := s.ensureStarter(ctx, tc); err != nil {
		return out, err
	}
	err := s.run(ctx, tc, false, func(r *req) error {
		if err := r.catalogRead(ctx); err != nil {
			return err
		}
		all, err := r.prices(ctx, `where not pi.archived`)
		if err != nil {
			return err
		}
		all = filterPrices(all, q)
		from, to, next, err := paging(len(all), q.Cursor, q.Limit)
		if err != nil {
			return err
		}
		for _, p := range all[from:to] {
			out.Items = append(out.Items, priceOut(p))
		}
		out.NextCursor = next
		return nil
	})
	return out, err
}

// filterPrices keeps the items that match the query and puts them in the order of the price list: the sections of the
// prototype first, the names inside a section.
func filterPrices(all []priceRow, q PriceQuery) []priceRow {
	needle := ""
	if q.Q != nil {
		needle = strings.ToLower(strings.TrimSpace(*q.Q))
	}
	all = slices.DeleteFunc(all, func(p priceRow) bool {
		return (q.Kind != nil && p.kind != *q.Kind) || (needle != "" && !strings.Contains(strings.ToLower(p.name), needle))
	})
	slices.SortFunc(all, func(a, b priceRow) int {
		if c := sectionRank(a.section) - sectionRank(b.section); c != 0 {
			return c
		}
		if c := strings.Compare(a.section, b.section); c != 0 {
			return c
		}
		return strings.Compare(strings.ToLower(a.name), strings.ToLower(b.name))
	})
	return all
}

// priceFields checks the fields a new or a changed item carries.
type priceFields struct {
	section, name, unit, kind *string
	price                     *rapi.Money
}

func (f priceFields) check() error {
	if err := f.checkText(); err != nil {
		return err
	}
	if f.unit != nil && !slices.Contains(units, *f.unit) {
		return invalid("unit", textUnknownUnit, "unknown")
	}
	if f.kind != nil && *f.kind != kindWork && *f.kind != kindMaterial {
		return invalid("kind", textUnknownKind, "unknown")
	}
	if f.price != nil && (f.price.Currency != currency || f.price.AmountMinor <= 0 || int64(f.price.AmountMinor) > maxMoney) {
		return invalid("price", textPricePositive, "positive")
	}
	return nil
}

// checkText checks the name and the section.
func (f priceFields) checkText() error {
	if f.name != nil {
		if n := utf8.RuneCountInString(strings.TrimSpace(*f.name)); n < 1 || n > 200 {
			return invalid("name", textPriceName, "required")
		}
	}
	if f.section != nil {
		if n := utf8.RuneCountInString(strings.TrimSpace(*f.section)); n < 1 || n > 100 {
			return invalid("section", textPriceSection, "required")
		}
	}
	return nil
}

// taken reports whether a live item other than except has the name (without the case and the edge spaces).
func (r *req) taken(ctx context.Context, name string, except uuid.UUID) (bool, error) {
	live, err := r.prices(ctx, `where not pi.archived and pi.id <> $1`, except)
	if err != nil {
		return false, err
	}
	n := strings.ToLower(strings.TrimSpace(name))
	return slices.ContainsFunc(live, func(p priceRow) bool { return strings.ToLower(strings.TrimSpace(p.name)) == n }), nil
}

func duplicateName() *failure {
	f := invalid("name", textPriceDuplicate, "duplicate")
	f.reason = reasonPriceDuplicate
	return f
}

// CreatePriceItem answers createPriceItem: an item of the price list; a name that is taken by a live item is refused.
func (s *Service) CreatePriceItem(ctx context.Context, tc tenantctx.TenantContext, b rapi.PriceItemCreate) (rapi.PriceItem, error) {
	var out rapi.PriceItem
	err := s.run(ctx, tc, true, func(r *req) error {
		if err := r.catalogWrite(ctx); err != nil {
			return err
		}
		unit, kind := string(b.Unit), string(b.Kind)
		if err := (priceFields{&b.Section, &b.Name, &unit, &kind, &b.Price}).check(); err != nil {
			return err
		}
		name := strings.TrimSpace(b.Name)
		if _, err := r.tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('repairs.price_items'))`); err != nil {
			return store("price list lock", err)
		}
		if dup, err := r.taken(ctx, name, uuid.Nil); err != nil {
			return err
		} else if dup {
			return duplicateName()
		}
		id := uuid.New()
		if _, err := r.tx.Exec(ctx, `insert into repairs.price_items (id, section, name, unit, kind, price_minor, currency, created_at, updated_at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`, id, strings.TrimSpace(b.Section), name, unit, kind, b.Price.AmountMinor, currency, r.now); err != nil {
			if uniqueViolation(err) {
				return duplicateName()
			}
			return store("insert price item", err)
		}
		got, err := r.prices(ctx, `where pi.id = $1`, id)
		if err != nil {
			return err
		}
		out = priceOut(got[0])
		return nil
	})
	return out, err
}

// apply checks a patch of an item and writes it into the row.
func (p *priceRow) apply(b rapi.PriceItemPatch) error {
	var unit *string
	if b.Unit != nil {
		unit = new(string(*b.Unit))
	}
	if err := (priceFields{section: b.Section, name: b.Name, unit: unit, price: b.Price}).check(); err != nil {
		return err
	}
	if b.Name != nil {
		p.name = strings.TrimSpace(*b.Name)
	}
	if b.Section != nil {
		p.section = strings.TrimSpace(*b.Section)
	}
	if unit != nil {
		p.unit = *unit
	}
	if b.Price != nil {
		p.price = int64(b.Price.AmountMinor)
	}
	if b.Archived != nil {
		p.archived = *b.Archived
	}
	return nil
}

// UpdatePriceItem answers updatePriceItem: the price or the attributes of an item. A new price reaches only the drafts
// built and the lines added afterwards: the lines of a version carry their own price.
func (s *Service) UpdatePriceItem(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b rapi.PriceItemPatch) (rapi.PriceItem, error) {
	var out rapi.PriceItem
	err := s.run(ctx, tc, true, func(r *req) error {
		if err := r.catalogWrite(ctx); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('repairs.price_items'))`); err != nil {
			return store("price list lock", err)
		}
		cur, err := r.prices(ctx, `where pi.id = $1 for update of pi`, id)
		if err != nil {
			return err
		}
		if len(cur) == 0 {
			return notFound(textPriceNotFound)
		}
		p := cur[0]
		if err := checkRev(ifMatch, p.revision, textPriceChanged); err != nil {
			return err
		}
		if err := p.apply(b); err != nil {
			return err
		}
		if !p.archived {
			if dup, err := r.taken(ctx, p.name, p.id); err != nil {
				return err
			} else if dup {
				return duplicateName()
			}
		}
		if _, err := r.tx.Exec(ctx, `update repairs.price_items set section = $2, name = $3, unit = $4, price_minor = $5, archived = $6, revision = revision + 1, updated_at = $7 where id = $1`,
			p.id, p.section, p.name, p.unit, p.price, p.archived, r.now); err != nil {
			if uniqueViolation(err) {
				return duplicateName()
			}
			return store("update price item", err)
		}
		got, err := r.prices(ctx, `where pi.id = $1`, id)
		if err != nil {
			return err
		}
		out = priceOut(got[0])
		return nil
	})
	return out, err
}
