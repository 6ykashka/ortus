// Тег Access (W0.13): участники, роли, назначения, оргструктура, группы, владельцы, «Почему доступно», импорт.
import type { Registry } from '../core/registry.ts';
import { explainHandlers } from './explain.ts';
import { groupsHandlers } from './groups.ts';
import { importsHandlers } from './imports.ts';
import { membersHandlers } from './members.ts';
import { rolesHandlers } from './roles.ts';
import { unitsHandlers } from './units.ts';

export const accessHandlers: Registry = {
  ...membersHandlers,
  ...rolesHandlers,
  ...unitsHandlers,
  ...groupsHandlers,
  ...explainHandlers,
  ...importsHandlers,
};
