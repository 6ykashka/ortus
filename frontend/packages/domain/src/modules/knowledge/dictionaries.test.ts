// Справочники «Базы знаний» (knowledge.js 14.10:11–62) с ответами владельца 17.10 (KB-02, KB-06).
import { describe, expect, it } from 'vitest';
import {
  KB_ACCESS,
  KB_BODY_MAX,
  KB_COLORS,
  KB_ICONS,
  KB_KINDS,
  KB_MAX_DEPTH,
  KB_MODES,
  KB_ROLE_CAPS,
  KB_ROLE_ORDER,
  KB_ROLES,
  KB_RUNS_KEPT,
  KB_SECTION,
  KB_STATUS,
  KB_TEMPLATES,
} from './dictionaries.ts';

describe('роли пространства (KB-02: без «Автора»)', () => {
  it('руководитель, редактор, читатель — шаблоны с областью «пространство»', () => {
    expect(KB_ROLES.map((r) => [r.id, r.name])).toEqual([
      ['r-kb-lead', 'Руководитель пространства'],
      ['r-kb-editor', 'Редактор'],
      ['r-kb-reader', 'Читатель'],
    ]);
    for (const r of KB_ROLES) {
      expect(r).toMatchObject({ kind: 'template', space: true });
      expect(r.finance).toEqual({ read: false, manage: false });
    }
    expect(KB_ROLES.map((r) => r.actions.knowledge)).toEqual([
      ['view', 'create', 'edit', 'review', 'settings'],
      ['view', 'create', 'edit', 'review'],
      ['view'],
    ]);
  });

  it('порядок старшинства и подписи возможностей', () => {
    expect(KB_ROLE_ORDER).toEqual(['r-kb-lead', 'r-kb-editor', 'r-kb-reader']);
    expect(KB_ROLE_CAPS).toEqual({
      'r-kb-lead': 'Всё в пространстве, участники, доступ, автоматизация',
      'r-kb-editor': 'Создаёт и правит любые страницы, публикует, перемещает',
      'r-kb-reader': 'Читает и отмечает «Ознакомлен»',
    });
  });
});

describe('уровни, режимы, типы, статусы', () => {
  it('уровни доступа пространства', () => {
    expect(KB_ACCESS).toEqual({
      open: {
        label: 'Открытое',
        icon: 'public',
        tone: 'ok',
        d: 'Роли области действуют полностью',
      },
      limited: {
        label: 'Ограниченное',
        icon: 'visibility',
        tone: 'info',
        d: 'Все в области читают, пишут участники',
      },
      closed: {
        label: 'Закрытое',
        icon: 'lock',
        tone: 'neutral',
        d: 'Только участники и владелец бизнеса',
      },
    });
  });

  it('режимы доступа узла', () => {
    expect(Object.keys(KB_MODES)).toEqual(['inherit', 'edit', 'listed']);
    expect(KB_MODES.inherit.label).toBe('Как у родителя');
    expect(KB_MODES.edit.label).toBe('Читают все, правят выбранные');
    expect(KB_MODES.listed).toEqual({
      label: 'Только выбранные',
      d: 'Читают и правят только те, кто в списке',
    });
  });

  it('типы узлов и статусы', () => {
    expect(KB_KINDS).toEqual({
      page: ['Страница', 'description'],
      folder: ['Папка', 'folder'],
      table: ['Таблица', 'table_view'],
      diagram: ['Схема', 'schema'],
      file: ['Файл', 'picture_as_pdf'],
      link: ['Запись CRM', 'dynamic_form'],
    });
    expect(KB_STATUS).toEqual({
      active: ['Действует', 'ok', 'check_circle'],
      draft: ['Черновик', 'warn', 'edit_note'],
      review: ['На проверке', 'warn', 'rate_review'],
      outdated: ['Пора пересмотреть', 'danger', 'event_busy'],
    });
    expect(KB_ICONS).toHaveLength(8);
    expect(KB_COLORS).toEqual(['#1F6B52', '#2B5479', '#7A5214', '#6B4A7A', '#A13A33', '#3A4844']);
  });
});

describe('шаблоны и пределы', () => {
  it('четыре шаблона пространства; «Пустое» — только «Обзор»', () => {
    expect(KB_TEMPLATES.map((t) => [t.id, t.name, t.nodes.length])).toEqual([
      ['regs', 'Регламенты подразделения', 5],
      ['staff', 'Инструкции для сотрудников', 8],
      ['objects', 'Объекты и проекты', 3],
      ['blank', 'Пустое пространство', 1],
    ]);
    const staff = KB_TEMPLATES[1];
    expect(staff?.nodes.filter((n) => n.role).map((n) => n.role)).toEqual([
      'r-driver',
      'r-foreman',
      'r-therapist',
    ]);
    expect(staff?.nodes[1]).toMatchObject({ t: 'Вводный инструктаж', ack: true });
  });

  it('шаблон раздела объекта ремонта', () => {
    expect(KB_SECTION).toEqual({
      name: 'Объект ремонта',
      v: 3,
      pages: [
        'Паспорт объекта',
        'Как попасть на объект',
        'Акты скрытых работ',
        'Фотоотчёт',
        'Гарантия',
      ],
    });
  });

  it('глубина дерева — шесть уровней (KB-06), текст до 20 000, журнал — 40 запусков', () => {
    expect(KB_MAX_DEPTH).toBe(6);
    expect(KB_BODY_MAX).toBe(20000);
    expect(KB_RUNS_KEPT).toBe(40);
  });
});
