/* Treasury tests: bookings become positions, positions are covered and
   linked, and every control on the rate desk, cover and deals refuses. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../public/engine.js');
const { SEED } = require('../public/data.js');
const T = Engine.treasury;

const NOW = '2026-09-24T06:00:00.000Z';                 /* 11:30 IST, before cut-off */
const later = h => new Date(Date.parse(NOW) + h * 3600000).toISOString();
const who = (d, l) => ({ domainId: d, loginId: l });
const MER = who('MERIDIANTEX', 'SMEUSER'), ARC = who('ARCADIACOMP', 'SMEUSER'), NIL = who('NILGIRISPICE', 'SMEUSER');
const MAKER = who('AD2', 'MAKER'), MAKER2 = who('AD2', 'MAKER2'), CHECKER = who('AD2', 'CHECKER'), OPS = who('AD2', 'OPS'), OPS2 = who('AD2', 'OPS2');
const DEALER = who('AD2', 'DEALER'), DEALER2 = who('AD2', 'DEALER2'), TCHECK = who('AD2', 'TCHECKER'), ADMIN = who('AD2', 'ADMIN');
const run = (db, w, cmd, p, now = NOW) => Engine.execute(db, w, cmd, p, { now, hashPassword: pw => 'plain$' + pw });
const refuses = (fn, re) => assert.throws(fn, e => e instanceof Engine.EngineError && (!re || re.test(e.message)), re && String(re));
const doc = n => ({ filename: n + '.pdf', size: '100 KB', type: 'application/pdf' });
const DEC = { fema: true, ofac: true };
const CHECKS = { documents: true, sanctions: true, purpose: true, beneficiary: true };
const fresh = () => Engine.freshState(SEED, NOW);
const pos = (db, id) => db.positions.find(p => p.id === id);

/* Meridian pays Filatura Ponti EUR 45,000 against BL-24014. */
const payment = over => ({ beneficiaryId: 'BEN-001', beneficiary: 'Filatura Ponti S.p.A.', beneficiaryCountry: 'Italy',
  beneficiaryAccount: 'IT60X0542811101000000123456', beneficiaryBank: 'Intesa Sanpaolo', beneficiaryBankCountry: 'Italy', swift: 'BCITITMM',
  currency: 'EUR', amount: 45000, remittanceType: 'DIR', purposeCode: 'S0102', executionDate: '2026-09-25', debitAccountId: 'BA-001',
  allocations: [{ billId: 'BL-24014', amount: 45000 }], docs: { transport: doc('t'), invoice: doc('i'), boe: doc('b') }, declarations: DEC, ...over });
/* the invariant every position must keep */
const balanced = db => db.positions.forEach(p => {
  const remaining = p.amount - (p.linkedAmount || 0) - (p.cancelledAmount || 0);
  assert.ok(remaining > -0.01, `${p.id} over-linked or over-cancelled`);
  assert.ok((p.covered || 0) <= p.amount - (p.cancelledAmount || 0) + 0.01, `${p.id} covered beyond its live amount`);
});

test('seed: every seeded conversion has exactly one position, and the book balances', () => {
  const db = fresh();
  const converted = [...db.outward.filter(o => o.status !== 'Draft' && ['booked', 'deal'].includes(o.rate.mode)),
                     ...db.disposals.filter(d => (d.creditCurrency || 'INR') === 'INR' && ['booked', 'deal'].includes(d.rate.mode))];
  converted.forEach(r => {
    const mine = db.positions.filter(p => p.recordId === r.id);
    assert.equal(mine.length, 1, r.id + ' has one position');
    assert.equal(r.rate.positionId, mine[0].id);
  });
  assert.ok(db.outward.find(o => o.id === 'OR-5105').rate.positionId, 'the saved draft keeps its booking');
  assert.equal(db.deals.filter(d => d.status === 'Issued').length, 1, 'one deal ready for the branch');
  assert.ok(db.covers.every(c => c.status === 'Active' && ['Spot', 'Forward'].includes(c.type)), 'cover is live when saved');
  assert.equal(db.approvals.filter(r => r.type === 'Card rate' && r.status === 'Pending').length, 1, 'one card rate waiting for the checker');
  db.covers.forEach(c => {
    const alloc = db.coverAllocations.filter(x => x.coverId === c.id && x.status === 'Active').reduce((t, x) => t + x.amount, 0);
    assert.ok(Math.abs(alloc - c.allocated) < 0.01, c.id + ' allocated matches its allocations');
  });
  balanced(db);
  const usd = T.netByCurrency(db, NOW).USD;
  assert.equal(usd.net, Math.round((usd.buy - usd.sell + usd.coverBuy - usd.coverSell) * 100) / 100, 'net = customer and cover legs');
  assert.ok(db.positions.every(p => p.product && p.branchId && p.channel), 'every position carries its product, branch and channel');
  assert.ok(db.positions.filter(p => p.smeId).every(p => ['Trade portal', 'Assisted', 'Treasury deal'].includes(p.channel)));
});

