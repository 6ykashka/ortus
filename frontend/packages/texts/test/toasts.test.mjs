// W0.14 · Тосты эталона этапов 0–2: статические this.toast('…') и okText this.run(…) — в словаре
// (литерал — в toast.ts, допускается ссылка на файл-владелец); шаблоны — табличные кейсы.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALL, format, toast } from '../src/index.ts';
import { extractToasts, fixture, leaves } from './_util.mjs';

const toastValues = new Set(leaves(toast).map(([, v]) => v));
const allValues = new Set(
  Object.entries(ALL)
    .flatMap(([ns, t]) => leaves(t, ns))
    .map(([, v]) => v),
);

describe('статические тосты главного файла эталона', () => {
  const found = extractToasts();
  const fx = fixture('toasts.json');

  it('извлечённый список совпадает с фикстурой', () => assert.deepEqual(found, fx));

  for (const { line, kind, text } of fx) {
    it(`:${line} ${kind} «${text}»`, () => {
      assert.ok(toastValues.has(text), `нет в toast: ${text}`);
      assert.ok(allValues.has(text));
    });
  }
});

describe('шаблоны тостов (конкатенации эталона)', () => {
  const t = toast;
  const cases = [
    [':2545', t.shell.flushOk, { label: 'Сдача машины' }, 'Сдача машины — принято сервером'],
    [
      ':2548',
      t.shell.flushFail,
      { label: 'Сдача машины', message: 'Нет связи' },
      'Сдача машины: Нет связи',
    ],
    [
      ':2789',
      t.shell.conflict,
      { message: 'Машину только что забронировали. Обновите список.' },
      'Конфликт: Машину только что забронировали. Обновите список.',
    ],
    [':2660', t.company.moduleConnected, { name: 'Логистика' }, 'Модуль «Логистика» подключён'],
    [':2687', t.company.quota, { gb: 25 }, 'Лимит места: 25 ГБ'],
    [
      ':2733',
      t.company.roleAssigned,
      { role: 'Менеджер логистики' },
      'Роль «Менеджер логистики» назначена',
    ],
    [':2762', t.company.roleSaved, { role: 'Логист' }, 'Роль «Логист» сохранена'],
    [':2788', t.manager.vehicleAssigned, { trip: 'Р-211' }, 'Машина назначена на рейс Р-211'],
    [
      ':2794',
      t.manager.requestSent,
      { firm: 'Юг Транс' },
      'Запрос отправлен фирме Юг Транс · уведомления в демо не отправляются',
    ],
    [
      ':3323',
      t.manager.firmApproved,
      { firm: 'Юг Транс' },
      'Фирма Юг Транс одобрила запрос (демо)',
    ],
    [
      ':3324',
      t.manager.firmDeclined,
      { firm: 'Юг Транс' },
      'Фирма Юг Транс отклонила запрос (демо)',
    ],
    [':3829', t.platform.operatorRoleChanged, { role: 'Поддержка' }, 'Роль изменена: Поддержка'],
    [
      ':3843',
      t.platform.operatorInvited,
      { email: 'a@ortus.example' },
      'Приглашение отправлено: a@ortus.example',
    ],
  ];
  for (const [src, msg, values, expected] of cases) {
    it(`${src} → ${expected}`, () => assert.equal(format(msg, values), expected));
  }
});
