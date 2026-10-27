// W6.24 · Общие части вкладок объекта: права, шапка раздела (h2 + пояснение), чип статуса, ожидание и ошибка загрузки,
// отказ доступа к деньгам объекта. Тон и размеры — токены @ortus/tokens, разметка — как у эталона (`section`
// с `aria-labelledby`, заголовок h2 20 px).
import type { UseQueryResult } from '@tanstack/react-query';
import { format, shell } from '@ortus/texts';
import { Banner, Skeleton, Status } from '@ortus/ui';
import type { ReactElement, ReactNode } from 'react';

import { useCan, useShell } from '../../../shell/context.tsx';
import { problemText } from '../../../shell/run.tsx';
import type { Chip } from './model.ts';
import { MONEY_TEXT } from './texts.ts';
import './money.css';

export interface TabProps {
  tenantId: string;
  projectId: string;
}

export interface Caps {
  /** Модуль отключён с историей: действия закрыты. */
  readOnly: boolean;
  /** Право или владелец (команды всё равно проверяет сервер). */
  has: (permission: string) => boolean;
  finance: boolean;
}

export function useCaps(): Caps {
  const { audience, readOnly } = useShell();
  const can = useCan();
  const owner = audience === 'owner';
  const has = (permission: string): boolean => owner || can(permission);
  return { readOnly, has, finance: has('repairs.finance.read') };
}

/** Действие доступно: есть право (любое из списка) и модуль не в режиме чтения. */
export function useMay(...permissions: string[]): boolean {
  const { readOnly, has } = useCaps();
  return !readOnly && permissions.some((p) => has(p));
}

export function Head(p: { id: string; title: string; intro: string }): ReactElement {
  return (
    <div className="ox-mt-head">
      <h2 id={p.id} className="ox-mt-h2">
        {p.title}
      </h2>
      <p className="ox-mt-intro">{p.intro}</p>
    </div>
  );
}

export function Section(p: { id: string; label: string; children: ReactNode }): ReactElement {
  return (
    <section aria-labelledby={p.id} data-screen-label={p.label} className="ox-mt">
      {p.children}
    </section>
  );
}

export function StatusChip({ chip }: { chip: Chip }): ReactElement {
  return (
    <Status tone={chip.tone} icon={chip.icon}>
      {chip.label}
    </Status>
  );
}

/** Ожидание и ошибка загрузки одним блоком; данные — в `children`. */
export function Loaded<T>(p: {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
}): ReactElement {
  const { query } = p;
  if (query.isError) {
    return (
      <Banner
        tone="danger"
        role="alert"
        title={format(MONEY_TEXT.loadFailed, { error: problemText(query.error) })}
        action={{ label: MONEY_TEXT.retry, onPress: () => void query.refetch() }}
      />
    );
  }
  if (query.data === undefined) return <Skeleton lines={4} label={shell.a11y.loading} />;
  return <>{p.children(query.data)}</>;
}

/** Деньги объекта без права `repairs.finance.read`: вкладки нет, а прямой вход — отказ. */
export function Denied(): ReactElement {
  return (
    <Banner tone="warn" icon="lock" title={MONEY_TEXT.denied.title} text={MONEY_TEXT.denied.text} />
  );
}
