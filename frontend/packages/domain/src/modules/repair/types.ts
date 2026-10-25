import type { TenantDb } from '../../core/types/index.ts';

// Типы модуля «Ремонт и стройка» (W6.10): срез `db.repair` эталона 14.10/19.10
// (design/ortus/extra-data.js:77–144) и сводка объекта для списка, карточки и «Главной».

/** Этап работ объекта; «Сдан» и «Замер» (черновик) управляют доступными действиями. */
export type RepairStage =
  'Подготовка' | 'Черновая отделка' | 'Чистовая отделка' | 'Замер' | 'Сдан' | (string & {});

export type EstimateState = 'none' | 'draft' | 'sent' | 'approved';

/** Деньги объекта: строки уже отформатированы (`'1 540 000 ₽'`), видны только с правом финансов. */
export interface ObjectFin {
  total: string;
  paid: string;
  spent: string;
  margin: string;
  /** Подписи под плитками: договор, получено, расходы, маржа. */
  subs: string[];
}

export interface SchedStatus {
  due: string;
  forecast: string;
  slip: number;
  slipText?: string;
  why?: string;
  noWho?: string[];
}

/** Сводка разделов объекта (`st` эталона) — форма `onStatus` дочернего модуля. */
export interface ObjectSections {
  sched?: SchedStatus;
  req: string[];
  draft: string[];
  sms: string[];
  est: EstimateState;
  estLabel?: string;
  /** Деньги: сервер не отдаёт без права финансов. */
  fin?: ObjectFin | null;
}

export interface FeedEntry {
  at: string;
  who: string;
  text: string;
}

export interface RepairObject {
  id: string;
  name: string;
  address: string;
  stage: RepairStage;
  area: string;
  kind: string;
  contract: string | null;
  due?: string | null;
  start?: string;
  client: string;
  /** ФИО прораба (так хранит эталон); `null` — не назначен. */
  foreman: string | null;
  /** id участника-прораба: основной способ связи (`core/entries`). */
  foremanId?: string | null;
  crew: string[];
  /** `true` — разделы заполнены у самого модуля; массив — только эти разделы. */
  sections?: true | string[];
  access: [icon: string, text: string][];
  sub?: { name: string; scope: string; until: string };
  draft?: boolean;
  measured?: string;
  handedOver?: string;
  warranty?: string;
  feed?: FeedEntry[];
  st?: ObjectSections;
}

export interface RepairWork {
  id: string;
  obj: string;
  name: string;
  unit: string;
  plan: number;
  fact: number;
}

export interface CrewMember {
  id: string;
  name: string;
  role: string;
  /** Бригада — карточки без входа в CRM. */
  account: boolean;
}

export interface RepairMaterial {
  id: string;
  obj: string;
  name: string;
  unit: string;
  qty: number;
}

export type ChangeStatus = 'proposed' | 'priced' | 'sent' | 'signed' | 'rejected';

export interface ChangeOrder {
  id: string;
  obj: string;
  at: string;
  by: string;
  title: string;
  volume: number;
  unit: string;
  note: string;
  photos: number;
  status: ChangeStatus;
  reason?: string;
  agreement?: number | string;
  ver?: number;
  /** Позиции справочника для черновика допсоглашения: `[id позиции, количество]`. */
  suggest?: [item: string, qty: number][];
}

export type WorkLogStatus = 'На проверке' | 'Принят' | 'Возвращён';

export interface WorkLog {
  id: string;
  obj: string;
  at: string;
  work: string;
  volume: number;
  crew: string[];
  materials: [id: string, qty: number][];
  photos: number;
  status: WorkLogStatus;
  by: string;
  /** Причина возврата (RS-09): бригада её не видит. */
  reason?: string;
}

export interface RepairSlice {
  objects: RepairObject[];
  works: RepairWork[];
  crew: CrewMember[];
  materials: RepairMaterial[];
  changes: ChangeOrder[];
  logs: WorkLog[];
}

/**
 * БД организации со срезом ремонта. Срез не добавляется в ModuleSlices: ядро и тесты ядра хранят
 * в 
epair минимум ({ objects } для entries), а полный срез читают только команды и проекции модуля.
 */
export type RepairDb = TenantDb & { repair?: RepairSlice };
