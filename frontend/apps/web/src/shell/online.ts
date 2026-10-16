// W1.20 · Связь (setOnline :2458–2464, 01-shell.md §16.1): `navigator.onLine` и события `online`/`offline`;
// при потере связи — тост «Нет связи. Черновики сохраняются на устройстве» (warn). Флажка демо-панели нет
// (PD-54): в e2e связь отключает `context.setOffline`.
import { toast as toastText } from '@ortus/texts';
import { useEffect, useRef, useState } from 'react';

import { useToast } from './toast.tsx';

const now = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine);

export function useOnline(): boolean {
  const [online, setOnline] = useState(now);
  const last = useRef(online);
  const toast = useToast();
  useEffect(() => {
    const sync = () => {
      const on = now();
      if (last.current && !on) toast(toastText.shell.offline, 'warn');
      last.current = on;
      setOnline(on);
    };
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [toast]);
  return online;
}
