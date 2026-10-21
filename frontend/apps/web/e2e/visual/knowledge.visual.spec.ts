// W4.32 · Сверка `knowledge` «База знаний» со снимком design-2026-10-19 (verification-protocol.md §3): эталон —
// «Ортус CRM.dc.html» → пункт меню «База знаний» (модуль «База знаний.dc.html» внутри CRM), реализация — тот же
// персонаж dev-входом. Шапка и меню оболочки закрыты маской — их сверяет ключ `shell`. Экраны: список, пространство,
// таблица, схема, старая версия, редактор, «Автоматизация», «Архив» (пустой и после «В архив»), «Новое
// пространство», «Доступ · …», водитель, карта доступа «Участников и доступа». Расхождения — allowlist/knowledge.md:
//   • строка «Обновлено: «…», дата» карточек — закрыта маской на обеих сторонах (у равных дат сервер берёт страницу
//     по названию, эталон — первую по порядку сида; Q-W4.32-1);
//   • подпись аудитории ознакомления — текст сервера «роль «Водитель»» (эталон — «Роль «Водитель» · «Север
//     Логистик»», KB.entryLabel; Q-W4.32-12) — на сверке обеим сторонам ставится текст сервера;
//   • «Участники и доступ» — карточки ролей без пиксельной сверки (KB-02: три роли, у эталона карточка «Автор»),
//     пиксели — карта доступа и «Почему так» на 390 и 768; на 1440 панель «Почему так» уже (варианты сотрудников без
//     должности — Q-W4.32-3), подписи — по allowlist;
//   • на телефоне цели нажатия 44 px (PD-28, Q-W4.32-8): зазор рядов панели страницы 10 px вместо 8, поля, узлы
//     шаблона, версии, крошки пути — 44 px, ячейки карты — 36 px, зазор строк значков и цветов — 16 px, зазор между
//     цветами — 22 px, крошки пути сжимаются все и не уже 44 px — те же размеры эталону (PHONE_PARITY).
import type { Locator, Page } from '@playwright/test';

import { call } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { compareShots, labelsOf } from './shell.compare.ts';

type Persona = 'owner' | 'manager' | 'driver';

const CHROME = ['header', 'nav[aria-label="Основная навигация"]', 'nav[aria-label="Навигация"]'];
/** Строка «Обновлено» карточек (сетка карточек — прямой ребёнок списка; диалог «Нового пространства» не задет). */
const UPDATED = 'section[aria-labelledby="kb-h"] > div > button > span:nth-child(4)';
/**
 * Подпись аудитории ознакомления (Q-W4.32-12): текст сервера «роль «Водитель»», у эталона — «Роль «Водитель» ·
 * «Север Логистик»» (KB.entryLabel). Перед снимком обеим сторонам ставится текст сервера: строка той же длины не
 * сдвигает разметку (иначе сдвиг на 390 и в редакторе закрыл бы сверку остального).
 */
async function sameAudience(p: Page): Promise<void> {
  await p.evaluate(() => {
    const AUD = 'роль «Водитель»';
    const heads = [
      /^(Ознакомление с версией \d+ · ).+$/,
      /^(Попросить ознакомиться с новой версией: ).+$/,
    ];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent ?? '';
      for (const re of heads) {
        const m = re.exec(t);
        if (m) n.textContent = `${m[1]}${AUD}`;
      }
    }
  });
}

/** Размеры целей нажатия реализации на телефоне (knowledge.css, @media max-width 639px) — для эталона. */
const PHONE_PARITY = `
  main select, main input:not([type="checkbox"]):not([type="radio"]),
  [role="dialog"] button[role="checkbox"],
  button[aria-pressed][style*="padding: 6px 4px"],
  nav[aria-label="Путь"] button { min-height: 44px !important; }
  label:has(> input[type="checkbox"]) { min-height: 44px !important; }
  button[title][style*="height: 28px"] { height: 36px !important; }
  div:has(> button[aria-label="Цвет"]) { row-gap: 16px !important; }
  button[aria-label="Цвет"] + button[aria-label="Цвет"] { margin-left: 10px !important; }
  nav[aria-label="Путь"] button { flex: 0 1 auto !important; min-width: 44px !important; }
`;

