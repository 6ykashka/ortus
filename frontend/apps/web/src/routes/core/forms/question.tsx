// W4.22 · Карточка выбранного вопроса (dc:182–266, qeVM dc:839–879): тип (21 активный и два недоступных), «Вопрос
// выше / ниже», меню («Дублировать», «Сделать скрытым / Показывать вопрос», «Удалить»), «Свернуть вопрос», заметки о
// смене типа и текста, скрытый вопрос, текст, «Обязательный», пояснение, значение по умолчанию, варианты (вид, баллы,
// ключ, «Другое»), шкала, настройки по типу, идентификатор, условие показа «И / ИЛИ».
import { format, forms as F } from '@ortus/texts';
import type { ReactElement } from 'react';

import type { SetBuilder, BuilderState } from './builder.tsx';
import { useForms } from './ctx.tsx';
import type { EditorModel } from './editor.tsx';
import {
  addCondition,
  addOption,
  changeType,
  condSources,
  condValues,
  CRM,
  deleteQuestion,
  duplicateQuestion,
  idError,
  isOff,
  moveQuestion,
  NUM,
  OPTS,
  type Question,
  type QType,
  removeOption,
  renameKey,
  setConditions,
  setOption,
  setQ,
  TXT,
  TYPE_KEYS,
  typeInfo,
} from './model.ts';
import { Glyph, Menu } from './parts.tsx';

