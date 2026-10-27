// W7.25 · Модель страницы «Документы» (чистые функции, без запросов): чип статуса (docStatus J:179–198), «Доступ»
// (Д:908), «Ждут меня» (Д:876–880), папки списком с путём, проверки «Нового документа» (docCreate J:660–685),
// «Что изменится» (Д:1313–1376), сроки внешних ссылок (DOC-06). Права кнопок — только `my.can` сервера.
import type { components } from '@ortus/api-client';

import { DOCS_TEXT as T } from './texts.ts';

type S = components['schemas'];

export type Kind = S['DocSummary']['kind'];
export type Level = NonNullable<S['DocMy']['level']>;
export type CreateKind = Kind | 'tpl' | 'scan';
export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';

export const MSK = 'Europe/Moscow';

export function plural(n: number, f: readonly [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return f[2];
  if (b > 1 && b < 5) return f[1];
  if (b === 1) return f[0];
  return f[2];
}

const WORDS = [T.words.one, T.words.few, T.words.many] as const;
export const wordsText = (n: number): string => `${n} ${plural(n, WORDS)}`;

export const fill = (s: string, v: Record<string, string | number>): string =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));

export const KINDS: Readonly<Record<Kind, { label: string; icon: string }>> = {
  text: { label: T.kinds.text.label, icon: T.kinds.text.icon },
  sheet: { label: T.kinds.sheet.label, icon: T.kinds.sheet.icon },
  pdf: { label: T.kinds.pdf.label, icon: T.kinds.pdf.icon },
};
export const kindOf = (k: Kind): { label: string; icon: string } => KINDS[k];

export interface Chip {
  tone: Tone;
  icon: string;
  label: string;
}

export interface ChipSource {
  status: S['DocSummary']['status'];
  route?: S['DocRouteBrief'] | null | undefined;
  ocr?: S['DocOcr'] | null | undefined;
  pdfaCopy?: boolean | undefined;
}

const BRIEF_STEP: Readonly<Record<string, Chip>> = {
  Согласовать: { tone: 'info', icon: 'task_alt', label: T.status.approving },
  Утвердить: { tone: 'warn', icon: 'approval', label: T.status.signing },
  'Подпись заказчика': { tone: 'warn', icon: 'signature', label: T.status.external },
  Ознакомить: { tone: 'info', icon: 'visibility', label: T.status.acking },
};

/** Чип статуса списка и карточки (docStatus J:179–198); полный маршрут даёт счёт «N из M», краткий — имя шага. */
export function statusChip(
  d: ChipSource,
  o: { route?: S['DocRoute']; jobName?: string } = {},
): Chip {
  if (d.status === 'archived')
    return { tone: 'neutral', icon: 'inventory_2', label: T.status.archived };
  const full = o.route;
  const brief = d.route ?? undefined;
  const active = full ? full.status === 'active' : brief?.status === 'active';
  if (active) {
    if (full) {
      const s = full.steps[full.currentStep];
      if (s?.kind === 'approve') {
        const n = s.decisions.filter((x) => x.decision === 'ok').length;
        const m = s.mode === 'any' ? 1 : s.who.length;
        return {
          tone: 'info',
          icon: 'task_alt',
          label: fill(T.status.approvingOf, { n, m }),
        };
      }
      if (s?.kind === 'sign') return { tone: 'warn', icon: 'approval', label: T.status.signing };
      if (s?.kind === 'external')
        return { tone: 'warn', icon: 'signature', label: T.status.external };
      if (s?.kind === 'ack') {
        const total = s.who.length;
        return {
          tone: 'info',
          icon: 'visibility',
          label: total
            ? fill(T.status.ackingOf, { n: s.done?.length ?? 0, m: total })
            : T.status.acking,
        };
      }
    } else if (brief?.stepName && BRIEF_STEP[brief.stepName]) {
      return BRIEF_STEP[brief.stepName] as Chip;
    }
    return { tone: 'info', icon: 'route', label: T.status.onRoute };
  }
  if (d.status === 'returned' || brief?.status === 'returned' || full?.status === 'returned') {
    return { tone: 'warn', icon: 'undo', label: T.status.returned };
  }
  if (d.pdfaCopy) {
    return d.status === 'signed'
      ? { tone: 'ok', icon: 'verified', label: T.status.pdfaSigned }
      : { tone: 'neutral', icon: 'inventory_2', label: T.status.pdfaArchive };
  }
  if (d.status === 'signed') return { tone: 'ok', icon: 'verified', label: T.status.signed };
  if (d.status === 'approved') return { tone: 'ok', icon: 'verified', label: T.status.approved };
  if (d.status === 'agreed') return { tone: 'ok', icon: 'check_circle', label: T.status.agreed };
  if (o.jobName) {
    return { tone: 'info', icon: 'hourglass_top', label: fill(T.status.job, { name: o.jobName }) };
  }
  const n = d.ocr?.status === 'done' ? d.ocr.doubtful : 0;
  if (n) {
    return {
      tone: 'warn',
      icon: 'document_scanner',
      label: fill(T.status.doubtful, { n: wordsText(n) }),
    };
  }
  return { tone: 'neutral', icon: 'edit_note', label: T.status.draft };
}

