import { describe, expect, it } from 'vitest';
import { ALL_MODULES, CORE, INDUSTRY, REASON, TONES, VERBS, isIndustry } from './dictionaries.ts';

describe('справочники ядра 14.10', () => {
  it('VERBS — шесть действий роли с подписями', () => {
    expect(VERBS).toEqual([
      ['view', 'Просматривать'],
      ['create', 'Создавать'],
      ['edit', 'Изменять'],
      ['review', 'Проверять'],
      ['export', 'Выгружать'],
      ['settings', 'Настраивать'],
    ]);
  });

  it('TONES — пять тонов статусов', () => {
    expect(Object.keys(TONES)).toEqual(['ok', 'info', 'warn', 'danger', 'neutral']);
    expect(TONES.ok).toEqual({ bg: '#E3EFE7', fg: '#1F6B52' });
  });

  it('отрасли: логистика, SPA, ремонт', () => {
    expect(Object.keys(INDUSTRY)).toEqual(['logistics', 'spa', 'repair']);
    expect(INDUSTRY.logistics.perms.edit).toEqual(['fleet.trips.manage', 'fleet.pool.request']);
    expect(INDUSTRY.repair.deps).toEqual(['tasks', 'inventory', 'files']);
  });

  it('CORE 14.10: «Касса» вместо «Внутренняя касса», добавлены docs, service, chat', () => {
    expect(Object.keys(CORE)).toEqual([
      'calendar',
      'tasks',
      'knowledge',
      'docs',
      'forms',
      'data',
      'files',
      'inventory',
      'cash',
      'service',
      'chat',
      'notifications',
    ]);
    expect(CORE.cash.name).toBe('Касса');
    expect(CORE.cash.perms?.create).toEqual([
      'cash.post',
      'cash.proposals.post',
      'cash.shift.operate',
    ]);
    expect(CORE.docs.perms?.settings).toEqual([
      'docs.share',
      'docs.templates.manage',
      'docs.folders.manage',
    ]);
    expect(CORE.service.perms?.view).toEqual(['service.requests.read']);
    expect(CORE.chat.perms?.settings).toEqual([
      'chat.settings.manage',
      'chat.members.manage',
      'chat.retention.manage',
    ]);
    expect(CORE.notifications.perms).toBeNull();
  });

  it('ALL_MODULES = отрасли + ядро (15 ключей), isIndustry', () => {
    expect(Object.keys(ALL_MODULES)).toHaveLength(15);
    expect(isIndustry('spa')).toBe(true);
    expect(isIndustry('tasks')).toBe(false);
    expect(isIndustry('toString')).toBe(false);
  });

  it('REASON — тексты отказов дословно', () => {
    expect(Object.keys(REASON)).toEqual([
      'module_off',
      'module_readonly',
      'no_permission',
      'no_scope',
      'driver_block',
    ]);
    expect(REASON.no_scope.text).toBe('Право есть, но объект находится вне области назначения.');
    expect(REASON.no_permission).toEqual({
      label: 'Нет права',
      icon: 'lock',
      tone: 'warn',
      text: 'Ни одна роль сотрудника не разрешает это действие.',
    });
    expect(REASON.driver_block.text).toBe(
      'Действующая функция «Водитель» запрещает начисления через любую роль и группу.',
    );
  });
});
