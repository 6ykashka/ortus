// W0.14 · Типы словаря. Лист — сообщение ICU MessageFormat (строка без аргументов — тоже сообщение).

/** Дерево строк домена: только объекты и строки, без массивов (ключи — идентификаторы эталона). */
export type TextTree = { readonly [key: string]: string | TextTree };

/** Значения аргументов сообщения: числа форматируются `Intl.NumberFormat('ru-RU')`. */
export type MessageValues = Readonly<Record<string, string | number | boolean>>;

export type MessageNode =
  | { readonly type: 'literal'; readonly value: string }
  | { readonly type: 'argument'; readonly name: string; readonly format?: 'number' }
  | { readonly type: 'pound' }
  | {
      readonly type: 'plural' | 'select';
      readonly name: string;
      readonly options: Readonly<Record<string, readonly MessageNode[]>>;
    };
