/* Treasury Management Portal tests: the branch counter, the rate desk,
   FX Plus bills, cut-off, the approvals inbox, liquidity and limits — and
   the trade portal flowing into the same book. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../public/engine.js');
const { SEED } = require('../public/data.js');
const T = Engine.treasury, V = Engine.tmp;

const NOW = '2026-09-24T06:00:00.000Z';                 /* 11:30 IST, before the 16:00 cut-off */
const later = h => new Date(Date.parse(NOW) + h * 3600000).toISOString();
const who = (d, l) => ({ domainId: d, loginId: l });
const MER = who('MERIDIANTEX', 'SMEUSER'), ARC = who('ARCADIACOMP', 'SMEUSER');
const MAKER = who('AD2', 'MAKER'), CHECKER = who('AD2', 'CHECKER'), OPS = who('AD2', 'OPS');
const DEALER = who('AD2', 'DEALER'), DEALER2 = who('AD2', 'DEALER2'), TCHECK = who('AD2', 'TCHECKER'), TCHECK2 = who('AD2', 'TCHECKER2');
const TVIEW = who('AD2', 'TVIEW'), BRANCH = who('AD2', 'BRANCH'), BRANCH2 = who('AD2', 'BRANCH2'), AIRPORT = who('AD2', 'AIRPORT');
const AGENT = who('SUNDARFX', 'AGENT'), RBULK = who('AD2', 'RBULK'), FIN = who('AD2', 'FINANCE'), ADMIN = who('AD2', 'ADMIN'), MASTER = who('TEST', 'MASTER');
const run = (db, w, cmd, p, now = NOW) => Engine.execute(db, w, cmd, p, { now, hashPassword: pw => 'plain$' + pw });
const refuses = (fn, re) => assert.throws(fn, e => e instanceof Engine.EngineError && (!re || re.test(e.message)), re && String(re));
const fresh = () => Engine.freshState(SEED, NOW);
const pos = (db, id) => db.positions.find(p => p.id === id);
const doc = n => ({ filename: n + '.pdf', size: '100 KB', type: 'application/pdf' });
const DEC = { fema: true, ofac: true };
const CHECKS = { documents: true, sanctions: true, purpose: true, beneficiary: true };
const approvalFor = (db, type, ref) => db.approvals.find(x => x.type === type && x.status === 'Pending' && (!ref || x.ref === ref));
/* amount = linked + remaining + cancelled, for every position, always */
const balanced = db => db.positions.forEach(p => {
  const sum = (p.linkedAmount || 0) + T.remaining(p) + (p.cancelledAmount || 0);
  assert.ok(Math.abs(sum - p.amount) < 0.01, `${p.id}: ${p.linkedAmount} + ${T.remaining(p)} + ${p.cancelledAmount} ≠ ${p.amount}`);
  assert.ok((p.covered || 0) <= T.live(p) + 0.01, `${p.id} covered beyond its live amount`);
  assert.ok(Math.abs((p.links || []).reduce((t, l) => t + l.amount, 0) - (p.linkedAmount || 0)) < 0.01 || (p.adjustments || []).length, `${p.id} links add up`);
});
/* quote and book at the counter, stepping through the review when asked */
const quoteAndBook = (db, w, deal, now = NOW) => {
  const q = run(db, w, 'quote.get', deal, now).quote;
  return { q, r: run(db, w, 'quote.book', { id: q.id, reviewed: true }, now) };
};

test('seed: one book, branch deals and trade bookings, every figure balanced', () => {
  const db = fresh();
  assert.ok(db.positions.some(p => p.smeId) && db.positions.some(p => !p.smeId));
  assert.ok(db.positions.filter(p => !p.smeId).every(p => p.cutoffAt && p.product !== 'INW'), 'branch deals carry a cut-off');
  assert.ok(db.positions.filter(p => p.smeId).every(p => !p.cutoffAt), 'trade bookings keep their 48-hour lock instead');
  assert.equal(db.smes.find(s => s.id === 'SME-1001').branchId, 'BR-MUMFORT', 'Meridian (Maharashtra GSTIN) is serviced by Mumbai Fort');
  assert.ok(db.rateDesk.some(r => r.status === 'Not published'), 'some card rates are deliberately unpublished');
  assert.equal(db.rateDesk.filter(r => r.status === 'Published').length + db.rateDesk.filter(r => r.status === 'Not published').length, db.rateDesk.length);
  assert.ok(db.approvals.filter(x => x.status === 'Pending').length >= 5, 'a live approvals inbox');
  assert.ok(db.nostro.some(n => n.kind === 'Correspondent' && n.currency === 'USD'));
  balanced(db);
});