test('a booked rate is locked: a rate revision after booking does not change it', () => {
  const db = fresh();
  const b = run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 45000 });
  assert.equal(b.refRate, undefined, 'the customer is never told the reference rate');
  assert.equal(b.margin, undefined);
  const booked = b.customerRate;
  const r = run(db, DEALER, 'rates.propose', { rows: [{ product: 'REM', currency: 'EUR', base: 96.4, card: 97.3 }] });
  assert.equal(db.currencies.find(c => c.code === 'EUR').refRate, 95.87, 'nothing moves until a checker approves');
  run(db, TCHECK, 'approval.approve', { id: r.id });
  assert.equal(db.currencies.find(c => c.code === 'EUR').refRate, 96.4);
  const id = run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'booked', positionId: b.positionId } }) }).id;
  assert.equal(db.outward.find(o => o.id === id).rate.customerRate, booked, 'charged the booked rate, not the new one');
  assert.equal(pos(db, b.positionId).status, 'Attached');
  /* a new booking uses the new rate */
  const b2 = run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 1000 });
  assert.ok(b2.customerRate > booked);
});

test('booking to concluded: submit, verify, authorise, release — and the events trade sent', () => {
  const db = fresh();
  const b = run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 45000 });
  const p = pos(db, b.positionId);
  assert.equal(p.side, 'SELL');
  assert.equal(T.coverState(p), 'Uncovered');
  const id = run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'booked', positionId: b.positionId } }) }).id;
  run(db, MAKER, 'outward.verify', { id, checks: CHECKS });
  run(db, CHECKER, 'outward.authorise', { id });
  const utr = run(db, OPS, 'outward.execute', { id }).utr;
  assert.equal(p.status, 'Concluded');
  assert.equal(p.linkRef, utr);
  assert.equal(p.linkedAmount, 45000);
  const types = db.tmsEvents.filter(e => e.positionId === p.id).map(e => e.type).reverse();
  assert.deepEqual(types, ['position.opened', 'position.attached', 'position.linked']);
  balanced(db);
});

test('the same booking cannot be used twice, and must match the request', () => {
  const db = fresh();
  const b = run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 45000 });
  refuses(() => run(db, MER, 'outward.submit', { draft: payment({ amount: 44000, allocations: [{ billId: 'BL-24014', amount: 44000 }], rate: { mode: 'booked', positionId: b.positionId } }) }), /Book the rate again for the new amount/);
  refuses(() => run(db, ARC, 'rate.release', { positionId: b.positionId }), /another customer/);
  run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'booked', positionId: b.positionId } }) });
  refuses(() => run(db, MER, 'outward.submit', { draft: payment({ allocations: [{ billId: 'BL-24015', amount: 45000 }], rate: { mode: 'booked', positionId: b.positionId } }) }), /already attached/);
});

test('cancel paths: release, replace, expiry, rejection and discard each cancel and return cover', () => {
  const db = fresh();
  /* release */
  const r1 = run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 1000 }).positionId;
  run(db, MER, 'rate.release', { positionId: r1 });
  assert.equal(pos(db, r1).status, 'Cancelled');
  /* replace: a new booking for the same draft cancels the old one */
  const r2 = run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 2000 }).positionId;
  const r3 = run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 2500, replaces: r2 }).positionId;
  assert.equal(pos(db, r2).cancelReason, 'Replaced by a new booking');
  /* expiry: the next command after 48 hours sweeps it */
  assert.equal(T.positionStatus(pos(db, r3), later(49)), 'Expired', 'screens show it expired before any sweep');
  run(db, DEALER, 'rates.import', {}, later(49));
  assert.match(pos(db, r3).cancelReason, /Lock expired/);
  /* rejection of an attached, covered position returns the cover to the pool */
  const b = run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 45000 }).positionId;
  const id = run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'booked', positionId: b } }) }).id;
  const cov = run(db, DEALER, 'cover.create', { currency: 'EUR', side: 'BUY', amount: 45000, rate: 95.8, counterparty: 'HDFC Bank' }).id;
  run(db, DEALER, 'cover.allocate', { source: cov, rows: [{ positionId: b, amount: 45000 }] });
  assert.equal(T.coverState(pos(db, b)), 'Covered');
  run(db, MAKER, 'outward.query', { id, question: 'Upload the signed invoice.' });
  run(db, CHECKER, 'outward.reject', { id, reason: 'Customer withdrew the payment' });  /* allowed from a query now */
  assert.equal(pos(db, b).status, 'Cancelled');
  assert.equal(db.covers.find(c => c.id === cov).allocated, 0, 'cover is back in the pool');
  assert.equal(pos(db, b).covered, 0);
  /* discarding a saved draft releases its booking */
  const bk = run(db, MER, 'rate.book', { dir: 'out', currency: 'GBP', amount: 500 }).positionId;
  const dr = run(db, MER, 'outward.saveDraft', { draft: { currency: 'GBP', amount: 500, rate: { mode: 'booked', positionId: bk } } }).id;
  assert.equal(db.outward.find(o => o.id === dr).rate.positionId, bk);
  run(db, MER, 'outward.discardDraft', { id: dr });
  assert.equal(pos(db, bk).cancelReason, 'Draft discarded');
  balanced(db);
});

