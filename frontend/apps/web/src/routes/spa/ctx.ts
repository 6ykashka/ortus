// W5.21 · Общие данные вкладок «Салона и SPA»: права по ключам, словари имён (ресурсы, услуги, номенклатура),
// брони календаря (название «Услуга · Клиент», буферы), обновление после команд.
import type { components } from '@ortus/api-client';

type S = components['schemas'];

export interface SpaCan {
  create: boolean;
  perform: boolean;
  /** Завершение со списанием: `spa.appointments.complete` и `inventory.consume`. */
  complete: boolean;
  override: boolean;
  servicesRead: boolean;
  servicesManage: boolean;
}

export interface SpaCtx {
  tenantId: string;
  tz: string;
  /** Момент открытия страницы (мс). */
  now: number;
  can: SpaCan;
  /** `null` — у роли нет права читать услуги (специалист по каталогу 0.12.0). */
  services: readonly S['SpaService'][] | null;
  resources: readonly S['CalendarResource'][];
  /** `null` — нет права склада. */
  items: readonly S['InventoryItem'][] | null;
  bookings: ReadonlyMap<string, S['Booking']>;
  /** Названия «Услуга · Клиент» броней, виденных на странице (отменённая бронь пропадает из календаря — название остаётся). */
  titles: ReadonlyMap<string, string>;
  /** Перечитать визиты, услуги, остатки после команды. */
  refresh: () => Promise<unknown>;
}

export const nameOf = (ctx: SpaCtx, id: string, fallback: string): string =>
  ctx.resources.find((r) => r.id === id)?.name ?? fallback;