test('branch quote → book → FX Plus bill links back → concluded, stock moves', () => {
  const db = fresh();
  const q = run(db, BRANCH, 'quote.get', { product: 'CSH', currency: 'USD', side: 'SELL', amount: 2000, customerName: 'Walk-in — test', customerRef: 'CUST-1' }).quote;
  assert.equal(q.branchId, 'BR-MUMFORT', 'a branch user quotes for its own branch');
  assert.ok(q.rate >= q.base && q.rate <= q.card, 'sell rate sits between base and card');
  assert.deepEqual(q.stepped, ['First quote by this user'], 'first quote is stepped');
  refuses(() => run(db, BRANCH, 'quote.book', { id: q.id }), /stepped review/);
  const bk = run(db, BRANCH, 'quote.book', { id: q.id, reviewed: true });
  const p = pos(db, bk.positionId);
  assert.equal(p.status, 'Open');
  assert.equal(p.channel, 'Branch');
  assert.ok(p.cutoffAt > NOW, 'cut-off ahead');
  refuses(() => run(db, BRANCH, 'quote.book', { id: q.id, reviewed: true }), /booked/);
  /* second quote by the same user is not stepped */
  assert.deepEqual(run(db, BRANCH, 'quote.get', { product: 'CSH', currency: 'USD', side: 'SELL', amount: 100 }).quote.stepped, []);
  const stock = () => V.inventory(db, NOW).find(i => i.locationId === 'BR-MUMFORT' && i.currency === 'USD').qty;
  const before = stock();
  const b1 = run(db, BRANCH, 'fxp.punch', { positionId: p.id, amount: 1500 });
  assert.equal(b1.auto, true, 'a bill with the position reference links itself');
  assert.equal(T.remaining(p), 500);
  assert.equal(p.status, 'Open');
  assert.equal(stock(), before, 'stock moves when the deal concludes');
  const b2 = run(db, BRANCH, 'fxp.punch', { positionId: p.id, amount: 500, withRef: false });
  assert.equal(b2.auto, false, 'no reference: it waits for knock-off');
  run(db, BRANCH, 'knockoff.confirm', { positionId: p.id, links: [{ fxpId: b2.id, amount: 500 }] });
  assert.equal(p.status, 'Concluded');
  assert.equal(V.linkTrack(db, p, NOW), 'Complete');
  assert.equal(stock(), before - 2000, 'the cash deal took currency out of the branch');
  refuses(() => run(db, BRANCH, 'knockoff.confirm', { positionId: p.id, links: [{ fxpId: b2.id, amount: 1 }] }), /concluded/);
  balanced(db);
});

