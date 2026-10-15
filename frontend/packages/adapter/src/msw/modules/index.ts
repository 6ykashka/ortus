// Тег Modules (W0.13): каталог подключаемых модулей организации (`fleet`, `spa`, `repairs`), подключение
// (владелец, x-scope tenant-owner), настройки модулей и ядра (`forms`, `tasks`). Подключение «Логистики»
// открывает доступ по назначениям в /me/context; операции модуля — его этап (W2.00).
import type { components } from '@ortus/api-client';

import { INSTALLABLE_KEYS, type InstallableKey, moduleLabel } from '../core/catalog.ts';
import { manifestDto } from '../core/dto.ts';
import { notifyOwners } from '../core/notify.ts';
import { FLEET_SETTINGS } from '../core/presets.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { ModuleRow } from '../core/state.ts';

type S = components['schemas'];

const SPA_SETTINGS: S['SpaSettings'] = {
  moduleKey: 'spa',
  cancellationMinutes: 120,
  allowNegativeStock: false,
  defaultTimeZone: 'Europe/Moscow',
};

const isInstallable = (key: string): key is InstallableKey =>
  (INSTALLABLE_KEYS as string[]).includes(key);

function installable(ctx: HandlerContext): { key: InstallableKey; row: ModuleRow } {
  const key = ctx.params.moduleKey ?? '';
  const row = ctx.org().org.modules[key];
  if (!isInstallable(key) || !row) fail('not_found');
  return { key, row };
}

/** Модуль с настройками: подключаемый (должен быть подключён) или модуль ядра с настройками. */
function withSettings(ctx: HandlerContext): { key: string; row: ModuleRow } {
  const key = ctx.params.moduleKey ?? '';
  const row = ctx.org().org.modules[key];
  if (!row) fail('not_found');
  if (isInstallable(key) && row.state !== 'active' && row.state !== 'read_only') {
    fail('module_not_installed', `Модуль «${moduleLabel(key)}» не подключён организацией.`);
  }
  if (!row.settings) fail('not_found');
  return { key, row };
}

export const modulesHandlers: Registry = {
  listModuleCatalog: (ctx) => {
    const mods = ctx.org().org.modules;
    return {
      body: {
        items: INSTALLABLE_KEYS.map((k) =>
          manifestDto(k, mods[k]?.state ?? 'uninstalled', mods[k]?.revision ?? 1),
        ),
      },
    };
  },

  getModuleInstallation: (ctx) => {
    const { key, row } = installable(ctx);
    return { body: manifestDto(key, row.state, row.revision) };
  },

  setModuleInstallation: (ctx) => {
    const t = ctx.org();
    const { key, row } = installable(ctx);
    const b = ctx.body as S['ModuleInstallationUpdate'];
    ctx.revision(row.revision);
    const next = b.enabled
      ? 'active'
      : b.retainedAccess === 'history_read'
        ? 'read_only'
        : 'uninstalled';
    if (next !== row.state) {
      row.state = next;
      row.revision++;
      t.org.policyVersion++;
      if (next === 'active') {
        if (key === 'fleet') row.settings ??= structuredClone(FLEET_SETTINGS);
        if (key === 'spa') row.settings ??= structuredClone(SPA_SETTINGS);
        notifyOwners(ctx.s, t.org, {
          kind: 'modules.module.enabled',
          severity: 'info',
          title: `Подключён модуль «${moduleLabel(key)}»`,
          link: '/modules',
        });
      }
    }
    return { body: manifestDto(key, row.state, row.revision) };
  },

  getModuleSettings: (ctx) => {
    const { row } = withSettings(ctx);
    return { body: structuredClone(row.settings), etag: row.settingsRevision };
  },

  updateModuleSettings: {
    messages: { cancellationMinutes: 'Не меньше 0 минут' },
    run: (ctx) => {
      const { key, row } = withSettings(ctx);
      const b = ctx.body as S['ModuleSettings'];
      ctx.revision(row.settingsRevision);
      if (b.moduleKey !== key) {
        fail('validation_failed', 'Настройки другого модуля.', {
          violations: [
            {
              field: 'moduleKey',
              code: 'mismatch',
              message: 'Модуль в теле не совпадает с адресом',
            },
          ],
        });
      }
      row.settings = structuredClone(b);
      row.settingsRevision++;
      return { body: structuredClone(b), etag: row.settingsRevision };
    },
  },
};
