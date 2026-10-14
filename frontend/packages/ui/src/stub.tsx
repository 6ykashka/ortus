import type { ReactElement, ReactNode } from 'react';
import { OWNERS, type Unit } from './contract';

/**
 * Заглушка единицы контракта: `<div data-stub data-owner>` с детьми и без текстовых пропсов,
 * чтобы красный тест потребителя падал по роли и тексту, а не по импорту.
 * Без стилей и цвета. Владелец (OWNERS) заменяет каталог заглушки реализацией.
 */
export function makeStub<P extends object>(name: Unit): (props: P) => ReactElement {
  function Stub(props: P): ReactElement {
    const { children } = props as { children?: ReactNode };
    return (
      <div data-stub={name} data-owner={OWNERS[name]}>
        {children ?? null}
      </div>
    );
  }
  Stub.displayName = `${name}Stub`;
  return Stub;
}
