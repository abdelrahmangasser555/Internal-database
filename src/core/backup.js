import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { MongoClient } from 'mongodb';
import { EJSON } from 'bson';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { encryptFileWithPassphrase, decryptFileWithPassphrase, isEncryptedBackup, newId } from './crypto.js';
import { addRecord, getConnection, getJob, getRecord } from './store.js';
import { backupEmailHtml, sendHtmlEmail } from './email.js';
import { logLine } from './log.js';
import { deviceName, TMP_DIR } from './paths.js';

const running = new Map();

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export function getRunning(jobId) {
  return running.get(jobId) || null;
}

async function zipDirectory(sourceDir, zipPath) {
  await fs.promises.mkdir(path.dirname(zipPath), { recursive: true });
  const output = fs.createWriteStream(zipPath, { mode: 0o600 });
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(output);
  archive.directory(sourceDir, false);
  await archive.finalize();
  await finished(output);
}

async function dumpDatabase({ uri, database, collections, allCollections, onProgress }) {
  const client = new MongoClient(uri, {
    maxPoolSize: 3,
    minPoolSize: 0,
    maxIdleTimeMS: 60_000,
    serverSelectionTimeoutMS: 12_000,
    connectTimeoutMS: 12_000,
    readPreference: 'secondaryPreferred',
    readConcern: { level: 'majority' },
  });
  await client.connect();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bkup-dump-'));
  try {
    const db = client.db(database);
    let names = collections;
    if (allCollections || !names?.length) {
      names = (await db.listCollections({}, { nameOnly: true }).toArray())
        .map((col) => col.name)
        .filter((name) => !name.startsWith('system.'));
    }

    const summary = [];
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i];
      onProgress?.({
        collection: name,
        collectionsDone: i,
        collectionsTotal: names.length,
      });
      const col = db.collection(name);
      const colDir = path.join(tmpRoot, 'collections', name);
      fs.mkdirSync(colDir, { recursive: true });
      const indexes = await col.indexes();
      fs.writeFileSync(path.join(colDir, 'indexes.json'), JSON.stringify(indexes, null, 2));

      const ndjsonPath = path.join(colDir, 'documents.ndjson');
      const ws = fs.createWriteStream(ndjsonPath);
      let count = 0;
      const cursor = col.find({}, { noCursorTimeout: false }).batchSize(500);
      for await (const doc of cursor) {
        const line = `${EJSON.stringify(doc)}\n`;
        if (!ws.write(line)) await once(ws, 'drain');
        count += 1;
        if (count % 1000 === 0) {
          onProgress?.({
            collection: name,
            collectionsDone: i,
            collectionsTotal: names.length,
            documents: count,
          });
        }
      }
      ws.end();
      await finished(ws);
      summary.push({ name, count, indexes: indexes.length });
    }

    const metadata = {
      format: 'backup-service-v1',
      database,
      createdAt: new Date().toISOString(),
      hostname: os.hostname(),
      platform: process.platform,
      readOnly: true,
      collections: summary,
    };
    fs.writeFileSync(path.join(tmpRoot, 'metadata.json'), JSON.stringify(metadata, null, 2));
    return { tmpRoot, summary, documentCount: summary.reduce((sum, col) => sum + col.count, 0) };
  } catch (err) {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    throw err;
  } finally {
    await client.close();
  }
}

