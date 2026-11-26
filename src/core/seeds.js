import { newId } from './crypto.js';
import { engineInfo } from './engines.js';
import { resolveConnection } from './adapters/index.js';
import { addWriteAudit, getConnection } from './store.js';
import { logLine } from './log.js';
import {
  enginesCompatible,
  getPath,
  insertOrder,
  liveNameCandidates,
  matchLiveName,
  parseSeed,
  summarizeSeed,
  validateSeed,
} from './seed-format.js';

function issue(level, code, message, extra = {}) {
  return { level, code, message, ...extra };
}

function keyString(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    if (value.$oid) return String(value.$oid);
    return JSON.stringify(value);
  }
  return String(value);
}

export function publicSeed(row) {
  if (!row) return null;
  const summary = summarizeSeed(row.payload);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    engine: row.engine,
    notes: row.notes || '',
    objectCount: summary?.objectCount || 0,
    recordCount: summary?.recordCount || 0,
    objects: summary?.objects || [],
    order: summary?.order || [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSimulatedAt: row.lastSimulatedAt || null,
    lastAppliedAt: row.lastAppliedAt || null,
    bindings: Array.isArray(row.bindings) ? row.bindings : [],
  };
}

export function fullSeed(row) {
  if (!row) return null;
  return { ...publicSeed(row), payload: row.payload };
}

async function liveLookup(adapter, conn, database, liveName, field, values) {
  if (typeof adapter.lookupKeys !== 'function') return [];
  try {
    return await adapter.lookupKeys(conn, database, liveName, field, values);
  } catch {
    return null;
  }
}

