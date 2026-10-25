// W4.70 · Экранные тесты «Публичной формы» гостя (`public-form`, `{origin}/f/{token}`, `?embed=1`; Q-W4.00-forms-21;
// эталона нет — рендер вкладки «Предпросмотр» W4.22, Q-W4.00-forms-19). Сеть — сценарный сервер: тег PublicForms
// (W4.70) поверх форм W4.05; форма — «Форма обратной связи» (публичный шаблон) или своя, через API владельца.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../app/testing.tsx';
import { call, jpeg, makeForm, type Made, patchForm } from '../core/forms/fill/testing.ts';

const ALTA = seedUuid('platform', 't-alta');
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
const star = (k: number) =>
  within(inCard().getByRole('radiogroup', { name: 'Оцените работу' })).getByRole('radio', {
    name: `${k} из 5`,
  });

const uniq = (s: string) => `${s} ${Math.random().toString(36).slice(2, 6)}`;

/** Владелец готовит публичную форму через API (`prepare`), затем — страница гостя по ссылке. */
async function open(
  prepare: (a: MockApp) => Promise<Made>,
  search = '',
): Promise<{ a: MockApp; m: Made }> {
  app = await renderMockApp('/auth/login', { persona: 'owner' });
  const a = app;
  const m = await prepare(a);
  await a.router.navigate({ to: `/f/${m.token ?? 'none'}${search}` as never });
  return { a, m };
}

const feedback = (a: MockApp) =>
  makeForm(a, ALTA, { name: uniq('Отзыв о доставке'), templateId: 'tpl-feedback' });

const custom = (fields: Record<string, unknown>[]) => (a: MockApp) =>
  makeForm(a, ALTA, { name: uniq('Заявка с сайта'), fields, settings: { access: 'public' } });

const responses = async (a: MockApp, m: Made) =>
  (await call(a, 'GET', `${m.url}/responses`)).body.items as {
    reviewStatus: string;
    channel: string;
    author: { displayName: string };
    answers: { fieldKey: string; value: unknown }[];
    linkParamKeys?: string[];
  }[];

