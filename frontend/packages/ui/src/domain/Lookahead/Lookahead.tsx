import type { ReactElement } from 'react';
import { Status } from '../../core/Status';
import type { LookaheadProps } from '../../types';
import styles from './Lookahead.module.css';

type Chip = NonNullable<LookaheadProps['items'][number]['chips']>[number];

/** Готовность этапа по `prep`: нет исполнителя, нет материала или «всё готово» (эталон :1279, :1117–1118). */
function prepChips(p: { crew: boolean; materials: boolean } | undefined): Chip[] {
  if (!p) return [];
  const out: Chip[] = [];
  if (!p.crew) out.push({ label: 'Нет исполнителя', tone: 'warn', icon: 'person_off' });
  if (!p.materials)
    out.push({ label: 'Материала нет на объекте', tone: 'warn', icon: 'inventory_2' });
  if (!out.length)
    out.push({ label: 'Исполнитель и материалы готовы', tone: 'ok', icon: 'check_circle' });
  return out;
}

/**
 * «Ближайшие 3 недели» (design/Ремонт и стройка.dc.html :392–405): окна по неделям, в каждом — этапы кнопками с датами,
 * исполнителем и чипами; пустая неделя — «Работ по графику нет». Диаграммы нет: список читается на телефоне.
 */
export function Lookahead({ weeks, items, prep }: LookaheadProps): ReactElement {
  return (
    <div className={styles.root}>
      {weeks.map((w) => {
        const list = items.filter((i) => i.week === w.start);
        return (
          <section key={w.start} className={styles.week}>
            <div className={styles.head}>
              <h3 className={styles.title}>{w.label}</h3>
              {w.sub ? <span className={styles.sub}>{w.sub}</span> : null}
            </div>
            {list.map((i) => (
              <button key={i.id} type="button" className={styles.item} onClick={i.onOpen}>
                <span className={styles.line}>
                  <strong>{i.title}</strong>
                  {i.when ? <span className={styles.when}>{i.when}</span> : null}
                </span>{' '}
                {i.who ? <span className={styles.who}>{i.who}</span> : null}{' '}
                <span className={styles.chips}>
                  {(i.chips ?? prepChips(prep[i.id])).map((c) => (
                    <span
                      key={c.label}
                      className={styles.chip}
                      data-strong={'strong' in c && c.strong ? 'true' : undefined}
                    >
                      <Status tone={c.tone} icon={c.icon}>
                        {c.label}
                      </Status>
                    </span>
                  ))}
                </span>
              </button>
            ))}
            {list.length ? null : <div className={styles.empty}>Работ по графику нет</div>}
          </section>
        );
      })}
    </div>
  );
}
