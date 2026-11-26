import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeSchemaRules,
  mergeFindings,
  normalizeSchema,
  schemaFromGraph,
} from '../src/core/schema-format.js';

test('normalizeSchema fills the portable format and drops broken relations', () => {
  const s = normalizeSchema({
    engine: 'mongodb',
    name: 'BBS',
    objects: [
      { name: 'users', columns: [{ name: '_id', pk: true, type: 'objectId' }] },
      { name: 'obs', columns: [{ name: 'userId', type: 'objectId', fk: true }] },
    ],
    relations: [
      { from: 'obs', fromColumn: 'userId', to: 'users', toColumn: '_id' },
      { from: '', to: 'nope' },
    ],
  });
  assert.equal(s.format, 'backup-service-schema-v1');
  assert.equal(s.objects.length, 2);
  assert.equal(s.relations.length, 1);
  assert.equal(s.objects[0].kind, 'collection');
});

test('SQL tables without a primary key are errors; missing parents are errors', () => {
  const s = normalizeSchema({
    engine: 'postgres',
    objects: [{ name: 'orders', columns: [{ name: 'user_id', type: 'uuid' }] }],
    relations: [{ from: 'orders', fromColumn: 'user_id', to: 'users', toColumn: 'id' }],
  });
  const kinds = new Set(analyzeSchemaRules(s).map((f) => f.kind));
  assert.ok(kinds.has('no-pk'));
  assert.ok(kinds.has('missing-to'));
  assert.equal(analyzeSchemaRules(s).find((f) => f.kind === 'no-pk').severity, 'error');
});

test('Mongo drafts without _id are warnings, not hard errors', () => {
  const s = normalizeSchema({
    engine: 'mongodb',
    objects: [{ name: 'users', columns: [{ name: 'email', type: 'string' }] }],
  });
  const pk = analyzeSchemaRules(s).find((f) => f.kind === 'no-pk');
  assert.equal(pk.severity, 'warn');
});

test('live missing FK index is an error on large SQL tables', () => {
  const s = normalizeSchema({
    engine: 'mysql',
    objects: [
      { name: 'users', columns: [{ name: 'id', type: 'int', pk: true }] },
      {
        name: 'orders',
        columns: [
          { name: 'id', pk: true, type: 'int' },
          { name: 'user_id', type: 'int', fk: true },
        ],
        rows: 80_000,
      },
    ],
    relations: [{ from: 'orders', fromColumn: 'user_id', to: 'users', toColumn: 'id' }],
  });
  const findings = analyzeSchemaRules(s, {
    details: {
      orders: {
        estimatedCount: 80_000,
        indexes: [{ name: 'PRIMARY', primary: true, definition: '(id)' }],
        primaryKey: ['id'],
      },
    },
  });
  const hit = findings.find((f) => f.kind === 'missing-fk-index');
  assert.ok(hit);
  assert.equal(hit.severity, 'error');
  assert.equal(hit.object, 'orders');
  assert.equal(hit.column, 'user_id');
});

test('schemaFromGraph maps Mongo inferred edges onto the canvas', () => {
  const schema = schemaFromGraph(
    {
      tables: [
        { name: 'users', type: 'collection', columns: [{ name: '_id', pk: true, type: 'objectId' }] },
        { name: 'obs', type: 'collection', columns: [{ name: 'userId', fk: true, type: 'objectId' }] },
      ],
      relations: [{ from: 'obs', fromColumn: 'userId', to: 'users', toColumn: '_id', inferred: true }],
    },
    { engine: 'mongodb' },
  );
  assert.equal(schema.engine, 'mongodb');
  assert.equal(schema.objects[0].kind, 'collection');
  const findings = analyzeSchemaRules(schema);
  assert.ok(findings.some((f) => f.kind === 'inferred-relation' && f.object === 'obs'));
});

test('mergeFindings keeps the first severity and paints on object+column', () => {
  const merged = mergeFindings(
    [{ kind: 'no-pk', object: 't', title: 'a', severity: 'error' }],
    [{ kind: 'no-pk', object: 't', title: 'b', severity: 'warn', source: 'ai' }],
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].severity, 'error');
  assert.equal(merged[0].source, 'rules');
});

test('required relation cycles are errors on every engine', () => {
  const s = normalizeSchema({
    engine: 'sqlite',
    objects: [
      { name: 'a', columns: [{ name: 'id', pk: true }, { name: 'b_id', fk: true }] },
      { name: 'b', columns: [{ name: 'id', pk: true }, { name: 'a_id', fk: true }] },
    ],
    relations: [
      { from: 'a', fromColumn: 'b_id', to: 'b', toColumn: 'id', required: true },
      { from: 'b', fromColumn: 'a_id', to: 'a', toColumn: 'id', required: true },
    ],
  });
  assert.ok(analyzeSchemaRules(s).some((f) => f.kind === 'required-cycle'));
});
