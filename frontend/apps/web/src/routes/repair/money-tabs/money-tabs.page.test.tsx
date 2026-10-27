// W6.24 · Экранные тесты вкладок объекта на сценарном сервере (MSW repairs W6.00, пресет repairs-ready, кв. 42 «Альты»):
// «Документы», «Финансы», «Оплата бригады», «Подрядчики», «Кабинет заказчика»; вкладки карточки объекта W6.20 — `?obj=&tab=`.
// Подписи — дословно из «Ремонт и стройка.dc.html» (design-2026-10-19).
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { type MockApp, type MockAppOptions, renderMockApp } from '../../../app/testing.tsx';

const SLOW = { timeout: 8_000 };
const ALTA = seedUuid('platform', 't-alta');
const A = (id: string): string => seedUuid('t-alta', id);
const OBJ = A('obj-42');
const BASE = 'http://ortus.test';
const nb = (s: string): string => s.replace(/(\d) (?=\d{3}\b)/g, '$1\u00A0');

beforeAll(() => {
  globalThis.CSS ??= {} as typeof CSS;
  globalThis.CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

type Tab = 'docs' | 'finance' | 'pay' | 'subs' | 'client';
const H2: Record<Tab, string> = {
  docs: 'Документы',
  finance: 'Финансы объекта',
  pay: 'Оплата бригады',
  subs: 'Подрядчики',
  client: 'Кабинет заказчика',
};

const open = async (tab: Tab, o: MockAppOptions = {}, heading = H2[tab]): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/repair?obj=${OBJ}&tab=${tab}`, {
    persona: 'owner',
    preset: 'repairs-ready',
    ...o,
  });
  await screen.findByRole('heading', { level: 2, name: heading }, SLOW);
  await waitFor(() => expect(screen.queryByLabelText('Загрузка')).toBeNull(), SLOW);
  return app;
};

const toast = (): string | null | undefined =>
  document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const goTab = (name: string): void => {
  fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${name}`) }));
};
const docRow = (title: string | RegExp): Promise<HTMLElement> =>
  screen.findByText(title, undefined, SLOW).then((x) => x.closest('li') as HTMLElement);

/** Акт № 1 подписан заказчиком прямо в состоянии сервера (после первого запроса данные ремонта уже созданы). */
function signActInState(a: MockApp): void {
  const org = a.scenario.state().orgs[ALTA] as unknown as {
    repairs: { docs: { id: string; state: string }[] };
  };
  const d = org.repairs.docs.find((x) => x.id === A('doc-42-act1'));
  if (!d) throw new Error('нет акта № 1 в состоянии');
  d.state = 'signed';
}

/** Публичная подпись заказчиком по ссылке кабинета (код заглушки порта SMS). */
async function clientSigns(documentId: string): Promise<void> {
  const r = await fetch(
    `${BASE}/api/v1/public/client/cab-${A('cl-42')}/documents/${documentId}/sign`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ smsCode: '482910' }),
    },
  );
  if (r.status !== 200) throw new Error(`подпись: ${r.status} ${await r.text()}`);
}

