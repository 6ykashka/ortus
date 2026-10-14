import { describe, expect, it } from 'vitest';
import { createIdGen } from './ids.ts';
import { DEFAULT_STATUS } from './task-port.ts';
import { createFakeTaskPort } from './testing/fake-task-port.ts';

describe('TaskPort: задачи для документов, чатов и обращений без импорта модуля задач', () => {
  const statuses = {
    fleet: [
      { id: 's1', name: 'Новая', cat: 'todo' as const },
      { id: 's2', name: 'В работе', cat: 'progress' as const },
      { id: 's3', name: 'На проверке', cat: 'progress' as const },
      { id: 's4', name: 'Готово', cat: 'done' as const },
    ],
  };

  it('статус по умолчанию для категорий', () => {
    expect(DEFAULT_STATUS).toEqual({ todo: 'Новая', progress: 'В работе', done: 'Готово' });
  });

  it('statusName: предпочтительное имя, иначе первый статус категории, иначе имя по умолчанию', () => {
    const port = createFakeTaskPort({ statuses });
    expect(port.statusName('fleet', 'progress', 'На проверке')).toBe('На проверке');
    expect(port.statusName('fleet', 'progress', 'Нет такого')).toBe('В работе');
    expect(port.statusName('fleet', 'done')).toBe('Готово');
    expect(port.statusName('leads', 'done', 'Отменена')).toBe('Отменена');
    expect(port.statusName('leads', 'todo')).toBe('Новая');
  });

  it('create/get/update/comment', () => {
    const db = { seq: 100 };
    const port = createFakeTaskPort({ statuses, ids: createIdGen(db) });
    const { id } = port.create({
      project: 'fleet',
      title: 'Согласовать: Договор',
      assignee: 'Марина Котова',
    });
    expect(id).toBe('T-100');
    expect(port.get(id)).toMatchObject({
      id,
      project: 'fleet',
      title: 'Согласовать: Договор',
      status: 'Новая',
    });
    port.update(id, {
      status: 'На проверке',
      assignee: 'Дарья Зимина',
      docRoute: { doc: 'doc-1' },
    });
    port.comment(id, { by: 'Система', at: '10:30', text: 'Маршрут запущен: v1', system: true });
    expect(port.get(id)).toMatchObject({
      status: 'На проверке',
      assignee: 'Дарья Зимина',
      docRoute: { doc: 'doc-1' },
    });
    expect(port.get(id)?.comments).toEqual([
      { by: 'Система', at: '10:30', text: 'Маршрут запущен: v1', system: true },
    ]);
    expect(port.all()).toHaveLength(1);
  });

  it('явный статус и id-схема проекта; несуществующая задача — без эффекта', () => {
    const port = createFakeTaskPort();
    const a = port.create({
      project: 'fleet',
      title: 'A',
      assignee: 'X',
      status: 'В работе',
      idPrefix: 'LOG-',
      idBase: 100,
    });
    expect(a.id).toBe('LOG-101');
    expect(port.get(a.id)?.status).toBe('В работе');
    port.update('nope', { status: 'Готово' });
    port.comment('nope', { by: 'x', at: '00:00', text: 'y' });
    expect(port.get('nope')).toBeUndefined();
  });
});
