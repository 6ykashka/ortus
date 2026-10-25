// Справочники «Обращений» (service.js 19.10:66–87) и проверка переходов статусов (S:269).
import { describe, expect, it } from 'vitest';
import {
  COMPENSATIONS,
  flowError,
  OUTCOMES,
  OUTCOMES_ABOUT,
  outcomesFor,
  SVC_CH,
  SVC_FLOW,
  SVC_KIND,
  SVC_PRIO,
  SVC_ST,
} from './dictionaries.ts';

describe('статусы и поток', () => {
  it('пять статусов с клиентскими подписями дословно', () => {
    expect(Object.keys(SVC_ST)).toEqual(['new', 'work', 'wait', 'resolved', 'closed']);
    expect(SVC_ST.new).toEqual({
      label: 'Новое',
      client: 'Получили',
      tone: 'info',
      icon: 'radio_button_unchecked',
    });
    expect(SVC_ST.work).toMatchObject({ label: 'В работе', client: 'Отвечаем' });
    expect(SVC_ST.wait).toMatchObject({
      label: 'Ждёт клиента',
      client: 'Ждём вашего ответа',
      tone: 'warn',
    });
    expect(SVC_ST.resolved).toMatchObject({ label: 'Решено', client: 'Решено', tone: 'ok' });
    expect(SVC_ST.closed).toMatchObject({ label: 'Закрыто', client: 'Закрыто', icon: 'lock' });
  });

  it('SVC_FLOW: new → work|wait|resolved, resolved → work|closed, closed — тупик', () => {
    expect(SVC_FLOW).toEqual({
      new: ['work', 'wait', 'resolved'],
      work: ['wait', 'resolved'],
      wait: ['work', 'resolved'],
      resolved: ['work', 'closed'],
      closed: [],
    });
  });

  it('flowError: допустимый переход — null, недопустимый — текст эталона', () => {
    expect(flowError('new', 'work')).toBeNull();
    expect(flowError('resolved', 'closed')).toBeNull();
    expect(flowError('new', 'closed')).toBe('Из статуса «Новое» в «Закрыто» перейти нельзя');
    expect(flowError('work', 'work')).toBe('Из статуса «В работе» в «В работе» перейти нельзя');
    expect(flowError('closed', 'work')).toBe('Из статуса «Закрыто» в «В работе» перейти нельзя');
  });
});

describe('виды, каналы, приоритеты, итоги', () => {
  it('семь видов обращения; в перечне нет оценки и NPS', () => {
    expect(Object.keys(SVC_KIND)).toEqual([
      'complaint',
      'claim',
      'question',
      'idea',
      'thanks',
      'warranty',
      'cargo',
    ]);
    expect(SVC_KIND.cargo).toEqual({
      label: 'Повреждение или недостача груза',
      icon: 'inventory_2',
    });
    expect(SVC_KIND.warranty.label).toBe('Гарантийный случай');
  });

  it('шесть каналов: подпись и иконка', () => {
    expect(SVC_CH).toEqual({
      sms: ['SMS', 'sms'],
      bot: ['Бот в Telegram', 'smart_toy'],
      cabinet: ['Кабинет заказчика', 'home_work'],
      widget: ['Виджет на сайте', 'web'],
      phone: ['Звонок', 'call'],
      qr: ['QR в салоне', 'qr_code_2'],
    });
  });

  it('приоритеты, итоги, компенсации дословно', () => {
    expect(SVC_PRIO).toEqual({ low: 'Низкий', normal: 'Средний', high: 'Высокий' });
    expect(OUTCOMES).toEqual([
      'Устранено',
      'Разъяснено',
      'Компенсация',
      'Не подтвердилось',
      'Дубль',
    ]);
    expect(OUTCOMES_ABOUT).toEqual(['Подтвердилась', 'Не подтвердилась']);
    expect(COMPENSATIONS).toEqual([
      'Скидка 20% на следующий визит',
      'Скидка 10% на следующую работу',
      'Бесплатное повторное посещение',
      'Возврат денег — через кассу',
    ]);
  });

  it('итоги зависят от пометки «касается сотрудника»', () => {
    expect(outcomesFor({ about: 'm-morozova' })).toBe(OUTCOMES_ABOUT);
    expect(outcomesFor({})).toBe(OUTCOMES);
    expect(outcomesFor({ about: undefined })).toBe(OUTCOMES);
  });
});
