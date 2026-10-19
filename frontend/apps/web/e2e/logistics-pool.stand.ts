// W2.23 · Помощники строк @stand «Ресурсного пула» на сиде e2e-stand. Сида пула на стенде нет (Q-W2.07-5): строка
// сама готовит пул и возвращает сид.
//   - «Логистика» и роль логиста Котовой — logisticsOn (W2.53, уборка там же);
//   - владелец публикует Тимура Ахмедова («Север Логистик», функция «Водитель») на окно 6 ч через 4–7 суток от «сейчас»
//     (окна рейсов других строк — ближайшие двое суток; пересечение с неснятой публикацией прошлого прогона — 409,
//     тогда окно сдвигается); для строки логиста (`foreign`) — карточку без входа «Водитель пула {проект}» фирмы
//     «Юг Транс» (в сиде все водители — «Север Логистик», фирма Котовой);
//   - рейс фирмы-получателя («Юг Транс», для `foreign` — «Север Логистик») внутри окна публикации (createTripPlan
//     владельца, без водителя);
//   - уборка: открытые запросы публикации отклоняются, одобренные отзываются (водитель снимается с не начатого рейса),
//     публикация снимается — окно водителя свободно для следующего проекта.
import { expect, type Page } from '@playwright/test';

import type { Session, Undo } from './_stand/fixtures.ts';
import { listUnits } from './_stand/stand.ts';
import { label, logisticsOn } from './logistics.stand.ts';
import { call, type Reply } from './shell.helpers.ts';

const HOUR = 3_600_000;
const YUG = 'Юг Транс';

export interface PoolStand {
  tenant: string;
  owner: Page;
  /** Псевдоним публикации («Водитель #N», выдаёт сервер). */
  code: string;
  publicationId: string;
  trip: { id: string; number: string };
}

const ok = (r: Reply, what: string): Reply => {
  expect(r.status < 300, `${what} ${r.status}: ${JSON.stringify(r.body)}`).toBe(true);
  return r;
};

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Карточка без входа «Водитель пула {проект}» в «Юг Транс» с функцией «Водитель» (createMember, createWorkProfile):
 * водитель другой фирмы для логиста «Север Логистик». Своя карточка у каждого проекта, повторный прогон берёт её же
 * (карточка места не занимает; стенд пересоздаётся `down -v`).
 */
async function yugDriver(
  owner: Page,
  tenant: string,
  unit: string,
  project: string,
): Promise<string> {
  const base = `/api/v1/tenants/${tenant}/members`;
  const name = `Водитель пула ${project}`;
  const list = ok(await call(owner, 'GET', `${base}?limit=200`), 'listMembers').body as {
    items: { id: string; displayName: string }[];
  };
  const id =
    list.items.find((m) => m.displayName === name)?.id ??
    (
      ok(
        await call(owner, 'POST', base, { body: { displayName: name, orgUnitIds: [unit] } }),
        'createMember',
      ).body as { id: string }
    ).id;
  const profiles = ok(await call(owner, 'GET', `${base}/${id}/work-profiles`), 'listWorkProfiles')
    .body as { items?: { function: string; validUntil?: string | null }[] };
  if (!(profiles.items ?? []).some((p) => p.function === 'driver' && !p.validUntil)) {
    ok(
      await call(owner, 'POST', `${base}/${id}/work-profiles`, {
        body: { function: 'driver', validFrom: iso(Date.now()) },
      }),
      'createWorkProfile',
    );
  }
  return id;
}

/**
 * Пул строки и уборка в `undo`. По умолчанию — публикация Ахмедова («Север Логистик») и рейс «Юг Транс» в её окне
 * (решает владелец). `foreign` — для логиста Котовой: публикация водителя «Юг Транс» и рейс «Север Логистик» (в
 * каталоге логиста нет водителей фирм, где он запрашивает, AUTH-06).
 */
