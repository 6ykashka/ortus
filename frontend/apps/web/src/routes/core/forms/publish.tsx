// W4.22 · Диалог «Опубликовать» (`modal-form-publish`, dc:457–466, modalVM dc:1063–1080): с ошибками — «Сначала
// исправьте форму», «Найдено ошибок: N…», «Перейти к конструктору»; без — «Опубликовать «…» vN?» и пункты (первая
// версия, привязка ответов, новые обязательные, смена типа, убранные вопросы, баллы без вариантов, поля «в БЗ»
// правил, «Действия после ответа…»). «Опубликовать vN» — `publishForm` (`draftRevision`, If-Match формы) после
// сохранения правок; ошибка сервера — первым пунктом. Escape и «Отмена» закрывают, фокус — в диалог и обратно.
import type { components } from '@ortus/api-client';
import { format, forms as F } from '@ortus/texts';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactElement, useEffect, useRef, useState } from 'react';

import { useApi } from '../../../app/api.tsx';
import { commands, formsKey } from './api.ts';
import { EDITOR_H1, errorText, useForms } from './ctx.tsx';
import type { EditorModel } from './editor.tsx';
import type { Tone } from './model.ts';
import { Glyph } from './parts.tsx';

type S = components['schemas'];

interface Item {
  icon: string;
  tone: Tone;
  text: string;
}

const names = (xs: readonly { label: string }[]): string =>
  xs.map((x) => `«${x.label}»`).join(', ');

/** Пункты диалога без ошибок (dc:1067–1077). */
function publishItems(m: EditorModel, rules: readonly S['FormRule'][]): Item[] {
  const items: Item[] = [];
  const d = m.def;
  const prev = m.published?.fields ?? [];
  const v = m.form.publishedVersionNumber;
  if (v) {
    items.push({
      icon: 'history',
      tone: 'ok',
      text: format(F.publish.kept, { n: m.form.responseCount }),
    });
  } else {
    const who = m.form.settings.access === 'public' ? F.publish.who.public : F.publish.who.members;
    items.push({ icon: 'campaign', tone: 'info', text: format(F.publish.first, { who }) });
  }
  const nr = d.fields.filter((x) => x.required && !prev.some((p) => p.key === x.key));
  if (v && nr.length)
    items.push({
      icon: 'info',
      tone: 'info',
      text: format(F.publish.newRequired, { names: names(nr) }),
    });
  const tc = d.fields.filter((x) => {
    const o = prev.find((p) => p.key === x.key);
    return o && o.type !== x.type;
  });
  if (tc.length)
    items.push({
      icon: 'swap_horiz',
      tone: 'warn',
      text: format(F.publish.typeChanged, { names: names(tc) }),
    });
  const rm = prev.filter((p) => !d.fields.some((x) => x.key === p.key));
  if (rm.length)
    items.push({
      icon: 'remove_circle',
      tone: 'neutral',
      text: format(F.publish.removed, { names: names(rm) }),
    });
  for (const w of m.issues.W) items.push({ icon: 'warning', tone: 'warn', text: w });
  for (const r of rules.filter((x) => x.kind === 'kb' && x.enabled)) {
    const miss = (r.kb?.fields ?? []).filter((f) => {
      if (f.source.startsWith('$')) return false;
      const now = d.fields.find((q) => q.key === f.source);
      const was = prev.find((o) => o.key === f.source);
      return !now || (was && now.type !== was.type);
    });
    if (miss.length) {
      items.push({
        icon: 'menu_book',
        tone: 'warn',
        text: format(F.publish.kb, { names: miss.map((f) => `«${f.name}»`).join(', ') }),
      });
    }
  }
  if (rules.some((r) => r.enabled))
    items.push({ icon: 'bolt', tone: 'neutral', text: F.publish.rules });
  return items;
}

