// W7.26 · Модель блока «Маршрут документа»: подписи шагов и «Сейчас» (эталон «Документы.dc.html» routeBarVM :970–1005),
// возврат и «Отправить снова», права кнопок по `my.wait`, лист согласования, форма «На согласование» (routeDlgVM
// :1386–1451) и тело `startDocRoute`. Дословность подписей — по эталону.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  addWorkDays,
  authorActions,
  backText,
  barTitle,
  dateTime,
  ddmm,
  draftErrors,
  draftFromTemplate,
  dueDates,
  isAuthor,
  meMemberId,
  moveStepUp,
  myAction,
  newStep,
  nowText,
  removeStep,
  resumeState,
  ackRecord,
  ackDoneText,
  previewRows,
  sheetRows,
  stepSub,
  stepView,
  toStartBody,
  type RouteDraft,
} from './model.ts';

type S = components['schemas'];

const m = (id: string, displayName: string): S['DocMemberRef'] => ({ memberId: id, displayName });
const SOKOLOV = m('m-sok', 'Алексей Соколов');
const ZIMINA = m('m-own', 'Дарья Зимина');
const KOTOVA = m('m-kot', 'Марина Котова');

const step = (o: Partial<S['DocRouteStep']> = {}): S['DocRouteStep'] => ({
  kind: 'approve',
  name: 'Согласовать',
  mode: 'all',
  who: [SOKOLOV],
  days: 2,
  status: 'active',
  due: '2026-10-02',
  decisions: [],
  ...o,
});

const route = (o: Partial<S['DocRoute']> = {}): S['DocRoute'] => ({
  id: 'rt-1',
  version: 3,
  startedBy: ZIMINA,
  startedAt: '2026-10-01T07:00:00Z',
  status: 'active',
  currentStep: 0,
  rules: { lock: true, notAuthor: true, commentOnBack: true, escalate: false },
  steps: [step()],
  ...o,
});

describe('ddmm и dateTime', () => {
  it.each([
    ['2026-10-02', '02.10'],
    ['2026-12-31', '31.12'],
  ])('%s → %s', (iso, want) => expect(ddmm(iso)).toBe(want));
  it('пусто — пустая строка', () => {
    expect(ddmm(null)).toBe('');
    expect(ddmm(undefined)).toBe('');
  });
  it('время — по поясу МСК', () => {
    expect(dateTime('2026-10-01T07:05:00Z')).toBe('01.10 10:05');
  });
});

describe('barTitle', () => {
  it.each([
    ['active', 'Маршрут · v3'],
    ['returned', 'Маршрут · v3'],
    ['done', 'Маршрут завершён · v3'],
  ] as const)('%s → %s', (status, want) => expect(barTitle(route({ status }))).toBe(want));
});

