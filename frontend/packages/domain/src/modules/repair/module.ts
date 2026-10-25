// Модуль «Ремонт и стройка» по контракту `DomainModule` ядра (B §5.1): установка сида, проекция,
// команды с задержками. Регистрацию в `modules/index.ts` и стадию сида подключает интегратор
// (план v2 §3.5, строкой в `integratorNotes` отчёта W6.10).
import type { DomainModule } from '../../core/module.ts';
import { REPAIR_DELAYS, REPAIR_METHODS, repairCommands } from './commands.ts';
import { repairSeed } from './seed.ts';
import type { RepairDb, RepairSlice } from './types.ts';
import { repairView } from './view.ts';

export const repairModule: DomainModule<RepairSlice | undefined> = {
  key: 'repair',
  install(db, opts) {
    const target = db as RepairDb;
    target.repair ??= repairSeed(opts.tenantId);
  },
  view: (db, actor) => ((db as RepairDb).repair ? repairView(db as RepairDb, actor) : null),
  commands: (ctx) => repairCommands(ctx),
  methods: REPAIR_METHODS,
  delays: REPAIR_DELAYS,
};
