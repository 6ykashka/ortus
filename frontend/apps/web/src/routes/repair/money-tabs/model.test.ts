// W6.24 · Модель вкладок «Документы», «Финансы», «Оплата бригады», «Подрядчики», «Кабинет заказчика»: подписи и
// расчёты эталона `Ремонт и стройка.dc.html` (:1660 DOC, :1682–1701 renderVals) на данных контракта 0.12.0-stage6.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  dative,
  docChip,
  docRows,
  financeCards,
  firstName,
  handOverDoc,
  linkView,
  longDay,
  movementRows,
  payPlan,
  payRows,
  previewStages,
  readinessByActs,
  rub,
  ruDate,
  ruDay,
  signedRub,
  subRows,
} from './model.ts';

type S = components['schemas'];

/** Разделитель тысяч в Intl ru-RU — неразрывный пробел (U+00A0); пробел перед «₽» обычный, как в эталоне. */
const nb = (s: string): string => s.replace(/(\d) (?=\d{3}\b)/g, '$1 ');
const doc = (
  o: Partial<S['RepairDocument']> & Pick<S['RepairDocument'], 'id' | 'kind' | 'title'>,
) => ({ projectId: 'p1', state: 'draft', ...o }) as S['RepairDocument'];

describe('форматы эталона', () => {
  it('рубли: минорные единицы → «438 175 ₽» с неразрывным пробелом', () => {
    expect(rub(43_817_500)).toBe(nb('438 175 ₽'));
    expect(rub(0)).toBe('0 ₽');
    expect(rub(13_145_250)).toBe(nb('131 453 ₽'));
  });

  it('знак суммы: плюс и настоящий минус', () => {
    expect(signedRub(1_320_000)).toBe(nb('+13 200 ₽'));
    expect(signedRub(-1_320_000)).toBe(nb('−13 200 ₽'));
    expect(signedRub(0)).toBe('0 ₽');
  });

  it('даты: «дд.мм» из даты и момента, «31 октября»', () => {
    expect(ruDay('2026-10-31')).toBe('31.10');
    expect(ruDay('2026-10-02T10:00:00Z')).toBe('02.10');
    expect(longDay('2026-11-27')).toBe('27 ноября');
    expect(ruDate('2026-10-31')).toBe('31.10.2026');
    expect(ruDate('2028-10-02T10:00:00Z')).toBe('02.10.2028');
  });

  it('имя заказчика в дательном падеже: «Ольга Смирнова» → «Ольге Смирновой»', () => {
    expect(dative('Ольга Смирнова')).toBe('Ольге Смирновой');
    expect(dative('Игорь Лебедев')).toBe('Игорю Лебедеву');
    expect(dative('Наталья Осипова')).toBe('Наталье Осиповой');
    expect(dative('ООО «Зерно»')).toBe('ООО «Зерно»');
    expect(firstName('Ольга Смирнова')).toBe('Ольга');
    expect(firstName('')).toBe('');
  });
});

