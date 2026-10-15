// Модуль «Логистика» по контракту `DomainModule` ядра. Команды (`reserve`, `submitDeparture`, …)
// появятся в шагах этапа 2 и MSW-хендлерах; здесь — установка сида и проекция.
import type { DomainModule } from '../../core/module.ts';
import { logisticsSeed } from './seed.ts';
import type { LogisticsSlices } from './types.ts';
import { logisticsView } from './view.ts';

export const logisticsModule: DomainModule<LogisticsSlices | undefined> = {
  key: 'logistics',
  install(db, opts) {
    const seed = logisticsSeed(opts.tenantId);
    db.vehicles ??= seed.vehicles;
    db.trips ??= seed.trips;
    db.pool ??= seed.pool;
    db.earnings ??= seed.earnings;
  },
  view: (db, actor) => (db.vehicles ? logisticsView(db, actor) : null),
  commands: () => ({}),
  methods: [],
  delays: {},
};
