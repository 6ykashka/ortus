import { useId, useState, type ReactElement } from 'react';
import { Button } from '../../core/Button';
import { Icon } from '../../core/Icon';
import type { ScheduleChangePreviewProps } from '../../types';
import { ddmm, dayNum } from '../Gantt/dates';
import styles from './ScheduleChangePreview.module.css';

const d = (iso: string): string => ddmm(dayNum(iso));

/**
 * Предпросмотр изменения графика (design/Ремонт и стройка.dc.html :304–325): что сдвинется, как изменится сдача,
 * кого уведомят; без причины сохранить нельзя. `role="region"`, причина — `select` с подписью. Тексты можно передать
 * готовыми (`texts`), иначе они собираются из `changes`, `moved`, `finish` и `notify`.
 */
export function ScheduleChangePreview({
  changes,
  moved,
  finish,
  notify,
  reasons,
  onApply,
  onCancel,
  texts,
  late = false,
  busy = false,
}: ScheduleChangePreviewProps): ReactElement {
  const [reason, setReason] = useState('');
  const id = useId();
  const lines = texts?.lines
    ? [texts.lines]
    : changes.map((c) => `«${c.title}»: начало ${d(c.from.start)} → ${d(c.start)}`);
  const movedText =
    texts?.moved ?? (moved > 0 ? `Сдвинутся следом: ${moved}.` : 'Другие этапы не сдвигаются.');
  const finishText =
    texts?.finish ??
    (finish.from === finish.to
      ? `Дата сдачи не меняется: ${d(finish.to)}.`
      : `Сдача: ${d(finish.from)} → ${d(finish.to)}.`);
  const notifyText =
    texts?.notify ?? `Уведомим: ${notify.length ? notify.join(', ') : 'исполнителей нет'}.`;
  const blocked = busy || !reason;

  return (
    <section className={styles.root} role="region" aria-label="Несохранённое изменение графика">
      <div className={styles.top}>
        <span className={styles.icon}>
          <Icon name="edit_calendar" size={22} />
        </span>
        <div className={styles.text}>
          <strong>Предпросмотр изменения — ещё не сохранено</strong>
          {lines.map((l) => (
            <span key={l} className={styles.line}>
              {l}
            </span>
          ))}
          <span className={styles.line}>{movedText}</span>
          <span className={styles.finish} data-late={late}>
            {finishText}
          </span>
          <span className={styles.notify}>{notifyText}</span>
        </div>
      </div>
      <div className={styles.actions}>
        <div className={styles.reason}>
          <label htmlFor={id}>Причина</label>
          <select
            id={id}
            className={styles.select}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">Выберите причину</option>
            {reasons.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <Button icon="check" disabled={blocked} loading={busy} onPress={() => onApply(reason)}>
          Сохранить и уведомить
        </Button>
        <Button variant="secondary" disabled={busy} onPress={onCancel}>
          Отменить
        </Button>
        {!reason ? (
          <span className={styles.hint}>Причина попадёт в историю графика и в уведомления.</span>
        ) : null}
      </div>
    </section>
  );
}
