// Правила логистики 14.10 (models.js:322–389): одни и те же для mock-сервера (проверки) и UI
// (предпросмотр). Тексты и порядок проверок — как в эталоне; Go-копия — W2.01.
import { int, num, plural } from '../../core/format.ts';
import { DEP_CHECKS, PHOTO_SIDES, RET_CHECKS, VEHICLE_STATE } from './dictionaries.ts';
import type {
  CompatCheck,
  CompatResult,
  ExpenseDraft,
  ExpenseErrors,
  InspectionDraft,
  Leg,
  TempRange,
  Trip,
  Vehicle,
} from './types.ts';

const signed = (n: number): string => (n > 0 ? '+' : '') + n;

/** «-18…+8 °C». */
export const tempLabel = (t: TempRange): string => signed(t[0]) + '…' + signed(t[1]) + ' °C';

/** Совместимость машины с грузом рейса. Сумма объёма и массы — не 3D-укладка. */
export function compat(v: Vehicle, trip: Trip): CompatResult {
  const c = trip.cargo;
  const mine = v.heldBy === trip.id;
  const avail = v.state === 'free' || mine;
  const st = VEHICLE_STATE[v.state];
  const checks: CompatCheck[] = [
    {
      key: 'avail',
      label: 'Доступность',
      icon: st.icon,
      ok: avail,
      value: mine ? 'Назначена на этот рейс' : st.label + (v.note ? ' · ' + v.note : ''),
    },
    {
      key: 'payload',
      label: 'Грузоподъёмность',
      icon: 'scale',
      ok: v.payloadT >= c.weightT,
      value: num(v.payloadT) + ' т',
      need: 'от ' + num(c.weightT) + ' т',
    },
    {
      key: 'volume',
      label: 'Объём',
      icon: 'deployed_code',
      ok: v.volumeM3 >= c.volumeM3,
      value: num(v.volumeM3) + ' м³',
      need: 'от ' + num(c.volumeM3) + ' м³',
    },
    {
      key: 'length',
      label: 'Длина кузова',
      icon: 'straighten',
      ok: v.lengthM >= c.lengthM,
      value: num(v.lengthM) + ' м',
      need: 'от ' + num(c.lengthM) + ' м',
    },
  ];
  if (c.temp) {
    const ok = !!v.temp && v.temp[0] <= c.temp[0] && v.temp[1] >= c.temp[1];
    checks.push({
      key: 'temp',
      label: 'Температура',
      icon: 'thermostat',
      ok,
      value: v.temp ? tempLabel(v.temp) : 'без охлаждения',
      need: tempLabel(c.temp),
    });
  } else {
    checks.push({
      key: 'temp',
      label: 'Температура',
      icon: 'thermostat',
      ok: true,
      value: 'не требуется',
    });
  }
  const fit = checks.slice(1).every((x) => x.ok);
  const reasons = checks
    .filter((x) => !x.ok)
    .map((x) => x.label + ': ' + x.value + (x.need ? ', нужно ' + x.need : ''));
  return { fit, ok: fit && avail, checks, reasons };
}

const round2 = (x: number): number => Math.max(0, Math.round(x * 100) / 100);

/** Загрузка после каждой остановки: объём и масса отдельно; проценты — только с машиной. */
export function legs(trip: Trip, v?: Vehicle): Leg[] {
  let w = 0;
  let vol = 0;
  return trip.stops.map((s) => {
    const sign = s.op === 'load' ? 1 : -1;
    w = round2(w + sign * s.w);
    vol = round2(vol + sign * s.v);
    return {
      ...s,
      wAfter: w,
      vAfter: vol,
      wPct: v ? Math.round((w / v.payloadT) * 100) : null,
      vPct: v ? Math.round((vol / v.volumeM3) * 100) : null,
    };
  });
}

const toNumber = (x: unknown): number => Number(String(x).replace(/\s/g, ''));

/** Чего не хватает, чтобы отправить осмотр выезда (`dep`) или сдачи (`ret`). */
export function inspMissing(d: InspectionDraft, kind: 'dep' | 'ret', minOdo: number): string[] {
  const miss: string[] = [];
  const count = (state: string) => PHOTO_SIDES.filter(([k]) => d.photos[k]?.state === state).length;
  const have = count('ready') + count('queued');
  if (have < 5) miss.push(5 - have + ' фото');
  const odo = toNumber(d.odometer);
  if (d.odometer === '' || !Number.isFinite(odo)) miss.push('пробег');
  else if (odo < minOdo) miss.push('пробег не меньше ' + int(minOdo) + ' км');
  if (!d.fuel) miss.push('уровень топлива');
  const list = kind === 'dep' ? DEP_CHECKS : RET_CHECKS;
  const c = list.filter(([k]) => !d.checks[k]).length;
  if (c) miss.push(c + ' ' + plural(c, 'пункт', 'пункта', 'пунктов') + ' чек-листа');
  return miss;
}

/** Ошибка поля «Пробег»: меньше начального или подозрительно больше (+3000 км). */
export function odoError(value: string, minOdo: number): string | null {
  if (value === '') return null;
  const n = toNumber(value);
  if (!Number.isFinite(n)) return 'Введите число';
  if (n < minOdo) return 'Пробег не может быть меньше ' + int(minOdo) + ' км';
  if (n > minOdo + 3000)
    return 'Больше начального на ' + int(n - minOdo) + ' км — проверьте показания';
  return null;
}

/** Ошибки формы расхода по полям; пустой объект — расход можно отправить. */
export function validateExpense(e: ExpenseDraft): ExpenseErrors {
  const err: ExpenseErrors = {};
  const a = toNumber(String(e.amount).replace(',', '.'));
  if (e.amount === '' || e.amount == null) err.amount = 'Укажите сумму';
  else if (!Number.isFinite(a)) err.amount = 'Сумма должна быть числом';
  else if (a <= 0) err.amount = 'Сумма должна быть больше нуля';
  else if (a > 200000) err.amount = 'Больше 200 000 ₽ — проверьте сумму';
  if (!e.date) err.date = 'Укажите дату';
  const r = e.receipt?.state;
  if (r === 'uploading') err.receipt = 'Дождитесь окончания загрузки чека';
  else if (r !== 'ready' && r !== 'queued') err.receipt = 'Добавьте фото чека';
  return err;
}
