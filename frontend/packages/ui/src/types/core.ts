// Типы пропсов базовых компонентов @ortus/ui (components.md 14.10, версия 0.2).
// Реализованы W0.10: Button, Field, Status, Banner, Card, Dialog, Icon. Остальные — заглушки W1.21.
import type { ReactElement, ReactNode } from 'react';
import type { Action, IconName, Option, ToastTone, Tone } from './common';

/** Иконка-лигатура: `aria-hidden`, класс `material-symbols-rounded`. */
export interface IconProps {
  name: IconName;
  /** Кегль в px: 15 (пилл CRM), 16 (пилл витрины), 18, 20 (по умолчанию), 22, 24, 28, 32. */
  size?: 15 | 16 | 18 | 20 | 22 | 24 | 28 | 32;
  /** `FILL 1` — только активный пункт меню (tokens.json icon.set). */
  fill?: boolean;
  className?: string;
}

/**
 * Кнопка (Дизайн-система.dc.html:164–210).
 * `disabledReason` выводится рядом и связывается через `aria-describedby`;
 * `loading` ставит `aria-busy` и сохраняет ширину.
 */
export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** `md` 44 px, `lg` 48 px (основное действие на телефоне), `compact` 32 px (только desktop-таблицы). */
  size?: 'md' | 'lg' | 'compact';
  icon?: IconName;
  loading?: boolean;
  /** Подпись во время выполнения: «Принимаем…». По умолчанию — `children`. */
  loadingLabel?: string;
  disabled?: boolean;
  /** Причина недоступности текстом рядом с кнопкой: «Нет фото одометра». */
  disabledReason?: string;
  type?: 'button' | 'submit' | 'reset';
  onPress?: () => void;
  'aria-label'?: string;
  children: ReactNode;
}

/** Кнопка-иконка 40×40, ghost. `label` становится `aria-label` и обязателен. */
export interface IconButtonProps {
  icon: IconName;
  label: string;
  badge?: number | string;
  size?: 40 | 44;
  onPress?: () => void;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: boolean | 'menu' | 'dialog' | 'listbox';
}

/**
 * Поле с подписью (Дизайн-система.dc.html:220–225): подпись над полем, ошибка под полем с иконкой,
 * единица измерения — внутри поля справа. Дочерний элемент — сам контрол (`<input>`, `<select>`, …).
 */
export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  readOnly?: boolean;
  disabled?: boolean;
  /** Единица внутри поля справа: «км», «₽». `TextInput.unit` (W1.21) передаётся сюда. */
  unit?: string;
  id?: string;
  children: ReactElement;
}

interface InputBase<V> {
  value: V;
  onChange: (value: V) => void;
  unit?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | 'search' | 'url';
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  /** 44 px или 48 px (поля водителя на телефоне). */
  size?: 'md' | 'lg';
  /** Моноширинный с `tabular-nums` (одометр, госномер). */
  mono?: boolean;
  'aria-label'?: string;
}

export type TextInputProps = InputBase<string>;
export interface NumberInputProps extends InputBase<number | ''> {
  min?: number;
  max?: number;
  step?: number;
}
/** Деньги в копейках: хранит `amountMinor`, показывает `1 250,00 ₽`. */
export interface MoneyInputProps extends Omit<InputBase<number | null>, 'value' | 'onChange'> {
  value: number | null;
  onChange: (amountMinor: number | null) => void;
  currency?: 'RUB';
}
/** Дата ISO `YYYY-MM-DD`. */
export type DateInputProps = InputBase<string>;
export interface SelectProps<V extends string = string> extends InputBase<V> {
  options: Option<V>[];
}
export interface TextareaProps extends InputBase<string> {
  rows?: number;
}

/** Строка выбора ≥ 44 px по высоте. */
export interface CheckboxProps {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
}
export interface SwitchProps {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  /** Подпись переключателя (видимая или `aria-label`): «Доступ роли к модулю „Логистика“». */
  label: string;
  description?: ReactNode;
  labelHidden?: boolean;
}
export interface RadioGroupProps<V extends string = string> {
  name?: string;
  value: V | null;
  onChange: (value: V) => void;
  label: string;
  labelHidden?: boolean;
  variant?: 'tiles' | 'cards';
  children: ReactNode;
}
export interface RadioProps<V extends string = string> {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  /** Состояние отмеченности задаёт `RadioGroup`; для одиночного радио — явно. */
  checked?: boolean;
}

