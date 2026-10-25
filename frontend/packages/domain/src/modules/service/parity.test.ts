// Паритет модуля «Обращения» с эталоном 19.10 (`design/ortus/service.js`, `models.js`, `mock-data.js`):
// одинаковые входы → одинаковые выходы. Эталон только импортируется (`seed/reference.ts`).
//
// Эталон считает по часовому поясу машины, домен — всегда по Москве, поэтому на время теста TZ
// процесса = Europe/Moscow; `Date.now` зафиксирован, чтобы `svcNow()` эталона не уходил от часов
// домена. Намеренные расхождения (не проверяются здесь, а проверены в своих тестах):
// - праздники и пояс календаря — поля календаря, в эталоне их нет (`calendar.test.ts`);
// - право проверяется с объектом-направлением (PD-53, `access.test.ts`) — на сиде совпадает с эталоном;
// - команды: компенсация требует «Решать», перенос пересчитывает сроки (`commands.test.ts`).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeed, FUTURE_STAGE_HOOKS } from '../../seed/compose.ts';
import { importReference } from '../../seed/reference.ts';
import { addWorkMinutes, CAL, workBetween, type WorkCalendar } from './calendar.ts';
import * as D from './dictionaries.ts';
import { hm, dayLabel, dur, when } from './format.ts';
import { serviceView, ownerOf, seesDir } from './access.ts';
import { serviceHook, serviceSeed, SVC_BASE } from './seed.ts';
import { slaHead, slaOf } from './sla.ts';
import type { ServiceRequest, ServiceTenantDb } from './types.ts';
import { createPilotModules } from '../index.ts';
import { at, must, svc } from './fixture.test-util.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

type Fn = (...a: never[]) => unknown;
interface RefService {
  SVC_BASE: number;
  svcNow: () => number;
  addWork: Fn;
  workBetween: Fn;
  hm: Fn;
  dayLabel: Fn;
  when: Fn;
  dur: Fn;
  slaOf: Fn;
  slaHead: Fn;
  serviceSeed: () => unknown;
  installService: (db: unknown) => void;
  serviceView: Fn;
  SVC_ST: unknown;
  SVC_FLOW: unknown;
  SVC_KIND: unknown;
  SVC_CH: unknown;
  SVC_PRIO: unknown;
  OUTCOMES: unknown;
  OUTCOMES_ABOUT: unknown;
  COMPENSATIONS: unknown;
}
interface RefData {
  seed(): { members: { id: string }[] } & Record<string, unknown>;
}

type Env = Record<string, string | undefined>;
const env = (globalThis as unknown as { process: { env: Env } }).process.env;
const TZ_BEFORE = env['TZ'];
const dateNow = vi.spyOn(Date, 'now');
let SV: RefService;
let M: unknown;
let MD: RefData;

beforeAll(async () => {
  env['TZ'] = 'Europe/Moscow';
  dateNow.mockReturnValue(SVC_BASE);
  SV = await importReference<RefService>('service.js');
  M = await importReference<unknown>('models.js');
  MD = await importReference<RefData>('mock-data.js');
});

afterAll(() => {
  dateNow.mockRestore();
  if (TZ_BEFORE === undefined) delete env['TZ'];
  else env['TZ'] = TZ_BEFORE;
});

const call = <T>(f: Fn, ...a: unknown[]): T => (f as (...x: unknown[]) => unknown)(...a) as T;
const json = (x: unknown): unknown => JSON.parse(JSON.stringify(x)) as unknown;

const MIN = 60_000;
const DAY = 86_400_000;
const CALS: Record<string, WorkCalendar> = { spa: CAL.spa, rep: CAL.rep, log: CAL.log };

describe('«сейчас» и справочники = service.js', () => {
  it('SVC_BASE и svcNow', () => {
    expect(SVC_BASE).toBe(SV.SVC_BASE);
    expect(SV.svcNow()).toBe(SV.SVC_BASE);
  });

  it.each([
    ['SVC_ST', D.SVC_ST],
    ['SVC_FLOW', D.SVC_FLOW],
    ['SVC_KIND', D.SVC_KIND],
    ['SVC_CH', D.SVC_CH],
    ['SVC_PRIO', D.SVC_PRIO],
    ['OUTCOMES', D.OUTCOMES],
    ['OUTCOMES_ABOUT', D.OUTCOMES_ABOUT],
    ['COMPENSATIONS', D.COMPENSATIONS],
  ] as const)('%s', (name, mine) => {
    expect(json(mine)).toEqual(json(SV[name]));
  });
});

