/* The admin controller: editable roles with maker/checker guards, user
   transaction limits in USD, onboarding rules, purpose overrides on the
   document policy, thresholds in USD, one-click restore — every change in the
   audit log with its before and after values. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../public/engine.js');
const { SEED } = require('../public/data.js');
Object.assign(SEED.settings, { marketSim: false, ibrSpreadPct: 0, deskMarginPaise: 0 });
SEED.smes.forEach(s => { if (s.config) s.config.ratePreset = 'RP-1'; });
const T = Engine.treasury;

const NOW = '2026-09-24T06:00:00.000Z';
const who = (d, l) => ({ domainId: d, loginId: l });
const MER = who('MERIDIANTEX', 'SMEUSER');
const MAKER = who('AD2', 'MAKER'), CHECKER = who('AD2', 'CHECKER'), OPS = who('AD2', 'OPS'), ADMIN = who('AD2', 'ADMIN'), DEALER = who('AD2', 'DEALER');
const run = (db, w, cmd, p, now = NOW) => Engine.execute(db, w, cmd, p, { now, hashPassword: pw => 'plain$' + pw });
const refuses = (fn, code, re) => assert.throws(fn, e => e instanceof Engine.EngineError && (!code || e.code === code) && (!re || re.test(e.message)),
  `expected ${code || 'a refusal'}${re ? ' ' + re : ''}`);
const doc = n => ({ filename: n + '.pdf', size: '100 KB', type: 'application/pdf' });
const DEC = { fema: true, ofac: true };
const CHECKS = { documents: true, sanctions: true, purpose: true, beneficiary: true };
const fresh = () => Engine.freshState(SEED, NOW);
const role = (db, id) => db.roles.find(r => r.id === id);
const lastAudit = (db, record) => db.audit.find(x => x.record === record);
const auditText = x => x && (x.text || x.action || JSON.stringify(x));
const payment = over => ({ beneficiaryId: 'BEN-001', beneficiary: 'Filatura Ponti S.p.A.', beneficiaryCountry: 'Italy',
  beneficiaryAccount: 'IT60X0542811101000000123456', beneficiaryBank: 'Intesa Sanpaolo', beneficiaryBankCountry: 'Italy', swift: 'BCITITMM',
  currency: 'EUR', amount: 45000, remittanceType: 'DIR', purposeCode: 'S0102', executionDate: '2026-09-25', debitAccountId: 'BA-001',
  allocations: [{ billId: 'BL-24014', amount: 45000 }], docs: { transport: doc('t'), invoice: doc('i'), boe: doc('b') }, declarations: DEC, rate: { mode: 'booked' }, ...over });
const application = over => ({
  legalName: 'Coromandel Leather Works', tradingName: 'Coromandel Leather', constitution: 'Partnership',
  incorporationDate: '2015-06-01', regNumber: 'PF-2015-100234', country: 'India', address: '12 Tannery Road, Chennai 600044',
  domainId: 'COROMANDEL', pan: 'AACFC1234F', gstin: '33AACFC1234F1Z5', iec: '0415009876',
  contactName: 'Meena Sundaram', designation: 'Partner', email: 'meena@coromandel.example', mobile: '+91 98400 12345',
  industry: 'Leather goods', description: 'Exports leather goods.', importVolume: 'USD 2,000,000', exportVolume: 'USD 1,000,000',
  countries: ['Italy'], requestedCurrencies: ['USD'], service: 'Both',
  signatories: [{ name: 'Meena Sundaram', designation: 'Partner', email: 'meena@coromandel.example', mobile: '+91 98400 12345', authority: 'Singly', limit: '' }],
  banks: [{ bank: 'HDFC Bank', branch: 'Guindy', accountNumber: '50200099887766', ifsc: 'HDFC0000123', currency: 'INR', type: 'Current', verified: true }],
  docs: { coi: doc('coi'), pan: doc('pan'), gst: doc('gst'), iec: doc('iec'), addr: doc('addr') },
  ...over,
});

test('seed roles hold no maker/checker pair', () => {
  const db = fresh();
  db.roles.filter(r => r.portal !== 'SME').forEach(r =>
    Engine.SEGREGATION_PAIRS.forEach(([x, y]) => assert.ok(!(r.can.includes(x) && r.can.includes(y)), `${r.id} holds ${x} and ${y}`)));
});

test('roles: a permission edit is saved, audited before and after, and enforced on the next action', () => {
  const db = fresh();
  refuses(() => run(db, MAKER, 'roles.update', { role: 'AD2 Sales', can: [] }));
  const sales = role(db, 'AD2 Sales');
  run(db, ADMIN, 'roles.update', { role: 'AD2 Sales', can: sales.can.filter(c => c !== 'reports.view') });
  assert.ok(!role(db, 'AD2 Sales').can.includes('reports.view'));
  assert.match(auditText(lastAudit(db, 'ROLES')), /AD2 Sales permissions changed — before: .*reports\.view.*; after:/);
  refuses(() => run(db, ADMIN, 'roles.update', { role: 'AD2 Sales', can: ['no.such.cap'] }), 'invalid_option');
});

test('roles: one role may not hold both sides of a maker/checker pair', () => {
  const db = fresh();
  const maker = role(db, 'AD2 Maker');
  refuses(() => run(db, ADMIN, 'roles.update', { role: 'AD2 Maker', can: [...maker.can, 'outward.approve'] }), 'segregation_conflict', /outward\.verify and outward\.approve/);
  const dealer = role(db, 'AD2 Treasury Dealer');
  refuses(() => run(db, ADMIN, 'roles.update', { role: 'AD2 Treasury Dealer', can: [...dealer.can, 'treasury.approve'] }), 'segregation_conflict');
});

test('roles: the pair check counts what a role gets by acting for a customer', () => {
  const db = fresh();
  /* giving customers outward.approve would let a maker (who acts for customers and verifies) approve too */
  const sme = role(db, 'SME User');
  refuses(() => run(db, ADMIN, 'roles.update', { role: 'SME User', can: [...sme.can, 'outward.approve'] }), 'segregation_conflict', /acting for a customer/);
});

