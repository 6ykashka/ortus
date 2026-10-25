// Маршрут документа для чтения (documents.js 14.10:162–198): кто ждёт на шаге, что ждёт участника,
// значок статуса. Движок маршрута (`activate`, `advance`, `syncTask`) и `routeSheet` — W7.22.
import { pluralN } from '../../../core/format.ts';
import { isDocOwner } from './access.ts';
import type { DocItem, DocStatusBadge, DocsTenantDb, DocWait, RouteStep } from './types.ts';

/** Кто ещё должен действовать на шаге; у неактивного шага — никто. */
export function stepWaiting(st: RouteStep | undefined): string[] {
  if (!st || st.status !== 'active') return [];
  if (st.kind === 'approve') {
    const ok = new Set(st.decisions.filter((x) => x.decision === 'ok').map((x) => x.member));
    const left = st.who.filter((id) => !ok.has(id));
    return st.mode === 'seq' ? left.slice(0, 1) : st.mode === 'any' ? (ok.size ? [] : left) : left;
  }
  if (st.kind === 'sign')
    return st.decisions.some((x) => x.decision === 'ok') ? [] : st.who.slice(0, 1);
  if (st.kind === 'ext') return st.decisions.some((x) => x.decision === 'ok') ? [] : ['ext'];
  if (st.kind === 'ack') {
    const done = new Set((st.done ?? []).map((x) => x.member));
    return (st.people ?? []).filter((id) => !done.has(id));
  }
  return [];
}

/** Что ждёт участника по документу: шаг маршрута, возврат автору, упоминание, слова OCR. */
export function docWaits(db: DocsTenantDb, mid: string, d: DocItem): DocWait[] {
  const w: DocWait[] = [];
  const r = d.route;
  if (r?.status === 'active') {
    const st = r.steps[r.cur];
    if (st && stepWaiting(st).includes(mid)) w.push({ kind: st.kind, due: st.due });
  }
  if (r?.status === 'returned' && r.by === mid) {
    w.push({ kind: 'returned', who: r.back?.name, comment: r.back?.comment });
  }
  for (const c of d.comments) {
    if (!c.resolved && c.mention === mid && !c.replies.some((x) => x.byId === mid)) {
      w.push({
        kind: 'mention',
        cid: c.id,
        by: db.members.find((m) => m.id === c.by)?.name,
        text: c.text,
      });
    }
  }
  const open = d.ocr?.status === 'done' ? (d.ocr.words ?? []).filter((x) => x.st === 'open') : [];
  if (open.length && (d.owner === mid || isDocOwner(db, mid)))
    w.push({ kind: 'ocr', n: open.length });
  return w;
}

/** Значок статуса документа: тон, значок и подпись. */
export function docStatus(d: DocItem): DocStatusBadge {
  const r = d.route;
  if (r?.status === 'active') {
    const st = r.steps[r.cur];
    if (st?.kind === 'approve') {
      const ok = st.decisions.filter((x) => x.decision === 'ok').length;
      return [
        'info',
        'task_alt',
        'Согласование · ' + ok + ' из ' + (st.mode === 'any' ? 1 : st.who.length),
      ];
    }
    if (st?.kind === 'sign') return ['warn', 'approval', 'Утверждение · ждёт подписи'];
    if (st?.kind === 'ext') return ['warn', 'signature', 'Подпись заказчика · SMS'];
    if (st?.kind === 'ack') {
      return [
        'info',
        'visibility',
        'Ознакомление · ' + (st.done ?? []).length + ' из ' + (st.people ?? []).length,
      ];
    }
  }
  if (r?.status === 'returned') return ['warn', 'undo', 'На доработке'];
  if (d.pdfa) {
    return d.status === 'signed'
      ? ['ok', 'verified', 'PDF/A · подписанная копия']
      : ['neutral', 'inventory_2', 'PDF/A · архив'];
  }
  if (d.status === 'signed') return ['ok', 'verified', 'Подписан · ПЭП'];
  if (d.status === 'approved') return ['ok', 'verified', 'Утверждён · ПЭП'];
  if (d.status === 'agreed') return ['ok', 'check_circle', 'Согласован'];
  const jr = (d.jobs ?? []).find((j) => j.status === 'running');
  if (jr) return ['info', 'hourglass_top', jr.name + '…'];
  const n =
    d.ocr?.status === 'done' ? (d.ocr.words ?? []).filter((x) => x.st === 'open').length : 0;
  if (n) return ['warn', 'document_scanner', 'Проверить ' + pluralN(n, 'слово', 'слова', 'слов')];
  if ((d.presence ?? []).length) return ['info', 'edit', 'Правят сейчас · ' + d.presence.length];
  return ['neutral', 'edit_note', 'Черновик'];
}