describe('документы', () => {
  it('чипы состояний — подписи эталона DOC', () => {
    expect(docChip('signed')).toEqual({ tone: 'ok', icon: 'verified', label: 'Подписан' });
    expect(docChip('paid')).toEqual({ tone: 'ok', icon: 'check_circle', label: 'Оплачен' });
    expect(docChip('draft')).toEqual({
      tone: 'neutral',
      icon: 'edit_note',
      label: 'Готов к отправке',
    });
    expect(docChip('sms')).toEqual({ tone: 'warn', icon: 'sms', label: 'Ждёт подписи заказчика' });
    expect(docChip('wait')).toEqual({
      tone: 'neutral',
      icon: 'hourglass_top',
      label: 'Этап не закрыт',
    });
  });

  it('строки: значок по виду, подпись из состояния, «Отправить на подпись» только у готового', () => {
    const rows = docRows(
      [
        doc({
          id: 'c',
          kind: 'contract',
          title: 'Договор подряда № 42',
          state: 'signed',
          estimateVersion: 2,
          signedAt: '2026-10-01T09:00:00Z',
        }),
        doc({
          id: 'i',
          kind: 'invoice',
          title: 'Счёт № 1 · аванс 30%',
          state: 'paid',
          signedAt: '2026-10-02T10:00:00Z',
        }),
        doc({ id: 'a1', kind: 'act', title: 'Акт № 1 · демонтаж', state: 'draft', actNo: 1 }),
        doc({ id: 'a2', kind: 'act', title: 'Акт № 2 · электрика', state: 'wait', actNo: 2 }),
        doc({ id: 'a3', kind: 'act', title: 'Акт № 3', state: 'sms', actNo: 3 }),
        doc({ id: 'h', kind: 'handover_act', title: 'Акт сдачи объекта', state: 'draft' }),
      ],
      'Ольга Смирнова',
    );
    expect(rows.map((r) => r.icon)).toEqual([
      'contract',
      'receipt_long',
      'task',
      'task',
      'task',
      'task_alt',
    ]);
    expect(rows.map((r) => r.meta)).toEqual([
      'Из сметы v2 · 01.10',
      'Оплачен 02.10',
      'Этап закрыт прорабом',
      'Этап в работе',
      'Отправлен в кабинет заказчика',
      'Этап закрыт прорабом',
    ]);
    expect(rows.map((r) => r.canSend)).toEqual([false, false, true, false, false, true]);
  });

  it('подписанный по SMS: «Подписан кодом из SMS · Ольга Смирнова»', () => {
    const [r] = docRows(
      [doc({ id: 'a', kind: 'act', title: 'Акт № 1', state: 'signed' })],
      'Ольга Смирнова',
    );
    expect(r?.meta).toBe('Подписан кодом из SMS · Ольга Смирнова');
  });

  it('черновик договора: «Из сметы vN» или «Собран по шаблону»', () => {
    const [a] = docRows([
      doc({ id: 'c', kind: 'contract', title: 'Договор', state: 'draft', estimateVersion: 2 }),
    ]);
    expect(a?.meta).toBe('Из сметы v2');
    const [b] = docRows([doc({ id: 'c', kind: 'warranty', title: 'Гарантия', state: 'draft' })]);
    expect(b?.meta).toBe('Собран по шаблону');
    expect(b?.icon).toBe('shield');
  });

  it('«Сдать объект»: акт сдачи подписан, объект в работе', () => {
    const signed = doc({
      id: 'h',
      kind: 'handover_act',
      title: 'Акт сдачи объекта',
      state: 'signed',
    });
    const draft = doc({
      id: 'h2',
      kind: 'handover_act',
      title: 'Акт сдачи объекта',
      state: 'draft',
    });
    expect(handOverDoc([signed], 'active')?.id).toBe('h');
    expect(handOverDoc([draft], 'active')).toBeUndefined();
    expect(handOverDoc([signed], 'handed_over')).toBeUndefined();
    expect(handOverDoc([signed], 'draft')).toBeUndefined();
  });

  it('готовность по закрытым актам: подписанные и оплаченные из всех актов', () => {
    const acts = [
      doc({ id: '1', kind: 'act', title: 'a', state: 'signed' }),
      doc({ id: '2', kind: 'act', title: 'b', state: 'draft' }),
      doc({ id: '3', kind: 'act', title: 'c', state: 'paid' }),
      doc({ id: '4', kind: 'act', title: 'd', state: 'wait' }),
      doc({ id: 'x', kind: 'contract', title: 'e', state: 'signed' }),
    ];
    expect(readinessByActs(acts)).toBe(50);
    expect(readinessByActs([])).toBe(0);
  });
});

describe('финансы', () => {
  const f: S['ProjectFinance'] = {
    projectId: 'p1',
    contract: { amountMinor: 43_817_500, currency: 'RUB' },
    received: { amountMinor: 13_145_300, currency: 'RUB' },
    expenses: { amountMinor: 5_000_000, currency: 'RUB' },
    marginPlan: { amountMinor: 11_830_700, currency: 'RUB' },
    estimateVersion: 2,
    movements: [
      {
        at: '2026-10-14T09:00:00Z',
        kind: 'expense',
        text: 'Чек: кабель ВВГнг',
        amount: { amountMinor: -1_320_000, currency: 'RUB' },
      },
      {
        at: '2026-10-02T09:00:00Z',
        kind: 'payment',
        text: 'Аванс по счёту № 1',
        amount: { amountMinor: 13_145_300, currency: 'RUB' },
      },
    ],
  };

  it('четыре карточки эталона: Договор, Получено от заказчика, Расходы, Маржа план', () => {
    expect(financeCards(f)).toEqual([
      { label: 'Договор', value: nb('438 175 ₽'), sub: 'по смете версии 2' },
      { label: 'Получено от заказчика', value: nb('131 453 ₽'), sub: 'аванс 30%' },
      { label: 'Расходы', value: nb('50 000 ₽'), sub: 'материалы, бригада, подрядчик' },
      { label: 'Маржа план', value: nb('118 307 ₽'), sub: '27% · факт после закрытия' },
    ]);
  });

  it('без версии сметы и без поступлений — подписи без цифр', () => {
    const z = { ...f, estimateVersion: undefined, received: { amountMinor: 0, currency: 'RUB' } };
    const cards = financeCards(z);
    expect(cards[0]?.sub).toBe('по договору');
    expect(cards[1]?.sub).toBe('поступлений пока нет');
  });

  it('движение денег: по возрастанию даты, приход «+» зелёным, расход «−»', () => {
    const rows = movementRows(f);
    expect(rows.map((r) => [r.at, r.text, r.sum, r.income])).toEqual([
      ['02.10', 'Аванс по счёту № 1', nb('+131 453 ₽'), true],
      ['14.10', 'Чек: кабель ВВГнг', nb('−13 200 ₽'), false],
    ]);
  });
});

