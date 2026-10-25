// W4.70 · Модель заполнения формы (`form-fill`, `public-form`): значения ответов по типам вопросов (FormQuestionType,
// контракт 0.11.0-stage4), параметры ссылки только для скрытых вопросов (Q-W4.05-26, Q-W4.00-forms-20), нарушения 422
// по вопросам, отказы сервера (409 причины, 410), состояние формы до заполнения, «Спасибо» с результатом теста.
import { type components, ProblemError } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  acceptOf,
  answersOf,
  doneOfReceipt,
  doneOfResponse,
  gateOf,
  linkParamsOf,
  refusalOf,
  tenantOrder,
  violationsOf,
} from './model.ts';

type S = components['schemas'];
type Q = S['FormQuestion'];

const q = (key: string, type: Q['type'], x: Partial<Q> = {}): Q => ({
  key,
  pageId: 'p1',
  type,
  label: key,
  required: false,
  ...x,
});

const def = (fields: Q[]): S['FormDefinitionV2'] => ({
  pages: [{ id: 'p1', title: 'Страница 1' }],
  fields,
});

const SETTINGS: S['FormSettings'] = {
  access: 'members',
  acceptUntil: null,
  responseLimit: null,
  onePerMember: false,
  allowEditBeforeReview: true,
  confirmationText: 'Спасибо! Ответ отправлен.',
  scoring: false,
  passScore: null,
  showScore: true,
  progressBar: true,
  backButton: true,
  showLogo: true,
  retainResponsesDays: 365,
};

describe('answersOf: значения ответов по типу вопроса', () => {
  it('текстовые — text; число — decimal без пробелов и с точкой; целые и оценки — decimal', () => {
    const d = def([
      q('t', 'text'),
      q('l', 'longtext'),
      q('e', 'email'),
      q('n', 'number'),
      q('i', 'int'),
      q('s', 'scale'),
      q('r', 'rating'),
    ]);
    expect(
      answersOf(d, {
        t: 'Дарья',
        l: 'Две строки',
        e: 'a@b.ru',
        n: '1 234,5',
        i: '007',
        s: '4',
        r: '5',
      }),
    ).toEqual([
      { fieldKey: 't', value: { type: 'text', value: 'Дарья' } },
      { fieldKey: 'l', value: { type: 'text', value: 'Две строки' } },
      { fieldKey: 'e', value: { type: 'text', value: 'a@b.ru' } },
      { fieldKey: 'n', value: { type: 'decimal', value: '1234.5' } },
      { fieldKey: 'i', value: { type: 'decimal', value: '7' } },
      { fieldKey: 's', value: { type: 'decimal', value: '4' } },
      { fieldKey: 'r', value: { type: 'decimal', value: '5' } },
    ]);
  });

  it('сумма — money в копейках RUB; да / нет — boolean; дата — date, со временем — instant', () => {
    const d = def([
      q('m', 'money'),
      q('b', 'bool'),
      q('d', 'date'),
      q('dt', 'date', { withTime: true }),
    ]);
    expect(
      answersOf(d, { m: '1 500,25', b: 'false', d: '2026-10-24', dt: '2026-10-24T09:30' }),
    ).toEqual([
      { fieldKey: 'm', value: { type: 'money', value: { amountMinor: 150025, currency: 'RUB' } } },
      { fieldKey: 'b', value: { type: 'boolean', value: false } },
      { fieldKey: 'd', value: { type: 'date', value: '2026-10-24' } },
      {
        fieldKey: 'dt',
        value: { type: 'instant', value: new Date('2026-10-24T09:30').toISOString() },
      },
    ]);
  });

  it('выбор — choices ключами; «Другое» — ключ other и otherText; файлы — files; CRM — reference', () => {
    const d = def([
      q('c', 'choice', { otherOption: true }),
      q('c2', 'choice', { otherOption: true }),
      q('m', 'multi', { otherOption: true }),
      q('s', 'select'),
      q('p', 'photo'),
      q('who', 'person'),
    ]);
    const ref = { moduleKey: 'core', entityType: 'member', entityId: 'm-1' };
    expect(
      answersOf(
        d,
        {
          c: 'o1',
          c2__other: 'Своё',
          m: ['o1', 'o2'],
          m__other: 'Ещё',
          s: 'o3',
          p: ['f-1', 'f-2'],
          who: 'm-1',
        },
        new Map([['m-1', ref]]),
      ),
    ).toEqual([
      { fieldKey: 'c', value: { type: 'choices', value: ['o1'] } },
      { fieldKey: 'c2', value: { type: 'choices', value: ['other'], otherText: 'Своё' } },
      { fieldKey: 'm', value: { type: 'choices', value: ['o1', 'o2', 'other'], otherText: 'Ещё' } },
      { fieldKey: 's', value: { type: 'choices', value: ['o3'] } },
      { fieldKey: 'p', value: { type: 'files', value: ['f-1', 'f-2'] } },
      { fieldKey: 'who', value: { type: 'reference', value: ref } },
    ]);
  });

  it('пустые, «Текст без вопроса», скрытые и не показанные по условию — не отправляются', () => {
    const d = def([
      q('a', 'bool'),
      q('b', 'text', {
        showIf: { mode: 'all', conditions: [{ fieldKey: 'a', operator: 'equals', value: 'true' }] },
      }),
      q('h', 'text', { hidden: true }),
      q('st', 'statement'),
      q('e', 'text'),
      q('mm', 'multi'),
    ]);
    expect(answersOf(d, { a: 'false', b: 'скрыто условием', h: 'x', e: '  ', mm: [] })).toEqual([
      { fieldKey: 'a', value: { type: 'boolean', value: false } },
    ]);
  });
});

