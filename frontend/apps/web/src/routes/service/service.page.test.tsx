// W7.32 · Экранные тесты страницы `service` «Обращения» (`/t/:tenantId/service`; эталон design-2026-10-19
// «Обращения.dc.html», разбор docs/plan/v2/analysis/dor/service.md §1.1). Сеть — сценарный сервер W7.00 (контракт
// 0.12.0-stage7) на сиде «Альты»: 4 направления, 8 обращений (открытых 7), 2 низкие оценки, «сейчас» 1.10 16:24.
// Персонажи: владелец (все направления, телефон по canContacts), логист Котова (только «Грузоперевозки»), массажистка
// (нет права — «Нет доступа»), владелец «Лотоса» (направлений нет — «Обращения не настроены»).
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const LOTOS = seedUuid('platform', 't-lotos');
const SLOW = { timeout: 8_000 };

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Persona = 'owner' | 'manager' | 'therapist' | 'owner@t-lotos';

const open = async (persona: Persona = 'owner', search = '', tenant = ALTA): Promise<MockApp> => {
  app = await renderMockApp(`/t/${tenant}/service${search}`, { persona });
  await screen.findByRole('heading', { level: 1, name: 'Обращения' }, { timeout: 20_000 });
  return app;
};

const section = () => document.querySelector<HTMLElement>('section.ox-sv') as HTMLElement;
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const rows = () => [...section().querySelectorAll<HTMLElement>('.ox-sv-row:not(.ox-sv-thead)')];
const keys = () => rows().map((r) => r.querySelector('.ox-sv-key')?.textContent);
const ready = () => waitFor(() => expect(rows().length).toBeGreaterThan(0), SLOW);
const rowOf = (key: string) =>
  rows().find((r) => r.querySelector('.ox-sv-key')?.textContent === key);
const press = (name: RegExp | string, scope: HTMLElement = section()) =>
  fireEvent.click(within(scope).getAllByRole('button', { name })[0] as HTMLElement);
const nav = () =>
  within(within(section()).getByRole('navigation', { name: 'Направления и очереди' }));
const queue = async (label: RegExp) => {
  fireEvent.click(nav().getByRole('button', { name: label }));
};
const field = (label: RegExp | string, scope: HTMLElement = section()) =>
  within(scope).getByLabelText(label) as HTMLInputElement;
const type = (label: RegExp | string, value: string, scope: HTMLElement = section()) =>
  fireEvent.change(field(label, scope), { target: { value } });
const openCard = async (key: string) => {
  await ready();
  fireEvent.click(rowOf(key)?.querySelector('.ox-sv-key') as HTMLElement);
  await waitFor(() => expect(section().querySelector('.ox-sv-cardbody')).toBeTruthy(), SLOW);
};
const cardText = () => section().querySelector('.ox-sv-cardbody')?.textContent ?? '';
const alertText = (scope: HTMLElement = section()) =>
  within(scope).getByRole('alert').querySelector('.ox-sv-alert-text')?.textContent;
/** Текст без имён значков (Material Symbols — лигатуры в 	extContent). */
const txt = (el: Element | null | undefined): string => {
  if (!el) return '';
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('.material-symbols-rounded').forEach((i) => i.remove());
  return c.textContent ?? '';
};
const status = () =>
  txt(section().querySelector('.ox-sv-cardhead .ox-sv-chiprow .ox-sv-chip:nth-of-type(3)'));

