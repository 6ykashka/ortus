import { createContext } from 'react';

/** Поле внутри `Field`: рамку, подпись и ошибку рисует `Field`, поле — только контрол и единицу. */
export const FieldContext = createContext(false);

/** Пропсы, которые `Field` передаёт дочернему контролу через `cloneElement`. */
export interface FieldInjectedProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  required?: boolean;
}
