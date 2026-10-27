// W5.33 · Диалог «Добавить чек» / «Переснять чек» (эталон Касса.dc.html :449–460, modalVM :906–915): плитки
// «Сфотографировать чек» и «Сканировать QR чека», сумма, статья, «К чему относится». Фото — файл Files
// (initiateUpload → PUT → completeUpload → проверка), в эталоне плитка просто переключалась. QR — снимок кода,
// распознаётся `BarcodeDetector` (где он есть); сумма берётся из `s=` чека ФНС, снимок становится фото чека.
// Команда — submitAdvanceReceipt (cash.advance.self, только держатель).
import { format } from '@ortus/texts';
import { Dialog } from '@ortus/ui';
import { type ReactElement, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { useBusy, useRun } from '../../../shell/run.tsx';
import { submitReceipt } from './api.ts';
import { parseReceiptQr, type ReceiptRow, rubles, type SelfCard, toMinor } from './model.ts';
import { DialogError, DIALOG_CODES, minorToInput, problemMessage, Sym } from './parts.tsx';
import { SELF_TEXT as T } from './texts.ts';
import { ReceiptRejectedError, uploadReceiptPhoto } from './upload.ts';

const D = T.receiptDialog;
const KEY = 'cash-receipt';

interface Detector {
  detect(image: ImageBitmap): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = new (o?: { formats?: string[] }) => Detector;

/** Содержимое QR со снимка; `null` — декодера нет в браузере или кода на снимке нет. */
export async function readQr(file: Blob): Promise<string | null> {
  const Ctor = (globalThis as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (!Ctor || typeof createImageBitmap !== 'function') return null;
  try {
    const image = await createImageBitmap(file);
    const found = await new Ctor({ formats: ['qr_code'] }).detect(image);
    image.close?.();
    return found[0]?.rawValue ?? null;
  } catch {
    return null;
  }
}

type Photo = { state: 'none' } | { state: 'busy' } | { state: 'ready'; fileId: string };

export interface ReceiptDialogProps {
  tenantId: string;
  card: SelfCard;
  /** «Переснять»: отклонённый чек, с которого берутся сумма, статья и связь. */
  redo: ReceiptRow | null;
  onClose: () => void;
  /** Чек отправлен: страница перечитывает данные. */
  onDone: () => void;
}

export function ReceiptDialog({
  tenantId,
  card,
  redo,
  onClose,
  onDone,
}: ReceiptDialogProps): ReactElement {
  const api = useApi();
  const run = useRun();
  const busy = useBusy(KEY);
  const [amount, setAmount] = useState(redo ? minorToInput(redo.amountMinor) : '');
  const [cat, setCat] = useState(redo?.categoryId ?? card.categories[0]?.id ?? '');
  const [link, setLink] = useState(redo?.note ?? '');
  const [photo, setPhoto] = useState<Photo>({ state: 'none' });
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const qrInput = useRef<HTMLInputElement>(null);

  const upload = async (file: File): Promise<void> => {
    setPhoto({ state: 'busy' });
    try {
      const fileId = await uploadReceiptPhoto(api, tenantId, card.id, file);
      setPhoto({ state: 'ready', fileId });
    } catch (e) {
      setPhoto({ state: 'none' });
      setErr(e instanceof ReceiptRejectedError ? D.uploadRejected : D.uploadFail);
    }
  };

  const onPhoto = (file: File | undefined): void => {
    if (!file) return;
    setErr(null);
    void upload(file);
  };

  const onQr = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setErr(null);
    const payload = await readQr(file);
    const sum = payload ? parseReceiptQr(payload) : null;
    if (!payload || !sum) {
      setErr(D.qrFail);
      return;
    }
    setQr(payload);
    setAmount(minorToInput(sum.amountMinor));
    if (photo.state === 'none') await upload(file);
  };

  const submit = async () => {
    const minor = toMinor(amount);
    if (minor === null) return setErr(D.needAmount);
    if (!cat) return setErr(D.needCategory);
    if (photo.state !== 'ready') return setErr(D.needPhoto);
    const { fileId } = photo;
    try {
      await run(
        KEY,
        () =>
          submitReceipt(api, tenantId, {
            accountId: card.id,
            amountMinor: minor,
            categoryId: cat,
            fileId,
            note: link.trim(),
            qr,
            redoOfReceiptId: redo?.id ?? null,
          }),
        T.toast.receipt,
        { quiet: DIALOG_CODES },
      );
      onDone();
      onClose();
    } catch (e) {
      setErr(problemMessage(e));
    }
  };

  const photoText =
    photo.state === 'ready' ? D.photoDone : photo.state === 'busy' ? D.photoBusy : D.photo;
  const uploading = photo.state === 'busy';

  return (
    <Dialog
      open
      onClose={onClose}
      title={redo ? D.redoTitle : D.title}
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
            disabled={busy || uploading}
            onClick={() => void submit()}
          >
            {busy ? D.sending : D.submit}
          </button>
        </>
      }
    >
      <div className="ox-cs-dlg">
        <span className="ox-cs-dlg-sub">{format(D.sub, { sum: rubles(card.balanceMinor) })}</span>
        <div className="ox-cs-tiles">
          <button
            type="button"
            className="ox-cs-tile"
            data-on={photo.state === 'ready' ? '' : undefined}
            aria-busy={uploading || undefined}
            onClick={() => photoInput.current?.click()}
          >
            <Sym name={photo.state === 'ready' ? 'check_circle' : 'photo_camera'} size={28} />
            {photoText}
          </button>
          <button
            type="button"
            className="ox-cs-tile"
            data-on={qr ? '' : undefined}
            onClick={() => qrInput.current?.click()}
          >
            <Sym name="qr_code_scanner" size={28} />
            {qr ? D.qrDone : D.qr}
          </button>
          <input
            ref={photoInput}
            hidden
            type="file"
            accept="image/*"
            capture="environment"
            aria-label={D.photoAria}
            onChange={(e) => {
              onPhoto(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <input
            ref={qrInput}
            hidden
            type="file"
            accept="image/*"
            capture="environment"
            aria-label={D.qrAria}
            onChange={(e) => {
              void onQr(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
        <div className="ox-cs-pair">
          <label className="ox-cs-field">
            {D.amount}
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setErr(null);
              }}
            />
          </label>
          <label className="ox-cs-field">
            {D.category}
            <select value={cat} onChange={(e) => setCat(e.target.value)}>
              {card.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="ox-cs-field">
          {D.link}
          <input
            value={link}
            placeholder={card.linkHint}
            onChange={(e) => setLink(e.target.value)}
          />
        </label>
        <span className="ox-cs-hint">{(qr ? D.noteQr : '') + D.note}</span>
        {err ? <DialogError text={err} /> : null}
      </div>
    </Dialog>
  );
}
