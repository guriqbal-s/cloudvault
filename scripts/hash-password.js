// Prints a bcrypt hash for users.passwordHash, made exactly as the API makes it.
//   npm run hash-password -- "MyNewPassword#2026"
// Use the output in database/login.sql (create user / reset password).
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "your password"');
  process.exit(1);
}
if (password.length < 10) console.warn('Warning: the app requires passwords of at least 10 characters for sign-up and resets.');

const rounds = Number(process.env.BCRYPT_ROUNDS) || 12;
console.log(await bcrypt.hash(password, rounds));