test('quotes expire and requote keeps every field; overrides stay inside the band', () => {
  const db = fresh();
  const q = run(db, BRANCH, 'quote.get', { product: 'REM', currency: 'EUR', side: 'SELL', amount: 3000, customerName: 'A. Shah', customerRef: 'REF-9' }).quote;
  refuses(() => run(db, BRANCH, 'quote.book', { id: q.id, reviewed: true }, later(0.25)), /expired/);
  const q2 = run(db, BRANCH, 'quote.requote', { id: q.id }, later(0.25)).quote;
  assert.equal(q2.version, 2);
  assert.equal(q2.customerRef, 'REF-9');
  assert.equal(q2.previousId, q.id);
  refuses(() => run(db, BRANCH, 'quote.get', { product: 'REM', currency: 'EUR', side: 'SELL', amount: 3000, overrideRate: q.card + 1 }), /between the base/);
  const o = run(db, BRANCH, 'quote.get', { product: 'REM', currency: 'EUR', side: 'SELL', amount: 3000, overrideRate: q.base + 0.01 }).quote;
  assert.ok(o.override && o.stepped.includes('Rate override'));
  /* above the stepped threshold */
  const big = run(db, BRANCH, 'quote.get', { product: 'REM', currency: 'USD', side: 'SELL', amount: 60000 }).quote;
  assert.ok(big.stepped.some(s => /Above/.test(s)));
  /* nothing is quoted where the desk has not published */
  refuses(() => run(db, BRANCH, 'quote.get', { product: 'FXC', currency: 'JPY', side: 'SELL', amount: 100000 }), /no published card rate/);
  refuses(() => run(db, BRANCH, 'quote.get', { product: 'INW', currency: 'USD', amount: 100 }), /Inward/);
  /* a branch user quotes only for its own branch */
  refuses(() => run(db, BRANCH, 'quote.get', { product: 'REM', currency: 'USD', side: 'SELL', amount: 100, branchId: 'BR-DELCP' }), /only for/);
});

test('cut-off: a branch deal not concluded is cancelled, the residual released and cover returned; trade keeps its lock', () => {
  const db = fresh();
  const { r } = quoteAndBook(db, BRANCH, { product: 'REM', currency: 'USD', side: 'SELL', amount: 5000 });
  const p = pos(db, r.positionId);
  run(db, BRANCH, 'fxp.punch', { positionId: p.id, amount: 3000 });
  const cov = run(db, DEALER, 'cover.create', { currency: 'USD', side: 'BUY', amount: 5000, rate: 88.1, counterparty: 'HDFC Bank' }).id;
  run(db, DEALER, 'cover.allocate', { source: cov, rows: [{ positionId: p.id, amount: 5000 }] });
  const tradeOpen = db.positions.filter(x => x.smeId && x.status === 'Attached').length;
  /* a reminder is raised 30 minutes after booking with no bill (the other deal) */
  const { r: r2 } = quoteAndBook(db, BRANCH, { product: 'REM', currency: 'USD', side: 'SELL', amount: 700 });
  run(db, BRANCH, 'quote.get', { product: 'REM', currency: 'USD', side: 'SELL', amount: 1 }, later(0.6));
  assert.ok(db.reminders.some(x => x.positionId === r2.positionId && x.state === 'Open'), 'reminder raised');
  /* 16:05 IST */
  run(db, DEALER, 'rates.import', {}, '2026-09-24T10:35:00.000Z');
  assert.equal(p.status, 'Concluded', 'concluded at what was linked');
  assert.equal(p.cancelledAmount, 2000);
  assert.equal(p.covered, 3000, 'cover above the live amount went back to the pool');
  assert.equal(db.covers.find(c => c.id === cov).allocated, 3000);
  assert.equal(pos(db, r2.positionId).status, 'Cancelled');
  assert.ok(db.reminders.filter(x => x.positionId === r2.positionId).every(x => x.state === 'Closed'));
  assert.equal(db.positions.filter(x => x.smeId && x.status === 'Attached').length, tradeOpen, 'trade positions are not cut-off cancelled');
  balanced(db);
});

test('keep past cut-off, request cancel (agent), cancel with a reason', () => {
  const db = fresh();
  const { r } = quoteAndBook(db, BRANCH, { product: 'FXC', currency: 'EUR', side: 'SELL', amount: 1000 });
  run(db, BRANCH, 'position.keep', { id: r.positionId, reason: 'Customer returns tomorrow' });
  assert.ok(pos(db, r.positionId).cutoffAt > '2026-09-25T05:00:00.000Z', 'held until 11:00 IST next day');
  run(db, DEALER, 'rates.import', {}, '2026-09-24T10:35:00.000Z');
  assert.equal(pos(db, r.positionId).status, 'Open', 'kept past today’s cut-off');
  /* the agent requests, the branch cancels */
  const a = quoteAndBook(db, AGENT, { product: 'REM', currency: 'USD', side: 'SELL', amount: 800 });
  const ap = pos(db, a.r.positionId);
  assert.equal(ap.branchId, 'BR-PUNE');
  assert.equal(ap.channel, 'Agent');
  assert.ok(ap.customerRate > a.q.base, 'the agent spread is on top');
  refuses(() => run(db, AGENT, 'position.cancel', { id: ap.id, reason: 'x' }), /cannot/);
  run(db, AGENT, 'position.requestCancel', { id: ap.id, reason: 'Customer withdrew' });
  refuses(() => run(db, BRANCH, 'position.cancel', { id: ap.id, reason: 'x' }), /another branch/);
  refuses(() => run(db, BRANCH, 'position.cancel', { id: r.positionId }), /reason/i);
  run(db, BRANCH, 'position.cancel', { id: r.positionId, reason: 'Customer withdrew' });
  assert.equal(pos(db, r.positionId).status, 'Cancelled');
  balanced(db);
});

