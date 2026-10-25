// Паритет команд «Обращений» с `serviceApi` эталона 19.10: один и тот же сценарий от лица владельца,
// логиста Котовой и массажиста даёт одинаковые результаты, ошибки (код и текст), срез и события.
// Намеренные отличия (компенсация без права, пересчёт сроков при переносе) в сценарий не входят —
// они проверены в `commands.test.ts`. Перенос МАС-40 в КОС даёт те же сроки: у типов «Вопрос» одинаковые
// цели и календарь.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEMO, fixedClock } from '../../core/clock.ts';
import { ApiError } from '../../core/errors/index.ts';
import { createModuleCtx } from '../../core/module.ts';
import { createFakeTaskPort } from '../../core/testing/index.ts';
import { createSeed, FUTURE_STAGE_HOOKS } from '../../seed/compose.ts';
import { importReference } from '../../seed/reference.ts';
import { createPilotModules } from '../index.ts';
import { serviceCommands } from './commands.ts';
import { serviceHook, SVC_BASE } from './seed.ts';
import type { ServiceTenantDb } from './types.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type Env = Record<string, string | undefined>;
const env = (globalThis as unknown as { process: { env: Env } }).process.env;
const TZ_BEFORE = env['TZ'];
const dateNow = vi.spyOn(Date, 'now');

class RefError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface RefService {
  installService(db: unknown): void;
  serviceApi(deps: {
    getDb(): unknown;
    getActor(): string;
    cmd(fn: () => unknown): unknown;
    ApiError: typeof RefError;
    M: unknown;
    event(text: string, to: string[]): void;
  }): Record<string, (...a: unknown[]) => unknown>;
}

let SV: RefService;
let M: unknown;
let MD: { seed(): Record<string, unknown> };

beforeAll(async () => {
  env['TZ'] = 'Europe/Moscow';
  dateNow.mockReturnValue(SVC_BASE);
  SV = await importReference<RefService>('service.js');
  M = await importReference<unknown>('models.js');
  MD = await importReference<{ seed(): Record<string, unknown> }>('mock-data.js');
});

afterAll(() => {
  dateNow.mockRestore();
  if (TZ_BEFORE === undefined) delete env['TZ'];
  else env['TZ'] = TZ_BEFORE;
});

const json = (x: unknown): unknown => JSON.parse(JSON.stringify(x)) as unknown;

type Step = [actor: string, method: string, ...args: unknown[]];

const CALL = {
  dir: 'd-grz',
  kind: 'question',
  name: 'Пётр Первый',
  phone: '+7 900 111-22-33',
  org: 'ООО Ромашка',
  link: 'Рейс Р-1',
  text: 'Где мой груз? Жду второй день.',
};

const SCENARIO: Step[] = [
  [
    'm-owner',
    'svcReply',
    'r-57',
    { kind: 'reply', text: 'Приняли, разбираемся', compensation: 'Скидка 20% на следующий визит' },
  ],
  ['m-owner', 'svcReply', 'r-57', { kind: 'note', text: 'заметка' }],
  ['m-owner', 'svcReply', 'r-57', { kind: 'note', text: 'я' }],
  ['m-owner', 'svcReply', 'r-57', { kind: 'reply', text: '' }],
  ['m-owner', 'svcTransition', 'r-57', 'wait'],
  ['m-owner', 'svcTransition', 'r-57', 'work'],
  ['m-owner', 'svcTransition', 'r-57', 'resolved'],
  ['m-owner', 'svcTransition', 'r-57', 'resolved', { outcome: 'Устранено' }],
  ['m-owner', 'svcTransition', 'r-57', 'work'],
  ['m-owner', 'svcTransition', 'r-57', 'resolved', { outcome: 'Разъяснено' }],
  ['m-owner', 'svcTransition', 'r-57', 'closed'],
  ['m-owner', 'svcTransition', 'r-57', 'work'],
  ['m-owner', 'svcReply', 'r-57', { kind: 'note', text: 'после закрытия' }],
  ['m-kotova', 'svcAssign', 'r-55', null],
  ['m-kotova', 'svcAssign', 'r-55', 'Марина Котова'],
  ['m-kotova', 'svcAssign', 'r-55', 'Анна Морозова'],
  ['m-kotova', 'svcPriority', 'r-55', 'high'],
  ['m-kotova', 'svcPriority', 'r-55', 'zzz'],
  ['m-kotova', 'svcTransition', 'r-55', 'work'],
  ['m-kotova', 'svcTransition', 'r-55', 'wait'],
  ['m-kotova', 'svcTransition', 'r-55', 'resolved', { outcome: 'Компенсация' }],
  ['m-owner', 'svcMove', 'r-40', 'd-kos'],
  ['m-owner', 'svcMove', 'r-40', 'd-kos'],
  ['m-owner', 'svcMove', 'r-40', 'd-zzz'],
  ['m-kotova', 'svcMove', 'r-k6', 'd-grz'],
  ['m-kotova', 'svcMove', 'r-55', 'd-mas'],
  ['m-kotova', 'svcCreate', CALL],
  ['m-kotova', 'svcCreate', { ...CALL, kind: 'complaint', org: '', link: '' }],
  ['m-kotova', 'svcCreate', { ...CALL, name: 'А' }],
  ['m-kotova', 'svcCreate', { ...CALL, phone: '123' }],
  ['m-kotova', 'svcCreate', { ...CALL, text: 'груз' }],
  ['m-kotova', 'svcCreate', { ...CALL, kind: 'zzz' }],
  ['m-kotova', 'svcCreate', { ...CALL, dir: 'd-mas', kind: 'complaint' }],
  ['m-owner', 'svcCreate', { ...CALL, dir: 'd-otd', kind: 'warranty' }],
  ['m-owner', 'svcShowPhone', 'r-57'],
  ['m-kotova', 'svcShowPhone', 'r-o11'],
  ['m-kotova', 'svcShowPhone', 'r-57'],
  ['m-owner', 'svcTransition', 'r-41', 'resolved', { outcome: 'Устранено' }],
  ['m-owner', 'svcShare', 'r-41', 'Вывод до решения'],
  ['m-owner', 'svcTransition', 'r-41', 'resolved', { outcome: 'Подтвердилась' }],
  ['m-owner', 'svcShare', 'r-41', 'кра'],
  ['m-owner', 'svcShare', 'r-41', 'Подогрев не включился, ремонтируем стол'],
  ['m-owner', 'svcShare', 'r-57', 'Вывод не про сотрудника'],
  ['m-owner', 'svcAddTask', 'r-o11', 'Позвонить прорабу'],
  ['m-owner', 'svcAddTask', 'r-o11', 'ab'],
  ['m-owner', 'svcRating', 'S-311', 'seen'],
  ['m-kotova', 'svcRating', 'S-311', 'seen'],
  ['m-kotova', 'svcRating', 'S-305', 'complaint'],
  ['m-owner', 'svcRating', 'S-999', 'seen'],
  ['m-owner', 'svcTransition', 'r-k6', 'closed'],
  ['m-owner', 'svcTransition', 'r-o11', 'wait'],
  ['m-owner', 'svcTransition', 'r-o11', 'resolved', { outcome: 'Дубль' }],
  ['m-morozova', 'svcReply', 'r-40', { kind: 'note', text: 'не должно пройти' }],
  ['m-morozova', 'svcPriority', 'r-57', 'low'],
  ['m-kotelnikova', 'svcReply', 'r-55', { kind: 'reply', text: 'Акт получили' }],
  ['m-owner', 'svcReply', 'r-39', { kind: 'reply', text: 'Спасибо за отзыв' }],
];

