// W2.25 · Вид «Главной» (homeVM :4097–4136; 05 §5.3–5.7): приветствие по часам, дата (вычисляется, Q-61),
// сводка, «Начало работы» владельца, «Сегодня в работе» (логистика и неподключённые отраслевые модули),
// «Рейсы сегодня». Подписи — ключи словаря `home.*`; состояния рейса — TRIP_STATE домена логистики.
import { TRIP_STATE } from '../modules/logistics/dictionaries.ts';
import { dayKey, hhmm, hourOf } from './time.ts';
import type { HomeMsg, HomeTarget } from './types.ts';

/** Рейс из listTripPlans (`TripPlan` контракта). */
export interface TripLike {
  id: string;
  number: string;
  title: string;
  state: string;
  plannedWindow: { startsAt: string; endsAt: string; timeZone?: string };
  driverDisplayName?: string;
  vehicleId?: string;
}

/** Машина из listVehicles (`Vehicle`: `available` — свободна). */
export interface VehicleLike {
  id: string;
  displayName: string;
  status: string;
}

/** «Доброе утро» до 12, «Добрый день» до 18, иначе «Добрый вечер» (:4127); имя — первое слово. */
export function greeting(now: Date, timeZone: string, displayName: string): HomeMsg {
  const h = hourOf(now, timeZone);
  const part = h < 12 ? 'morning' : h < 18 ? 'day' : 'evening';
  return { key: 'greeting', args: { part, name: displayName.trim().split(/\s+/)[0] ?? '' } };
}