test('open-booking limit per customer, and it counts only unused bookings', () => {
  const db = fresh();
  for (let i = 0; i < 4; i++) run(db, MER, 'rate.book', { dir: 'out', currency: 'USD', amount: 100 + i });
  /* OR-5105's draft booking is the fifth */
  refuses(() => run(db, MER, 'rate.book', { dir: 'out', currency: 'USD', amount: 999 }), /already holds 5 open rate bookings/);
  const one = db.positions.find(p => p.smeId === 'SME-1001' && p.status === 'Open' && p.amount === 100);
  run(db, MER, 'rate.release', { positionId: one.id });
  run(db, MER, 'rate.book', { dir: 'out', currency: 'USD', amount: 999 });
});

test('allocation: bank cover and internal cross, with every refusal', () => {
  const db = fresh();
  refuses(() => run(db, DEALER, 'cover.create', { currency: 'USD', side: 'BUY', amount: 50000, rate: 88.3, counterparty: 'Some Bank' }), /Counterparty/);
  refuses(() => run(db, DEALER, 'cover.create', { currency: 'USD', side: 'BUY', amount: 50000, rate: 88.3, counterparty: 'Kotak Mahindra Bank', type: 'Forward', valueDate: '2026-10-30' }), /not set up for forward/);
  refuses(() => run(db, DEALER, 'cover.create', { currency: 'USD', side: 'BUY', amount: 50000, rate: 88.3, counterparty: 'Axis Bank', type: 'Forward' }), /later value date/);
  refuses(() => run(db, TCHECK, 'cover.create', { currency: 'USD', side: 'BUY', amount: 50000, rate: 88.3, counterparty: 'Axis Bank' }), /cannot|withheld/);
  const cov = run(db, DEALER, 'cover.create', { currency: 'USD', side: 'BUY', amount: 5000, rate: 88.3, counterparty: 'Axis Bank' }).id;
  assert.equal(db.covers.find(c => c.id === cov).status, 'Active', 'live when saved');
  refuses(() => run(db, TCHECK, 'cover.allocate', { source: cov, rows: [] }), /cannot|withheld/);
  const usdSell = db.positions.filter(p => p.currency === 'USD' && p.side === 'SELL' && p.status !== 'Held' && T.uncovered(p) >= 3000)
    .sort((x, y) => T.uncovered(y) - T.uncovered(x));
  const [a, b] = usdSell;
  refuses(() => run(db, DEALER, 'cover.allocate', { source: cov, rows: [{ positionId: a.id, amount: T.uncovered(a) + 1 }] }), /uncovered/);
  refuses(() => run(db, DEALER, 'cover.allocate', { source: cov, rows: [{ positionId: a.id, amount: 3000 }, { positionId: b.id, amount: 3000 }] }), /more than the/);
  const eur = db.positions.find(p => p.currency === 'EUR' && T.uncovered(p) > 0);
  refuses(() => run(db, DEALER, 'cover.allocate', { source: cov, rows: [{ positionId: eur.id, amount: 1 }] }), /not USD/);
  const held = db.positions.find(p => p.status === 'Held');
  refuses(() => run(db, DEALER, 'cover.allocate', { source: cov, rows: [{ positionId: held.id, amount: 1 }] }), /held/);
  run(db, DEALER, 'cover.allocate', { source: cov, rows: [{ positionId: a.id, amount: 3000 }, { positionId: b.id, amount: 2000 }] });
  assert.equal(db.covers.find(c => c.id === cov).allocated, 5000);
  /* GBP: Meridian's advance receipt (a BUY) crosses against its sales */
  const gbpBuy = db.positions.find(p => p.smeId && p.currency === 'GBP' && p.side === 'BUY' && T.uncovered(p) > 0);
  const gbpSell = db.positions.filter(p => p.smeId && p.currency === 'GBP' && p.side === 'SELL' && T.uncovered(p) > 0);
  const before = T.netByCurrency(db, NOW).GBP;
  const crossed = gbpSell.reduce((t, p) => t + T.uncovered(p), 0);
  run(db, DEALER, 'cover.allocate', { source: gbpBuy.id, rows: gbpSell.map(p => ({ positionId: p.id, amount: T.uncovered(p) })) });
  assert.equal(T.netByCurrency(db, NOW).GBP.net, before.net, 'a cross leaves the net unchanged');
  assert.equal(T.netByCurrency(db, NOW).GBP.crossable, Math.round((before.crossable - crossed) * 100) / 100, 'both legs shrink by what was crossed');
  gbpSell.forEach(p => assert.equal(T.coverState(p), 'Covered'));
  refuses(() => run(db, DEALER, 'cover.allocate', { source: gbpBuy.id, rows: [{ positionId: db.positions.find(p => p.currency === 'GBP' && p.side === 'BUY' && p !== gbpBuy)?.id || 'POS-9999', amount: 1 }] }), /./);
  balanced(db);
});

