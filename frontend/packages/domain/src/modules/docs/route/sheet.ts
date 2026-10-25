// Лист согласования (documents.js 14.10:199–213): кто и как решил на каждом шаге маршрута, плюс
// слепок версии. Его печатает последняя страница PDF/A-копии. Чистая функция: время и БД не меняет.
import { pluralN } from '../../../core/format.ts';
import type { DocItem, DocsTenantDb } from '../core/types.ts';
import { shaOf } from '../core/util.ts';
import type { RDoc, RRoute, RouteSheetResult, RouteSheetRow } from './types.ts';

const EMPTY: RouteSheetResult = { rows: [], v: 0, sha: '' };

/**
 * `r` — маршрут (по умолчанию текущий маршрут документа); `noAck` — без строки ознакомления
 * (в PDF/A её нет: ознакомление идёт после утверждения).
 */
export function routeSheet(
  db: DocsTenantDb,
  doc: DocItem | RDoc,
  r?: RRoute,
  noAck?: boolean,
): RouteSheetResult {
  const d = doc as RDoc;
  const route = r ?? d.route;
  if (!route) return { ...EMPTY, v: d.v };
  const nm = (id: string): string => db.members.find((m) => m.id === id)?.name || id;
  const rows: RouteSheetRow[] = [];
  route.steps.forEach((st, i) => {
    const s = i + 1 + ' · ' + st.name;
    const wait = st.status === 'wait' ? 'после шага ' + i : 'ждёт';
    if (st.kind === 'ack') {
      if (noAck) return;
      const people = st.people ?? [];
      rows.push({
        s,
        w:
          st.status === 'wait'
            ? 'после утверждения'
            : pluralN(people.length, 'сотрудник', 'сотрудника', 'сотрудников'),
        r: st.status === 'wait' ? '—' : (st.done ?? []).length + ' из ' + people.length,
        at: '',
      });
      return;
    }
    if (st.kind === 'ext') {
      const x = st.decisions.find((y) => y.decision === 'ok');
      rows.push({
        s,
        w: st.ext?.name ?? '',
        r: x ? 'Подписал(а) · код из SMS' + (x.demo ? ' · демо' : '') : wait,
        at: x ? x.at : '',
      });
      return;
    }
    for (const id of st.who) {
      const x = st.decisions.filter((y) => y.member === id).slice(-1)[0];
      const res = x
        ? x.decision === 'ok'
          ? (st.kind === 'sign' ? 'Утвердил(а) · ПЭП, код из SMS' : 'Согласовал(а)') +
            (x.demo ? ' · демо' : '')
          : 'Вернул(а) на доработку'
        : st.status === 'done'
          ? 'не потребовалось'
          : wait;
      rows.push({ s, w: nm(id), r: res, at: x ? x.at : '' });
    }
  });
  const ver = d.versions.find((x) => x.v === route.v);
  return {
    rows,
    v: route.v,
    sha: shaOf(ver ? ver.body || ver.sheets || ver.pages || ver.v : route.v),
  };
}
