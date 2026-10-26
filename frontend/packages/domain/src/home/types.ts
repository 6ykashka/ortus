// W2.25 · «Главная · Требует решения» (S2-18): типы реестра источников (план v2 §3.5, 01-shell.md §23). Сервер
// (getMyDecisionQueue, тег Home) отдаёт структурные карточки `DecisionItem` (kind, tone, params); текст и переход
// собирает клиент. Модуль кладёт провайдер `home/sources/<m>.ts`: виды `kind` → карточка. Тексты — ключи словаря
// `@ortus/texts` `home.*` с аргументами (домен не зависит от словаря, подписи собирает страница).

/** Тон карточки очереди (homeVM :4052, ORDER :4094). */
export type HomeTone = 'danger' | 'warn' | 'info' | 'neutral';

/** Карточка сервера (`components['schemas']['DecisionItem']` контракта 0.5.0-stage2). */
export interface DecisionItemLike {
  key: string;
  kind: string;
  moduleKey: string;
  tone: HomeTone;
  object?: { moduleKey: string; entityType: string; entityId: string };
  params: Readonly<Record<string, string>>;
  occurredAt?: string;
}

/** Очередь сервера (`DecisionQueue`): карточки до лимита и число до лимита. */
export interface DecisionQueueLike {
  items: readonly DecisionItemLike[];
  total: number;
}

/** Ключ словаря `home.*` (путь от `home`, например `queue.criticalDefect`). */
export type HomeTextKey =
  | 'greeting'
  | 'summary'
  | 'scopeAll'
  | 'queue.shown'
  | 'queue.criticalDefect'
  | 'queue.defectText'
  | 'queue.shiftWaits'
  | 'queue.shiftWaitsText'
  | 'queue.tripNoDriver'
  | 'queue.tripNoDriverText'
  | 'queue.poolRequested'
  | 'queue.trialEnded'
  | 'queue.trialEndedText'
  | 'queue.trialLeft'
  | 'queue.trialLeftText'
  | 'queue.storageUsed'
  | 'queue.storageText'
  | 'queue.noRole'
  | 'queue.noRoleText'
  | 'queue.chips.blocksDeparture'
  | 'queue.chips.review'
  | 'queue.chips.otherFirm'
  | 'queue.chips.today'
  | 'queue.chips.subscription'
  | 'queue.chips.storage'
  | 'queue.chips.access'
  | 'queue.actions.resolve'
  | 'queue.actions.check'
  | 'queue.actions.openPool'
  | 'queue.actions.findInPool'
  | 'queue.actions.more'
  | 'queue.actions.assign'
  | 'queue.actions.modules'
  // W2.73 · S2-20 1g: машина рейса временного водителя.
  | 'queue.vehicleChoice'
  | 'queue.vehicleChoiceText'
  | 'queue.noVehicle'
  | 'queue.noVehicleText'
  | 'queue.chips.until'
  | 'queue.chips.tripAt'
  | 'queue.actions.keepVehicle'
  | 'queue.actions.assignVehicle'
  // W4.81 · Задачи участника «Новая» и «На проверке» (homeVM :4081–4084).
  | 'queue.task'
  | 'queue.taskDue'
  | 'queue.chips.task'
  | 'queue.chips.taskReview'
  | 'queue.actions.open'
  | 'setup.progress'
  | 'setup.module.title'
  | 'setup.module.text'
  | 'setup.module.action'
  | 'setup.roles.title'
  | 'setup.roles.text'
  | 'setup.roles.action'
  | 'setup.invite.title'
  | 'setup.invite.text'
  | 'setup.invite.action'
  | 'work.logistics'
  | 'work.spa'
  | 'work.repair'
  | 'work.tripsToday'
  | 'work.onRoute'
  | 'work.freeVehicles'
  | 'work.freeOf'
  | 'work.awaitingReview'
  // W4.81 · Карточка «Задачи» (:4113).
  | 'work.tasks'
  | 'work.tasksNew'
  | 'work.tasksProgress'
  | 'work.tasksReview'
  | 'trips.row'
  | 'trips.sub'
  | 'trips.noDriver'
  | 'trips.noVehicle';

/** Подпись: ключ словаря и аргументы ICU. */
export interface HomeMsg {
  key: HomeTextKey;
  args?: Readonly<Record<string, string | number>>;
}

/** Переход с «Главной»: страница своего контура и search-параметры (ADR-0001). */
export interface HomeTarget {
  page: string;
  search?: Readonly<Record<string, string>>;
}

/** Карточка «Требует решения» (Ортус CRM.dc.html :1735–1742): полоса и чип по тону, одна кнопка. */
export interface HomeCard {
  key: string;
  tone: HomeTone;
  icon: string;
  tag: HomeMsg;
  title: HomeMsg;
  text: HomeMsg;
  action?: { label: HomeMsg; target: HomeTarget };
}

/** Контекст сборки карточки: часовой пояс подписей времени и даты. */
export interface HomeSourceContext {
  timeZone: string;
}

/** Карточка по виду: всё, кроме ключа и тона (их даёт сервер). */
export type CardOf = (
  item: DecisionItemLike,
  ctx: HomeSourceContext,
) => Omit<HomeCard, 'key' | 'tone'>;

/** Провайдер модуля: виды `kind` его источника → карточка. */
export interface HomeSource {
  /** Имя файла `sources/<id>.ts`. */
  id: string;
  /** Модуль источника (`DecisionItem.moduleKey`). */
  moduleKey: string;
  /** Этап плана, с которого источник в очереди. */
  stage: number;
  kinds: Readonly<Record<string, CardOf>>;
}

/** Очередь «Требует решения» для страницы. */
export interface HomeQueue {
  cards: HomeCard[];
  /** Сколько карточек требует решения (сводка «Требует решения: N»). */
  total: number;
  /** Подпись рядом с заголовком: '' при 0, «N», «показано 8 из N». */
  count: string | HomeMsg;
}