test('roles: the Administrator keeps the admin permissions', () => {
  const db = fresh();
  const ad = role(db, 'AD2 Administrator');
  refuses(() => run(db, ADMIN, 'roles.update', { role: 'AD2 Administrator', can: ad.can.filter(c => c !== 'admin.users') }), 'admin_lockout');
});

test('roles: removing the last holder of a permission an open request needs is refused', () => {
  const db = fresh();
  run(db, MER, 'outward.submit', { draft: payment() });
  const mk = role(db, 'AD2 Maker');
  /* only the maker role verifies outward requests */
  assert.ok(!db.roles.some(r => r.id !== 'AD2 Maker' && r.portal !== 'SME' && r.can.includes('outward.verify')));
  refuses(() => run(db, ADMIN, 'roles.update', { role: 'AD2 Maker', can: mk.can.filter(c => c !== 'outward.verify') }), 'cap_orphaned', /outward\.verify/);
});

test('roles: a role with active users cannot be disabled; an empty one can, and is then refused for new users', () => {
  const db = fresh();
  refuses(() => run(db, ADMIN, 'roles.setEnabled', { role: 'AD2 Maker', enabled: false }), 'role_in_use', /AD2\/MAKER/);
  refuses(() => run(db, ADMIN, 'roles.setEnabled', { role: 'AD2 Administrator', enabled: false }));
  db.logins.filter(l => l.role === 'AD2 Sales').forEach(l => { l.active = false; });
  run(db, ADMIN, 'roles.setEnabled', { role: 'AD2 Sales', enabled: false });
  assert.equal(role(db, 'AD2 Sales').disabled, true);
  refuses(() => run(db, ADMIN, 'user.add', { user: { domainId: 'AD2', loginId: 'SALES9', name: 'New Sales', role: 'AD2 Sales' } }));
  run(db, ADMIN, 'roles.setEnabled', { role: 'AD2 Sales', enabled: true });
});

test('roles: Restore default permissions undoes an edit, audited', () => {
  const db = fresh();
  const was = [...role(db, 'AD2 Sales').can];
  run(db, ADMIN, 'roles.update', { role: 'AD2 Sales', can: was.filter(c => c !== 'reports.view') });
  refuses(() => run(db, MAKER, 'roles.restore', {}));
  run(db, ADMIN, 'roles.restore', {});
  assert.deepEqual(role(db, 'AD2 Sales').can, was);
  assert.match(auditText(lastAudit(db, 'ROLES')), /Default permissions restored — before:/);
});

