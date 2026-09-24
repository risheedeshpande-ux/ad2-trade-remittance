/* Engine tests: the full partner journey plus the controls that must refuse. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../public/engine.js');
const { SEED } = require('../public/data.js');

const NOW = '2026-09-24T10:00:00.000Z';
const ctx = (over = {}) => ({ now: NOW, hashPassword: pw => 'plain$' + pw, ...over });
const who = (d, l) => ({ domainId: d, loginId: l });
const MAKER = who('AD2', 'MAKER'), MAKER2 = who('AD2', 'MAKER2'), CHECKER = who('AD2', 'CHECKER'), OPS = who('AD2', 'OPS'), ADMIN = who('AD2', 'ADMIN');
const run = (db, w, cmd, p, c) => Engine.execute(db, w, cmd, p, ctx(c));
const refuses = (fn, re) => assert.throws(fn, e => e instanceof Engine.EngineError && (!re || re.test(e.message)));
const doc = n => ({ filename: n + '.pdf', size: '100 KB', type: 'application/pdf' });
const DEC = { fema: true, ofac: true };
const tradeDocs = { dil: doc('dil'), expinv: doc('inv'), sb: doc('sb') };
const DCHECKS = { documents: true, bills: true, account: true, sanctions: true };

const application = over => ({
  legalName: 'Coromandel Leather Works Private Limited', tradingName: 'Coromandel Leather', constitution: 'Private Limited',
  incorporationDate: '2015-06-01', regNumber: 'U19100TN2015PTC100234', country: 'India', address: '12 Tannery Road, Chennai 600044',
  domainId: 'COROMANDEL', pan: 'AACCC1234F', gstin: '33AACCC1234F1Z5', iec: '0415009876',
  contactName: 'Meena Sundaram', designation: 'CFO', email: 'meena@coromandel.example', mobile: '+91 98400 12345',
  industry: 'Leather goods', description: 'Imports finished hides, exports leather goods to Europe.', expectedVolume: 'USD 3,000,000',
  requestedCurrencies: ['USD', 'EUR'], service: 'Both',
  banks: [{ bank: 'HDFC Bank', branch: 'Guindy', accountNumber: '50200099887766', ifsc: 'HDFC0000123', currency: 'INR', type: 'Current', verified: true }],
  docs: { coi: doc('coi'), pan: doc('pan'), gst: doc('gst'), iec: doc('iec'), addr: doc('addr') },
  ...over,
});
const pricing = { permission: 'Both', currencies: ['USD', 'EUR'], margins: { USD: 50 },
  charges: [{ name: 'Transaction handling fee', basis: 'Fixed', value: 500, currency: 'INR', frequency: 'Per transaction' }],
  effectiveDate: '2026-09-24', remarks: 'Standard' };

test('seed is consistent', () => {
  const db = Engine.freshState(SEED);
  assert.equal(db.purposeCodes.length, 111);
  assert.deepEqual(db.products.map(p => [p.id, p.purposes.length]), [['AIR', 4], ['DIR', 6], ['OTT', 110], ['LC', 5], ['TRADE', 0]]);
  db.products.forEach(p => p.purposes.forEach(c => assert.ok(db.purposeCodes.find(x => x.code === c), c)));
  db.outward.forEach(o => assert.ok(db.products.find(p => p.id === o.remittanceType), o.id));
  /* bill balances agree with the confirmed ledger */
  db.bills.forEach(b => {
    const led = db.allocations.filter(l => l.billId === b.id && l.status === 'Confirmed').reduce((t, l) => t + l.amount, 0);
    assert.equal(b.adjusted, led, b.id);
    assert.equal(b.outstanding, b.amount - b.adjusted, b.id);
  });
});

test('document policy follows the workbook', () => {
  const db = Engine.freshState(SEED);
  assert.deepEqual(Engine.checklist(db, 'AIR', 'S0101', 0).map(d => d.name), ['Proforma Invoice']);
  assert.deepEqual(Engine.checklist(db, 'DIR', 'S0102', 0).map(d => d.name), ['Transport Document', 'Commercial Invoice', 'Bill of Entry']);
  const svc = Engine.checklist(db, 'OTT', 'S1006', 100000);
  assert.deepEqual(svc.filter(d => d.required).map(d => d.id), ['invoice', 'form145']);   // transport optional, Form 146 below threshold
  const goods = Engine.checklist(db, 'OTT', 'S0102', 900000);
  assert.deepEqual(goods.filter(d => d.required).map(d => d.id), ['invoice', 'transport', 'form145', 'form146']);
  assert.deepEqual(Engine.checklist(db, 'TRADE', '', 0).map(d => d.name), ['Disposal Instruction Letter', 'Commercial Export Invoice', 'Shipping Bill']);
});

