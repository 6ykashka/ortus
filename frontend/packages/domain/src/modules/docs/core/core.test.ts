// Табличные тесты ядра документов (B §3.3 «Чистые функции → тесты»): ожидания записаны явно,
// не только как «равно эталону».
import { describe, expect, it } from 'vitest';
import { docAccess, docRights, engineCfg, finSees, isDocOwner, protEdit } from './access.ts';
import { DOC_LEVELS, DOC_ROLES, DOC_TEMPLATES, LV, LV_KEY } from './dictionaries.ts';
import { altaDocs, doc, folder, lotosDocs, T } from './fixture.test-util.ts';
import { entryLabel } from './labels.ts';
import { docsOf, folderLabel } from './tree.ts';
import { docsView } from './view.ts';
import { fieldVals, fillTokens } from './fields.ts';
import { docMoveImpact, docShareImpact } from './impact.ts';
import { docStatus, docWaits, stepWaiting } from './waits.ts';
import { addWorkDays, dval } from './util.ts';
import type { DocItem } from './types.ts';

const dec = (member: string, decision = 'ok') => ({ member, decision, at: 'x' }) as never;

describe('addWorkDays', () => {
  it.each([
    ['01.10.2026', 1, '02.10.2026'],
    ['01.10.2026', 2, '05.10.2026'],
    ['03.11.2026', 1, '05.11.2026'],
    ['01.10.2026', 0, '01.10.2026'],
    ['31.12.2026', 1, '01.01.2027'],
  ])('%s + %i = %s', (from, n, to) => {
    expect(addWorkDays(from, n)).toBe(to);
  });

  it('праздники передаются параметром', () => {
    expect(addWorkDays('01.10.2026', 1, new Set(['02.10.2026']))).toBe('05.10.2026');
    expect(addWorkDays('03.11.2026', 1, new Set())).toBe('04.11.2026');
  });

  it('dval: неразобранная дата — 0', () => {
    expect(dval('01.10.2026')).toBe(20261001);
    expect(dval('31.10')).toBe(0);
    expect(dval(undefined)).toBe(0);
  });
});

describe('справочники', () => {
  it('уровни и ключи согласованы', () => {
    expect(DOC_LEVELS).toHaveLength(6);
    expect(LV_KEY.slice(1).map((k) => LV[k as keyof typeof LV])).toEqual([1, 2, 3, 4, 5]);
    expect(DOC_ROLES.map((r) => r.docLevel)).toEqual([5, 4, 1]);
    expect(DOC_TEMPLATES.map((t) => t.id)).toEqual(['tpl-order', 'tpl-poa', 'tpl-act']);
  });
});

describe('docAccess: «Альта»', () => {
  const db = altaDocs();
  const L = (mid: string, id: string) => {
    const x = db.docs.items.find((d) => d.id === id) ?? folder(db, id);
    return docAccess(db, mid, x, T).L;
  };

  it('владелец бизнеса — 5 везде', () => {
    for (const d of db.docs.items) expect(L('m-owner', d.id)).toBe(5);
    expect(docAccess(db, 'm-owner', doc(db, 'doc-pay'), T).owner).toBe(true);
  });

  it('руководитель логистики: своя папка и «Только выбранные» по списку', () => {
    expect(L('m-kotova', 'fd-log')).toBe(5);
    expect(L('m-kotova', 'doc-fuel')).toBe(5);
    expect(L('m-kotova', 'doc-pay')).toBe(4);
    expect(L('m-kotova', 'doc-42')).toBe(0);
  });

  it('неизвестный и заблокированный участник — 0', () => {
    expect(docAccess(db, 'нет', doc(db, 'doc-42'), T)).toMatchObject({
      L: 0,
      level: 'Нет доступа',
    });
    const blocked = altaDocs();
    const m = blocked.members.find((x) => x.id === 'm-kotova');
    if (m) m.status = 'blocked';
    const r = docAccess(blocked, 'm-kotova', doc(blocked, 'doc-fuel'), T);
    expect(r.L).toBe(0);
    expect(r.chain.map((s) => s.k)).toEqual(['no']);
  });

  it('водитель не видит финансовые документы никогда', () => {
    const drv = db.members.find((m) => m.function === 'driver');
    expect(drv).toBeDefined();
    const r = docAccess(db, (drv as { id: string }).id, doc(db, 'doc-pay'), T);
    expect(r).toMatchObject({ L: 0, fn: true });
  });

  it('цепочка причин содержит организацию и итог', () => {
    const r = docAccess(db, 'm-kotova', doc(db, 'doc-fuel'), T);
    expect(r.chain[0]).toMatchObject({ k: 'ok', t: 'Организация' });
    expect(r.level).toBe('Управляет доступом');
  });

  it('владелец документа получает 5; временный доступ маршрута повышает уровень', () => {
    const d = altaDocs();
    const x = doc(d, 'doc-ord14');
    x.tmp = [{ member: 'm-vasiliev', level: 'comment', why: 'Согласующий', v: 6 }];
    const r = docAccess(d, 'm-vasiliev', x, T);
    expect(r).toMatchObject({ L: 2, onlyV: 6 });
    expect(r.chain.at(-1)).toMatchObject({ t: 'Маршрут', d: 'Согласующий' });
    expect(docAccess(d, 'm-kotova', x, T).L).toBe(5);
  });
});

