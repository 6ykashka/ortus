// W1.20 · Реестр страниц (контракт C-2 брифа): страничный WS кладёт `src/routes/<область>/<ключ>.page.tsx`
// с `export default function Page()` — оболочка подхватывает его без правок (`import.meta.glob`). Имя файла —
// ключ страницы (`users`, `repairCatalog`) или сегмент маршрута (`repair-catalog`). Нет файла — заглушка
// `PageStub` (заголовок — подпись пункта меню).
import { PAGES, type PageKey } from '@ortus/domain/nav';
import { type ComponentType, createElement, lazy, type ReactElement, Suspense } from 'react';

import { BootSkeleton, PageStub } from '../shell/states.tsx';

type PageModule = { default: ComponentType };

const files = import.meta.glob<PageModule>('../routes/**/*.page.tsx');

const byName = new Map<string, () => Promise<PageModule>>(
  Object.entries(files).map(([path, load]) => [
    path.slice(path.lastIndexOf('/') + 1, -'.page.tsx'.length),
    load,
  ]),
);

/** Ленивые компоненты страниц, у которых есть файл (создаются один раз при загрузке модуля). */
export const PAGE_COMPONENTS: ReadonlyMap<PageKey, ComponentType> = new Map(
  [...PAGES.values()].flatMap((p) => {
    const load = byName.get(p.key) ?? byName.get(p.segment);
    return load ? [[p.key, lazy(load)] as const] : [];
  }),
);

export function PageSlot({ page, title }: { page: PageKey; title: string }): ReactElement {
  const component = PAGE_COMPONENTS.get(page);
  if (!component) return <PageStub page={page} title={title} />;
  return <Suspense fallback={<BootSkeleton />}>{createElement(component)}</Suspense>;
}