describe('stepSub — подпись под названием шага', () => {
  it.each([
    [step({ mode: 'all', who: [SOKOLOV, KOTOVA] }), 'все сразу · 0 из 2'],
    [step({ mode: 'seq', who: [SOKOLOV, KOTOVA] }), 'по очереди · 0 из 2'],
    [step({ mode: 'any', who: [SOKOLOV, KOTOVA] }), 'достаточно одного · 0 из 1'],
    [
      step({
        who: [SOKOLOV, KOTOVA],
        decisions: [
          { member: SOKOLOV, decision: 'ok', at: '2026-10-01T08:00:00Z', method: 'click' },
        ],
      }),
      'все сразу · 1 из 2',
    ],
    [
      step({
        who: [SOKOLOV],
        decisions: [
          { member: SOKOLOV, decision: 'back', at: '2026-10-01T08:00:00Z', method: 'click' },
        ],
      }),
      'все сразу · 0 из 1',
    ],
    [step({ kind: 'sign', name: 'Утвердить', who: [ZIMINA] }), 'Дарья Зимина'],
    [
      step({ kind: 'sign', name: 'Утвердить', who: [ZIMINA], status: 'done' }),
      'Дарья Зимина · ПЭП',
    ],
    [step({ kind: 'ack', name: 'Ознакомить', who: [], status: 'wait' }), 'после утверждения'],
    [
      step({
        kind: 'ack',
        name: 'Ознакомить',
        who: [SOKOLOV, KOTOVA, ZIMINA],
        done: [{ member: SOKOLOV, at: '2026-10-02T08:00:00Z', device: 'компьютер' }],
      }),
      '1 из 3',
    ],
    [
      step({
        kind: 'ack',
        name: 'Ознакомить',
        who: [],
        done: [{ member: SOKOLOV, at: '2026-10-02T08:00:00Z', device: 'компьютер' }],
      }),
      'ознакомились: 1',
    ],
    [
      step({
        kind: 'external',
        name: 'Подпись заказчика',
        who: [],
        external: { name: 'Ольга Смирнова' },
      }),
      'Ольга Смирнова',
    ],
    [
      step({
        kind: 'external',
        name: 'Подпись заказчика',
        who: [],
        status: 'done',
        external: { name: 'Ольга Смирнова' },
      }),
      'подписал(а)',
    ],
  ])('%#', (s, want) => expect(stepSub(s)).toBe(want));
});

describe('stepView — номер, значок и состояние чипа', () => {
  const r = route({
    steps: [
      step({ status: 'done' }),
      step({ kind: 'sign', name: 'Утвердить' }),
      step({ status: 'wait' }),
    ],
    currentStep: 1,
  });
  it('выполнен, текущий, ожидает', () => {
    expect(stepView(r, 0)).toMatchObject({ n: '1', icon: 'check_circle', state: 'done' });
    expect(stepView(r, 1)).toMatchObject({ n: '2', icon: 'radio_button_checked', state: 'active' });
    expect(stepView(r, 2)).toMatchObject({ n: '3', icon: 'radio_button_unchecked', state: 'wait' });
  });
  it('возвращён: на шаге, где вернули, значок «undo»', () => {
    const back = route({
      status: 'returned',
      currentStep: 0,
      back: { name: 'Алексей Соколов' },
      steps: [step({ status: 'wait' })],
    });
    expect(stepView(back, 0)).toMatchObject({ icon: 'undo', state: 'back' });
  });
  it('маршрут завершён: активного нет', () => {
    const done = route({ status: 'done', steps: [step({ status: 'done' })] });
    expect(stepView(done, 0).state).toBe('done');
  });
});

describe('nowText — строка «Сейчас»', () => {
  it('шаг, срок и кто ждёт', () => {
    expect(nowText(route())).toBe('Шаг 1 «Согласовать» · до 02.10. Ждут: Алексей Соколов.');
  });
  it('решившие не ждут', () => {
    const r = route({
      steps: [
        step({
          who: [SOKOLOV, KOTOVA],
          decisions: [
            { member: SOKOLOV, decision: 'ok', at: '2026-10-01T08:00:00Z', method: 'click' },
          ],
        }),
      ],
    });
    expect(nowText(r)).toBe('Шаг 1 «Согласовать» · до 02.10. Ждут: Марина Котова.');
  });
  it('заказчик — с пометкой', () => {
    const r = route({
      currentStep: 0,
      steps: [
        step({
          kind: 'external',
          name: 'Подпись заказчика',
          who: [],
          due: '2026-10-05',
          external: { name: 'Ольга Смирнова' },
        }),
      ],
    });
    expect(nowText(r)).toBe(
      'Шаг 1 «Подпись заказчика» · до 05.10. Ждут: Ольга Смирнова (заказчик).',
    );
  });
  it('ознакомление — по подписям аудитории', () => {
    const r = route({
      steps: [
        step({
          kind: 'ack',
          name: 'Ознакомить',
          who: [],
          audience: [{ who: 'role', level: 'view', label: 'Роль «Водитель»' }],
        }),
      ],
    });
    expect(nowText(r)).toBe('Шаг 1 «Ознакомить» · до 02.10. Ждут: Роль «Водитель».');
  });
  it('без срока и без ожидающих', () => {
    const r = route({ steps: [step({ due: null, who: [] })] });
    expect(nowText(r)).toBe('Шаг 1 «Согласовать».');
  });
  it('завершён: дата последнего решения', () => {
    const r = route({
      status: 'done',
      steps: [
        step({
          status: 'done',
          decisions: [
            { member: SOKOLOV, decision: 'ok', at: '2026-10-03T09:30:00Z', method: 'click' },
          ],
        }),
      ],
    });
    expect(nowText(r)).toBe('Завершён 03.10.');
  });
});

