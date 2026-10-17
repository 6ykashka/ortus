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
    decision: d.decision
      ? {
          chip: CHIPS[d.decision],
          at: d.decidedAt ? at(T.decidedAt, d.decidedAt) : '',
          comment: d.decisionComment ?? null,
        }
      : null,
  };
}
