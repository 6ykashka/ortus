// Сводка объекта и список объектов (Ортус CRM.dc.html:4284–4355, 19.10): «Требует решения»,
// готовность, срок сдачи, фильтры «Активные · Требуют решения · До договора · Сданы», поиск и
// сортировка «сначала то, что ждёт решения». Чистые функции: действия кнопок — описания
// (`TodoAction`), страница сама вызывает команды; «сегодня» — часы домена (Q-W4.00-repair-15).
import { can, grants } from '../../core/access/index.ts';
import { ddmmyyyy, type Clock } from '../../core/clock.ts';
import { foremanIdOf } from '../../core/entries.ts';
import { num, plural } from '../../core/format.ts';
import type { ToneKey } from '../../core/types/index.ts';
import type {
  ChangeOrder,
  EstimateState,
  ObjectSections,
  RepairDb,
  RepairObject,
  RepairWork,
  SchedStatus,
  WorkLog,
} from './types.ts';

/** Кто смотрит: права и персона (`cx` эталона). */
export interface RepairContext {
  mid: string;
  /** ФИО участника. */
  me: string;
  /** Персона «прораб»: отметки отправляет только она. */
  isFm: boolean;
  canLog: boolean;
  canReview: boolean;
  canEdit: boolean;
  canFin: boolean;
}

export function repairContext(db: RepairDb, mid: string, persona: string): RepairContext {
  const isFm = persona === 'foreman';
  return {
    mid,
    me: db.members.find((m) => m.id === mid)?.name ?? '',
    isFm,
    canLog: can(db, mid, 'repair', 'create').ok && isFm,
    canReview: can(db, mid, 'repair', 'review').ok,
    canEdit: can(db, mid, 'repair', 'edit').ok,
    canFin: grants(db, mid).some((g) => g.roleObj.all || g.roleObj.finance.read),
  };
}

/** Сводка дочернего модуля, которую страница передаёт в CRM (`rpChild`/`onStatus`). */
export interface ChildStatus {
  sched?: SchedStatus;
  req?: string[];
  draft?: string[];
  sms?: string[];
  est?: EstimateState;
  estLabel?: string;
  fin?: ObjectSections['fin'];
  /** Состояние и подпись сметы объектов-черновиков. */
  objEst?: Record<string, { st: EstimateState; label: string }>;
  /** Заявки на материалы по объектам. */
  reqBy?: Record<string, string[]>;
}

export type TodoAction =
  | { kind: 'assign-foreman' }
  | { kind: 'accept-log'; logId: string }
  | { kind: 'open'; tab: string }
  | { kind: 'open-supply' };

export interface TodoItem {
  icon: string;
  tone: ToneKey;
  tag: string;
  title: string;
  meta: string;
  /** Подпись кнопки; пусто — кнопки нет. */
  primary: string;
  action: TodoAction | null;
  /** Вкладка карточки, к которой относится пункт. */
  tab: string;
}

export interface ObjectSummary {
  o: RepairObject;
  done: boolean;
  draft: boolean;
  est: EstimateState;
  estLabel: string;
  changes: ChangeOrder[];
  works: RepairWork[];
  logs: WorkLog[];
  pending: WorkLog[];
  factSum: number;
  pendSum: number;
  /** Готовность по объёмам, %: принято и на приёмке (дополняет до 100). */
  readiness: { accepted: number; pending: number };
  cs: ObjectSections;
  canLog: boolean;
  todo: TodoItem[];
  /** Срок сдачи по договору (по сводке модуля, иначе из объекта). */
  due: string | null;
  /** Прогноз сдачи, если срок сдвигается. */
  slip: string | null;
}

const NONE: ObjectSections = { req: [], draft: [], sms: [], est: 'draft', fin: null };

const ESTIMATE_DEFAULT_LABEL = 'Смета не собрана';