test('end to end: onboard a partner, pay a supplier, dispose export proceeds', () => {
  const db = Engine.freshState(SEED);

  /* 1. digital onboarding */
  refuses(() => run(db, null, 'onboarding.submit', { application: application({ iec: '' }), password: 'Welcome123' }), /IEC/);
  refuses(() => run(db, null, 'onboarding.submit', { application: application({ docs: {} }), password: 'Welcome123' }), /documents/);
  refuses(() => run(db, null, 'onboarding.submit', { application: application(), password: 'short' }), /password/);
  const sub = run(db, null, 'onboarding.submit', { application: application(), loginId: 'ADMIN', password: 'Welcome123' });
  const smeId = sub.smeId;
  const SME = who('COROMANDEL', 'ADMIN');
  assert.equal(db.logins.find(l => l.domainId === 'COROMANDEL').role, 'SME Applicant');
  refuses(() => run(db, SME, 'outward.saveDraft', { draft: {} }), /cannot|approves/);

  /* 2. maker prices and sends; maker cannot approve; checker approves */
  refuses(() => run(db, MAKER, 'onboarding.approve', { smeId }), /withheld by design/);
  run(db, MAKER, 'onboarding.review', { smeId, config: pricing, submit: true });
  assert.equal(Engine.publicStatus(db, smeId, 'COROMANDEL').status, 'Pending Approval');
  run(db, CHECKER, 'onboarding.approve', { smeId });
  const sme = db.smes.find(s => s.id === smeId);
  assert.equal(sme.status, 'Approved');
  assert.equal(db.logins.find(l => l.domainId === 'COROMANDEL').role, 'SME User');
  assert.equal(Engine.marginFor(db, sme, 'EUR'), 60);   // derived from USD 50 × 1.20

  /* 3. masters: beneficiary + account verification */
  const acct = db.accounts.find(a => a.smeId === smeId);
  const ben = run(db, SME, 'beneficiary.add', { beneficiary: { name: 'Pelletteria Toscana SRL', country: 'Italy', bank: 'UniCredit',
    bankCountry: 'Italy', accountNumber: 'IT40S0542811101000000123456', swift: 'UNCRITMM', currency: 'EUR' } }).id;
  refuses(() => run(db, SME, 'beneficiary.add', { beneficiary: { name: 'X', country: 'Y', bank: 'Z', bankCountry: 'Y', accountNumber: '123456', swift: 'BAD' } }), /SWIFT/);

  /* 4. import bill, accepted by the checker (AutoChecker is off) */
  const billId = run(db, SME, 'bill.lodge', { type: 'Import', bill: { invoiceNumber: 'PT-2026-044', invoiceDate: '2026-09-10',
    counterparty: 'Pelletteria Toscana SRL', counterpartyCountry: 'Italy', currency: 'EUR', amount: 40000, dueDate: '2026-11-10',
    orderRef: 'PO-1', shipmentRef: 'BOE-1' } }).id;
  assert.equal(db.bills.find(b => b.id === billId).review, 'Submitted');
  refuses(() => run(db, SME, 'bill.lodge', { type: 'Import', bill: { invoiceNumber: 'PT-2026-044', invoiceDate: '2026-09-10',
    counterparty: 'x', counterpartyCountry: 'y', currency: 'EUR', amount: 1, dueDate: '2026-11-10' } }), /already lodged/);
  run(db, CHECKER, 'bill.accept', { id: billId });

  /* 5. DIR outward against the bill */
  const draft = {
    beneficiaryId: ben, beneficiary: 'Pelletteria Toscana SRL', beneficiaryCountry: 'Italy', beneficiaryAccount: 'IT40S0542811101000000123456',
    beneficiaryBank: 'UniCredit', beneficiaryBankCountry: 'Italy', swift: 'UNCRITMM', currency: 'EUR', amount: 40000,
    remittanceType: 'DIR', purposeCode: 'S0102', executionDate: '2026-09-25', debitAccountId: acct.id,
    rate: { mode: 'booked', bookedAt: '2026-09-24T09:30:00.000Z', customerRate: 1 /* tampered — must be recomputed */ },
    allocations: [{ billId, amount: 40000 }],
    docs: { transport: doc('bl'), invoice: doc('inv') }, declarations: DEC,
  };
  refuses(() => run(db, SME, 'outward.submit', { draft: { ...draft, declarations: {}, docs: { ...draft.docs, boe: doc('boe') } } }), /declarations/);
  refuses(() => run(db, SME, 'outward.submit', { draft }), /Bill of Entry/);
  refuses(() => run(db, SME, 'outward.submit', { draft: { ...draft, purposeCode: 'S1006', docs: { ...draft.docs, boe: doc('boe') } } }), /not available under DIR/);
  refuses(() => run(db, SME, 'outward.submit', { draft: { ...draft, allocations: [], docs: { ...draft.docs, boe: doc('boe') } } }), /import bill/);
  refuses(() => run(db, SME, 'outward.submit', { draft: { ...draft, rate: { mode: 'booked', bookedAt: '2026-09-20T09:00:00.000Z' }, docs: { ...draft.docs, boe: doc('boe') } } }), /expired/);
  const orId = run(db, SME, 'outward.submit', { draft: { ...draft, docs: { ...draft.docs, boe: doc('boe') } } }).id;
  const o = db.outward.find(x => x.id === orId);
  assert.equal(o.status, 'Submitted');
  assert.equal(o.rate.customerRate, +(95.87 + 0.60).toFixed(4));    // recomputed, not the tampered 1
  /* the bill is now reserved */
  assert.equal(Engine.billAvailable(db, db.bills.find(b => b.id === billId)), 0);

  /* 6. maker verifies, checker authorises, ops executes */
  refuses(() => run(db, CHECKER, 'outward.authorise', { id: orId }), /verified/);
  refuses(() => run(db, MAKER, 'outward.verify', { id: orId, checks: { documents: true } }), /every verification check/);
  const checks = { documents: true, sanctions: true, purpose: true, beneficiary: true };
  run(db, MAKER, 'outward.verify', { id: orId, checks });
  refuses(() => run(db, MAKER, 'outward.authorise', { id: orId }), /withheld by design/);
  run(db, CHECKER, 'outward.authorise', { id: orId });
  refuses(() => run(db, CHECKER, 'outward.execute', { id: orId }), /withheld by design|cannot/);
  const before = acct.balance;
  const ex = run(db, OPS, 'outward.execute', { id: orId });
  assert.match(ex.utr, /^AD2O260924\d{5}$/);
  assert.equal(o.status, 'Completed');
  assert.equal(acct.balance, +(before - o.debitInr).toFixed(2));
  const b = db.bills.find(x => x.id === billId);
  assert.equal(b.settlement, 'Settled');
  assert.ok(db.allocations.some(l => l.remId === orId && l.status === 'Confirmed'));

  /* 7. export: bill, inward receipt recorded by ops, disposal through maker/checker/ops */
  const expBill = run(db, SME, 'bill.lodge', { type: 'Export', bill: { invoiceNumber: 'CLW/EXP/0091', invoiceDate: '2026-09-01',
    counterparty: 'Lederhaus GmbH', counterpartyCountry: 'Germany', currency: 'USD', amount: 25000, dueDate: '2026-12-01', shipmentRef: 'SB-99' } }).id;
  run(db, CHECKER, 'bill.accept', { id: expBill });
  refuses(() => run(db, MAKER, 'inward.record', { inward: { smeId, remitter: 'Lederhaus GmbH', remitterCountry: 'Germany', currency: 'USD', amount: 25000 } }), /cannot/);
  const irId = run(db, OPS, 'inward.record', { inward: { smeId, remitter: 'Lederhaus GmbH', remitterCountry: 'Germany', currency: 'USD', amount: 25000 } }).id;
  refuses(() => run(db, SME, 'disposal.submit', { draft: { inwardId: irId, amount: 25000, allocations: [{ billId: expBill, amount: 30000 }], creditAccountId: acct.id,
    rate: { mode: 'booked', bookedAt: NOW }, docs: tradeDocs, declarations: DEC } }), /available|exceed/);
  const diId = run(db, SME, 'disposal.submit', { draft: { inwardId: irId, amount: 25000, option: 'knockoff', purposeCode: 'TRADE',
    allocations: [{ billId: expBill, amount: 25000 }], creditAccountId: acct.id,
    rate: { mode: 'booked', bookedAt: NOW }, docs: tradeDocs, declarations: DEC } }).id;
  assert.equal(db.inward.find(i => i.id === irId).available, 0);
  refuses(() => run(db, MAKER, 'disposal.verify', { id: diId, checks: { documents: true, bills: true, account: true } }), /every verification check/);
  run(db, MAKER, 'disposal.verify', { id: diId, checks: DCHECKS });
  run(db, CHECKER, 'disposal.authorise', { id: diId });
  const bal = acct.balance;
  const pr = run(db, OPS, 'disposal.process', { id: diId });
  assert.match(pr.firc, /^FIRC-2026-\d+$/);
  const d = db.disposals.find(x => x.id === diId);
  assert.equal(d.creditInr, +(25000 * (88.42 - 0.50)).toFixed(2));
  assert.equal(acct.balance, +(bal + d.creditInr).toFixed(2));
  assert.equal(db.bills.find(x => x.id === expBill).settlement, 'Settled');
  assert.equal(db.inward.find(i => i.id === irId).status, 'Processed');

  /* 8. what the SME can see */
  const view = Engine.scopeState(db, SME);
  assert.equal(view.smes.length, 1);
  assert.ok(view.outward.every(x => x.smeId === smeId));
  assert.ok(!view.smes[0].config.remarks, 'internal remarks hidden from the SME');
  assert.ok(view.notifications.some(n => /Payment .* sent/.test(n.text)));
  assert.ok(view.logins.every(l => !l.pw), 'no password hashes leave the server');
});