test('approvals inbox: maker-checker, own entry refused, reason required, resubmit as a new version', () => {
  const db = fresh();
  const id = run(db, DEALER, 'rates.propose', { rows: [{ product: 'CSH', currency: 'USD', base: 88.42, card: 89.6 }], reason: 'Intraday' }).id;
  const item = db.approvals.find(x => x.id === id);
  assert.ok(item.diff.length && item.diff[0].before && item.diff[0].after, 'the checker sees before and after');
  refuses(() => run(db, TVIEW, 'approval.approve', { id }), /cannot/);
  refuses(() => run(db, TCHECK, 'approval.reject', { id }), /reason/i);
  run(db, TCHECK, 'approval.reject', { id, reason: 'Card too wide for cash' });
  refuses(() => run(db, DEALER2, 'approval.resubmit', { id, note: 'x' }), /maker/);
  const v2 = run(db, DEALER, 'approval.resubmit', { id, note: 'Narrowed' }).id;
  assert.equal(db.approvals.find(x => x.id === v2).version, 2);
  assert.equal(item.status, 'Superseded');
  run(db, TCHECK2, 'approval.approve', { id: v2 });
  assert.equal(db.rateDesk.find(r => r.product === 'CSH' && r.currency === 'USD').card, 89.6);
  /* a checker who is also the maker is refused */
  const own = run(db, ADMIN, 'master.currencyLimit', { currency: 'USD', limit: 500000 });
  assert.ok(own.message);
  const lim = approvalFor(db, 'Exposure limit', 'USD');
  run(db, TCHECK, 'approval.approve', { id: lim.id });
  assert.equal(db.currencies.find(c => c.code === 'USD').exposureLimit, 500000);
  /* bulk reject needs one reason for all */
  const ids = db.approvals.filter(x => x.status === 'Pending' && x.makerKey !== 'AD2/TCHECKER').slice(0, 2).map(x => x.id);
  run(db, TCHECK, 'approval.bulkReject', { ids, reason: 'Month-end freeze' });
  ids.forEach(i => assert.equal(db.approvals.find(x => x.id === i).status, 'Rejected'));
});

test('customer limit: a breaching deal is held, released by a checker, or declined', () => {
  const db = fresh();
  const hv = db.limits.find(l => l.id === 'CORP-1211');
  const q = run(db, BRANCH, 'quote.get', { product: 'REM', currency: 'USD', side: 'SELL', amount: 50000, customerId: 'CORP-1211', customerRef: 'HV-1' }).quote;
  assert.equal(q.limit.breach, true);
  const b = run(db, BRANCH, 'quote.book', { id: q.id, reviewed: true });
  assert.equal(b.held, true);
  const p = pos(db, b.positionId);
  assert.equal(p.status, 'Held');
  assert.equal(run(db, BRANCH, 'fxp.punch', { positionId: p.id, amount: 100 }).auto, false, 'a bill for a held deal waits; it does not link');
  const apr = approvalFor(db, 'Held deal', p.id);
  run(db, TCHECK, 'approval.approve', { id: apr.id });
  assert.equal(p.status, 'Open');
  /* declined */
  const q2 = run(db, BRANCH, 'quote.get', { product: 'REM', currency: 'USD', side: 'SELL', amount: 60000, customerId: 'CORP-1211' }).quote;
  const p2 = pos(db, run(db, BRANCH, 'quote.book', { id: q2.id, reviewed: true }).positionId);
  run(db, TCHECK, 'approval.reject', { id: approvalFor(db, 'Held deal', p2.id).id, reason: 'Over the sanctioned line' });
  assert.equal(p2.status, 'Cancelled');
  /* raising the limit goes to a checker */
  const to = hv.limit * 2;
  run(db, DEALER, 'limits.raise', { id: hv.id, limit: to, reason: 'Sanction letter received' });
  assert.notEqual(hv.limit, to, 'not before approval');
  run(db, TCHECK, 'approval.approve', { id: approvalFor(db, 'Limit change', hv.id).id });
  assert.equal(V.limits(db, NOW).find(l => l.id === hv.id).limit, to);
  balanced(db);
});

