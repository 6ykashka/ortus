// Люди организации (W0.13): приглашение участника — общее правило хендлера inviteMember, импорта CSV и
// пресета seats-full. Приглашённый занимает место (people/seats.ts W0.12); аккаунт с почтой создаётся
// в статусе pending (как acc-6 сида), членство — invited, как в Go-сиде W0.06.
import { seedUuid } from '@ortus/domain/seed';

import type {
  AccountRow,
  InvitationRow,
  MemberRow,
  MembershipRow,
  Org,
  ScenarioState,
  TenantRow,
} from './state.ts';
import { addMs, DAY } from './time.ts';

/** Новый UUID v5 `ortus:<область>:new:<счётчик>`: детерминирован для одинаковой истории запросов. */
export const newId = (s: ScenarioState, scope: string): string =>
  seedUuid(`${scope}:new`, String(++s.seq));

/** Срок приглашения — неделя (пример inspectInvitation/ok). */
export const INVITATION_TTL_MS = 7 * DAY;

export interface InviteInput {
  email: string;
  displayName?: string;
  orgUnitIds?: string[];
  workProfiles?: MemberRow['workProfiles'];
  phone?: string;
}

/** Маска почты для превью приглашения: `o•••••@alta.example`. */
export const maskEmail = (email: string): string => {
  const at = email.indexOf('@');
  return at > 0 ? `${email[0]}•••••${email.slice(at)}` : '•••••';
};

/** Аккаунт по почте или новый (pending). */
export function accountFor(s: ScenarioState, email: string, displayName: string): AccountRow {
  const norm = email.toLowerCase();
  const found = s.accounts.find((a) => a.email.toLowerCase() === norm);
  if (found) return found;
  const proto = `acc-x${s.seq + 1}`;
  const acc: AccountRow = {
    id: newId(s, 'platform'),
    proto,
    displayName,
    email,
    status: 'pending',
  };
  s.accounts.push(acc);
  return acc;
}

/** Участник-приглашённый, его членство и (если `send`) приглашение со сроком неделя. */
export function inviteMember(
  s: ScenarioState,
  tenant: TenantRow,
  org: Org,
  input: InviteInput,
  send = true,
): { member: MemberRow; invitation?: InvitationRow } {
  const displayName = input.displayName?.trim() || input.email.split('@')[0] || input.email;
  const account = accountFor(s, input.email, displayName);
  const id = newId(s, org.proto);
  const member: MemberRow = {
    id,
    proto: `m-new-${s.seq}`,
    userId: account.id,
    displayName,
    email: input.email,
    status: 'invited',
    orgUnitIds: [...(input.orgUnitIds ?? [])],
    revision: 1,
    workProfiles: [...(input.workProfiles ?? [])],
  };
  if (input.phone) member.phone = input.phone;
  org.members.push(member);
  const mid = seedUuid('platform', `membership:${tenant.proto}:${account.proto}`);
  const existing = s.memberships.find(
    (m) => m.accountId === account.id && m.tenantId === tenant.id,
  );
  if (existing) {
    existing.status = 'invited';
    existing.memberId = member.id;
  } else {
    const row: MembershipRow = {
      id: mid,
      tenantId: tenant.id,
      accountId: account.id,
      status: 'invited',
      owner: false,
      memberId: member.id,
    };
    s.memberships.push(row);
  }
  if (!send) return { member };
  const invitationId = newId(s, org.proto);
  const invitation: InvitationRow = {
    id: invitationId,
    memberId: member.id,
    email: input.email,
    status: 'pending',
    expiresAt: addMs(s.clock, INVITATION_TTL_MS),
    createdAt: s.clock,
    token: 'inv_' + invitationId.replaceAll('-', ''),
  };
  org.invitations.push(invitation);
  return { member, invitation };
}
