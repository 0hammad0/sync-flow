// Show the currently DEPLOYED Firestore rules, and optionally deploy
// the local firestore.rules via the Firebase Rules REST API using the
// service-account credentials from .env.local.
// Usage:
//   node scripts/deploy-firestore-rules.mjs           # show deployed rules only
//   node scripts/deploy-firestore-rules.mjs --deploy  # deploy local firestore.rules
import { readFileSync } from 'fs';
import { JWT } from 'google-auth-library';

for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

const PROJECT = process.env.FIREBASE_PROJECT_ID;
const client = new JWT({
  email: process.env.FIREBASE_CLIENT_EMAIL,
  key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});
const { token } = await client.getAccessToken();
const API = 'https://firebaserules.googleapis.com/v1';
const auth = { Authorization: `Bearer ${token}` };

async function api(path, init = {}) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...auth, 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} -> ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

// --- Show currently deployed firestore rules ---
const release = await api(`/projects/${PROJECT}/releases/cloud.firestore`).catch((e) => {
  console.log('No cloud.firestore release found:', e.message);
  return null;
});
if (release) {
  const ruleset = await api(`/${release.rulesetName.replace(/^projects/, 'projects')}`.replace(API, '').replace(/^\//, '/'));
  console.log('=== CURRENTLY DEPLOYED RULES ===');
  for (const f of ruleset.source.files) console.log(f.content);
  console.log('=== END DEPLOYED RULES (updated', release.updateTime, ') ===');
}

if (!process.argv.includes('--deploy')) process.exit(0);

// --- Deploy local firestore.rules ---
const localRules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const ruleset = await api(`/projects/${PROJECT}/rulesets`, {
  method: 'POST',
  body: JSON.stringify({ source: { files: [{ name: 'firestore.rules', content: localRules }] } }),
});
console.log('Created ruleset:', ruleset.name);

const newRelease = await api(
  `/projects/${PROJECT}/releases/cloud.firestore?updateMask=rulesetName`,
  {
    method: 'PATCH',
    body: JSON.stringify({ release: { name: `projects/${PROJECT}/releases/cloud.firestore`, rulesetName: ruleset.name } }),
  }
).catch(async (e) => {
  // No existing release — create one.
  console.log('PATCH failed (' + e.message.slice(0, 120) + '), trying POST /releases');
  return api(`/projects/${PROJECT}/releases`, {
    method: 'POST',
    body: JSON.stringify({ name: `projects/${PROJECT}/releases/cloud.firestore`, rulesetName: ruleset.name }),
  });
});
console.log('DEPLOYED:', JSON.stringify(newRelease));
