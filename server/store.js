/* State store. The whole platform state is one JSON document, written with
   optimistic concurrency: write(state, etag) fails with a conflict if someone
   else wrote since it was read, and the caller replays its command on the
   fresh state.

     supabase  a row in Supabase Postgres — used when SUPABASE_URL and a server key are set
     blob      Vercel Blob (private store) — used when BLOB_READ_WRITE_TOKEN is set
     file      a JSON file on disk — local development (STATE_FILE, default .data/state.json)
     memory    per-process only — the fallback on Vercel with no store connected

   STATE_STORE=supabase|blob|file|memory picks one explicitly when more than
   one is configured; otherwise the first configured in the order above.

   A relational database can replace this module without touching the engine:
   it only needs read() and write() with the same conflict behaviour. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Conflict extends Error { constructor() { super('conflict'); this.conflict = true; } }

const etagOf = text => crypto.createHash('sha1').update(text).digest('hex');

function memoryStore() {
  let text = null;
  return {
    kind: 'memory', persistent: false,
    async read() { return text ? { state: JSON.parse(text), etag: etagOf(text) } : { state: null, etag: null }; },
    async write(state, etag, opts) {
      if (!(opts && opts.force) && (text ? etagOf(text) : null) !== etag) throw new Conflict();
      text = JSON.stringify(state);
      return etagOf(text);
    },
  };
}

function fileStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const readText = () => { try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; } };
  return {
    kind: 'file', persistent: true,
    async read() { const t = readText(); return t ? { state: JSON.parse(t), etag: etagOf(t) } : { state: null, etag: null }; },
    async write(state, etag, opts) {
      const cur = readText();
      if (!(opts && opts.force) && (cur ? etagOf(cur) : null) !== etag) throw new Conflict();
      const t = JSON.stringify(state);
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, t);
      fs.renameSync(tmp, file);
      return etagOf(t);
    },
  };
}

/* The Blob token may be under the default name or a custom prefix chosen
   when the store was connected (e.g. STORAGE_BLOB_READ_WRITE_TOKEN). */
function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const k = Object.keys(process.env).find(k => /BLOB_READ_WRITE_TOKEN$/.test(k) && process.env[k]);
  return k ? process.env[k] : null;
}

/* Works with a private or a public Blob store: tries private first and
   switches to public if the store refuses private access. In public mode
   the path carries a hash of the token so it cannot be guessed. */
function blobStore(token) {
  const blob = require('@vercel/blob');
  const base = process.env.STATE_PREFIX || 'ad2-trade';
  const secretPath = base + '-' + crypto.createHash('sha256').update('path:' + token).digest('hex').slice(0, 24);
  let access = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';
  const pathname = () => (access === 'public' ? secretPath : base) + '/state.json';
  /* Public blobs are served through a CDN that caches for up to a minute, so
     a plain read can return an old state — the cause of actions that seemed
     not to stick and resets that seemed not to happen. Read the public copy
     with a unique query string so the CDN has to fetch the current one. */
  const storeId = String(token).split('_')[3] || '';
  const target = () => access === 'public' && storeId
    ? `https://${storeId}.public.blob.vercel-storage.com/${pathname()}?fresh=${Date.now()}${Math.random().toString(36).slice(2, 6)}`
    : pathname();
  const accessProblem = e => /access|public|private/i.test(String(e && e.message)) && !(e instanceof blob.BlobPreconditionFailedError);
  const store = {
    kind: 'blob', persistent: true, lastError: null,
    get access() { return access; },
    async read() {
      try {
        let r;
        try { r = await blob.get(target(), { access, useCache: false, token, headers: { 'cache-control': 'no-cache' } }); }
        catch (e) {
          if (e instanceof blob.BlobNotFoundError) return { state: null, etag: null };
          if (access === 'private' && accessProblem(e)) { access = 'public'; return store.read(); }
          throw e;
        }
        if (!r || r.statusCode !== 200) return { state: null, etag: null };
        const text = await new Response(r.stream).text();
        store.lastError = null;
        return { state: JSON.parse(text), etag: r.blob.etag };
      } catch (e) { store.lastError = String(e && e.message || e); throw e; }
    },
    async write(state, etag, wopts) {
      const opts = { access, contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60, token };
      if (wopts && wopts.force) opts.allowOverwrite = true;
      else if (etag) { opts.ifMatch = etag; opts.allowOverwrite = true; } else { opts.allowOverwrite = false; }
      try {
        const res = await blob.put(pathname(), JSON.stringify(state), opts);
        store.lastError = null;
        return res.etag;
      } catch (e) {
        if (e instanceof blob.BlobPreconditionFailedError || /already exists|precondition/i.test(String(e && e.message))) throw new Conflict();
        if (access === 'private' && accessProblem(e)) { access = 'public'; return store.write(state, null, wopts); }
        store.lastError = String(e && e.message || e);
        throw e;
      }
    },
  };
  return store;
}

/* Supabase: the Vercel integration sets SUPABASE_URL and
   SUPABASE_SERVICE_ROLE_KEY; a project using the newer API keys has a
   secret key (sb_secret_…) instead. Either works. */
function supabaseConfig() {
  const env = process.env;
  const url = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
  return url && key ? { url: String(url).replace(/\/+$/, ''), key: String(key) } : null;
}

