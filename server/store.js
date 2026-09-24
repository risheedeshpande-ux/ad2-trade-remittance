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
    async write(state, etag) {
      if ((text ? etagOf(text) : null) !== etag) throw new Conflict();
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
    async write(state, etag) {
      const cur = readText();
      if ((cur ? etagOf(cur) : null) !== etag) throw new Conflict();
      const t = JSON.stringify(state);
      const tmp = file + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, t);
      fs.renameSync(tmp, file);
      return etagOf(t);
    },
  };
}

function blobStore(token) {
  const blob = require('@vercel/blob');
  const pathname = (process.env.STATE_PREFIX || 'ad2-trade') + '/state.json';
  return {
    kind: 'blob', persistent: true,
    async read() {
      let r;
      try { r = await blob.get(pathname, { access: 'private', useCache: false, token }); }
      catch (e) { if (e instanceof blob.BlobNotFoundError) return { state: null, etag: null }; throw e; }
      if (!r || r.statusCode !== 200) return { state: null, etag: null };
      const text = await new Response(r.stream).text();
      return { state: JSON.parse(text), etag: r.blob.etag };
    },
    async write(state, etag) {
      const opts = { access: 'private', contentType: 'application/json', addRandomSuffix: false,
                     cacheControlMaxAge: 60, token };
      if (etag) { opts.ifMatch = etag; opts.allowOverwrite = true; } else { opts.allowOverwrite = false; }
      try {
        const res = await blob.put(pathname, JSON.stringify(state), opts);
        return res.etag;
      } catch (e) {
        if (e instanceof blob.BlobPreconditionFailedError || /already exists|precondition/i.test(String(e && e.message))) throw new Conflict();
        throw e;
      }
    },
  };
}

function makeStore() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return blobStore(process.env.BLOB_READ_WRITE_TOKEN);
  if (process.env.STATE_FILE || !process.env.VERCEL) {
    return fileStore(process.env.STATE_FILE || path.join(__dirname, '..', '.data', 'state.json'));
  }
  return memoryStore();
}

module.exports = { makeStore, memoryStore, fileStore, Conflict };
