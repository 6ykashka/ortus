// Модуль «Чаты» (W7.10, P1f chats): виды, состав из источников поверх `core/entries`, права, политики,
// проекция и 17 команд из прототипа 14.10/19.10. Общие имена эталона (`RANK`, `BOUNDS`, `tsDay`,
// `srcLabel`, `policyOf`, `Poll`…) экспортируются с префиксом `chat`/`CHAT_`, чтобы не пересечься с
// другими модулями. Интегратор подключает модуль и хук стадии `chats` строкой в `modules/index.ts`
// и `seed/compose.ts` (план v2 §3.5).
export type {
  Chat,
  ChatAccess,
  ChatBucket,
  ChatCan,
  ChatFile,
  ChatHold,
  ChatKind,
  ChatMessage,
  ChatPerson,
  ChatPolicy,
  ChatRights,
  ChatRoleKey,
  ChatSource,
  ChatsSlice,
  ChatsTenantDb,
  Poll as ChatPoll,
  MatrixGroup as ChatMatrixGroup,
} from './types.ts';
export type { ChatMy, ChatsView, ChatView, MessageView, PollView } from './view.ts';
export type {
  ChatSourceInput,
  ChatSpec,
  ChatsApi,
  MembersPreview as ChatMembersPreview,
  PolicyNote as ChatPolicyNote,
  SendSpec as ChatSendSpec,
} from './commands.ts';
export type {
  CleanupResult as ChatCleanupResult,
  StoragePlan as ChatStoragePlan,
} from './storage.ts';
export { chatsModule } from './module.ts';
export { chatsHook, chatsSeed, installChats } from './seed.ts';
export { chatsView } from './view.ts';
export {
  BOUNDS as CHAT_BOUNDS,
  CHAT_KINDS,
  CHAT_ROLE_ID,
  CHAT_ROLE_LABEL,
  CHAT_ROLES,
  DEFAULT_POLICY as CHAT_DEFAULT_POLICY,
  EDIT_LABEL as CHAT_EDIT_LABEL,
  EDIT_MIN as CHAT_EDIT_MIN,
  FULL_HINT as CHAT_FULL_HINT,
  FULL_LABEL as CHAT_FULL_LABEL,
  FULL_MODES_MVP as CHAT_FULL_MODES_MVP,
  FWD_LABEL as CHAT_FWD_LABEL,
  RANK as CHAT_RANK,
  RCPT_LABEL as CHAT_RCPT_LABEL,
  TEMP_LABEL as CHAT_TEMP_LABEL,
} from './dictionaries.ts';
export { tsDay as chatTsDay, tsLabel as chatTsLabel, tsTime as chatTsTime } from './time.ts';
export {
  chatAccess,
  chatMatrix,
  chatPeople,
  chatRights,
  chatTitle,
  chatVerbs,
  policyOf as chatPolicyOf,
  srcHas as chatSrcHas,
  srcIcon as chatSrcIcon,
  srcLabel as chatSrcLabel,
} from './access.ts';
export {
  ALL_RE as CHAT_ALL_RE,
  cleanupPlan as chatCleanupPlan,
  heldMsg as chatHeldMsg,
  planStorage as chatPlanStorage,
} from './storage.ts';
export { CHAT_DELAYS, CHAT_METHODS, chatsCommands } from './commands.ts';
