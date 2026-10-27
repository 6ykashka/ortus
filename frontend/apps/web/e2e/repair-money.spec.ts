// W6.24 · e2e вкладок объекта «Ремонт и стройка» (эталон design-2026-10-19, «Ремонт и стройка.dc.html»):
// repair-docs :513–529, repair-finance :547–558, repair-pay :560–575, repair-subs :577–588, repair-client :590–611.
// Режим mock — сценарный сервер (пресет repairs-ready, кв. 42 «Альты»), 390 и 1440. Режим stand — @stand-spec: backend
// W6.11–W6.15 ещё не в main. Хост `?object=&tab=` — временный `routes/repair/repair.page.tsx` (замена — W6.20).
import { expect, test } from './_stand/fixtures.ts';
import { hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { goTab, openMoney, section, signAct, signHandover } from './repair-money.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const MOCK = 'пресеты и сценарии — сценарный сервер mock';

test.describe('repair-docs — «Документы» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', MOCK);
  test.describe.configure({ timeout: 90_000 });

  test('заголовок, пояснение, пять документов с чипами, сноска про подпись', async ({
    app,
    page,
  }) => {
    await openMoney(app, page, 'docs');
    const docs = section(page, 'Документы');
    await expect(docs.getByRole('heading', { level: 2, name: 'Документы' })).toBeVisible();
    await expect(docs).toContainText(
      'Договор, акты и счета собираются из сметы по шаблонам. Заказчик подписывает в кабинете кодом из SMS.',
    );
    const rows = docs.getByRole('list', { name: 'Документы объекта' }).getByRole('listitem');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0)).toContainText('Договор подряда № 42');
    await expect(rows.nth(0)).toContainText('Подписан');
    await expect(rows.nth(1)).toContainText('Оплачен 02.10');
    await expect(rows.nth(2)).toContainText('Готов к отправке');
    await expect(rows.nth(3)).toContainText('Этап не закрыт');
    await expect(docs).toContainText('Её юридическую силу нужно закрепить в договоре с заказчиком');
    await expect(page.getByRole('button', { name: /Демо/ })).toHaveCount(0);
  });

  test('«Отправить на подпись» у акта № 1 — чип «Ждёт подписи заказчика»', async ({
    app,
    page,
  }) => {
    await openMoney(app, page, 'docs');
    await page.getByRole('button', { name: 'Отправить на подпись: Акт № 1 · демонтаж' }).click();
    await expect(toast(page)).toHaveText('Акт № 1 · демонтаж отправлен на подпись заказчику');
    const row = page.getByRole('listitem').filter({ hasText: 'Акт № 1 · демонтаж' });
    await expect(row).toContainText('Ждёт подписи заказчика');
    await expect(row).toContainText('Отправлен в кабинет заказчика');
    await expect(row.getByRole('button')).toHaveCount(0);
  });

  test('акт сдачи подписан заказчиком — «Сдать объект» с подтверждением', async ({ app, page }) => {
    const { tenant, project } = await openMoney(app, page, 'docs');
    await expect(page.getByRole('button', { name: 'Сдать объект' })).toHaveCount(0);
    await signHandover(page, tenant, project);
    await goTab(page, 'Подрядчики');
    await expect(section(page, 'Подрядчики')).toBeVisible();
    await goTab(page, 'Документы');
    await page.getByRole('button', { name: 'Сдать объект' }).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('heading', { name: 'Сдать объект заказчику?' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Сдать объект' }).click();
    await expect(toast(page)).toHaveText('Объект сдан заказчику');
    await expect(page.getByRole('button', { name: 'Сдать объект' })).toHaveCount(0);
    await expect(page.getByText(/Гарантия до \d\d\.\d\d\.\d{4}\./)).toBeVisible();
  });

  test('прораб: документы без сумм и без кнопок действий; вкладка одна', async ({ app, page }) => {
    await openMoney(app, page, 'docs', { persona: 'foreman' });
    await expect(
      page.getByRole('tab', { name: /^(Финансы|Оплата бригады|Подрядчики|Кабинет заказчика)/ }),
    ).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /^Документы/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Отправить на подпись/ })).toHaveCount(0);
    await expect(section(page, 'Документы')).not.toContainText('₽');
  });

  test('390 и 1440: без горизонтальной прокрутки, цели нажатия не меньше 44 px', async ({
    app,
    page,
  }) => {
    await openMoney(app, page, 'docs');
    await expect(section(page, 'Документы').getByRole('listitem')).toHaveCount(5);
    expect(await noHorizontalScroll(page)).toBe(true);
    const send = page.getByRole('button', { name: 'Отправить на подпись: Акт № 1 · демонтаж' });
    expect(await hitHeight(send)).toBeGreaterThanOrEqual(44);
  });

  test('axe: нет серьёзных нарушений', async ({ app, page, axe }) => {
    await openMoney(app, page, 'docs');
    await expect(section(page, 'Документы').getByRole('listitem')).toHaveCount(5);
    const result = await axe(page);
    expect({ serious: result.serious, critical: result.critical }).toEqual({
      serious: 0,
      critical: 0,
    });
  });
});

