// W6.22 · Модель «Шаблонов и расценок» (`catVM`, `tplMeta`, `srcChip`, `pickList`, :1327–1329, :1490–1542
// `Ремонт и стройка.dc.html`, снимок design-2026-10-19) поверх DTO контракта 0.12.0-stage6 (Template, PriceItem). Чистые
// функции без React. Подписи эталона, которых нет в контракте (единица и пометка этапа технологии, названия документов),
// собираются из его полей: Q-W6.22-5.
import type { components } from '@ortus/api-client';
import { plural } from '@ortus/domain';
import { FORMULAS, type FormulaKey } from '@ortus/domain/modules';

import { dayCount, dmText, numText, parsePrice, rubText, unitRu } from '../supply/model.ts';
import type { ChipData } from '../supply/ui.tsx';

type S = components['schemas'];
export type Formula = NonNullable<S['TemplateLine']['formula']>;
export type Kind = 'all' | 'work' | 'material';

const FORMULA_KEY: Readonly<Record<Formula, FormulaKey>> = {
  floor: 'floor',
  floor_dry: 'floorDry',
  walls: 'walls',
  walls_dry: 'wallsDry',
  wet: 'bath',
  perimeter: 'perim',
  perimeter_dry: 'perimDry',
};

/** Формулы объёма в порядке эталона (`FML`). */
export const FORMULA_LIST: readonly Formula[] = [
  'floor',
  'floor_dry',
  'walls',
  'walls_dry',
  'wet',
  'perimeter',
  'perimeter_dry',
];

export const formulaLabel = (f: Formula): string => FORMULAS[FORMULA_KEY[f]];

/** Коэффициент эталона (`kTxt`): « × 1,07»; единица не пишется. */
export const kText = (k: string | undefined): string =>
  k && Number(k) !== 1 ? ` × ${k.replace('.', ',')}` : '';

/** «N раздела · N строки · N из замера» (`tplMeta`). */
export function tplMeta(t: S['Template']): string {
  const sections = new Set(t.lines.map((l) => l.section)).size;
  const lines = t.lines.length;
  const measured = t.lines.filter((l) => l.formula).length;
  return `${sections} ${plural(sections, 'раздел', 'раздела', 'разделов')} · ${lines} ${plural(lines, 'строка', 'строки', 'строк')} · ${measured} из замера`;
}

export const tplMetaLine = (t: S['Template']): string =>
  `${tplMeta(t)} · объектов: ${t.usedByObjects}`;

/** Метка происхождения (`srcChip`). */
export function srcChip(t: S['Template']): ChipData {
  if (t.source === 'ortus')
    return { label: 'Ортус · копия организации', tone: 'neutral', icon: 'verified' };
  if (t.copiedFromId) return { label: 'Свой · копия', tone: 'info', icon: 'bookmark' };
  return { label: 'Свой · из объекта', tone: 'info', icon: 'bookmark' };
}

const KEEP = 'Правки не меняют уже созданные объекты.';

/** Откуда шаблон: стартовый, копия «…», сохранён из объекта «…». */
export function tplFrom(
  t: S['Template'],
  templates: readonly S['Template'][],
  projects: readonly { id: string; name: string }[],
): string {
  if (t.source === 'ortus')
    return 'Стартовый шаблон Ортуса, скопирован в организацию. Правки остаются у вас и не меняют уже созданные объекты.';
  if (t.copiedFromId) {
    const name = templates.find((x) => x.id === t.copiedFromId)?.name;
    return `Копия шаблона${name ? ` «${name}»` : ''}. ${KEEP}`;
  }
  const name = projects.find((x) => x.id === t.sourceProjectId)?.name;
  return `Сохранён из объекта${name ? ` «${name}»` : ''}. ${KEEP}`;
}

const priceOf = (prices: readonly S['PriceItem'][], id: string): S['PriceItem'] | undefined =>
  prices.find((p) => p.id === id);

/** Правило объёма строки: «из замера: площадь пола × 1,07» или «фиксированно: 30 шт». */
export function ruleText(
  line: S['TemplateLine'],
  prices: readonly S['PriceItem'][],
): { text: string; formula: boolean } {
  if (line.formula)
    return { text: `из замера: ${formulaLabel(line.formula)}${kText(line.coef)}`, formula: true };
  const unit = priceOf(prices, line.priceItemId)?.unit;
  return {
    text: `фиксированно: ${numText(Number(line.quantity ?? 1))}${unit ? ` ${unitRu(unit)}` : ''}`,
    formula: false,
  };
}

export interface StageRow {
  n: string;
  name: string;
  rate: string;
  pause: string;
}

/** Технология графика: номер, выработка в день («1 день» без выработки), пауза или опережение. */
export function stageRows(t: S['Template']): StageRow[] {
  return t.stages.map((s, i) => {
    const days = s.pauseDays ?? 0;
    return {
      n: String(i + 1),
      name: s.name,
      rate: s.ratePerDay ? `${numText(Number(s.ratePerDay))}/день` : '1 день',
      pause: days < 0 ? `раньше на ${dayCount(-days)}` : days > 0 ? `пауза ${dayCount(days)}` : '',
    };
  });
}

