/* Full-platform QA. Drives every journey through the real UI, as each role
   would, on a throwaway server — onboarding (digital, offline, clarification,
   rejection), every outward product (DIR, LC, AIR, OTT) and inward variation
   (reported remittance, partial, advance, EEFC, disposal on behalf), bills
   (form, document AI, CSV, queries), knock-off with UFI, queries answered by
   the SME or by AD2 for it, four-eyes and segregation, reports, the test data
   lab, reset and the stale-state guard.

   Every scenario runs even if an earlier one fails, and the results are
   written to qa-report.json and qa-report.md next to the screenshots.

     npm run test:qa                   starts a throwaway local server
     BASE=https://… npm run test:qa    runs against a deployment (resets it)   */
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'ad2-qa');
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

async function startServer() {
  if (process.env.BASE) return { base: process.env.BASE.replace(/\/$/, ''), stop: () => {} };
  const port = 8700 + Math.floor(Math.random() * 500);
  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ad2-qa-')), 'state.json');
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), STATE_FILE: stateFile }, stdio: 'pipe' });
  await new Promise((res, rej) => { proc.stdout.on('data', d => /on http/.test(d) && res()); proc.on('exit', rej); setTimeout(res, 3000); });
  return { base: `http://localhost:${port}`, stop: () => proc.kill() };
}

