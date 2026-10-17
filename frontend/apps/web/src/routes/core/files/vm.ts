// W1.24 · Модель «Файлов» (filesVM :4219–4231): строка файла (иконка, имя, родитель, чип, размер) по
// FileListItem и место организации «46,2 из 100 ГБ».
import type { components } from '@ortus/api-client';
import { ALL_MODULES, INDUSTRY, num } from '@ortus/domain';
import type { IconName, Tone } from '@ortus/ui';

import { gbText, usedBytes } from '../../company/modules/storage.ts';
import { FILES_TEXT, t } from './texts.ts';

type S = components['schemas'];

export interface FileRow {
  id: string;
  icon: IconName;
  name: string;
  parent: string;
  chip: { label: string; tone: Tone; icon: IconName };
  size: string;
  ready: boolean;
}

export interface FilesUsage {
  text: string;
  pct: string;
  tone: 'accent' | 'danger';
}

const MiB = 1024 ** 2;

/** «1,2 МБ», «16 МБ», «300 КБ»; отклонённый — «—» (:4226). */
export function fileSize(bytes: number, status: S['File']['status']): string {
  if (status === 'rejected' || bytes <= 0) return FILES_TEXT.size.none;
  if (bytes < MiB) return t(FILES_TEXT.size.kb, { n: Math.max(1, Math.round(bytes / 1024)) });
  return t(FILES_TEXT.size.mb, { n: num(Math.round((bytes / MiB) * 10) / 10) });
}

/**
 * Имя модуля по ключу контракта (fleet, repairs — отраслевые; прочие — CORE); неизвестный ключ — `null`
 * (код API пользователю не выводится).
 */
function moduleName(key: string): string | null {
  if (key === 'fleet') return INDUSTRY.logistics.name;
  if (key === 'repairs') return INDUSTRY.repair.name;
  return (ALL_MODULES as Record<string, { name: string } | undefined>)[key]?.name ?? null;
}

/** Ключи `FILES_TEXT.parents`, которые не являются видом родителя. */
const NOT_KINDS: ReadonlySet<string> = new Set(['other', 'unknown', 'foreign']);

/** Родитель файла: вид родителя (`fleet.trip` = `trip`) и его короткий заголовок `ownerTitle`. */
export function fileParent(item: S['FileListItem']): string {
  const P = FILES_TEXT.parents;
  const kind = item.owner.entityType.split('.').at(-1) ?? '';
  const title = item.ownerTitle;
  if (kind === 'reservation') return P.reservation;
  const known = (P as Record<string, string>)[kind];
  if (title && known && !NOT_KINDS.has(kind)) return t(known, { title });
  const module = moduleName(item.owner.moduleKey);
  if (module === null) return title ?? P.foreign;
  return title ? t(P.other, { module, title }) : t(P.unknown, { module });
}

/**
 * Адрес короткой ссылки «Открыть» для перехода: только `https:` и `http:` (стенд с MinIO), иначе `null`.
 * Защита в глубину: вкладка `about:blank` наследует origin приложения, `javascript:`/`data:` в ней выполнились
 * бы от его имени.
 */
export function safeDownloadUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
}

const CHIPS: Readonly<Record<S['File']['status'], FileRow['chip']>> = {
  ready: { label: FILES_TEXT.chips.ready, tone: 'ok', icon: 'check_circle' },
  quarantined: { label: FILES_TEXT.chips.quarantined, tone: 'info', icon: 'shield' },
  rejected: { label: FILES_TEXT.chips.rejected, tone: 'danger', icon: 'block' },
  pending_upload: { label: FILES_TEXT.chips.pending_upload, tone: 'info', icon: 'upload' },
};

/** Иконка (:4223–4226): фото осмотра, чек, затем по типу содержимого. */
function iconOf(item: S['FileListItem']): IconName {
  if (item.purpose === 'inspection' || item.purpose === 'repair_evidence') return 'photo_library';
  if (item.purpose === 'expense_receipt') return 'receipt';
  const type = item.file.contentType;
  if (type === 'application/pdf') return 'picture_as_pdf';
  if (type.startsWith('image/')) return 'image';
  if (/zip|compressed/.test(type)) return 'folder_zip';
  return 'description';
}

export function fileRow(item: S['FileListItem']): FileRow {
  const f = item.file;
  return {
    id: f.id,
    icon: iconOf(item),
    name: f.fileName,
    parent: fileParent(item),
    chip: CHIPS[f.status],
    size: fileSize(f.sizeBytes, f.status),
    ready: f.status === 'ready',
  };
}

/** Место на «Файлах» (:4228–4230): полоса без жёлтого порога, красная от 100 %. */
export function filesUsage(u: S['StorageUsage']): FilesUsage {
  const used = usedBytes(u);
  const pct = u.quotaBytes > 0 ? Math.min(100, (used / u.quotaBytes) * 100) : 100;
  return {
    text: t(FILES_TEXT.usage, { used: gbText(used), quota: gbText(u.quotaBytes) }),
    pct: pct.toFixed(1) + '%',
    tone: pct >= 100 ? 'danger' : 'accent',
  };
}
