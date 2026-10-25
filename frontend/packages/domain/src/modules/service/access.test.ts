// Доступ к «Обращениям» (service.js 19.10:215–232 `seesDir`, `ownerOf`, `serviceView`) с правилом
// PD-53: команда проверяется с объектом-направлением, а не «где-нибудь в организации».
import { describe, expect, it } from 'vitest';
import { demoClock } from '../../core/clock.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { canIn, ownerOf, seesDir, serviceView, teamOf } from './access.ts';
import { installService } from './seed.ts';
import type { ServiceTenantDb } from './types.ts';
import { at, must, svc } from './fixture.test-util.ts';

type Db = ServiceTenantDb & ReturnType<typeof createAlta>;

function alta(): Db {
  const db = createAlta(createPlatform()) as unknown as Db;
  installService(db, { tenantId: 't-alta', clock: demoClock });
  return db;
}

const dirs = (db: Db, id: string) =>
  (db.service?.directions ?? []).filter((d) => seesDir(db, id, d)).map((d) => d.key);
const view = (db: Db, id: string) => serviceView(db, id);

describe('ownerOf, seesDir', () => {
  it('владелец видит все четыре направления', () => {
    const db = alta();
    expect(ownerOf(db, 'm-owner')).toBe(true);
    expect(dirs(db, 'm-owner')).toEqual(['МАС', 'КОС', 'ОТД', 'ГРЗ']);
  });

  it('Котова и Котельникова — только «Грузоперевозки» (роль r-agent с областью проекта)', () => {
    const db = alta();
    expect(ownerOf(db, 'm-kotova')).toBe(false);
    expect(dirs(db, 'm-kotova')).toEqual(['ГРЗ']);
    expect(dirs(db, 'm-kotelnikova')).toEqual(['ГРЗ']);
  });

  it('массажист, водитель, прораб — ни одного направления', () => {
    const db = alta();
    for (const id of ['m-morozova', 'm-vasiliev', 'm-sokolov', 'm-nobody']) {
      expect(dirs(db, id)).toEqual([]);
    }
  });

  it('роль со скоупом «вся организация» направлений не открывает: нужен project-грант (эталон)', () => {
    const db = alta();
    db.assignments.push({
      id: 'x1',
      member: 'm-sokolov',
      role: 'r-agent',
      scope: { type: 'tenant' },
    });
    expect(dirs(db, 'm-sokolov')).toEqual([]);
  });

  it('роль направления без действий модуля не даёт видимости', () => {
    const db = alta();
    db.roles.push({
      id: 'r-empty',
      name: 'Пустая',
      kind: 'custom',
      project: true,
      actions: { service: [] },
      finance: { read: false, manage: false },
    });
    db.assignments.push({
      id: 'x2',
      member: 'm-sokolov',
      role: 'r-empty',
      scope: { type: 'project', id: 'svc-otd' },
    });
    expect(dirs(db, 'm-sokolov')).toEqual([]);
  });
});

describe('canIn — право в направлении с объектом (PD-53)', () => {
  it('Котова: все действия роли в ГРЗ, в «Массаже» — ничего', () => {
    const db = alta();
    const mas = at(svc(db).directions, 0);
    const grz = at(svc(db).directions, 3);
    for (const verb of ['view', 'create', 'edit', 'review'] as const) {
      expect(canIn(db, 'm-kotova', grz, verb)).toBe(true);
      expect(canIn(db, 'm-kotova', mas, verb)).toBe(false);
    }
    expect(canIn(db, 'm-kotova', grz, 'settings')).toBe(false);
  });

  it('владелец — везде, в том числе «Настраивать»', () => {
    const db = alta();
    for (const d of db.service?.directions ?? [])
      expect(canIn(db, 'm-owner', d, 'settings')).toBe(true);
  });

  it('модуль «Обращения» всегда подключён: отключение в db.modules не влияет на ядро', () => {
    const db = alta();
    expect(canIn(db, 'm-nobody', at(svc(db).directions, 0), 'view')).toBe(false);
  });
});

