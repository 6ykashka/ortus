// W2.23 · Ключ идемпотентности «Отправить запрос» (возврат 1): то же тело до окончательного ответа — тот же
// Idempotency-Key (повтор после «нет связи» не создаёт второй запрос); после 2xx и неповторяемой ошибки 4xx ключ
// сбрасывается — повторный запрос того же водителя на тот же рейс (после «Отклонить») идёт с новым ключом и не получает
// сохранённый ответ первого (backend `internal/platform/idem` хранит ответ 7 суток). Тот же ключ остаётся после ответов,
// которые backend не сохраняет (`retryable` idem.go): «нет связи», 5xx, 429, повторяемые 409 `resources_unavailable`,
// `idempotency_in_progress`.
import { type components, ProblemError } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { idemKeys } from './api.ts';

type S = components['schemas'];

const BODY = { driverMemberId: 'm-1', tripId: 't-1', reason: 'Запрос на рейс Р-211' };

const problem = (status: number, code: S['Problem']['code'], retryable?: boolean): ProblemError =>
  new ProblemError(status, {
    type: 'about:blank',
    title: code,
    status,
    code,
    requestId: 'req-1',
    ...(retryable === undefined ? {} : { retryable }),
  });

describe('idemKeys «Запросить водителя»', () => {
  it('то же тело до ответа — тот же ключ; другое тело — другой ключ', () => {
    const keys = idemKeys();
    const a = keys.of(BODY);
    expect(keys.of({ ...BODY })).toBe(a);
    expect(keys.of({ ...BODY, reason: 'Нужен на вечер' })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('после успеха — новый ключ того же тела', () => {
    const keys = idemKeys();
    const a = keys.of(BODY);
    keys.settle(BODY);
    expect(keys.of(BODY)).not.toBe(a);
  });

  it.each([
    ['409 invalid_transition', problem(409, 'invalid_transition', false)],
    ['422 validation_failed', problem(422, 'validation_failed')],
    ['404 not_found', problem(404, 'not_found')],
    ['403 forbidden_action', problem(403, 'forbidden_action')],
  ])('после окончательной ошибки %s — новый ключ', (_, e) => {
    const keys = idemKeys();
    const a = keys.of(BODY);
    keys.settle(BODY, e);
    expect(keys.of(BODY)).not.toBe(a);
  });

  it.each([
    ['нет связи', new TypeError('Failed to fetch')],
    ['500', new ProblemError(500)],
    ['503 dependency_unavailable', problem(503, 'dependency_unavailable', true)],
    ['429 rate_limited', problem(429, 'rate_limited', true)],
    ['409 resources_unavailable', problem(409, 'resources_unavailable', true)],
    ['409 idempotency_in_progress', problem(409, 'idempotency_in_progress')],
  ])('после повторяемого ответа (%s) — тот же ключ', (_, e) => {
    const keys = idemKeys();
    const a = keys.of(BODY);
    keys.settle(BODY, e);
    expect(keys.of(BODY)).toBe(a);
  });

  it('сброс ключа одного тела не меняет ключ другого', () => {
    const keys = idemKeys();
    const other = { ...BODY, tripId: 't-2' };
    const b = keys.of(other);
    keys.of(BODY);
    keys.settle(BODY);
    expect(keys.of(other)).toBe(b);
  });
});