/** Статус-пилл: иконка + текст + цвет; текст обязателен. */
export interface StatusProps {
  tone: Tone;
  icon?: IconName;
  children: string | number | ReactElement | (string | number | ReactElement)[];
}

/**
 * Баннер раздела (Дизайн-система.dc.html:275–278): trial, только чтение, офлайн, квота, модуль отключён.
 * `role` по умолчанию: `alert` для `danger`, иначе `status`.
 */
export interface BannerProps {
  tone: Tone;
  title: string;
  text?: ReactNode;
  icon?: IconName;
  action?: Action;
  role?: 'status' | 'alert';
}

/**
 * Отказ доступа: `module_off`, `module_readonly`, `no_permission`, `no_scope`.
 * При `module_readonly` у того, кто видит модуль, вместо гейта — содержимое с баннером «Модуль отключён».
 */
export interface AccessGateProps {
  reason: 'module_off' | 'module_readonly' | 'no_permission' | 'no_scope';
  moduleName?: string;
  title?: string;
  text?: string;
  /** Действие показывается, только если оно доступно. */
  action?: Action;
}

/**
 * Карточка: обычная, выбранная, недоступная (с причиной).
 * Кликабельная карточка — ровно одна кнопка или ссылка (заголовок), а не вложенные.
 */
export interface CardProps {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Открыть карточку: заголовок становится кнопкой с областью нажатия на всю карточку. */
  onOpen?: () => void;
  /** Вместо `onOpen` — ссылка. */
  href?: string;
  selected?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Пунктирная рамка: модуль не подключён, локальный черновик. */
  dashed?: boolean;
  headingLevel?: 2 | 3 | 4;
  children?: ReactNode;
}

/**
 * Модальный диалог: фокус-ловушка, возврат фокуса, Esc и клик по подложке закрывают.
 * На ширине < 640 — лист снизу.
 */
export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** `sm` 380 px (витрина), `md` 560 px, `lg` 620 px (назначение роли). */
  size?: 'sm' | 'md' | 'lg';
  /** Идёт операция: закрытие Esc и подложкой заблокировано, `aria-busy`. */
  busy?: boolean;
  /** `false` — закрывается только кнопками. */
  dismissable?: boolean;
}

export interface Consequence {
  title: string;
  items: { text: string; icon?: IconName; tone?: Tone }[];
}

/** Подтверждение значимого изменения с последствиями. */
export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  text?: ReactNode;
  icon?: IconName;
  tone?: 'default' | 'danger';
  consequences?: Consequence[];
  /** Флажок «Понимаю последствия»: без него подтвердить нельзя. */
  ack?: { label: string };
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  busyLabel?: string;
}

/** Мобильный лист снизу на < 640 px; доступность как у Dialog. */
export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/** Тост: успех — только после ответа сервера; не для ошибок полей. */
export interface ToastProps {
  tone: ToastTone;
  text: string;
  action?: Action;
  onDismiss: () => void;
  durationMs?: number;
}

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  text?: string;
  action?: Action;
  dashed?: boolean;
}

/** Полосы `aria-hidden`, контейнер `aria-busy`. */
export interface SkeletonProps {
  lines?: number;
  shape?: 'text' | 'block' | 'circle';
  label?: string;
}

export interface TabItem {
  id: string;
  label: string;
  badge?: number | string;
}
/** Подчёркивание 2 px акцентом; стрелки ←/→, `aria-controls`. */
export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  'aria-label': string;
  variant?: 'underline' | 'cards';
}

/** Полоса заполнения: «Занятое место». */
export interface MeterProps {
  value: number;
  max: number;
  label: string;
  tone?: Tone;
  text?: string;
}

export interface NavItem {
  id: string;
  label: string;
  icon: IconName;
  badge?: number | 'план';
  current?: boolean;
  onPress: () => void;
}
/** Навигация оболочки: sidebar ≥ 1080, rail 640–1079, нижняя < 640. */
export interface NavProps {
  groups: { title?: string; items: NavItem[] }[];
  mode: 'sidebar' | 'rail' | 'bottom';
  'aria-label': string;
  more?: Action;
}

export interface ScopeOption {
  value: string;
  label: string;
  kind: 'tenant' | 'region' | 'firm';
}
/** Подпись «Область просмотра». */
export interface ScopeSelectProps {
  value: string;
  options: ScopeOption[];
  onChange: (value: string) => void;
  label?: string;
}

export interface VisuallyHiddenProps {
  children: ReactNode;
}
