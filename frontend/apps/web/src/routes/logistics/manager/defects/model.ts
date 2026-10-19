// W2.21 · Модель «Очереди блокирующих дефектов» (`logistics-defects`, S2-17; no-reference B-6 №7, 14-stage2-dor.md
// §4): блокирующие дефекты осмотров выезда на проверке менеджера (state `in_review`, старые первыми) и решённые
// («разрешить выезд» → `resolved`, «подтвердить неисправность» → `confirmed_out_of_service`; свежие первыми).
import type { components } from '@ortus/api-client';
import { format } from '@ortus/texts';

import { type Chip, dateOf, timeOf } from '../review/model.ts';
import { DEFECTS_TEXT as T } from './texts.ts';

type S = components['schemas'];
type Defect = S['InspectionDefect'];

export interface DefectRow {
  id: string;
  title: string;
  trip: string;
  vehicle: string;
  reported: string;
  /** W2.46: «Исполнитель: {имя} · срок {дата} в {время}»; не назначен — null. */
  assignee: string | null;
  decision: { chip: Chip; at: string; comment: string | null } | null;
}

const CHIPS: Record<NonNullable<Defect['decision']>, Chip> = {
  allow_departure: { label: T.decisions.allow_departure, tone: 'ok', icon: 'check_circle' },
  confirm_out_of_service: {
    label: T.decisions.confirm_out_of_service,
    tone: 'danger',
    icon: 'block',
  },
};

const DECIDED: readonly Defect['state'][] = ['resolved', 'confirmed_out_of_service'];

/** «На проверке» и «Решённые» (только блокирующие: некритичные в очередь не попадают). */
export function partition(list: readonly Defect[]): { review: Defect[]; decided: Defect[] } {
  const blocking = list.filter((d) => d.severity === 'blocking');
  return {
    review: blocking
      .filter((d) => d.state === 'in_review')
      .sort((a, b) => a.reportedAt.localeCompare(b.reportedAt)),
    decided: blocking
      .filter((d) => DECIDED.includes(d.state))
      .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? '')),
  };
}

const at = (tpl: string, iso: string): string =>
  format(tpl, { date: dateOf(iso), time: timeOf(iso) });

export function defectRow(d: Defect): DefectRow {
  const trip = d.tripNumber
    ? d.driverDisplayName
      ? format(T.trip, { trip: d.tripNumber, driver: d.driverDisplayName })
      : format(T.tripOnly, { trip: d.tripNumber })
    : '';
  return {
    id: d.id,
    title: format(T.title, { zone: d.zone, text: d.description }),
    trip,
    vehicle: d.vehicleDisplayName
      ? format(T.vehicle, { model: d.vehicleDisplayName, plate: d.registrationNumber ?? '' })
      : '',
    reported: at(T.reported, d.reportedAt),
    assignee: assigneeLine(d),
    decision: d.decision
      ? {
          chip: CHIPS[d.decision],
          at: d.decidedAt ? at(T.decidedAt, d.decidedAt) : '',
          comment: d.decisionComment ?? null,
        }
      : null,
  };
}

function assigneeLine(d: Defect): string | null {
  if (!d.assigneeMemberId) return null;
  const name = d.assigneeDisplayName ?? '';
  return d.dueAt
    ? format(T.assignee, { name, date: dateOf(d.dueAt), time: timeOf(d.dueAt) })
    : format(T.assigneeOnly, { name });
}

/** Москва — UTC+3 без перехода на летнее время (времена страницы — по Москве). */
const MSK_OFFSET = '+03:00';
const LOCAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Значение поля «дата и время» (`YYYY-MM-DDTHH:MM`, московское время) → `Instant` контракта с суффиксом Z. */
export function dueIso(local: string): string | null {
  if (!LOCAL_RE.test(local)) return null;
  const t = Date.parse(`${local}:00${MSK_OFFSET}`);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().replace('.000Z', 'Z');
}

const byName = new Intl.Collator('ru-RU');

/**
 * Кому назначить дефект: активные участники, кроме тех, у кого из рабочих профилей только «Водитель» (права на очередь
 * у них нет); по алфавиту. Право `fleet.inspections.review` над фирмой машины проверяет сервер (иначе 422).
 */
export function assigneeOptions(members: readonly S['Member'][]): S['Member'][] {
  return members
    .filter(
      (m) =>
        m.status === 'active' &&
        !(m.workProfiles.length > 0 && m.workProfiles.every((w) => w === 'driver')),
    )
    .sort((a, b) => byName.compare(a.displayName, b.displayName));
}
