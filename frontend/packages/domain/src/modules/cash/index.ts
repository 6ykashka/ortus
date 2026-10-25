// Модуль «Касса» (W5.30, P1g cash): кассы, смены, предложения модулей, подотчёт и согласование
// из прототипа 14.10/19.10. Имена эталона, общие с другими модулями (`nameOf`, `rub`, `plural`,
// `unitTitle`), экспортируются с префиксом `cash`, чтобы не пересечься с документами и чатами.
export type * from './types.ts';
export type { CashPostApi, CashPostInput, CashPayInput } from './commands-post.ts';
export type { CashShiftApi, CashCloseInput } from './commands-shift.ts';
export type { CashTransferApi, CashTransferInput } from './commands-transfer.ts';
export type {
  CashAdvanceApi,
  CashIssueInput,
  CashReceiptInput,
  CashReturnInput,
} from './commands-advance.ts';
export type { CashApproveApi, CashAccountInput } from './commands-approve.ts';
export type { CashApi } from './commands.ts';
export type { CashPerson } from './access.ts';
export type {
  AdvanceReceiptView,
  CashAccountMy,
  CashAccountView,
  CashOpView,
  CashRequestView,
  CashShiftView,
  CashTodoItem,
  CashTransferView,
  CashView,
} from './view.ts';
export { cashHook, cashModule, createCashModule } from './module.ts';
export {
  CASH_SEED_STAGE,
  cashSeedAlta,
  installCash,
  makeAccount as cashMakeAccount,
} from './seed.ts';
export { CASH_DELAYS, CASH_METHODS, cashCommands } from './commands.ts';
export { cashView, cashTodo } from './view.ts';
export { cashProposals } from './proposals.ts';
export {
  accCan as cashAccCan,
  canAcceptTransfer,
  cashAccess,
  cashPeople,
  rightsText as cashRightsText,
} from './access.ts';
export { assertCashScope, driverCashSelf } from './role-rules.ts';
export {
  ALL_VERBS as CASH_ALL_VERBS,
  CASH_OPT0,
  CATS as CASH_CATS,
  DENOMS as CASH_DENOMS,
  KIND as CASH_KIND,
  KKT as CASH_KKT,
  METHOD as CASH_METHOD,
  METHODS_OF as CASH_METHODS_OF,
  MODE as CASH_MODE,
  OP as CASH_OP,
  PRICE as CASH_PRICE,
  REQ_LABEL as CASH_REQ_LABEL,
  VERB_TEXT as CASH_VERB_TEXT,
  balanceOf as cashBalanceOf,
  drawerFor as cashDrawerFor,
  dueState as cashDueState,
  nameOf as cashNameOf,
  opSign as cashOpSign,
  openShift as cashOpenShift,
  parseSum as cashParseSum,
  plural as cashPlural,
  rub as cashRub,
  signRub as cashSignRub,
  unitTitle as cashUnitTitle,
} from './dictionaries.ts';
