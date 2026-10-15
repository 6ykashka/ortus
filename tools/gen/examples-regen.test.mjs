// W1.00 · П-15 критики этапа 0: генераторы примеров стюарда (examples-seed.mjs, examples-stage1.mjs)
// выдают те же файлы, что лежат в api/openapi/examples, — пересборка их не меняет. membershipId — UUID
// членства control DB `membership:<организация>:<аккаунт>` (Go-сид W0.06, MSW W0.13), userId оператора —
// accounts.id его аккаунта `account:op-1` (стенд W0.09, dev-вход), а не id записи platform_operators.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, it } from 'node:test';
import { renderExamples } from './examples-seed.mjs';
import { seedUuid } from './lib/examples.mjs';
import { EXAMPLES_DIR, ROOT, SEED_IDS_PATH } from './lib/paths.mjs';

const rel = (p) => relative(ROOT, p).replaceAll('\\', '/');
const onDisk = () => {
  const out = [SEED_IDS_PATH];
  for (const d of readdirSync(EXAMPLES_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    for (const f of readdirSync(join(EXAMPLES_DIR, d.name))) {
      if (f.endsWith('.json')) out.push(join(EXAMPLES_DIR, d.name, f));
    }
  }
  return out;
};
const { files } = await renderExamples();
const json = (op, name) => JSON.parse(files.get(join(EXAMPLES_DIR, op, `${name}.json`)));
const membership = (t, acc) => seedUuid('platform', `membership:${t}:${acc}`);

describe('пересборка примеров (П-15)', () => {
  it('генератор выдаёт ровно файлы api/openapi/examples, байт в байт', () => {
    const generated = [...files.keys()].map(rel).sort();
    assert.deepEqual(generated, onDisk().map(rel).sort());
    const changed = [...files]
      .filter(([p, text]) => !existsSync(p) || readFileSync(p, 'utf8') !== text)
      .map(([p]) => rel(p));
    assert.deepEqual(changed, []);
  });

  it('membershipId — членство control DB membership:<организация>:<аккаунт>', () => {
    const want = {
      owner: [['t-alta', 'acc-1']],
      manager: [['t-alta', 'acc-2']],
      driver: [['t-alta', 'acc-3']],
      therapist: [
        ['t-alta', 'acc-4'],
        ['t-lotos', 'acc-4'],
      ],
      foreman: [
        ['t-alta', 'acc-5'],
        ['t-remstroy', 'acc-5'],
      ],
      'owner-lotos': [['t-lotos', 'acc-11']],
    };
    for (const [persona, list] of Object.entries(want)) {
      const got = json('getMyContext', persona).tenants.map((t) => t.membershipId);
      assert.deepEqual(
        got,
        list.map(([t, a]) => membership(t, a)),
        persona,
      );
    }
    assert.deepEqual(
      json('selectTenant', 'ok').tenants.map((t) => t.membershipId),
      [membership('t-alta', 'acc-4'), membership('t-lotos', 'acc-4')],
    );
    assert.equal(json('acceptInvitation', 'ok').membershipId, membership('t-alta', 'acc-6'));
  });

  it('userId оператора — accounts.id аккаунта account:op-1', () => {
    assert.equal(json('getMyContext', 'operator').userId, seedUuid('platform', 'account:op-1'));
  });
});
