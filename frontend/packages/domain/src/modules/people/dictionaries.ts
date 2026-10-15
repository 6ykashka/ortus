// Статусы участника организации (models.js 14.10:145–149).
import type { ToneKey } from '../../core/types/common.ts';
import type { MemberStatus } from '../../core/types/index.ts';

export interface MemberStateLabel {
  label: string;
  tone: ToneKey;
  icon: string;
}

export const MEMBER_STATE: Readonly<Record<MemberStatus, MemberStateLabel>> = {
  active: { label: 'Активен', tone: 'ok', icon: 'check_circle' },
  invited: { label: 'Приглашён', tone: 'warn', icon: 'schedule' },
  blocked: { label: 'Заблокирован', tone: 'danger', icon: 'block' },
};
