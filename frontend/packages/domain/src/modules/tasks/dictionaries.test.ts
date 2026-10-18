import { describe, expect, it } from 'vitest';
import {
  PRIORITY,
  PROJECT_ROLES,
  STATUS_CAT,
  TASK_FLOW,
  TASK_STATUSES,
  TASK_TONE,
  VERB_LABEL,
  WHO_LABEL,
  WHO_VERB,
  WORKFLOWS,
} from './dictionaries.ts';

describe('справочники задач (models.js 14.10:164–184, 235)', () => {
  it('статусы и переходы старого процесса задач', () => {
    expect(TASK_STATUSES).toEqual(['Новая', 'В работе', 'На проверке', 'Готово']);
    expect(TASK_FLOW).toEqual({
      Новая: ['В работе', 'Отменена'],
      'В работе': ['На проверке', 'Новая'],
      'На проверке': ['Готово', 'В работе'],
      Готово: ['В работе'],
      Отменена: ['Новая'],
    });
  });

  it.each([
    ['Новая', ['neutral', 'radio_button_unchecked']],
    ['В работе', ['info', 'pending']],
    ['На проверке', ['warn', 'rate_review']],
    ['Готово', ['ok', 'check_circle']],
    ['Отменена', ['neutral', 'block']],
    ['Статус из процесса проекта', ['info', 'pending']],
  ])('тон статуса «%s» (неизвестный — «в работе»)', (status, tone) => {
    expect(TASK_TONE[status]).toEqual(tone);
  });

  it('у тона пять известных статусов', () => {
    expect(Object.keys(TASK_TONE)).toEqual([
      'Новая',
      'В работе',
      'На проверке',
      'Готово',
      'Отменена',
    ]);
  });

  it('процессы «Задачи» и «Заявки»', () => {
    expect(WORKFLOWS.tasks).toMatchObject({
      statuses: TASK_STATUSES,
      flow: TASK_FLOW,
      item: 'задача',
      items: 'Задачи',
      done: 'Готово',
    });
    expect(WORKFLOWS.leads.statuses).toEqual(['Новая', 'Замер', 'Смета', 'Договор', 'Объект']);
    expect(WORKFLOWS.leads.flow['Смета']).toEqual(['Договор', 'Замер', 'Отказ']);
    expect(WORKFLOWS.leads.flow['Объект']).toEqual([]);
    expect(WORKFLOWS.leads.tone['Договор']).toEqual(['warn', 'contract']);
    expect(WORKFLOWS.leads).toMatchObject({ item: 'заявка', items: 'Заявки', done: 'Объект' });
  });

  it('роли проекта, действия и «кто может»', () => {
    expect(PROJECT_ROLES).toEqual(['r-pm', 'r-approver', 'r-exec', 'r-viewer']);
    expect(VERB_LABEL).toEqual({
      view: 'Читать',
      create: 'Создавать',
      edit: 'Менять статус',
      review: 'Согласовывать',
      settings: 'Настраивать',
    });
    expect(WHO_LABEL).toEqual({
      'r-pm': 'руководитель проекта',
      'r-approver': 'согласующий',
      'r-exec': 'исполнитель по роли',
      assignee: 'исполнитель задачи',
      author: 'автор задачи',
    });
    expect(WHO_VERB).toEqual({ 'r-pm': 'settings', 'r-approver': 'review', 'r-exec': 'edit' });
  });

  it('категории статусов и приоритеты', () => {
    expect(STATUS_CAT).toEqual({
      todo: ['К выполнению', '#ECEFEA', '#3A4844', '#B7C0B4'],
      progress: ['В работе', '#E7EEF6', '#2B5479', '#9DB7D1'],
      done: ['Готово', '#E3EFE7', '#1F6B52', '#9CC3AE'],
    });
    expect(PRIORITY).toEqual({
      urgent: ['Срочно', 'danger', 'priority_high'],
      high: ['Высокий', 'warn', 'keyboard_double_arrow_up'],
      normal: ['Обычный', 'neutral', 'remove'],
      low: ['Низкий', 'neutral', 'keyboard_arrow_down'],
    });
  });
});