test('P&L: sales margin and dealing result, signed by side, all in INR', () => {
  const db = fresh();
  const b = run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 10000 }).positionId;
  const p = pos(db, b);
  const cov = run(db, DEALER, 'cover.create', { currency: 'EUR', side: 'BUY', amount: 10000, rate: p.refRate - 0.2, counterparty: 'ICICI Bank' }).id;
  run(db, DEALER, 'cover.allocate', { source: cov, rows: [{ positionId: b, amount: 10000 }] });
  const row = T.pnl(db, NOW).rows.find(r => r.positionId === b);
  assert.equal(row.sales, Math.round((p.customerRate - p.refRate) * 10000 * 100) / 100, 'sale: customer rate above the reference');
  assert.equal(row.realised, 2000, 'bought cover 0.20 below the reference on 10,000');
  assert.equal(row.unrealised, 0);
  /* a purchase: selling cover above the reference is a gain */
  const di = db.positions.find(x => x.recordId === 'DI-9001');
  const r2 = T.pnl(db, NOW).rows.find(r => r.positionId === di.id);
  assert.equal(r2.realised, Math.round((112.46 - di.refRate) * di.amount * 100) / 100);
  assert.ok(r2.sales > 0, 'buying below the reference is sales margin');
});

test('deals: treasury issues, branch applies, single use, bound to the customer', () => {
  const db = fresh();
  refuses(() => run(db, MAKER, 'deal.issue', { smeId: 'SME-1002', dir: 'out', currency: 'USD', amount: 10000, rate: 88.8 }), /cannot|withheld/);
  refuses(() => run(db, DEALER, 'deal.issue', { smeId: 'SME-1002', dir: 'out', currency: 'USD', amount: 10000, rate: 99 }), /3%/);
  const d = run(db, DEALER, 'deal.issue', { smeId: 'SME-1002', dir: 'out', currency: 'USD', amount: 10000, rate: 88.8, validHours: 4 });
  assert.equal(pos(db, d.positionId).status, 'Open', 'the exposure is on the book at issue');
  const arcPay = { beneficiaryId: 'BEN-005', beneficiary: 'Shenzhen Ruiyang Electronics', beneficiaryCountry: 'China', beneficiaryAccount: '6222021001128845',
    beneficiaryBank: 'Bank of China', beneficiaryBankCountry: 'China', swift: 'BKCHCNBJ', currency: 'USD', amount: 8000, remittanceType: 'AIR',
    purposeCode: 'S0101', executionDate: '2026-09-26', debitAccountId: 'BA-004', allocations: [], docs: { pi: doc('pi') }, declarations: DEC };
  const docsFor = Engine.checklist(db, 'AIR', 'S0101', 8000 * 88.8).filter(x => x.required).reduce((o, x) => ({ ...o, [x.id]: doc(x.id) }), {});
  arcPay.docs = docsFor;
  refuses(() => run(db, ARC, 'outward.submit', { draft: { ...arcPay, rate: { mode: 'deal', dealRef: d.id } } }), /applied by AD2/);
  refuses(() => run(db, MAKER, 'outward.submit', { actingFor: 'SME-1001', draft: { ...payment(), rate: { mode: 'deal', dealRef: d.id } } }), /another customer/);
  refuses(() => run(db, MAKER, 'outward.submit', { actingFor: 'SME-1002', draft: { ...arcPay, amount: 12000, rate: { mode: 'deal', dealRef: d.id } } }), /covers up to/);
  const id = run(db, MAKER, 'outward.submit', { actingFor: 'SME-1002', draft: { ...arcPay, rate: { mode: 'deal', dealRef: d.id } } }).id;
  const p = pos(db, d.positionId);
  assert.equal(p.status, 'Attached');
  assert.equal(p.cancelledAmount, 2000, 'the unused part of the deal is released');
  assert.equal(db.deals.find(x => x.id === d.id).usedOn, id);
  refuses(() => run(db, MAKER, 'outward.submit', { actingFor: 'SME-1002', draft: { ...arcPay, rate: { mode: 'deal', dealRef: d.id } } }), /used/);
  /* an unused deal expires with its position */
  const d2 = run(db, DEALER, 'deal.issue', { smeId: 'SME-1002', dir: 'out', currency: 'USD', amount: 5000, rate: 88.8, validHours: 1 });
  run(db, DEALER, 'rates.import', {}, later(2));
  assert.equal(db.deals.find(x => x.id === d2.id).status, 'Expired');
  balanced(db);
});

