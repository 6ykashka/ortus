// W7.25 · Модель страницы «Документы»: чип статуса (docStatus J:179–198), «Доступ» (Д:908), «Ждут меня» (Д:876–880),
// отбор списка, проверки «Нового документа» (docCreate J:660–685), «Что изменится» (Д:1313–1376), сроки ссылок (DOC-06).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  accessOf,
  anchorText,
  createErrors,
  folderNameError,
  extExpiry,
  extExpiryError,
  folderOptions,
  impactLines,
  kindOf,
  plural,
  shareHint,
  shortName,
  statusChip,
  versionSource,
  waitCards,
  whenOf,
} from './model.ts';

type S = components['schemas'];

const my = (o: Partial<S['DocMy']> = {}): S['DocMy'] => ({
  level: 'edit',
  can: {
    view: true,
    comment: true,
    suggest: true,
    edit: true,
    share: false,
    shareExternal: false,
    export: false,
    convert: true,
    sign: false,
    route: true,
    manage: false,
    locked: false,
  },
  maxGrant: 'edit',
  wait: [],
  ...o,
});

const sum = (o: Partial<S['DocSummary']> = {}): S['DocSummary'] => ({
  id: 'd1',
  kind: 'text',
  title: 'Договор',
  folderId: 'f1',
  folderName: 'Договоры',
  owner: { memberId: 'm1', displayName: 'Марина Котова' },
  status: 'draft',
  sensitivity: 'normal',
  version: 1,
  updatedAt: '2026-10-19T09:00:00Z',
  updatedBy: null,
  links: [],
  my: my(),
  ...o,
});

describe('plural', () => {
  it('склоняет по числу', () => {
    const f = ['слово', 'слова', 'слов'] as const;
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, f))).toEqual([
      'слово',
      'слова',
      'слов',
      'слов',
      'слово',
      'слова',
      'слов',
    ]);
  });
});

describe('statusChip', () => {
  it('черновик', () => {
    expect(statusChip(sum())).toEqual({ tone: 'neutral', icon: 'edit_note', label: 'Черновик' });
  });
  it('утверждён и подписан', () => {
    expect(statusChip(sum({ status: 'approved' }))).toMatchObject({
      tone: 'ok',
      label: 'Утверждён · ПЭП',
    });
    expect(statusChip(sum({ status: 'signed' }))).toMatchObject({
      tone: 'ok',
      label: 'Подписан · ПЭП',
    });
    expect(statusChip(sum({ status: 'agreed' }))).toMatchObject({
      tone: 'ok',
      label: 'Согласован',
    });
  });
  it('возврат на доработку важнее статуса', () => {
    expect(
      statusChip(
        sum({ status: 'returned', route: { status: 'returned', currentStep: 0, stepName: null } }),
      ),
    ).toMatchObject({ tone: 'warn', label: 'На доработке' });
  });
  it('маршрут по краткому виду: имя шага', () => {
    const r = (stepName: string): S['DocSummary'] =>
      sum({ status: 'in_route', route: { status: 'active', currentStep: 0, stepName } });
    expect(statusChip(r('Согласовать')).label).toBe('Согласование');
    expect(statusChip(r('Утвердить'))).toMatchObject({
      tone: 'warn',
      label: 'Утверждение · ждёт подписи',
    });
    expect(statusChip(r('Подпись заказчика'))).toMatchObject({
      tone: 'warn',
      label: 'Подпись заказчика · SMS',
    });
    expect(statusChip(r('Ознакомить')).label).toBe('Ознакомление');
    expect(statusChip(r('Своё имя')).label).toBe('На маршруте');
  });
  it('маршрут по полному виду: «N из M»', () => {
    const route: S['DocRoute'] = {
      id: 'r',
      version: 3,
      startedBy: { memberId: 'm', displayName: 'A' },
      startedAt: '2026-10-19T09:00:00Z',
      status: 'active',
      currentStep: 0,
      rules: { lock: true, notAuthor: true, commentOnBack: true, escalate: false },
      steps: [
        {
          kind: 'approve',
          name: 'Согласовать',
          mode: 'all',
          who: [
            { memberId: 'a', displayName: 'A' },
            { memberId: 'b', displayName: 'B' },
          ],
          days: 1,
          status: 'active',
          decisions: [
            {
              member: { memberId: 'a', displayName: 'A' },
              decision: 'ok',
              at: '2026-10-19T09:00:00Z',
              method: 'click',
            },
          ],
        },
      ],
    };
    expect(statusChip(sum({ status: 'in_route' }), { route }).label).toBe('Согласование · 1 из 2');
    const anyRoute = { ...route, steps: route.steps.map((s) => ({ ...s, mode: 'any' as const })) };
    expect(statusChip(sum({ status: 'in_route' }), { route: anyRoute }).label).toBe(
      'Согласование · 1 из 1',
    );
  });
  it('PDF/A-копия', () => {
    expect(statusChip(sum({ pdfaCopy: true, status: 'signed' })).label).toBe(
      'PDF/A · подписанная копия',
    );
    expect(statusChip(sum({ pdfaCopy: true })).label).toBe('PDF/A · архив');
  });
  it('распознавание: слова под вопросом', () => {
    const ocr: S['DocOcr'] = { status: 'done', doubtful: 2 };
    expect(statusChip(sum({ kind: 'pdf', ocr }))).toMatchObject({
      tone: 'warn',
      label: 'Проверить 2 слова',
    });
    expect(statusChip(sum({ kind: 'pdf', ocr: { ...ocr, doubtful: 0 } })).label).toBe('Черновик');
  });
  it('задание в работе и архив', () => {
    expect(statusChip(sum(), { jobName: 'Сжатие' })).toMatchObject({
      tone: 'info',
      label: 'Сжатие…',
    });
    expect(statusChip(sum({ status: 'archived' })).label).toBe('В архиве');
  });
});