/** Сводка объекта — одна для строки списка и карточки. */
export function repairSum(
  db: RepairDb,
  o: RepairObject,
  cx: RepairContext,
  child: ChildStatus | null = null,
): ObjectSummary {
  const r = db.repair;
  const done = o.stage === 'Сдан';
  const draft = !!o.draft;
  const works = (r?.works ?? []).filter((w) => w.obj === o.id);
  const logs = (r?.logs ?? []).filter((l) => l.obj === o.id);
  const pending = logs.filter((l) => l.status === 'На проверке');
  const work = (id: string): RepairWork | undefined => works.find((x) => x.id === id);
  const crewName = (id: string): string | undefined => r?.crew.find((c) => c.id === id)?.name;
  const planSum = works.reduce((a, w) => a + w.plan, 0) || 1;
  const factSum = works.reduce((a, w) => a + w.fact, 0);
  const pendSum = pending.reduce((a, l) => a + l.volume, 0);
  const pc = (x: number): number => Math.min(100, Math.round((x / planSum) * 100));
  const oe = child?.objEst?.[o.id];
  const cs: ObjectSections =
    (o.sections === true && child ? (child as ObjectSections) : o.st) ?? NONE;
  const sc = cs.sched;
  const est: EstimateState = draft ? (oe ? oe.st : (cs.est ?? 'none')) : (cs.est ?? 'draft');
  const changes = (r?.changes ?? []).filter((c) => c.obj === o.id);
  const foremanHere = foremanIdOf(db, o.id) === cx.mid;
  const canLog = cx.canLog && !done && foremanHere && works.some((w) => w.fact < w.plan);

  const todo: TodoItem[] = [];
  const add = (
    icon: string,
    tone: ToneKey,
    tag: string,
    title: string,
    meta: string,
    primary: string,
    action: TodoAction | null,
    tab: string,
  ): void => {
    todo.push({ icon, tone, tag, title, meta, primary, action, tab });
  };
  const open = (tab: string): TodoAction => ({ kind: 'open', tab });

  if (!done && !draft) {
    if (!o.foreman && cx.canEdit) {
      add(
        'person_off',
        'warn',
        'Команда',
        'Не назначен прораб',
        'Без прораба нет отметок работ и заявок на материалы' +
          (o.start ? ' · начало работ ' + o.start : ''),
        'Назначить прораба',
        { kind: 'assign-foreman' },
        'overview',
      );
    }
    for (const l of pending) {
      const w = work(l.work);
      const what = (w?.name ?? '—') + ': ' + num(l.volume) + ' ' + (w?.unit ?? '');
      if (cx.canReview && !cx.isFm) {
        add(
          'fact_check',
          'warn',
          'Приёмка',
          what,
          'Отметка ' +
            l.id +
            ' · ' +
            (l.by || 'прораб') +
            ', ' +
            l.at +
            ' · фото: ' +
            l.photos +
            (l.crew.length ? ' · ' + l.crew.map(crewName).join(', ') : ''),
          'Принять объём',
          { kind: 'accept-log', logId: l.id },
          'works',
        );
      } else {
        add(
          'pending',
          'info',
          'Приёмка',
          'Отметка ' + l.id + ' ждёт приёмки',
          what + ' · отправлена ' + l.at,
          '',
          null,
          'works',
        );
      }
    }
    if (canLog && !pending.length) {
      add(
        'today',
        'neutral',
        'Сегодня',
        'Отметка за сегодня не отправлена',
        'Объём, бригада, материалы и фото — одной формой',
        'Отметить работу',
        open('works'),
        'works',
      );
    }
    if (sc?.slip) {
      add(
        'event_busy',
        'warn',
        'График',
        'Сдача сдвигается на ' + (sc.slipText ?? '') + ': прогноз ' + sc.forecast,
        'По договору ' + sc.due + (sc.why ? ' · ' + sc.why : ''),
        'Открыть график',
        open('schedule'),
        'schedule',
      );
    }
    if (sc?.noWho?.length) {
      add(
        'person_off',
        'neutral',
        'График',
        'Не назначен исполнитель: ' + sc.noWho.join(', '),
        'Без исполнителя этап не начнётся в срок',
        'Открыть график',
        open('schedule'),
        'schedule',
      );
    }
    for (const d of cs.sms ?? []) {
      add(
        'sms',
        'warn',
        'Документы',
        d + ': ждёт подписи заказчика',
        'Заказчик подписывает в кабинете кодом из SMS',
        'Открыть документы',
        open('docs'),
        'docs',
      );
    }
    if (cx.canFin) {
      for (const d of cs.draft ?? []) {
        add(
          'draw',
          'neutral',
          'Документы',
          d + ': готов к отправке',
          'После подписи заказчиком откроется оплата бригаде',
          'Открыть документы',
          open('docs'),
          'docs',
        );
      }
    }
    const reqs = child?.reqBy?.[o.id] ?? cs.req ?? [];
    if (reqs.length) {
      add(
        'shopping_cart',
        'info',
        'Снабжение',
        'Заявки на материалы ждут решения снабжения: ' + reqs.length,
        reqs.join(' · ') + ' · выдать со склада или купить',
        'Решить в снабжении',
        { kind: 'open-supply' },
        'supply',
      );
    }
    if (cx.canFin && cs.est === 'sent') {
      add(
        'schedule_send',
        'warn',
        'Смета',
        (cs.estLabel ?? 'Смета') + ' у заказчика',
        'Ждёт согласования в кабинете заказчика',
        'Открыть смету',
        open('estimate'),
        'estimate',
      );
    }
    for (const c of changes) {
      const what = c.title + ': ' + num(c.volume) + ' ' + c.unit;
      const office = !cx.isFm && cx.canEdit && cx.canFin;
      if (office && c.status === 'proposed') {
        add(
          'request_quote',
          'warn',
          'Допработы',
          what,
          c.id +
            ' · предложил ' +
            c.by +
            ', ' +
            c.at +
            ' · фото: ' +
            c.photos +
            ' · оцените в смете и отправьте допсоглашение заказчику',
          'Оценить в смете',
          open('estimate'),
          'estimate',
        );
      } else if (office && c.status === 'priced') {
        add(
          'edit_note',
          'neutral',
          'Допработы',
          c.id + ' в черновике допсоглашения',
          what + ' · проверьте строки и отправьте заказчику на подпись',
          'Открыть смету',
          open('estimate'),
          'estimate',
        );
      } else if (cx.isFm && (c.status === 'proposed' || c.status === 'priced')) {
        add(
          'pending',
          'info',
          'Допработы',
          c.id + ' у офиса на оценке',
          what + ' · отправлена ' + c.at,
          '',
          null,
          'works',
        );
      } else if (cx.isFm && c.status === 'sent') {
        add(
          'sms',
          'info',
          'Допработы',
          c.id + ' в допсоглашении у заказчика',
          what + ' · ждёт подписи кодом из SMS',
          '',
          null,
          'works',
        );
      }
    }
  }
  if (draft && cx.canFin && cx.canEdit) {
    const lab = oe ? oe.label : ESTIMATE_DEFAULT_LABEL;
    if (est === 'none') {
      add(
        'request_quote',
        'warn',
        'Смета',
        'Смета не собрана',
        'Замер выполнен ' +
          (o.measured ?? '') +
          ' · соберите черновик по шаблону: объёмы из замера, цены из справочника',
        'Собрать смету',
        open('estimate'),
        'estimate',
      );
    } else if (est === 'draft') {
      add(
        'edit_note',
        'neutral',
        'Смета',
        'Черновик сметы не отправлен заказчику',
        lab,
        'Открыть смету',
        open('estimate'),
        'estimate',
      );
    } else if (est === 'sent') {
      add(
        'schedule_send',
        'info',
        'Смета',
        'Смета у заказчика на согласовании',
        lab,
        'Открыть смету',
        open('estimate'),
        'estimate',
      );
    } else {
      add(
        'handshake',
        'info',
        'Договор',
        'Смета согласована: следующий шаг — договор',
        lab + ' · договор готовится на этапе заявки «Договор»',
        '',
        null,
        'estimate',
      );
    }
  }
  return {
    o,
    done,
    draft,
    est,
    estLabel: draft ? (oe ? oe.label : ESTIMATE_DEFAULT_LABEL) : '',
    changes,
    works,
    logs,
    pending,
    factSum,
    pendSum,
    readiness: { accepted: pc(factSum), pending: Math.min(100 - pc(factSum), pc(pendSum)) },
    cs,
    canLog,
    todo,
    due: sc?.due || o.due || null,
    slip: !done && sc?.slip ? sc.forecast : null,
  };
}

