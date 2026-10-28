// W7.13 · Бейдж пункта «Чаты» (navForBase :2966): Σ непрочитанных по чатам участника (`listChats`, `my.unread`).
// Ключ под `['tenant', id, 'chat']`: команды страницы «Чаты» перечитывают его вместе со своими данными. Нет права, модуль не
// подключён или сбой — без бейджа. Опрос раз в минуту; доставка в реальном времени — подсказка `chat.changed` (W7.12).
import { unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../app/api.tsx';

const LIMIT = 200;

export function useChatBadge(tenantId: string | null): number {
  const api = useApi();
  const q = useQuery({
    queryKey: ['tenant', tenantId ?? '', 'chat', 'badge'],
    enabled: tenantId !== null,
    retry: false,
    refetchInterval: 60_000,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/chats', {
            params: { path: { tenantId: tenantId ?? '' }, query: { limit: LIMIT } },
          }),
        )
      ).items.reduce((sum, c) => sum + c.my.unread, 0),
  });
  return q.data ?? 0;
}
