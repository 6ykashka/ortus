// W6.20 · Общие части страницы «Объекты»: чип статуса, полоса «принято / на приёмке», навигация внутри страницы
// (`?obj=&tab=&filter=&q=`, ADR-0001), часы страницы и тексты ошибок команд.
import { ProblemError } from '@ortus/api-client';
import { Icon } from '@ortus/ui';
import { useLocation, useNavigate } from '@tanstack/react-router';
import type { ReactElement } from 'react';

import { type Chip } from './model.ts';

export function ChipView({ chip }: { chip: Chip }): ReactElement {
  return (
    <span className="ox-rp-chip" data-tone={chip.tone}>
      <Icon name={chip.icon} size={15} />
      {chip.label}
    </span>
  );
}

export function Meter(p: { accepted: number; pending: number; size?: 'lg' }): ReactElement {
  return (
    <span className="ox-rp-meter" data-size={p.size} aria-hidden="true">
      <span className="ox-rp-meter-done" style={{ width: `${p.accepted}%` }} />
      <span className="ox-rp-meter-pend" style={{ width: `${p.pending}%` }} />
    </span>
  );
}

const asText = (v: unknown): string | undefined =>
  v === undefined || v === null || v === '' ? undefined : String(v);

export interface RepairSearch {
  obj?: string;
  tab?: string;
  filter?: string;
  q: string;
}

/** Параметры адреса страницы; числа и логические значения разбора роутера возвращаются в строки. */
export function useRepairSearch(): RepairSearch {
  const s = useLocation().search as Record<string, unknown>;
  const obj = asText(s.obj);
  const tab = asText(s.tab);
  const filter = asText(s.filter);
  return {
    ...(obj ? { obj } : {}),
    ...(tab ? { tab } : {}),
    ...(filter ? { filter } : {}),
    q: asText(s.q) ?? '',
  };
}

/** Переход внутри страницы: `replace` — для фильтров и поиска (без записи в историю на каждый символ). */
export function useRepairNav(
  tenantId: string,
): (search: Record<string, string>, replace?: boolean) => void {
  const navigate = useNavigate();
  return (search, replace = false) =>
    void navigate({
      to: '/t/$tenantId/$page',
      params: { tenantId, page: 'repair' },
      search: search as never,
      replace,
    });
}

/** «Сегодня» по Москве, `гггг-мм-дд` (часы страницы; даты эталона — московские). */
export function todayIso(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(now);
}

/** Текст ответа сервера: первое нарушение поля, иначе detail (409/422 показывают текст сервера). */
export function serverText(e: unknown): string | undefined {
  if (!(e instanceof ProblemError)) return undefined;
  return e.problem?.violations?.[0]?.message ?? e.problem?.detail ?? undefined;
}
