// Место чата и удержание (chats.js 14.10:335–355, 546–559; PD-60): расчёт без изменения чата до
// успеха, очистка по фильтрам, удержание по чату, сотруднику и периоду.
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY } from './dictionaries.ts';
import { chatOf, chatsAlta } from './fixture.test-util.ts';
import { ALL_RE, cleanupPlan, heldMsg, planStorage } from './storage.ts';
import type { Chat, ChatMessage, ChatPolicy } from './types.ts';

const obj = (): Chat => chatOf(chatsAlta({ modules: true }), 'ch-obj42');
const P = (o: Partial<ChatPolicy> = {}): ChatPolicy => ({ ...DEFAULT_POLICY.record, ...o });
const err = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return '';
};
const QUOTA_FULL =
  'Место чата заполнено: 4,6 ГБ из 5 ГБ. Файлы не отправляются — текст, опросы и подтверждения работают. Освободите место в «Сведения › Хранение»';

describe('planStorage', () => {
  it('влезает: только растёт занятое место, корзины не трогаются', () => {
    const c = obj();
    const plan = planStorage(c, P(), 300);
    expect(plan).toMatchObject({ usedMb: 4900, freed: null });
    expect(plan.buckets).toBe(c.buckets);
    expect(plan.note).toBeUndefined();
  });

  it('без места на чат (личные): растёт без предела', () => {
    const c = { ...obj(), usedMb: 10 };
    expect(planStorage(c, P({ quotaMb: null }), 10_000).usedMb).toBe(10_010);
  });

  it('«Запретить новые файлы» — validation, чат не меняется', () => {
    const c = obj();
    const before = JSON.stringify(c);
    expect(err(() => planStorage(c, P({ onFull: 'block' }), 500))).toBe(QUOTA_FULL);
    expect(JSON.stringify(c)).toBe(before);
  });

  it('«Удалять старые вложения»: самые старые корзины, без удержания; чат пока не изменён', () => {
    const c = obj();
    const before = JSON.stringify(c);
    const plan = planStorage(c, P({ onFull: 'ring' }), 500);
    expect(JSON.stringify(c)).toBe(before);
    expect(plan.freed).toBe(100);
    expect(plan.usedMb).toBe(5000);
    expect(plan.buckets.find((b) => b.id === 'b2')).toMatchObject({ mb: 400, n: 272 });
    expect(plan.buckets.find((b) => b.id === 'b7')).toMatchObject({ mb: 200, n: 6, hold: true });
    expect(plan.note).toEqual({
      title: 'Удалены старые вложения: место чата',
      text: '68 файлов · 100 МБ · сохранённое в запись и под удержанием не тронуто',
      icon: 'autorenew',
    });
  });

  it('«Переносить в архив»: счётчик архива и подпись про 1–3 минуты', () => {
    const plan = planStorage(obj(), P({ onFull: 'archive' }), 500);
    expect(plan.archivedMb).toBe(100);
    expect(plan.note).toEqual({
      title: 'Старые вложения перенесены в архив',
      text: '68 файлов · 100 МБ · открываются по запросу за 1–3 минуты',
      icon: 'inventory_2',
    });
  });

  it('удалять нечего (всё под удержанием) — validation без изменений', () => {
    const c = obj();
    for (const b of c.buckets ?? []) b.hold = true;
    const before = JSON.stringify(c);
    expect(err(() => planStorage(c, P({ onFull: 'ring' }), 500))).toBe(
      'Место чата заполнено, а удалить можно только сохранённое в запись или под удержанием. Освободите место вручную',
    );
    expect(JSON.stringify(c)).toBe(before);
  });

  it('«Сжимать медиа»: фото и видео старше 30 дней сжимаются на 40 %', () => {
    const c = obj();
    const plan = planStorage(c, P({ onFull: 'compress' }), 500);
    expect(plan.freed).toBe(960);
    expect(plan.usedMb).toBe(4140);
    expect(plan.buckets.find((b) => b.id === 'b1')).toMatchObject({ mb: 1140, compressed: true });
    expect(plan.buckets.find((b) => b.id === 'b2')).toMatchObject({ mb: 300, compressed: true });
    expect(plan.buckets.find((b) => b.id === 'b3')?.compressed).toBeUndefined();
    expect(plan.buckets.find((b) => b.id === 'b7')?.compressed).toBeUndefined();
    expect(plan.note).toEqual({
      title: 'Медиа сжато: место чата',
      text: 'Освобождено 960 МБ · оригиналы удалятся через 14 дней',
      icon: 'compress',
    });
    expect(c.buckets?.find((b) => b.id === 'b1')?.mb).toBe(1900);
  });

  it('сжатия не хватило — validation, корзины и счётчик прежние (в эталоне оставались сжатыми)', () => {
    const c = obj();
    const before = JSON.stringify(c);
    expect(err(() => planStorage(c, P({ onFull: 'compress' }), 3000))).toBe(QUOTA_FULL);
    expect(JSON.stringify(c)).toBe(before);
  });

  it('сжимать нечего — нет служебной заметки, если места хватает', () => {
    const c = { ...obj(), buckets: [], usedMb: 4600 };
    expect(err(() => planStorage(c, P({ onFull: 'compress' }), 500))).toBe(QUOTA_FULL);
  });
});

