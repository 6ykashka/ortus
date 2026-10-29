// W7.90 · Выход этапа 7, модуль «Чаты» (backend W7.11, страница W7.13): рабочий чат «Альты» от состава до хранения.
// Владелец выдаёт сотрудникам роль с действиями чатов (посева ролей чатов нет, Q-W7.11-21), заводит рабочий чат
// («Что изменится» — dryRun, затем создание), логист ведёт чат модератором, водитель пишет. Путь: лента с нумерацией,
// «Важное» с «Ознакомлен», опрос с голосованием и закрытием, непрочитанные и отметка прочтения, правка с историей,
// удаление модератором с причиной (в ленте остаётся только пометка), закрепление, задача из сообщения; политика
// вида и хранение (dryRun очистки, юридическая блокировка); архив закрывает отправку. Изоляция: «Лотос» не видит
// чат «Альты» (404 как у несуществующего), сотрудник без роли чатов — отказ. Страница «Чаты» открывается.
//   @stand — страница проекта (390 / 768 / 1440); чат несёт метку прогона, роли и назначения снимает уборка.
import type { Page } from '@playwright/test';

import { expect, test } from '../../_stand/fixtures.ts';
import { expectStatus, memberByEmail } from '../../_stand/stand.ts';
import { label, realClock } from '../../logistics.stand.ts';
import { h1, noHorizontalScroll } from '../../modules.helpers.ts';
import { call, LOTOS, type Reply, tenantId } from '../../shell.helpers.ts';
import * as J from '../stage2/journey.ts';

const body = <T>(r: Reply): T => r.body as T;
const KOTOVA = 'm.kotova@alta.example';
const VASILIEV = 'i.vasiliev@alta.example';
const CHAT_ACTIONS = [
  'chat.read',
  'chat.write',
  'chat.files.send',
  'chat.polls.create',
  'chat.receipts.read',
  'chat.direct',
];

interface Message {
  id: string;
  seq: number;
  text: string;
  kind: string;
  authorDisplayName: string;
  editedAt?: string | null;
  important?: { ackCount: number; totalCount: number; dueDate: string } | null;
  poll?: {
    id: string;
    closed: boolean;
    totalVoters: number;
    options: { id: string; text?: string; label?: string; votes?: number }[];
  } | null;
  deleted?: { moderator: boolean; reason?: string } | null;
  tasks: { taskId: string; key: string }[];
}
interface ChatDto {
  id: string;
  title: string;
  status: string;
  revision: number;
  memberCount: number;
  my: { role: string; unread: number; lastReadSeq: number };
  pinned?: { id: string } | null;
}