export async function simulateSeed({ payload, connectionId, database, wipe = false, createMissing = true }) {
  const checked = validateSeed(payload);
  const issues = [...checked.issues];
  if (!checked.ok || !checked.seed) {
    return {
      ok: false,
      canApply: false,
      seed: checked.seed ? summarizeSeed(checked.seed) : null,
      issues,
      objects: [],
      permissions: null,
      target: null,
      wipe: Boolean(wipe),
      createMissing: Boolean(createMissing),
    };
  }

  const seed = checked.seed;
  const connPublic = getConnection(connectionId);
  if (!connPublic) throw new Error('Connection not found');
  if (!enginesCompatible(seed.engine, connPublic.engine)) {
    issues.push(
      issue(
        'error',
        'engine_mismatch',
        `This seed is for ${engineInfo(seed.engine).label}. Pick a ${engineInfo(seed.engine).label} connection (or set engine to "any").`,
      ),
    );
  }

  const { conn, adapter, info } = resolveConnection(connectionId);
  const targetDb = database || (connPublic.engine === 'sqlite' ? 'main' : '');
  if (!targetDb) throw new Error('Pick a database to seed into');

  let permissions = null;
  try {
    permissions = await adapter.permissions(conn, targetDb);
  } catch (err) {
    issues.push(issue('warn', 'permissions_failed', `Could not read user privileges: ${err.message}`));
  }

  if (permissions?.canWrite === false) {
    issues.push(issue('error', 'no_write', `User ${permissions.user || ''} cannot INSERT on this connection.`, { user: permissions.user }));
  }
  if (wipe && permissions?.canWrite === false) {
    issues.push(issue('error', 'no_wipe', 'Wipe needs DELETE on the listed objects.'));
  }

  let liveObjects = [];
  try {
    liveObjects = await adapter.listObjects(conn, targetDb);
  } catch (err) {
    issues.push(issue('error', 'list_failed', `Could not list ${info.objectPlural}: ${err.message}`));
  }
  const liveNames = (Array.isArray(liveObjects) ? liveObjects : []).map((o) => o.name);

  const order = insertOrder(seed.objects, seed.order);
  const objects = [];

  for (const name of order) {
    const obj = seed.objects.find((o) => o.name === name);
    if (!obj) continue;
    const liveName = matchLiveName(obj.name, liveNames, conn.engine);
    const live = liveName ? liveObjects.find((o) => o.name === liveName) : null;
    let described = null;
    if (liveName) {
      try {
        described = await adapter.describe(conn, targetDb, liveName);
      } catch (err) {
        issues.push(issue('warn', 'describe_failed', `Could not describe ${obj.name}: ${err.message}`, { object: obj.name }));
      }
    }

    const liveCols = new Set((described?.columns || []).map((c) => c.name));
    const missingColumns = (obj.columns || [])
      .map((c) => c.name)
      .filter((c) => c && !c.includes('.') && liveCols.size && !liveCols.has(c));
    const extraRequired = (described?.columns || []).filter((c) => c.pk && !c.nullable && obj.records.some((r) => getPath(r, c.name) == null && r[c.name] === undefined));

    if (!live) {
      if (createMissing) {
        issues.push(issue('warn', 'will_create', `${obj.name} does not exist on the target. Apply will CREATE it from the seed columns.`, { object: obj.name }));
      } else {
        issues.push(issue('error', 'missing_object', `${obj.name} is not on the target, and "create missing" is off.`, { object: obj.name }));
      }
    } else if (missingColumns.length) {
      issues.push(
        issue('error', 'missing_columns', `${obj.name} is missing columns on the target: ${missingColumns.join(', ')}.`, {
          object: obj.name,
          columns: missingColumns,
        }),
      );
    }

    for (const ref of obj.refs) {
      const parent = seed.objects.find((o) => o.name === ref.target);
      const parentLive = matchLiveName(ref.target, liveNames, conn.engine);
      const missingInSeed = [];
      obj.records.forEach((rec, i) => {
        const value = getPath(rec, ref.field);
        if (value == null || value === '') return;
        const key = keyString(value);
        const pk = parent?.pk?.[0] || ref.targetField;
        const hit = parent?.records?.some((p) => keyString(getPath(p, pk)) === key || keyString(p[ref.targetField]) === key);
        if (!hit) missingInSeed.push({ index: i, key });
      });
      if (missingInSeed.length && parentLive && typeof adapter.lookupKeys === 'function') {
        const found = await liveLookup(
          adapter,
          conn,
          targetDb,
          parentLive,
          ref.targetField || parent?.pk?.[0] || '_id',
          missingInSeed.map((m) => m.key),
        );
        if (found === null) {
          issues.push(issue('warn', 'live_lookup_failed', `Could not check existing ${ref.target} rows for ${obj.name}.${ref.field}.`, { object: obj.name }));
        } else {
          const foundSet = new Set(found.map(String));
          const still = missingInSeed.filter((m) => !foundSet.has(String(m.key)));
          for (const m of still) {
            const level = ref.onMissing === 'error' ? 'error' : 'warn';
            issues.push(
              issue(level, 'ref_missing_live', `${obj.name}[${m.index}].${ref.field}=${m.key} is not in this seed and not in target ${ref.target}.`, {
                object: obj.name,
                field: ref.field,
                target: ref.target,
                key: m.key,
              }),
            );
          }
        }
      } else if (missingInSeed.length && !parent) {
        issues.push(issue('error', 'missing_target', `${obj.name}.${ref.field} points at ${ref.target}, which is not in the seed.`, { object: obj.name }));
      }
    }

    objects.push({
      name: obj.name,
      liveName: liveName || obj.name,
      exists: Boolean(live),
      liveRows: live?.rows ?? described?.estimatedCount ?? 0,
      seedRecords: obj.records.length,
      willCreate: !live && createMissing,
      willWipe: Boolean(wipe) && Boolean(live),
      missingColumns,
      refs: obj.refs,
      rules: obj.rules,
      action: !live ? (createMissing ? 'create + insert' : 'blocked') : wipe ? 'wipe + insert' : 'insert',
    });
  }

  const errors = issues.filter((i) => i.level === 'error');
  return {
    ok: errors.length === 0,
    canApply: errors.length === 0,
    seed: summarizeSeed(seed),
    issues,
    objects,
    permissions,
    target: {
      connectionId,
      connectionName: conn.name,
      engine: conn.engine,
      database: targetDb,
      user: permissions?.user || null,
    },
    wipe: Boolean(wipe),
    createMissing: Boolean(createMissing),
    totals: {
      insert: seed.objects.reduce((s, o) => s + o.records.length, 0),
      wipe: wipe ? objects.reduce((s, o) => s + (o.willWipe ? o.liveRows : 0), 0) : 0,
    },
  };
}