describe('docRights', () => {
  const db = altaDocs();

  it('блокировка на время маршрута и PDF/A', () => {
    const d = doc(db, 'doc-42');
    const free = docRights(db, 'm-owner', d, T);
    expect(free).toMatchObject({ edit: true, locked: false, route: true, manage: true });
    const locked = {
      ...d,
      route: { status: 'active', rules: { lock: true } },
    } as unknown as DocItem;
    expect(docRights(db, 'm-owner', locked, T)).toMatchObject({
      edit: false,
      suggest: false,
      editL: true,
      locked: true,
    });
    expect(docRights(db, 'm-owner', { ...d, pdfa: true }, T)).toMatchObject({
      locked: true,
      route: false,
    });
  });

  it('maxGrant: «Управляет» выдаёт 5, остальные — не выше 4', () => {
    expect(docRights(db, 'm-owner', doc(db, 'doc-42'), T).maxGrant).toBe(5);
    expect(docRights(db, 'm-kotova', doc(db, 'doc-pay'), T).maxGrant).toBe(4);
  });

  it('engineCfg', () => {
    const r = { edit: true, suggest: false, comment: true, export: false } as never;
    expect(engineCfg(r, 'text')).toBe(
      'edit: true · review: true · comment: true · download: false · print: false',
    );
    const s = { edit: false, suggest: true, comment: true, export: true } as never;
    expect(engineCfg(s, 'sheet')).toBe(
      'edit: false · review: false · comment: true · download: true · print: true',
    );
  });
});

describe('финансы и защищённые диапазоны', () => {
  const db = altaDocs();
  const pay = doc(db, 'doc-fuel').sheets?.find((s) => s.fin);

  it('лист «Начисления»: владелец, список finWho; не водитель', () => {
    expect(pay?.finWho).toEqual(['m-kotova']);
    expect(finSees(db, 'm-owner', doc(db, 'doc-fuel'), pay)).toBe(true);
    expect(finSees(db, 'm-kotova', doc(db, 'doc-fuel'), pay)).toBe(true);
    expect(finSees(db, 'm-vasiliev', doc(db, 'doc-fuel'), pay)).toBe(false);
    expect(finSees(db, 'нет', doc(db, 'doc-fuel'), pay)).toBe(false);
    const drv = db.members.find((m) => m.function === 'driver');
    expect(finSees(db, (drv as { id: string }).id, doc(db, 'doc-fuel'), pay)).toBe(false);
  });

  it('protEdit: владелец и записи списка', () => {
    const pr = doc(db, 'doc-fuel').prot?.[0];
    expect(pr).toBeDefined();
    if (!pr) return;
    expect(protEdit(db, 'm-owner', pr)).toBe(true);
    expect(protEdit(db, 'm-kotova', pr)).toBe(true);
    expect(protEdit(db, 'm-vasiliev', pr)).toBe(false);
    expect(isDocOwner(db, 'm-owner')).toBe(true);
    expect(isDocOwner(db, 'm-kotova')).toBe(false);
  });
});

