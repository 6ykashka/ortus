// W6.21 · Таблица сметы: разделы, строки с объёмом и ценой, строка из справочника, новый раздел, скидка, итого
// (эталон design-2026-10-19 «Ремонт и стройка.dc.html» :221–262, estVM :1441–1455, :1474–1480).
import { Icon } from '@ortus/ui';
import { type KeyboardEvent, type ReactElement } from 'react';

import type { PickItem } from './picker.ts';
import { ESTIMATE_TEXT as T, t } from './texts.ts';
import type { SectionView } from './vm.ts';

export interface PickState {
  sectionId: string | null;
  query: string;
  items: readonly PickItem[];
}

interface Props {
  sections: readonly SectionView[];
  edit: boolean;
  totalLabel: string;
  total: string;
  discountPct: number;
  discountAmount: string;
  discountInput: string;
  baseText: string | undefined;
  pick: PickState;
  newSection: string;
  onQty: (lineId: string, value: string) => void;
  onPrice: (lineId: string, value: string) => void;
  onReset: (lineId: string) => void;
  onRemove: (lineId: string) => void;
  onTogglePick: (sectionId: string) => void;
  onQuery: (q: string) => void;
  onAddLine: (sectionId: string, priceItemId: string) => void;
  onNewSection: (v: string) => void;
  onAddSection: () => void;
  onDiscount: (value: string) => void;
}

const enterBlurs = (e: KeyboardEvent<HTMLInputElement>): void => {
  if (e.key === 'Enter') e.currentTarget.blur();
};

