// Экспорт-лист модуля «Чаты» (`modules/chats/index.ts`). Интегратор подключает его одной строкой в
// `modules/index.ts`; имена (значения и типы) не пересекаются с общим барелем и с экспортом «Базы
// знаний» W4.30 и «Форм» W4.20. Расширяется добавлением.
import { describe, expect, it } from 'vitest';
import { exportedNames } from '../knowledge/exports.test-util.ts';

const at = (file: string): URL => new URL(file, import.meta.url);

const CHATS_EXPORTS = [
  // модуль, сид, проекция
  'chatsModule',
  'chatsHook',
  'chatsSeed',
  'installChats',
  'chatsView',
  // справочники
  'CHAT_KINDS',
  'CHAT_ROLE_LABEL',
  'CHAT_ROLES',
  'CHAT_ROLE_ID',
  'CHAT_RANK',
  'CHAT_BOUNDS',
  'CHAT_DEFAULT_POLICY',
  'CHAT_EDIT_LABEL',
  'CHAT_EDIT_MIN',
  'CHAT_RCPT_LABEL',
  'CHAT_TEMP_LABEL',
  'CHAT_FWD_LABEL',
  'CHAT_FULL_LABEL',
  'CHAT_FULL_HINT',
  'CHAT_FULL_MODES_MVP',
  // время демо
  'chatTsDay',
  'chatTsTime',
  'chatTsLabel',
  // состав и права
  'chatAccess',
  'chatRights',
  'chatPeople',
  'chatMatrix',
  'chatTitle',
  'chatVerbs',
  'chatPolicyOf',
  'chatSrcHas',
  'chatSrcLabel',
  'chatSrcIcon',
  // место и удержание
  'chatPlanStorage',
  'chatCleanupPlan',
  'chatHeldMsg',
  'CHAT_ALL_RE',
  // команды
  'chatsCommands',
  'CHAT_METHODS',
  'CHAT_DELAYS',
];

describe('экспорт-лист modules/chats', () => {
  it('модуль и его функции, ничего лишнего', async () => {
    const pkg = await import('./index.ts');
    expect(Object.keys(pkg).sort()).toEqual([...CHATS_EXPORTS].sort());
  });

  it('значения не пересекаются с @ortus/domain/modules', async () => {
    const [pkg, modules] = await Promise.all([import('./index.ts'), import('../index.ts')]);
    const own = pkg as Record<string, unknown>;
    const taken = modules as Record<string, unknown>;
    expect(Object.keys(own).filter((k) => k in taken && taken[k] !== own[k])).toEqual([]);
  });

  it('имена типов и значений не пересекаются с барелем модулей', async () => {
    const [chats, barrel] = await Promise.all([
      exportedNames(at('./index.ts')),
      exportedNames(at('../index.ts'), ['./chats/index.ts']),
    ]);
    expect(chats).toEqual(expect.arrayContaining(CHATS_EXPORTS));
    expect(chats.filter((n) => barrel.includes(n))).toEqual([]);
  });

  it('типы публичного API перечислены', async () => {
    const names = await exportedNames(at('./index.ts'));
    for (const t of [
      'Chat',
      'ChatMessage',
      'ChatPolicy',
      'ChatsSlice',
      'ChatsTenantDb',
      'ChatsView',
      'ChatView',
      'MessageView',
      'ChatsApi',
      'ChatSendSpec',
      'ChatSpec',
      'ChatPoll',
    ]) {
      expect(names).toContain(t);
    }
  });
});
