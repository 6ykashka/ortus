// W1.23 · Вкладка «Проверка доступа» (S1-14; эталон design-stage-1 :400–425, accessVM :3218–3247): сотрудник,
// действие, объект (машина или рейс логистики, Q-W1.23-8; без права на логистику — фирма организации), примеры;
// результат — explainAccess:
// «Разрешено» с основанием или причина эталона, «Рабочее место сотрудника · вычислено»; «Почему доступно» —
// диалог с проверками и назначениями (no-reference).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { company, format } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useQueries, useQuery } from '@tanstack/react-query';
import { type ReactElement, useId, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { ExplainDialog } from '../../../modals/people/index.ts';
import {
  CHECK_ACTIONS,
  type CheckAction,
  checkObjects,
  resultOf,
  WORKPLACE_PERMISSIONS,
  workplaceOf,
} from './check.ts';
import { problemText } from '../../../shell/run.tsx';
import { accessKey, type AccessData, fetchAll, isForbidden } from './data.ts';
import { memberSubtitle, unitLabel, type Units } from './model.ts';
import { Hidden } from './parts.tsx';
import { PEOPLE_TEXT } from './texts.ts';

type S = components['schemas'];
const C = company.users.check;
const NO_OBJECT = '';

const CIRCLE: Readonly<Record<'ok' | 'warn' | 'danger' | 'neutral', { bg: string; fg: string }>> = {
  ok: { bg: 'var(--ox-ok-bg)', fg: 'var(--ox-ok-fg)' },
  warn: { bg: 'var(--ox-warn-bg)', fg: 'var(--ox-warn-fg)' },
  danger: { bg: 'var(--ox-danger-bg)', fg: 'var(--ox-danger-fg)' },
  neutral: { bg: 'var(--ox-neutral-bg)', fg: 'var(--ox-neutral-fg)' },
};

interface Query {
  member: string;
  action: string;
  /** Выбранный объект; не выбран — первый объект домашней фирмы (эталон: «ГАЗель Next · Север Логистик»). */
  object: string | undefined;
}

interface ObjectOption {
  value: string;
  label: string;
  /** Подразделение объекта; у «Без конкретного объекта» нет. */
  orgUnitId?: string;
}

export interface CheckTabProps {
  tenantId: string;
  data: AccessData;
  units: Units;
}

/** Машины и рейсы логистики (не завершённые): нет права или модуль не подключён — пусто, вкладка предлагает фирмы. */
function fleetOptions(api: ApiClient, tenantId: string) {
  const path = { tenantId };
  const quiet = async <T,>(load: () => Promise<T[]>): Promise<T[]> => {
    try {
      return await load();
    } catch {
      return [];
    }
  };
  return [
    {
      queryKey: [...accessKey(tenantId), 'check-vehicles'],
      retry: false,
      queryFn: () =>
        quiet(() =>
          fetchAll(async (query) =>
            unwrap(
              await api.GET('/api/v1/tenants/{tenantId}/fleet/vehicles', {
                params: { path, query },
              }),
            ),
          ),
        ),
    },
    {
      queryKey: [...accessKey(tenantId), 'check-trips'],
      retry: false,
      queryFn: () =>
        quiet(() =>
          fetchAll(async (query) =>
            unwrap(
              await api.GET('/api/v1/tenants/{tenantId}/fleet/trip-plans', {
                params: {
                  path,
                  query: {
                    ...query,
                    state: [
                      'planned',
                      'assigned',
                      'inspection',
                      'defect_review',
                      'on_route',
                      'returning',
                    ],
                  },
                },
              }),
            ),
          ),
        ),
    },
  ] as const;
}

function explainOptions(
  api: ApiClient,
  tenantId: string,
  memberId: string,
  permission: string,
  orgUnitId: string,
) {
  return {
    queryKey: [...accessKey(tenantId), 'explain', memberId, permission, orgUnitId],
    enabled: Boolean(memberId),
    queryFn: async (): Promise<S['AccessExplanation']> =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/access/explanation', {
          params: {
            path: { tenantId },
            query: { memberId, permission, ...(orgUnitId ? { orgUnitId } : {}) },
          },
        }),
      ),
  };
}

