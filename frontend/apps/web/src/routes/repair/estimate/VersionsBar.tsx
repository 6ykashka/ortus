// W6.21 · Плитки версий сметы, пояснение и кнопка сравнения (эталон design-2026-10-19 «Ремонт и стройка.dc.html»
// :187–198, estVM :1417–1423, :1473).
import { Icon } from '@ortus/ui';
import type { ReactElement } from 'react';

import { ChipView } from './ChipView.tsx';
import { ESTIMATE_TEXT as T, t } from './texts.ts';
import type { Tile } from './vm.ts';

interface Props {
  tiles: readonly Tile[];
  note: string;
  /** Номер версии, с которой можно сравнить выбранную; нет — кнопки нет. */
  compareWith: number | undefined;
  compareOn: boolean;
  onPick: (version: number) => void;
  onCompare: () => void;
}

export function VersionsBar(p: Props): ReactElement {
  return (
    <>
      <div role="group" aria-label={T.versionsAria} className="ox-rp-tiles">
        {p.tiles.map((v) => (
          <button
            key={v.version}
            type="button"
            className="ox-rp-tile"
            aria-pressed={v.selected}
            onClick={() => p.onPick(v.version)}
          >
            <span className="ox-rp-tile-top">
              <strong>{v.title}</strong>
              <ChipView chip={v.chip} small />
            </span>{' '}
            <span className="ox-rp-meta">{v.meta}</span>
          </button>
        ))}
      </div>
      <div className="ox-rp-vnote">
        <span>{p.note}</span>
        {p.compareWith !== undefined ? (
          <button
            type="button"
            className="ox-rp-btn"
            data-variant="secondary"
            aria-pressed={p.compareOn}
            onClick={p.onCompare}
          >
            <Icon name={p.compareOn ? 'table_rows' : 'compare_arrows'} size={18} />
            {p.compareOn ? T.compareOff : t(T.compareWith, { n: p.compareWith })}
          </button>
        ) : null}
      </div>
    </>
  );
}
