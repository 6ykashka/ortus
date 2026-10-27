// W5.33 · Экранные тесты «Мой подотчёт» (Касса.dc.html selfVM :802–818, разметка :289–317, диалоги :449–465):
// карточка остатка водителя и прораба, чеки и «Переснять», «Добавить чек» (фото через Files, QR), «Вернуть остаток»,
// нет доступа, ошибка и «Повторить». Данные — сид кассы сценарного сервера (подотчёты Васильева и Соколова).
import type { ScenarioServer } from '@ortus/adapter/msw';
import { cashRub as rub } from '@ortus/domain/modules';
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BASE_URL,
  type MockApp,
  type MockAppOptions,
  renderMockApp,
} from '../../../app/testing.tsx';
import { transport } from './upload.ts';

const ALTA = seedUuid('platform', 't-alta');
const SLOW = { timeout: 15_000 };
vi.setConfig({ testTimeout: 30_000 });

interface RoleRow {
  name: string;
  permissions: string[];
}
interface OrgState {
  roles: RoleRow[];
  policyVersion: number;
}

/** Ключ `cash.advance.self` шаблонам «Водитель» и «Прораб» (в контракте 0.12.0-stage5 его там нет, Q-W5.33-7). */
const granted: RoleRow[] = [];
function grantSelf(scenario: ScenarioServer): void {
  const org = scenario.state().orgs[ALTA] as unknown as OrgState;
  for (const r of org.roles) {
    if (!['Водитель', 'Прораб'].includes(r.name) || r.permissions.includes('cash.advance.self')) {
      continue;
    }
    // Не `push`: массив прав — общий пример контракта, его правка протекла бы в другие тесты.
    r.permissions = [...r.permissions, 'cash.advance.self'];
    granted.push(r);
  }
  org.policyVersion++;
}

/** Сид сценарного сервера общий для тестов файла: выданное право возвращается. */
function revokeSelf(): void {
  for (const r of granted.splice(0)) {
    r.permissions = r.permissions.filter((k) => k !== 'cash.advance.self');
  }
}

