import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exampleSeed, insertOrder, parseSeed } from '../src/core/seed-format.js';
import * as sqlite from '../src/core/adapters/sqlite.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-seed-'));
const file = path.join(dir, 'seed.sqlite');
const conn = { id: 'seed-test', uri: `sqlite:${file}` };

describe('sqlite seed apply', () => {
  before(() => {
    fs.writeFileSync(file, '');
  });

  after(() => {
    sqlite.close(conn.id).catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reports file privileges', async () => {
    const perms = await sqlite.permissions(conn);
    assert.equal(perms.canRead, true);
    assert.equal(perms.canWrite, true);
    assert.equal(perms.user, 'local-file');
  });

  it('creates tables, inserts in order, and looks up keys', async () => {
    const seed = parseSeed(exampleSeed());
    seed.order = insertOrder(seed.objects, seed.order);
    for (const obj of seed.objects) {
      await sqlite.seedEnsure(conn, 'main', obj);
    }
    for (const name of seed.order) {
      const obj = seed.objects.find((o) => o.name === name);
      const result = await sqlite.seedInsert(conn, 'main', obj.name, obj.records);
      assert.equal(result.inserted, obj.records.length);
    }
    await sqlite.close(conn.id);
    const users = await sqlite.lookupKeys(conn, 'main', 'users', '_id', ['user_ada', 'nope']);
    assert.ok(users.includes('user_ada'));
    assert.ok(!users.includes('nope'));
    const described = await sqlite.describe(conn, 'main', 'observations');
    assert.ok(described.columns.some((c) => c.name === 'userId'));
  });

  it('wipes listed objects then re-inserts', async () => {
    const wiped = await sqlite.seedWipe(conn, 'main', ['observations', 'users']);
    assert.equal(wiped.find((w) => w.name === 'users').deleted, 2);
    const again = await sqlite.seedInsert(conn, 'main', 'users', [{ _id: 'user_ada', email: 'ada@example.com', name: 'Ada' }]);
    assert.equal(again.inserted, 1);
  });
});
