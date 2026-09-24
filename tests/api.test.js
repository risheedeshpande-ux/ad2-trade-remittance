/* API tests against a throwaway file store. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad2-api-'));
process.env.STATE_FILE = path.join(dir, 'state.json');
delete process.env.DEMO_PASSCODE;
const app = require('../server/app');

const call = (method, route, { body = {}, query = {}, token, ip = '10.0.0.1' } = {}) =>
  app.handle({ method, route, query, body, ip, headers: token ? { authorization: 'Bearer ' + token } : {} });
const signIn = async (d, l, pw = 'demo') => {
  const r = await call('POST', 'session', { body: { domainId: d, loginId: l, password: pw } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
};

test('health reports the store', async () => {
  const r = await call('GET', 'health');
  assert.equal(r.status, 200);
  assert.equal(r.body.store, 'file');
  assert.equal(r.body.passcodeRequired, false);
});

test('sign-in: wrong password refused, tokens are verified, tampering is caught', async () => {
  const bad = await call('POST', 'session', { body: { domainId: 'AD2', loginId: 'MAKER', password: 'nope' }, ip: '10.9.9.9' });
  assert.equal(bad.status, 401);
  const token = await signIn('AD2', 'MAKER');
  const st = await call('GET', 'state', { token });
  assert.equal(st.body.user.role, 'AD2 Maker');
  const forged = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
  assert.equal((await call('GET', 'state', { token: forged })).status, 401);
  /* anonymous state carries masters but no business data */
  const pub = await call('GET', 'state');
  assert.equal(pub.body.state.smes.length, 0);
  assert.ok(pub.body.state.purposeCodes.length > 100);
});

test('throttling after repeated failures', async () => {
  for (let i = 0; i < 20; i++) await call('POST', 'session', { body: { domainId: 'AD2', loginId: 'MAKER', password: 'x' }, ip: '10.1.1.1' });
  const r = await call('POST', 'session', { body: { domainId: 'AD2', loginId: 'MAKER', password: 'demo' }, ip: '10.1.1.1' });
  assert.equal(r.status, 429);
});

test('register, approve, sign in with own password; scoping holds', async () => {
  const doc = n => ({ filename: n + '.pdf', size: '1 KB' });
  const application = {
    legalName: 'Tapi River Textiles LLP', constitution: 'Partnership', incorporationDate: '2018-01-01', regNumber: 'AAB-1234',
    address: 'Surat', domainId: 'TAPIRIVER', pan: 'AAFFT1234K', gstin: '24AAFFT1234K1Z2', iec: '0518001122',
    contactName: 'Nirav Shah', designation: 'Partner', email: 'n@tapi.example', mobile: '+91 90000 11111', industry: 'Textiles',
    description: 'Yarn', expectedVolume: 'USD 1m', requestedCurrencies: ['USD'], service: 'Import',
    banks: [{ bank: 'SBI', accountNumber: '12345678901', ifsc: 'SBIN0001234', currency: 'INR', type: 'Current', verified: true }],
    docs: { coi: doc('a'), pan: doc('b'), gst: doc('c'), iec: doc('d'), addr: doc('e') },
  };
  const sub = await call('POST', 'command', { body: { cmd: 'onboarding.submit', payload: { application, loginId: 'OWNER', password: 'Str0ngpass' } } });
  assert.equal(sub.status, 200, JSON.stringify(sub.body));
  const smeId = sub.body.result.smeId;
  /* the stored password is hashed, and never returned */
  const raw = JSON.parse(fs.readFileSync(process.env.STATE_FILE, 'utf8'));
  assert.match(raw.logins.find(l => l.domainId === 'TAPIRIVER').pw, /^scrypt\$/);
  assert.ok(!JSON.stringify(sub.body).includes('scrypt$'));
  /* demo passcode does not open a self-registered account */
  assert.equal((await call('POST', 'session', { body: { domainId: 'TAPIRIVER', loginId: 'OWNER', password: 'demo' }, ip: '10.2.2.2' })).status, 401);
  const smeTok = await signIn('TAPIRIVER', 'OWNER', 'Str0ngpass');

  const status = await call('GET', 'status', { query: { app: smeId, domain: 'TAPIRIVER' } });
  assert.equal(status.body.application.status, 'Submitted');
  assert.equal((await call('GET', 'status', { query: { app: smeId, domain: 'WRONG' } })).status, 404);

  const maker = await signIn('AD2', 'MAKER');
  const checker = await signIn('AD2', 'COMPLIANCE');
  const cfg = { permission: 'Import', currencies: ['USD'], margins: { USD: 40 },
    charges: [{ name: 'SWIFT charge', basis: 'Fixed', value: 750 }], effectiveDate: '2026-09-24' };
  assert.equal((await call('POST', 'command', { token: maker, body: { cmd: 'onboarding.review', payload: { smeId, config: cfg, submit: true } } })).status, 200);
  const denied = await call('POST', 'command', { token: maker, body: { cmd: 'onboarding.approve', payload: { smeId } } });
  assert.equal(denied.status, 403);
  const ok = await call('POST', 'command', { token: checker, body: { cmd: 'onboarding.approve', payload: { smeId } } });
  assert.equal(ok.status, 200);

  /* same token, new role: re-read on every request */
  const me = await call('GET', 'state', { token: smeTok });
  assert.equal(me.body.user.role, 'SME User');
  assert.deepEqual(me.body.state.smes.map(s => s.id), [smeId]);
  assert.ok(me.body.state.outward.every(o => o.smeId === smeId));
  /* since= short-circuits when nothing changed */
  const again = await call('GET', 'state', { token: smeTok, query: { since: String(me.body.rev) } });
  assert.equal(again.body.unchanged, true);
});

