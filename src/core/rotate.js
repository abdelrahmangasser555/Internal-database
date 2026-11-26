import { ObjectId } from 'mongodb';
import { EJSON } from 'bson';
import { getClient } from './mongo.js';
import { getConnection, getSettings, addRotationAudit, listRotationAudit } from './store.js';
import { hashPassword, getHashConfig } from './hash.js';
import { makePassword, userDisplay } from './pattern.js';
import { passwordEmailHtml, renderTemplate, sendHtmlEmail } from './email.js';
import { logLine } from './log.js';

function toObjectId(id) {
  if (id && typeof id === 'object' && id.$oid) return new ObjectId(id.$oid);
  if (typeof id === 'string' && ObjectId.isValid(id)) return new ObjectId(id);
  return id;
}

export async function previewRotation({
  connectionId,
  database,
  collection,
  mapping,
  mode,
  pattern,
  ids,
  all,
  customMessage,
}) {
  const client = await getClient(connectionId);
  const col = client.db(database).collection(collection);
  const query = all ? {} : { _id: { $in: (ids || []).map(toObjectId) } };
  const users = await col.find(query).project({ password: 0 }).limit(500).toArray();
  const samples = users.slice(0, 8).map((user) => {
    const info = userDisplay(user, mapping);
    const password = makePassword({ mode, pattern, user, mapping });
    const vars = { ...info, password, database, username: info.username };
    return {
      ...info,
      password,
      emailPreview: renderTemplate(customMessage || 'Hi {{name}}, your new password is {{password}}.', vars),
    };
  });
  return { count: all ? await col.countDocuments() : users.length, samples };
}

export async function executeRotation(input) {
  const {
    connectionId,
    database,
    collection,
    mapping,
    mode,
    pattern,
    ids,
    all,
    notifyUsers = false,
    customMessage = '',
  } = input;

  const connection = getConnection(connectionId);
  const settings = getSettings();
  const hashConfig = getHashConfig(settings);
  const client = await getClient(connectionId);
  const col = client.db(database).collection(collection);
  const passwordField = mapping.passwordField || 'password';
  const query = all ? {} : { _id: { $in: (ids || []).map(toObjectId) } };
  const users = await col.find(query).toArray();

  const results = [];
  for (const user of users) {
    const info = userDisplay(user, mapping);
    const password = makePassword({ mode, pattern, user, mapping });
    const hashed = await hashPassword(password, hashConfig);
    await col.updateOne({ _id: user._id }, { $set: { [passwordField]: hashed } });
    const userId = String(user._id);
    const previous = listRotationAudit().find(
      (row) => row.userId === userId && row.database === database && row.collection === collection && row.password,
    );
    addRotationAudit({
      at: new Date().toISOString(),
      connectionId,
      connectionName: connection?.name,
      database,
      collection,
      userId,
      email: info.email || null,
      name: info.name || null,
      username: info.username || null,
      previousPassword: previous?.password || null,
      password,
      notified: Boolean(notifyUsers && info.email),
    });
    if (notifyUsers && info.email) {
      const vars = { ...info, password, database, username: info.username };
      const message = renderTemplate(customMessage, vars);
      try {
        await sendHtmlEmail({
          to: [info.email],
          subject: 'Your password has been rotated',
          html: passwordEmailHtml({
            ...info,
            password,
            customMessage: message,
            database,
            connectionName: connection?.name || '',
          }),
        });
      } catch (err) {
        logLine(`User notify failed (${info.email}): ${err.message}`);
      }
    }
    results.push({ id: String(user._id), email: info.email, name: info.name });
  }

  logLine(`Rotated ${results.length} password(s) on ${database}.${collection}`);
  return { updated: results.length, algorithm: hashConfig };
}

export function ejsonUser(doc) {
  return EJSON.serialize(doc);
}

function truthy(v) {
  return v === true || v === 1 || /^(1|true|yes)$/i.test(String(v || ''));
}

/** Newest-first audit rows, narrowed by text, dates, connection, and database. */
export function filterRotationAudit(rows, { q = '', from = '', to = '', database = '', connectionId = '', unique } = {}) {
  const term = String(q || '').trim().toLowerCase();
  const start = from ? new Date(`${from}T00:00:00`).getTime() : null;
  const end = to ? new Date(`${to}T23:59:59.999`).getTime() : null;
  const db = String(database || '').trim();
  const conn = String(connectionId || '').trim();
  const filtered = (rows || []).filter((row) => {
    const at = new Date(row.at).getTime();
    if (start && !(at >= start)) return false;
    if (end && !(at <= end)) return false;
    if (db && String(row.database || '') !== db) return false;
    if (conn && row.connectionId && String(row.connectionId) !== conn) return false;
    if (!term) return true;
    const blob = [row.email, row.name, row.username, row.userId, row.database, row.collection, row.connectionName]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return blob.includes(term);
  });
  if (!truthy(unique)) return filtered;
  const latest = new Map();
  for (const row of filtered) {
    const key = `${row.collection || ''}|${row.userId || row.email || ''}`;
    const prev = latest.get(key);
    if (!prev || new Date(row.at) >= new Date(prev.at)) latest.set(key, row);
  }
  return [...latest.values()].sort((a, b) => new Date(b.at) - new Date(a.at));
}

export function formatRotationAudit(rows) {
  const lines = [
    'Backup Service — password rotation audit',
    `Generated: ${new Date().toISOString()}`,
    'This file stays on this device. It lists each rotated user, the previous generated password, and the new one.',
    '',
    '=== Latest password per user ===',
  ];
  const latest = new Map();
  for (const row of rows || []) {
    const key = `${row.database}|${row.collection}|${row.userId}`;
    const prev = latest.get(key);
    if (!prev || new Date(row.at) >= new Date(prev.at)) latest.set(key, row);
  }
  if (!latest.size) lines.push('(no matching rows)');
  for (const row of latest.values()) {
    lines.push(
      `${row.name || row.username || row.email || row.userId}  <${row.email || 'no email'}>  final: ${row.password || '(not recorded)'}`,
    );
  }
  lines.push('', '=== History ===');
  for (const row of rows || []) {
    lines.push('---');
    lines.push(`When: ${row.at || ''}`);
    lines.push(`Name: ${row.name || ''}`);
    lines.push(`Username: ${row.username || ''}`);
    lines.push(`Email: ${row.email || ''}`);
    lines.push(`User id: ${row.userId || ''}`);
    lines.push(`Connection: ${row.connectionName || ''}`);
    lines.push(`Database: ${row.database || ''}.${row.collection || ''}`);
    lines.push(`Previous password: ${row.previousPassword || '(not recorded)'}`);
    lines.push(`New password: ${row.password || '(not recorded)'}`);
    lines.push(`Notified: ${row.notified ? 'yes' : 'no'}`);
  }
  if (!(rows || []).length) lines.push('(no matching rows)');
  lines.push('');
  return lines.join('\n');
}