/** Комплект документов шаблона: акты идут по разделам смета без материалов, в порядке разделов. */
export function documentLabels(t: S['Template']): string[] {
  const sections = [...new Set(t.lines.map((l) => l.section))].filter((s) => s !== 'Материалы');
  let act = 0;
  return t.documents.map((d) => {
    switch (d) {
      case 'contract':
        return 'Договор подряда — из согласованной версии сметы';
      case 'agreement':
        return 'Допсоглашение';
      case 'invoice':
        return 'Счёт';
      case 'handover_act':
        return 'Акт сдачи объекта';
      case 'warranty':
        return `Гарантийный паспорт · ${t.warrantyMonths} ${plural(t.warrantyMonths, 'месяц', 'месяца', 'месяцев')}`;
      default: {
        const section = sections[act++];
        return section ? `Акт по разделу «${section}»` : 'Акт';
      }
    }
  });
}

/** Материалы для снабжения: название позиции и правило объёма. */
export function matRows(
  t: S['Template'],
  prices: readonly S['PriceItem'][],
): { name: string; rule: string }[] {
  return t.materials.map((m) => {
    const item = priceOf(prices, m.priceItemId);
    return {
      name: item?.name ?? m.priceItemId,
      rule: m.formula
        ? `${formulaLabel(m.formula)}${kText(m.coef)}`
        : `фиксированно: ${numText(Number(m.quantity ?? 1))}${item ? ` ${unitRu(item.unit)}` : ''}`,
    };
  });
}

export interface PriceRowView {
  id: string;
  name: string;
  kind: string;
  unit: string;
  /** Цена в рублях для поля ввода («1350», «1234,5»). */
  price: string;
  used: string;
  revision: number;
}

/** Справочник: фильтр по названию и типу, группы по разделам в порядке справочника, счётчик «N из M». */
export function priceGroups(
  items: readonly S['PriceItem'][],
  q: string,
  kind: Kind,
): { count: string; groups: { section: string; items: PriceRowView[] }[] } {
  const qq = q.trim().toLowerCase();
  const shown = items.filter(
    (p) => (kind === 'all' || p.kind === kind) && (!qq || p.name.toLowerCase().includes(qq)),
  );
  const sections = [...new Set(shown.map((p) => p.section))];
  return {
    count: `${shown.length} из ${items.length}`,
    groups: sections.map((section) => ({
      section,
      items: shown
        .filter((p) => p.section === section)
        .map((p) => ({
          id: p.id,
          name: p.name,
          kind: p.kind === 'work' ? 'Работа' : 'Материал',
          unit: unitRu(p.unit),
          price: String(p.price.amountMinor / 100).replace('.', ','),
          used: String(p.usedInTemplates),
          revision: p.revision,
        })),
    })),
  };
}

/** Подбор строки из справочника: до 8 позиций, позиции раздела — первыми (`pickList`). */
export function pickList(
  items: readonly S['PriceItem'][],
  q: string,
  section: string,
): { id: string; name: string; meta: string }[] {
  const qq = q.trim().toLowerCase();
  return items
    .filter((p) => !qq || p.name.toLowerCase().includes(qq))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => Number(b.p.section === section) - Number(a.p.section === section) || a.i - b.i)
    .slice(0, 8)
    .map(({ p }) => ({
      id: p.id,
      name: p.name,
      meta: `${unitRu(p.unit)} · ${rubText(p.price.amountMinor)} · ${p.kind === 'work' ? 'работа' : 'материал'}`,
    }));
}

/** Проверка формы «Новая позиция» (:1536–1538): текст ошибки эталона или `null`. */
export function newItemError(
  name: string,
  price: string,
  items: readonly S['PriceItem'][],
): string | null {
  const nm = name.trim();
  if (nm.length < 3) return 'Укажите название позиции';
  if (!(parsePrice(price) > 0)) return 'Укажите цену больше нуля';
  if (items.some((p) => p.name.toLowerCase() === nm.toLowerCase()))
    return 'Такая позиция уже есть в справочнике';
  return null;
}

export const newItemNote = (name: string): string =>
  `«${name}» добавлена в справочник: её можно выбрать в сметах и шаблонах.`;

export const copyNote = (name: string): string =>
  `Копия «${name}» создана — настройте её под свой вид работ.`;

export interface DraftLine {
  key: string;
  priceItemId: string;
  section: string;
  formula: Formula | '';
  coefIn: string;
  qtyIn: string;
}

const comma = (v: string | undefined, def: string): string => (v ? v.replace('.', ',') : def);

/** Черновик правки: строки шаблона с полями ввода (коэффициент и количество — как набрал пользователь). */
export function draftOf(t: S['Template']): DraftLine[] {
  return t.lines.map((l, i) => ({
    key: `${i}:${l.priceItemId}`,
    priceItemId: l.priceItemId,
    section: l.section,
    formula: l.formula ?? '',
    coefIn: comma(l.coef, '1'),
    qtyIn: comma(l.quantity, '1'),
  }));
}

/** Строки `updateTemplate`: формула с коэффициентом (≠ 1) или фиксированное количество (> 0, иначе 1). */
export function linesOf(draft: readonly DraftLine[]): S['TemplateLine'][] {
  return draft.map((d) => {
    if (d.formula) {
      const k = parsePrice(d.coefIn) || 1;
      return {
        priceItemId: d.priceItemId,
        section: d.section,
        formula: d.formula,
        ...(k !== 1 ? { coef: String(k) } : {}),
      };
    }
    const q = parsePrice(d.qtyIn);
    return { priceItemId: d.priceItemId, section: d.section, quantity: String(q > 0 ? q : 1) };
  });
}

/** Дата «изменён дд.мм». */
export const updatedText = (t: S['Template']): string => dmText(t.updatedAt);
