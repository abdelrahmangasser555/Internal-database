import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { MongoClient, ObjectId } from 'mongodb';
import { EJSON } from 'bson';
import {
  closeClient,
  collectionStats,
  findDocuments,
  getClient,
  listCollections,
  listDatabases as mongoDatabases,
  listIndexes,
  testUri,
} from '../mongo.js';
import { clampLimit } from './sqlsafe.js';
import { emptyPermission } from './seedwrite.js';

export const engine = 'mongodb';

const BLOCKED_STAGES = ['$out', '$merge'];
const BLOCKED_OPERATORS = ['$where', '$function', '$accumulator'];

export async function test(uri) {
  const started = Date.now();
  const result = await testUri(uri);
  return { ...result, latencyMs: Date.now() - started };
}

export async function listDatabases(conn) {
  return mongoDatabases(conn.id);
}

export async function listObjects(conn, db) {
  const client = await getClient(conn.id);
  const cols = await listCollections(conn.id, db);
  const withCounts = await Promise.all(
    cols.map(async (c) => {
      let rows = 0;
      try {
        rows = c.type === 'view' ? 0 : await client.db(db).collection(c.name).estimatedDocumentCount();
      } catch {
        rows = 0;
      }
      return { ...c, type: c.type === 'view' ? 'view' : 'collection', rows };
    }),
  );
  return withCounts;
}

function bsonType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (v instanceof Date) return 'date';
  if (v && typeof v === 'object') {
    if (v._bsontype) return v._bsontype === 'ObjectId' ? 'objectId' : v._bsontype.toLowerCase();
    return 'object';
  }
  return typeof v;
}

function inferFields(docs) {
  const fields = new Map();
  const visit = (doc, prefix, depth) => {
    for (const [k, v] of Object.entries(doc || {})) {
      const key = prefix ? `${prefix}.${k}` : k;
      const type = bsonType(v);
      if (!fields.has(key)) fields.set(key, { name: key, types: new Map(), count: 0, sample: null });
      const f = fields.get(key);
      f.count += 1;
      f.types.set(type, (f.types.get(type) || 0) + 1);
      if (f.sample == null && v != null && type !== 'object' && type !== 'array') f.sample = EJSON.serialize(v);
      if (type === 'object' && depth < 1) visit(v, key, depth + 1);
    }
  };
  docs.forEach((d) => visit(d, '', 0));
  return [...fields.values()].map((f) => ({
    name: f.name,
    type: [...f.types.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).join(' | '),
    presence: docs.length ? Math.round((f.count / docs.length) * 100) : 0,
    pk: f.name === '_id',
    nullable: f.count < docs.length || f.types.has('null'),
    sample: f.sample,
  }));
}

async function sample(client, db, name, size) {
  const col = client.db(db).collection(name);
  try {
    return await col.aggregate([{ $sample: { size } }], { maxTimeMS: 8000 }).toArray();
  } catch {
    return col.find({}).limit(size).toArray();
  }
}

export async function describe(conn, db, name) {
  const client = await getClient(conn.id);
  const [docs, indexes, stats] = await Promise.all([
    sample(client, db, name, 200),
    listIndexes(conn.id, db, name).catch(() => []),
    collectionStats(conn.id, db, name).catch(() => ({ estimatedCount: 0 })),
  ]);
  return {
    name,
    type: 'collection',
    columns: inferFields(docs),
    sampleSize: docs.length,
    primaryKey: ['_id'],
    foreignKeys: [],
    indexes: indexes.map((i) => ({
      name: i.name,
      unique: Boolean(i.unique),
      primary: i.name === '_id_',
      definition: JSON.stringify(i.key),
    })),
    estimatedCount: stats.estimatedCount,
  };
}

export async function rows(conn, db, name, { skip = 0, limit = 50, filter = {}, sort } = {}) {
  if (sort?.column) {
    const client = await getClient(conn.id);
    const col = client.db(db).collection(name);
    const safeLimit = clampLimit(limit, 50, 200);
    const safeSkip = Math.max(Number(skip) || 0, 0);
    const [docs, estimatedCount] = await Promise.all([
      col.find(filter || {}).sort({ [sort.column]: sort.dir === 'desc' ? -1 : 1 }).skip(safeSkip).limit(safeLimit).toArray(),
      col.estimatedDocumentCount(),
    ]);
    return { documents: docs.map((d) => EJSON.serialize(d)), skip: safeSkip, limit: safeLimit, estimatedCount };
  }
  return findDocuments(conn.id, db, name, { skip, limit, filter });
}

