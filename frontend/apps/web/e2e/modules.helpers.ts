// W1.24 · Помощники e2e страниц «Модули и место», «Хранилище», «Файлы»: вход персонажа и переход на страницу
// своей организации по прямому URL (ADR-0001), пресеты сценарного сервера (только mock), тост и диалог.
import type { Persona } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { ALTA, devScenario, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

/** Вход персонажа, затем страница `segment` организации `name` по прямому URL; возвращает id организации. */
export async function openPage(
  app: AppFn,
  page: Page,
  segment: string,
  o: { persona?: Persona; tenant?: string; preset?: string } = {},
): Promise<string> {
  const persona = o.persona ?? 'owner';
  await app('/', { persona });
  const id = await tenantId(page, o.tenant ?? ALTA);
  if (o.preset) await devScenario(page, { preset: o.preset });
  await app(`/t/${id}/${segment}`, { persona });
  return id;
}

export const h1 = (page: Page, name: string): Locator =>
  page.getByRole('heading', { level: 1, name });

export const toast = (page: Page): Locator => page.locator('.ox-toast .ox-toast-text');

export const dialog = (page: Page): Locator => page.getByRole('dialog');

/** Карточка отраслевого модуля по заголовку `h3`. */
export const moduleCard = (page: Page, name: string): Locator =>
  page.locator('article').filter({ has: page.getByRole('heading', { level: 3, name }) });

/**
 * Высота области нажатия цели по вертикали через её центр: сколько точек (шаг 1 px) от верха до низа с запасом
 * 30 px попадает в саму цель (`elementFromPoint` → цель или её потомок). Видимая высота кнопки эталона может
 * быть 36/40 px (PD-28), область нажатия на телефоне — не меньше 44 px (verification-protocol §1 п. 3).
 * Меряет после загрузки шрифтов (W2.81, harness H12): пока шрифт иконок грузится, лигатура раскладывается
 * запасным шрифтом, шире кнопки-иконки, и перекрывает центр соседней цели.
 */
export async function hitHeight(target: Locator): Promise<number> {
  return target.evaluate(async (el) => {
    el.scrollIntoView({ block: 'center' });
    await document.fonts.ready;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    let n = 0;
    for (let y = Math.floor(r.top) - 30; y <= Math.ceil(r.bottom) + 30; y++) {
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === el || el.contains(hit))) n++;
    }
    return n;
  });
}

/** Нет горизонтальной прокрутки страницы. */
export async function noHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const main = document.querySelector('#ox-main');
    const doc = document.scrollingElement;
    const fits = (el: Element | null) => !el || el.scrollWidth <= el.clientWidth + 1;
    return fits(main) && fits(doc);
  });
}