test('the trade customer at the branch: quote → FX deal → applied in the trade portal → UTR concludes it and moves the Nostro', () => {
  const db = fresh();
  const q = run(db, BRANCH, 'quote.get', { product: 'REM', currency: 'EUR', side: 'SELL', amount: 20000, smeId: 'SME-1001' }).quote;
  const b = run(db, BRANCH, 'quote.book', { id: q.id, reviewed: true });
  assert.ok(b.dealId, 'a trade customer’s quote becomes an FX deal reference');
  const p = pos(db, b.positionId);
  assert.equal(p.smeId, 'SME-1001');
  assert.equal(p.channel, 'Treasury deal');
  assert.equal(p.cutoffAt, null, 'a deal keeps its validity, not the branch cut-off');
  const deal = db.deals.find(d => d.id === b.dealId);
  assert.equal(deal.rate, p.customerRate);
  /* the trade portal: AD2 applies the deal on the customer’s payment */
  const draft = { beneficiaryId: 'BEN-001', beneficiary: 'Filatura Ponti S.p.A.', beneficiaryCountry: 'Italy', beneficiaryAccount: 'IT60X0542811101000000123456',
    beneficiaryBank: 'Intesa Sanpaolo', beneficiaryBankCountry: 'Italy', swift: 'BCITITMM', currency: 'EUR', amount: 20000, remittanceType: 'DIR', purposeCode: 'S0102',
    executionDate: '2026-09-25', debitAccountId: 'BA-001', allocations: [{ billId: 'BL-24014', amount: 20000 }],
    docs: { transport: doc('t'), invoice: doc('i'), boe: doc('b') }, declarations: DEC, rate: { mode: 'deal', dealRef: b.dealId } };
  const id = run(db, MAKER, 'outward.submit', { actingFor: 'SME-1001', draft }).id;
  assert.equal(p.status, 'Attached');
  run(db, MAKER2(), 'outward.verify', { id, checks: CHECKS });
  run(db, CHECKER, 'outward.authorise', { id });
  const nostro = () => db.nostro.find(n => n.kind === 'Correspondent' && n.currency === 'EUR' && n.status === 'Current').balance;
  const ho = () => db.bankAccounts.find(x => x.id === 'BK-HDFC-1042').ledger;
  const n0 = nostro(), i0 = ho();
  const utr = run(db, OPS, 'outward.execute', { id }).utr;
  assert.equal(p.status, 'Concluded');
  assert.equal(p.links[0].kind, 'UTR');
  assert.equal(p.links[0].ref, utr);
  assert.equal(nostro(), n0 - 20000, 'the payment left the EUR Nostro');
  assert.ok(ho() > i0, 'the customer’s INR debit reached the head-office account');
  /* treasury sees the whole journey */
  const tr = Engine.scopeState(db, DEALER);
  assert.ok(tr.positions.find(x => x.id === p.id).links.length);
  assert.deepEqual(db.tmsEvents.filter(e => e.positionId === p.id).map(e => e.type).reverse(), ['position.opened', 'position.attached', 'position.linked']);
  balanced(db);
});
function MAKER2() { return who('AD2', 'MAKER2'); }