describe('linkParamsOf: параметры адреса — только скрытые вопросы (не CRM и не файлы), до 500 символов', () => {
  const d = def([
    q('q-src', 'text', { hidden: true }),
    q('q-ref', 'person', { hidden: true }),
    q('q-photo', 'photo', { hidden: true }),
    q('q-text', 'text'),
  ]);
  it('лишние, CRM, файлы и embed не уходят', () => {
    expect(
      linkParamsOf(d, '?q-src=email&q-text=x&q-ref=1&q-photo=2&embed=1&utm_source=promo'),
    ).toEqual({ 'q-src': 'email' });
  });
  it('значение обрезается до 500 символов; нет параметров — пусто', () => {
    expect(linkParamsOf(d, `?q-src=${'я'.repeat(600)}`)['q-src']).toHaveLength(500);
    expect(linkParamsOf(d, '')).toEqual({});
  });
});

describe('violationsOf: 422 по вопросам, прочее — общим текстом', () => {
  it('нарушения вопросов версии — по ключам, остальные — списком', () => {
    const e = new ProblemError(422, {
      type: 't',
      title: 'Ошибка проверки',
      status: 422,
      code: 'validation_failed',
      requestId: 'r',
      detail: 'Обязательный вопрос',
      violations: [
        { field: 'q-name', code: 'invalid', message: 'Обязательный вопрос' },
        { field: 'subject', code: 'invalid', message: 'Объект не найден' },
      ],
    });
    expect(violationsOf(e, def([q('q-name', 'text')]))).toEqual({
      errs: { 'q-name': 'Обязательный вопрос' },
      rest: ['Объект не найден'],
    });
  });
  it('не 422 — null', () => {
    expect(violationsOf(new ProblemError(409), def([]))).toBeNull();
  });
});

const problem = (status: number, code: string, reason?: string, detail?: string) =>
  new ProblemError(status, {
    type: 't',
    title: 't',
    status,
    code: code as S['ProblemCode'],
    requestId: 'r',
    ...(detail ? { detail } : {}),
    ...(reason ? { reason } : {}),
  } as S['Problem']);

describe('refusalOf: отказы отправки и чтения', () => {
  it('409 по причине; 410; 404, 403; нет связи; прочее — null', () => {
    expect(refusalOf(problem(409, 'invalid_transition', 'form_version_changed'))).toEqual({
      kind: 'changed',
    });
    expect(refusalOf(problem(409, 'invalid_transition', 'form_already_answered'))).toEqual({
      kind: 'answered',
    });
    expect(refusalOf(problem(409, 'invalid_transition', 'form_closed'))).toEqual({
      kind: 'closed',
    });
    expect(refusalOf(problem(410, 'public_token_expired'))).toEqual({ kind: 'linkInvalid' });
    expect(
      refusalOf(problem(410, 'nonce_used', undefined, 'Ответ с этой страницы уже отправлен')),
    ).toEqual({ kind: 'nonce', text: 'Ответ с этой страницы уже отправлен' });
    expect(refusalOf(problem(404, 'not_found'))).toEqual({ kind: 'notFound' });
    expect(refusalOf(problem(403, 'forbidden_action'))).toEqual({ kind: 'noAccess' });
    expect(refusalOf(new TypeError('Failed to fetch'))).toEqual({ kind: 'offline' });
    expect(refusalOf(problem(429, 'rate_limited'))).toBeNull();
  });
  it('422 нонса гостя — «откройте заново» с текстом сервера', () => {
    const e = new ProblemError(422, {
      type: 't',
      title: 't',
      status: 422,
      code: 'validation_failed',
      requestId: 'r',
      violations: [
        { field: 'submissionNonce', code: 'invalid', message: 'Откройте форму по ссылке заново' },
      ],
    });
    expect(refusalOf(e)).toEqual({ kind: 'nonce', text: 'Откройте форму по ссылке заново' });
  });
});

