/* Supabase store: run against a fake Supabase REST API (PostgREST) that keeps
   one table in memory and behaves as the real one does for the requests the
   store makes — filters, insert, upsert, conditional update, missing table. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const URL_ = 'https://demo-project.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiJ9.service-role.sig';

function fakeSupabase({ tableExists = true } = {}) {
  const rows = new Map();
  const calls = [];
  const reply = (status, body) => ({ status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
  async function fetch(url, { method, headers, body }) {
    const u = new URL(url);
    calls.push({ method, path: u.pathname, qs: u.search, headers, bytes: body ? body.length : 0 });
    if (headers.apikey !== KEY) return reply(401, { message: 'Invalid API key' });
    if (!tableExists) return reply(404, { code: 'PGRST205', message: "Could not find the table 'public.ad2_state' in the schema cache" });
    const eq = k => { const v = u.searchParams.get(k); return v && v.startsWith('eq.') ? decodeURIComponent(v.slice(3)) : null; };
    const pick = (row, sel) => Object.fromEntries((sel || 'id,doc,etag').split(',').map(c => [c, row[c]]));
    const sel = u.searchParams.get('select');
    if (method === 'GET') {
      const row = rows.get(eq('id'));
      return reply(200, row ? [pick(row, sel)] : []);
    }
    const data = JSON.parse(body);
    const prefer = headers.Prefer || '';
    if (method === 'POST') {
      if (rows.has(data.id) && !/merge-duplicates/.test(prefer)) return reply(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
      rows.set(data.id, JSON.parse(JSON.stringify(data)));
      return reply(201);
    }
    if (method === 'PATCH') {
      const row = rows.get(eq('id'));
      if (!row || row.etag !== eq('etag')) return reply(200, []);
      Object.assign(row, JSON.parse(JSON.stringify(data)));
      return reply(200, [pick(row, sel)]);
    }
    return reply(405, { message: 'no' });
  }
  return { fetch, rows, calls };
}

const { supabaseStore, Conflict } = require('../server/store');

test('supabase store: create, read, conditional update, conflicts, reset', async () => {
  const sb = fakeSupabase();
  const s = supabaseStore({ url: URL_, key: KEY }, { fetch: sb.fetch });
  assert.equal(s.kind, 'supabase');
  assert.deepEqual(await s.read(), { state: null, etag: null });

  const e1 = await s.write({ n: 1 }, null);
  await assert.rejects(s.write({ n: 'late' }, null), e => e instanceof Conflict, 'a second create is a conflict');
  const r1 = await s.read();
  assert.deepEqual(r1, { state: { n: 1 }, etag: e1 });

  const e2 = await s.write({ n: 2 }, e1);
  assert.notEqual(e2, e1, 'every write stamps a new etag');
  await assert.rejects(s.write({ n: 'stale' }, e1), e => e instanceof Conflict, 'a write on a stale etag is a conflict');
  assert.equal(sb.rows.get('ad2-trade').doc.n, 2, 'the stale write did not land');

  const e3 = await s.write({ n: 'reset' }, 'whatever', { force: true });
  assert.equal(sb.rows.get('ad2-trade').etag, e3, 'a reset overwrites whatever is there');

  /* the key goes in apikey, and in Authorization only when it is a JWT */
  assert.ok(sb.calls.every(c => c.headers.apikey === KEY && c.headers.Authorization === 'Bearer ' + KEY));
  const s2 = supabaseStore({ url: URL_, key: 'sb_secret_abc' }, { fetch: async (u, o) => { assert.ok(!o.headers.Authorization); return { status: 200, text: async () => '[]' }; } });
  await s2.read();
});

test('supabase store: a poll fetches only the etag unless the document changed', async () => {
  const sb = fakeSupabase();
  const a = supabaseStore({ url: URL_, key: KEY }, { fetch: sb.fetch });
  const b = supabaseStore({ url: URL_, key: KEY }, { fetch: sb.fetch });   // a second server instance
  const big = { rows: 'x'.repeat(50000) };
  await a.write(big, null);
  await b.read();
  sb.calls.length = 0;
  const again = await b.read();
  assert.equal(again.state.rows.length, 50000);
  assert.deepEqual(sb.calls.map(c => c.qs), ['?id=eq.ad2-trade&select=etag'], 'an unchanged state costs one tiny request');
  /* another instance writes: the next read notices and fetches the document */
  const { etag } = await a.read();
  await a.write({ rows: 'changed' }, etag);
  sb.calls.length = 0;
  assert.equal((await b.read()).state.rows, 'changed');
  assert.deepEqual(sb.calls.map(c => c.qs), ['?id=eq.ad2-trade&select=etag', '?id=eq.ad2-trade&select=doc,etag']);
});

test('supabase store: says what to fix when the table or key is wrong', async () => {
  const missing = supabaseStore({ url: URL_, key: KEY }, { fetch: fakeSupabase({ tableExists: false }).fetch });
  await assert.rejects(missing.read(), /Run supabase\/schema\.sql/);
  assert.match(missing.lastError, /schema\.sql/);
  const wrongKey = supabaseStore({ url: URL_, key: 'anon-key' }, { fetch: fakeSupabase().fetch });
  await assert.rejects(wrongKey.read(), /service role or secret key/);
});

test('the whole API runs on Supabase: sign in, act, reset, health', async () => {
  const sb = fakeSupabase();
  process.env.SUPABASE_URL = URL_ + '/';
  process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
  globalThis.fetch = sb.fetch;
  delete process.env.STATE_FILE;
  const app = require('../server/app');
  const call = (method, route, { body = {}, token, query = {} } = {}) =>
    app.handle({ method, route, query, body, ip: '10.7.7.7', headers: token ? { authorization: 'Bearer ' + token } : {} });

  const health = await call('GET', 'health');
  assert.equal(health.body.store, 'supabase');
  assert.equal(health.body.storeOk, true);
  assert.ok(sb.rows.get('ad2-trade'), 'the first request seeds the row');

  const token = (await call('POST', 'session', { body: { domainId: 'AD2', loginId: 'OPS', password: 'demo' } })).body.token;
  const before = sb.rows.get('ad2-trade').etag;
  const r = await call('POST', 'command', { token, body: { cmd: 'outward.execute', payload: { id: 'OR-5102' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.notEqual(sb.rows.get('ad2-trade').etag, before, 'the action is written to Supabase');
  assert.equal(sb.rows.get('ad2-trade').doc.outward.find(o => o.id === 'OR-5102').status, 'Completed');

  const reset = await call('POST', 'reset', { body: { passcode: 'demo' } });
  assert.equal(reset.status, 200);
  assert.equal(sb.rows.get('ad2-trade').doc.outward.find(o => o.id === 'OR-5102').status, 'Authorised', 'reset restores the seed in Supabase');
});