describe('public-form: страница гостя', () => {
  it('без оболочки и без /me/context: «Альта Групп», «Отзыв»; ответ — «Спасибо», «На проверке» у владельца', async () => {
    const { a, m } = await open(feedback);
    await ready();
    expect(card().querySelector('.ox-fm-pv-logo')?.textContent).toContain('Альта Групп');
    expect(inCard().getByRole('heading', { level: 2, name: 'Отзыв' })).toBeTruthy();
    expect(document.querySelector('nav')).toBeNull();
    fireEvent.click(star(5));
    fireEvent.click(inCard().getByRole('radio', { name: 'Да' }));
    fireEvent.change(inCard().getByLabelText('Комментарий'), { target: { value: 'Вовремя' } });
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(card().textContent).toContain(THANKS), SLOW);
    expect(inCard().queryByRole('button', { name: 'Пройти ещё раз' })).toBeNull();
    const top = (await responses(a, m))[0];
    expect(top).toMatchObject({
      reviewStatus: 'pending',
      channel: 'public',
      author: { displayName: 'Гость' },
    });
    const paths = a.responses().map((r) => r.path);
    const at = paths.indexOf(`/api/v1/public/forms/${m.token}`);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(paths.slice(at).filter((p) => p === '/api/v1/me/context')).toEqual([]);
  });

  it('условие показа: «Нет» — «Что нам улучшить?» обязателен', async () => {
    await open(feedback);
    await ready();
    expect(inCard().queryByLabelText('Что нам улучшить?')).toBeNull();
    fireEvent.click(star(2));
    fireEvent.click(inCard().getByRole('radio', { name: 'Нет' }));
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() =>
      expect(inCard().getByRole('alert').textContent).toBe('Обязательный вопрос'),
    );
  });

  it('параметры адреса — только скрытому вопросу: ключ из ссылки у ответа', async () => {
    const { a, m } = await open(
      custom([
        { key: 'q-text', pageId: 'p1', type: 'longtext', label: 'Ваш вопрос', required: true },
        {
          key: 'q-src',
          pageId: 'p1',
          type: 'text',
          label: 'Источник',
          required: false,
          hidden: true,
          defaultValue: 'сайт',
        },
      ]),
      '?q-src=email&utm_source=promo',
    );
    await ready();
    fireEvent.change(inCard().getByLabelText('Ваш вопрос'), { target: { value: 'Доставка?' } });
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(card().textContent).toContain(THANKS), SLOW);
    const top = (await responses(a, m))[0];
    expect(top?.linkParamKeys).toEqual(['q-src']);
    expect(top?.answers).toContainEqual({
      fieldKey: 'q-src',
      value: { type: 'text', value: 'email' },
    });
  });

  it('встраивание ?embed=1 — `data-embed` у страницы', async () => {
    await open(feedback, '?embed=1');
    await ready();
    expect(document.querySelector('.ox-ff')?.hasAttribute('data-embed')).toBe(true);
  });

  it('файл гостя: «Проверяем…», до проверки — «Файл ещё проверяется — подождите»; после — «Спасибо»', async () => {
    const { a, m } = await open(
      custom([
        { key: 'q-what', pageId: 'p1', type: 'text', label: 'Что случилось', required: true },
        { key: 'q-photo', pageId: 'p1', type: 'photo', label: 'Фото', required: true, maxFiles: 3 },
      ]),
    );
    await ready();
    fireEvent.change(inCard().getByLabelText('Что случилось'), { target: { value: 'Течёт кран' } });
    fireEvent.change(inCard().getByLabelText('Прикрепить файл'), {
      target: { files: [jpeg('kran.jpg')] },
    });
    await waitFor(() => expect(card().textContent).toContain('Проверяем «kran.jpg»…'), SLOW);
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() =>
      expect(inCard().getByRole('alert').textContent).toBe('Файл ещё проверяется — подождите'),
    );
    await call(a, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } });
    await waitFor(() => expect(card().textContent).toContain('1 файл из 3'), { timeout: 10_000 });
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(card().textContent).toContain(THANKS), SLOW);
    const top = (await responses(a, m))[0];
    expect(top?.answers.find((x) => x.fieldKey === 'q-photo')?.value).toMatchObject({
      type: 'files',
    });
  }, 20_000);

  it('закрытая форма — «Приём ответов закрыт»', async () => {
    await open(async (a) => {
      const m = await feedback(a);
      await patchForm(a, m.url, { status: 'closed' });
      return m;
    });
    await waitFor(() => expect(stateTitle()).toBe('Приём ответов закрыт'), SLOW);
  });

  it('форма больше не публичная — «Ссылка недействительна»; неизвестная ссылка — «Форма не найдена»', async () => {
    const { a } = await open(async (x) => {
      const m = await feedback(x);
      await patchForm(x, m.url, { settings: { access: 'members' } });
      return m;
    });
    await waitFor(() => expect(stateTitle()).toBe('Ссылка недействительна'), SLOW);
    await a.router.navigate({ to: '/f/fUnknownToken0000000000000000' as never });
    await waitFor(() => expect(stateTitle()).toBe('Форма не найдена'), SLOW);
  });

  it('новая версия между открытием и отправкой — «Форма обновилась…» → «Открыть заново» — новая версия', async () => {
    const { a, m } = await open(feedback);
    await ready();
    fireEvent.click(star(3));
    fireEvent.click(inCard().getByRole('radio', { name: 'Да' }));
    const d = await call(a, 'GET', `${m.url}/draft`);
    const def = d.body.definition as { pages: { id: string }[]; fields: Record<string, unknown>[] };
    def.fields.push({
      key: 'q-city',
      pageId: def.pages[0]?.id,
      type: 'text',
      label: 'Город',
      required: false,
    });
    await call(a, 'PUT', `${m.url}/draft`, { body: { definition: def }, ifMatch: d.etag });
    const d2 = await call(a, 'GET', `${m.url}/draft`);
    const cur = await call(a, 'GET', m.url);
    await call(a, 'POST', `${m.url}/publish`, {
      body: { draftRevision: d2.body.revision },
      ifMatch: cur.etag,
    });
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(stateTitle()).toBe('Форма обновилась — откройте её заново'), SLOW);
    fireEvent.click(within(state() as HTMLElement).getByRole('button', { name: 'Открыть заново' }));
    await ready();
    expect(inCard().getByLabelText('Город')).toBeTruthy();
  });

  it('нет связи при отправке — «Нет связи…»; повтор с тем же нонсом — «Спасибо»', async () => {
    const { a, m } = await open(feedback);
    await ready();
    fireEvent.click(star(5));
    fireEvent.click(inCard().getByRole('radio', { name: 'Да' }));
    a.scenario.setScenario('submitPublicForm=offline');
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(
      () =>
        expect(document.querySelector('.ox-ff-alert')?.textContent).toBe(
          'Нет связи с сервером. Ответ не отправлен — повторите.',
        ),
      SLOW,
    );
    a.scenario.setScenario(null);
    fireEvent.click(inCard().getByRole('button', { name: 'Отправить' }));
    await waitFor(() => expect(card().textContent).toContain(THANKS), SLOW);
    expect(await responses(a, m)).toHaveLength(1);
  });
});