function assertNoWrites(value, where = 'query') {
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      for (const [k, inner] of Object.entries(v)) {
        if (BLOCKED_STAGES.includes(k)) throw new Error(`${k} writes data and is blocked in the read-only runner`);
        if (BLOCKED_OPERATORS.includes(k)) throw new Error(`${k} runs server-side JavaScript and is blocked`);
        walk(inner);
      }
    }
  };
  walk(value);
  return where;
}

/** Parse a read-only Mongo request: {collection, filter, projection, sort, limit} or {collection, pipeline}. */
export function parseMongoQuery(text) {
  let spec;
  try {
    spec = typeof text === 'string' ? EJSON.parse(text, { relaxed: true }) : text;
  } catch {
    throw new Error('Mongo queries are JSON, e.g. {"collection":"users","filter":{"active":true},"limit":20}');
  }
  if (!spec || typeof spec !== 'object' || !spec.collection) throw new Error('Add "collection" to the query');
  if (spec.pipeline && !Array.isArray(spec.pipeline)) throw new Error('"pipeline" must be an array');
  const allowed = new Set(['collection', 'filter', 'projection', 'sort', 'limit', 'skip', 'pipeline']);
  const extra = Object.keys(spec).find((k) => !allowed.has(k));
  if (extra) throw new Error(`Unsupported key "${extra}". Use filter/projection/sort/limit or pipeline.`);
  assertNoWrites(spec);
  return spec;
}

export async function query(conn, db, text, { limit = 500 } = {}) {
  const spec = parseMongoQuery(text);
  const cap = clampLimit(spec.limit || limit, 500, 5000);
  const started = Date.now();
  const client = await getClient(conn.id);
  const col = client.db(db).collection(spec.collection);
  let docs;
  if (spec.pipeline) {
    docs = await col.aggregate([...spec.pipeline, { $limit: cap + 1 }], { maxTimeMS: 30_000 }).toArray();
  } else {
    let cursor = col.find(spec.filter || {}, { maxTimeMS: 30_000 });
    if (spec.projection) cursor = cursor.project(spec.projection);
    if (spec.sort) cursor = cursor.sort(spec.sort);
    if (spec.skip) cursor = cursor.skip(Number(spec.skip) || 0);
    docs = await cursor.limit(cap + 1).toArray();
  }
  const truncated = docs.length > cap;
  return {
    kind: 'documents',
    documents: docs.slice(0, cap).map((d) => EJSON.serialize(d)),
    rowCount: Math.min(docs.length, cap),
    truncated,
    durationMs: Date.now() - started,
  };
}

function singular(name) {
  return String(name).toLowerCase().replace(/ies$/, 'y').replace(/s$/, '');
}

export async function graph(conn, db) {
  const client = await getClient(conn.id);
  const cols = (await listCollections(conn.id, db)).slice(0, 80);
  const tables = [];
  for (const c of cols) {
    const docs = c.type === 'view' ? [] : await sample(client, db, c.name, 40).catch(() => []);
    let rowsCount = 0;
    try {
      rowsCount = await client.db(db).collection(c.name).estimatedDocumentCount();
    } catch {
      rowsCount = 0;
    }
    tables.push({
      name: c.name,
      type: c.type === 'view' ? 'view' : 'collection',
      rows: rowsCount,
      columns: inferFields(docs).filter((f) => !f.name.includes('.')).slice(0, 40),
    });
  }
  // Inferred references: userId / user_id / user (ObjectId) → users._id
  const bySingular = new Map(tables.map((t) => [singular(t.name), t.name]));
  const relations = [];
  for (const t of tables) {
    for (const f of t.columns) {
      if (f.name === '_id' || !/objectId/.test(f.type)) continue;
      const base = singular(f.name.replace(/(_id|Id|_ids|Ids)$/, ''));
      const target = bySingular.get(base);
      if (target && target !== t.name) {
        f.fk = true;
        relations.push({ from: t.name, fromColumn: f.name, to: target, toColumn: '_id', inferred: true });
      }
    }
  }
  return { tables, relations, inferred: true };
}