/** Дней от «сегодня» (по часам домена, Москва) до даты `ДД.ММ` этого года; иначе `null`. */
export function daysUntil(clock: Clock, dm: string | null | undefined): number | null {
  const m = /^(\d{1,2})\.(\d{1,2})$/.exec(String(dm ?? ''));
  if (!m) return null;
  const [d0, m0, y0] = ddmmyyyy(clock).split('.').map(Number);
  const from = Date.UTC(y0 ?? 0, (m0 ?? 1) - 1, d0 ?? 1);
  return Math.round((Date.UTC(y0 ?? 0, Number(m[2]) - 1, Number(m[1])) - from) / 86_400_000);
}

export const EMPTY_LIST_TEXT = {
  foremanNone: {
    icon: 'home_work',
    title: 'Вам пока не назначены объекты',
    text: 'Объект появится здесь, когда владелец назначит вас прорабом.',
  },
  ownerNone: {
    icon: 'home_work',
    title: 'Объектов пока нет',
    text: 'Объект-черновик создаётся из заявки на этапе «Замер».',
  },
} as const;

export interface ListEmpty {
  icon: string;
  title: string;
  text: string;
}

export interface ListRow extends ObjectSummary {
  /** Строка срока сдачи под датой («через 16 дней», «прогноз · по договору …»). */
  dueSub: string;
  dueLabel: string;
  /** Дата в колонке «Сдача»: прогноз, сдача или замер. */
  dueText: string;
  stageKind: 'done' | 'draft' | 'active';
  stageLabel: string;
  showBar: boolean;
  /** Принято и на приёмке, % (для полосы готовности). */
  accepted: number;
  pendingPct: number;
  foreman: string;
  top: TodoItem | null;
  /** «ещё N вопроса»; пусто, если вопрос один или нет. */
  more: string;
  /** Тяжесть главного вопроса для сортировки (9 — сдан, 5 — вопросов нет). */
  sev: number;
  /** Дней до срока для сортировки (`null` — срока нет). */
  dd: number | null;
}