type Reference = (
  file?: string,
  o?: { persona?: Persona; hidePanel?: boolean },
) => Promise<{ page: Page; root: Locator }>;
type App = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

const phone = (p: Page): boolean => (p.viewportSize()?.width ?? 1440) < 640;

/** Эталон: пункт меню «База знаний» — боковая панель или рейл, на телефоне — «Ещё» → «Все разделы». */
async function openOnReference(page: Page): Promise<void> {
  const side = page.locator('nav[aria-label="Основная навигация"]');
  if (await side.isVisible()) {
    await side
      .locator('button[title="База знаний"], button:has-text("База знаний")')
      .first()
      .click();
  } else {
    await page.locator('nav[aria-label="Навигация"]').getByRole('button', { name: 'Ещё' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'База знаний' }).click();
  }
  await page.getByRole('heading', { level: 1, name: 'База знаний' }).waitFor();
  await page.waitForLoadState('networkidle');
}

/** Одинаковые шаги на обеих сторонах: пространство, папка, страница, версия, правка, вкладка, диалоги. */
interface Steps {
  space?: string;
  expand?: string;
  node?: string;
  version?: string;
  edit?: boolean;
  tab?: string;
  /** «В архив» выбранной страницы до перехода на вкладку (непустой «Архив»). */
  archive?: boolean;
  access?: boolean;
  newSpace?: boolean;
}

const treeOf = (p: Page): Locator => p.getByRole('navigation', { name: 'Дерево пространства' });

async function showTree(p: Page): Promise<void> {
  if (!(await treeOf(p).isVisible()))
    await p.getByRole('button', { name: 'Дерево', exact: true }).click();
}

async function act(p: Page, s: Steps): Promise<void> {
  if (s.newSpace) {
    await p.getByRole('button', { name: 'Новое пространство' }).click();
    await p.getByRole('dialog').getByText('Вводный инструктаж').first().waitFor();
  }
  if (!s.space) {
    await p.waitForTimeout(400);
    return;
  }
  await p
    .locator('section[aria-labelledby="kb-h"] button')
    .filter({ hasText: s.space })
    .first()
    .click();
  await p.locator(`section[aria-label="${s.space}"]`).waitFor();
  await p.getByRole('heading', { level: 2 }).first().waitFor();
  if (s.expand) {
    await showTree(p);
    await treeOf(p)
      .getByText(s.expand, { exact: true })
      .first()
      .locator('xpath=ancestor::*[.//button[@aria-label="Развернуть"]][1]')
      .getByRole('button', { name: 'Развернуть' })
      .first()
      .click();
  }
  if (s.node) {
    await showTree(p);
    await treeOf(p).getByText(s.node, { exact: true }).first().click();
    await p.getByRole('heading', { level: 2, name: s.node }).waitFor();
  }
  if (s.version) {
    await p
      .getByRole('button', { name: new RegExp(`^${s.version}\\b`) })
      .first()
      .click();
    await p.getByText(/^Вы смотрите версию/).waitFor();
    // Нажатие на версию внизу прокручивает экран, а баннер сверху сдвигает якорь прокрутки по-разному на сторонах —
    // снимок с начала страницы (баннер старой версии в кадре).
    await p.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
        if (el.scrollTop > 0) el.scrollTop = 0;
      }
      window.scrollTo(0, 0);
    });
  }
  if (s.edit) {
    await p.getByRole('button', { name: 'Править', exact: true }).click();
    await p.getByRole('button', { name: /^Опубликовать v/ }).waitFor();
  }
  if (s.archive) {
    const done = p.getByText('Перенесено в архив').first();
    await p.getByRole('button', { name: 'Действия со страницей' }).click();
    await p
      .getByRole('menuitem', { name: 'В архив' })
      .or(p.getByRole('button', { name: 'В архив', exact: true }))
      .first()
      .click();
    await done.waitFor();
    // Тосты оболочки и эталона расположены по-разному — снимок после того, как тост ушёл.
    await done.waitFor({ state: 'hidden', timeout: 15_000 });
  }
  if (s.tab) {
    await p
      .getByRole('navigation', { name: 'Разделы пространства' })
      .getByRole('button', { name: s.tab })
      .click();
  }
  if (s.tab === 'Участники и доступ') await p.getByText('Карта доступа', { exact: true }).waitFor();
  if (s.tab === 'Автоматизация') {
    await p.getByText('Новая версия регламента → попросить ознакомиться заново').waitFor();
    await p.getByText('24.09 18:10').waitFor();
  }
  if (s.tab === 'Архив') {
    await (
      s.archive
        ? p.getByRole('button', { name: 'Восстановить', exact: true }).first()
        : p.getByText('В архиве ничего нет')
    ).waitFor();
  }
  if (s.access) {
    await p.getByRole('button', { name: 'Доступ', exact: true }).first().click();
    await p.getByRole('dialog').waitFor();
  }
  await p.waitForTimeout(400);
}