describe('teamOf — исполнители направления', () => {
  it('активные, видят направление и имеют право «Отвечать»', () => {
    const db = alta();
    const grz = at(svc(db).directions, 3);
    expect(teamOf(db, grz)).toEqual(['Дарья Зимина', 'Марина Котова', 'Вера Котельникова']);
  });

  it('заблокированный и приглашённый не входят', () => {
    const db = alta();
    db.assignments.push({
      id: 'x3',
      member: 'm-petrova',
      role: 'r-agent',
      scope: { type: 'project', id: 'svc-grz' },
    });
    db.assignments.push({
      id: 'x4',
      member: 'm-gromov',
      role: 'r-agent',
      scope: { type: 'project', id: 'svc-grz' },
    });
    expect(teamOf(db, at(svc(db).directions, 3))).not.toContain('Олеся Петрова');
    expect(teamOf(db, at(svc(db).directions, 3))).not.toContain('Кирилл Громов');
  });

  it('наблюдатель без «Отвечать» не входит в команду', () => {
    const db = alta();
    db.roles.push({
      id: 'r-watch',
      name: 'Наблюдатель',
      kind: 'template',
      project: true,
      actions: { service: ['view'] },
      finance: { read: false, manage: false },
    });
    db.assignments.push({
      id: 'x5',
      member: 'm-sokolov',
      role: 'r-watch',
      scope: { type: 'project', id: 'svc-grz' },
    });
    expect(teamOf(db, at(svc(db).directions, 3))).not.toContain('Алексей Соколов');
    expect(dirs(db, 'm-sokolov')).toEqual(['ГРЗ']);
  });
});

describe('serviceView — срез для участника', () => {
  it('Котова: одно направление, его типы, обращения и оценки; телефон только маской', () => {
    const v = view(alta(), 'm-kotova');
    expect(v?.hidden).toBeUndefined();
    expect(v?.directions.map((d) => d.key)).toEqual(['ГРЗ']);
    expect(v?.directions[0]).toMatchObject({
      canContacts: false,
      team: ['Дарья Зимина', 'Марина Котова', 'Вера Котельникова'],
    });
    expect(v?.types).toHaveLength(5);
    expect(v?.types.every((t) => t.dir === 'd-grz')).toBe(true);
    expect(v?.templates).toHaveLength(4);
    expect(v?.requests.map((r) => r.key)).toEqual(['ГРЗ-57', 'ГРЗ-55']);
    expect(v?.requests[0]?.client).toMatchObject({
      name: 'Наталья Гусева',
      phoneMasked: '+7 ••• •••-••-12',
    });
    expect(v?.requests[0]?.client).not.toHaveProperty('phone');
    expect(v?.requests[0]).not.toHaveProperty('shown');
    expect(v?.ratings.map((x) => x.id)).toEqual(['S-305']);
  });

  it('владелец: все направления и обращения; телефон скрыт, пока не показан; canContacts', () => {
    const v = view(alta(), 'm-owner');
    expect(v?.directions).toHaveLength(4);
    expect(v?.directions.every((d) => d.canContacts)).toBe(true);
    expect(v?.requests).toHaveLength(8);
    expect(v?.requests.every((r) => r.client.phone === undefined)).toBe(true);
    expect(v?.ratings).toHaveLength(2);
  });

  it('показанный телефон виден только тому, кому показали', () => {
    const db = alta();
    at(svc(db).requests, 0).shown = ['m-kotova'];
    expect(view(db, 'm-kotova')?.requests[0]?.client.phone).toBe('+7 916 204-44-12');
    expect(view(db, 'm-owner')?.requests[0]?.client).not.toHaveProperty('phone');
    expect(view(db, 'm-kotelnikova')?.requests[0]?.client).not.toHaveProperty('phone');
  });

  it('руководитель направления (lead) тоже видит canContacts', () => {
    const db = alta();
    at(svc(db).directions, 3).lead = 'm-kotova';
    expect(view(db, 'm-kotova')?.directions[0]?.canContacts).toBe(true);
    expect(view(db, 'm-kotelnikova')?.directions[0]?.canContacts).toBe(false);
  });

  it('жалоба на сотрудника скрыта от него самого, остальное направления — видно', () => {
    const db = alta();
    db.assignments.push({
      id: 'x6',
      member: 'm-morozova',
      role: 'r-agent',
      scope: { type: 'project', id: 'svc-mas' },
    });
    const keys = view(db, 'm-morozova')?.requests.map((r) => r.key);
    expect(keys).toEqual(['МАС-40', 'МАС-39']);
    expect(view(db, 'm-owner')?.requests.map((r) => r.key)).toContain('МАС-41');
  });

  it('нет права «Видеть»: пустой срез с признаком hidden', () => {
    expect(view(alta(), 'm-morozova')).toEqual({
      directions: [],
      types: [],
      templates: [],
      requests: [],
      ratings: [],
      hidden: true,
    });
  });

  it('у организации нет среза «Обращений» (демо-«Лотос»): null', () => {
    const db = alta();
    db.service = null;
    expect(view(db, 'm-owner')).toBeNull();
    delete db.service;
    expect(view(db, 'm-owner')).toBeNull();
  });

  it('срез — копия: правка ответа не меняет базу', () => {
    const db = alta();
    const v = must(view(db, 'm-owner'));
    at(v.requests, 0).title = 'изменено';
    at(v.directions, 0).name = 'изменено';
    expect(at(svc(db).requests, 0).title).toBe('Две коробки помяты, внутри бой');
    expect(at(svc(db).directions, 0).name).toBe('Массаж');
  });
});
