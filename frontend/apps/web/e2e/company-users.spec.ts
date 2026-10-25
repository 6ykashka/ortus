// W1.23 · e2e страницы `company-users`: «Пользователи и роли» — вкладки «Люди», «Группы», «Проверка доступа»,
// карточка сотрудника и «Почему доступно» (эталон design-stage-1, «Ортус CRM.dc.html» :283–332, :400–425,
// usersVM :3139–3166, accessVM :3218–3247; чек-лист docs/plan/analysis/02-company.md §10 #15–#17, #27, #34–#36;
// обязательные пункты verification-protocol.md §1.3). Персонаж — dev-вход ?persona= (e2e-сборка).
import { expect, test } from './fixtures/index.ts';
import {
  dialog,
  noHorizontalScroll,
  openUsers,
  personRow,
  tab,
  tabs,
  toast,
  USERS_H1,
} from './people.helpers.ts';
import { devScenario, LOTOS, tenantId } from './shell.helpers.ts';

const h1 = { level: 1, name: USERS_H1 } as const;

test.describe('company-users — «Люди», «Группы», «Проверка доступа» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');

  test('открывается из меню «Пользователи и роли» и по прямому URL', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    const wide = (page.viewportSize()?.width ?? 0) >= 640;
    const nav = wide
      ? page.getByRole('navigation', { name: 'Основная навигация' })
      : page.getByRole('navigation', { name: 'Навигация', exact: true });
    await nav.getByRole('button', { name: wide ? 'Пользователи и роли' : 'Люди' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/users$`));
    await expect(page.getByRole('heading', h1)).toBeVisible();
    await app(`/t/${alta}/users`, { persona: 'owner' });
    await expect(page.getByRole('heading', h1)).toBeVisible();
  });

  test('шапка: крошка, заголовок, абзац; вкладки со счётчиками, «Люди» выбрана (#15)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await expect(page.getByText('Альта Групп / Компания и доступ')).toBeVisible();
    await expect(
      page.getByText(
        'Роль задаёт действия, область — данные, к которым они применяются. Один сотрудник может иметь разные роли в разных фирмах.',
      ),
    ).toBeVisible();
    await expect(tabs(page).getByRole('tab')).toHaveText([
      'Люди10',
      'Группы2',
      'Роли9',
      'Проверка доступа',
    ]);
    await expect(tab(page, 'Люди')).toHaveAttribute('aria-selected', 'true');
  });

  test('«Люди»: «10 участников · без роли: 3 · мест занято 9 из 10» и «Пригласить» (#16)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await expect(page.getByText('10 участников · без роли: 3 · мест занято 9 из 10')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Пригласить' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Участники' }).getByRole('listitem')).toHaveCount(
      10,
    );
  });

  test('строки людей: назначения, «через группу», «Водитель», статусы, выключенная кнопка (#17)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await expect(personRow(page, 'Дарья Зимина')).toContainText(
      'Владелец бизнеса· Вся организация',
    );
    await expect(personRow(page, 'Дарья Зимина')).toContainText('Активен');
    const vasiliev = personRow(page, 'Илья Васильев');
    await expect(vasiliev).toContainText(
      'Водитель· Москва / Север Логистик· через группу «Водители Север»',
    );
    await expect(vasiliev).toContainText(
      'Функция «Водитель»: начисления недоступны через любую роль',
    );
    await expect(personRow(page, 'Анна Морозова')).toContainText(
      'Массажист· Только назначенное лично',
    );
    await expect(personRow(page, 'Олеся Петрова')).toContainText('Приглашён');
    await expect(personRow(page, 'Олеся Петрова')).toContainText(
      'Без роли — нет доступа к модулям',
    );
    const gromov = personRow(page, 'Кирилл Громов');
    await expect(gromov).toContainText('Заблокирован');
    await expect(gromov.getByRole('button', { name: 'Назначить роль' })).toBeDisabled();
    await expect(
      personRow(page, 'Марина Котова').getByRole('button', { name: 'Назначить роль' }),
    ).toBeEnabled();
  });

  test('«Группы»: две карточки, участники и роли через группу (#27)', async ({ app, page }) => {
    await openUsers(app, page);
    await tab(page, 'Группы').click();
    await expect(tab(page, 'Группы')).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByText(
        'Группа упрощает назначение ролей, но не объединяет данные фирм: область задаётся в каждом назначении.',
      ),
    ).toBeVisible();
    const disp = page.getByRole('article').filter({ hasText: 'Диспетчеры Север' });
    await expect(disp).toContainText('2 участника: Марина Котова, Олеся Петрова');
    await expect(disp).toContainText('Роли через группу не назначены');
    const drv = page.getByRole('article').filter({ hasText: 'Водители Север' });
    await expect(drv).toContainText('2 участника: Илья Васильев, Кирилл Громов');
    await expect(drv).toContainText(
      'Роли через группу: Исполнитель · Проект «Логистика · Север»; Водитель · Москва / Север Логистик',
    );
    await expect(page.getByRole('button', { name: 'Создать группу' })).toBeEnabled();
  });

  test('«Проверка доступа»: Котова · «Просматривать машины» — «Модуль не подключён» (#34)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=check' });
    await expect(page.getByRole('heading', { name: 'Проверить доступ' })).toBeVisible();
    await expect(
      page.getByText('Объяснение вычисленного права. Это не вход под пользователем.'),
    ).toBeVisible();
    await expect(page.getByLabel('Сотрудник')).toHaveValue(/.+/);
    await expect(page.getByLabel('Сотрудник').locator('option:checked')).toHaveText(
      'Марина Котова · m.kotova@alta.example',
    );
    await expect(page.getByLabel('Действие').locator('option:checked')).toHaveText(
      'Просматривать машины',
    );
    const result = page.getByRole('region', { name: 'Результат проверки' });
    await expect(result).toContainText('Модуль не подключён');
    await expect(result).toContainText('Марина Котова не может: просматривать машины');
    await expect(result).toContainText(
      'Модуль не подключён организацией. Подключить его может владелец бизнеса. Модуль: Логистика.',
    );
    await expect(result).toContainText('Рабочее место сотрудника · вычислено');
    await expect(result).toContainText('Нет доступных разделов модулей');
  });

  test('пресет «Начисления водителю» — «Запрещено функцией «Водитель»» (#35)', async ({
    app,
    page,
  }) => {
    // Порядок проверок контракта (x-authorization-order): подключение модуля раньше SoD. В эталоне «Логистика»
    // по умолчанию выключена, но canEarnings проверяет функцию первой — на сервере это так при подключённом модуле.
    await openUsers(app, page);
    await devScenario(page, { preset: 'logistics-ready' });
    await page.goto(page.url().replace(/\/users.*$/, '/users?tab=check'));
    await page.getByRole('button', { name: 'Начисления водителю' }).click();
    const result = page.getByRole('region', { name: 'Результат проверки' });
    await expect(result).toContainText('Запрещено функцией «Водитель»');
    await expect(result).toContainText('Илья Васильев не может: видеть начисления');
    await expect(result).toContainText(
      'Действующая функция «Водитель» запрещает начисления через любую роль и группу.',
    );
  });

  test('логистика подключена: «Нет права» и «Разрешено» с основанием (#36)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await devScenario(page, { preset: 'logistics-ready' });
    await page.reload();
    await tab(page, 'Проверка доступа').click();
    const result = page.getByRole('region', { name: 'Результат проверки' });
    await page.getByRole('button', { name: 'Нет права' }).click();
    await expect(result).toContainText('Нет права');
    await expect(result).toContainText('Ни одна роль сотрудника не разрешает это действие.');
    await page
      .getByLabel('Сотрудник')
      .selectOption({ label: 'Илья Васильев · i.vasiliev@alta.example' });
    await page.getByLabel('Действие').selectOption({ label: 'Просматривать машины' });
    await page
      .getByRole('combobox', { name: /^Объект/ })
      .selectOption({ label: 'Без конкретного объекта' });
    await expect(result).toContainText('Разрешено');
    await expect(result).toContainText('Илья Васильев может: просматривать машины');
    await expect(result).toContainText(
      'Основание · роль «Водитель» · Москва / Север Логистик · через группу «Водители Север».',
    );
    await expect(result).toContainText('Логистика');
  });

  test('«Почему доступно»: проверки по порядку и назначения (S1-14, no-reference)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=check' });
    await page.getByRole('button', { name: 'Почему доступно' }).click();
    const dlg = dialog(page, 'Почему доступно');
    await expect(dlg).toBeVisible();
    // Возврат 16.10 №2: подзаголовок — подпись действия, а не ключ права.
    await expect(dlg).toContainText('Марина Котова · Просматривать машины');
    await expect(dlg).not.toContainText('fleet.vehicles.read');
    await expect(
      dlg.getByRole('list', { name: 'Проверки по порядку' }).getByRole('listitem'),
    ).toHaveCount(6);
    await expect(dlg).toContainText('Подключение модуля');
    await expect(dlg).toContainText('Модуль «Логистика» не подключён.');
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });

  test('карточка сотрудника: «Заблокировать» и «Разблокировать» (S1-09, updateMember W1.43)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await personRow(page, 'Тимур Ахмедов').getByRole('button', { name: 'Тимур Ахмедов' }).click();
    const card = dialog(page, 'Тимур Ахмедов');
    await expect(card).toContainText('t.akhmedov@alta.example');
    await expect(card).toContainText('Функции');
    await expect(card).toContainText('Водитель');
    // Возврат 16.10 №1: блокировка — с подтверждением; фокус после команд остаётся в карточке, Escape её закрывает.
    await card.getByRole('button', { name: 'Заблокировать' }).click();
    const confirm = dialog(page, 'Заблокировать сотрудника «Тимур Ахмедов»?');
    await expect(confirm).toContainText('Вход и новые операции будут закрыты');
    await confirm.getByRole('button', { name: 'Заблокировать' }).click();
    await expect(toast(page)).toHaveText('Сотрудник заблокирован: вход и новые операции закрыты');
    await expect(card).toContainText('Заблокирован');
    expect(await card.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await card.getByRole('button', { name: 'Разблокировать' }).click();
    await expect(toast(page)).toHaveText('Сотрудник снова может входить');
    await expect(card).toContainText('Активен');
    await expect(card.getByRole('button', { name: 'Заблокировать' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(personRow(page, 'Тимур Ахмедов')).toContainText('Активен');
  });

  // Возврат 16.10 №2: подтверждение открывается поверх карточки, не размонтируя её, — после закрытия карточки фокус
  // возвращается на имя в строке (а не на body).
  test('карточка: после подтверждения блокировки фокус возвращается на имя в строке', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    const name = personRow(page, 'Тимур Ахмедов').getByRole('button', { name: 'Тимур Ахмедов' });
    await name.focus();
    await page.keyboard.press('Enter');
    const card = dialog(page, 'Тимур Ахмедов');
    await card.getByRole('button', { name: 'Заблокировать' }).click();
    const confirm = dialog(page, 'Заблокировать сотрудника «Тимур Ахмедов»?');
    await confirm.getByRole('button', { name: 'Отмена' }).click();
    await expect(confirm).toBeHidden();
    expect(await card.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(name).toBeFocused();
    await page.keyboard.press('Enter');
    await card.getByRole('button', { name: 'Заблокировать' }).click();
    await confirm.getByRole('button', { name: 'Заблокировать' }).click();
    await expect(toast(page)).toHaveText('Сотрудник заблокирован: вход и новые операции закрыты');
    await expect(card).toContainText('Заблокирован');
    await card.getByRole('button', { name: 'Закрыть' }).click();
    await expect(card).toBeHidden();
    await expect(name).toBeFocused();
  });

  test('«Проверка доступа»: ошибка explainAccess — текст и «Повторить»; загрузка — aria-busy', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await devScenario(page, { scenario: 'explainAccess=rate_limited' });
    await tab(page, 'Проверка доступа').click();
    const result = page.getByRole('region', { name: 'Результат проверки' });
    const alert = result.getByRole('alert');
    await expect(alert).toContainText('Не удалось проверить доступ.');
    await devScenario(page, { scenario: 'explainAccess=delay=1500' });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(result).toHaveAttribute('aria-busy', 'true');
    await expect(result.getByRole('status')).toHaveText('Проверяем доступ…');
    await expect(result).toContainText('Марина Котова не может: просматривать машины');
    await expect(result).toHaveAttribute('aria-busy', 'false');
  });

  test('нет права на роли: «Люди» открыты, «Роли» — «Нет права…» (Котова, logistics-ready)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await devScenario(page, { preset: 'logistics-ready' });
    const alta = await tenantId(page);
    await app(`/t/${alta}/users`, { persona: 'manager' });
    await expect(page.getByRole('heading', h1)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Участники' })).toBeVisible();
    await expect(page.getByText(/Не удалось загрузить список/)).toHaveCount(0);
    await tab(page, 'Роли').click();
    await expect(page.getByText('Нет права просматривать роли организации.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Повторить' })).toHaveCount(0);
  });

  // Возврат 16.10 №3 (major): у Котовой (права в своей области) listRoles — 403 — роль назначения не видна; строка
  // говорит об этом («нет права»), а не начинается с «· »; действий без права записи нет.
  test('права в своей области (Котова): «Роль не видна — нет права просматривать роли», без «Пригласить»', async ({
    app,
    page,
  }) => {
    const HIDDEN = 'Роль не видна — нет права просматривать роли';
    await openUsers(app, page);
    await devScenario(page, { preset: 'logistics-ready' });
    const alta = await tenantId(page);
    await app(`/t/${alta}/users`, { persona: 'manager' });
    await expect(personRow(page, 'Илья Васильев')).toContainText(
      `${HIDDEN}· Проект «Логистика · Север»· через группу «Водители Север»`,
    );
    await expect(page.getByRole('button', { name: 'Пригласить' })).toHaveCount(0);
    await tab(page, 'Группы').click();
    const drv = page.getByRole('article').filter({ hasText: 'Водители Север' });
    await expect(drv).toContainText(
      `Роли через группу: ${HIDDEN} · Проект «Логистика · Север»; ${HIDDEN} · `,
    );
    const disp = page.getByRole('article').filter({ hasText: 'Диспетчеры Север' });
    await expect(disp).toContainText('вне вашей области');
    await expect(page.getByRole('button', { name: 'Создать группу' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Изменить состав' })).toHaveCount(0);
  });

  // Возврат 16.10 №3 (minor): listMembers и listGroups — 403 — «нет права», а не пустой список с «Пригласить».
  test('нет права на участников: «Нет права просматривать участников организации.»', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await devScenario(page, {
      scenario: 'listMembers=forbidden_action,listGroups=forbidden_action',
    });
    await page.reload();
    await expect(page.getByText('Нет права просматривать участников организации.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Пригласить' })).toHaveCount(0);
    await expect(page.getByText(/участников · /)).toHaveCount(0);
    await expect(tab(page, 'Люди')).toHaveText('Люди');
    await tab(page, 'Группы').click();
    await expect(page.getByText('Нет права просматривать группы организации.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Создать группу' })).toHaveCount(0);
  });

  test('своя карточка: заблокировать себя нельзя — кнопки нет (Q-W1.43-2)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await personRow(page, 'Дарья Зимина').getByRole('button', { name: 'Дарья Зимина' }).click();
    const card = dialog(page, 'Дарья Зимина');
    await expect(card).toContainText('Владелец бизнеса');
    await expect(card.getByRole('button', { name: 'Заблокировать' })).toHaveCount(0);
  });

  test('«Лотос»: 23 участника, места 23 из 25', async ({ app, page }) => {
    await openUsers(app, page, { persona: 'owner@t-lotos', tenant: LOTOS });
    await expect(page.getByText(/^23 участников · .*мест занято 23 из 25$/)).toBeVisible();
    await expect(tab(page, 'Группы')).toHaveText('Группы1');
  });

  test('загрузка: скелетон до ответа listMembers', async ({ app, page }) => {
    await openUsers(app, page);
    await devScenario(page, { scenario: 'listMembers=delay=1500', once: true });
    await page.reload();
    const status = page.getByRole('status', { name: 'Загрузка' });
    await expect(status).toBeVisible();
    await expect(status).toBeHidden();
    await expect(personRow(page, 'Дарья Зимина')).toBeVisible();
  });

  test('ошибка загрузки: текст ошибки и «Повторить»', async ({ app, page }) => {
    await openUsers(app, page);
    await devScenario(page, { scenario: 'listMembers=rate_limited', once: true });
    await page.reload();
    const alert = page.getByRole('alert').filter({ hasText: 'Не удалось загрузить список' });
    await expect(alert).toBeVisible();
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(personRow(page, 'Дарья Зимина')).toBeVisible();
  });

  test('нет права: логисту раздел закрыт гейтом оболочки', async ({ app, page }) => {
    await app('/', { persona: 'manager' });
    const alta = await tenantId(page);
    await app(`/t/${alta}/users`, { persona: 'manager' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Нет доступа к разделу «Пользователи и роли»' }),
    ).toBeVisible();
  });

  test('клавиатура: стрелки переключают вкладки, фокус виден', async ({ app, page }) => {
    await openUsers(app, page);
    await tab(page, 'Люди').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Группы')).toBeFocused();
    await expect(tab(page, 'Группы')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'Проверка доступа')).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/tab=check/);
    const outline = await tab(page, 'Проверка доступа').evaluate(
      (el) => getComputedStyle(el).outlineStyle,
    );
    expect(outline).not.toBe('none');
  });

  test('axe: «Люди», «Группы», «Проверка доступа» без serious/critical', async ({
    app,
    page,
    axe,
  }) => {
    await openUsers(app, page);
    for (const t of ['Люди', 'Группы', 'Проверка доступа']) {
      await tab(page, t).click();
      await expect(tab(page, t)).toHaveAttribute('aria-selected', 'true');
      const r = await axe(page);
      expect(
        r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
        t,
      ).toEqual([]);
    }
  });

  // Возврат 16.10 №3: на 768 оболочка (W1.49) показывает свёрнутую боковую панель, а не нижнюю навигацию — граница
  // та же, что у меню в первом тесте файла (640 px), поэтому строка зелёная на всех трёх проектах.
  test('раскладка: 390 — без горизонтальной прокрутки и с нижней навигацией; 768 и 1440 — боковая панель', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    expect(await noHorizontalScroll(page)).toBe(true);
    const wide = (page.viewportSize()?.width ?? 0) >= 640;
    if (wide) {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    } else {
      const bottom = page.getByRole('navigation', { name: 'Навигация', exact: true });
      await expect(bottom.getByRole('button', { name: 'Люди' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }
    const invite = page.getByRole('button', { name: 'Пригласить' });
    expect((await invite.boundingBox())?.height).toBeGreaterThanOrEqual(40);
    // Возврат 16.10 №1: имя-кнопка карточки сотрудника — цель нажатия не меньше 44 px (§1.3), строка не растёт.
    const name = personRow(page, 'Дарья Зимина').getByRole('button', { name: 'Дарья Зимина' });
    expect((await name.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  });
});

// W1.05, W1.06, W1.43 — в main: список, назначения, группы, «Почему доступно» и приостановка на стенде (Go-сид).
// Сид стенда общий для всех проектов прогона (e2e-stand: workers 1, пропусков быть не должно), поэтому команды
// возвращают состояние сида: «Заблокировать» → «Разблокировать».
test.describe('company-users — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('стенд: люди «Альты», назначения и группы', async ({ app, page }) => {
    test.slow();
    await openUsers(app, page);
    await expect(personRow(page, 'Дарья Зимина')).toContainText(
      'Владелец бизнеса· Вся организация',
    );
    await expect(personRow(page, 'Илья Васильев')).toContainText(
      'Водитель· Москва / Север Логистик· через группу «Водители Север»',
    );
    // W4.85: область «проект» — с именем проекта задач (listTaskProjects, сид «Логистика · Север»).
    await expect(personRow(page, 'Илья Васильев')).toContainText('Проект «Логистика · Север»');
    await expect(personRow(page, 'Кирилл Громов')).toContainText('Заблокирован');
    await tab(page, 'Группы').click();
    await expect(page.getByRole('article').filter({ hasText: 'Водители Север' })).toContainText(
      'Илья Васильев',
    );
  });

  test('стенд: «Заблокировать» и «Разблокировать» (updateMember)', async ({ app, page }) => {
    test.slow();
    await openUsers(app, page);
    await personRow(page, 'Тимур Ахмедов').getByRole('button', { name: 'Тимур Ахмедов' }).click();
    const card = dialog(page, 'Тимур Ахмедов');
    await card.getByRole('button', { name: 'Заблокировать' }).click();
    await dialog(page, 'Заблокировать сотрудника «Тимур Ахмедов»?')
      .getByRole('button', { name: 'Заблокировать' })
      .click();
    await expect(card).toContainText('Заблокирован');
    await card.getByRole('button', { name: 'Разблокировать' }).click();
    await expect(card).toContainText('Активен');
  });

  test('стенд: «Почему доступно» по explainAccess', async ({ app, page }) => {
    test.slow();
    await openUsers(app, page, { query: 'tab=check' });
    const result = page.getByRole('region', { name: 'Результат проверки' });
    await expect(result).toContainText('Марина Котова не может: просматривать машины');
    await page.getByRole('button', { name: 'Почему доступно' }).click();
    await expect(dialog(page, 'Почему доступно')).toContainText('Подключение модуля');
  });
});
