// Модуль «Файлы» по контракту `DomainModule` ядра: разбивка места организации. Сессии загрузки и
// «Хранилище» — W1.09 / W1.24; здесь — установка сида и проекция (без фильтра, как в эталоне).
import type { DomainModule } from '../../core/module.ts';
import { filesSeed } from './seed.ts';
import type { StorageSlice } from './types.ts';

export const filesModule: DomainModule<StorageSlice | undefined> = {
  key: 'files',
  install(db, opts) {
    db.storage ??= filesSeed(opts.tenantId);
  },
  view: (_db, _actor, slice) => (slice ? structuredClone(slice) : null),
  commands: () => ({}),
  methods: [],
  delays: {},
};
