import type { Tone } from '@ortus/tokens';

/** Пять тонов статусов (`tokens.json` color.tone). */
export type { Tone };

/** Тон тоста: `error` вместо `danger` (Ортус CRM.dc.html:2898). */
export type ToastTone = 'ok' | 'warn' | 'error' | 'info';

/** Имя лигатуры Material Symbols Rounded: `verified`, `route`, `undo`, … */
export type IconName = string;

/** Одно действие компонента: подпись-глагол и обработчик. */
export interface Action {
  label: string;
  onPress: () => void;
  icon?: IconName;
  disabled?: boolean;
}

/** Вариант значения для выпадающих списков. */
export interface Option<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}