export async function dump(conn, db, { objects, onProgress }, dir) {
  const client = new MongoClient(conn.uri, {
    maxPoolSize: 3,
    minPoolSize: 0,
    maxIdleTimeMS: 60_000,
    serverSelectionTimeoutMS: 12_000,
    connectTimeoutMS: 12_000,
    readPreference: 'secondaryPreferred',
    readConcern: { level: 'majority' },
  });
  await client.connect();
  try {
    const database = client.db(db);
    let names = objects;
    if (!names?.length) {
      names = (await database.listCollections({}, { nameOnly: true }).toArray())
        .map((col) => col.name)
        .filter((name) => !name.startsWith('system.'));
    }
    const summary = [];
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      onProgress?.({ collection: name, collectionsDone: i, collectionsTotal: names.length });
      const col = database.collection(name);
      const colDir = path.join(dir, 'collections', name);
      fs.mkdirSync(colDir, { recursive: true });
      const indexes = await col.indexes();
      fs.writeFileSync(path.join(colDir, 'indexes.json'), JSON.stringify(indexes, null, 2));
      const ws = fs.createWriteStream(path.join(colDir, 'documents.ndjson'));
      let count = 0;
      const cursor = col.find({}, { noCursorTimeout: false }).batchSize(500);
      for await (const doc of cursor) {
        if (!ws.write(`${EJSON.stringify(doc)}\n`)) await once(ws, 'drain');
        count += 1;
        if (count % 1000 === 0) {
          onProgress?.({ collection: name, collectionsDone: i, collectionsTotal: names.length, documents: count });
        }
      }
      ws.end();
      await finished(ws);
      summary.push({ name, count, indexes: indexes.length });
    }
    return { summary, hostname: os.hostname() };
  } finally {
    await client.close();
  }
}