describe('«Обращения»: очередь', () => {
  it('владелец: шапка, подзаголовок, кнопка звонка, навигация со счётчиками, строки по самому раннему сроку', async () => {
    await open();
    await ready();
    expect(section().textContent).toContain(
      'Все мои направления · открытые · сначала самый ранний срок',
    );
    expect(within(section()).getByRole('button', { name: 'Обращение по звонку' })).toBeTruthy();
    const groups = [...section().querySelectorAll('.ox-sv-navgroup')].map((g) => txt(g));
    expect(groups[0]).toBe('НаправленияВсе мои7Массаж2Косметология1Отделка2Грузоперевозки2');
    expect(groups[1]).toContain('Открытые7');
    expect(groups[1]).toContain('Без ответа4');
    expect(groups[1]).toContain('Срок нарушен1');
    expect(groups[1]).toContain('Низкие оценки2');
    expect(groups[1]).toContain('Решено и закрыто1');
    expect(keys()).toEqual(['ГРЗ-57', 'МАС-41', 'МАС-40', 'КОС-6', 'ОТД-12', 'ОТД-11', 'ГРЗ-55']);
    expect(rowOf('ГРЗ-57')?.textContent).toContain('Первый ответпросрочен на 1 ч 10 мин');
    expect(rowOf('ГРЗ-57')?.getAttribute('data-late')).toBe('true');
    expect(rowOf('ГРЗ-55')?.textContent).toContain('Паузаждём клиента');
    expect(rowOf('МАС-41')?.textContent).toContain('SMS · оценка 2 из 5');
    expect(rowOf('МАС-40')?.textContent).toContain('Без привязки');
  });

  it('очереди: «Срок нарушен», «Ждут клиента», «Решено и закрыто», пустая «Срок под угрозой»', async () => {
    await open();
    await ready();
    await queue(/^Срок нарушен/);
    await waitFor(() => expect(keys()).toEqual(['ГРЗ-57']), SLOW);
    expect(section().textContent).toContain('Все мои направления · срок нарушен ·');
    await queue(/^Ждут клиента/);
    await waitFor(() => expect(keys()).toEqual(['ГРЗ-55']), SLOW);
    await queue(/^Срок под угрозой/);
    await waitFor(() => expect(section().textContent).toContain('В этой очереди пусто'), SLOW);
    await queue(/^Решено и закрыто/);
    await waitFor(() => expect(rows()).toHaveLength(1), SLOW);
    expect(rows()[0]?.textContent).toContain('Решено');
  });

  it('направление «Массаж»: подзаголовок и строки; поиск и фильтры «Тип», «Канал»', async () => {
    await open();
    await ready();
    fireEvent.click(nav().getByRole('button', { name: /^Массаж/ }));
    await waitFor(() => expect(keys()).toEqual(['МАС-41', 'МАС-40']), SLOW);
    expect(section().textContent).toContain('Массаж · открытые · сначала самый ранний срок');
    fireEvent.click(nav().getByRole('button', { name: /^Все мои/ }));
    await waitFor(() => expect(keys()).toHaveLength(7), SLOW);
    type('Поиск', 'Гусева');
    await waitFor(() => expect(keys()).toEqual(['ГРЗ-57']), SLOW);
    type('Поиск', '');
    type('Тип', 'question');
    await waitFor(() => expect(keys()).toEqual(['МАС-40']), SLOW);
    type('Тип', '');
    type('Канал', 'sms');
    await waitFor(() => expect(keys()).toEqual(['МАС-41']), SLOW);
    const opts = [...field('Канал').querySelectorAll('option')].map((o) => o.textContent);
    expect(opts).toEqual([
      'Все каналы',
      'SMS',
      'Бот в Telegram',
      'Кабинет заказчика',
      'Виджет на сайте',
      'Звонок',
      'QR в салоне',
    ]);
  });

  it('«Взять себе» назначает на себя, ссылка пропадает', async () => {
    await open();
    await ready();
    press('Взять себе', rowOf('КОС-6') as HTMLElement);
    await waitFor(() => expect(toast()).toBe('КОС-6 назначено на вас'), SLOW);
    await waitFor(() => expect(rowOf('КОС-6')?.textContent).toContain('Дарья Зимина'), SLOW);
    expect(
      within(rowOf('КОС-6') as HTMLElement).queryByRole('button', { name: 'Взять себе' }),
    ).toBeNull();
  });

  it('строка открывает карточку, «Очередь» возвращает в список', async () => {
    await open();
    await openCard('ОТД-11');
    expect(cardText()).toContain('Претензия по качеству или срокам');
    expect(section().querySelector('.ox-sv-cardtitle')?.textContent).toBe(
      'Прошу уменьшить цену: перепад ламината в коридоре',
    );
    press('Очередь');
    await waitFor(() => expect(rows().length).toBeGreaterThan(0), SLOW);
  });

  it('диплинк ?open=<id> открывает карточку', async () => {
    await open('owner', `?open=${seedUuid('t-alta', 'r-o11')}`);
    await waitFor(() => expect(section().querySelector('.ox-sv-cardbody')).toBeTruthy(), SLOW);
    expect(section().querySelector('.ox-sv-key')?.textContent).toBe('ОТД-11');
  });
});