describe('accessOf', () => {
  it('ознакомление — одна версия', () => {
    expect(accessOf(my({ onlyVersion: 3 }))).toEqual({
      icon: 'visibility',
      label: 'Только v3 · ознакомление',
    });
  });
  it('уровень участника', () => {
    expect(accessOf(my({ level: 'edit' })).label).toBe('Уровень: «Правит»');
    expect(accessOf(my({ level: 'manage' })).label).toBe('Уровень: «Управляет доступом»');
    expect(accessOf(my({ level: 'view' })).label).toBe('Уровень: «Читает»');
  });
});

describe('waitCards', () => {
  it('порядок: подпись, согласование, возврат, ознакомление, распознавание, упоминание', () => {
    const w = (kind: S['DocWait']['kind'], o: Partial<S['DocWait']> = {}): S['DocWait'] => ({
      kind,
      ...o,
    });
    const docs = [
      sum({
        id: 'a',
        title: 'A',
        my: my({ wait: [w('mention', { by: 'Марина', commentId: 'c' })] }),
      }),
      sum({ id: 'b', title: 'B', my: my({ wait: [w('approve', { due: '2026-10-22' })] }) }),
      sum({ id: 'c', title: 'C', my: my({ wait: [w('sign')] }) }),
      sum({ id: 'd', title: 'D', my: my({ wait: [w('ocr', { count: 2 })] }) }),
    ];
    const cards = waitCards(docs);
    expect(cards.map((c) => c.doc.title)).toEqual(['C', 'B', 'D', 'A']);
    expect(cards.map((c) => c.label)).toEqual([
      'Утвердить',
      'Согласовать',
      'Проверить распознавание',
      'Упоминание',
    ]);
    expect(cards[1]?.text).toBe('Шаг «Согласовать» · до 22.10');
    expect(cards[2]?.text).toBe('2 слова под вопросом');
    expect(cards[3]?.text).toBe('Марина');
    expect(cards.map((c) => c.button)).toEqual(['Открыть', 'Открыть', 'Проверить', 'Ответить']);
  });
  it('возврат и ознакомление', () => {
    const cards = waitCards([
      sum({
        my: my({
          wait: [
            { kind: 'returned', by: 'Вера Котельникова', comment: 'Исправьте срок' },
            { kind: 'ack', due: '2026-11-04' },
          ],
        }),
      }),
    ]);
    expect(cards.map((c) => c.text)).toEqual([
      'Вера Котельникова: «Исправьте срок»',
      'Утверждённая · срок до 04.11',
    ]);
  });
});

describe('форматы', () => {
  it('shortName', () => {
    expect(shortName('Дарья Зимина')).toBe('Д. Зимина');
    expect(shortName('Иван')).toBe('Иван');
    expect(shortName('')).toBe('');
  });
  it('whenOf: сегодня — время, раньше — дата (Москва)', () => {
    const now = Date.parse('2026-10-19T12:00:00Z');
    expect(whenOf('2026-10-19T07:15:00Z', now)).toBe('10:15');
    expect(whenOf('2026-10-17T07:15:00Z', now)).toBe('17.10');
  });
  it('versionSource', () => {
    expect(versionSource('edit')).toBe('правка');
    expect(versionSource('route')).toBe('маршрут');
    expect(versionSource('restore')).toBe('восстановление');
  });
  it('anchorText', () => {
    expect(anchorText({ kind: 'block', ref: 'b1', quote: 'Окончание — 27 ноября' })).toBe(
      'К абзацу «Окончание — 27 ноября»',
    );
    expect(anchorText({ kind: 'block', ref: 'b1' })).toBe('Ко всему документу.');
    expect(anchorText({ kind: 'cell', ref: 'G5' })).toBe('К ячейке G5');
    expect(anchorText({ kind: 'page', ref: '2' })).toBe('К странице 2');
  });
  it('kindOf', () => {
    expect(kindOf('sheet')).toMatchObject({ icon: 'table_chart', label: 'Таблица' });
    expect(kindOf('pdf').icon).toBe('picture_as_pdf');
  });
});

