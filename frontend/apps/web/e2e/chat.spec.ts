// W7.13 · e2e страницы «Чаты» (ключи chats, chats-policies, modal-chat-new; эталон design-2026-10-19 «Чаты.dc.html»).
// Режим mock — MSW W7.00 на сиде «Альты» (чаты W7.10). Пункты verification-protocol §1.3: меню и URL, состояния,
// клавиатура, axe, 390 / 1440. Режим stand — после W7.11 (backend чатов не в main).
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { dialog, h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const section = (page: Page): Locator => page.locator('section[aria-labelledby="h-chat"]');
const list = (page: Page): Locator =>
  section(page).getByRole('complementary', { name: 'Список чатов' });
const thread = (page: Page): Locator => section(page).getByRole('region', { name: /^Чат · / });
const side = (page: Page): Locator =>
  section(page).getByRole('complementary', { name: 'Сведения о чате' });
const messages = (page: Page): Locator => thread(page).getByRole('article');
const row = (page: Page, title: string): Locator =>
  list(page).getByRole('button', { name: new RegExp(title) });

const DRIVERS = 'Водители · Север Логистик';
const NEWS = 'Альта · новости';
const OBJECT = 'ЖК Речной · квартира 42';

type Persona = 'owner' | 'manager' | 'driver' | 'foreman';

async function open(
  app: Parameters<typeof openPage>[0],
  page: Page,
  o: { persona?: Persona; search?: string; chat?: string } = {},
): Promise<void> {
  await openPage(app, page, `chat${o.search ?? ''}`, { persona: o.persona ?? 'owner' });
  await expect(h1(page, 'Чаты')).toBeVisible({ timeout: 20_000 });
  await expect(list(page)).toBeVisible();
  if (o.chat) await openChat(page, o.chat);
}

/** Открыть чат из списка (на телефоне список заменяется чатом). */
async function openChat(page: Page, title: string): Promise<void> {
  if (phone(page) && (await thread(page).count())) {
    await thread(page).getByRole('button', { name: 'К списку чатов' }).click();
  }
  await row(page, title).click();
  await expect(thread(page)).toContainText(title, { timeout: 15_000 });
}

const message = (page: Page, text: string | RegExp): Locator =>
  messages(page).filter({ hasText: text }).first();

async function menu(page: Page, text: string | RegExp, item: string): Promise<void> {
  const m = message(page, text);
  await m.getByRole('button', { name: 'Действия с сообщением' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test.describe('chat — «Чаты» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и сид — сценарный сервер mock');
  test.setTimeout(90_000);

  test('список владельца: папки со счётчиками, строки чатов, подзаголовок, бейдж меню', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(section(page)).toContainText(
      '7 непрочитанных · 1 ждёт подтверждения · состав и права — из «Пользователей и ролей»',
    );
    const folders = list(page).getByRole('group', { name: 'Папки чатов' });
    await expect(folders.getByRole('button')).toHaveText([
      'Все5',
      'Личные1',
      'Рабочие1',
      'Записи2',
      'Объявления1',
    ]);
    for (const t of [OBJECT, DRIVERS, NEWS, 'Рейс Р-208 · Северный маршрут', 'Алексей Соколов']) {
      await expect(row(page, t)).toBeVisible();
    }
    await expect(row(page, DRIVERS)).toContainText('Подтвердить');
    await expect(row(page, DRIVERS)).toContainText('Критический дефект · М 608 КТ 77');
    await expect(row(page, NEWS)).toContainText('Вы: 4 ноября — выходной');
    await expect(row(page, 'Алексей Соколов')).toContainText(
      'Хорошо, завтра отправлю в чат объекта.',
    );
    if (!phone(page)) {
      await expect(
        page.getByRole('navigation').getByRole('button', { name: /^Чаты/ }).first(),
      ).toContainText('7');
    }
    // Папка и поиск
    await folders.getByRole('button', { name: /^Личные/ }).click();
    await expect(list(page).getByRole('button', { name: /Алексей Соколов/ })).toHaveCount(1);
    await expect(row(page, DRIVERS)).toHaveCount(0);
    await folders.getByRole('button', { name: /^Все/ }).click();
    await list(page).getByRole('searchbox', { name: 'Поиск по чатам' }).fill('Северный маршрут');
    await expect(row(page, 'Рейс Р-208')).toBeVisible();
    await expect(row(page, NEWS)).toHaveCount(0);
    await list(page).getByRole('searchbox', { name: 'Поиск по чатам' }).fill('нет такого');
    await expect(list(page)).toContainText('Ничего не нашлось');
    await expect(
      list(page).getByText('Чаты рейсов и объектов появятся, когда подключите', { exact: false }),
    ).toBeVisible();
  });

  test('чат «Водители»: служебное сообщение, важное с «Ознакомлен», опрос с голосом', async ({
    app,
    page,
  }) => {
    await open(app, page, { chat: DRIVERS });
    await expect(page).toHaveURL(/[?&]chat=/);
    await expect(thread(page)).toContainText('Критический дефект · М 608 КТ 77');
    await expect(thread(page)).toContainText('Выезд заблокирован до решения менеджера');
    await expect(thread(page).getByRole('button', { name: 'Открыть автопарк' })).toBeVisible();
    const important = message(page, 'Регламент приёмки смены обновлён');
    await expect(important).toContainText('Важное · подтвердить до 03.10');
    await expect(important).toContainText('Подтвердите, что прочитали · подтвердили 0 из');
    await important.getByRole('button', { name: 'Ознакомлен' }).click();
    await expect(toast(page)).toHaveText('Подтверждено: «Ознакомлен»');
    await expect(important).toContainText('Вы подтвердили');
    await expect(important.getByRole('button', { name: 'Ознакомлен' })).toHaveCount(0);
    if (await list(page).count()) {
      await expect(row(page, DRIVERS)).not.toContainText('Подтвердить');
      await expect(row(page, DRIVERS).locator('.ox-chat-badge')).toHaveCount(0);
    }
    // Опрос: результаты видны модератору сразу, голос меняет выбор
    const poll = message(page, 'Кто может выйти в субботу 04.10 на рейс Р-215?');
    await expect(poll).toContainText('Открытый · один вариант · закроется 03.10 в 18:00');
    await expect(poll).toContainText('Не проголосовали: ');
    await poll.getByRole('button', { name: /Могу утром/ }).click();
    await expect(poll.getByRole('button', { name: /Могу утром/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(poll).toContainText('1 · 100 %');
    await poll.getByRole('button', { name: 'Закрыть опрос' }).click();
    await expect(toast(page)).toHaveText('Опрос закрыт');
    await expect(poll).toContainText('закрыт');
  });

  test('отправка, правка и удаление своего сообщения; «Enter — отправить»', async ({
    app,
    page,
  }) => {
    await open(app, page, { chat: NEWS });
    const box = thread(page).getByRole('textbox', { name: 'Сообщение' });
    await expect(box).toHaveAttribute(
      'placeholder',
      'Сообщение · Enter — отправить, Shift+Enter — новая строка',
    );
    await box.fill('Тест: склад закрыт в пятницу');
    await box.press('Enter');
    const mine = message(page, 'Тест: склад закрыт в пятницу');
    await expect(mine).toBeVisible();
    await expect(mine).toContainText('Вы');
    await expect(box).toHaveValue('');
    // На узкой раскладке список скрыт, пока открыт чат.
    if (await list(page).count()) {
      await expect(row(page, NEWS)).toContainText('Вы: Тест: склад закрыт в пятницу');
    }
    // Правка в окне политики
    await menu(page, 'Тест: склад закрыт', 'Править');
    await expect(thread(page)).toContainText('Правка сообщения · окно');
    await expect(box).toHaveValue('Тест: склад закрыт в пятницу');
    await box.fill('Тест: склад открыт в пятницу');
    await box.press('Enter');
    await expect(message(page, 'Тест: склад открыт в пятницу')).toBeVisible();
    await message(page, 'Тест: склад открыт').getByRole('button', { name: 'изменено' }).click();
    await expect(message(page, 'Тест: склад открыт')).toContainText('История правок');
    await expect(message(page, 'Тест: склад открыт')).toContainText('Тест: склад закрыт в пятницу');
    // Удаление автором — метка вместо текста
    await menu(page, 'Тест: склад открыт', 'Удалить у всех');
    await expect(toast(page)).toHaveText('Сообщение удалено');
    await expect(thread(page)).toContainText('Удалено автором');
    await expect(thread(page)).not.toContainText('Тест: склад открыт в пятницу');
  });

  test('опрос из поля ввода: вопрос, варианты, анонимность, срок', async ({ app, page }) => {
    await open(app, page, { chat: DRIVERS });
    const t = thread(page);
    await t.getByRole('button', { name: 'Опрос', exact: true }).click();
    await t.getByRole('textbox', { name: 'Вопрос опроса' }).fill('Где обедаем?');
    await t.getByRole('textbox', { name: 'Вариант 1' }).fill('Столовая');
    await t.getByRole('textbox', { name: 'Вариант 2' }).fill('Кафе');
    await t.getByRole('button', { name: '+ Вариант' }).click();
    await t.getByRole('textbox', { name: 'Вариант 3' }).fill('Не иду');
    await t.getByRole('button', { name: 'Анонимный' }).click();
    await t.getByRole('button', { name: 'сутки' }).click();
    await t.getByRole('button', { name: 'Отправить' }).click();
    const poll = message(page, 'Где обедаем?');
    await expect(poll).toBeVisible({ timeout: 15_000 });
    await expect(poll).toContainText('Анонимный · один вариант');
    await expect(poll).toContainText('Столовая');
    await expect(poll).toContainText('Не иду');
  });

  test('чат объекта: темы, файлы, спойлер, одноразовый файл, маска ПДн, закрепление, кнопка записи', async ({
    app,
    page,
  }) => {
    await open(app, page, { chat: OBJECT });
    const t = thread(page);
    await expect(t).toContainText('Чат записи · 2 участника');
    await expect(t.getByRole('button', { name: 'Объект', exact: true })).toBeVisible();
    await expect(t.getByRole('tab')).toHaveText([
      'Все темы',
      'Общее',
      'Снабжение',
      'Приёмка',
      'Допработы',
    ]);
    // Темы: «Приёмка» — только служебная карточка
    await t.getByRole('tab', { name: 'Приёмка' }).click();
    await expect(t).toContainText('Отметка на приёмке: штукатурка стен, 42 м²');
    await expect(t).not.toContainText('Стены в спальне готовы');
    await expect(t.getByRole('textbox', { name: 'Сообщение' })).toHaveAttribute(
      'placeholder',
      'Сообщение в «Приёмка» · Enter — отправить',
    );
    await t.getByRole('tab', { name: 'Все темы' }).click();
    // Файлы сообщения
    const files = message(page, 'Стены в спальне готовы');
    await expect(files).toContainText('Спальня · стена 1.jpg');
    await expect(files).toContainText('4,1 МБ');
    // Маска ПДн: номер скрыт, раскрытие — по праву и с записью в журнал
    const pdn = message(page, 'Заказчик просит звонить заранее');
    await expect(pdn).toContainText('+7 ••• •••-••-17');
    await pdn.getByRole('button', { name: 'Показать номер · попадёт в журнал' }).click();
    await expect(toast(page)).toHaveText('Номер показан, раскрытие записано в журнал чата');
    await expect(pdn).toContainText('+7 916 482-31-17');
    // Спойлер и одноразовый файл автора
    const pass = message(page, 'Пропуск на ноябрь');
    await expect(pass).toContainText('Одноразовый · открыли 0');
    await pass.getByRole('button', { name: 'Скрыто · нажмите, чтобы показать' }).click();
    await expect(pass).toContainText('Код домофона на ноябрь: 0420');
    // Важное: автор видит итог подтверждений
    await expect(message(page, '4 ноября работы на объекте')).toContainText('Подтвердили 0 из');
    // Закрепление модератором
    await menu(page, 'Договор согласовали', 'Закрепить');
    await expect(t.getByRole('note', { name: 'Закреплённое сообщение' })).toContainText(
      'Договор согласовали, утверждаю сегодня',
    );
    await menu(page, 'Договор согласовали', 'Открепить');
    await expect(t.getByRole('note', { name: 'Закреплённое сообщение' })).toHaveCount(0);
  });

  test('файл и документ в поле ввода: загрузка через files, чип, отправка, подпись размера', async ({
    app,
    page,
  }) => {
    // Загрузка идёт по presigned-ссылке хранилища: в mock его отдаёт маршрут теста.
    await page
      .context()
      .route('https://storage.example.invalid/**', (r) => r.fulfill({ status: 200 }));
    await open(app, page, { chat: DRIVERS });
    const t = thread(page);
    await expect(t).toContainText('до 100 МБ');
    await t.locator('input[type="file"]').setInputFiles({
      name: 'Акт осмотра.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    });
    await expect(t).toContainText('Акт осмотра.pdf · ');
    await t.getByRole('button', { name: 'Документ из «Документов»' }).click();
    await expect(t).toContainText('Документ уйдёт карточкой со ссылкой');
    await t.getByRole('button', { name: 'Документ из «Документов»' }).click();
    await t.getByRole('textbox', { name: 'Сообщение' }).fill('Акт во вложении');
    await t.getByRole('button', { name: 'Отправить' }).click();
    const sent = message(page, 'Акт во вложении');
    await expect(sent).toBeVisible({ timeout: 15_000 });
    await expect(sent).toContainText('Акт осмотра.pdf');
    await expect(t.getByRole('button', { name: 'Убрать файл' })).toHaveCount(0);
  });

  test('временное сообщение и спойлер из поля ввода: срок по кругу, «исчезнет через»', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'owner', chat: 'Алексей Соколов' });
    const t = thread(page);
    const temp = t.getByRole('button', { name: 'Временное сообщение' });
    await temp.click();
    await expect(t).toContainText('исчезнет через 1 ч');
    await temp.click();
    await expect(t).toContainText('исчезнет через 1 дн');
    await t.getByRole('button', { name: 'Скрытый текст (спойлер)' }).click();
    await t.getByRole('textbox', { name: 'Скрытый текст' }).fill('Код 4471');
    await t.getByRole('textbox', { name: 'Сообщение' }).fill('Код от калитки:');
    await t.getByRole('button', { name: 'Отправить' }).click();
    const sent = message(page, 'Код от калитки:');
    await expect(sent).toBeVisible({ timeout: 15_000 });
    await expect(sent).toContainText('Исчезнет через');
    await sent.getByRole('button', { name: 'Скрыто · нажмите, чтобы показать' }).click();
    await expect(sent).toContainText('Код 4471');
  });

  test('сохранить файлы в объект и создать задачу из сообщения', async ({ app, page }) => {
    await open(app, page, { chat: OBJECT });
    await menu(page, 'Стены в спальне готовы', 'Сохранить в объект');
    await expect(toast(page)).toHaveText(
      'Файлы сохранены в запись: дальше они живут по сроку записи',
    );
    await expect(message(page, 'Стены в спальне готовы')).toContainText('Сохранено в запись');
    await expect(message(page, 'Стены в спальне готовы')).toContainText('сохранено в «Объект»');
    await menu(page, 'Договор согласовали', 'Создать задачу');
    await expect(toast(page)).toContainText('создана из сообщения');
    await expect(message(page, 'Договор согласовали')).toContainText('Задача ');
  });

  test('панель «Сведения»: сообщение, участники, права, хранение; состав с предпросмотром', async ({
    app,
    page,
  }) => {
    await open(app, page, { chat: OBJECT });
    // Сообщение: «⋯» → «Сведения о сообщении» (на узкой раскладке сведения заменяют чат)
    await menu(page, 'Договор согласовали', 'Сведения о сообщении');
    await expect(page).toHaveURL(/side=msg/);
    const s = side(page);
    await expect(s.getByRole('tab')).toHaveText(['Участники', 'Сообщение', 'Права', 'Хранение']);
    await expect(s).toContainText('Вы: «Договор согласовали, утверждаю сегодня');
    await expect(s).toContainText('Галочки');
    await expect(s).toContainText('Имена в этом чате не показываются');
    await s.getByRole('button', { name: 'Закрыть сведения' }).click();
    await expect(side(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/side=/);
    // Кнопка «Сведения о чате»: вкладка «Сообщение» без выбранного сообщения
    await thread(page).getByRole('button', { name: 'Сведения о чате' }).click();
    await expect(page).toHaveURL(/side=info/);
    await expect(s).toContainText('Откуда состав');
    await expect(s).toContainText('Участники · ');
    await expect(s).toContainText('Откуда доступ у вас');
    await s.getByRole('tab', { name: 'Сообщение' }).click();
    await expect(s).toContainText('Выберите сообщение: «⋯» → «Сведения о сообщении»');
    // Состав: источник «Группа» → предпросмотр «Что изменится»
    await s.getByRole('tab', { name: 'Участники' }).click();
    await s.getByLabel('Кого добавить').selectOption('group');
    await s.getByRole('button', { name: 'Проверить, кто войдёт' }).click();
    await expect(s.getByRole('region', { name: 'Что изменится' })).toBeVisible();
    await s.getByRole('button', { name: 'Отмена' }).click();
    await expect(s.getByRole('region', { name: 'Что изменится' })).toHaveCount(0);
    // Права: матрица и политика вида
    await s.getByRole('tab', { name: 'Права' }).click();
    await expect(s.getByRole('table')).toContainText('Писать сообщения');
    await expect(s.getByRole('table')).toContainText('Видеть ПДн без маски');
    await expect(s).toContainText('Политика вида');
    await expect(s).toContainText('Файл до');
    // Хранение: 92 %, пороги, очистка с предпросмотром, удержание
    await s.getByRole('tab', { name: 'Хранение' }).click();
    await expect(s).toContainText('4,6 ГБ');
    await expect(s).toContainText('из 5 ГБ');
    await expect(s).toContainText('92 %');
    await expect(s).toContainText('Пороги: 75 % — уведомление, 90 % — предложение очистки');
    await expect(s).toContainText('Удержание до 01.12');
    await expect(s).toContainText('Удалится: ');
    await expect(s.getByRole('button', { name: /^Удалить \d+ файл/ })).toBeEnabled();
    await s.getByRole('button', { name: /Сжимать медиа/ }).click();
    await expect(toast(page)).toHaveText('При заполнении: Сжимать медиа');
    await s.getByRole('button', { name: 'Закрыть сведения' }).click();
    await expect(side(page)).toHaveCount(0);
    await expect(page).not.toHaveURL(/side=/);
  });

  test('«Новый чат»: предпросмотр «Кто войдёт» и создание группы', async ({ app, page }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: 'Новый чат' }).click();
    const d = dialog(page);
    await expect(d).toContainText(
      'Вы — владелец бизнеса: добавляете сотрудников всей организации и ставите любые метки',
    );
    await expect(d.getByRole('button', { name: /Объявления/ })).toBeVisible();
    await expect(d).toContainText('Добавьте роль в области, группу или сотрудника');
    await d.getByRole('button', { name: /^Создать чат/ }).click();
    await expect(d).toContainText('Название — не короче 3 символов');
    await d.getByLabel('Название').fill('Зимняя резина · Север Логистик');
    await d.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(d.getByRole('complementary', { name: 'Кто войдёт' })).toContainText(
      /Войдут [1-9]/,
    );
    await d.getByRole('button', { name: /^Создать чат · \d+ участник/ }).click();
    await expect(toast(page)).toHaveText('Чат «Зимняя резина · Север Логистик» создан');
    await expect(dialog(page)).toHaveCount(0);
    await expect(thread(page)).toContainText('Зимняя резина · Север Логистик');
    if (await list(page).count()) await expect(row(page, 'Зимняя резина')).toBeVisible();
  });

  test('логист: «Новый чат» скрыт — в посевных ролях нет chat.create (Q-W7.13-1)', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'manager' });
    await expect(list(page)).toContainText('Водители · Север Логистик');
    await expect(section(page).getByRole('button', { name: 'Новый чат' })).toHaveCount(0);
  });

  test('вкладка «Политики»: только владелец; проверка последствий и сохранение', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: 'Политики' }).click();
    await expect(page).toHaveURL(/tab=policy/);
    await expect(section(page)).toContainText('Политика сверху вниз');
    const rows = section(page).getByRole('group', { name: 'Виды чатов' });
    await expect(rows.getByRole('button')).toHaveCount(5);
    await rows.getByRole('button', { name: /Объявления/ }).click();
    await expect(section(page)).toContainText('«Объявления» · значения по умолчанию');
    await expect(section(page).getByLabel('Удалённые в журнале')).toHaveCount(0);
    const save = section(page).getByRole('button', { name: 'Сохранить политику' });
    await expect(save).toBeDisabled();
    await section(page).getByLabel('Хранение текста').selectOption('2');
    await section(page).getByRole('button', { name: 'Проверить последствия' }).click();
    await expect(section(page).getByRole('status', { name: 'Что изменится' })).toBeVisible();
    await save.click();
    await expect(toast(page)).toHaveText('Политика «Объявления» сохранена');
    await expect(section(page).getByLabel('Хранение текста')).toHaveValue('2');
    await expect(rows.getByRole('button', { name: /Объявления/ })).toContainText('Текст 2 г.');
    // Сброс до сохранения
    await section(page).getByLabel('Размер файла').selectOption('10');
    await section(page).getByRole('button', { name: 'Сбросить' }).click();
    await expect(section(page).getByLabel('Размер файла')).not.toHaveValue('10');
  });

  test('логист: объявления только для чтения; «Политик» нет', async ({ app, page }) => {
    await open(app, page, { persona: 'manager', chat: NEWS });
    await expect(section(page).getByRole('button', { name: 'Политики' })).toHaveCount(0);
    await expect(thread(page)).toContainText(
      'В объявлениях пишут модераторы. Вы читаете и подтверждаете важное',
    );
    await expect(thread(page).getByRole('textbox', { name: 'Сообщение' })).toHaveCount(0);
    await expect(message(page, '4 ноября — выходной')).toContainText('Вы подтвердили');
  });

  test('водитель: рабочие чаты фирмы; без прав модератора инструменты закрыты', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'driver' });
    await expect(row(page, 'Альта · новости')).toBeVisible();
    await openChat(page, DRIVERS);
    await expect(section(page).getByRole('button', { name: 'Новый чат' })).toHaveCount(0);
    const t = thread(page);
    await t.getByRole('button', { name: /^Важное — нужно право/ }).click();
    await expect(section(page).getByRole('alert')).toContainText(
      'Важное с подтверждением отправляют модераторы',
    );
    await t.getByRole('button', { name: /^Временные запрещены политикой вида/ }).click();
    await expect(section(page).getByRole('alert')).toContainText('Временные сообщения в этом чате');
  });

  test('узкая раскладка: список → чат → сведения → назад', async ({ app, page }) => {
    test.skip(!phone(page), 'раскладка 390 — только в проекте телефона');
    await open(app, page);
    await expect(list(page)).toBeVisible();
    await expect(thread(page)).toHaveCount(0);
    await row(page, DRIVERS).click();
    await expect(thread(page)).toBeVisible();
    await expect(list(page)).toHaveCount(0);
    await thread(page).getByRole('button', { name: 'Сведения о чате' }).click();
    await expect(side(page)).toBeVisible();
    await expect(thread(page)).toHaveCount(0);
    await side(page).getByRole('button', { name: 'Закрыть сведения' }).click();
    await expect(thread(page)).toBeVisible();
    await thread(page).getByRole('button', { name: 'К списку чатов' }).click();
    await expect(list(page)).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('широкая раскладка: список, чат и сведения в три колонки', async ({ app, page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1200, 'три колонки — только на компьютере');
    await open(app, page, { chat: DRIVERS });
    await thread(page).getByRole('button', { name: 'Сведения о чате' }).click();
    await expect(list(page)).toBeVisible();
    await expect(thread(page)).toBeVisible();
    await expect(side(page)).toBeVisible();
  });

  test('клавиатура и axe без serious (страница, меню, диалог); 390 — цели не меньше 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page, { chat: DRIVERS });
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const bad = async (): Promise<string[]> =>
      (await axe(page)).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(await bad()).toEqual([]);
    // Меню сообщения: открывается с клавиатуры, закрывается Escape
    const btn = messages(page).first().getByRole('button', { name: 'Действия с сообщением' });
    await btn.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    expect(await bad()).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    if (phone(page)) {
      expect(await hitHeight(btn)).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(thread(page).getByRole('button', { name: 'Сведения о чате' })),
      ).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(thread(page).getByRole('button', { name: 'Отправить' })),
      ).toBeGreaterThanOrEqual(44);
      expect(await noHorizontalScroll(page)).toBe(true);
    }
    if (!phone(page)) {
      await section(page).getByRole('button', { name: 'Новый чат' }).click();
      await expect(dialog(page)).toBeVisible();
      expect(await bad()).toEqual([]);
    }
  });
});