describe('«Обращения»: «Низкие оценки»', () => {
  it('две оценки: балл, клиент, причины; «Просмотрено» убирает оценку', async () => {
    await open();
    await ready();
    await queue(/^Низкие оценки/);
    await waitFor(() => expect(section().querySelectorAll('.ox-sv-rating')).toHaveLength(2), SLOW);
    expect(section().textContent).toContain(
      'Оценки 1–3, где клиент не просил связаться. Срока ответа нет: решите, открыть жалобу или отметить просмотренной.',
    );
    press('Просмотрено');
    await waitFor(() => expect(toast()).toBe('Оценка отмечена просмотренной'), SLOW);
    await waitFor(() => expect(section().querySelectorAll('.ox-sv-rating')).toHaveLength(1), SLOW);
  });

  it('«Открыть жалобу» заводит обращение и открывает карточку', async () => {
    await open();
    await ready();
    await queue(/^Низкие оценки/);
    await waitFor(() => expect(section().querySelectorAll('.ox-sv-rating')).toHaveLength(2), SLOW);
    press('Открыть жалобу');
    await waitFor(() => expect(section().querySelector('.ox-sv-cardbody')).toBeTruthy(), SLOW);
    expect(status()).toBe('В работе');
  });
});

describe('«Обращения»: «Обращение по звонку»', () => {
  it('проверка полей, подсказка, заведено → карточка с записью «Заведено по звонку»', async () => {
    await open();
    await ready();
    press('Обращение по звонку');
    const panel = section().querySelector('.ox-sv-call') as HTMLElement;
    // axe heading-order: после h1 страницы заголовок панели — h2, не h3
    expect(panel.querySelector('h3')).toBeNull();
    expect(panel.querySelector('h2')?.textContent).toBe('Обращение по звонку');
    fireEvent.change(field('Направление', panel), {
      target: { value: seedUuid('t-alta', 'd-grz') },
    });
    await waitFor(() =>
      expect(panel.textContent).toContain(
        'Канал «звонок», исполнитель — вы. Первый ответ — 4 ч в рабочем времени направления, по закону — 30 дней.',
      ),
    );
    press('Завести обращение', panel);
    await waitFor(() => expect(alertText(panel)).toBeTruthy(), SLOW);
    type('Клиент', 'Пётр Иванов', panel);
    type('Телефон', '+7 900 111-22-33', panel);
    type('Что случилось', 'Не доехал груз', panel);
    press('Завести обращение', panel);
    await waitFor(() => expect(toast()).toBe('Обращение заведено'), SLOW);
    await waitFor(() => expect(section().querySelector('.ox-sv-cardbody')).toBeTruthy(), SLOW);
    expect(cardText()).toContain('Пётр Иванов');
    expect(cardText()).toContain('Заведено по звонку');
    expect(status()).toBe('В работе');
  });

  it('«Отмена» закрывает панель', async () => {
    await open();
    await ready();
    press('Обращение по звонку');
    const panel = section().querySelector('.ox-sv-call') as HTMLElement;
    press('Отмена', panel);
    expect(section().querySelector('.ox-sv-call')).toBeNull();
  });
});

