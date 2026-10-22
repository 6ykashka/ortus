// W4.23 · Вкладка «Версии» (`forms-versions`; эталон design-2026-10-19 «Формы и опросы.dc.html» dc:440–454, versVM
// dc:1012–1020; разбор forms.md §1.9): список версий (`listFormVersions`, новая первой, «Действует»), структура выбранной
// версии по страницам с отличиями от предыдущей («Добавлено», «Новый тип», «Текст изменён», «Изменено») и «Убрано
// относительно предыдущей версии». Пусто — «Форма ещё не публиковалась».
import { format, formsResults as F } from '@ortus/texts';
import { type ReactElement, useState } from 'react';

import { useVersions } from './api.ts';
import { Failed, Glyph, Pending } from './ctx.tsx';
import { versionMeta, versionView } from './model.ts';
import './results.css';

const V = F.versions;

export function VersionsTab({
  tenantId,
  formId,
}: {
  tenantId: string;
  formId: string;
}): ReactElement {
  const q = useVersions(tenantId, formId);
  const [pick, setPick] = useState<number | null>(null);
  // Ошибка — карточкой, только если данных нет: отказ перечитывания при данных в кэше вкладку не роняет.
  if (!q.data)
    return <div className="ox-fr-vs">{q.isError ? <Failed q={q} /> : <Pending rows={3} />}</div>;
  const vs = [...q.data].sort((a, b) => b.number - a.number);
  const sel = vs.find((v) => v.number === pick) ?? vs[0];
  const prev = sel ? vs.find((v) => v.number === sel.number - 1) : undefined;
  const view = sel ? versionView(sel, prev) : null;
  return (
    <div className="ox-fr-vs">
      <div className="ox-fr-vlist">
        {!vs.length ? <div className="ox-fr-vnone">{V.none}</div> : null}
        {vs.map((v) => (
          <button
            key={v.id}
            type="button"
            aria-pressed={v.number === sel?.number}
            onClick={() => setPick(v.number)}
          >
            <span className="ox-fr-vrow">
              <strong>{format(V.item, { n: v.number })}</strong>
              {v.current ? <span className="ox-fr-vcur">{V.current}</span> : null}
            </span>
            <span className="ox-fr-vmeta">{versionMeta(v)}</span>
          </button>
        ))}
      </div>
      {sel && view ? (
        <div className="ox-fr-ver">
          <h3>{format(V.title, { n: sel.number })}</h3>
          {view.questions.map((x) => (
            <div key={x.key} className="ox-fr-vq-wrap">
              {x.pageStart ? <div className="ox-fr-vpage">{x.page}</div> : null}
              <div className="ox-fr-vq">
                <Glyph name={x.icon} size={20} className="ox-fr-vq-icon" />
                <div className="ox-fr-vq-body">
                  <div className="ox-fr-vq-label">{x.label}</div>
                  <div className="ox-fr-vq-meta">{x.meta}</div>
                </div>
                {x.diff ? (
                  <span className="ox-fr-chip" data-tone={x.diff.tone} data-small="">
                    {x.diff.label}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
          {view.removed.map((r, i) => (
            <div key={i} className="ox-fr-vremoved">
              <Glyph name="remove_circle" size={20} />
              {/* Подпись и вопрос — отдельные элементы флекса с зазором, как текстовые узлы эталона (dc:450). */}
              <span>{format(V.removed, { list: '' })}</span>
              <span>{r}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
