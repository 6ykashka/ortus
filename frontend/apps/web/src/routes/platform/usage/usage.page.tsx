// W4.61 · «Использование» оператора (pg.usage «Ортус CRM.dc.html» :869–943, usageVM :3751–3805; design-2026-10-19):
// плитки сводки, «Требуют внимания» с переходами в карточку организации и к заявке, «Отраслевые модули», таблица «По
// организациям» с сортировками. Данные — getPlatformUsage (W4.07): только метаданные control DB.
import '../kit/kit.css';
import './usage.css';

import { platform, screenLabels } from '@ortus/texts';
import { Icon } from '@ortus/ui';
import { useNavigate } from '@tanstack/react-router';
import { type ReactElement, useState } from 'react';

import { useShell } from '../../../shell/context.tsx';
import {
  AreaSkeleton,
  Bar,
  isForbidden,
  Notice,
  PageHead,
  Pills,
  RetryAlert,
  StatusChip,
} from '../kit/ui.tsx';
import { useTrialEnds, useUsage } from './api.ts';
import {
  moduleCards,
  signalRows,
  type SortKey,
  sortRows,
  summaryTiles,
  tableRows,
} from './model.ts';
import { USAGE_TEXT as T } from './texts.ts';

type Usage = NonNullable<ReturnType<typeof useUsage>['data']>;

const SORTS: readonly SortKey[] = ['seats', 'storage', 'activity', 'name'];

function Body({ usage }: { usage: Usage }): ReactElement {
  const { go } = useShell();
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortKey>('seats');
  const trialEnds = useTrialEnds(usage);
  const openCard = (tenantId: string) =>
    void navigate({
      to: '/platform/$page',
      params: { page: 'tenants' },
      search: { org: tenantId } as never,
    });
  const signals = signalRows(usage, trialEnds);
  const rows = sortRows(tableRows(usage), sort);
  return (
    <>
      <div className="ox-us-tiles">
        {summaryTiles(usage).map((k) => (
          <div key={k.label} className="ox-us-tile">
            <span className="ox-us-tile-label">{k.label}</span>{' '}
            <span className="ox-us-tile-value">{k.value}</span>{' '}
            <span className="ox-us-tile-sub">{k.sub}</span>
          </div>
        ))}
      </div>
      <div className="ox-us-row">
        <div className="ox-pk-card ox-us-signals">
          <div className="ox-us-signals-head">
            <h2>{T.signals.title}</h2>
            <span className="ox-us-count">{signals.length}</span>
          </div>
          {signals.length === 0 ? <div className="ox-us-quiet">{T.signals.empty}</div> : null}
          {signals.map((g) => (
            <div key={g.key} className="ox-us-signal">
              <span className="ox-us-signal-icon" data-tone={g.tone} aria-hidden="true">
                <Icon name={g.icon} size={18} />
              </span>{' '}
              <div className="ox-us-signal-main">
                <span className="ox-us-signal-org">{g.org}</span>
                <span className="ox-us-signal-text">{g.text}</span>
              </div>{' '}
              <button
                type="button"
                className="ox-us-signal-act ox-pk-hit"
                onClick={() => (g.act === 'request' ? go('requests') : openCard(g.tenantId))}
              >
                {g.act === 'request' ? T.signals.openRequest : T.signals.card}
              </button>
            </div>
          ))}
        </div>
        <div className="ox-pk-card ox-us-modules">
          <div className="ox-us-modules-head">
            <h2>{T.modules.title}</h2>
            <span>{T.modules.note}</span>
          </div>
          {moduleCards(usage).map((m) => (
            <div key={m.key} className="ox-us-module">
              <div className="ox-us-module-top">
                <Icon name={m.icon} size={20} className="ox-us-module-icon" />
                <strong>{m.name}</strong>
                <span className="ox-us-module-n">{m.n}</span>
              </div>{' '}
              <Bar percent={m.percent} tone="accent" />{' '}
              <span className="ox-us-module-seats">{m.seats}</span>{' '}
              <div className="ox-us-module-orgs">
                {m.orgs.map((o) => (
                  <button
                    key={o.tenantId ?? o.name}
                    type="button"
                    className="ox-us-org-chip ox-pk-hit"
                    onClick={() => o.tenantId && openCard(o.tenantId)}
                  >
                    {o.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="ox-pk-card ox-us-table-card">
        <div className="ox-us-table-head">
          <h2>{T.table.title}</h2>
          <Pills
            label={T.table.sortAria}
            items={SORTS.map((key) => ({ key, label: T.table.sorts[key] }))}
            value={sort}
            onChange={setSort}
            size={34}
            className="ox-us-sorts"
          />
        </div>
        <div className="ox-us-table-wrap">
          <table className="ox-us-table">
            <thead>
              <tr>
                {T.table.cols.map((c, i) => (
                  <th key={c} scope="col" data-narrow={i === 2 || i === 3 || undefined}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.tenantId}>
                  <td>
                    <button
                      type="button"
                      className="ox-us-org"
                      onClick={() => openCard(r.tenantId)}
                    >
                      <span className="ox-us-org-name">{r.name}</span>
                      <StatusChip chip={r.chip} />
                    </button>
                  </td>
                  <td>{r.tier}</td>
                  <td>
                    <div className="ox-us-cell-bar">
                      <span className="ox-us-num">{r.seats}</span>
                      <Bar percent={r.seatsPercent} tone={r.seatsTone} />
                    </div>
                  </td>
                  <td>
                    <div className="ox-us-cell-bar">
                      <span className="ox-us-num ox-us-nowrap">{r.storage}</span>
                      <Bar percent={r.storagePercent} tone={r.storageTone} />
                    </div>
                  </td>
                  <td className="ox-us-mods">{r.modules}</td>
                  <td>
                    <div className="ox-us-activity">
                      <span className="ox-us-num ox-us-act">{r.act}</span>
                      <span className="ox-us-last" data-late={r.lastLate || undefined}>
                        {r.last}
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function UsagePage(): ReactElement {
  const q = useUsage();
  let content: ReactElement;
  if (q.data) content = <Body usage={q.data} />;
  else if (q.isError && isForbidden(q.error)) content = <Notice>{T.forbidden}</Notice>;
  else if (q.isError)
    content = <RetryAlert text={T.loadError} error={q.error} onRetry={() => void q.refetch()} />;
  else content = <AreaSkeleton />;
  return (
    <section
      className="ox-pk ox-us"
      aria-labelledby="h-usage"
      data-screen-label={screenLabels.byPage.usage}
    >
      <PageHead id="h-usage" crumb={platform.crumb} title={T.title} intro={T.note} />
      {content}
    </section>
  );
}