export function PublishDialog(p: {
  m: EditorModel;
  rules: readonly S['FormRule'][];
  onClose: (toBuilder: boolean) => void;
  onPublished: (d: S['FormDraft'], etag: string | null) => void;
}): ReactElement {
  const api = useApi();
  const qc = useQueryClient();
  const { tenantId, cmd } = useForms();
  const { m } = p;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const box = useRef<HTMLDivElement | null>(null);
  const back = useRef<HTMLElement | null>(null);
  const E = m.issues.E;
  const bad = E.length > 0;
  const v = (m.form.publishedVersionNumber ?? 0) + 1;

  useEffect(() => {
    back.current = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    return () => {
      // Фокус — кнопке, открывшей диалог; она недоступна («Опубликовано» после публикации) — заголовку формы.
      const b = back.current;
      const restore = () => {
        if (b?.isConnected) b.focus({ preventScroll: true });
        if (!b || document.activeElement !== b)
          document.getElementById(EDITOR_H1)?.focus({ preventScroll: true });
      };
      restore();
      setTimeout(() => {
        if (document.activeElement === document.body) restore();
      }, 0);
    };
  }, []);

  const close = (toBuilder = false) => {
    if (busy) return;
    p.onClose(toBuilder);
  };

  // Escape и ловушка Tab — и когда фокус вне диалога (щелчок по подложке, потерянный фокус): слушатель документа.
  // Escape внутри диалога обрабатывает onKeyDown (не доходит до документа).
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      else if (e.key === 'Tab') trap(e, box.current);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    const saved = await m.draft.flush();
    if (!saved) {
      setBusy(false);
      setErr(m.draft.saveError || F.publish.bad);
      return;
    }
    const rev = qc.getQueryData<{ draft: S['FormDraft'] }>([
      ...formsKey(tenantId),
      'draft',
      m.form.id,
    ])?.draft.revision;
    const r = await cmd(
      { op: 'publish', id: m.form.id, rev },
      (key) =>
        commands.publish(api, tenantId, m.form.id, m.formEtag ?? '', rev ?? m.draft.revision, key),
      format(F.toasts.published, { v, name: m.form.name }),
      { local: true },
    );
    if (!r.ok) {
      setBusy(false);
      // «Нет связи» уже показал тост оболочки — без повтора пунктом диалога.
      if (r.code !== 'offline') setErr(r.error ?? errorText(null));
      return;
    }
    // Черновик после публикации — действующая версия (ключи сменивших тип вопросов — `{key}-v{N}`).
    const fresh = await m.draft.query.refetch();
    if (fresh.data) p.onPublished(fresh.data.draft, fresh.data.etag);
    setBusy(false);
    p.onClose(false);
  };

  const items: Item[] = [
    ...(err ? [{ icon: 'error', tone: 'danger' as const, text: err }] : []),
    ...E.map((t) => ({ icon: 'error', tone: 'danger' as const, text: t })),
    ...(bad ? [] : publishItems(m, p.rules)),
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="fm-md-t"
      className="ox-fm-modal"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div ref={box} className="ox-fm-modal-box">
        <div className="ox-fm-modal-head">
          <h2 id="fm-md-t">
            {bad ? F.publish.bad : format(F.publish.title, { name: m.form.name, v })}
          </h2>
          <span>
            {bad ? format(F.publish.badText, { n: E.length }) : format(F.publish.text, { v })}
          </span>
        </div>
        {items.map((it, i) => (
          <div
            key={i}
            className="ox-fm-modal-item"
            data-tone={it.tone}
            {...(i === 0 && err ? { role: 'alert' } : {})}
          >
            <Glyph name={it.icon} size={18} />
            <span>{it.text}</span>
          </div>
        ))}
        <div className="ox-fm-modal-actions">
          <button type="button" className="ox-fm-btn" onClick={() => close(bad)}>
            {bad ? F.publish.toBuilder : F.publish.cancel}
          </button>
          {!bad ? (
            <button
              type="button"
              className="ox-fm-btn"
              data-variant="primary"
              data-size="publish"
              // Не `disabled`: сфокусированная кнопка не теряет фокус на время команды (Escape и Tab работают).
              aria-disabled={busy || undefined}
              aria-busy={busy}
              onClick={() => void confirm()}
            >
              <Glyph name="publish" size={18} />
              {format(F.publish.confirm, { v })}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Ловушка Tab внутри диалога; фокус вне диалога — Tab возвращает его к первому (Shift+Tab — к последнему). */
function trap(e: KeyboardEvent, box: HTMLElement | null): void {
  if (!box) return;
  const els = [
    ...box.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea'),
  ];
  const first = els[0];
  const last = els.at(-1);
  if (!first || !last) return;
  if (!box.contains(document.activeElement)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
