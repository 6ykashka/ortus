// W1.25 · Диалог команды оператора (opConfirm :2176–2201, :2796–2798) с обязательным полем «Причина» (S1-04,
// Q-W1.00-1; поля в эталоне нет — design-requests «platform-tenants · поле «Причина»»). Собран на @ortus/ui Dialog:
// у ConfirmDialog нет слота для поля (бриф W1.25 §10 п. 3). Кнопка действия недоступна, пока причина короче
// 5 символов или длиннее 500 (тогда — ошибка под полем); 422 — ошибка под полем; прочие ошибки — тост оболочки,
// диалог остаётся открытым.
import { ProblemError } from '@ortus/api-client';
import { errors, platform, shell, toast } from '@ortus/texts';
import { Button, Dialog, Field, Icon, Textarea, type Tone } from '@ortus/ui';
import { type ReactElement, useEffect, useId, useState } from 'react';

import { useRun } from '../../../../shell/run.tsx';
import { reasonOk, reasonTooLong } from './model.ts';
import { ORGS_TEXT } from './texts.ts';

export interface Consequence {
  icon: string;
  tone: Tone;
  text: string;
}

export interface CommandSpec {
  title: string;
  text: string;
  items: readonly Consequence[];
  confirm: string;
  danger: boolean;
}

const C = platform.tenants.confirm;

/** Тексты диалогов эталона (opVM :3551–3557, 04-platform §5.1 «Взаимодействия»). */
export const COMMANDS = {
  extend: (name: string): CommandSpec => ({
    title: C.extendTitle.replace('{name}', name),
    text: C.extendText,
    items: [
      { icon: 'lock_open', tone: 'ok', text: C.opsBack },
      { icon: 'history', tone: 'neutral', text: C.audited },
    ],
    confirm: C.extendConfirm,
    danger: false,
  }),
  suspend: (name: string): CommandSpec => ({
    title: C.restrictTitle.replace('{name}', name),
    text: C.restrictText,
    items: [
      { icon: 'block', tone: 'warn', text: C.restrictClosed },
      { icon: 'task_alt', tone: 'ok', text: C.restrictFinish },
      { icon: 'inventory_2', tone: 'ok', text: C.dataKept },
    ],
    confirm: C.restrictConfirm,
    danger: true,
  }),
  resume: (name: string): CommandSpec => ({
    title: C.liftTitle.replace('{name}', name),
    text: C.liftText,
    items: [{ icon: 'lock_open', tone: 'ok', text: C.opsBack }],
    confirm: platform.tenants.actions.lift,
    danger: false,
  }),
} as const;

/** Текст ошибки поля из 422: нарушение поля `reason`, иначе общий текст кода. */
function reasonError(e: unknown): string | undefined {
  if (!(e instanceof ProblemError) || e.code !== 'validation_failed') return undefined;
  const v = e.problem?.violations?.find((x) => x.field === 'reason');
  return v?.message ?? errors.problem.validation_failed;
}

export function CommandDialog({
  spec,
  onClose,
  onConfirm,
}: {
  spec: CommandSpec;
  onClose: () => void;
  /** Команда с причиной; успех закрывает диалог, ошибка оставляет его открытым. */
  onConfirm: (reason: string) => Promise<void>;
}): ReactElement {
  const run = useRun();
  const fieldId = useId();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  /** Счётчик неудачных попыток: после ошибки фокус возвращается на поле. */
  const [failures, setFailures] = useState(0);

  // Фокус — на поле «Причина»: при открытии (RAC ставит фокус на диалог раньше этого эффекта) и после ошибки —
  // чтобы поправить причину. Во время запроса кнопка действия занята (`loading`: aria-disabled, aria-busy), а не
  // disabled, и фокус остаётся на ней — в диалоге, а не на body.
  useEffect(() => {
    document.getElementById(fieldId)?.focus();
  }, [fieldId, failures]);

  const confirm = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await run('platform.command', () => onConfirm(reason), toast.platform.done, {
        quiet: ['validation_failed'],
      });
      onClose();
    } catch (e) {
      setError(reasonError(e));
      setBusy(false);
      setFailures((n) => n + 1);
    }
  };

  const footer = (
    <>
      <Button variant="secondary" onPress={onClose} disabled={busy}>
        {shell.modal.cancel}
      </Button>
      <Button
        variant={spec.danger ? 'danger' : 'primary'}
        onPress={() => void confirm()}
        disabled={!busy && !reasonOk(reason)}
        loading={busy}
        loadingLabel={shell.modal.busy}
      >
        {spec.confirm}
      </Button>
    </>
  );

  return (
    <Dialog open onClose={onClose} title={spec.title} busy={busy} footer={footer}>
      <div className="ox-orgs-dialog">
        <p className="ox-orgs-dialog-text">{spec.text}</p>
        <div className="ox-orgs-dialog-section">
          <span className="ox-orgs-dialog-title">{shell.modal.consequences}</span>
          <ul className="ox-orgs-dialog-items">
            {spec.items.map((i) => (
              <li key={i.text} className="ox-orgs-dialog-item">
                <Icon name={i.icon} size={18} className={`ox-orgs-tone-${i.tone}`} />
                <span className="ox-orgs-conseq">{i.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <Field
          id={fieldId}
          label={ORGS_TEXT.reason.label}
          hint={ORGS_TEXT.reason.hint}
          error={error ?? reasonTooLong(reason)}
          required
          disabled={busy}
        >
          <Textarea value={reason} onChange={setReason} rows={3} />
        </Field>
      </div>
    </Dialog>
  );
}
