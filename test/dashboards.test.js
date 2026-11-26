import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWidget, toNumber } from '../src/core/dashboards.js';
import { coerceQueryText, validateReadOnlyQuery } from '../src/core/ai.js';

test('normalizeWidget fills chart metadata and keeps unknown types as tables', () => {
  const w = normalizeWidget(
    {
      type: 'stacked',
      title: 'Status mix',
      query: 'SELECT status, COUNT(*) AS n FROM t GROUP BY status',
      seriesKeys: ['n', 'other'],
      span: 'full',
      format: 'percent',
    },
    3,
  );
  assert.equal(w.id, 'w4');
  assert.equal(w.type, 'stacked');
  assert.equal(w.span, 'full');
  assert.deepEqual(w.seriesKeys, ['n', 'other']);
  assert.equal(w.format, 'percent');
  const fallback = normalizeWidget({ type: 'heatmap', title: 'Nope' });
  assert.equal(fallback.type, 'table');
});

test('note and pipeline widgets may omit a query', () => {
  const note = normalizeWidget({ type: 'note', title: 'Caveat', note: 'Grain is per tenant-day.' });
  assert.equal(note.type, 'note');
  assert.equal(note.query, '');
  assert.match(note.note, /tenant-day/);
  const pipe = normalizeWidget({ type: 'pipeline', title: 'Flow', steps: [{ object: 'users', role: 'source' }] });
  assert.equal(pipe.steps[0].object, 'users');
});

test('toNumber unwraps Mongo extended JSON numerics', () => {
  assert.equal(toNumber({ $numberInt: '42' }), 42);
  assert.equal(toNumber({ $numberDouble: '1.5' }), 1.5);
  assert.equal(toNumber('9'), 9);
  assert.equal(toNumber('nope'), null);
});

test('validateReadOnlyQuery accepts SELECT and Mongo pipelines, rejects writes', () => {
  const sql = validateReadOnlyQuery('SELECT id, name FROM users LIMIT 20', false);
  assert.match(sql, /SELECT/i);
  const mongo = validateReadOnlyQuery(
    { collection: 'observations', pipeline: [{ $group: { _id: '$status', n: { $sum: 1 } } }, { $limit: 20 }] },
    true,
  );
  assert.match(mongo, /"collection": "observations"/);
  assert.throws(() => validateReadOnlyQuery('INSERT INTO users (name) VALUES (\'x\')', false));
  assert.throws(() => validateReadOnlyQuery({ collection: 'users', pipeline: [{ $out: 'dump' }] }, true));
});

test('coerceQueryText stringifies object queries', () => {
  assert.equal(coerceQueryText(null), '');
  assert.match(coerceQueryText({ collection: 'users', filter: {} }), /collection/);
});
