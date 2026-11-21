/* Rate modes: each SME prices one of three ways (live lock, bank applies the
   rate, assigned or requested), set by an admin-defined preset. These tests
   hold the per-mode command matrix, the bank-priced flow end to end, the
   terms a request keeps, and the codes every new refusal carries. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('../public/engine.js');
const { SEED } = require('../public/data.js');
Object.assign(SEED.settings, { marketSim: false, ibrSpreadPct: 0, deskMarginPaise: 0 });
const T = Engine.treasury;

const NOW = '2026-09-24T06:00:00.000Z';
const later = h => new Date(Date.parse(NOW) + h * 3600000).toISOString();
const who = (d, l) => ({ domainId: d, loginId: l });
const MER = who('MERIDIANTEX', 'SMEUSER');
const MAKER = who('AD2', 'MAKER'), MAKER2 = who('AD2', 'MAKER2'), CHECKER = who('AD2', 'CHECKER'), OPS = who('AD2', 'OPS');
const DEALER = who('AD2', 'DEALER'), ADMIN = who('AD2', 'ADMIN');
const run = (db, w, cmd, p, now = NOW) => Engine.execute(db, w, cmd, p, { now, hashPassword: pw => 'plain$' + pw });
const refuses = (fn, code, re) => assert.throws(fn, e => e instanceof Engine.EngineError && (!code || e.code === code) && (!re || re.test(e.message)),
  `expected ${code || 'a refusal'}${re ? ' ' + re : ''}`);
const doc = n => ({ filename: n + '.pdf', size: '100 KB', type: 'application/pdf' });
const DEC = { fema: true, ofac: true };
const CHECKS = { documents: true, sanctions: true, purpose: true, beneficiary: true };
const payment = over => ({ beneficiaryId: 'BEN-001', beneficiary: 'Filatura Ponti S.p.A.', beneficiaryCountry: 'Italy',
  beneficiaryAccount: 'IT60X0542811101000000123456', beneficiaryBank: 'Intesa Sanpaolo', beneficiaryBankCountry: 'Italy', swift: 'BCITITMM',
  currency: 'EUR', amount: 45000, remittanceType: 'DIR', purposeCode: 'S0102', executionDate: '2026-09-25', debitAccountId: 'BA-001',
  allocations: [{ billId: 'BL-24014', amount: 45000 }], docs: { transport: doc('t'), invoice: doc('i'), boe: doc('b') }, declarations: DEC, ...over });
const pos = (db, id) => db.positions.find(p => p.id === id);
const out = (db, id) => db.outward.find(o => o.id === id);
const preset = (db, id) => db.ratePresets.find(p => p.id === id);
/* Meridian on a given preset (RP-1 live, RP-2 bank, RP-3 negotiated) */
const fresh = (presetId = 'RP-1') => {
  const db = Engine.freshState(SEED, NOW);
  db.smes.find(s => s.id === 'SME-1001').config.ratePreset = presetId;
  return db;
};
const openPositions = (db, recId) => db.positions.filter(p => p.recordId === recId && ['Open', 'Attached', 'Held'].includes(p.status));

test('seed: three presets, one default, and the demo SMEs cover every mode', () => {
  const db = Engine.freshState(SEED, NOW);
  assert.equal(db.ratePresets.length, T.MAX_PRESETS);
  assert.equal(db.ratePresets.filter(p => p.isDefault).length, 1);
  db.ratePresets.forEach(p => assert.ok(T.RATE_MODES[p.mode], p.id + ' uses a known mode id'));
  const mode = id => T.rateTerms(db, db.smes.find(s => s.id === id)).mode;
  assert.deepEqual([mode('SME-1001'), mode('SME-1002'), mode('SME-1003')], ['live', 'negotiated', 'bank']);
  assert.ok(!('rfqThresholdUsd' in db.settings) && !('rfqValidMin' in db.settings), 'the global RFQ switches are gone');
  assert.ok(!db.deals.some(d => d.smeId === 'SME-1003' && d.status === 'Issued'), 'no deals are issued to a bank-priced customer');
});