interface Outcome {
  ok: boolean;
  value?: unknown;
  code?: string;
  message?: string;
}

function mine() {
  const db = createSeed({
    modules: createPilotModules(),
    hooks: { ...FUTURE_STAGE_HOOKS, service: serviceHook },
  }).dbs['t-alta'] as unknown as ServiceTenantDb & { events?: { text: string; to: string[] }[] };
  const state = { actor: 'm-owner' };
  const api = serviceCommands(
    createModuleCtx({
      getDb: () => db as never,
      getActor: () => state.actor,
      clock: fixedClock(DEMO.svcBase),
      tasks: createFakeTaskPort(),
    }),
  ) as unknown as Record<string, (...a: unknown[]) => unknown>;
  const run = (actor: string, method: string, args: unknown[]): Outcome => {
    state.actor = actor;
    try {
      return { ok: true, value: (api[method] as (...a: unknown[]) => unknown)(...args) };
    } catch (e) {
      if (e instanceof ApiError) return { ok: false, code: e.code, message: e.message };
      throw e;
    }
  };
  return { db, run };
}

function reference() {
  const db = MD.seed() as Record<string, unknown>;
  SV.installService(db);
  const state = { actor: 'm-owner' };
  const events: { text: string; to: string[] }[] = [];
  const api = SV.serviceApi({
    getDb: () => db,
    getActor: () => state.actor,
    cmd: (fn) => fn(),
    ApiError: RefError,
    M,
    event: (text, to) => events.push({ text, to }),
  });
  const run = (actor: string, method: string, args: unknown[]): Outcome => {
    state.actor = actor;
    try {
      return { ok: true, value: (api[method] as (...a: unknown[]) => unknown)(...args) };
    } catch (e) {
      if (e instanceof RefError) return { ok: false, code: e.code, message: e.message };
      throw e;
    }
  };
  return { db, run, events };
}

describe('serviceCommands = serviceApi эталона', () => {
  it('сценарий из всех десяти команд: результат, ошибка и срез после каждого шага', () => {
    const a = mine();
    const b = reference();
    let errors = 0;
    for (const [actor, method, ...args] of SCENARIO) {
      const got = a.run(actor, method, args);
      const want = b.run(actor, method, args);
      expect(json(got), method + ' ' + JSON.stringify(args)).toEqual(json(want));
      expect(json(a.db.service), method + ' ' + JSON.stringify(args)).toEqual(
        json((b.db as { service: unknown }).service),
      );
      if (!got.ok) errors++;
    }
    expect(errors).toBeGreaterThan(20);
    expect(SCENARIO.filter((s) => !['svcReply'].includes(s[1] as string)).length).toBeGreaterThan(
      40,
    );
  });

  it('события сотруднику (`event` эталона) совпадают по тексту и адресатам', () => {
    const a = mine();
    const b = reference();
    for (const [actor, method, ...args] of SCENARIO) {
      a.run(actor, method, args);
      b.run(actor, method, args);
    }
    const mineEvents = (a.db.events ?? []).filter((e) => e.text.startsWith('Вывод по обращению'));
    expect(mineEvents.map((e) => ({ text: e.text, to: e.to }))).toEqual(b.events);
    expect(b.events).toHaveLength(1);
  });

  it('сценарий покрывает все десять методов', () => {
    const used = new Set(SCENARIO.map((s) => s[1]));
    expect([...used].sort()).toEqual(
      [
        'svcAddTask',
        'svcAssign',
        'svcCreate',
        'svcMove',
        'svcPriority',
        'svcRating',
        'svcReply',
        'svcShare',
        'svcShowPhone',
        'svcTransition',
      ].sort(),
    );
  });
});