test('user limits: in USD, checked at verify, authorise and release; refused with the limit named', () => {
  const db = fresh();
  const id = run(db, MER, 'outward.submit', { draft: payment() }).id;
  run(db, ADMIN, 'user.setLimit', { domainId: 'AD2', loginId: 'MAKER', limitUsd: 10000 });
  assert.match(auditText(lastAudit(db, 'USERS')), /before: no limit; after: USD 10,000/);
  refuses(() => run(db, MAKER, 'outward.verify', { id, checks: CHECKS }), 'user_limit', /above your limit of USD 10,000/);
  run(db, ADMIN, 'user.setLimit', { domainId: 'AD2', loginId: 'MAKER', limitUsd: 1000000 });
  run(db, MAKER, 'outward.verify', { id, checks: CHECKS });
  run(db, ADMIN, 'user.setLimit', { domainId: 'AD2', loginId: 'CHECKER', limitUsd: 100 });
  refuses(() => run(db, CHECKER, 'outward.authorise', { id }), 'user_limit');
  run(db, ADMIN, 'user.setLimit', { domainId: 'AD2', loginId: 'CHECKER', limitUsd: null });
  run(db, CHECKER, 'outward.authorise', { id });
  refuses(() => run(db, ADMIN, 'user.setLimit', { domainId: 'AD2', loginId: 'OPS', limitUsd: -5 }), 'out_of_range');
});

test('user limits: a missing reference rate refuses instead of passing', () => {
  const db = fresh();
  const id = run(db, MER, 'outward.submit', { draft: payment() }).id;
  run(db, ADMIN, 'user.setLimit', { domainId: 'AD2', loginId: 'MAKER', limitUsd: 1e9 });
  db.currencies.find(c => c.code === 'EUR').refRate = 0;
  refuses(() => run(db, MAKER, 'outward.verify', { id, checks: CHECKS }), 'ref_rate_missing');
});

test('stepped review threshold is set in USD and compared in INR at the USD reference', () => {
  const db = fresh();
  assert.equal(db.settings.steppedThresholdUsd, 45000);
  const usd = db.currencies.find(c => c.code === 'USD').refRate;
  assert.equal(T.steppedInr(db), Math.round(45000 * usd * 100) / 100);
  run(db, ADMIN, 'settings.update', { steppedThresholdUsd: 50000 });
  assert.equal(T.steppedInr(db), Math.round(50000 * usd * 100) / 100);
  assert.match(auditText(lastAudit(db, 'SETTINGS')), /steppedThresholdUsd 45000 → 50000/);
  /* data from before keeps its INR figure */
  delete db.settings.steppedThresholdUsd; db.settings.steppedThresholdInr = 4000000;
  assert.equal(T.steppedInr(db), 4000000);
});

test('onboarding rules: documents by constitution and mandatory KYC fields apply to new applications', () => {
  const db = fresh();
  /* a partnership need not upload a certificate of incorporation */
  const noCoi = application({ docs: { pan: doc('pan'), gst: doc('gst'), iec: doc('iec'), addr: doc('addr') } });
  refuses(() => run(db, null, 'onboarding.submit', { application: noCoi, password: 'Welcome123' }), null, /documents/);
  run(db, ADMIN, 'onboarding.setDocRule', { id: 'coi', constitution: 'Partnership', rule: 'not-needed' });
  assert.match(auditText(lastAudit(db, 'ONBOARDING')), /Partnership — before: required; after: not-needed/);
  run(db, null, 'onboarding.submit', { application: noCoi, password: 'Welcome123' });
  /* IEC optional */
  refuses(() => run(db, null, 'onboarding.submit', { application: application({ domainId: 'COROTWO', pan: 'AACFC1235F', gstin: '33AACFC1235F1Z5', iec: '' }), password: 'Welcome123' }), null, /IEC/);
  run(db, ADMIN, 'onboarding.setField', { field: 'iec', required: false });
  run(db, null, 'onboarding.submit', { application: application({ domainId: 'COROTWO', pan: 'AACFC1235F', gstin: '33AACFC1235F1Z5', iec: '' }), password: 'Welcome123' });
  refuses(() => run(db, ADMIN, 'onboarding.setDocRule', { id: 'coi', rule: 'not-needed' }));
  refuses(() => run(db, MAKER, 'onboarding.setField', { field: 'iec', required: true }));
  run(db, ADMIN, 'onboarding.addDoc', { name: 'Partnership deed', required: true });
  assert.ok(Engine.onboardChecklist(db, 'Partnership').some(d => d.name === 'Partnership deed' && d.required));
  run(db, ADMIN, 'onboarding.restoreRules', {});
  assert.ok(!db.onboardDocs.some(d => d.name === 'Partnership deed'));
  assert.notEqual(db.settings.kycRequired.iec, false);
});

