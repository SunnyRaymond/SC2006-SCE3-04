#!/usr/bin/env node
// Renew the OneMap token (it expires every 3 days), save it to credentials.env,
// and optionally push it to Vercel production and redeploy.
//
//   node scripts/renew-onemap-token.mjs            # renew + update credentials.env only
//   node scripts/renew-onemap-token.mjs --vercel   # also update Vercel env and redeploy
//
// Reads OneMap_Email / OneMap_Password from credentials.env. Never prints the token.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, 'credentials.env');
const VERCEL_SCOPE = 'raymond-guos-projects-88b45d26';
const VERCEL_PROJECT = 'plugplan-sg';
const VERCEL_DOMAIN = 'plugplan-sg.vercel.app';

const text = readFileSync(envFile, 'utf8');
const read = (key) => text.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '');
const email = read('OneMap_Email');
const password = read('OneMap_Password');
if (!email || !password) throw new Error('OneMap_Email / OneMap_Password missing from credentials.env');

const res = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ email, password }),
});
const body = await res.json().catch(() => ({}));
const token = body.access_token;
if (!res.ok || !token) throw new Error(`OneMap getToken failed (${res.status}): ${body.error ?? JSON.stringify(body)}`);

const expiry = new Date(Number(body.expiry_timestamp) * 1000);
const updated = /^OneMap_API=.*$/m.test(text)
  ? text.replace(/^OneMap_API=.*$/m, `OneMap_API=${token}`)
  : `${text.trimEnd()}\nOneMap_API=${token}\n`;
writeFileSync(envFile, updated);
console.log(`✔ New OneMap token saved to credentials.env (expires ${expiry.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' })} SGT)`);

// Quick live check against the search API the app uses.
const probe = new URL('https://www.onemap.gov.sg/api/common/elastic/search');
probe.search = new URLSearchParams({ searchVal: 'NTU', returnGeom: 'Y', getAddrDetails: 'Y', pageNum: '1' }).toString();
const probeRes = await fetch(probe, { headers: { Authorization: token } });
console.log(probeRes.ok ? '✔ OneMap search works with the new token' : `✖ OneMap search returned ${probeRes.status}`);

if (!process.argv.includes('--vercel')) {
  console.log('Skipped Vercel. Re-run with --vercel to update production and redeploy.');
  process.exit(0);
}

const vercel = (args, input) => {
  const r = spawnSync('npx', ['--yes', 'vercel@latest', ...args, '--scope', VERCEL_SCOPE], {
    cwd: root, shell: true, input, stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'],
  });
  return r.status === 0;
};

if (!vercel(['link', '--yes', '--project', VERCEL_PROJECT])) throw new Error('vercel link failed (run `npx vercel login` first)');
vercel(['env', 'rm', 'OneMap_API', 'production', '--yes']); // ok if it did not exist
if (!vercel(['env', 'add', 'OneMap_API', 'production'], token)) throw new Error('vercel env add failed');
console.log('✔ Vercel production OneMap_API updated');
if (!vercel(['redeploy', VERCEL_DOMAIN, '--target', 'production'])) throw new Error('vercel redeploy failed');
console.log(`✔ Redeployed https://${VERCEL_DOMAIN}`);