test('rate desk: band, four-eyes, supersede, reject with a reason — and trade pricing follows it', () => {
  const db = fresh();
  const usd = () => db.currencies.find(c => c.code === 'USD').refRate;
  const row = (pr, cur) => db.rateDesk.find(r => r.product === pr && r.currency === cur);
  refuses(() => run(db, DEALER, 'rates.propose', { rows: [{ product: 'REM', currency: 'USD', base: 95, card: 95.5 }] }), /more than 2%/);
  refuses(() => run(db, DEALER, 'rates.propose', { rows: [{ product: 'REM', currency: 'USD', base: 88.4, card: 88.1 }] }), /cannot be below the base/);
  refuses(() => run(db, DEALER, 'rates.propose', { rows: [] }), /at least one/);
  refuses(() => run(db, MAKER, 'rates.propose', { rows: [{ product: 'REM', currency: 'USD', base: 88.5, card: 89.2 }] }), /cannot|withheld/);
  const r1 = run(db, DEALER, 'rates.propose', { rows: [{ product: 'REM', currency: 'USD', base: 88.5, card: 89.2 }] }).id;
  refuses(() => run(db, DEALER, 'approval.approve', { id: r1 }), /cannot/);
  const r2 = run(db, DEALER, 'rates.propose', { rows: [{ product: 'REM', currency: 'USD', base: 88.52, card: 89.25 }] }).id;
  assert.equal(db.approvals.find(x => x.id === r1).status, 'Superseded', 'a maker’s newer proposal supersedes the older one');
  refuses(() => run(db, TCHECK, 'approval.approve', { id: r1 }), /superseded/);
  refuses(() => run(db, TCHECK, 'approval.reject', { id: r2 }), /reason/i);
  run(db, TCHECK, 'approval.reject', { id: r2, reason: 'Wait for the RBI reference rate' });
  assert.equal(usd(), 88.42, 'nothing published');
  /* approved: the base is the trade reference, and every card moves with it */
  const cardBefore = row('FXC', 'USD').card;
  const r3 = run(db, DEALER2, 'rates.propose', { rows: [{ product: 'REM', currency: 'USD', base: 88.5, card: 89.2 }] }).id;
  run(db, TCHECK, 'approval.approve', { id: r3 });
  assert.equal(usd(), 88.5);
  assert.equal(row('REM', 'USD').card, 89.2);
  assert.equal(row('FXC', 'USD').card, Math.round((cardBefore + 0.08) * 10000) / 10000, 'the spread is kept, the base moves');
  const b = run(db, MER, 'rate.book', { dir: 'out', currency: 'USD', amount: 1000 });
  assert.equal(pos(db, b.positionId).refRate, 88.5, 'trade books on the published base');
  /* nothing is priced in a currency the desk has not published */
  row('REM', 'EUR').status = 'Not published';
  refuses(() => run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 1000 }), /No card rate is published for EUR/);
  refuses(() => run(db, MER, 'outward.submit', { draft: payment({ rate: { mode: 'booked' } }) }), /No card rate is published/);
});

