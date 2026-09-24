/* Sessions, passwords and sign-in throttling.

   A session is a signed token (HMAC-SHA256) carrying only who signed in and
   when it expires. Role and SME are always re-read from the stored login on
   every request, so an approval or a role change takes effect immediately
   and a token can never grant more than its login currently holds. */
'use strict';
const crypto = require('crypto');

const TTL_HOURS = 12;

let devSecret = null;
function secret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  /* Stable across instances without extra configuration: derived from the
     Blob credential, which is itself secret. */
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return crypto.createHash('sha256').update('ad2-session:' + process.env.BLOB_READ_WRITE_TOKEN).digest('hex');
  }
  if (!devSecret) devSecret = crypto.randomBytes(32).toString('hex');
  return devSecret;
}

const b64u = buf => Buffer.from(buf).toString('base64url');
const sign = data => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

function issueToken(login, now = Date.now()) {
  const body = b64u(JSON.stringify({ d: login.domainId, l: login.loginId, iat: now, exp: now + TTL_HOURS * 3600000 }));
  return body + '.' + sign(body);
}

function readToken(token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expect = sign(body);
  const a = Buffer.from(mac), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!p || typeof p.exp !== 'number' || p.exp < now) return null;
  return { domainId: String(p.d), loginId: String(p.l) };
}

/* scrypt with a per-password salt. */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
function verifyPassword(pw, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const [, s, h] = stored.split('$');
  const expect = Buffer.from(h, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), expect.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, expect);
}

/* Demo accounts share one passcode. Set DEMO_PASSCODE on the deployment to
   keep a public link from being operated by anyone who finds it. */
const passcode = () => process.env.DEMO_PASSCODE || 'demo';
const passcodeRequired = () => !!process.env.DEMO_PASSCODE;
function checkPasscode(pw) {
  const a = crypto.createHash('sha256').update(String(pw || '')).digest();
  const b = crypto.createHash('sha256').update(passcode()).digest();
  return crypto.timingSafeEqual(a, b);
}

/* Simple per-instance throttle: 20 failed sign-ins per IP per 10 minutes. */
const failures = new Map();
const WINDOW = 10 * 60 * 1000, LIMIT = 20;
function throttled(ip, now = Date.now()) {
  const f = failures.get(ip);
  if (!f || f.reset < now) return false;
  return f.count >= LIMIT;
}
function recordFailure(ip, now = Date.now()) {
  const f = failures.get(ip);
  if (!f || f.reset < now) failures.set(ip, { count: 1, reset: now + WINDOW });
  else f.count += 1;
  if (failures.size > 5000) failures.clear();
}
const clearFailures = ip => failures.delete(ip);

module.exports = { issueToken, readToken, hashPassword, verifyPassword, checkPasscode, passcodeRequired,
                   throttled, recordFailure, clearFailures };
