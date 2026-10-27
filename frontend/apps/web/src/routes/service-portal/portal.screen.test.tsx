// W7.33 · Экранные тесты портала клиента: `public-service-page` (`/s/{slug}`) и `public-service-request`
// (`/r/{token}`). Эталон — design-2026-10-19 «Обращения - варианты.dc.html» 1a. Сеть — сценарный сервер W7.00
// (тег PublicService); сессии и оболочки нет, `/me/context` не запрашивается.
import { seedUuid } from '@ortus/domain/seed';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MockApp, renderMockApp } from '../../app/testing.tsx';
import { jpeg } from '../core/forms/fill/testing.ts';

// Хранилище объектов mock (adapter msw/files) знает только сессии initiateUpload; билеты портала (msw/service,
// W7.00) в него не заведены, поэтому PUT по билету подменён — остальные шаги загрузки идут через сценарный сервер.
vi.mock('../core/files/upload/upload.tsx', async (orig) => ({
  ...(await orig<typeof import('../core/files/upload/upload.tsx')>()),
  putObject: () => Promise.resolve(),
}));

const SLOW = { timeout: 8_000 };
let app: MockApp | undefined;
afterEach(() => {
  app?.close();
  app = undefined;
  localStorage.clear();
});

/** Личная ссылка seed-обращения сценарного сервера (`portalToken` msw/service). */
const tokenOf = (id: string): string => `tok_${seedUuid('t-alta', id).replaceAll('-', '')}z`;

const main = (): HTMLElement => document.querySelector<HTMLElement>('main.ox-sp') as HTMLElement;
const ui = () => within(main());
const open = async (url: string): Promise<MockApp> => {
  app = await renderMockApp(url);
  return app;
};
const field = (label: string) => ui().getByLabelText(label);
const click = (name: string | RegExp, role = 'button') =>
  fireEvent.click(ui().getByRole(role, { name }));
const errors = () => [...main().querySelectorAll('.ox-sp-err')].map((e) => e.textContent);

describe('public-service-page: страница направления', () => {
  it('без оболочки и /me/context: бренд, направление, «Чем помочь?», три группы типов', async () => {
    const a = await open('/s/mas');
    await waitFor(
      () => expect(ui().getByRole('heading', { level: 1, name: 'Чем помочь?' })).toBeTruthy(),
      SLOW,
    );
    expect(main().textContent).toContain('Альта Групп');
    expect(main().textContent).toContain('Массаж');
    expect(document.querySelector('nav')).toBeNull();
    const groups = [...main().querySelectorAll('.ox-sp-group h2')].map((h) => h.textContent);
    expect(groups).toEqual(['Оценить и поблагодарить', 'Если что-то не так', 'Другое']);
    for (const n of [
      'Спасибо мастеру',
      'Жалоба',
      'Вернуть деньги за услугу',
      'Вопрос',
      'Предложение',
    ])
      expect(ui().getByRole('button', { name: new RegExp(n) })).toBeTruthy();
    expect(ui().queryByRole('button', { name: /Оценить визит/ })).toBeNull();
    expect(a.responses().map((r) => r.path)).not.toContain('/api/v1/me/context');
    expect(ui().queryByText(/Мои обращения/)).toBeNull();
  });

  it('неизвестный slug — «Страница не найдена»', async () => {
    await open('/s/nope');
    await waitFor(() => expect(main().textContent).toContain('Страница не найдена'), SLOW);
  });

  it('жалоба: проверки полей, отправка, квитанция с личной ссылкой и «Мои обращения · 1»', async () => {
    const a = await open('/s/mas');
    await waitFor(() => click(/Жалоба/), SLOW);
    expect(ui().getByRole('heading', { level: 1, name: 'Жалоба' })).toBeTruthy();
    click('Отправить');
    expect(errors()).toEqual([
      'Опишите, что случилось',
      'Нужно согласие на обработку персональных данных',
    ]);
    fireEvent.change(field('Ваше имя'), { target: { value: 'Ольга' } });
    fireEvent.change(field('Телефон'), { target: { value: '+7 900 12' } });
    fireEvent.change(field('Опишите, что случилось'), {
      target: { value: 'Начали позже, холодно' },
    });
    fireEvent.click(field('Согласен на обработку персональных данных'));
    click('Отправить');
    expect(errors()).toEqual(['Телефон — не меньше 10 цифр']);
    fireEvent.change(field('Телефон'), { target: { value: '+7 900 123-45-67' } });
    click('Отправить');
    await waitFor(() => expect(ui().getByText('Приняли ваше обращение')).toBeTruthy(), SLOW);
    const link = ui().getByRole('link', { name: 'Следить за ответом' });
    expect(link.getAttribute('href')).toMatch(/^\/r\/tok_/);
    expect(main().textContent).toMatch(/МАС-\d+/);
    expect(main().textContent).toContain('Получили');
    expect(
      a
        .responses()
        .some(
          (r) =>
            r.method === 'POST' &&
            r.path === '/api/v1/public/service/mas/requests' &&
            r.status === 201,
        ),
    ).toBe(true);
    click('Написать ещё');
    await waitFor(() =>
      expect(ui().getByRole('button', { name: /Мои обращения · 1/ })).toBeTruthy(),
    );
  });

  it('«Мои обращения»: список обращений браузера со ссылками', async () => {
    localStorage.setItem(
      'ox-sp-mine:mas',
      JSON.stringify([{ key: 'МАС-41', title: 'Начали позже', token: tokenOf('r-41') }]),
    );
    await open('/s/mas');
    await waitFor(() => click(/Мои обращения · 1/), SLOW);
    const link = ui().getByRole('link', { name: /МАС-41/ });
    expect(link.getAttribute('href')).toBe(`/r/${tokenOf('r-41')}`);
    expect(main().textContent).toContain('Начали позже');
  });

  it('вопрос без согласия не уходит; «Назад» возвращает к списку', async () => {
    await open('/s/mas');
    await waitFor(() => click(/^Вопрос/), SLOW);
    fireEvent.change(field('Опишите, что случилось'), {
      target: { value: 'Можно ли с ребёнком?' },
    });
    click('Отправить');
    expect(errors()).toEqual(['Нужно согласие на обработку персональных данных']);
    click('Назад');
    expect(ui().getByRole('heading', { level: 1, name: 'Чем помочь?' })).toBeTruthy();
  });
});