test('what each role sees: the customer, the branch and treasury', () => {
  const db = fresh();
  run(db, MER, 'rate.book', { dir: 'out', currency: 'EUR', amount: 1000 });
  const sme = Engine.scopeState(db, MER);
  assert.ok(sme.positions.length > 0 && sme.positions.every(p => p.smeId === 'SME-1001'));
  assert.ok(sme.positions.every(p => p.refRate === undefined && p.margin === undefined && p.covered === undefined));
  assert.deepEqual([sme.covers.length, sme.deals.length, sme.tmsEvents.length, sme.approvals.length, sme.limits.length], [0, 0, 0, 0, 0]);
  assert.ok(sme.rateDesk.length && sme.rateDesk.every(r => r.card === undefined && ['REM', 'INW'].includes(r.product)), 'whether it can book, never the card rate');
  const branch = Engine.scopeState(db, MAKER);
  assert.ok(branch.positions.length > 5 && branch.positions.every(p => p.covered === undefined && p.coverState && p.smeId));
  assert.equal(branch.covers.length, 0, 'the branch sees no cover rates');
  assert.ok(branch.deals.length > 0, 'the branch sees the deals it may apply');
  const tr = Engine.scopeState(db, DEALER);
  assert.equal(tr.scope, 'tmp-full');
  assert.ok(tr.covers.length && tr.coverAllocations.length && tr.tmsEvents.length && tr.approvals.length && tr.rateDesk[0].card > 0);
  assert.ok(tr.positions.some(p => !p.smeId), 'treasury sees branch deals and trade bookings in one book');
  const adm = Engine.scopeState(db, ADMIN);
  assert.ok(adm.covers.length && adm.integrations.length, 'the administrator oversees the book and the portal settings');
  const pub = Engine.scopeState(db, null);
  assert.ok(pub.currencies.every(c => c.refRate === undefined), 'signed out: no reference rates');
  assert.equal(pub.positions.length, 0);
  /* treasury holds no trade authority, and the branch none in treasury */
  refuses(() => run(db, DEALER, 'outward.verify', { id: 'OR-5106', checks: CHECKS }), /cannot/);
  refuses(() => run(db, DEALER, 'rate.book', { dir: 'out', currency: 'USD', amount: 10 }), /cannot/);
  refuses(() => run(db, OPS, 'cover.create', { currency: 'USD', side: 'BUY', amount: 10, rate: 88, counterparty: 'HDFC Bank' }), /cannot/);
});

test('cut-off: uncovered positions are flagged, not cancelled, and the dealer is told once', () => {
  const db = fresh();
  const before = T.exceptions(db, NOW).filter(e => e.type === 'Uncovered after cut-off');
  assert.equal(before.length, 0, 'nothing before 16:00 IST');
  const evening = '2026-09-24T11:00:00.000Z';            /* 16:30 IST */
  const after = T.exceptions(db, evening).filter(e => e.type === 'Uncovered after cut-off');
  assert.ok(after.some(e => e.currency === 'USD'));
  const open = db.positions.filter(p => p.status === 'Attached').length;
  run(db, DEALER, 'rates.import', {}, evening);
  run(db, DEALER, 'rates.import', {}, evening);
  assert.equal(db.positions.filter(p => p.status === 'Attached').length, open, 'cut-off cancels no trade position');
  assert.equal(db.notifications.filter(n => /Cut-off passed with USD/.test(n.text)).length, 1, 'told once per currency per day');
});

test('market simulation: repeatable, bounded, and off means the published rate', () => {
  const db = fresh();
  const m1 = T.marketRate(db, 'USD', NOW), m2 = T.marketRate(db, 'USD', NOW);
  assert.equal(m1, m2);
  assert.notEqual(T.marketRate(db, 'USD', later(3)), m1, 'it moves');
  assert.ok(Math.abs(m1 / 88.42 - 1) < 0.005, 'within half a percent of the base');
  run(db, ADMIN, 'settings.update', { marketSim: false });
  assert.equal(T.marketRate(db, 'USD', later(3)), 88.42);
});

test('disposal: INR credit is a purchase position linked by the FIRC; EEFC opens none', () => {
  const db = fresh();
  const i = db.inward.find(x => x.id === 'IR-3303');
  const b = run(db, MER, 'rate.book', { dir: 'in', currency: i.currency, amount: 60000 }).positionId;
  assert.equal(pos(db, b).side, 'BUY');
  const docs = Engine.checklist(db, 'TRADE', 'P0102', 0, { option: 'knockoff' }).filter(x => x.required).reduce((o, x) => ({ ...o, [x.id]: doc(x.id) }), {});
  const id = run(db, MER, 'disposal.submit', { draft: { inwardId: 'IR-3303', amount: 60000, option: 'knockoff', purposeCode: 'P0102',
    allocations: [{ billId: 'BL-24003', amount: 50000 }], creditAccountId: 'BA-001', rate: { mode: 'booked', positionId: b }, docs, declarations: DEC } }).id;
  run(db, MAKER, 'disposal.verify', { id, checks: { documents: true, bills: true, account: true, sanctions: true } });
  run(db, CHECKER, 'disposal.authorise', { id });
  const firc = run(db, OPS, 'disposal.process', { id }).firc;
  assert.equal(pos(db, b).status, 'Concluded');
  assert.equal(pos(db, b).linkRef, firc);
  const count = db.positions.length;
  const eefc = db.accounts.find(a => a.smeId === 'SME-1003' && a.currency !== 'INR');
  if (eefc) {
    const rc = db.inward.find(x => x.smeId === 'SME-1003' && x.available > 0 && x.currency === eefc.currency);
    if (rc) {
      run(db, NIL, 'disposal.submit', { draft: { inwardId: rc.id, amount: 1000, option: 'advance', purposeCode: 'P0103', creditAccountId: eefc.id,
        docs: Engine.checklist(db, 'TRADE', 'P0103', 0, { option: 'advance' }).filter(x => x.required).reduce((o, x) => ({ ...o, [x.id]: doc(x.id) }), {}), declarations: DEC } });
      assert.equal(db.positions.length, count, 'EEFC credit converts nothing');
    }
  }
  balanced(db);
});

