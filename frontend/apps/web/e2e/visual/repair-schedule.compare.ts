// W6.23 · Помощники сверки `repair-schedule` «Карточка объекта · График» со снимком design-2026-10-19
// (verification-protocol.md §3). Эталон: «Ортус CRM.dc.html» → владелец подключает «Ремонт и стройку» в «Модулях и месте»
// → «Объекты» → «ЖК Речной · квартира 42» → вкладка «График» (раздел `h-gantt` модуля «Ремонт и стройка.dc.html» :279–511).
// Реализация: маршрут страницы `/t/:tenant/repair/:project/schedule` (вкладку карточки встроит W6.20), пресет repairs-ready,
// «сегодня» — 20.10.2026 (эталон: константа «Сегодня 20 октября»). Расхождения — allowlist/repair-schedule.md.
import type { Locator, Page } from '@playwright/test';

import { call, devScenario, tenantId } from '../shell.helpers.ts';
import { openOnReference } from './modules.compare.ts';

export const SECTION = 'section[aria-labelledby="h-gantt"]';
export const ASIDE = 'aside[aria-label="Сводка графика и этап"]';
export const OBJ42 = 'ЖК Речной · квартира 42';
const TODAY = '2026-10-20T12:00:00+03:00';

export const section = (page: Page): Locator => page.locator(SECTION);

export const isPhone = (page: Page): boolean => (page.viewportSize()?.width ?? 1440) < 640;

