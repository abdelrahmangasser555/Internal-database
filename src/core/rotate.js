import { ObjectId } from 'mongodb';
import { EJSON } from 'bson';
import { getClient } from './mongo.js';
import { getConnection, getSettings, addRotationAudit } from './store.js';
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
    addRotationAudit({
      at: new Date().toISOString(),
      connectionId,
      connectionName: connection?.name,
      database,
      collection,
      userId: String(user._id),
      email: info.email || null,
      name: info.name || null,
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