describe('оплата бригады', () => {
  const acc = (
    o: Partial<S['CrewAccrual']> & Pick<S['CrewAccrual'], 'id' | 'state'>,
  ): S['CrewAccrual'] => ({
    projectId: 'p1',
    workerId: `w-${o.id}`,
    workerName: 'Рустам Каримов',
    role: 'бригадир',
    amount: { amountMinor: 1_980_000, currency: 'RUB' },
    selfEmployed: false,
    work: 'Демонтаж',
    ...o,
  });
  const act = (state: S['RepairDocument']['state'], no = 1) =>
    doc({ id: `act-${no}`, kind: 'act', title: `Акт № ${no} · демонтаж`, state, actNo: no });

  it('строки и чипы статусов', () => {
    const rows = payRows([
      acc({ id: '1', state: 'pending_act' }),
      acc({ id: '2', state: 'accrued', selfEmployed: true }),
      acc({ id: '3', state: 'proposed' }),
      acc({ id: '4', state: 'paid' }),
    ]);
    expect(rows[0]).toMatchObject({
      name: 'Рустам Каримов',
      role: 'бригадир',
      work: 'Демонтаж',
      sum: nb('19 800 ₽'),
    });
    expect(rows.map((r) => r.chip)).toEqual([
      { tone: 'neutral', icon: 'hourglass_top', label: 'Ждёт закрытия акта' },
      { tone: 'info', icon: 'payments', label: 'Начислено' },
      { tone: 'warn', icon: 'schedule_send', label: 'Ждёт проведения в кассе' },
      { tone: 'ok', icon: 'check_circle', label: 'Выплачено' },
    ]);
  });

  it('акт не подписан: начислять нельзя, подсказка про акт № 1', () => {
    const p = payPlan([acc({ id: '1', state: 'pending_act' })], [act('draft')]);
    expect(p.accrue).toBeUndefined();
    expect(p.payoutIds).toEqual([]);
    expect(p.hint).toBe(
      'Начисление откроется после подписания акта № 1 заказчиком (раздел «Документы»).',
    );
  });

  it('акт подписан: «Начислить по акту № 1»', () => {
    const p = payPlan([acc({ id: '1', state: 'pending_act' })], [act('signed')]);
    expect(p.accrue).toEqual({ id: 'act-1', no: 1 });
    expect(p.hint).toBe('');
  });

  it('подсказка берёт первый неподписанный акт по номеру', () => {
    const p = payPlan(
      [acc({ id: '1', state: 'pending_act' })],
      [act('draft', 2), act('signed', 1), act('wait', 3)],
    );
    expect(p.accrue).toEqual({ id: 'act-1', no: 1 });
  });

  it('начислено: «Провести выплату через кассу» по начисленным', () => {
    const p = payPlan(
      [acc({ id: '1', state: 'accrued' }), acc({ id: '2', state: 'accrued' })],
      [act('signed')],
    );
    expect(p.accrue).toBeUndefined();
    expect(p.payoutIds).toEqual(['1', '2']);
  });

  it('всё предложено или выплачено: «Выплаты проведены, операции появились в кассе.»', () => {
    const p = payPlan(
      [acc({ id: '1', state: 'proposed' }), acc({ id: '2', state: 'paid' })],
      [act('signed')],
    );
    expect(p.hint).toBe('Выплаты проведены, операции появились в кассе.');
  });

  it('начислений нет — подсказка пуста', () => {
    expect(payPlan([], [act('draft')]).hint).toBe('');
  });
});

