/*
 * Format-only validator for .env.deploy.
 *
 * Deliberately prints shapes, lengths and yes/no results — never the values
 * themselves, because these are live secrets. Run with: node scripts/check-secrets.js
 */
const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '..', '.env.deploy');

if (!fs.existsSync(file)) {
  console.log('MISSING FILE: .env.deploy');
  process.exit(1);
}

const vars = {};
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z_]+)=(.*)$/.exec(line);
  if (match) vars[match[1]] = match[2].trim();
}

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

// --- MONGODB_URI ----------------------------------------------------------
const uri = vars.MONGODB_URI ?? '';
const REQUIRED_USER = 'speaking_coach';
const REQUIRED_HOST = '@intraprep.8xgcesy.mongodb.net/';

check('MONGODB_URI is non-empty', uri.length > 0, `${uri.length} chars`);
check('MONGODB_URI starts with mongodb+srv://', uri.startsWith('mongodb+srv://'));
check(`MONGODB_URI user is ${REQUIRED_USER}`, uri.includes(`mongodb+srv://${REQUIRED_USER}:`));
check('MONGODB_URI host matches Atlas cluster', uri.includes(REQUIRED_HOST));
check('MONGODB_URI has appName=INTRAPREP', uri.includes('appName=INTRAPREP'));
check('MONGODB_URI has no <placeholder> left', !/<db_username>|<db_password>/.test(uri));

const pwMatch = /^mongodb\+srv:\/\/[^:]+:([^@]+)@/.exec(uri);
const password = pwMatch ? pwMatch[1] : '';
check('MONGODB_URI password present', password.length > 0, `${password.length} chars`);
// Special characters in the password must be percent-encoded or the URI breaks.
check(
  'MONGODB_URI password needs no URL-encoding',
  password.length > 0 && /^[A-Za-z0-9._~-]+$/.test(password),
  password.length > 0 && /^[A-Za-z0-9._~-]+$/.test(password)
    ? 'safe charset'
    : 'HAS SPECIAL CHARS - must encode or simplify',
);

// --- GROQ_API_KEY ---------------------------------------------------------
const groq = vars.GROQ_API_KEY ?? '';
check('GROQ_API_KEY is non-empty', groq.length > 0, `${groq.length} chars`);
check('GROQ_API_KEY starts with gsk_', groq.startsWith('gsk_'));
check('GROQ_API_KEY charset is alphanumeric', /^gsk_[A-Za-z0-9]+$/.test(groq));
// Deliberately no comparison against a remembered key: that would mean keeping a
// secret in a tracked file. Rotation is verified by the operator, not here.
check('GROQ_API_KEY length looks like a real key', groq.length >= 30, `${groq.length} chars`);

// --- BYOK_ENCRYPTION_KEY --------------------------------------------------
const byok = vars.BYOK_ENCRYPTION_KEY ?? '';
let byokBytes = -1;
try {
  byokBytes = Buffer.from(byok, 'base64').length;
} catch {
  byokBytes = -1;
}
check('BYOK_ENCRYPTION_KEY decodes to exactly 32 bytes', byokBytes === 32, `${byokBytes} bytes`);

// --- report ---------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('CHECK', 52), 'RESULT');
console.log('-'.repeat(64));
for (const r of results) {
  console.log(pad(r.name, 52), r.pass ? 'PASS' : 'FAIL', r.detail ? `(${r.detail})` : '');
}
console.log('-'.repeat(64));

const failed = results.filter((r) => !r.pass);
if (failed.length === 0) {
  console.log('ALL CHECKS PASSED - ready for Render.');
  process.exit(0);
}
console.log(`${failed.length} CHECK(S) FAILED - fix before deploying.`);
process.exit(1);