describe('«Обращения»: карточка, статусы', () => {
  it('ГРЗ-57: действия «Новое», «Взять в работу» → «Ждём клиента» → «Вернуть в работу»', async () => {
    await open();
    await openCard('ГРЗ-57');
    const acts = [...section().querySelectorAll('.ox-sv-acts button')].map((b) => txt(b));
    expect(acts).toEqual(['Взять в работу', 'Ждём клиента', 'Решено…', 'В другое направление…']);
    press('Взять в работу');
    await waitFor(() => expect(toast()).toBe('ГРЗ-57 в работе'), SLOW);
    await waitFor(() => expect(status()).toBe('В работе'), SLOW);
    press('Ждём клиента');
    await waitFor(() => expect(toast()).toBe('Срок на паузе: ждём клиента'), SLOW);
    await waitFor(() => expect(status()).toBe('Ждёт клиента'), SLOW);
    expect(cardText()).toContain('на паузе');
    press('Вернуть в работу');
    await waitFor(() => expect(toast()).toBe('Срок снова идёт'), SLOW);
    await waitFor(() => expect(status()).toBe('В работе'), SLOW);
  });

  it('«Решено…»: без итога ошибка, итог → «решено», «Закрыть», закрытое без ответа', async () => {
    await open();
    await openCard('ГРЗ-57');
    press('Решено…');
    const panel = section().querySelector('section[aria-label="Итог решения"]') as HTMLElement;
    expect(
      within(panel)
        .getAllByRole('radio')
        .map((b) => b.textContent),
    ).toEqual(['Устранено', 'Разъяснено', 'Компенсация', 'Не подтвердилось', 'Дубль']);
    press('Решить', panel);
    await waitFor(() => expect(alertText(panel)).toBe('Выберите итог решения'));
    fireEvent.click(within(panel).getByRole('radio', { name: 'Устранено' }));
    press('Решить', panel);
    await waitFor(() => expect(toast()).toBe('ГРЗ-57 решено'), SLOW);
    await waitFor(() => expect(status()).toBe('Решено'), SLOW);
    expect(cardText()).toContain('Итог: Устранено.');
    press('Закрыть');
    await waitFor(() => expect(toast()).toBe('ГРЗ-57 закрыто'), SLOW);
    await waitFor(
      () =>
        expect(cardText()).toContain('Обращение закрыто: ответы и заметки больше не добавляются.'),
      SLOW,
    );
    expect(within(section()).queryByRole('tablist')).toBeNull();
  });

  it('перенос: «В другое направление…» → новый номер', async () => {
    await open();
    await openCard('ГРЗ-57');
    press('В другое направление…');
    const panel = section().querySelector(
      'section[aria-label="Перенести в другое направление"]',
    ) as HTMLElement;
    expect(panel.textContent).toContain(
      'Обращение получит номер нового направления. Старый номер будет вести на новый, клиенту уйдёт сообщение.',
    );
    press('Перенести', panel);
    await waitFor(() => expect(toast()).toMatch(/^Новый номер: МАС-\d+$/), SLOW);
    await waitFor(
      () =>
        expect(section().querySelector('.ox-sv-cardhead .ox-sv-key')?.textContent).toMatch(/^МАС-/),
      SLOW,
    );
    expect(cardText()).toContain('прежний номер ГРЗ-57');
  });
});

