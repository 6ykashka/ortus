// W4.70 · Экранные тесты «Заполнения формы» сотрудником (`form-fill`, `{origin}/forms/{id}`, Q-W4.00-forms-21; эталона
// нет — рендер вкладки «Предпросмотр» W4.22 без панели, Q-W4.00-forms-19). Сеть — сценарный сервер W4.05 (тег Forms,
// core.files с хранилищем mock) на сиде W4.20: «Осмотр машины» v3 «Альты»; новые формы — через API контракта.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../../app/testing.tsx';
import { call, jpeg, makeForm, patchForm } from './testing.ts';

const ALTA = seedUuid('platform', 't-alta');
const INSP = seedUuid('t-alta', 'fm-insp');
const SLOW = { timeout: 8_000 };
const THANKS = 'Спасибо! Ответ отправлен.';

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const card = (): HTMLElement =>
  document.querySelector<HTMLElement>('.ox-fm-pv-card') as HTMLElement;
const inCard = () => within(card());
const state = () => document.querySelector<HTMLElement>('.ox-ff-state');
const stateTitle = () => state()?.querySelector('h1')?.textContent;
const ready = () => waitFor(() => expect(card()).toBeTruthy(), SLOW);

const TEXT_Q = [
  { key: 'q-name', pageId: 'p1', type: 'text', label: 'Как вас зовут', required: true },
  {
    key: 'q-shift',
    pageId: 'p1',
    type: 'choice',
    label: 'Смена',
    required: true,
    options: [
      { key: 'o1', label: 'Утро' },
      { key: 'o2', label: 'Вечер' },
    ],
  },
  {
    key: 'q-src',
    pageId: 'p1',
    type: 'text',
    label: 'Источник',
    required: false,
    hidden: true,
    defaultValue: 'портал',
  },
];

/** Вход персонажа на экран без запросов, затем `prepare` через API и переход на форму. */
async function open(
  prepare?: (a: MockApp) => Promise<string>,
  o: { persona?: string; search?: string; scenario?: string } = {},
): Promise<MockApp> {
  app = await renderMockApp('/auth/login', {
    persona: o.persona ?? 'owner',
    preset: 'logistics-ready',
  });
  const a = app;
  const id = prepare ? await prepare(a) : INSP;
  if (o.scenario) a.scenario.setScenario(o.scenario, true);
  await a.router.navigate({ to: `/forms/${id}${o.search ?? ''}` as never });
  return a;
}

const simple =
  (o: { settings?: Record<string, unknown>; fields?: Record<string, unknown>[] } = {}) =>
  async (a: MockApp) =>
    (
      await makeForm(a, ALTA, {
        name: `Отметка смены ${Math.random().toString(36).slice(2, 6)}`,
        fields: o.fields ?? TEXT_Q,
        ...(o.settings ? { settings: o.settings } : {}),
      })
    ).form;

async function fillSimple(): Promise<void> {
  await ready();
  fireEvent.change(inCard().getByLabelText('Как вас зовут'), { target: { value: 'Дарья' } });
  fireEvent.click(inCard().getByRole('radio', { name: 'Утро' }));
}

const responses = async (a: MockApp, form: string) =>
  (await call(a, 'GET', `/api/v1/tenants/${ALTA}/forms/${form}/responses`)).body.items as {
    number: string;
    reviewStatus: string;
    answers: { fieldKey: string; value: unknown }[];
    linkParamKeys?: string[];
  }[];

