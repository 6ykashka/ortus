// W2.26 · Личные виды «Данных» (эталон dtViews :4202 — «Вид сохранён · личный»; Q-W2.51-7: вид хранится в браузере
// участника, контракта нет). Ключ — организация и участник: другой вход в том же браузере своих видов не видит.
// Хранилище может отсутствовать или бросать (приватное окно, запрет сайта) — тогда видов нет, страница работает.

export interface SavedView {
  name: string;
  set: string;
  q: string;
}

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export const viewsKey = (tenantId: string, memberId: string): string =>
  `ortus:data-views:${tenantId}:${memberId}`;

const isView = (v: unknown): v is SavedView => {
  const o = v as Partial<SavedView> | null;
  return !!o && typeof o.name === 'string' && typeof o.set === 'string' && typeof o.q === 'string';
};

export function loadViews(store: Store | null, key: string): SavedView[] {
  try {
    const raw = store?.getItem(key);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list)
      ? list.filter(isView).map(({ name, set, q }) => ({ name, set, q }))
      : [];
  } catch {
    return [];
  }
}

/** Вид с тем же именем заменяется и встаёт в конец (:4202); возвращает новый список. */
export function saveView(store: Store | null, key: string, view: SavedView): SavedView[] {
  const list = [...loadViews(store, key).filter((v) => v.name !== view.name), view];
  try {
    store?.setItem(key, JSON.stringify(list));
  } catch {
    // Без хранилища вид живёт до перезагрузки страницы, как в эталоне.
  }
  return list;
}

/** `localStorage`, если браузер его даёт. */
export function browserStore(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