describe('«Обращения»: карточка, ответ и заметка', () => {
  it('пустой ответ — ошибка; шаблон подставляет имя и номер; ответ уходит клиенту', async () => {
    await open();
    await openCard('МАС-40');
    press('Отправить', section().querySelector('.ox-sv-compose') as HTMLElement);
    await waitFor(() => expect(alertText()).toBe('Напишите текст ответа'));
    press('Шаблоны ответов');
    press(/Принять|Приняли в работу/);
    const area = field('Ответ клиенту') as unknown as HTMLTextAreaElement;
    expect(area.value).toMatch(/^Екатерина, приняли ваше обращение МАС-40\. Ответим /);
    press('Отправить', section().querySelector('.ox-sv-compose') as HTMLElement);
    await waitFor(() => expect(toast()).toBe('Ответ отправлен клиенту'), SLOW);
    await waitFor(() => expect(cardText()).toContain('Клиент видит'), SLOW);
    expect(cardText()).toContain('Екатерина, приняли ваше обращение МАС-40');
    expect(status()).toBe('В работе');
  });

  it('вкладка «Внутренняя заметка»: подпись канала, пустая заметка, сохранение', async () => {
    await open();
    await openCard('МАС-40');
    fireEvent.click(within(section()).getByRole('tab', { name: /Внутренняя заметка/ }));
    expect(cardText()).toContain('Заметку клиент не увидит');
    press('Сохранить заметку');
    await waitFor(() => expect(alertText()).toBe('Напишите текст заметки'));
    type('Внутренняя заметка', 'Позвонить завтра');
    press('Сохранить заметку');
    await waitFor(() => expect(toast()).toBe('Заметка сохранена'), SLOW);
    await waitFor(() => expect(cardText()).toContain('Внутренняя заметка · клиент не видит'), SLOW);
    expect(cardText()).toContain('Позвонить завтра');
  });

  it('компенсация в ответе (владелец): список, запись в обращении', async () => {
    await open();
    await openCard('МАС-41');
    const sel = field('Компенсация') as unknown as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual([
      'Без компенсации',
      'Скидка 20% на следующий визит',
      'Скидка 10% на следующую работу',
      'Бесплатное повторное посещение',
      'Возврат денег — через кассу',
    ]);
    fireEvent.change(sel, { target: { value: 'Скидка 20% на следующий визит' } });
    type('Ответ клиенту', 'ОльгаИзвините, дарим скидку.');
    press('Отправить', section().querySelector('.ox-sv-compose') as HTMLElement);
    await waitFor(() => expect(toast()).toBe('Ответ отправлен клиенту'), SLOW);
    await waitFor(
      () => expect(cardText()).toContain('Компенсация: Скидка 20% на следующий визит.'),
      SLOW,
    );
  });

  it('«Отправить и решить» открывает «Итог решения» после ответа', async () => {
    await open();
    await openCard('МАС-40');
    type('Ответ клиенту', 'Да, можно.');
    press('Отправить и решить');
    await waitFor(
      () => expect(section().querySelector('section[aria-label="Итог решения"]')).toBeTruthy(),
      SLOW,
    );
  });
});