describe('backText — возврат на доработку', () => {
  const r = route({
    status: 'returned',
    back: { name: 'Алексей Соколов', comment: 'Срок — 27 ноября' },
    steps: [step({ status: 'wait' })],
  });
  it('автору: что делать', () => {
    expect(backText(r, true)).toBe(
      'Алексей Соколов вернул(а) v3 на доработку: «Срок — 27 ноября». Исправьте документ и отправьте снова — маршрут продолжится с шага «Согласовать».',
    );
  });
  it('остальным: у кого документ', () => {
    expect(backText(r, false)).toBe(
      'Алексей Соколов вернул(а) v3 на доработку: «Срок — 27 ноября». Документ у автора: Дарья Зимина.',
    );
  });
  it('без комментария', () => {
    expect(backText(route({ status: 'returned', back: { name: 'Алексей Соколов' } }), false)).toBe(
      'Алексей Соколов вернул(а) v3 на доработку. Документ у автора: Дарья Зимина.',
    );
  });
});

describe('resumeState — «Отправить снова»', () => {
  it('нет правок: выключена, причина рядом', () => {
    expect(resumeState(3, route())).toEqual({
      label: 'Отправить снова · v3',
      disabled: true,
      hint: 'Сначала внесите правки: согласуют новую версию',
    });
  });
  it('версия документа выросла: доступна', () => {
    expect(resumeState(4, route())).toEqual({
      label: 'Отправить снова · v4',
      disabled: false,
      hint: '',
    });
  });
});

describe('myAction — что ждут от меня (my.wait сервера)', () => {
  const wait = (kind: S['DocWait']['kind']): S['DocWait'][] => [{ kind }];
  it.each([
    ['approve', 'active', 'approve'],
    ['sign', 'active', 'sign'],
    ['ack', 'active', 'ack'],
  ] as const)('%s при активном маршруте → %s', (kind, status, want) => {
    expect(myAction(wait(kind), route({ status }))).toBe(want);
  });
  it.each(['returned', 'done', 'cancelled'] as const)('маршрут %s — действий нет', (status) => {
    expect(myAction(wait('approve'), route({ status }))).toBeNull();
  });
  it('другие ожидания не относятся к маршруту', () => {
    expect(myAction([{ kind: 'mention' }, { kind: 'ocr', count: 2 }], route())).toBeNull();
  });
  it('порядок: утвердить раньше согласования', () => {
    expect(myAction([{ kind: 'approve' }, { kind: 'sign' }], route())).toBe('sign');
  });
});

describe('isAuthor и authorActions', () => {
  it('запустивший маршрут или управляющий документом', () => {
    expect(isAuthor(route(), 'm-own', false)).toBe(true);
    expect(isAuthor(route(), 'm-sok', false)).toBe(false);
    expect(isAuthor(route(), 'm-sok', true)).toBe(true);
  });
  it('активный маршрут: отменить', () => {
    expect(authorActions(route(), true)).toEqual([{ id: 'cancel', label: 'Отменить маршрут' }]);
  });
  it('ознакомление идёт: завершить досрочно и отменить', () => {
    const r = route({
      steps: [
        step({
          kind: 'ack',
          name: 'Ознакомить',
          who: [SOKOLOV, KOTOVA],
          done: [{ member: SOKOLOV, at: '2026-10-02T08:00:00Z', device: 'компьютер' }],
        }),
      ],
    });
    expect(authorActions(r, true)).toEqual([
      { id: 'closeAck', label: 'Завершить ознакомление · 1 из 2' },
      { id: 'cancel', label: 'Отменить маршрут' },
    ]);
  });
  it('возвращён: отменить; завершён и не автор: ничего', () => {
    expect(authorActions(route({ status: 'returned' }), true)).toEqual([
      { id: 'cancel', label: 'Отменить маршрут' },
    ]);
    expect(authorActions(route({ status: 'done' }), true)).toEqual([]);
    expect(authorActions(route(), false)).toEqual([]);
  });
});