test.describe('repair-finance — «Финансы объекта» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', MOCK);
  test.describe.configure({ timeout: 90_000 });

  test('четыре карточки и «Движение денег»', async ({ app, page }) => {
    await openMoney(app, page, 'finance');
    const fin = section(page, 'Финансы объекта');
    await expect(fin.getByRole('heading', { level: 2, name: 'Финансы объекта' })).toBeVisible();
    await expect(fin).toContainText(
      'Видят владелец и роли с правом «Финансы объектов». Прорабу, бригаде и подрядчикам раздел недоступен.',
    );
    const cards = fin.getByRole('list', { name: 'Показатели объекта' }).getByRole('listitem');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toContainText('Договор');
    await expect(cards.nth(0)).toContainText('438 175 ₽');
    await expect(cards.nth(0)).toContainText('по смете версии 2');
    await expect(cards.nth(1)).toContainText('131 453 ₽');
    await expect(cards.nth(1)).toContainText('аванс 30%');
    await expect(cards.nth(2)).toContainText('материалы, бригада, подрядчик');
    await expect(cards.nth(3)).toContainText('118 307 ₽');
    await expect(cards.nth(3)).toContainText('27% · факт после закрытия');
    const rows = fin.getByRole('list', { name: 'Движение денег' }).getByRole('listitem');
    await expect(rows.first()).toContainText('02.10');
    await expect(rows.first()).toContainText('+131 453 ₽');
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('прораб: вкладки «Финансы» нет, прямой вход — карточка без сумм', async ({ app, page }) => {
    await openMoney(app, page, 'finance', { persona: 'foreman' });
    await expect(page.getByRole('tab', { name: /^Финансы/ })).toHaveCount(0);
    await expect(page.getByText('Движение денег')).toHaveCount(0);
  });

  test('ошибка загрузки: баннер и «Повторить» возвращают данные', async ({ app, page }) => {
    await openMoney(app, page, 'docs');
    await devScenario(page, { scenario: 'getProjectFinance=rate_limited' });
    await goTab(page, 'Финансы');
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Движение денег').first()).toBeVisible();
  });
});

test.describe('repair-pay — «Оплата бригады» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', MOCK);
  test.describe.configure({ timeout: 90_000 });

  test('таблица: исполнители «Ждёт закрытия акта», подсказка про акт № 1', async ({
    app,
    page,
  }) => {
    await openMoney(app, page, 'pay');
    const pay = section(page, 'Оплата бригады');
    await expect(pay.getByRole('heading', { level: 2, name: 'Оплата бригады' })).toBeVisible();
    await expect(pay).toContainText(
      'Выплата проходит через кассу, самозанятым нужен чек из «Мой налог».',
    );
    const table = pay.getByRole('table', { name: 'Начисления бригаде' });
    await expect(table.getByRole('columnheader')).toHaveText([
      'Исполнитель',
      'Работы по акту',
      'Сумма',
      'Статус',
    ]);
    await expect(table.getByRole('row')).toHaveCount(4);
    await expect(table.getByText('Ждёт закрытия акта')).toHaveCount(3);
    await expect(
      pay.getByText(
        'Начисление откроется после подписания акта № 1 заказчиком (раздел «Документы»).',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Начислить|Провести выплату/ })).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('акт подписан → «Начислить по акту № 1» → «Начислено» → выплата через кассу', async ({
    app,
    page,
  }) => {
    const { tenant, project } = await openMoney(app, page, 'pay');
    await signAct(page, tenant, project, 1);
    await goTab(page, 'Документы');
    await expect(section(page, 'Документы')).toBeVisible();
    await goTab(page, 'Оплата бригады');
    await page.getByRole('button', { name: 'Начислить по акту № 1' }).click();
    await expect(toast(page)).toHaveText('Начислено по акту № 1');
    const pay = section(page, 'Оплата бригады');
    await expect(pay.getByRole('row').filter({ hasText: 'Начислено' })).toHaveCount(3);
    await page.getByRole('button', { name: 'Провести выплату через кассу' }).click();
    await expect(toast(page)).toHaveText('Выплата передана в кассу');
    await expect(pay.getByText('Ждёт проведения в кассе')).toHaveCount(3);
    await expect(pay.getByText('Выплаты проведены, операции появились в кассе.')).toBeVisible();
  });
});