export const levelName = (l: Level | null | undefined): string => (l ? T.levels[l] : '');

/** Колонка «Доступ» (Д:908): утверждённая версия для ознакомления или уровень участника. */
export function accessOf(my: S['DocMy']): { icon: string; label: string } {
  if (my.onlyVersion) {
    return { icon: 'visibility', label: fill(T.access.onlyVersion, { v: my.onlyVersion }) };
  }
  const icon =
    my.level === 'manage' ? 'admin_panel_settings' : my.level === 'view' ? 'visibility' : 'tune';
  return { icon, label: fill(T.access.level, { level: levelName(my.level) }) };
}

// ───────────────────────────── «Ждут меня» ─────────────────────────────

const WAIT_ORDER: Readonly<Record<S['DocWait']['kind'], number>> = {
  sign: 0,
  approve: 1,
  returned: 2,
  ack: 3,
  ocr: 4,
  mention: 5,
};

export interface WaitCard {
  key: string;
  doc: S['DocSummary'];
  wait: S['DocWait'];
  label: string;
  icon: string;
  tone: 'warn' | 'info';
  button: string;
  text: string;
}

const short = (t: string | undefined, n: number): string => {
  const x = (t ?? '').replace(/\s+/g, ' ').trim();
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
};

/** `2026-10-22` → `22.10`. */
export const dayMonth = (iso: string | null | undefined): string => {
  const m = /^\d{4}-(\d\d)-(\d\d)/.exec(iso ?? '');
  return m ? `${m[2]}.${m[1]}` : '';
};

function waitText(w: S['DocWait']): string {
  const due = dayMonth(w.due);
  switch (w.kind) {
    case 'approve':
      return `Шаг «Согласовать»${due ? ` · до ${due}` : ''}`;
    case 'sign':
      return 'Согласовали все · ждёт вашей подписи';
    case 'ack':
      return `Утверждённая${due ? ` · срок до ${due}` : ''}`;
    case 'returned':
      return `${w.by ?? ''}${w.comment ? `: «${short(w.comment, 70)}»` : ''}`;
    case 'mention':
      return `${w.by ?? ''}${w.comment ? `: «${short(w.comment, 80)}»` : ''}`;
    case 'ocr':
      return `${wordsText(w.count ?? 0)} под вопросом`;
  }
}

/** «Ждут меня · N»: порядок sign → approve → returned → ack → ocr → mention (Д:876–880). */
export function waitCards(docs: readonly S['DocSummary'][]): WaitCard[] {
  return docs
    .flatMap((doc) => doc.my.wait.map((wait, i) => ({ doc, wait, i })))
    .sort((a, b) => WAIT_ORDER[a.wait.kind] - WAIT_ORDER[b.wait.kind])
    .map(({ doc, wait, i }) => {
      const k = T.waitKinds[wait.kind];
      return {
        key: `${doc.id}:${wait.kind}:${i}`,
        doc,
        wait,
        label: k.label,
        icon: k.icon,
        tone: k.tone,
        button: k.btn,
        text: waitText(wait),
      };
    });
}

// ───────────────────────────── форматы ─────────────────────────────

/** «Дарья Зимина» → «Д. Зимина». */
export function shortName(name: string): string {
  const p = name.trim().split(/\s+/);
  if (p.length < 2) return name.trim();
  return `${(p[0] ?? '').slice(0, 1)}. ${p.slice(1).join(' ')}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((x) => x[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const parts = (ms: number, tz: string): Record<string, string> =>
  Object.fromEntries(
    new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );

/** Сегодня — «ЧЧ:ММ», раньше — «ДД.ММ» (Д:909). */
export function whenOf(iso: string, now: number, tz: string = MSK): string {
  const at = parts(Date.parse(iso), tz);
  const today = parts(now, tz);
  return at.day === today.day && at.month === today.month
    ? `${at.hour}:${at.minute}`
    : `${at.day}.${at.month}`;
}

/** «ДД.ММ ЧЧ:ММ» — время событий журнала и версий. */
export function stampOf(iso: string, tz: string = MSK): string {
  const p = parts(Date.parse(iso), tz);
  return `${p.day}.${p.month} ${p.hour}:${p.minute}`;
}

export const versionSource = (s: S['DocVersion']['source']): string => T.vers.sources[s];

export function anchorText(a: {
  kind: 'block' | 'cell' | 'page';
  ref: string;
  quote?: string | undefined;
}): string {
  if (a.kind === 'cell') return fill(T.talk.anchorCell, { ref: a.ref });
  if (a.kind === 'page') return fill(T.talk.anchorPage, { ref: a.ref });
  return a.quote ? fill(T.talk.anchorBlock, { quote: a.quote }) : T.talk.anchorDoc;
}

export function bytesText(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} МБ`;
  if (n >= 1000) return `${Math.round(n / 1000)} КБ`;
  return `${n} Б`;
}

