// Контракт номенклатуры @ortus/ui (components.md 14.10, версия 0.2) — W0.10.
// UNITS: единицы таблицы components.md + служебные (Icon, VisuallyHidden, RadioGroup) и Meter, Nav.
// PROP_KEYS: основные пропсы из колонки «Props» — компилятор проверяет, что это ключи типов,
// тест contract.test.ts — что каждый проп таблицы на месте.
import type * as T from './types';

export const UNITS = [
  'Button',
  'IconButton',
  'Icon',
  'VisuallyHidden',
  'Field',
  'TextInput',
  'NumberInput',
  'MoneyInput',
  'DateInput',
  'Select',
  'Textarea',
  'Checkbox',
  'Switch',
  'RadioGroup',
  'Radio',
  'Status',
  'SyncState',
  'Banner',
  'AccessGate',
  'Card',
  'DataTable',
  'CheckList',
  'PhotoSlot',
  'LoadBar',
  'Stepper',
  'Dialog',
  'ConfirmDialog',
  'Sheet',
  'Toast',
  'EmptyState',
  'Skeleton',
  'AppShell',
  'ScopeSelect',
  'RoleEditor',
  'ConflictNotice',
  'ObjectHeader',
  'ReadinessBar',
  'DecisionQueue',
  'Tabs',
  'Meter',
  'Nav',
  'Gantt',
  'ScheduleChangePreview',
  'Lookahead',
] as const;

export type Unit = (typeof UNITS)[number];

/** Пропсы каждой единицы — для проверки PROP_KEYS компилятором. */
interface UnitProps {
  Button: T.ButtonProps;
  IconButton: T.IconButtonProps;
  Icon: T.IconProps;
  VisuallyHidden: T.VisuallyHiddenProps;
  Field: T.FieldProps;
  TextInput: T.TextInputProps;
  NumberInput: T.NumberInputProps;
  MoneyInput: T.MoneyInputProps;
  DateInput: T.DateInputProps;
  Select: T.SelectProps;
  Textarea: T.TextareaProps;
  Checkbox: T.CheckboxProps;
  Switch: T.SwitchProps;
  RadioGroup: T.RadioGroupProps;
  Radio: T.RadioProps;
  Status: T.StatusProps;
  SyncState: T.SyncStateProps;
  Banner: T.BannerProps;
  AccessGate: T.AccessGateProps;
  Card: T.CardProps;
  DataTable: T.DataTableProps<unknown>;
  CheckList: T.CheckListProps;
  PhotoSlot: T.PhotoSlotProps;
  LoadBar: T.LoadBarProps;
  Stepper: T.StepperProps;
  Dialog: T.DialogProps;
  ConfirmDialog: T.ConfirmDialogProps;
  Sheet: T.SheetProps;
  Toast: T.ToastProps;
  EmptyState: T.EmptyStateProps;
  Skeleton: T.SkeletonProps;
  AppShell: T.AppShellProps;
  ScopeSelect: T.ScopeSelectProps;
  RoleEditor: T.RoleEditorProps;
  ConflictNotice: T.ConflictNoticeProps;
  ObjectHeader: T.ObjectHeaderProps;
  ReadinessBar: T.ReadinessBarProps;
  DecisionQueue: T.DecisionQueueProps;
  Tabs: T.TabsProps;
  Meter: T.MeterProps;
  Nav: T.NavProps;
  Gantt: T.GanttProps;
  ScheduleChangePreview: T.ScheduleChangePreviewProps;
  Lookahead: T.LookaheadProps;
}

const INPUT = ['value', 'onChange', 'unit', 'inputMode'] as const;
const CHOICE = ['checked', 'label', 'description'] as const;

