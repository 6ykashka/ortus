// Тег Modules, контракт 0.4.0-stage1 (W1.00, S1-18): «Затронет сейчас» диалога «Отключить модуль».
// Только чтение: состояние не меняется. Рейсов, визитов и автоматизаций в режиме mock нет (операции модулей —
// их этапы), поэтому список пуст — строка эталона «Активных процессов нет».
import type { components } from '@ortus/api-client';

import { INSTALLABLE_KEYS, type InstallableKey, moduleLabel } from '../core/catalog.ts';
import { fail } from '../core/problem.ts';
import type { Registry } from '../core/registry.ts';

type S = components['schemas'];

const isInstallable = (key: string): key is InstallableKey =>
  (INSTALLABLE_KEYS as string[]).includes(key);

export const moduleDeactivationHandlers: Registry = {
  previewModuleDeactivation: (ctx) => {
    const key = ctx.params.moduleKey ?? '';
    const row = ctx.org().org.modules[key];
    if (!isInstallable(key) || !row) fail('not_found');
    if (row.state !== 'active') {
      fail('module_not_installed', `Модуль «${moduleLabel(key)}» не подключён организацией.`);
    }
    const body: S['ModuleDeactivationPreview'] = {
      moduleKey: key,
      retainedAccess: 'history_read',
      activeItems: [],
      hiddenCount: 0,
      generatedAt: ctx.now(),
    };
    return { body };
  },
};
