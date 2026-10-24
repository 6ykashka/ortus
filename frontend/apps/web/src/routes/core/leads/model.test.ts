// W4.13 · Модель старой доски «Заявки» (эталон design-2026-10-19 «Ортус CRM.dc.html» :1600–1705, tasksVM :4443–4504):
// колонки — этапы воронки WORKFLOWS.leads в порядке эталона (статусы сервера по имени), карточка и строка списка, чип
// этапа, приоритет, срок «ДД.ММ», кнопки «Перевести» (вперёд — залитая, назад — «← »), история «по порядку».
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { cardOf, chipOf, columnsOf, dueText, historyLines, movesOf, prioOf } from './model.ts';

type S = components['schemas'];

const STATUSES: S['TaskWorkflowStatus'][] = [
  { id: 'new', name: 'Новая', category: 'todo' },
  { id: 'measure', name: 'Замер', category: 'progress' },
  { id: 'estimate', name: 'Смета', category: 'progress' },
  { id: 'contract', name: 'Договор', category: 'progress' },
  { id: 'object', name: 'Объект', category: 'done' },
  { id: 'rejected', name: 'Отказ', category: 'done' },
];

const task = (o: Partial<S['Task']>): S['Task'] => ({
  id: 'id-l31',
  key: 'L-31',
  projectId: 'leads',
  title: 'Квартира 64 м², Химки',
  descriptionMarkdown: '',
  status: 'new',
  statusName: 'Новая',
  statusCategory: 'todo',
  priority: 'high',
  labels: [],
  relatedObjects: [],
  customFields: [],
  revision: 1,
  assigneeMemberId: 'zimina',
  assigneeDisplayName: 'Дарья Зимина',
  dueAt: '2026-10-03T21:00:00Z',
  ...o,
});

const NOW = Date.parse('2026-10-01T07:30:00Z');

describe('«Заявки»: колонки и карточки', () => {
  it('колонки — 5 этапов воронки эталона; «Отказ» колонки не имеет', () => {
    const cols = columnsOf(STATUSES, [
      task({}),
      task({ id: 'id-l29', key: 'L-29', status: 'measure', statusName: 'Замер' }),
      task({ id: 'id-x', key: 'L-1', status: 'rejected', statusName: 'Отказ' }),
    ]);
    expect(cols.map((c) => [c.name, c.icon, c.fg, c.count, c.empty])).toEqual([
      ['Новая', 'radio_button_unchecked', '#4C5955', '1', false],
      ['Замер', 'straighten', '#2B5479', '1', false],
      ['Смета', 'request_quote', '#7A5214', '0', true],
      ['Договор', 'contract', '#7A5214', '0', true],
      ['Объект', 'apartment', '#1F6B52', '0', true],
    ]);
    expect(cols[0]?.cards.map((t) => t.key)).toEqual(['L-31']);
  });

  it('приоритет: подпись, иконка, цвет (нейтральный — #5C6964)', () => {
    expect(prioOf('urgent')).toEqual({ label: 'Срочно', icon: 'priority_high', fg: '#A13A33' });
    expect(prioOf('high')).toEqual({
      label: 'Высокий',
      icon: 'keyboard_double_arrow_up',
      fg: '#7A5214',
    });
    expect(prioOf('normal')).toEqual({ label: 'Обычный', icon: 'remove', fg: '#5C6964' });
  });

  it('чип этапа: тон и иконка воронки', () => {
    expect(chipOf('Договор')).toEqual({
      label: 'Договор',
      icon: 'contract',
      bg: '#FAF1DC',
      fg: '#7A5214',
    });
    expect(chipOf('Неизвестный')).toEqual({
      label: 'Неизвестный',
      icon: 'radio_button_unchecked',
      bg: '#ECEFEA',
      fg: '#4C5955',
    });
  });

  // Возврат 3: задача эталона без срока хранит due «—» (api.js createTask :639) — «срок —» на карточке (CRM:1642),
  // «—» в ячейке списка и в поле «Срок» карточки (CRM:1673).
  it('срок — «ДД.ММ» дня по Москве (конец дня — полночь следующего); без срока — «—», как в эталоне', () => {
    expect(dueText('2026-10-03T21:00:00Z')).toBe('03.10');
    expect(dueText(undefined)).toBe('—');
    expect(cardOf(task({ dueAt: undefined }), NOW).due).toBe('—');
  });

  it('карточка: id, тема, исполнитель, срок; просрочена — срочная незавершённая со сроком не позже сегодня', () => {
    expect(cardOf(task({}), NOW)).toMatchObject({
      id: 'id-l31',
      key: 'L-31',
      title: 'Квартира 64 м², Химки',
      assignee: 'Дарья Зимина',
      due: '03.10',
      overdue: false,
    });
    expect(cardOf(task({ priority: 'urgent', dueAt: '2026-09-30T21:00:00Z' }), NOW).overdue).toBe(
      true,
    );
    expect(
      cardOf(
        task({ priority: 'urgent', dueAt: '2026-09-30T21:00:00Z', statusCategory: 'done' }),
        NOW,
      ).overdue,
    ).toBe(false);
  });
});