test.describe('repair-money — axe всех пяти вкладок @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', MOCK);
  test.describe.configure({ timeout: 90_000 });

  const TABS = [
    ['docs', 'Документы'],
    ['finance', 'Финансы объекта'],
    ['pay', 'Оплата бригады'],
    ['subs', 'Подрядчики'],
    ['client', 'Кабинет заказчика'],
  ] as const;

  for (const [tab, title] of TABS) {
    test(`${tab}: axe serious/critical 0, без горизонтальной прокрутки страницы`, async ({
      app,
      page,
      axe,
    }) => {
      await openMoney(app, page, tab);
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
      await page.waitForLoadState('networkidle');
      expect(await noHorizontalScroll(page)).toBe(true);
      const result = await axe(page);
      const bad = result.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
      expect(bad).toEqual([]);
    });
  }
});

test.describe('repair-subs — «Подрядчики» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', MOCK);
  test.describe.configure({ timeout: 90_000 });

  test('карточка подрядчика; «Закрыть доступ» и «Открыть доступ до …»', async ({ app, page }) => {
    await openMoney(app, page, 'subs');
    const subs = section(page, 'Подрядчики');
    await expect(subs.getByRole('heading', { level: 2, name: 'Подрядчики' })).toBeVisible();
    const card = subs.getByRole('listitem').filter({ hasText: 'ООО «ЭлектроПрофи»' });
    await expect(card).toContainText('Электромонтаж: 38 точек, щиток');
    await expect(card).toContainText('Доступ к объекту до 31.10: отметки, фото, акты');
    await expect(card).toContainText('Договор: 45 600 ₽');
    await expect(card).toContainText('Оплачено 20 000 ₽');
    await card.getByRole('button', { name: 'Закрыть доступ' }).click();
    await expect(toast(page)).toHaveText('Доступ подрядчика закрыт');
    await expect(card).toContainText('Доступ закрыт');
    await card.getByRole('button', { name: /^Открыть доступ до \d\d\.\d\d$/ }).click();
    await expect(toast(page)).toHaveText('Доступ подрядчика открыт');
    await expect(card).toContainText(/Доступ к объекту до \d\d\.\d\d: отметки, фото, акты/);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

test.describe('repair-client — «Кабинет заказчика» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', MOCK);
  test.describe.configure({ timeout: 90_000 });

  test('ссылка отправлена, превью; «Отозвать ссылку» → «Выпустить новую ссылку»', async ({
    app,
    page,
  }) => {
    await openMoney(app, page, 'client');
    const cl = section(page, 'Кабинет заказчика');
    await expect(cl.getByRole('heading', { level: 2, name: 'Кабинет заказчика' })).toBeVisible();
    await expect(
      cl.getByText('Ссылка отправлена Ольге Смирновой по SMS 01.10 и действует до сдачи объекта.'),
    ).toBeVisible();
    const preview = cl.getByRole('group', { name: 'Так заказчик видит кабинет' });
    await expect(preview).toContainText('Альта Групп · ремонт');
    await expect(preview).toContainText(/Здравствуйте, Ольга! Готовность \d+%/);
    await expect(preview).toContainText('Сдача объекта');
    await expect(preview).toContainText('131 453 ₽ из 438 175 ₽');
    await expect(preview.getByRole('button')).toHaveCount(0);
    expect((await preview.boundingBox())?.width ?? 0).toBeLessThanOrEqual(421);
    await cl.getByRole('button', { name: 'Отозвать ссылку' }).click();
    await expect(toast(page)).toHaveText('Ссылка отозвана');
    await expect(
      cl.getByText('Ссылка отозвана: по старой ссылке кабинет не открывается.'),
    ).toBeVisible();
    await expect(preview).toHaveCount(0);
    await cl.getByRole('button', { name: 'Выпустить новую ссылку' }).click();
    await expect(toast(page)).toHaveText('Новая ссылка выпущена');
    await expect(cl.getByText(/^https:\/\/crm\.ortus\.example\/c\/cab-/)).toBeVisible();
    await expect(cl.getByRole('button', { name: 'Скопировать' })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

test.describe('repair-money — стенд @stand @stand-spec', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  // Backend тега Repairs (W6.11–W6.15) ещё не в main: на стенде операции вкладок отвечают 501/404. Сценарий стенда
  // — те же шаги, что в mock (документы → подпись → начисление → выплата в кассу), после слияния W6.12–W6.15.
  test.fixme('вкладки на стенде: документы, финансы, оплата бригады, подрядчики, кабинет', () => {});
});
