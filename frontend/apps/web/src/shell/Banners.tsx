// W1.20 · Баннеры над страницей (bannersVM :3083–3098; 01-shell.md §11): пробный период завершён, модуль
// отключён с историей, нет связи, место организации заполнено (владельцу — свой текст и «Открыть «Модули и
// место»», остальным — текст сотрудника без кнопки). Оператору баннеров нет. Кнопка «Демо: продлить
// как оператор» не переносится (PD-54). Очередь отправки («Связь восстановлена.») — у владельцев офлайн-черновиков
// (этап 2), оболочка показывает число ожидающих, если страница его сообщит.
// Разметка и стили — рендер «Ортус CRM.dc.html» :174–180 (PD-28): текст 14/20,3 px наследуется от оболочки,
// `flex: 1 1 240px`, `text-wrap: pretty`, кнопка без фона с наследуемым шрифтом, рамка — LINE :2304. Banner из
// @ortus/ui следует витрине «Дизайн-система.dc.html» :275–278 (13 px, flex-basis 260 px, кнопка на белом) —
// для оболочки не подходит (вопрос владельцу @ortus/ui — в отчёте W1.20).
import { unwrap } from '@ortus/api-client';
import type { PageKey } from '@ortus/domain/nav';
import { banners as T, format } from '@ortus/texts';
import { Icon, type IconName } from '@ortus/ui';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement } from 'react';

import { useApi } from '../app/api.tsx';
import { moduleName } from './labels.ts';

export interface BannersProps {
  tenantId: string;
  page: PageKey | null;
  owner: boolean;
  online: boolean;
  tenantReadOnly: boolean;
  /** `tenantState.storageWriteStatus = blocked`; `null` — /me/context признака не прислал (стенд до W1.08). */
  storageBlocked: boolean | null;
  /** Модуль домена отключённого с историей модуля страницы (`moduleBanner`). */
  readonlyModule: string | null;
  goModules: () => void;
}

type BannerTone = 'warn' | 'neutral' | 'danger';

interface ShellBannerProps {
  tone: BannerTone;
  icon: IconName;
  title: string;
  text: string | undefined;
  action?: { label: string; onPress: () => void } | undefined;
}

/** Баннер оболочки (:174–180): role `alert` у `danger`, иначе `status` (mk :3085). */
function ShellBanner({ tone, icon, title, text, action }: ShellBannerProps): ReactElement {
  return (
    <div className="ox-banner" data-tone={tone} role={tone === 'danger' ? 'alert' : 'status'}>
      <Icon name={icon} size={20} />
      <div className="ox-banner-body">
        <strong className="ox-banner-title">{title}</strong> <span>{text}</span>
      </div>
      {action ? (
        <button type="button" className="ox-banner-action" onClick={action.onPress}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

const RO_TEXT = T.moduleReadonly.text as Record<string, string>;

/**
 * Место заполнено (эталон :3096 — все, кроме оператора). Признак каждого участника —
 * `tenantState.storageWriteStatus` из /me/context (0.4.0-stage1, без billing.read). Владельцу — ещё
 * getStorageUsage: «Модули и место» (W1.24) обновляет его сразу после смены лимита, не дожидаясь /me/context;
 * у стенда без `tenantState` это единственный источник.
 */
function useStorageFull(tenantId: string, owner: boolean, blocked: boolean | null): boolean {
  const api = useApi();
  const q = useQuery({
    queryKey: ['tenant', tenantId, 'storage'],
    enabled: owner,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/storage', {
          params: { path: { tenantId } },
        }),
      ),
  });
  const s = owner ? q.data : undefined;
  if (s) return s.writeStatus === 'blocked' || s.committedBytes >= s.quotaBytes;
  return blocked === true;
}

export function Banners(p: BannersProps): ReactElement | null {
  const storageFull = useStorageFull(p.tenantId, p.owner, p.storageBlocked);
  const out: ReactElement[] = [];
  if (p.tenantReadOnly) {
    out.push(
      <ShellBanner
        key="trial"
        tone="warn"
        icon="lock_clock"
        title={T.trialEnded.title}
        text={T.trialEnded.text}
      />,
    );
  }
  if (p.readonlyModule) {
    out.push(
      <ShellBanner
        key="ro"
        tone="neutral"
        icon="history"
        title={format(T.moduleReadonly.title, { name: moduleName(p.readonlyModule) })}
        text={RO_TEXT[p.readonlyModule]}
      />,
    );
  }
  if (!p.online) {
    out.push(
      <ShellBanner
        key="offline"
        tone="warn"
        icon="cloud_off"
        title={T.offline.title}
        text={format(T.offline.text, { queued: 0 })}
      />,
    );
  }
  if (storageFull) {
    out.push(
      <ShellBanner
        key="storage"
        tone="danger"
        icon="storage"
        title={T.storageFull.title}
        text={p.owner ? T.storageFull.textOwner : T.storageFull.textOther}
        action={
          p.owner && p.page !== 'modules'
            ? { label: T.storageFull.action, onPress: p.goModules }
            : undefined
        }
      />,
    );
  }
  return out.length ? <>{out}</> : null;
}