describe('«Обращения»: боковая колонка', () => {
  it('«Направление»: название направления и модуля из каталога, без технического ключа (dirText эталона)', async () => {
    await open();
    await openCard('МАС-40');
    const side = section().querySelector('.ox-sv-cardbody') as HTMLElement;
    const label = [...side.querySelectorAll('.ox-sv-label')].find(
      (l) => l.textContent === 'Направление',
    );
    expect(label?.nextElementSibling?.textContent).toBe('Массаж · Салон и SPA');
    expect(side.textContent).not.toMatch(/· spa\b/);
  });

  it('приоритет, исполнитель, «Назначить меня»', async () => {
    await open();
    await openCard('МАС-40');
    expect(field('Исполнитель').value).toBe('');
    fireEvent.change(field('Приоритет'), { target: { value: 'high' } });
    await waitFor(() => expect(toast()).toBe('Приоритет изменён'), SLOW);
    await waitFor(() => expect(cardText()).toContain('Высокий приоритет'), SLOW);
    press('Назначить меня');
    await waitFor(() => expect(toast()).toBe('МАС-40 назначено на вас'), SLOW);
    await waitFor(
      () =>
        expect(
          (field('Исполнитель') as unknown as HTMLSelectElement).selectedOptions[0]?.textContent,
        ).toBe('Дарья Зимина'),
      SLOW,
    );
    fireEvent.change(field('Исполнитель'), { target: { value: '' } });
    await waitFor(() => expect(toast()).toBe('Исполнитель снят'), SLOW);
  });

  it('телефон: маска → «Показать» (владелец — руководитель направления) → полный номер', async () => {
    await open();
    await openCard('ГРЗ-57');
    expect(cardText()).toContain('+7 ••• •••-••-12');
    press('Показать');
    await waitFor(() => expect(toast()).toBe('Телефон показан, запись в истории'), SLOW);
    await waitFor(() => expect(cardText()).toContain('+7 916 204-44-12'), SLOW);
    expect(within(section()).queryByRole('button', { name: 'Показать' })).toBeNull();
  });

  it('связанная задача: короткая тема — ошибка, создание добавляет строку', async () => {
    await open();
    await openCard('МАС-40');
    expect(cardText()).toContain('Задач нет');
    press('＋ Задача');
    type('Тема задачи', 'Хм');
    press('Создать');
    await waitFor(() => expect(alertText()).toBe('Тема задачи — не короче 3 символов'), SLOW);
    type('Тема задачи', 'Проверить абонемент');
    press('Создать');
    await waitFor(() => expect(toast()).toBe('Задача создана'), SLOW);
    await waitFor(() => expect(cardText()).toContain('Проверить абонемент'), SLOW);
    expect(cardText()).not.toContain('Задач нет');
  });

  it('жалоба на сотрудника: «Кто видит», два итога, вывод после решения', async () => {
    await open();
    await openCard('МАС-41');
    expect(cardText()).toContain(
      'Жалоба касается работы сотрудника. Анна Морозова не видит обращение, пока руководитель не поделится выводом. Благодарности сотрудник видит сразу.',
    );
    expect(cardText()).toContain('Вывод можно отправить после решения');
    press('Решено…');
    const panel = section().querySelector('section[aria-label="Итог решения"]') as HTMLElement;
    expect(panel.textContent).toContain(
      'Жалоба касается сотрудника: в его оценки идёт только итог «Подтвердилась».',
    );
    fireEvent.click(within(panel).getByRole('radio', { name: 'Подтвердилась' }));
    press('Решить', panel);
    await waitFor(() => expect(toast()).toBe('МАС-41 решено'), SLOW);
    await waitFor(() => expect(cardText()).toContain('Поделиться выводом с сотрудником…'), SLOW);
    press('Поделиться выводом с сотрудником…');
    type('Вывод для сотрудника', 'Опоздание подтвердилось, разбираем график.');
    press('Отправить', section().querySelector('.ox-sv-aside') as HTMLElement);
    await waitFor(() => expect(toast()).toBe('Вывод отправлен сотруднику'), SLOW);
    await waitFor(() => expect(cardText()).toContain('Вывод отправлен'), SLOW);
    expect(cardText()).toContain('«Опоздание подтвердилось, разбираем график.»');
  });
});

