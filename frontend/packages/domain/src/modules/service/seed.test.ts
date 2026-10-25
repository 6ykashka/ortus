// Сид «Обращений» (service.js 19.10:123–213): 4 направления, 21 тип, 4 шаблона, 8 обращений,
// 2 низкие оценки; шаблон роли `r-agent` и назначения с областью направления (только «Альта»).
import { describe, expect, it } from 'vitest';
import { demoClock, DEMO } from '../../core/clock.ts';
import { createAlta } from '../../seed/alta.ts';
import { createLotos } from '../../seed/lotos.ts';
import { createPlatform } from '../../seed/platform.ts';
import { CAL } from './calendar.ts';
import { installService, serviceHook, serviceSeed, SVC_BASE } from './seed.ts';
import type { ServiceTenantDb } from './types.ts';
import { at } from './fixture.test-util.ts';

const ms = (d: number, mo: number, h: number, mi: number): number =>
  Date.UTC(2026, mo - 1, d, h - 3, mi);

describe('«сейчас» демо', () => {
  it('SVC_BASE = 1 октября 2026, 16:24 по Москве = DEMO.svcBase ядра', () => {
    expect(SVC_BASE).toBe(ms(1, 10, 16, 24));
    expect(SVC_BASE).toBe(Date.parse(DEMO.svcBase));
  });
});

describe('serviceSeed()', () => {
  const S = serviceSeed();

  it('4 направления с календарями, ключами, проектами и руководителем-владельцем', () => {
    expect(S.directions.map((d) => [d.id, d.key, d.name, d.project, d.next])).toEqual([
      ['d-mas', 'МАС', 'Массаж', 'svc-mas', 42],
      ['d-kos', 'КОС', 'Косметология', 'svc-kos', 7],
      ['d-otd', 'ОТД', 'Отделка', 'svc-otd', 13],
      ['d-grz', 'ГРЗ', 'Грузоперевозки', 'svc-grz', 58],
    ]);
    expect(S.directions.every((d) => d.lead === 'm-owner')).toBe(true);
    expect(S.directions.map((d) => d.cal)).toEqual([CAL.spa, CAL.spa, CAL.rep, CAL.log]);
    expect(S.directions[3]).toMatchObject({
      module: 'Логистика',
      area: 'Москва, Самара',
      color: '#2B5479',
    });
  });

  it('21 тип: цели в минутах и сроки по закону в днях', () => {
    expect(S.types).toHaveLength(21);
    const t = (id: string) => S.types.find((x) => x.id === id);
    expect(t('d-mas:complaint')).toEqual({
      id: 'd-mas:complaint',
      dir: 'd-mas',
      kind: 'complaint',
      name: 'Жалоба',
      first: 120,
      resolve: 1320,
      legal: null,
    });
    expect(t('d-mas:claim')).toMatchObject({
      name: 'Вернуть деньги за услугу',
      first: 660,
      resolve: null,
      legal: 10,
    });
    expect(t('d-otd:warranty')).toMatchObject({ first: 240, resolve: 6000 });
    expect(t('d-grz:cargo')).toMatchObject({ name: 'Повреждение или недостача груза', legal: 30 });
    expect(t('d-grz:thanks')).toMatchObject({
      name: 'Спасибо водителю',
      first: null,
      resolve: null,
    });
  });

  it('4 шаблона ответа дословно', () => {
    expect(S.templates.map((x) => x[0])).toEqual([
      'Приняли в работу',
      'Нужны подробности',
      'Извинение и компенсация',
      'Решено',
    ]);
    expect(S.templates[0]?.[1]).toBe('{имя}, приняли ваше обращение {номер}. Ответим {срок}.');
  });

  it('8 обращений в порядке эталона и счётчик seq = 200', () => {
    expect(S.requests.map((r) => [r.id, r.key, r.status])).toEqual([
      ['r-57', 'ГРЗ-57', 'new'],
      ['r-41', 'МАС-41', 'new'],
      ['r-o11', 'ОТД-11', 'work'],
      ['r-40', 'МАС-40', 'new'],
      ['r-o12', 'ОТД-12', 'work'],
      ['r-55', 'ГРЗ-55', 'wait'],
      ['r-k6', 'КОС-6', 'new'],
      ['r-39', 'МАС-39', 'resolved'],
    ]);
    expect(S.seq).toBe(200);
  });

  it('сообщения нумеруются msg1…, время — по Москве', () => {
    const ids = S.requests.flatMap((r) => r.messages.map((m) => m.id));
    expect(ids[0]).toBe('msg1');
    expect(new Set(ids).size).toBe(ids.length);
    expect(S.requests[0]?.at).toBe(ms(1, 10, 11, 14));
    expect(S.requests[0]?.messages[0]?.files).toEqual([
      'Фото 1.jpg',
      'Фото 2.jpg',
      'Акт о расхождении.pdf',
    ]);
  });

  it('сроки в рабочем времени направления: ГРЗ-57 — до 15:14, ОТД-11 — до 19:00 понедельника', () => {
    const r57 = S.requests[0];
    expect(r57?.sla.first).toEqual({ goal: 240, due: ms(1, 10, 15, 14), stopped: null });
    expect(r57?.sla.legal?.due).toBe(ms(1, 10, 11, 14) + 30 * 86_400_000);
    const o11 = S.requests[2];
    // 27.09 — воскресенье, пн–пт 9–19: 600 мин с понедельника 9:00 заканчиваются в 19:00
    expect(o11?.sla.first).toEqual({
      goal: 600,
      due: ms(28, 9, 19, 0),
      stopped: ms(28, 9, 10, 30),
    });
    expect(o11?.sla.resolve).toBeNull();
  });

  it('жалоба на мастера: about, aboutName и оценка 2 из 5', () => {
    const r41 = S.requests[1];
    expect(r41).toMatchObject({
      about: 'm-morozova',
      aboutName: 'Анна Морозова',
      fromRating: 2,
      priority: 'high',
    });
    expect(r41?.tasks).toEqual([
      { id: 'T-71', title: 'Починить подогрев стола в кабинете № 2', status: 'Новая' },
    ]);
  });

  it('ГРЗ-55 на паузе с pausedAt; МАС-39 — решено с итогом «Передано мастеру»', () => {
    expect(S.requests[5]).toMatchObject({
      pausedAt: ms(28, 9, 11, 0),
      assignee: 'Вера Котельникова',
      channel: 'phone',
    });
    expect(S.requests[7]).toMatchObject({
      outcome: 'Передано мастеру',
      resolvedAt: ms(30, 9, 15, 40),
    });
    expect(S.requests[7]?.sla).toEqual({ first: null, resolve: null, legal: null });
  });

  it('2 низкие оценки, обе открыты', () => {
    expect(S.ratings.map((x) => [x.id, x.dir, x.score, x.status])).toEqual([
      ['S-311', 'd-mas', 3, 'open'],
      ['S-305', 'd-grz', 2, 'open'],
    ]);
    expect(S.ratings[1]?.at).toBe(ms(29, 9, 12, 40));
  });

  it('каждый вызов — новые объекты', () => {
    const a = serviceSeed();
    at(a.requests, 0).title = 'x';
    expect(serviceSeed().requests[0]?.title).toBe('Две коробки помяты, внутри бой');
  });
});

