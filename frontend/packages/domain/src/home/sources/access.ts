// W2.25 · Источник «Требует решения» доступа (homeVM :4071–4072; 05 §5.5 строка 8): активные сотрудники без роли
// с областью организации, подразделения или «своего» (PD-53) → «Назначить» → «Пользователи и роли» ?tab=people.
import type { HomeSource } from '../types.ts';

export const source: HomeSource = {
  id: 'access',
  moduleKey: 'members',
  stage: 2,
  kinds: {
    'access.members_without_role': (item) => ({
      icon: 'person_off',
      tag: { key: 'queue.chips.access' },
      title: { key: 'queue.noRole', args: { n: Number(item.params.count ?? 0) } },
      text: { key: 'queue.noRoleText', args: { names: item.params.names ?? '' } },
      action: {
        label: { key: 'queue.actions.assign' },
        target: { page: 'users', search: { tab: 'people' } },
      },
    }),
  },
};
