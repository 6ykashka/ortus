// W1.54 · Страница «Структура» (`company-structure`, S1-08; no-reference B-6, design-requests.md «company-structure ·
// перенос»; в эталоне регионы и фирмы только читаются). Собрана на @ortus/ui, как другие no-reference экраны этапа:
// дерево регион → фирма → подразделение (listOrgUnits), создание узла, переименование и перенос с предпросмотром
// влияния на доступ (dialogs.tsx). Команды — владельцу и сотруднику с org_units.manage; в режиме только чтения
// недоступны (Q-W1.54-7, Q-W1.54-8).
import type { components } from '@ortus/api-client';
import { company, errors, format, shell } from '@ortus/texts';
import { Banner, Button, EmptyState, Icon, Skeleton, Status } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { useCan, useShell } from '../../../shell/context.tsx';
import { problemText } from '../../../shell/run.tsx';
import { useRoleNames, useUnits } from './api.ts';
import { CreateDialog, MoveDialog, RenameDialog } from './dialogs.tsx';
import {
  buildTree,
  commandsFor,
  flatten,
  type Kind,
  kindLabel,
  type ManageScope,
  manageScope,
  mayManage,
  type TreeNode,
} from './model.ts';
import { STRUCTURE_TEXT as T } from './texts.ts';
import './structure.css';

type OrgUnit = components['schemas']['OrgUnit'];

type Open =
  | { kind: 'create'; parent: OrgUnit | null }
  | { kind: 'rename'; unit: OrgUnit }
  | { kind: 'move'; unit: OrgUnit };

const ICON: Record<Kind, string> = {
  region: 'public',
  company: 'domain',
  branch: 'warehouse',
  team: 'groups',
};

interface Actions {
  /** Где есть org_units.manage: команды узла — по `commandsFor`, без права — кнопок нет. */
  scope: ManageScope;
  /** Организация только для чтения: кнопки есть, но недоступны. */
  locked: boolean;
  open: (o: Open) => void;
}

function Node({ node, actions }: { node: TreeNode; actions: Actions }): ReactElement {
  const u = node.unit;
  const active = u.status === 'active';
  const named = (tpl: string) => format(tpl, { name: u.name });
  const cmd = active ? commandsFor(actions.scope, u) : null;
  return (
    <li className="ox-str-node">
      <div
        className="ox-str-row"
        data-depth={Math.min(node.depth, 4)}
        data-archived={active ? undefined : ''}
      >
        <span className="ox-str-label">
          <Icon name={ICON[u.kind]} size={20} />
          <span className="ox-str-name">{u.name}</span>
          <Status tone="neutral">{kindLabel(u.kind)}</Status>
          {active ? null : <Status tone="warn">{T.archived}</Status>}
        </span>
        {cmd && (cmd.add || cmd.rename || cmd.move) ? (
          <span className="ox-str-actions">
            {cmd.add ? (
              <Button
                variant="ghost"
                icon="add"
                disabled={actions.locked}
                aria-label={named(T.actions.addTo)}
                onPress={() => actions.open({ kind: 'create', parent: u })}
              >
                {T.actions.add}
              </Button>
            ) : null}
            {cmd.rename ? (
              <Button
                variant="ghost"
                icon="edit"
                disabled={actions.locked}
                aria-label={named(T.actions.renameNamed)}
                onPress={() => actions.open({ kind: 'rename', unit: u })}
              >
                {T.actions.rename}
              </Button>
            ) : null}
            {cmd.move ? (
              <Button
                variant="ghost"
                icon="drive_file_move"
                disabled={actions.locked}
                aria-label={named(T.actions.moveNamed)}
                onPress={() => actions.open({ kind: 'move', unit: u })}
              >
                {T.actions.move}
              </Button>
            ) : null}
          </span>
        ) : null}
      </div>
      {node.children.length > 0 ? (
        <ul className="ox-str-children">
          {node.children.map((c) => (
            <Node key={c.unit.id} node={c} actions={actions} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export default function StructurePage(): ReactElement {
  const { tenant, tenantId: id, audience, readOnly, nav } = useShell();
  const tenantId = id ?? '';
  const can = useCan();
  const owner = audience === 'owner';
  const units = useUnits(tenantId);
  const [open, setOpen] = useState<Open | null>(null);
  const list = units.data ?? [];
  // Право изменения с областью (Q-W1.54-12): верхний уровень — только с правом на всю организацию.
  const scope = manageScope(owner, nav.capabilities, list);
  const manage = scope.any;
  const top = mayManage(scope, null);
  const roles = useRoleNames(tenantId, manage && (owner || can('roles.read')));
  const actions: Actions = { scope, locked: readOnly, open: setOpen };
  const roots = buildTree(list);
  const commandable =
    !readOnly &&
    flatten(roots).some((n) => n.unit.status === 'active' && mayManage(scope, n.unit.id));
  const addRoot = (): void => setOpen({ kind: 'create', parent: null });

  let body: ReactElement;
  if (units.isPending) {
    body = <Skeleton lines={6} label={shell.a11y.loading} />;
  } else if (units.isError) {
    body = (
      <Banner
        tone="danger"
        title={format(T.loadFailed, { error: problemText(units.error) })}
        action={{ label: T.retry, onPress: () => void units.refetch() }}
      />
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState
        icon="account_tree"
        title={T.empty.title}
        text={T.empty.text}
        dashed
        {...(top
          ? {
              action: {
                label: T.actions.addRoot,
                icon: 'add',
                onPress: addRoot,
                disabled: readOnly,
              },
            }
          : {})}
      />
    );
  } else {
    // Без доступных команд (только чтение, нет права изменения) в дереве нет ни одной цели Tab, а #ox-main
    // прокручивается: дерево само становится целью фокуса — с клавиатуры его можно прокрутить и прочитать (axe
    // scrollable-region-focusable, возврат 1 доделки №2). Команды остаются кнопками @ortus/ui (disabled).
    body = (
      <ul className="ox-str-tree" aria-label={T.treeLabel} tabIndex={commandable ? undefined : 0}>
        {roots.map((n) => (
          <Node key={n.unit.id} node={n} actions={actions} />
        ))}
      </ul>
    );
  }

  return (
    <section aria-labelledby="h-str" className="ox-str">
      <div className="ox-str-head">
        <div className="ox-str-heading">
          <div className="ox-str-crumb">
            {format(company.crumbs.company, { tenant: tenant?.name ?? '' })}
          </div>
          <h1 id="h-str" className="ox-str-title" tabIndex={-1}>
            {T.title}
          </h1>
          <p className="ox-str-intro">{T.intro}</p>
        </div>
        {top ? (
          <span className="ox-str-tools">
            <Button icon="add" disabled={readOnly} onPress={addRoot}>
              {T.actions.addRoot}
            </Button>
          </span>
        ) : null}
      </div>
      {readOnly ? <Banner tone="warn" title={errors.problem.tenant_read_only} /> : null}
      {manage ? null : <Banner tone="info" title={T.noManage} />}
      {body}
      {open?.kind === 'create' ? (
        <CreateDialog
          tenantId={tenantId}
          parent={open.parent}
          units={list}
          onClose={() => setOpen(null)}
        />
      ) : null}
      {open?.kind === 'rename' ? (
        <RenameDialog tenantId={tenantId} unit={open.unit} onClose={() => setOpen(null)} />
      ) : null}
      {open?.kind === 'move' ? (
        <MoveDialog
          tenantId={tenantId}
          unit={open.unit}
          units={list}
          roles={roles.data ?? new Map()}
          allowed={(target) => mayManage(scope, target)}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </section>
  );
}