export const PROP_KEYS = {
  Button: ['variant', 'size', 'icon', 'loading', 'disabled', 'disabledReason'],
  IconButton: ['icon', 'label', 'badge'],
  Icon: ['name', 'size', 'fill'],
  VisuallyHidden: ['children'],
  Field: ['label', 'hint', 'error', 'required', 'children', 'readOnly', 'disabled', 'unit'],
  TextInput: INPUT,
  NumberInput: INPUT,
  MoneyInput: INPUT,
  DateInput: INPUT,
  Select: [...INPUT, 'options'],
  Textarea: INPUT,
  Checkbox: CHOICE,
  Switch: CHOICE,
  RadioGroup: ['value', 'onChange', 'label', 'children'],
  Radio: CHOICE,
  Status: ['tone', 'icon', 'children'],
  SyncState: ['state'],
  Banner: ['tone', 'title', 'action'],
  AccessGate: ['reason', 'action'],
  Card: ['title', 'meta', 'actions', 'onOpen'],
  DataTable: ['columns', 'rows', 'sort', 'filter', 'onRow', 'mobile'],
  CheckList: ['items'],
  PhotoSlot: ['role', 'state', 'progress', 'onCapture', 'onRetry'],
  LoadBar: ['weightPct', 'volumePct'],
  Stepper: ['steps', 'current'],
  Dialog: ['title', 'open', 'onClose'],
  ConfirmDialog: ['title', 'consequences', 'confirmLabel', 'tone'],
  Sheet: ['title', 'children'],
  Toast: ['tone', 'text', 'action'],
  EmptyState: ['icon', 'title', 'text', 'action'],
  Skeleton: ['lines', 'shape'],
  AppShell: ['tenant', 'scope', 'nav', 'notifications', 'profile'],
  ScopeSelect: ['value', 'options'],
  RoleEditor: ['role', 'catalog', 'onChange'],
  ConflictNotice: ['code', 'onRefresh'],
  ObjectHeader: ['icon', 'chips', 'title', 'meta', 'progress', 'actions', 'tabs'],
  ReadinessBar: ['segments', 'legend'],
  DecisionQueue: ['title', 'items', 'empty'],
  Tabs: ['items', 'value', 'onChange'],
  Meter: ['value', 'max', 'label'],
  Nav: ['groups', 'mode'],
  Gantt: ['stages', 'links', 'baseline', 'today', 'calendar', 'zoom', 'onSelect', 'onPreview'],
  ScheduleChangePreview: ['changes', 'moved', 'finish', 'notify', 'reasons', 'onApply', 'onCancel'],
  Lookahead: ['weeks', 'items', 'prep'],
} as const satisfies { [U in Unit]: readonly (keyof UnitProps[U])[] };

/**
 * Кто реализует единицу (заменяет каталог заглушки целиком). W0.10 — реализовано;
 * W1.20 — оболочка (только тип); W1.21 — остальные core и DataTable; W1.23 — RoleEditor;
 * W2.20/W2.22/W2.25 — логистика и «Главная»; W6.20/W6.23 — объекты и график.
 */
export const OWNERS = {
  Button: 'W0.10',
  Icon: 'W0.10',
  Field: 'W0.10',
  Status: 'W0.10',
  Banner: 'W0.10',
  Card: 'W0.10',
  Dialog: 'W0.10',
  IconButton: 'W1.21',
  VisuallyHidden: 'W1.21',
  TextInput: 'W1.21',
  NumberInput: 'W1.21',
  MoneyInput: 'W1.21',
  DateInput: 'W1.21',
  Select: 'W1.21',
  Textarea: 'W1.21',
  Checkbox: 'W1.21',
  Switch: 'W1.21',
  RadioGroup: 'W1.21',
  Radio: 'W1.21',
  AccessGate: 'W1.21',
  ConfirmDialog: 'W1.21',
  Sheet: 'W1.21',
  Toast: 'W1.21',
  EmptyState: 'W1.21',
  Skeleton: 'W1.21',
  Tabs: 'W1.21',
  Meter: 'W1.21',
  Nav: 'W1.21',
  ScopeSelect: 'W1.21',
  DataTable: 'W1.21',
  AppShell: 'W1.20',
  RoleEditor: 'W1.23',
  CheckList: 'W2.20',
  LoadBar: 'W2.20',
  ConflictNotice: 'W2.20',
  SyncState: 'W2.22',
  PhotoSlot: 'W2.22',
  Stepper: 'W2.22',
  DecisionQueue: 'W2.25',
  ObjectHeader: 'W6.20',
  ReadinessBar: 'W6.20',
  Gantt: 'W6.23',
  ScheduleChangePreview: 'W6.23',
  Lookahead: 'W6.23',
} as const satisfies Record<Unit, string>;
