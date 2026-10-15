// Экран `/` каркаса (S0-04): что знает о пользователе GET /me/context — путь браузер → BFF → API → tenant DB.
// До оболочки W1.20 это служебный экран (нет в прототипе, no-reference); W1.20 заменит его редиректом ADR-0001.
import { type MeContext, ProblemError, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { useApi } from './api.tsx';
import { T } from './texts.ts';

export const meContextKey = ['me', 'context'] as const;

function Tenants({ me }: { me: MeContext }) {
  if (me.tenants.length === 0) return <p>{T.noTenants}</p>;
  return (
    <ul>
      {me.tenants.map((t) => (
        <li key={t.tenantId}>
          <span>{t.name}</span> · <span>{T.membership[t.membershipStatus]}</span>
        </li>
      ))}
    </ul>
  );
}

export function ContextPage() {
  const api = useApi();
  const q = useQuery({
    queryKey: meContextKey,
    queryFn: async () => unwrap(await api.GET('/api/v1/me/context')),
  });
  if (q.isPending) return <p role="status">{T.loading}</p>;
  if (q.isError) {
    return q.error instanceof ProblemError && q.error.status === 401 ? (
      <section>
        <p>{T.signInNeeded}</p>
        <Link to="/auth/login">{T.signIn}</Link>
      </section>
    ) : (
      <p role="alert">{T.offline}</p>
    );
  }
  const me = q.data;
  return (
    <section aria-label={T.contextTitle}>
      <h1>{me.displayName}</h1>
      {me.platformOperator ? <p>{T.operator}</p> : null}
      <Tenants me={me} />
    </section>
  );
}
