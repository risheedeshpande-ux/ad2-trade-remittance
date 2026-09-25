/* HTTP API. Framework-free so the same code serves Vercel functions (api/)
   and the local development server (server.js).

     GET  /api/health                  mode, store and whether a passcode is needed
     POST /api/session                 sign in -> { token, user }
                                       { as } with a master test session -> the target's session
     GET  /api/state[?since=rev]       the caller's view of the platform
     POST /api/command                 { cmd, payload } -> run one engine command
     GET  /api/status?app=&domain=     public application tracker
     POST /api/reset                   { passcode } -> reseed the demo            */
'use strict';
const Engine = require('../public/engine.js');
const { SEED } = require('../public/data.js');
const auth = require('./auth');
const { makeStore } = require('./store');

const clone = o => JSON.parse(JSON.stringify(o));
const MAX_BODY = 400 * 1024;

let store = null;
const getStore = () => (store = store || makeStore());

/* A short-lived read cache keeps polling cheap. Every command re-reads the
   store before it writes, so the cache can never cause a lost update. */
let cache = null;           // { state, etag, at }
const CACHE_MS = 4000;

/* A state is newer than another if it was seeded later (epoch), or it is the
   same seeding with a higher revision. Revisions carry on across a reset, so
   either test alone would do; both together survive a wiped store too. */
const newer = (a, b) => !b || (a.epoch || '') > (b.epoch || '') || ((a.epoch || '') === (b.epoch || '') && (a.rev || 0) > (b.rev || 0));

async function readState({ fresh } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache;
  const s = getStore();
  let { state, etag } = await s.read();
  if (!state || state.version !== SEED.version) {
    const seeded = Engine.freshState(SEED, null, { rev: state ? (state.rev || 0) + 1 : 0 });
    try { etag = await s.write(seeded, etag); state = seeded; }
    catch (e) { if (!e.conflict) throw e; ({ state, etag } = await s.read()); }
  }
  /* A lagging read (a CDN copy, another instance) never replaces a newer
     state this instance has already seen. */
  if (cache && newer(cache.state, state)) return cache;
  cache = { state, etag, at: Date.now() };
  return cache;
}

/* Run one command against a fresh read and write it back. If someone wrote
   first, or the read lagged, wait a moment and replay it on a fresh read.
   Returns { next, result }, or null if the store stayed busy. */
async function commit(w, cmd, payload) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { state, etag } = await readState({ fresh: true });
    const next = clone(state);
    const result = Engine.execute(next, w, cmd, payload, { now: new Date().toISOString(), hashPassword: auth.hashPassword });
    try {
      const newTag = await getStore().write(next, etag);
      cache = { state: next, etag: newTag, at: Date.now() };
      return { next, result };
    } catch (e) {
      if (!e.conflict) throw e;
      cache = null;
      await new Promise(r => setTimeout(r, 120 * (attempt + 1)));
    }
  }
  return null;
}

const json = (status, body, extra) => ({ status, body, headers: extra || {} });
const errorOut = e => {
  if (e instanceof Engine.EngineError) return json(e.status, { error: e.message, code: e.code, details: e.details || [] });
  console.error(e);
  const msg = String(e && e.message || e).slice(0, 200);
  return json(500, { error: 'The server could not complete this (' + msg + '). Try again, or check the Blob store connection.', code: 'server' });
};