export async function poolStand(
  session: () => Promise<Session>,
  undo: Undo,
  project: string,
  o: { foreign?: boolean } = {},
): Promise<PoolStand> {
  const s = await logisticsOn(session, undo);
  const base = `/api/v1/tenants/${s.tenant}/fleet`;
  const yug = (await listUnits(s.owner, s.tenant)).find((u) => u.name === YUG);
  if (!yug) throw new Error(`нет подразделения «${YUG}»`);
  const driver = o.foreign
    ? await yugDriver(s.owner, s.tenant, yug.id, project)
    : s.members.akhmedov;
  const home = o.foreign ? yug.id : s.unitId;
  const tripUnit = o.foreign ? s.unitId : yug.id;
  let start = Math.ceil((Date.now() + 4 * 24 * HOUR + Math.random() * 72 * HOUR) / HOUR) * HOUR;
  let pub: { id: string; displayName: string; freeWindow: { startsAt: string } } | undefined;
  for (let i = 0; i < 12 && !pub; i++, start += 7 * HOUR) {
    const r = await call(s.owner, 'POST', `${base}/driver-pool/publications`, {
      body: {
        driverMemberId: driver,
        homeOrgUnitId: home,
        freeWindow: {
          startsAt: iso(start),
          endsAt: iso(start + 6 * HOUR),
          timeZone: 'Europe/Moscow',
        },
        qualifications: ['Кат. B'],
        terms: 'По соглашению фирм группы',
      },
    });
    if (r.status === 201) pub = r.body as NonNullable<typeof pub>;
    else if ((r.body as { code?: string }).code !== 'resources_unavailable')
      ok(r, 'publishDriverToPool');
  }
  if (!pub) throw new Error('publishDriverToPool: окно водителя занято во всех попытках');
  const publicationId = pub.id;
  undo(`пул: публикация ${pub.displayName}`, () => cleanup(s.owner, s.tenant, publicationId));
  // Рейс — внутри окна созданной публикации (счётчик цикла уже сдвинул start после успешной попытки).
  const from = Date.parse(pub.freeWindow.startsAt) + HOUR;
  const trip = ok(
    await call(s.owner, 'POST', `${base}/trip-plans`, {
      body: {
        orgUnitId: tripUnit,
        title: `Пул ${label(project)}`,
        plannedWindow: {
          startsAt: iso(from),
          endsAt: iso(from + 2 * HOUR),
          timeZone: 'Europe/Moscow',
        },
        distanceKm: '35',
        cargo: {
          description: 'Сухой груз · 5 паллет-мест',
          weightKg: '400',
          volumeM3: '5',
          lengthM: '2',
        },
        stops: [
          {
            sequence: 1,
            op: 'load',
            address: 'Склад № 1, Лобня',
            weightKg: '400',
            volumeM3: '5',
            plannedAt: iso(from),
          },
          {
            sequence: 2,
            op: 'unload',
            address: 'Химки, ул. Заводская, 8',
            weightKg: '400',
            volumeM3: '5',
            plannedAt: iso(from + HOUR),
          },
        ],
      },
    }),
    'createTripPlan',
  ).body as { id: string; number: string };
  return {
    tenant: s.tenant,
    owner: s.owner,
    code: pub.displayName,
    publicationId,
    trip: { id: trip.id, number: trip.number },
  };
}

/** Запросы публикации закрыты (открытые — отклонены, одобренные — отозваны), публикация снята. */
async function cleanup(owner: Page, tenant: string, publicationId: string): Promise<void> {
  const base = `/api/v1/tenants/${tenant}/fleet`;
  const list = ok(
    await call(
      owner,
      'GET',
      `${base}/driver-transfer-requests?status=requested&status=approved&limit=200`,
    ),
    'listDriverTransfers',
  ).body as { items: { id: string; status: string; publicationId?: string }[] };
  for (const x of list.items.filter((t) => t.publicationId === publicationId)) {
    const path = `${base}/driver-transfer-requests/${x.id}`;
    const cur = ok(await call(owner, 'GET', path), 'getDriverTransfer');
    ok(
      await call(owner, 'POST', `${path}/decision`, {
        body: {
          decision: x.status === 'approved' ? 'revoke' : 'reject',
          comment: 'W2.23: уборка стенд-e2e',
        },
        ifMatch: cur.headers.etag ?? '',
      }),
      'decideDriverTransfer',
    );
  }
  const path = `${base}/driver-pool/publications/${publicationId}`;
  const cur = ok(await call(owner, 'GET', path), 'getDriverPoolPublication');
  if ((cur.body as { state: string }).state !== 'active') return;
  ok(
    await call(owner, 'POST', `${path}/withdrawal`, {
      body: { comment: 'W2.23: уборка стенд-e2e' },
      ifMatch: cur.headers.etag ?? '',
    }),
    'withdrawDriverPoolPublication',
  );
}