describe('влияние на доступ', () => {
  const db = altaDocs();
  it('перенос в «Финансы» лишает доступа; без изменений — пусто', () => {
    const d = doc(db, 'doc-ord14');
    const r = docMoveImpact(db, d, 'fd-log-fin', T);
    expect(r.lose.length + r.down.length).toBeGreaterThan(0);
    expect(docMoveImpact(db, d, d.folder, T)).toEqual({ gain: [], lose: [], up: [], down: [] });
    expect(docShareImpact(db, d, {}, T)).toEqual({ gain: [], lose: [], up: [], down: [] });
  });

  it('«Все сотрудники — читают» открывает доступ приглашённым с пометкой', () => {
    const d = doc(db, 'doc-ord14');
    const r = docShareImpact(db, d, { share: [{ who: 'all', level: 'view' }] }, T);
    expect(r.gain.length).toBeGreaterThan(0);
    expect(r.gain.every((x) => x.from === 0 && x.to === 1)).toBe(true);
  });
});

describe('маршрут: кто ждёт и статус', () => {
  it('stepWaiting', () => {
    const seq = {
      status: 'active',
      kind: 'approve',
      mode: 'seq',
      who: ['a', 'b', 'c'],
      decisions: [],
    };
    expect(stepWaiting(seq as never)).toEqual(['a']);
    const any = {
      status: 'active',
      kind: 'approve',
      mode: 'any',
      who: ['a', 'b'],
      decisions: [dec('b')],
    };
    expect(stepWaiting(any as never)).toEqual([]);
    expect(stepWaiting(undefined)).toEqual([]);
    expect(stepWaiting({ ...seq, status: 'done' } as never)).toEqual([]);
  });

  it('docStatus', () => {
    expect(docStatus({ status: 'signed' } as never)).toEqual(['ok', 'verified', 'Подписан · ПЭП']);
    expect(docStatus({ pdfa: true } as never)).toEqual(['neutral', 'inventory_2', 'PDF/A · архив']);
    expect(docStatus({ status: 'draft' } as never)).toEqual(['neutral', 'edit_note', 'Черновик']);
  });

  it('docWaits: упоминание в комментарии и слова OCR', () => {
    const db = altaDocs();
    expect(docWaits(db, 'm-ilyin', doc(db, 'doc-42')).map((w) => w.kind)).toEqual(['mention']);
    expect(docWaits(db, 'm-sokolov', doc(db, 'doc-318'))).toEqual([{ kind: 'ocr', n: 3 }]);
    expect(docWaits(db, 'm-owner', doc(db, 'doc-318'))).toEqual([{ kind: 'ocr', n: 3 }]);
  });
});

describe('поля CRM', () => {
  it('fillTokens', () => {
    expect(fillTokens('Привет, {Имя}!', { Имя: 'Ира' })).toBe('Привет, Ира!');
    expect(fillTokens('{X}', {})).toBe('{X}');
  });

  it('fieldVals «Альта»: подрядчик и подписант договора', () => {
    const db = altaDocs();
    const v = fieldVals(db, doc(db, 'doc-42'));
    expect(v['Подрядчик']).toBe('ООО «Альта Групп»');
    expect(v['Подписант']).toBe('Дарья Зимина');
    expect(v['Цена']).toBe('1 248 300 ₽');
  });

  it('fieldVals «Лотос»: организация не «Альта»', () => {
    const db = lotosDocs();
    const d = { ...doc(db, 'doc-l1'), fields: [{ k: 'Орг', src: 'tenant' }] };
    expect(fieldVals(db, d)['Орг']).toMatch(/^ООО «.+»$/);
    expect(fieldVals(db, d)['Орг']).not.toContain('Альта');
  });
});