test.describe('выход этапа 7 — чаты: состав, лента, важное, опрос, правка, хранение @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('рабочий чат «Альты»: логист модерирует, водитель пишет; «Лотос» и сотрудник без роли ничего не видят', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(420_000);
    await realClock(page);
    const tag = label(testInfo.project.name);

    // 0. Владелец «Альты»: роль с действиями чатов у логиста и водителя.
    await app('/', { persona: 'owner' });
    const tenant = await tenantId(page);
    const base = `/api/v1/tenants/${tenant}`;
    const kotova = (await memberByEmail(page, tenant, KOTOVA)).id;
    const vasiliev = (await memberByEmail(page, tenant, VASILIEV)).id;
    // Участник: читает и пишет; модератор — ещё закрепляет, объявляет и ведёт состав (действия организации).
    for (const [member, who, extra] of [
      [kotova, 'модератор', ['chat.moderate', 'chat.announce', 'chat.members.manage']],
      [vasiliev, 'участник', []],
    ] as const) {
      const role = body<{ id: string }>(
        expectStatus(
          await call(page, 'POST', `${base}/roles`, {
            body: {
              name: `Чаты W7.90 ${who} ${tag}`,
              description: 'Стенд-путь выхода этапа 7',
              permissions: [...CHAT_ACTIONS, ...extra],
            },
          }),
          201,
          'createRole',
        ),
      );
      undo(`роль чатов (${who})`, async () => {
        const cur = await call(page, 'GET', `${base}/roles/${role.id}`);
        await call(page, 'DELETE', `${base}/roles/${role.id}`, { ifMatch: cur.headers.etag ?? '' });
      });
      const a = body<{ id: string }>(
        expectStatus(
          await call(page, 'POST', `${base}/assignments`, {
            body: {
              principalType: 'member',
              principalId: member,
              roleId: role.id,
              scope: { kind: 'tenant', resourceIds: [], includeDescendants: true },
            },
          }),
          201,
          'createAssignment',
        ),
      );
      undo(`назначение роли чатов (${who})`, async () => {
        await call(page, 'DELETE', `${base}/assignments/${a.id}`);
      });
    }
    const logist = await session();
    await logist.open('/', 'manager');
    await realClock(logist.page);
    const driver = await session();
    await driver.open('/', 'driver');
    await realClock(driver.page);

    // 1. Состав из источников: «Что изменится» не создаёт чат; затем создание — оба в составе.
    const title = `Рейс ${tag}`;
    const spec = {
      kind: 'group',
      title,
      sources: [
        { who: 'member', refId: kotova, role: 'moderator' },
        { who: 'member', refId: vasiliev, role: 'member' },
      ],
    };
    const dry = J.expectOk(
      await call(page, 'POST', `${base}/chats`, { body: { ...spec, dryRun: true } }),
      'createChat dryRun',
    );
    const impact = body<{ applied: boolean; impact: { joined: { displayName: string }[] } }>(dry);
    expect(impact.applied).toBe(false);
    expect(impact.impact.joined.map((m) => m.displayName).sort()).toEqual([
      'Илья Васильев',
      'Марина Котова',
    ]);
    expect(
      body<{ items: { title: string }[] }>(await call(page, 'GET', `${base}/chats`)).items.map(
        (c) => c.title,
      ),
      'dryRun ничего не создал',
    ).not.toContain(title);
    const made = J.expectOk(
      await call(page, 'POST', `${base}/chats`, { body: spec }),
      'createChat',
    );
    expect(made.status).toBe(201);
    const chat = body<{ chat: ChatDto }>(made).chat;
    expect(chat.status).toBe('active');
    expect(chat.memberCount).toBe(2);
    const cbase = `${base}/chats/${chat.id}`;
    const members = body<{
      items: { member: { displayName: string }; state: string; role: string }[];
    }>(J.expectOk(await call(page, 'GET', `${cbase}/members`), 'listChatMembers')).items;
    expect(members.find((m) => m.member.displayName === 'Марина Котова')).toMatchObject({
      state: 'in',
      role: 'moderator',
    });
    expect(members.find((m) => m.member.displayName === 'Илья Васильев')).toMatchObject({
      state: 'in',
      role: 'member',
    });

    // 2. Лента: нумерация идёт подряд, водитель пишет, читатель-логист видит.
    const say = async (p: Page, text: string, extra: Record<string, unknown> = {}) =>
      body<Message>(
        J.expectOk(
          await call(p, 'POST', `${cbase}/messages`, { body: { text, ...extra } }),
          'postChatMessage',
        ),
      );
    const m1 = await say(driver.page, `Выезжаю в 8:00 ${tag}`);
    const m2 = await say(driver.page, 'Груз принял');
    expect(m2.seq).toBe(m1.seq + 1);
    expect(m1.authorDisplayName).toBe('Илья Васильев');
    const empty = await call(driver.page, 'POST', `${cbase}/messages`, { body: {} });
    expect(empty.status).toBe(422);
    expect(body<{ code: string }>(empty).code).toBe('validation_failed');

    // 3. «Важное» — только модератору; водитель отмечает «Ознакомлен».
    const noRight = await call(driver.page, 'POST', `${cbase}/messages`, {
      body: { text: 'Срочно всем', important: {} },
    });
    expect(noRight.status).toBeGreaterThanOrEqual(400);
    expect(body<{ code: string }>(noRight).code).toBe('chat_content_forbidden');
    const imp = await say(logist.page, `Завтра выезд в 6:30 ${tag}`, { important: {} });
    expect(imp.important).toMatchObject({ ackCount: 0 });
    expect(imp.important?.totalCount).toBeGreaterThanOrEqual(1);
    const acked = body<Message>(
      J.expectOk(
        await call(driver.page, 'POST', `${cbase}/messages/${imp.id}/ack`),
        'ackChatMessage',
      ),
    );
    expect(acked.important?.ackCount).toBe(1);

    // 4. Опрос: логист создаёт, водитель голосует, логист закрывает; повторное голосование после закрытия — отказ.
    const poll = await say(logist.page, '', {
      poll: { question: `Когда выезжаем? ${tag}`, options: ['6:30', '8:00'] },
    });
    expect(poll.poll?.options).toHaveLength(2);
    const pollId = poll.poll?.id ?? '';
    const option = poll.poll?.options[0]?.id ?? '';
    const voted = body<Message>(
      J.expectOk(
        await call(driver.page, 'PUT', `${cbase}/polls/${pollId}/vote`, {
          body: { optionIds: [option] },
        }),
        'voteChatPoll',
      ),
    );
    expect(voted.poll?.totalVoters).toBe(1);
    const closed = body<Message>(
      J.expectOk(
        await call(logist.page, 'POST', `${cbase}/polls/${pollId}/close`),
        'closeChatPoll',
      ),
    );
    expect(closed.poll?.closed).toBe(true);
    const late = await call(driver.page, 'PUT', `${cbase}/polls/${pollId}/vote`, {
      body: { optionIds: [option] },
    });
    expect(late.status).toBeGreaterThanOrEqual(400);

    // 5. Непрочитанные: у водителя есть непрочитанное от логиста, отметка прочтения обнуляет.
    const list = body<{ items: ChatDto[] }>(
      J.expectOk(await call(driver.page, 'GET', `${base}/chats?limit=100`), 'listChats'),
    ).items;
    const mine = list.find((c) => c.id === chat.id);
    expect(mine, 'чат в списке водителя').toBeTruthy();
    expect(mine?.my.unread).toBeGreaterThanOrEqual(1);
    const feed = body<{ items: Message[]; hasMore: boolean }>(
      J.expectOk(await call(driver.page, 'GET', `${cbase}/messages?limit=50`), 'listChatMessages'),
    ).items;
    const seqs = feed.map((m) => m.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const readTo = Math.max(...seqs);
    const read = body<{ unread: number; lastReadSeq: number }>(
      J.expectOk(
        await call(driver.page, 'POST', `${cbase}/read`, { body: { uptoSeq: readTo } }),
        'markChatRead',
      ),
    );
    expect(read).toMatchObject({ unread: 0, lastReadSeq: readTo });

    // 6. Правка автором и история; чужое править нельзя; удаление модератором с причиной.
    const edited = body<Message>(
      J.expectOk(
        await call(driver.page, 'PATCH', `${cbase}/messages/${m1.id}`, {
          body: { text: `Выезжаю в 8:30 ${tag}` },
        }),
        'editChatMessage',
      ),
    );
    expect(edited.editedAt).toBeTruthy();
    const versions = body<{ items: { text: string }[] }>(
      J.expectOk(
        await call(driver.page, 'GET', `${cbase}/messages/${m1.id}/versions`),
        'listChatMessageVersions',
      ),
    ).items;
    expect(versions.map((v) => v.text)).toEqual([`Выезжаю в 8:00 ${tag}`]);
    const foreign = await call(logist.page, 'PATCH', `${cbase}/messages/${m1.id}`, {
      body: { text: 'Подправлю чужое' },
    });
    expect(foreign.status).toBe(403);
    const noReason = await call(logist.page, 'DELETE', `${cbase}/messages/${m2.id}?for=all`);
    expect(noReason.status).toBe(422);
    const gone = body<Message>(
      J.expectOk(
        await call(
          logist.page,
          'DELETE',
          `${cbase}/messages/${m2.id}?for=all&reason=${encodeURIComponent('Ошибочное сообщение')}`,
        ),
        'deleteChatMessage',
      ),
    );
    expect(gone.deleted).toMatchObject({ moderator: true, reason: 'Ошибочное сообщение' });
    expect(gone.text).toBe('');
    const after = body<{ items: Message[] }>(
      await call(driver.page, 'GET', `${cbase}/messages?limit=50`),
    ).items.find((m) => m.id === m2.id);
    expect(after?.deleted?.reason).toBe('Ошибочное сообщение');
    expect(after?.text).toBe('');

    // 7. Закрепление и задача из сообщения (логист — модератор).
    const pinned = body<{ pinnedMessageId: string | null }>(
      J.expectOk(
        await call(logist.page, 'PUT', `${cbase}/pin`, { body: { messageId: imp.id } }),
        'pinChatMessage',
      ),
    );
    expect(pinned.pinnedMessageId).toBe(imp.id);
    expect(body<ChatDto>(await call(driver.page, 'GET', cbase)).pinned?.id).toBe(imp.id);
    const task = await call(page, 'POST', `${cbase}/messages/${imp.id}/task`, {
      body: { title: `Подготовить выезд ${tag}` },
    });
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    expect(body<{ key: string }>(task).key).toMatch(/\d+$/);

    // 8. Политика вида и хранение: dryRun политики и очистки ничего не меняют; блокировка ставится и снимается.
    const policies = body<{ items: { kind: string; revision: number }[] }>(
      J.expectOk(await call(page, 'GET', `${base}/chat-policies`), 'listChatPolicies'),
    ).items;
    expect(policies.map((p) => p.kind).sort()).toEqual([
      'announce',
      'area',
      'direct',
      'group',
      'record',
    ]);
    const dryPolicy = J.expectOk(
      await call(page, 'PUT', `${base}/chat-policies/group`, {
        body: { patch: { filesDays: 365 }, dryRun: true },
      }),
      'updateChatPolicy dryRun',
    );
    expect(body<{ applied: boolean }>(dryPolicy).applied).toBe(false);
    const storage = body<{ usedBytes: number; onFull: string }>(
      J.expectOk(await call(page, 'GET', `${cbase}/storage`), 'getChatStorage'),
    );
    expect(storage.usedBytes).toBeGreaterThanOrEqual(0);
    const clean = body<{ applied: boolean }>(
      J.expectOk(
        await call(page, 'POST', `${cbase}/cleanups`, {
          body: { kinds: ['photo'], olderThanDays: 30, dryRun: true },
        }),
        'createChatCleanup dryRun',
      ),
    );
    expect(clean.applied).toBe(false);
    const hold = body<{ id: string; status: string }>(
      expectStatus(
        await call(page, 'POST', `${base}/chat-holds`, {
          body: { scope: 'chat', chatId: chat.id, reason: `Проверка W7.90 ${tag}` },
        }),
        201,
        'createChatHold',
      ),
    );
    expect(hold.status).toBe('active');
    expect(
      body<ChatDto & { hold?: { id: string } | null }>(await call(page, 'GET', cbase)).hold?.id,
    ).toBe(hold.id);
    expect((await call(page, 'DELETE', `${base}/chat-holds/${hold.id}`)).status).toBe(200);

    // 9. Страница «Чаты»: чат в списке у водителя, без горизонтальной прокрутки.
    await driver.open(`/t/${tenant}/chat`, 'driver');
    await expect(h1(driver.page, 'Чаты')).toBeVisible({ timeout: 30_000 });
    await expect(driver.page.getByText(title).first()).toBeVisible({ timeout: 30_000 });
    expect(await noHorizontalScroll(driver.page)).toBe(true);

    // 10. Изоляция: «Лотос» и сотрудник без роли чатов.
    const lotos = await session();
    await lotos.open('/', 'owner@t-lotos');
    const lotosTenant = await tenantId(lotos.page, LOTOS);
    const foreign404 = [
      ['GET', `${base}/chats`],
      ['GET', cbase],
      ['GET', `${cbase}/messages`],
      ['GET', `${cbase}/members`],
    ] as const;
    for (const [method, path] of foreign404) {
      const r = await call(lotos.page, method, path);
      expect(r.status, `${method} ${path}`).toBe(404);
      expect(body<{ code: string }>(r).code).toBe('not_found');
    }
    const lotosList = body<{ items: { title: string }[] }>(
      await call(lotos.page, 'GET', `/api/v1/tenants/${lotosTenant}/chats`),
    );
    expect(JSON.stringify(lotosList)).not.toContain(title);
    const post404 = await call(lotos.page, 'POST', `${cbase}/messages`, {
      body: { text: 'чужой' },
    });
    expect(post404.status).toBe(404);
    // Логист «Лотоса» открывает чат «Альты» по id в своей организации — чата там нет.
    const cross = await call(lotos.page, 'GET', `/api/v1/tenants/${lotosTenant}/chats/${chat.id}`);
    expect(cross.status).toBe(404);
    const foreman = await session();
    await foreman.open('/', 'foreman');
    const noRole = await call(foreman.page, 'GET', `${base}/chats`);
    expect(noRole.status, JSON.stringify(noRole.body)).toBe(403);
    const noRoleOne = await call(foreman.page, 'GET', cbase);
    expect(noRoleOne.status).toBeGreaterThanOrEqual(403);
    expect(JSON.stringify(noRoleOne.body)).not.toContain(title);

    // 11. Архив закрывает отправку.
    const arch = body<ChatDto>(
      J.expectOk(await call(page, 'POST', `${cbase}/archive`), 'archiveChat'),
    );
    expect(arch.status).toBe('archived');
    const closedPost = await call(driver.page, 'POST', `${cbase}/messages`, {
      body: { text: 'после архива' },
    });
    expect(closedPost.status).toBeGreaterThanOrEqual(400);
  });
});
