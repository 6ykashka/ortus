// Справочники чатов и время демо (chats.js 14.10:7–63): значения дословно из эталона, отклонения
// по ответам владельца 17.10 (CHAT-02, CHAT-10) — явно (бриф W7.10 §10).
import { describe, expect, it } from 'vitest';
import {
  BOUNDS,
  CHAT_KINDS,
  CHAT_ROLE_LABEL,
  CHAT_ROLES,
  CHAT_ROLE_ID,
  DEFAULT_POLICY,
  EDIT_LABEL,
  EDIT_MIN,
  FULL_HINT,
  FULL_LABEL,
  FULL_MODES_MVP,
  FWD_LABEL,
  RANK,
  RCPT_LABEL,
  TEMP_LABEL,
} from './dictionaries.ts';
import { tsDay, tsLabel, tsTime } from './time.ts';

describe('время демо: минуты от 01.10.2026 00:00', () => {
  it.each([
    [0, '01.10', '00:00'],
    [-1, '30.09', '23:59'],
    [665, '01.10', '11:05'],
    [1440, '02.10', '00:00'],
    [-1440, '30.09', '00:00'],
    [31 * 1440, '01.11', '00:00'],
  ])('tsDay/tsTime(%i) = %s / %s', (ts, day, time) => {
    expect(tsDay(ts)).toBe(day);
    expect(tsTime(ts)).toBe(time);
  });

  it('tsLabel: тот же день — только время, другой — дата и время', () => {
    expect(tsLabel(600, 665)).toBe('10:00');
    expect(tsLabel(-420, 665)).toBe('30.09 17:00');
    expect(tsLabel(1500, 665)).toBe('02.10 01:00');
  });
});

describe('виды чатов и роли', () => {
  it('пять видов с подписями, иконками и папками', () => {
    expect(Object.keys(CHAT_KINDS)).toEqual(['direct', 'group', 'area', 'record', 'announce']);
    expect(CHAT_KINDS.direct).toEqual({
      label: 'Личные',
      one: 'Личный чат',
      icon: 'person',
      folder: 'direct',
    });
    expect(CHAT_KINDS.area.one).toBe('Чат по роли');
    expect(CHAT_KINDS.area.folder).toBe('group');
    expect(CHAT_KINDS.record).toMatchObject({ label: 'Чаты записей', icon: 'link' });
    expect(CHAT_KINDS.announce).toMatchObject({ label: 'Объявления', icon: 'campaign' });
  });

  it('роли в чате: подписи и ранги', () => {
    expect(CHAT_ROLE_LABEL).toEqual({
      owner: 'Владелец чата',
      moderator: 'Модератор',
      member: 'Участник',
      reader: 'Читатель',
    });
    expect(RANK).toEqual({ reader: 1, member: 2, moderator: 3, owner: 4 });
  });

  it('пять ролей чата с действиями модуля «Чаты»', () => {
    expect(CHAT_ROLES.map((r) => r.id)).toEqual([
      'r-chat-owner',
      'r-chat-mod',
      'r-chat-member',
      'r-chat-reader',
      'r-chat-creator',
    ]);
    expect(CHAT_ROLES.map((r) => r.actions.chat)).toEqual([
      ['view', 'create', 'review', 'settings'],
      ['view', 'create', 'review'],
      ['view', 'create'],
      ['view'],
      ['view', 'create', 'edit'],
    ]);
    expect(CHAT_ROLES.map((r) => r.chatRole)).toEqual([
      'owner',
      'moderator',
      'member',
      'reader',
      undefined,
    ]);
    expect(CHAT_ROLES.every((r) => r.kind === 'template' && !r.finance.read)).toBe(true);
    expect(CHAT_ROLE_ID).toEqual({
      owner: 'r-chat-owner',
      moderator: 'r-chat-mod',
      member: 'r-chat-member',
      reader: 'r-chat-reader',
    });
  });
});

describe('подписи политик', () => {
  it('правка, прочтение, временные, пересылка, заполнение', () => {
    expect(EDIT_LABEL).toEqual({ '15m': '15 минут', '48h': '48 часов', none: 'Без срока' });
    expect(EDIT_MIN).toEqual({ '15m': 15, '48h': 2880, none: Infinity });
    expect(RCPT_LABEL).toEqual({ off: 'Не показывать', ticks: 'Галочки', who: 'Кто и когда' });
    expect(TEMP_LABEL).toEqual({
      off: 'Запрещены',
      allowed: '1 час — 7 дней',
      viewonce: 'Одноразовые файлы · модераторы',
    });
    expect(FWD_LABEL).toEqual({
      free: 'Свободно',
      internal: 'Внутри организации',
      off: 'Запрещена',
    });
    expect(FULL_LABEL).toEqual({
      block: 'Запретить новые файлы',
      ring: 'Удалять старые вложения',
      archive: 'Переносить в архив',
      compress: 'Сжимать медиа',
    });
    expect(Object.keys(FULL_HINT)).toEqual(Object.keys(FULL_LABEL));
    expect(FULL_HINT.block).toBe(
      'Текст, опросы и подтверждения работают. Рабочие фото модулей уходят в резерв модуля.',
    );
  });

  it('Q-W7.10-3: в MVP интерфейса режим «архив» скрыт, справочник его хранит', () => {
    expect(FULL_MODES_MVP).toEqual(['block', 'ring', 'compress']);
  });
});

describe('пределы и политики видов', () => {
  it('BOUNDS эталона, кроме срока удалённых (CHAT-10: ровно 30 дней)', () => {
    expect(BOUNDS).toEqual({
      textY: [1, 5],
      filesD: [30, 1825],
      voiceD: [30, 1095],
      rcptD: [7, 90],
      delD: [30, 30],
      maxMb: [10, 2000],
    });
  });

  it('DEFAULT_POLICY: значения эталона, режим прочтения — CHAT-02 (ticks, у объявлений off)', () => {
    const base = {
      textY: 3,
      filesD: 365,
      voiceD: 90,
      rcptD: 30,
      delD: 30,
      edit: '48h',
      maxMb: 200,
      quotaMb: null,
      temp: 'off',
      fwd: 'internal',
      pdn: true,
      onFull: 'block',
    };
    expect(DEFAULT_POLICY.direct).toEqual({ ...base, rcpt: 'ticks', temp: 'allowed' });
    expect(DEFAULT_POLICY.group).toEqual({ ...base, rcpt: 'ticks', quotaMb: 5000 });
    expect(DEFAULT_POLICY.area).toEqual({ ...base, rcpt: 'ticks', maxMb: 100 });
    expect(DEFAULT_POLICY.record).toEqual({
      ...base,
      rcpt: 'ticks',
      maxMb: 500,
      quotaMb: 5000,
      temp: 'viewonce',
      afterClose: 3,
    });
    expect(DEFAULT_POLICY.announce).toEqual({ ...base, rcpt: 'off', textY: 5, maxMb: 50 });
  });

  it('все значения по умолчанию внутри пределов организации', () => {
    for (const p of Object.values(DEFAULT_POLICY)) {
      for (const [k, [a, b]] of Object.entries(BOUNDS)) {
        const v = p[k as keyof typeof BOUNDS];
        expect(v).toBeGreaterThanOrEqual(a);
        expect(v).toBeLessThanOrEqual(b);
      }
    }
  });
});