const rnd = (): string => Math.random().toString(36).slice(2, 6);
const SCALE_MAXES = [3, 4, 5, 6, 7, 8, 9, 10];
/** Ввод числа (num dc:842): цифры, точка, запятая и минус. */
const numText = (v: string): string => v.replace(/[^\d.,-]/g, '');
/** Целое из ввода; пусто или не число — нет значения. */
const intOf = (v: string): number | undefined => {
  const s = v.replace(/[^\d-]/g, '');
  if (!s || s === '-') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export function QuestionEditor({
  m,
  x,
  state,
  setState,
}: {
  m: EditorModel;
  x: Question;
  state: BuilderState;
  setState: SetBuilder;
}): ReactElement {
  const { menu, setMenu } = useForms();
  const d = m.def;
  const ro = !m.canEdit;
  const i = d.fields.findIndex((y) => y.key === x.key);
  const t = typeInfo(x.type);
  const o = m.prev.get(x.key);
  const set = (p: Partial<Record<keyof Question, unknown>>) =>
    m.draft.edit((dd) => setQ(dd, x.key, p));
  const srcs = condSources(d, x.key);
  const c = x.showIf ?? { mode: 'all' as const, conditions: [] };
  const typeChanged = !!o && o.type !== x.type;
  const idLocked = m.inVersions.has(x.key) || ro;
  const idTxt = state.idTxt?.key === x.key ? state.idTxt : null;
  const statement = x.type === 'statement';
  const quiz = m.form.settings.scoring;
  const C = F.builder.card;

  const onId = (text: string) => {
    const err = idError(d, x, text);
    if (err) {
      setState((s) => ({ ...s, idTxt: { key: x.key, text, err } }));
      return;
    }
    const to = text.trim();
    m.draft.edit((dd) => renameKey(dd, x.key, to));
    setState((s) => ({ ...s, idTxt: null, sel: to }));
  };

  const menuItems = [
    {
      label: C.menuItems.duplicate,
      icon: 'content_copy',
      onClick: () => {
        setMenu(null);
        let nkey = '';
        m.draft.edit((dd) => {
          const r = duplicateQuestion(dd, x.key, rnd());
          nkey = r.key;
          return r.def;
        });
        setState((s) => ({ ...s, sel: nkey || s.sel }));
      },
    },
    {
      label: x.hidden ? C.menuItems.show : C.menuItems.hide,
      icon: x.hidden ? 'visibility' : 'visibility_off',
      onClick: () => {
        set({ hidden: x.hidden ? undefined : true });
        setMenu(null);
      },
    },
    {
      label: C.menuItems.remove,
      icon: 'delete',
      danger: true,
      onClick: () => {
        setMenu(null);
        const r = deleteQuestion(d, x.key);
        m.draft.edit(() => r.def);
        setState((s) => ({ ...s, undo: r.undo, sel: null }));
      },
    },
  ];

  const lenTitle = TXT.includes(x.type) ? C.length : C.range;
  const minVal = TXT.includes(x.type) ? x.minLength : x.minValue;
  const maxVal = TXT.includes(x.type) ? x.maxLength : x.maxValue;
  const setRange = (k: 'min' | 'max', v: string) => {
    if (TXT.includes(x.type)) set({ [k === 'min' ? 'minLength' : 'maxLength']: intOf(v) });
    else {
      const s = numText(v);
      set({ [k === 'min' ? 'minValue' : 'maxValue']: s || undefined });
    }
  };

  return (
    <div className="ox-fm-qe">
      <div className="ox-fm-qe-top">
        <span className="ox-fm-q-icon" aria-hidden="true" style={{ background: t.bg, color: t.fg }}>
          <Glyph name={t.icon} size={18} />
        </span>
        <select
          className="ox-fm-qe-type"
          value={x.type}
          disabled={ro}
          aria-label={C.typeAria}
          onChange={(e) =>
            m.draft.edit((dd) => ({
              ...dd,
              fields: dd.fields.map((y) =>
                y.key === x.key ? changeType(y, e.target.value as QType) : y,
              ),
            }))
          }
        >
          {TYPE_KEYS.map((k) => (
            <option key={k} value={k} disabled={isOff(k)}>
              {isOff(k) ? format(C.unavailable, { label: typeInfo(k).label }) : typeInfo(k).label}
            </option>
          ))}
        </select>
        <span className="ox-fm-fill" />
        {!ro ? (
          <>
            <button
              type="button"
              className="ox-fm-icon-btn"
              data-size="32"
              disabled={i === 0}
              aria-label={C.up}
              onClick={() => m.draft.edit((dd) => moveQuestion(dd, x.key, -1))}
            >
              <Glyph name="arrow_upward" size={18} />
            </button>
            <button
              type="button"
              className="ox-fm-icon-btn"
              data-size="32"
              disabled={i === d.fields.length - 1}
              aria-label={C.down}
              onClick={() => m.draft.edit((dd) => moveQuestion(dd, x.key, 1))}
            >
              <Glyph name="arrow_downward" size={18} />
            </button>
            <div className="ox-fm-anchor">
              <button
                type="button"
                className="ox-fm-icon-btn"
                data-size="32"
                aria-label={C.menu}
                aria-expanded={menu === 'q'}
                onClick={() => setMenu(menu === 'q' ? null : 'q')}
              >
                <Glyph name="more_horiz" size={18} />
              </button>
              {menu === 'q' ? (
                <Menu className="ox-fm-menu-q" items={menuItems} onClose={() => setMenu(null)} />
              ) : null}
            </div>
          </>
        ) : null}
        <button
          type="button"
          className="ox-fm-icon-btn"
          data-size="32"
          aria-label={C.collapse}
          onClick={() => {
            setMenu(null);
            setState((s) => ({ ...s, sel: null }));
          }}
        >
          <Glyph name="expand_less" size={20} />
        </button>
      </div>
      {o && (typeChanged || o.label !== x.label) ? (
        <div className="ox-fm-note" data-tone={typeChanged ? 'warn' : 'info'}>
          <Glyph name="info" size={18} />
          <span>
            {typeChanged ? format(C.noteType, { type: typeInfo(o.type).label }) : C.noteText}
          </span>
        </div>
      ) : null}
      {x.hidden ? (
        <div className="ox-fm-note" data-tone="neutral">
          <Glyph name="visibility_off" size={18} />
          <span>{format(C.hiddenNote, { id: x.key })}</span>
        </div>
      ) : null}
      <div className="ox-fm-qe-grid">
        <span className="ox-fm-qe-cap">{statement ? C.text : C.question}</span>
        <div className="ox-fm-qe-col">
          <textarea
            rows={2}
            value={x.label}
            maxLength={500}
            disabled={ro}
            placeholder={statement ? C.placeholderStatement : C.placeholder}
            aria-label={statement ? C.text : C.question}
            onChange={(e) => set({ label: e.target.value })}
          />
          {!statement ? (
            <label className="ox-fm-check">
              <input
                type="checkbox"
                checked={x.required}
                disabled={ro}
                onChange={(e) => set({ required: e.target.checked })}
              />
              {C.requiredLabel}
            </label>
          ) : null}
          {x.hint !== undefined ? (
            <input
              className="ox-fm-input"
              value={x.hint}
              maxLength={1000}
              disabled={ro}
              placeholder={C.hintPlaceholder}
              aria-label={C.hintAria}
              onChange={(e) => set({ hint: e.target.value })}
            />
          ) : null}
          {x.defaultValue !== undefined ? (
            <input
              className="ox-fm-input"
              value={x.defaultValue}
              maxLength={500}
              disabled={ro}
              placeholder={C.defaultLabel}
              aria-label={C.defaultLabel}
              onChange={(e) => set({ defaultValue: e.target.value })}
            />
          ) : null}
          {!ro ? (
            <div className="ox-fm-qe-toggles">
              {!statement ? (
                <button
                  type="button"
                  className="ox-fm-link-btn"
                  onClick={() => set({ hint: x.hint !== undefined ? undefined : '' })}
                >
                  <Glyph name="notes" size={17} />
                  {x.hint !== undefined ? C.hintRemove : C.hintAdd}
                </button>
              ) : null}
              {!['photo', 'statement', 'multi'].includes(x.type) ? (
                <button
                  type="button"
                  className="ox-fm-link-btn"
                  onClick={() =>
                    set({ defaultValue: x.defaultValue !== undefined ? undefined : '' })
                  }
                >
                  <Glyph name="input" size={17} />
                  {x.defaultValue !== undefined ? C.defaultRemove : C.defaultLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {OPTS.includes(x.type) ? (
          <>
            <span className="ox-fm-qe-cap" data-top="6">
              {C.answers}
            </span>
            <div className="ox-fm-qe-col">
              {x.type === 'choice' || x.type === 'multi' ? (
                <div role="group" aria-label={C.viewsAria} className="ox-fm-seg">
                  {(['list', 'tiles', 'row'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={(x.optionView ?? 'list') === k}
                      disabled={ro}
                      onClick={() => set({ optionView: k === 'list' ? undefined : k })}
                    >
                      {C.views[k]}
                    </button>
                  ))}
                </div>
              ) : null}
              {(x.options ?? []).map((op, oi) => (
                <div key={op.key} className="ox-fm-opt">
                  <Glyph
                    name={
                      x.type === 'multi'
                        ? 'check_box_outline_blank'
                        : x.type === 'select'
                          ? 'arrow_right'
                          : 'radio_button_unchecked'
                    }
                    size={20}
                    className="ox-fm-opt-icon"
                  />
                  <input
                    className="ox-fm-input ox-fm-opt-label"
                    value={op.label}
                    maxLength={300}
                    disabled={ro}
                    aria-label={format(C.option, { n: oi + 1 })}
                    onChange={(e) =>
                      m.draft.edit((dd) => setOption(dd, x.key, oi, { label: e.target.value }))
                    }
                  />
                  {quiz ? (
                    <label className="ox-fm-score">
                      <input
                        inputMode="numeric"
                        value={op.score !== undefined ? String(op.score) : ''}
                        disabled={ro}
                        placeholder="0"
                        aria-label={format(C.pointsAria, { n: oi + 1 })}
                        onChange={(e) =>
                          m.draft.edit((dd) =>
                            setOption(dd, x.key, oi, { score: intOf(e.target.value) as number }),
                          )
                        }
                      />
                      {C.points}
                    </label>
                  ) : null}
                  <span className="ox-fm-opt-id" title={C.optionId}>
                    {op.key}
                  </span>
                  {!ro ? (
                    <button
                      type="button"
                      className="ox-fm-icon-btn"
                      data-size="32"
                      data-danger=""
                      disabled={(x.options ?? []).length < 2}
                      aria-label={format(C.optionDelete, { n: oi + 1 })}
                      onClick={() => m.draft.edit((dd) => removeOption(dd, x.key, oi))}
                    >
                      <Glyph name="close" size={18} />
                    </button>
                  ) : null}
                </div>
              ))}
              {!ro ? (
                <div className="ox-fm-opt-add">
                  <button
                    type="button"
                    className="ox-fm-link-btn"
                    data-accent=""
                    onClick={() => m.draft.edit((dd) => addOption(dd, x.key))}
                  >
                    <Glyph name="add" size={18} />
                    {C.addOption}
                  </button>
                  {x.type === 'choice' || x.type === 'multi' ? (
                    <label className="ox-fm-check">
                      <input
                        type="checkbox"
                        checked={!!x.otherOption}
                        onChange={(e) => set({ otherOption: e.target.checked || undefined })}
                      />
                      {C.other}
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        {x.type === 'scale' ? (
          <>
            <span className="ox-fm-qe-cap">{C.scale}</span>
            <div className="ox-fm-qe-row">
              <label className="ox-fm-inline">
                {C.from}
                <select
                  className="ox-fm-small-select"
                  value={String(x.scaleMin ?? 1)}
                  disabled={ro}
                  onChange={(e) => set({ scaleMin: Number(e.target.value) })}
                >
                  <option value="0">0</option>
                  <option value="1">1</option>
                </select>
              </label>
              <label className="ox-fm-inline">
                {C.to}
                <select
                  className="ox-fm-small-select"
                  value={String(x.scaleMax ?? 5)}
                  disabled={ro}
                  onChange={(e) => set({ scaleMax: Number(e.target.value) })}
                >
                  {SCALE_MAXES.map((n) => (
                    <option key={n} value={String(n)}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <input
                className="ox-fm-input ox-fm-grow"
                value={x.scaleLeftLabel ?? ''}
                maxLength={100}
                disabled={ro}
                placeholder={C.left}
                aria-label={C.left}
                onChange={(e) => set({ scaleLeftLabel: e.target.value || undefined })}
              />
              <input
                className="ox-fm-input ox-fm-grow"
                value={x.scaleRightLabel ?? ''}
                maxLength={100}
                disabled={ro}
                placeholder={C.right}
                aria-label={C.right}
                onChange={(e) => set({ scaleRightLabel: e.target.value || undefined })}
              />
            </div>
          </>
        ) : null}
        <span className="ox-fm-qe-cap">{C.settings}</span>
        <div className="ox-fm-qe-col" data-gap="10">
          {TXT.includes(x.type) || NUM.includes(x.type) ? (
            <div className="ox-fm-qe-row">
              <span className="ox-fm-qe-key">{lenTitle}</span>
              <input
                className="ox-fm-input ox-fm-num"
                inputMode="decimal"
                value={minVal === undefined ? '' : String(minVal)}
                disabled={ro}
                placeholder={C.min}
                aria-label={C.min}
                onChange={(e) => setRange('min', e.target.value)}
              />
              <span>—</span>
              <input
                className="ox-fm-input ox-fm-num"
                inputMode="decimal"
                value={maxVal === undefined ? '' : String(maxVal)}
                disabled={ro}
                placeholder={C.max}
                aria-label={C.max}
                onChange={(e) => setRange('max', e.target.value)}
              />
            </div>
          ) : null}
          {x.type === 'multi' ? (
            <div className="ox-fm-qe-row">
              <span className="ox-fm-qe-key">{C.selectCount}</span>
              <input
                className="ox-fm-input ox-fm-num"
                inputMode="numeric"
                value={x.minSelected === undefined ? '' : String(x.minSelected)}
                disabled={ro}
                placeholder={C.min}
                aria-label={C.minSel}
                onChange={(e) => set({ minSelected: intOf(e.target.value) })}
              />
              <span>—</span>
              <input
                className="ox-fm-input ox-fm-num"
                inputMode="numeric"
                value={x.maxSelected === undefined ? '' : String(x.maxSelected)}
                disabled={ro}
                placeholder={C.max}
                aria-label={C.maxSel}
                onChange={(e) => set({ maxSelected: intOf(e.target.value) })}
              />
            </div>
          ) : null}
          {OPTS.includes(x.type) ? (
            <label className="ox-fm-qe-row">
              <span className="ox-fm-qe-key">{C.order}</span>
              <select
                className="ox-fm-select ox-fm-qe-select"
                value={x.optionOrder ?? 'as_is'}
                disabled={ro}
                onChange={(e) =>
                  set({ optionOrder: e.target.value === 'as_is' ? undefined : e.target.value })
                }
              >
                <option value="as_is">{C.orders.asIs}</option>
                <option value="alpha">{C.orders.alpha}</option>
                <option value="random">{C.orders.random}</option>
              </select>
            </label>
          ) : null}
          {x.type === 'date' ? (
            <label className="ox-fm-check">
              <input
                type="checkbox"
                checked={!!x.withTime}
                disabled={ro}
                onChange={(e) => set({ withTime: e.target.checked || undefined })}
              />
              {C.withTime}
            </label>
          ) : null}
          {x.type === 'photo' ? (
            <div className="ox-fm-qe-row">
              <select
                className="ox-fm-select ox-fm-qe-files"
                value={x.accept ?? 'photo'}
                disabled={ro}
                aria-label={C.filesAria}
                onChange={(e) => set({ accept: e.target.value })}
              >
                <option value="photo">{C.accept.photo}</option>
                <option value="docs">{C.accept.docs}</option>
                <option value="any">{C.accept.any}</option>
              </select>
              <label className="ox-fm-inline">
                {C.maxFiles}
                <input
                  className="ox-fm-input ox-fm-tiny"
                  inputMode="numeric"
                  value={String(x.maxFiles ?? 5)}
                  disabled={ro}
                  aria-label={C.maxFilesAria}
                  onChange={(e) => set({ maxFiles: intOf(e.target.value) })}
                />
                {C.files}
              </label>
              <label className="ox-fm-inline">
                {C.to}
                <input
                  className="ox-fm-input ox-fm-tiny"
                  inputMode="numeric"
                  value={String(x.maxFileMb ?? 20)}
                  disabled={ro}
                  aria-label={C.maxMbAria}
                  onChange={(e) => set({ maxFileMb: intOf(e.target.value) })}
                />
                {C.mb}
              </label>
            </div>
          ) : null}
          {x.type === 'unit' ? (
            <label className="ox-fm-qe-row">
              <span className="ox-fm-qe-key">{C.unitLevel}</span>
              <select
                className="ox-fm-select ox-fm-qe-select"
                value={x.unitLevel ?? 'any'}
                disabled={ro}
                onChange={(e) => set({ unitLevel: e.target.value })}
              >
                <option value="any">{C.unitLevels.any}</option>
                <option value="region">{C.unitLevels.region}</option>
                <option value="firm">{C.unitLevels.firm}</option>
              </select>
            </label>
          ) : null}
          {x.type === 'ref' ? (
            <label className="ox-fm-qe-row">
              <span className="ox-fm-qe-key">{C.refKind}</span>
              <select
                className="ox-fm-select ox-fm-qe-select"
                value={x.refKind ?? 'vehicle'}
                disabled={ro}
                onChange={(e) => set({ refKind: e.target.value })}
              >
                <option value="vehicle">{C.refKinds.vehicle}</option>
                <option value="trip">{C.refKinds.trip}</option>
                <option value="object">{C.refKinds.object}</option>
                <option value="task">{C.refKinds.task}</option>
              </select>
            </label>
          ) : null}
          {CRM.includes(x.type) ? <span className="ox-fm-crm-note">{C.crmNote}</span> : null}
          <label className="ox-fm-qe-row">
            <span className="ox-fm-qe-key">{C.id}</span>
            <input
              className="ox-fm-input ox-fm-id"
              value={idTxt ? idTxt.text : x.key}
              disabled={idLocked}
              aria-describedby={`fm-id-note-${x.key}`}
              onChange={(e) => onId(e.target.value)}
            />
          </label>
          <span id={`fm-id-note-${x.key}`} className="ox-fm-id-note">
            {m.inVersions.has(x.key) ? C.idLocked : C.idNote}
          </span>
          {idTxt?.err ? (
            <span role="alert" className="ox-fm-id-err">
              {idTxt.err}
            </span>
          ) : null}
        </div>
        <span className="ox-fm-qe-cap">{C.cond}</span>
        <div className="ox-fm-qe-col">
          {!c.conditions.length ? (
            <div className="ox-fm-qe-row" data-gap="cond">
              {!ro && srcs.length > 0 ? (
                <button
                  type="button"
                  className="ox-fm-btn"
                  data-size="36"
                  onClick={() => m.draft.edit((dd) => addCondition(dd, x.key))}
                >
                  <Glyph name="call_split" size={18} />
                  {C.condAdd}
                </button>
              ) : null}
              <span className="ox-fm-cond-hint">{srcs.length ? C.condHint : C.condNone}</span>
            </div>
          ) : (
            <>
              {c.conditions.length > 1 ? (
                <select
                  className="ox-fm-select ox-fm-cond-mode"
                  value={c.mode}
                  disabled={ro}
                  aria-label={C.condModeAria}
                  onChange={(e) =>
                    m.draft.edit((dd) =>
                      setConditions(dd, x.key, (cc) => {
                        cc.mode = e.target.value as 'all' | 'any';
                      }),
                    )
                  }
                >
                  <option value="all">{C.condModes.all}</option>
                  <option value="any">{C.condModes.any}</option>
                </select>
              ) : null}
              {c.conditions.map((k, ci) => {
                const src = d.fields.find((y) => y.key === k.fieldKey);
                const vals = condValues(src);
                return (
                  <div key={ci} className="ox-fm-cond">
                    <select
                      className="ox-fm-select ox-fm-cond-field"
                      value={k.fieldKey}
                      disabled={ro}
                      aria-label={C.condField}
                      onChange={(e) => {
                        const nv = condValues(d.fields.find((y) => y.key === e.target.value));
                        m.draft.edit((dd) =>
                          setConditions(dd, x.key, (cc) => {
                            const z = cc.conditions[ci];
                            if (!z) return;
                            z.fieldKey = e.target.value;
                            z.value = nv?.[0]?.[0] ?? '';
                          }),
                        );
                      }}
                    >
                      {srcs.map((y) => (
                        <option key={y.key} value={y.key}>
                          {y.label.trim() || typeInfo(y.type).label}
                        </option>
                      ))}
                      {!srcs.some((y) => y.key === k.fieldKey) ? (
                        <option value={k.fieldKey}>{src?.label.trim() || k.fieldKey}</option>
                      ) : null}
                    </select>
                    <select
                      className="ox-fm-select ox-fm-cond-op"
                      value={k.operator}
                      disabled={ro}
                      aria-label={C.condOp}
                      onChange={(e) =>
                        m.draft.edit((dd) =>
                          setConditions(dd, x.key, (cc) => {
                            const z = cc.conditions[ci];
                            if (z) z.operator = e.target.value as 'equals' | 'not_equals';
                          }),
                        )
                      }
                    >
                      <option value="equals">{C.ops.equals}</option>
                      <option value="not_equals">{C.ops.notEquals}</option>
                    </select>
                    {vals ? (
                      <select
                        className="ox-fm-select ox-fm-cond-value"
                        value={k.value}
                        disabled={ro}
                        aria-label={C.condValue}
                        onChange={(e) =>
                          m.draft.edit((dd) =>
                            setConditions(dd, x.key, (cc) => {
                              const z = cc.conditions[ci];
                              if (z) z.value = e.target.value;
                            }),
                          )
                        }
                      >
                        {vals.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="ox-fm-input ox-fm-cond-value"
                        value={k.value}
                        maxLength={500}
                        disabled={ro}
                        placeholder={C.valuePlaceholder}
                        aria-label={C.condValue}
                        onChange={(e) =>
                          m.draft.edit((dd) =>
                            setConditions(dd, x.key, (cc) => {
                              const z = cc.conditions[ci];
                              if (z) z.value = e.target.value;
                            }),
                          )
                        }
                      />
                    )}
                    {!ro ? (
                      <button
                        type="button"
                        className="ox-fm-icon-btn"
                        data-size="32"
                        data-danger=""
                        aria-label={C.condDelete}
                        onClick={() =>
                          m.draft.edit((dd) =>
                            setConditions(dd, x.key, (cc) => {
                              cc.conditions.splice(ci, 1);
                            }),
                          )
                        }
                      >
                        <Glyph name="close" size={18} />
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {!ro ? (
                <button
                  type="button"
                  className="ox-fm-link-btn"
                  data-accent=""
                  onClick={() => m.draft.edit((dd) => addCondition(dd, x.key))}
                >
                  <Glyph name="add" size={18} />
                  {C.condMore}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