describe('подрядчики', () => {
  const sub = (o: Partial<S['Subcontractor']> = {}): S['Subcontractor'] => ({
    id: 's1',
    name: 'ООО «ЭлектроПрофи»',
    scope: 'Электромонтаж: 38 точек, щиток',
    active: true,
    accessUntil: '2026-10-31',
    contract: { amountMinor: 4_560_000, currency: 'RUB' },
    paid: { amountMinor: 2_000_000, currency: 'RUB' },
    ...o,
  });

  it('доступ открыт: срок, «Закрыть доступ»', () => {
    const [r] = subRows([sub()], '2026-10-20');
    expect(r).toMatchObject({
      name: 'ООО «ЭлектроПрофи»',
      access: 'Доступ к объекту до 31.10: отметки, фото, акты',
      closed: false,
      contract: nb('45 600 ₽'),
      paid: nb('20 000 ₽'),
      toggle: { label: 'Закрыть доступ', open: false },
    });
  });

  it('доступ закрыт: «Открыть доступ до …» с прежним сроком, если он не в прошлом', () => {
    const [r] = subRows([sub({ active: false })], '2026-10-20');
    expect(r?.access).toBe('Доступ закрыт');
    expect(r?.closed).toBe(true);
    expect(r?.toggle).toEqual({
      label: 'Открыть доступ до 31.10',
      open: true,
      until: '2026-10-31',
    });
  });

  it('прежний срок в прошлом или не задан — сегодня плюс 14 дней', () => {
    const [a] = subRows([sub({ active: false, accessUntil: '2026-10-01' })], '2026-10-20');
    expect(a?.toggle).toEqual({
      label: 'Открыть доступ до 03.11',
      open: true,
      until: '2026-11-03',
    });
    const [b] = subRows([sub({ active: false, accessUntil: undefined })], '2026-10-20');
    expect(b?.toggle.until).toBe('2026-11-03');
  });

  it('договор и оплата не заданы — прочерк', () => {
    const [r] = subRows([sub({ contract: undefined, paid: undefined })], '2026-10-20');
    expect(r?.contract).toBe('—');
    expect(r?.paid).toBe('—');
  });
});

describe('кабинет заказчика', () => {
  const link = (o: Partial<S['ClientLink']> = {}): S['ClientLink'] => ({
    active: true,
    sentAt: '2026-10-01T07:00:00Z',
    sentTo: '+7 *** *** 12-42',
    ...o,
  });

  it('ссылка действует: текст эталона и «Отозвать ссылку»', () => {
    expect(linkView(link(), { status: 'active', clientName: 'Ольга Смирнова' })).toEqual({
      tone: 'ok',
      icon: 'link',
      text: 'Ссылка отправлена Ольге Смирновой по SMS 01.10 и действует до сдачи объекта.',
      action: { kind: 'revoke', label: 'Отозвать ссылку' },
    });
  });

  it('заказчик не указан — «заказчику»', () => {
    expect(linkView(link(), { status: 'active' }).text).toBe(
      'Ссылка отправлена заказчику по SMS 01.10 и действует до сдачи объекта.',
    );
  });

  it('ссылка отозвана или не выпускалась: текст эталона и «Выпустить новую ссылку»', () => {
    const expected = {
      tone: 'danger',
      icon: 'link_off',
      text: 'Ссылка отозвана: по старой ссылке кабинет не открывается.',
      action: { kind: 'issue', label: 'Выпустить новую ссылку' },
    };
    expect(
      linkView(link({ active: false, revokedAt: '2026-10-05T10:00:00Z' }), { status: 'active' }),
    ).toEqual(expected);
    expect(linkView({ active: false }, { status: 'active' })).toEqual(expected);
  });

  it('объект сдан: кабинет закрыт, действий нет', () => {
    const v = linkView(
      { active: false, revokedAt: '2026-10-25T10:00:00Z' },
      { status: 'handed_over' },
    );
    expect(v.text).toBe('Кабинет закрыт после сдачи объекта.');
    expect(v.action).toBeUndefined();
  });

  it('этапы превью: четыре первых этапа графика и «Сдача объекта» с прогнозом', () => {
    const st = (n: number, status: S['ScheduleStage']['status']) =>
      ({
        id: `s${n}`,
        name: `Этап ${n}`,
        status,
        startOn: '2026-10-21',
        endOn: '2026-10-23',
      }) as S['ScheduleStage'];
    const out = previewStages(
      [st(1, 'done'), st(2, 'started'), st(3, 'planned'), st(4, 'planned'), st(5, 'planned')],
      { dueOn: '2026-11-27', forecastDueOn: '2026-12-01' },
    );
    expect(out).toEqual([
      { name: 'Этап 1', icon: 'check_circle', tone: 'ok', when: 'готово' },
      { name: 'Этап 2', icon: 'progress_activity', tone: 'info', when: 'идёт, до 23.10' },
      { name: 'Этап 3', icon: 'radio_button_unchecked', tone: 'muted', when: 'с 21.10' },
      { name: 'Этап 4', icon: 'radio_button_unchecked', tone: 'muted', when: 'с 21.10' },
      {
        name: 'Сдача объекта',
        icon: 'flag',
        tone: 'warn',
        when: '01.12 · по договору 27.11',
      },
    ]);
  });

  it('сдача в срок: зелёный флажок без «по договору»', () => {
    const out = previewStages([], { dueOn: '2026-11-27', forecastDueOn: '2026-11-27' });
    expect(out).toEqual([{ name: 'Сдача объекта', icon: 'flag', tone: 'ok', when: '27.11' }]);
    expect(previewStages([], {})).toEqual([]);
  });
});