describe('gateOf: форма до заполнения', () => {
  const form = (x: Partial<S['Form']>): S['Form'] =>
    ({
      status: 'published',
      publishedVersionNumber: 1,
      settings: SETTINGS,
      my: { respond: true },
      ...x,
    }) as S['Form'];
  const NOW = new Date('2026-10-01T07:30:00Z');
  it('открыта; черновик — не найдена; закрыта; срок прошёл; уже отвечал; лимит — закрыта', () => {
    expect(gateOf(form({}), NOW)).toBe('open');
    expect(gateOf(form({ status: 'draft', publishedVersionNumber: null }), NOW)).toBe('notFound');
    expect(gateOf(form({ status: 'closed', my: { respond: false } as S['FormMy'] }), NOW)).toBe(
      'closed',
    );
    expect(
      gateOf(
        form({
          settings: { ...SETTINGS, acceptUntil: '2026-09-30' },
          my: { respond: false } as S['FormMy'],
        }),
        NOW,
      ),
    ).toBe('closed');
    expect(
      gateOf(
        form({
          settings: { ...SETTINGS, onePerMember: true },
          my: { respond: false } as S['FormMy'],
        }),
        NOW,
      ),
    ).toBe('answered');
    expect(gateOf(form({ my: { respond: false } as S['FormMy'] }), NOW)).toBe('closed');
  });
});

describe('«Спасибо»: текст и результат теста', () => {
  it('ответ сотрудника: свой текст, «Результат…» при «Показывать результат»', () => {
    const s = { ...SETTINGS, scoring: true, passScore: 2, confirmationText: '' };
    expect(doneOfResponse({ points: 1, maxPoints: 3, passed: false }, s)).toEqual({
      text: 'Спасибо! Ответ отправлен.',
      score: { text: 'Результат: 1 из 3 баллов · нужно 2 для зачёта', ok: false },
    });
    expect(
      doneOfResponse({ points: 1, maxPoints: 1, passed: true }, { ...s, passScore: 1 }),
    ).toEqual({
      text: 'Спасибо! Ответ отправлен.',
      score: { text: 'Результат: 1 из 1 балла · тест пройден', ok: true },
    });
    expect(
      doneOfResponse({ points: 4, maxPoints: 5, passed: null }, { ...s, showScore: false }),
    ).toEqual({
      text: 'Спасибо! Ответ отправлен.',
      score: null,
    });
    expect(doneOfResponse(undefined, { ...SETTINGS, confirmationText: 'Принято' })).toEqual({
      text: 'Принято',
      score: null,
    });
  });
  it('квитанция гостя: первая строка — текст, «Результат…» — чип', () => {
    expect(doneOfReceipt('Спасибо!\nРезультат: 1 из 2 баллов · нужно 2 для зачёта')).toEqual({
      text: 'Спасибо!',
      score: { text: 'Результат: 1 из 2 баллов · нужно 2 для зачёта', ok: false },
    });
    expect(doneOfReceipt('Результат: 2 из 2 баллов · тест пройден')).toEqual({
      text: 'Спасибо! Ответ отправлен.',
      score: { text: 'Результат: 2 из 2 баллов · тест пройден', ok: true },
    });
    expect(doneOfReceipt('Готово')).toEqual({ text: 'Готово', score: null });
  });
});

describe('tenantOrder и acceptOf', () => {
  it('организации: последняя выбранная, затем остальные активные по имени', () => {
    const t = (tenantId: string, name: string, membershipStatus = 'active') =>
      ({ tenantId, name, membershipStatus }) as S['TenantContext'];
    const me = {
      lastTenantId: 'b',
      tenants: [t('a', 'Альта'), t('b', 'Бета'), t('c', 'Вега', 'suspended')],
    } as S['MeContext'];
    expect(tenantOrder(me)).toEqual(['b', 'a']);
  });
  it('тип файлов: фото, документы, любые', () => {
    expect(acceptOf(q('p', 'photo', { accept: 'photo' }))).toBe('image/*');
    expect(acceptOf(q('p', 'photo', { accept: 'docs' }))).toBe('.pdf,.doc,.docx,.xls,.xlsx');
    expect(acceptOf(q('p', 'photo', { accept: 'any' }))).toBeUndefined();
    expect(acceptOf(q('p', 'photo'))).toBeUndefined();
  });
});
