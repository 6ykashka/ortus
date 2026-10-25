// Проекция чатов для участника (chatsView, chats.js 14.10:280–315): видимость чатов, маска ПДн,
// итоги прочтения, опросов и важного, удалённые сообщения (PD-60: без «воскресания»).
import { describe, expect, it } from 'vitest';
import { chatOf, chatsAlta, msgOf, slice } from './fixture.test-util.ts';
import type { ChatMessage, ChatsTenantDb } from './types.ts';
import { chatsView, type ChatView } from './view.ts';

const db = (): ChatsTenantDb => chatsAlta({ modules: true, docs: true });
const view = (d: ChatsTenantDb, actor: string) => {
  const v = chatsView(d, actor, structuredClone(slice(d)));
  if (!v) throw new Error('нет проекции');
  return v;
};
const item = (d: ChatsTenantDb, actor: string, id: string): ChatView => {
  const it = view(d, actor).items.find((x) => x.id === id);
  if (!it) throw new Error('чат ' + id + ' не виден ' + actor);
  return it;
};
const msg = (it: ChatView, id: string) => {
  const m = it.msgs.find((x) => x.id === id);
  if (!m) throw new Error('нет ' + id);
  return m;
};
const T = (d: number, t: string): number => {
  const [h, m] = t.split(':').map(Number) as [number, number];
  return d * 1440 + h * 60 + m;
};

describe('какие чаты видит участник', () => {
  it('нет среза — ничего', () => {
    expect(chatsView(db(), 'm-owner', undefined)).toBeUndefined();
    expect(chatsView(chatsAlta({ raw: true }), 'm-owner', slice(db()))).toBeUndefined();
  });

  it.each([
    ['m-owner', ['ch-news', 'ch-drv', 'ch-trip', 'ch-obj42', 'ch-dzs']],
    ['m-vasiliev', ['ch-news', 'ch-drv', 'ch-trip', 'ch-dkv']],
    ['m-sokolov', ['ch-news', 'ch-obj42', 'ch-dzs']],
    ['m-kotova', ['ch-news', 'ch-drv', 'ch-trip', 'ch-dkv']],
    ['m-gromov', []],
    ['m-ilyin', []],
  ])('%s видит %j', (actor, ids) => {
    expect(view(db(), actor).items.map((c) => c.id)).toEqual(ids);
  });

  it('служебные поля среза сохраняются', () => {
    const d = db();
    const v = view(d, 'm-owner');
    expect(v.v1).toBe(true);
    expect(v.now).toBe(665);
    expect(v.policy.record.maxMb).toBe(500);
  });
});

describe('«мой» доступ в чате', () => {
  it('роль, цепочка, права, непрочитанные, ждёт подтверждения, собеседник', () => {
    const d = db();
    const drv = item(d, 'm-vasiliev', 'ch-drv');
    expect(drv.my.ok).toBe(true);
    expect(drv.my.role).toBe('member');
    expect(drv.my.chain).toHaveLength(3);
    expect(drv.my.can.write).toBe(true);
    expect('vb' in drv.my).toBe(false);
    expect(drv.my.unread).toBe(3);
    expect(drv.my.ackWait).toEqual(['cm-5']);
    expect(drv.my.peer).toBeNull();
    expect(item(d, 'm-kotova', 'ch-dkv').my.peer).toBe('m-vasiliev');
    expect(item(d, 'm-kotova', 'ch-drv').my.unread).toBe(0);
    expect(item(d, 'm-kotova', 'ch-drv').my.ackWait).toEqual([]);
  });

  it('корзины и журнал — только тем, кто настраивает чат', () => {
    const d = db();
    expect(item(d, 'm-owner', 'ch-obj42').buckets).toHaveLength(7);
    expect(item(d, 'm-sokolov', 'ch-obj42').buckets).toEqual([]);
    chatOf(d, 'ch-obj42').journal.push({ ts: 1, by: 'm-owner', text: 'Очистка' });
    expect(item(d, 'm-owner', 'ch-obj42').journal).toHaveLength(1);
    expect(item(d, 'm-sokolov', 'ch-obj42').journal).toEqual([]);
    expect(item(d, 'm-kotelnikova', 'ch-news').buckets).toEqual([]);
  });
});

