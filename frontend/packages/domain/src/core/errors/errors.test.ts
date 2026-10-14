import { describe, expect, it } from 'vitest';
import {
  ApiError,
  CANON_CODES,
  CLIENT_CODES,
  PROTOTYPE_CODES,
  denyAccess,
  isModuleStyleOp,
  toCanonCode,
  toCanonCodes,
  toPrototypeCode,
  type CanonCode,
} from './index.ts';

describe('коды ошибок: прототип и канон', () => {
  it('18 кодов прототипа — набор 14.10 тот же, что 03.10', () => {
    expect([...PROTOTYPE_CODES].sort()).toEqual(
      [
        'conflict',
        'driver_block',
        'forbidden',
        'incompatible',
        'last_owner',
        'module_off',
        'module_readonly',
        'no_permission',
        'no_scope',
        'not_found',
        'offline',
        'quota_exceeded',
        'role_conflict',
        'seats_exhausted',
        'subscription_restricted',
        'transition',
        'upload_failed',
        'validation',
      ].sort(),
    );
  });

  it('канонические коды — реестр 12 v0.2 (с кодами чатов) + коды 17/D-34, у каждого HTTP-статус', () => {
    expect(CANON_CODES.forbidden_action).toBe(403);
    expect(CANON_CODES.not_found).toBe(404);
    expect(CANON_CODES.invalid_transition).toBe(409);
    expect(CANON_CODES.revision_mismatch).toBe(412);
    expect(CANON_CODES.validation_failed).toBe(422);
    expect(CANON_CODES.seats_exhausted).toBe(409);
    expect(CANON_CODES.request_pending).toBe(409);
    expect(CANON_CODES.tier_below_usage).toBe(422);
    expect(CANON_CODES.chat_on_hold).toBe(409);
    expect(CANON_CODES.not_implemented).toBe(501);
    expect(Object.keys(CANON_CODES)).toHaveLength(52);
    expect([...CLIENT_CODES]).toEqual(['offline', 'timeout', 'upload_failed']);
  });

  it('каждый канонический и клиентский код отображается ровно в один код адаптера', () => {
    for (const c of [...(Object.keys(CANON_CODES) as CanonCode[]), ...CLIENT_CODES]) {
      expect(typeof toPrototypeCode(c)).toBe('string');
    }
  });

  it('каждый код прототипа имеет хотя бы один канонический', () => {
    for (const p of PROTOTYPE_CODES) expect(toCanonCodes(p).length).toBeGreaterThan(0);
  });
});

describe('карта канон → прототип', () => {
  it.each([
    ['tenant_read_only', 'subscription_restricted'],
    ['tenant_suspended', 'subscription_restricted'],
    ['module_not_installed', 'module_off'],
    ['module_read_only', 'module_readonly'],
    ['function_blocked', 'driver_block'],
    ['not_found', 'not_found'],
    ['reservation_overlap', 'conflict'],
    ['resources_unavailable', 'conflict'],
    ['revision_mismatch', 'conflict'],
    ['vehicle_incompatible', 'incompatible'],
    ['separation_of_duties_conflict', 'role_conflict'],
    ['last_owner_required', 'last_owner'],
    ['validation_failed', 'validation'],
    ['odometer_decrease', 'validation'],
    ['amount_invalid', 'validation'],
    ['inspection_incomplete', 'validation'],
    ['photo_not_ready', 'validation'],
    ['tier_below_usage', 'validation'],
    ['quota_exceeded', 'quota_exceeded'],
    ['seats_exhausted', 'seats_exhausted'],
    ['request_pending', 'conflict'],
    ['chat_content_forbidden', 'forbidden'],
    ['not_implemented', 'not_implemented'],
    ['session_expired', 'session_expired'],
    ['offline', 'offline'],
    ['timeout', 'offline'],
    ['upload_failed', 'upload_failed'],
  ] as const)('%s → %s', (canon, proto) => {
    expect(toPrototypeCode(canon)).toBe(proto);
  });

  it('forbidden_action: ядро → no_permission, модули и проекты задач → forbidden', () => {
    expect(toPrototypeCode('forbidden_action')).toBe('no_permission');
    expect(toPrototypeCode('forbidden_action', { op: 'publishForm' })).toBe('no_permission');
    expect(toPrototypeCode('forbidden_action', { op: 'createKbPage' })).toBe('no_permission');
    for (const op of [
      'createProject',
      'setTaskField',
      'saveRole',
      'svcReply',
      'kbPublish',
      'docRouteStart',
      'chatSend',
      'cashPost',
    ]) {
      expect(toPrototypeCode('forbidden_action', { op })).toBe('forbidden');
    }
  });

  it('invalid_transition: переходы процесса → transition, остальное → conflict', () => {
    expect(toPrototypeCode('invalid_transition')).toBe('conflict');
    expect(toPrototypeCode('invalid_transition', { op: 'reviewTrip' })).toBe('conflict');
    for (const op of ['moveTask', 'runTransition', 'rejectApproval', 'svcTransition']) {
      expect(toPrototypeCode('invalid_transition', { op })).toBe('transition');
    }
  });

  it('isModuleStyleOp различает префиксы модулей', () => {
    expect(isModuleStyleOp('kbCreateSpace')).toBe(true);
    expect(isModuleStyleOp('chatTick')).toBe(true);
    expect(isModuleStyleOp('kbx')).toBe(false);
    expect(isModuleStyleOp('reserve')).toBe(false);
    expect(isModuleStyleOp(undefined)).toBe(false);
  });
});

