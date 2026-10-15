import { useCallback, useSyncExternalStore } from 'react';

const hasMatchMedia = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function';

/** Совпадение медиазапроса; без `matchMedia` (SSR, jsdom) — `false` (широкий экран). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!hasMatchMedia()) return () => undefined;
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => hasMatchMedia() && window.matchMedia(query).matches,
    () => false,
  );
}