test('four eyes: an assisted request cannot be verified by the maker who raised it', () => {
  const db = Engine.freshState(SEED);
  const acting = { actingFor: 'SME-1001' };
  const d = {
    beneficiaryId: 'BEN-002', beneficiary: 'Northgate Advisory Ltd', beneficiaryCountry: 'United Kingdom', beneficiaryAccount: 'GB82WEST12345698765432',
    beneficiaryBank: 'Barclays', beneficiaryBankCountry: 'United Kingdom', swift: 'BARCGB22', currency: 'GBP', amount: 3000,
    remittanceType: 'OTT', purposeCode: 'S1006', executionDate: '2026-09-30', debitAccountId: 'BA-001',
    rate: { mode: 'deal', dealRef: 'FXD-2026-1', customerRate: 113 }, docs: { invoice: doc('i'), form145: doc('f') }, declarations: DEC,
  };
  const id = run(db, MAKER, 'outward.submit', { ...acting, draft: d }).id;
  assert.equal(db.outward.find(o => o.id === id).source, 'AD2 Assisted');
  refuses(() => run(db, MAKER, 'outward.verify', { id, checks: { documents: true, sanctions: true, purpose: true, beneficiary: true } }), /another user/);
  run(db, MAKER2, 'outward.verify', { id, checks: { documents: true, sanctions: true, purpose: true, beneficiary: true } });
  run(db, CHECKER, 'outward.authorise', { id });
});