describe('вкладки денег в карточке объекта', () => {
  it('переключение вкладки меняет адрес и раздел', async () => {
    const a = await open('docs');
    goTab('Подрядчики');
    await screen.findByRole('heading', { level: 2, name: 'Подрядчики' }, SLOW);
    expect(a.router.state.location.search).toMatchObject({ tab: 'subs', obj: OBJ });
  });

  it('владелец: в карточке есть все пять вкладок денег, текущая выбрана', async () => {
    await open('finance');
    const tabs = screen.getAllByRole('tab').map((b) => b.textContent ?? '');
    for (const name of [
      'Документы',
      'Финансы',
      'Оплата бригады',
      'Подрядчики',
      'Кабинет заказчика',
    ])
      expect(tabs.some((x) => x.startsWith(name))).toBe(true);
    expect(screen.getByRole('tab', { name: /^Финансы/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('прораб: вкладок «Финансы», «Оплата бригады», «Подрядчики», «Кабинет заказчика» нет; «Документы» есть', async () => {
    await open('docs', { persona: 'foreman' });
    const names = screen.getAllByRole('tab').map((b) => b.textContent ?? '');
    expect(names.some((x) => x.startsWith('Документы'))).toBe(true);
    for (const hidden of ['Финансы', 'Оплата бригады', 'Подрядчики', 'Кабинет заказчика'])
      expect(names.some((x) => x.startsWith(hidden))).toBe(false);
  });
});
describe('repair-docs — «Документы»', () => {
  it('заголовок, пояснение, документы с чипами и сноска про подпись', async () => {
    await open('docs');
    expect(
      screen.getByText(
        'Договор, акты и счета собираются из сметы по шаблонам. Заказчик подписывает в кабинете кодом из SMS. Закрытый акт двигает готовность объекта и открывает оплату бригаде.',
      ),
    ).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Документы объекта' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((r) => r.querySelector('.ox-mt-name')?.textContent)).toEqual([
      'Договор подряда № 42',
      'Счёт № 1 · аванс 30%',
      'Акт № 1 · демонтаж',
      'Акт № 2 · электрика',
      'Акт сдачи объекта',
    ]);
    expect(within(rows[0] as HTMLElement).getByText('Подписан')).toBeTruthy();
    expect(within(rows[0] as HTMLElement).getByText('Из сметы v2 · 01.10')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Оплачен')).toBeTruthy();
    expect(within(rows[1] as HTMLElement).getByText('Оплачен 02.10')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('Готов к отправке')).toBeTruthy();
    expect(within(rows[3] as HTMLElement).getByText('Этап не закрыт')).toBeTruthy();
    expect(
      screen.getByText(
        'Подпись кодом из SMS — простая электронная подпись. Её юридическую силу нужно закрепить в договоре с заказчиком; это вопрос к юристу.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Демо/ })).toBeNull();
  });

  it('«Отправить на подпись» только у готовых документов (акт № 1 и акт сдачи)', async () => {
    await open('docs');
    const buttons = screen.getAllByRole('button', { name: /^Отправить на подпись/ });
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Отправить на подпись',
      'Отправить на подпись',
    ]);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Отправить на подпись: Акт № 1 · демонтаж',
      'Отправить на подпись: Акт сдачи объекта',
    ]);
  });

  it('отправка на подпись: тост, чип «Ждёт подписи заказчика», кнопка уходит', async () => {
    await open('docs');
    fireEvent.click(
      screen.getByRole('button', { name: 'Отправить на подпись: Акт № 1 · демонтаж' }),
    );
    await waitFor(
      () => expect(toast()).toBe('Акт № 1 · демонтаж отправлен на подпись заказчику'),
      SLOW,
    );
    const row = await docRow('Акт № 1 · демонтаж');
    await waitFor(() => expect(within(row).getByText('Ждёт подписи заказчика')).toBeTruthy(), SLOW);
    expect(within(row).getByText('Отправлен в кабинет заказчика')).toBeTruthy();
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('после «Отправить на подпись» фокус уходит на строку документа, а не на body', async () => {
    await open('docs');
    fireEvent.click(
      screen.getByRole('button', { name: 'Отправить на подпись: Акт № 1 · демонтаж' }),
    );
    const row = await docRow('Акт № 1 · демонтаж');
    await waitFor(() => expect(within(row).queryByRole('button')).toBeNull(), SLOW);
    await waitFor(() => expect(document.activeElement).toBe(row), SLOW);
  });

  it('акт сдачи подписан заказчиком: «Сдать объект» с подтверждением, после сдачи — гарантия', async () => {
    const a = await open('docs');
    fireEvent.click(
      screen.getByRole('button', { name: 'Отправить на подпись: Акт сдачи объекта' }),
    );
    await waitFor(
      () => expect(toast()).toBe('Акт сдачи объекта отправлен на подпись заказчику'),
      SLOW,
    );
    await clientSigns(A('doc-42-handover'));
    goTab('Подрядчики');
    await screen.findByRole('heading', { level: 2, name: 'Подрядчики' }, SLOW);
    goTab('Документы');
    const handOver = await screen.findByRole('button', { name: 'Сдать объект' }, SLOW);
    fireEvent.click(handOver);
    const dlg = await screen.findByRole('dialog', undefined, SLOW);
    expect(within(dlg).getByRole('heading', { name: 'Сдать объект заказчику?' })).toBeTruthy();
    fireEvent.click(within(dlg).getByRole('button', { name: 'Сдать объект' }));
    await waitFor(() => expect(toast()).toBe('Объект сдан заказчику'), SLOW);
    await waitFor(
      () => expect(screen.queryByRole('button', { name: 'Сдать объект' })).toBeNull(),
      SLOW,
    );
    expect(a.responses().some((r) => r.path.endsWith('/hand-over') && r.status === 200)).toBe(true);
  });

  it('прораб: документы видны, кнопок действий нет, сумм нет', async () => {
    await open('docs', { persona: 'foreman' });
    expect(screen.queryByRole('button', { name: /Отправить на подпись/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сдать объект' })).toBeNull();
    expect(document.body.textContent).not.toContain('₽');
  });
});

describe('repair-finance — «Финансы объекта»', () => {
  it('четыре карточки эталона и «Движение денег»', async () => {
    await open('finance');
    expect(
      screen.getByText(
        'Видят владелец и роли с правом «Финансы объектов». Прорабу, бригаде и подрядчикам раздел недоступен.',
      ),
    ).toBeTruthy();
    const cards = screen.getByRole('list', { name: 'Показатели объекта' });
    const text = (label: string): string =>
      within(cards).getByText(label).closest('li')?.textContent ?? '';
    expect(text('Договор')).toContain(nb('438 175 ₽'));
    expect(text('Договор')).toContain('по смете версии 2');
    expect(text('Получено от заказчика')).toContain(nb('131 453 ₽'));
    expect(text('Получено от заказчика')).toContain('аванс 30%');
    expect(text('Расходы')).toContain('материалы, бригада, подрядчик');
    expect(text('Маржа план')).toContain(nb('118 307 ₽'));
    expect(text('Маржа план')).toContain('27% · факт после закрытия');
    expect(screen.getByText('Движение денег')).toBeTruthy();
    const rows = within(screen.getByRole('list', { name: 'Движение денег' })).getAllByRole(
      'listitem',
    );
    expect(rows.length).toBeGreaterThan(1);
    expect(rows[0]?.textContent).toContain('02.10');
    expect(rows[0]?.textContent).toContain('Счёт № 1 · аванс 30%');
    expect(rows[0]?.textContent).toContain(nb('+131 453 ₽'));
  });

  it('прораб: прямой вход на «Финансы» — вкладки нет, карточка показывает обзор, сумм нет', async () => {
    app = await renderMockApp(`/t/${ALTA}/repair?obj=${OBJ}&tab=finance`, {
      persona: 'foreman',
      preset: 'repairs-ready',
    });
    await screen.findByRole('heading', { level: 1, name: 'ЖК Речной · квартира 42' }, SLOW);
    expect(screen.queryByRole('tab', { name: /^Финансы/ })).toBeNull();
    expect(screen.queryByText('Движение денег')).toBeNull();
  });

  it('ошибка загрузки: баннер и «Повторить»', async () => {
    await open('docs', { scenario: 'getProjectFinance=rate_limited' });
    goTab('Финансы');
    expect(await screen.findByRole('alert', undefined, SLOW)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeTruthy();
  });
});

describe('repair-pay — «Оплата бригады»', () => {
  it('таблица, три исполнителя «Ждёт закрытия акта», подсказка про акт № 1, действий нет', async () => {
    await open('pay');
    expect(
      screen.getByText(
        'Сдельно по закрытым актам. Исполнитель видит только свои начисления. Выплата проходит через кассу, самозанятым нужен чек из «Мой налог».',
      ),
    ).toBeTruthy();
    const table = screen.getByRole('table', { name: 'Начисления бригаде' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Исполнитель', 'Работы по акту', 'Сумма', 'Статус']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('Иван Петров');
    expect(rows[0]?.textContent).toContain(nb('19 800 ₽'));
    expect(within(table).getAllByText('Ждёт закрытия акта')).toHaveLength(3);
    expect(
      screen.getByText(
        'Начисление откроется после подписания акта № 1 заказчиком (раздел «Документы»).',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Начислить/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Провести выплату/ })).toBeNull();
  });

  it('прокручиваемая обёртка таблицы доступна с клавиатуры: tabindex 0, region с подписью', async () => {
    await open('pay');
    const table = screen.getByRole('table', { name: 'Начисления бригаде' });
    const wrap = table.closest('.ox-mt-scroll') as HTMLElement;
    expect(wrap.getAttribute('tabindex')).toBe('0');
    expect(wrap.getAttribute('role')).toBe('region');
    expect(wrap.getAttribute('aria-label')).toBe('Начисления бригаде');
  });

  it('акт подписан: начисление, затем выплата через кассу — предложением', async () => {
    const a = await open('pay');
    signActInState(a);
    goTab('Документы');
    await screen.findByRole('heading', { level: 2, name: 'Документы' }, SLOW);
    goTab('Оплата бригады');
    const accrue = await screen.findByRole('button', { name: 'Начислить по акту № 1' }, SLOW);
    fireEvent.click(accrue);
    await waitFor(() => expect(toast()).toBe('Начислено по акту № 1'), SLOW);
    await waitFor(() => expect(screen.getAllByText('Начислено').length).toBeGreaterThan(0), SLOW);
    expect(screen.queryByRole('button', { name: /Начислить по акту/ })).toBeNull();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Провести выплату через кассу' }, SLOW),
    );
    await waitFor(() => expect(toast()).toBe('Выплата передана в кассу'), SLOW);
    await waitFor(
      () => expect(screen.getAllByText('Ждёт проведения в кассе')).toHaveLength(3),
      SLOW,
    );
    expect(screen.getByText('Выплаты проведены, операции появились в кассе.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Провести выплату через кассу' })).toBeNull();
  });
});

describe('repair-subs — «Подрядчики»', () => {
  it('карточка подрядчика: доступ, договор, оплачено', async () => {
    await open('subs');
    expect(
      screen.getByText(
        'Подрядчик получает временный доступ только к своему объекту и своим работам: отметки, фото, акты. Цены заказчика и финансы объекта ему не видны.',
      ),
    ).toBeTruthy();
    const card = (await screen.findByText('ООО «ЭлектроПрофи»', undefined, SLOW)).closest(
      'li',
    ) as HTMLElement;
    expect(within(card).getByText('Электромонтаж: 38 точек, щиток')).toBeTruthy();
    expect(within(card).getByText('Доступ к объекту до 31.10: отметки, фото, акты')).toBeTruthy();
    expect(card.textContent).toContain(nb('Договор: 45 600 ₽'));
    expect(card.textContent).toContain(nb('Оплачено 20 000 ₽'));
  });

  it('«Закрыть доступ» — красная рамка на белом (эталон :584), не залитая danger-кнопка', async () => {
    await open('subs');
    const close = await screen.findByRole('button', { name: 'Закрыть доступ' }, SLOW);
    expect(close.getAttribute('data-variant')).not.toBe('danger');
    expect(close.getAttribute('data-tone')).toBe('danger');
  });

  it('«Закрыть доступ» → «Доступ закрыт» → «Открыть доступ до …» → доступ снова открыт', async () => {
    await open('subs');
    fireEvent.click(await screen.findByRole('button', { name: 'Закрыть доступ' }, SLOW));
    await waitFor(() => expect(toast()).toBe('Доступ подрядчика закрыт'), SLOW);
    expect(await screen.findByText('Доступ закрыт', undefined, SLOW)).toBeTruthy();
    const reopen = await screen.findByRole(
      'button',
      { name: /^Открыть доступ до \d\d\.\d\d$/ },
      SLOW,
    );
    fireEvent.click(reopen);
    await waitFor(() => expect(toast()).toBe('Доступ подрядчика открыт'), SLOW);
    expect(
      await screen.findByText(
        /^Доступ к объекту до \d\d\.\d\d: отметки, фото, акты$/,
        undefined,
        SLOW,
      ),
    ).toBeTruthy();
  });
});

describe('repair-client — «Кабинет заказчика»', () => {
  it('ссылка действует, превью 420 px: готовность, этапы, оплачено; «Подписать по SMS» — не кнопка', async () => {
    await open('client');
    expect(
      screen.getByText(
        'Заказчик открывает по личной ссылке без регистрации и места в тарифе не занимает. Подпись документов — кодом из SMS на номер из договора.',
      ),
    ).toBeTruthy();
    expect(
      await screen.findByText(
        'Ссылка отправлена Ольге Смирновой по SMS 01.10 и действует до сдачи объекта.',
        undefined,
        SLOW,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Отозвать ссылку' })).toBeTruthy();
    const preview = screen.getByRole('group', { name: 'Так заказчик видит кабинет' });
    expect(within(preview).getByText('Альта Групп · ремонт')).toBeTruthy();
    expect(within(preview).getByText('ЖК Речной · квартира 42')).toBeTruthy();
    expect(within(preview).getByText(/^Здравствуйте, Ольга! Готовность \d+%$/)).toBeTruthy();
    for (const stage of [
      'Демонтаж',
      'Электрика · черновая',
      'Штукатурка стен',
      'Стяжка пола',
      'Сдача объекта',
    ]) {
      expect(within(preview).getByText(stage)).toBeTruthy();
    }
    expect(within(preview).getByText('Оплачено')).toBeTruthy();
    expect(preview.textContent).toContain(nb('131 453 ₽ из 438 175 ₽'));
    expect(within(preview).queryByRole('button')).toBeNull();
    expect(within(preview).queryByText('Подписать по SMS')).toBeNull();
  });

  it('документ ждёт подписи: в превью жёлтый блок и «Подписать по SMS» текстом', async () => {
    await open('docs');
    fireEvent.click(
      screen.getByRole('button', { name: 'Отправить на подпись: Акт № 1 · демонтаж' }),
    );
    await waitFor(
      () => expect(toast()).toBe('Акт № 1 · демонтаж отправлен на подпись заказчику'),
      SLOW,
    );
    goTab('Кабинет заказчика');
    const preview = await screen.findByRole('group', { name: 'Так заказчик видит кабинет' }, SLOW);
    expect(
      await within(preview).findByText('Акт № 1 · демонтаж ждёт вашей подписи', undefined, SLOW),
    ).toBeTruthy();
    const sign = within(preview).getByText('Подписать по SMS');
    expect(sign.tagName).toBe('SPAN');
  });

  it('«Отозвать ссылку» → текст отзыва, превью исчезает → «Выпустить новую ссылку» → адрес и «Скопировать»', async () => {
    const a = await open('client');
    fireEvent.click(await screen.findByRole('button', { name: 'Отозвать ссылку' }, SLOW));
    await waitFor(() => expect(toast()).toBe('Ссылка отозвана'), SLOW);
    expect(
      await screen.findByText(
        'Ссылка отозвана: по старой ссылке кабинет не открывается.',
        undefined,
        SLOW,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Так заказчик видит кабинет' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Выпустить новую ссылку' }));
    await waitFor(() => expect(toast()).toBe('Новая ссылка выпущена'), SLOW);
    const url = await screen.findByText(/^https:\/\/crm\.ortus\.example\/c\/cab-/, undefined, SLOW);
    expect(url).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Скопировать' })).toBeTruthy();
    expect(
      await screen.findByText(
        /^Ссылка отправлена Ольге Смирновой по SMS \d\d\.\d\d/,
        undefined,
        SLOW,
      ),
    ).toBeTruthy();
    expect(
      a
        .responses()
        .filter((r) => r.path.endsWith('/client-link') && r.method !== 'GET')
        .map((r) => r.status),
    ).toEqual([204, 201]);
  });
});