test('no reader of the removed RFQ settings remains', () => {
  const root = path.join(__dirname, '..');
  const files = d => fs.readdirSync(path.join(root, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)]);
  const hits = ['public', 'server', 'tests'].flatMap(files).filter(f => /\.js$/.test(f) && !f.endsWith('ratemodes.test.js'))
    .filter(f => /rfqThresholdUsd|rfqValidMin/.test(fs.readFileSync(path.join(root, f), 'utf8')));
  assert.deepEqual(hits, []);
});

test('command matrix: live lock — the customer locks and submits; no rate requests', () => {
  const db = fresh('RP-1');
  const b = run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 45000 });
  assert.equal(pos(db, b.positionId).lockHours, 48);
  refuses(() => run(db, MER, 'rate.request', { dir: 'out', currency: 'EUR', amount: 1000 }), 'mode_forbids', /Lock the live rate/);
  refuses(() => run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'pending' } }) }));
  const id = run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'booked', positionId: b.positionId } }) }).id;
  assert.equal(out(db, id).rateMode, 'live');
  /* inline booking at submit is allowed too */
  const db2 = fresh('RP-1');
  const id2 = run(db2, MER, 'outward.submit', { draft: payment({ rate: { mode: 'booked' } }) }).id;
  assert.equal(out(db2, id2).rate.mode, 'booked');
});

test('live lock: the preset lock validity applies (24 hours)', () => {
  const db = fresh('RP-1');
  preset(db, 'RP-1').options.lockValidityHours = 24;
  const b = run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 1000 });
  assert.equal(b.expiresAt, later(24));
  assert.match(b.message, /locked for 24 hours/);
});

test('live lock: "AD may update" off stops AD2 changing the rate; on by default', () => {
  const db = fresh('RP-1');
  const id = run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'booked' } }) }).id;
  run(db, MAKER, 'outward.updateDeal', { id, dealRef: 'PHN-001', customerRate: out(db, id).rate.customerRate + 0.1 });
  const db2 = fresh('RP-1');
  preset(db2, 'RP-1').options.adMayUpdate = false;
  const id2 = run(db2, MER, 'outward.submit', { draft: payment({ rate: { mode: 'booked' } }) }).id;
  refuses(() => run(db2, MAKER, 'outward.updateDeal', { id: id2, dealRef: 'PHN-001', customerRate: 105 }), 'mode_forbids');
});

test('live lock: the size gate sends large amounts to the dealer, below it locks live', () => {
  const db = fresh('RP-1');
  preset(db, 'RP-1').options.rfqFromUsd = 50000;
  const usd = n => T.usdOf(db, 'EUR', n);
  assert.ok(usd(45000) < 50000 || usd(40000) < 50000);
  const small = usd(45000) < 50000 ? 45000 : 40000;
  run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: small });
  /* find an amount at or above USD 50,000 */
  const big = Math.ceil(50000 / usd(1)) + 1;
  refuses(() => run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: big }), 'mode_forbids', /request the rate/);
  const r = run(db, MER, 'rate.request', { dir: 'out', currency: 'EUR', amount: big });
  assert.ok(db.rfqs.find(x => x.id === r.id));
});

test('a missing reference rate refuses the size gate instead of letting it pass', () => {
  const db = fresh('RP-1');
  preset(db, 'RP-1').options.rfqFromUsd = 50000;
  db.currencies.find(c => c.code === 'USD').refRate = 0;
  refuses(() => run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 1000 }), 'ref_rate_missing');
  assert.throws(() => T.usdOfStrict(db, 'EUR', 10), e => e.code === 'ref_rate_missing');
});

test('command matrix: bank applies the rate — submit without a rate only', () => {
  const db = fresh('RP-2');
  refuses(() => run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 1000 }), 'mode_forbids', /Submit the request without a rate/);
  refuses(() => run(db, MER, 'rate.request', { dir: 'out', currency: 'EUR', amount: 1000 }), 'mode_forbids');
  refuses(() => run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'booked' } }) }), 'mode_forbids');
  refuses(() => run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'deal', dealRef: 'FXD-77521' } }) }), 'mode_forbids');
  const id = run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'pending' } }) }).id;
  const o = out(db, id);
  assert.equal(o.rate.mode, 'pending');
  assert.equal(o.rateMode, 'bank');
  assert.equal(o.inrAmount, null); assert.equal(o.debitInr, null);
  assert.equal(openPositions(db, id).length, 0, 'no position until AD2 prices it');
  /* the customer cannot apply a deal to it either */
  refuses(() => run(db, MER, 'outward.applyDeal', { id, dealRef: 'FXD-77521' }), 'mode_forbids');
});

