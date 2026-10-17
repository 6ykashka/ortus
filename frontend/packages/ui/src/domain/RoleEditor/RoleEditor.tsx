import { type ReactElement, useState } from 'react';
import type { RoleCatalog, RoleCatalogVerb, RoleDraft, RoleEditorProps } from '../../types';
import { Icon } from '../../core/Icon';
import { roleEditorLabels as L } from './labels';
import styles from './RoleEditor.module.css';

type Module = RoleCatalog['modules'][number];

const normal = (m: Module): RoleCatalogVerb[] => m.verbs.filter((v) => !v.restricted);

const without = (rec: Record<string, string[]>, key: string): Record<string, string[]> =>
  Object.fromEntries(Object.entries(rec).filter(([k]) => k !== key));

/**
 * Новый черновик с действиями модуля `key` (пустой список — модуль убирается); `partial` — новые частичные
 * уровни модуля (без него частичные уровни не меняются).
 */
function withActions(
  role: RoleDraft,
  key: string,
  verbs: string[],
  partial?: readonly string[],
): RoleDraft {
  const actions = without(role.actions, key);
  if (verbs.length) actions[key] = verbs;
  if (partial === undefined || role.partial === undefined) return { ...role, actions };
  const nextPartial = without(role.partial, key);
  if (partial.length) nextPartial[key] = [...partial];
  return { ...role, actions, partial: nextPartial };
}

interface RowProps {
  m: Module;
  role: RoleDraft;
  open: boolean;
  readOnly: boolean;
  onToggleOpen: () => void;
  onOpen: () => void;
  onChange: (role: RoleDraft) => void;
}

/** Строка модуля: иконка, название, итог, раскрытие, переключатель и уровни (:354–363, :3176–3192). */
function ModuleRow({
  m,
  role,
  open,
  readOnly,
  onToggleOpen,
  onOpen,
  onChange,
}: RowProps): ReactElement {
  const own = role.actions[m.key] ?? [];
  const partial = role.partial?.[m.key] ?? [];
  const levels = normal(m);
  // Уровень с любым выданным действием (целиком или частично) — «{k} из {M}», k ≥ 1 у включённого модуля (:3182).
  const granted = levels.filter((v) => own.includes(v.key) || partial.includes(v.key));
  const on = granted.length > 0;
  const off = !m.on;
  const note = off ? L.moduleOff : on ? L.moduleOn(granted.length, levels.length) : L.noAccess;

  const toggle = () => {
    const restricted = own.filter((k) => m.verbs.some((v) => v.restricted && v.key === k));
    if (on) {
      onChange(withActions(role, m.key, restricted, []));
      return;
    }
    const first = levels.find((v) => v.key === 'view') ?? levels[0];
    onChange(withActions(role, m.key, first ? [...restricted, first.key] : restricted, []));
    onOpen();
  };

  // Отметка частичного уровня дополняет его: уровень переходит из `partial` в `actions`.
  const toggleVerb = (key: string) => {
    const next = own.includes(key) ? own.filter((k) => k !== key) : [...own, key];
    onChange(
      withActions(
        role,
        m.key,
        next,
        partial.filter((k) => k !== key),
      ),
    );
  };

  return (
    <div className={styles.row} data-module={m.key}>
      <div className={styles.head}>
        {m.icon ? (
          <Icon name={m.icon} size={20} className={styles.icon} />
        ) : (
          <span className={styles.icon} />
        )}
        <div className={styles.title} data-off={off ? '' : undefined}>
          <span className={styles.name}>{m.name}</span>
          <span className={styles.note}>{note}</span>
        </div>
        {on ? (
          <button
            type="button"
            className={styles.expand}
            aria-expanded={open}
            aria-label={L.expand(open, m.name)}
            onClick={onToggleOpen}
          >
            <Icon name={open ? 'expand_less' : 'expand_more'} size={22} />
          </button>
        ) : null}
        <button
          type="button"
          role="switch"
          className={styles.switch}
          aria-checked={on}
          aria-label={L.switch(m.name)}
          disabled={off || readOnly}
          onClick={toggle}
        >
          <span className={styles.knob} />
        </button>
      </div>
      {open && on ? (
        <fieldset className={styles.verbs}>
          <legend className={styles.srOnly}>{m.name}</legend>
          {levels.map((v) => {
            const checked = own.includes(v.key);
            const some = !checked && partial.includes(v.key);
            return (
              <label
                key={v.key}
                className={styles.verb}
                title={v.perms.join(', ')}
                data-checked={checked || some ? '' : undefined}
              >
                <input
                  type="checkbox"
                  ref={(el) => {
                    if (el) el.indeterminate = some;
                  }}
                  checked={checked}
                  disabled={readOnly}
                  onChange={() => toggleVerb(v.key)}
                />
                {v.label}
              </label>
            );
          })}
        </fieldset>
      ) : null}
    </div>
  );
}

