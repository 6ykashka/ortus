// W2.24 · Черновик осмотра на устройстве (S2-15, LOG-11; ответ владельца 17.10 на D-09: «фото осмотра —
// офлайн-черновик, онлайн нужен только на «Выехать»»). Черновик шага смены (`draftKey` экрана: выезд — по брони,
// сдача — по попытке) хранится как `draft:<область>:<draftKey>`, фото слотов — Blob уже сжатого JPEG без EXIF
// (`blob:<область>:draft:<draftKey>:<слот>`). После перезапуска: готовые фото — «Загружено» (файл на сервере),
// не дошедшие до сервера — «На устройстве · ждёт связи» (queued) и уходят, когда есть связь; без файла на
// устройстве — пустой слот. Черновики других шагов и старше 7 дней удаляются (короткая жизнь данных на устройстве,
// 08-domain §9).
import type { DeviceStore } from '../../../../pwa/store.ts';
import { EMPTY_SLOT, type Draft, SIDES, type SideKey, type Slot } from '../model.ts';

export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Saved {
  draft: Draft;
  savedAt: string;
}

const draftKeyOf = (scope: string, key: string) => `draft:${scope}:${key}`;
const photoPrefix = (scope: string, key: string) => `blob:${scope}:draft:${key}:`;
const photoKeyOf = (scope: string, key: string, side: SideKey | 'receipt') =>
  `${photoPrefix(scope, key)}${side}`;

/** Слот без ссылки на превью (object URL живёт до перезагрузки). */
function stripSlot(s: Slot): Slot {
  const out: Slot = { state: s.state, progress: s.progress };
  if (s.fileId) out.fileId = s.fileId;
  if (s.capturedAt) out.capturedAt = s.capturedAt;
  return out;
}

export async function saveDraft(
  store: DeviceStore,
  scope: string,
  key: string,
  draft: Draft,
  now = new Date(),
): Promise<void> {
  const photos = Object.fromEntries(
    SIDES.map((s) => [s.key, stripSlot(draft.photos[s.key])]),
  ) as Draft['photos'];
  const saved: Saved = { draft: { ...draft, photos }, savedAt: now.toISOString() };
  await store.set(draftKeyOf(scope, key), saved);
}

export async function putPhoto(
  store: DeviceStore,
  scope: string,
  key: string,
  side: SideKey | 'receipt',
  blob: Blob,
): Promise<void> {
  await store.set(photoKeyOf(scope, key, side), blob);
}

export async function getPhoto(
  store: DeviceStore,
  scope: string,
  key: string,
  side: SideKey | 'receipt',
): Promise<Blob | undefined> {
  return store.get<Blob>(photoKeyOf(scope, key, side));
}

const objectUrl = (b: Blob): string | undefined =>
  typeof URL.createObjectURL === 'function' ? URL.createObjectURL(b) : undefined;

/** Черновик с устройства; нет или старше 7 дней — `undefined`. */
export async function loadDraft(
  store: DeviceStore,
  scope: string,
  key: string,
  o: { now?: Date; url?: (b: Blob) => string | undefined } = {},
): Promise<Draft | undefined> {
  const saved = await store.get<Saved>(draftKeyOf(scope, key));
  if (!saved) return undefined;
  const now = (o.now ?? new Date()).getTime();
  if (now - Date.parse(saved.savedAt) > DRAFT_TTL_MS) return undefined;
  const url = o.url ?? objectUrl;
  const photos = {} as Draft['photos'];
  for (const s of SIDES) {
    const slot = saved.draft.photos[s.key] ?? EMPTY_SLOT;
    const blob = slot.state === 'empty' ? undefined : await getPhoto(store, scope, key, s.key);
    const preview = blob ? url(blob) : undefined;
    const withUrl = (x: Slot): Slot => (preview ? { ...x, url: preview } : x);
    if (slot.state === 'ready' && slot.fileId) photos[s.key] = withUrl(stripSlot(slot));
    else if (blob) {
      const q: Slot = { state: 'queued', progress: 0 };
      if (slot.capturedAt) q.capturedAt = slot.capturedAt;
      photos[s.key] = withUrl(q);
    } else photos[s.key] = EMPTY_SLOT;
  }
  return { ...saved.draft, photos };
}

/** Удалить черновик и его фото (сдача принята сервером, бронь снята). */
export async function dropDraft(store: DeviceStore, scope: string, key: string): Promise<void> {
  await store.delete(draftKeyOf(scope, key));
  for (const k of await store.keys(photoPrefix(scope, key))) await store.delete(k);
}

/** Оставить только черновик `keep` (текущий шаг смены) и не старше 7 дней; прочие черновики и фото — удалить. */
export async function pruneDrafts(
  store: DeviceStore,
  scope: string,
  keep: string | null,
  now = new Date(),
): Promise<void> {
  let staleKeep = false;
  for (const k of await store.keys(`draft:${scope}:`)) {
    const key = k.slice(`draft:${scope}:`.length);
    const saved = await store.get<Saved>(k);
    const fresh = !!saved && now.getTime() - Date.parse(saved.savedAt) <= DRAFT_TTL_MS;
    if (key === keep && fresh) continue;
    if (key === keep) staleKeep = true;
    await store.delete(k);
  }
  const keepPrefix = keep !== null && !staleKeep ? photoPrefix(scope, keep) : null;
  for (const k of await store.keys(`blob:${scope}:draft:`)) {
    if (!keepPrefix || !k.startsWith(keepPrefix)) await store.delete(k);
  }
}
