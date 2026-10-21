// W4.32 · «Участники и доступ» (М:199–256, peopleVM М:676–710): карточки ролей пространства (три роли — KB-02) и
// «По уровню «…»», руководителю — смена роли и «Убрать», «Добавить в пространство», карта доступа (страницы × до
// восьми сотрудников) и «Проверить сотрудника» (цепочка причин и итог). Участники — listKnowledgeSpaceMembers,
// сотрудники для добавления — кандидаты доступа главной страницы (listKnowledgeAccessCandidates, руководителю).
import type { components } from '@ortus/api-client';
import { format, knowledge as K } from '@ortus/texts';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useShell } from '../../../shell/context.tsx';
import { commands, useAccessMap, useCandidates, useExplain, useMembers } from './api.ts';
import { useKb } from './ctx.tsx';
import {
  avatarOf,
  CELL_LOOK,
  dayOf,
  homeOf,
  initialsOf,
  KIND_ICON,
  lowerFirst,
  mapGrid,
  type Space,
  STEP_LOOK,
  type TreeIndex,
  verdictOf,
} from './model.ts';
import { Failed, Glyph, Pending } from './parts.tsx';

type S = components['schemas'];
type Role = S['KnowledgeSpaceRole']['role'];

interface Person {
  key: string;
  name: string;
  src: string;
  /** Роль пространства — выбор «Роль в пространстве» руководителю. */
  role?: Role;
  memberId?: string;
  canChange: boolean;
}

