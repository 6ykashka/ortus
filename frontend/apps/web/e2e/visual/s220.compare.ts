// W2.73 · Сверка экранов S2-20 «Машина для временного водителя» с макетами «Временный водитель - варианты.dc.html»
// (снимок design-2026-10-19b, 1a–1g): эталон — холст вариантов (без демо-панели), состояние макета — tweaks
// `data-props` (:499) через `__dcSetProps` корня; предмет сверки — блок макета (`[id="1a"] [role=dialog]`, `[id="1b"] article`…).
import type { Target } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

export const S220_FILE = 'Временный водитель - варианты.dc.html';

export interface S220Props {
  vehicleMode?: 'Наша + можно свою' | 'Только наша' | 'Своя машина водителя';
  homeCarFits?: boolean;
  homeDecision?: 'Водитель и машина' | 'Только водитель';
}

/** Tweaks макета (переопределение props корня, как панель Tweaks Claude Design). */
export async function setProps(page: Page, props: S220Props): Promise<void> {
  await page.evaluate((p) => {
    const w = window as unknown as {
      __dcSetProps: (name: string, o: Record<string, unknown>) => void;
      __dcRootName: () => string;
    };
    w.__dcSetProps(w.__dcRootName(), p as Record<string, unknown>);
  }, props);
  // Перерисовка корня — следующий кадр.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

/** Цель сверки — блок макета или реализации вместо корня страницы. */
export const part = (t: Target, root: Locator): Target => ({ ...t, root });
