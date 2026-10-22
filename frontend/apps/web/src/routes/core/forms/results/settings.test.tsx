// W4.23 · Экранные тесты «Настроек» формы (dc:287–323) и диалога «Поделиться формой» (dc:1081–1087). Сеть — сценарный
// сервер W4.05 (тег Forms поверх домена W4.20, форма «Осмотр машины» «Альты»).
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string) => seedUuid('t-alta', id);
const INSP = A('fm-insp');
const FOREMAN = A('fm-foreman');
const SLOW = { timeout: 8_000 };

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (form: string, tab: string, persona = 'owner'): Promise<MockApp> => {
  // Пресет «Логистика подключена»: Марина Котова — «Менеджер логистики» (видит формы, без «Настраивать»).
  app = await renderMockApp(`/t/${ALTA}/forms?form=${form}&tab=${tab}`, {
    persona,
    preset: 'logistics-ready',
  });
  await screen.findByRole('tablist', { name: 'Разделы формы' }, SLOW);
  return app;
};
const panel = () => document.querySelector<HTMLElement>('.ox-fr-st') as HTMLElement;
const ready = () => waitFor(() => expect(panel()).toBeTruthy(), SLOW);
const radio = (name: RegExp) =>
  within(screen.getByRole('radiogroup', { name: 'Доступ к форме' })).getByRole('radio', { name });
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const sent = (method: string, end: string) =>
  (app?.responses() ?? []).filter((r) => r.method === method && r.path.endsWith(end));

