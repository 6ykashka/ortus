// Маршрут документа (W7.22): явные таблицы по командам, листу согласования, задаче и PDF/A.
// Паритет с эталоном — `parity.test.ts`.
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../../core/errors/index.ts';
import { docRights } from '../core/access.ts';
import { doc, folder, T } from '../core/fixture.test-util.ts';
import type { DocItem } from '../core/types.ts';
import { stepWaiting } from '../core/waits.ts';
import { routeSheet } from './sheet.ts';
import { ORDER_STEPS, routeRig, type RouteRig } from './fixture.test-util.ts';
import type { RDoc } from './types.ts';

const RULES = { notAuthor: false };
const rd = (r: RouteRig, id: string): RDoc => doc(r.db, id) as unknown as RDoc;
const fail = (fn: () => unknown): ApiError => {
  try {
    fn();
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('ожидалась ошибка');
};

function startOrder(r: RouteRig, steps: unknown = ORDER_STEPS): { task: string; v: number } {
  r.as('m-owner');
  return r.cmds.docRouteStart('doc-ord14', { steps, rules: RULES, project: 'pj-docs' } as never);
}

/** Маршрут приказа до шага «ознакомить»: согласовал Котова, утвердил владелец по коду. */
function toAck(r: RouteRig): void {
  startOrder(r);
  r.as('m-kotova');
  r.cmds.docRouteDecide('doc-ord14', { decision: 'ok' });
  r.as('m-owner');
  const { code } = r.cmds.docSignStart('doc-ord14');
  r.cmds.docSign('doc-ord14', code);
}

describe('docRouteStart', () => {
  it('создаёт маршрут, задачу и временный доступ; первый шаг активен', () => {
    const r = routeRig();
    const out = startOrder(r);
    const d = rd(r, 'doc-ord14');
    expect(out.v).toBe(d.v);
    expect(d.route).toMatchObject({ status: 'active', cur: 0, by: 'm-owner', project: 'pj-docs' });
    expect(d.route?.task).toBe(out.task);
    expect(d.route?.rules).toEqual({
      lock: true,
      notAuthor: false,
      commentOnBack: true,
      escalate: false,
    });
    expect(d.route?.steps.map((s) => s.status)).toEqual(['active', 'wait', 'wait']);
    expect(d.route?.steps[0]?.due).toBe('05.10.2026');
    expect(d.status).toBe('draft');
    expect(d.frozen).toBeNull();
    const t = r.ctx.tasks.get(out.task);
    expect(t).toMatchObject({ project: 'pj-docs', status: 'На проверке', priority: 'high' });
    expect(t?.docRoute).toMatchObject({
      doc: 'doc-ord14',
      route: d.route?.id,
      status: 'active',
      n: 1,
      of: 3,
      step: 'Согласовать',
      waiting: ['m-kotova'],
    });
    expect(t?.comments[0]).toMatchObject({ text: 'Маршрут запущен: v' + d.v, system: true });
    expect(r.db.events?.[0]?.to).toEqual(['m-kotova']);
  });

  it('помечает версию «На согласование» и кладёт прежний маршрут в журнал', () => {
    const r = routeRig();
    const d = rd(r, 'doc-ord14');
    d.dirty = true;
    const v0 = d.v;
    startOrder(r);
    expect(d.v).toBe(v0 + 1);
    expect(d.versions.at(-1)?.name).toBe('На согласование');
    r.cmds.docRouteCancel('doc-ord14');
    startOrder(r);
    expect(d.routeLog).toHaveLength(1);
    expect(d.routeLog?.[0]?.status).toBe('cancelled');
  });

  it('согласующему без доступа даёт «комментирует» на время шага', () => {
    const r = routeRig();
    startOrder(r, [{ kind: 'approve', who: ['m-sokolov'], days: 1 }]);
    const d = rd(r, 'doc-ord14');
    expect(d.tmp).toEqual([
      expect.objectContaining({ member: 'm-sokolov', level: 'comment', step: 0 }),
    ]);
  });

  it('сохраняет шаблон маршрута в папку', () => {
    const r = routeRig();
    r.as('m-owner');
    r.cmds.docRouteStart('doc-ord14', {
      steps: [{ kind: 'approve', who: ['m-kotova'], days: 1 }],
      rules: RULES,
      project: 'pj-docs',
      saveTpl: true,
    } as never);
    expect(folder(r.db, 'fd-log-ord').routeTpl).toMatchObject({
      name: 'Шаблон папки «' + folder(r.db, 'fd-log-ord').name + '»',
      project: 'pj-docs',
    });
  });

  it.each([
    ['нет шагов', { steps: [], project: 'pj-docs' }, 'Добавьте хотя бы один шаг'],
    ['неизвестный шаг', { steps: [{ kind: 'zzz' }], project: 'pj-docs' }, 'Неизвестный шаг'],
    [
      'нет согласующих',
      { steps: [{ kind: 'approve', who: [] }], project: 'pj-docs' },
      'Шаг 1 «Согласовать»: добавьте согласующих',
    ],
    [
      'нет сотрудника',
      { steps: [{ kind: 'approve', who: ['m-nobody'] }], project: 'pj-docs' },
      'Шаг 1 «Согласовать»: сотрудник не найден',
    ],
    [
      'автор согласует сам',
      { steps: [{ kind: 'approve', who: ['m-owner'] }], project: 'pj-docs' },
      'Шаг 1 «Согласовать»: автор не согласует свой документ. Уберите себя или выключите правило',
    ],
    [
      'автор утверждает сам',
      { steps: [{ kind: 'sign', who: ['m-owner'] }], project: 'pj-docs' },
      'Шаг 1 «Утвердить»: автор не утверждает свой документ. Выберите другого утверждающего или выключите правило',
    ],
    [
      'нет утверждающего',
      { steps: [{ kind: 'sign', who: [] }], project: 'pj-docs' },
      'Шаг 1 «Утвердить»: выберите, кто утверждает',
    ],
    [
      'пустая аудитория',
      { steps: [{ kind: 'ack', audience: [] }], project: 'pj-docs' },
      'Шаг 1 «Ознакомить»: добавьте роль, группу или сотрудников',
    ],
    [
      'нет заказчика',
      { steps: [{ kind: 'ext' }], project: 'pj-docs' },
      'Шаг 1 «Подпись заказчика»: укажите заказчика',
    ],
    [
      'нет проекта',
      { steps: [{ kind: 'approve', who: ['m-kotova'] }], project: 'nope' },
      'Выберите проект задач с процессом',
    ],
  ])('отказ: %s', (_n, spec, text) => {
    const r = routeRig();
    r.as('m-owner');
    const e = fail(() => r.cmds.docRouteStart('doc-ord14', spec as never));
    expect(e).toMatchObject({ code: 'validation', message: text });
    expect(rd(r, 'doc-ord14').route).toBeUndefined();
  });

  it('отказ: заблокированный согласующий', () => {
    const r = routeRig();
    const m = r.db.members.find((x) => x.id === 'm-kotova');
    if (m) m.status = 'blocked';
    r.as('m-owner');
    const e = fail(() =>
      r.cmds.docRouteStart('doc-ord14', {
        steps: [{ kind: 'approve', who: ['m-kotova'] }],
        project: 'pj-docs',
      } as never),
    );
    expect(e.message).toBe('Шаг 1 «Согласовать»: ' + (m?.name ?? '') + ' заблокирован');
  });

  it('отказ: утверждающий без права «Утверждать»', () => {
    const r = routeRig();
    r.as('m-owner');
    const e = fail(() =>
      r.cmds.docRouteStart('doc-ord14', {
        steps: [{ kind: 'sign', who: ['m-sokolov'] }],
        project: 'pj-docs',
      } as never),
    );
    expect(e.code).toBe('validation');
    expect(e.message).toMatch(/не может утверждать: нет права «Документы · Утверждать»/);
  });

  it('отказ: уже на маршруте, PDF/A, недоступный документ, нет права править', () => {
    const r = routeRig();
    startOrder(r);
    expect(fail(() => startOrder(r)).message).toBe('Документ уже на маршруте');
    expect(
      fail(() =>
        r.cmds.docRouteStart('doc-nope', {
          steps: [{ kind: 'approve', who: ['m-kotova'] }],
          project: 'pj-docs',
        } as never),
      ),
    ).toMatchObject({ code: 'not_found', message: 'Документ не найден или недоступен' });
    r.as('m-kotova');
    expect(
      fail(() => r.cmds.docRouteStart('doc-42', { steps: [], project: 'pj-docs' } as never)).code,
    ).toBe('not_found');
    const pdfa = rd(r, 'doc-ord14');
    r.as('m-owner');
    pdfa.route = undefined;
    pdfa.pdfa = true;
    expect(
      fail(() => r.cmds.docRouteStart('doc-ord14', { steps: [], project: 'pj-docs' } as never))
        .message,
    ).toBe('PDF/A-копию не отправляют на согласование');
  });

  it('отказ: нет права создавать задачи в проекте', () => {
    const r = routeRig();
    r.as('m-kotova');
    const e = fail(() =>
      r.cmds.docRouteStart('doc-ord14', {
        steps: [{ kind: 'approve', who: ['m-ilyin'] }],
        project: 'pj-docs',
      } as never),
    );
    expect(e).toMatchObject({ code: 'forbidden' });
    expect(e.message).toMatch(/^Нет права создавать задачи в проекте «Документы · маршруты»/);
  });
});

describe('согласование и утверждение', () => {
  it('«все сразу»: ждём обоих, потом шаг переходит; задача следует за маршрутом', () => {
    const r = routeRig();
    startOrder(r, [
      { kind: 'approve', mode: 'all', who: ['m-kotova', 'm-ilyin'], days: 1 },
      { kind: 'approve', mode: 'any', who: ['m-kotova', 'm-ilyin'], days: 1 },
    ]);
    const d = rd(r, 'doc-ord14');
    r.as('m-kotova');
    expect(r.cmds.docRouteDecide('doc-ord14', { decision: 'ok', comment: 'ок' })).toEqual({
      status: 'active',
    });
    expect(stepWaiting(d.route?.steps[0])).toEqual(['m-ilyin']);
    const t = () => r.ctx.tasks.get(d.route?.task ?? '');
    expect(t()?.assignee).toBe(r.db.members.find((m) => m.id === 'm-ilyin')?.name);
    r.as('m-ilyin');
    r.cmds.docRouteDecide('doc-ord14', { decision: 'ok' });
    expect(d.route?.cur).toBe(1);
    expect(d.route?.steps[0]?.status).toBe('done');
    r.as('m-kotova');
    r.cmds.docRouteDecide('doc-ord14', { decision: 'ok' });
    expect(d.route).toMatchObject({ status: 'done' });
    expect(d.status).toBe('agreed');
    expect(t()).toMatchObject({ status: 'Готово' });
    expect(t()?.docRoute).toMatchObject({ status: 'done' });
    expect(t()?.comments.at(-1)?.text).toBe('Маршрут завершён');
    expect(d.history?.[0]?.text).toBe('Маршрут завершён');
  });

  it('«по очереди»: решение второго не принимают, пока не решил первый', () => {
    const r = routeRig();
    startOrder(r, [{ kind: 'approve', mode: 'seq', who: ['m-kotova', 'm-ilyin'], days: 1 }]);
    r.as('m-ilyin');
    expect(fail(() => r.cmds.docRouteDecide('doc-ord14', { decision: 'ok' }))).toMatchObject({
      code: 'forbidden',
    });
    r.as('m-kotova');
    r.cmds.docRouteDecide('doc-ord14', { decision: 'ok' });
    expect(r.db.events?.[0]?.to).toEqual(['m-ilyin']);
    expect(r.db.events?.[0]?.text).toBe('Согласуйте «Приказ № 14 · О работе 4 ноября» v6');
  });

  it('отказ в решении: не на маршруте, не ваша очередь, утверждение без кода, ознакомление', () => {
    const r = routeRig();
    expect(fail(() => r.cmds.docRouteDecide('doc-ord14', { decision: 'ok' })).message).toBe(
      'Документ не на маршруте',
    );
    startOrder(r);
    r.as('m-owner');
    expect(fail(() => r.cmds.docRouteDecide('doc-ord14', { decision: 'ok' })).message).toBe(
      'Сейчас решение ждут: ' + (r.db.members.find((m) => m.id === 'm-kotova')?.name ?? ''),
    );
    expect(
      fail(() => r.cmds.docRouteDecide('doc-ord14', { decision: 'ok', as: 'm-ilyin' })).message,
    ).toBe('Решение этого участника сейчас не ждут');
    const d = rd(r, 'doc-ord14');
    r.as('m-kotova');
    r.cmds.docRouteDecide('doc-ord14', { decision: 'ok' });
    r.as('m-owner');
    expect(fail(() => r.cmds.docRouteDecide('doc-ord14', { decision: 'ok' })).message).toBe(
      'Утверждение — подписью по коду из SMS',
    );
    expect(d.route?.steps[1]?.decisions).toEqual([]);
  });

  it('решение должно быть ok или back: пустое не обходит подпись по коду', () => {
    const r = routeRig();
    startOrder(r);
    r.as('m-kotova');
    r.cmds.docRouteDecide('doc-ord14', { decision: 'ok' });
    r.as('m-owner');
    for (const spec of [{}, { decision: 'yes' }, { comment: 'х' }]) {
      expect(fail(() => r.cmds.docRouteDecide('doc-ord14', spec))).toMatchObject({
        code: 'validation',
        message: 'Выберите решение: согласовать или вернуть на доработку',
      });
    }
    expect(rd(r, 'doc-ord14').route?.steps[1]?.decisions).toEqual([]);
  });

  it('демо «от имени»: утверждение без кода помечено демо', () => {
    const r = routeRig();
    startOrder(r);
    r.as('m-kotova');
    r.cmds.docRouteDecide('doc-ord14', { decision: 'ok' });
    r.as('m-sokolov');
    r.as('m-kotova');
    // `as` — демо-решение за ждущего участника
    r.cmds.docRouteDecide('doc-ord14', { decision: 'ok', as: 'm-owner' });
    const d = rd(r, 'doc-ord14');
    expect(d.route?.steps[1]?.decisions[0]).toMatchObject({ member: 'm-owner', demo: true });
    expect(d.status).toBe('approved');
    expect(d.pdfaId).toBeTruthy();
  });

  it('возврат: нужен комментарий, маршрут «на доработке», автор видит ожидание', () => {
    const r = routeRig();
    startOrder(r);
    r.as('m-kotova');
    expect(fail(() => r.cmds.docRouteDecide('doc-ord14', { decision: 'back' })).message).toBe(
      'Напишите, что доработать',
    );
    expect(
      r.cmds.docRouteDecide('doc-ord14', { decision: 'back', comment: 'Поправьте п. 2' }),
    ).toEqual({ status: 'returned' });
    const d = rd(r, 'doc-ord14');
    expect(d.route?.status).toBe('returned');
    expect(d.route?.back).toMatchObject({ step: 0, by: 'm-kotova', comment: 'Поправьте п. 2' });
    expect(d.tmp).toEqual([]);
    const t = r.ctx.tasks.get(d.route?.task ?? '');
    expect(t?.status).toBe('В работе');
    expect(t?.assignee).toBe(r.db.members.find((m) => m.id === 'm-owner')?.name);
    expect(t?.comments.at(-1)?.text).toMatch(/вернул\(а\) на доработку v\d+ — Поправьте п\. 2$/);
    expect(r.db.events?.[0]?.to).toEqual(['m-owner']);
  });

  it('возврат без комментария, если правило выключено', () => {
    const r = routeRig();
    r.as('m-owner');
    r.cmds.docRouteStart('doc-ord14', {
      steps: [{ kind: 'approve', who: ['m-kotova'] }],
      rules: { notAuthor: false, commentOnBack: false },
      project: 'pj-docs',
    } as never);
    r.as('m-kotova');
    r.cmds.docRouteDecide('doc-ord14', { decision: 'back' });
    expect(rd(r, 'doc-ord14').history?.[0]?.text).toMatch(
      /вернул\(а\) на доработку: без комментария/,
    );
  });
});

describe('подпись ПЭП', () => {
  it('код из SMS: детерминированный, три попытки, утверждение, PDF/A', () => {
    const r = routeRig();
    startOrder(r);
    r.as('m-kotova');
    r.cmds.docRouteDecide('doc-ord14', { decision: 'ok' });
    r.as('m-kotova');
    expect(fail(() => r.cmds.docSignStart('doc-ord14')).code).toBe('forbidden');
    r.as('m-owner');
    const seq0 = r.db.seq;
    const { code, phone } = r.cmds.docSignStart('doc-ord14');
    expect(code).toBe(String(1000 + ((seq0 * 7919) % 9000)));
    expect(phone).toMatch(/^\+7 9•• •••-••-\d\d$/);
    expect(r.db.seq).toBe(seq0 + 1);
    expect(fail(() => r.cmds.docSign('doc-ord14', '0000')).message).toBe(
      'Код не подходит. Осталось попыток: 2',
    );
    expect(fail(() => r.cmds.docSign('doc-ord14', '1')).message).toBe(
      'Код не подходит. Осталось попыток: 1',
    );
    expect(fail(() => r.cmds.docSign('doc-ord14', '2')).message).toBe(
      'Код не подходит. Осталось попыток: 0',
    );
    expect(fail(() => r.cmds.docSign('doc-ord14', code)).message).toBe(
      'Попытки закончились — запросите новый код',
    );
    const again = r.cmds.docSignStart('doc-ord14');
    const out = r.cmds.docSign('doc-ord14', ' ' + again.code + ' ');
    const d = rd(r, 'doc-ord14');
    expect(d.status).toBe('approved');
    expect(out.pdfa).toBe(d.pdfaId);
    expect(d.route?.sms).toBeNull();
    expect(d.route?.steps[1]?.decisions[0]).toMatchObject({ method: 'pep_sms', member: 'm-owner' });
    expect(d.frozen).toMatchObject({ Фирма: expect.any(String) });
  });

  it('подпись без кода и чужим участником — отказ', () => {
    const r = routeRig();
    expect(fail(() => r.cmds.docSign('doc-ord14', '1')).message).toBe('Документ не на маршруте');
    expect(fail(() => r.cmds.docSignStart('doc-ord14')).message).toBe('Документ не на маршруте');
    startOrder(r);
    expect(fail(() => r.cmds.docSignStart('doc-ord14')).code).toBe('forbidden');
    expect(fail(() => r.cmds.docSign('doc-ord14', '1')).message).toBe('Сначала запросите код');
  });

  it('PDF/A: копия рядом с исходником с листом согласования и слепком версии', () => {
    const r = routeRig();
    toAck(r);
    const d = rd(r, 'doc-ord14');
    const nd = r.db.docs.items.find((x) => x.id === d.pdfaId) as unknown as RDoc;
    expect(r.db.docs.items[0]).toBe(nd as unknown as DocItem);
    expect(nd).toMatchObject({
      kind: 'pdf',
      title: d.title + ' · PDF/A',
      folder: d.folder,
      owner: 'm-owner',
      pdfa: true,
      status: 'signed',
      size: 0.6,
      textLayer: true,
      src: { doc: 'doc-ord14', v: d.route?.v, op: 'route' },
    });
    expect(nd.versions[0]).toMatchObject({
      v: 1,
      source: 'route',
      name: 'Подписанная копия v' + d.route?.v,
    });
    const pages = nd.pages as { art: string; rows?: unknown[]; sha?: string }[];
    expect(pages.map((p) => p.art)).toEqual(['from', 'approval']);
    expect(pages[1]?.rows).toHaveLength(2);
    expect(pages[1]?.sha).toMatch(/^[0-9a-f]{4}…[0-9a-f]{4}$/);
  });
});

describe('ознакомление', () => {
  it('шаг строит список людей, выдаёт чтение и закрывается, когда ознакомились все', () => {
    const r = routeRig();
    toAck(r);
    const d = rd(r, 'doc-ord14');
    const st = d.route?.steps[2];
    expect(st?.status).toBe('active');
    const people = st?.people ?? [];
    expect(people.length).toBeGreaterThan(0);
    expect(people).not.toContain('m-owner');
    for (const m of people) {
      expect(docRights(r.db, m, d as unknown as DocItem, T).L).toBeGreaterThanOrEqual(1);
    }
    const outsider = r.db.members.find((m) => !people.includes(m.id) && m.id !== 'm-owner');
    r.as(outsider?.id ?? null);
    expect(fail(() => r.cmds.docAck('doc-ord14', {})).code).toBe('not_found');
    people.forEach((m, i) => {
      r.as(m);
      const out = r.cmds.docAck('doc-ord14', { device: 'телефон' });
      expect(out).toEqual({ done: i + 1, of: people.length });
      // повторное «ознакомлен(а)» ничего не меняет
      if (i < people.length - 1) expect(r.cmds.docAck('doc-ord14', {})).toEqual(out);
    });
    expect(d.route?.status).toBe('done');
    expect(st?.done?.[0]).toMatchObject({ device: 'телефон', v: d.route?.v });
    expect(st?.done).toHaveLength(people.length);
  });

  it('владелец и автор завершают ознакомление досрочно; остальные — нет', () => {
    const r = routeRig();
    toAck(r);
    const d = rd(r, 'doc-ord14');
    const first = d.route?.steps[2]?.people?.[0] ?? '';
    r.as(first);
    expect(fail(() => r.cmds.docAckClose('doc-ord14')).code).toBe('forbidden');
    r.as('m-owner');
    expect(r.cmds.docAckClose('doc-ord14')).toEqual({ ok: true });
    expect(d.route?.status).toBe('done');
    expect(d.route?.steps[2]?.closed).toMatchObject({ by: 'm-owner' });
    expect(d.history?.some((h) => /^Ознакомление завершено: 0 из \d+$/.test(h.text))).toBe(true);
    expect(fail(() => r.cmds.docAckClose('doc-ord14')).message).toBe('Ознакомление не идёт');
    expect(fail(() => r.cmds.docAck('doc-ord14', {})).message).toBe('Ознакомление не запрошено');
  });

  it('пустая аудитория: шаг пропускается и маршрут завершается', () => {
    const r = routeRig();
    startOrder(r, [{ kind: 'ack', audience: [{ who: 'member', ref: 'm-owner' }], days: 1 }]);
    const d = rd(r, 'doc-ord14');
    expect(d.route?.status).toBe('done');
    expect(d.route?.steps[0]?.people).toEqual([]);
  });
});

describe('доработка и отмена', () => {
  it('возобновить: нужна новая версия, шаг начинается заново', () => {
    const r = routeRig();
    startOrder(r);
    r.as('m-kotova');
    r.cmds.docRouteDecide('doc-ord14', { decision: 'back', comment: 'Доработать' });
    const d = rd(r, 'doc-ord14');
    r.as('m-sokolov');
    expect(fail(() => r.cmds.docRouteResume('doc-ord14')).code).toBe('not_found');
    r.as('m-kotova');
    expect(fail(() => r.cmds.docRouteResume('doc-ord14')).message).toBe(
      'Отправить снова может автор маршрута',
    );
    r.as('m-owner');
    expect(fail(() => r.cmds.docRouteResume('doc-ord14')).message).toBe(
      'Сначала внесите правки: согласуют новую версию',
    );
    d.dirty = true;
    const v0 = d.v;
    expect(r.cmds.docRouteResume('doc-ord14')).toEqual({ v: v0 + 1 });
    expect(d.route).toMatchObject({ status: 'active', v: v0 + 1 });
    expect(d.route?.back?.resolved).toBe(true);
    expect(d.route?.steps[0]).toMatchObject({ status: 'active', decisions: [] });
    expect(d.versions.at(-1)?.name).toBe('После доработки');
    expect(r.ctx.tasks.get(d.route?.task ?? '')?.status).toBe('На проверке');
    expect(fail(() => r.cmds.docRouteResume('doc-ord14')).message).toBe('Документ не на доработке');
  });

  it('отмена: только автор или владелец; задача закрывается; доступ снимается', () => {
    const r = routeRig();
    startOrder(r, [{ kind: 'approve', who: ['m-sokolov'], days: 1 }]);
    const d = rd(r, 'doc-ord14');
    expect(d.tmp).toHaveLength(1);
    r.as('m-kotova');
    expect(fail(() => r.cmds.docRouteCancel('doc-ord14')).message).toBe(
      'Отменить маршрут может автор или владелец бизнеса',
    );
    r.as('m-owner');
    expect(r.cmds.docRouteCancel('doc-ord14')).toEqual({ ok: true });
    expect(d.route?.status).toBe('cancelled');
    expect(d.tmp).toEqual([]);
    const t = r.ctx.tasks.get(d.route?.task ?? '');
    expect(t?.status).toBe('Отменена');
    expect(t?.docRoute).toMatchObject({ status: 'cancelled' });
    expect(t?.comments.at(-1)?.text).toMatch(/: маршрут отменён$/);
    expect(fail(() => r.cmds.docRouteCancel('doc-ord14')).message).toBe('Маршрут уже завершён');
  });

  it('проверка доступа (Q-W7.22-2): решение, подпись и ознакомление недоступному — not_found', () => {
    const r = routeRig();
    startOrder(r);
    r.as('m-morozova-none');
    for (const fn of [
      () => r.cmds.docRouteDecide('doc-ord14', { decision: 'ok' }),
      () => r.cmds.docSignStart('doc-ord14'),
      () => r.cmds.docSign('doc-ord14', '1'),
      () => r.cmds.docAck('doc-ord14', {}),
      () => r.cmds.docAckClose('doc-ord14'),
      () => r.cmds.docRouteCancel('doc-ord14'),
    ]) {
      expect(fail(fn)).toMatchObject({ code: 'not_found' });
    }
  });

  it('нет документа и нет модуля', () => {
    const r = routeRig();
    expect(fail(() => r.cmds.docRouteCancel('doc-nope')).code).toBe('not_found');
    delete (r.db as { docs?: unknown }).docs;
    expect(fail(() => r.cmds.docRouteCancel('doc-ord14')).message).toBe(
      'Модуль «Документы» не подключён',
    );
  });
});

describe('routeSheet', () => {
  it('пустой маршрут, строки по шагам и слепок версии', () => {
    const r = routeRig();
    const d = rd(r, 'doc-ord14');
    expect(routeSheet(r.db, d)).toEqual({ rows: [], v: d.v, sha: '' });
    startOrder(r);
    const s = routeSheet(r.db, d);
    expect(s.v).toBe(d.route?.v);
    expect(s.rows[0]).toMatchObject({ s: '1 · Согласовать', r: 'ждёт', at: '' });
    expect(s.rows[1]).toMatchObject({ s: '2 · Утвердить', r: 'после шага 1' });
    expect(s.rows[2]).toMatchObject({ s: '3 · Ознакомить', w: 'после утверждения', r: '—' });
    expect(routeSheet(r.db, d, d.route, true).rows).toHaveLength(2);
  });

  it('решения: согласовал, утвердил, вернул, подпись заказчика, не потребовалось', () => {
    const r = routeRig();
    const d = rd(r, 'doc-ord14');
    const nm = (id: string): string => r.db.members.find((m) => m.id === id)?.name ?? id;
    const at = '01.10 10:30';
    d.route = {
      id: 'rt-x',
      v: d.v,
      by: 'm-owner',
      at,
      status: 'active',
      cur: 0,
      project: null,
      task: null,
      rules: { lock: true, notAuthor: true, commentOnBack: true, escalate: false },
      steps: [
        {
          kind: 'approve',
          name: 'Согласовать',
          who: ['m-kotova', 'm-ilyin'],
          days: 1,
          status: 'done',
          decisions: [
            { member: 'm-kotova', decision: 'ok', at },
            { member: 'm-ilyin', decision: 'back', at },
            { member: 'm-ilyin', decision: 'ok', at, demo: true },
          ],
        },
        {
          kind: 'approve',
          name: 'Ещё',
          who: ['m-kotova'],
          days: 1,
          status: 'done',
          decisions: [],
        },
        {
          kind: 'sign',
          name: 'Утвердить',
          who: ['m-owner'],
          days: 1,
          status: 'done',
          decisions: [{ member: 'm-owner', decision: 'ok', at, method: 'pep_sms' }],
        },
        {
          kind: 'ext',
          name: 'Подпись заказчика',
          who: [],
          days: 1,
          status: 'done',
          ext: { name: 'Ольга Смирнова' },
          decisions: [{ member: 'ext', decision: 'ok', at, demo: true }],
        },
        {
          kind: 'ext',
          name: 'Подпись',
          who: [],
          days: 1,
          status: 'wait',
          ext: { name: 'Иван' },
          decisions: [],
        },
        {
          kind: 'ack',
          name: 'Ознакомить',
          who: [],
          days: 1,
          status: 'active',
          people: ['m-a', 'm-b'],
          done: [{ member: 'm-a', at }],
          decisions: [],
        },
      ],
    };
    const rows = routeSheet(r.db, d).rows;
    expect(rows).toEqual([
      { s: '1 · Согласовать', w: nm('m-kotova'), r: 'Согласовал(а)', at },
      { s: '1 · Согласовать', w: nm('m-ilyin'), r: 'Согласовал(а) · демо', at },
      { s: '2 · Ещё', w: nm('m-kotova'), r: 'не потребовалось', at: '' },
      { s: '3 · Утвердить', w: nm('m-owner'), r: 'Утвердил(а) · ПЭП, код из SMS', at },
      { s: '4 · Подпись заказчика', w: 'Ольга Смирнова', r: 'Подписал(а) · код из SMS · демо', at },
      { s: '5 · Подпись', w: 'Иван', r: 'после шага 4', at: '' },
      { s: '6 · Ознакомить', w: '2 сотрудника', r: '1 из 2', at: '' },
    ]);
    const back = d.route.steps[0];
    if (back) back.decisions = [{ member: 'm-ilyin', decision: 'back', at }];
    expect(routeSheet(r.db, d).rows[1]).toMatchObject({ r: 'Вернул(а) на доработку' });
    expect(routeSheet(r.db, d).rows.at(-1)?.w).toBe('2 сотрудника');
    // неизвестный участник печатается своим id
    const step = d.route.steps[1];
    if (step) step.who = ['m-ghost'];
    expect(routeSheet(r.db, d).rows.some((x) => x.w === 'm-ghost')).toBe(true);
    // слепок версии
    const v = d.versions.find((x) => x.v === d.route?.v);
    expect(v).toBeTruthy();
  });
});