/**
 * Редактор роли (02-company §6.7; Ортус CRM.dc.html:347–372): название, блоки системной роли и функции
 * «Водитель», модули — переключатель, итог «{k} из {M} действий», раскрытие уровней; `restricted` уровни —
 * блок «Финансовые разрешения» с ключами. Подвал «Сохранить роль» и «Итоговые права роли» рисует страница.
 * Группы — `fieldset` + `legend` (контракт W0.10): «Модули и действия» (легенда с заголовком h3), действия модуля
 * (легенда — имя модуля, скрыта от глаз), «Финансовые разрешения».
 */
export function RoleEditor({
  role,
  catalog,
  onChange,
  readOnly = false,
  driverBlocked = false,
  driverReason,
  initiallyOpen = [],
}: RoleEditorProps): ReactElement {
  const [openSet, setOpenSet] = useState<ReadonlySet<string>>(() => new Set(initiallyOpen));
  const system = role.system === true;
  const finance = catalog.modules.flatMap((m) =>
    m.verbs.filter((v) => v.restricted).map((v) => ({ m, v })),
  );
  const setOpen = (key: string, open: boolean) =>
    setOpenSet((s) => {
      const next = new Set(s);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });

  return (
    <div className={styles.editor}>
      <label className={styles.field}>
        {L.name}
        <input
          className={styles.input}
          value={role.name}
          disabled={system || readOnly}
          onChange={(e) => onChange({ ...role, name: e.target.value })}
        />
      </label>
      {system ? (
        <div className={styles.callout} data-tone="info">
          <Icon name="shield_person" size={20} />
          <span>{L.system}</span>
        </div>
      ) : null}
      {driverReason === 'role' ? (
        <div className={styles.callout} data-tone="warn">
          <Icon name="badge" size={20} />
          <span>{L.driver}</span>
        </div>
      ) : null}
      {system ? null : (
        <>
          <fieldset className={styles.modules}>
            <legend className={styles.legend}>
              <h3 className={styles.heading}>{L.modules}</h3>
            </legend>
            {catalog.modules.map((m) => (
              <ModuleRow
                key={m.key}
                m={m}
                role={role}
                open={openSet.has(m.key)}
                readOnly={readOnly}
                onToggleOpen={() => setOpen(m.key, !openSet.has(m.key))}
                onOpen={() => setOpen(m.key, true)}
                onChange={onChange}
              />
            ))}
          </fieldset>
          {finance.length ? (
            <fieldset className={styles.finance}>
              <legend className={styles.legend}>
                <span className={styles.financeHead}>
                  <Icon name="lock" size={20} className={styles.financeIcon} />
                  <strong>{L.finance}</strong>
                </span>
              </legend>
              <span className={styles.financeNote}>{L.financeNote}</span>
              {finance.map(({ m, v }) => {
                const own = role.actions[m.key] ?? [];
                const checked = own.includes(v.key);
                return (
                  <label key={`${m.key}:${v.key}`} className={styles.financeItem}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={driverBlocked || readOnly}
                      onChange={() =>
                        onChange(
                          withActions(
                            role,
                            m.key,
                            checked ? own.filter((k) => k !== v.key) : [...own, v.key],
                          ),
                        )
                      }
                    />
                    <span className={styles.financeText}>
                      <span>{v.label}</span>
                      <code className={styles.code}>{v.perms.join(', ')}</code>
                    </span>
                  </label>
                );
              })}
              {driverBlocked ? (
                <span className={styles.finNote}>
                  <Icon name="block" size={16} />
                  {driverReason === 'holder' ? L.finHolder : L.finRole}
                </span>
              ) : null}
            </fieldset>
          ) : null}
        </>
      )}
    </div>
  );
}
