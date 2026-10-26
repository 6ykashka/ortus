// W2.25 · «Главная» (`@ortus/domain/home`): реестр источников «Требует решения» (S2-18), очередь и вид страницы.
export { OUT_OF_STAGE, type OutOfStageSource } from './out-of-stage.ts';
export { homeQueue, QUEUE_LIMIT } from './queue.ts';
export { HOME_SOURCES } from './sources.gen.ts';
export { HOME_TIME_ZONE, hhmm } from './time.ts';
export type * from './types.ts';
export {
  dateLine,
  greeting,
  logisticsWork,
  offModules,
  setupSteps,
  summary,
  tasksBadges,
  tasksWork,
  tripsToday,
  type SetupInput,
  type SetupStep,
  type TaskSummaryLike,
  type TripLike,
  type TripRow,
  type VehicleLike,
  type WorkCard,
} from './view.ts';
