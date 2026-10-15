// Импорт людей из CSV (W0.13, S1-10, W0.08 §4.1): предпросмотр → применение. Колонки: full_name (обязательна),
// email, phone, org_unit (название или id подразделения), work_profile. Не больше 1 МБ и 2000 строк (413).
// Срок предпросмотра — сутки; приглашения из файла требуют members.invite (x-field-permissions).
import type { components } from '@ortus/api-client';

import { actionsFor } from '../core/access.ts';
import { importDto } from '../core/dto.ts';
import { inviteMember } from '../core/people.ts';
import { fail } from '../core/problem.ts';
import type { HandlerContext, Registry } from '../core/registry.ts';
import type { ImportRow, Org } from '../core/state.ts';
import { addMs, DAY } from '../core/time.ts';
import { requireSeats, requireUnits } from './members.ts';
import { SOD_TEXT, sodConflict } from './rules.ts';

type S = components['schemas'];
type Row = S['PeopleImportRow'];

const MAX_BYTES = 1024 * 1024;
const MAX_ROWS = 2000;
const TOO_LARGE = 'Файл больше 1 МБ или 2000 строк. Разделите его на части.';
const PROFILES = new Set(['driver', 'practitioner', 'foreman', 'manager']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Разбор CSV: запятая или точка с запятой, кавычки по RFC 4180. */
export function parseCsv(text: string): string[][] {
  const sep = (text.split('\n')[0] ?? '').includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function previewRows(org: Org, csv: string[][], defaultUnit: string): Row[] {
  const [header = [], ...data] = csv;
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const idx = {
    name: col('full_name'),
    email: col('email'),
    phone: col('phone'),
    unit: col('org_unit'),
    profile: col('work_profile'),
  };
  return data.map((cells, i): Row => {
    const get = (j: number) => (j >= 0 ? (cells[j] ?? '').trim() : '');
    const fullName = get(idx.name);
    const email = get(idx.email);
    const phone = get(idx.phone);
    const unitRaw = get(idx.unit);
    const profile = get(idx.profile);
    const errors: S['ProblemViolation'][] = [];
    if (!fullName) errors.push({ field: 'full_name', code: 'required', message: 'Укажите ФИО' });
    if (email && !EMAIL.test(email)) {
      errors.push({ field: 'email', code: 'format', message: 'Неверный адрес почты' });
    }
    if (profile && !PROFILES.has(profile)) {
      errors.push({ field: 'work_profile', code: 'enum', message: 'Неизвестная функция' });
    }
    const unit = unitRaw
      ? org.units.find((u) => u.id === unitRaw.toLowerCase() || u.name === unitRaw)
      : undefined;
    if (unitRaw && !unit) {
      errors.push({ field: 'org_unit', code: 'unknown', message: 'Нет такого подразделения' });
    }
    const line = i + 2;
    if (errors.length) {
      const row: Row = { line, action: 'error', errors };
      if (fullName) row.fullName = fullName;
      if (email) row.email = email;
      return row;
    }
    const existing = email
      ? org.members.find((m) => m.email?.toLowerCase() === email.toLowerCase())
      : undefined;
    const row: Row = { line, action: existing ? 'update' : 'create', fullName, errors: [] };
    if (email) row.email = email;
    if (phone) row.phone = phone;
    row.orgUnitId = unit?.id ?? defaultUnit;
    if (profile) row.workProfile = profile as Row['workProfile'];
    if (existing) row.memberId = existing.id;
    return reorderRow(row);
  });
}

/** Поля строки в порядке примера createPeopleImport/ok. */
const reorderRow = (r: Row): Row => {
  const keys = [
    'line',
    'action',
    'fullName',
    'email',
    'phone',
    'orgUnitId',
    'workProfile',
    'memberId',
    'errors',
  ];
  return Object.fromEntries(
    keys.filter((k) => k in r).map((k) => [k, (r as Record<string, unknown>)[k]]),
  ) as Row;
};

const totalsOf = (rows: Row[], invited: number): S['PeopleImportTotals'] => ({
  rows: rows.length,
  create: rows.filter((r) => r.action === 'create').length,
  update: rows.filter((r) => r.action === 'update').length,
  skip: rows.filter((r) => r.action === 'skip').length,
  error: rows.filter((r) => r.action === 'error').length,
  invited,
});

function importOr404(ctx: HandlerContext): ImportRow {
  const imp = ctx.org().org.imports.find((i) => i.id === ctx.params.importId?.toLowerCase());
  if (!imp || (imp.state === 'previewed' && ctx.now() >= imp.expiresAt)) fail('not_found');
  return imp;
}

export const importsHandlers: Registry = {
  createPeopleImport: {
    before: (ctx) => {
      const csv = (ctx.body as { csv?: unknown } | undefined)?.csv;
      if (typeof csv !== 'string') return;
      const lines = csv.split('\n').filter((l) => l.trim() !== '').length - 1;
      if (new TextEncoder().encode(csv).length > MAX_BYTES || lines > MAX_ROWS) {
        fail('payload_too_large', TOO_LARGE);
      }
    },
    run: (ctx) => {
      const org = ctx.org().org;
      const b = ctx.body as S['PeopleImportCreate'];
      requireUnits(ctx, [b.defaultOrgUnitId], 'defaultOrgUnitId');
      const csv = parseCsv(b.csv);
      const header = (csv[0] ?? []).map((h) => h.trim().toLowerCase());
      if (!header.includes('full_name')) {
        fail('validation_failed', undefined, {
          violations: [
            { field: 'csv', code: 'missing_column', message: 'Нет колонки full_name (ФИО)' },
          ],
        });
      }
      const rows = previewRows(org, csv, b.defaultOrgUnitId.toLowerCase());
      const row: ImportRow = {
        id: ctx.newId(),
        state: 'previewed',
        fileName: b.fileName,
        defaultOrgUnitId: b.defaultOrgUnitId.toLowerCase(),
        totals: totalsOf(rows, 0),
        rows,
        createdAt: ctx.now(),
        expiresAt: addMs(ctx.now(), DAY),
        revision: 1,
      };
      org.imports.push(row);
      return { status: 201, body: importDto(row) };
    },
  },

  getPeopleImport: (ctx) => ({ body: importDto(importOr404(ctx)) }),

  commitPeopleImport: (ctx) => {
    const t = ctx.org();
    const imp = importOr404(ctx);
    const b = ctx.body as S['PeopleImportCommit'];
    ctx.revision(imp.revision);
    if (imp.state !== 'previewed') fail('invalid_transition', 'Импорт уже применён.');
    if (b.sendInvitations && !actionsFor(t, ctx.op.scope, ctx.now()).has('members.invite')) {
      fail('forbidden_action', 'Приглашать из файла может только участник с правом приглашать.');
    }
    const errors = imp.rows.filter((r) => r.action === 'error');
    if (errors.length && !b.skipInvalidRows) {
      fail('validation_failed', 'В файле есть строки с ошибками: исправьте их или пропустите.', {
        violations: errors.map((r) => ({
          field: `rows[${r.line}]`,
          code: 'invalid',
          message: r.errors[0]?.message ?? 'Ошибка в строке',
        })),
      });
    }
    const creates = imp.rows.filter((r) => r.action === 'create');
    requireSeats(ctx, creates.length);
    for (const r of imp.rows.filter((x) => x.action === 'update')) {
      const m = t.org.members.find((x) => x.id === r.memberId);
      const profiles =
        r.workProfile && m && !m.workProfiles.includes(r.workProfile)
          ? [...m.workProfiles, r.workProfile]
          : m?.workProfiles;
      if (m && profiles && sodConflict(t.org, m, ctx.now(), [], profiles)) {
        fail('separation_of_duties_conflict', SOD_TEXT);
      }
    }
    let invited = 0;
    const rows = imp.rows.map((r): Row => {
      if (r.action === 'error') return { ...r, action: 'skip' };
      if (r.action === 'create') {
        const { member } = inviteMember(
          ctx.s,
          t.tenant,
          t.org,
          {
            email: r.email ?? `${ctx.newId()}@import.invalid`,
            displayName: r.fullName,
            orgUnitIds: r.orgUnitId ? [r.orgUnitId] : [],
            workProfiles: r.workProfile ? [r.workProfile] : [],
            phone: r.phone,
          },
          b.sendInvitations,
        );
        if (b.sendInvitations) invited++;
        return reorderRow({ ...r, memberId: member.id });
      }
      if (r.action === 'update') {
        const m = t.org.members.find((x) => x.id === r.memberId);
        if (m) {
          let changed = false;
          if (r.orgUnitId && !m.orgUnitIds.includes(r.orgUnitId)) {
            m.orgUnitIds.push(r.orgUnitId);
            changed = true;
          }
          if (r.workProfile && !m.workProfiles.includes(r.workProfile)) {
            m.workProfiles.push(r.workProfile);
            changed = true;
          }
          if (r.phone && m.phone !== r.phone) {
            m.phone = r.phone;
            changed = true;
          }
          if (changed) m.revision++;
        }
      }
      return r;
    });
    imp.rows = rows;
    imp.totals = totalsOf(rows, invited);
    imp.state = 'committed';
    imp.committedAt = ctx.now();
    imp.revision++;
    return { body: importDto(imp) };
  },
};
