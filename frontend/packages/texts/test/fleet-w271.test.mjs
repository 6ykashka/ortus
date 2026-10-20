// W2.71 (контракт 0.6.3-stage2) · Тексты S2-20 «Машина для временного водителя» без эталона (no-reference,
// Q-W2.70-13): сообщения ошибок запроса, решения и выбора машины и заголовки уведомлений «машина выбрана /
// освобождена», «водитель выбрал», «машину поставили». Одна строка для примеров контракта, MSW и экранов W2.73/W2.74.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { errors, format, logisticsManager } from '../src/index.ts';
import { readJson, readText, ROOT } from './_util.mjs';

const example = (op, name) => readJson(join(ROOT, 'api/openapi/examples', op, `${name}.json`));
const offers = readText(join(ROOT, 'frontend/packages/adapter/src/msw/fleet/offers.ts'));

describe('ошибки S2-20 (errors.mock.logistics.vehicleOffer)', () => {
  const t = errors.mock.logistics.vehicleOffer;

  it('тексты отказов запроса, решения и выбора', () => {
    assert.deepEqual(t, {
      closed: 'Выбор машины уже закрыт.',
      notFound: 'Бронь не найдена.',
      chooseFirst: 'Сначала выберите машину.',
      noUsualVehicle: 'У водителя нет обычной машины',
      hostRequired: 'Выберите машину фирмы рейса',
      hostNotWithHome: 'Машину фирмы рейса не указывают для своей обычной',
      tripRequired: 'Машину запрашивают на рейс',
      usualVehicle: 'Нужна машина фирмы водителя',
      driverOnly: 'Обычную машину не запрашивали',
      rejectReason: 'Укажите причину отказа',
      notFit: 'Машина не подходит рейсу:',
      busy: 'Машина занята на время рейса. Обновите список.',
    });
    // Причина отказа — та же строка, что у отказа заявки оператором.
    assert.equal(t.rejectReason, errors.mock.platform.rejectReason);
  });

  it('совпадают с примерами контракта', () => {
    assert.equal(example('chooseReservation', 'offer_closed').detail, t.closed);
    assert.equal(example('chooseReservation', 'not_found').detail, t.notFound);
    const reject = example('decideDriverTransfer', 'validation_failed');
    assert.equal(reject.detail, `${t.rejectReason}.`);
    assert.equal(reject.violations[0].message, t.rejectReason);
    assert.ok(example('requestDriverTransfer', 'vehicle_incompatible').detail.startsWith(t.notFit));
  });

  it('совпадают с MSW (OFFER_TEXT)', () => {
    for (const [k, v] of Object.entries(t)) {
      assert.ok(offers.includes(`${k}: '${v}'`), `MSW offers.ts: нет ${k}: «${v}»`);
    }
  });
});

describe('уведомления S2-20 (logisticsManager.vehicleOfferNotify)', () => {
  const t = logisticsManager.vehicleOfferNotify;
  const v = 'Isuzu Elf К 120 РУ 77';

  it('заголовки фирме машины, логисту и водителю', () => {
    assert.equal(
      format(t.chosen, { vehicle: v, trip: 'Р-212' }),
      `Машина ${v} выбрана на рейс Р-212`,
    );
    assert.equal(
      format(t.released, { vehicle: v, trip: 'Р-212' }),
      `Машина ${v} освобождена: рейс Р-212`,
    );
    assert.equal(
      format(t.driverChose, { vehicle: v, trip: 'Р-212' }),
      `Водитель выбрал машину на рейс Р-212: ${v}`,
    );
    assert.equal(
      format(t.assigned, { vehicle: v, trip: 'Р-212' }),
      `Машину поставили на рейс Р-212: ${v}`,
    );
    assert.equal(format(t.choose, { trip: 'Р-212' }), 'Выберите машину на рейс Р-212');
  });

  it('MSW собирает те же заголовки (OFFER_NOTIFY)', () => {
    for (const s of [
      '`Машина ${label(v)} выбрана на рейс ${trip.number}`',
      '`Машина ${label(v)} освобождена: рейс ${trip.number}`',
      '`Водитель выбрал машину на рейс ${trip.number}: ${label(v)}`',
      '`Машину поставили на рейс ${trip.number}: ${label(v)}`',
      '`Выберите машину на рейс ${trip.number}`',
    ]) {
      assert.ok(offers.includes(s), `MSW offers.ts: нет ${s}`);
    }
  });
});