// ───────────────────────────── папки ─────────────────────────────

export interface FolderOption {
  id: string;
  label: string;
  folder: S['DocFolder'];
}

/** Папки списком «A › B» в порядке дерева; `onlyCreate` — только те, где участник правит (`my.create`). */
export function folderOptions(
  folders: readonly S['DocFolder'][],
  onlyCreate = false,
): FolderOption[] {
  const ids = new Set(folders.map((f) => f.id));
  const kids = (parent: string | null): S['DocFolder'][] =>
    folders.filter((f) =>
      parent === null ? !f.parentId || !ids.has(f.parentId) : f.parentId === parent,
    );
  const out: FolderOption[] = [];
  const walk = (parent: string | null, path: string[], depth: number): void => {
    if (depth > 12) return;
    for (const f of kids(parent)) {
      const label = [...path, f.name].join(' › ');
      if (!onlyCreate || f.my.create) out.push({ id: f.id, label, folder: f });
      walk(f.id, [...path, f.name], depth + 1);
    }
  };
  walk(null, [], 0);
  return out;
}

// ───────────────────────────── «Новый документ» ─────────────────────────────

export interface CreateDraft {
  kind: CreateKind;
  title: string;
  folderId: string;
  files: number;
  needsLink: boolean;
  link: string;
  template?: boolean;
}

/** Название папки: 2–200 символов (DocFolderCreate.name). */
export function folderNameError(name: string): string | undefined {
  const n = name.trim().length;
  if (n < 2) return T.folder.errName;
  if (n > 200) return T.folder.errNameLong;
  return undefined;
}

export function createErrors(d: CreateDraft): Record<string, string> {
  const e: Record<string, string> = {};
  if (d.title.trim().length < 2) e.title = T.create.errTitle;
  if (!d.folderId) e.folderId = T.create.errFolder;
  if ((d.kind === 'pdf' || d.kind === 'scan') && !d.files && !d.template)
    e.files = T.create.errFiles;
  if (d.needsLink && !d.link) e.link = T.create.errLink;
  return e;
}

// ───────────────────────────── доступ ─────────────────────────────

/** «Что изменится» перед сохранением доступа или переносом (diffAccess). */
export function impactLines(i: S['DocAccessImpact']): string[] {
  const out: string[] = [];
  for (const p of i.gain) {
    out.push(fill(T.share.impactGain, { name: p.member.displayName, level: levelName(p.to) }));
  }
  for (const p of [...i.up, ...i.down]) {
    out.push(
      fill(T.share.impactChange, {
        name: p.member.displayName,
        from: levelName(p.from),
        to: levelName(p.to),
      }),
    );
  }
  if (i.lose.length) {
    out.push(
      fill(T.share.impactLose, { names: i.lose.map((p) => p.member.displayName).join(', ') }),
    );
  }
  return out;
}

export function shareHint(o: { owner: boolean; my: S['DocMy'] }): string {
  if (o.owner) return T.share.youOwner;
  if (o.my.level === 'manage') return T.share.youManage;
  return fill(T.share.youLevel, { level: levelName(o.my.level), max: levelName(o.my.maxGrant) });
}

const DAY = 86_400_000;
const utc = (iso: string): number => {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(iso);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Number.NaN;
};
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** Срок внешней ссылки по умолчанию: сегодня + 14 дней (Q-W4.00-documents-4). */
export const extExpiry = (today: string): string => iso(utc(today) + 14 * DAY);

/** Не раньше сегодня и не позже сегодня + 30 дней (DOC-06). */
export function extExpiryError(date: string, today: string): string | null {
  const d = utc(date);
  const t = utc(today);
  if (Number.isNaN(d) || d < t || d > t + 30 * DAY) return T.share.extMax;
  return null;
}

/** Срок на конец дня (UTC 23:59:59 по московскому дню). */
export const endOfDay = (date: string): string => `${date}T20:59:59Z`;

/** Локальная дата (YYYY-MM-DD) в Москве. */
export function todayOf(now: number): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: MSK,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return p;
}