describe('права по глаголам роли (hasVerb) при уровне 2–3', () => {
  /** Документ «Только выбранные»: участник — комментатор; глаголы даёт только назначение с областью. */
  function withScope(scope: unknown, role = 'r-manager') {
    const db = altaDocs();
    const d = doc(db, 'doc-ord14');
    d.mode = 'listed';
    d.share = [{ who: 'member', ref: 'm-vasiliev', level: 'comment' }];
    db.assignments.push({ id: 'a-t', member: 'm-vasiliev', role, scope } as never);
    return { db, d };
  }
  const rights = (x: { db: ReturnType<typeof altaDocs>; d: DocItem }) =>
    docRights(x.db, 'm-vasiliev', x.d, T);

  it('без назначения: комментатор не делится и не экспортирует', () => {
    const db = altaDocs();
    const d = doc(db, 'doc-ord14');
    d.mode = 'listed';
    d.share = [{ who: 'member', ref: 'm-vasiliev', level: 'comment' }];
    const r = docRights(db, 'm-vasiliev', d, T);
    expect(r).toMatchObject({ L: 2, share: false, export: false, sign: false, maxGrant: 2 });
  });

  it.each([
    ['tenant', { type: 'tenant' }],
    ['region', { type: 'region', id: 'r-msk' }],
    ['firm', { type: 'firm', id: 'f-msk-sever' }],
    ['folder', { type: 'folder', id: 'fd-log-ord' }],
    ['doc', { type: 'doc', id: 'doc-ord14' }],
  ])('область «%s»: роль с «settings» разрешает «Поделиться»', (_n, scope) => {
    expect(rights(withScope(scope)).share).toBe(true);
  });

  it('чужие область и документ не помогают', () => {
    expect(rights(withScope({ type: 'region', id: 'r-spb' })).share).toBe(false);
    expect(rights(withScope({ type: 'folder', id: 'fd-rep' })).share).toBe(false);
    expect(rights(withScope({ type: 'doc', id: 'doc-42' })).share).toBe(false);
  });

  it('«только своё»: прораб объекта с записью `relation` получает глаголы роли', () => {
    const db = altaDocs();
    const d = doc(db, 'doc-318');
    d.mode = 'listed';
    d.share = [
      { who: 'member', ref: 'm-vasiliev', level: 'comment' },
      { who: 'relation', ref: 'foreman', obj: 'obj-42', level: 'view' },
    ];
    db.assignments.push({
      id: 'a-s',
      member: 'm-sokolov',
      role: 'r-foreman',
      scope: { type: 'self' },
    });
    expect(docRights(db, 'm-sokolov', d, T).owner).toBeUndefined();
    db.assignments.push({
      id: 'a-s2',
      member: 'm-vasiliev',
      role: 'r-foreman',
      scope: { type: 'self' },
    });
    expect(docRights(db, 'm-vasiliev', d, T).share).toBe(false);
  });

  it('роль с «review» и «export» открывает подпись и экспорт', () => {
    const x = withScope({ type: 'tenant' }, 'r-doc-test');
    x.db.roles.push({
      id: 'r-doc-test',
      name: 'Тест',
      kind: 'custom',
      actions: { docs: ['review', 'export'] },
      finance: { read: false, manage: false },
    });
    expect(rights(x)).toMatchObject({ sign: true, export: true, share: false });
  });
});

describe('проекция: временный доступ маршрута и мелочи', () => {
  it('временный доступ ограничен версией: тело версии, без обсуждения и истории', () => {
    const db = altaDocs();
    const d = doc(db, 'doc-ord14');
    d.tmp = [{ member: 'm-vasiliev', level: 'comment', why: 'Согласующий', v: 5 }];
    const v = docsView(db, 'm-vasiliev', structuredClone(db.docs), T);
    const x = v?.items.find((i) => i.id === 'doc-ord14');
    expect(x?.versions.map((y) => y.v)).toEqual([5]);
    expect(x?.body).toEqual(d.versions[0]?.body);
    expect(x).toMatchObject({ comments: [], suggestions: [], share: [], dirty: false });
    d.tmp = [{ member: 'm-vasiliev', level: 'comment', why: 'Согласующий', v: 99 }];
    const gone = docsView(db, 'm-vasiliev', structuredClone(db.docs), T)?.items.find(
      (i) => i.id === 'doc-ord14',
    );
    expect(gone?.versions).toEqual([]);
  });

  it('без среза — null; документ, которого нет в БД, не попадает в ответ', () => {
    const db = altaDocs();
    expect(docsView(db, 'm-owner', undefined, T)).toBeNull();
    const c = structuredClone(db.docs);
    c.items.push({ ...(c.items[0] as DocItem), id: 'нет' });
    expect(docsView(db, 'm-owner', c, T)?.items.some((i) => i.id === 'нет')).toBe(false);
  });

  it('подписи: неизвестная запись, пустое дерево, путь к папке', () => {
    const db = altaDocs();
    expect(entryLabel(db, { who: 'x' as never })).toBe('—');
    expect(docsOf({} as never)).toEqual({ folders: [], items: [], v1: true });
    expect(folderLabel(db, 'fd-log-ord')).toBe('Север Логистик › Приказы');
  });
});
