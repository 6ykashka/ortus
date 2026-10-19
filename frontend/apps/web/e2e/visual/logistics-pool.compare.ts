// W2.23 · Помощник сверки «Ресурсного пула» и диалога «Запросить водителя» с эталоном design-stage-2: на эталоне
// «Логистика» изначально не подключена — владелец подключает её в «Модули и место» (шаг 1 «Пути проверки»).
import type { Page } from '@playwright/test';

import { openOnReference } from './modules.compare.ts';

/** Эталон: «Модули и место» → «Логистика» → «Подключить», тост подключения закрывается до сверки. */
export async function connectLogisticsOnReference(page: Page): Promise<void> {
  await openOnReference(page, 'Модули и место', 'Модули');
  await page
    .locator('article')
    .filter({ has: page.getByRole('heading', { level: 3, name: 'Логистика' }) })
    .getByRole('button', { name: 'Подключить' })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Подключить', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByText('Модуль «Логистика» подключён').waitFor({ state: 'detached' });
}
