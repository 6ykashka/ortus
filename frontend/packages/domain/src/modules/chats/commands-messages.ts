// Команды сообщений чатов (chats.js 14.10:378–499): прочтение, отправка, правка, удаление,
// подтверждение, опросы, закрепление, раскрытие ПДн, одноразовые файлы, «Сохранить в запись»,
// «Задача из сообщения». Проверки идут до изменений. Отличия от эталона (PD-60, бриф W7.10 §10):
// - удалённое сообщение не подтверждается, не оценивается, не открывается и не превращается в задачу;
// - удержание защищает сообщения (`heldMsg`); `@все` разбирается одним регулярным выражением;
//   `@Имя` уведомляет только участника чата;
// - место чата считается до изменений (`planStorage`);
// - «Задача из сообщения» создаётся через `TaskPort`: проект выбирает вызывающий или берётся по
//   подразделению чата, id выдаёт задачник; закрытие опроса — один раз; открытие одноразового файла
//   после удаления по таймеру — отказ.
import { pluralN, gb } from '../../core/format.ts';
import type { ModuleCtx } from '../../core/module.ts';
import { chatTitle } from './access.ts';
import type { ChatsApi } from './commands.ts';
import { chatsKit } from './commands-kit.ts';
import { CHAT_KINDS, EDIT_LABEL, EDIT_MIN } from './dictionaries.ts';
import { ALL_RE, heldMsg, planStorage } from './storage.ts';
import { tsDay, tsLabel, tsTime } from './time.ts';
import type { ChatFile, FileKind, Poll } from './types.ts';

type MessageApi = Pick<
  ChatsApi,
  | 'chatOpen'
  | 'chatSend'
  | 'chatEdit'
  | 'chatDelete'
  | 'chatAck'
  | 'chatVote'
  | 'chatPollClose'
  | 'chatPin'
  | 'chatReveal'
  | 'chatOpenOnce'
  | 'chatSaveTo'
  | 'chatToTask'
>;

const BUCKET_KIND: Readonly<Record<string, FileKind>> = {
  photo: 'photo',
  video: 'video',
  voice: 'voice',
};
const BUCKET_LABEL: Readonly<Record<FileKind, string>> = {
  photo: 'Фото',
  video: 'Видео',
  voice: 'Голосовые',
  doc: 'Документы',
};

