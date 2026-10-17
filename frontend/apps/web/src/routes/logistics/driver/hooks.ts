// W2.22 · Хуки экрана водителя: загрузка фото в слот (сессия загрузки, превью, «Ошибка загрузки» и тост) и отметки
// «Прибыл» — только на устройстве (03 §15 п. 8, бриф §10 п. 11: sessionStorage вкладки по рейсу).
import { errors } from '@ortus/texts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useToast } from '../../../shell/toast.tsx';
import type { Slot } from './model.ts';
import { type UploadOptions, uploadPhoto } from './photos.ts';

export type SetSlot = (patch: (s: Slot) => Slot) => void;

/**
 * `upload(slotId, file, purpose, set)`: слот — «Загрузка N%» с превью, затем «Загружено» (файл прошёл проверку)
 * или «Ошибка загрузки» с тостом. Повторный выбор того же слота отменяет обновления прежней попытки.
 */
export function useSlotUpload(tenantId: string, tripId: string) {
  const api = useApi();
  const toast = useToast();
  const seq = useRef(new Map<string, number>());
  const urls = useRef<string[]>([]);
  useEffect(() => {
    const list = urls.current;
    return () => {
      for (const u of list) URL.revokeObjectURL(u);
    };
  }, []);

  return useCallback(
    (slotId: string, file: File, purpose: UploadOptions['purpose'], set: SetSlot): void => {
      const n = (seq.current.get(slotId) ?? 0) + 1;
      seq.current.set(slotId, n);
      const live = (patch: (s: Slot) => Slot) => {
        if (seq.current.get(slotId) === n) set(patch);
      };
      const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
      if (url) urls.current.push(url);
      const capturedAt = new Date().toISOString();
      live(() => ({ state: 'uploading', progress: 0, ...(url ? { url } : {}) }));
      uploadPhoto(api, tenantId, file, {
        purpose,
        tripId,
        onProgress: (p) => live((s) => (s.state === 'uploading' ? { ...s, progress: p } : s)),
      }).then(
        (fileId) => live((s) => ({ ...s, state: 'ready', progress: 100, fileId, capturedAt })),
        () => {
          if (seq.current.get(slotId) !== n) return;
          live((s) => ({ state: 'failed', progress: 0, ...(s.url ? { url: s.url } : {}) }));
          toast(errors.mock.files.uploadFailed, 'error');
        },
      );
    },
    [api, toast, tenantId, tripId],
  );
}

const marksKey = (tripId: string) => `ortus.driver.stops.${tripId}`;

function readMarks(tripId: string): Record<number, boolean> {
  try {
    const raw = sessionStorage.getItem(marksKey(tripId));
    return raw ? (JSON.parse(raw) as Record<number, boolean>) : {};
  } catch {
    return {};
  }
}

/** Отметки «Прибыл» по точкам рейса — только на этом устройстве (компонент маршрута — с key рейса). */
export function useStopMarks(tripId: string) {
  const [marks, setMarks] = useState<Record<number, boolean>>(() => readMarks(tripId));
  const toggle = useCallback(
    (i: number) =>
      setMarks((m) => {
        const next = { ...m, [i]: !m[i] };
        try {
          sessionStorage.setItem(marksKey(tripId), JSON.stringify(next));
        } catch {
          // Хранилище вкладки недоступно — отметка живёт до перезагрузки.
        }
        return next;
      }),
    [tripId],
  );
  return { marks, toggle };
}
