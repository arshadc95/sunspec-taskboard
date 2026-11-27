import { loadEnv, readConfig } from '../src/config.js';
import { openDatabase, upsertSuperuser } from '../src/db.js';

loadEnv();
const config = readConfig();
const args = process.argv.slice(2);
const email = String(args[0] || config.adminEmail || '').trim().toLowerCase();
const password = args[1] || config.adminPassword || '';
const name = args[2] || config.adminName || 'Superuser';

if (!email || !password) {
  console.error('Usage: npm run create-superuser -- email@example.com "password" "Full Name"');
  console.error('Or set ADMIN_EMAIL, ADMIN_PASSWORD and optional ADMIN_NAME in .env');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

const db = openDatabase(config.dbPath);
const result = upsertSuperuser(db, { email, password, name });
if (result.created) console.log(`Created superuser ${email}`);
else console.log(`Updated ${email} to an active superuser and reset the password`);
db.close();