export interface RepairListFilter {
  key: string;
  label: string;
  n: number;
}

export interface RepairListInput {
  db: RepairDb;
  objects: readonly RepairObject[];
  cx: RepairContext;
  child: ChildStatus | null;
  today: Clock;
  filter?: string;
  q?: string;
}

export interface RepairListResult {
  key: string;
  filters: RepairListFilter[];
  rows: (ListRow & { dueText: string })[];
  empty: ListEmpty | null;
  subtitle: string | null;
  hasSearch: boolean;
  showForeman: boolean;
}

const TONE_WEIGHT: Record<ToneKey, number> = { danger: 0, warn: 1, info: 2, neutral: 3, ok: 4 };

const dn = (n: number): string => n + ' ' + plural(n, 'день', 'дня', 'дней');

export function repairList(i: RepairListInput): RepairListResult {
  const { cx } = i;
  const all = i.objects
    .map((o) => repairSum(i.db, o, cx, i.child))
    .map((x): ListRow => {
      const { o } = x;
      const k = x.todo.length - 1;
      const acc = x.readiness.accepted;
      const d = daysUntil(i.today, o.due);
      const dueSub = x.draft
        ? 'договора ещё нет'
        : x.done
          ? o.warranty
            ? 'гарантия до ' + o.warranty
            : ''
          : x.slip
            ? 'прогноз · по договору ' + x.due
            : d == null
              ? ''
              : d > 0
                ? 'через ' + dn(d)
                : d === 0
                  ? 'сегодня'
                  : 'просрочено на ' + dn(-d);
      return {
        ...x,
        dueSub,
        dueLabel: x.done ? 'Сдан' : x.draft ? 'Замер' : 'Сдача',
        dueText: (x.done ? o.handedOver : x.draft ? o.measured : x.slip || x.due) || '—',
        stageKind: x.done ? 'done' : x.draft ? 'draft' : 'active',
        stageLabel: x.done ? 'Сдан' : x.draft ? o.stage + ' · до договора' : o.stage,
        showBar: !x.draft,
        accepted: acc,
        pendingPct: x.done ? 0 : x.readiness.pending,
        foreman: x.draft ? 'после договора' : (o.foreman ?? 'не назначен'),
        top: x.todo[0] ?? null,
        more: k > 0 ? 'ещё ' + k + ' ' + plural(k, 'вопрос', 'вопроса', 'вопросов') : '',
        sev: x.done ? 9 : x.todo.length ? Math.min(...x.todo.map((t) => TONE_WEIGHT[t.tone])) : 5,
        dd: daysUntil(i.today, x.slip || x.due),
      };
    });
  const active = all.filter((x) => !x.done && !x.draft);
  const pre = all.filter((x) => x.draft);
  const groups: [string, string, ListRow[]][] = [
    ['active', 'Активные', active],
    ...(cx.isFm
      ? []
      : ([
          ['todo', 'Требуют решения', [...active, ...pre].filter((x) => x.todo.length)],
          ['pre', 'До договора', pre],
        ] as [string, string, ListRow[]][])),
    ['done', 'Сданы', all.filter((x) => x.done)],
  ];
  const key = groups.some((g) => g[0] === i.filter) ? (i.filter as string) : 'active';
  const q = (i.q ?? '').trim().toLowerCase();
  const rows = (groups.find((g) => g[0] === key)?.[2] ?? [])
    .filter(
      (x) =>
        !q || [x.o.name, x.o.address, x.o.client, x.o.foreman].join(' ').toLowerCase().includes(q),
    )
    .sort((a, b) => a.sev - b.sev || (a.dd ?? 999) - (b.dd ?? 999));
  const none = !i.objects.length;
  return {
    key,
    filters: groups.map(([k, label, arr]) => ({ key: k, label, n: arr.length })),
    rows,
    empty: rows.length
      ? null
      : none
        ? cx.isFm
          ? EMPTY_LIST_TEXT.foremanNone
          : EMPTY_LIST_TEXT.ownerNone
        : {
            icon: 'search_off',
            title: 'По фильтру объектов нет',
            text: q ? 'Измените запрос или очистите поиск.' : 'Выберите другой фильтр.',
          },
    subtitle: cx.isFm ? 'Объекты, где вы прораб' : null,
    hasSearch: !cx.isFm,
    showForeman: !cx.isFm,
  };
}
