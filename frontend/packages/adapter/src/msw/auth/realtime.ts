// Тег Auth, контракт 0.4.0-stage1 (W1.00, ADR-0015, PD-58): одноразовый билет канала реального времени.
// В режиме mock WebSocket нет: билет выдаётся по контракту (60 секунд, пинг 25 секунд), подсказки
// context.changed и notifications.changed клиент режима mock заменяет перечитыванием по таймеру (W1.20, W1.22).
import type { components } from '@ortus/api-client';

import { fail } from '../core/problem.ts';
import type { Registry } from '../core/registry.ts';
import { addMs } from '../core/time.ts';

type S = components['schemas'];

const TICKET_TTL_MS = 60_000;
const HEARTBEAT_SECONDS = 25;

export const realtimeHandlers: Registry = {
  createRealtimeTicket: (ctx) => {
    if (!ctx.actor) fail('session_expired');
    const body: S['RealtimeTicket'] = {
      ticket: `rt1.${ctx.newId('platform')}`,
      path: '/api/v1/realtime',
      protocol: 'ortus.realtime.v1',
      expiresAt: addMs(ctx.now(), TICKET_TTL_MS),
      heartbeatSeconds: HEARTBEAT_SECONDS,
    };
    return { status: 201, body };
  },
};