test('bank applies the rate end to end: maker applies the live rate, checker authorises, ops releases', () => {
  const db = fresh('RP-2');
  const id = run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'pending' } }) }).id;
  refuses(() => run(db, MAKER, 'outward.verify', { id, checks: CHECKS }), 'rate_required');
  run(db, MAKER, 'outward.verify', { id, checks: CHECKS, rate: { mode: 'live' } });
  const o = out(db, id);
  assert.equal(o.rate.mode, 'booked');
  assert.ok(o.inrAmount > 0 && o.debitInr > o.inrAmount, 'the final calculation is filled in');
  assert.ok(!o.chargesIndicative);
  assert.equal(pos(db, o.rate.positionId).status, 'Attached');
  assert.ok(db.notifications.some(n => n.toSmeId === 'SME-1001' && n.text.includes('applied the rate')));
  run(db, CHECKER, 'outward.authorise', { id });
  run(db, OPS, 'outward.execute', { id });
  assert.equal(o.status, 'Completed');
});

test('bank applies the rate: the maker may apply an issued deal or a phone deal instead', () => {
  const db = fresh('RP-2');
  const id = run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'pending' } }) }).id;
  const ref = db.currencies.find(c => c.code === 'EUR').refRate;
  run(db, MAKER, 'outward.verify', { id, checks: CHECKS, rate: { mode: 'deal', dealRef: 'PHN-7788', customerRate: ref + 0.5 } });
  assert.equal(out(db, id).rate.mode, 'deal');
  assert.equal(out(db, id).rate.dealRef, 'PHN-7788');
});

test('bank applies the rate: the checker cannot authorise without a rate', () => {
  const db = fresh('RP-2');
  const id = run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'pending' } }) }).id;
  const o = out(db, id);
  /* force the state a rate-less verified request would be in */
  o.status = 'Verified'; o.wf.verified = { key: 'AD2/MAKER', by: 'x', at: NOW };
  refuses(() => run(db, CHECKER, 'outward.authorise', { id }), 'rate_required');
});

test('bank applies the rate: a query clears the applied rate and releases its position', () => {
  const db = fresh('RP-2');
  const id = run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'pending' } }) }).id;
  run(db, MAKER, 'outward.verify', { id, checks: CHECKS, rate: { mode: 'live' } });
  const p = out(db, id).rate.positionId;
  run(db, CHECKER, 'outward.query', { id, question: 'Please confirm the invoice number.' });
  assert.equal(out(db, id).rate.mode, 'pending');
  assert.equal(pos(db, p).status, 'Cancelled');
  assert.equal(out(db, id).inrAmount, null);
  run(db, MER, 'outward.respond', { id, response: 'Invoice FP-2026-118.' });
  run(db, MAKER2, 'outward.verify', { id, checks: CHECKS, rate: { mode: 'live' } });
  assert.equal(openPositions(db, id).length, 1, 'exactly one position after re-pricing');
});

test('bank applies the rate: a second apply on the same request leaves one position', () => {
  const db = fresh('RP-2');
  const id = run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'pending' } }) }).id;
  run(db, MAKER, 'outward.updateDeal', { id, dealRef: 'PHN-0001', customerRate: db.currencies.find(c => c.code === 'EUR').refRate + 0.4 });
  run(db, MAKER2, 'outward.updateDeal', { id, dealRef: 'PHN-0002', customerRate: db.currencies.find(c => c.code === 'EUR').refRate + 0.3 });
  assert.equal(openPositions(db, id).length, 1);
});