(async () => {
  const srv = await startServer();
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  let errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  let n = 0;
  const results = [];
  let current = null;

  /* ---------- helpers ------------------------------------------------------ */
  const shot = (name, full) => page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(3, '0')}-${name}.png`), fullPage: !!full });
  const wait = ms => page.waitForTimeout(ms);
  const idle = () => page.waitForFunction(() => !document.body.classList.contains('busy'), null, { timeout: 15000 });
  const click = async (sel, opts) => { await page.locator(sel).first().click(opts); await wait(200); await idle(); };
  const modalOk = async () => { await click('.modal [data-act="modal-ok"]'); await wait(350); };
  const closeModal = async () => { if (await page.locator('.modal').count()) await click('.modal [data-act="modal-close"]'); };
  const setVal = async (sel, v) => { await page.fill(sel, String(v)); await page.locator(sel).dispatchEvent('change'); await wait(250); };
  const select = async (sel, v) => { await page.selectOption(sel, v); await wait(300); };
  const noCrash = async where => {
    if (await page.locator('text=Something went wrong rendering this screen').count()) throw new Error('Render error at ' + where);
  };
  const go = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await wait(400); await noCrash(hash); };
  const signAs = async (d, l) => {
    await closeModal();
    const ok = await page.evaluate(([d, l]) => switchTo(d, l), [d, l]);
    await idle(); await wait(450);
    if (!ok) throw new Error(`Could not sign in as ${d}/${l}`);
  };
  const api = (c, p) => page.evaluate(([c, p]) => send(c, p).then(r => ({ ok: true, r })).catch(e => ({ ok: false, status: e.status, msg: e.message })), [c, p]);
  const state = (fn, arg) => page.evaluate(fn, arg);
  const toastSays = re => page.waitForFunction(r => [...document.querySelectorAll('.toast')].some(t => new RegExp(r, 'i').test(t.textContent)), re.source, { timeout: 10000 });
  const hashId = async () => (await page.evaluate(() => location.hash)).split('?')[0].split('/').pop();
  const samples = async scope => { while (await page.locator(`[data-act="doc-sample"][data-scope="${scope}"]`).count()) await click(`[data-act="doc-sample"][data-scope="${scope}"]`); };
  const declare = async prefix => { await page.check(`[data-act="${prefix}-dec"][data-dk="fema"]`); await page.check(`[data-act="${prefix}-dec"][data-dk="ofac"]`); };
  const text = sel => page.locator(sel).first().textContent();
  const check = (cond, msg) => { if (!cond) throw new Error(msg); current.checks.push(msg.replace(/^(.)/, c => c.toUpperCase())); };
  const pickPurpose = async (id, query, code) => {
    await page.fill('#' + id, query); await wait(250);
    const hits = await page.locator(`.pp-opt:not([hidden])`).count();
    await click(`.pp-opt[data-code="${code}"]`);
    return hits;
  };
  const submitReview = async () => {
    await page.waitForSelector('.modal .review-t', { timeout: 8000 });
    await modalOk();
    await page.waitForSelector('.done-card', { timeout: 8000 });
    return hashId();
  };

  /* Raise an outward request through the form, the way the SME (or AD2 for it) does. */
  async function newOutward(o) {
    await go('#/sme/outward/new');
    await page.waitForSelector('h1:has-text("New outward request")');
    if (o.bene) await select('#or-bene', o.bene);
    await click(`[data-act="or-product"][data-id="${o.product}"]`);
    if (o.lc) await setVal('#or-lcNumber', o.lc);
    if (o.purpose) await pickPurpose('or-purpose', o.purposeSearch || o.purpose, o.purpose);
    if (o.currency) await select('#or-currency', o.currency);
    for (const b of o.bills || []) {
      await select('#or-billpick', b.id);
      if (b.amount) await setVal(`[data-act="or-alloc"][data-bill="${b.id}"]`, b.amount);
    }
    if (o.amount) await setVal('#or-amount', o.amount);
    await select('#or-debit', o.account || await page.locator('#or-debit option:not([disabled])').nth(1).getAttribute('value'));
    if (o.margin != null) await setVal('#or-margin', o.margin);
    if (o.deal) {
      await click('[data-act="or-deal-ref"]'); await page.fill('#dref', o.deal); await modalOk();
    } else await click('[data-act="or-book-rate"]');
    await samples('or'); await declare('or');
    if (o.shot) await shot(o.shot, true);
    await click('[data-act="or-submit"]');
    if (o.shot) await shot(o.shot + '-review');
    const id = await submitReview();
    if (o.shot) await shot(o.shot + '-done');
    return id;
  }
  /* Submit a disposal instruction for a receipt. */
  async function newDisposal(inwardId, d) {
    await go(`#/sme/inward/${inwardId}/dispose`);
    await page.waitForSelector('h1:has-text("Disposal instruction")');
    if (d.amount) await setVal('#di-amt', d.amount);
    if (d.option === 'advance') await click('[data-act="di-option"][data-id="advance"]');
    if (d.purpose) await pickPurpose('di-purpose', d.purposeSearch || d.purpose, d.purpose);
    for (const b of d.bills || []) {
      await select('#di-billpick', b.id);
      if (b.amount) await setVal(`[data-act="di-alloc"][data-bill="${b.id}"]`, b.amount);
    }
    await select('#di-acct', d.account);
    if (!d.eefc) await click('[data-act="di-book-rate"]');
    await samples('di'); await declare('di');
    if (d.shot) await shot(d.shot, true);
    await click('[data-act="di-submit"]');
    return submitReview();
  }
  async function approveOutward(id, w = {}) {
    await signAs('AD2', w.maker || 'MAKER'); await go('#/ad2/outward/' + id);
    await click('[data-act="or-verify"]'); await click('[data-act="vchk-all"]');
    if (w.note) await page.fill('#vnote', w.note);
    await modalOk(); await page.waitForSelector('h1:has-text("Verified")');
    await signAs(...(w.auth || ['AD2', 'CHECKER'])); await go('#/ad2/outward/' + id);
    await click('[data-act="or-authorise"]'); if (w.note) await page.fill('#vnote', w.note);
    await modalOk(); await page.waitForSelector('h1:has-text("Authorised")');
    await signAs(...(w.release || ['AD2', 'OPS'])); await go('#/ad2/outward/' + id);
    await click('[data-act="or-execute"]'); await modalOk();
    await page.waitForSelector('.modal .advice', { timeout: 8000 });
    const utr = await page.locator('.advice-head b').nth(1).textContent();
    await closeModal();
    await page.waitForSelector('h1:has-text("Completed")');
    return utr;
  }
  async function approveDisposal(id, w = {}) {
    await signAs('AD2', w.maker || 'MAKER'); await go('#/ad2/disposals/' + id);
    await click('[data-act="di-verify"]'); await click('[data-act="vchk-all"]'); if (w.note) await page.fill('#vnote', w.note);
    await modalOk(); await page.waitForSelector('h1:has-text("Verified")');
    await signAs(...(w.auth || ['AD2', 'CHECKER'])); await go('#/ad2/disposals/' + id);
    await click('[data-act="di-authorise"]'); if (w.note) await page.fill('#vnote', w.note);
    await modalOk(); await page.waitForSelector('h1:has-text("Authorised")');
    await signAs(...(w.process || ['AD2', 'OPS'])); await go('#/ad2/disposals/' + id);
    await click('[data-act="di-process"]'); await modalOk();
    await page.waitForSelector('.modal .advice', { timeout: 8000 });
    const firc = await page.locator('.advice-head b').nth(1).textContent();
    return firc;
  }
  async function knockOff(side, pairs, shotName) {
    await go('#/sme/knockoff');
    if (await page.locator('[data-act="ko-side"]').count()) await select('[data-act="ko-side"]', side);
    for (const p of pairs) {
      await select('#ko-bill', p.bill); await select('#ko-rem', p.rem);
      if (p.amount) await page.fill('#ko-amt', String(p.amount));
      await click('[data-act="ko-add"]');
    }
    if (shotName) await shot(shotName, true);
    await click('[data-act="ko-submit"]');
    await page.waitForSelector('.done-card');
    return (await hashId()).split(',');
  }
  async function confirmAllocation(alId, who = ['AD2', 'CHECKER']) {
    await signAs(...who); await go('#/ad2/reconciliation?s=Proposed');
    await click(`tr:has-text("${alId}") [data-act="rec-confirm"]`);
    await toastSays(/UFI/);
  }

  const scenario = async (area, name, roles, fn) => {
    current = { area, name, roles, checks: [], status: 'pass', error: null, ms: 0 };
    process.stdout.write(`• [${area}] ${name} … `);
    const t = Date.now();
    errors = [];
    try {
      await fn();
      await noCrash(name);
      if (errors.length) throw new Error('Page errors: ' + [...new Set(errors)].join(' | '));
      console.log(`ok (${((Date.now() - t) / 1000).toFixed(1)}s, ${current.checks.length} checks)`);
    } catch (e) {
      current.status = 'fail'; current.error = e.message.split('\n')[0];
      console.log('FAIL — ' + current.error);
      await shot('FAIL-' + name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40), true).catch(() => {});
      await closeModal().catch(() => {});
    }
    current.ms = Date.now() - t;
    results.push(current);
  };

  try {
    await page.goto(srv.base + '/app.html#/login');
    await page.waitForSelector('.login-panel');
    if (process.env.BASE) { await click('.sim-bar [data-act="reset-demo"]'); await modalOk(); await page.waitForSelector('.login-panel'); }
    await shot('login', true);

    /* ================= roles and access ================= */
    await scenario('Roles', 'Each role has its own menu of the work it does, and every screen renders', 'All', async () => {
      const users = [['AD2', 'SALES'], ['AD2', 'MAKER'], ['AD2', 'CHECKER'], ['AD2', 'COMPLIANCE'], ['AD2', 'OPS'], ['AD2', 'ADMIN'],
        ['MERIDIANTEX', 'SMEUSER'], ['NILGIRISPICE', 'SMEUSER'], ['ARCADIACOMP', 'SMEUSER'], ['ISHANICONS', 'APPLICANT']];
      const menus = {};
      for (const [d, l] of users) {
        await signAs(d, l);
        menus[d + '/' + l] = await page.$$eval('.nav a .lbl', as => as.map(a => a.textContent));
        const links = await page.$$eval('.nav a', as => as.map(a => a.getAttribute('href')));
        await shot('menu-' + (d + '-' + l).toLowerCase());
        for (const h of links) await go(h);
      }
      const has = (k, label) => menus[k].includes(label);
      check(has('AD2/MAKER', 'Applications to price') && has('AD2/MAKER', 'Verify payments') && has('AD2/MAKER', 'Verify disposals'), 'maker menu: price applications, verify payments and disposals');
      check(!has('AD2/MAKER', 'Authorise payments') && !has('AD2/MAKER', 'Applications to approve'), 'maker menu has no approval items');
      check(has('AD2/CHECKER', 'Authorise payments') && has('AD2/CHECKER', 'Accept bills') && has('AD2/CHECKER', 'Confirm knock-offs'), 'checker menu: authorise, accept bills, confirm knock-offs');
      check(!has('AD2/CHECKER', 'Applications to approve') && !has('AD2/CHECKER', 'SME applications'), 'checker no longer approves customers');
      check(has('AD2/COMPLIANCE', 'Applications to approve') && !has('AD2/COMPLIANCE', 'Authorise payments'), 'compliance approves customers only');
      check(has('AD2/OPS', 'Receipts to confirm') && has('AD2/OPS', 'Release payments') && has('AD2/OPS', 'Credit & issue FIRC') && has('AD2/OPS', 'Authorise payments'), 'operations can confirm receipts, authorise, release and credit');
      check(has('AD2/SALES', 'Onboard a customer') && !has('AD2/SALES', 'My work queue'), 'sales onboards and transacts, with no approval queue');
      check(has('AD2/ADMIN', 'Users') && !has('AD2/MAKER', 'Users'), 'only the Administrator manages users');
      check(!has('ARCADIACOMP/SMEUSER', 'Inward & disposal') && has('NILGIRISPICE/SMEUSER', 'Inward & disposal'), 'SME menu follows its Import / Export permission');
      check(menus['ISHANICONS/APPLICANT'].length === 1, 'an applicant sees only its application');
      await signAs('AD2', 'SALES'); await go('#/ad2/admin/users');
      check((await page.evaluate(() => location.hash)).startsWith('#/ad2/dashboard'), 'a role cannot open another role’s screen by URL');
    });

    await scenario('Roles', 'Four-eyes and segregation are enforced by the server, not just the screen', 'Maker, Checker, Compliance, Ops, Admin, SME', async () => {
      await signAs('AD2', 'MAKER');
      let r = await api('outward.authorise', { id: 'OR-5103' });
      check(!r.ok && r.status === 403, 'maker cannot authorise (403)');
      await signAs('AD2', 'CHECKER');
      r = await api('outward.execute', { id: 'OR-5102' });
      check(!r.ok && r.status === 403, 'checker cannot release a payment (403)');
      r = await api('onboarding.approve', { smeId: 'SME-1005' });
      check(!r.ok && r.status === 403, 'trade checker cannot approve a customer (403)');
      await signAs('AD2', 'COMPLIANCE');
      r = await api('outward.authorise', { id: 'OR-5103' });
      check(!r.ok && r.status === 403, 'compliance cannot authorise money (403)');
      await signAs('AD2', 'ADMIN');
      r = await api('outward.authorise', { id: 'OR-5103' });
      check(!r.ok && r.status === 403, 'administrator holds no transaction authority (403)');
      await signAs('MERIDIANTEX', 'SMEUSER');
      r = await api('outward.verify', { id: 'OR-5103', checks: {} });
      check(!r.ok && r.status === 403, 'an SME cannot verify its own request (403)');
    });

    /* ================= customer view ================= */
    await scenario('Customer', 'The customer never sees AD2’s margin or a deal-reference box', 'SME', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER');
      const view = await state(() => ({ margins: DB.smes[0].config.margins, rates: DB.smes[0].config.customerRates, ref: DB.currencies[0].refRate,
        rate: DB.outward.find(o => o.rate && o.rate.customerRate)?.rate }));
      check(view.margins === undefined && view.ref === undefined, 'the API sends the customer no margins and no reference rates');
      check(view.rates && view.rates.EUR && view.rates.EUR.out > 0, 'the customer receives its own ready-made rates');
      check(view.rate.margin === undefined && view.rate.refRate === undefined, 'past requests reach the customer without margin');
      await go('#/sme/outward/new');
      await select('#or-bene', 'BEN-002'); await click('[data-act="or-product"][data-id="OTT"]');
      await select('#or-currency', 'GBP'); await setVal('#or-amount', 1000);
      const body = (await page.locator('.page').innerText()).toLowerCase();
      check(!/margin|paise|reference rate/.test(body), 'the new-request form shows no margin, paise or reference rate');
      check(!(await page.locator('[data-act="or-deal-ref"]').count()), 'the customer has no “Enter FX deal reference” button');
      check(/foreign currency you pay/.test(body) && /inr equivalent/.test(body), 'the rate card shows the FX amount and its INR value');
      await shot('customer-rate-card', true);
      for (const h of ['#/sme/outward/OR-5103', '#/sme/profile', '#/sme/dashboard', '#/sme/disposals/DI-9004']) {
        await go(h);
        const t = (await page.locator('.page').innerText()).toLowerCase();
        check(!/margin|paise|reference rate/.test(t), `no margin on ${h}`);
      }
      await go('#/sme/reports'); await select('[data-act="report-pick"]', 'charges');
      check(!/margin/i.test(await page.locator('thead').textContent()), 'the charges report has no margin column for the customer');
      await signAs('MERIDIANTEX', 'SMEUSER');
      const doc = n => ({ filename: n + '.pdf', size: '1 KB' });
      const deal = await api('outward.submit', { draft: { beneficiaryId: 'BEN-002', beneficiary: 'Northgate Advisory Ltd', beneficiaryCountry: 'United Kingdom',
        beneficiaryAccount: 'GB82WEST12345698765432', beneficiaryBank: 'Barclays', beneficiaryBankCountry: 'United Kingdom', swift: 'BARCGB22',
        currency: 'GBP', amount: 1000, remittanceType: 'OTT', purposeCode: 'S1006', executionDate: new Date().toISOString().slice(0, 10), debitAccountId: 'BA-001',
        docs: { invoice: doc('i'), form145: doc('f') }, declarations: { fema: true, ofac: true }, rate: { mode: 'deal', dealRef: 'FXD-2026-1', customerRate: 113 } } });
      check(!deal.ok && /applied by AD2/.test(deal.msg), 'the server refuses a deal reference from the customer');
    });

    /* ================= outward ================= */
    await scenario('Outward', 'DIR: pick the bill, amount follows, book the rate for it, review, confirm — then maker, checker, operations', 'SME → Maker → Checker → Ops', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER');
      await go('#/sme/outward/new');
      await select('#or-bene', 'BEN-001'); await click('[data-act="or-product"][data-id="DIR"]');
      const opts = await page.$$eval('#or-billpick option', os => os.map(o => o.textContent));
      check(opts.some(o => /BL-24014.*bill 45,000\.00 EUR.*free 45,000\.00 EUR/.test(o)), 'the bill dropdown lists each bill with its amount and what is free');
      check(!opts.some(o => /BL-24004/.test(o)), 'a bill fully held by another request is not offered');
      check(await page.locator('text=fully held by requests already in progress: BL-24004 (OR-5103)').count() === 1, 'the held bill is explained (BL-24004 held by OR-5103)');
      check(await page.inputValue('#or-executionDate') === new Date().toISOString().slice(0, 10), 'execution date defaults to today');
      await select('#or-billpick', 'BL-24014');
      check(await page.inputValue('#or-amount') === '45000', 'the amount follows the bill (45,000)');
      check(await page.inputValue('#or-currency') === 'EUR', 'the currency follows the bill');
      const id = await newOutwardContinue();
      async function newOutwardContinue() {
        await select('#or-debit', 'BA-001');
        await click('[data-act="or-book-rate"]');
        check(/Booked .* for 45,000\.00 EUR/.test(await text('.ratebox')), 'the booking states the amount it is for');
        await samples('or'); await declare('or');
        await shot('dir-form', true);
        await click('[data-act="or-submit"]');
        await shot('dir-review');
        return submitReview();
      }
      check(/OR-\d+/.test(id), 'a confirmation screen shows the reference ' + id);
      await shot('dir-done');
      await signAs('AD2', 'MAKER');
      check(await state(i => myQueue().some(q => q.id === i && q.title === 'Verify'), id), 'it lands in the maker’s queue');
      const utr = await approveOutward(id);
      check(/^AD2O\d+/.test(utr), 'operations releases it with a UTR ' + utr);
      const b = await state(() => bill('BL-24014'));
      check(b.settlement === 'Settled' && b.outstanding === 0, 'the import bill is settled');
      const led = await state(i => DB.allocations.find(l => l.remId === i && l.status === 'Confirmed'), id);
      check(led && led.ufi && led.ufi.system === 'IDPMS', 'the settlement is reported to IDPMS through UFI (' + (led && led.ufi.ref) + ')');
      await signAs('MERIDIANTEX', 'SMEUSER'); await go('#/sme/outward/' + id);
      await page.waitForSelector('h1:has-text("Completed")');
      await click('[data-act="or-advice"]'); await page.waitForSelector('.modal .advice');
      check(/Total debited/.test(await text('.modal .advice')), 'the customer can open the payment advice and MT103');
      await closeModal();
    });

    await scenario('Outward', 'Pay part of a bill; the rest stays free; a rejection releases the reservation', 'SME → Maker → Checker', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER');
      const id = await newOutward({ bene: 'BEN-001', product: 'DIR', bills: [{ id: 'BL-24015', amount: 20000 }] });
      const free = await state(() => Engine.billAvailable(DB, bill('BL-24015')));
      check(free === 12750, 'after paying 20,000 of 32,750 the bill has 12,750 free');
      await go('#/sme/outward/new'); await select('#or-bene', 'BEN-001'); await click('[data-act="or-product"][data-id="DIR"]');
      check((await page.$$eval('#or-billpick option', os => os.map(o => o.textContent))).some(o => /BL-24015.*free 12,750\.00 EUR/.test(o)), 'the next request offers only the 12,750 still free');
      await signAs('AD2', 'MAKER'); await go('#/ad2/outward/' + id);
      await click('[data-act="or-verify"]'); await click('[data-act="vchk-all"]'); await modalOk();
      await signAs('AD2', 'CHECKER'); await go('#/ad2/outward/' + id);
      await click('[data-act="or-reject"]'); await page.fill('#why', 'Invoice amount does not match the proforma.'); await modalOk();
      await page.waitForSelector('h1:has-text("Rejected")');
      check(await state(() => Engine.billAvailable(DB, bill('BL-24015'))) === 32750, 'rejection frees the whole bill again');
    });

    await scenario('Outward', 'LC to a watchlist beneficiary scores High; Operations authorises, a second operations user releases', 'SME → Maker → Ops → Ops2', async () => {
      await signAs('PUNEAUTO', 'SMEUSER');
      await go('#/sme/outward/new');
      const bene = await page.locator('#or-bene option', { hasText: 'Blocked Trading' }).getAttribute('value');
      await go('#/sme/outward');
      const cur = 'USD';
      const billId = await state(c => DB.bills.find(b => b.type === 'Import' && b.review === 'Accepted' && b.currency === c && Engine.billAvailable(DB, b) > 0 && b.smeId === ctxSmeId())?.id, cur);
      const id = await newOutward({ bene, product: 'LC', lc: 'ILC/2026/0911', bills: [{ id: billId }], shot: 'lc-form' });
      await signAs('AD2', 'MAKER'); await go('#/ad2/outward/' + id);
      await page.waitForSelector('.risk-High');
      check(true, 'the compliance panel shows High risk to AD2');
      await click('[data-act="or-verify"]'); await click('[data-act="vchk-all"]'); await click('.modal [data-act="modal-ok"]');
      await toastSays(/record your reason/);
      check(true, 'the maker cannot pass it without a written reason');
      await page.fill('#vnote', 'Watchlist hit reviewed: different entity.'); await modalOk();
      await signAs('AD2', 'OPS'); await go('#/ad2/outward/' + id);
      await click('[data-act="or-authorise"]'); await page.fill('#vnote', 'Authorised after compliance review.'); await modalOk();
      await page.waitForSelector('h1:has-text("Authorised")');
      check(await page.locator('text=Four-eyes: you acted on this earlier').count() === 1, 'the operations user who authorised is told another user must release');
      const r = await api('outward.execute', { id });
      check(!r.ok, 'the server refuses the same person releasing it');
      await signAs('AD2', 'OPS2'); await go('#/ad2/outward/' + id);
      await click('[data-act="or-execute"]'); await modalOk(); await page.waitForSelector('.modal .advice'); await closeModal();
      check(/LC ILC/.test(await state(i => mt103(outwardRec(i)), id)), 'the MT103 carries the LC number');
    });

    let airId;
    await scenario('Outward', 'AIR advance, then its Bill of Entry by document AI, then a knock-off that updates the balances as you go', 'SME → Maker → Checker → Ops → SME → Ops → SME → Checker', async () => {
      await signAs('ARCADIACOMP', 'SMEUSER');
      airId = await newOutward({ bene: 'BEN-005', product: 'AIR', purpose: 'S0101', purposeSearch: 'advance', currency: 'USD', amount: 12000 });
      await approveOutward(airId, { maker: 'MAKER2', auth: ['AD2', 'CHECKER2'], release: ['AD2', 'OPS2'] });
      const o = await state(i => outwardRec(i), airId);
      check(!!o.boeDueDate, 'the advance carries a Bill of Entry due date');
      await signAs('ARCADIACOMP', 'SMEUSER'); await go('#/sme/bills/import');
      await click('[data-act="bill-tab"][data-t="form"]');
      await click('[data-act="bill-ai"]'); await page.waitForSelector('.ai-field', { timeout: 5000 });
      check(await page.locator('.ai-field').count() > 3, 'document AI prefills the fields with confidence scores');
      await setVal('#bl-counterparty', 'Shenzhen Ruiyang Electronics'); await select('#bl-currency', 'USD'); await setVal('#bl-amount', 12000);
      await click('[data-act="bill-save"]'); await page.waitForSelector('.done-card');
      const billId = await hashId();
      check(/BL-\d+/.test(billId), 'lodging shows a confirmation with ' + billId);
      await signAs('AD2', 'OPS'); await go('#/ad2/bills?s=accept');
      await click(`tr:has-text("${billId}") [data-act="bill-accept"]`); await toastSays(/accepted/);
      check(true, 'operations accepts the bill');
      await signAs('ARCADIACOMP', 'SMEUSER');
      await go('#/sme/knockoff');
      await select('#ko-bill', billId); await select('#ko-rem', airId);
      check(await page.inputValue('#ko-amt') === '12000', 'choosing both fills the amount they can match');
      await click('[data-act="ko-add"]');
      const billsLeft = await page.$$eval('.knock .pane:first-child tbody tr', rs => rs.map(r => r.textContent));
      const remsLeft = await page.$$eval('.knock .pane:last-child tbody tr', rs => rs.map(r => r.textContent));
      check(!billsLeft.some(r => r.includes(billId)) && !remsLeft.some(r => r.includes(airId)), 'fully used items drop out of the panes before submitting');
      await shot('knockoff-batch', true);
      await click('[data-act="ko-submit"]'); await page.waitForSelector('.done-card');
      const [al] = (await hashId()).split(',');
      await confirmAllocation(al);
      const b = await state(i => bill(i), billId);
      check(b.settlement === 'Settled', 'confirmation settles the bill');
      const l = await state(i => DB.allocations.find(x => x.id === i), al);
      check(l.ufi && l.ufi.system === 'IDPMS', 'the knock-off is reported to IDPMS (UFI portal updated)');
    });

    await scenario('Outward', 'OTT: type a word to find the purpose code; Form 146 appears above ₹5 lakh', 'SME', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER');
      await go('#/sme/outward/new');
      await select('#or-bene', 'BEN-002'); await click('[data-act="or-product"][data-id="OTT"]');
      const hits = await pickPurpose('or-purpose', 'consultancy', 'S1006');
      check(hits >= 1, `typing “consultancy” finds S1006 among ${hits} matches`);
      await page.fill('#or-purpose', 'shipping freight'); await wait(250);
      check(await page.locator('.pp-opt:not([hidden])').count() >= 2, 'two words narrow the list (shipping freight)');
      await page.keyboard.press('Escape');
      await pickPurpose('or-purpose', 'consultancy', 'S1006');
      await select('#or-currency', 'GBP');
      await setVal('#or-amount', 7000);
      const high = await text('.docrow:has-text("Form 146")');
      await setVal('#or-amount', 3000);
      const low = await text('.docrow:has-text("Form 146")');
      check(/Required/.test(high) && /Optional/.test(low), 'Form 146 is required at GBP 7,000 and optional at GBP 3,000');
    });

    await scenario('Outward', 'Save a draft, continue it later and submit', 'SME', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER');
      await go('#/sme/outward/new');
      await select('#or-bene', 'BEN-003'); await click('[data-act="or-product"][data-id="OTT"]');
      await pickPurpose('or-purpose', 'freight on imports', 'S0203');
      await select('#or-currency', 'USD'); await setVal('#or-amount', 2400);
      await click('[data-act="or-save"]'); await toastSays(/Draft OR-/);
      const draftId = await state(() => OR_DRAFT.id);
      await go('#/sme/outward/' + draftId);
      await click('[data-act="or-continue"]');
      await page.waitForSelector('h1:has-text("Continue draft")');
      check(await page.inputValue('#or-amount') === '2400', 'the draft reopens with its details');
      await select('#or-debit', 'BA-001'); await click('[data-act="or-book-rate"]');
      await samples('or'); await declare('or');
      await click('[data-act="or-submit"]');
      const id = await submitReview();
      check(id === draftId, 'the draft is submitted under its own reference');
    });

    await scenario('Outward', 'Query: the maker asks, the SME answers with a document, another maker verifies', 'Maker → SME → Maker2', async () => {
      await signAs('AD2', 'MAKER'); await go('#/ad2/outward/OR-5106');
      await click('[data-act="or-query"]'); await page.fill('#why', 'Attach the signed proforma invoice.'); await modalOk();
      await page.waitForSelector('h1:has-text("Clarification Required")');
      await signAs('ARCADIACOMP', 'SMEUSER'); await go('#/sme/outward/OR-5106');
      await page.fill('#resp-text', 'Signed proforma attached.'); await page.locator('#resp-text').dispatchEvent('input');
      await click('[data-act="doc-sample"][data-scope="resp"]');
      await click('[data-act="or-respond"]'); await page.waitForSelector('h1:has-text("Submitted")');
      check(true, 'the SME’s answer sends it back to the maker');
      await signAs('AD2', 'MAKER2'); await go('#/ad2/outward/OR-5106');
      await click('[data-act="or-verify"]'); await click('[data-act="vchk-all"]'); await modalOk();
      await page.waitForSelector('h1:has-text("Verified")');
      check(true, 'a second maker verifies it');
    });

    await scenario('Outward', 'Query answered by AD2 for the customer, with the documents it sent in', 'Maker (for SME) → Maker2 → Checker → Ops', async () => {
      await signAs('AD2', 'MAKER'); await go('#/ad2/outward/OR-5104');
      check(await page.locator('h2:has-text("Answer for the customer")').count() === 1, 'the maker sees “Answer for the customer” on a request under query');
      await page.fill('#resp-text', 'Travel agent invoice received from the customer by email.'); await page.locator('#resp-text').dispatchEvent('input');
      await click('[data-act="doc-sample"][data-scope="resp"]');
      await shot('answer-for-customer', true);
      await click('[data-act="or-resolve"]'); await page.waitForSelector('h1:has-text("Submitted")');
      const o = await state(() => outwardRec('OR-5104'));
      check(/on behalf of the SME/.test(o.query.respondedBy), 'the answer is recorded as given on the SME’s behalf');
      await approveOutward('OR-5104', { maker: 'MAKER2' });
      await signAs('MERIDIANTEX', 'SMEUSER'); await go('#/sme/outward/OR-5104');
      check(await page.locator('text=recorded by').count() >= 1, 'the SME sees the answer AD2 recorded for it');
    });

    await scenario('Outward', 'Release a payment already authorised (seeded) and see the account debited', 'Ops', async () => {
      await signAs('AD2', 'OPS'); await go('#/ad2/outward?s=Authorised');
      check(await page.locator('tr:has-text("OR-5102")').count() === 1, '“Release payments” lists what is authorised');
      const before = await state(() => acct('BA-004').balance);
      await go('#/ad2/outward/OR-5102'); await click('[data-act="or-execute"]'); await modalOk();
      await page.waitForSelector('.modal .advice'); await closeModal();
      const o = await state(() => outwardRec('OR-5102'));
      const after = await state(() => acct('BA-004').balance);
      check(Math.abs(before - after - o.debitInr) < 0.01, 'the INR account is debited by the payment and charges');
    });

    /* ================= inward ================= */
    await scenario('Inward', 'SME reports a buyer’s payment; Operations confirms it; the SME disposes of it; FIRC issued and downloadable', 'SME → Ops → SME → Maker → Checker → Ops', async () => {
      await signAs('AD2', 'OPS'); await go('#/ad2/bills?s=accept');
      await click('tr:has-text("BL-24019") [data-act="bill-accept"]'); await toastSays(/accepted/);
      await signAs('NILGIRISPICE', 'SMEUSER'); await go('#/sme/inward');
      await click('[data-act="in-new"]');
      check(await page.locator('.modal:has-text("Report a payment from a buyer")').count() === 1, '“New inward remittance” offers to dispose or to report a payment');
      await click('[data-act="nin-report"]');
      await page.fill('#int-rem', 'Aroma Europe BV'); await page.fill('#int-cty', 'Netherlands'); await select('#int-cur', 'USD');
      await page.fill('#int-amt', '9000'); await page.fill('#int-rmk', 'Part payment for NSE/EX/2026/338');
      await click('[data-act="int-doc-sample"]');
      await modalOk(); await page.waitForSelector('.done-card');
      const irId = await hashId();
      check(await state(i => inwardRec(i).status, irId) === 'Intimated', 'the payment is reported and waits for operations');
      await signAs('AD2', 'OPS');
      check(await state(i => myQueue().some(q => q.id === i && q.title === 'Confirm credit'), irId), 'it is in operations’ queue to confirm');
      await go('#/ad2/inward/' + irId); await click('[data-act="in-confirm"]');
      await setVal('#ic-amt', 8975); await modalOk();
      await page.waitForSelector('h1 .badge:has-text("Awaiting Instruction")');
      check(await state(i => inwardRec(i).available, irId) === 8975, 'operations confirms what was actually credited (8,975)');
      await signAs('NILGIRISPICE', 'SMEUSER');
      const di = await newDisposal(irId, { purpose: 'P0102', purposeSearch: 'collection', bills: [{ id: 'BL-24019' }], account: 'BA-006', shot: 'dispose-reported' });
      const firc = await approveDisposal(di);
      check(/^FIRC-/.test(firc), 'operations credits the account and issues ' + firc);
      await closeModal();
      await signAs('NILGIRISPICE', 'SMEUSER'); await go('#/sme/reports'); await select('[data-act="report-pick"]', 'firc');
      await click(`tr:has-text("${firc}") [data-act="di-firc"]`);
      check(await page.locator('.modal .advice:has-text("UFI portal updated")').count() === 1, 'the FIRC downloads from the report and shows the UFI portal update');
      await closeModal();
    });

    let partA, partB;
    await scenario('Inward', 'Partial disposal: part against a bill, the rest as an advance — two FIRCs; the advance is knocked off later', 'SME → Maker → Checker → Ops → SME → Checker2', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER');
      partA = await newDisposal('IR-3303', { amount: 60000, bills: [{ id: 'BL-24003', amount: 50000 }], account: 'BA-001' });
      const i = await state(() => inwardRec('IR-3303'));
      check(i.available === 37200 && i.status === 'Partially Disposed', 'the receipt keeps 37,200 for later');
      await go('#/sme/inward/IR-3303'); await click('button:has-text("Dispose the balance")');
      check(await page.inputValue('#di-amt') === '37200', 'the balance is prefilled');
      await click('[data-act="di-option"][data-id="advance"]');
      check(await page.locator('.pp-sel:has-text("P0103")').count() === 1, 'choosing advance switches the purpose to P0103');
      await select('#di-acct', 'BA-001'); await click('[data-act="di-book-rate"]');
      await samples('di'); await declare('di'); await click('[data-act="di-submit"]');
      partB = await submitReview();
      await approveDisposal(partA); await closeModal();
      await approveDisposal(partB, { maker: 'MAKER2', auth: ['AD2', 'OPS'], process: ['AD2', 'OPS2'] }); await closeModal();
      const st = await state(() => inwardRec('IR-3303'));
      check(st.status === 'Processed' && st.fircs.length === 2, 'the receipt is fully processed with two FIRCs');
      await signAs('MERIDIANTEX', 'SMEUSER');
      const [al] = await knockOff('Export', [{ bill: 'BL-24003', rem: partB }]);
      await confirmAllocation(al, ['AD2', 'CHECKER2']);
      const b = await state(() => bill('BL-24003'));
      check(b.outstanding === 97200 - 50000 - 37200, 'the advance FIRC knocks off the rest of BL-24003');
    });

    await scenario('Inward', 'Advance receipt credited now, knocked off against the export bill later; a reversal restores it', 'SME → Maker → Checker → Ops → SME → Checker → Ops', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER');
      const di = await newDisposal('IR-3309', { option: 'advance', account: 'BA-001' });
      check(await state(i => disposalRec(i).purposeCode, di) === 'P0103', 'an advance is reported under P0103');
      await approveDisposal(di); await closeModal();
      check(await state(i => disposalRec(i).unallocated, di) === 15000, 'the FIRC shows 15,000 pending knock-off');
      await signAs('MERIDIANTEX', 'SMEUSER'); await go('#/sme/disposals/' + di);
      await click('[data-act="ko-from-firc"]'); await page.waitForSelector('h1:has-text("Bill Knock-off")');
      await select('#ko-bill', 'BL-24017');
      check(await page.inputValue('#ko-amt') === '15000', 'the FIRC is preselected and the amount filled');
      await click('[data-act="ko-add"]'); await click('[data-act="ko-submit"]'); await page.waitForSelector('.done-card');
      const [al] = (await hashId()).split(',');
      await confirmAllocation(al);
      check(await state(() => bill('BL-24017').outstanding) === 7000, 'BL-24017 has 7,000 left');
      await signAs('AD2', 'OPS'); await go('#/ad2/reconciliation?s=Confirmed');
      await click(`tr:has-text("${al}") [data-act="rec-reverse"]`); await page.fill('#why', 'Matched to the wrong invoice'); await modalOk();
      await toastSays(/reversed/);
      check(await state(i => disposalRec(i).unallocated, di) === 15000, 'reversal puts the 15,000 back as pending knock-off');
    });

    await scenario('Inward', 'Credit to an EEFC account: foreign currency, no conversion, no rate', 'SME → Maker → Checker → Ops', async () => {
      await signAs('NILGIRISPICE', 'SMEUSER');
      const before = await state(() => acct('BA-007').balance);
      const di = await newDisposal('IR-3305', { amount: 20000, option: 'advance', account: 'BA-007', eefc: true });
      await approveDisposal(di, { maker: 'MAKER2' });
      check(/EEFC/.test(await text('.modal .advice')), 'the FIRC says EEFC');
      await closeModal();
      check(await state(() => acct('BA-007').balance) === before + 20000, 'the EEFC balance rises by USD 20,000');
    });

    await scenario('Inward', 'Operations records a credit; the SME starts the disposal from “New inward remittance”', 'Ops → SME → Maker → Checker → Ops', async () => {
      await signAs('AD2', 'OPS'); await go('#/ad2/inward');
      await click('[data-act="in-record"]');
      await select('#ri-sme', await page.locator('#ri-sme option', { hasText: 'Coastal Cashew' }).first().getAttribute('value'));
      await click('[data-act="ri-suggest"]'); await modalOk();
      await page.waitForSelector('h1 .badge:has-text("Awaiting Instruction")');
      const irId = await hashId();
      const s = await state(i => sme(inwardRec(i).smeId), irId);
      const login = await state(i => DB.logins.find(l => l.smeId === i).loginId, s.id);
      await signAs(s.domainId, login); await go('#/sme/dashboard');
      await click('[data-act="in-new"]');
      await select('#nin-rec', irId); await click('[data-act="nin-dispose"]');
      await page.waitForSelector('h1:has-text("Disposal instruction")');
      check(true, 'the SME picks the receipt and lands on its instruction');
      const acc = await state(i => DB.accounts.find(a => a.smeId === i && a.currency === 'INR' && a.verified).id, s.id);
      await select('#di-billpick', await page.locator('#di-billpick option').nth(1).getAttribute('value'));
      await select('#di-acct', acc); await click('[data-act="di-book-rate"]');
      await samples('di'); await declare('di'); await click('[data-act="di-submit"]');
      const di = await submitReview();
      await approveDisposal(di); await closeModal();
      check(await state(i => disposalRec(i).status, di) === 'Processed', 'processed with its FIRC');
    });

    await scenario('Inward', 'Operations cannot match a reported payment and tells the SME why', 'SME → Ops', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER'); await go('#/sme/inward');
      await click('[data-act="in-new"]'); await click('[data-act="nin-report"]');
      await page.fill('#int-rem', 'Unknown Buyer SA'); await page.fill('#int-cty', 'France'); await select('#int-cur', 'EUR'); await page.fill('#int-amt', '5000');
      await modalOk(); await page.waitForSelector('.done-card');
      const irId = await hashId();
      await signAs('AD2', 'OPS'); await go('#/ad2/inward/' + irId);
      await click('[data-act="in-decline"]'); await page.fill('#why', 'No matching credit in the nostro after two days.'); await modalOk();
      await signAs('MERIDIANTEX', 'SMEUSER'); await go('#/sme/inward/' + irId);
      check(await page.locator('text=No matching credit').count() >= 1, 'the SME sees it was not received, with the reason');
    });

    /* ================= assisted ================= */
    await scenario('Assisted', 'Sales books a payment for a customer at a branch margin with a treasury deal; Ops authorises, Ops2 releases', 'Sales (for SME) → Maker → Ops → Ops2', async () => {
      await signAs('AD2', 'SALES'); await go('#/ad2/directory');
      await click('[data-act="assist-start"][data-id="SME-1001"]');
      await click('.modal [data-act="assist-go"][data-dest="#/sme/outward/new"]');
      await page.waitForSelector('h1:has-text("New outward request")');
      check(await page.locator('.sim-bar:has-text("Transacting for a customer")').count() === 1, 'a banner says who is being served');
      const id = await newOutward({ bene: 'BEN-002', product: 'OTT', purpose: 'S1006', purposeSearch: 'management consultancy', currency: 'GBP', amount: 1500, account: 'BA-001',
        deal: 'FXD-2026-90210' });
      const o = await state(i => outwardRec(i), id);
      check(o.source === 'AD2 Assisted' && o.rate.dealRef === 'FXD-2026-90210', 'the request is stamped as assisted with the deal reference');
      await click('[data-act="assist-exit"]');
      check((await page.evaluate(() => location.hash)).startsWith('#/ad2/dashboard'), '“Done” returns to the AD2 workspace');
      await approveOutward(id, { auth: ['AD2', 'OPS'], release: ['AD2', 'OPS2'] });
      await signAs('AD2', 'SALES'); await go('#/ad2/directory');
      await click('[data-act="assist-start"][data-id="SME-1001"]');
      await click('.modal [data-act="assist-go"][data-dest="#/sme/outward/new"]');
      await select('#or-bene', 'BEN-002'); await click('[data-act="or-product"][data-id="OTT"]'); await select('#or-currency', 'GBP'); await setVal('#or-amount', 800);
      const m = Number(await page.inputValue('#or-margin'));
      await setVal('#or-margin', m - 4); await click('[data-act="or-book-rate"]');
      check(/margin \d+ paise/i.test(await text('.ratebox')), 'AD2 sees the margin it is pricing at');
      await click('[data-act="assist-exit"]');
    });

    await scenario('Assisted', 'Maker disposes of a receipt on the customer’s behalf from the AD2 inward list', 'Maker (for SME) → Maker2 → Checker → Ops', async () => {
      await signAs('AD2', 'MAKER'); await go('#/ad2/inward');
      await click('tr:has-text("SWF-INW-779012") [data-act="assist-dispose"]');
      await page.waitForSelector('h1:has-text("Disposal instruction")');
      await select('#di-billpick', 'BL-24002'); await select('#di-acct', 'BA-001');
      check(await page.locator('[data-act="di-deal-ref"]').count() === 1, 'AD2 may apply a deal reference for the customer');
      await click('[data-act="di-book-rate"]'); await samples('di'); await declare('di');
      await click('[data-act="di-submit"]');
      const di = await submitReview();
      await click('[data-act="assist-exit"]').catch(() => {});
      const r = await api('disposal.verify', { id: di, checks: { documents: true, bills: true, account: true, sanctions: true } });
      check(!r.ok, 'the maker who raised it cannot verify it');
      await approveDisposal(di, { maker: 'MAKER2' }); await closeModal();
      check(await state(() => bill('BL-24002').settlement) === 'Settled', 'BL-24002 is settled');
    });

    await scenario('Assisted', 'Sales lodges an export bill for a customer; the checker accepts it', 'Sales (for SME) → Checker', async () => {
      await signAs('AD2', 'SALES'); await go('#/ad2/directory');
      const sid = await state(() => DB.smes.find(s => s.domainId === 'DELHIDECOR').id);
      await click(`[data-act="assist-start"][data-id="${sid}"]`);
      await click('.modal [data-act="assist-go"][data-dest="#/sme/bills/export"]');
      await click('[data-act="bill-tab"][data-t="form"]');
      await click('[data-act="bill-ai"]'); await page.waitForSelector('.ai-field', { timeout: 5000 });
      await click('[data-act="bill-save"]'); await page.waitForSelector('.done-card');
      const billId = await hashId();
      await click('[data-act="assist-exit"]');
      await signAs('AD2', 'CHECKER'); await go('#/ad2/bills?s=accept');
      await click(`tr:has-text("${billId}") [data-act="bill-accept"]`); await toastSays(/accepted/);
      check(await state(i => bill(i).review, billId) === 'Accepted', 'the bill is accepted and can be disposed against');
    });

    /* ================= bills ================= */
    await scenario('Bills', 'CSV upload keeps failed rows; a query on a bill is answered for the customer; Operations accepts', 'SME → Checker → Maker (for SME) → Ops', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER'); await go('#/sme/bills/export');
      await click('[data-act="bill-tab"][data-t="upload"]');
      await click('[data-act="csv-sample"]'); await click('[data-act="csv-validate"]');
      check(await page.locator('#csv-preview .badge.b-red').count() === 2, 'validation flags the duplicate and the missing currency');
      await click('[data-act="csv-confirm"]'); await toastSays(/2 bills lodged/);
      await signAs('AD2', 'CHECKER'); await go('#/ad2/bills?s=accept');
      const row = page.locator('tr:has-text("Halden Trading AS")').first();
      const billId = (await row.locator('td').first().textContent()).trim();
      await row.locator('[data-act="bill-query"]').click(); await wait(200);
      await page.fill('#why', 'Add the shipping bill number.'); await modalOk();
      await signAs('AD2', 'MAKER'); await go('#/ad2/bills?s=query');
      await click(`tr:has-text("${billId}") [data-act="bill-resolve"]`);
      await page.fill('#br-ref', 'SB-2299001'); await page.fill('#why', 'Customer phoned in the shipping bill number.'); await modalOk();
      check(await state(i => bill(i).review, billId) === 'Resubmitted', 'the maker’s answer resubmits it');
      await signAs('AD2', 'OPS'); await go('#/ad2/bills?s=accept');
      await click(`tr:has-text("${billId}") [data-act="bill-accept"]`); await toastSays(/accepted/);
      check(true, 'operations accepts it');
    });

    /* ================= onboarding ================= */
    await scenario('Onboarding', 'Digital: register, maker prices (select all, one margin, no charge), Compliance approves, the business trades', 'Applicant → Maker → Compliance → SME', async () => {
      await page.evaluate(() => { setSession(null); resetDrafts(); location.hash = '#/register'; render(); });
      await click('[data-act="ob-sample"]');
      for (let i = 0; i < 7; i++) await click('[data-act="ob-next"]');
      await page.check('#declare'); await click('[data-act="ob-submit"]');
      await page.waitForSelector('.modal:has-text("Application submitted")');
      await modalOk(); await page.waitForSelector('h1:has-text("Application")');
      const smeId = await state(() => ctxSmeId());
      check(await page.locator('text=Where it is now').count() === 1, 'the applicant sees where the application is');
      await signAs('AD2', 'MAKER'); await go('#/ad2/applications/' + smeId);
      await click('[data-act="rv-cur-all"]');
      await page.fill('#rv-all-m', '45'); await click('[data-act="rv-margin-all"]');
      const r = await state(() => REVIEW);
      check(r.currencies.length === 8 && r.currencies.every(c => r.margins[c] === 45), 'select all + one margin fills every currency');
      await shot('pricing-review', true);
      await click('[data-act="rv-submit"]'); await toastSays(/Compliance/);
      check(true, 'no charge is needed to send it on');
      await signAs('AD2', 'MAKER'); await go('#/ad2/applications/' + smeId);
      check(await page.locator('[data-act="rv-approve"]').count() === 0, 'the maker cannot approve');
      await signAs('AD2', 'COMPLIANCE'); await go('#/ad2/applications?s=approve');
      check(await page.locator(`tr:has-text("${smeId}")`).count() === 1, '“Applications to approve” lists it for Compliance');
      await go('#/ad2/applications/' + smeId); await click('[data-act="rv-approve"]'); await modalOk(); await toastSays(/approved/);
      const login = await state(i => DB.logins.find(l => l.smeId === i), smeId);
      check(login.role === 'SME User', 'the applicant’s sign-in becomes an SME User');
    });

    await scenario('Onboarding', 'Offline by Sales: credentials shown; Compliance returns it; the maker reprices; a second Compliance user approves', 'Sales → Maker → Compliance → Maker → Compliance2', async () => {
      await signAs('AD2', 'SALES'); await go('#/ad2/dashboard');
      await click('[data-act="offline-app"]');
      await click('[data-act="ob-sample"]');
      for (let i = 0; i < 7; i++) await click('[data-act="ob-next"]');
      await page.check('#declare'); await click('[data-act="ob-submit"]');
      await page.waitForSelector('.modal:has-text("Application captured")');
      check(/Domain ID/.test(await text('.modal')), 'Sales sees the Domain ID and Login ID the customer signs in with');
      const smeId = await state(() => DB.smes[DB.smes.length - 1].id);
      await closeModal();
      await signAs('AD2', 'MAKER'); await go('#/ad2/applications/' + smeId);
      await setVal('[data-act="rv-margin"][data-c="USD"]', 40);
      await click('[data-act="rv-charge-add"]'); await modalOk();
      await click('[data-act="rv-submit"]'); await toastSays(/Compliance/);
      await signAs('AD2', 'COMPLIANCE'); await go('#/ad2/applications/' + smeId);
      await click('[data-act="rv-return"]'); await page.fill('#why', 'Margin too low for this volume.'); await modalOk();
      await signAs('AD2', 'MAKER'); await go('#/ad2/applications/' + smeId);
      await setVal('[data-act="rv-margin"][data-c="USD"]', 52); await click('[data-act="rv-submit"]'); await toastSays(/Compliance/);
      await signAs('AD2', 'COMPLIANCE2'); await go('#/ad2/applications/' + smeId);
      await click('[data-act="rv-approve"]'); await modalOk(); await toastSays(/approved/);
      check(await state(i => sme(i).config.margins.USD, smeId) === 52, 'approved at the repriced margin');
    });

    await scenario('Onboarding', 'Clarification: the applicant supplies its IEC; the maker prices; Compliance approves', 'Applicant → Maker → Compliance', async () => {
      await signAs('HKTRADING', 'APPLICANT'); await go('#/sme/dashboard');
      await page.fill('#ap-resp', 'IEC issued last week — attached.'); await page.fill('#ap-iec', '0826011223');
      await click('[data-act="ob-respond"]'); await toastSays(/Response sent/);
      await signAs('AD2', 'MAKER'); await go('#/ad2/applications/SME-1004');
      await setVal('[data-act="rv-margin"][data-c="USD"]', 55); await click('[data-act="rv-submit"]'); await toastSays(/Compliance/);
      await signAs('AD2', 'COMPLIANCE'); await go('#/ad2/applications/SME-1004');
      await click('[data-act="rv-approve"]'); await modalOk(); await toastSays(/approved/);
      check(await state(() => sme('SME-1004').status) === 'Approved', 'approved once the IEC is in');
    });

    await scenario('Onboarding', 'Compliance rejects an application; the applicant can no longer sign in', 'Compliance', async () => {
      await signAs('AD2', 'COMPLIANCE'); await go('#/ad2/applications/SME-1005');
      await click('[data-act="rv-reject"]'); await page.fill('#why', 'Business activity outside our risk appetite.'); await modalOk();
      await toastSays(/rejected/);
      const r = await page.evaluate(() => signIn('ISHANICONS', 'APPLICANT', 'demo').then(() => 'in').catch(e => e.status));
      check(r === 403, 'the rejected applicant is refused (403)');
    });

    await scenario('Onboarding', 'A duplicate PAN is flagged to the maker', 'Applicant → Maker', async () => {
      await page.evaluate(() => { setSession(null); location.hash = '#/login'; render(); });
      const r = await page.evaluate(() => send('onboarding.submit', { application: { ...sampleBusiness(), domainId: 'DUPTEST1', pan: 'AAFCM4521K', loginId: 'ADMIN' }, password: 'Welcome2026' })
        .then(x => x).catch(e => ({ err: e.message })));
      if (r.err) throw new Error(r.err);
      await signAs('AD2', 'MAKER'); await go('#/ad2/applications/' + r.smeId);
      await page.waitForSelector('text=PAN matches SME-1001');
      check(true, 'the maker sees “PAN matches SME-1001”');
    });

    /* ================= admin, reports, lab, platform ================= */
    await scenario('Admin', 'Administrator adds a Compliance user and changes the controls; the audit log records it', 'Admin', async () => {
      await signAs('AD2', 'ADMIN'); await go('#/ad2/admin/users');
      await click('[data-act="user-add"]');
      await select('#nu-role', 'AD2 Compliance'); await page.fill('#nu-login', 'COMPLIANCE3'); await page.fill('#nu-name', 'Asha Pillai');
      await modalOk(); await toastSays(/COMPLIANCE3 added/);
      check(true, 'a Compliance user can be added');
      await go('#/ad2/admin/compliance');
      await page.fill('#rw-amount', '35'); await click('[data-act="rule-save"][data-id="amount"]'); await toastSays(/updated/);
      await go('#/ad2/admin/docs');
      await click('[data-act="doc-add"][data-product="OTT"]'); await page.fill('#nd-name', 'Insurance certificate'); await select('#nd-rule', 'optional');
      await modalOk(); await toastSays(/added/);
      await go('#/ad2/admin/settings');
      await page.fill('#set-band', '10'); await click('[data-act="set-band-save"]'); await toastSays(/saved/);
      await go('#/ad2/admin/audit'); await page.fill('[data-act="audit-filter"]', 'COMPLIANCE3'); await wait(500);
      check(await page.locator('tbody tr').count() >= 1, 'the audit log records the change');
      await go('#/ad2/admin/roles');
      check(await page.locator('h2:has-text("AD2 Compliance")').count() === 1, 'the roles screen describes the Compliance role');
    });

    await scenario('Reports', 'Reports: bill amount beside outstanding, aging with rows, UFI status, FIRC downloads, CSV export', 'SME, Ops', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER'); await go('#/sme/reports');
      await select('[data-act="report-pick"]', 'outstanding');
      const head = await text('thead');
      check(/Bill amount/.test(head) && /Outstanding/.test(head), 'outstanding bills show the bill amount and the outstanding');
      await select('[data-act="report-pick"]', 'aging');
      check(await page.locator('tbody tr').count() > 3, 'the aging report lists every open bill, receipt and FIRC');
      await shot('report-aging', true);
      await select('[data-act="report-pick"]', 'realised');
      check(/UFI portal/.test(await text('thead')) && await page.locator('td:has-text("EDPMS updated"), td:has-text("IDPMS updated")').count() >= 1, 'bills lodged and realised show the UFI portal knock-off');
      await select('[data-act="report-pick"]', 'firc');
      check(await page.locator('[data-act="di-firc"]').count() >= 1, 'every FIRC has a download');
      const [dl] = await Promise.all([page.waitForEvent('download'), click('[data-act="export-report"]')]);
      check(/\.csv$/.test(dl.suggestedFilename()), 'the report exports as CSV');
    });

    await scenario('Lab', 'Test data lab: a new business with parked requests that carry on through the real workflow', 'Maker, Ops', async () => {
      await signAs('AD2', 'MAKER'); await go('#/ad2/lab');
      await click('[data-act="lab-create"][data-p="HYDPHARMA"][data-stage="approved"]');
      await page.waitForSelector('.modal:has-text("Test business created")');
      const smeId = /\((SME-\d+)\)/.exec(await text('.modal'))[1];
      await closeModal();
      await click(`[data-act="lab-queue"][data-id="${smeId}"]`); await toastSays(/parked/);
      await click(`[data-act="lab-topup"][data-id="${smeId}"]`); await toastSays(/Added/);
      check(await state(i => myQueue().filter(q => DB.outward.concat(DB.disposals).find(r => r.id === q.id)?.smeId === i).length, smeId) >= 2, 'parked requests reach the maker');
      await signAs('AD2', 'OPS2'); await go('#/ad2/queue');
      await page.waitForSelector('td:has-text("Release payment")');
      check(true, 'an authorised one is waiting for operations to release');
    });

    /* ================= master test user ================= */
    await scenario('Testing', 'Master test user: one sign-in; “Do it as …” carries a payment through every stage, never to someone who already handled it', 'Master → SME → Maker → Checker → Ops', async () => {
      await closeModal();
      await page.evaluate(() => { setSession(null); resetDrafts(); location.hash = '#/login'; render(); });
      await page.waitForSelector('.login-panel');
      await click('.mt-login [data-act="fill-login"]');
      check(await page.inputValue('#li-domain') === 'TEST' && await page.inputValue('#li-user') === 'MASTER', 'the sign-in page offers the master test user first (TEST / MASTER)');
      await page.fill('#li-pass', 'demo'); await click('form [type=submit]'); await wait(400);
      check(await page.evaluate(() => location.hash) === '#/test', 'the master lands on the test console');
      check(await page.locator('.mt-person').count() >= 15, 'every customer and AD2 user can be opened from the console');
      check(await page.locator('tr:has-text("Verify the payment") [data-act="mt-go"]').count() >= 1, 'open items list the next step and who can take it');
      await shot('master-console', true);
      await click('[data-act="mt-go"][data-d="MERIDIANTEX"][data-dest="#/sme/outward/new"]');
      check(await state(() => S.domainId + '/' + S.loginId) === 'MERIDIANTEX/SMEUSER', 'a journey starts as the customer, with no password');
      const id = await newOutward({ bene: 'BEN-002', product: 'OTT', purpose: 'S1006', purposeSearch: 'consultancy', currency: 'GBP', amount: 3000 });
      await shot('master-bar');
      const trail = [];
      for (const [action, status] of [['or-verify', 'Verified'], ['or-authorise', 'Authorised'], ['or-execute', 'Completed']]) {
        trail.push((await text('.mbar .mb-go')).replace(/\s*→\s*$/, ''));
        await click('.mbar .mb-go'); await page.waitForSelector(`[data-act="${action}"]`);
        check(/you can do this here/.test(await text('.mbar .mb-step')), `the bar opens the request for the ${status === 'Verified' ? 'maker' : status === 'Authorised' ? 'checker' : 'operations user'}`);
        await click(`[data-act="${action}"]`);
        if (action === 'or-verify') await click('[data-act="vchk-all"]');
        await modalOk();
        if (action === 'or-execute') { await page.waitForSelector('.modal .advice', { timeout: 8000 }); await closeModal(); }
        await page.waitForSelector(`h1:has-text("${status}")`);
      }
      check(new Set(trail).size === 3, 'the bar hands it to three different people: ' + trail.join(' → '));
      check(/Released/.test(await text('.mbar .mb-step')), 'the bar shows the payment released');
      const keys = await state(i => { const o = DB.outward.find(x => x.id === i); return [o.createdByKey, o.wf.verified.key, o.wf.authorised.key, o.wf.executed.key]; }, id);
      check(new Set(keys).size === 4, 'four different people raised, verified, authorised and released it');
      const switches = await state(() => DB.audit.filter(a => /^Opened the platform as/.test(a.action)).length);
      check(switches >= 4, `each switch is written to the audit log (${switches})`);
      await click('.mbar [data-act="mt-console"]');
      check(await page.evaluate(() => location.hash) === '#/test', 'the bar returns to the console');
      await page.evaluate(() => { setSession(null); endMaster(); });
    });

    await scenario('Platform', 'Type an amount and click straight away: the first click counts', 'SME', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER'); await go('#/sme/outward/new');
      await select('#or-bene', 'BEN-002'); await click('[data-act="or-product"][data-id="OTT"]'); await select('#or-currency', 'GBP');
      await page.fill('#or-amount', '1234');                       // no change event yet: the click blurs the field
      await page.click('[data-act="or-book-rate"]'); await wait(400);
      const r = await state(() => OR_DRAFT.rate);
      check(r.mode === 'booked' && r.bookedAmount === 1234, 'one click books the rate for the amount just typed');
      await signAs('NILGIRISPICE', 'SMEUSER'); await go('#/sme/inward/IR-3306/dispose');
      await page.fill('#di-amt', '5000');
      await page.click('[data-act="di-option"][data-id="advance"]'); await wait(400);
      check(await state(() => DI_DRAFT.option) === 'advance' && await state(() => DI_DRAFT.amount) === '5000', 'a click right after typing is not lost on the disposal form either');
    });

    await scenario('Platform', 'The browser never goes back to an older copy of the state', 'Any', async () => {
      await signAs('AD2', 'MAKER');
      const r = await page.evaluate(() => {
        const before = DB.outward.length, rev = API.rev;
        applyServer({ rev: rev - 3, epoch: API.epoch, state: { ...DB, outward: [] } });
        return { before, after: DB.outward.length, rev: API.rev === rev };
      });
      check(r.after === r.before && r.rev, 'a lagging reply is ignored');
    });

    await scenario('Platform', 'Phone width: drawer navigation, no horizontal scroll', 'SME', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await signAs('MERIDIANTEX', 'SMEUSER'); await go('#/sme/dashboard');
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await click('.appbar [data-act="nav-toggle"]'); await shot('mobile-nav');
      await page.setViewportSize({ width: 1440, height: 1000 });
      check(over <= 2, 'no horizontal overflow at 390px (' + over + 'px)');
    });

    await scenario('Platform', 'A half-filled registration survives a reload', 'Applicant', async () => {
      await page.evaluate(() => { setSession(null); resetDrafts(); location.hash = '#/register'; render(); });
      await page.waitForSelector('#ob-legalName');
      await page.fill('#ob-legalName', 'Konkan Cashew Traders'); await page.locator('#ob-legalName').dispatchEvent('input');
      await page.reload(); await page.waitForSelector('#ob-legalName'); await wait(300);
      check(await page.inputValue('#ob-legalName') === 'Konkan Cashew Traders', 'the draft is restored after a reload');
      await click('[data-act="ob-restart"]');
    });

    await scenario('Platform', 'Reset demo data restores the starting data for everyone', 'Any', async () => {
      await page.goto(srv.base + '/app.html#/login'); await page.waitForSelector('.login-panel');
      const rev = await state(() => API.rev);
      await click('.sim-bar [data-act="reset-demo"]'); await modalOk(); await page.waitForSelector('.login-panel');
      check(await state(() => API.rev) > rev, 'the revision moves forward, so no browser keeps the old data');
      await signAs('MERIDIANTEX', 'SMEUSER');
      check(await state(() => Engine.billAvailable(DB, bill('BL-24014'))) === 45000, 'seed data is back (BL-24014 free again)');
      check(await state(() => outwardRec('OR-5104').status) === 'Clarification Required', 'seeded requests are back at their starting stage');
    });
  } finally {
    const pass = results.filter(r => r.status === 'pass').length;
    const report = { at: new Date().toISOString(), base: srv.base, total: results.length, passed: pass, failed: results.length - pass,
      checks: results.reduce((t, r) => t + r.checks.length, 0), results };
    fs.writeFileSync(path.join(SHOTS, 'qa-report.json'), JSON.stringify(report, null, 2));
    const md = [`# QA run — ${report.at}`, '', `${pass} of ${results.length} journeys passed · ${report.checks} checks`, '',
      '| # | Area | Journey | Who | Result | Checks |', '|---|---|---|---|---|---|',
      ...results.map((r, i) => `| ${i + 1} | ${r.area} | ${r.name} | ${r.roles} | ${r.status === 'pass' ? 'Pass' : 'FAIL: ' + r.error} | ${r.checks.length} |`)].join('\n');
    fs.writeFileSync(path.join(SHOTS, 'qa-report.md'), md + '\n');
    console.log(`\n${pass === results.length ? 'PASS' : 'FAIL'} — ${pass}/${results.length} journeys, ${report.checks} checks. Report and screenshots in ${SHOTS}`);
    if (pass !== results.length) process.exitCode = 1;
    await browser.close();
    srv.stop();
  }
})();