describe('public-service-page: оценка визита (`?w=`)', () => {
  const rate = async () => {
    await open('/s/mas?w=work-1');
    await waitFor(() => click(/Оценить визит/), SLOW);
  };

  it('«Оценить визит» только по ссылке с токеном работы; 1–3 открывают причины и «Свяжитесь со мной»', async () => {
    await rate();
    expect(ui().getByRole('heading', { level: 1, name: 'Как вам визит?' })).toBeTruthy();
    expect(main().textContent).toContain('1 · плохо');
    expect(main().textContent).toContain('5 · отлично');
    expect(ui().queryByText('Что пошло не так?')).toBeNull();
    fireEvent.click(
      within(ui().getByRole('radiogroup', { name: 'Оценка визита' })).getByRole('radio', {
        name: '2 из 5',
      }),
    );
    expect(ui().getByText('Что пошло не так?')).toBeTruthy();
    const chip = ui().getByRole('button', { name: 'Опоздание начала' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    expect(chip.getAttribute('aria-pressed')).toBe('true');
    expect(ui().getByText('Ответим в течение 2 часов')).toBeTruthy();
  });

  it('отправка без оценки — «Выберите оценку»; жалоба с просьбой связаться уходит обращением', async () => {
    const a = await open('/s/mas?w=work-1');
    await waitFor(() => click(/Оценить визит/), SLOW);
    click('Отправить');
    expect(errors()).toEqual(['Выберите оценку']);
    fireEvent.click(
      within(ui().getByRole('radiogroup', { name: 'Оценка визита' })).getByRole('radio', {
        name: '2 из 5',
      }),
    );
    fireEvent.click(ui().getByRole('button', { name: 'Температура в кабинете' }));
    fireEvent.change(field('Комментарий'), { target: { value: 'Холодно' } });
    fireEvent.click(field('Свяжитесь со мной'));
    fireEvent.click(field('Согласен на обработку персональных данных'));
    click('Отправить');
    expect(errors()).toEqual(['Телефон — не меньше 10 цифр']);
    fireEvent.change(field('Телефон'), { target: { value: '+7 900 123-45-67' } });
    click('Отправить');
    await waitFor(() => expect(ui().getByText('Спасибо за оценку!')).toBeTruthy(), SLOW);
    expect(main().textContent).toContain('Мы открыли обращение');
    expect(
      a
        .responses()
        .some((r) => r.method === 'POST' && r.path.endsWith('/mas/requests') && r.status === 201),
    ).toBe(true);
  });

  it('5 из 5 — «Спасибо», без причин', async () => {
    await rate();
    fireEvent.click(
      within(ui().getByRole('radiogroup', { name: 'Оценка визита' })).getByRole('radio', {
        name: '5 из 5',
      }),
    );
    expect(ui().queryByText('Что пошло не так?')).toBeNull();
    fireEvent.click(field('Согласен на обработку персональных данных'));
    click('Отправить');
    await waitFor(() => expect(ui().getByText('Спасибо за оценку!')).toBeTruthy(), SLOW);
    expect(main().textContent).toContain('Мы передали её команде.');
  });
});

describe('public-service-request: обращение по личной ссылке', () => {
  it('новое обращение: номер, статус «Получили», лента, переписка; «Довольны ли решением?» нет', async () => {
    await open(`/r/${tokenOf('r-41')}`);
    await waitFor(() => expect(main().textContent).toContain('МАС-41'), SLOW);
    expect(document.querySelector('nav')).toBeNull();
    expect(main().querySelector('.ox-sp-chip')?.textContent).toContain('Получили');
    const steps = [...main().querySelectorAll('.ox-sp-steps .ox-sp-step-text')].map(
      (l) => l.textContent,
    );
    expect(steps[0]).toMatch(/^Получили \d\d:\d\d/);
    expect(steps).toHaveLength(3);
    expect(main().textContent).toContain('Начали на 15 минут позже');
    expect(ui().queryByText('Довольны ли решением?')).toBeNull();
    expect(ui().getByLabelText('Сообщение')).toBeTruthy();
  });

  it('«Написать»: пустое не уходит, сообщение появляется в ленте', async () => {
    const a = await open(`/r/${tokenOf('r-41')}`);
    await waitFor(() => expect(ui().getByLabelText('Сообщение')).toBeTruthy(), SLOW);
    expect(ui().getByRole('button', { name: 'Отправить' }).hasAttribute('disabled')).toBe(true);
    fireEvent.change(ui().getByLabelText('Сообщение'), { target: { value: 'Жду ответа' } });
    click('Отправить');
    await waitFor(
      () =>
        expect(main().querySelector('.ox-sp-msg[data-mine]')?.textContent).toContain('Жду ответа'),
      SLOW,
    );
    expect((ui().getByLabelText('Сообщение') as HTMLTextAreaElement).value).toBe('');
    expect(
      a
        .responses()
        .some((r) => r.method === 'POST' && r.path.endsWith('/messages') && r.status === 201),
    ).toBe(true);
  });

  it('решённое: «Довольны ли решением?» — одна оценка, дальше «Вы уже оценили: 4 из 5»', async () => {
    await open(`/r/${tokenOf('r-39')}`);
    await waitFor(() => expect(ui().getByText('Довольны ли решением?')).toBeTruthy(), SLOW);
    expect(main().querySelector('.ox-sp-chip')?.textContent).toContain('Решено');
    fireEvent.click(
      within(ui().getByRole('radiogroup', { name: 'Оценка решения' })).getByRole('radio', {
        name: '4 из 5',
      }),
    );
    await waitFor(() => expect(ui().getByText('Вы уже оценили: 4 из 5')).toBeTruthy(), SLOW);
    expect(ui().queryByRole('radiogroup', { name: 'Оценка решения' })).toBeNull();
  });

  it('«Вопрос не решён — вернуть в работу» возвращает статус «Отвечаем»', async () => {
    await open(`/r/${tokenOf('r-39')}`);
    await waitFor(() => click('Вопрос не решён — вернуть в работу'), SLOW);
    fireEvent.change(ui().getByLabelText('Что осталось нерешённым?'), {
      target: { value: 'Боль вернулась' },
    });
    click('Вернуть в работу');
    await waitFor(
      () => expect(main().querySelector('.ox-sp-chip')?.textContent).toContain('Отвечаем'),
      SLOW,
    );
    expect(main().textContent).toContain('Боль вернулась');
    expect(ui().queryByText('Довольны ли решением?')).toBeNull();
  });

  it('«Не присылать опросы» — «СТОП»', async () => {
    const a = await open(`/r/${tokenOf('r-41')}`);
    await waitFor(() => click('Не присылать опросы'), SLOW);
    await waitFor(
      () => expect(main().textContent).toContain('Хорошо, опросы больше не придут.'),
      SLOW,
    );
    expect(a.responses().some((r) => r.path.endsWith('/opt-out') && r.status === 200)).toBe(true);
  });

  it('вложение к сообщению: файл виден в списке до отправки', async () => {
    await open(`/r/${tokenOf('r-41')}`);
    await waitFor(() => expect(ui().getByLabelText('Прикрепить фото')).toBeTruthy(), SLOW);
    fireEvent.change(ui().getByLabelText('Прикрепить фото'), {
      target: { files: [jpeg('stol.jpg')] },
    });
    await waitFor(() => expect(main().textContent).toContain('stol.jpg'), SLOW);
  });

  it('неизвестная ссылка — «Страница не найдена»', async () => {
    await open('/r/tok_unknown00000000000000000');
    await waitFor(() => expect(main().textContent).toContain('Страница не найдена'), SLOW);
  });
});
