// Типы маршрута документа (W7.22). Расширяют типы ядра документов (W7.21): поля, которые пишет
// только движок маршрута (код СМС, возврат, закрытие ознакомления, журнал маршрутов, PDF/A-копия).
// Типы ядра не меняются: расширение совместимо — `DocItem` присваивается `RDoc` без приведения.
import type { Entry } from '../../../core/types/index.ts';
import type {
  DocItem,
  DocRoute,
  DocVersion,
  RouteRules,
  RouteStep,
  StepDecision,
  StepKind,
  StepMode,
  TmpAccess,
} from '../core/types.ts';

export type { StepKind, StepMode, RouteRules };

/** Запись «ознакомлен(а)» шага `ack`. */
export interface AckDone {
  member: string;
  at: string;
  v?: number;
  device?: string;
}

export interface RStep extends Omit<RouteStep, 'done' | 'decisions'> {
  decisions: StepDecision[];
  audience?: Entry[];
  done?: AckDone[];
  from?: string;
  end?: string;
  closed?: { at: string; by: string; left: string[] };
}

export interface RBack {
  step?: number;
  by?: string;
  name: string;
  comment?: string;
  at?: string;
  resolved?: boolean;
}

export interface RRoute extends Omit<DocRoute, 'steps' | 'back'> {
  steps: RStep[];
  back?: RBack;
  end?: string;
  sms?: { code: string; member: string; tries: number; at: string } | null;
}

export interface RTmp extends TmpAccess {
  route?: string;
  step?: number;
  keep?: boolean;
}

export interface RVersion extends DocVersion {
  annots?: unknown[];
}

export interface HistEntry {
  at: string;
  by: string;
  text: string;
}

/** Документ с полями маршрута. */
export interface RDoc extends Omit<DocItem, 'route' | 'tmp' | 'frozen' | 'versions' | 'history'> {
  route?: RRoute;
  routeLog?: RRoute[];
  tmp: RTmp[];
  frozen?: Record<string, string> | null;
  versions: RVersion[];
  history: HistEntry[];
  pdfaId?: string;
  src?: { doc: string; v: number; op: string };
}

/** Шаг в заявке на запуск маршрута (`docRouteStart`). */
export interface RouteStepSpec {
  kind: StepKind | string;
  mode?: StepMode | string;
  who?: string[];
  audience?: Entry[];
  days?: number | string;
  ext?: { name?: string; phone?: string };
}

export interface RouteStartSpec {
  steps?: RouteStepSpec[];
  rules?: Partial<RouteRules>;
  project?: string;
  saveTpl?: boolean;
}

export interface RouteDecideSpec {
  decision?: 'ok' | 'back' | string;
  comment?: string;
  /** Демо: решение «от имени» ждущего участника; в backend (W7.24) его нет. */
  as?: string;
}

export interface RouteSheetRow {
  s: string;
  w: string;
  r: string;
  at: string;
}

export interface RouteSheetResult {
  rows: RouteSheetRow[];
  v: number;
  sha: string;
}
