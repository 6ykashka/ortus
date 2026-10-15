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

/** userSubject dev-провайдера (backend/internal/platform/session/dev/dev.go). */
const DEV_SUBJECT = /^[a-z0-9][a-z0-9@._-]{0,63}$/;

describe('newcomer: dev-вход нового человека (W1.50, только стенд dev/e2e)', () => {
  it('тело входа: subject new-<адрес>, адрес в нижнем регистре, имя без пробелов по краям', () => {
    assert.equal(m.NEWCOMER_PREFIX, 'new-');
    assert.deepEqual(m.newcomer?.(' I.Novikov@Alta.Example ', ' Иван Новиков '), {
      persona: 'new-i.novikov@alta.example',
      email: 'i.novikov@alta.example',
      displayName: 'Иван Новиков',
    });
  });

  it('subject детерминирован (повторный вход — тот же аккаунт) и проходит проверку dev-провайдера', () => {
    const a = m.newcomer?.('a+tag@alta.example', 'А');
    assert.deepEqual(a, m.newcomer?.('A+Tag@alta.example', 'А'));
    assert.equal(a?.persona, 'new-a-tag@alta.example');
    assert.match(a?.persona ?? '', DEV_SUBJECT);
    assert.equal(m.isNewcomerSubject?.(a?.persona ?? ''), true);
  });

  it('isNewcomerSubject: только new-… в форме subject', () => {
    assert.equal(m.isNewcomerSubject?.('owner'), false);
    assert.equal(m.isNewcomerSubject?.('acc-7'), false);
    assert.equal(m.isNewcomerSubject?.('new-'), false);
    assert.equal(m.isNewcomerSubject?.('new-Иван'), false);
  });

  it('плохой адрес, пустое имя, слишком длинный subject — ошибка', () => {
    for (const email of [
      '',
      'not-an-email',
      'n@',
      '@alta.example',
      'n n@alta.example',
      'Н <n@alta.example>',
    ]) {
      assert.throws(() => m.newcomer?.(email, 'Новый'), /email/, email);
    }
    assert.throws(() => m.newcomer?.('n@alta.example', '  '), /displayName/);
    assert.throws(() => m.newcomer?.(`${'n'.repeat(60)}@alta.example`, 'Новый'), /64/);
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
