import { randomPassword } from './crypto.js';

function field(user, names) {
  for (const name of names) {
    const value = user?.[name];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return '';
}

export function userDisplay(user, mapping = {}) {
  return {
    id: user._id?.$oid || user._id || '',
    name: field(user, [mapping.nameField, 'name', 'fullName', 'displayName'].filter(Boolean)),
    email: field(user, [mapping.emailField, 'email', 'mail'].filter(Boolean)),
    username: field(user, [mapping.usernameField, 'username', 'userName', 'email'].filter(Boolean)),
  };
}

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function firstWord(value) {
  return String(value || '').trim().split(/\s+/)[0] || '';
}

export function applyPattern(pattern, user, mapping) {
  const info = userDisplay(user, mapping);
  const now = new Date();
  const tokens = {
    name: slug(info.name) || slug(info.username) || 'user',
    Name: info.name || info.username || 'user',
    first: slug(firstWord(info.name)) || 'user',
    email: info.email,
    emailLocal: info.email.split('@')[0] || '',
    user: slug(info.username) || slug(info.email) || 'user',
    yyyy: String(now.getFullYear()),
    mm: String(now.getMonth() + 1).padStart(2, '0'),
    dd: String(now.getDate()).padStart(2, '0'),
  };

  let out = String(pattern || '');
  out = out.replace(/\{rand:(\d+)\}/g, (_, n) => randomPassword(Number(n)));
  out = out.replace(/\{digits:(\d+)\}/g, (_, n) =>
    Array.from({ length: Number(n) }, () => String(Math.floor(Math.random() * 10))).join(''),
  );
  out = out.replace(/\{(\w+)\}/g, (full, key) => (key in tokens ? tokens[key] : full));
  return out;
}

export function makePassword({ mode, pattern, user, mapping, length = 16 }) {
  if (mode === 'pattern') return applyPattern(pattern, user, mapping);
  return randomPassword(length);
}