/* The whole state is one row of a table (supabase/schema.sql). Every write
   stamps a fresh etag, and an update only lands where the row still carries
   the etag it was read with — the same optimistic concurrency as the Blob
   store. It talks to the Supabase REST API with fetch, so there is no client
   library to install. Only a server key can reach the table. */
function supabaseStore({ url, key }, { fetch: doFetch = globalThis.fetch, table = process.env.SUPABASE_TABLE || 'ad2_state' } = {}) {
  const id = process.env.STATE_PREFIX || 'ad2-trade';
  const base = `${url}/rest/v1/${encodeURIComponent(table)}`;
  const byId = 'id=eq.' + encodeURIComponent(id);
  /* legacy service-role keys are JWTs and go in Authorization too; the newer
     secret keys go in apikey only */
  const headers = prefer => ({ apikey: key, ...(/^eyJ/.test(key) ? { Authorization: 'Bearer ' + key } : {}),
    'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) });

  async function call(method, qs, { body, prefer } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await doFetch(qs ? `${base}?${qs}` : base, { method, headers: headers(prefer),
        body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (e) { data = { message: text.slice(0, 200) }; }
      return { status: res.status, data };
    } finally { clearTimeout(timer); }
  }
  const problem = (r, what) => {
    const d = (r.data && typeof r.data === 'object') ? r.data : {};
    if (d.code === 'PGRST205' || d.code === '42P01' || /could not find the table|does not exist/i.test(d.message || ''))
      return new Error(`Supabase table "${table}" not found. Run supabase/schema.sql in the Supabase SQL editor.`);
    if (r.status === 401 || r.status === 403)
      return new Error('Supabase refused the key. Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) to the service role or secret key, not the anon key.');
    return new Error(`Supabase ${what} failed (${r.status}${d.message ? ': ' + d.message : ''}).`);
  };
  const fail = (r, what) => { const e = problem(r, what); store.lastError = e.message; throw e; };
  const first = r => (Array.isArray(r.data) ? r.data[0] : null) || null;

  /* The last document this instance read or wrote. Browsers poll every few
     seconds, so a read first asks only for the etag (a few bytes) and fetches
     the ~150 KB document only when it has changed. Callers never mutate what
     read() returns: a command works on a copy. */
  let last = null;
  const store = {
    kind: 'supabase', persistent: true, lastError: null,
    async read() {
      if (last) {
        const r = await call('GET', `${byId}&select=etag`);
        if (r.status !== 200) fail(r, 'read');
        const row = first(r);
        if (row && row.etag === last.etag) { store.lastError = null; return { state: last.doc, etag: last.etag }; }
        if (!row) { last = null; store.lastError = null; return { state: null, etag: null }; }
      }
      const r = await call('GET', `${byId}&select=doc,etag`);
      if (r.status !== 200) fail(r, 'read');
      store.lastError = null;
      const row = first(r);
      last = row ? { doc: row.doc, etag: row.etag } : null;
      return row ? { state: row.doc, etag: row.etag } : { state: null, etag: null };
    },
    async write(state, etag, opts) {
      const tag = crypto.randomBytes(12).toString('hex');
      const at = new Date().toISOString();
      let r;
      if (opts && opts.force) {
        /* a reset: overwrite whatever is there */
        r = await call('POST', 'on_conflict=id', { body: { id, doc: state, etag: tag, updated_at: at }, prefer: 'resolution=merge-duplicates,return=minimal' });
        if (r.status >= 300) fail(r, 'write');
      } else if (!etag) {
        /* the first write: only if no one has created the row meanwhile */
        r = await call('POST', '', { body: { id, doc: state, etag: tag, updated_at: at }, prefer: 'return=minimal' });
        if (r.status === 409) throw new Conflict();
        if (r.status >= 300) fail(r, 'write');
      } else {
        r = await call('PATCH', `${byId}&etag=eq.${encodeURIComponent(etag)}&select=etag`, { body: { doc: state, etag: tag, updated_at: at }, prefer: 'return=representation' });
        if (r.status >= 300) fail(r, 'write');
        if (!Array.isArray(r.data) || !r.data.length) throw new Conflict();   // someone wrote since we read
      }
      store.lastError = null;
      last = { doc: state, etag: tag };
      return tag;
    },
  };
  return store;
}

/* A secret the deployment already holds, to derive the session-signing key
   from when SESSION_SECRET is not set. */
function storeSecret() {
  const sb = supabaseConfig();
  return blobToken() || (sb && sb.key) || null;
}

function makeStore() {
  const pick = String(process.env.STATE_STORE || '').toLowerCase();
  const sb = supabaseConfig(), token = blobToken();
  const file = () => fileStore(process.env.STATE_FILE || path.join(__dirname, '..', '.data', 'state.json'));
  if (pick === 'supabase' && sb) return supabaseStore(sb);
  if (pick === 'blob' && token) return blobStore(token);
  if (pick === 'file') return file();
  if (pick === 'memory') return memoryStore();
  if (sb) return supabaseStore(sb);
  if (token) return blobStore(token);
  if (process.env.STATE_FILE || !process.env.VERCEL) return file();
  return memoryStore();
}

module.exports = { makeStore, memoryStore, fileStore, supabaseStore, blobToken, storeSecret, Conflict };