function PersonRow({
  p,
  roleOpts,
  onRole,
}: {
  p: Person;
  roleOpts: { v: string; t: string }[];
  onRole: (memberId: string, role: Role | null) => void;
}): ReactElement {
  return (
    <div className="ox-kb-person">
      <span className="ox-kb-avatar" style={{ background: avatarOf(p.name) }}>
        {initialsOf(p.name)}
      </span>
      <span className="ox-kb-person-text">
        <span className="ox-kb-person-name">{p.name}</span>
        <span className="ox-kb-person-src">{p.src}</span>
      </span>
      {p.canChange && p.role && p.memberId ? (
        <select
          className="ox-kb-person-role"
          value={p.role}
          aria-label={K.people.roleAria}
          onChange={(e) => onRole(p.memberId ?? '', (e.target.value || null) as Role | null)}
        >
          {roleOpts.map((o) => (
            <option key={o.v} value={o.v}>
              {o.t}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

/** Карта доступа и «Проверить сотрудника» (М:226–253), руководителю. */
function AccessMap({ space, tree }: { space: Space; tree: TreeIndex }): ReactElement | null {
  const { tenantId, search } = useKb();
  const map = useAccessMap(tenantId, space.id, true);
  const [who, setWho] = useState<string>('');
  const [why, setWhy] = useState<string>('');
  const m = map.data;
  const people = m?.members ?? [];
  const rows = m?.rows ?? [];
  const sel = people.find((x) => x.memberId === who) ?? people[0];
  const node =
    rows.find((r) => r.nodeId === why) ??
    rows.find((r) => r.nodeId === search.page) ??
    rows.find((r) => r.nodeId === homeOf(space, tree)?.id) ??
    rows[0];
  const ex = useExplain(tenantId, node?.nodeId, sel?.memberId);
  if (!m) {
    return (
      <div className="ox-kb-map-wrap">
        {map.isError ? <Failed q={map} /> : <Pending rows={3} />}
      </div>
    );
  }
  const grid = mapGrid(people.length);
  const verdict = verdictOf(ex.data);
  return (
    <div className="ox-kb-map-wrap">
      <div className="ox-kb-map">
        <span className="ox-kb-map-head">
          <strong>{K.people.map}</strong>
          <span>{K.people.mapNote}</span>
        </span>
        <div className="ox-kb-map-scroll">
          <div
            className="ox-kb-map-cols"
            style={{ gridTemplateColumns: grid.cols, minWidth: grid.minW }}
          >
            <span>{K.kinds.page}</span>
            {people.map((x) => (
              <button
                key={x.memberId}
                type="button"
                className="ox-kb-map-col"
                data-sel={sel && x.memberId === sel.memberId ? '' : undefined}
                onClick={() => setWho(x.memberId)}
              >
                <span className="ox-kb-map-av" style={{ background: avatarOf(x.displayName) }}>
                  {initialsOf(x.displayName)}
                </span>
                <span className="ox-kb-map-name">{x.displayName.split(' ')[0]}</span>
              </button>
            ))}
          </div>
          {rows.map((r, i) => {
            const n = tree.byId.get(r.nodeId);
            return (
              <div
                key={r.nodeId}
                className="ox-kb-map-row"
                style={{ gridTemplateColumns: grid.cols, minWidth: grid.minW }}
              >
                <span className="ox-kb-map-page" style={{ paddingLeft: `${(r.depth - 1) * 16}px` }}>
                  <Glyph name={n ? KIND_ICON[n.kind] : 'description'} size={16} />
                  <span className="ox-kb-map-title">{r.title}</span>
                  {n && n.accessMode !== 'inherit' ? (
                    <Glyph name="lock" size={14} title={K.tree.own} className="ox-kb-lock" />
                  ) : null}
                  {n?.sensitivity === 'finance' ? (
                    <Glyph name="payments" size={14} title={K.tree.finance} className="ox-kb-fin" />
                  ) : null}
                </span>
                {(m.cells[i] ?? []).map((c, j) => {
                  const look = CELL_LOOK[c];
                  const label = K.people.cells[c];
                  const ring =
                    !!sel &&
                    !!node &&
                    people[j]?.memberId === sel.memberId &&
                    r.nodeId === node.nodeId;
                  return (
                    <button
                      key={j}
                      type="button"
                      className="ox-kb-cell"
                      data-tone={look.tone}
                      data-ring={ring ? '' : undefined}
                      title={label}
                      onClick={() => {
                        setWho(people[j]?.memberId ?? '');
                        setWhy(r.nodeId);
                      }}
                    >
                      <Glyph name={look.icon} size={14} />
                      {label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <aside aria-label={K.people.whyAria} className="ox-kb-why">
        <strong className="ox-kb-why-title">{K.people.check}</strong>
        <select
          value={sel?.memberId ?? ''}
          aria-label={K.people.member}
          onChange={(e) => setWho(e.target.value)}
        >
          {people.map((x) => (
            <option key={x.memberId} value={x.memberId}>
              {x.displayName}
            </option>
          ))}
        </select>
        <span className="ox-kb-why-label">{K.kinds.page}</span>
        <strong className="ox-kb-why-page">
          {node ? format(K.people.whyPage, { title: node.title }) : '—'}
        </strong>
        <div className="ox-kb-chain">
          {(ex.data?.chain ?? []).map((c, i) => (
            <div key={i} className="ox-kb-chain-step">
              <Glyph name={STEP_LOOK[c.kind].icon} size={19} className={`ox-kb-step-${c.kind}`} />
              <span>
                <strong>{c.title}</strong>
                <span>{c.detail}</span>
              </span>
            </div>
          ))}
        </div>
        {ex.isError ? (
          <Failed q={ex} />
        ) : !ex.data && ex.isFetching ? (
          <Pending rows={1} />
        ) : (
          <div className="ox-kb-res" data-tone={verdict.tone}>
            <Glyph name={verdict.icon} size={18} />
            <span>{ex.data ? ex.data.summary : K.people.pickCell}</span>
          </div>
        )}
      </aside>
    </div>
  );
}

export function PeopleTab({ space, tree }: { space: Space; tree: TreeIndex }): ReactElement {
  const api = useApi();
  const { tenantId, cmd, busy } = useKb();
  const { me } = useShell();
  const members = useMembers(tenantId, space.id);
  const lead = space.my.lead;
  const home = homeOf(space, tree);
  const cands = useCandidates(tenantId, home?.id ?? '', lead && !!home);
  const [addWho, setAddWho] = useState('');
  const [addRole, setAddRole] = useState<Role>('kb_space_reader');
  const data = members.data;
  const roles = data?.roles ?? [];
  const roleOpts = [
    ...roles.map((r) => ({ v: r.role as string, t: r.label })),
    { v: '', t: K.people.remove },
  ];
  const inSpace = new Set(roles.flatMap((r) => r.members.map((m) => m.memberId)));

  const setRole = (memberId: string, role: Role | null): void => {
    void cmd(
      { op: 'member', space: space.id, memberId, role },
      (key) => commands.setMember(api, tenantId, space.id, memberId, role, key),
      role ? K.toast.roleChanged : K.toast.memberRemoved,
    );
  };
  const add = async (): Promise<void> => {
    const r = await cmd(
      { op: 'member', space: space.id, memberId: addWho, role: addRole },
      (key) => commands.setMember(api, tenantId, space.id, addWho, addRole, key),
      K.toast.memberAdded,
    );
    if (r.ok) setAddWho('');
  };

  const cards: { name: string; caps: string; people: Person[] }[] = roles.map((r) => ({
    name: r.label,
    caps: r.description,
    people: r.members.map((m) => ({
      key: m.memberId,
      name: m.displayName,
      src:
        m.state === 'invited'
          ? format(K.people.invited, { src: K.people.assigned })
          : K.people.assigned,
      role: r.role,
      memberId: m.memberId,
      // Свою роль руководителя не снять (М:683): своя строка — по имени входа (id участника в /me/context нет).
      canChange: lead && !(m.displayName === me.displayName && r.role === 'kb_space_lead'),
    })),
  }));
  if (data?.byLevel) {
    cards.push({
      name: data.byLevel.label,
      caps: format(K.people.levelCaps, { d: data.levelLabel, area: lowerFirst(space.areaLabel) }),
      people: [
        ...data.byLevel.members.map((m) => ({
          key: `l-${m.memberId}`,
          name: m.displayName,
          src: m.source,
          canChange: false,
        })),
        ...(data.pageAssignments ?? []).map((a) => ({
          key: `p-${a.memberId}-${a.nodeId}`,
          name: a.displayName || '—',
          src: a.until
            ? format(K.people.pageUntil, { title: a.nodeTitle, date: dayOf(a.until) })
            : format(K.people.page, { title: a.nodeTitle }),
          canChange: false,
        })),
      ],
    });
  }
  const whoOpts = (cands.data ?? []).filter(
    (c) => c.entry.who === 'member' && c.entry.refId && !inSpace.has(c.entry.refId),
  );

  return (
    <div className="ox-kb-tab-body ox-kb-people">
      <span className="ox-kb-people-intro">
        {format(K.people.intro, {
          space: space.name,
          level: K.levels[space.access].d.toLowerCase(),
        })}
      </span>
      {members.isPending ? <Pending rows={3} /> : null}
      {members.isError ? <Failed q={members} /> : null}
      <div className="ox-kb-roles">
        {cards.map((c) => (
          <div key={c.name} className="ox-kb-role">
            <span className="ox-kb-role-head">
              <strong>{c.name}</strong>
              <span>{c.caps}</span>
            </span>
            <div className="ox-kb-role-people">
              {c.people.map((p) => (
                <PersonRow key={p.key} p={p} roleOpts={roleOpts} onRole={setRole} />
              ))}
              {!c.people.length ? <span className="ox-kb-nobody">{K.people.nobody}</span> : null}
            </div>
          </div>
        ))}
      </div>
      {lead && data && cands.isError ? (
        <div className="ox-kb-add" data-state="error">
          <Failed q={cands} />
        </div>
      ) : lead && data && home && !cands.data ? (
        <div className="ox-kb-add" data-state="pending">
          <Pending rows={1} />
        </div>
      ) : lead && data ? (
        <div className="ox-kb-add">
          <select
            value={addWho}
            aria-label={K.people.member}
            onChange={(e) => setAddWho(e.target.value)}
          >
            <option value="">{K.people.member}</option>
            {whoOpts.map((c) => (
              <option key={c.entry.refId} value={c.entry.refId}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            value={addRole}
            aria-label={K.people.role}
            onChange={(e) => setAddRole(e.target.value as Role)}
          >
            {roles.map((r) => (
              <option key={r.role} value={r.role}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ox-kb-btn"
            data-variant="primary"
            data-size="lg"
            disabled={!addWho || busy}
            onClick={() => void add()}
          >
            <Glyph name="person_add" size={18} />
            {K.people.add}
          </button>
        </div>
      ) : null}
      {lead ? <AccessMap space={space} tree={tree} /> : null}
    </div>
  );
}
