import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SEED_FORMAT,
  checkIntegrity,
  enginesCompatible,
  exampleSeed,
  insertOrder,
  parseSeed,
  validateSeed,
} from '../src/core/seed-format.js';
import { listSkills, tallSkillPrompt } from '../src/core/seed-skills.js';

describe('seed format', () => {
  it('parses the example and reports a valid graph', () => {
    const result = validateSeed(exampleSeed());
    assert.equal(result.ok, true);
    assert.equal(result.seed.format, SEED_FORMAT);
    assert.deepEqual(result.seed.order, ['users', 'observations']);
    assert.equal(result.stats.records, 4);
  });

  it('rejects a missing format and empty objects', () => {
    const result = validateSeed({ name: 'x', objects: [] });
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.code === 'format' || i.code === 'empty'));
  });

  it('blocks an observation without a user when the ref is required', () => {
    const seed = exampleSeed();
    seed.objects[1].records.push({ _id: 'obs_orphan', type: 'bp', value: 1 });
    const issues = checkIntegrity(parseSeed(seed));
    assert.ok(issues.some((i) => i.code === 'orphan_required' && i.level === 'error'));
  });

  it('allows a missing parent when onMissing is null', () => {
    const seed = exampleSeed();
    seed.objects[1].refs[0].required = false;
    seed.objects[1].refs[0].onMissing = 'null';
    seed.objects[1].rules.allowOrphan = true;
    seed.objects[1].records.push({ _id: 'obs_free', type: 'note' });
    const result = validateSeed(seed);
    assert.equal(result.ok, true);
  });

  it('detects a dangling userId', () => {
    const seed = exampleSeed();
    seed.objects[1].records[0].userId = 'user_missing';
    const result = validateSeed(seed);
    assert.equal(result.ok, false);
    assert.ok(result.issues.some((i) => i.code === 'ref_missing'));
  });

  it('detects duplicate primary keys and unique emails', () => {
    const seed = exampleSeed();
    seed.objects[0].records.push({ _id: 'user_ada', email: 'other@example.com', name: 'Dup' });
    const result = validateSeed(seed);
    assert.ok(result.issues.some((i) => i.code === 'duplicate_pk'));
  });

  it('orders parents before children even if listed backwards', () => {
    const seed = parseSeed({
      format: SEED_FORMAT,
      engine: 'any',
      objects: [
        {
          name: 'observations',
          pk: ['_id'],
          records: [{ _id: 'o1', userId: 'u1' }],
          refs: [{ field: 'userId', target: 'users', targetField: '_id', required: true }],
        },
        { name: 'users', pk: ['_id'], records: [{ _id: 'u1' }] },
      ],
    });
    assert.deepEqual(insertOrder(seed.objects), ['users', 'observations']);
  });

  it('treats any as compatible with every engine', () => {
    assert.equal(enginesCompatible('any', 'postgres'), true);
    assert.equal(enginesCompatible('mysql', 'mariadb'), true);
    assert.equal(enginesCompatible('mongodb', 'postgres'), false);
  });

  it('parses JSON strings and rejects garbage', () => {
    assert.throws(() => parseSeed('not json'), /not valid JSON/);
    const seed = parseSeed(JSON.stringify(exampleSeed()));
    assert.equal(seed.objects.length, 2);
  });
});

describe('seed skills', () => {
  it('exposes a tall prompt and one skill per engine', () => {
    const skills = listSkills();
    assert.ok(tallSkillPrompt().includes(SEED_FORMAT));
    assert.ok(skills.some((s) => s.id === 'tall'));
    for (const engine of ['mongodb', 'postgres', 'mysql', 'mariadb', 'sqlite', 'mssql']) {
      const skill = skills.find((s) => s.id === engine);
      assert.ok(skill, engine);
      assert.ok(skill.prompt.includes(SEED_FORMAT));
      assert.ok(skill.prompt.includes(`"engine": "${engine}"`));
    }
  });
});
