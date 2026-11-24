import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export function hashPassword(password) {
  return bcrypt.hashSync(password, ROUNDS);
}

export function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  try {
    return bcrypt.compareSync(password, passwordHash);
  } catch {
    return false;
  }
}
