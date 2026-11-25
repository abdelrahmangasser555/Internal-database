import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { MASTER_KEY_FILE } from './paths.js';

export const ENC_MAGIC = Buffer.from('BKUPENC1');
const SCRYPT = { N: 16384, r: 8, p: 1 };
const HEADER_LEN = 8 + 16 + 12;

function loadOrCreateDeviceKey() {
  const fromEnv = process.env.BACKUP_MASTER_KEY?.trim();
  if (fromEnv) {
    return crypto.createHash('sha256').update(fromEnv).digest();
  }
  if (fs.existsSync(MASTER_KEY_FILE)) {
    return fs.readFileSync(MASTER_KEY_FILE);
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(MASTER_KEY_FILE, key, { mode: 0o600 });
  return key;
}

let deviceKey;
function getDeviceKey() {
  if (!deviceKey) deviceKey = loadOrCreateDeviceKey();
  return deviceKey;
}

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getDeviceKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(payload) {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getDeviceKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function deriveKeyFromPassphrase(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, SCRYPT);
}

export function isEncryptedBackup(filePathOrBuffer) {
  if (Buffer.isBuffer(filePathOrBuffer)) {
    return filePathOrBuffer.length >= 8 && filePathOrBuffer.subarray(0, 8).equals(ENC_MAGIC);
  }
  if (!fs.existsSync(filePathOrBuffer)) return false;
  const fd = fs.openSync(filePathOrBuffer, 'r');
  try {
    const buf = Buffer.alloc(8);
    fs.readSync(fd, buf, 0, 8, 0);
    return buf.equals(ENC_MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

export async function encryptFileWithPassphrase(inPath, outPath, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKeyFromPassphrase(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const output = fs.createWriteStream(outPath, { mode: 0o600 });
  await new Promise((resolve, reject) => {
    output.on('error', reject);
    const input = fs.createReadStream(inPath);
    input.on('error', reject);
    cipher.on('error', reject);
    output.write(Buffer.concat([ENC_MAGIC, salt, iv]));
    input.pipe(cipher).pipe(output, { end: false });
    cipher.on('end', () => {
      output.write(cipher.getAuthTag());
      output.end();
    });
    output.on('finish', resolve);
  });
}

export async function decryptFileWithPassphrase(inPath, outPath, passphrase) {
  const stat = fs.statSync(inPath);
  if (stat.size < HEADER_LEN + 16) throw new Error('Encrypted backup is truncated');
  const header = Buffer.alloc(HEADER_LEN);
  const fd = fs.openSync(inPath, 'r');
  try {
    fs.readSync(fd, header, 0, HEADER_LEN, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (!header.subarray(0, 8).equals(ENC_MAGIC)) throw new Error('Not an encrypted backup file');
  const salt = header.subarray(8, 24);
  const iv = header.subarray(24, 36);
  const tag = Buffer.alloc(16);
  const fd2 = fs.openSync(inPath, 'r');
  try {
    fs.readSync(fd2, tag, 0, 16, stat.size - 16);
  } finally {
    fs.closeSync(fd2);
  }
  const key = deriveKeyFromPassphrase(passphrase, salt);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const input = fs.createReadStream(inPath, {
    start: HEADER_LEN,
    end: stat.size - 17,
  });
  await pipeline(input, decipher, fs.createWriteStream(outPath, { mode: 0o600 }));
}

export function randomPassword(length = 16) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$%&*!?';
  const all = upper + lower + digits + symbols;
  const pick = (set) => set[crypto.randomInt(0, set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export function newId() {
  return crypto.randomUUID();
}