export async function restoreCheck(conn, db, names) {
  const client = await getClient(conn.id);
  const existing = new Set((await client.db(db).listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  return Promise.all(
    names.map(async (name) => ({
      name,
      exists: existing.has(name),
      rows: existing.has(name) ? await client.db(db).collection(name).estimatedDocumentCount() : 0,
    })),
  );
}

/** Explicit write path: insert documents into empty target collections and rebuild indexes. */
export async function restore(conn, db, { names, readRows, readIndexes, onProgress }) {
  const client = new MongoClient(conn.uri, { serverSelectionTimeoutMS: 12_000, connectTimeoutMS: 12_000 });
  await client.connect();
  const results = [];
  try {
    const database = client.db(db);
    for (const name of names) {
      const col = database.collection(name);
      let batch = [];
      let inserted = 0;
      const flush = async () => {
        if (!batch.length) return;
        await col.insertMany(batch, { ordered: true });
        inserted += batch.length;
        batch = [];
        onProgress?.({ collection: name, documents: inserted });
      };
      for await (const doc of readRows(name)) {
        batch.push(doc);
        if (batch.length >= 1000) await flush();
      }
      await flush();
      if (!inserted) await database.createCollection(name).catch(() => {});
      const indexes = (await readIndexes?.(name)) || [];
      for (const idx of indexes) {
        if (idx.name === '_id_') continue;
        const { key, v, ns, ...opts } = idx;
        await col.createIndex(key, opts).catch(() => {});
      }
      results.push({ name, inserted, indexes: indexes.filter((i) => i.name !== '_id_').length });
    }
  } finally {
    await client.close();
  }
  return results;
}

export async function close(connectionId) {
  await closeClient(connectionId);
}

function mongoKey(value) {
  if (value && typeof value === 'object') {
    if (value.$oid) return String(value.$oid);
    if (value._bsontype === 'ObjectId') return String(value);
  }
  return value == null ? null : String(value);
}

function toMongoValue(value) {
  try {
    return EJSON.deserialize(value);
  } catch {
    return value;
  }
}

async function writeMongo(conn) {
  const client = new MongoClient(conn.uri, { serverSelectionTimeoutMS: 12_000, connectTimeoutMS: 12_000 });
  await client.connect();
  return client;
}

export async function permissions(conn, db) {
  const client = await getClient(conn.id);
  try {
    const status = await client.db(db || 'admin').command({ connectionStatus: 1, showPrivileges: true });
    const info = status.authInfo || {};
    const users = info.authenticatedUsers || [];
    const roles = (info.authenticatedUserRoles || []).map((r) => `${r.role}@${r.db}`);
    const privs = info.authenticatedUserPrivileges || [];
    const actions = new Set();
    for (const p of privs) for (const a of p.actions || []) actions.add(a);
    const roleBlob = roles.join(' ').toLowerCase();
    const has = (name) => actions.has(name) || /root|restore/.test(roleBlob);
    return {
      user: users.map((u) => `${u.user}@${u.db}`).join(', ') || 'authenticated',
      roles,
      canRead: has('find') || /read|readwrite|root|dbadmin/.test(roleBlob) || !roles.length,
      canWrite: has('insert') || /readwrite|root/.test(roleBlob),
      canCreate: has('createCollection') || has('insert') || /readwrite|root/.test(roleBlob),
      canDrop: has('dropCollection') || /root|dbadmin/.test(roleBlob),
      canAdmin: /root|useradmin|dbadmin/.test(roleBlob),
      privileges: [...actions].sort().slice(0, 48),
      details: privs.slice(0, 24).map((p) => ({
        resource: p.resource?.collection != null ? `${p.resource.db || '*'}.${p.resource.collection || '*'}` : JSON.stringify(p.resource || {}),
        actions: p.actions || [],
      })),
      notes: roles.length ? [] : ['Could not list roles; the user may lack connectionStatus privileges.'],
    };
  } catch (err) {
    return emptyPermission({ user: 'unknown', notes: [err.message] });
  }
}

export async function seedEnsure(conn, db, object) {
  const client = await writeMongo(conn);
  try {
    await client.db(db).createCollection(object.name).catch(() => {});
    return { name: object.name, created: true };
  } finally {
    await client.close();
  }
}

export async function seedWipe(conn, db, names) {
  const client = await writeMongo(conn);
  const out = [];
  try {
    const database = client.db(db);
    for (const name of names) {
      const result = await database.collection(name).deleteMany({});
      out.push({ name, deleted: result.deletedCount || 0 });
    }
    return out;
  } finally {
    await client.close();
  }
}

export async function seedInsert(conn, db, name, records) {
  if (!records?.length) return { name, inserted: 0 };
  const client = await writeMongo(conn);
  try {
    const docs = records.map((r) => toMongoValue(structuredClone(r)));
    const result = await client.db(db).collection(name).insertMany(docs, { ordered: true });
    return { name, inserted: result.insertedCount || docs.length };
  } finally {
    await client.close();
  }
}

function hostFromUri(uri) {
  try {
    const u = new URL(String(uri).replace(/^mongodb(\+srv)?:/i, 'https:'));
    return u.hostname || '';
  } catch {
    return '';
  }
}

export async function insight(conn, db) {
  const client = await getClient(conn.id);
  const admin = client.db('admin');
  const cmd = (spec) => admin.command(spec).catch(() => ({}));
  const [hello, build, host, status, listed] = await Promise.all([
    cmd({ hello: 1 }),
    cmd({ buildInfo: 1 }),
    cmd({ hostInfo: 1 }),
    cmd({ serverStatus: 1 }),
    client
      .db()
      .admin()
      .listDatabases()
      .catch(() => ({ databases: [] })),
  ]);
  const hostname = hello.me || status.host || hostFromUri(conn.uri);
  const atlas = /\.mongodb\.net$/i.test(hostname) || /mongodb\.net/i.test(hostFromUri(conn.uri));
  const tags = hello.tags || {};
  const topology = hello.msg === 'isdbgrid' || /shard/i.test(hostname) ? 'sharded' : hello.setName ? 'replicaSet' : 'standalone';
  const databases = (listed.databases || [])
    .filter((d) => d.name !== 'local')
    .map((d) => ({ name: d.name, sizeOnDisk: d.sizeOnDisk || 0, empty: Boolean(d.empty) }));
  const target = db || databases.find((d) => !['admin', 'config'].includes(d.name))?.name || databases[0]?.name || '';
  let objects = [];
  if (target) {
    try {
      objects = (await listObjects(conn, target)).slice(0, 40);
    } catch {
      objects = [];
    }
  }
  const members = (hello.hosts || (hostname ? [hostname] : [])).map((h) => ({
    host: h,
    me: h === hello.me,
    regionCode: h === hello.me ? tags.region || tags.availabilityZone || '' : '',
    provider: h === hello.me ? tags.provider || (atlas ? 'Atlas' : '') : '',
    nodeType: h === hello.me ? tags.nodeType || '' : '',
  }));
  const connections = status.connections || {};
  const opcounters = status.opcounters || {};
  const os = host.os || {};
  const extra = host.extra || {};
  return {
    version: build.version || status.version || hello.maxWireVersion || null,
    process: status.process || (topology === 'sharded' ? 'mongos' : 'mongod'),
    topology,
    replicaSet: hello.setName || status.repl?.setName || null,
    host: hostname,
    atlas,
    clusterName: atlas ? hostname.split('.')[0] : hostname.split('.')[0] || null,
    instanceType: tags.nodeType ? `Atlas ${String(tags.nodeType).toLowerCase().replace(/_/g, ' ')}` : atlas ? 'MongoDB Atlas' : topology,
    storageEngine: status.storageEngine?.name || null,
    os: { type: os.type || extra.kernelVersion || null, name: os.name || null, version: os.version || extra.osName || null },
    cpu: extra.cpuModelName || extra.cpuFrequencyMHz ? { model: extra.cpuModelName || null, mhz: extra.cpuFrequencyMHz || null, cores: extra.numCores || host.system?.numCores || null } : null,
    uptimeSec: status.uptime || null,
    connections: {
      current: connections.current ?? null,
      available: connections.available ?? null,
      max:
        connections.current != null && connections.available != null
          ? Number(connections.current) + Number(connections.available)
          : null,
      active: connections.active ?? null,
      totalCreated: connections.totalCreated ?? null,
    },
    ops: {
      query: opcounters.query ?? null,
      insert: opcounters.insert ?? null,
      update: opcounters.update ?? null,
      delete: opcounters.delete ?? null,
      getmore: opcounters.getmore ?? null,
      command: opcounters.command ?? null,
    },
    regionCode: tags.region || tags.availabilityZone || null,
    provider: tags.provider || (atlas ? 'MongoDB Atlas' : extra.cpuArch ? extra.cpuArch : null),
    databases,
    database: target,
    objects,
    dataSize: databases.reduce((s, d) => s + (d.sizeOnDisk || 0), 0),
    members,
    notes: [],
  };
}

export async function fetchOne(conn, db, name, { field, value }) {
  if (!field) throw new Error('field is required');
  const client = await getClient(conn.id);
  const col = client.db(db).collection(name);
  let queryValue = toMongoValue(value);
  if (field === '_id') {
    const raw = value && typeof value === 'object' && value.$oid ? value.$oid : typeof value === 'string' ? value : null;
    if (raw && /^[a-f0-9]{24}$/i.test(raw)) {
      try {
        queryValue = new ObjectId(raw);
      } catch {
        queryValue = raw;
      }
    }
  }
  const doc = await col.findOne({ [field]: queryValue }, { maxTimeMS: 10_000 });
  if (!doc) return { found: false, object: name, field };
  return { found: true, object: name, field, document: EJSON.serialize(doc) };
}

export async function lookupKeys(conn, db, name, field, values) {
  const list = [...new Set((values || []).map(mongoKey).filter((v) => v != null))].slice(0, 200);
  if (!list.length) return [];
  const client = await getClient(conn.id);
  const queryValues = list.map((v) => {
    if (field === '_id' && /^[a-f0-9]{24}$/i.test(v)) {
      try {
        return new ObjectId(v);
      } catch {
        return v;
      }
    }
    return v;
  });
  const docs = await client
    .db(db)
    .collection(name)
    .find({ [field]: { $in: queryValues } }, { projection: { [field]: 1 } })
    .limit(200)
    .toArray();
  return docs.map((d) => mongoKey(d[field] ?? d._id));
}
