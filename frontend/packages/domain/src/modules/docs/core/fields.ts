// Поля CRM в документе (documents.js 14.10:215–235): значения подставляются из организации,
// владельца, подразделения папки, объекта ремонта и рейса; `{Поле}` в тексте заменяется значением.
//
// Отличие от эталона: «организация» — запись платформы с `id === db.tenantId`, а не `tenants[0]`
// (у «Лотоса» эталон подставлял «Альта»).
import { objOf } from '../../../core/entries.ts';
import { unitName } from './labels.ts';
import { folderPath } from './tree.ts';
import type { DocItem, DocsTenantDb } from './types.ts';

interface TripRef {
  id: string;
  title?: string;
  date?: string;
  driverName?: string;
  vehicleId?: string;
}
interface VehicleRef {
  id: string;
  model?: string;
  plate?: string;
}
type Extra = {
  trips?: TripRef[];
  vehicles?: VehicleRef[];
  platform?: { tenants?: { id: string; name?: string }[] };
};

function tenantName(db: DocsTenantDb): string {
  const ts = (db as Extra).platform?.tenants ?? [];
  return (ts.find((t) => t.id === db.tenantId) ?? ts[0])?.name || '';
}

/** Значения полей документа: имя поля → строка. Замороженные (`frozen`) важнее источника. */
export function fieldVals(db: DocsTenantDb, d: DocItem): Record<string, string> {
  const out: Record<string, string> = {};
  const x = db as Extra;
  const lk = d.links[0];
  const o =
    lk?.kind === 'object' ? (objOf(db, lk.id) as Record<string, unknown> | undefined) : undefined;
  const t = lk?.kind === 'trip' ? x.trips?.find((y) => y.id === lk.id) : undefined;
  const own = db.members.find((m) => m.id === 'm-owner');
  const top = folderPath(db, d.folder)[0];
  for (const f of d.fields ?? []) {
    let v = f.v || '';
    const src = f.src;
    if (d.frozen && f.k in d.frozen) v = d.frozen[f.k] as string;
    else if (src === 'tenant') v = 'ООО «' + tenantName(db) + '»';
    else if (src === 'owner') v = own ? own.name : '';
    else if (src === 'unit') v = top?.unit ? unitName(db, top.unit) : tenantName(db);
    else if (src?.startsWith('obj.')) {
      const val = o?.[src.slice(4)];
      v = o ? (typeof val === 'string' ? val : val ? String(val) : '') : f.v || '';
    } else if (src === 'trip.driverName') v = t ? t.driverName || '' : '';
    else if (src === 'trip.date') v = t ? (t.date ?? '') : '';
    else if (src === 'trip.ref') v = t ? t.id + ' · ' + t.title : '';
    else if (src === 'trip.vehicle') {
      const vh = t && x.vehicles?.find((y) => y.id === t.vehicleId);
      v = vh ? vh.model + ' ' + vh.plate : t ? 'машина не назначена' : '';
    }
    out[f.k] = v;
  }
  return out;
}

/** Подставляет значения в `{Поле}`; неизвестное поле остаётся как есть. */
export const fillTokens = (
  text: string | undefined,
  vals: Record<string, string> | undefined,
): string =>
  String(text ?? '').replace(/\{([^{}]+)\}/g, (m, k: string) =>
    vals && k in vals ? (vals[k] as string) : m,
  );