describe('маска ПДн', () => {
  const PHONE = 'Заказчик просит звонить заранее: +7 916 482-31-17.';
  const MASKED = 'Заказчик просит звонить заранее: +7 ••• •••-••-17.';

  it('номер скрыт у участника и у владельца до раскрытия', () => {
    const d = db();
    const m = msg(item(d, 'm-sokolov', 'ch-obj42'), 'cm-' + phoneId(d));
    expect(m.text).toBe(MASKED);
    expect(m.pdn).toBe(true);
    expect(m.revealed).toBe(false);
    expect(msg(item(d, 'm-owner', 'ch-obj42'), 'cm-' + phoneId(d)).text).toBe(MASKED);
  });

  it('после раскрытия — открытый текст только раскрывшему', () => {
    const d = db();
    msgOf(chatOf(d, 'ch-obj42'), 'cm-' + phoneId(d)).revealed = ['m-owner'];
    const mine = msg(item(d, 'm-owner', 'ch-obj42'), 'cm-' + phoneId(d));
    expect(mine.text).toBe(PHONE);
    expect(mine.revealed).toBe(true);
    expect(msg(item(d, 'm-sokolov', 'ch-obj42'), 'cm-' + phoneId(d)).text).toBe(MASKED);
  });

  it('история правок автору и модератору — тоже под маской', () => {
    const d = db();
    const m0 = msgOf(chatOf(d, 'ch-obj42'), 'cm-' + phoneId(d));
    m0.edits = [{ text: 'позвоните +7 916 000-11-22', ts: 700 }];
    const mine = msg(item(d, 'm-sokolov', 'ch-obj42'), 'cm-' + phoneId(d));
    expect(mine.edited).toBe(1);
    expect(mine.editLog).toEqual([{ text: 'позвоните +7 ••• •••-••-22', ts: 700 }]);
    expect(msg(item(d, 'm-owner', 'ch-obj42'), 'cm-' + phoneId(d)).editLog).toHaveLength(1);
  });

  it('чужие правки скрыты от обычного участника чата', () => {
    const d = db();
    const dr = msgOf(chatOf(d, 'ch-drv'), 'cm-3');
    dr.edits = [{ text: 'старый текст', ts: 5 }];
    const v = msg(item(d, 'm-vasiliev', 'ch-drv'), 'cm-3');
    expect(v.edited).toBe(1);
    expect(v.editLog).toEqual([]);
    expect(msg(item(d, 'm-kotova', 'ch-drv'), 'cm-3').editLog).toHaveLength(1);
  });
});

function phoneId(d: ChatsTenantDb): string {
  const m = chatOf(d, 'ch-obj42').msgs.find((x) => x.text.includes('+7 916 482'));
  return (m?.id ?? '').replace('cm-', '');
}

describe('удалённые сообщения не воскресают (PD-60)', () => {
  const deleted = (d: ChatsTenantDb): ChatMessage => {
    const m = msgOf(chatOf(d, 'ch-obj42'), 'cm-' + phoneId(d));
    m.files = [{ name: 'a.jpg', mb: 1, kind: 'photo' }];
    m.spoiler = 'секрет';
    m.important = { due: '31.10', acks: [] };
    m.doc = { kind: 'doc', ref: 'doc-42', title: 'Договор', sub: '' };
    m.edits = [{ text: 'до правки', ts: 1 }];
    m.deleted = { by: 'm-owner', ts: 700, mod: true, reason: 'Ошибочный номер', keepUntil: 9999 };
    return m;
  };

  it('остаётся метка: кто, когда, причина модератора', () => {
    const d = db();
    const m = deleted(d);
    const v = msg(item(d, 'm-sokolov', 'ch-obj42'), m.id);
    expect(v.text).toBe('');
    expect(v.files).toEqual([]);
    expect(v.doc).toBeNull();
    expect(v.poll).toBeNull();
    expect(v.spoiler).toBeNull();
    expect(v.important).toBeNull();
    expect(v.pdn).toBe(false);
    expect(v.edited).toBe(0);
    expect(v.editLog).toEqual([]);
    expect(v.deleted).toEqual({ mod: true, reason: 'Ошибочный номер', ts: 700, by: 'm-owner' });
    expect(JSON.stringify(v)).not.toContain('до правки');
    expect(JSON.stringify(v)).not.toContain('916');
  });

  it('модератору тоже не показываем исходный текст; удалённое автором — без причины', () => {
    const d = db();
    const m = deleted(d);
    expect(msg(item(d, 'm-owner', 'ch-obj42'), m.id).text).toBe('');
    m.deleted = { by: 'm-sokolov', ts: 701, mod: false, reason: 'ушла', keepUntil: 1 };
    expect(msg(item(d, 'm-sokolov', 'ch-obj42'), m.id).deleted?.reason).toBe('');
  });

  it('удалённый опрос и «важное» не попадают в ожидание подтверждения и итоги', () => {
    const d = db();
    const m = msgOf(chatOf(d, 'ch-drv'), 'cm-5');
    m.deleted = { by: 'm-kotova', ts: 700, mod: false, reason: '', keepUntil: 1 };
    expect(item(d, 'm-vasiliev', 'ch-drv').my.ackWait).toEqual([]);
    const p = msgOf(chatOf(d, 'ch-drv'), 'cm-6');
    p.deleted = { by: 'm-kotova', ts: 700, mod: false, reason: '', keepUntil: 1 };
    expect(msg(item(d, 'm-vasiliev', 'ch-drv'), 'cm-6').poll).toBeNull();
  });
});