test('trade booking in the trade portal lands on the treasury book at the customer’s branch, and inward credits reach the Nostro', () => {
  const db = fresh();
  const b = run(db, MER, 'rate.book', { dir: 'out', currency: 'USD', amount: 12000 });
  const p = pos(db, b.positionId);
  assert.equal(p.product, 'REM');
  assert.equal(p.branchId, 'BR-MUMFORT');
  assert.equal(p.channel, 'Trade portal');
  const book = V.book(Engine.scopeState(db, DEALER), NOW);
  assert.ok(book.some(r => r.currency === 'USD' && r.branches.some(b => b.branchId === 'BR-MUMFORT')), 'the dealer’s book shows it');
  /* branch users never see trade customers’ bookings they do not own */
  const br = Engine.scopeState(db, BRANCH2);
  assert.ok(br.positions.every(x => x.branchId === 'BR-DELCP'));
  /* an inward credit recorded by operations moves the correspondent Nostro */
  const n = () => db.nostro.find(x => x.kind === 'Correspondent' && x.currency === 'USD' && x.status === 'Current').balance;
  const before = n();
  run(db, OPS, 'inward.record', { inward: { smeId: 'SME-1001', currency: 'USD', amount: 7500, remitter: 'Acme Inc', remitterCountry: 'United States' } });
  assert.equal(n(), before + 7500);
});

test('amendment: a reduced bill unwinds the link as a forward-dated adjustment and returns cover', () => {
  const db = fresh();
  const { r } = quoteAndBook(db, BRANCH, { product: 'REM', currency: 'GBP', side: 'SELL', amount: 4000 });
  const p = pos(db, r.positionId);
  const bill = run(db, BRANCH, 'fxp.punch', { positionId: p.id, amount: 4000 }).id;
  assert.equal(p.status, 'Concluded');
  const cov = run(db, DEALER, 'cover.create', { currency: 'GBP', side: 'BUY', amount: 4000, rate: 112.2, counterparty: 'ICICI Bank' }).id;
  run(db, DEALER, 'cover.allocate', { source: cov, rows: [{ positionId: p.id, amount: 4000 }] });
  const am = run(db, BRANCH, 'fxp.amend', { id: bill, change: 'Amount reduced', newAmount: 2500 }).id;
  run(db, DEALER, 'amend.toChecker', { id: am });
  run(db, TCHECK, 'approval.approve', { id: approvalFor(db, 'Amendment').id });
  assert.equal(p.linkedAmount, 2500);
  assert.equal(p.cancelledAmount, 1500);
  assert.equal(p.covered, 2500, '1,500 of cover returned to the pool');
  assert.equal(p.adjustments.length, 1);
  assert.equal(db.amendments.find(x => x.id === am).status, 'Adjusted');
  balanced(db);
});

test('forward cover settles through a checker; spot cover moves cash at once', () => {
  const db = fresh();
  const inr = () => db.bankAccounts.find(x => x.id === 'BK-ICICI-2051').ledger;
  const i0 = inr();
  run(db, DEALER, 'cover.create', { currency: 'USD', side: 'BUY', amount: 10000, rate: 88.2, counterparty: 'ICICI Bank' });
  assert.equal(inr(), i0 - 882000, 'spot cover paid from its settlement account');
  const f = run(db, DEALER, 'cover.create', { currency: 'EUR', side: 'BUY', amount: 30000, rate: 95.7, counterparty: 'ICICI Bank', type: 'Forward', valueDate: '2026-10-15' }).id;
  refuses(() => run(db, DEALER, 'forward.settle', { id: f, amount: 40000, evidence: 'X' }), /pending/);
  run(db, DEALER, 'forward.settle', { id: f, amount: 10000, evidence: 'ICICI-S1' });
  refuses(() => run(db, DEALER, 'forward.settle', { id: f, amount: 1000, evidence: 'ICICI-S2' }), /already has a settlement/);
  const c = db.covers.find(x => x.id === f);
  assert.equal(c.settled || 0, 0, 'nothing moves before approval');
  run(db, TCHECK, 'approval.approve', { id: approvalFor(db, 'Forward settlement', f).id });
  assert.equal(c.settled, 10000);
});

