import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRotationAudit, formatRotationAudit } from '../src/core/rotate.js';

const rows = [
  {
    at: '2026-11-20T10:00:00.000Z',
    userId: '1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    username: 'ada',
    database: 'app',
    collection: 'users',
    connectionName: 'Local',
    previousPassword: null,
    password: 'ada-old',
  },
  {
    at: '2026-11-25T10:00:00.000Z',
    userId: '1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    username: 'ada',
    database: 'app',
    collection: 'users',
    connectionName: 'Local',
    previousPassword: 'ada-old',
    password: 'ada-final',
  },
  {
    at: '2026-11-25T11:00:00.000Z',
    userId: '2',
    name: 'Grace Hopper',
    email: 'grace@example.com',
    username: 'grace',
    database: 'app',
    collection: 'users',
    connectionName: 'Local',
    previousPassword: null,
    password: 'grace-final',
  },
];

test('filterRotationAudit matches a user and a date window', () => {
  const found = filterRotationAudit(rows, { q: 'ada', from: '2026-11-24', to: '2026-11-26' });
  assert.equal(found.length, 1);
  assert.equal(found[0].password, 'ada-final');
});

test('formatRotationAudit lists the latest password and the previous one', () => {
  const text = formatRotationAudit(filterRotationAudit(rows, { q: 'ada' }));
  assert.match(text, /final: ada-final/);
  assert.match(text, /Previous password: ada-old/);
  assert.match(text, /New password: ada-final/);
  assert.doesNotMatch(text, /grace-final/);
});

test('filterRotationAudit unique keeps one latest row per user', () => {
  const found = filterRotationAudit(rows, { unique: '1' });
  assert.equal(found.length, 2);
  assert.equal(found.find((r) => r.userId === '1').password, 'ada-final');
});

test('filterRotationAudit scopes to a database', () => {
  const extra = [...rows, { ...rows[2], userId: '3', database: 'other', email: 'other@example.com', password: 'x' }];
  const found = filterRotationAudit(extra, { database: 'app', unique: true });
  assert.equal(found.length, 2);
  assert.equal(
    found.some((r) => r.database === 'other'),
    false,
  );
});
