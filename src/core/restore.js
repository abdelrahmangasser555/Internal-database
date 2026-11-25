import { getRecord } from './store.js';
import { openArchive } from './archive.js';
import { passphraseFor } from './backup.js';
import { resolveConnection } from './adapters/index.js';
import { engineInfo } from './engines.js';
import { logLine } from './log.js';
import { addWriteAudit } from './store.js';

// Restore is an explicit write path, like Rotate. It never overwrites data:
// every target table/collection must be missing or empty, and the caller must
// confirm by typing the target database name.

function compatible(sourceEngine, targetEngine) {
  const family = (e) => (e === 'mariadb' ? 'mysql' : e);
  return family(sourceEngine || 'mongodb') === family(targetEngine || 'mongodb');
}

async function load(recordId, passphrase) {
  const record = getRecord(recordId);
  if (!record) throw new Error('Record not found');
  const archive = await openArchive(record.filePath, passphraseFor(record, passphrase));
  return { record, archive };
}

export async function previewRestore({ recordId, connectionId, database, objects, passphrase }) {
  const { record, archive } = await load(recordId, passphrase);
  try {
    const { conn, adapter } = resolveConnection(connectionId);
    const sourceEngine = archive.engine;
    if (!compatible(sourceEngine, conn.engine)) {
      throw new Error(`This is a ${engineInfo(sourceEngine).label} backup. Pick a ${engineInfo(sourceEngine).label} connection to restore it.`);
    }
    const all = (archive.metadata.collections || []).map((c) => ({ name: c.name, count: c.count }));
    const chosen = objects?.length ? all.filter((o) => objects.includes(o.name)) : all;
    const targetDb = database || archive.metadata.database;
    const state = await adapter.restoreCheck(conn, targetDb, chosen.map((o) => o.name));
    const items = chosen.map((o) => {
      const t = state.find((s) => s.name === o.name) || {};
      const blocked = t.exists && t.rows > 0;
      return {
        name: o.name,
        backupCount: o.count,
        targetExists: Boolean(t.exists),
        targetRows: t.rows || 0,
        action: blocked ? 'blocked' : t.exists ? 'load into empty' : 'create + load',
        blocked,
      };
    });
    return {
      record: { id: record.id, fileName: record.fileName, createdAt: archive.metadata.createdAt },
      sourceEngine,
      sourceDatabase: archive.metadata.database,
      target: { connectionId, connectionName: conn.name, engine: conn.engine, database: targetDb },
      items,
      totalRecords: items.reduce((s, i) => s + i.backupCount, 0),
      canRestore: items.length > 0 && items.every((i) => !i.blocked),
    };
  } finally {
    archive.close();
  }
}

export async function executeRestore({ recordId, connectionId, database, objects, passphrase, confirm }) {
  const preview = await previewRestore({ recordId, connectionId, database, objects, passphrase });
  if (!preview.canRestore) throw new Error('Some targets already contain data. Restore only writes into empty or new tables/collections.');
  if (String(confirm || '').trim() !== preview.target.database) {
    throw new Error(`Type the target database name (${preview.target.database}) to confirm`);
  }
  const { archive } = await load(recordId, passphrase);
  const started = Date.now();
  try {
    const { conn, adapter } = resolveConnection(connectionId);
    const names = preview.items.map((i) => i.name);
    const schema = archive.isMongo ? null : await archive.readJson('schema.json', { tables: [] });
    const results = await adapter.restore(conn, preview.target.database, {
      schema,
      names,
      readRows: (name) => archive.rows(name),
      readIndexes: (name) => archive.readIndexes(name),
    });
    const inserted = results.reduce((s, r) => s + (r.inserted || 0), 0);
    logLine(`Restore ok: ${preview.record.fileName} → ${conn.name}/${preview.target.database} (${inserted} records)`);
    addWriteAudit({
      kind: 'restore',
      connectionId: conn.id,
      connectionName: conn.name,
      engine: conn.engine,
      database: preview.target.database,
      objects: names,
      inserted,
      recordId: preview.record.id,
      fileName: preview.record.fileName,
    });
    return { ok: true, results, inserted, durationMs: Date.now() - started, target: preview.target };
  } finally {
    archive.close();
  }
}
