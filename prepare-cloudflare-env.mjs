import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { randomBytes } from 'node:crypto';

const source = fs.existsSync('env') ? fs.readFileSync('env', 'utf8') : '';
const values = parseEnv(source);
if (!values.REORDIA_ADMIN_PASSWORD) {
  values.REORDIA_ADMIN_PASSWORD = randomBytes(24).toString('hex');
  fs.appendFileSync('env', `${source.endsWith('\n') || !source ? '' : '\n'}REORDIA_ADMIN_PASSWORD=${values.REORDIA_ADMIN_PASSWORD}\n`);
}
if (!values.PAGE_TOKEN_ENCRYPTION_KEY) {
  values.PAGE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  fs.appendFileSync('env', `\nPAGE_TOKEN_ENCRYPTION_KEY=${values.PAGE_TOKEN_ENCRYPTION_KEY}\n`);
}
const keys = ['META_APP_SECRET', 'REORDIA_ADMIN_PASSWORD', 'PAGE_TOKEN_ENCRYPTION_KEY'];
const secrets = Object.fromEntries(keys.filter(key => values[key]).map(key => [key, values[key]]));
fs.writeFileSync('.dev.vars', Object.entries(secrets).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', {mode:0o600});
console.log('Prepared private .dev.vars. Workspace username: admin. Password is in env.');
for (const key of keys) console.log(`${key}: ${secrets[key] ? 'ready' : 'missing; configure on Cloudflare'}`);