export function LinesTable(p: Props): ReactElement {
  const cols = p.edit ? 6 : 5;
  return (
    <div className="ox-rp-tablewrap">
      <table className="ox-rp-table" data-min="760">
        <thead>
          <tr>
            <th scope="col">{T.line}</th>
            <th scope="col">{T.unit}</th>
            <th scope="col" className="ox-rp-right">
              {T.qty}
            </th>
            <th scope="col" className="ox-rp-right">
              {T.priceCol}
            </th>
            <th scope="col" className="ox-rp-right ox-rp-wide">
              {T.sum}
            </th>
            {p.edit ? (
              <th scope="col">
                <span className="ox-rp-vh">{T.remove}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {p.sections.map((s) => {
            const picking = p.edit && p.pick.sectionId === s.id;
            return <SectionRows key={s.id} s={s} picking={picking} cols={cols} p={p} />;
          })}
          {p.edit ? (
            <tr>
              <td colSpan={cols}>
                <div className="ox-rp-newsec">
                  <input
                    className="ox-rp-input"
                    data-w="wide"
                    value={p.newSection}
                    placeholder={T.newSection}
                    aria-label={T.newSectionAria}
                    onChange={(e) => p.onNewSection(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') p.onAddSection();
                    }}
                  />
                  <button
                    type="button"
                    className="ox-rp-btn"
                    data-variant="secondary"
                    onClick={p.onAddSection}
                  >
                    <Icon name="add" size={18} />
                    {T.addSection}
                  </button>
                </div>
              </td>
            </tr>
          ) : null}
          {p.edit || p.discountPct > 0 ? (
            <tr>
              <td colSpan={4}>
                <span className="ox-rp-disc">
                  {T.discount}
                  {p.edit ? (
                    <>
                      <span>
                        <input
                          key={p.discountInput}
                          className="ox-rp-input"
                          data-w="disc"
                          inputMode="decimal"
                          defaultValue={p.discountInput}
                          aria-label={T.discountAria}
                          onBlur={(e) => p.onDiscount(e.currentTarget.value)}
                          onKeyDown={enterBlurs}
                        />
                        %
                      </span>
                      <span className="ox-rp-meta">{T.discountNote}</span>
                    </>
                  ) : (
                    <span className="ox-rp-num">{p.discountPct}%</span>
                  )}
                </span>
              </td>
              <td className="ox-rp-td-n">{p.discountAmount}</td>
              {p.edit ? <td /> : null}
            </tr>
          ) : null}
          <tr className="ox-rp-grand">
            <td colSpan={4}>{p.totalLabel}</td>
            <td className="ox-rp-td-n">{p.total}</td>
            {p.edit ? <td /> : null}
          </tr>
          {p.baseText ? (
            <tr>
              <td colSpan={cols} className="ox-rp-basetext">
                {p.baseText}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function SectionRows({
  s,
  picking,
  cols,
  p,
}: {
  s: SectionView;
  picking: boolean;
  cols: number;
  p: Props;
}): ReactElement {
  return (
    <>
      <tr className="ox-rp-sec">
        <td colSpan={4}>
          <span className="ox-rp-sec-title">
            <strong>{s.title}</strong>
            {p.edit ? (
              <button
                type="button"
                className="ox-rp-btn"
                data-variant="dashed"
                data-size="xs"
                aria-expanded={picking}
                onClick={() => p.onTogglePick(s.id)}
              >
                <Icon name="add" size={16} />
                {T.fromCatalog}
              </button>
            ) : null}
          </span>
        </td>
        <td className="ox-rp-td-n ox-rp-bold">{s.sum}</td>
        {p.edit ? <td /> : null}
      </tr>
      {picking ? (
        <tr className="ox-rp-pickrow">
          <td colSpan={cols}>
            <div className="ox-rp-pick">
              <input
                type="search"
                className="ox-rp-input"
                data-w="search"
                value={p.pick.query}
                placeholder={T.searchCatalog}
                aria-label={T.searchCatalogAria}
                onChange={(e) => p.onQuery(e.target.value)}
              />
              <div className="ox-rp-picklist">
                {p.pick.items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    className="ox-rp-pickbtn"
                    onClick={() => p.onAddLine(s.id, it.id)}
                  >
                    <span>{it.name}</span>
                    <span className="ox-rp-meta">{it.meta}</span>
                  </button>
                ))}
                {p.pick.items.length === 0 ? (
                  <span className="ox-rp-meta">{T.catalogNone}</span>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
      {s.lines.map((l) => (
        <tr key={l.id}>
          <td>
            <span className="ox-rp-line">
              {l.name}
              {l.isNew ? (
                <span className="ox-rp-tag" data-tone="ok">
                  {T.badgeNew}
                </span>
              ) : null}
              {l.formula ? (
                <span className="ox-rp-tag" data-tone="info" title={l.formulaTitle}>
                  <Icon name="straighten" size={15} />
                  {l.formula}
                </span>
              ) : null}
              {l.manualBadge ? (
                <>
                  <span className="ox-rp-tag">{T.badgeManual}</span>
                  {l.canReset ? (
                    <button
                      type="button"
                      className="ox-rp-btn"
                      data-variant="text"
                      data-size="xs"
                      onClick={() => p.onReset(l.id)}
                    >
                      {T.resetFromMeasure}
                    </button>
                  ) : null}
                </>
              ) : null}
            </span>
          </td>
          <td className="ox-rp-unit">{l.unit}</td>
          <td className="ox-rp-td-q">
            {p.edit ? (
              <input
                key={`${l.id}:${l.qtyInput}`}
                className="ox-rp-input"
                data-w="qty"
                inputMode="decimal"
                defaultValue={l.qtyInput}
                aria-label={t(T.qtyOf, { name: l.name })}
                onBlur={(e) => p.onQty(l.id, e.currentTarget.value)}
                onKeyDown={enterBlurs}
              />
            ) : (
              l.qty
            )}
          </td>
          <td className="ox-rp-td-q">
            {p.edit ? (
              <input
                key={`${l.id}:${l.priceInput}`}
                className="ox-rp-input"
                data-w="price"
                inputMode="decimal"
                defaultValue={l.priceInput}
                aria-label={t(T.priceOf, { name: l.name })}
                onBlur={(e) => p.onPrice(l.id, e.currentTarget.value)}
                onKeyDown={enterBlurs}
              />
            ) : (
              l.price
            )}
          </td>
          <td className="ox-rp-td-n">{l.sum}</td>
          {p.edit ? (
            <td className="ox-rp-td-del">
              <button
                type="button"
                className="ox-rp-iconbtn"
                data-tone="danger"
                aria-label={t(T.removeOf, { name: l.name })}
                onClick={() => p.onRemove(l.id)}
              >
                <Icon name="close" size={18} />
              </button>
            </td>
          ) : null}
        </tr>
      ))}
      {s.empty ? (
        <tr>
          <td colSpan={cols} className="ox-rp-muted-cell">
            {T.sectionEmpty}
          </td>
        </tr>
      ) : null}
    </>
  );
}
