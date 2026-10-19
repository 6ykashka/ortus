// Тег Files, контракт 0.4.0-stage1 (W1.00, S1-21): список файлов «Файлы» с родительским объектом.
// Родитель и purpose — из сессии загрузки файла. В режиме mock видимость родителя не моделируется: список
// отдаётся участнику с files.read во всей организации (владелец), остальным — пустой (сервер фильтрует по
// доступу к родителю до пагинации; файл невидимого родителя просто отсутствует). Исключение — W2.57 (AC-06):
// файлы рейса перевода, закрытого участнику пулом, в список не попадают (poolClosed).
import type { components } from '@ortus/api-client';

import { fileDto } from '../core/dto.ts';
import { page } from '../core/page.ts';
import { fail } from '../core/problem.ts';
import type { Registry } from '../core/registry.ts';
import { unitsWith } from '../access/rules.ts';
import { poolClosed } from './index.ts';

type S = components['schemas'];

const STATUSES = new Set(['pending_upload', 'quarantined', 'ready', 'rejected']);
const PURPOSES = new Set([
  'inspection',
  'expense_receipt',
  'knowledge_attachment',
  'form_attachment',
  'repair_evidence',
  // W4.02 (0.7.0-stage4): вложения задач.
  'task_attachment',
]);

export const filesListHandlers: Registry = {
  listFiles: (ctx) => {
    const status = ctx.query.get('status');
    const purpose = ctx.query.get('purpose');
    if (status !== null && !STATUSES.has(status)) fail('malformed_request');
    if (purpose !== null && !PURPOSES.has(purpose)) fail('malformed_request');
    const { org } = ctx.org();
    if (unitsWith(ctx, 'files.read') !== 'all') return { body: page([], ctx.query) };
    const items: S['FileListItem'][] = [];
    for (const f of [...org.files].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))) {
      const u = org.uploads.find((x) => x.fileId === f.id);
      if (!u) continue;
      if (status !== null && f.status !== status) continue;
      if (purpose !== null && u.purpose !== purpose) continue;
      if (poolClosed(ctx, u.owner, 'files.read')) continue;
      items.push({ file: fileDto(f), purpose: u.purpose, owner: { ...u.owner } });
    }
    return { body: page(items, ctx.query) };
  },
};
