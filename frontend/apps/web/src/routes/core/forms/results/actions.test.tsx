// W4.23 · Экранные тесты «Действий после ответа» (dc:324–410): карточки правил «Осмотра машины» «Альты», включение,
// новое действие пяти видов, «в БЗ» на существующую таблицу и на новую страницу с таблицей, «Изменить», «Удалить»,
// «Перенести прошлые ответы», только просмотр. Сеть — сценарный сервер W4.05 (задачи — W4.03, «в БЗ» — W4.04).
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { type MockApp, renderMockApp } from '../../../../app/testing.tsx';

const ALTA = seedUuid('platform', 't-alta');
const INSP = seedUuid('t-alta', 'fm-insp');
const SLOW = { timeout: 10_000 };

let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
});

const open = async (persona = 'owner', scenario?: string): Promise<MockApp> => {
  app = await renderMockApp(`/t/${ALTA}/forms?form=${INSP}&tab=actions`, {
    persona,
    preset: 'logistics-ready',
    ...(scenario ? { scenario } : {}),
  });
  await waitFor(() => expect(rules().length).toBeGreaterThan(0), SLOW);
  return app;
};
const panel = () => document.querySelector<HTMLElement>('.ox-fr-ac') as HTMLElement;
const rules = () => [...document.querySelectorAll<HTMLElement>('.ox-fr-rule')];
const rule = (title: string) =>
  rules().find((r) => r.querySelector('strong')?.textContent === title) as HTMLElement;
const ed = () => document.querySelector<HTMLElement>('.ox-fr-red') as HTMLElement;
const add = (name: string) =>
  within(document.querySelector('.ox-fr-adds') as HTMLElement).getByRole('button', { name });
const toast = () => document.querySelector('.ox-toast .ox-toast-text')?.textContent;
const save = () => fireEvent.click(within(ed()).getByRole('button', { name: 'Сохранить' }));
const select = (label: string | RegExp, text: string) => {
  const s = within(ed()).getByLabelText(label) as HTMLSelectElement;
  const o = [...s.options].find((x) => x.textContent === text);
  if (!o)
    throw new Error(
      `нет варианта «${text}» в «${String(label)}»: ${[...s.options].map((x) => x.textContent).join(' | ')}`,
    );
  fireEvent.change(s, { target: { value: o.value } });
};