test('purpose overrides: beat the product rule; waive, require, and an INR threshold entered in USD', () => {
  const db = fresh();
  const req = (product, code, inrAmt, id) => Engine.checklist(db, product, code, inrAmt).find(d => d.id === id);
  assert.equal(req('DIR', 'S0102', 0, 'boe').required, true);
  run(db, ADMIN, 'policy.setPurposeRule', { purposeCode: 'S0102', product: 'DIR', docId: 'boe', rule: 'waive' });
  assert.equal(req('DIR', 'S0102', 0, 'boe').required, false);
  assert.match(auditText(lastAudit(db, 'POLICY')), /S0102 · Bill of Entry \(DIR\) — before: product rule; after: waived/);
  /* a product-specific override beats one for all products */
  run(db, ADMIN, 'policy.setPurposeRule', { purposeCode: 'S0102', product: '*', docId: 'boe', rule: 'require' });
  assert.equal(req('DIR', 'S0102', 0, 'boe').required, false);
  /* threshold typed in USD, stored in INR at today's reference, conversion audited */
  run(db, ADMIN, 'policy.setPurposeRule', { purposeCode: 'S0102', product: 'DIR', docId: 'boe', rule: 'threshold', thresholdUsd: 10000 });
  const usd = db.currencies.find(c => c.code === 'USD').refRate;
  const thr = Math.round(10000 * usd * 100) / 100;
  assert.equal(db.purposeDocRules.find(r => r.docId === 'boe' && r.product === 'DIR').threshold, thr);
  assert.match(auditText(lastAudit(db, 'POLICY')), /entered USD 10,000.00, converted at ₹/);
  assert.equal(req('DIR', 'S0102', thr - 1, 'boe').required, false);
  assert.equal(req('DIR', 'S0102', thr + 1, 'boe').required, true);
  /* a purpose can add a document the product does not list */
  run(db, ADMIN, 'policy.setPurposeRule', { purposeCode: 'S0102', product: 'DIR', docId: 'form146', rule: 'require', name: 'Form 146' });
  assert.ok(req('DIR', 'S0102', 0, 'form146').required);
  /* back to the product rule */
  run(db, ADMIN, 'policy.setPurposeRule', { purposeCode: 'S0102', product: 'DIR', docId: 'boe', rule: 'product' });
  run(db, ADMIN, 'policy.setPurposeRule', { purposeCode: 'S0102', product: '*', docId: 'boe', rule: 'product' });
  assert.equal(req('DIR', 'S0102', 0, 'boe').required, true);
  refuses(() => run(db, ADMIN, 'policy.setPurposeRule', { purposeCode: 'ZZ999', product: 'DIR', docId: 'boe', rule: 'waive' }));
});

test('document policy thresholds: INR stored, USD entry converted and audited; missing USD rate refuses', () => {
  const db = fresh();
  run(db, ADMIN, 'policy.setRule', { product: 'OTT', docId: 'form146', rule: 'threshold', thresholdUsd: 6000 });
  const usd = db.currencies.find(c => c.code === 'USD').refRate;
  assert.equal(db.docPolicy.find(d => d.product === 'OTT' && d.id === 'form146').threshold, Math.round(6000 * usd * 100) / 100);
  assert.match(auditText(lastAudit(db, 'POLICY')), /before: threshold above .*after: threshold above .*converted at/);
  db.currencies.find(c => c.code === 'USD').refRate = 0;
  refuses(() => run(db, ADMIN, 'policy.setRule', { product: 'OTT', docId: 'form146', rule: 'threshold', thresholdUsd: 6000 }), 'ref_rate_missing');
  run(db, ADMIN, 'policy.restore', {});
  assert.equal(db.docPolicy.find(d => d.product === 'OTT' && d.id === 'form146').threshold, 500000);
});

test('restore actions need the settings permission; seed defaults never reach a browser', () => {
  const db = fresh();
  refuses(() => run(db, MAKER, 'policy.restore', {}));
  refuses(() => run(db, DEALER, 'onboarding.restoreRules', {}));
  assert.ok(!('seedDefaults' in Engine.scopeState(db, ADMIN)));
  assert.ok(!('seedDefaults' in Engine.scopeState(db, MER)));
});

test('settings changes record before and after', () => {
  const db = fresh();
  run(db, ADMIN, 'settings.update', { maxOpenBookings: 7, autoChecker: true });
  assert.match(auditText(lastAudit(db, 'SETTINGS')), /maxOpenBookings 5 → 7.*autoChecker off → on/);
  assert.equal(run(db, ADMIN, 'settings.update', { maxOpenBookings: 7 }).message, 'No change.');
});

test('every permission lists the commands it guards', () => {
  const m = Engine.capCommands();
  assert.ok(m['outward.approve'].includes('outward.authorise'));
  assert.ok(m['admin.users'].includes('roles.update'));
});
