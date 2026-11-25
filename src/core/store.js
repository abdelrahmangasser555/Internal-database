import fs from 'node:fs';
import path from 'node:path';
import { decryptSecret, encryptSecret, newId } from './crypto.js';
import {
  CONNECTIONS_FILE,
  JOBS_FILE,
  RECORDS_FILE,
  ROTATION_AUDIT_FILE,
  SETTINGS_FILE,
} from './paths.js';

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function publicConnection(row) {
  const { uriEnc, ...rest } = row;
  return {
    ...rest,
    hasUri: Boolean(uriEnc),
    uriMasked: rest.uriMasked || '',
  };
}

export function maskUri(uri) {
  return String(uri || '').replace(/(:\/\/[^:/@]+:)([^@]+)(@)/, '$1*****$3');
}

export function listConnections() {
  return readJson(CONNECTIONS_FILE, []).map(publicConnection);
}

export function getConnection(id, { includeUri = false } = {}) {
  const row = readJson(CONNECTIONS_FILE, []).find((item) => item.id === id);
  if (!row) return null;
  if (!includeUri) return publicConnection(row);
  return { ...publicConnection(row), uri: decryptSecret(row.uriEnc) };
}

export function saveConnection(input) {
  const rows = readJson(CONNECTIONS_FILE, []);
  const now = new Date().toISOString();
  let row = rows.find((item) => item.id === input.id);
  if (!row) {
    row = {
      id: input.id || newId(),
      createdAt: now,
    };
    rows.push(row);
  }
  row.name = String(input.name || 'Untitled').trim();
  row.color = input.color || '#00ED64';
  row.updatedAt = now;
  if (input.uri) {
    row.uriEnc = encryptSecret(input.uri.trim());
    row.uriMasked = maskUri(input.uri.trim());
  }
  writeJson(CONNECTIONS_FILE, rows);
  return publicConnection(row);
}

export function deleteConnection(id) {
  const rows = readJson(CONNECTIONS_FILE, []).filter((item) => item.id !== id);
  writeJson(CONNECTIONS_FILE, rows);
}

export function listJobs() {
  return readJson(JOBS_FILE, []).map((job) => {
    const { passphraseEnc, ...rest } = job;
    return { ...rest, hasPassphrase: Boolean(passphraseEnc) };
  });
}

export function getJob(id, { includePassphrase = false } = {}) {
  const row = readJson(JOBS_FILE, []).find((item) => item.id === id);
  if (!row) return null;
  const { passphraseEnc, ...rest } = row;
  const out = { ...rest, hasPassphrase: Boolean(passphraseEnc) };
  if (includePassphrase && passphraseEnc) {
    out.passphrase = decryptSecret(passphraseEnc);
  }
  return out;
}

export function saveJob(input) {
  const rows = readJson(JOBS_FILE, []);
  const now = new Date().toISOString();
  let row = rows.find((item) => item.id === input.id);
  if (!row) {
    row = { id: input.id || newId(), createdAt: now, lastRunAt: null, nextRunAt: null };
    rows.push(row);
  }
  row.name = String(input.name || 'Backup job').trim();
  row.connectionId = input.connectionId;
  row.database = input.database || '';
  row.collections = Array.isArray(input.collections) ? input.collections : [];
  row.allCollections = Boolean(input.allCollections);
  row.targetPath = input.targetPath;
  row.interval = input.interval;
  row.notifyEmails = Array.isArray(input.notifyEmails)
    ? input.notifyEmails.map((e) => String(e).trim()).filter(Boolean)
    : [];
  row.encrypt = Boolean(input.encrypt);
  row.enabled = input.enabled !== false;
  row.updatedAt = now;
  if (input.passphrase) {
    row.passphraseEnc = encryptSecret(input.passphrase);
  }
  if (input.encrypt === false) {
    delete row.passphraseEnc;
  }
  if (input.nextRunAt) row.nextRunAt = input.nextRunAt;
  writeJson(JOBS_FILE, rows);
  return getJob(row.id);
}

export function patchJob(id, patch) {
  const rows = readJson(JOBS_FILE, []);
  const row = rows.find((item) => item.id === id);
  if (!row) return null;
  Object.assign(row, patch, { updatedAt: new Date().toISOString() });
  writeJson(JOBS_FILE, rows);
  return getJob(id);
}

export function deleteJob(id) {
  writeJson(
    JOBS_FILE,
    readJson(JOBS_FILE, []).filter((item) => item.id !== id),
  );
}

export function listRecords() {
  return readJson(RECORDS_FILE, []);
}

export function getRecord(id) {
  return readJson(RECORDS_FILE, []).find((item) => item.id === id) || null;
}

export function addRecord(record) {
  const rows = readJson(RECORDS_FILE, []);
  rows.unshift(record);
  writeJson(RECORDS_FILE, rows);
  return record;
}

export function deleteRecord(id) {
  writeJson(
    RECORDS_FILE,
    readJson(RECORDS_FILE, []).filter((item) => item.id !== id),
  );
}

export function getSettings() {
  return {
    fromEmail: process.env.SES_FROM_EMAIL || 'backups-service@tailoredtech.tech',
    port: Number(process.env.APP_PORT || 4780),
    hash: { algorithm: 'bcrypt', rounds: 10 },
    ...readJson(SETTINGS_FILE, {}),
  };
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch, updatedAt: new Date().toISOString() };
  writeJson(SETTINGS_FILE, next);
  return next;
}

export function addRotationAudit(entry) {
  const rows = readJson(ROTATION_AUDIT_FILE, []);
  rows.unshift(entry);
  writeJson(ROTATION_AUDIT_FILE, rows.slice(0, 2000));
}

export function listRotationAudit() {
  return readJson(ROTATION_AUDIT_FILE, []);
}