test('controls: segregation, scoping, admin', () => {
  const db = Engine.freshState(SEED);
  const MER = who('MERIDIANTEX', 'SMEUSER');
  /* an SME cannot touch another SME's record */
  refuses(() => run(db, MER, 'outward.respond', { id: 'OR-5106', response: 'x' }), /another SME/);
  /* the admin holds no transaction authority */
  refuses(() => run(db, ADMIN, 'outward.authorise', { id: 'OR-5103' }), /withheld/);
  run(db, ADMIN, 'purpose.setEnabled', { product: 'OTT', code: 'S0020', enabled: false });
  assert.ok(!Engine.purposesFor(db, 'OTT').some(p => p.code === 'S0020'));
  run(db, ADMIN, 'policy.setRule', { product: 'OTT', docId: 'transport', rule: 'required' });
  assert.ok(Engine.checklist(db, 'OTT', 'S1006', 0).find(x => x.id === 'transport').required);
  /* insufficient funds stops execution */
  db.accounts.find(a => a.id === 'BA-004').balance = 10;
  refuses(() => run(db, OPS, 'outward.execute', { id: 'OR-5102' }), /Insufficient funds/);
  /* rejecting a disposal releases the receipt balance */
  const i = db.inward.find(x => x.id === 'IR-3306');
  const was = i.available;
  run(db, CHECKER, 'disposal.reject', { id: 'DI-9003', reason: 'Wrong bill' });
  assert.equal(i.available, was + 120000);
  /* public scope carries no business data */
  const pub = Engine.scopeState(db, null);
  assert.equal(pub.smes.length, 0);
  assert.equal(pub.outward.length, 0);
});

