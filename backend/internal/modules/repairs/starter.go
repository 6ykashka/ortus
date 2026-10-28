package repairs

import (
	"context"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// The starter set of Ortus (design/docs/19: «стартовые шаблоны Ортуса копируются в организацию при подключении
// модуля»): the price list of 23 items and three templates of the prototype (CAT0 and TPL0 of
// «Ремонт и стройка.dc.html», design-2026-10-19). The fourth template of the prototype, «Ремонт под ключ · дом», is a
// template the organization saved from its own object and is not part of the set.

type starterItem struct {
	key, section, name, unit, kind string
	rub                            int64
}

var starterItems = []starterItem{
	{"p-dem-floor", secDemolition, "Демонтаж напольного покрытия", unitM2, kindWork, 180},
	{"p-dem-wall", secDemolition, "Демонтаж перегородок", unitM2, kindWork, 650},
	{"p-trash", secDemolition, "Вывоз мусора", unitTrip, kindWork, 6500},
	{"p-el-point", secElectrics, "Электромонтаж, точка", unitPiece, kindWork, 1200},
	{"p-el-move", secElectrics, "Перенос розетки или выключателя", unitPiece, kindWork, 1500},
	{"p-chase", secElectrics, "Штробление бетона", unitM, kindWork, 450},
	{"p-shield", secElectrics, "Сборка щитка", unitPiece, kindWork, 9500},
	{"p-plaster", secWalls, "Штукатурка по маякам", unitM2, kindWork, 650},
	{"p-paint", secWalls, "Шпаклёвка и покраска", unitM2, kindWork, 520},
	{"p-wallpaper", secWalls, "Поклейка обоев", unitM2, kindWork, 380},
	{"p-screed", secFloors, "Стяжка пола", unitM2, kindWork, 750},
	{"p-laminate", secFloors, "Укладка ламината", unitM2, kindWork, 490},
	{"p-tile", secFloors, "Укладка плитки", unitM2, kindWork, 1600},
	{"p-skirting", secFloors, "Монтаж плинтуса", unitM, kindWork, 220},
	{"p-plumb", secPlumbing, "Установка сантехприбора", unitPiece, kindWork, 3500},
	{"m-laminate", secMaterials, "Ламинат 33 класс", unitM2, kindMaterial, 1350},
	{"m-laminate32", secMaterials, "Ламинат 32 класс", unitM2, kindMaterial, 980},
	{"m-plaster", secMaterials, "Штукатурка гипсовая 30 кг", unitMesh, kindMaterial, 400},
	{"m-cable", secMaterials, "Кабель и фурнитура", unitSet, kindMaterial, 28500},
	{"m-skirting", secMaterials, "Плинтус МДФ", unitM, kindMaterial, 310},
	{"m-tile", secMaterials, "Керамогранит 60×60", unitM2, kindMaterial, 1800},
	{"m-primer", secMaterials, "Грунтовка глубокого проникновения", unitLiter, kindMaterial, 95},
	{"m-paint", secMaterials, "Краска интерьерная", unitLiter, kindMaterial, 540},
}

// sl is a line of a starter template: a formula with a coefficient (thousandths) or a fixed quantity (thousandths).
type sl struct {
	section, item, formula string
	k, qty                 milli
}

// st is a stage of the technology: the output per day (thousandths, 0 — one day) and the pause in days.
type st struct {
	name        string
	rate, pause int
}

type starterTemplate struct {
	name, kind string
	warranty   int
	lines      []sl
	materials  []sl
	stages     []st
	documents  []string
	checklist  []string
}

func f(section, item, formula string, k milli) sl {
	return sl{section: section, item: item, formula: formula, k: k}
}
func q(section, item string, qty milli) sl { return sl{section: section, item: item, qty: qty} }

var (
	capLines = []sl{
		f(secDemolition, "p-dem-floor", "floor", 1000), q(secDemolition, "p-trash", 2000),
		q(secElectrics, "p-el-point", 30000), q(secElectrics, "p-shield", 1000),
		f(secWalls, "p-plaster", "walls_dry", 1000), f(secWalls, "p-paint", "walls_dry", 1000),
		f(secFloors, "p-screed", "floor", 1000), f(secFloors, "p-laminate", "floor_dry", 1000), f(secFloors, "p-tile", "wet", 1000), f(secFloors, "p-skirting", "perimeter_dry", 1000),
		f(secMaterials, "m-laminate", "floor_dry", 1070), f(secMaterials, "m-plaster", "walls_dry", 400), q(secMaterials, "m-cable", 1000),
		f(secMaterials, "m-skirting", "perimeter_dry", 1050),
	}
	capMaterials = []sl{
		f(secMaterials, "m-laminate", "floor_dry", 1070), f(secMaterials, "m-plaster", "walls_dry", 400), q(secMaterials, "m-cable", 1000),
		f(secMaterials, "m-skirting", "perimeter_dry", 1050), f(secMaterials, "m-tile", "wet", 1100), f(secMaterials, "m-primer", "walls", 200),
	}
)

var starterTemplates = []starterTemplate{
	{
		name: "Капитальный ремонт квартиры", kind: "капитальный ремонт", warranty: 24, lines: capLines, materials: capMaterials,
		stages: []st{{"Демонтаж", 12000, 0}, {"Электрика · черновая", 5000, 0}, {"Штукатурка стен", 12000, -3}, {"Стяжка пола", 25000, 0}, {"Шпаклёвка и покраска", 10000, 5},
			{"Плитка в санузле", 5000, 3}, {"Укладка ламината", 15000, 10}, {"Электрика · чистовая", 20000, 0}, {"Уборка и сдача объекта", 0, 0}},
		documents: []string{docContract, docAct, docAct, docAct, docAct, docHandOver, docWarranty},
		checklist: []string{
			"Стены: отклонение не больше 2 мм на 2 м", "Углы и откосы ровные, без трещин", "Плитка: швы ровные, пустот при простукивании нет",
			"Ламинат без щелей и скрипа, зазоры закрыты плинтусом", "Розетки и выключатели работают, группы подписаны в щитке",
			"Сантехника без протечек, вода уходит свободно", "Двери и окна открываются без усилия", "Мусор вывезен, объект убран"},
	},
	{
		name: "Косметический ремонт", kind: "косметический ремонт", warranty: 12,
		lines: []sl{q(secDemolition, "p-trash", 1000), f(secWalls, "p-wallpaper", "walls_dry", 1000), f(secFloors, "p-laminate", "floor_dry", 1000),
			f(secFloors, "p-skirting", "perimeter_dry", 1000), f(secMaterials, "m-laminate32", "floor_dry", 1070), f(secMaterials, "m-skirting", "perimeter_dry", 1050)},
		materials: []sl{f(secMaterials, "m-laminate32", "floor_dry", 1070), f(secMaterials, "m-skirting", "perimeter_dry", 1050), f(secMaterials, "m-primer", "walls", 200)},
		stages:    []st{{"Подготовка и вывоз мусора", 0, 0}, {"Поклейка обоев", 20000, 0}, {"Укладка ламината", 20000, 0}, {"Монтаж плинтуса", 30000, 0}, {"Уборка и сдача объекта", 0, 0}},
		documents: []string{docContract, docHandOver, docWarranty},
		checklist: []string{"Обои: стыки не видны, пузырей нет", "Ламинат без щелей и скрипа", "Плинтус закреплён, углы подогнаны", "Мусор вывезен, объект убран"},
	},
	{
		name: "Коммерческое помещение", kind: "коммерческий ремонт", warranty: 12,
		lines: []sl{q(secDemolition, "p-dem-wall", 26000), q(secDemolition, "p-trash", 3000), q(secElectrics, "p-el-point", 40000), q(secElectrics, "p-shield", 1000),
			f(secWalls, "p-paint", "walls", 1000), f(secFloors, "p-screed", "floor", 1000), f(secFloors, "p-tile", "floor", 1000),
			f(secMaterials, "m-paint", "walls", 300), f(secMaterials, "m-tile", "floor", 1100), q(secMaterials, "m-cable", 2000)},
		materials: []sl{f(secMaterials, "m-paint", "walls", 300), f(secMaterials, "m-tile", "floor", 1100), q(secMaterials, "m-cable", 2000), f(secMaterials, "m-primer", "walls", 200)},
		stages: []st{{"Демонтаж перегородок", 10000, 0}, {"Электрика · черновая", 6000, 0}, {"Стяжка пола", 30000, 0}, {"Шпаклёвка и покраска", 15000, 0},
			{"Укладка плитки", 8000, 3}, {"Электрика · чистовая", 25000, 0}, {"Уборка и сдача объекта", 0, 0}},
		documents: []string{docContract, docAct, docAct, docHandOver, docWarranty},
		checklist: []string{"Покрытие пола ровное, швы затёрты", "Освещение и розетки работают по проекту", "Пути эвакуации свободны", "Мусор вывезен, помещение убрано"},
	},
}

// ensureStarter copies the starter set of Ortus into an organization that keeps the catalog and has none of its
// templates yet (Q-W6.12-2: there is no hook of the connection of the module, the first read of the catalog does it). It
// is idempotent: a lock serializes the readers and a second look under it finds the set.
func (s *Service) ensureStarter(ctx context.Context, tc tenantctx.TenantContext) error {
	var need bool
	if err := s.run(ctx, tc, false, func(r *req) error {
		ok, err := r.anywhere(ctx, actCatalog)
		if err != nil || !ok {
			return err
		}
		return store("starter check", r.tx.QueryRow(ctx, `select not exists (select 1 from repairs.templates where source = 'ortus')`).Scan(&need))
	}); err != nil || !need {
		return err
	}
	return s.run(ctx, tc, true, func(r *req) error {
		if _, err := r.tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('repairs.starter'))`); err != nil {
			return store("starter lock", err)
		}
		var still bool
		if err := r.tx.QueryRow(ctx, `select not exists (select 1 from repairs.templates where source = 'ortus')`).Scan(&still); err != nil {
			return store("starter check", err)
		}
		if !still {
			return nil
		}
		return r.seedStarter(ctx)
	})
}

// seedStarter writes the items of the starter price list that the organization does not have (by name) and the three
// templates over them.
func (r *req) seedStarter(ctx context.Context) error {
	ids := make(map[string]uuid.UUID, len(starterItems))
	for _, it := range starterItems {
		var id uuid.UUID
		err := r.tx.QueryRow(ctx, `select id from repairs.price_items where not archived and lower(btrim(name)) = lower($1)`, it.name).Scan(&id)
		if noRows(err) {
			id = uuid.New()
			_, err = r.tx.Exec(ctx, `insert into repairs.price_items (id, section, name, unit, kind, price_minor, currency, created_at, updated_at)
				values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`, id, it.section, it.name, it.unit, it.kind, it.rub*100, currency, r.now)
		}
		if err != nil {
			return store("starter item "+it.key, err)
		}
		ids[it.key] = id
	}
	for _, t := range starterTemplates {
		row := &tplRow{id: uuid.New(), name: t.name, kind: t.kind, source: "ortus", documents: t.documents, checklist: t.checklist, warranty: t.warranty}
		var lines []tplLine
		for _, set := range []struct {
			part  string
			lines []sl
		}{{partEstimate, t.lines}, {partMaterial, t.materials}} {
			for _, l := range set.lines {
				tl := tplLine{part: set.part, section: l.section, item: ids[l.item]}
				if l.formula != "" {
					tl.formula, tl.coef = new(l.formula), new(l.k)
				} else {
					tl.qty = new(l.qty)
				}
				lines = append(lines, tl)
			}
		}
		stages := make([]tplStage, 0, len(t.stages))
		for _, s := range t.stages {
			stage := tplStage{name: s.name, pause: s.pause, sections: []string{}}
			if s.rate > 0 {
				stage.rate = new(milli(s.rate))
			}
			stages = append(stages, stage)
		}
		if err := r.insertTemplate(ctx, row, lines, stages); err != nil {
			return err
		}
	}
	return nil
}