describe('«Действия после ответа»', () => {
  it('карточки эталона: «Создать задачу» и «Сохранить в Базу знаний», пять кнопок «добавить»', async () => {
    await open();
    // Карточки — после имён сотрудников: без мелькания «без исполнителя», пока грузится listMembers.
    expect(rule('Создать задачу').textContent).not.toContain('без исполнителя');
    expect(panel().textContent).toContain(
      'Действие выполняется один раз для каждого ответа. Ответ формы — заявление человека: деньги, склад и объёмы меняют только команды своих модулей.',
    );
    expect(rules()).toHaveLength(2);
    await waitFor(
      () =>
        expect(rule('Создать задачу').textContent).toContain(
          'Задача «Проверить осмотр» → Марина Котова',
        ),
      SLOW,
    );
    expect(rule('Создать задачу').textContent).toContain('после принятия ответа · правило v1');
    const kb = rule('Сохранить в Базу знаний');
    expect(kb.textContent).toContain(
      'Строка в таблицу «Осмотры» · страница «Журнал осмотров машин»',
    );
    expect(kb.textContent).toContain('после принятия ответа · правило v1 · записано ответов: 2');
    expect(within(kb).getByRole('button', { name: 'Открыть страницу' })).toBeTruthy();
    expect(within(kb).queryByRole('button', { name: /Перенести прошлые ответы/ })).toBeNull();
    expect(
      [...(document.querySelector('.ox-fr-adds')?.querySelectorAll('button') ?? [])].map((b) =>
        b.textContent?.replace(/^[a-z_]+/, ''),
      ),
    ).toEqual([
      'Создать задачу',
      'Уведомить сотрудника',
      'Письмо на почту',
      'HTTP-запрос',
      'Сохранить в Базу знаний',
    ]);
  });

  it('«Включено» — выключить: тост, счётчик вкладки', async () => {
    await open();
    const tab = () => screen.getByRole('tab', { name: /^Действия после ответа/ });
    expect(tab().textContent).toBe('Действия после ответа2');
    fireEvent.click(within(rule('Создать задачу')).getByLabelText('Включено'));
    await waitFor(() => expect(toast()).toBe('Действие выключено'), SLOW);
    await waitFor(() => expect(tab().textContent).toBe('Действия после ответа1'), SLOW);
  });

  // Возврат 4: черновик в кэше — один вид данных с редактором W4.22 ({draft, etag}). После команды вкладки (общая
  // инвалидация «Форм») черновик перечитывается — вопросы формы в «Только если» и в «в БЗ» остаются.
  it('команда вкладки → «Только если» и источники «в БЗ» по вопросам формы на месте', async () => {
    await open();
    const conds = () =>
      [...(within(ed()).getByLabelText(/^Только если/) as HTMLSelectElement).options].map(
        (o) => o.textContent,
      );
    const newPageCols = async () => {
      fireEvent.click(add('Сохранить в Базу знаний'));
      await waitFor(
        () =>
          expect(
            [
              ...(within(ed()).getByLabelText(/^Страница Базы знаний/) as HTMLSelectElement)
                .options,
            ].map((o) => o.textContent),
          ).toContain('＋ Новая страница'),
        SLOW,
      );
      select(/^Страница Базы знаний/, '＋ Новая страница');
      const cols = [...ed().querySelectorAll('.ox-fr-map-row')].length;
      fireEvent.click(within(ed()).getByRole('button', { name: 'Отмена' }));
      return cols;
    };
    fireEvent.click(add('Создать задачу'));
    const fresh = conds();
    expect(fresh).toContain('Есть дефекты?');
    expect(fresh.length).toBeGreaterThan(1);
    fireEvent.click(within(ed()).getByRole('button', { name: 'Отмена' }));
    const freshCols = await newPageCols();
    expect(freshCols).toBeGreaterThan(4);

    fireEvent.click(within(rule('Создать задачу')).getByLabelText('Включено'));
    await waitFor(() => expect(toast()).toBe('Действие выключено'), SLOW);
    // Перечитывание после команды — дождаться ответа черновика.
    await new Promise((r) => setTimeout(r, 500));
    fireEvent.click(add('Создать задачу'));
    expect(conds()).toEqual(fresh);
    fireEvent.click(within(ed()).getByRole('button', { name: 'Отмена' }));
    expect(await newPageCols()).toBe(freshCols);
  });

  it('новая задача: заголовок, «Когда», «Только если», ошибка названия; «Действие добавлено»', async () => {
    await open();
    fireEvent.click(add('Создать задачу'));
    expect(ed().querySelector('h3')?.textContent).toBe('Новое действие: создать задачу');
    expect(document.querySelector('.ox-fr-adds')).toBeNull();
    expect((within(ed()).getByLabelText('Когда') as HTMLSelectElement).value).toBe('submitted');
    const title = within(ed()).getByLabelText('Название задачи') as HTMLInputElement;
    expect(title.value).toBe('Проверить ответ: Осмотр машины');
    fireEvent.change(title, { target: { value: ' ' } });
    save();
    expect(within(ed()).getByRole('alert').textContent).toBe('Укажите название задачи');
    fireEvent.change(title, { target: { value: 'Разобрать осмотр' } });
    select(/^Только если/, 'Есть дефекты?');
    expect((within(ed()).getByLabelText(/^равно/) as HTMLSelectElement).value).toBe('true');
    await waitFor(
      () =>
        expect(
          (within(ed()).getByLabelText(/^Исполнитель/) as HTMLSelectElement).options.length,
        ).toBeGreaterThan(0),
      SLOW,
    );
    save();
    await waitFor(() => expect(toast()).toBe('Действие добавлено'), SLOW);
    await waitFor(() => expect(rules()).toHaveLength(3), SLOW);
    expect(rules()[2]?.textContent).toContain('Задача «Разобрать осмотр» →');
    expect(rules()[2]?.textContent).toContain(
      'после отправки ответа · если «Есть дефекты?» = да · правило v1',
    );
  });

  it('письмо и HTTP: проверки адреса и пояснения показа; HTTP — карточка «POST …»', async () => {
    await open();
    fireEvent.click(add('Письмо на почту'));
    expect(ed().textContent).toContain('На показе письма не отправляются.');
    fireEvent.change(within(ed()).getByLabelText('Адрес'), { target: { value: 'почта' } });
    save();
    expect(within(ed()).getByRole('alert').textContent).toBe('Укажите адрес почты');
    fireEvent.click(within(ed()).getByRole('button', { name: 'Отмена' }));
    fireEvent.click(add('HTTP-запрос'));
    expect(ed().textContent).toContain(
      'На показе запрос не выполняется. В продукте — подписанный вебхук с повтором.',
    );
    const url = within(ed()).getByLabelText('Адрес запроса (POST, JSON с ответами)');
    fireEvent.change(url, { target: { value: 'http://example.ru' } });
    save();
    expect(within(ed()).getByRole('alert').textContent).toBe(
      'Адрес запроса должен начинаться с https://',
    );
    fireEvent.change(url, { target: { value: 'https://example.ru/hook' } });
    save();
    await waitFor(() => expect(toast()).toBe('Действие добавлено'), SLOW);
    await waitFor(
      () => expect(rule('HTTP-запрос').textContent).toContain('POST https://example.ru/hook'),
      SLOW,
    );
  });

  it('«в БЗ» на таблицу «Осмотры»: сопоставление, пример R-1012, подтверждение обязательно', async () => {
    await open();
    fireEvent.click(add('Сохранить в Базу знаний'));
    expect((within(ed()).getByLabelText('Когда') as HTMLSelectElement).value).toBe('accepted');
    expect(ed().textContent).toContain('Выберите страницу или создайте новую');
    await waitFor(
      () =>
        expect(
          [
            ...(within(ed()).getByLabelText(/^Страница Базы знаний/) as HTMLSelectElement).options,
          ].map((o) => o.textContent),
        ).toContain('Логистика · Журнал осмотров машин'),
      SLOW,
    );
    select(/^Страница Базы знаний/, 'Логистика · Журнал осмотров машин');
    await waitFor(
      () =>
        expect(
          [
            ...(within(ed()).getByLabelText(/^Таблица на странице/) as HTMLSelectElement).options,
          ].map((o) => o.textContent),
        ).toEqual(['Осмотры · строк: 2', 'Новая таблица по вопросам формы']),
      SLOW,
    );
    await waitFor(
      () => expect(ed().textContent).toContain('Столбцы таблицы и данные для них'),
      SLOW,
    );
    expect((within(ed()).getByLabelText('Данные для поля «Дата»') as HTMLSelectElement).value).toBe(
      '$at',
    );
    await waitFor(
      () =>
        expect(ed().textContent).toContain(
          'Так будет выглядеть строка для ответа R-1012 от 27.09 09:05',
        ),
      SLOW,
    );
    save();
    expect(within(ed()).getByRole('alert').textContent).toBe(
      'Подтвердите, что записи увидят все сотрудники с доступом к странице',
    );
    fireEvent.click(within(ed()).getByLabelText(/^Понимаю: записи увидят все сотрудники/));
    save();
    await waitFor(() => expect(toast()).toBe('Действие добавлено'), SLOW);
    await waitFor(() => expect(rules()).toHaveLength(3), SLOW);
  });

  it('«＋ Новая страница» с новой таблицей — тост эталона, затем «Перенести прошлые ответы · 2»', async () => {
    await open();
    fireEvent.click(add('Сохранить в Базу знаний'));
    await waitFor(
      () =>
        expect(
          [
            ...(within(ed()).getByLabelText(/^Страница Базы знаний/) as HTMLSelectElement).options,
          ].map((o) => o.textContent),
        ).toContain('＋ Новая страница'),
      SLOW,
    );
    select(/^Страница Базы знаний/, '＋ Новая страница');
    expect((within(ed()).getByLabelText('Название страницы') as HTMLInputElement).value).toBe(
      'Ответы: Осмотр машины',
    );
    expect((within(ed()).getByLabelText('Название новой таблицы') as HTMLInputElement).value).toBe(
      'Ответы формы',
    );
    expect(ed().textContent).toContain('Столбцы новой таблицы');
    fireEvent.click(within(ed()).getByLabelText(/^Понимаю: записи увидят все сотрудники/));
    save();
    await waitFor(
      () =>
        expect(toast()).toBe(
          'Страница «Ответы: Осмотр машины» создана с таблицей «Ответы формы». Действие добавлено',
        ),
      SLOW,
    );
    await waitFor(() => expect(rules()).toHaveLength(3), SLOW);
    const created = rules()[2] as HTMLElement;
    expect(created.textContent).toContain(
      'Строка в таблицу «Ответы формы» · страница «Ответы: Осмотр машины»',
    );
    fireEvent.click(within(created).getByRole('button', { name: 'Перенести прошлые ответы · 2' }));
    await waitFor(() => expect(toast()).toBe('Перенесено в Базу знаний: 2 ответа'), SLOW);
  });

  it('«Страница Базы знаний»: у страницы со своим доступом — « · только владелец» (dc:941)', async () => {
    await open();
    fireEvent.click(add('Сохранить в Базу знаний'));
    const opts = () =>
      [...(within(ed()).getByLabelText(/^Страница Базы знаний/) as HTMLSelectElement).options].map(
        (o) => o.textContent,
      );
    await waitFor(
      () =>
        expect(opts()).toContain('Руководство · Политика начислений водителям · только владелец'),
      SLOW,
    );
    expect(opts()).toContain('Логистика · Журнал осмотров машин');
  });

  it('«＋ Новая страница» «Только владелец»: доступ страницы — «Только выбранные» до правила, без «Понимаю…»', async () => {
    const a = await open();
    fireEvent.click(add('Сохранить в Базу знаний'));
    await waitFor(
      () =>
        expect(
          [
            ...(within(ed()).getByLabelText(/^Страница Базы знаний/) as HTMLSelectElement).options,
          ].map((o) => o.textContent),
        ).toContain('＋ Новая страница'),
      SLOW,
    );
    select(/^Страница Базы знаний/, '＋ Новая страница');
    const who = within(ed()).getByRole('group', { name: 'Кто видит страницу' });
    fireEvent.click(within(who).getByRole('button', { name: 'Только владелец' }));
    expect(ed().textContent).toContain('Страницу и записи увидит только владелец.');
    expect(within(ed()).queryByLabelText(/^Понимаю: записи увидят все сотрудники/)).toBeNull();
    // Пример строки: вопрос-фото — «5 фото · файлы в ответе R-1012» (formVal models.js:113; в сиде — текст «5 фото»).
    await waitFor(
      () =>
        expect([...ed().querySelectorAll('.ox-fr-pv td')].map((td) => td.textContent)).toContain(
          '5 фото · файлы в ответе R-1012',
        ),
      SLOW,
    );
    save();
    await waitFor(
      () =>
        expect(toast()).toBe(
          'Страница «Ответы: Осмотр машины» создана с таблицей «Ответы формы». Действие добавлено',
        ),
      SLOW,
    );
    // Порядок команд: страница → доступ «Только выбранные» → таблица → правило.
    const seen = a
      .responses()
      .filter((r) => r.method !== 'GET')
      .map((r) => `${r.method} ${r.path.replace(/[0-9a-f-]{36}/g, ':id')} ${r.status}`);
    const iNode = seen.indexOf('POST /api/v1/tenants/:id/knowledge/spaces/:id/nodes 201');
    const iAccess = seen.indexOf('PUT /api/v1/tenants/:id/knowledge/nodes/:id/access 200');
    const iRule = seen.indexOf('POST /api/v1/tenants/:id/forms/:id/rules 201');
    expect(iNode).toBeGreaterThanOrEqual(0);
    expect(iAccess).toBeGreaterThan(iNode);
    expect(iRule).toBeGreaterThan(iAccess);
    // Состояние сервера: страница «Только выбранные» без записей — читают руководитель и владелец бизнеса.
    const org = a.scenario.state().orgs[ALTA] as unknown as {
      knowledge: {
        db: { knowledge: { pages: { title: string; mode?: string; list?: unknown[] }[] } };
      };
    };
    const pg = org.knowledge.db.knowledge.pages.find((x) => x.title === 'Ответы: Осмотр машины');
    expect(pg?.mode).toBe('listed');
    expect(pg?.list).toEqual([]);
  });

  it('«Только владелец»: доступ не установлен — правило не создаётся, страница выбрана, нужно «Понимаю…»', async () => {
    const a = await open();
    a.scenario.setScenario('setKnowledgeNodeAccess=rate_limited');
    fireEvent.click(add('Сохранить в Базу знаний'));
    await waitFor(
      () =>
        expect(
          [
            ...(within(ed()).getByLabelText(/^Страница Базы знаний/) as HTMLSelectElement).options,
          ].map((o) => o.textContent),
        ).toContain('＋ Новая страница'),
      SLOW,
    );
    select(/^Страница Базы знаний/, '＋ Новая страница');
    const who = within(ed()).getByRole('group', { name: 'Кто видит страницу' });
    fireEvent.click(within(who).getByRole('button', { name: 'Только владелец' }));
    save();
    await waitFor(
      () =>
        expect(within(ed()).getByRole('alert').textContent).toMatch(
          /^Страница создана, но доступ «Только владелец» не установлен: .+\. Действие не сохранено$/,
        ),
      SLOW,
    );
    expect(
      a.responses().some((r) => r.method === 'POST' && /\/forms\/[^/]+\/rules$/.test(r.path)),
    ).toBe(false);
    expect(rules()).toHaveLength(2);
    // Страница уже есть с доступом пространства: она выбрана, записи увидят все — подтверждение обязательно.
    await waitFor(
      () =>
        expect(within(ed()).getByLabelText(/^Понимаю: записи увидят все сотрудники/)).toBeTruthy(),
      SLOW,
    );
    expect(ed().querySelector('.ox-fr-kb-access')?.textContent).toContain('Все сотрудники');
    // Таблица страницы выбирается сама после загрузки узла — сообщение об отказе доступа при этом не пропадает.
    await waitFor(() => expect(ed().querySelector('.ox-fr-np')).toBeNull(), SLOW);
    await new Promise((r) => setTimeout(r, 300));
    expect(within(ed()).getByRole('alert').textContent).toMatch(
      /^Страница создана, но доступ «Только владелец» не установлен: /,
    );
  });

  // Возврат 2: отказ последнего шага (правила) после созданной страницы — «нет связи», 429 (не QUIET). Эталон dc:665:
  // при любой ошибке правила — «Страница создана, но действие не сохранено: …», страница выбрана, редактор работает.
  it.each(['rate_limited', 'offline'])(
    '«＋ Новая страница»: createFormRule=%s — «Страница создана, но действие не сохранено», страница выбрана, повтор сохраняет',
    async (code) => {
      const a = await open();
      fireEvent.click(add('Сохранить в Базу знаний'));
      await waitFor(
        () =>
          expect(
            [
              ...(within(ed()).getByLabelText(/^Страница Базы знаний/) as HTMLSelectElement)
                .options,
            ].map((o) => o.textContent),
          ).toContain('＋ Новая страница'),
        SLOW,
      );
      select(/^Страница Базы знаний/, '＋ Новая страница');
      fireEvent.click(within(ed()).getByLabelText(/^Понимаю: записи увидят все сотрудники/));
      a.scenario.setScenario(`createFormRule=${code}`);
      save();
      await waitFor(
        () =>
          expect(within(ed()).getByRole('alert').textContent).toMatch(
            /^Страница создана, но действие не сохранено: .+/,
          ),
        SLOW,
      );
      const btn = within(ed()).getByRole('button', { name: 'Сохранить' });
      expect(btn.getAttribute('aria-busy')).toBe('false');
      expect(
        (within(ed()).getByRole('button', { name: 'Отмена' }) as HTMLButtonElement).disabled,
      ).toBe(false);
      // Созданная страница выбрана — повтор не создаёт её заново («В этом разделе уже есть страница …»).
      await waitFor(() => expect(ed().querySelector('.ox-fr-np')).toBeNull(), SLOW);
      const page = within(ed()).getByLabelText(/^Страница Базы знаний/) as HTMLSelectElement;
      expect(page.selectedOptions[0]?.textContent).toBe('Логистика · Ответы: Осмотр машины');
      expect(rules()).toHaveLength(2);
      a.scenario.setScenario(null);
      save();
      await waitFor(() => expect(toast()).toBe('Действие добавлено'), SLOW);
      await waitFor(() => expect(rules()).toHaveLength(3), SLOW);
      const nodes = a
        .responses()
        .filter((r) => r.method === 'POST' && /\/knowledge\/spaces\/[^/]+\/nodes$/.test(r.path));
      expect(nodes).toHaveLength(1);
      expect(rules()[2]?.textContent).toContain(
        'Строка в таблицу «Ответы формы» · страница «Ответы: Осмотр машины»',
      );
    },
  );

  it('логист: исполнитель задачи — сама Марина Котова, а не «без исполнителя»', async () => {
    await open('manager');
    await waitFor(
      () =>
        expect(rule('Создать задачу').textContent).toContain(
          'Задача «Проверить осмотр» → Марина Котова',
        ),
      SLOW,
    );
    expect(rule('Создать задачу').textContent).not.toContain('без исполнителя');
  });

  it('фокус: редактор открыт — на его заголовке; «Отмена» — обратно на кнопку, которая его открыла', async () => {
    await open();
    const mail = add('Письмо на почту');
    mail.focus();
    fireEvent.click(mail);
    await waitFor(() => expect(document.activeElement).toBe(ed().querySelector('h3')));
    fireEvent.click(within(ed()).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(document.activeElement).toBe(add('Письмо на почту')));
    const change = within(rule('Создать задачу')).getByRole('button', { name: 'Изменить' });
    change.focus();
    fireEvent.click(change);
    await waitFor(() => expect(document.activeElement).toBe(ed().querySelector('h3')));
    fireEvent.click(within(ed()).getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(document.activeElement).toBe(change));
  });

  it('фокус: «Удалить действие» — на соседнюю карточку, последнее — на кнопку «добавить»', async () => {
    await open();
    const delOf = (title: string) =>
      within(rule(title)).getByRole('button', { name: 'Удалить действие' });
    const first = delOf('Создать задачу');
    first.focus();
    fireEvent.click(first);
    await waitFor(() => expect(rules()).toHaveLength(1), SLOW);
    // Карточка «в БЗ» встала на место удалённой — фокус на её первом элементе управления.
    await waitFor(
      () =>
        expect(document.activeElement).toBe(
          within(rules()[0] as HTMLElement).getByLabelText('Включено'),
        ),
      SLOW,
    );
    const last = delOf('Сохранить в Базу знаний');
    last.focus();
    fireEvent.click(last);
    await waitFor(() => expect(rules()).toHaveLength(0), SLOW);
    await waitFor(() => expect(document.activeElement).toBe(add('Создать задачу')), SLOW);
  });

  it('«Изменить» — правило v2; «Удалить действие» «в БЗ» — тост эталона', async () => {
    await open();
    fireEvent.click(within(rule('Создать задачу')).getByRole('button', { name: 'Изменить' }));
    expect(ed().querySelector('h3')?.textContent).toBe('Изменить: создать задачу');
    fireEvent.change(within(ed()).getByLabelText('Название задачи'), {
      target: { value: 'Проверить осмотр машины' },
    });
    save();
    await waitFor(() => expect(toast()).toBe('Действие обновлено · правило v2'), SLOW);
    await waitFor(() => expect(rule('Создать задачу').textContent).toContain('правило v2'), SLOW);
    fireEvent.click(
      within(rule('Сохранить в Базу знаний')).getByRole('button', { name: 'Удалить действие' }),
    );
    await waitFor(
      () => expect(toast()).toBe('Действие удалено. Уже записанные строки остаются в Базе знаний'),
      SLOW,
    );
    await waitFor(() => expect(rules()).toHaveLength(1), SLOW);
  });

  it('логист — только просмотр; ошибка загрузки правил — «Повторить»', async () => {
    await open('manager');
    expect(
      (within(rule('Создать задачу')).getByLabelText('Включено') as HTMLInputElement).disabled,
    ).toBe(true);
    expect(within(panel()).queryByRole('button', { name: 'Изменить' })).toBeNull();
    expect(document.querySelector('.ox-fr-adds')).toBeNull();
    app?.close();
    app = await renderMockApp(`/t/${ALTA}/forms?form=${INSP}&tab=actions`, {
      persona: 'owner',
      scenario: 'listFormRules=rate_limited',
    });
    await screen.findByText(/Не удалось загрузить данные/, {}, SLOW);
    app.scenario.setScenario(null);
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(rules()).toHaveLength(2), SLOW);
  });
});
