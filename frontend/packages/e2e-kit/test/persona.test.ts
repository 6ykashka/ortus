// Персонажи эталона (design/Ортус CRM.dc.html:33–54) и dev-вход ?persona= (PD-54). Бриф §4.2, §6 п.2.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type * as Persona from '../src/persona.ts';
import { load } from './_load.ts';

const m = await load<typeof Persona>('../src/persona.ts');

describe('персонажи и подписи демо-панели', () => {
  it('8 персонажей — значения select «Персонаж»', () => {
    assert.deepEqual(m.PERSONAS, [
      'operator',
      'owner',
      'manager',
      'driver',
      'therapist',
      'foreman',
      'owner@t-lotos',
      'therapist@t-lotos',
    ]);
  });

  it('подписи дословно из прототипа', () => {
    assert.deepEqual(m.PERSONA_LABEL, {
      operator: 'Оператор платформы',
      owner: 'Владелец · Дарья Зимина',
      manager: 'Логист · Марина Котова',
      driver: 'Водитель · Илья Васильев',
      therapist: 'Массажист · Анна Морозова',
      foreman: 'Прораб · Алексей Соколов',
      'owner@t-lotos': 'Владелец · Ирина Белова',
      'therapist@t-lotos': 'Массажист · Анна Морозова',
    });
  });

  it('ширины, флажки и селектор панели', () => {
    assert.deepEqual(m.WIDTH_LABEL, {
      auto: 'По окну',
      390: '390 · телефон',
      768: '768 · планшет',
      1440: '1440 · компьютер',
    });
    assert.deepEqual(m.FLAG_LABEL, {
      offline: 'Нет связи',
      conflictNext: 'Конфликт брони',
      failUploadNext: 'Сбой загрузки фото',
    });
    assert.equal(m.PANEL, '[aria-label="Панель демонстрации"]');
  });

  it('isPersona различает известные значения', () => {
    assert.equal(typeof m.isPersona, 'function');
    assert.equal(m.isPersona?.('owner@t-lotos'), true);
    assert.equal(m.isPersona?.('admin'), false);
  });
});

describe('personaUrl (dev-вход только в e2e-сборке, PD-54)', () => {
  it('добавляет ?persona= к маршруту', () => {
    assert.equal(typeof m.personaUrl, 'function');
    assert.equal(m.personaUrl?.('/t/t-alta/home', 'owner'), '/t/t-alta/home?persona=owner');
  });

  it('сохраняет существующий запрос и хеш', () => {
    assert.equal(
      m.personaUrl?.('/t/t-alta/repair?tab=overview#top', 'foreman'),
      '/t/t-alta/repair?tab=overview&persona=foreman#top',
    );
  });

  it('кодирует @ и заменяет прежний persona', () => {
    assert.equal(
      m.personaUrl?.('/t/t-lotos/home?persona=owner', 'owner@t-lotos'),
      '/t/t-lotos/home?persona=owner%40t-lotos',
    );
  });

  it('неизвестный персонаж — ошибка', () => {
    assert.throws(() => m.personaUrl?.('/', 'admin' as Persona.Persona), /persona/);
  });
});

describe('referenceUrl', () => {
  it('кодирует кириллицу и пробелы в имени файла эталона', () => {
    assert.equal(typeof m.referenceUrl, 'function');
    assert.equal(
      m.referenceUrl?.('http://127.0.0.1:4173', 'Ортус CRM.dc.html'),
      'http://127.0.0.1:4173/%D0%9E%D1%80%D1%82%D1%83%D1%81%20CRM.dc.html',
    );
  });

  it('подкаталог и хеш', () => {
    assert.equal(
      m.referenceUrl?.('http://127.0.0.1:4106/', 'modules/Касса.dc.html', '#/x'),
      'http://127.0.0.1:4106/modules/%D0%9A%D0%B0%D1%81%D1%81%D0%B0.dc.html#/x',
    );
  });
});
