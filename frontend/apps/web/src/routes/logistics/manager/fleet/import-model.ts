// W2.50 · Модель экрана «Импорт машин» (`logistics-vehicle-import`, no-reference; D-11 комплекта, контракт
// 0.6.1-stage2 W2.52: createVehicleImport → commitVehicleImport). Фирма по умолчанию — фирмы права
// fleet.vehicles.manage (как фирма рейса формы планирования W2.20); итоги и строки предпросмотра; выбор применения;
// ошибка файла (422 заголовка, 413 размера) — текстом сервера.
import type { components } from '@ortus/api-client';
import { ProblemError } from '@ortus/api-client';
import { format } from '@ortus/texts';

import { problemCode, problemText } from '../../../../shell/run.tsx';
import { unitLabel } from '../../../../shell/scope.ts';
import { type Access, may } from './model.ts';
import { FLEET_TEXT } from './texts.ts';

type S = components['schemas'];
type Import = S['VehicleImport'];
type Row = S['VehicleImportRow'];

const T = FLEET_TEXT.import;

export const MANAGE = 'fleet.vehicles.manage';

export interface UnitOption {
  value: string;
  label: string;
}

/** Фирмы, в которые можно импортировать машины; по умолчанию — первая по алфавиту или подразделение права. */
export function importUnits(a: Access): { options: UnitOption[]; defaultId: string } {
  const options = a.units
    .filter((u) => u.status === 'active' && u.kind !== 'region')
    .filter((u) => may(a, MANAGE, u.id))
    .map((u) => ({ value: u.id, label: unitLabel(a.units, u.id) ?? u.name }))
    .sort((x, y) => x.label.localeCompare(y.label, 'ru'));
  // Без названий подразделений (нет org_units.read) — подразделение права на машины.
  const capUnit = a.caps.find((c) => c.permission === MANAGE && c.scope.kind === 'org_unit')?.scope
    .resourceIds[0];
  return { options, defaultId: options[0]?.value ?? capUnit ?? '' };
}

export interface Stat {
  key: keyof S['VehicleImportTotals'];
  label: string;
  value: string;
}

/** Итоги предпросмотра; после применения — прошедшее время и «Пропущено» вместо «С ошибками». */
export function summary(imp: Import): Stat[] {
  const done = imp.state === 'committed';
  const keys: Stat['key'][] = done
    ? ['rows', 'create', 'update', 'skip']
    : ['rows', 'create', 'update', 'error'];
  const labels = done ? T.totalsDone : T.totals;
  return keys.map((key) => ({ key, label: labels[key], value: String(imp.totals[key]) }));
}

type Violation = S['ProblemViolation'];

/**
 * Ошибка строки с колонкой: «body_type (кузов): Неизвестный тип кузова» — код заголовка файла и подпись, как ошибка
 * заголовка сервера; вся строка (`line`) — «строка»; колонка новее экрана — её код; без поля — только текст.
 */
export function violationText(v: Violation): string {
  const labels: Readonly<Record<string, string>> = T.columnLabels;
  const label = labels[v.field];
  let column: string = v.field;
  if (v.field === 'line') column = T.wholeLine;
  else if (label) column = format(T.fieldNamed, { field: v.field, label });
  return column ? format(T.fieldError, { column, message: v.message }) : v.message;
}

export interface RowView {
  line: number;
  title: string;
  action: string;
  tone: 'ok' | 'info' | 'neutral' | 'danger';
  errors: string[];
}

const TONE: Readonly<Record<Row['action'], RowView['tone']>> = {
  create: 'ok',
  update: 'info',
  skip: 'neutral',
  error: 'danger',
};

/** «Строка N · госномер · название», действие и ошибки сервера по колонкам строки. */
export function rowView(r: Row): RowView {
  return {
    line: r.line,
    title: [format(T.line, { line: String(r.line) }), r.registrationNumber, r.displayName]
      .filter((x): x is string => !!x)
      .join(' · '),
    action: T.actions[r.action],
    tone: TONE[r.action],
    errors: r.errors.map(violationText),
  };
}

/** Строки с ошибками и строки к применению (создание, обновление, пропуск) — в порядке файла. */
export function splitRows(imp: Import): { errors: RowView[]; valid: RowView[] } {
  const views = imp.rows.map(rowView);
  return {
    errors: views.filter((_, i) => imp.rows[i]?.action === 'error'),
    valid: views.filter((_, i) => imp.rows[i]?.action !== 'error'),
  };
}

/** Что можно применить: всё, без строк с ошибками или ничего. */
export function applyChoice(imp: Import): 'apply' | 'skip' | 'none' {
  if (imp.state !== 'previewed') return 'none';
  const valid = imp.totals.create + imp.totals.update;
  if (valid === 0) return 'none';
  return imp.totals.error > 0 ? 'skip' : 'apply';
}

export const resultText = (imp: Import): string =>
  format(T.result, {
    create: String(imp.totals.create),
    update: String(imp.totals.update),
    skip: String(imp.totals.skip),
  });

/** Ошибка файла: текст сервера (detail 422 заголовка, 413 размера); иначе — словарь по коду. */
export function fileError(e: unknown): string {
  if (e instanceof ProblemError && e.problem?.detail) return e.problem.detail;
  return problemText(e);
}

/**
 * Коды устаревшего предпросмотра на «Применить»: 412 revision_mismatch (ETag) и 409 invalid_transition (импорт
 * уже применён или истёк, госномер только что заняли — сервер просит загрузить файл заново).
 */
export const STALE_CODES = ['revision_mismatch', 'invalid_transition'] as const;

/** Предпросмотр устарел — те же коды, что `quiet` «Применить»: прочие 409 (повтор ключа) показывает тост run. */
export const isStale = (e: unknown): boolean =>
  (STALE_CODES as readonly string[]).includes(problemCode(e));

const BOM = String.fromCharCode(0xfeff);

/** Текст файла без BOM (Excel сохраняет «CSV UTF-8» с BOM — иначе первая колонка не узнаётся). */
export const stripBom = (text: string): string => (text.startsWith(BOM) ? text.slice(1) : text);