test('bank applies the rate: the customer view carries no rate, INR or percentage charge before pricing', () => {
  const db = fresh('RP-2');
  const id = run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'pending' } }) }).id;
  const v = Engine.scopeState(db, MER);
  const s = v.smes[0];
  assert.deepEqual(s.config.customerRates, {}, 'no live rate is sent');
  assert.equal(s.config.rateTerms.mode, 'bank');
  assert.equal(s.config.rateTerms.modeName, 'Bank applies the rate');
  assert.ok(!('margins' in s.config) && !('ratePreset' in s.config));
  assert.ok(!v.ratePresets, 'presets are AD2 data');
  const o = v.outward.find(x => x.id === id);
  assert.equal(o.rate.customerRate, null); assert.equal(o.inrAmount, null); assert.equal(o.debitInr, null);
  assert.ok(o.charges.every(c => c.amount == null || c.pct == null), 'percentage charges have no amount yet');
  /* a live-lock customer still sees its rates */
  assert.ok(Object.keys(Engine.scopeState(fresh('RP-1'), MER).smes[0].config.customerRates).length);
});

test('bank applies the rate: inward disposals credit INR only once AD2 applies the rate; EEFC unaffected', () => {
  const db = fresh('RP-2');
  const docs = Engine.checklist(db, 'TRADE', 'P0102', 0, { option: 'knockoff' }).filter(x => x.required).reduce((o, x) => ({ ...o, [x.id]: doc(x.id) }), {});
  const id = run(db, MER, 'disposal.submit', { draft: { inwardId: 'IR-3303', amount: 60000, option: 'knockoff', purposeCode: 'P0102',
    allocations: [{ billId: 'BL-24003', amount: 50000 }], creditAccountId: 'BA-001', rate: { mode: 'pending' }, docs, declarations: DEC } }).id;
  const d = db.disposals.find(x => x.id === id);
  assert.equal(d.rate.mode, 'pending'); assert.equal(d.creditInr, null);
  refuses(() => run(db, MAKER, 'disposal.verify', { id, checks: { documents: true, bills: true, account: true, sanctions: true } }), 'rate_required');
  run(db, MAKER, 'disposal.verify', { id, checks: { documents: true, bills: true, account: true, sanctions: true }, rate: { mode: 'live' } });
  assert.ok(d.creditInr > 0);
  run(db, CHECKER, 'disposal.authorise', { id });
  run(db, OPS, 'disposal.process', { id });
  assert.equal(d.status, 'Processed');
});

test('command matrix: assigned or requested — deals and rate requests, no live lock', () => {
  const db = fresh('RP-3');
  refuses(() => run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 1000 }), 'mode_forbids', /request a rate/);
  refuses(() => run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'pending' } }) }));
  const r = run(db, MER, 'rate.request', { dir: 'out', currency: 'EUR', amount: 45000 });
  assert.equal(db.rfqs.find(x => x.id === r.id).quoteValidMin, 15);
  /* deals-only preset: no rate requests */
  preset(db, 'RP-3').options.allowRfq = false;
  refuses(() => run(db, MER, 'rate.request', { dir: 'out', currency: 'EUR', amount: 1000 }), 'mode_forbids', /assigned you/);
});

test('options are frozen on the request: a preset edit after submission changes new requests only', () => {
  const db = fresh('RP-3');
  const r = run(db, MER, 'rate.request', { dir: 'out', currency: 'EUR', amount: 45000 });
  run(db, ADMIN, 'presets.update', { id: 'RP-3', options: { lockValidityHours: 24, allowDeals: true, allowRfq: true, quoteValidMin: 5 } });
  run(db, DEALER, 'rfq.quote', { id: r.id, margin: 40, quoteVer: 0 });
  const q = db.rfqs.find(x => x.id === r.id);
  assert.equal(q.validUntil, new Date(Date.parse(NOW) + 15 * 60000).toISOString(), 'the open quote keeps its 15 minutes');
  const c = run(db, MER, 'rfq.confirm', { id: r.id, quoteVer: q.quoteVer });
  assert.equal(c.expiresAt, later(48), 'and its 48-hour lock');
  /* a submitted bank-priced request keeps bank pricing after its SME moves to live (X2) */
  const db2 = fresh('RP-2');
  const id = run(db2, MER, 'outward.submit', { draft: payment({ rate: { mode: 'pending' } }) }).id;
  run(db2, MAKER, 'sme.setPreset', { smeId: 'SME-1001', presetId: 'RP-1' });
  assert.equal(out(db2, id).rateMode, 'bank');
  refuses(() => run(db2, MAKER2, 'outward.verify', { id, checks: CHECKS }), 'rate_required');
});

