/* State store. The whole platform state is one JSON document, written with
   optimistic concurrency: write(state, etag) fails with a conflict if someone
   else wrote since it was read, and the caller replays its command on the
   fresh state.

     blob    Vercel Blob (private store) — used when BLOB_READ_WRITE_TOKEN is set
     file    a JSON file on disk — local development (STATE_FILE, default .data/state.json)
     memory  per-process only — the fallback on Vercel with no Blob store linked

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

function makeStore() {
  const token = blobToken();
  if (token) return blobStore(token);
  if (process.env.STATE_FILE || !process.env.VERCEL) {
    return fileStore(process.env.STATE_FILE || path.join(__dirname, '..', '.data', 'state.json'));
  }
  return memoryStore();
}

module.exports = { makeStore, memoryStore, fileStore, blobToken, Conflict };