describe('cleanupPlan', () => {
  it('видео старше 90 дней: итог из эталона', () => {
    const { res, hit } = cleanupPlan(obj(), P(), ['video90']);
    expect(res).toEqual({
      n: 212,
      mb: 1900,
      after: 2700,
      quota: 5000,
      saved: 1100,
      held: 6,
      heldMb: 200,
    });
    expect(hit.map((b) => b.id)).toEqual(['b1']);
  });

  it('несколько фильтров; корзина под удержанием не попадает', () => {
    const { res, hit } = cleanupPlan(obj(), P(), ['photo180', 'voice30', 'docs30']);
    expect(hit.map((b) => b.id)).toEqual(['b2', 'b4', 'b5']);
    expect(res.n).toBe(340 + 30 + 96);
    expect(res.mb).toBe(500 + 300 + 100);
  });

  it('неизвестные фильтры отбрасываются; пустой набор — validation', () => {
    expect(err(() => cleanupPlan(obj(), P(), []))).toBe('Выберите, что удалить');
    expect(err(() => cleanupPlan(obj(), P(), ['zzz']))).toBe('Выберите, что удалить');
  });

  it('без корзин и без удержания', () => {
    const c = { ...obj(), buckets: undefined, savedMb: undefined };
    expect(cleanupPlan(c, P({ quotaMb: null }), ['video90']).res).toEqual({
      n: 0,
      mb: 0,
      after: 4600,
      quota: null,
      saved: 0,
      held: 0,
      heldMb: 0,
    });
  });
});

describe('heldMsg: удержание защищает сообщения', () => {
  const m = (by: string, ts: number): ChatMessage => ({
    id: 'x',
    seq: 1,
    ts,
    by,
    text: '',
    reads: {},
  });

  it('нет удержания — не удержано', () => {
    const c = obj();
    delete c.hold;
    expect(heldMsg(c, m('m-owner', 0))).toBe(false);
  });

  it('по чату целиком', () => {
    const c = obj();
    delete c.hold?.range;
    expect(heldMsg(c, m('m-owner', 0))).toBe(true);
  });

  it('по сотруднику', () => {
    const c = obj();
    if (c.hold) {
      delete c.hold.range;
      c.hold.members = ['m-sokolov'];
    }
    expect(heldMsg(c, m('m-sokolov', 0))).toBe(true);
    expect(heldMsg(c, m('m-owner', 0))).toBe(false);
  });

  it('по периоду', () => {
    const c = obj();
    expect(heldMsg(c, m('m-owner', -20 * 1440))).toBe(true);
    expect(heldMsg(c, m('m-owner', -1))).toBe(false);
    expect(heldMsg(c, m('m-owner', -31 * 1440))).toBe(false);
  });
});

describe('@все — один разбор для проверки прав и рассылки', () => {
  it.each([
    ['@все', true],
    ['Внимание, @все!', true],
    ['@ВСЕ собираемся', true],
    ['тут@все', false],
    ['@всех', false],
    ['@все,', true],
    ['', false],
  ])('«%s» → %s', (text, ok) => {
    expect(ALL_RE.test(text)).toBe(ok);
  });
});
