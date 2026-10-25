// Срез «Обращения» (service.js 19.10, docs/22-client-requests.md): направления, типы, обращения,
// низкие оценки. Время — миллисекунды Unix (как в эталоне); исполнитель хранится именем (как в
// эталоне, расхождение с контрактом `assigneeId` — Q-W7.30-1).
import type { TenantDb } from '../../core/types/index.ts';
import type { WorkCalendar } from './calendar.ts';

export type RequestStatus = 'new' | 'work' | 'wait' | 'resolved' | 'closed';
export type RequestKind =
  'complaint' | 'claim' | 'question' | 'idea' | 'thanks' | 'warranty' | 'cargo';
export type Channel = 'sms' | 'bot' | 'cabinet' | 'widget' | 'phone' | 'qr';
export type RequestPriority = 'low' | 'normal' | 'high';
export type MessageKind = 'client' | 'public' | 'note' | 'system' | 'rating';
export type SlaState = 'done' | 'pause' | 'late' | 'risk' | 'norm' | 'legal' | 'none';
export type SlaKey = 'first' | 'resolve' | 'legal';

export interface Direction {
  id: string;
  /** Ключ номера: `МАС` → `МАС-42`. */
  key: string;
  name: string;
  color: string;
  module: string;
  area: string;
  /** Сервисный проект задач направления — область назначения роли `project` (S:211). */
  project: string;
  cal: WorkCalendar;
  /** Руководитель направления (id участника): видит телефоны клиентов. */
  lead: string;
  /** Следующий порядковый номер. */
  next: number;
}

export interface RequestType {
  id: string;
  dir: string;
  kind: RequestKind;
  name: string;
  /** Цели в рабочих минутах направления; срок по закону — в календарных днях. */
  first: number | null;
  resolve: number | null;
  legal: number | null;
}

export interface Target {
  goal: number;
  due: number;
  stopped: number | null;
}

export interface LegalTarget {
  days: number;
  due: number;
  stopped: number | null;
}

export interface Sla {
  first: Target | null;
  resolve: Target | null;
  legal: LegalTarget | null;
}

export interface RequestMessage {
  id: string;
  kind: MessageKind;
  at: number;
  text: string;
  by?: string;
  files?: string[];
  channel?: Channel | null;
  auto?: boolean;
  score?: number;
  reasons?: string[];
  contact?: boolean;
}

export interface RequestClient {
  name: string;
  org?: string;
  /** Полный номер; в срезе участника есть только у тех, кому его показали. */
  phone?: string;
  phoneMasked?: string;
  since: string;
}

export interface RequestLink {
  label: string;
  lines: string[];
}

export interface RequestTask {
  id: string;
  title: string;
  status: string;
}

export interface ServiceRequest {
  id: string;
  key: string;
  dir: string;
  kind: RequestKind;
  title: string;
  status: RequestStatus;
  priority: RequestPriority;
  /** Исполнитель — имя участника (эталон); `null` — не назначен. */
  assignee: string | null;
  at: number;
  channel: Channel;
  client: RequestClient;
  link: RequestLink | null;
  /** Жалоба касается сотрудника (id участника): сам он обращение не видит. */
  about?: string;
  aboutName?: string;
  fromRating?: number;
  sla: Sla;
  pausedAt?: number | null;
  labels: string[];
  tasks: RequestTask[];
  messages: RequestMessage[];
  outcome?: string | null;
  resolvedAt?: number | null;
  compensation?: string;
  shared?: { text: string; at: number; by: string };
  oldKeys?: string[];
  /** Участники, которым показан телефон клиента. */
  shown?: string[];
}

export type RatingStatus = 'open' | 'seen' | 'request';

export interface Rating {
  id: string;
  dir: string;
  client: string;
  score: number;
  reasons: string[];
  comment: string;
  at: number;
  work: string;
  status: RatingStatus;
  request?: string;
}

/** Шаблон ответа: имя и текст с подстановками `{имя}`, `{номер}`, `{срок}`. */
export type ReplyTemplate = [name: string, text: string];

export interface ServiceSlice {
  directions: Direction[];
  types: RequestType[];
  templates: ReplyTemplate[];
  requests: ServiceRequest[];
  ratings: Rating[];
  /** Счётчик id обращений, сообщений и задач (`S().seq`, начинается с 200). */
  seq: number;
}

export interface DirectionView extends Direction {
  /** Имена активных участников, видящих направление и имеющих право «Отвечать». */
  team: string[];
  canContacts: boolean;
}

export type RequestView = Omit<ServiceRequest, 'client' | 'shown'> & {
  client: Omit<RequestClient, 'phone'> & { phone?: string; phoneMasked: string };
};

export interface ServiceView {
  directions: DirectionView[];
  types: RequestType[];
  templates: ReplyTemplate[];
  requests: RequestView[];
  ratings: Rating[];
  /** Нет права «Обращения · Видеть»: пустой срез с признаком. */
  hidden?: true;
}

export interface SlaItem {
  key: SlaKey;
  label: string;
  state: SlaState;
  text: string;
  until: string;
  /** Просрочка, минуты (только `late`). */
  over?: number;
  /** Остаток, минуты (только `risk`, `norm`, `legal`). */
  left?: number;
}

export interface SlaHeadInfo {
  key?: SlaKey;
  state: SlaState;
  label: string;
  text: string;
  until: string;
  over?: number;
  left?: number;
  /** Порядок очереди: меньше — срочнее. */
  rank: number;
}

/**
 * БД организации со срезом «Обращений». ModuleSlices ядра не расширяется: фикстура ядра
 * (core/testing/fixture.ts) хранит упрощённый service ({directions: {id, name, project}}), и
 * расширение сделало бы её несовместимой с TenantDb (так же у «Базы знаний»). 
ull — у
 * организации нет направлений (демо-«Лотос»).
 */
export type ServiceTenantDb = Omit<TenantDb, 'service'> & { service?: ServiceSlice | null };