test('knock-off: advance payment against a later import bill', () => {
  const db = Engine.freshState(SEED);
  const ARC = who('ARCADIACOMP', 'SMEUSER');
  const checks = { documents: true, sanctions: true, purpose: true, beneficiary: true };
  run(db, MAKER, 'outward.verify', { id: 'OR-5106', checks });
  run(db, CHECKER, 'outward.authorise', { id: 'OR-5106' });
  run(db, OPS, 'outward.execute', { id: 'OR-5106' });
  assert.ok(db.outward.find(o => o.id === 'OR-5106').boeDueDate);
  run(db, ARC, 'bill.respond', { id: 'BL-24008', response: 'BoE added', shipmentRef: 'BOE-7760011' });
  run(db, CHECKER, 'bill.accept', { id: 'BL-24008' });
  const [alId] = run(db, ARC, 'knockoff.propose', { side: 'Import', items: [{ billId: 'BL-24008', remId: 'OR-5106', amount: 52000 }] }).ids;
  refuses(() => run(db, ARC, 'knockoff.propose', { side: 'Import', items: [{ billId: 'BL-24008', remId: 'OR-5106', amount: 1 }] }), /left to apply|available/);
  run(db, CHECKER, 'recon.confirm', { id: alId });
  const b = db.bills.find(x => x.id === 'BL-24008');
  assert.equal(b.outstanding, 76900 - 52000);
  run(db, OPS, 'recon.reverse', { id: alId, reason: 'Wrong bill' });
  assert.equal(b.outstanding, 76900);
});

test('seeded payments carry their INR debit', () => {
  const db = Engine.freshState(SEED);
  db.outward.filter(o => o.status !== 'Draft').forEach(o => assert.ok(o.debitInr > 0, o.id));
});

