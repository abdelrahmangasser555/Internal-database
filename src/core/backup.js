import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import archiver from 'archiver';
import unzipper from 'unzipper';
import { encryptFileWithPassphrase, decryptFileWithPassphrase, isEncryptedBackup, newId } from './crypto.js';
import { addRecord, getConnection, getJob, getRecord, listRecords, patchRecord } from './store.js';
import { backupEmailHtml, sendHtmlEmail } from './email.js';
import { logLine } from './log.js';
import { deviceName, TMP_DIR } from './paths.js';
import { adapterFor } from './adapters/index.js';
import { engineInfo } from './engines.js';
import { hashTree, sha256File, writeChecksumSidecar } from './archive.js';

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

export function listRunning() {
  return Object.fromEntries(running.entries());
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

/** Read-only dump through the engine adapter into a temp folder, plus metadata and checksums. */
async function dumpDatabase({ connection, database, objects, onProgress }) {
  const engine = connection.engine || 'mongodb';
  const adapter = adapterFor(engine);
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bkup-dump-'));
  try {
    const { summary } = await adapter.dump(connection, database, { objects, onProgress }, tmpRoot);
    const checksums = await hashTree(tmpRoot);
    fs.writeFileSync(path.join(tmpRoot, 'checksums.json'), JSON.stringify({ algorithm: 'sha256', files: checksums }, null, 2));
    const metadata = {
      format: 'backup-service-v2',
      engine,
      engineLabel: engineInfo(engine).label,
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
  }
}

/** Delete old backup files for a job according to its retention policy. Records are kept and marked pruned. */
export function applyRetention(job) {
  const keepLast = Number(job.retention?.keepLast) || 0;
  const maxAgeDays = Number(job.retention?.maxAgeDays) || 0;
  if (!keepLast && !maxAgeDays) return [];
  const target = path.resolve(job.targetPath || '');
  const candidates = listRecords().filter(
    (r) => r.jobId === job.id && r.status === 'success' && !r.pruned && r.filePath && fs.existsSync(r.filePath),
  );
  const now = Date.now();
  const pruned = [];
  candidates.forEach((rec, index) => {
    const ageDays = (now - new Date(rec.finishedAt || rec.startedAt).getTime()) / 86_400_000;
    const overCount = keepLast && index >= keepLast;
    const tooOld = maxAgeDays && ageDays > maxAgeDays;
    if (!overCount && !tooOld) return;
    // Only ever touch files this job wrote inside its own folder.
    if (path.dirname(path.resolve(rec.filePath)) !== target) return;
    try {
      fs.unlinkSync(rec.filePath);
      if (fs.existsSync(`${rec.filePath}.sha256`)) fs.unlinkSync(`${rec.filePath}.sha256`);
      patchRecord(rec.id, { pruned: true, prunedAt: new Date().toISOString(), prunedReason: overCount ? `keep last ${keepLast}` : `older than ${maxAgeDays} days` });
      pruned.push(rec.id);
    } catch (err) {
      logLine(`Retention could not remove ${rec.filePath}: ${err.message}`);
    }
  });
  if (pruned.length) logLine(`Retention pruned ${pruned.length} file(s) for ${job.name}`);
  return pruned;
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
  const progress = { status: 'running', collectionsDone: 0, collectionsTotal: 0, collection: '', startedAt: startedAt.toISOString() };
  running.set(jobId, progress);

  const safeDb = String(job.database).replace(/[^\w.-]+/g, '_');
  const fileBase = `${String(job.name).replace(/[^\w.-]+/g, '_')}_${safeDb}_${stamp()}`;
  const zipPath = path.join(job.targetPath, `${fileBase}.zip`);
  const encPath = path.join(job.targetPath, `${fileBase}.zip.enc`);
  let filePath = job.encrypt ? encPath : zipPath;
  let error = null;
  let summary = [];
  let documentCount = 0;
  let size = 0;
  let sha256 = null;
  const encrypted = Boolean(job.encrypt);
  let tmpRoot;

  try {
    const dump = await dumpDatabase({
      connection,
      database: job.database,
      objects: job.allCollections ? [] : job.collections,
      onProgress: (p) => Object.assign(progress, p),
    });
    tmpRoot = dump.tmpRoot;
    summary = dump.summary;
    documentCount = dump.documentCount;
    progress.phase = 'compressing';
    await zipDirectory(tmpRoot, zipPath);
    if (job.encrypt) {
      if (!job.passphrase) throw new Error('Encryption is on but no passphrase is set. Edit the job and set one.');
      progress.phase = 'encrypting';
      await encryptFileWithPassphrase(zipPath, encPath, job.passphrase);
      fs.unlinkSync(zipPath);
      filePath = encPath;
    } else {
      filePath = zipPath;
    }
    size = fs.statSync(filePath).size;
    progress.phase = 'checksum';
    sha256 = await sha256File(filePath);
    writeChecksumSidecar(filePath, sha256);
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
    engine: connection.engine || 'mongodb',
    database: job.database,
    collections: summary,
    documentCount,
    filePath,
    fileName: path.basename(filePath),
    size,
    sizeLabel: formatBytes(size),
    encrypted,
    sha256,
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

  if (!error && job.verifyAfter !== false) {
    try {
      const { verifyRecord } = await import('./verify.js');
      const report = await verifyRecord(record.id);
      record.verification = report.summary;
    } catch (err) {
      logLine(`Verification after backup failed: ${err.message}`);
    }
  }
  if (!error) applyRetention(job);

  if (job.notifyEmails?.length) {
    try {
      await sendHtmlEmail({
        to: job.notifyEmails,
        subject: error ? `[Backup failed] ${job.name} / ${job.database}` : `[Backup] ${job.name} / ${job.database}`,
        html: backupEmailHtml(record),
      });
    } catch (mailErr) {
      logLine(`Backup email failed: ${mailErr.message}`);
    }
  }

  if (error) throw new Error(error);
  logLine(`Backup ok [${job.name}] ${filePath}`);
  return getRecord(record.id) || record;
}

export function recordExists(record) {
  return Boolean(record?.filePath && fs.existsSync(record.filePath));
}

export async function decryptRecord(recordId, destDir, passphraseOverride) {
  const record = getRecord(recordId);
  if (!record) throw new Error('Record not found');
  if (!fs.existsSync(record.filePath)) throw new Error('Backup file is missing');
  const job = record.jobId ? getJob(record.jobId, { includePassphrase: true }) : null;
  const passphrase = passphraseOverride || job?.passphrase;
  fs.mkdirSync(destDir, { recursive: true });
  const outZip = path.join(destDir, `${record.fileName.replace(/\.enc$/i, '').replace(/\.zip$/i, '')}.zip`);
  if (isEncryptedBackup(record.filePath)) {
    if (!passphrase) throw new Error('This backup is encrypted. Set the job passphrase to decrypt it.');
    await decryptFileWithPassphrase(record.filePath, outZip, passphrase);
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

export function passphraseFor(record, override) {
  if (override) return override;
  if (!record?.jobId) return null;
  return getJob(record.jobId, { includePassphrase: true })?.passphrase || null;
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
  if (!filePath || !fs.existsSync(filePath)) throw new Error('File not found');
  const stat = fs.statSync(filePath);
  const encrypted = isEncryptedBackup(filePath) || filePath.endsWith('.enc');
  const record = {
    id: newId(),
    jobId: null,
    jobName: 'Imported',
    connectionId: null,
    connectionName: connectionName || 'Imported',
    engine: null,
    database: database || '',
    collections: [],
    documentCount: 0,
    filePath,
    fileName: path.basename(filePath),
    size: stat.size,
    sizeLabel: formatBytes(stat.size),
    encrypted,
    sha256: null,
    status: 'success',
    error: null,
    reason: 'import',
    device: deviceName(),
    startedAt: new Date(stat.mtime).toISOString(),
    finishedAt: new Date(stat.mtime).toISOString(),
    durationMs: 0,
  };
  const sidecar = `${filePath}.sha256`;
  if (fs.existsSync(sidecar)) record.sha256 = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0] || null;
  addRecord(record);
  return record;
}

export function tempDecryptDir(recordId) {
  return path.join(TMP_DIR, recordId);
}
