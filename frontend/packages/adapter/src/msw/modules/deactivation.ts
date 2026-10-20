// Тег Modules, контракт 0.4.0-stage1 (W1.00, S1-18): «Затронет сейчас» диалога «Отключить модуль».
// Только чтение: состояние не меняется. W2.62 (AC-12, Q-W2.32-5): процессы модуля — как modulesreg.Preview backend
// (рейсы «Логистики»: начатые — «можно завершить», назначенные — закрываются); пустой список — строка эталона
// «Активных процессов нет». Предпросмотр открыт подключённому модулю и модулю в draining.
import type { components } from '@ortus/api-client';

import { INSTALLABLE_KEYS, type InstallableKey, moduleLabel } from '../core/catalog.ts';
import { fail } from '../core/problem.ts';
import type { Registry } from '../core/registry.ts';
import { activeItems } from './draining.ts';

type S = components['schemas'];

const isInstallable = (key: string): key is InstallableKey =>
  (INSTALLABLE_KEYS as string[]).includes(key);

export const moduleDeactivationHandlers: Registry = {
  previewModuleDeactivation: (ctx) => {
    const key = ctx.params.moduleKey ?? '';
    const org = ctx.org().org;
    const row = org.modules[key];
    if (!isInstallable(key) || !row) fail('not_found');
    if (row.state !== 'active' && row.state !== 'draining') {
      fail('module_not_installed', `Модуль «${moduleLabel(key)}» не подключён организацией.`);
    }
    const { items, hiddenCount } = activeItems(org, key);
    const body: S['ModuleDeactivationPreview'] = {
      moduleKey: key,
      retainedAccess: 'history_read',
      activeItems: items,
      hiddenCount,
      generatedAt: ctx.now(),
    };
    return { body };
  },
};