export async function runBackup(jobId, { reason = 'schedule' } = {}) {
  const job = getJob(jobId, { includePassphrase: true });
  if (!job) throw new Error('Backup job not found');
  if (running.has(jobId)) throw new Error('This backup is already running');

  const connection = getConnection(job.connectionId, { includeUri: true });
  if (!connection?.uri) throw new Error('Connection is missing');
  if (!job.database) throw new Error('Select a database for this backup');
  if (!job.targetPath) throw new Error('Select a backup folder');

  fs.mkdirSync(job.targetPath, { recursive: true });

  const startedAt = new Date();
  const progress = { status: 'running', collectionsDone: 0, collectionsTotal: 0, collection: '' };
  running.set(jobId, progress);

  const fileBase = `${String(job.name).replace(/[^\w.-]+/g, '_')}_${job.database}_${stamp()}`;
  const zipName = `${fileBase}.zip`;
  const encName = `${fileBase}.zip.enc`;
  const zipPath = path.join(job.targetPath, zipName);
  const encPath = path.join(job.targetPath, encName);
  let filePath = job.encrypt ? encPath : zipPath;
  let error = null;
  let summary = [];
  let documentCount = 0;
  let size = 0;
  let encrypted = Boolean(job.encrypt);
  let tmpRoot;

  try {
    const dump = await dumpDatabase({
      uri: connection.uri,
      database: job.database,
      collections: job.collections,
      allCollections: job.allCollections,
      onProgress: (p) => Object.assign(progress, p),
    });
    tmpRoot = dump.tmpRoot;
    summary = dump.summary;
    documentCount = dump.documentCount;
    await zipDirectory(tmpRoot, zipPath);
    if (job.encrypt) {
      if (!job.passphrase) {
        throw new Error('Encryption is on but no passphrase is set. Edit the job and set one.');
      }
      await encryptFileWithPassphrase(zipPath, encPath, job.passphrase);
      fs.unlinkSync(zipPath);
      filePath = encPath;
      encrypted = true;
    } else {
      filePath = zipPath;
    }
    size = fs.statSync(filePath).size;
  } catch (err) {
    error = err.message || String(err);
    logLine(`Backup failed [${job.name}]: ${error}`);
    if (fs.existsSync(zipPath) && job.encrypt) {
      try {
        fs.unlinkSync(zipPath);
      } catch {
        // ignore
      }
    }
  } finally {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  const finishedAt = new Date();
  const record = {
    id: newId(),
    jobId: job.id,
    jobName: job.name,
    connectionId: job.connectionId,
    connectionName: connection.name,
    database: job.database,
    collections: summary,
    documentCount,
    filePath,
    fileName: path.basename(filePath),
    size,
    sizeLabel: formatBytes(size),
    encrypted,
    status: error ? 'failed' : 'success',
    error,
    reason,
    device: deviceName(),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt - startedAt,
  };
  addRecord(record);
  running.delete(jobId);

  if (job.notifyEmails?.length) {
    try {
      await sendHtmlEmail({
        to: job.notifyEmails,
        subject: error
          ? `[Backup failed] ${job.name} / ${job.database}`
          : `[Backup] ${job.name} / ${job.database}`,
        html: backupEmailHtml(record),
      });
    } catch (mailErr) {
      logLine(`Backup email failed: ${mailErr.message}`);
    }
  }

  if (error) throw new Error(error);
  logLine(`Backup ok [${job.name}] ${filePath}`);
  return record;
}

export function recordExists(record) {
  return Boolean(record?.filePath && fs.existsSync(record.filePath));
}

export async function decryptRecord(recordId, destDir) {
  const record = getRecord(recordId);
  if (!record) throw new Error('Record not found');
  if (!fs.existsSync(record.filePath)) throw new Error('Backup file is missing');
  const job = getJob(record.jobId, { includePassphrase: true });
  fs.mkdirSync(destDir, { recursive: true });
  const outZip = path.join(destDir, record.fileName.replace(/\.enc$/i, '').replace(/\.zip$/i, '') + '.zip');
  if (isEncryptedBackup(record.filePath)) {
    if (!job?.passphrase) throw new Error('This backup is encrypted. Set the job passphrase to decrypt it.');
    await decryptFileWithPassphrase(record.filePath, outZip, job.passphrase);
  } else {
    fs.copyFileSync(record.filePath, outZip);
  }
  const extractDir = path.join(destDir, 'contents');
  fs.mkdirSync(extractDir, { recursive: true });
  await new Promise((resolve, reject) => {
    fs.createReadStream(outZip)
      .pipe(unzipper.Extract({ path: extractDir }))
      .on('close', resolve)
      .on('error', reject);
  });
  return { zipPath: outZip, extractDir };
}

export async function exportRecord(recordId, destPath) {
  const record = getRecord(recordId);
  if (!record) throw new Error('Record not found');
  if (!fs.existsSync(record.filePath)) throw new Error('Backup file is missing');
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.copyFileSync(record.filePath, destPath);
  return destPath;
}

export function importBackupFile({ filePath, connectionName = '', database = '' }) {
  if (!fs.existsSync(filePath)) throw new Error('File not found');
  const stat = fs.statSync(filePath);
  const encrypted = isEncryptedBackup(filePath) || filePath.endsWith('.enc');
  const record = {
    id: newId(),
    jobId: null,
    jobName: 'Imported',
    connectionId: null,
    connectionName: connectionName || 'Imported',
    database: database || '',
    collections: [],
    documentCount: 0,
    filePath,
    fileName: path.basename(filePath),
    size: stat.size,
    sizeLabel: formatBytes(stat.size),
    encrypted,
    status: 'success',
    error: null,
    reason: 'import',
    device: deviceName(),
    startedAt: new Date(stat.mtime).toISOString(),
    finishedAt: new Date(stat.mtime).toISOString(),
    durationMs: 0,
  };
  addRecord(record);
  return record;
}

export function tempDecryptDir(recordId) {
  return path.join(TMP_DIR, recordId);
}