test('liquidity: Nostro upload with duplicates, integrations refresh, credit line rule preview', () => {
  const db = fresh();
  const day = String(db.nostro.find(n => n.kind === 'Issuer' && n.issuer === 'Visa' && n.currency === 'USD' && n.status === 'Current').statementAt).slice(0, 10);
  refuses(() => run(db, DEALER, 'nostro.upload', { rows: [{ issuer: 'Visa', currency: 'USD', balance: 201000, statementDate: day }] }), /duplicate/);
  const r = run(db, DEALER, 'nostro.upload', { rows: [{ issuer: 'Visa', currency: 'USD', balance: 201000, statementDate: day }, { issuer: 'Mastercard', currency: 'EUR', balance: 5000, statementDate: day }],
    onDuplicate: 'replace', reason: 'Revised statement' });
  assert.equal(r.committed, 1);
  assert.ok(approvalFor(db, 'Nostro upload — replace'));
  const sftp = db.integrations.find(i => i.id === 'FXP-SFTP');
  assert.equal(sftp.status, 'Delayed');
  const n = db.fxpTxns.length;
  run(db, DEALER, 'integration.retry', { id: 'FXP-SFTP' });
  assert.equal(sftp.status, 'Healthy');
  assert.ok(db.fxpTxns.length > n, 'bills in the SFTP pipe delivered');
  const line = db.creditLines.find(l => l.id === 'CL-ICICI');
  const u0 = V.lineUse(line).utilised;
  run(db, DEALER, 'credit.ruleVersion', { lineId: line.id, version: 'v0.1' });
  assert.equal(V.lineUse(line).utilised, u0, 'a rule version is preview only until approved');
  run(db, TCHECK, 'approval.approve', { id: approvalFor(db, 'Funding rule version').id });
  assert.equal(line.ruleVersion, 'v0.1');
});

test('finance maps card sales to a settlement; bulk booking request → treasury → checker → stock', () => {
  const db = fresh();
  const st = db.cardSettlements.find(s => s.id === 'SET-3201');
  const inv = db.cardActivity.find(x => x.kind === 'Sale' && x.prefix === '4147' && x.funding === 'INR' && x.amount - (x.mapped || 0) >= 20000);
  refuses(() => run(db, FIN, 'card.map', { id: st.id, rows: [{ invoiceId: db.cardActivity.find(x => x.funding === 'EEFC').id, amount: 10 }] }), /INR-funded/);
  run(db, FIN, 'card.map', { id: st.id, rows: [{ invoiceId: inv.id, amount: 20000 }] });
  assert.equal(V.reconOf(db, st).mapped, 20000);
  refuses(() => run(db, BRANCH, 'card.map', { id: st.id, rows: [] }), /cannot|withheld/);
  const id = run(db, RBULK, 'bulk.request', { branchId: 'BR-AHD', currency: 'USD', amount: 40000, requiredDate: '2026-09-26' }).id;
  refuses(() => run(db, RBULK, 'bulk.request', { branchId: 'BR-DELCP', currency: 'USD', amount: 1, requiredDate: '2026-09-26' }), /region/);
  run(db, DEALER, 'bulk.book', { id, rate: 88.6, bankRef: 'BK-2001', counterparty: 'HDFC Bank', valueDate: '2026-09-26' });
  const stock = () => (V.inventory(db, NOW).find(i => i.locationId === 'BR-AHD' && i.currency === 'USD') || { qty: 0 }).qty;
  const s0 = stock();
  run(db, TCHECK, 'approval.approve', { id: approvalFor(db, 'Bulk booking detail', id).id });
  assert.equal(stock(), s0 + 40000);
  assert.equal(db.bulkRequests.find(r => r.id === id).status, 'Booked');
});

