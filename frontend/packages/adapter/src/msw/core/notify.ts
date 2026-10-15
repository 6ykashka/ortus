// Входящие организации (W0.13): событие пишется во входящие владельцев (адресаты событий прототипа —
// владельцы, people/seats.ts W0.12 `owners`). Хранение — как notify.notifications tenant DB (W0.08).
import { newId } from './people.ts';
import type { NotificationRow, Org, ScenarioState } from './state.ts';

export type NewNotification = Omit<NotificationRow, 'accountId' | 'id' | 'createdAt' | 'readAt'>;

/** Аккаунты владельцев организации. */
export const ownerAccounts = (s: ScenarioState, org: Org): string[] =>
  s.memberships.filter((m) => m.tenantId === org.tenantId && m.owner).map((m) => m.accountId);

export function notifyOwners(s: ScenarioState, org: Org, n: NewNotification): void {
  for (const accountId of ownerAccounts(s, org)) {
    org.notifications.push({
      ...n,
      accountId,
      id: newId(s, org.proto),
      createdAt: s.clock,
      readAt: null,
    });
  }
}

/** «приняла» / «принял» по фамилии (последнее слово имени на -а/-я). */
export const pastVerb = (name: string, female: string, male: string): string =>
  /[ая]$/.test(name.trim().split(/\s+/).at(-1) ?? '') ? female : male;