describe('form-fill: страница сотрудника', () => {
  it('«Осмотр машины» v3: шапка «Альта Групп», название, «Страница 1 из 4», без панели предпросмотра и меню', async () => {
    await open();
    await ready();
    expect(inCard().getByRole('heading', { level: 2, name: 'Осмотр машины' })).toBeTruthy();
    expect(card().querySelector('.ox-fm-pv-logo')?.textContent).toContain('Альта Групп');
    expect(card().textContent).toContain('Страница 1 из 4');
    expect(screen.queryByText('Предпросмотр черновика. Ответ не сохраняется.')).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('ответ с фото: загрузка core.files, четыре страницы, «Спасибо» без «Пройти ещё раз»; ответ R-1013 принят', async () => {
    const a = await open();
    await ready();
    fireEvent.click(inCard().getByRole('button', { name: 'Далее' }));
    await waitFor(() =>
      expect(inCard().getByRole('alert').textContent).toBe('Обязательный вопрос'),
    );
    fireEvent.change(inCard().getByLabelText('Прикрепить файл'), {
      target: { files: [jpeg('front.jpg')] },
    });
    await waitFor(() => expect(card().textContent).toContain('1 файл из 5'), SLOW);
    expect(card().textContent).toContain('front.jpg');
    fireEvent.click(inCard().getByRole('button', { name: 'Далее' }));
    fireEvent.change(inCard().getByLabelText('Пробег по одометру, км'), {
      target: { value: '85 120' },
    });
    fireEvent.click(inCard().getByRole('radio', { name: '¾' }));
    fireEvent.click(inCard().getByRole('button', { name: 'Далее' }));
    for (const c of ['кузов', 'шины', 'документы'])
      fireEvent.click(inCard().getByRole('checkbox', { name: c }));
    fireEvent.click(inCard().getByRole('button', { name: 'Далее' }));
    fireEvent.click(inCard().getByRole('radio', { name: 'Нет' }));
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(card().textContent).toContain(THANKS), SLOW);
    expect(inCard().queryByRole('button', { name: 'Пройти ещё раз' })).toBeNull();
    const top = (await responses(a, INSP))[0];
    expect(top?.number).toBe('R-1013');
    expect(top?.reviewStatus).toBe('accepted');
    expect(top?.answers).toContainEqual({
      fieldKey: 'q-odo',
      value: { type: 'decimal', value: '85120' },
    });
    const calls = a.responses().map((r) => `${r.method} ${r.status} ${r.path}`);
    expect(calls).toContain(`POST 201 /api/v1/tenants/${ALTA}/files/uploads`);
    expect(calls).toContain(`POST 201 /api/v1/tenants/${ALTA}/forms/${INSP}/responses`);
  }, 20_000);

  it('параметр адреса — значение скрытого вопроса (linkParams); лишние не уходят', async () => {
    let form = '';
    const a = await open(
      async (x) => {
        form = await simple()(x);
        return form;
      },
      { search: '?q-src=email&utm=1' },
    );
    await fillSimple();
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(card().textContent).toContain(THANKS), SLOW);
    const top = (await responses(a, form))[0];
    expect(top?.linkParamKeys).toEqual(['q-src']);
    expect(top?.answers).toContainEqual({
      fieldKey: 'q-src',
      value: { type: 'text', value: 'email' },
    });
  });

  it('тест с баллами: «Результат: 1 из 1 балла · тест пройден»', async () => {
    await open(
      simple({
        settings: { scoring: true, passScore: 1, showScore: true },
        fields: [
          {
            key: 'q-helmet',
            pageId: 'p1',
            type: 'choice',
            label: 'Каска обязательна?',
            required: true,
            options: [
              { key: 'o1', label: 'Да', score: 1 },
              { key: 'o2', label: 'Нет', score: 0 },
            ],
          },
        ],
      }),
    );
    await ready();
    fireEvent.click(inCard().getByRole('radio', { name: 'Да' }));
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(card().textContent).toContain(THANKS), SLOW);
    expect(card().querySelector('.ox-fm-pv-score')?.textContent).toBe(
      'Результат: 1 из 1 балла · тест пройден',
    );
  });

  it('вопрос «Сотрудник»: варианты listFormFieldOptions, ответ — ссылка с подписью сервера', async () => {
    let form = '';
    const a = await open(async (x) => {
      form = await simple({
        fields: [{ key: 'q-who', pageId: 'p1', type: 'person', label: 'Дежурный', required: true }],
      })(x);
      return form;
    });
    await ready();
    const sel = inCard().getByRole('combobox', { name: 'Дежурный' });
    await waitFor(() => expect(sel.textContent).toContain('Марина Котова'), SLOW);
    const opt = [...sel.querySelectorAll('option')].find((x) => x.textContent === 'Марина Котова');
    fireEvent.change(sel, { target: { value: opt?.value } });
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(card().textContent).toContain(THANKS), SLOW);
    expect((await responses(a, form))[0]?.answers[0]?.value).toMatchObject({
      type: 'reference',
      label: 'Марина Котова',
    });
  });

  it('409 form_version_changed — «Форма обновилась — откройте её заново» → «Открыть заново»', async () => {
    const a = await open(simple());
    await fillSimple();
    a.scenario.setScenario('submitFormResponse=invalid_transition', true);
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(stateTitle()).toBe('Форма обновилась — откройте её заново'), SLOW);
    fireEvent.click(within(state() as HTMLElement).getByRole('button', { name: 'Открыть заново' }));
    await ready();
    expect((inCard().getByLabelText('Как вас зовут') as HTMLInputElement).value).toBe('');
  });

  it('«Один ответ от сотрудника» — после ответа «Вы уже отвечали на эту форму»', async () => {
    let form = '';
    const a = await open(async (x) => {
      form = await simple({ settings: { onePerMember: true } })(x);
      return form;
    });
    await fillSimple();
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(card().textContent).toContain(THANKS), SLOW);
    await a.router.navigate({ to: '/auth/login' as never });
    await a.router.navigate({ to: `/forms/${form}` as never });
    await waitFor(() => expect(stateTitle()).toBe('Вы уже отвечали на эту форму'), SLOW);
  });

  it('закрытая форма — «Приём ответов закрыт»', async () => {
    await open(async (x) => {
      const id = await simple()(x);
      await patchForm(x, `/api/v1/tenants/${ALTA}/forms/${id}`, { status: 'closed' });
      return id;
    });
    await waitFor(() => expect(stateTitle()).toBe('Приём ответов закрыт'), SLOW);
    expect(document.querySelector('.ox-fm-pv-card')).toBeNull();
  });

  it('нет связи при отправке — «Нет связи…», ответы на месте; повтор — «Спасибо», один ответ', async () => {
    let form = '';
    const a = await open(async (x) => {
      form = await simple()(x);
      return form;
    });
    await fillSimple();
    a.scenario.setScenario('submitFormResponse=offline');
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(
      () =>
        expect(document.querySelector('.ox-ff-alert')?.textContent).toBe(
          'Нет связи с сервером. Ответ не отправлен — повторите.',
        ),
      SLOW,
    );
    expect((inCard().getByLabelText('Как вас зовут') as HTMLInputElement).value).toBe('Дарья');
    a.scenario.setScenario(null);
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(card().textContent).toContain(THANKS), SLOW);
    expect(await responses(a, form)).toHaveLength(1);
  });

  it('ошибка загрузки 429 — «Не удалось загрузить форму: …», «Повторить» — форма', async () => {
    await open(simple(), { scenario: 'getForm=rate_limited' });
    await waitFor(
      () =>
        expect(state()?.textContent).toContain(
          'Не удалось загрузить форму: Слишком много запросов. Подождите и повторите.',
        ),
      SLOW,
    );
    fireEvent.click(within(state() as HTMLElement).getByRole('button', { name: 'Повторить' }));
    await ready();
  });

  it('водитель без права «Видеть формы» — «Нет доступа к форме»', async () => {
    await open(undefined, { persona: 'driver' });
    await waitFor(() => expect(stateTitle()).toBe('Нет доступа к форме'), SLOW);
  });

  it('неизвестная форма — «Форма не найдена»', async () => {
    await open(async () => '00000000-0000-5000-8000-0000000000aa');
    await waitFor(() => expect(stateTitle()).toBe('Форма не найдена'), SLOW);
  });

  it('без входа — экран входа с ?next= на форму', async () => {
    app = await renderMockApp(`/forms/${INSP}`);
    const a = app;
    await waitFor(() => expect(a.path()).toBe('/auth/login'), SLOW);
    expect(new URLSearchParams(a.router.state.location.searchStr).get('next')).toBe(
      `/forms/${INSP}`,
    );
  });
});
