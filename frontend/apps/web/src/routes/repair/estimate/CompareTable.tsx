// W6.21 · Сравнение версий сметы: строка, версия A, версия B, разница (эталон design-2026-10-19
// «Ремонт и стройка.dc.html» :200–219, estVM :1424–1440).
import type { ReactElement } from 'react';

import { ChipView } from './ChipView.tsx';
import { ESTIMATE_TEXT as T, t } from './texts.ts';
import type { CompareView } from './vm.ts';

export function CompareTable({
  view,
  a,
  b,
  onToggleSame,
}: {
  view: CompareView;
  a: number;
  b: number;
  onToggleSame: () => void;
}): ReactElement {
  return (
    <div className="ox-rp-tablewrap">
      <table className="ox-rp-table" data-min="760" aria-label={t(T.compareAria, { a, b })}>
        <thead>
          <tr>
            <th scope="col">{T.compareLine}</th>
            <th scope="col" className="ox-rp-right">
              {view.aLabel}
            </th>
            <th scope="col" className="ox-rp-right">
              {view.bLabel}
            </th>
            <th scope="col" className="ox-rp-right ox-rp-wide">
              {T.compareDiff}
            </th>
          </tr>
        </thead>
        <tbody>
          {view.rows.map((r, i) => (
            <tr key={`${r.name}-${i}`} data-row={r.kind}>
              <td>
                <span className="ox-rp-cmp-name">
                  <span>
                    <span data-strike={r.strike ? '' : undefined}>{r.name}</span>
                    <ChipView chip={r.chip} small />
                  </span>
                  <span className="ox-rp-meta">{r.section}</span>
                </span>
              </td>
              <td className="ox-rp-td-c">
                <span className="ox-rp-cmp-sum">
                  <span>{r.aSum}</span>
                  <span>{r.aCalc}</span>
                </span>
              </td>
              <td className="ox-rp-td-c">
                <span className="ox-rp-cmp-sum">
                  <span>{r.bSum}</span>
                  <span>{r.bCalc}</span>
                </span>
              </td>
              <td className="ox-rp-delta" data-dtone={r.dTone}>
                {r.d}
              </td>
            </tr>
          ))}
          {view.noRows ? (
            <tr>
              <td colSpan={4} className="ox-rp-muted-cell">
                {T.compareNone}
              </td>
            </tr>
          ) : null}
          {view.sameCount > 0 ? (
            <tr className="ox-rp-cmp-same">
              <td colSpan={4}>
                <button
                  type="button"
                  className="ox-rp-btn"
                  data-variant="text"
                  data-size="sm"
                  onClick={onToggleSame}
                >
                  {view.sameLabel}
                </button>
              </td>
            </tr>
          ) : null}
          <tr className="ox-rp-grand">
            <td>{T.total}</td>
            <td className="ox-rp-td-c">{view.aTotal}</td>
            <td className="ox-rp-td-c">{view.bTotal}</td>
            <td className="ox-rp-delta" data-dtone={view.dTone}>
              {view.dTotal}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