describe('рабочий календарь и подписи = service.js', () => {
  it('addWorkMinutes и workBetween на сетке стартов × длительностей × календарей', () => {
    let n = 0;
    for (const cal of Object.values(CALS)) {
      for (let k = 0; k < 14 * 24 * 2; k++) {
        const start = SVC_BASE - 3 * DAY + k * 30 * MIN + 7 * MIN;
        for (const mins of [0, 1, 45, 120, 240, 660, 1320, 6000]) {
          const end = call<number>(SV.addWork, start, mins, cal);
          expect(addWorkMinutes(start, mins, cal)).toBe(end);
          expect(workBetween(start, end, cal)).toBe(call(SV.workBetween, start, end, cal));
          n++;
        }
        const b = start + (k % 97) * 53 * MIN;
        expect(workBetween(start, b, cal)).toBe(call(SV.workBetween, start, b, cal));
      }
    }
    expect(n).toBeGreaterThan(2000);
  });

  it('hm, dayLabel, when, dur', () => {
    for (let k = 0; k < 400; k++) {
      const t = SVC_BASE - 20 * DAY + k * 97 * MIN;
      expect(hm(t)).toBe(call(SV.hm, t));
      expect(dayLabel(t)).toBe(call(SV.dayLabel, t));
      expect(when(t, SVC_BASE)).toBe(call(SV.when, t, SVC_BASE));
    }
    for (const cal of [undefined, ...Object.values(CALS)])
      for (let m = -5; m < 7000; m += 13) expect(dur(m, cal)).toBe(call(SV.dur, m, cal));
  });
});

describe('сид и срез участника = service.js', () => {
  const alta = (): ServiceTenantDb & { members: { id: string }[]; assignments: unknown[] } => {
    const db = createSeed({
      modules: createPilotModules(),
      hooks: { ...FUTURE_STAGE_HOOKS, service: serviceHook },
    }).dbs['t-alta'];
    return db as never;
  };

  it('serviceSeed() побайтно (JSON) совпадает', () => {
    expect(json(serviceSeed())).toEqual(json(SV.serviceSeed()));
  });

  it('роль r-agent и назначения совпадают с installService', () => {
    const ref = MD.seed() as Record<string, unknown>;
    SV.installService(ref);
    const mine = alta() as unknown as Record<string, unknown>;
    const pick = (db: Record<string, unknown>) => ({
      role: (db['roles'] as { id: string }[]).find((r) => r.id === 'r-agent'),
      as: (db['assignments'] as { id: string }[]).filter((a) => a.id.startsWith('as-svc')),
    });
    expect(json(pick(mine))).toEqual(json(pick(ref)));
  });

  it('serviceView всех участников «Альты», в том числе с показанным телефоном', () => {
    const ref = MD.seed() as {
      members: { id: string }[];
      service?: { requests: ServiceRequest[] };
    };
    SV.installService(ref);
    const mine = alta();
    at(must(ref.service).requests, 0).shown = ['m-kotova', 'm-owner'];
    at(svc(mine).requests, 0).shown = ['m-kotova', 'm-owner'];
    at(must(ref.service).requests, 1).shown = ['m-kotelnikova'];
    at(svc(mine).requests, 1).shown = ['m-kotelnikova'];
    let n = 0;
    for (const m of [...mine.members.map((x) => x.id), 'm-nobody']) {
      const want = call<unknown>(SV.serviceView, ref, m, M);
      expect(json(serviceView(mine, m))).toEqual(json(want));
      n++;
    }
    expect(n).toBeGreaterThan(8);
  });

  it('жалоба на сотрудника скрыта и в эталоне, и в домене; видимость направлений та же', () => {
    const ref = MD.seed() as {
      members: { id: string }[];
      assignments: unknown[];
      service?: unknown;
    };
    SV.installService(ref);
    const mine = alta();
    const extra = {
      id: 'x1',
      member: 'm-morozova',
      role: 'r-agent',
      scope: { type: 'project', id: 'svc-mas' },
    };
    ref.assignments.push(extra);
    mine.assignments.push(extra);
    expect(json(serviceView(mine, 'm-morozova'))).toEqual(
      json(call(SV.serviceView, ref, 'm-morozova', M)),
    );
    const own = call<{ requests: { key: string }[] }>(SV.serviceView, ref, 'm-morozova', M);
    expect(own.requests.map((r) => r.key)).not.toContain('МАС-41');
    for (const id of mine.members.map((x) => x.id))
      expect(ownerOf(mine as never, id)).toBe(
        (ref.assignments as { member: string; role: string }[]).some(
          (a) => a.member === id && a.role === 'r-owner',
        ),
      );
    expect(seesDir(mine as never, 'm-kotova', at(svc(mine).directions, 0))).toBe(false);
  });
});

describe('slaOf, slaHead = service.js', () => {
  const STATUSES = ['new', 'work', 'wait', 'resolved', 'closed'] as const;
  const OFFSETS = [
    -DAY,
    0,
    20 * MIN,
    26 * MIN,
    3 * 60 * MIN,
    DAY,
    2 * DAY,
    3 * DAY,
    8 * DAY,
    15 * DAY,
    40 * DAY,
  ];

  it('все обращения сида × статусы × моменты времени', () => {
    const seed = serviceSeed();
    const ref = SV.serviceSeed() as { requests: ServiceRequest[]; directions: { id: string }[] };
    let n = 0;
    for (const [i, r] of seed.requests.entries()) {
      const d = must(seed.directions.find((x) => x.id === r.dir));
      const refR = at(ref.requests, i);
      for (const status of STATUSES) {
        for (const off of OFFSETS) {
          const now = SVC_BASE + off;
          const a = { ...r, status };
          const b = { ...refR, status };
          expect(json(slaOf(a, d, now))).toEqual(json(call(SV.slaOf, b, d, now)));
          expect(json(slaHead(a, d, now))).toEqual(json(call(SV.slaHead, b, d, now)));
          n++;
        }
      }
    }
    expect(n).toBe(8 * 5 * OFFSETS.length);
  });
});