export function messageCommands(ctx: ModuleCtx): MessageApi {
  const { ApiError } = ctx;
  const K = chatsKit(ctx);
  const { me, meName, X, chat, need, find, tick, inIds, post, sys, journal } = K;
  /** Сообщение, с которым ещё можно работать: удалённое — только метка. */
  const live = <T extends { deleted?: unknown }>(m: T): T => {
    if (m.deleted) throw new ApiError('validation', 'Сообщение удалено');
    return m;
  };

  return {
    chatOpen(id) {
      const c = chat(id);
      need(c);
      const now = X().now;
      for (const m of c.msgs) {
        if (m.by !== me() && m.by !== 'sys' && !m.reads[me()]) m.reads[me()] = now;
      }
      c.lastRead = { ...c.lastRead, [me()]: c.seq };
      return { ok: true };
    },

    chatSend(id, spec) {
      const c = chat(id);
      const s = spec ?? {};
      const r = need(
        c,
        'write',
        c.kind === 'announce'
          ? 'В объявлениях пишут модераторы'
          : c.status === 'archived'
            ? 'Чат в архиве: только чтение'
            : 'У вас роль «Читатель»: можно читать, голосовать и подтверждать',
      );
      const P = r.P;
      const text = String(s.text ?? '').trim();
      const files: ChatFile[] = (s.files ?? []).map((f) => ({
        name: String(f.name),
        mb: Number(f.mb) || 0,
        kind: (f.kind ?? 'doc') as FileKind,
      }));
      if (!text && !files.length && !s.doc && !s.poll) {
        throw new ApiError('validation', 'Напишите сообщение или прикрепите файл');
      }
      if (text.length > 4000) {
        throw new ApiError(
          'validation',
          'Больше 4000 знаков: длинный текст удобнее оформить страницей Базы знаний',
        );
      }
      if (s.important && !r.can.announce) {
        throw new ApiError(
          'forbidden',
          'Важное с подтверждением отправляют модераторы с правом «Чаты · Решать»',
        );
      }
      const toAll = ALL_RE.test(text);
      if (toAll && !r.can.announce) {
        throw new ApiError('forbidden', '@все — только у модераторов с правом «Чаты · Решать»');
      }
      if (s.temp && !r.can.temp) {
        throw new ApiError(
          'forbidden',
          'Временные сообщения в этом чате запрещены политикой вида «' +
            CHAT_KINDS[c.kind].label +
            '»',
        );
      }
      if (s.viewOnce && !r.can.viewOnce) {
        throw new ApiError(
          'forbidden',
          'Одноразовые файлы отправляют модераторы, если это разрешает политика',
        );
      }
      if (s.viewOnce && !files.length) {
        throw new ApiError('validation', 'Прикрепите файл для одноразового просмотра');
      }
      let pollObj: Poll | null = null;
      if (s.poll) {
        const q = String(s.poll.q ?? '').trim();
        const opts = (s.poll.opts ?? []).map((o) => String(o ?? '').trim()).filter(Boolean);
        if (!q) throw new ApiError('validation', 'Напишите вопрос опроса');
        if (opts.length < 2) throw new ApiError('validation', 'Нужно минимум два варианта');
        if (opts.length > 10) throw new ApiError('validation', 'Не больше 10 вариантов');
        const hrs = Math.min(168, Math.max(1, Number(s.poll.hours) || 24));
        const closes = X().now + hrs * 60;
        pollObj = {
          q,
          opts: opts.map((t, i) => ({ id: 'o' + String(i + 1), t })),
          votes: {},
          voters: [],
          anon: !!s.poll.anon,
          multi: !!s.poll.multi,
          closes,
          closesLabel: tsDay(closes) + ' в ' + tsTime(closes),
          closed: false,
        };
      }
      if (files.length) {
        const big = files.find((f) => f.mb > P.maxMb);
        if (big) {
          throw new ApiError(
            'validation',
            '«' +
              big.name +
              '» больше ' +
              gb(P.maxMb) +
              ' — предел политики вида «' +
              CHAT_KINDS[c.kind].label +
              '»',
          );
        }
        const plan = planStorage(
          c,
          P,
          files.reduce((a, f) => a + f.mb, 0),
        );
        c.usedMb = plan.usedMb;
        c.buckets = plan.buckets;
        if (plan.archivedMb) c.archivedMb = (c.archivedMb ?? 0) + plan.archivedMb;
        if (plan.note) sys(c, plan.note.title, plan.note.text, plan.note.icon);
        for (const f of files) {
          const k = BUCKET_KIND[f.kind] ?? 'doc';
          const b = c.buckets.find((x) => x.kind === k && x.ageD === 0 && !x.hold);
          if (b) {
            b.n += 1;
            b.mb += f.mb;
          } else {
            c.buckets.push({
              id: ctx.ids.next('b'),
              kind: k,
              label: BUCKET_LABEL[k],
              ageD: 0,
              n: 1,
              mb: f.mb,
            });
          }
        }
      }
      const now = X().now;
      const m = post(c, {
        topic: c.topics ? (s.topic ?? c.topics[0] ?? null) : null,
        text,
        files: files.length
          ? files.map((f) => (s.viewOnce ? { ...f, viewOnce: true, opened: {} } : f))
          : null,
        doc: s.doc
          ? { kind: s.doc.kind ?? 'doc', ref: s.doc.ref, title: s.doc.title, sub: s.doc.sub ?? '' }
          : null,
        important: s.important ? { due: s.due || '—', acks: [] } : null,
        temp: s.temp ? { exp: now + Number(s.temp) * 60, h: Number(s.temp) } : null,
        spoiler: s.spoiler ? String(s.spoiler).slice(0, 300) : null,
        ...(pollObj ? { kind: 'poll' as const, poll: pollObj } : {}),
      });
      const others = inIds(c).filter((k) => k !== me());
      const title = K.title(c);
      if (s.important || toAll) {
        ctx.emit(
          (s.important ? 'Важное в «' : 'Вас упомянули в «') +
            title +
            '»: ' +
            (text || 'сообщение').slice(0, 60),
          others,
        );
      }
      for (const mm of K.db().members) {
        if (others.includes(mm.id) && text.includes('@' + (mm.name.split(' ')[0] ?? ''))) {
          ctx.emit(meName() + ' упомянул(а) вас в «' + title + '»', [mm.id]);
        }
      }
      if (c.kind === 'direct') ctx.emit(meName() + ': ' + (text || 'файл').slice(0, 60), others);
      return { id: m.id };
    },

    chatEdit(msgId, text) {
      const [c, m] = find(msgId);
      const r = need(c);
      const t = String(text ?? '').trim();
      if (m.by !== me()) throw new ApiError('forbidden', 'Править можно только свои сообщения');
      live(m);
      if (!t) throw new ApiError('validation', 'Текст не может быть пустым — удалите сообщение');
      if (X().now - m.ts > EDIT_MIN[r.P.edit]) {
        throw new ApiError(
          'validation',
          'Окно правки закрыто: ' +
            EDIT_LABEL[r.P.edit] +
            ' по политике вида «' +
            CHAT_KINDS[c.kind].label +
            '»',
        );
      }
      if (t === m.text) return { same: true };
      (m.edits ??= []).push({ text: m.text, ts: X().now });
      m.text = t;
      tick(1);
      return { ok: true };
    },

    chatDelete(msgId, reason) {
      const [c, m] = find(msgId);
      const r = need(c);
      if (m.deleted) throw new ApiError('validation', 'Сообщение уже удалено');
      if (c.hold && heldMsg(c, m)) {
        throw new ApiError(
          'validation',
          'Нельзя удалить: удержание «' + c.hold.reason + '» до ' + c.hold.until,
        );
      }
      const own = m.by === me();
      const inWin = X().now - m.ts <= EDIT_MIN[r.P.edit];
      if (own && !inWin && !r.can.mod) {
        throw new ApiError(
          'forbidden',
          'Окно удаления закрыто: ' + EDIT_LABEL[r.P.edit] + '. Попросите модератора',
        );
      }
      if (!own && !r.can.mod) throw new ApiError('forbidden', 'Чужие сообщения удаляют модераторы');
      const why = String(reason ?? '').trim();
      if (!own && !why) throw new ApiError('validation', 'Укажите причину — её увидят участники');
      m.deleted = {
        by: me(),
        ts: X().now,
        mod: !own,
        reason: why,
        keepUntil: X().now + r.P.delD * 1440,
      };
      journal(
        c,
        (own ? 'Удалено автором' : 'Удалено модератором: ' + why) +
          ' · сообщение от ' +
          tsLabel(m.ts, X().now),
      );
      return { ok: true };
    },

    chatAck(msgId) {
      const [c, m] = find(msgId);
      need(c);
      live(m);
      const im = m.important;
      if (!im) throw new ApiError('validation', 'Подтверждение не запрошено');
      if (m.by === me()) throw new ApiError('validation', 'Своё сообщение подтверждать не нужно');
      if (im.acks.some((a) => a.member === me())) return { already: true };
      im.acks.push({ member: me(), ts: tick(1) });
      m.reads[me()] ??= X().now;
      const left = inIds(c).filter(
        (k) => k !== m.by && !im.acks.some((a) => a.member === k),
      ).length;
      if (!left) ctx.emit('Все подтвердили «' + m.text.slice(0, 50) + '»', [m.by]);
      return { left };
    },

    chatVote(msgId, optIds) {
      const [c, m] = find(msgId);
      need(c);
      live(m);
      const p = m.poll;
      if (!p) throw new ApiError('validation', 'Это не опрос');
      if (p.closed || X().now >= p.closes) {
        throw new ApiError('validation', 'Опрос закрыт ' + p.closesLabel);
      }
      const chosen = (optIds ?? []).filter((o) => p.opts.some((x) => x.id === o));
      if (!chosen.length) throw new ApiError('validation', 'Выберите вариант');
      if (!p.multi && chosen.length > 1) {
        throw new ApiError('validation', 'В этом опросе один вариант');
      }
      for (const k of Object.keys(p.votes)) {
        p.votes[k] = (p.votes[k] ?? []).filter((x) => x !== me());
      }
      for (const o of chosen) (p.votes[o] ??= []).push(me());
      return { ok: true };
    },

    chatPollClose(msgId) {
      const [c, m] = find(msgId);
      const r = need(c);
      live(m);
      const p = m.poll;
      if (!p) throw new ApiError('validation', 'Это не опрос');
      if (m.by !== me() && !r.can.mod) {
        throw new ApiError('forbidden', 'Закрыть опрос может автор или модератор');
      }
      if (p.closed) throw new ApiError('validation', 'Опрос уже закрыт');
      p.closed = true;
      const top = p.opts
        .map((o): [string, number] => [o.t, (p.votes[o.id] ?? []).length])
        .sort((a, b) => b[1] - a[1])[0];
      sys(
        c,
        'Опрос закрыт: «' + p.q + '»',
        top && top[1] ? 'Больше всего голосов: ' + top[0] + ' · ' + String(top[1]) : 'Голосов нет',
        'ballot',
        'ok',
      );
      return { ok: true };
    },

    chatPin(msgId) {
      const [c] = find(msgId);
      need(c, 'pin', 'Закрепляют модераторы');
      c.pinned = c.pinned === msgId ? null : msgId;
      return { pinned: c.pinned };
    },

    chatReveal(msgId) {
      const [c, m] = find(msgId);
      need(c, 'pdn', 'Номер скрыт: нужно право «ПДн без маски»');
      live(m);
      const seen = (m.revealed ??= []);
      if (!seen.includes(me())) seen.push(me());
      journal(c, meName() + ' раскрыл(а) ПДн в сообщении от ' + tsLabel(m.ts, X().now));
      return { ok: true };
    },

    chatOpenOnce(msgId) {
      const [c, m] = find(msgId);
      need(c);
      live(m);
      const f = (m.files ?? []).find((x) => x.viewOnce);
      if (!f) throw new ApiError('validation', 'Файл не одноразовый');
      if (m.by === me()) {
        throw new ApiError(
          'validation',
          'Автор одноразового файла его не открывает: файл видят только получатели',
        );
      }
      if (f.opened?.[me()]) {
        throw new ApiError('validation', 'Вы уже открыли этот файл — он больше не откроется');
      }
      if (f.gone) {
        throw new ApiError('validation', 'Файл удалён: прошло 24 часа после первого открытия');
      }
      f.opened = { ...f.opened, [me()]: X().now };
      journal(c, meName() + ' открыл(а) одноразовый файл «' + f.name + '»');
      return { name: f.name };
    },

    chatSaveTo(msgId) {
      const [c, m] = find(msgId);
      need(c, 'saveTo', 'Сохранять в запись могут участники чата записи');
      live(m);
      const fs = (m.files ?? []).filter((f) => !f.savedTo && !f.viewOnce);
      if (!fs.length) throw new ApiError('validation', 'Нечего сохранять: файлы уже в записи');
      const mb = fs.reduce((a, f) => a + f.mb, 0);
      for (const f of fs) f.savedTo = c.record?.label || c.record?.id || '';
      c.usedMb = Math.max(0, c.usedMb - mb);
      c.savedMb = (c.savedMb ?? 0) + mb;
      const b = (c.buckets ?? []).find((x) => x.ageD === 0 && x.kind === 'photo');
      if (b) {
        b.mb = Math.max(0, b.mb - mb);
        b.n = Math.max(0, b.n - fs.length);
      }
      journal(
        c,
        meName() +
          ' сохранил(а) ' +
          pluralN(fs.length, 'файл', 'файла', 'файлов') +
          ' в запись · ' +
          gb(mb),
      );
      return { n: fs.length, mb };
    },

    chatToTask(msgId, projectId) {
      const db = K.db();
      const [c, m] = find(msgId);
      need(c, 'task', 'Создавать задачи может роль с правом «Задачи · Создавать»');
      live(m);
      const projects = db.projects ?? [];
      let project: string;
      if (projectId !== undefined) {
        if (!projects.some((p) => p.id === projectId)) {
          throw new ApiError('not_found', 'Проект не найден');
        }
        project = projectId;
      } else {
        const cand = projects.filter((p) => p.flow !== 'leads');
        const hit = cand.find((p) => p.unit === c.unit) ?? cand[0];
        if (!hit) {
          throw new ApiError(
            'validation',
            'Нет проекта для задачи: создайте проект или выберите существующий',
          );
        }
        project = hit.id;
      }
      const title =
        String(m.text || m.poll?.q || 'Сообщение из чата')
          .replace(/\s+/g, ' ')
          .slice(0, 80) || 'Сообщение из чата';
      const chatName = chatTitle(db, c, me());
      const { id } = ctx.tasks.create({
        project,
        title,
        assignee: meName(),
        author: meName(),
        authorId: me(),
        priority: 'normal',
        due: '—',
        comments: [{ by: meName(), at: tsTime(X().now), text: 'Из чата «' + chatName + '»' }],
        links: [{ kind: 'chat', id: c.id, label: 'Чат «' + chatName + '»' }],
      });
      (m.tasks ??= []).push(id);
      return { id };
    },
  };
}