/** «Среда, 1 октября» (в эталоне захардкожено :4126, Q-61). */
export function dateLine(now: Date, timeZone: string): string {
  const s = new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** «Требует решения: N. …» / «Срочных вопросов нет.» (:4128). */
export const summary = (n: number): HomeMsg => ({ key: 'summary', args: { n } });

export interface SetupStep {
  id: 'module' | 'roles' | 'invite';
  n: number;
  done: boolean;
  /** Первый невыполненный шаг (акцентная кнопка). */
  current: boolean;
  title: HomeMsg;
  text: HomeMsg;
  action: { label: HomeMsg; target: HomeTarget };
}

export interface SetupInput {
  /** Подключён отраслевой модуль (логистика или ремонт, :4116). */
  industryOn: boolean;
  /** Роли с областью назначены — в очереди нет «сотрудников без роли» (Q-66, бриф §10 п. 2). */
  rolesAssigned: boolean;
  /** В организации есть приглашённые сотрудники (бриф §10 п. 3). */
  invited: boolean;
}

const USERS: HomeTarget = { page: 'users', search: { tab: 'people' } };

/** «Начало работы» владельца (:4115–4130): три шага, прогресс, блок скрыт при 3 из 3. */
export function setupSteps(i: SetupInput): {
  show: boolean;
  progress: HomeMsg;
  steps: SetupStep[];
} {
  const raw = [
    { id: 'module', done: i.industryOn, target: { page: 'modules' } },
    { id: 'roles', done: i.rolesAssigned, target: USERS },
    { id: 'invite', done: i.invited, target: USERS },
  ] as const;
  const first = raw.findIndex((s) => !s.done);
  const steps = raw.map((s, n) => ({
    id: s.id,
    n: n + 1,
    done: s.done,
    current: n === first,
    title: { key: `setup.${s.id}.title` as const },
    text: { key: `setup.${s.id}.text` as const },
    action: { label: { key: `setup.${s.id}.action` as const }, target: s.target },
  }));
  const done = steps.filter((s) => s.done).length;
  return {
    show: done < steps.length,
    progress: { key: 'setup.progress', args: { done, total: steps.length } },
    steps,
  };
}

const today = (trips: readonly TripLike[], now: Date, timeZone: string): TripLike[] => {
  const day = dayKey(now, timeZone);
  return trips.filter(
    (t) =>
      t.state !== 'cancelled' &&
      dayKey(new Date(t.plannedWindow.startsAt), t.plannedWindow.timeZone ?? timeZone) === day,
  );
};

export interface WorkCard {
  icon: string;
  title: HomeMsg;
  target: HomeTarget;
  lines: { label: HomeMsg; value: string | HomeMsg }[];
}

/** Карточка «Логистика» (:4098–4105). */
export function logisticsWork(
  trips: readonly TripLike[],
  vehicles: readonly VehicleLike[],
  now: Date,
  timeZone: string,
): WorkCard {
  const day = today(trips, now, timeZone);
  const count = (state: string) => String(day.filter((t) => t.state === state).length);
  const free = vehicles.filter((v) => v.status === 'available').length;
  return {
    icon: 'local_shipping',
    title: { key: 'work.logistics' },
    target: { page: 'fleet' },
    lines: [
      { label: { key: 'work.tripsToday' }, value: String(day.length) },
      { label: { key: 'work.onRoute' }, value: count('on_route') },
      {
        label: { key: 'work.freeVehicles' },
        value: { key: 'work.freeOf', args: { free, total: vehicles.length } },
      },
      { label: { key: 'work.awaitingReview' }, value: count('submitted') },
    ],
  };
}

const INDUSTRY = [
  { moduleKey: 'fleet', icon: 'local_shipping', title: { key: 'work.logistics' } },
  { moduleKey: 'spa', icon: 'spa', title: { key: 'work.spa' } },
  { moduleKey: 'repairs', icon: 'construction', title: { key: 'work.repair' } },
] as const satisfies readonly { moduleKey: string; icon: string; title: HomeMsg }[];

const ON = new Set(['active', 'draining', 'read_only']);

/** Пунктирные карточки неподключённых отраслевых модулей владельца (:4106–4111), порядок эталона. */
export function offModules(
  modules: readonly { moduleKey: string; state: string }[],
): { moduleKey: string; icon: string; title: HomeMsg }[] {
  const state = new Map(modules.map((m) => [m.moduleKey, m.state]));
  return INDUSTRY.filter((m) => !ON.has(state.get(m.moduleKey) ?? 'uninstalled')).map((m) => ({
    ...m,
  }));
}

export interface TripRow {
  key: string;
  time: string;
  title: HomeMsg;
  sub: { driver: string | HomeMsg; vehicle: string | HomeMsg };
  chip: { label: string; tone: string; icon: string };
  target: HomeTarget;
}

const TO_REVIEW = new Set(['submitted', 'defect_review', 'rework', 'accepted']);

/** «Рейсы сегодня» (:4134): по началу окна; приёмочные состояния — «Приёмка смен», иначе рабочее место логиста. */
export function tripsToday(
  trips: readonly TripLike[],
  vehicles: readonly VehicleLike[],
  now: Date,
  timeZone: string,
): TripRow[] {
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  return today(trips, now, timeZone)
    .sort((a, b) => Date.parse(a.plannedWindow.startsAt) - Date.parse(b.plannedWindow.startsAt))
    .flatMap((t) => {
      const state = TRIP_STATE[t.state as keyof typeof TRIP_STATE] as
        (typeof TRIP_STATE)[keyof typeof TRIP_STATE] | undefined;
      if (!state) return [];
      const v = t.vehicleId ? byId.get(t.vehicleId) : undefined;
      return [
        {
          key: t.id,
          time: hhmm(new Date(t.plannedWindow.startsAt), t.plannedWindow.timeZone ?? timeZone),
          title: { key: 'trips.row', args: { trip: t.number, title: t.title } },
          sub: {
            driver: t.driverDisplayName || { key: 'trips.noDriver' },
            vehicle: v?.displayName || { key: 'trips.noVehicle' },
          },
          chip: { label: state.label, tone: state.tone, icon: state.icon },
          target: { page: TO_REVIEW.has(t.state) ? 'review' : 'fleet', search: { trip: t.id } },
        },
      ];
    });
}