/** Эталон: подключение «Ремонта и стройки», объект «ЖК Речной · квартира 42», вкладка «График». */
export async function openGanttOnReference(page: Page): Promise<void> {
  await openOnReference(page, 'Модули и место', 'Модули');
  await page
    .locator('article')
    .filter({ has: page.getByRole('heading', { level: 3, name: 'Ремонт и стройка' }) })
    .getByRole('button', { name: 'Подключить' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Подключить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await openOnReference(page, 'Объекты');
  await page.getByText(OBJ42).first().click();
  await page.getByRole('tab', { name: 'График' }).click();
  await section(page).getByRole('heading', { level: 2, name: 'График работ' }).waitFor();
  await page.waitForLoadState('networkidle');
}

type AppFn = (route: string, o?: { persona?: 'owner' }) => Promise<unknown>;

/** Реализация: пресет repairs-ready, часы 20.10.2026, страница графика объекта. */
export async function openGanttOnApp(app: AppFn, page: Page): Promise<void> {
  await app('/', { persona: 'owner' });
  const tenant = await tenantId(page);
  await devScenario(page, { preset: 'repairs-ready' });
  await page.clock.setSystemTime(new Date(TODAY));
  await app('/', { persona: 'owner' });
  const r = await call(page, 'GET', `/api/v1/tenants/${tenant}/repairs/projects?limit=100`);
  const id = (r.body as { items: { id: string; name: string }[] }).items.find(
    (x) => x.name === OBJ42,
  )?.id;
  if (!id) throw new Error(`нет объекта «${OBJ42}»`);
  await app(`/t/${tenant}/repair/${id}/schedule`, { persona: 'owner' });
  await section(page).getByRole('heading', { name: 'График работ' }).waitFor();
  await page
    .getByRole('img', { name: /^Демонтаж: / })
    .or(page.getByRole('heading', { level: 3, name: /^Эта неделя/ }))
    .first()
    .waitFor();
  await page.waitForLoadState('networkidle');
}

/**
 * Обе стороны к одному кадру: высота окна — весь график (без внутренней прокрутки), ширина раздела реализации —
 * как у эталона (страница-маршрут шире вкладки карточки), заголовок — уровня вкладки (data-level), фон под разделом
 * белый (фон страницы сверяет ключ `shell`), форма «Новый базовый план» (no-reference) скрыта.
 */
export async function alignBoth(impl: Page, ref: Page): Promise<void> {
  const vp = impl.viewportSize() ?? { width: 1440, height: 900 };
  for (const p of [impl, ref]) await p.setViewportSize({ width: vp.width, height: 2600 });
  const width = (await section(ref).boundingBox())?.width ?? 0;
  await section(impl).evaluate((el, w) => {
    el.style.width = `${w}px`;
    el.style.maxWidth = `${w}px`;
    el.querySelector('#h-gantt')?.setAttribute('data-level', '2');
    el.querySelectorAll<HTMLElement>('.ox-gt-baseline').forEach((b) => (b.style.display = 'none'));
  }, width);
  for (const p of [impl, ref]) {
    await section(p).evaluate((el) => {
      el.style.background = '#fff';
    });
  }
  // На телефоне реализация держит цели нажатия 44 px (PD-28), эталон — 36 px: тот же размер ставится эталону.
  if ((impl.viewportSize()?.width ?? 1440) < 640) {
    await ref.locator('[role="toolbar"] button, [role="toolbar"] label').evaluateAll((els) => {
      for (const e of els) (e as HTMLElement).style.minHeight = '44px';
    });
  }
  await impl.waitForTimeout(600);
  await impl.waitForLoadState('networkidle');
}

/**
 * Данные эталона, которых нет в контракте (allowlist/repair-schedule.md, Q-W6.23-1, Q-W6.23-2): серые линии «по договору»
 * под этапами (в API нет базовых длительностей), «+N дн», деление «принято / на приёмке» полосы идущего этапа и чип
 * «Принято N%, на приёмке M%», значки заявок снабжения. Скрываются (visibility) на обеих сторонах — раскладка не меняется.
 */
export async function hideDataOnly(page: Page): Promise<void> {
  await section(page).evaluate((el) => {
    const hide = (e: Element): void => {
      (e as HTMLElement).style.visibility = 'hidden';
    };
    // Линии «по договору» под этапами: реализация — [data-baseline], эталон — полоса 4 px на top:32px.
    el.querySelectorAll('[data-baseline]').forEach(hide);
    el.querySelectorAll('span').forEach((s) => {
      const st = getComputedStyle(s);
      if (st.position === 'absolute' && st.top === '32px' && st.height === '4px') hide(s);
      // «+N дн» эталона.
      if (st.fontWeight === '600' && /^\s*[+−]\d+ дн$/.test(s.textContent ?? '')) hide(s);
    });
    // Значки снабжения эталона (inventory_2).
    el.querySelectorAll('span[role="img"]').forEach((s) => {
      if (s.textContent === 'inventory_2') hide(s);
    });
    // Полоса идущего этапа: «Электрика · черновая» — деление «принято / на приёмке».
    el.querySelectorAll('[role="img"][aria-label^="Электрика · черновая: "]').forEach(hide);
    // Чип идущего этапа в «Ближайших 3 неделях»: в API нет принятой доли объёма (Q-W6.23-2) — у реализации подпись
    // эталона, чтобы чип занимал то же место (перенос строки чипов зависит от ширины).
    el.querySelectorAll('span').forEach((s) => {
      for (const n of Array.from(s.childNodes)) {
        if (n.nodeType === 3 && (n.textContent ?? '').trim() === 'В работе') {
          n.textContent = 'Принято 53%, на приёмке 8%';
        }
      }
    });
  });
}

/** Нижняя граница основной колонки: диаграмма с легендой или недельные окна («Подготовить заранее» — снабжение, данные). */
async function mainBottom(page: Page): Promise<number> {
  return page.locator(ASIDE).evaluate((el) => {
    const main = (el.previousElementSibling ?? el.parentElement) as HTMLElement;
    const prep = Array.from(main.querySelectorAll('h3')).find(
      (h) => h.textContent === 'Подготовить заранее',
    );
    const card = prep?.parentElement?.parentElement;
    const edge = card ?? main;
    const r = edge.getBoundingClientRect();
    return (card ? r.top - 12 : r.bottom) + window.scrollY;
  });
}

/** Кадр: верх раздела (заголовок, чипы, переключатели) и основная колонка до низа диаграммы / недельных окон. */
export async function shootMain(page: Page): Promise<Buffer> {
  const box = await section(page).boundingBox();
  if (!box) throw new Error('нет раздела графика');
  const bottom = await mainBottom(page);
  // Правая панель сверяется отдельным кадром: здесь она скрыта без смены раскладки.
  await page.locator(ASIDE).evaluate((el) => ((el as HTMLElement).style.visibility = 'hidden'));
  const shot = await page.screenshot({
    clip: { x: box.x, y: box.y, width: box.width, height: bottom - box.y },
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
  await page.locator(ASIDE).evaluate((el) => ((el as HTMLElement).style.visibility = ''));
  return shot;
}

/** Кадр: карточка «Сдача объекта» до абзаца «Последний перенос…» (в нём причина со свободным текстом — Q-W6.23-9). */
export async function shootSummary(page: Page): Promise<Buffer> {
  const card = page
    .locator(ASIDE)
    .getByRole('heading', { level: 3, name: 'Сдача объекта' })
    .locator('xpath=..');
  const box = await card.boundingBox();
  if (!box) throw new Error('нет карточки «Сдача объекта»');
  const cut = await card.evaluate((el) => {
    const p = Array.from(el.querySelectorAll('p, span, div')).find((e) =>
      (e.textContent ?? '').startsWith('Последний перенос'),
    );
    return p ? p.getBoundingClientRect().top + window.scrollY : null;
  });
  const height = (cut ?? box.y + box.height) - box.y;
  // Чип итога (значок 16 px общего Status против 15 px эталона) и перечень критического пути (перенос строк в доли
  // пикселя) скрываются на обеих сторонах — allowlist/repair-schedule.md; тексты сверяет структурная сверка.
  await card.evaluate((el) => {
    el.querySelectorAll('span, div').forEach((s) => {
      const own = Array.from(s.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent ?? '')
        .join('');
      if (/^(Позже|Раньше) договора на|^В срок по договору| → /.test(own.trim())) {
        (s as HTMLElement).style.visibility = 'hidden';
      }
    });
  });
  return page.screenshot({
    clip: { x: box.x, y: box.y, width: box.width, height },
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
}
