// W7.26 · Диалог «Утвердить · ПЭП» (эталон «Документы.dc.html» :703–715, signVM :1453–1456; `requestDocSignCode`,
// `confirmDocSign`). Контракт 0.12.0-stage7: утверждающий подтверждает подпись повторным входом в Ортус
// (`pep_login`, Q-W4.00-documents-2), код из SMS — только заказчику (D-31) — Q-W7.26-1. Попытки: после третьей
// неверной сервер отвечает 429 `rate_limited` и просит новый запрос.
import { type components } from '@ortus/api-client';
import { Button, Dialog, Field } from '@ortus/ui';
import { type ReactElement, useEffect, useId, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { confirmSign, idemKeys, requestSignCode } from './api.ts';
import { DIALOG_CODES, useCommand } from './cmd.ts';
import { ROUTE_TEXT as T } from './texts.ts';

type S = components['schemas'];

export function SignDialog(p: {
  tenantId: string;
  doc: S['Document'];
  route: S['DocRoute'];
  onClose: () => void;
}): ReactElement {
  const api = useApi();
  const id = useId();
  const cmd = useCommand(p.tenantId);
  const [keys] = useState(idemKeys);
  const [challenge, setChallenge] = useState<S['DocSignChallenge'] | undefined>();
  const [password, setPassword] = useState('');
  const asked = useRef(false);
  const cmdRef = (docId: string) => ({ api, tenantId: p.tenantId, docId });

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    const body: S['DocSignCodeRequest'] = { method: 'pep_login' };
    void cmd
      .exec(
        'docs.sign.code',
        () => requestSignCode({ ...cmdRef(p.doc.id), key: keys.key(body) }, body),
        null,
        DIALOG_CODES,
      )
      .then((c) => c && setChallenge(c));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- один запрос на открытие диалога
  }, []);

  useEffect(() => {
    if (challenge) document.getElementById(`${id}-pass`)?.focus();
  }, [challenge, id]);

  const submit = async (): Promise<void> => {
    if (!password) return;
    const body: S['DocSignConfirm'] = { method: 'pep_login', password };
    const done = await cmd.exec(
      'docs.sign',
      () => confirmSign({ ...cmdRef(p.doc.id), key: keys.key(body) }, body),
      T.sign.done,
      DIALOG_CODES,
    );
    if (done) {
      p.onClose();
      return;
    }
    keys.settle(body);
    setPassword('');
    setChallenge((c) => (c ? { ...c, attemptsLeft: Math.max(0, c.attemptsLeft - 1) } : c));
  };

  const busy = cmd.busy === 'docs.sign';
  return (
    <Dialog
      open
      onClose={p.onClose}
      title={T.sign.title}
      size="sm"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onPress={p.onClose} disabled={busy}>
            {T.sign.cancel}
          </Button>
          <Button
            onPress={() => void submit()}
            disabled={busy || !challenge || !password || challenge.attemptsLeft === 0}
          >
            {T.sign.submit}
          </Button>
        </>
      }
    >
      <div className="ox-rt-field-col">
        <p className="ox-rt-dlg-sub">{`${p.doc.title} · v${p.route.version}`}</p>
        <p className="ox-rt-sign-sub">{challenge ? T.sign.text : T.sign.preparing}</p>
        <Field label={T.sign.password} id={`${id}-pass`}>
          <input
            id={`${id}-pass`}
            type="password"
            className="ox-rt-pass"
            autoComplete="current-password"
            value={password}
            disabled={!challenge}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
          />
        </Field>
        {challenge ? (
          <p className="ox-rt-note">{`${T.sign.attempts}: ${challenge.attemptsLeft}`}</p>
        ) : null}
        {cmd.error ? (
          <p role="alert" className="ox-rt-err">
            {cmd.error}
          </p>
        ) : null}
        <p className="ox-rt-note">{`${T.sign.passwordHint} v${p.route.version}.`}</p>
      </div>
    </Dialog>
  );
}
