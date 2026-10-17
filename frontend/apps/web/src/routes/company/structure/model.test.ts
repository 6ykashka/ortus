// W1.54 · Модель «Структуры» (S1-08, no-reference): дерево из плоского listOrgUnits, путь узла, вид нового узла,
// цели переноса, строки предпросмотра влияния (previewOrgUnitMove) и проверка названия.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  buildTree,
  childKind,
  flatten,
  impactView,
  commandsFor,
  kindLabel,
  manageScope,
  mayManage,
  moveTargets,
  nameError,
  pathOf,
  sameTarget,
} from './model.ts';

type OrgUnit = components['schemas']['OrgUnit'];
type Preview = components['schemas']['OrgUnitMovePreview'];

const u = (
  id: string,
  parentId: string | null,
  name: string,
  kind: OrgUnit['kind'],
  status: OrgUnit['status'] = 'active',
): OrgUnit => ({ id, parentId, name, kind, status, revision: 1 });

// Сид «Альты» в миниатюре: два региона, фирмы, подразделение, архивная фирма; порядок API — по имени.
const UNITS: OrgUnit[] = [
  u('f2', 'r1', 'Юг Транс', 'company'),
  u('r2', null, 'Самара', 'region'),
  u('b1', 'f1', 'Склад', 'branch'),
  u('r1', null, 'Москва', 'region'),
  u('f1', 'r1', 'Север Логистик', 'company'),
  u('f3', 'r2', 'Волга Логистик', 'company'),
  u('fa', 'r2', 'Архивная', 'company', 'archived'),
];

describe('дерево', () => {
  it('корни — узлы без родителя, дети по названию (ru)', () => {
    const tree = buildTree(UNITS);
    expect(tree.map((n) => n.unit.name)).toEqual(['Москва', 'Самара']);
    expect(tree[0]?.children.map((n) => n.unit.name)).toEqual(['Север Логистик', 'Юг Транс']);
    expect(tree[0]?.children[0]?.children.map((n) => n.unit.name)).toEqual(['Склад']);
    expect(tree[1]?.children.map((n) => n.unit.name)).toEqual(['Архивная', 'Волга Логистик']);
  });

  it('глубина узлов и обход в порядке дерева', () => {
    const flat = flatten(buildTree(UNITS));
    expect(flat.map((n) => `${n.depth}:${n.unit.name}`)).toEqual([
      '0:Москва',
      '1:Север Логистик',
      '2:Склад',
      '1:Юг Транс',
      '0:Самара',
      '1:Архивная',
      '1:Волга Логистик',
    ]);
  });

  it('родитель не виден (вне области) — узел становится корнем', () => {
    const tree = buildTree([u('f1', 'hidden', 'Север Логистик', 'company')]);
    expect(tree.map((n) => n.unit.name)).toEqual(['Север Логистик']);
  });

  it('пустой список — пустое дерево', () => {
    expect(buildTree([])).toEqual([]);
  });
});

describe('путь и вид', () => {
  it('путь узла — названия предков через « / »', () => {
    expect(pathOf(UNITS, 'b1')).toBe('Москва / Север Логистик / Склад');
    expect(pathOf(UNITS, 'r1')).toBe('Москва');
    expect(pathOf(UNITS, 'нет')).toBe('');
  });

  it('подписи вида', () => {
    expect(kindLabel('region')).toBe('Регион');
    expect(kindLabel('company')).toBe('Фирма');
    expect(kindLabel('branch')).toBe('Подразделение');
    expect(kindLabel('team')).toBe('Команда');
  });

  it('вид нового узла — следующий уровень', () => {
    expect(childKind(null)).toBe('region');
    expect(childKind('region')).toBe('company');
    expect(childKind('company')).toBe('branch');
    expect(childKind('branch')).toBe('team');
    expect(childKind('team')).toBe('team');
  });
});

describe('цели переноса', () => {
  it('без самого узла, его потомков, текущего родителя и архивных; подпись — путь', () => {
    expect(moveTargets(UNITS, 'f1')).toEqual([
      { value: 'f2', label: 'Москва / Юг Транс' },
      { value: 'r2', label: 'Самара' },
      { value: 'f3', label: 'Самара / Волга Логистик' },
    ]);
  });

  it('регион верхнего уровня можно перенести под другой узел', () => {
    expect(moveTargets(UNITS, 'r2').map((o) => o.value)).toEqual(['r1', 'f1', 'b1', 'f2']);
  });

  it('только под узлы, где действующий может изменять структуру', () => {
    const s = manageScope(false, [cap('org_units.manage', 'org_unit', ['r1'])], UNITS);
    expect(moveTargets(UNITS, 'f1', (id) => mayManage(s, id))).toEqual([
      { value: 'f2', label: 'Москва / Юг Транс' },
    ]);
  });
});

const cap = (
  permission: string,
  kind: 'tenant' | 'org_unit',
  resourceIds: string[] = [],
  includeDescendants = true,
) => ({ permission, scope: { kind, resourceIds, includeDescendants } });