/**
 * Id «Альты» из /me/context: сразу после входа запрос страницы может уйти мимо service worker MSW в прокси Vite
 * (ECONNREFUSED) — ждём управляющий worker и повторяем до ответа 200.
 */
async function altaId(page: Page): Promise<string> {
  await page
    .waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 15_000 })
    .catch(() => undefined);
  for (let i = 0; i < 10; i++) {
    const r = await call(page, 'GET', '/api/v1/me/context').catch(() => null);
    const tenants = (r?.status === 200 ? r.body : null) as {
      tenants?: { tenantId: string; name: string }[];
    } | null;
    const id = tenants?.tenants?.find((t) => t.name === 'Альта Групп')?.tenantId;
    if (id) return id;
    await page.waitForTimeout(500);
  }
  throw new Error('нет ответа /me/context с «Альта Групп»');
}

async function openBoth(
  app: App,
  page: Page,
  reference: Reference,
  s: Steps = {},
  persona: Persona = 'owner',
) {
  const ref = await reference(undefined, { persona, hidePanel: true });
  await openOnReference(ref.page);
  await act(ref.page, s);
  await app('/', { persona });
  const alta = await altaId(page);
  await app(`/t/${alta}/knowledge`, { persona });
  await page.getByRole('heading', { level: 1, name: 'База знаний' }).waitFor();
  await page.locator('.ox-kb-card').first().waitFor();
  await act(page, s);
  if (phone(page)) {
    // Цели нажатия 44 px на телефоне (PD-28, Q-W4.32-8) — те же размеры эталону: зазор рядов панели страницы 10 px,
    // поля ввода и выбора, узлы шаблона, версии, крошки пути — 44 px, ячейки карты доступа — 36 px.
    await ref.page.evaluate(() => {
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>('div[style*="padding: 10px 20px"]'),
      )) {
        el.style.rowGap = '10px';
      }
    });
    await ref.page.addStyleTag({ content: PHONE_PARITY });
  }
  await sameAudience(ref.page);
  await sameAudience(page);
  // Под нагрузкой соседних прогонов сеть может не затихнуть — данные уже на экране (шаги ждут заголовки).
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await ref.page.evaluate(() => document.fonts.ready.then(() => undefined));
  return ref;
}

const masksOf = (p: Page): Locator[] => [...CHROME, UPDATED].map((s) => p.locator(s));

async function pixels(
  page: Page,
  ref: { page: Page; root: Locator },
  key: string,
  testInfo: Parameters<Parameters<typeof test>[2]>[1],
) {
  const impl = { kind: 'app' as const, page, root: page.locator('#app'), url: page.url() };
  return compareShots(
    { target: impl, mask: masksOf(page) },
    {
      target: { kind: 'reference', page: ref.page, root: ref.root, url: ref.page.url() },
      mask: masksOf(ref.page),
    },
    `${key}-${testInfo.project.name}`,
    testInfo,
  );
}

