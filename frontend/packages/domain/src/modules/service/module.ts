// Модуль «Обращения» по контракту `DomainModule` ядра (B §5.1): проекция для участника и 10 команд
// с задержками. Сид среза — стадия `service` (`serviceHook`, после `normProjects`, только «Альта»):
// регистрацию модуля в `modules/index.ts` и хук в `seed/compose.ts` подключает интегратор (план v2 §3.5).
import type { DomainModule } from '../../core/module.ts';
import { serviceView } from './access.ts';
import { SERVICE_DELAYS, SERVICE_METHODS, serviceCommands } from './commands.ts';
import type { ServiceView } from './types.ts';

export const serviceModule: DomainModule<ServiceView | null | undefined> = {
  key: 'service',
  /** Срез создаёт стадия сида `service`: модуль всегда включён, но данные только у «Альты». */
  install() {},
  view: (db, actor) => serviceView(db as Parameters<typeof serviceView>[0], actor),
  commands: (ctx) => serviceCommands(ctx) as never,
  methods: SERVICE_METHODS,
  delays: SERVICE_DELAYS,
};
