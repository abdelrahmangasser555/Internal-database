import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import unzipper from 'unzipper';
import { EJSON } from 'bson';
import { decryptFileWithPassphrase, isEncryptedBackup, newId } from './crypto.js';
import { TMP_DIR } from './paths.js';

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export function writeChecksumSidecar(filePath, sha256) {
  const sidecar = `${filePath}.sha256`;
  fs.writeFileSync(sidecar, `${sha256}  ${path.basename(filePath)}\n`, { mode: 0o600 });
  return sidecar;
}

/** Hash every file in a directory tree (relative POSIX paths → sha256). */
export async function hashTree(dir) {
  const out = {};
  const walk = async (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out[path.relative(dir, full).split(path.sep).join('/')] = await sha256File(full);
    }
  };
  await walk(dir);
  return out;
}

/**
 * Open a backup file (plain .zip or AES .zip.enc) for reading.
 * Returns helpers to read JSON entries and stream NDJSON lines. Always call close().
 */
export async function openArchive(filePath, passphrase) {
  if (!fs.existsSync(filePath)) throw new Error('Backup file is missing');
  let zipPath = filePath;
  let tmp = null;
  if (isEncryptedBackup(filePath)) {
    if (!passphrase) throw new Error('This backup is encrypted. A passphrase is needed to read it.');
    tmp = path.join(TMP_DIR, `open-${newId()}`);
    fs.mkdirSync(tmp, { recursive: true });
    zipPath = path.join(tmp, 'backup.zip');
    try {
      await decryptFileWithPassphrase(filePath, zipPath, passphrase);
    } catch (err) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw new Error(/unable to authenticate|auth/i.test(err.message) ? 'Wrong passphrase or the file was modified' : err.message);
    }
  }
  const directory = await unzipper.Open.file(zipPath);
  const entries = new Map(directory.files.filter((f) => f.type === 'File').map((f) => [f.path.replace(/\\/g, '/'), f]));

  const readJson = async (name, fallback = null) => {
    const entry = entries.get(name);
    if (!entry) return fallback;
    return JSON.parse((await entry.buffer()).toString('utf8'));
  };

  async function* lines(name) {
    const entry = entries.get(name);
    if (!entry) return;
    const rl = readline.createInterface({ input: entry.stream(), crlfDelay: Infinity });
    for await (const line of rl) {
      if (line.trim()) yield line;
    }
  }

  const metadata = (await readJson('metadata.json', {})) || {};
  const engine = metadata.engine || 'mongodb';
  const isMongo = engine === 'mongodb';
  const dataPath = (name) => (isMongo ? `collections/${name}/documents.ndjson` : `tables/${name}/rows.ndjson`);

  async function* rows(name) {
    for await (const line of lines(dataPath(name))) {
      yield isMongo ? EJSON.parse(line, { relaxed: false }) : JSON.parse(line);
    }
  }

  const entryHash = (name) =>
    new Promise((resolve, reject) => {
      const entry = entries.get(name);
      if (!entry) return resolve(null);
      const hash = crypto.createHash('sha256');
      entry
        .stream()
        .on('data', (c) => hash.update(c))
        .on('error', reject)
        .on('end', () => resolve(hash.digest('hex')));
    });

  return {
    metadata,
    engine,
    isMongo,
    entries: [...entries.keys()],
    readJson,
    lines,
    rows,
    dataPath,
    entryHash,
    readIndexes: (name) => readJson(`collections/${name}/indexes.json`, []),
    close: () => {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
    },
  };
}