describe('«Настройки»', () => {
  it('карточки эталона, режимы доступа, область, значения по умолчанию', async () => {
    await open(INSP, 'settings');
    await ready();
    expect([...panel().querySelectorAll('h3')].map((h) => h.textContent)).toEqual([
      'Кто может ответить',
      'Приём ответов',
      'Тест с баллами',
      'Вид формы',
    ]);
    expect(radio(/^Сотрудники организации/).getAttribute('aria-checked')).toBe('true');
    expect((radio(/^Все, у кого есть ссылка/) as HTMLButtonElement).disabled).toBe(false);
    const inv = radio(/^По персональному приглашению/) as HTMLButtonElement;
    expect(inv.disabled).toBe(true);
    expect(inv.title).toBe('Появится позже: персональные приглашения со сроком');
    expect((screen.getByLabelText('Хранить ответы') as HTMLSelectElement).value).toBe('365');
    expect((screen.getByLabelText('Текст после отправки') as HTMLTextAreaElement).value).toBe(
      'Спасибо! Ответ отправлен.',
    );
    expect((screen.getByLabelText('Не больше ответов всего') as HTMLInputElement).placeholder).toBe(
      'без ограничения',
    );
    const area = screen.getByLabelText(/^Область формы/) as HTMLSelectElement;
    expect(area.value).toBe('');
    expect([...area.options].map((o) => o.textContent)).toContain('Север Логистик · фирма');
    expect(panel().textContent).toContain(
      'Форму и ответы видят роли с правами «Формы» в этой области.',
    );
    expect(panel().textContent).toContain(
      'Цвет кнопок и логотип берутся из «Оформления» организации.',
    );
  });

  it('флажок — сразу updateForm с If-Match; поле — по потере фокуса; лимит 0 — ошибка сервера', async () => {
    await open(INSP, 'settings');
    await ready();
    fireEvent.click(screen.getByLabelText('Один ответ от сотрудника'));
    await waitFor(() => expect(sent('PATCH', `/forms/${INSP}`)).toHaveLength(1), SLOW);
    await waitFor(
      () =>
        expect(
          (screen.getByLabelText('Один ответ от сотрудника') as HTMLInputElement).checked,
        ).toBe(true),
      SLOW,
    );
    const limit = screen.getByLabelText('Не больше ответов всего') as HTMLInputElement;
    fireEvent.change(limit, { target: { value: '0' } });
    expect(sent('PATCH', `/forms/${INSP}`)).toHaveLength(1);
    fireEvent.blur(limit);
    expect((await within(panel()).findByRole('alert', {}, SLOW)).textContent).toBe(
      'Лимит ответов — положительное число',
    );
    fireEvent.change(limit, { target: { value: '25' } });
    fireEvent.blur(limit);
    await waitFor(() => expect(within(panel()).queryByRole('alert')).toBeNull(), SLOW);
    await waitFor(() => expect(limit.value).toBe('25'), SLOW);
  });

  it('«Считать баллы» — максимум и проходной балл; область — тост «Область формы изменена»', async () => {
    await open(INSP, 'settings');
    await ready();
    fireEvent.click(screen.getByLabelText('Считать баллы за варианты ответа'));
    await screen.findByText('Максимум по форме: 0 баллов', {}, SLOW);
    expect((screen.getByLabelText('Проходной балл') as HTMLInputElement).placeholder).toBe(
      'не задан',
    );
    const area = screen.getByLabelText(/^Область формы/) as HTMLSelectElement;
    const firm = [...area.options].find((o) => o.textContent === 'Север Логистик · фирма');
    fireEvent.change(area, { target: { value: firm?.value } });
    await waitFor(() => expect(toast()).toBe('Область формы изменена'), SLOW);
  });

  it('«Все, у кого есть ссылка» — режим сразу; логист — только просмотр', async () => {
    await open(INSP, 'settings');
    await ready();
    fireEvent.click(radio(/^Все, у кого есть ссылка/));
    await waitFor(
      () => expect(radio(/^Все, у кого есть ссылка/).getAttribute('aria-checked')).toBe('true'),
      SLOW,
    );
    app?.close();
    await open(INSP, 'settings', 'manager');
    await ready();
    expect(screen.getByText('Только просмотр · нет права «Настраивать» формы')).toBeTruthy();
    expect((screen.getByLabelText('Один ответ от сотрудника') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect((radio(/^Все, у кого есть ссылка/) as HTMLButtonElement).disabled).toBe(true);
  });

  it('«Кто может ответить» — одна остановка Tab, стрелки выбирают режим (ARIA radiogroup)', async () => {
    await open(INSP, 'settings');
    await ready();
    const members = radio(/^Сотрудники организации/);
    const pub = radio(/^Все, у кого есть ссылка/);
    const inv = radio(/^По персональному приглашению/);
    expect([members.tabIndex, pub.tabIndex, inv.tabIndex]).toEqual([0, -1, -1]);
    members.focus();
    fireEvent.keyDown(members, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(pub);
    await waitFor(() => expect(pub.getAttribute('aria-checked')).toBe('true'), SLOW);
    expect(sent('PATCH', `/forms/${INSP}`)).toHaveLength(1);
    expect([members.tabIndex, pub.tabIndex]).toEqual([-1, 0]);
    // Неактивное «По персональному приглашению» пропускается: со второго по кругу — на первый.
    fireEvent.keyDown(pub, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(members);
    await waitFor(() => expect(members.getAttribute('aria-checked')).toBe('true'), SLOW);
    fireEvent.keyDown(members, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(pub);
  });

  it('без лишних запросов: подразделения — один раз, после updateForm черновик и версии не перечитываются', async () => {
    await open(INSP, 'settings');
    await ready();
    await waitFor(() => expect(sent('GET', '/draft').length).toBeGreaterThan(0), SLOW);
    await waitFor(() => expect(sent('GET', '/versions').length).toBeGreaterThan(0), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(sent('GET', '/org-units')).toHaveLength(1);
    const draft = sent('GET', '/draft').length;
    const versions = sent('GET', '/versions').length;
    fireEvent.click(screen.getByLabelText('Один ответ от сотрудника'));
    await waitFor(() => expect(sent('PATCH', `/forms/${INSP}`)).toHaveLength(1), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(sent('GET', '/draft')).toHaveLength(draft);
    expect(sent('GET', '/versions')).toHaveLength(versions);
    expect(sent('GET', '/org-units')).toHaveLength(1);
  });

  // Возврат 4: черновик в кэше — один вид данных с редактором W4.22 ({draft, etag}). Вопрос CRM, который есть только
  // в черновике, после команды другой вкладки (общая инвалидация «Форм») по-прежнему закрывает публичный доступ.
  it('команда вкладки → «Настройки»: вопрос CRM черновика закрывает «Все, у кого есть ссылка»', async () => {
    app = await renderMockApp(`/t/${ALTA}/forms?form=${INSP}&tab=actions`, {
      persona: 'owner',
      preset: 'logistics-ready',
    });
    const rule = await waitFor(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.ox-fr-rule')].find(
        (r) => r.querySelector('strong')?.textContent === 'Создать задачу',
      );
      expect(el).toBeTruthy();
      return el as HTMLElement;
    }, SLOW);
    // В черновике сервера — новый вопрос «Ответственный» (сотрудник, CRM); в действующей версии его нет.
    const org = app.scenario.state().orgs[ALTA] as unknown as {
      formsData: {
        forms: { id: string; draft: { definition: { fields: Record<string, unknown>[] } } }[];
      };
    };
    const row = org.formsData.forms.find((x) => x.id === INSP);
    if (!row) throw new Error('нет формы «Осмотр машины» в состоянии сервера');
    row.draft.definition.fields.push({
      key: 'q-resp',
      label: 'Ответственный',
      type: 'person',
      required: false,
    });
    fireEvent.click(within(rule).getByLabelText('Включено'));
    await waitFor(() => expect(toast()).toBe('Действие выключено'), SLOW);
    await new Promise((r) => setTimeout(r, 500));
    fireEvent.click(screen.getByRole('tab', { name: 'Настройки' }));
    await ready();
    const pub = radio(/^Все, у кого есть ссылка/) as HTMLButtonElement;
    expect(pub.disabled).toBe(true);
    expect(pub.textContent).toContain('«Ответственный»');
  });

  it('ошибка загрузки вкладки — своя карточка ошибки с кнопкой «Повторить» страницы форм', async () => {
    app = await renderMockApp(`/t/${ALTA}/forms?form=${INSP}&tab=versions`, {
      persona: 'owner',
      scenario: 'listFormVersions=rate_limited',
    });
    const vs = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('.ox-fr-vs');
      expect(el?.textContent).toMatch(/Не удалось загрузить данные/);
      return el as HTMLElement;
    }, SLOW);
    // Классы страницы форм (results.css), а не modules.css «Модулей», которых здесь нет.
    expect(vs.querySelector('.ox-mod-alert')).toBeNull();
    expect(vs.querySelector('.ox-fr-failed [role="alert"]')?.textContent).toMatch(
      /^Не удалось загрузить данные: /,
    );
    const retry = within(vs).getByRole('button', { name: 'Повторить' });
    expect(retry.className).toBe('ox-fr-btn');
  });

  it('ошибка загрузки формы — «Повторить»', async () => {
    app = await renderMockApp(`/t/${ALTA}/forms?form=${INSP}&tab=settings`, {
      persona: 'owner',
      scenario: 'getForm=rate_limited',
    });
    await screen.findByText(/Не удалось загрузить данные/, {}, SLOW);
    app.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await screen.findByRole('tablist', { name: 'Разделы формы' }, SLOW);
  });
});

describe('«Поделиться формой»', () => {
  it('сотрудники: ссылка /forms/{id}, «Копировать» → «Скопировано», Escape закрывает', async () => {
    await open(INSP, 'settings');
    fireEvent.click(screen.getByRole('button', { name: 'Поделиться' }));
    const d = await screen.findByRole('dialog', {}, SLOW);
    expect(within(d).getByRole('heading', { level: 2 }).textContent).toBe('Поделиться формой');
    expect(d.textContent).toContain('Доступ настраивается во вкладке «Настройки».');
    const link = within(d).getByLabelText('Ссылка для сотрудников') as HTMLInputElement;
    expect(link.value).toMatch(new RegExp(`/forms/${INSP}$`));
    fireEvent.click(within(d).getByRole('button', { name: 'Копировать' }));
    await within(d).findByRole('button', { name: 'Скопировано' }, SLOW);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('перерисовка редактора под диалогом не уводит фокус с «Копировать»', async () => {
    await open(INSP, 'settings');
    fireEvent.click(screen.getByRole('button', { name: 'Поделиться' }));
    const d = await screen.findByRole('dialog', {}, SLOW);
    const copy = within(d).getByRole('button', { name: 'Копировать' });
    copy.focus();
    expect(document.activeElement).toBe(copy);
    // Новый адрес той же формы и вкладки — страница и редактор W4.22 под диалогом перерисовываются (новая onClose).
    const box = d.querySelector('[tabindex="-1"]');
    await app?.router.navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId: ALTA, page: 'forms' },
      search: { form: INSP, tab: 'settings', x: '1' } as never,
      replace: true,
    });
    await waitFor(() => expect(app?.router.state.location.search).toMatchObject({ x: '1' }));
    expect(screen.getByRole('dialog').querySelector('[tabindex="-1"]')).toBe(box);
    expect(document.activeElement).toBe(copy);
  });

  it.each(['offline', 'rate_limited'])(
    'getForm=%s после открытия редактора — «Поделиться» не перечитывает форму: диалог и редактор на месте',
    async (code) => {
      await open(INSP, 'settings');
      await ready();
      const reads = sent('GET', `/forms/${INSP}`).length;
      app?.scenario.setScenario(`getForm=${code}`);
      const share = screen.getByRole('button', { name: 'Поделиться' });
      share.focus();
      fireEvent.click(share);
      const d = await screen.findByRole('dialog', {}, SLOW);
      // Повтор запроса (если он есть) — через ~1 с: ждать дольше.
      await new Promise((r) => setTimeout(r, 2500));
      expect(sent('GET', `/forms/${INSP}`)).toHaveLength(reads);
      expect(screen.queryByText(/Не удалось загрузить данные/)).toBeNull();
      expect(d.isConnected).toBe(true);
      expect(document.querySelector('.ox-fm-editor')).toBeTruthy();
      expect(within(d).getByLabelText('Ссылка для сотрудников')).toBeTruthy();
      expect(d.contains(document.activeElement)).toBe(true);
    },
  );

  it('публичная форма: публичная ссылка и код для сайта; черновик — без ссылок', async () => {
    await open(INSP, 'settings');
    await ready();
    fireEvent.click(radio(/^Все, у кого есть ссылка/));
    await waitFor(
      () => expect(radio(/^Все, у кого есть ссылка/).getAttribute('aria-checked')).toBe('true'),
      SLOW,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Поделиться' }));
    const d = await screen.findByRole('dialog', {}, SLOW);
    expect((within(d).getByLabelText('Публичная ссылка') as HTMLInputElement).value).toMatch(
      /\/f\/f[0-9a-f]+$/,
    );
    expect((within(d).getByLabelText('Код для сайта') as HTMLInputElement).value).toMatch(
      /^<iframe src=".+\?embed=1" width="100%" height="640" frameborder="0"><\/iframe>$/,
    );
    app?.close();
    await open(FOREMAN, 'settings');
    fireEvent.click(screen.getByRole('button', { name: 'Поделиться' }));
    const d2 = await screen.findByRole('dialog', {}, SLOW);
    expect(d2.textContent).toContain('Ссылка появится после публикации: сейчас форма — черновик.');
    expect(within(d2).queryAllByRole('textbox')).toHaveLength(0);
  });
});