test('bad input is refused cleanly', async () => {
  const maker = await signIn('AD2', 'MAKER');
  const r = await call('POST', 'command', { token: maker, body: { cmd: 'no.such', payload: {} } });
  assert.equal(r.status, 400);
  const r2 = await call('POST', 'command', { token: maker, body: { cmd: 'outward.verify', payload: { id: 'OR-9999' } } });
  assert.equal(r2.status, 404);
  const r3 = await call('POST', 'command', { body: { cmd: 'outward.verify', payload: { id: 'OR-5106' } } });
  assert.equal(r3.status, 401);
});

test('reset needs the passcode', async () => {
  assert.equal((await call('POST', 'reset', { body: { passcode: 'wrong' }, ip: '10.3.3.3' })).status, 403);
  assert.equal((await call('POST', 'reset', { body: { passcode: 'demo' }, ip: '10.3.3.4' })).status, 200);
  const st = await call('GET', 'state', { token: await signIn('AD2', 'MAKER') });
  assert.ok(!st.body.state.smes.some(s => s.domainId === 'TAPIRIVER'));
});

test('never back in time: a caller holding a newer state is told to keep it', async () => {
  const token = await signIn('AD2', 'MAKER');
  const st = await call('GET', 'state', { token });
  const { rev, epoch } = st.body;
  assert.ok(epoch, 'state carries its epoch');
  /* the caller says it already has a later revision (a lagging instance would see this) */
  const ahead = await call('GET', 'state', { token, query: { since: String(rev + 5), epoch } });
  assert.equal(ahead.body.unchanged, true);
  assert.equal(ahead.body.stale, true);
  assert.ok(!ahead.body.state);
  /* min= never short-circuits: a user who just switched gets a full view */
  const full = await call('GET', 'state', { token, query: { min: String(rev), epoch } });
  assert.ok(full.body.state && full.body.user);
});

test('reset is authoritative and moves the revision forward', async () => {
  const token = await signIn('AD2', 'MAKER');
  const before = await call('GET', 'state', { token });
  const r = await call('POST', 'reset', { body: { passcode: 'demo' }, ip: '10.3.3.9' });
  assert.equal(r.status, 200);
  assert.ok(r.body.rev > before.body.rev, 'revision continues across a reset');
  assert.notEqual(r.body.epoch, before.body.epoch);
  assert.equal(r.body.state.smes.length, 0, 'reset answers with the public view');
  const after = await call('GET', 'state', { token: await signIn('AD2', 'MAKER') });
  assert.equal(after.body.epoch, r.body.epoch);
});
