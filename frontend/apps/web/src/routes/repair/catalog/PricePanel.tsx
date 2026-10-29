// W6.22 · Вкладка «Справочник расценок» (эталон :689–720): поиск и тип («Все / Работы / Материалы»), таблица по
// разделам с ценой в строке, «N из M», блок «Новая позиция» с ошибками эталона. Цена правится в таблице и сохраняется
// при выходе из поля (updatePriceItem); новая цена попадает только в новые черновики смет.
import { ProblemError } from '@ortus/api-client';
import type { components } from '@ortus/api-client';
import { format } from '@ortus/texts';
import { CATALOG_SECTIONS } from '@ortus/domain/modules';
import { Icon } from '@ortus/ui';
import { type KeyboardEvent, type ReactElement, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { problemText, useBusy, useRun } from '../../../shell/run.tsx';
import { PRICE_UNITS, parsePrice, unitRu } from '../supply/model.ts';
import { SegGroup } from '../supply/ui.tsx';
import { addPriceItem, setPrice } from './api.ts';
import { type Kind, newItemError, newItemNote, priceGroups, type PriceRowView } from './model.ts';
import { CATALOG_TEXT as T } from './texts.ts';

type S = components['schemas'];

/** Первое сообщение нарушения из Problem (дубликат названия на сервере) или текст по коду. */
const serverMessage = (e: unknown): string => {
  const v = (e as { problem?: { violations?: { message?: string }[] } } | undefined)?.problem
    ?.violations?.[0]?.message;
  return v ?? problemText(e);
};

function PriceInput(p: {
  row: PriceRowView;
  locked: boolean;
  onCommit: (value: string) => Promise<boolean>;
}): ReactElement {
  const [v, setV] = useState(p.row.price);
  const commit = async (): Promise<void> => {
    if (v === p.row.price) return;
    if (!(await p.onCommit(v))) setV(p.row.price);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') e.currentTarget.blur();
  };
  return (
    <input
      className="ox-rps-input ox-rc-price"
      data-num=""
      data-sm=""
      inputMode="decimal"
      value={v}
      disabled={p.locked}
      aria-label={format(T.price.priceAria, { name: p.row.name })}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={onKey}
    />
  );
}

export function PricePanel(p: {
  tenantId: string;
  prices: readonly S['PriceItem'][];
  locked: boolean;
  onNote: (text: string) => void;
  onChanged: () => Promise<void>;
}): ReactElement {
  const api = useApi();
  const run = useRun();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [name, setName] = useState('');
  const [itemKind, setItemKind] = useState<'work' | 'material'>('work');
  const [section, setSection] = useState('Полы');
  const [unit, setUnit] = useState<S['RepairUnit']>('m2');
  const [price, setPriceIn] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const busy = useBusy('catalog:price-add');
  const g = priceGroups(p.prices, q, kind);

  const commitPrice = async (id: string, value: string): Promise<boolean> => {
    const n = parsePrice(value);
    const item = p.prices.find((x) => x.id === id);
    if (!item) return false;
    if (!(n > 0)) {
      setErr(T.price.priceInvalid);
      return false;
    }
    setErr(null);
    try {
      await run(`catalog:price:${id}`, () => setPrice(api, p.tenantId, item, Math.round(n * 100)));
      await p.onChanged();
      return true;
    } catch {
      return false;
    }
  };

  const add = async (): Promise<void> => {
    const bad = newItemError(name, price, p.prices);
    if (bad) {
      setErr(bad);
      return;
    }
    const nm = name.trim();
    try {
      await run(
        'catalog:price-add',
        () =>
          addPriceItem(api, p.tenantId, {
            section,
            name: nm,
            unit,
            kind: itemKind,
            price: { amountMinor: Math.round(parsePrice(price) * 100), currency: 'RUB' },
          }),
        null,
        { quiet: ['validation_failed'] },
      );
      setName('');
      setPriceIn('');
      setErr(null);
      p.onNote(newItemNote(nm));
      await p.onChanged();
    } catch (e) {
      if (e instanceof ProblemError && e.code === 'validation_failed') setErr(serverMessage(e));
    }
  };

  const kinds = [
    { key: 'all' as const, label: T.price.kinds.all },
    { key: 'work' as const, label: T.price.kinds.work },
    { key: 'material' as const, label: T.price.kinds.material },
  ];

  return (
    <>
      <div className="ox-rc-tools">
        <label className="ox-rc-search">
          <Icon name="search" size={18} />
          <input
            type="search"
            value={q}
            placeholder={T.price.search}
            aria-label={T.price.searchAria}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <SegGroup aria={T.price.kindAria} items={kinds} value={kind} onChange={setKind} />
        <span className="ox-rps-sub ox-rc-count">{g.count}</span>
      </div>
      <div className="ox-rps-card">
        <div className="ox-rps-scroll" tabIndex={0}>
          <table className="ox-rps-table ox-rps-w640">
            <thead>
              <tr>
                <th scope="col">{T.price.cols.item}</th>
                <th scope="col">{T.price.cols.kind}</th>
                <th scope="col">{T.price.cols.unit}</th>
                <th scope="col" className="ox-rps-r">
                  {T.price.cols.price}
                </th>
                <th scope="col" className="ox-rps-r">
                  {T.price.cols.used}
                </th>
              </tr>
            </thead>
            <tbody>
              {g.groups.flatMap((grp) => [
                <tr key={`g:${grp.section}`} className="ox-rc-sec">
                  <td colSpan={5}>
                    <strong>{grp.section}</strong>
                  </td>
                </tr>,
                ...grp.items.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td className="ox-rps-muted">{r.kind}</td>
                    <td className="ox-rps-muted">{r.unit}</td>
                    <td className="ox-rps-r">
                      <PriceInput
                        key={`${r.id}:${r.revision}:${r.price}`}
                        row={r}
                        locked={p.locked}
                        onCommit={(v) => commitPrice(r.id, v)}
                      />
                    </td>
                    <td className="ox-rps-r ox-rps-muted">{r.used}</td>
                  </tr>
                )),
              ])}
              {g.groups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="ox-rps-empty">
                    {T.price.empty}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ox-rps-card-sel ox-rc-new">
        <h3 className="ox-rps-h3">{T.newItem.title}</h3>
        <div className="ox-rps-grid">
          <label className="ox-rps-field ox-rps-grow">
            {T.newItem.name}
            <input
              className="ox-rps-input"
              value={name}
              placeholder={T.newItem.namePlaceholder}
              disabled={p.locked}
              onChange={(e) => {
                setName(e.target.value);
                setErr(null);
              }}
            />
          </label>
          <label className="ox-rps-field ox-rc-f-kind">
            {T.newItem.kind}
            <select
              className="ox-rps-select"
              value={itemKind}
              disabled={p.locked}
              onChange={(e) => setItemKind(e.target.value === 'material' ? 'material' : 'work')}
            >
              <option value="work">{T.newItem.work}</option>
              <option value="material">{T.newItem.material}</option>
            </select>
          </label>
          <label className="ox-rps-field ox-rc-f-sec">
            {T.newItem.section}
            <select
              className="ox-rps-select"
              value={section}
              disabled={p.locked}
              onChange={(e) => setSection(e.target.value)}
            >
              {CATALOG_SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="ox-rps-field ox-rc-f-unit">
            {T.newItem.unit}
            <select
              className="ox-rps-select"
              value={unit}
              disabled={p.locked}
              onChange={(e) => setUnit(e.target.value as S['RepairUnit'])}
            >
              {PRICE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {unitRu(u)}
                </option>
              ))}
            </select>
          </label>
          <label className="ox-rps-field ox-rc-f-price">
            {T.newItem.price}
            <input
              className="ox-rps-input"
              data-num=""
              inputMode="decimal"
              value={price}
              disabled={p.locked}
              onChange={(e) => {
                setPriceIn(e.target.value);
                setErr(null);
              }}
            />
          </label>
          <button
            type="button"
            className="ox-rps-btn"
            data-variant="primary"
            data-size="lg"
            disabled={p.locked || busy}
            onClick={() => void add()}
          >
            <Icon name="add" size={18} />
            {T.newItem.add}
          </button>
        </div>
        {err ? (
          <span role="alert" className="ox-rps-alert">
            {err}
          </span>
        ) : null}
        <span className="ox-rps-sub">{T.newItem.hint}</span>
      </div>
    </>
  );
}