describe('folderOptions', () => {
  const f = (id: string, name: string, parentId: string | null, create = true): S['DocFolder'] => ({
    id,
    name,
    parentId,
    orgUnitId: null,
    mode: 'inherit',
    owner: { memberId: 'm', displayName: 'A' },
    icon: 'folder',
    sensitivity: 'normal',
    hasRouteTemplate: false,
    shares: [],
    documentCount: 0,
    my: { level: create ? 'edit' : 'view', create, manage: false },
    revision: 1,
  });
  it('путь «A › B», по дереву, с отбором «правит»', () => {
    const list = [
      f('b', 'Приказы', 'a'),
      f('a', 'Север Логистик', null),
      f('c', 'Финансы', 'a', false),
    ];
    expect(folderOptions(list).map((o) => o.label)).toEqual([
      'Север Логистик',
      'Север Логистик › Приказы',
      'Север Логистик › Финансы',
    ]);
    expect(folderOptions(list, true).map((o) => o.id)).toEqual(['a', 'b']);
  });
});

describe('createErrors', () => {
  const base = {
    kind: 'text' as const,
    title: 'Приказ',
    folderId: 'f1',
    files: 0,
    needsLink: false,
    link: '',
  };
  it('верный черновик', () => {
    expect(createErrors(base)).toEqual({});
  });
  it('название, папка', () => {
    expect(createErrors({ ...base, title: ' П ', folderId: '' })).toEqual({
      title: 'Название — не короче 2 символов',
      folderId: 'Выберите папку',
    });
  });
  it('PDF и скан — нужны файлы', () => {
    expect(createErrors({ ...base, kind: 'pdf' }).files).toBe('Добавьте файлы или фото');
    expect(createErrors({ ...base, kind: 'pdf', files: 2 })).toEqual({});
    expect(createErrors({ ...base, kind: 'pdf', files: 0, template: true }).files).toBeUndefined();
  });
  it('шаблон с полями объекта — нужна связь', () => {
    expect(createErrors({ ...base, needsLink: true }).link).toBe(
      'Выберите рейс / объект для полей шаблона',
    );
    expect(createErrors({ ...base, needsLink: true, link: 'o1' })).toEqual({});
  });
});

describe('impactLines', () => {
  const p = (
    name: string,
    from: S['DocImpactPerson']['from'],
    to: S['DocImpactPerson']['to'],
  ): S['DocImpactPerson'] => ({
    member: { memberId: name, displayName: name },
    from,
    to,
    invited: false,
  });
  it('пустой — «не изменится»', () => {
    expect(impactLines({ gain: [], lose: [], up: [], down: [] })).toEqual([]);
  });
  it('получат, изменят, потеряют', () => {
    const lines = impactLines({
      gain: [p('Алексей Соколов', null, 'comment')],
      up: [p('Вера', 'view', 'edit')],
      down: [p('Илья', 'edit', 'view')],
      lose: [p('Сергей', 'view', null), p('Мария', 'view', null)],
    });
    expect(lines).toEqual([
      'Алексей Соколов получит «Комментирует» и уведомление',
      'Вера: «Читает» → «Правит»',
      'Илья: «Правит» → «Читает»',
      'Потеряют доступ: Сергей, Мария',
    ]);
  });
});

describe('внешняя ссылка', () => {
  it('срок по умолчанию — сегодня + 14 дней', () => {
    expect(extExpiry('2026-10-19')).toBe('2026-11-02');
  });
  it('не больше 30 дней и не в прошлом', () => {
    expect(extExpiryError('2026-11-18', '2026-10-19')).toBeNull();
    expect(extExpiryError('2026-11-19', '2026-10-19')).toBe('Срок ссылки — не больше 30 дней');
    expect(extExpiryError('2026-10-18', '2026-10-19')).toBe('Срок ссылки — не больше 30 дней');
    expect(extExpiryError('', '2026-10-19')).toBe('Срок ссылки — не больше 30 дней');
  });
});

describe('shareHint', () => {
  it('кто вы в «Поделиться»', () => {
    const can = my().can;
    expect(
      shareHint({
        owner: true,
        my: my({ level: 'manage', can: { ...can, shareExternal: true, share: true } }),
      }),
    ).toBe('Вы — владелец бизнеса: выдаёте любой уровень и внешние ссылки.');
    expect(
      shareHint({
        owner: false,
        my: my({ level: 'manage', can: { ...can, share: true, manage: true } }),
      }),
    ).toBe(
      'Вы управляете доступом к документу: выдаёте любой уровень. Внешние ссылки — у владельца бизнеса.',
    );
    expect(
      shareHint({
        owner: false,
        my: my({ level: 'edit', maxGrant: 'edit', can: { ...can, share: true } }),
      }),
    ).toBe('Вы — «Правит»: делитесь внутри организации не выше «Правит».');
  });
});

describe('folderNameError', () => {
  it('короче 2 и длиннее 200 символов — ошибка, иначе пусто', () => {
    expect(folderNameError(' a ')).toBe('Название — не короче 2 символов');
    expect(folderNameError('a'.repeat(201))).toBe('Название — не длиннее 200 символов');
    expect(folderNameError('a'.repeat(200))).toBeUndefined();
    expect(folderNameError('Акты')).toBeUndefined();
  });
});