describe('installService — только «Альта Групп»', () => {
  const opts = (tenantId: string) => ({ tenantId, clock: demoClock });

  it('срез, роль r-agent и два назначения с областью направления', () => {
    const db = createAlta(createPlatform()) as unknown as ServiceTenantDb &
      ReturnType<typeof createAlta>;
    installService(db, opts('t-alta'));
    expect(db.service?.requests).toHaveLength(8);
    expect(db.roles.find((r) => r.id === 'r-agent')).toEqual({
      id: 'r-agent',
      name: 'Специалист по обращениям',
      kind: 'template',
      project: true,
      actions: { service: ['view', 'create', 'edit', 'review'] },
      finance: { read: false, manage: false },
    });
    expect(db.assignments.filter((a) => a.id.startsWith('as-svc'))).toEqual([
      {
        id: 'as-svc1',
        member: 'm-kotova',
        role: 'r-agent',
        scope: { type: 'project', id: 'svc-grz' },
      },
      {
        id: 'as-svc2',
        member: 'm-kotelnikova',
        role: 'r-agent',
        scope: { type: 'project', id: 'svc-grz' },
      },
    ]);
  });

  it('идемпотентен: повторный вызов ничего не дублирует', () => {
    const db = createAlta(createPlatform()) as unknown as ServiceTenantDb &
      ReturnType<typeof createAlta>;
    installService(db, opts('t-alta'));
    const first = db.service;
    const n = db.assignments.length;
    installService(db, opts('t-alta'));
    expect(db.service).toBe(first);
    expect(db.assignments).toHaveLength(n);
  });

  it('роль r-agent не дублируется, если уже есть', () => {
    const db = createAlta(createPlatform()) as unknown as ServiceTenantDb &
      ReturnType<typeof createAlta>;
    db.roles.push({
      id: 'r-agent',
      name: 'Чужая',
      kind: 'custom',
      actions: {},
      finance: { read: false, manage: false },
    });
    installService(db, opts('t-alta'));
    expect(db.roles.filter((r) => r.id === 'r-agent')).toHaveLength(1);
    expect(db.roles.find((r) => r.id === 'r-agent')?.name).toBe('Чужая');
  });

  it('«Лотос»: срез не создаётся', () => {
    const lotos = createLotos(createPlatform()) as unknown as ServiceTenantDb &
      ReturnType<typeof createLotos>;
    installService(lotos, opts('t-lotos'));
    expect(lotos.service ?? null).toBeNull();
    expect(lotos.assignments.some((a) => a.id === 'as-svc1')).toBe(false);
  });

  it('serviceHook — стадия `service` сида', () => {
    const db = createAlta(createPlatform()) as unknown as ServiceTenantDb &
      ReturnType<typeof createAlta>;
    serviceHook(db as never, opts('t-alta'));
    expect(db.service?.directions).toHaveLength(4);
  });
});