test('partial disposal: knock off part, credit the rest as advance, knock the FIRC off later', () => {
  const db = Engine.freshState(SEED);
  const MER = who('MERIDIANTEX', 'SMEUSER');
  /* IR-3303: GBP 97,200. Dispose 60,000 now: 50,000 against BL-24003, 10,000 unallocated. */
  const docs = { dil: doc('dil'), expinv: doc('inv'), sb: doc('sb') };
  refuses(() => run(db, MER, 'disposal.submit', { draft: { inwardId: 'IR-3303', amount: 100000, option: 'knockoff', purposeCode: 'TRADE',
    allocations: [{ billId: 'BL-24003', amount: 50000 }], creditAccountId: 'BA-001', rate: { mode: 'booked', bookedAt: NOW }, docs, declarations: DEC } }), /left to dispose/);
  refuses(() => run(db, MER, 'disposal.submit', { draft: { inwardId: 'IR-3303', amount: 60000, option: 'knockoff', purposeCode: 'NOPE',
    allocations: [{ billId: 'BL-24003', amount: 50000 }], creditAccountId: 'BA-001', rate: { mode: 'booked', bookedAt: NOW }, docs, declarations: DEC } }), /Purpose/);
  const id1 = run(db, MER, 'disposal.submit', { draft: { inwardId: 'IR-3303', amount: 60000, option: 'knockoff', purposeCode: 'TRADE',
    allocations: [{ billId: 'BL-24003', amount: 50000 }], creditAccountId: 'BA-001', rate: { mode: 'booked', bookedAt: NOW }, docs, declarations: DEC } }).id;
  const i = db.inward.find(x => x.id === 'IR-3303');
  assert.equal(i.available, 37200);
  assert.equal(i.status, 'Partially Disposed');
  /* the rest as an advance: no bills, no export invoice or shipping bill needed */
  const id2 = run(db, MER, 'disposal.submit', { draft: { inwardId: 'IR-3303', amount: 37200, option: 'advance', purposeCode: 'TRADE',
    creditAccountId: 'BA-001', rate: { mode: 'booked', bookedAt: NOW }, docs: { dil: doc('dil') }, declarations: DEC } }).id;
  assert.equal(i.available, 0);
  assert.equal(i.status, 'Instruction Submitted');
  [id1, id2].forEach(id => {
    run(db, MAKER, 'disposal.verify', { id, checks: DCHECKS });
    run(db, CHECKER, 'disposal.authorise', { id });
    run(db, OPS, 'disposal.process', { id });
  });
  const d1 = db.disposals.find(x => x.id === id1), d2 = db.disposals.find(x => x.id === id2);
  assert.equal(d1.unallocated, 10000);
  assert.equal(d2.unallocated, 37200);
  assert.match(d1.fircUfi.ref, /^UFI-E-2026-\d{6}$/);
  assert.equal(i.status, 'Processed');
  assert.equal(i.fircs.length, 2);
  const bl = db.bills.find(b => b.id === 'BL-24003');
  assert.equal(bl.outstanding, 97200 - 50000);
  assert.ok(db.allocations.find(l => l.disposalId === id1 && l.status === 'Confirmed').ufi.system === 'EDPMS');
  /* FIRC pending knock-off → export bill, via proposal and checker confirmation */
  refuses(() => run(db, MER, 'knockoff.propose', { side: 'Export', items: [{ billId: 'BL-24003', remId: id1, amount: 10001 }] }), /pending knock-off/);
  const [al] = run(db, MER, 'knockoff.propose', { side: 'Export', items: [{ billId: 'BL-24003', remId: id2, amount: 37200 }] }).ids;
  refuses(() => run(db, MER, 'knockoff.propose', { side: 'Export', items: [{ billId: 'BL-24012', remId: id2, amount: 1 }] }), /pending knock-off/);
  run(db, CHECKER, 'recon.confirm', { id: al });
  assert.equal(d2.unallocated, 0);
  assert.equal(bl.outstanding, 97200 - 50000 - 37200);
  assert.ok(db.allocations.find(x => x.id === al).ufi.ref);
  /* reversing puts the amount back as pending knock-off */
  run(db, OPS, 'recon.reverse', { id: al, reason: 'Wrong invoice' });
  assert.equal(d2.unallocated, 37200);
  assert.ok(db.allocations.find(x => x.id === al).ufiReversal.ref);
  /* seeded advance DI-9004 knocks off against BL-24012 */
  const [al2] = run(db, MER, 'knockoff.propose', { side: 'Export', items: [{ billId: 'BL-24012', remId: 'DI-9004', amount: 40000 }] }).ids;
  run(db, CHECKER, 'recon.confirm', { id: al2 });
  assert.equal(db.bills.find(b => b.id === 'BL-24012').outstanding, 20000);
});

test('disposal to an EEFC account credits foreign currency with no conversion', () => {
  const db = Engine.freshState(SEED);
  const NIL = who('NILGIRISPICE', 'SMEUSER');
  const eefc = db.accounts.find(a => a.id === 'BA-007');
  const before = eefc.balance;
  refuses(() => run(db, NIL, 'disposal.submit', { draft: { inwardId: 'IR-3306', amount: 1000, option: 'advance', creditAccountId: 'BA-007',
    docs: { dil: doc('d') }, declarations: DEC } }), /EEFC account in AED/);
  const id = run(db, NIL, 'disposal.submit', { draft: { inwardId: 'IR-3305', amount: 20000, option: 'advance', creditAccountId: 'BA-007',
    docs: { dil: doc('d') }, declarations: DEC } }).id;
  run(db, MAKER, 'disposal.verify', { id, checks: DCHECKS });
  run(db, CHECKER, 'disposal.authorise', { id });
  run(db, OPS, 'disposal.process', { id });
  const d = db.disposals.find(x => x.id === id);
  assert.equal(d.creditCurrency, 'USD');
  assert.equal(d.creditInr, 0);
  assert.equal(eefc.balance, before + 20000);
});

