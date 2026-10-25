// Команды «Кассы» (cash.js 14.10/19.10:275–561): 16 методов `cash*` для mock-адаптера. Синхронные
// функции над БД текущей организации; задержку, сеть и `view` добавляет адаптер (`cmd` эталона).
//
// Отличия от эталона (бриф W5.30 §10):
// - команда выполняется целиком или не выполняется: при исключении срез кассы, счётчик id и
//   события возвращаются (в эталоне часть мутаций оставалась до `throw`, B §3.5 «Риски»);
// - время операций и заявок — часы домена (`Clock`, Москва), а не `new Date()` и `CASH_DAY`.
import type { CommandFn, ModuleCtx } from '../../core/module.ts';
import { advanceCommands, type CashAdvanceApi } from './commands-advance.ts';
import { approveCommands, type CashApproveApi } from './commands-approve.ts';
import { postCommands, type CashPostApi } from './commands-post.ts';
import { shiftCommands, type CashShiftApi } from './commands-shift.ts';
import { transferCommands, type CashTransferApi } from './commands-transfer.ts';
import { createKit } from './kit.ts';

export type CashApi = CashPostApi &
  CashShiftApi &
  CashTransferApi &
  CashAdvanceApi &
  CashApproveApi;

/** Задержки mock-адаптера, мс (`cmd(fn, ms)` эталона). */
export const CASH_DELAYS: Readonly<Record<keyof CashApi, number>> = {
  cashPost: 350,
  cashPostProposal: 400,
  cashDismiss: 250,
  cashLink: 250,
  cashReverse: 350,
  cashShiftOpen: 350,
  cashShiftClose: 450,
  cashShiftReview: 350,
  cashTransfer: 350,
  cashTransferAccept: 300,
  cashIssue: 350,
  cashReceipt: 350,
  cashReceiptDecide: 300,
  cashReturn: 350,
  cashApprove: 350,
  cashAccountCreate: 350,
};

export const CASH_METHODS = Object.keys(CASH_DELAYS) as readonly (keyof CashApi)[];

export function cashCommands(ctx: ModuleCtx): CashApi {
  const kit = createKit(ctx);
  const groups: CashApi = {
    ...postCommands(kit),
    ...shiftCommands(kit),
    ...transferCommands(kit),
    ...advanceCommands(kit),
    ...approveCommands(kit),
  };
  const out = {} as Record<string, CommandFn>;
  for (const name of CASH_METHODS) {
    const fn = groups[name] as (...a: never[]) => unknown;
    out[name] = ((...a: never[]) => kit.atomic(() => fn(...a))) as CommandFn;
  }
  return out as unknown as CashApi;
}
