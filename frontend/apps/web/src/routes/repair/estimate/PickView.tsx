// W6.21 · «Сметы нет»: замер, выбор шаблона, «Что получит объект», «Собрать черновик сметы» (эталон design-2026-10-19
// «Ремонт и стройка.dc.html» :120–147, estVM :1390–1408).
import { Icon } from '@ortus/ui';
import type { ReactElement } from 'react';

import { ChipView } from './ChipView.tsx';
import { rub } from './format.ts';
import { ESTIMATE_TEXT as T, t } from './texts.ts';
import { sourceChip, templateMeta, templateParts } from './templates.ts';
import type { components } from '@ortus/api-client';
import type { RepairTabLink } from '../measure/types.ts';

type Template = components['schemas']['Template'];

interface Props {
  templates: readonly Template[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  kind: string | undefined;
  measureLine: string;
  /** Сумма черновика по замеру и ценам справочника, копейки. */
  total: number;
  busy: boolean;
  onCreate: () => void;
  onNavigate?: ((tab: RepairTabLink) => void) | undefined;
}

export function PickView(p: Props): ReactElement | null {
  const tpl = p.templates.find((x) => x.id === p.selectedId);
  if (!tpl) return null;
  return (
    <>
      <div className="ox-rp-measure">
        <Icon name="straighten" size={22} className="ox-rp-ico" />
        <span>{p.measureLine}</span>
        {p.onNavigate ? (
          <button
            type="button"
            className="ox-rp-btn"
            data-variant="secondary"
            data-size="sm"
            onClick={() => p.onNavigate?.('measure')}
          >
            {T.openMeasure}
          </button>
        ) : null}
      </div>
      <div className="ox-rp-stack">
        <h3 className="ox-rp-h3">{T.template}</h3>
        <div role="radiogroup" aria-label={T.templateAria} className="ox-rp-radios">
          {p.templates.map((x) => {
            const on = x.id === tpl.id;
            return (
              <button
                key={x.id}
                type="button"
                role="radio"
                aria-checked={on}
                className="ox-rp-radio"
                onClick={() => p.onSelect(x.id)}
              >
                <span className="ox-rp-radio-top">
                  <strong>{x.name}</strong>
                  <Icon
                    name={on ? 'radio_button_checked' : 'radio_button_unchecked'}
                    size={20}
                    className="ox-rp-radio-dot"
                  />
                </span>
                <ChipView chip={sourceChip(x)} small />
                <span className="ox-rp-meta">{templateMeta(x)}</span>
                {x.kind === p.kind ? (
                  <span className="ox-rp-fit">
                    <Icon name="done" size={15} />
                    {t(T.fits, { kind: p.kind ?? '' })}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      <div className="ox-rp-card">
        <h3 className="ox-rp-h3">{t(T.partsTitle, { name: tpl.name })}</h3>
        <div className="ox-rp-parts">
          {templateParts(tpl).map((x) => (
            <div key={x.title} className="ox-rp-part">
              <span className="ox-rp-part-ico" aria-hidden="true">
                <Icon name={x.icon} size={18} />
              </span>
              <span>
                <strong>{x.title}</strong>
                <span>{x.text}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="ox-rp-create">
          <button
            type="button"
            className="ox-rp-btn"
            data-size="lg"
            disabled={p.busy}
            onClick={p.onCreate}
          >
            <Icon name="playlist_add" size={18} />
            {T.create}
          </button>
          <span>
            {T.createTotal} <strong>{rub(p.total)}</strong>
          </span>
        </div>
      </div>
    </>
  );
}
