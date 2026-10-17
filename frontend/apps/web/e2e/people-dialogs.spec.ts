// W1.23 · e2e страницы `people-dialogs`: диалоги «Назначить роль», «Пригласить участника», «Создать роль»
// (эталон design-stage-1, «Ортус CRM.dc.html» :2176–2262, modalVM :3964–4034, обработчики :2723–2753; чек-лист
// docs/plan/analysis/02-company.md §10 #18–#26, #33, #65, #68; WS-14 §6(а) по контракту 0.4.0-stage1) и диалоги
// без эталона (no-reference, B-6): «Передать владение» (S1-16), «Создать группу» и «Состав группы» (S1-13).
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/index.ts';
import { dialog, openUsers, personRow, runTag, tab, toast } from './people.helpers.ts';
import { call, devScenario } from './shell.helpers.ts';

const assignFor = async (page: Page, name: string) => {
  await personRow(page, name).getByRole('button', { name: 'Назначить роль' }).click();
  const dlg = dialog(page, 'Назначить роль');
  await expect(dlg).toBeVisible();
  return dlg;
};

const options = (page: Page, sel: ReturnType<Page['getByLabel']>) =>
  sel.locator('option').allTextContents();

test.describe('people-dialogs — «Назначить роль» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии — сценарный сервер mock');

  test('открытие у Марины Котовой: подпись, роль, область «Фирма», итог (#18)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Марина Котова');
    await expect(dlg).toContainText('Марина Котова · m.kotova@alta.example');
    await expect(dlg.getByLabel('Роль')).toHaveValue('');
    await expect(dlg.getByLabel('Роль').locator('option:checked')).toHaveText('Выберите роль');
    const area = dlg.getByRole('group', { name: 'Область действия' });
    await expect(area.getByRole('button', { name: 'Вся организация' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(area.getByRole('button', { name: 'Регион' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(area.getByRole('button', { name: 'Фирма' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(area.getByRole('button', { name: 'Касса' })).toHaveCount(0);
    await expect(dlg.getByLabel('Регион').locator('option:checked')).toHaveText('Москва');
    await expect(dlg.getByLabel('Фирма').locator('option:checked')).toHaveText('Север Логистик');
    await expect(dlg.getByLabel('Действует до')).toHaveValue('');
    await expect(dlg).toContainText('Необязательно');
    await expect(dlg).toContainText('Роль не выбрана · Москва / Север Логистик');
    await expect(dlg).toContainText('Выберите роль, чтобы увидеть итоговые права');
    await expect(dlg).toContainText('Текущие назначения');
    await expect(dlg).toContainText('Руководитель проекта · Проект');
    await expect(dlg.getByRole('button', { name: 'Отмена' })).toBeEnabled();
    await expect(dlg.getByRole('button', { name: 'Назначить' })).toBeEnabled();
  });

  test('опции «Роль»: роли организации без системной', async ({ app, page }) => {
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Марина Котова');
    expect(await options(page, dlg.getByLabel('Роль'))).toEqual([
      'Выберите роль',
      'Менеджер логистики',
      'Водитель',
      'Массажист',
      'Прораб',
      'Руководитель проекта',
      'Согласующий',
      'Исполнитель',
      'Наблюдатель',
    ]);
  });

  test('«Назначить» без роли — «Выберите роль»; выбор роли убирает ошибку (#19)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Марина Котова');
    await dlg.getByRole('button', { name: 'Назначить' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Выберите роль');
    await dlg.getByLabel('Роль').selectOption({ label: 'Менеджер логистики' });
    await expect(dlg.getByRole('alert')).toHaveCount(0);
  });

  test('итог роли «Менеджер логистики»: модули, область, начисления', async ({ app, page }) => {
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Марина Котова');
    await dlg.getByLabel('Роль').selectOption({ label: 'Менеджер логистики' });
    await expect(dlg).toContainText('Менеджер логистики · Москва / Север Логистик');
    const facts = dlg
      .getByRole('list', { name: 'Итог назначения' })
      .locator('li > span:last-child');
    await expect(facts).toHaveText([
      'Отраслевые модули: Логистика (модуль не подключён)',
      'Только Москва / Север Логистик; соседние фирмы скрыты',
      'Начисления водителям — видны в этой области',
    ]);
    await dlg.getByLabel('Роль').selectOption({ label: 'Массажист' });
    await expect(facts).toHaveText([
      'Отраслевые модули: Салон и SPA',
      'Только Москва / Север Логистик; соседние фирмы скрыты',
      'Начисления недоступны',
    ]);
  });

  test('области «Вся организация», «Регион», смена региона ставит первую фирму', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Марина Котова');
    await dlg.getByLabel('Роль').selectOption({ label: 'Менеджер логистики' });
    const area = dlg.getByRole('group', { name: 'Область действия' });
    await area.getByRole('button', { name: 'Вся организация' }).click();
    await expect(area.getByRole('button', { name: 'Вся организация' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(dlg.getByLabel('Регион')).toHaveCount(0);
    await expect(dlg).toContainText('Менеджер логистики · Вся организация');
    await expect(dlg).toContainText('Данные всех регионов и фирм организации');
    await area.getByRole('button', { name: 'Регион' }).click();
    await expect(dlg.getByLabel('Фирма')).toHaveCount(0);
    await expect(dlg).toContainText('Менеджер логистики · Регион Москва');
    await expect(dlg).toContainText('Все фирмы региона Москва; другие регионы скрыты');
    expect(await options(page, dlg.getByLabel('Регион'))).toEqual([
      'Москва',
      'Самара',
      'Санкт-Петербург',
    ]);
    await area.getByRole('button', { name: 'Фирма' }).click();
    await dlg.getByLabel('Регион').selectOption({ label: 'Самара' });
    await expect(dlg.getByLabel('Фирма').locator('option:checked')).toHaveText('Волга Логистик');
    expect(await options(page, dlg.getByLabel('Фирма'))).toEqual([
      'Волга Логистик',
      'Самара Трак',
      'Жигули Карго',
      'Приволжье Сервис',
    ]);
    await expect(dlg).toContainText('Менеджер логистики · Самара / Волга Логистик');
  });

  test('назначение: тост, диалог закрыт, строка у сотрудника (#20)', async ({ app, page }) => {
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Марина Котова');
    await dlg.getByLabel('Роль').selectOption({ label: 'Менеджер логистики' });
    await dlg.getByLabel('Действует до').fill('2026-10-31');
    await dlg.getByRole('button', { name: 'Назначить' }).click();
    await expect(toast(page)).toHaveText('Роль «Менеджер логистики» назначена');
    await expect(dlg).toBeHidden();
    await expect(personRow(page, 'Марина Котова')).toContainText(
      'Менеджер логистики· Москва / Север Логистик · до 31.10.2026',
    );
    await expect(page.getByText('10 участников · без роли: 3 · мест занято 9 из 10')).toBeVisible();
  });

  test('водитель и роль с начислениями: конфликт в итоге и ошибка сервера в диалоге (#21)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Илья Васильев');
    await dlg.getByLabel('Роль').selectOption({ label: 'Менеджер логистики' });
    await expect(dlg).toContainText(
      'Конфликт: функция «Водитель» несовместима с правом на начисления — сервер отклонит назначение',
    );
    await dlg.getByRole('button', { name: 'Назначить' }).click();
    await expect(dlg.getByRole('alert')).toContainText(
      'Функция «Водитель» несовместима с правом на начисления (правило MVP).',
    );
    await expect(toast(page)).toHaveCount(0);
    await expect(dlg).toBeVisible();
  });

  test('«Снять» у последнего владельца — тост «Нельзя снять роль с последнего владельца» (#22)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Дарья Зимина');
    const row = dlg.getByRole('listitem').filter({ hasText: 'Владелец бизнеса · Вся организация' });
    await row.getByRole('button', { name: 'Снять' }).click();
    await expect(toast(page)).toHaveText('Нельзя снять роль с последнего владельца');
    await expect(row).toBeVisible();
  });

  test('«Снять» обычное назначение: тост «Назначение снято», строка исчезла', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Анна Морозова');
    const row = dlg
      .getByRole('listitem')
      .filter({ hasText: 'Массажист · Только назначенное лично' });
    await row.getByRole('button', { name: 'Снять' }).click();
    await expect(toast(page)).toHaveText('Назначение снято');
    await expect(row).toHaveCount(0);
    await expect(dlg).toBeVisible();
  });

  test('нет связи: тост и текст в диалоге, диалог открыт', async ({ app, page }) => {
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Марина Котова');
    await dlg.getByLabel('Роль').selectOption({ label: 'Массажист' });
    await devScenario(page, { scenario: 'createAssignment=offline', once: true });
    await dlg.getByRole('button', { name: 'Назначить' }).click();
    await expect(toast(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(dlg.getByRole('alert')).toContainText(
      'Нет связи с сервером. Операция не выполнена.',
    );
    await expect(dlg).toBeVisible();
  });

  test('вход по адресу ?assign=<участник>&role=<роль> (вход «Назначить роли» с других страниц)', async ({
    app,
    page,
  }) => {
    const alta = await openUsers(app, page);
    const ids = await page.evaluate(async (t) => {
      const m = await (
        await fetch(`/api/v1/tenants/${t}/members`, { credentials: 'include' })
      ).json();
      const r = await (
        await fetch(`/api/v1/tenants/${t}/roles`, { credentials: 'include' })
      ).json();
      return {
        member: m.items.find((x: { displayName: string }) => x.displayName === 'Марина Котова').id,
        role: r.items.find((x: { name: string }) => x.name === 'Менеджер логистики').id,
      };
    }, alta);
    await app(`/t/${alta}/users?tab=people&assign=${ids.member}&role=${ids.role}`, {
      persona: 'owner',
    });
    const dlg = dialog(page, 'Назначить роль');
    await expect(dlg.getByLabel('Роль').locator('option:checked')).toHaveText('Менеджер логистики');
    await expect(dlg).toContainText('Менеджер логистики · Москва / Север Логистик');
  });

  // Возврат 16.10 №1: адрес проверяется — роль не из списка отбрасывается, заблокированному диалог не открывается.
  test('вход по адресу: системная роль отбрасывается; заблокированный участник — без диалога', async ({
    app,
    page,
  }) => {
    const alta = await openUsers(app, page);
    const ids = await page.evaluate(async (t) => {
      const m = await (
        await fetch(`/api/v1/tenants/${t}/members`, { credentials: 'include' })
      ).json();
      const r = await (
        await fetch(`/api/v1/tenants/${t}/roles`, { credentials: 'include' })
      ).json();
      const member = (n: string) =>
        m.items.find((x: { displayName: string }) => x.displayName === n).id as string;
      return {
        kotova: member('Марина Котова'),
        gromov: member('Кирилл Громов'),
        owner: r.items.find((x: { builtIn: boolean }) => x.builtIn).id as string,
      };
    }, alta);
    await app(`/t/${alta}/users?tab=people&assign=${ids.kotova}&role=${ids.owner}`, {
      persona: 'owner',
    });
    const dlg = dialog(page, 'Назначить роль');
    await expect(dlg.getByLabel('Роль').locator('option:checked')).toHaveText('Выберите роль');
    await expect(dlg).toContainText('Роль не выбрана · Москва / Север Логистик');
    await app(`/t/${alta}/users?tab=people&assign=${ids.gromov}`, { persona: 'owner' });
    await expect(personRow(page, 'Кирилл Громов')).toContainText('Заблокирован');
    await expect(dialog(page, 'Назначить роль')).toHaveCount(0);
  });
});

test.describe('people-dialogs — «Пригласить участника» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии — сценарный сервер mock');

  test('открытие: поля, «Без роли», «Область» выключена, места (#23)', async ({ app, page }) => {
    await openUsers(app, page);
    await page.getByRole('button', { name: 'Пригласить' }).click();
    const dlg = dialog(page, 'Пригласить участника');
    await expect(dlg.getByLabel('Имя и фамилия')).toHaveValue('');
    await expect(dlg.getByLabel('Электронная почта')).toHaveAttribute(
      'placeholder',
      'name@company.ru',
    );
    await expect(dlg.getByLabel('Электронная почта')).toHaveAttribute('type', 'email');
    // Возврат 16.10 №1: поле внутри <label> — цвет и насыщенность подписи (:2230–2234): 500/#3A4844.
    for (const field of ['Имя и фамилия', 'Электронная почта', 'Роль', 'Область']) {
      const look = await dlg.getByLabel(field).evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.color, s.fontWeight];
      });
      expect(look, field).toEqual(['rgb(58, 72, 68)', '500']);
    }
    await expect(dlg.getByLabel('Роль').locator('option:checked')).toHaveText(
      'Без роли — назначить позже',
    );
    await expect(dlg.getByLabel('Область')).toBeDisabled();
    await expect(dlg).toContainText(
      'Свободно мест: 1 из 10 — это последнее. Приглашение занимает место сразу, до принятия.',
    );
    await expect(dlg.getByRole('button', { name: 'Пригласить' })).toBeEnabled();
  });

  // Возврат 16.10 №1: без данных подписки места не «без ограничения» — загрузка и ошибка отдельно.
  test('места: сбой getTenantSubscription — ошибка и «Повторить», «Пригласить» недоступна', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await devScenario(page, { scenario: 'getTenantSubscription=offline' });
    await page.reload();
    await expect(page.getByText('10 участников · без роли: 3', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Пригласить' }).click();
    const dlg = dialog(page, 'Пригласить участника');
    await expect(dlg.getByRole('alert')).toContainText('Не удалось проверить свободные места.');
    await expect(dlg).not.toContainText('Мест без ограничения');
    await expect(dlg.getByRole('button', { name: 'Пригласить' })).toBeDisabled();
    await devScenario(page, { scenario: null });
    await dlg.getByRole('button', { name: 'Повторить' }).click();
    await expect(dlg).toContainText(
      'Свободно мест: 1 из 10 — это последнее. Приглашение занимает место сразу, до принятия.',
    );
    await expect(dlg.getByRole('button', { name: 'Пригласить' })).toBeEnabled();
  });

  test('«Область»: 16 вариантов после выбора роли', async ({ app, page }) => {
    await openUsers(app, page);
    await page.getByRole('button', { name: 'Пригласить' }).click();
    const dlg = dialog(page, 'Пригласить участника');
    await dlg.getByLabel('Роль').selectOption({ label: 'Менеджер логистики' });
    await expect(dlg.getByLabel('Область')).toBeEnabled();
    expect(await options(page, dlg.getByLabel('Область'))).toEqual([
      'Вся организация',
      'Москва · весь регион',
      'Москва / Север Логистик',
      'Москва / Юг Транс',
      'Москва / Восток Карго',
      'Москва / Центр Экспресс',
      'Самара · весь регион',
      'Самара / Волга Логистик',
      'Самара / Самара Трак',
      'Самара / Жигули Карго',
      'Самара / Приволжье Сервис',
      'Санкт-Петербург · весь регион',
      'Санкт-Петербург / Нева Логистик',
      'Санкт-Петербург / Балтик Транс',
      'Санкт-Петербург / Охта Карго',
      'Санкт-Петербург / Пулково Экспресс',
    ]);
    await expect(dlg.getByLabel('Область').locator('option:checked')).toHaveText(
      'Москва / Север Логистик',
    );
  });

  test('ошибки полей после первой попытки (#24)', async ({ app, page }) => {
    await openUsers(app, page);
    await page.getByRole('button', { name: 'Пригласить' }).click();
    const dlg = dialog(page, 'Пригласить участника');
    await expect(dlg.getByRole('alert')).toHaveCount(0);
    await dlg.getByRole('button', { name: 'Пригласить' }).click();
    await expect(dlg.getByText('Укажите имя')).toBeVisible();
    await expect(dlg.getByText('Укажите адрес')).toBeVisible();
    await expect(dlg.getByLabel('Имя и фамилия')).toHaveAttribute('aria-invalid', 'true');
    await expect(dlg.getByLabel('Электронная почта')).toHaveAttribute('aria-invalid', 'true');
    await dlg.getByLabel('Электронная почта').fill('abc');
    await expect(dlg.getByText('Адрес выглядит неверно: проверьте «@» и домен')).toBeVisible();
    await dlg.getByLabel('Имя и фамилия').fill('Тест');
    await expect(dlg.getByText('Укажите имя')).toHaveCount(0);
  });

  test('адрес участника: «Участник с таким адресом уже есть» в диалоге (#25)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await page.getByRole('button', { name: 'Пригласить' }).click();
    const dlg = dialog(page, 'Пригласить участника');
    await dlg.getByLabel('Имя и фамилия').fill('Тест');
    await dlg.getByLabel('Электронная почта').fill('d.zimina@alta.example');
    await dlg.getByRole('button', { name: 'Пригласить' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Участник с таким адресом уже есть');
    await expect(toast(page)).toHaveCount(0);
  });

  test('приглашение: тост, «Приглашён» в списке, 10 из 10 — «Все места тарифа заняты.» (#26)', async ({
    app,
    page,
  }) => {
    const alta = await openUsers(app, page);
    await page.getByRole('button', { name: 'Пригласить' }).click();
    let dlg = dialog(page, 'Пригласить участника');
    await dlg.getByLabel('Имя и фамилия').fill('Пётр Новый');
    await dlg.getByLabel('Электронная почта').fill('p.novy@alta.example');
    await dlg.getByRole('button', { name: 'Пригласить' }).click();
    await expect(toast(page)).toHaveText('Приглашение отправлено: p.novy@alta.example');
    await expect(dlg).toBeHidden();
    await expect(personRow(page, 'Пётр Новый')).toContainText('Приглашён');
    await expect(
      page.getByText('11 участников · без роли: 4 · мест занято 10 из 10'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Пригласить' }).click();
    dlg = dialog(page, 'Пригласить участника');
    const full = dlg.getByRole('alert').filter({ hasText: 'Все места тарифа заняты.' });
    await expect(full).toContainText(
      'Чтобы пригласить сотрудника, отзовите неактуальное приглашение, заблокируйте бывшего сотрудника или запросите тариф больше. Рабочего без входа можно вести карточкой бесплатно.',
    );
    await expect(dlg.getByRole('button', { name: 'Пригласить' })).toBeDisabled();
    await dlg.getByRole('button', { name: 'Подписка и места' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/billing$`));
  });

  test('пресет seats-full: «Все места тарифа заняты.» сразу', async ({ app, page }) => {
    await openUsers(app, page);
    await devScenario(page, { preset: 'seats-full' });
    await page.reload();
    await page.getByRole('button', { name: 'Пригласить' }).click();
    const dlg = dialog(page, 'Пригласить участника');
    await expect(
      dlg.getByRole('alert').filter({ hasText: 'Все места тарифа заняты.' }),
    ).toBeVisible();
  });

  test('«Лотос»: места 2 из 25, область «Москва / Лотос · Тверская»', async ({ app, page }) => {
    await openUsers(app, page, { persona: 'owner@t-lotos', tenant: 'SPA «Лотос»' });
    await page.getByRole('button', { name: 'Пригласить' }).click();
    const dlg = dialog(page, 'Пригласить участника');
    await expect(dlg).toContainText(
      'Свободно мест: 2 из 25. Приглашение занимает место сразу, до принятия.',
    );
    await expect(dlg.getByLabel('Область').locator('option:checked')).toHaveText(
      'Москва / Лотос · Тверская',
    );
  });
});

test.describe('people-dialogs — «Создать роль» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии — сценарный сервер mock');

  test('открытие: «Название», «Основа роли», «Пустая роль» выбрана (#33)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await page.getByRole('button', { name: 'Создать роль' }).click();
    const dlg = dialog(page, 'Создать роль');
    await expect(dlg.getByLabel('Название')).toHaveAttribute(
      'placeholder',
      'Например: Менеджер Север',
    );
    const basis = dlg.getByRole('radiogroup', { name: 'Основа роли' });
    await expect(basis.getByRole('radio', { name: /Пустая роль/ })).toBeChecked();
    await expect(basis).toContainText(
      'Ноль бизнес-разрешений. Включайте модули и действия вручную.',
    );
    await expect(basis).toContainText('Готовый набор действий отрасли. Его можно изменить.');
    await expect(basis).toContainText('Копия текущих прав роли организации.');
    await expect(dlg.getByRole('combobox')).toHaveCount(0);
  });

  test('пустое название — «Укажите название роли»', async ({ app, page }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await page.getByRole('button', { name: 'Создать роль' }).click();
    const dlg = dialog(page, 'Создать роль');
    await dlg.getByRole('button', { name: 'Создать и настроить' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Укажите название роли');
    await dlg.getByLabel('Название').fill('Диспетчер');
    await expect(dlg.getByRole('alert')).toHaveCount(0);
  });

  test('«Из шаблона» и «Скопировать существующую»: списки ролей', async ({ app, page }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await page.getByRole('button', { name: 'Создать роль' }).click();
    const dlg = dialog(page, 'Создать роль');
    await dlg.getByRole('radio', { name: /Из шаблона/ }).check();
    const tpl = dlg.getByRole('combobox', { name: 'Из шаблона' });
    await expect(tpl.locator('option:checked')).toHaveText('Менеджер логистики');
    expect(await tpl.locator('option').allTextContents()).toEqual([
      'Менеджер логистики',
      'Водитель',
      'Массажист',
      'Прораб',
      'Руководитель проекта',
      'Согласующий',
      'Исполнитель',
      'Наблюдатель',
    ]);
    await dlg.getByRole('radio', { name: /Скопировать существующую/ }).check();
    await expect(dlg.getByRole('combobox', { name: 'Из шаблона' })).toHaveCount(0);
    await expect(
      dlg.getByRole('combobox', { name: 'Скопировать существующую' }).locator('option:checked'),
    ).toHaveText('Менеджер логистики');
  });

  test('создание пустой роли: тост «Роль создана», вкладка «Роли» с новой ролью', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await tab(page, 'Роли').click();
    await page.getByRole('button', { name: 'Создать роль' }).click();
    const dlg = dialog(page, 'Создать роль');
    await dlg.getByLabel('Название').fill('Пустая');
    await dlg.getByRole('button', { name: 'Создать и настроить' }).click();
    await expect(toast(page)).toHaveText('Роль создана');
    await expect(dlg).toBeHidden();
    await expect(page).toHaveURL(/tab=roles&role=/);
    await expect(
      page.getByText(
        'Нет бизнес-разрешений. Пустая роль ничего не открывает, пока вы не включите модули и действия.',
      ),
    ).toBeVisible();
  });
});

test.describe('people-dialogs — без эталона: владение и группы @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии — сценарный сервер mock');

  test('«Передать владение»: подтверждение почтой, тост, владельцев двое (S1-16)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await personRow(page, 'Марина Котова').getByRole('button', { name: 'Марина Котова' }).click();
    await dialog(page, 'Марина Котова').getByRole('button', { name: 'Передать владение' }).click();
    const dlg = dialog(page, 'Передать владение');
    await expect(dlg).toContainText('Марина Котова · m.kotova@alta.example');
    await expect(dlg.getByRole('checkbox', { name: 'Остаться совладельцем' })).toBeChecked();
    await dlg.getByLabel('Почта получателя').fill('wrong@alta.example');
    await dlg.getByLabel('Причина').fill('Расширяем управление');
    await dlg.getByRole('button', { name: 'Передать владение' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Введите почту m.kotova@alta.example');
    await dlg.getByLabel('Почта получателя').fill('m.kotova@alta.example');
    await dlg.getByRole('button', { name: 'Передать владение' }).click();
    await expect(toast(page)).toHaveText('Владение передано: Марина Котова');
    await expect(dlg).toBeHidden();
    const card = dialog(page, 'Марина Котова');
    await expect(card).toContainText('Владелец бизнеса');
    // Возврат 16.10 №3 (major): кнопка «Передать владение» исчезла (получатель — владелец) — фокус на «Закрыть»
    // карточки, а не на body; Escape закрывает карточку.
    await expect(card.getByRole('button', { name: 'Закрыть' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(
      personRow(page, 'Марина Котова').getByRole('button', { name: 'Марина Котова' }),
    ).toBeFocused();
  });

  test('«Создать группу» и «Состав группы» (S1-13)', async ({ app, page }) => {
    await openUsers(app, page, { query: 'tab=groups' });
    await page.getByRole('button', { name: 'Создать группу' }).click();
    let dlg = dialog(page, 'Создать группу');
    await dlg.getByLabel('Название группы').fill('Логисты Самара');
    await dlg.getByRole('checkbox', { name: 'Вера Котельникова' }).check();
    await dlg.getByRole('button', { name: 'Создать группу' }).click();
    await expect(toast(page)).toHaveText('Группа «Логисты Самара» создана');
    const card = page.getByRole('article').filter({ hasText: 'Логисты Самара' });
    await expect(card).toContainText('1 участник: Вера Котельникова');
    await expect(tab(page, 'Группы')).toHaveText('Группы3');
    await card.getByRole('button', { name: 'Изменить состав' }).click();
    dlg = dialog(page, 'Состав группы «Логисты Самара»');
    await dlg.getByRole('checkbox', { name: 'Тимур Ахмедов' }).check();
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText('Состав группы «Логисты Самара» сохранён');
    await expect(card).toContainText('2 участника: Вера Котельникова, Тимур Ахмедов');
    // Возврат 16.10 №1: удаление группы — с подтверждением (verification-protocol §7).
    await card.getByRole('button', { name: 'Изменить состав' }).click();
    await dialog(page, 'Состав группы «Логисты Самара»')
      .getByRole('button', { name: 'Удалить группу' })
      .click();
    const confirm = dialog(page, 'Удалить группу «Логисты Самара»?');
    await expect(confirm).toContainText('Участники останутся в организации');
    await confirm.getByRole('button', { name: 'Отмена' }).click();
    dlg = dialog(page, 'Состав группы «Логисты Самара»');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Удалить группу' }).click();
    await dialog(page, 'Удалить группу «Логисты Самара»?')
      .getByRole('button', { name: 'Удалить группу' })
      .click();
    await expect(toast(page)).toHaveText('Группа «Логисты Самара» удалена');
    await expect(card).toHaveCount(0);
  });
});

test.describe('people-dialogs — общие свойства диалогов @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии — сценарный сервер mock');

  test('Escape и подложка закрывают; aria-modal; фокус внутри (#65, #68)', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    let dlg = await assignFor(page, 'Марина Котова');
    await expect(dlg).toHaveAttribute('aria-modal', 'true');
    await expect(dlg.getByRole('heading', { level: 2, name: 'Назначить роль' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await page.getByRole('button', { name: 'Пригласить' }).click();
    dlg = dialog(page, 'Пригласить участника');
    await page.mouse.click(5, 5);
    await expect(dlg).toBeHidden();
  });

  // Возврат 16.10 №2: основная кнопка на время запроса — aria-disabled (не disabled): фокус не уходит на body,
  // после ошибки сервера Escape закрывает диалог (verification-protocol §1.3).
  const inside = (dlg: ReturnType<typeof dialog>) =>
    dlg.evaluate((el) => el.contains(document.activeElement));

  test('ошибка сервера: фокус в диалоге, Escape закрывает — «Назначить роль»', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Марина Котова');
    await dlg.getByLabel('Роль').selectOption({ label: 'Массажист' });
    await devScenario(page, { scenario: 'createAssignment=offline', once: true });
    await dlg.getByRole('button', { name: 'Назначить' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Нет связи с сервером');
    expect(await inside(dlg)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });

  test('ошибка сервера: фокус в диалоге, Escape закрывает — «Создать роль»', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=roles' });
    await page.getByRole('button', { name: 'Создать роль' }).click();
    const dlg = dialog(page, 'Создать роль');
    await dlg.getByLabel(/^Название/).fill('Диспетчер');
    await devScenario(page, { scenario: 'createRole=offline', once: true });
    await dlg.getByRole('button', { name: 'Создать и настроить' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Нет связи с сервером');
    expect(await inside(dlg)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });

  test('ошибка сервера: фокус в диалоге, Escape закрывает — «Создать группу»', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=groups' });
    await page.getByRole('button', { name: 'Создать группу' }).click();
    const dlg = dialog(page, 'Создать группу');
    await dlg.getByLabel(/^Название группы/).fill('Логисты Самара');
    await devScenario(page, { scenario: 'createGroup=offline', once: true });
    await dlg.getByRole('button', { name: 'Создать группу' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Нет связи с сервером');
    expect(await inside(dlg)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });

  test('ошибка сервера: фокус в диалоге, Escape закрывает — «Передать владение»', async ({
    app,
    page,
  }) => {
    await openUsers(app, page);
    await personRow(page, 'Марина Котова').getByRole('button', { name: 'Марина Котова' }).click();
    await dialog(page, 'Марина Котова').getByRole('button', { name: 'Передать владение' }).click();
    const dlg = dialog(page, 'Передать владение');
    await dlg.getByLabel(/^Почта получателя/).fill('wrong@alta.example');
    await dlg.getByLabel(/^Причина/).fill('Расширяем управление');
    await dlg.getByRole('button', { name: 'Передать владение' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('Введите почту m.kotova@alta.example');
    expect(await inside(dlg)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });

  test('«Удалить группу» → «Отмена» → Escape — фокус на «Изменить состав»', async ({
    app,
    page,
  }) => {
    await openUsers(app, page, { query: 'tab=groups' });
    const edit = page
      .getByRole('article')
      .filter({ hasText: 'Диспетчеры Север' })
      .getByRole('button', { name: 'Изменить состав' });
    await edit.focus();
    await page.keyboard.press('Enter');
    const dlg = dialog(page, 'Состав группы «Диспетчеры Север»');
    await dlg.getByRole('button', { name: 'Удалить группу' }).click();
    const confirm = dialog(page, 'Удалить группу «Диспетчеры Север»?');
    await confirm.getByRole('button', { name: 'Отмена' }).click();
    await expect(confirm).toBeHidden();
    expect(await inside(dlg)).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(edit).toBeFocused();
  });

  // Возврат 16.10 №3 (minor): кнопки-источника больше нет — фокус не уходит на body (WCAG 2.4.3).
  test('«Удалить группу» подтверждено — фокус на «Создать группу»', async ({ app, page }) => {
    await openUsers(app, page, { query: 'tab=groups' });
    await page
      .getByRole('article')
      .filter({ hasText: 'Диспетчеры Север' })
      .getByRole('button', { name: 'Изменить состав' })
      .click();
    await dialog(page, 'Состав группы «Диспетчеры Север»')
      .getByRole('button', { name: 'Удалить группу' })
      .click();
    await dialog(page, 'Удалить группу «Диспетчеры Север»?')
      .getByRole('button', { name: 'Удалить группу' })
      .click();
    await expect(toast(page)).toHaveText('Группа «Диспетчеры Север» удалена');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Создать группу' })).toBeFocused();
  });

  test('диалог из адреса ?assign= — после Escape фокус на «Назначить роль» в строке', async ({
    app,
    page,
  }) => {
    const alta = await openUsers(app, page);
    const kotova = await page.evaluate(async (t) => {
      const m = await (
        await fetch(`/api/v1/tenants/${t}/members`, { credentials: 'include' })
      ).json();
      return m.items.find((x: { displayName: string }) => x.displayName === 'Марина Котова')
        .id as string;
    }, alta);
    await app(`/t/${alta}/users?tab=people&assign=${kotova}`, { persona: 'owner' });
    const dlg = dialog(page, 'Назначить роль');
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(
      personRow(page, 'Марина Котова').getByRole('button', { name: 'Назначить роль' }),
    ).toBeFocused();
  });

  test('клавиатура: Tab не выходит из диалога, кольцо фокуса', async ({ app, page }) => {
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Марина Котова');
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      expect(await dlg.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    const focused = dlg.locator(':focus');
    const outline = await focused.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('раскладка: 1440 — по центру до 620 px; 390 — лист снизу', async ({ app, page }) => {
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Марина Котова');
    const box = await dlg.boundingBox();
    const vp = page.viewportSize() ?? { width: 0, height: 0 };
    if (vp.width >= 640) {
      expect(box?.width).toBeLessThanOrEqual(620);
    } else {
      expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(vp.height);
      expect(Math.round(box?.width ?? 0)).toBe(vp.width);
    }
  });

  test('axe: диалоги назначения, приглашения и создания роли', async ({ app, page, axe }) => {
    await openUsers(app, page);
    await assignFor(page, 'Марина Котова');
    let r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Пригласить' }).click();
    await dialog(page, 'Пригласить участника').getByRole('button', { name: 'Пригласить' }).click();
    r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
  });
});

// W1.06, W1.41 — в main. Сид стенда общий для всех проектов прогона (e2e-stand: workers 1, пропусков быть не
// должно), поэтому команды возвращают сид: назначение снимается тем же тестом, владение после передачи снимается
// revokeOwnership; свободное место тарифа одно — приглашение проходит в первом проекте, дальше проверяется
// «Все места тарифа заняты.».
const NEW_OWNER = { name: 'Алексей Соколов', email: 'a.sokolov@alta.example' } as const;
test.describe('people-dialogs — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('стенд: назначить и снять роль', async ({ app, page }) => {
    test.slow();
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Тимур Ахмедов');
    await dlg.getByLabel('Роль').selectOption({ label: 'Массажист' });
    await dlg.getByRole('button', { name: 'Назначить' }).click();
    await expect(toast(page)).toHaveText('Роль «Массажист» назначена');
    await expect(personRow(page, 'Тимур Ахмедов')).toContainText(
      'Массажист· Москва / Север Логистик',
    );
    const again = await assignFor(page, 'Тимур Ахмедов');
    await again
      .getByRole('listitem')
      .filter({ hasText: 'Массажист · Москва / Север Логистик' })
      .getByRole('button', { name: 'Снять' })
      .click();
    await expect(toast(page)).toHaveText('Назначение снято');
  });

  test('стенд: водитель и роль с начислениями — ошибка сервера в диалоге', async ({
    app,
    page,
  }) => {
    test.slow();
    await openUsers(app, page);
    const dlg = await assignFor(page, 'Илья Васильев');
    await dlg.getByLabel('Роль').selectOption({ label: 'Менеджер логистики' });
    await dlg.getByRole('button', { name: 'Назначить' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Водитель');
  });

  // W1.52 (в main): listMembers отдаёт карточку с действующим приглашением как `invited` — места клиента и
  // сервера совпадают. W1.51: письмо приглашения уходит в Mailpit слота.
  test('стенд: приглашение — тост и «Приглашён», затем «Все места тарифа заняты.»', async ({
    app,
    page,
  }) => {
    test.slow();
    await openUsers(app, page);
    const seats = page.getByText(/ · мест занято \d+ из 10$/);
    await expect(seats).toBeVisible();
    if ((await seats.textContent())?.endsWith('мест занято 9 из 10')) {
      const email = `new.${runTag()}@alta.example`;
      await page.getByRole('button', { name: 'Пригласить' }).click();
      const dlg = dialog(page, 'Пригласить участника');
      await dlg.getByLabel('Имя и фамилия').fill('Новый Сотрудник');
      await dlg.getByLabel('Электронная почта').fill(email);
      await dlg.getByRole('button', { name: 'Пригласить' }).click();
      await expect(toast(page)).toHaveText(`Приглашение отправлено: ${email}`);
      await expect(dlg).toBeHidden();
    }
    await expect(personRow(page, 'Новый Сотрудник')).toContainText('Приглашён');
    await expect(seats).toHaveText(/ · мест занято 10 из 10$/);
    await page.getByRole('button', { name: 'Пригласить' }).click();
    const full = dialog(page, 'Пригласить участника');
    await expect(
      full.getByRole('alert').filter({ hasText: 'Все места тарифа заняты.' }),
    ).toBeVisible();
    await expect(full.getByRole('button', { name: 'Пригласить' })).toBeDisabled();
  });

  test('стенд: передача владения с подтверждением почтой', async ({ app, page }) => {
    test.slow();
    const to = NEW_OWNER;
    await openUsers(app, page);
    const tenant = /\/t\/([^/]+)\//.exec(new URL(page.url()).pathname)?.[1] ?? '';
    await personRow(page, to.name).getByRole('button', { name: to.name }).click();
    await dialog(page, to.name).getByRole('button', { name: 'Передать владение' }).click();
    const dlg = dialog(page, 'Передать владение');
    await dlg.getByLabel('Почта получателя').fill(to.email);
    await dlg.getByLabel('Причина').fill('Совладелец салона');
    await dlg.getByRole('button', { name: 'Передать владение' }).click();
    await expect(toast(page)).toHaveText(`Владение передано: ${to.name}`);

    // Сид — обратно: «Остаться совладельцем» отмечено, вошедший остаётся владельцем и снимает нового (204).
    const owners = await call(page, 'GET', `/api/v1/tenants/${tenant}/owners`);
    expect(owners.status).toBe(200);
    const items = (owners.body as { items: { memberId: string; email: string }[] }).items;
    const added = items.find((o) => o.email === to.email);
    expect(added, `${to.email} среди владельцев`).toBeDefined();
    expect(items.length).toBeGreaterThan(1);
    const revoked = await call(
      page,
      'DELETE',
      `/api/v1/tenants/${tenant}/owners/${added?.memberId}`,
    );
    expect(revoked.status).toBe(204);
  });
});