function who(headers) {
  const h = headers['authorization'] || headers['Authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return { ok: true, who: null };
  const t = auth.readToken(m[1].trim());
  return t ? { ok: true, who: t } : { ok: false };
}
const publicUser = (db, w) => {
  if (!w) return null;
  try {
    const a = Engine.resolveActor(db, w, null);
    return { domainId: a.domainId, loginId: a.loginId, role: a.role, smeId: a.smeId, name: a.name };
  } catch (e) { return null; }
};

async function handle({ method, route, query, headers, body, ip }) {
  try {
    if (route === 'health' && method === 'GET') {
      const s = getStore();
      let storeOk = true, storeError = null;
      try { await readState(); } catch (e) { storeOk = false; storeError = String(e && e.message || e).slice(0, 300); }
      return json(200, { ok: true, mode: 'server', store: s.kind, access: s.access || null, persistent: s.persistent, storeOk, storeError,
                         passcodeRequired: auth.passcodeRequired(), seedVersion: SEED.version, time: new Date().toISOString() });
    }

    if (route === 'status' && method === 'GET') {
      const { state } = await readState();
      const r = Engine.publicStatus(state, query.app, query.domain);
      return r ? json(200, { application: r }) : json(404, { error: 'No application matches that Application ID and Domain ID.', code: 'not_found' });
    }

    if (route === 'session' && method === 'POST' && body.as) {
      /* The master test user opens the platform as another user. The engine
         checks the capability and audits the switch; the session issued is
         the target's own, so it carries only that user's authority. */
      const w = who(headers);
      if (!w.ok || !w.who) return json(401, { error: 'Your session has expired. Sign in again.', code: 'auth' });
      const target = { domainId: String(body.as.domainId || '').trim().toUpperCase().slice(0, 20),
                       loginId: String(body.as.loginId || '').trim().toUpperCase().slice(0, 20) };
      const out = await commit(w.who, 'test.actAs', target);
      if (!out) return json(409, { error: 'The platform is busy. Try again.', code: 'conflict' });
      const login = out.next.logins.find(l => l.domainId === target.domainId && l.loginId === target.loginId);
      return json(200, { ok: true, result: out.result, token: auth.issueToken(login), user: publicUser(out.next, target),
                         rev: out.next.rev, epoch: out.next.epoch, state: Engine.scopeState(out.next, target) });
    }

    if (route === 'session' && method === 'POST') {
      if (auth.throttled(ip)) return json(429, { error: 'Too many sign-in attempts. Wait a few minutes and try again.', code: 'throttled' });
      const domainId = String(body.domainId || '').trim().toUpperCase().slice(0, 20);
      const loginId = String(body.loginId || '').trim().toUpperCase().slice(0, 20);
      const password = String(body.password || '').slice(0, 200);
      const { state } = await readState({ fresh: true });
      const login = state.logins.find(l => l.domainId === domainId && l.loginId === loginId);
      const ok = login && (login.pw ? auth.verifyPassword(password, login.pw) : (login.demo && auth.checkPasscode(password)));
      if (!ok) {
        auth.recordFailure(ip);
        return json(401, { error: 'Domain ID, Login ID or password is incorrect.', code: 'auth' });
      }
      auth.clearFailures(ip);
      if (login.active === false) return json(403, { error: 'This user has been deactivated. Contact your administrator.', code: 'forbidden' });
      const sme = login.smeId && state.smes.find(s => s.id === login.smeId);
      if (sme && sme.status === 'Rejected') return json(403, { error: 'This application was rejected. Access is not available.', code: 'forbidden' });
      return json(200, { token: auth.issueToken(login), user: publicUser(state, login) });
    }

    if (route === 'state' && method === 'GET') {
      const w = who(headers);
      if (!w.ok) return json(401, { error: 'Your session has expired. Sign in again.', code: 'auth' });
      let { state } = await readState();
      /* The caller already holds a newer state than this instance has: read
         the store again, and if it still lags, tell the caller to keep what
         it has rather than send it back in time. */
      const floor = query.since != null ? query.since : query.min;
      const theirs = floor != null ? { rev: Number(floor), epoch: query.epoch || state.epoch } : null;
      if (theirs && newer(theirs, state)) {
        ({ state } = await readState({ fresh: true }));
        if (newer(theirs, state)) return json(200, { unchanged: true, stale: true, rev: theirs.rev, epoch: theirs.epoch });
      }
      if (query.since != null && String(state.rev) === String(query.since) && (!query.epoch || query.epoch === state.epoch))
        return json(200, { unchanged: true, rev: state.rev, epoch: state.epoch });
      const user = publicUser(state, w.who);
      if (w.who && !user) return json(401, { error: 'Your session is no longer valid. Sign in again.', code: 'auth' });
      return json(200, { rev: state.rev, epoch: state.epoch, state: Engine.scopeState(state, w.who), user });
    }

    if (route === 'command' && method === 'POST') {
      const w = who(headers);
      if (!w.ok) return json(401, { error: 'Your session has expired. Sign in again.', code: 'auth' });
      const cmd = String(body.cmd || '');
      if (!Engine.COMMANDS.includes(cmd)) return json(400, { error: 'Unknown action.', code: 'unknown' });
      const payload = body.payload && typeof body.payload === 'object' ? body.payload : {};
      const out = await commit(w.who, cmd, payload);
      if (!out) return json(409, { error: 'The platform is busy. Try again.', code: 'conflict' });
      const { next, result } = out;
      return json(200, { ok: true, result, rev: next.rev, epoch: next.epoch, state: Engine.scopeState(next, w.who), user: publicUser(next, w.who) });
    }

    if (route === 'reset' && method === 'POST') {
      if (auth.throttled(ip)) return json(429, { error: 'Too many attempts. Wait a few minutes.', code: 'throttled' });
      if (!auth.checkPasscode(body.passcode)) { auth.recordFailure(ip); return json(403, { error: 'The demo passcode is incorrect.', code: 'forbidden' }); }
      const s = getStore();
      let prev = null;
      try { prev = (await readState({ fresh: true })).state; } catch (e) { prev = null; }
      /* A reset is authoritative: it overwrites whatever is stored, and its
         revision continues from the state it replaces. */
      const seeded = Engine.freshState(SEED, null, { rev: ((prev && prev.rev) || 0) + 1 });
      const newTag = await s.write(seeded, null, { force: true });
      cache = { state: seeded, etag: newTag, at: Date.now() };
      return json(200, { ok: true, rev: seeded.rev, epoch: seeded.epoch, state: Engine.scopeState(seeded, null), user: null, message: 'Demo data reset.' });
    }

    return json(404, { error: 'Not found.', code: 'not_found' });
  } catch (e) {
    return errorOut(e);
  }
}

/* Node (req, res) adapter used by both Vercel and server.js. */
async function nodeHandler(req, res, route) {
  const url = new URL(req.url, 'http://local');
  const query = Object.fromEntries(url.searchParams.entries());
  let body = {};
  if (req.method === 'POST') {
    try {
      if (req.body !== undefined) {
        body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString('utf8') || '{}') : req.body);
      } else {
        const chunks = []; let size = 0;
        for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new Error('too large'); chunks.push(c); }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      }
      if (JSON.stringify(body).length > MAX_BODY) throw new Error('too large');
    } catch (e) {
      return send(res, json(400, { error: 'The request body is not valid JSON or is too large.', code: 'invalid' }));
    }
    if (!body || typeof body !== 'object') body = {};
  }
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const out = await handle({ method: req.method, route, query, headers: req.headers, body, ip });
  send(res, out);
}
function send(res, out) {
  res.statusCode = out.status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  Object.entries(out.headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(out.body));
}

const route = name => (req, res) => nodeHandler(req, res, name);

module.exports = { handle, nodeHandler, route, _reset: () => { store = null; cache = null; } };
