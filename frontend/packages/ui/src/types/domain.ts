// Типы пропсов доменных компонентов @ortus/ui (components.md 14.10). Все — заглушки до владельцев (OWNERS).
// Владелец может только добавлять необязательные пропсы; удаление и переименование — через интегратора.
import type { ReactNode } from 'react';
import type { Action, IconName, Tone } from './common';
import type { EmptyStateProps, StatusProps, TabsProps } from './core';

/** Локальное отделено от серверного: «На устройстве», «Ждёт связи», «Загрузка N%», «Ошибка — повторить», «Принято сервером». */
export interface SyncStateProps {
  state: 'local' | 'queued' | 'uploading' | 'failed' | 'confirmed';
  progress?: number;
  at?: string;
  onRetry?: () => void;
  label?: string;
}

export interface DataColumn<Row> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  mono?: boolean;
  width?: number;
  render?: (row: Row) => ReactNode;
  /** Приоритетное поле карточки на < 640 px. */
  primary?: boolean;
}
/** Таблица с `<th scope>`; фильтры и сортировка в URL; < 640 px → список карточек. */
export interface DataTableProps<Row> {
  columns: DataColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  sort?: { key: string; dir: 'asc' | 'desc' };
  onSort?: (sort: { key: string; dir: 'asc' | 'desc' }) => void;
  filter?: ReactNode;
  onRow?: (row: Row) => void;
  state?: 'ready' | 'loading' | 'empty' | 'error';
  empty?: EmptyStateProps;
  error?: { text: string; onRetry?: () => void };
  /** `cards` (14.10, по умолчанию) или `scroll` (горизонтальная прокрутка внутри карточки). */
  mobile?: 'cards' | 'scroll';
  minWidth?: number;
}

/** Иконка + текст «соответствует / не соответствует». */
export interface CheckListProps {
  items: { ok: boolean; label: string; value?: string; need?: string }[];
  summary?: { ok: boolean; label: string };
}

export type PhotoRole = 'front' | 'back' | 'left' | 'right' | 'odo';
/** `<input type="file" accept="image/*" capture="environment">`, подпись ракурса. */
export interface PhotoSlotProps {
  role: PhotoRole;
  label: string;
  state: 'empty' | 'uploading' | 'failed' | 'local' | 'done';
  progress?: number;
  previewUrl?: string;
  onCapture: (file: File) => void;
  onRetry?: () => void;
}

/** Масса и объём раздельно; > 100 % — danger; числа текстом. */
export interface LoadBarProps {
  weightPct: number;
  volumePct: number;
  label?: string;
  note?: string;
}

export interface StepperProps {
  steps: { id: string; label: string }[];
  current: string;
  blocked?: string[];
}

/** Бронь занята, ревизия устарела; «Обновить» — первым действием. */
export interface ConflictNoticeProps {
  code: string;
  text?: string;
  onRefresh: () => void;
  refreshLabel?: string;
}

/** Шапка объекта: `h1` — название, вкладки снизу прокручиваются вбок. */
export interface ObjectHeaderProps {
  icon?: IconName;
  chips?: StatusProps[];
  title: string;
  meta?: ReactNode;
  progress?: ReactNode;
  actions?: ReactNode;
  tabs?: TabsProps;
}

/** Принято — акцент, на приёмке — штриховка warn; проценты текстом в легенде. */
export interface ReadinessBarProps {
  segments: { value: number; kind: 'done' | 'pending' }[];
  legend?: boolean;
}

export interface DecisionItem {
  id: string;
  tone: Tone;
  icon?: IconName;
  tag?: string;
  title: string;
  meta?: string;
  action?: Action;
}
/** Сортировка по срочности — у VM; пусто — «Решений не требуется». */
export interface DecisionQueueProps {
  title?: string;
  items: DecisionItem[];
  empty?: string;
  max?: number;
  /** W2.25: подпись рядом с заголовком («4», «показано 8 из 12»). */
  count?: string;
  /** W2.25: загрузка (скелетон) или ошибка (баннер с повтором) вместо списка. */
  state?: 'ready' | 'loading' | 'error';
  /** W2.25: текст ошибки и повтор при `state: 'error'`. */
  error?: { text: string; onRetry?: () => void; retryLabel?: string };
}

export interface RoleCatalogVerb {
  key: string;
  label: string;
  perms: string[];
  sensitive?: boolean;
  restricted?: boolean;
}
export interface RoleCatalog {
  modules: {
    key: string;
    name: string;
    on: boolean;
    verbs: RoleCatalogVerb[];
    /** Иконка строки модуля (W1.23: Ортус CRM.dc.html:356). */
    icon?: IconName;
  }[];
}
export interface RoleDraft {
  id: string;
  name: string;
  system?: boolean;
  actions: Record<string, string[]>;
  /**
   * W1.23: уровни модуля, выданные не целиком (часть ключей уровня), — флажок в неопределённом состоянии; в
   * `actions` их нет. Модуль с такими уровнями включён и считает их в «{k} из {M}». Отметка уровня переносит его
   * в `actions`; выключение модуля убирает модуль и отсюда — так страница отличает снятие от «без изменений».
   */
  partial?: Record<string, string[]>;
}
/** Тумблер модуля → уровни → действия; группы `fieldset` + `legend`. */
export interface RoleEditorProps {
  role: RoleDraft;
  catalog: RoleCatalog;
  onChange: (role: RoleDraft) => void;
  readOnly?: boolean;
  driverBlocked?: boolean;
  /**
   * W1.23: почему финансовые разрешения закрыты (`driverBlocked`): `role` — роль функции «Водитель»
   * (блок «Профессиональная функция «Водитель»…»), `holder` — роль назначена водителю (:3205).
   */
  driverReason?: 'role' | 'holder';
  /** W1.23: модули, раскрытые при первом показе (`roleOpen` эталона, :2347). */
  initiallyOpen?: string[];
}

export interface GanttStage {
  id: string;
  title: string;
  /** ISO-даты. */
  start: string;
  end: string;
  /** Полоса по факту: акт / принято / на приёмке / план. */
  kind: 'act' | 'accepted' | 'review' | 'plan';
  paused?: { start: string; end: string }[];
  critical?: boolean;
  baseline?: { start: string; end: string };
}
export interface GanttChange {
  stageId: string;
  start: string;
  end: string;
}
/** Полоса — `role="img"` с датами в `aria-label`; изменения доступны кнопками в карточке этапа. */
export interface GanttProps {
  stages: GanttStage[];
  links: { from: string; to: string }[];
  baseline?: boolean;
  today: string;
  calendar: { weekends: number[]; holidays?: string[] };
  zoom: 'fit' | 'day';
  onSelect?: (stageId: string) => void;
  onPreview?: (change: GanttChange) => void;
}

/** Без причины сохранить нельзя; `role="region"`, причина — `select` с подписью. */
export interface ScheduleChangePreviewProps {
  changes: (GanttChange & { title: string; from: { start: string; end: string } })[];
  moved: number;
  finish: { from: string; to: string };
  notify: string[];
  reasons: { value: string; label: string }[];
  onApply: (reason: string) => void;
  onCancel: () => void;
}

/** По неделям; готовность исполнителя и материалов; список кнопок без диаграммы. */
export interface LookaheadProps {
  weeks: { start: string; label: string }[];
  items: { id: string; title: string; week: string; onOpen?: () => void }[];
  prep: Record<string, { crew: boolean; materials: boolean }>;
}