test('preset edits: mode locked while in use, options validated, every change audited before and after', () => {
  const db = fresh('RP-1');
  refuses(() => run(db, ADMIN, 'presets.update', { id: 'RP-1', mode: 'bank' }), 'preset_in_use', /Meridian Textiles/);
  refuses(() => run(db, ADMIN, 'presets.update', { id: 'RP-3', options: { allowDeals: false, allowRfq: false } }), 'invalid_option');
  refuses(() => run(db, ADMIN, 'presets.update', { id: 'RP-2', options: { quoteValidMin: 5 } }), 'invalid_option', /quoteValidMin/);
  refuses(() => run(db, ADMIN, 'presets.update', { id: 'RP-1', options: { lockValidityHours: 100 } }), 'out_of_range', /between 1 and 72 hours/);
  refuses(() => run(db, MAKER, 'presets.update', { id: 'RP-1', name: 'X' }));
  run(db, ADMIN, 'presets.update', { id: 'RP-2', name: 'Bank-priced (SME)' });
  const line = db.audit.find(x => x.record === 'RP-2');
  assert.match(line.text || line.action || JSON.stringify(line), /before: Bank-priced .*after: Bank-priced \(SME\)/);
  /* an unused preset may change mode */
  db.smes.forEach(s => { if (s.config && s.config.ratePreset === 'RP-2') s.config.ratePreset = 'RP-1'; });
  run(db, ADMIN, 'presets.update', { id: 'RP-2', mode: 'negotiated' });
  assert.equal(preset(db, 'RP-2').options.quoteValidMin, 15);
});

test('preset moves: one SME or a whole preset; open locks keep their terms', () => {
  const db = fresh('RP-1');
  const b = run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 45000 });
  const r = run(db, MAKER, 'sme.setPreset', { smeId: 'SME-1001', presetId: 'RP-3' });
  assert.ok(r.openTerms >= 1);
  assert.match(r.message, /keep their own terms/);
  /* the open lock still submits */
  run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'booked', positionId: b.positionId } }) });
  const bulk = run(db, MAKER, 'sme.setPreset', { fromPreset: 'RP-3', presetId: 'RP-1' });
  assert.ok(bulk.moved >= 2, 'Meridian and Arcadia moved together');
  assert.ok(db.smes.filter(s => s.status === 'Approved').every(s => s.config.ratePreset !== 'RP-3'));
});

test('onboarding: the maker picks the preset, the default is pre-selected', () => {
  const db = fresh();
  const app = db.smes.find(s => ['Submitted', 'Under Review'].includes(s.status));
  if (!app) return;
  const cfg = { permission: 'Both', currencies: ['USD'], margins: { USD: 20 }, charges: [], effectiveDate: '2026-10-01', ratePreset: 'RP-3' };
  run(db, MAKER, 'onboarding.review', { smeId: app.id, config: cfg });
  assert.equal(app.pendingConfig.ratePreset, 'RP-3');
  run(db, MAKER, 'onboarding.review', { smeId: app.id, config: { ...cfg, ratePreset: undefined } });
  assert.equal(app.pendingConfig.ratePreset, 'RP-1');
  refuses(() => run(db, MAKER, 'onboarding.review', { smeId: app.id, config: { ...cfg, ratePreset: 'RP-9' } }));
});

test('branch staff acting for a bank-priced customer book directly (assisted bypass)', () => {
  const db = fresh('RP-2');
  const b = run(db, MAKER, 'rate.book', { actingFor: 'SME-1001', dir: 'out', currency: 'EUR', amount: 1000 });
  assert.ok(pos(db, b.positionId));
});

test('data from before presets prices live', () => {
  const db = fresh();
  delete db.ratePresets;
  db.smes.forEach(s => { if (s.config) delete s.config.ratePreset; });
  const id = run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'booked' } }) }).id;
  delete out(db, id).rateMode; delete out(db, id).rateOptions;
  run(db, MAKER, 'outward.verify', { id, checks: CHECKS });
  run(db, CHECKER, 'outward.authorise', { id });
});
