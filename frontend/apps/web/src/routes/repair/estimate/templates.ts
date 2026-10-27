// W6.21 · Выбор шаблона для черновика сметы (эталон design-2026-10-19 «Ремонт и стройка.dc.html» estVM :1390–1408,
// tplMeta :1327, srcChip :1328; fval :845, rq :847, lineFrom :1332). Сервер собирает черновик сам; здесь — подписи
// и сумма «по замеру и ценам справочника», которую человек видит до нажатия «Собрать черновик сметы».
import type { components } from '@ortus/api-client';

import { fmtNum, type MeasureTotals, measureOf, type RoomDraft } from '../measure/calc.ts';
import { dm, plw } from './format.ts';
import { type Chip, FORMULA_LABEL } from './vm.ts';

type S = components['schemas'];
type TemplateLine = S['TemplateLine'];

export const templateMeta = (t: S['Template']): string => {
  const sections = new Set(t.lines.map((l) => l.section)).size;
  const lines = t.lines.length;
  const formulas = t.lines.filter((l) => l.formula).length;
  return `${sections} ${plw(sections, 'раздел', 'раздела', 'разделов')} · ${lines} ${plw(lines, 'строка', 'строки', 'строк')} · ${formulas} из замера`;
};

export function sourceChip(t: S['Template']): Chip {
  if (t.source === 'ortus')
    return { label: 'Ортус · копия организации', tone: 'neutral', icon: 'verified' };
  return {
    label: t.copiedFromId ? 'Свой · копия' : 'Свой · из объекта',
    tone: 'info',
    icon: 'bookmark',
  };
}

/** Шаблон по умолчанию: подходящий к виду ремонта, иначе первый. */
export const defaultTemplateId = (
  templates: readonly S['Template'][],
  kind: string | undefined,
): string | undefined => (templates.find((t) => t.kind === kind) ?? templates[0])?.id;

export interface Part {
  icon: string;
  title: string;
  text: string;
}

const DOC_NAME: Readonly<Record<S['RepairDocumentKind'], string>> = {
  contract: 'договор подряда',
  agreement: 'допсоглашения',
  act: 'акты по разделам',
  invoice: 'счета',
  handover_act: 'акт сдачи объекта',
  warranty: 'гарантийный паспорт',
};

export function templateParts(t: S['Template']): Part[] {
  const sections = new Set(t.lines.map((l) => l.section)).size;
  const lines = t.lines.length;
  const formulas = t.lines.flatMap((l) => (l.formula ? [l.formula] : []));
  const labels = [...new Set(formulas.map((f) => FORMULA_LABEL[f]))].slice(0, 3);
  const stages = t.stages.length;
  const checks = t.checklist.length;
  const mats = t.materials.length;
  return [
    {
      icon: 'request_quote',
      title: 'Разделы и работы сметы',
      text: `${sections} ${plw(sections, 'раздел', 'раздела', 'разделов')}, ${lines} ${plw(lines, 'строка', 'строки', 'строк')} · цены из справочника на сегодня`,
    },
    {
      icon: 'straighten',
      title: 'Формулы объёмов из замера',
      text: `${formulas.length} ${plw(formulas.length, 'строка считается', 'строки считаются', 'строк считаются')} из замера: ${labels.join(', ')}`,
    },
    {
      icon: 'view_timeline',
      title: 'Технология графика',
      text: `${stages} ${plw(stages, 'этап', 'этапа', 'этапов')} с выработкой и паузами на сушку · график соберётся после согласования сметы`,
    },
    {
      icon: 'draw',
      title: 'Комплект документов',
      text: [...new Set(t.documents.map((d) => DOC_NAME[d]))].join(', '),
    },
    {
      icon: 'checklist',
      title: 'Чек-лист приёмки',
      text: `${checks} ${plw(checks, 'пункт', 'пункта', 'пунктов')} для прораба и заказчика при сдаче`,
    },
    {
      icon: 'inventory_2',
      title: 'Материалы для снабжения',
      text: `${mats} ${plw(mats, 'позиция', 'позиции', 'позиций')} с количеством из замера`,
    },
  ];
}

const CEIL_UNITS: ReadonlySet<S['RepairUnit']> = new Set(['piece', 'mesh', 'trip', 'set', 'liter']);

/** Формулы объёма из замера (fval :845). */
function fval(f: NonNullable<TemplateLine['formula']>, m: MeasureTotals): number {
  switch (f) {
    case 'floor':
      return m.floor;
    case 'floor_dry':
      return m.floor - m.bathFloor;
    case 'walls':
      return m.walls;
    case 'walls_dry':
      return m.walls - m.bathWalls;
    case 'wet':
      return m.bathFloor + m.bathWalls;
    case 'perimeter':
      return m.perimeter;
    case 'perimeter_dry':
      return m.perimeter - m.bathPerimeter;
  }
}

/** Объём строки шаблона: по формуле из замера × коэффициент или фиксированный; округление rq эталона. */
export function volumeOf(l: TemplateLine, unit: S['RepairUnit'], m: MeasureTotals): number {
  const raw = l.formula ? fval(l.formula, m) * Number(l.coef ?? 1) : Number(l.quantity ?? 1);
  return CEIL_UNITS.has(unit) ? Math.ceil(raw - 1e-9) : Math.round(raw * 10) / 10;
}

/** Сумма черновика без скидки, копейки; позиции вне справочника не считаются. */
export function templateTotal(
  t: S['Template'],
  prices: ReadonlyMap<string, S['PriceItem']>,
  m: MeasureTotals,
): number {
  let sum = 0;
  for (const l of t.lines) {
    const p = prices.get(l.priceItemId);
    if (p) sum += Math.round(volumeOf(l, p.unit, m) * p.price.amountMinor);
  }
  return sum;
}

export function measureLine(measuredAt: string | undefined, rooms: readonly RoomDraft[]): string {
  const m = measureOf(rooms);
  const n = rooms.length;
  const date = measuredAt ? ` ${dm(measuredAt)}` : '';
  return `Замер${date}: ${n} ${plw(n, 'помещение', 'помещения', 'помещений')} · пол ${fmtNum(m.floor)} м² · стены ${fmtNum(m.walls)} м² · санузлы ${fmtNum(m.bathFloor + m.bathWalls)} м²`;
}