test('test data lab: requests it parks are real positions', () => {
  const db = fresh();
  const n = db.positions.length;
  const r = run(db, MAKER, 'lab.queue', { smeId: 'SME-1001' });
  assert.ok(r.ids.length >= 2);
  r.ids.forEach(id => {
    const rec = db.outward.find(o => o.id === id) || db.disposals.find(d => d.id === id);
    assert.ok(rec.rate.positionId, id + ' has a position');
    assert.equal(pos(db, rec.rate.positionId).recordId, id);
  });
  assert.ok(db.positions.length > n);
  balanced(db);
});

test('update FX deal: a phone deal replaces the booked rate after submission, and the book follows', () => {
  const db = fresh();
  const o = db.outward.find(x => x.id === 'OR-5103');            /* seeded: Verified, booked EUR 88,400, no stage keys */
  const p0 = pos(db, o.rate.positionId);
  const cov = db.covers.find(c => c.id === db.coverAllocations.find(x => x.positionId === p0.id).coverId);
  const alloc0 = cov.allocated;
  /* validation and who may */
  refuses(() => run(db, MAKER, 'outward.updateDeal', { id: o.id, dealRef: 'ab', customerRate: 96 }), /4–30/);
  refuses(() => run(db, MAKER, 'outward.updateDeal', { id: o.id, dealRef: 'DESK-0924/7', customerRate: -96 }), /positive/);
  refuses(() => run(db, MAKER, 'outward.updateDeal', { id: o.id, dealRef: 'DESK-0924/7', customerRate: 'x' }), /positive/);
  refuses(() => run(db, MAKER, 'outward.updateDeal', { id: o.id, dealRef: 'DESK-0924/7', customerRate: 99.5 }), /3%/);
  refuses(() => run(db, MAKER, 'outward.updateDeal', { id: o.id, dealRef: 'DESK-0924/7' }), /not issued by treasury/);
  [CHECKER, OPS, MER, DEALER].forEach(w => refuses(() => run(db, w, 'outward.updateDeal', { id: o.id, dealRef: 'DESK-0924/7', customerRate: 96.1 }), /cannot/));
  /* happy path */
  run(db, MAKER2, 'outward.updateDeal', { id: o.id, dealRef: 'desk-0924/7', customerRate: 96.1 });
  assert.deepEqual([o.rate.mode, o.rate.dealRef, o.rate.customerRate], ['deal', 'DESK-0924/7', 96.1]);
  assert.equal(o.inrAmount, Math.round(88400 * 96.1 * 100) / 100);
  assert.equal(o.debitInr, Math.round((o.inrAmount + o.charges.reduce((t, c) => t + c.amount, 0)) * 100) / 100);
  const swiftCfg = db.smes.find(s => s.id === o.smeId).config.charges.find(c => c.category === 'swift');
  assert.equal(o.charges.find(c => c.name === swiftCfg.name).amount, swiftCfg.byCurrency.EUR, 'repricing keeps the EUR SWIFT charge');
  assert.ok(o.risk.flags.some(f => f.rule === 'deal'), 'compliance sees the deal');
  assert.equal(p0.status, 'Cancelled', 'the booking is released');
  assert.equal(cov.allocated, alloc0 - 50000, 'its cover goes back to the pool');
  const p1 = pos(db, o.rate.positionId);
  assert.deepEqual([p1.status, p1.source, p1.dealId, p1.recordId, p1.amount, p1.customerRate], ['Attached', 'Deal', 'DESK-0924/7', o.id, 88400, 96.1]);
  assert.equal(p1.margin, Math.round((96.1 - 95.87) * 100));
  assert.equal(db.deals.find(d => d.id === 'DESK-0924/7').status, 'Used');
  assert.ok(db.audit.some(x => x.record === o.id && /AD2 Maker/.test(x.actor) && /booked rate at [\d.]+ → deal DESK-0924\/7 at 96\.1000/.test(x.action)));
  /* four-eyes: back to Submitted, and whoever changed the rate takes no later step */
  assert.equal(o.status, 'Submitted'); assert.ok(!o.wf.verified);
  refuses(() => run(db, MAKER2, 'outward.verify', { id: o.id, checks: CHECKS }), /changed the FX deal/);
  /* the same phone deal is corrected in place */
  refuses(() => run(db, MAKER2, 'outward.updateDeal', { id: o.id, dealRef: 'DESK-0924/7', customerRate: 96.1 }), /already at/);
  run(db, MAKER2, 'outward.updateDeal', { id: o.id, dealRef: 'DESK-0924/7', customerRate: 96.05 });
  assert.equal(o.rate.positionId, p1.id); assert.equal(p1.customerRate, 96.05);
  run(db, MAKER, 'outward.verify', { id: o.id, checks: CHECKS });
  refuses(() => run(db, MAKER2, 'outward.authorise', { id: o.id }), /cannot/);
  run(db, CHECKER, 'outward.authorise', { id: o.id });
  refuses(() => run(db, MAKER, 'outward.updateDeal', { id: o.id, dealRef: 'DESK-0924/8', customerRate: 96 }), /only before authorisation/);
  run(db, OPS, 'outward.execute', { id: o.id });
  assert.equal(p1.status, 'Concluded');
  balanced(db);
});