test('exceptions are separate and owned; offline capture is flagged; admin changes go through a checker', () => {
  const db = fresh();
  const ex = V.exceptions(db, NOW);
  ['Position without transaction', 'Transaction without position', 'Currency mismatch', 'Unallocated cover'].forEach(t =>
    assert.ok(ex.some(x => x.type === t), 'exception type ' + t));
  const one = ex.find(x => x.type === 'Unallocated cover');
  run(db, DEALER, 'exception.note', { key: one.key, findings: 'Allocating after the 14:00 run', resolve: true });
  assert.ok(!V.exceptions(db, NOW).some(x => x.key === one.key), 'resolved exceptions leave the list');
  const off = run(db, BRANCH, 'offline.submit', { entries: [{ product: 'CSH', currency: 'USD', side: 'SELL', amount: 300, rate: 89.1, committedAt: later(-1), reason: 'Network outage', customerName: 'Walk-in' }] });
  assert.equal(pos(db, off.ids[0]).channel, 'Offline capture');
  refuses(() => run(db, BRANCH, 'offline.submit', { entries: [{ product: 'CSH', currency: 'USD', side: 'SELL', amount: 300, rate: 89.1, committedAt: later(-30), reason: 'Network outage' }] }), /24 hours/);
  run(db, ADMIN, 'tmpuser.add', { name: 'Ravi Menon', loginId: 'BRANCH9', role: 'AD2 Branch Inputter', branchScope: 'BR-KOCHI' });
  assert.ok(!db.logins.some(l => l.loginId === 'BRANCH9'), 'not before approval');
  run(db, TCHECK, 'approval.approve', { id: approvalFor(db, 'New user').id });
  const scope = Engine.scopeState(db, who('AD2', 'BRANCH9'));
  assert.equal(scope.scope, 'tmp-branch');
  assert.ok(scope.positions.every(p => p.branchId === 'BR-KOCHI'));
  run(db, ADMIN, 'master.cutoff', { product: 'REM', time: '15:30', effectiveFrom: '2026-09-25', reason: 'Correspondent window' });
  run(db, TCHECK, 'approval.approve', { id: approvalFor(db, 'Cut-off change').id });
  assert.equal(db.tmpProducts.find(p => p.code === 'REM').cutoff, '15:30');
  balanced(db);
});

test('what each TMP role sees', () => {
  const db = fresh();
  const s = w => Engine.scopeState(db, w);
  const br = s(BRANCH);
  assert.equal(br.scope, 'tmp-branch');
  assert.ok(br.positions.length && br.positions.every(p => p.branchId === 'BR-MUMFORT' && p.refRate === undefined && p.covered === undefined));
  assert.equal(br.covers.length + br.approvals.length + br.bankAccounts.length + br.nostro.length, 0);
  assert.ok(br.smes.length && br.smes.every(x => !x.config.margins), 'trade customers to quote, without their margins');
  const ag = s(AGENT);
  assert.equal(ag.scope, 'tmp-agent');
  assert.ok(ag.positions.every(p => p.bookedByKey === 'SUNDARFX/AGENT'));
  assert.equal(ag.fxpTxns.length + ag.inventory.length, 0);
  const bulk = s(RBULK);
  assert.ok(bulk.bulkRequests.length && bulk.positions.length === 0);
  const fin = s(FIN);
  assert.ok(fin.cardActivity.length && fin.positions.length === 0 && fin.approvals.every(x => ['Reconciliation adjustment', 'Nostro upload — replace'].includes(x.type)));
  const view = s(TVIEW);
  assert.equal(view.scope, 'tmp-full');
  refuses(() => run(db, TVIEW, 'cover.create', { currency: 'USD', side: 'BUY', amount: 1, rate: 88, counterparty: 'HDFC Bank' }), /cannot/);
  refuses(() => run(db, TVIEW, 'rates.propose', { rows: [{ product: 'REM', currency: 'USD', base: 88.4, card: 89 }] }), /cannot/);
  const m = s(MASTER);
  assert.equal(m.scope, 'master');
  assert.ok(m.rateDesk.length && m.approvals.length && m.positions.length);
  /* trade users keep their own portal: no TMP commands */
  refuses(() => run(db, MAKER, 'quote.get', { product: 'REM', currency: 'USD', side: 'SELL', amount: 1, branchId: 'BR-MUMFORT' }), /cannot/);
  refuses(() => run(db, MER, 'approval.approve', { id: db.approvals[0].id }), /cannot/);
});