test('LC settlement, compliance risk and the assisted margin band', () => {
  const db = Engine.freshState(SEED);
  const ARC = who('ARCADIACOMP', 'SMEUSER');
  const base = { beneficiaryId: 'BEN-006', beneficiary: 'Ruiyang Precision Pte Ltd', beneficiaryCountry: 'Singapore', beneficiaryAccount: '0033-991-4471',
    beneficiaryBank: 'DBS Bank', beneficiaryBankCountry: 'Singapore', swift: 'DBSSSGSG', currency: 'SGD', amount: 20000,
    remittanceType: 'LC', purposeCode: 'S0102', executionDate: '2026-09-30', debitAccountId: 'BA-004',
    rate: { mode: 'booked', bookedAt: NOW }, allocations: [{ billId: 'BL-24007', amount: 20000 }],
    docs: { lccopy: doc('lc'), invoice: doc('inv'), transport: doc('bl') }, declarations: DEC };
  refuses(() => run(db, ARC, 'outward.submit', { draft: base }), /letter of credit number/);
  const id = run(db, ARC, 'outward.submit', { draft: { ...base, lcNumber: 'ILC/2026/0457' } }).id;
  const o = db.outward.find(x => x.id === id);
  assert.equal(o.lcNumber, 'ILC/2026/0457');
  assert.equal(o.risk.level, 'Low');
  /* an SME cannot change its own margin */
  refuses(() => run(db, ARC, 'outward.submit', { draft: { ...base, lcNumber: 'X1', allocations: [{ billId: 'BL-24007', amount: 1000 }], amount: 1000, rate: { mode: 'booked', bookedAt: NOW, margin: 10 } } }), /Only AD2/);
  /* AD2 in the assisted journey can, within the band */
  const m = Engine.marginFor(db, db.smes.find(s => s.id === 'SME-1002'), 'SGD');
  refuses(() => run(db, MAKER, 'outward.submit', { actingFor: 'SME-1002', draft: { ...base, lcNumber: 'X2', amount: 1000, allocations: [{ billId: 'BL-24007', amount: 1000 }], rate: { mode: 'booked', bookedAt: NOW, margin: m - 20 } } }), /between/);
  const aid = run(db, MAKER, 'outward.submit', { actingFor: 'SME-1002', draft: { ...base, lcNumber: 'X3', amount: 1000, allocations: [{ billId: 'BL-24007', amount: 1000 }], rate: { mode: 'booked', bookedAt: NOW, margin: m - 5 } } }).id;
  assert.equal(db.outward.find(x => x.id === aid).rate.margin, m - 5);
  /* a watchlist beneficiary scores High and needs a written reason */
  const hid = run(db, ARC, 'outward.submit', { draft: { ...base, lcNumber: 'X4', amount: 1000, allocations: [{ billId: 'BL-24007', amount: 1000 }], beneficiaryId: '', beneficiary: 'Blocked Trading LLC', beneficiaryCountry: 'Iran' } }).id;
  const h = db.outward.find(x => x.id === hid);
  assert.equal(h.risk.level, 'High');
  const checks = { documents: true, sanctions: true, purpose: true, beneficiary: true };
  refuses(() => run(db, MAKER, 'outward.verify', { id: hid, checks }), /Risk score is High/);
  run(db, MAKER, 'outward.verify', { id: hid, checks, note: 'Name match is a false positive; confirmed with the SME.' });
  /* the SME never sees risk scores or internal notes */
  const view = Engine.scopeState(db, ARC);
  assert.ok(view.outward.every(x => !x.risk));
  assert.ok(!view.audit.some(x => /Compliance check|Maker note/.test(x.action)), 'internal audit entries stay internal');
  assert.ok(!view.complianceRules);
  /* admin can switch a rule off */
  run(db, ADMIN, 'compliance.setRule', { id: 'sanctions', enabled: false });
  refuses(() => run(db, ADMIN, 'compliance.setRule', { id: 'amount', weight: 500 }), /between 0 and 100/);
});