test('update FX deal: an issued deal keeps its rate; drafts take a typed phone-deal rate; disposals too', () => {
  const db = fresh();
  const o = db.outward.find(x => x.id === 'OR-5106');            /* Arcadia, Submitted, USD 52,000 */
  const d = run(db, DEALER, 'deal.issue', { smeId: o.smeId, dir: 'out', currency: 'USD', amount: 60000, rate: 88.9 });
  refuses(() => run(db, MAKER, 'outward.updateDeal', { id: o.id, dealRef: d.id, customerRate: 88.7 }), /issued at 88\.9000/);
  run(db, MAKER, 'outward.updateDeal', { id: o.id, dealRef: d.id, customerRate: 88.9 });
  assert.equal(pos(db, d.positionId).cancelledAmount, 8000, 'the unused part of the deal goes back');
  refuses(() => run(db, MAKER, 'outward.updateDeal', { id: o.id, dealRef: d.id, customerRate: 88.8 }), /reissue/);
  run(db, MAKER, 'outward.updateDeal', { id: o.id, dealRef: 'DESK-77', customerRate: 88.75 });
  assert.equal(pos(db, d.positionId).status, 'Cancelled'); assert.equal(db.deals.find(x => x.id === d.id).status, 'Withdrawn');
  /* draft: a typed deal reference carries its rate onto the book at submit */
  const arcPay = { beneficiaryId: 'BEN-005', beneficiary: 'Shenzhen Ruiyang Electronics', beneficiaryCountry: 'China', beneficiaryAccount: '6222021001128845',
    beneficiaryBank: 'Bank of China', beneficiaryBankCountry: 'China', swift: 'BKCHCNBJ', currency: 'USD', amount: 8000, remittanceType: 'AIR',
    purposeCode: 'S0101', executionDate: '2026-09-26', debitAccountId: 'BA-004', allocations: [], declarations: DEC,
    docs: Engine.checklist(db, 'AIR', 'S0101', 8000 * 88.8).filter(x => x.required).reduce((m, x) => ({ ...m, [x.id]: doc(x.id) }), {}) };
  const sub = rate => run(db, MAKER, 'outward.submit', { actingFor: 'SME-1002', draft: { ...arcPay, rate: { mode: 'deal', dealRef: 'PH-1', customerRate: rate } } });
  refuses(() => sub(0), /not issued by treasury/);
  refuses(() => sub(80), /3%/);
  const id = sub(88.8).id, r = db.outward.find(x => x.id === id);
  assert.equal(r.inrAmount, 8000 * 88.8);
  assert.deepEqual([pos(db, r.rate.positionId).status, pos(db, r.rate.positionId).channel], ['Attached', 'Assisted']);
  /* disposal: the same command */
  const di = db.disposals.find(x => x.id === 'DI-9003');
  const old = pos(db, di.rate.positionId);
  refuses(() => run(db, CHECKER, 'disposal.updateDeal', { id: di.id, dealRef: 'PH-IN-1', customerRate: 24 }), /cannot/);
  run(db, MAKER, 'disposal.updateDeal', { id: di.id, dealRef: 'PH-IN-1', customerRate: 24 });
  assert.equal(old.status, 'Cancelled');
  assert.equal(di.creditInr, Math.round(di.amount * 24 * 100) / 100);
  assert.deepEqual([pos(db, di.rate.positionId).side, pos(db, di.rate.positionId).margin], ['BUY', 7]);
  refuses(() => run(db, MAKER, 'disposal.verify', { id: di.id, checks: { documents: true, account: true, sanctions: true, bills: true } }), /changed the FX deal/);
  balanced(db);
});