// Возврат 1 (W7.13-r1): состояния страницы по verification-protocol §1.3 — загрузка, ошибка с «Повторить», офлайн,
// нет права — для listChats, getChat и listChatMessages; справочники только по праву; подписи «Нового чата» и «Политик».
test.describe('chat — состояния и сверка с эталоном @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и сид — сценарный сервер mock');
  test.setTimeout(90_000);

  const FEED_FAILED = 'Не удалось загрузить сообщения';
  const LIST_FAILED = 'Не удалось загрузить чаты';

  test('лента: listChatMessages=offline — ошибка и «Повторить» → сообщения', async ({
    app,
    page,
  }) => {
    await open(app, page, { chat: DRIVERS });
    await devScenario(page, { scenario: 'listChatMessages=offline' });
    await page.reload();
    await expect(thread(page)).toBeVisible({ timeout: 20_000 });
    const alert = thread(page).getByRole('alert').filter({ hasText: FEED_FAILED });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(messages(page)).toHaveCount(0);
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(thread(page)).toContainText('Критический дефект · М 608 КТ 77', {
      timeout: 15_000,
    });
    await expect(alert).toHaveCount(0);
  });

  test('лента: listChatMessages=forbidden_action — «нет права», без «Повторить»', async ({
    app,
    page,
  }) => {
    await open(app, page, { chat: DRIVERS });
    await devScenario(page, { scenario: 'listChatMessages=forbidden_action' });
    await page.reload();
    await expect(thread(page)).toBeVisible({ timeout: 20_000 });
    const alert = thread(page).getByRole('alert').filter({ hasText: 'нет права' });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(alert.getByRole('button', { name: 'Повторить' })).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('лента: скелетон «Загружаем сообщения…» до ответа listChatMessages', async ({
    app,
    page,
  }) => {
    await open(app, page, { chat: DRIVERS });
    await devScenario(page, { scenario: 'listChatMessages=delay=3000' });
    await page.reload();
    const status = thread(page).getByRole('status', { name: 'Загрузка' });
    await expect(status).toBeVisible({ timeout: 15_000 });
    await expect(status).toContainText('Загружаем сообщения…');
    await expect(thread(page)).toContainText('Критический дефект · М 608 КТ 77', {
      timeout: 15_000,
    });
    await expect(status).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('«Политики»: listChatPolicies=offline — role=alert про политики и «Повторить»; forbidden_action — «нет права» без «Повторить»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: 'Политики' }).click();
    await expect(page).toHaveURL(/tab=policy/);
    await devScenario(page, { scenario: 'listChatPolicies=offline' });
    await page.reload();
    const alert = section(page).getByRole('alert').filter({ hasText: 'политики' });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await expect(alert).not.toContainText('чаты');
    const retry = alert.getByRole('button', { name: 'Повторить' });
    await devScenario(page, { scenario: null });
    await retry.click();
    await expect(section(page).getByRole('group', { name: 'Виды чатов' })).toBeVisible({
      timeout: 15_000,
    });
    await devScenario(page, { scenario: 'listChatPolicies=forbidden_action' });
    await page.reload();
    const denied = section(page).getByRole('alert').filter({ hasText: 'нет права' });
    await expect(denied).toBeVisible({ timeout: 20_000 });
    await expect(denied.getByRole('button', { name: 'Повторить' })).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  test('чат: getChat=offline — ошибка и «Повторить»; getChat=forbidden_action — «нет права»', async ({
    app,
    page,
  }) => {
    await open(app, page, { chat: DRIVERS });
    await devScenario(page, { scenario: 'getChat=offline' });
    await page.reload();
    const retry = section(page).getByRole('button', { name: 'Повторить' });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    await expect(section(page)).toContainText(LIST_FAILED);
    await devScenario(page, { scenario: null });
    await retry.click();
    await expect(thread(page)).toContainText(DRIVERS, { timeout: 15_000 });
    await devScenario(page, { scenario: 'getChat=forbidden_action' });
    await page.reload();
    await expect(section(page).getByRole('alert').filter({ hasText: 'нет права' })).toBeVisible({
      timeout: 20_000,
    });
    await devScenario(page, { scenario: null });
  });

  test('список: listChats=offline — ошибка, «Повторить», счётчики папок без нулей', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await devScenario(page, { scenario: 'listChats=offline' });
    await page.reload();
    await expect(h1(page, 'Чаты')).toBeVisible({ timeout: 20_000 });
    const alert = list(page).getByRole('alert');
    await expect(alert).toContainText(LIST_FAILED, { timeout: 15_000 });
    await expect(
      list(page).getByRole('group', { name: 'Папки чатов' }).getByRole('button'),
    ).toHaveText(['Все', 'Личные', 'Рабочие', 'Записи', 'Объявления']);
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(row(page, DRIVERS)).toBeVisible({ timeout: 15_000 });
    await expect(
      list(page).getByRole('group', { name: 'Папки чатов' }).getByRole('button').first(),
    ).toHaveText('Все5');
  });

  test('список: listChats=forbidden_action — AccessGate; listChats=delay — скелетон', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await devScenario(page, { scenario: 'listChats=delay=3000' });
    await page.reload();
    await expect(list(page).getByRole('status', { name: 'Загрузка' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(row(page, DRIVERS)).toBeVisible({ timeout: 15_000 });
    await devScenario(page, { scenario: 'listChats=forbidden_action' });
    await page.reload();
    await expect(page.locator('.ox-gate')).toBeVisible({ timeout: 20_000 });
    await expect(section(page)).toHaveCount(0);
    await devScenario(page, { scenario: null });
  });

  for (const persona of ['manager', 'driver', 'foreman'] as const) {
    test(`${persona}: справочники организации не запрашиваются без права — ни одного 403`, async ({
      app,
      page,
    }) => {
      const denied: string[] = [];
      page.on('response', (r) => {
        if (r.status() === 403 && r.url().includes('/api/v1/tenants/')) denied.push(r.url());
      });
      await open(app, page, { persona });
      await page.waitForLoadState('networkidle');
      expect(denied).toEqual([]);
    });
  }

  test('«Новый чат»: подписи эталона — «Закрыть», «Метка чата», «Кто войдёт», политика вида', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: 'Новый чат' }).click();
    const d = dialog(page);
    await expect(d.getByRole('button', { name: 'Закрыть' })).toBeVisible();
    await expect(d.getByRole('group', { name: 'Метка чата' })).toBeVisible();
    await expect(d).toContainText(
      'Состав по роли и группе дальше меняется сам: новые сотрудники войдут, уволенные и заблокированные выйдут, их сообщения останутся в чате.',
    );
    await expect(d.locator('.ox-chat-pol-note')).toHaveText(
      /^Политика вида «[^»]+»: текст \d+ г\., файл до \d+ МБ(, \d+(,\d)? ГБ на чат)?, прочтение — «[^»]+»$/,
    );
    await expect(d.getByRole('combobox', { name: 'Область' })).toBeVisible();
    await expect(d.getByRole('option', { name: 'Москва' })).toHaveCount(0);
    if ((page.viewportSize()?.width ?? 0) >= 1100) {
      const name = await d.getByRole('textbox', { name: 'Название' }).boundingBox();
      const area = await d.getByRole('combobox', { name: 'Область' }).boundingBox();
      expect(Math.abs((name?.y ?? 0) - (area?.y ?? 99))).toBeLessThan(20);
    }
    await d.getByRole('button', { name: 'Закрыть' }).click();
    await expect(d).toHaveCount(0);
  });

  test('«Политики»: кнопки рядом с «Новый чат», вводная карточка, виды строками таблицы', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const head = section(page).locator('.ox-chat-top');
    await expect(head.getByRole('button', { name: 'Сообщения' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await head.getByRole('button', { name: 'Политики' }).click();
    await expect(page).toHaveURL(/tab=policy/);
    await expect(head.getByRole('button', { name: 'Политики' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(section(page).locator('.ox-chat-pol-intro .material-symbols-rounded')).toHaveText(
      'account_tree',
    );
    const rows = section(page).getByRole('group', { name: 'Виды чатов' }).getByRole('button');
    await expect(rows).toHaveCount(5);
    const boxes = await rows.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), w: Math.round(r.width), y: Math.round(r.y) };
      }),
    );
    // Строки друг под другом на всю ширину, не сетка карточек.
    expect(new Set(boxes.map((b) => b.x)).size).toBe(1);
    expect(boxes.every((b, i) => i === 0 || b.y > (boxes[i - 1]?.y ?? 0))).toBe(true);
    await expect(section(page).locator('.ox-chat-pol-card')).toBeVisible();
  });

  // Возврат 2 (W7.13-r2)
  test('«Новый чат»: короткое название после ввода в поле — ошибка не стирается blur-предпросмотром', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: 'Новый чат' }).click();
    const d = dialog(page);
    await d.getByLabel('Название').fill('Ab');
    await d.getByRole('button', { name: /^Создать чат/ }).click();
    await expect(d.getByRole('alert')).toContainText('Название — не короче 3 символов');
    // blur-предпросмотр отвечает позже клика: ошибка должна пережить его ответ
    await page.waitForTimeout(1200);
    await expect(d.getByRole('alert')).toContainText('Название — не короче 3 символов');
    await expect(d).toBeVisible();
  });

  test('«Новый чат»: ошибка названия исчезает при правке поля, не ждёт повторной отправки', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: 'Новый чат' }).click();
    const d = dialog(page);
    await d.getByLabel('Название').fill('Ab');
    await d.getByRole('button', { name: /^Создать чат/ }).click();
    await expect(d.getByRole('alert')).toContainText('Название — не короче 3 символов');
    await d.getByLabel('Название').fill('Abc');
    await expect(d.getByRole('alert')).toHaveCount(0);
  });

  test('«Новый чат»: «Кто войдёт» обновляется без названия, без 422 в консоли', async ({
    app,
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await open(app, page);
    await section(page).getByRole('button', { name: 'Новый чат' }).click();
    const d = dialog(page);
    await d.getByRole('button', { name: 'Добавить', exact: true }).click();
    await expect(d.getByRole('complementary', { name: 'Кто войдёт' })).toContainText(
      /Войдут [1-9]/,
    );
    await expect(d.getByRole('alert')).toHaveCount(0);
    expect(errors.filter((e) => /422/.test(e))).toEqual([]);
  });

  test('«Новый чат»: вид «Личный» по умолчанию выбирает не себя — создание проходит', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: 'Новый чат' }).click();
    const d = dialog(page);
    await d.getByRole('button', { name: /Личный/ }).click();
    await d.getByRole('button', { name: /^Создать чат/ }).click();
    await expect(d.getByRole('alert')).toHaveCount(0);
    await expect(d).toHaveCount(0);
  });

  test('панель «Сведения»: axe без serious/moderate на каждой вкладке, область прокрутки фокусируется', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page, { chat: OBJECT });
    await page.waitForLoadState('networkidle');
    await thread(page).getByRole('button', { name: 'Сведения о чате' }).click();
    const s = side(page);
    const panel = s.getByRole('tabpanel');
    for (const tab of ['Участники', 'Сообщение', 'Права', 'Хранение']) {
      await s.getByRole('tab', { name: tab }).click();
      await expect(panel).toHaveAttribute('tabindex', '0');
      await expect(panel).toHaveAccessibleName(tab);
      const found = (await axe(page)).violations
        .filter((v) =>
          ['scrollable-region-focusable', 'heading-order', 'aria-allowed-attr'].includes(v.id),
        )
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(found, tab).toEqual([]);
    }
  });

  test('панель «Сведения» на 768: axe без color-contrast на каждой вкладке (вышедшие участники)', async ({
    app,
    page,
    axe,
  }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await open(app, page, { chat: OBJECT });
    await page.waitForLoadState('networkidle');
    await thread(page).getByRole('button', { name: 'Сведения о чате' }).click();
    const s = side(page);
    for (const tab of ['Участники', 'Сообщение', 'Права', 'Хранение']) {
      await s.getByRole('tab', { name: tab }).click();
      const found = (await axe(page)).violations
        .filter((v) => v.id === 'color-contrast')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(found, tab).toEqual([]);
      const out = s.locator('.ox-chat-person[data-state="out"]');
      if (await out.count()) await expect(out.first()).not.toHaveCSS('opacity', '0.75');
    }
  });
});

test.describe('chat — «Чаты» @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('@stand-spec список и лента на реальном backend (причина: backend чатов — W7.11, ещё не в main)', () => {});
});