const CASES: [string, Steps, Persona?][] = [
  ['knowledge-spaces', {}],
  ['knowledge-space', { space: 'Логистика' }],
  ['knowledge-table', { space: 'Логистика', node: 'Журнал осмотров машин' }],
  ['knowledge-diagram', { space: 'Логистика', node: 'Схема сдачи смены' }],
  [
    'knowledge-oldver',
    { space: 'Логистика', expand: 'Регламенты', node: 'Регламент приёмки смены', version: 'v1' },
  ],
  [
    'knowledge-editor',
    { space: 'Логистика', expand: 'Регламенты', node: 'Регламент приёмки смены', edit: true },
  ],
  [
    'knowledge-driver',
    { space: 'Логистика', expand: 'Регламенты', node: 'Регламент приёмки смены' },
    'driver',
  ],
  ['knowledge-automation', { space: 'Логистика', tab: 'Автоматизация' }],
  ['knowledge-archive', { space: 'Логистика', tab: 'Архив' }],
  [
    'knowledge-archive-items',
    { space: 'Логистика', node: 'Схема сдачи смены', archive: true, tab: 'Архив' },
  ],
  ['modal-kb-space', { newSpace: true }],
  ['modal-kb-access', { space: 'Логистика', node: 'Тарифы и начисления', access: true }],
];

for (const [key, steps, persona] of CASES) {
  test(`${key}: ${persona ?? 'owner'} «Альты» в допуске 0,01 @mock`, async ({
    app,
    page,
    reference,
    harness,
  }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
    test.setTimeout(120_000);
    const ref = await openBoth(app, page, reference, steps, persona);
    const r = await pixels(page, ref, key, testInfo);
    console.log(`visual ${key} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });
}

test('knowledge-people: карта доступа и «Почему так» в допуске 0,01 (390, 768) @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  // 1440: панель «Почему так» уже — варианты сотрудников без должности (Q-W4.32-3, allowlist .ox-kb-why).
  test.skip(testInfo.project.name === 'desktop-1440', 'Q-W4.32-3: ширина «Почему так» на 1440');
  test.setTimeout(120_000);
  const ref = await openBoth(app, page, reference, {
    space: 'Логистика',
    tab: 'Участники и доступ',
  });
  // Карточки ролей (KB-02: у эталона есть «Автор») скрыты на обеих сторонах; карта и «Почему так» — в начале экрана.
  for (const p of [page, ref.page]) {
    await p.evaluate(() => {
      const lead = Array.from(document.querySelectorAll('strong')).find(
        (s) => s.textContent === 'Руководитель пространства',
      );
      const grid = lead?.closest('div')?.parentElement;
      if (grid) grid.style.display = 'none';
      const why = document.querySelector('aside[aria-label="Почему так"]');
      why?.parentElement?.scrollIntoView({ block: 'start' });
    });
    await p.waitForTimeout(300);
  }
  const r = await pixels(page, ref, 'knowledge-people', testInfo);
  console.log(`visual knowledge-people ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});

test('knowledge: подписи совпадают с эталоном — список, «Обзор», «Автоматизация», «Доступ» @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  test.setTimeout(120_000);
  for (const steps of [{}, { space: 'Логистика' }, { space: 'Логистика', tab: 'Автоматизация' }]) {
    const ref = await openBoth(app, page, reference, steps);
    const area = (p: Page) => p.locator('#ox-main, main').first();
    // Строка «Обновлено: …» карточек — данные сервера (allowlist .ox-kb-card-upd, Q-W4.32-1): без неё на обеих сторонах.
    for (const p of [page, ref.page]) {
      await p.evaluate((sel) => {
        for (const el of Array.from(document.querySelectorAll(sel))) el.remove();
      }, UPDATED);
    }
    const expected = await labelsOf([area(ref.page)], 'knowledge');
    const actual = await labelsOf([area(page)], 'knowledge');
    expect(actual).toEqual(expected);
    await ref.page.context().close();
  }
});

test('knowledge: «Участники и доступ» руководителя — подписи с отличиями KB-02 @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'структурная сверка mock-визуала');
  test.setTimeout(120_000);
  const ref = await openBoth(app, page, reference, {
    space: 'Логистика',
    tab: 'Участники и доступ',
  });
  const area = (p: Page) => p.locator('#ox-main, main').first();
  const expected = await labelsOf([area(ref.page)], 'knowledge');
  const actual = await labelsOf([area(page)], 'knowledge');
  expect(actual).toEqual(expected);
});