describe('meMemberId — кто я среди участников документа', () => {
  const r = route({
    steps: [
      step({
        who: [SOKOLOV],
        decisions: [
          { member: KOTOVA, decision: 'ok', at: '2026-10-01T08:00:00Z', method: 'click' },
        ],
        done: [{ member: ZIMINA, at: '2026-10-02T08:00:00Z', device: 'компьютер' }],
      }),
    ],
  });
  const doc = { owner: ZIMINA, authors: [KOTOVA] };
  it('находит участника по имени среди автора, шагов, решений и отметок', () => {
    expect(meMemberId(r, doc, 'membership-1', 'Алексей Соколов')).toBe('m-sok');
    expect(meMemberId(r, doc, 'membership-1', 'Марина Котова')).toBe('m-kot');
    expect(meMemberId(r, doc, 'membership-1', 'Дарья Зимина')).toBe('m-own');
  });
  it('нет среди участников — идентификатор членства', () => {
    expect(meMemberId(r, doc, 'membership-1', 'Илья Васильев')).toBe('membership-1');
    expect(meMemberId(null, doc, 'membership-1', 'Дарья Зимина')).toBe('m-own');
  });
});

describe('ознакомление', () => {
  const r = route({
    steps: [
      step({
        kind: 'ack',
        name: 'Ознакомить',
        who: [],
        done: [{ member: SOKOLOV, at: '2026-10-02T08:00:00Z', device: 'телефон' }],
      }),
    ],
  });
  it('отметка участника находится по memberId', () => {
    expect(ackRecord(r, 'm-sok')).toEqual({ at: '2026-10-02T08:00:00Z', device: 'телефон' });
    expect(ackRecord(r, 'm-own')).toBeNull();
  });
  it('«Вы ознакомились …»', () => {
    expect(ackDoneText({ at: '2026-10-02T08:00:00Z', device: 'телефон' }, 3)).toBe(
      'Вы ознакомились 02.10 11:00 · v3 · телефон',
    );
  });
});

describe('sheetRows — лист согласования', () => {
  it('решения, ожидание, ознакомление и заказчик', () => {
    const r = route({
      status: 'active',
      currentStep: 1,
      steps: [
        step({
          status: 'done',
          who: [SOKOLOV],
          decisions: [
            { member: SOKOLOV, decision: 'ok', at: '2026-10-01T08:00:00Z', method: 'click' },
          ],
        }),
        step({ kind: 'sign', name: 'Утвердить', who: [ZIMINA] }),
        step({
          kind: 'ack',
          name: 'Ознакомить',
          who: [],
          status: 'wait',
          audience: [{ who: 'role', level: 'view', label: 'Роль «Водитель»' }],
        }),
        step({
          kind: 'external',
          name: 'Подпись заказчика',
          who: [],
          status: 'wait',
          external: { name: 'Ольга Смирнова' },
        }),
      ],
    });
    expect(sheetRows(r)).toEqual([
      { step: '1 · Согласовать', who: 'Алексей Соколов', result: 'согласовано', at: '01.10 11:00' },
      { step: '2 · Утвердить', who: 'Дарья Зимина', result: 'ждёт', at: '' },
      { step: '3 · Ознакомить', who: 'Роль «Водитель»', result: 'после утверждения', at: '' },
      { step: '4 · Подпись заказчика', who: 'Ольга Смирнова', result: 'после шага 3', at: '' },
    ]);
  });
  it('возврат и подпись ПЭП', () => {
    const r = route({
      steps: [
        step({
          status: 'wait',
          decisions: [
            {
              member: SOKOLOV,
              decision: 'back',
              at: '2026-10-01T08:00:00Z',
              comment: 'Срок',
              method: 'click',
            },
          ],
        }),
        step({
          kind: 'sign',
          name: 'Утвердить',
          who: [ZIMINA],
          status: 'done',
          decisions: [
            { member: ZIMINA, decision: 'ok', at: '2026-10-01T09:00:00Z', method: 'pep_login' },
          ],
        }),
      ],
    });
    expect(sheetRows(r).map((x) => x.result)).toEqual(['возвращено', 'подписано · ПЭП']);
  });
});

