// backup-service-seed-v1
// Portable fixture format: named objects (tables/collections), records, refs
// (how rows connect) and rules (what is allowed without a parent, uniqueness).
// Parsing and integrity live here so simulate/apply and unit tests share one path.

import { ENGINES, engineInfo, isSqlEngine } from './engines.js';
import { topoSortTables } from './adapters/sqlsafe.js';

export const SEED_FORMAT = 'backup-service-seed-v1';
export const SEED_ENGINES = [...Object.keys(ENGINES), 'any'];
export const CARDINALITIES = ['one-to-one', 'one-to-many', 'many-to-one', 'many-to-many'];
export const ON_MISSING = ['error', 'skip', 'null'];
export const WIPE_MODES = ['none', 'seeded'];

const MAX_OBJECTS = 80;
const MAX_RECORDS_PER_OBJECT = 5_000;
const MAX_TOTAL_RECORDS = 20_000;

export function familyOf(engine) {
  if (!engine || engine === 'any') return 'any';
  return engine === 'mariadb' ? 'mysql' : engine;
}

export function enginesCompatible(seedEngine, targetEngine) {
  if (!seedEngine || seedEngine === 'any') return true;
  return familyOf(seedEngine) === familyOf(targetEngine);
}

export function getPath(obj, path) {
  if (!path) return undefined;
  if (obj && Object.prototype.hasOwnProperty.call(obj, path)) return obj[path];
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

export function setPath(obj, path, value) {
  const parts = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function issue(level, code, message, extra = {}) {
  return { level, code, message, ...extra };
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function strList(value, { min = 0, max = 32 } = {}) {
  const list = asArray(value)
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  if (list.length < min) return list;
  return list.slice(0, max);
}

function pkValue(record, pk) {
  if (!pk.length) return undefined;
  if (pk.length === 1) return getPath(record, pk[0]);
  return JSON.stringify(pk.map((k) => getPath(record, k)));
}

export function inferColumns(records, pk = []) {
  const pkSet = new Set(pk);
  const seen = new Map();
  for (const rec of records || []) {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    for (const [name, value] of Object.entries(rec)) {
      if (name.includes('.')) continue;
      if (!seen.has(name)) {
        seen.set(name, { name, types: new Set(), nullable: false, pk: pkSet.has(name) });
      }
      const col = seen.get(name);
      if (value == null) col.nullable = true;
      else col.types.add(jsType(value));
    }
  }
  return [...seen.values()].map((c) => ({
    name: c.name,
    type: [...c.types][0] || 'string',
    types: [...c.types],
    nullable: c.nullable || !pkSet.has(c.name),
    pk: c.pk,
    required: pkSet.has(c.name),
  }));
}

function jsType(value) {
  if (value == null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  if (typeof value === 'object') {
    if ('$oid' in value) return 'objectId';
    if ('$date' in value) return 'date';
    if ('$binary' in value) return 'binary';
    if ('$bigint' in value) return 'bigint';
    return 'object';
  }
  return 'string';
}

function normalizeRef(raw, objectName) {
  if (!raw || typeof raw !== 'object') return null;
  const field = String(raw.field || raw.from || '').trim();
  const target = String(raw.target || raw.to || '').trim();
  if (!field || !target) return null;
  const cardinality = CARDINALITIES.includes(raw.cardinality) ? raw.cardinality : 'many-to-one';
  const onMissing = ON_MISSING.includes(raw.onMissing) ? raw.onMissing : raw.required === false ? 'null' : 'error';
  return {
    field,
    target,
    targetField: String(raw.targetField || raw.toField || (raw.target === objectName ? field : '_id')).trim() || '_id',
    required: raw.required !== false && onMissing === 'error',
    onMissing,
    cardinality,
    note: raw.note ? String(raw.note).slice(0, 400) : '',
  };
}

function normalizeObject(raw, index) {
  const name = String(raw?.name || '').trim();
  const records = Array.isArray(raw?.records) ? raw.records.filter((r) => r && typeof r === 'object' && !Array.isArray(r)) : [];
  const pk = strList(raw?.pk || raw?.primaryKey, { max: 8 });
  const refs = asArray(raw?.refs || raw?.relations)
    .map((r) => normalizeRef(r, name))
    .filter(Boolean);
  const rulesRaw = raw?.rules && typeof raw.rules === 'object' ? raw.rules : {};
  const columns = Array.isArray(raw?.columns)
    ? raw.columns
        .filter((c) => c && c.name)
        .map((c) => ({
          name: String(c.name).trim(),
          type: String(c.type || 'string').trim(),
          nullable: c.nullable !== false && !c.pk && !c.required,
          pk: Boolean(c.pk),
          required: Boolean(c.required || c.pk),
        }))
    : inferColumns(records, pk);
  const kind = raw?.kind === 'table' || raw?.kind === 'collection' ? raw.kind : null;
  return {
    name,
    kind,
    pk: pk.length ? pk : columns.filter((c) => c.pk).map((c) => c.name),
    columns,
    records,
    refs,
    rules: {
      required: strList(rulesRaw.required, { max: 32 }),
      unique: strList(rulesRaw.unique, { max: 16 }),
      allowOrphan: Boolean(rulesRaw.allowOrphan),
    },
    note: raw?.note ? String(raw.note).slice(0, 800) : '',
    _index: index,
  };
}

export function parseSeed(input) {
  let raw = input;
  if (typeof input === 'string') {
    const trimmed = input.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new Error('Seed is not valid JSON');
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Seed must be a JSON object');
  }
  const objectsIn = Array.isArray(raw.objects) ? raw.objects : Array.isArray(raw.collections) ? raw.collections : Array.isArray(raw.tables) ? raw.tables : [];
  const objects = objectsIn.map(normalizeObject);
  const engine = SEED_ENGINES.includes(raw.engine) ? raw.engine : raw.engine ? String(raw.engine) : 'any';
  const order = Array.isArray(raw.order) ? raw.order.map((n) => String(n).trim()).filter(Boolean) : [];
  return {
    format: String(raw.format || '').trim() || SEED_FORMAT,
    version: Number(raw.version) || 1,
    name: String(raw.name || 'Untitled seed').trim().slice(0, 120),
    description: String(raw.description || '').trim().slice(0, 2000),
    engine,
    notes: String(raw.notes || '').trim().slice(0, 4000),
    objects,
    order: order.length ? order : insertOrder(objects, order),
    wipe: WIPE_MODES.includes(raw.wipe?.strategy) ? raw.wipe.strategy : raw.wipe === true ? 'seeded' : 'none',
  };
}

export function insertOrder(objects, preferred = []) {
  const names = objects.map((o) => o.name);
  const relations = objects.flatMap((o) => o.refs.filter((r) => r.target !== o.name).map((r) => ({ from: o.name, to: r.target })));
  const sorted = topoSortTables(objects, relations);
  if (!preferred.length) return sorted;
  const set = new Set(names);
  const out = [];
  for (const n of preferred) if (set.has(n) && !out.includes(n)) out.push(n);
  for (const n of sorted) if (!out.includes(n)) out.push(n);
  return out;
}

export function indexByPk(object) {
  const map = new Map();
  const pk = object.pk.length ? object.pk : [];
  object.records.forEach((rec, i) => {
    const key = pk.length ? pkValue(rec, pk) : undefined;
    if (key === undefined || key === null || key === '') return;
    const k = typeof key === 'object' ? JSON.stringify(key) : String(key);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(i);
  });
  return map;
}

export function checkIntegrity(seed) {
  const issues = [];
  const byName = new Map(seed.objects.map((o) => [o.name, o]));
  const indexes = new Map(seed.objects.map((o) => [o.name, indexByPk(o)]));

  for (const obj of seed.objects) {
    const pk = obj.pk;
    if (!pk.length) {
      issues.push(issue('warn', 'no_pk', `${obj.name} has no primary key. Duplicate detection and live lookups will be weaker.`, { object: obj.name }));
    }

    const pkIndex = indexes.get(obj.name);
    for (const [key, rows] of pkIndex) {
      if (rows.length > 1) {
        issues.push(issue('error', 'duplicate_pk', `${obj.name} has ${rows.length} records with primary key ${key}.`, { object: obj.name, key }));
      }
    }

    for (const field of obj.rules.required) {
      obj.records.forEach((rec, i) => {
        const v = getPath(rec, field);
        if (v == null || v === '') {
          issues.push(issue('error', 'required_missing', `${obj.name}[${i}] is missing required field "${field}".`, { object: obj.name, index: i, field }));
        }
      });
    }

    for (const field of obj.rules.unique) {
      const seen = new Map();
      obj.records.forEach((rec, i) => {
        const v = getPath(rec, field);
        if (v == null || v === '') return;
        const k = typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (seen.has(k)) {
          issues.push(issue('error', 'unique_violation', `${obj.name} unique field "${field}" repeats value ${k} (rows ${seen.get(k)} and ${i}).`, { object: obj.name, field, key: k }));
        } else seen.set(k, i);
      });
    }

    for (const ref of obj.refs) {
      const target = byName.get(ref.target);
      if (!target) {
        issues.push(issue('error', 'missing_target', `${obj.name}.${ref.field} points at "${ref.target}", which is not in this seed.`, { object: obj.name, ref }));
        continue;
      }
      const targetIndex = indexes.get(ref.target);
      const targetPk = target.pk[0] || ref.targetField;
      obj.records.forEach((rec, i) => {
        const value = getPath(rec, ref.field);
        const empty = value == null || value === '';
        if (empty) {
          if (ref.required || (ref.onMissing === 'error' && !obj.rules.allowOrphan)) {
            issues.push(
              issue('error', 'orphan_required', `${obj.name}[${i}] has no ${ref.field}; this ${obj.name} cannot exist without a ${ref.target} (${ref.note || 'required connection'}).`, {
                object: obj.name,
                index: i,
                field: ref.field,
                target: ref.target,
              }),
            );
          } else if (!obj.rules.allowOrphan && ref.onMissing !== 'null' && ref.onMissing !== 'skip') {
            issues.push(
              issue('warn', 'orphan_optional', `${obj.name}[${i}] has no ${ref.field}. allowOrphan is off; simulation will still pass because the ref is optional.`, {
                object: obj.name,
                index: i,
                field: ref.field,
                target: ref.target,
              }),
            );
          }
          return;
        }
        const key = typeof value === 'object' ? JSON.stringify(value?.$oid || value) : String(value);
        const hit = targetIndex.get(key) || targetIndex.get(String(value?.$oid || ''));
        if (!hit) {
          const level = ref.onMissing === 'error' ? 'error' : 'warn';
          const action = ref.onMissing === 'skip' ? 'this row will be skipped' : ref.onMissing === 'null' ? 'the link will be stored as null' : 'apply will be blocked';
          issues.push(
            issue(level, 'ref_missing', `${obj.name}[${i}].${ref.field}=${key} has no matching ${ref.target}.${ref.targetField || targetPk}. ${action}.`, {
              object: obj.name,
              index: i,
              field: ref.field,
              target: ref.target,
              key,
            }),
          );
        }
      });
    }
  }

  return issues;
}

export function validateSeed(input) {
  const issues = [];
  let seed;
  try {
    seed = parseSeed(input);
  } catch (err) {
    return { ok: false, seed: null, issues: [issue('error', 'parse', err.message)] };
  }

  if (seed.format !== SEED_FORMAT) {
    issues.push(issue('error', 'format', `Expected format "${SEED_FORMAT}", got "${seed.format || '(missing)'}".`));
  }
  if (!SEED_ENGINES.includes(seed.engine) && seed.engine !== 'any') {
    issues.push(issue('error', 'engine', `Unknown engine "${seed.engine}". Use one of: ${SEED_ENGINES.join(', ')}.`));
  }
  if (!seed.objects.length) {
    issues.push(issue('error', 'empty', 'Seed has no objects (tables/collections).'));
  }
  if (seed.objects.length > MAX_OBJECTS) {
    issues.push(issue('error', 'too_many_objects', `At most ${MAX_OBJECTS} objects per seed.`));
  }

  const names = new Set();
  let total = 0;
  for (const obj of seed.objects) {
    if (!obj.name) {
      issues.push(issue('error', 'unnamed', `Object at index ${obj._index} is missing a name.`));
      continue;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_.$]*$/.test(obj.name.replace(/\./g, '_'))) {
      issues.push(issue('error', 'bad_name', `"${obj.name}" is not a safe table/collection name.`, { object: obj.name }));
    }
    if (names.has(obj.name)) {
      issues.push(issue('error', 'duplicate_object', `Object "${obj.name}" is declared twice.`));
    }
    names.add(obj.name);
    if (obj.records.length > MAX_RECORDS_PER_OBJECT) {
      issues.push(issue('error', 'too_many_records', `${obj.name} has ${obj.records.length} records (max ${MAX_RECORDS_PER_OBJECT}).`, { object: obj.name }));
    }
    total += obj.records.length;
    if (!obj.records.length) {
      issues.push(issue('warn', 'empty_object', `${obj.name} has no records.`, { object: obj.name }));
    }
  }
  if (total > MAX_TOTAL_RECORDS) {
    issues.push(issue('error', 'too_many_total', `Seed has ${total} records (max ${MAX_TOTAL_RECORDS}).`));
  }

  issues.push(...checkIntegrity(seed));
  seed.order = insertOrder(seed.objects, seed.order);

  const errors = issues.filter((i) => i.level === 'error');
  return {
    ok: errors.length === 0,
    seed,
    issues,
    stats: {
      objects: seed.objects.length,
      records: total,
      refs: seed.objects.reduce((s, o) => s + o.refs.length, 0),
      engine: seed.engine,
    },
  };
}

export function summarizeSeed(seed) {
  if (!seed) return null;
  const records = seed.objects.reduce((s, o) => s + (o.records?.length || 0), 0);
  return {
    name: seed.name,
    description: seed.description,
    engine: seed.engine,
    objectCount: seed.objects.length,
    recordCount: records,
    objects: seed.objects.map((o) => ({
      name: o.name,
      kind: o.kind,
      pk: o.pk,
      records: o.records.length,
      refs: o.refs.map((r) => ({
        field: r.field,
        target: r.target,
        required: r.required,
        onMissing: r.onMissing,
        cardinality: r.cardinality,
        note: r.note,
      })),
      rules: o.rules,
      columns: o.columns.map((c) => c.name),
    })),
    order: seed.order || insertOrder(seed.objects),
  };
}

export function liveNameCandidates(seedName, engine) {
  const names = [seedName];
  if (engine === 'postgres' && !seedName.includes('.')) names.push(`public.${seedName}`);
  if (engine === 'mssql' && !seedName.includes('.')) names.push(`dbo.${seedName}`);
  if (seedName.startsWith('public.')) names.push(seedName.slice(7));
  if (seedName.startsWith('dbo.')) names.push(seedName.slice(4));
  return [...new Set(names)];
}

export function matchLiveName(seedName, liveNames, engine) {
  const candidates = liveNameCandidates(seedName, engine);
  for (const c of candidates) {
    const hit = liveNames.find((n) => n === c);
    if (hit) return hit;
  }
  const lower = candidates.map((c) => c.toLowerCase());
  return liveNames.find((n) => lower.includes(n.toLowerCase())) || null;
}

export function exampleSeed() {
  return {
    format: SEED_FORMAT,
    version: 1,
    name: 'Users and observations',
    description: 'Minimal demo: users must exist before observations. An observation cannot be created without a user.',
    engine: 'any',
    objects: [
      {
        name: 'users',
        kind: 'collection',
        pk: ['_id'],
        columns: [
          { name: '_id', type: 'string', pk: true },
          { name: 'email', type: 'string', required: true },
          { name: 'name', type: 'string' },
        ],
        rules: { required: ['email'], unique: ['email'], allowOrphan: false },
        records: [
          { _id: 'user_ada', email: 'ada@example.com', name: 'Ada Lovelace' },
          { _id: 'user_grace', email: 'grace@example.com', name: 'Grace Hopper' },
        ],
        refs: [],
        note: 'Root entity. No parent required.',
      },
      {
        name: 'observations',
        kind: 'collection',
        pk: ['_id'],
        columns: [
          { name: '_id', type: 'string', pk: true },
          { name: 'userId', type: 'string', required: true },
          { name: 'type', type: 'string', required: true },
          { name: 'value', type: 'number' },
        ],
        rules: { required: ['type'], unique: [], allowOrphan: false },
        refs: [
          {
            field: 'userId',
            target: 'users',
            targetField: '_id',
            required: true,
            onMissing: 'error',
            cardinality: 'many-to-one',
            note: 'An observation cannot exist without a user.',
          },
        ],
        records: [
          { _id: 'obs_1', userId: 'user_ada', type: 'heart_rate', value: 72 },
          { _id: 'obs_2', userId: 'user_grace', type: 'temperature', value: 36.6 },
        ],
        note: 'Child of users. Insert after users.',
      },
    ],
  };
}

export function engineHint(engine) {
  const info = engine === 'any' ? { label: 'any engine', objectLabel: 'object', objectPlural: 'objects' } : engineInfo(engine);
  return {
    engine,
    label: info.label || 'any engine',
    sql: engine !== 'any' && isSqlEngine(engine),
    objectLabel: info.objectLabel || 'object',
    objectPlural: info.objectPlural || 'objects',
  };
}