describe('карта прототип → канон', () => {
  it.each([
    ['no_permission', 'forbidden_action'],
    ['forbidden', 'forbidden_action'],
    ['no_scope', 'not_found'],
    ['not_found', 'not_found'],
    ['transition', 'invalid_transition'],
    ['subscription_restricted', 'tenant_read_only'],
    ['module_off', 'module_not_installed'],
    ['module_readonly', 'module_read_only'],
    ['driver_block', 'function_blocked'],
    ['validation', 'validation_failed'],
    ['incompatible', 'vehicle_incompatible'],
    ['role_conflict', 'separation_of_duties_conflict'],
    ['last_owner', 'last_owner_required'],
    ['seats_exhausted', 'seats_exhausted'],
    ['quota_exceeded', 'quota_exceeded'],
    ['offline', 'offline'],
    ['upload_failed', 'upload_failed'],
    ['conflict', 'invalid_transition'],
  ] as const)('%s → %s', (proto, canon) => {
    expect(toCanonCode(proto)).toBe(canon);
  });

  it('conflict уточняется операцией (09 §5.3)', () => {
    expect(toCanonCode('conflict', { op: 'reserve' })).toBe('reservation_overlap');
    expect(toCanonCode('conflict', { op: 'assignVehicle' })).toBe('reservation_overlap');
    expect(toCanonCode('conflict', { op: 'moveBooking' })).toBe('resources_unavailable');
    expect(toCanonCode('conflict', { op: 'saveKbPage' })).toBe('revision_mismatch');
    expect(toCanonCode('conflict', { op: 'requestSeats' })).toBe('request_pending');
    expect(toCanonCode('conflict', { op: 'reviewTrip' })).toBe('invalid_transition');
  });

  it('toCanonCodes перечисляет все канонические варианты', () => {
    expect(toCanonCodes('subscription_restricted')).toEqual(
      expect.arrayContaining(['tenant_read_only', 'tenant_suspended', 'feature_requires_plan']),
    );
    expect(toCanonCodes('conflict')).toEqual(
      expect.arrayContaining(['invalid_transition', 'reservation_overlap', 'revision_mismatch']),
    );
    expect(toCanonCodes('no_scope')).toEqual(['not_found']);
  });
});

describe('ApiError и политика forbidden/not_found', () => {
  it('ApiError — Error с кодом и дополнительными полями', () => {
    const e = new ApiError('conflict', 'Машину только что забронировали', { vehicleId: 'v1' });
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ApiError');
    expect(e.code).toBe('conflict');
    expect(e.message).toBe('Машину только что забронировали');
    expect(e.vehicleId).toBe('v1');
    expect(new ApiError('validation', 'x').db).toBeUndefined();
  });

  it('невидимый объект → not_found, видимый без права → forbidden', () => {
    const hidden = denyAccess(false, 'Нет права «Правит»', 'Документ не найден');
    expect(hidden.code).toBe('not_found');
    expect(hidden.message).toBe('Документ не найден');
    const seen = denyAccess(true, 'Нет права «Правит»', 'Документ не найден');
    expect(seen.code).toBe('forbidden');
    expect(seen.message).toBe('Нет права «Правит»');
    expect(denyAccess(false, 'x').message).toBe('Не найдено');
  });
});