describe('форма «На согласование»', () => {
  const tpl: S['DocRouteTemplate'] = {
    id: 'rtp-1',
    folderId: 'fd-1',
    name: 'Приказ по фирме',
    steps: [
      { kind: 'approve', mode: 'all', whoMemberIds: ['m-kot'], days: 2 },
      { kind: 'sign', whoMemberIds: ['m-own'], days: 1 },
      {
        kind: 'ack',
        audience: [{ who: 'role', refId: 'r-driver', level: 'view', label: 'Роль «Водитель»' }],
        days: 3,
      },
    ],
    rules: { lock: true, notAuthor: true, commentOnBack: true, escalate: false },
  };

  it('без шаблона: один шаг «Согласовать» на 2 рабочих дня, правила по умолчанию', () => {
    const d = draftFromTemplate(undefined);
    expect(d.name).toBe('');
    expect(d.steps).toHaveLength(1);
    expect(d.steps[0]).toMatchObject({ kind: 'approve', mode: 'all', days: 2, whoMemberIds: [] });
    expect(d.rules).toEqual({ lock: true, notAuthor: true, commentOnBack: true, escalate: false });
    expect(d.saveAsFolderTemplate).toBe(false);
  });

  it('из шаблона папки: шаги, правила и название', () => {
    const d = draftFromTemplate(tpl);
    expect(d.name).toBe('Приказ по фирме');
    expect(d.steps.map((s) => s.kind)).toEqual(['approve', 'sign', 'ack']);
    expect(d.steps[1]).toMatchObject({ whoMemberIds: ['m-own'], days: 1 });
    expect(d.steps[2]?.audience).toHaveLength(1);
  });

  it('newStep: умолчания по видам', () => {
    expect(newStep('approve')).toMatchObject({ mode: 'all', days: 2, whoMemberIds: [] });
    expect(newStep('sign')).toMatchObject({ days: 1, whoMemberIds: [] });
    expect(newStep('ack')).toMatchObject({ days: 3, audience: [] });
    expect(newStep('external')).toMatchObject({ days: 3, externalName: '', externalPhone: '' });
  });

  it('moveStepUp и removeStep не меняют исходный список', () => {
    const a = [newStep('approve'), newStep('sign'), newStep('ack')];
    expect(moveStepUp(a, 1).map((s) => s.kind)).toEqual(['sign', 'approve', 'ack']);
    expect(moveStepUp(a, 0)).toBe(a);
    expect(removeStep(a, 0).map((s) => s.kind)).toEqual(['sign', 'ack']);
    expect(a.map((s) => s.kind)).toEqual(['approve', 'sign', 'ack']);
  });

  describe('draftErrors — тексты эталона, по порядку шагов', () => {
    const base = (
      steps: RouteDraft['steps'],
      o: Partial<RouteDraft['rules']> = {},
    ): RouteDraft => ({
      name: '',
      steps,
      rules: { lock: true, notAuthor: true, commentOnBack: true, escalate: false, ...o },
      saveAsFolderTemplate: false,
    });
    const ctx = { authorId: 'm-own', linked: true };

    it('нет шагов', () => {
      expect(draftErrors(base([]), ctx)).toEqual(['Добавьте хотя бы один шаг']);
    });
    it('согласующих нет — номер шага', () => {
      expect(draftErrors(base([newStep('approve')]), ctx)).toEqual(['Шаг 1: добавьте согласующих']);
    });
    it('автор среди согласующих при правиле', () => {
      const s = { ...newStep('approve'), whoMemberIds: ['m-own'] };
      expect(draftErrors(base([s]), ctx)).toEqual([
        'Автор не согласует свой документ: уберите себя или выключите правило',
      ]);
      expect(draftErrors(base([s], { notAuthor: false }), ctx)).toEqual([]);
    });
    it('утверждающий не выбран / автор', () => {
      expect(draftErrors(base([newStep('sign')]), ctx)).toEqual([
        'Шаг «Утвердить»: выберите, кто утверждает',
      ]);
      const s = { ...newStep('sign'), whoMemberIds: ['m-own'] };
      expect(draftErrors(base([s]), ctx)).toEqual([
        'Автор не утверждает свой документ: выберите другого утверждающего или выключите правило',
      ]);
    });
    it('ознакомление без аудитории', () => {
      expect(draftErrors(base([newStep('ack')]), ctx)).toEqual([
        'Шаг «Ознакомить»: добавьте, кого ознакомить',
      ]);
    });
    it('подпись заказчика: нужны имя и телефон; без связи с объектом шага быть не может', () => {
      expect(draftErrors(base([newStep('external')]), ctx)).toEqual([
        'Шаг «Подпись заказчика»: укажите имя и телефон заказчика',
      ]);
      const ok = {
        ...newStep('external'),
        externalName: 'Ольга',
        externalPhone: '+7 916 000-00-17',
      };
      expect(draftErrors(base([ok]), ctx)).toEqual([]);
      expect(draftErrors(base([ok]), { ...ctx, linked: false })).toEqual([
        'Шаг «Подпись заказчика»: у документа нет объекта с заказчиком',
      ]);
    });
    it('несколько ошибок — по порядку шагов, пустой список — можно отправлять', () => {
      const good = { ...newStep('approve'), whoMemberIds: ['m-kot'] };
      expect(draftErrors(base([good, newStep('ack'), newStep('sign')]), ctx)).toEqual([
        'Шаг «Ознакомить»: добавьте, кого ознакомить',
        'Шаг «Утвердить»: выберите, кто утверждает',
      ]);
      expect(draftErrors(base([good]), ctx)).toEqual([]);
    });
  });

  describe('toStartBody — тело startDocRoute', () => {
    const d: RouteDraft = {
      name: 'Приказ по фирме',
      steps: [
        { ...newStep('approve'), mode: 'seq', whoMemberIds: ['m-kot', 'm-sok'], days: 3 },
        { ...newStep('sign'), whoMemberIds: ['m-own'] },
        {
          ...newStep('ack'),
          audience: [{ who: 'role', refId: 'r-driver', level: 'view', label: 'Роль «Водитель»' }],
        },
        { ...newStep('external'), externalName: ' Ольга ', externalPhone: '+7 916 000-00-17' },
      ],
      rules: { lock: true, notAuthor: true, commentOnBack: false, escalate: true },
      saveAsFolderTemplate: true,
    };
    it('шаги по видам, правила, флажок шаблона — только с правом', () => {
      const b = toStartBody(d, { canSaveTemplate: true });
      expect(b.steps).toEqual([
        { kind: 'approve', mode: 'seq', whoMemberIds: ['m-kot', 'm-sok'], days: 3 },
        { kind: 'sign', whoMemberIds: ['m-own'], days: 1 },
        {
          kind: 'ack',
          audience: [{ who: 'role', refId: 'r-driver', level: 'view', label: 'Роль «Водитель»' }],
          days: 3,
        },
        { kind: 'external', days: 3, externalName: 'Ольга', externalPhone: '+7 916 000-00-17' },
      ]);
      expect(b.rules).toEqual({
        lock: true,
        notAuthor: true,
        commentOnBack: false,
        escalate: true,
      });
      expect(b.saveAsFolderTemplate).toBe(true);
      expect(b.dryRun).toBeUndefined();
      expect(toStartBody(d, { canSaveTemplate: false }).saveAsFolderTemplate).toBeUndefined();
    });
    it('dryRun — «Что произойдёт»', () => {
      expect(toStartBody(d, { canSaveTemplate: false, dryRun: true }).dryRun).toBe(true);
    });
  });

  describe('previewRows — черновик листа согласования', () => {
    const names: Record<string, string> = {
      a: 'Анна Иванова',
      b: 'Борис Петров',
      c: 'Вера Котова',
    };
    const nameOf = (id: string): string => names[id] ?? id;
    const rows = (steps: RouteDraft['steps']) =>
      previewRows(
        {
          name: '',
          steps,
          rules: { lock: true, notAuthor: true, commentOnBack: true, escalate: false },
          saveAsFolderTemplate: false,
        },
        nameOf,
      );

    it('все сразу: оба ждут; по очереди: второй — после первого; достаточно одного: «или первый»', () => {
      expect(
        rows([{ ...newStep('approve'), whoMemberIds: ['a', 'b'] }]).map((r) => r.result),
      ).toEqual(['ждёт', 'ждёт']);
      expect(
        rows([{ ...newStep('approve'), mode: 'seq', whoMemberIds: ['a', 'b'] }]).map(
          (r) => r.result,
        ),
      ).toEqual(['ждёт', 'после Анна']);
      expect(
        rows([{ ...newStep('approve'), mode: 'any', whoMemberIds: ['a', 'b'] }]).map(
          (r) => r.result,
        ),
      ).toEqual(['ждёт', 'или первый']);
    });

    it('следующие шаги — «после шага N», ознакомление — «после утверждения», заказчик', () => {
      const r = rows([
        { ...newStep('approve'), whoMemberIds: ['a'] },
        { ...newStep('sign'), whoMemberIds: ['c'] },
        {
          ...newStep('ack'),
          audience: [{ who: 'role', level: 'view', label: 'Роль «Водитель»' }],
        },
        { ...newStep('external'), externalName: 'Ольга Смирнова' },
      ]);
      expect(r).toEqual([
        { step: '1 · Согласовать', who: 'Анна Иванова', result: 'ждёт', at: '' },
        { step: '2 · Утвердить', who: 'Вера Котова', result: 'после шага 1', at: '' },
        { step: '3 · Ознакомить', who: 'Роль «Водитель»', result: 'после утверждения', at: '' },
        { step: '4 · Подпись заказчика', who: 'Ольга Смирнова', result: 'после шага 3', at: '' },
      ]);
    });

    it('шаг без участников — прочерк', () => {
      expect(rows([newStep('approve')])).toEqual([
        { step: '1 · Согласовать', who: '—', result: 'ждёт', at: '' },
      ]);
    });
  });

  describe('сроки шагов — рабочие дни нарастающим итогом', () => {
    it('addWorkDays пропускает субботу и воскресенье', () => {
      expect(addWorkDays('2026-10-01', 1)).toBe('2026-10-02'); // чт → пт
      expect(addWorkDays('2026-10-02', 1)).toBe('2026-10-05'); // пт → пн
      expect(addWorkDays('2026-10-01', 5)).toBe('2026-10-08');
    });
    it('dueDates: «до ДД.ММ» по шагам', () => {
      const steps = [
        { ...newStep('approve'), days: 2 },
        { ...newStep('sign'), days: 1 },
      ];
      expect(dueDates(steps, '2026-10-01')).toEqual(['05.10', '06.10']);
    });
  });
});
