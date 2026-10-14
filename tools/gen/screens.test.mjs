// W0.07 · api/openapi/screens.yaml — «экран → операции» (план v2 §3.4: ведёт стюард; бриф §4.7).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { SCREENS_PATH } from './lib/paths.mjs';
import { checkScreens } from './lib/screens.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const doc = bundle();
const screens = readYaml(SCREENS_PATH);

describe('screens.yaml', () => {
  it('заготовка экранов этапа 1: оболочка, компания, оператор, вход', () => {
    for (const key of [
      'shell',
      'company-users',
      'company-modules',
      'company-storage',
      'core-files',
      'platform-tenants',
      'auth-login',
      'modal-assign',
      'modal-invite',
      'modal-create-role',
    ]) {
      assert.ok(screens.screens[key], key);
    }
  });

  it('у каждого экрана есть stage, title, ws и список операций', () => {
    for (const [key, s] of Object.entries(screens.screens)) {
      assert.match(key, /^[a-z]+(-[a-z]+)*$/, key);
      assert.equal(typeof s.title, 'string', key);
      assert.ok(Number.isInteger(s.stage), key);
      assert.match(s.ws, /^W\d\.\d\d$/, key);
      assert.ok(Array.isArray(s.operations), key);
    }
  });

  it('каждая операция screens.yaml есть в бандле', () => {
    assert.deepEqual(checkScreens(doc, screens), []);
  });

  it('несуществующая операция ловится', () => {
    const bad = structuredClone(screens);
    bad.screens.shell.operations.push('getNothing');
    assert.deepEqual(checkScreens(doc, bad), ['shell: операции getNothing нет в бандле']);
  });

  it('оболочка получает контекст через getMyContext', () => {
    assert.ok(screens.screens.shell.operations.includes('getMyContext'));
  });
});