describe('«Заявки»: «Перевести» и история', () => {
  const opt = (o: Partial<S['TaskTransitionOption']>): S['TaskTransitionOption'] => ({
    key: 'to-measure',
    name: 'Замер',
    toStatusId: 'measure',
    toStatusName: 'Замер',
    approval: false,
    commentRequired: false,
    allowed: true,
    ...o,
  });

  it('вперёд — без стрелки, назад и «Отказ» — «← »; запрет сервера или нет права — недоступна', () => {
    const t = task({
      availableTransitions: [
        opt({}),
        opt({ key: 'to-rejected', name: 'Отказ', toStatusId: 'rejected', toStatusName: 'Отказ' }),
      ],
    });
    expect(movesOf(t, { canEdit: true })).toEqual([
      {
        key: 'to-measure',
        label: 'Замер',
        to: 'Замер',
        icon: 'straighten',
        fwd: true,
        disabled: false,
      },
      {
        key: 'to-rejected',
        label: '← Отказ',
        to: 'Отказ',
        icon: 'block',
        fwd: false,
        disabled: false,
      },
    ]);
    expect(movesOf(t, { canEdit: false }).every((m) => m.disabled)).toBe(true);
    const back = task({
      status: 'estimate',
      statusName: 'Смета',
      availableTransitions: [opt({ allowed: false })],
    });
    expect(movesOf(back, { canEdit: true })).toEqual([
      {
        key: 'to-measure',
        label: '← Замер',
        to: 'Замер',
        icon: 'straighten',
        fwd: false,
        disabled: true,
      },
    ]);
  });

  // Возврат 1: порядок кнопок — WORKFLOWS.leads.flow эталона (Договор: «Объект», «← Смета», «← Отказ»), а не порядок
  // availableTransitions сервера; переходы вне flow — в конце в порядке сервера.
  it('порядок «Перевести» — по воронке эталона', () => {
    const t = task({
      status: 'contract',
      statusName: 'Договор',
      availableTransitions: [
        opt({ key: 'x', name: 'Особый', toStatusId: 'x', toStatusName: 'Особый' }),
        opt({ key: 'to-estimate', name: 'Смета', toStatusId: 'estimate', toStatusName: 'Смета' }),
        opt({ key: 'to-rejected', name: 'Отказ', toStatusId: 'rejected', toStatusName: 'Отказ' }),
        opt({ key: 'to-object', name: 'Объект', toStatusId: 'object', toStatusName: 'Объект' }),
      ],
    });
    expect(movesOf(t, { canEdit: true }).map((m) => m.label)).toEqual([
      'Объект',
      '← Смета',
      '← Отказ',
      '← Особый',
    ]);
  });

  it('история — по порядку (старые сверху), системные — приглушены', () => {
    const items: S['TaskHistoryEntry'][] = [
      {
        id: '2',
        at: '2026-10-01T06:30:00Z',
        kind: 'comment',
        actorDisplayName: 'Дарья Зимина',
        text: 'Перезвонила',
      },
      {
        id: '1',
        at: '2026-09-27T07:12:00Z',
        kind: 'transition',
        actorDisplayName: 'Марина Котова',
        text: 'Замер: Новая → Замер',
      },
    ];
    expect(historyLines(items, NOW)).toEqual([
      { id: '1', text: 'Замер: Новая → Замер', meta: 'Марина Котова · 27.09 10:12', system: true },
      { id: '2', text: 'Перезвонила', meta: 'Дарья Зимина · 09:30', system: false },
    ]);
  });
});
