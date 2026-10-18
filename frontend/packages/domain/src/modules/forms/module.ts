// Модуль «Формы» по контракту `DomainModule` ядра: сид форм и ответов, проекция и три команды 14.10.
// Регистрация в `modules/index.ts` и `seed/compose.ts` — интегратор (план v2 §3.5).
import type { DomainModule } from '../../core/module.ts';
import { createFormsCommands, FORMS_DELAYS, FORMS_METHODS, type FormsOptions } from './commands.ts';
import { formsSeed } from './seed.ts';
import { formsView, type FormsView } from './view.ts';

export function createFormsModule(opts: FormsOptions = {}): DomainModule<FormsView | null> {
  return {
    key: 'forms',
    install(db, o) {
      const seed = formsSeed(o.tenantId);
      db.forms ??= seed.forms;
      db.responses ??= seed.responses;
    },
    view: (db, actor) => (db.forms ? formsView(db, actor) : null),
    commands: (ctx) => ({ ...createFormsCommands(ctx, opts) }),
    methods: FORMS_METHODS,
    delays: FORMS_DELAYS,
  };
}

export const formsModule = createFormsModule();
