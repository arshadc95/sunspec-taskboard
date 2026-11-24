import path from 'node:path';
import dotenv from 'dotenv';

export function loadEnv() {
  dotenv.config();
}

export function readConfig(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || path.join(process.cwd(), 'data'));
  return {
    port: Number(env.PORT || 8082),
    sessionSecret: env.SESSION_SECRET || '',
    dbPath: path.resolve(env.DB_PATH || path.join(dataDir, 'taskboard.sqlite')),
    dataDir,
    adminEmail: String(env.ADMIN_EMAIL || '').trim().toLowerCase(),
    adminPassword: String(env.ADMIN_PASSWORD || ''),
    adminName: String(env.ADMIN_NAME || 'Superuser').trim() || 'Superuser',
    loginMax: Number(env.LOGIN_MAX_ATTEMPTS || 8),
    loginWindowMs: Number(env.LOGIN_WINDOW_MS || 15 * 60 * 1000),
  };
}

export function assertConfig(config) {
  if (!config.sessionSecret || config.sessionSecret.length < 16) {
    throw new Error('SESSION_SECRET must be set and be at least 16 characters.');
  }
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error('PORT must be a whole number between 1 and 65535.');
  }
}
