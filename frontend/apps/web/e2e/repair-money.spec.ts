// W6.24 · e2e вкладок объекта «Ремонт и стройка» (эталон design-2026-10-19, «Ремонт и стройка.dc.html»):
// repair-docs :513–529, repair-finance :547–558, repair-pay :560–575, repair-subs :577–588, repair-client :590–611.
// Режим mock — сценарный сервер (пресет repairs-ready, кв. 42 «Альты»), 390 и 1440. Режим stand — @stand (W2.103): backend
// W6.11–W6.15 в main. Хост `?object=&tab=` — временный `routes/repair/repair.page.tsx` (замена — W6.20).
import { expect, test } from './_stand/fixtures.ts';
import type { Session, Undo } from './_stand/fixtures.ts';
import { hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import {
  goTab,
  type MoneyTab,
  openMoney,
  section,
  signAct,
  signHandover,
} from './repair-money.helpers.ts';
import {
  agreementSent,
  contractedObject,
  grantForeman,
  requestSignature,
  type StandObject,
} from './repair.stand.ts';
import { devScenario, tenantId } from './shell.helpers.ts';

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

// Стенд: backend документов, финансов, оплаты бригады, подрядчиков и кабинета заказчика W6.15 в main. Объект с
// согласованной сметой — командами API (repair.stand.ts); допсоглашение отправляется командой — оно единственный документ,
// который backend создаёт сам (договор, акты и счета в main не создаются, поэтому начисления бригаде и выплата на стенде
// недостижимы — см. отчёт); код подписи уходит через порт SMS без провайдера, подписать на стенде нельзя.
test.describe('repair-money — вкладки денег объекта @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(180_000);

  /** Свой объект с согласованной сметой на вкладке `tab`; `agreement` — допсоглашение № 1 отправлено заказчику. */
  async function openStandMoney(
    app: Parameters<typeof openPage>[0],
    page: Page,
    project: string,
    tab: MoneyTab,
    o: { agreement?: boolean; persona?: 'owner' | 'foreman'; fx?: Fx } = {},
  ): Promise<StandObject> {
    await app('/', { persona: 'owner' });
    const tenant = await tenantId(page);
    const obj = await contractedObject(page, tenant, project);
    if (o.agreement) await agreementSent(page, obj);
    const persona = o.persona ?? 'owner';
    if (persona === 'foreman' && o.fx) {
      const owner = await o.fx.session();
      await owner.open('/', 'owner');
      await grantForeman(owner.page, obj, o.fx.undo);
    }
    await app(`/t/${tenant}/repair?obj=${obj.id}&tab=${tab}`, { persona });
    await expect(page.getByRole('tab').first()).toBeVisible({ timeout: 30_000 });
    return obj;
  }

  type Fx = { undo: Undo; session: () => Promise<Session> };

  test('владелец на стенде: «Документы» — заголовок, пояснение, допсоглашение; запрос подписи → «Ждёт подписи заказчика»', async ({
    app,
    page,
  }, testInfo) => {
    const obj = await openStandMoney(app, page, testInfo.project.name, 'docs', { agreement: true });
    const docs = section(page, 'Документы');
    await expect(docs.getByRole('heading', { level: 2, name: 'Документы' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(docs).toContainText(
      'Договор, акты и счета собираются из сметы по шаблонам. Заказчик подписывает в кабинете кодом из SMS.',
    );
    const rows = docs.getByRole('list', { name: 'Документы объекта' }).getByRole('listitem');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Допсоглашение № 1');
    // Допсоглашение создано отправкой версии сметы: подписи ещё не запрашивали, этап не закрыт.
    await expect(rows.first()).toContainText('Этап не закрыт');
    await expect(rows.first().getByRole('button')).toHaveCount(0);
    await expect(docs).toContainText('Её юридическую силу нужно закрепить в договоре с заказчиком');
    await expect(page.getByRole('button', { name: /Демо/ })).toHaveCount(0);
    // Код подписи запрашивает владелец (requestDocumentSignature): документ ждёт подписи заказчика.
    await requestSignature(page, obj);
    await page.reload();
    await expect(section(page, 'Документы').getByRole('listitem').first()).toContainText(
      'Ждёт подписи заказчика',
      { timeout: 30_000 },
    );
  });

  test('владелец на стенде: «Документы» до допсоглашения — «Документов пока нет»', async ({
    app,
    page,
  }, testInfo) => {
    await openStandMoney(app, page, testInfo.project.name, 'docs');
    const docs = section(page, 'Документы');
    await expect(docs.getByRole('heading', { level: 2, name: 'Документы' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(docs).toContainText('Документов пока нет');
    await expect(page.getByRole('button', { name: 'Сдать объект' })).toHaveCount(0);
  });

  test('прораб на стенде: документы без сумм и без кнопок действий; вкладка одна', async ({
    app,
    page,
    undo,
    session,
  }, testInfo) => {
    await openStandMoney(app, page, testInfo.project.name, 'docs', {
      agreement: true,
      persona: 'foreman',
      fx: { undo, session },
    });
    await expect(page.getByRole('tab', { name: /^Документы/ })).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('tab', { name: /^(Финансы|Оплата бригады|Подрядчики|Кабинет заказчика)/ }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Отправить на подпись/ })).toHaveCount(0);
    await expect(section(page, 'Документы')).not.toContainText('₽');
  });

  test('владелец на стенде: «Финансы объекта» — четыре карточки по смете и пустое «Движение денег»', async ({
    app,
    page,
  }, testInfo) => {
    await openStandMoney(app, page, testInfo.project.name, 'finance');
    const fin = section(page, 'Финансы объекта');
    await expect(fin.getByRole('heading', { level: 2, name: 'Финансы объекта' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(fin).toContainText(
      'Видят владелец и роли с правом «Финансы объектов». Прорабу, бригаде и подрядчикам раздел недоступен.',
    );
    const cards = fin.getByRole('list', { name: 'Показатели объекта' }).getByRole('listitem');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toContainText('Договор');
    await expect(cards.nth(0)).toContainText(/\d[\d\s]*₽/);
    await expect(cards.nth(0)).toContainText('по смете версии 1');
    await expect(cards.nth(1)).toContainText('Получено от заказчика');
    await expect(cards.nth(2)).toContainText('материалы, бригада, подрядчик');
    await expect(cards.nth(3)).toContainText('Маржа');
    await expect(cards.nth(3)).toContainText('100% · факт после закрытия');
    await expect(fin).toContainText('Движений денег пока нет');
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('прораб на стенде: вкладки «Финансы» нет', async ({
    app,
    page,
    undo,
    session,
  }, testInfo) => {
    await openStandMoney(app, page, testInfo.project.name, 'finance', {
      persona: 'foreman',
      fx: { undo, session },
    });
    await expect(page.getByRole('tab', { name: /^Замер/ })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: /^Финансы/ })).toHaveCount(0);
    await expect(page.getByText('Движение денег')).toHaveCount(0);
  });

  test('владелец на стенде: «Оплата бригады» — пояснение и пустое состояние до закрытых актов', async ({
    app,
    page,
  }, testInfo) => {
    await openStandMoney(app, page, testInfo.project.name, 'pay');
    const pay = section(page, 'Оплата бригады');
    await expect(pay.getByRole('heading', { level: 2, name: 'Оплата бригады' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(pay).toContainText(
      'Выплата проходит через кассу, самозанятым нужен чек из «Мой налог».',
    );
    await expect(pay).toContainText('Начислений пока нет');
    await expect(page.getByRole('button', { name: /Начислить|Провести выплату/ })).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('владелец на стенде: «Подрядчики» — пояснение и «Подрядчиков пока нет»', async ({
    app,
    page,
  }, testInfo) => {
    await openStandMoney(app, page, testInfo.project.name, 'subs');
    const subs = section(page, 'Подрядчики');
    await expect(subs.getByRole('heading', { level: 2, name: 'Подрядчики' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(subs).toContainText('Подрядчик получает временный доступ только к своему объекту');
    await expect(subs).toContainText('Подрядчиков пока нет');
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('владелец на стенде: «Кабинет заказчика» — ссылка, превью; «Отозвать ссылку» → «Выпустить новую ссылку»', async ({
    app,
    page,
  }, testInfo) => {
    await openStandMoney(app, page, testInfo.project.name, 'client');
    const cl = section(page, 'Кабинет заказчика');
    await expect(cl.getByRole('heading', { level: 2, name: 'Кабинет заказчика' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      cl.getByText(
        /^Ссылка отправлена Ольге Смирновой по SMS \d\d\.\d\d и действует до сдачи объекта\.$/,
      ),
    ).toBeVisible();
    const preview = cl.getByRole('group', { name: 'Так заказчик видит кабинет' });
    await expect(preview).toContainText('Альта Групп · ремонт');
    await expect(preview).toContainText(/Здравствуйте, Ольга! Готовность \d+%/);
    await expect(preview).toContainText(/Оплачено\s*0 ₽ из \d[\d\s]*₽/);
    await expect(preview.getByRole('button')).toHaveCount(0);
    expect((await preview.boundingBox())?.width ?? 0).toBeLessThanOrEqual(421);
    await cl.getByRole('button', { name: 'Отозвать ссылку' }).click();
    await expect(toast(page)).toHaveText('Ссылка отозвана', { timeout: 20_000 });
    await expect(
      cl.getByText('Ссылка отозвана: по старой ссылке кабинет не открывается.'),
    ).toBeVisible();
    await expect(preview).toHaveCount(0);
    await cl.getByRole('button', { name: 'Выпустить новую ссылку' }).click();
    await expect(toast(page)).toHaveText('Новая ссылка выпущена', { timeout: 20_000 });
    await expect(cl.getByText(/^https?:\/\/\S+\/c\/\S+/)).toBeVisible();
    await expect(cl.getByRole('button', { name: 'Скопировать' })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  for (const [tab, title] of [
    ['docs', 'Документы'],
    ['finance', 'Финансы объекта'],
    ['pay', 'Оплата бригады'],
    ['subs', 'Подрядчики'],
    ['client', 'Кабинет заказчика'],
  ] as const) {
    test(`владелец на стенде: ${tab} — axe serious/critical 0, без горизонтальной прокрутки, цели ≥ 44 px на 390`, async ({
      app,
      page,
      axe,
    }, testInfo) => {
      await openStandMoney(app, page, testInfo.project.name, tab, { agreement: tab === 'docs' });
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible({
        timeout: 30_000,
      });
      await page.waitForLoadState('networkidle');
      expect(await noHorizontalScroll(page)).toBe(true);
      const bad = (await axe(page)).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' | ')).join(' | ')}`);
      expect(bad).toEqual([]);
    });
  }
});
