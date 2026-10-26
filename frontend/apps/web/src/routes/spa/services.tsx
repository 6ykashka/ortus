// W5.21 · Вкладка «Услуги и техкарты» (`spa-services`, no-reference, B-6): услуги салона с длительностью, буферами,
// ценой, оборудованием и техкартой; «Новая услуга» и «Изменить» (с версией — ревизия растёт, записанные визиты
// держат снимок). Права: `spa.services.read` — читать, `spa.services.manage` — создавать и править.
import type { components } from '@ortus/api-client';
import { format, shell } from '@ortus/texts';
import { Button, EmptyState, Skeleton } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { LoadFailed } from '../company/modules/ui.tsx';
import type { SpaCtx } from './ctx.ts';
import { ServiceDialog } from './dialogs.tsx';
import { buffersText, durationText, moneyText, recipeChips } from './model.ts';
import { SPA_TEXT as T } from './texts.ts';

type Service = components['schemas']['SpaService'];

function Row(p: { ctx: SpaCtx; service: Service; onEdit: (s: Service) => void }): ReactElement {
  const { ctx, service: s } = p;
  const names = new Map((ctx.items ?? []).map((i) => [i.id, i.name]));
  const equipment = s.requiredEquipmentIds
    .map((id) => ctx.resources.find((r) => r.id === id)?.name)
    .filter((x): x is string => !!x)
    .join(', ');
  const recipe = recipeChips(s.recipe, names);
  return (
    <article className="ox-spa-card ox-spa-service" aria-labelledby={`svc-${s.id}`}>
      <div className="ox-spa-body">
        <div className="ox-spa-row">
          <h3 id={`svc-${s.id}`} className="ox-spa-h3">
            {s.name}
          </h3>
          <span className="ox-spa-rev">{format(T.services.revision, { n: s.revision })}</span>
        </div>
        <span className="ox-spa-meta">
          {T.services.duration}: {durationText(s.durationMinutes)} ·{' '}
          {buffersText(s.bufferBeforeMinutes, s.bufferAfterMinutes)} · {T.services.price}:{' '}
          {moneyText(s.price)}
        </span>
        <span className="ox-spa-sub">
          {T.services.equipment}: {equipment || T.noEquipment}
        </span>
        {recipe.length ? (
          <div className="ox-spa-chips" role="list" aria-label={T.services.recipe}>
            {recipe.map((r) => (
              <span key={r} role="listitem" className="ox-spa-chip">
                {r}
              </span>
            ))}
          </div>
        ) : (
          <span className="ox-spa-sub">{T.services.noRecipe}</span>
        )}
        {ctx.can.servicesManage ? (
          <div className="ox-spa-actions">
            <Button
              variant="secondary"
              icon="edit"
              aria-label={`${T.services.edit}: ${s.name}`}
              onPress={() => p.onEdit(s)}
            >
              {T.services.edit}
            </Button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function ServicesTab(p: {
  ctx: SpaCtx;
  status: 'pending' | 'error' | 'success';
  error: unknown;
  onRetry: () => void;
}): ReactElement {
  const { ctx } = p;
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const list = ctx.services ?? [];
  let body: ReactElement;
  if (p.status === 'pending') body = <Skeleton lines={4} label={shell.a11y.loading} />;
  else if (p.status === 'error') body = <LoadFailed error={p.error} onRetry={p.onRetry} />;
  else if (!list.length)
    body = <EmptyState icon="spa" title={T.empty.services} text={T.empty.servicesText} dashed />;
  else
    body = (
      <div className="ox-spa-list" role="list" aria-label={T.services.listAria}>
        {list.map((s) => (
          <div key={s.id} role="listitem" className="ox-spa-li">
            <Row ctx={ctx} service={s} onEdit={setEditing} />
          </div>
        ))}
      </div>
    );
  return (
    <div className="ox-spa-visits">
      <div className="ox-spa-bar">
        <span className="ox-spa-note">{T.services.snapshotNote}</span>
        {ctx.can.servicesManage ? (
          <Button icon="add" onPress={() => setEditing('new')}>
            {T.services.add}
          </Button>
        ) : null}
      </div>
      {body}
      {editing ? (
        <ServiceDialog
          ctx={ctx}
          {...(editing === 'new' ? {} : { service: editing })}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