export async function applySeed({ payload, connectionId, database, wipe = false, createMissing = true, confirm }) {
  const preview = await simulateSeed({ payload, connectionId, database, wipe, createMissing });
  if (!preview.canApply) {
    const first = preview.issues.find((i) => i.level === 'error');
    throw new Error(first?.message || 'Simulation found problems. Fix them before applying.');
  }
  if (String(confirm || '').trim() !== preview.target.database) {
    throw new Error(`Type the target database name (${preview.target.database}) to confirm`);
  }

  const seed = parseSeed(payload);
  const { conn, adapter } = resolveConnection(connectionId);
  const targetDb = preview.target.database;
  const order = insertOrder(seed.objects, seed.order);
  const started = Date.now();
  const results = [];

  if (wipe) {
    const reverse = [...order].reverse().map((name) => preview.objects.find((o) => o.name === name)?.liveName || name);
    const wiped = await adapter.seedWipe(conn, targetDb, reverse);
    results.push(...wiped.map((w) => ({ ...w, op: 'wipe' })));
  }

  for (const name of order) {
    const obj = seed.objects.find((o) => o.name === name);
    const plan = preview.objects.find((o) => o.name === name);
    if (!plan?.exists && createMissing) {
      await adapter.seedEnsure(conn, targetDb, { ...obj, name: plan.liveName || obj.name });
    }
    const skipped = [];
    const toInsert = [];
    for (let i = 0; i < obj.records.length; i += 1) {
      const rec = obj.records[i];
      let drop = false;
      const clone = structuredClone(rec);
      for (const ref of obj.refs) {
        const value = getPath(clone, ref.field);
        if (value == null || value === '') {
          if (ref.onMissing === 'skip') drop = true;
        }
      }
      const miss = preview.issues.filter((iss) => iss.object === obj.name && iss.index === i && iss.code === 'ref_missing' && iss.level !== 'error');
      if (miss.some((m) => obj.refs.find((r) => r.field === m.field)?.onMissing === 'skip')) drop = true;
      if (miss.some((m) => obj.refs.find((r) => r.field === m.field)?.onMissing === 'null')) {
        for (const m of miss) {
          const ref = obj.refs.find((r) => r.field === m.field);
          if (ref?.onMissing === 'null') clone[ref.field] = null;
        }
      }
      if (drop) skipped.push(i);
      else toInsert.push(clone);
    }
    const inserted = await adapter.seedInsert(conn, targetDb, plan.liveName || obj.name, toInsert);
    results.push({ name: obj.name, op: 'insert', inserted: inserted.inserted, skipped: skipped.length });
  }

  const inserted = results.filter((r) => r.op === 'insert').reduce((s, r) => s + (r.inserted || 0), 0);
  addWriteAudit({
    kind: 'seed',
    connectionId,
    connectionName: conn.name,
    engine: conn.engine,
    database: targetDb,
    objects: order,
    inserted,
    wipe: Boolean(wipe),
    seedName: seed.name,
    durationMs: Date.now() - started,
  });
  logLine('seed', `${seed.name} → ${conn.name}/${targetDb} inserted ${inserted}${wipe ? ' (wiped first)' : ''}`);

  return {
    ok: true,
    target: preview.target,
    results,
    inserted,
    durationMs: Date.now() - started,
    wipe: Boolean(wipe),
  };
}

export { liveNameCandidates };