test('test data lab: new businesses, top-ups and parked requests', () => {
  const db = Engine.freshState(SEED);
  assert.ok(db.smes.filter(s => s.test).length >= 6);
  const r = run(db, who('AD2', 'SALES'), 'lab.createSme', { profile: 'MYSOREMACH' });
  assert.notEqual(r.domainId, 'MYSOREMACH');           // the seeded one already holds it
  const s = db.smes.find(x => x.id === r.smeId);
  assert.equal(s.status, 'Approved');
  const SMEW = who(r.domainId, r.loginId);
  const billsBefore = db.bills.filter(b => b.smeId === s.id).length;
  run(db, SMEW, 'lab.topUp', {});
  assert.ok(db.bills.filter(b => b.smeId === s.id).length > billsBefore);
  refuses(() => run(db, SMEW, 'lab.topUp', { smeId: 'SME-1001' }), /own business/);
  refuses(() => run(db, SMEW, 'lab.createSme', { profile: 'PUNEAUTO' }), /AD2 portal/);
  const q = run(db, MAKER, 'lab.queue', { smeId: s.id });
  const st = q.ids.map(id => (db.outward.find(o => o.id === id) || db.disposals.find(d => d.id === id)).status);
  assert.deepEqual(st, ['Submitted', 'Verified', 'Authorised', 'Submitted']);
  /* the parked requests continue through the real workflow */
  run(db, OPS, 'outward.execute', { id: q.ids[2] });
  run(db, CHECKER, 'outward.authorise', { id: q.ids[1] });
  run(db, MAKER, 'outward.verify', { id: q.ids[0], checks: { documents: true, sanctions: true, purpose: true, beneficiary: true } });
  run(db, MAKER, 'disposal.verify', { id: q.ids[3], checks: DCHECKS });
  /* an applicant to review */
  const ap = run(db, MAKER, 'lab.createSme', { profile: 'KERALACOIR', stage: 'applicant' });
  assert.equal(db.smes.find(x => x.id === ap.smeId).status, 'Submitted');
  run(db, MAKER, 'onboarding.review', { smeId: ap.smeId, config: { ...pricing, permission: 'Export', currencies: ['USD'] }, submit: true });
  run(db, CHECKER, 'onboarding.approve', { smeId: ap.smeId });
  /* the lab can be switched off */
  run(db, ADMIN, 'settings.update', { testLab: false });
  refuses(() => run(db, MAKER, 'lab.topUp', { smeId: s.id }), /switched off/);
});

test('users: add, deactivate, role change; duplicate PAN flagged', () => {
  const db = Engine.freshState(SEED);
  run(db, ADMIN, 'user.add', { user: { domainId: 'AD2', loginId: 'CHECKER3', name: 'Asha Pillai', role: 'AD2 Checker' } });
  const C3 = who('AD2', 'CHECKER3');
  run(db, C3, 'outward.authorise', { id: 'OR-5103' });
  refuses(() => run(db, ADMIN, 'user.add', { user: { domainId: 'AD2', loginId: 'CHECKER3', name: 'x', role: 'AD2 Checker' } }), /already exists/);
  refuses(() => run(db, MAKER, 'user.add', { user: { domainId: 'AD2', loginId: 'X99', name: 'x', role: 'AD2 Maker' } }), /cannot/);
  run(db, ADMIN, 'user.setActive', { domainId: 'AD2', loginId: 'CHECKER3', active: false });
  assert.throws(() => run(db, C3, 'outward.authorise', { id: 'OR-5103' }), e => e.status === 401);
  refuses(() => run(db, ADMIN, 'user.setActive', { domainId: 'AD2', loginId: 'ADMIN', active: false }), /own user/);
  run(db, ADMIN, 'user.setRole', { domainId: 'AD2', loginId: 'MAKER2', role: 'AD2 Sales' });
  refuses(() => run(db, who('AD2', 'MAKER2'), 'outward.verify', { id: 'OR-5106', checks: {} }), /cannot/);
  run(db, ADMIN, 'user.add', { user: { domainId: 'MERIDIANTEX', loginId: 'TREASURY', name: 'Arjun Rao', password: 'Treasury2026' } });
  assert.ok(db.logins.find(l => l.loginId === 'TREASURY').pw);
  /* public sign-in list shows demo accounts only */
  assert.ok(!Engine.scopeState(db, null).logins.some(l => l.loginId === 'TREASURY'));
  /* same PAN as Meridian: accepted, flagged for the maker */
  const r = run(db, null, 'onboarding.submit', { application: application({ domainId: 'MERIDIAN2', pan: 'AAFCM4521K' }), password: 'Welcome123' });
  assert.match(db.smes.find(s => s.id === r.smeId).dupFlags[0], /PAN matches SME-1001/);
});
