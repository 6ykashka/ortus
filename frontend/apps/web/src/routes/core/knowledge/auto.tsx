// W4.32 · «Автоматизация» (М:258–280, autoVM М:712–721; руководитель): правила пространства с переключателем,
// «Проверить сроки сейчас», объекты раздела («Создать раздел» / «Открыть раздел»), «Журнал запусков».
// «Архив» (М:282–290, archVM М:723–726; редактор или руководитель): корни архивных веток и «Восстановить».
import { format, knowledge as K } from '@ortus/texts';
import { type ReactElement, useId, useRef } from 'react';

import { useApi } from '../../../app/api.tsx';
import { commands, useArchive, useRules, useRuns } from './api.ts';
import { useKb } from './ctx.tsx';
import { KIND_ICON, RUN_LOOK, type Space, stampOf } from './model.ts';
import { Failed, Glyph, Pending } from './parts.tsx';

export function AutoTab({ space }: { space: Space }): ReactElement {
  const api = useApi();
  const { tenantId, cmd, busy, go } = useKb();
  const rules = useRules(tenantId, space.id);
  const runs = useRuns(tenantId, space.id);
  const ids = useId();
  // Во время команды кнопки не disabled, а aria-disabled: фокус клавиатуры остаётся на нажатой (не уходит в body).
  const wait = busy ? { 'aria-disabled': true as const } : {};
  const send: typeof cmd = (fp, fn, okText) =>
    busy ? Promise.resolve({ ok: false }) : cmd(fp, fn, okText);
  return (
    <div className="ox-kb-tab-body ox-kb-auto">
      <div className="ox-kb-auto-rules">
        <strong className="ox-kb-auto-title">{K.auto.rules}</strong>
        {rules.isPending ? <Pending /> : null}
        {rules.isError ? <Failed q={rules} /> : null}
        {(rules.data ?? []).map((r) => (
          <div key={r.id} className="ox-kb-rule">
            <div className="ox-kb-rule-head">
              <span className="ox-kb-rule-names">
                <strong id={`${ids}-${r.id}`}>{r.name}</strong>
                <span className="ox-kb-rule-trigger">
                  <Glyph name="bolt" size={15} />
                  {r.trigger}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                className="ox-kb-switch"
                aria-checked={r.enabled ? 'true' : 'false'}
                aria-label={K.auto.switchAria}
                aria-describedby={`${ids}-${r.id}`}
                {...wait}
                onClick={() =>
                  void send(
                    { op: 'rule', rule: r.id, enabled: !r.enabled },
                    (key) => commands.setRule(api, tenantId, r.id, !r.enabled, key),
                    r.enabled ? K.toast.ruleOff : K.toast.ruleOn,
                  )
                }
              >
                <span />
              </button>
            </div>
            <span className="ox-kb-rule-note">{K.auto.notes[r.kind]}</span>
            {r.kind === 'review' ? (
              <button
                type="button"
                className="ox-kb-btn"
                data-size="sm"
                data-start=""
                disabled={!r.enabled}
                {...wait}
                onClick={() =>
                  void send(
                    // Отпечаток без времени: повтор после «нет связи» — тот же ключ (бриф §4); после ответа ключ
                    // отработан (ctx.tsx, keys.settle) — следующая проверка уходит с новым.
                    { op: 'review-check', space: space.id },
                    (key) => commands.reviewCheck(api, tenantId, space.id, key),
                    K.toast.checked,
                  )
                }
              >
                {K.auto.checkNow}
              </button>
            ) : null}
            {r.kind === 'section' && r.objects?.length ? (
              <div className="ox-kb-objects">
                {r.objects.map((o) => (
                  <div key={o.projectId} className="ox-kb-object">
                    <span className="ox-kb-object-text">
                      <strong>{o.name}</strong>
                      <span>
                        {o.foremanName
                          ? format(K.auto.objectForeman, {
                              stage: o.stage ?? '',
                              name: o.foremanName,
                            })
                          : format(K.auto.objectNoForeman, { stage: o.stage ?? '' })}
                      </span>
                    </span>
                    {o.sectionNodeId ? (
                      <button
                        type="button"
                        className="ox-kb-link-btn"
                        onClick={() => go({ space: space.id, page: o.sectionNodeId ?? '' })}
                      >
                        {K.auto.openSection}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ox-kb-btn"
                        data-size="xs"
                        disabled={!r.enabled}
                        {...wait}
                        onClick={() =>
                          void send(
                            { op: 'section', space: space.id, project: o.projectId },
                            (key) => commands.runSection(api, tenantId, space.id, o.projectId, key),
                            K.toast.sectionCreated,
                          )
                        }
                      >
                        {K.auto.createSection}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
        {rules.data ? (
          <span className="ox-kb-auto-foot">
            <Glyph name="info" size={16} />
            {K.auto.footer}
          </span>
        ) : null}
      </div>
      <div className="ox-kb-runs">
        <strong className="ox-kb-auto-title">{K.auto.runs}</strong>
        <div className="ox-kb-runs-list">
          {runs.isPending ? <Pending /> : null}
          {runs.isError ? <Failed q={runs} /> : null}
          {(runs.data ?? []).map((r) => (
            <div key={r.id} className="ox-kb-run">
              <Glyph name={RUN_LOOK[r.result].icon} size={19} className={`ox-kb-run-${r.result}`} />
              <span>
                <span className="ox-kb-run-text">{r.text}</span>
                <span className="ox-kb-run-at">{stampOf(r.at)}</span>
              </span>
            </div>
          ))}
          {runs.data && !runs.data.length ? (
            <span className="ox-kb-empty">{K.auto.noRuns}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ArchiveTab({ space }: { space: Space }): ReactElement {
  const api = useApi();
  const { tenantId, cmd, busy } = useKb();
  const items = useArchive(tenantId, space.id, true);
  const list = useRef<HTMLDivElement | null>(null);
  // Во время команды — aria-disabled (фокус остаётся на нажатой); после «Восстановить» строка уходит из списка —
  // фокус на «Восстановить» следующей строки (или предыдущей), без строк — на список «В архиве ничего нет».
  const restore = async (nodeId: string, i: number): Promise<void> => {
    if (busy) return;
    const r = await cmd(
      { op: 'restore', node: nodeId },
      (key) => commands.restore(api, tenantId, nodeId, key),
      K.toast.unarchived,
    );
    if (!r.ok) return;
    setTimeout(() => {
      const box = list.current;
      if (!box || (document.activeElement && box.contains(document.activeElement))) return;
      const btns = box.querySelectorAll<HTMLElement>('.ox-kb-arch-row button');
      (btns[Math.min(i, btns.length - 1)] ?? box).focus({ preventScroll: true });
    }, 0);
  };
  return (
    <div className="ox-kb-tab-body ox-kb-arch">
      <span className="ox-kb-arch-intro">{K.archive.intro}</span>
      <div ref={list} className="ox-kb-arch-list" tabIndex={-1}>
        {items.isPending ? <Pending /> : null}
        {items.isError ? <Failed q={items} /> : null}
        {(items.data ?? []).map((x, i) => (
          <div key={x.nodeId} className="ox-kb-arch-row">
            <Glyph name={KIND_ICON[x.kind]} size={19} />
            <span className="ox-kb-arch-text">
              <strong>{x.title}</strong>
              <span>{format(K.archive.branch, { n: x.pages })}</span>
            </span>
            <button
              type="button"
              className="ox-kb-btn"
              data-size="sm"
              data-weight="medium"
              {...(busy ? { 'aria-disabled': true as const } : {})}
              onClick={() => void restore(x.nodeId, i)}
            >
              {K.archive.restore}
            </button>
          </div>
        ))}
        {items.data && !items.data.length ? (
          <span className="ox-kb-empty">{K.archive.empty}</span>
        ) : null}
      </div>
    </div>
  );
}
