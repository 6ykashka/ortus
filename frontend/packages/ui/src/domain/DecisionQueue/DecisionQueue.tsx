import { useId, type ReactElement } from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { Banner } from '../../core/Banner';
import { Icon } from '../../core/Icon';
import { Skeleton } from '../../core/Skeleton';
import type { DecisionQueueProps } from '../../types';
import { labels } from './labels';
import styles from './DecisionQueue.module.css';

/**
 * Очередь «Требует решения» (Ортус CRM.dc.html :1733–1744; components.md `DecisionQueue`): область с `h2`
 * и подписью-счётчиком, пункты в порядке VM (сортировка по срочности — у VM) с полосой и чипом тона, иконкой,
 * тегом, текстом и одной кнопкой; пусто — «Решений не требуется. Новые вопросы появятся здесь.». Тег и иконка
 * дублируют тон (статус = иконка + текст + цвет). Цвет полосы — `--ox-queue-mark-<tone>` потребителя или тон.
 */
export function DecisionQueue({
  title = labels.title,
  items,
  empty = labels.empty,
  max,
  count,
  state = 'ready',
  error,
}: DecisionQueueProps): ReactElement {
  const headingId = useId();
  const shown = max === undefined ? items : items.slice(0, Math.max(0, max));

  let body: ReactElement;
  if (state === 'loading') {
    body = <Skeleton lines={3} label={labels.loading} />;
  } else if (state === 'error') {
    body = (
      <Banner
        tone="danger"
        title={error?.text ?? ''}
        {...(error?.onRetry
          ? { action: { label: error.retryLabel ?? labels.retry, onPress: error.onRetry } }
          : {})}
      />
    );
  } else if (shown.length === 0) {
    body = (
      <div className={styles.empty}>
        <Icon name="task_alt" size={24} />
        <span>{empty}</span>
      </div>
    );
  } else {
    body = (
      <ul className={styles.list}>
        {shown.map((item) => (
          <li key={item.id} className={styles.item} data-tone={item.tone}>
            <span className={styles.icon} data-tone={item.tone}>
              <Icon name={item.icon ?? 'info'} size={22} />
            </span>
            <div className={styles.body}>
              <span className={styles.head}>
                <strong className={styles.title}>{item.title}</strong>
                {item.tag ? (
                  <span className={styles.tag} data-tone={item.tone}>
                    {item.tag}
                  </span>
                ) : null}
              </span>
              {item.meta ? <span className={styles.meta}>{item.meta}</span> : null}
            </div>
            {item.action ? (
              <AriaButton
                className={styles.action}
                onPress={item.action.onPress}
                isDisabled={item.action.disabled}
              >
                {item.action.label}
                <Icon name={item.action.icon ?? 'arrow_forward'} size={18} />
              </AriaButton>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className={styles.queue} aria-labelledby={headingId}>
      <div className={styles.header}>
        <h2 id={headingId} className={styles.heading}>
          {title}
        </h2>
        {count ? <span className={styles.count}>{count}</span> : null}
      </div>
      {body}
    </section>
  );
}
