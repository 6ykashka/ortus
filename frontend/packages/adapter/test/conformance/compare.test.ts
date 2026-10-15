// Сверка и пересъёмка примеров (W0.13, PD-43): новые UUID ответа сопоставляются с UUID примера по порядку
// появления — при сверке (prepare) и при записи снимка (snapshot: в пример идут id карты seed-ids).
import { describe, expect, it } from 'vitest';

import { example } from '../../src/msw/contract/index.ts';
import { prepare, snapshot } from './compare.ts';

const role = example('createRole', 'ok') as { id: string; name: string };
const NEW = '0f0f0f0f-0000-5000-8000-000000000001';

describe('сверка с примером', () => {
  it('новый UUID ответа совпадает с UUID нового объекта примера', () => {
    const { expected, actual } = prepare(role, { ...role, id: NEW });
    expect(actual).toEqual(expected);
  });

  it('другое значение поля — расхождение', () => {
    const { expected, actual } = prepare(role, { ...role, id: NEW, name: 'Логист' });
    expect(actual).not.toEqual(expected);
  });
});

describe('снимок для примера', () => {
  it('новые UUID ответа заменяются UUID примера, остальное — как в ответе', () => {
    const shot = snapshot(role, { ...role, id: NEW, name: 'Диспетчер смены' }) as typeof role;
    expect(shot).toEqual({ ...role, name: 'Диспетчер смены' });
  });

  it('UUID внутри строк заменяются так же', () => {
    const ex = { id: role.id, url: `https://x.invalid/${role.id}` };
    expect(snapshot(ex, { id: NEW, url: `https://x.invalid/${NEW}` })).toEqual(ex);
  });
});