describe('«Обращения»: логист Котова и состояния страницы', () => {
  it('Котова: только «Грузоперевозки», «Взять себе», телефон скрыт с подсказкой, нет компенсации', async () => {
    await open('manager');
    await ready();
    expect(keys()).toEqual(['ГРЗ-57', 'ГРЗ-55']);
    expect(nav().queryByRole('button', { name: /^Массаж/ })).toBeNull();
    expect(
      within(rowOf('ГРЗ-57') as HTMLElement).getByRole('button', { name: 'Взять себе' }),
    ).toBeTruthy();
    await openCard('ГРЗ-57');
    expect(cardText()).toContain('Телефон показывают руководителю направления и владельцу');
    expect(within(section()).queryByRole('button', { name: 'Показать' })).toBeNull();
    expect(within(section()).queryByLabelText('Компенсация')).toBeNull();
    const acts = [...section().querySelectorAll('.ox-sv-acts button')].map((b) => txt(b));
    expect(acts).toContain('Взять в работу');
  });

  it('«Взять себе» Котовой назначает её исполнителем', async () => {
    await open('manager');
    await ready();
    press('Взять себе', rowOf('ГРЗ-57') as HTMLElement);
    await waitFor(() => expect(toast()).toBe('ГРЗ-57 назначено на вас'), SLOW);
    await waitFor(() => expect(rowOf('ГРЗ-57')?.textContent).toContain('Марина Котова'), SLOW);
  });

  it('массажистка: «Нет доступа к обращениям»', async () => {
    app = await renderMockApp(`/t/${ALTA}/service`, { persona: 'therapist' });
    await waitFor(() => expect(section()?.textContent).toContain('Нет доступа к обращениям'), SLOW);
    expect(section().textContent).toContain(
      'Ни одна ваша роль не даёт права «Обращения · Видеть». Владелец бизнеса может назначить роль «Специалист по обращениям» с областью направления.',
    );
  });

  it('владелец «Лотоса»: «Обращения не настроены»', async () => {
    app = await renderMockApp(`/t/${LOTOS}/service`, { persona: 'owner@t-lotos' });
    await waitFor(() => expect(section()?.textContent).toContain('Обращения не настроены'), SLOW);
    expect(section().textContent).toContain(
      'В этой организации пока нет направлений. Демо-направления заведены в «Альта Групп».',
    );
  });

  it('сбой загрузки направлений: баннер с «Повторить»', async () => {
    app = await renderMockApp(`/t/${ALTA}/service`, {
      persona: 'owner',
      setup: () => {
        const through = globalThis.fetch;
        vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
          const req = new Request(input, init);
          if (req.method === 'GET' && /\/service\/directions$/.test(new URL(req.url).pathname)) {
            return new Response(JSON.stringify({ code: 'internal_error' }), { status: 500 });
          }
          return through(req);
        });
      },
    });
    await waitFor(
      () => expect(section()?.textContent).toContain('Не удалось загрузить обращения'),
      { timeout: 20_000 },
    );
    expect(within(section()).getByRole('button', { name: 'Повторить' })).toBeTruthy();
  }, 30_000);

  it('нет связи: заметка и заблокированные кнопки', async () => {
    await open();
    await openCard('МАС-40');
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      window.dispatchEvent(new Event('offline'));
      await waitFor(() =>
        expect(section().textContent).toContain(
          'Нет связи с сервером: кнопки недоступны, пока связь не появится.',
        ),
      );
      expect(
        (within(section()).getByRole('button', { name: 'Взять в работу' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    } finally {
      online.mockRestore();
      window.dispatchEvent(new Event('online'));
    }
  });

  it('узкий контейнер (< 860): навигация чипами «Направления» и «Очереди»', async () => {
    class RO {
      constructor(private readonly cb: (e: unknown[]) => void) {}
      observe(el: Element): void {
        if (el.classList.contains('ox-sv')) this.cb([{ contentRect: { width: 500 } }]);
      }
      disconnect(): void {}
      unobserve(): void {}
    }
    vi.stubGlobal('ResizeObserver', RO);
    await open();
    await ready();
    await waitFor(() =>
      expect(within(section()).getByRole('group', { name: 'Направления' })).toBeTruthy(),
    );
    const dirs = within(within(section()).getByRole('group', { name: 'Направления' }));
    expect(dirs.getByRole('button', { name: /Массаж · 2/ })).toBeTruthy();
    const qs = within(within(section()).getByRole('group', { name: 'Очереди' }));
    expect(qs.getByRole('button', { name: /Срок нарушен · 1/ })).toBeTruthy();
    expect(section().querySelector('nav')).toBeNull();
    fireEvent.click(qs.getByRole('button', { name: /Срок нарушен · 1/ }));
    await waitFor(() => expect(keys()).toEqual(['ГРЗ-57']), SLOW);
  }, 40_000);
});