export function CheckTab({ tenantId, data, units }: CheckTabProps): ReactElement {
  const resultId = useId();
  const members = data.members.data ?? [];
  const byName = (name: string) => members.find((m) => m.displayName === name)?.id;
  const firstRegion = units.regions[0];
  const firms = firstRegion ? units.firmsOf(firstRegion.id) : [];
  const allFirms = units.regions.flatMap((r) => units.firmsOf(r.id));
  const [q, setQ] = useState<Query>(() => ({
    member: byName('Марина Котова') ?? members[0]?.id ?? '',
    action: CHECK_ACTIONS[0]?.value ?? '',
    object: undefined,
  }));
  const [why, setWhy] = useState(false);
  const action = CHECK_ACTIONS.find((a) => a.value === q.action) as CheckAction;
  const member = members.find((m) => m.id === q.member);
  const api = useApi();
  const [vehicles, trips] = useQueries({ queries: fleetOptions(api, tenantId) });
  const fleetObjects = checkObjects(
    (vehicles.data ?? []) as S['Vehicle'][],
    (trips.data ?? []) as S['TripPlan'][],
    units,
  );
  // Нет машин и рейсов (нет права, модуль не подключён) — фирмы организации, как до логистики.
  const options: ObjectOption[] = [
    ...(fleetObjects.length
      ? fleetObjects
      : allFirms.map((f) => ({ value: f.id, label: unitLabel(f, units), orgUnitId: f.id }))),
    { value: NO_OBJECT, label: C.noObject },
  ];
  const defaultUnit = units.firstFirm()?.id;
  const object =
    options.find((o) => o.value === q.object) ??
    options.find((o) => o.orgUnitId !== undefined && o.orgUnitId === defaultUnit) ??
    options[0];
  const objectUnitId = object?.orgUnitId ?? NO_OBJECT;
  const objectIn = (unitId: string | undefined) =>
    options.find((o) => o.orgUnitId !== undefined && o.orgUnitId === unitId)?.value;
  const explain = useQuery(
    explainOptions(api, tenantId, q.member, action.permission, objectUnitId),
  );
  const workplace = useQueries({
    queries: Object.values(WORKPLACE_PERMISSIONS).map((p) =>
      explainOptions(api, tenantId, q.member, p, NO_OBJECT),
    ),
  });
  const groups = new Map((data.groups.data ?? []).map((g) => [g.id, g.name]));

  const presets: [string, Partial<Query>][] = [
    [
      C.presets.moduleOff,
      { member: byName('Алексей Соколов'), action: 'repair.create', object: NO_OBJECT },
    ],
    [
      C.presets.noPermission,
      { member: byName('Илья Васильев'), action: 'fleet.review', object: objectIn(firms[0]?.id) },
    ],
    [
      C.presets.noScope,
      { member: byName('Илья Васильев'), action: 'fleet.view', object: objectIn(firms[1]?.id) },
    ],
    [
      C.presets.earnings,
      { member: byName('Илья Васильев'), action: 'fleet.earnings', object: objectIn(firms[0]?.id) },
    ],
  ];
  const apply = (p: Partial<Query>) =>
    setQ((cur) => ({
      member: p.member ?? cur.member,
      action: p.action ?? cur.action,
      object: p.object ?? cur.object,
    }));

  // Состояния главного запроса вкладки (verification-protocol §1.3): загрузка и ошибка explainAccess.
  const loading = explain.isFetching;
  const failed = explain.isError && !explain.isFetching;
  const x = explain.data;
  const result =
    x && member
      ? resultOf(x, {
          memberName: member.displayName,
          action,
          ...(object?.orgUnitId ? { objectLabel: object.label } : {}),
          units,
          groups,
        })
      : null;
  // «Рабочее место» — пять запросов: сбой любого — ошибка с «Повторить», а не пустой список (возврат 16.10 №2).
  const workplaceFailed = workplace.find((w) => w.isError && !w.isFetching);
  const retryWorkplace = () =>
    Promise.all(workplace.filter((w) => w.isError).map((w) => w.refetch()));
  // «Повторить» проверки — заново и главный запрос, и не прошедшие запросы «Рабочего места».
  const retryAll = () => Promise.all([explain.refetch(), retryWorkplace()]);
  const [fleet, spa, repairs, review, earnings] = workplace.map((w) => w.data?.allowed === true);
  const nav = workplaceOf({
    fleet: Boolean(fleet),
    spa: Boolean(spa),
    repairs: Boolean(repairs),
    review: Boolean(review),
    earnings: Boolean(earnings),
  });
  const circle = CIRCLE[result?.tone ?? 'neutral'];

  const select = (
    label: string,
    value: string,
    key: keyof Query,
    options: { value: string; label: string }[],
  ) => (
    <label className="ox-users-field">
      {label}
      <select value={value} onChange={(e) => setQ((cur) => ({ ...cur, [key]: e.target.value }))}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="ox-users-panel">
      <div className="ox-check">
        <div className="ox-check-card">
          <div>
            <h3>{C.title}</h3>
            <span>{C.intro}</span>
          </div>
          {select(
            C.member,
            q.member,
            'member',
            members.map((m) => ({ value: m.id, label: memberSubtitle(m) })),
          )}
          {select(
            C.action,
            q.action,
            'action',
            CHECK_ACTIONS.map((a) => ({ value: a.value, label: a.label })),
          )}
          {select(C.objectField, object?.value ?? NO_OBJECT, 'object', options)}
          <div className="ox-check-presets">
            <span>{C.examples}</span>
            {presets.map(([label, p]) => (
              <button key={label} type="button" onClick={() => apply(p)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <section
          className="ox-check-result"
          aria-labelledby={resultId}
          aria-busy={loading}
          data-tone={result && !loading && !failed ? result.tone : 'neutral'}
        >
          <Hidden id={resultId}>{PEOPLE_TEXT.a11y.result}</Hidden>
          {loading ? (
            <span role="status" className="ox-check-loading">
              {PEOPLE_TEXT.checkLoading}
            </span>
          ) : null}
          {failed ? (
            <div role="alert" className="ox-users-error">
              <span>{format(PEOPLE_TEXT.checkError, { error: problemText(explain.error) })}</span>
              {isForbidden(explain.error) ? null : (
                <button type="button" className="ox-users-btn" onClick={() => void retryAll()}>
                  {PEOPLE_TEXT.retry}
                </button>
              )}
            </div>
          ) : null}
          {result && !loading && !failed ? (
            <>
              <div className="ox-check-verdict">
                <span
                  className="ox-check-circle"
                  style={{ background: circle.bg, color: circle.fg }}
                >
                  <Icon name={result.icon} size={24} />
                </span>
                <div>
                  <span
                    className="ox-check-pill"
                    style={{ background: circle.bg, color: circle.fg }}
                  >
                    {result.chip}
                  </span>
                  <strong className="ox-check-title">{result.title}</strong>
                  <span className="ox-check-text">{result.text}</span>
                </div>
              </div>
              <div className="ox-check-workplace">
                <span className="ox-check-workplace-title">{C.workplace}</span>
                {workplaceFailed ? (
                  <div role="alert" className="ox-users-error">
                    <span>
                      {format(PEOPLE_TEXT.workplaceError, {
                        error: problemText(workplaceFailed.error),
                      })}
                    </span>
                    <button
                      type="button"
                      className="ox-users-btn"
                      onClick={() => void retryWorkplace()}
                    >
                      {PEOPLE_TEXT.retry}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="ox-check-nav">
                      {nav.map((n) => (
                        <span key={n.label}>
                          <Icon name={n.icon} size={16} />
                          {n.label}
                        </span>
                      ))}
                    </div>
                    {nav.length ? null : <span className="ox-check-empty">{C.noSections}</span>}
                  </>
                )}
              </div>
              <button
                type="button"
                className="ox-users-btn ox-check-why"
                onClick={() => setWhy(true)}
              >
                {PEOPLE_TEXT.card.explain}
              </button>
            </>
          ) : null}
        </section>
      </div>
      {why && x && member ? (
        <ExplainDialog
          memberName={member.displayName}
          actionLabel={action.label}
          explanation={x}
          units={units}
          groups={groups}
          onClose={() => setWhy(false)}
        />
      ) : null}
    </div>
  );
}
