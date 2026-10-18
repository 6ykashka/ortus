// Модуль «Формы» по контракту DomainModule ядра: сид, проекция (api.js:206–207), команды.
import { describe, expect, it } from 'vitest';
import { composeCommands, composeDelays, type DomainModule } from '../../core/module.ts';
import { demoClock } from '../../core/clock.ts';
import { createSeed } from '../../seed/compose.ts';
import * as forms from './index.ts';
import { formsModule } from './module.ts';
import { formsCtx, formsFixture, inspResponse } from './testing/fixture.ts';
import { formsView } from './view.ts';

const memberName = (db: { members: { id: string; name: string }[] }, id: string) =>
  db.members.find((m) => m.id === id)?.name ?? '';

describe('formsModule', () => {
  it('ключ, методы и задержки эталона', () => {
    expect(formsModule.key).toBe('forms');
    expect(formsModule.methods).toEqual(['publishForm', 'backfillKbRule', 'retryFormAction']);
    expect(composeDelays([formsModule as DomainModule])).toEqual({
      publishForm: 500,
      backfillKbRule: 450,
      retryFormAction: 300,
    });
  });

  it('install: «Альта» — 2 формы и 2 ответа, «Лотос» — пусто', () => {
    const { dbs } = createSeed();
    for (const db of Object.values(dbs)) {
      formsModule.install(db, { tenantId: db.tenantId, clock: demoClock });
    }
    expect(dbs['t-alta'].forms?.map((f) => f.id)).toEqual(['fm-insp', 'fm-foreman']);
    expect(dbs['t-alta'].responses?.map((r) => r.id)).toEqual(['R-0988', 'R-1012']);
    expect(dbs['t-lotos'].forms).toEqual([]);
    expect(dbs['t-lotos'].responses).toEqual([]);
  });

  it('install идемпотентен: существующий срез не заменяется', () => {
    const db = formsFixture();
    const before = db.forms[0];
    db.responses.unshift(inspResponse('R-1050'));
    formsModule.install(db, { tenantId: db.tenantId, clock: demoClock });
    expect(db.forms[0]).toBe(before);
    expect(db.responses).toHaveLength(3);
  });

  it('composeCommands собирает три команды, они работают на БД контекста', () => {
    const db = formsFixture();
    const cmds = composeCommands([formsModule as DomainModule], formsCtx(db));
    expect(Object.keys(cmds).sort()).toEqual(['backfillKbRule', 'publishForm', 'retryFormAction']);
    db.responses.unshift(inspResponse('R-1050'));
    const backfill = cmds['backfillKbRule'] as (f: string, r: string) => unknown;
    expect(backfill('fm-insp', 'au-2')).toEqual({ added: 1, failed: 0, err: null });
  });

  it('view: нет среза форм — null', () => {
    const db = formsFixture();
    delete (db as { forms?: unknown }).forms;
    expect(formsModule.view(db, 'm-owner', null)).toBeNull();
  });
});

describe('formsView', () => {
  it('формы видны все, ответы — тем, кто видит логистику фирмы «Север»', () => {
    const db = formsFixture();
    for (const actor of ['m-owner', 'm-vasiliev']) {
      const v = formsView(db, actor);
      expect(v.forms.map((f) => f.id)).toEqual(['fm-insp', 'fm-foreman']);
      expect(v.responses.map((r) => r.id)).toEqual(['R-0988', 'R-1012']);
    }
  });

  it('без логистики — только свои ответы (по ФИО автора)', () => {
    const db = formsFixture();
    db.responses.unshift(inspResponse('R-1050', { author: memberName(db, 'm-morozova') }));
    expect(formsView(db, 'm-morozova').responses.map((r) => r.id)).toEqual(['R-1050']);
    expect(formsView(db, 'm-nobody').responses).toEqual([]);
  });

  it('логистика отключена — ответы всё равно видны (проверка как у включённой)', () => {
    const db = formsFixture();
    db.modules.logistics = { enabled: false };
    expect(formsView(db, 'm-vasiliev').responses).toHaveLength(2);
  });

  it('проекция — копия: правка не меняет БД', () => {
    const db = formsFixture();
    const v = formsModule.view(db, 'm-owner', null);
    if (!v?.forms[0]) throw new Error('нет проекции');
    v.forms[0].name = 'Изменено';
    expect(db.forms[0]?.name).toBe('Осмотр машины');
  });

  it('срезов нет — пустые списки', () => {
    const db = formsFixture();
    delete (db as { forms?: unknown }).forms;
    delete (db as { responses?: unknown }).responses;
    expect(formsView(db, 'm-owner')).toEqual({ forms: [], responses: [] });
  });
});

describe('точка входа modules/forms', () => {
  it('экспорт-лист зафиксирован', () => {
    expect(Object.keys(forms).sort()).toEqual([
      'CHOICE_TYPES',
      'CRM_TYPES',
      'FORMS_DELAYS',
      'FORMS_METHODS',
      'FORM_SETTINGS',
      'FORM_TEMPLATES',
      'FORM_VAL_MAX',
      'FORM_VARS',
      'createFormsCommands',
      'createFormsModule',
      'defaultKnowledge',
      'formVal',
      'formsModule',
      'formsSeed',
      'formsView',
      'kbFits',
      'kbRun',
      'nextVersionFields',
      'normalizeDef',
      'ownersOf',
      'templateDef',
      'validatePublish',
    ]);
  });
});