beforeAll(() => {
  // React Aria Modal зовёт CSS.escape при открытии диалога (jsdom его не даёт) — как review.page.test.tsx.
  globalThis.CSS ??= {} as typeof CSS;
  globalThis.CSS.escape ??= (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
});

/** Текстовые запросы RTL сравнивают строку как есть, а текст узла нормализуют (NBSP → пробел). */
const n = (s: string): string => s.replace(/\s+/g, ' ');

let app: MockApp | undefined;
const realPut = transport.put;
const realPrepare = transport.prepare;

beforeEach(() => {
  transport.pollMs = 5;
  transport.prepare = async (f) => f;
  transport.put = async () => undefined;
});
afterEach(() => {
  revokeSelf();
  app?.close();
  app = undefined;
  transport.put = realPut;
  transport.prepare = realPrepare;
  vi.unstubAllGlobals();
});

const open = async (
  persona: 'driver' | 'foreman',
  o: MockAppOptions = {},
  title = 'Мой подотчёт',
): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/cash-self`, {
    persona,
    setup: grantSelf,
    ...o,
  });
  await screen.findByRole('heading', { level: 1, name: title }, SLOW);
  return app;
};

const card = (): HTMLElement => {
  const el = document.querySelector<HTMLElement>('.ox-cs-card');
  if (!el) throw new Error('нет карточки остатка');
  return el;
};
const receipts = (): string[] =>
  [...document.querySelectorAll('.ox-cs-receipt-title')].map((e) => e.textContent ?? '');

/** Завершает проверку загруженных файлов сценарного сервера (антивирус режима mock). */
const scan = (): Promise<Response> =>
  fetch(`${BASE_URL}/api/v1/dev/scenario`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scanFiles: true }),
  });

const file = (name = 'check.jpg') =>
  new File([new Uint8Array([7, 7, 7])], name, { type: 'image/jpeg' });

async function chooseFile(dialog: HTMLElement, label: string): Promise<void> {
  const input = within(dialog).getByLabelText(label, { selector: 'input' });
  fireEvent.change(input, { target: { files: [file()] } });
}

describe('карточка остатка', () => {
  it('водитель: заголовок, остаток, «Выдано … · ДД.ММ · отчитались на …», полоса, чеки, «Вернуть остаток»', async () => {
    await open('driver');
    expect(screen.getByText('Деньги на руках, отчёт чеками и возврат остатка')).toBeTruthy();
    expect(within(card()).getByText('Подотчёт · на руках')).toBeTruthy();
    expect(card().querySelector('.ox-cs-bal')?.textContent).toBe(rub(4450));
    expect(
      within(card()).getByText(n(`Выдано ${rub(10000)} · 28.09 · отчитались на ${rub(5550)}`)),
    ).toBeTruthy();
    expect(card().querySelector<HTMLElement>('.ox-cs-bar-fill')?.style.width).toBe('56%');
    expect(screen.getByRole('button', { name: 'Добавить чек' })).toBeTruthy();
    expect(screen.getByRole('button', { name: `Вернуть остаток ${rub(4450)}` })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Чеки' })).toBeTruthy();
    expect(receipts()).toEqual([
      `Парковка · Рейс Р-203 · ${rub(400)}`,
      `Мойка · Рейс Р-203 · ${rub(600)}`,
      `Топливо · Рейс Р-201 · ${rub(3050)}`,
      `Топливо · Рейс Р-196 · ${rub(2500)}`,
    ]);
    const statuses = [...document.querySelectorAll('.ox-cs-receipt-status')].map(
      (e) => e.textContent,
    );
    expect(statuses).toEqual([
      'Не принят: Не видна сумма на фото — переснимите чек',
      'На проверке',
      'Принят',
      'Принят',
    ]);
  });

  it('«Переснять» — только у отклонённого чека, вместо суммы справа', async () => {
    await open('driver');
    const buttons = screen.getAllByRole('button', { name: 'Переснять' });
    expect(buttons).toHaveLength(1);
    const row = buttons[0]?.closest('.ox-cs-receipt') as HTMLElement;
    expect(row.textContent).toContain('Парковка');
    expect(row.querySelector('.ox-cs-receipt-sum')).toBeNull();
  });

  it('прораб: тот же макет, свой подотчёт', async () => {
    await open('foreman');
    expect(card().querySelector('.ox-cs-bal')?.textContent).toBe(rub(11270));
    expect(
      within(card()).getByText(n(`Выдано ${rub(30000)} · 30.09 · отчитались на ${rub(18730)}`)),
    ).toBeTruthy();
    expect(receipts()).toEqual([`Материалы · Закупка З-14 · ЖК Речной, кв. 42 · ${rub(18730)}`]);
    expect(screen.queryByRole('button', { name: 'Переснять' })).toBeNull();
  });
});

describe('«Вернуть остаток»', () => {
  it('диалог с суммой по умолчанию → «Возврат отправлен: ждёт приёма», «В пути», остаток 0', async () => {
    await open('driver');
    fireEvent.click(screen.getByRole('button', { name: `Вернуть остаток ${rub(4450)}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Вернуть остаток' });
    expect(within(dialog).getByText(n(`На руках ${rub(4450)}`))).toBeTruthy();
    expect(
      within(dialog).getByText(
        'Отдайте деньги логисту или владельцу. Пока возврат не приняли, сумма числится «в пути».',
      ),
    ).toBeTruthy();
    expect((within(dialog).getByLabelText('Сумма, ₽') as HTMLInputElement).value).toBe('4450');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Вернуть' }));
    await screen.findByText('Возврат отправлен: ждёт приёма', undefined, SLOW);
    await screen.findByText(n(`Возврат ${rub(4450)} ждёт приёма`), undefined, SLOW);
    await waitFor(() => expect(card().querySelector('.ox-cs-bal')?.textContent).toBe(rub(0)), SLOW);
    expect(within(card()).getByText('Отчитались полностью')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Вернуть остаток/ })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('сумма больше остатка — ошибка в диалоге, ничего не отправлено', async () => {
    await open('driver');
    fireEvent.click(screen.getByRole('button', { name: `Вернуть остаток ${rub(4450)}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Вернуть остаток' });
    fireEvent.change(within(dialog).getByLabelText('Сумма, ₽'), { target: { value: '9999' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Вернуть' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      `На руках меньше: ${rub(4450)}`,
    );
    expect(app?.responses().some((r) => r.path.endsWith('/advance-returns'))).toBe(false);
  });

  it('пустая сумма — «Сумма: укажите число больше нуля»', async () => {
    await open('driver');
    fireEvent.click(screen.getByRole('button', { name: `Вернуть остаток ${rub(4450)}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Вернуть остаток' });
    fireEvent.change(within(dialog).getByLabelText('Сумма, ₽'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Вернуть' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'Сумма: укажите число больше нуля',
    );
  });
});

describe('«Добавить чек»', () => {
  it('диалог: плитки, подсказки, статьи; без фото — «Сфотографируйте чек»', async () => {
    await open('driver');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить чек' }));
    const dialog = await screen.findByRole('dialog', { name: 'Добавить чек' });
    expect(within(dialog).getByText(n(`На руках ${rub(4450)}`))).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Сфотографировать чек' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Сканировать QR чека' })).toBeTruthy();
    expect(within(dialog).getByLabelText('К чему относится')).toBeTruthy();
    expect(
      (within(dialog).getByLabelText('К чему относится') as HTMLInputElement).placeholder,
    ).toBe('Рейс, например Р-208');
    expect(
      within(dialog).getByText(
        'Чек уйдёт на проверку. Расход подотчёта проведётся, когда его примут.',
      ),
    ).toBeTruthy();
    const options = [...(within(dialog).getByLabelText('Статья') as HTMLSelectElement).options];
    expect(options.length).toBeGreaterThan(1);
    fireEvent.change(within(dialog).getByLabelText('Сумма, ₽'), { target: { value: '300' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить на проверку' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('Сфотографируйте чек');
  });

  it('фото → «Фото чека добавлено» → отправка → «Чек отправлен на проверку», новая строка «На проверке»', async () => {
    await open('driver');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить чек' }));
    const dialog = await screen.findByRole('dialog', { name: 'Добавить чек' });
    await chooseFile(dialog, 'Фото чека');
    await waitFor(async () => {
      await scan();
      expect(within(dialog).getByText('Фото чека добавлено')).toBeTruthy();
    }, SLOW);
    fireEvent.change(within(dialog).getByLabelText('Сумма, ₽'), { target: { value: '1 260' } });
    fireEvent.change(within(dialog).getByLabelText('К чему относится'), {
      target: { value: 'Р-208' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отправить на проверку' }));
    await screen.findByText('Чек отправлен на проверку', undefined, SLOW);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), SLOW);
    await waitFor(() => expect(receipts()[0]).toBe(`Топливо · Р-208 · ${rub(1260)}`), SLOW);
    expect(document.querySelectorAll('.ox-cs-receipt-status')[0]?.textContent).toBe('На проверке');
  });

  it('QR чека: сумма из s=, «QR прочитан»; снимок QR становится фото чека', async () => {
    class Detector {
      detect = async (): Promise<{ rawValue: string }[]> => [
        { rawValue: 't=20260930T1304&s=1260.00&fn=9960&i=1234&fp=5678&n=1' },
      ];
    }
    vi.stubGlobal('BarcodeDetector', Detector);
    vi.stubGlobal('createImageBitmap', async () => ({ close: () => undefined }));
    await open('driver');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить чек' }));
    const dialog = await screen.findByRole('dialog', { name: 'Добавить чек' });
    await chooseFile(dialog, 'QR чека');
    await waitFor(async () => {
      await scan();
      expect(within(dialog).getByText('QR прочитан')).toBeTruthy();
      expect(within(dialog).getByText('Фото чека добавлено')).toBeTruthy();
    }, SLOW);
    expect((within(dialog).getByLabelText('Сумма, ₽') as HTMLInputElement).value).toBe('1260');
    expect(
      within(dialog).getByText(
        'Из QR взяты сумма, дата и номер чека — проверьте статью. Чек уйдёт на проверку. Расход подотчёта проведётся, когда его примут.',
      ),
    ).toBeTruthy();
  });

  it('QR не распознан (нет BarcodeDetector) — подсказка, сумма вручную', async () => {
    await open('driver');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить чек' }));
    const dialog = await screen.findByRole('dialog', { name: 'Добавить чек' });
    await chooseFile(dialog, 'QR чека');
    expect((await within(dialog).findByRole('alert')).textContent).toContain(
      'QR не распознан. Введите сумму вручную.',
    );
  });

  it('«Переснять»: диалог «Переснять чек» с суммой и статьёй отклонённого чека', async () => {
    await open('driver');
    fireEvent.click(screen.getByRole('button', { name: 'Переснять' }));
    const dialog = await screen.findByRole('dialog', { name: 'Переснять чек' });
    expect((within(dialog).getByLabelText('Сумма, ₽') as HTMLInputElement).value).toBe('400');
    expect(
      (within(dialog).getByLabelText('Статья') as HTMLSelectElement).selectedOptions[0]?.text,
    ).toBe('Парковка');
    expect((within(dialog).getByLabelText('К чему относится') as HTMLInputElement).value).toBe(
      'Рейс Р-203',
    );
  });

  it('«Отменить» закрывает диалог без отправки', async () => {
    await open('driver');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить чек' }));
    const dialog = await screen.findByRole('dialog', { name: 'Добавить чек' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отменить' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(app?.responses().some((r) => r.method === 'POST' && r.path.endsWith('/receipts'))).toBe(
      false,
    );
  });
});

describe('состояния страницы', () => {
  it('нет права на подотчёт: «Кассы недоступны…»', async () => {
    app = await renderMockApp(`/t/${ALTA}/cash-self`, { persona: 'driver' });
    await screen.findByRole('heading', { level: 1, name: 'Касса' }, SLOW);
    expect(screen.getByText('Кассы вашей области')).toBeTruthy();
    expect(
      screen.getByText(
        'Кассы недоступны: в ваших ролях нет модуля «Касса» или в вашей области ещё нет касс. Доступ выдаёт владелец в «Пользователях и ролях».',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить чек' })).toBeNull();
  });

  it('загрузка и ошибка списка с «Повторить»', async () => {
    app = await renderMockApp(`/t/${ALTA}/cash-self`, {
      persona: 'driver',
      setup: grantSelf,
      scenario: 'listCashAccounts=rate_limited',
    });
    const alert = await screen.findByRole('alert', undefined, SLOW);
    expect(alert.textContent).toContain(
      'Не удалось загрузить подотчёт: Слишком много запросов. Подождите и повторите.',
    );
    app.scenario.setScenario(null);
    fireEvent.click(within(alert).getByRole('button', { name: 'Повторить' }));
    await screen.findByRole('heading', { level: 1, name: 'Мой подотчёт' }, SLOW);
  });
});
