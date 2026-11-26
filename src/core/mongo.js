import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';
import { getConnection } from './store.js';

const clients = new Map();

const POOL = {
  // Desktop admin tool: few concurrent operations, keep the server footprint small.
  maxPoolSize: 5,
  minPoolSize: 0,
  maxIdleTimeMS: 60_000,
  serverSelectionTimeoutMS: 8_000,
  connectTimeoutMS: 10_000,
};

function browseOptions(uri) {
  return {
    ...POOL,
    readPreference: 'secondaryPreferred',
    readConcern: { level: 'majority' },
    uri,
  };
}

export async function getClient(connectionId) {
  const cached = clients.get(connectionId);
  if (cached) return cached;
  const conn = getConnection(connectionId, { includeUri: true });
  if (!conn?.uri) throw new Error('Connection not found');
  const client = new MongoClient(conn.uri, {
    maxPoolSize: POOL.maxPoolSize,
    minPoolSize: POOL.minPoolSize,
    maxIdleTimeMS: POOL.maxIdleTimeMS,
    serverSelectionTimeoutMS: POOL.serverSelectionTimeoutMS,
    connectTimeoutMS: POOL.connectTimeoutMS,
    readPreference: 'secondaryPreferred',
  });
  await client.connect();
  clients.set(connectionId, client);
  return client;
}

export async function testUri(uri) {
  const client = new MongoClient(uri, {
    maxPoolSize: 1,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8_000,
    connectTimeoutMS: 10_000,
    readPreference: 'secondaryPreferred',
  });
  try {
    await client.connect();
    const admin = client.db('admin');
    const info = await admin.command({ ping: 1 });
    const build = await admin.command({ buildInfo: 1 }).catch(() => ({}));
    return {
      ok: info?.ok === 1,
      version: build.version || null,
    };
  } finally {
    await client.close();
  }
}

export async function listDatabases(connectionId) {
  const client = await getClient(connectionId);
  const { databases } = await client.db().admin().listDatabases();
  return databases
    .filter((db) => !['local'].includes(db.name))
    .map((db) => ({
      name: db.name,
      sizeOnDisk: db.sizeOnDisk || 0,
      empty: Boolean(db.empty),
    }));
}

export async function listCollections(connectionId, dbName) {
  const client = await getClient(connectionId);
  const cols = await client.db(dbName).listCollections({}, { nameOnly: false }).toArray();
  return cols
    .filter((col) => !col.name.startsWith('system.'))
    .map((col) => ({
      name: col.name,
      type: col.type || 'collection',
    }));
}

export async function collectionStats(connectionId, dbName, colName) {
  const client = await getClient(connectionId);
  const col = client.db(dbName).collection(colName);
  const estimated = await col.estimatedDocumentCount();
  return { estimatedCount: estimated };
}

export async function findDocuments(connectionId, dbName, colName, { skip = 0, limit = 50, filter = {} } = {}) {
  const client = await getClient(connectionId);
  const col = client.db(dbName).collection(colName);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const safeSkip = Math.max(Number(skip) || 0, 0);
  let parsedFilter = {};
  if (filter && typeof filter === 'object') parsedFilter = filter;
  const [docs, estimatedCount] = await Promise.all([
    col
      .find(parsedFilter)
      .skip(safeSkip)
      .limit(safeLimit)
      .toArray(),
    col.estimatedDocumentCount(),
  ]);
  return {
    documents: docs.map((doc) => EJSON.serialize(doc)),
    skip: safeSkip,
    limit: safeLimit,
    estimatedCount,
  };
}

export async function listIndexes(connectionId, dbName, colName) {
  const client = await getClient(connectionId);
  return client.db(dbName).collection(colName).indexes();
}

export async function sampleUsers(connectionId, dbName, colName, { skip = 0, limit = 200, search = '' } = {}) {
  const client = await getClient(connectionId);
  const col = client.db(dbName).collection(colName);
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 200);
  const safeSkip = Math.max(Number(skip) || 0, 0);
  const query = search
    ? {
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { username: { $regex: search, $options: 'i' } },
        ],
      }
    : {};
  const [docs, total] = await Promise.all([
    col.find(query).project({ password: 0 }).skip(safeSkip).limit(safeLimit).toArray(),
    col.countDocuments(query),
  ]);
  return {
    documents: docs.map((doc) => EJSON.serialize(doc)),
    skip: safeSkip,
    limit: safeLimit,
    total,
  };
}

export async function closeClient(connectionId) {
  const client = clients.get(connectionId);
  if (client) {
    await client.close();
    clients.delete(connectionId);
  }
}

export async function closeAllClients() {
  await Promise.all([...clients.values()].map((client) => client.close().catch(() => {})));
  clients.clear();
}

export { browseOptions };