describe('прочтение', () => {
  it('режим «галочки»: только число, без списка', () => {
    const d = db();
    const m = msg(item(d, 'm-kotova', 'ch-drv'), 'cm-3');
    expect(m.readN).toBe(2);
    expect(m.reads).toEqual([]);
  });

  it('режим «кто и когда»: список автору и модератору, участнику — нет', () => {
    const d = db();
    chatOf(d, 'ch-drv').over = { rcpt: 'who' };
    const author = msg(item(d, 'm-kotova', 'ch-drv'), 'cm-3');
    expect(author.reads.map((r) => r.id).sort()).toEqual(['m-kotelnikova', 'm-vasiliev']);
    expect(msg(item(d, 'm-vasiliev', 'ch-drv'), 'cm-3').reads).toEqual([]);
    expect(msg(item(d, 'm-vasiliev', 'ch-drv'), 'cm-3').readN).toBe(2);
  });

  it('режим «не показывать»: readN = −1', () => {
    expect(msg(item(db(), 'm-kotova', 'ch-news'), 'cm-1').readN).toBe(-1);
  });
});

describe('«важное», опросы, файлы', () => {
  it('подтверждение: счётчик, моё, список — автору', () => {
    const d = db();
    expect(msg(item(d, 'm-kotova', 'ch-news'), 'cm-2').important).toEqual({
      due: '31.10',
      n: 1,
      mine: true,
      list: [],
    });
    expect(msg(item(d, 'm-owner', 'ch-news'), 'cm-2').important).toEqual({
      due: '31.10',
      n: 1,
      mine: false,
      list: [{ id: 'm-kotova', ts: T(0, '09:20') }],
    });
  });

  it('опрос: итоги по вариантам, мои голоса, голоса не отдаются', () => {
    const d = db();
    const p = msgOf(chatOf(d, 'ch-drv'), 'cm-6').poll;
    if (!p) throw new Error('нет опроса');
    p.votes = { o1: ['m-vasiliev', 'm-kotova'], o3: [] };
    const v = msg(item(d, 'm-vasiliev', 'ch-drv'), 'cm-6').poll;
    expect(v?.total).toBe(2);
    expect(v?.mine).toBe(true);
    expect(v?.closed).toBe(false);
    expect(v?.opts.map((o) => [o.id, o.n, o.mine, o.who])).toEqual([
      ['o1', 2, true, ['m-vasiliev', 'm-kotova']],
      ['o2', 0, false, []],
      ['o3', 0, false, []],
    ]);
    expect('votes' in (v ?? {})).toBe(false);
  });

  it('анонимный опрос не называет голосовавших', () => {
    const d = db();
    const p = msgOf(chatOf(d, 'ch-drv'), 'cm-6').poll;
    if (!p) throw new Error('нет опроса');
    p.anon = true;
    p.votes = { o1: ['m-vasiliev'] };
    const v = msg(item(d, 'm-kotova', 'ch-drv'), 'cm-6').poll;
    expect(v?.opts[0]).toMatchObject({ n: 1, mine: false, who: [] });
  });

  it('опрос закрывается по сроку', () => {
    const d = db();
    const p = msgOf(chatOf(d, 'ch-drv'), 'cm-6').poll;
    slice(d).now = p?.closes ?? 0;
    expect(msg(item(d, 'm-kotova', 'ch-drv'), 'cm-6').poll?.closed).toBe(true);
  });

  it('одноразовый файл: открыт ли мной и сколько открыли', () => {
    const d = db();
    const pass = chatOf(d, 'ch-obj42').msgs.find((m) => m.files?.[0]?.viewOnce);
    if (!pass?.files?.[0]) throw new Error('нет файла');
    pass.files[0].opened = { 'm-sokolov': 700 };
    const mine = msg(item(d, 'm-sokolov', 'ch-obj42'), pass.id).files?.[0];
    expect(mine).toMatchObject({ opened: true, openedN: 1 });
    const author = msg(item(d, 'm-owner', 'ch-obj42'), pass.id).files?.[0];
    expect(author).toMatchObject({ opened: false, openedN: 1 });
    const photos = chatOf(d, 'ch-obj42').msgs.find((m) => m.files?.[0]?.kind === 'photo');
    expect(msg(item(d, 'm-owner', 'ch-obj42'), photos?.id ?? '').files?.[0]).toMatchObject({
      opened: false,
      openedN: 0,
    });
  });
});

describe('скрытые сообщения', () => {
  it('временное исчезает по таймеру', () => {
    const d = db();
    expect(item(d, 'm-kotova', 'ch-dkv').msgs).toHaveLength(3);
    slice(d).now = T(1, '07:55');
    expect(item(d, 'm-kotova', 'ch-dkv').msgs).toHaveLength(2);
  });

  it('«видно только вам»', () => {
    const d = db();
    const m = msgOf(chatOf(d, 'ch-drv'), 'cm-3');
    m.visibleTo = ['m-kotova'];
    expect(item(d, 'm-kotova', 'ch-drv').msgs.some((x) => x.id === 'cm-3')).toBe(true);
    expect(item(d, 'm-vasiliev', 'ch-drv').msgs.some((x) => x.id === 'cm-3')).toBe(false);
  });
});