// Возврат 1 доделки №2 (minor): право org_units.manage с областью. Верхний уровень (создание, перенос корня) — только
// с правом на всю организацию; переименование — право на сам узел; перенос — на узел и его родителя (backend
// units.go: mayManageParent, UpdateOrgUnit).
describe('где можно изменять структуру', () => {
  it('владелец и право на всю организацию — везде, включая верхний уровень', () => {
    for (const s of [
      manageScope(true, [], UNITS),
      manageScope(false, [cap('org_units.manage', 'tenant')], UNITS),
    ]) {
      expect(mayManage(s, null)).toBe(true);
      expect(mayManage(s, 'f3')).toBe(true);
      expect(s.any).toBe(true);
    }
  });

  it('право на регион с поддеревом: регион и потомки, не верхний уровень и не соседний регион', () => {
    const s = manageScope(false, [cap('org_units.manage', 'org_unit', ['r1'])], UNITS);
    expect(s.any).toBe(true);
    expect(mayManage(s, null)).toBe(false);
    expect(['r1', 'f1', 'b1', 'f2'].every((id) => mayManage(s, id))).toBe(true);
    expect(mayManage(s, 'r2')).toBe(false);
    expect(mayManage(s, 'f3')).toBe(false);
  });

  it('право без поддерева — только сам узел; чужие права и org_units.read не в счёт', () => {
    const s = manageScope(
      false,
      [
        cap('org_units.manage', 'org_unit', ['f1'], false),
        cap('org_units.read', 'tenant'),
        cap('members.manage', 'org_unit', ['r2']),
      ],
      UNITS,
    );
    expect(mayManage(s, 'f1')).toBe(true);
    expect(mayManage(s, 'b1')).toBe(false);
    expect(mayManage(s, 'r2')).toBe(false);
    expect(manageScope(false, [cap('org_units.read', 'tenant')], UNITS).any).toBe(false);
  });

  it('команды узла: добавить и переименовать — право на узел; перенести — ещё и на родителя', () => {
    const s = manageScope(false, [cap('org_units.manage', 'org_unit', ['r1'])], UNITS);
    const of = (id: string) => {
      const unit = UNITS.find((x) => x.id === id);
      if (!unit) throw new Error(id);
      return commandsFor(s, unit);
    };
    expect(of('r1')).toEqual({ add: true, rename: true, move: false });
    expect(of('f1')).toEqual({ add: true, rename: true, move: true });
    expect(of('r2')).toEqual({ add: false, rename: false, move: false });
    expect(commandsFor(manageScope(true, [], UNITS), UNITS[3] as OrgUnit)).toEqual({
      add: true,
      rename: true,
      move: true,
    });
  });
});

describe('название', () => {
  it('пустое и из пробелов — «Укажите название»', () => {
    expect(nameError('')).toBe('Укажите название');
    expect(nameError('   ')).toBe('Укажите название');
  });

  it('длиннее 150 символов — «Не длиннее 150 символов»', () => {
    expect(nameError('я'.repeat(151))).toBe('Не длиннее 150 символов');
    expect(nameError('я'.repeat(150))).toBeNull();
  });

  it('обычное — без ошибки', () => {
    expect(nameError('Склад')).toBeNull();
  });
});

describe('предпросмотр влияния', () => {
  const preview = (p: Partial<Preview> = {}): Preview => ({
    orgUnitId: 'f1',
    fromParentId: 'r1',
    toParentId: 'r2',
    descendantUnitCount: 1,
    memberCount: 3,
    assignmentsLosingScope: 0,
    assignmentsGainingScope: 0,
    affectedPeople: [],
    hiddenCount: 0,
    ...p,
  });
  const roles = new Map([['role-1', 'Менеджер логистики']]);

  it('без затронутых: «Доступ ни у кого не изменится.», счётчики переноса', () => {
    const v = impactView(preview(), roles);
    expect(v.facts).toEqual(['Вложенных подразделений: 1', 'Сотрудников в переносимой части: 3']);
    expect(v.none).toBe(true);
    expect(v.gains).toEqual([]);
    expect(v.losses).toEqual([]);
    expect(v.hidden).toBeNull();
  });

  it('получат и потеряют доступ: «{имя} · {роль}», роль без права — только имя', () => {
    const v = impactView(
      preview({
        assignmentsGainingScope: 1,
        assignmentsLosingScope: 1,
        affectedPeople: [
          {
            memberId: 'm1',
            displayName: 'Сергей Ильин',
            change: 'gains',
            roleId: 'role-1',
            assignmentId: 'a1',
          },
          {
            memberId: 'm2',
            displayName: 'Тимур Ахмедов',
            change: 'loses',
            roleId: 'role-x',
            assignmentId: 'a2',
          },
        ],
      }),
      roles,
    );
    expect(v.none).toBe(false);
    expect(v.gains).toEqual(['Сергей Ильин · Менеджер логистики']);
    expect(v.losses).toEqual(['Тимур Ахмедов']);
  });

  it('часть скрыта: «Ещё N — вне вашей области просмотра»', () => {
    const v = impactView(preview({ hiddenCount: 2, assignmentsLosingScope: 2 }), roles);
    expect(v.none).toBe(false);
    expect(v.hidden).toBe('Ещё 2 — вне вашей области просмотра');
  });

  it('предпросмотр той же цели', () => {
    expect(sameTarget(preview(), 'f1', 'r2')).toBe(true);
    expect(sameTarget(preview(), 'f1', 'r1')).toBe(false);
    expect(sameTarget(undefined, 'f1', 'r2')).toBe(false);
  });
});
