// W5.33 · Диалог «Вернуть остаток» (эталон Касса.dc.html :462–465, modalVM :916–920): сумма (по умолчанию весь
// остаток), подсказка «Отдайте деньги логисту или владельцу…». Команда — returnCashAdvance; возврат в пути
// ждёт приёма выдающим (decideCashTransfer).
import { format } from '@ortus/texts';
import { Dialog } from '@ortus/ui';
import { type ReactElement, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useBusy, useRun } from '../../../shell/run.tsx';
import { returnAdvance } from './api.ts';
import { rubles, toMinor, type Transfer } from './model.ts';
import { DialogError, DIALOG_CODES, minorToInput, problemMessage } from './parts.tsx';
import { SELF_TEXT as T } from './texts.ts';

const D = T.returnDialog;
const KEY = 'cash-return';

export interface ReturnDialogProps {
  tenantId: string;
  accountId: string;
  balanceMinor: number;
  onClose: () => void;
  /** Возврат отправлен (перемещение в пути из ответа): страница перечитывает данные. */
  onDone: (sent: Transfer) => void;
}

export function ReturnDialog({
  tenantId,
  accountId,
  balanceMinor,
  onClose,
  onDone,
}: ReturnDialogProps): ReactElement {
  const api = useApi();
  const run = useRun();
  const busy = useBusy(KEY);
  const [amount, setAmount] = useState(minorToInput(balanceMinor));
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const minor = toMinor(amount);
    if (minor === null) {
      setErr(D.needAmount);
      return;
    }
    if (minor > balanceMinor) {
      setErr(format(D.tooMuch, { sum: rubles(balanceMinor) }));
      return;
    }
    try {
      const sent = await run(
        KEY,
        () => returnAdvance(api, tenantId, accountId, minor),
        T.toast.returned,
        {
          quiet: DIALOG_CODES,
        },
      );
      onDone(sent);
      onClose();
    } catch (e) {
      setErr(problemMessage(e));
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={D.title}
      busy={busy}
      footer={
        <>
          <button type="button" className="ox-cs-btn" onClick={onClose}>
            {T.cancel}
          </button>
          <button
            type="button"
            className="ox-cs-btn"
            data-primary=""
            disabled={busy}
            onClick={() => void submit()}
          >
            {D.submit}
          </button>
        </>
      }
    >
      <div className="ox-cs-dlg">
        <span className="ox-cs-dlg-sub">{format(D.sub, { sum: rubles(balanceMinor) })}</span>
        <label className="ox-cs-field">
          {D.amount}
          <input
            inputMode="decimal"
            value={amount}
            data-invalid={err ? '' : undefined}
            onChange={(e) => {
              setAmount(e.target.value);
              setErr(null);
            }}
          />
        </label>
        <span className="ox-cs-hint">{D.note}</span>
        {err ? <DialogError text={err} /> : null}
      </div>
    </Dialog>
  );
}
