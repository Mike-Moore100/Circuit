// Minimal .env loader — zero deps. Imported once by src/config/index.ts so
// every tsx script that touches `config` automatically picks up secrets
// from a local .env file without anyone having to remember --env-file.
//
// Rules:
//   - .env is optional. If missing, no-op (production reads from real env).
//   - Existing process.env values win (so `KEY=x npm run pipeline` overrides
//     anything in the file).
//   - Lines are KEY=VALUE. Trims whitespace, strips matching surrounding
//     quotes, ignores blank lines and `#` comments.
import fs from 'node:fs';
import path from 'node:path';

const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
