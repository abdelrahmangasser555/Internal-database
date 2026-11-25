import fs from 'node:fs';
import { getRecord, patchRecord } from './store.js';
import { openArchive, sha256File } from './archive.js';
import { passphraseFor } from './backup.js';

/**
 * Verify a backup file without touching any database:
 * file present → SHA-256 vs. the value recorded at backup time → archive opens (decrypts) →
 * per-file checksums inside the archive → document/row counts match the metadata.
 */
export async function verifyRecord(recordId, { passphrase } = {}) {
  const record = getRecord(recordId);
  if (!record) throw new Error('Record not found');
  const checks = [];
  const add = (id, label, status, detail = '') => checks.push({ id, label, status, detail });

  if (!record.filePath || !fs.existsSync(record.filePath)) {
    add('file', 'Backup file present', 'fail', record.filePath || 'no path');
    return finish(record, checks);
  }
  add('file', 'Backup file present', 'pass', record.fileName);

  const actual = await sha256File(record.filePath);
  let expected = record.sha256;
  const sidecar = `${record.filePath}.sha256`;
  if (!expected && fs.existsSync(sidecar)) expected = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0];
  if (expected) {
    add('sha256', 'SHA-256 matches the value saved at backup time', actual === expected ? 'pass' : 'fail', actual === expected ? actual : `expected ${expected}, got ${actual}`);
  } else {
    add('sha256', 'SHA-256 baseline', 'warn', `No checksum was saved for this file. Current: ${actual}`);
  }

  let archive;
  try {
    archive = await openArchive(record.filePath, passphraseFor(record, passphrase));
    add('open', record.encrypted ? 'Decrypts and opens (AES-256-GCM tag valid)' : 'Zip opens', 'pass', `${archive.entries.length} files`);
  } catch (err) {
    add('open', 'Archive opens', /passphrase is needed/.test(err.message) ? 'warn' : 'fail', err.message);
    return finish(record, checks, actual);
  }

  try {
    const meta = archive.metadata;
    if (!meta?.format) add('metadata', 'metadata.json present', 'fail', 'missing');
    else add('metadata', 'metadata.json present', 'pass', `${meta.format} · ${meta.engineLabel || meta.engine || 'MongoDB'} · ${meta.database}`);

    const sums = await archive.readJson('checksums.json', null);
    if (sums?.files) {
      let bad = 0;
      for (const [name, hash] of Object.entries(sums.files)) {
        if ((await archive.entryHash(name)) !== hash) bad += 1;
      }
      const total = Object.keys(sums.files).length;
      add('entries', 'Per-file checksums inside the archive', bad ? 'fail' : 'pass', bad ? `${bad} of ${total} files differ` : `${total} files match`);
    } else {
      add('entries', 'Per-file checksums inside the archive', 'warn', 'Older backup format without checksums.json');
    }

    const objects = meta?.collections || [];
    let mismatched = [];
    let totalRows = 0;
    for (const obj of objects) {
      let n = 0;
      for await (const _line of archive.lines(archive.dataPath(obj.name))) n += 1;
      totalRows += n;
      if (n !== obj.count) mismatched.push(`${obj.name}: ${n}/${obj.count}`);
    }
    if (objects.length) {
      add(
        'counts',
        `${archive.isMongo ? 'Document' : 'Row'} counts match metadata`,
        mismatched.length ? 'fail' : 'pass',
        mismatched.length ? mismatched.slice(0, 5).join(', ') : `${objects.length} ${archive.isMongo ? 'collections' : 'tables'} · ${totalRows} records`,
      );
    }
  } catch (err) {
    add('contents', 'Archive contents readable', 'fail', `Corrupted data: ${err.message}`);
  } finally {
    archive.close();
  }
  return finish(record, checks, actual);
}

function finish(record, checks, actual) {
  const failed = checks.filter((c) => c.status === 'fail').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  const summary = {
    ok: failed === 0,
    status: failed ? 'failed' : warned ? 'partial' : 'verified',
    checkedAt: new Date().toISOString(),
    failed,
    warned,
  };
  const patch = { verification: summary };
  if (!record.sha256 && actual && !failed) patch.sha256Observed = actual;
  patchRecord(record.id, patch);
  return { summary, checks };
}
