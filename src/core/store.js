import fs from 'node:fs';
import path from 'node:path';
import { decryptSecret, encryptSecret, newId } from './crypto.js';
import { detectEngine, maskUri as maskConnectionUri } from './engines.js';
import {
  CONNECTIONS_FILE,
  DASHBOARDS_FILE,
  JOBS_FILE,
  RECORDS_FILE,
  ROTATION_AUDIT_FILE,
  SEEDS_FILE,
  SETTINGS_FILE,
  WRITE_AUDIT_FILE,
} from './paths.js';
import { parseSeed, summarizeSeed } from './seed-format.js';

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
    engine: rest.engine || 'mongodb',
    hasUri: Boolean(uriEnc),
    uriMasked: rest.uriMasked || '',
  };
}

export function maskUri(uri) {
  return maskConnectionUri(uri);
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
  row.color = input.color || row.color || '#E8E8E8';
  row.environment = ['production', 'staging', 'development', 'local'].includes(input.environment)
    ? input.environment
    : row.environment || 'production';
  row.tags = Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : row.tags || [];
  row.updatedAt = now;
  if (input.uri) {
    const uri = input.uri.trim();
    const engine = input.engine || detectEngine(uri);
    if (!engine) throw new Error('Unrecognised connection string. Use mongodb://, postgres://, mysql://, mariadb://, sqlite:/path or mssql://');
    row.engine = engine;
    row.uriEnc = encryptSecret(uri);
    row.uriMasked = maskUri(uri);
  } else if (input.engine && row.uriEnc) {
    row.engine = input.engine;
  }
  if (!row.engine) row.engine = 'mongodb';
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
  row.retention = {
    keepLast: Math.max(0, Math.floor(Number(input.retention?.keepLast ?? row.retention?.keepLast ?? 0)) || 0),
    maxAgeDays: Math.max(0, Math.floor(Number(input.retention?.maxAgeDays ?? row.retention?.maxAgeDays ?? 0)) || 0),
  };
  row.verifyAfter = input.verifyAfter !== undefined ? Boolean(input.verifyAfter) : row.verifyAfter !== false;
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

export function patchRecord(id, patch) {
  const rows = readJson(RECORDS_FILE, []);
  const row = rows.find((item) => item.id === id);
  if (!row) return null;
  Object.assign(row, patch);
  writeJson(RECORDS_FILE, rows);
  return row;
}

export function deleteRecord(id) {
  writeJson(
    RECORDS_FILE,
    readJson(RECORDS_FILE, []).filter((item) => item.id !== id),
  );
}

export const DEFAULT_AI_MODEL = 'deepseek/deepseek-v4.1-flash';

export function getSettings() {
  return {
    fromEmail: process.env.SES_FROM_EMAIL || 'backups-service@tailoredtech.tech',
    port: Number(process.env.APP_PORT || 4780),
    hash: { algorithm: 'bcrypt', rounds: 10 },
    ai: { model: process.env.OPENROUTER_MODEL || DEFAULT_AI_MODEL, enabled: true },
    ...readJson(SETTINGS_FILE, {}),
  };
}

/** Settings safe to send to the browser: secrets are replaced by flags. */
export function publicSettings() {
  const { aiKeyEnc, ...rest } = getSettings();
  return {
    ...rest,
    ai: {
      model: rest.ai?.model || DEFAULT_AI_MODEL,
      enabled: rest.ai?.enabled !== false,
      hasKey: Boolean(process.env.OPENROUTER_API_KEY || aiKeyEnc),
      keySource: process.env.OPENROUTER_API_KEY ? 'env' : aiKeyEnc ? 'settings' : null,
    },
  };
}

export function getAiKey() {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY;
  const { aiKeyEnc } = readJson(SETTINGS_FILE, {});
  return aiKeyEnc ? decryptSecret(aiKeyEnc) : null;
}

export function saveSettings(patch) {
  const { aiKey, aiKeyEnc: _ignored, ...rest } = patch || {};
  const current = readJson(SETTINGS_FILE, {});
  const next = { ...getSettings(), ...current, ...rest, updatedAt: new Date().toISOString() };
  if (rest.ai) next.ai = { ...(getSettings().ai || {}), ...rest.ai };
  if (typeof aiKey === 'string') {
    if (aiKey.trim()) next.aiKeyEnc = encryptSecret(aiKey.trim());
    else delete next.aiKeyEnc;
  }
  writeJson(SETTINGS_FILE, next);
  return publicSettings();
}

export function addRotationAudit(entry) {
  const rows = readJson(ROTATION_AUDIT_FILE, []);
  rows.unshift(entry);
  writeJson(ROTATION_AUDIT_FILE, rows.slice(0, 2000));
}

export function listRotationAudit() {
  return readJson(ROTATION_AUDIT_FILE, []);
}

export function addWriteAudit(entry) {
  const rows = readJson(WRITE_AUDIT_FILE, []);
  rows.unshift({ at: new Date().toISOString(), ...entry });
  writeJson(WRITE_AUDIT_FILE, rows.slice(0, 2000));
}

export function listWriteAudit() {
  return readJson(WRITE_AUDIT_FILE, []);
}

export function listSeeds() {
  return readJson(SEEDS_FILE, []);
}

export function getSeed(id) {
  return listSeeds().find((row) => row.id === id) || null;
}

function normalizeSeedBindings(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const item of input) {
    const connectionId = String(item?.connectionId || '').trim();
    const database = String(item?.database || '').trim();
    if (!connectionId || !database) continue;
    const key = `${connectionId}\0${database}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ connectionId, database });
    if (out.length >= 40) break;
  }
  return out;
}

export function saveSeed(input) {
  const parsed = parseSeed(input.payload || input);
  const summary = summarizeSeed(parsed);
  const rows = listSeeds();
  const now = new Date().toISOString();
  let row = input.id ? rows.find((item) => item.id === input.id) : null;
  if (!row) {
    row = { id: input.id || newId(), createdAt: now };
    rows.unshift(row);
  }
  row.name = String(input.name || parsed.name || 'Untitled seed').trim();
  row.description = String(input.description || parsed.description || '').trim();
  row.engine = parsed.engine;
  row.notes = String(input.notes || parsed.notes || '').trim();
  row.bindings = input.bindings !== undefined ? normalizeSeedBindings(input.bindings) : row.bindings || [];
  row.payload = parsed;
  row.objectCount = summary.objectCount;
  row.recordCount = summary.recordCount;
  row.updatedAt = now;
  writeJson(SEEDS_FILE, rows);
  return row;
}

export function patchSeed(id, patch) {
  const rows = listSeeds();
  const row = rows.find((item) => item.id === id);
  if (!row) return null;
  Object.assign(row, patch, { updatedAt: new Date().toISOString() });
  writeJson(SEEDS_FILE, rows);
  return row;
}

export function deleteSeed(id) {
  writeJson(
    SEEDS_FILE,
    listSeeds().filter((item) => item.id !== id),
  );
}

export function listDashboards() {
  return readJson(DASHBOARDS_FILE, []);
}

export function getDashboard(id) {
  return listDashboards().find((row) => row.id === id) || null;
}

export function saveDashboard(input) {
  const rows = listDashboards();
  const now = new Date().toISOString();
  let row = input.id ? rows.find((item) => item.id === input.id) : null;
  if (!row) {
    row = { id: input.id || newId(), createdAt: now };
    rows.unshift(row);
  }
  row.name = String(input.name || 'Untitled dashboard').trim().slice(0, 120);
  row.prompt = String(input.prompt || row.prompt || '').trim();
  row.connectionId = input.connectionId || row.connectionId;
  row.database = input.database || row.database;
  row.summary = String(input.summary || row.summary || '').trim();
  row.widgets = Array.isArray(input.widgets) ? input.widgets : row.widgets || [];
  row.updatedAt = now;
  if (input.lastRunAt) row.lastRunAt = input.lastRunAt;
  writeJson(DASHBOARDS_FILE, rows);
  return row;
}

export function deleteDashboard(id) {
  writeJson(
    DASHBOARDS_FILE,
    listDashboards().filter((item) => item.id !== id),
  );
}
