import bcrypt from 'bcryptjs';

const DEFAULT_ROUNDS = 10;

export function getHashConfig(settings = {}) {
  return {
    algorithm: settings.hash?.algorithm || 'bcrypt',
    rounds: Number(settings.hash?.rounds || DEFAULT_ROUNDS),
  };
}

export async function hashPassword(plain, config = {}) {
  const algorithm = config.algorithm || 'bcrypt';
  const rounds = Number(config.rounds || DEFAULT_ROUNDS);
  if (algorithm !== 'bcrypt') {
    throw new Error(`Unsupported hash algorithm: ${algorithm}`);
  }
  return bcrypt.hash(String(plain), rounds);
}

export async function verifyPassword(plain, hashed) {
  return bcrypt.compare(String(plain), String(hashed));
}
