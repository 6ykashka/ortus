// W2.24 · Черновик осмотра на устройстве (S2-15; ответ владельца 17.10 на D-09: «фото осмотра — офлайн-черновик,
// онлайн нужен только на «Выехать»»): черновик и фото переживают перезапуск; фото, не дошедшие до сервера, после
// восстановления — «На устройстве · ждёт связи» (queued); черновики чужих смен и старше 7 дней удаляются.
import { describe, expect, it } from 'vitest';

import { memoryStore } from '../../../../pwa/store.ts';
import { emptyDraft, photoCount, photoView, missingOf, type Draft } from '../model.ts';
import { dropDraft, getPhoto, loadDraft, pruneDrafts, putPhoto, saveDraft } from './drafts.ts';

const SCOPE = 't1:u1';
const KEY = 'trip-1:dep:res-1';
const jpeg = () => new Blob([new Uint8Array([1])], { type: 'image/jpeg' });

function draft(): Draft {
  const d = emptyDraft();
  return {
    ...d,
    odometer: '84 500',
    fuel: 'h',
    checks: { body: true },
    defects: [{ zone: 'Кузов', text: 'Царапина', critical: false }],
    photos: {
      ...d.photos,
      front: { state: 'ready', progress: 100, fileId: 'f-1', capturedAt: 'c1', url: 'blob:x' },
      back: { state: 'uploading', progress: 40, url: 'blob:y', capturedAt: 'c2' },
      left: { state: 'queued', progress: 0, capturedAt: 'c3' },
      right: { state: 'failed', progress: 0 },
    },
  };
}

describe('черновик осмотра на устройстве', () => {
  it('сохраняется и восстанавливается: поля, готовые фото, фото на устройстве — queued', async () => {
    const store = memoryStore();
    await putPhoto(store, SCOPE, KEY, 'front', jpeg());
    await putPhoto(store, SCOPE, KEY, 'back', jpeg());
    await putPhoto(store, SCOPE, KEY, 'left', jpeg());
    await saveDraft(store, SCOPE, KEY, draft(), new Date('2026-10-01T10:00:00Z'));
    const urls: Blob[] = [];
    const d = await loadDraft(store, SCOPE, KEY, {
      now: new Date('2026-10-01T11:00:00Z'),
      url: (b) => {
        urls.push(b);
        return `blob:restored-${String(urls.length)}`;
      },
    });
    expect(d).toMatchObject({
      odometer: '84 500',
      fuel: 'h',
      checks: { body: true },
      defects: [{ zone: 'Кузов', text: 'Царапина', critical: false }],
    });
    expect(d?.photos.front).toEqual({
      state: 'ready',
      progress: 100,
      fileId: 'f-1',
      capturedAt: 'c1',
      url: 'blob:restored-1',
    });
    expect(d?.photos.back).toEqual({
      state: 'queued',
      progress: 0,
      capturedAt: 'c2',
      url: 'blob:restored-2',
    });
    expect(d?.photos.left).toMatchObject({ state: 'queued', capturedAt: 'c3' });
    // Фото без файла на устройстве — пустой слот.
    expect(d?.photos.right).toEqual({ state: 'empty', progress: 0 });
    expect(d?.photos.odo).toEqual({ state: 'empty', progress: 0 });
  });

  it('нет черновика — undefined; старше 7 дней — нет', async () => {
    const store = memoryStore();
    expect(await loadDraft(store, SCOPE, KEY)).toBeUndefined();
    await saveDraft(store, SCOPE, KEY, draft(), new Date('2026-10-01T10:00:00Z'));
    expect(
      await loadDraft(store, SCOPE, KEY, { now: new Date('2026-10-08T10:00:01Z') }),
    ).toBeUndefined();
  });

  it('фото: Blob по слоту; dropDraft удаляет черновик и его фото', async () => {
    const store = memoryStore();
    const b = jpeg();
    await putPhoto(store, SCOPE, KEY, 'odo', b);
    expect(await getPhoto(store, SCOPE, KEY, 'odo')).toBe(b);
    await saveDraft(store, SCOPE, KEY, draft());
    await dropDraft(store, SCOPE, KEY);
    expect(await store.keys('')).toEqual([]);
  });

  it('pruneDrafts: остаётся только черновик текущего шага смены; старые — удалены', async () => {
    const store = memoryStore();
    const now = new Date('2026-10-10T10:00:00Z');
    await saveDraft(store, SCOPE, KEY, draft(), now);
    await putPhoto(store, SCOPE, KEY, 'front', jpeg());
    await saveDraft(store, SCOPE, 'trip-0:ret:0', draft(), now);
    await putPhoto(store, SCOPE, 'trip-0:ret:0', 'front', jpeg());
    await saveDraft(store, 't1:u2', 'trip-9:dep:x', draft(), now);
    await pruneDrafts(store, SCOPE, KEY, now);
    expect(await store.keys('')).toEqual([
      `blob:${SCOPE}:draft:${KEY}:front`,
      `draft:${SCOPE}:${KEY}`,
      'draft:t1:u2:trip-9:dep:x',
    ]);
    await pruneDrafts(store, SCOPE, null, now);
    expect(await store.keys('')).toEqual(['draft:t1:u2:trip-9:dep:x']);
  });
});

describe('слот фото «На устройстве · ждёт связи» (photoVM :3391)', () => {
  it('рамка, иконка и подпись эталона; засчитывается в «Фото · N из 5» и в «Осталось»', () => {
    const v = photoView({ state: 'queued', progress: 0 }, 'Спереди');
    expect(v).toMatchObject({
      border: '2px dashed #B7791F',
      icon: 'cloud_off',
      status: 'На устройстве · ждёт связи',
      stFg: '#7A5214',
      stIcon: 'cloud_off',
      uploading: false,
      ready: false,
      failed: false,
    });
    const d = emptyDraft();
    const queued = {
      ...d,
      photos: {
        front: { state: 'queued' as const, progress: 0 },
        back: { state: 'queued' as const, progress: 0 },
        left: { state: 'ready' as const, progress: 100, fileId: 'f' },
        right: { state: 'ready' as const, progress: 100, fileId: 'f' },
        odo: { state: 'ready' as const, progress: 100, fileId: 'f' },
      },
    };
    expect(photoCount(queued)).toBe(5);
    expect(missingOf(queued, 'dep', 0, [])).not.toContain('5 фото');
    expect(missingOf(queued, 'dep', 0, []).join()).not.toMatch(/фото/);
  });
});
