/* Multi-scenario browser QA. Where e2e.js walks one partner through the demo
   guide, this drives every other journey through the real UI, as each role:

     role sidebars · collapsible rail · partial and advance disposal · FIRC
     knock-off with UFI · EEFC credit · LC with a High-risk beneficiary ·
     Form 146 threshold · AIR knock-off · query and response · onboarding
     return and approve · duplicate PAN · test data lab · user admin ·
     compliance and document masters · assisted margin · mobile · draft autosave

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
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  let n = 0, passed = 0;
  const shot = (name, full) => page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: !!full });
  const wait = ms => page.waitForTimeout(ms);
  const idle = () => page.waitForFunction(() => !document.body.classList.contains('busy'), null, { timeout: 15000 });
  const click = async (sel, opts) => { await page.locator(sel).first().click(opts); await wait(200); await idle(); };
  const modalOk = async () => { await click('.modal [data-act="modal-ok"]'); await wait(300); };
  const closeModal = async () => { if (await page.locator('.modal').count()) await click('.modal [data-act="modal-close"]'); };
  const setVal = async (sel, v) => { await page.fill(sel, String(v)); await page.locator(sel).dispatchEvent('change'); await wait(250); };
  const select = async (sel, v) => { await page.selectOption(sel, v); await wait(250); };
  const go = async hash => { await page.evaluate(h => { location.hash = h; }, hash); await wait(350); await noCrash(hash); };
  const noCrash = async where => {
    if (await page.locator('text=Something went wrong rendering this screen').count()) throw new Error('Render error at ' + where);
  };
  const signAs = async (d, l) => {
    await closeModal();
    const ok = await page.evaluate(([d, l]) => switchTo(d, l), [d, l]);
    await idle(); await wait(400);
    if (!ok) throw new Error(`Could not sign in as ${d}/${l}`);
  };
  const api = (c, p) => page.evaluate(([c, p]) => send(c, p).then(r => ({ ok: true, r })).catch(e => ({ ok: false, status: e.status, msg: e.message })), [c, p]);
  const state = fn => page.evaluate(fn);
  const toastSays = re => page.waitForFunction(r => [...document.querySelectorAll('.toast')].some(t => new RegExp(r, 'i').test(t.textContent)), re.source, { timeout: 10000 });
  const hashId = async () => (await page.evaluate(() => location.hash)).split('/').pop();
  const samples = async scope => { while (await page.locator(`[data-act="doc-sample"][data-scope="${scope}"]`).count()) await click(`[data-act="doc-sample"][data-scope="${scope}"]`); };
  const declare = async prefix => { await page.check(`[data-act="${prefix}-dec"][data-dk="fema"]`); await page.check(`[data-act="${prefix}-dec"][data-dk="ofac"]`); };
  const approveOutward = async (id, who = {}) => {
    await signAs('AD2', who.maker || 'MAKER'); await go('#/ad2/outward/' + id);
    await click('[data-act="or-verify"]'); await click('[data-act="vchk-all"]');
    if (who.note) await page.fill('#vnote', who.note);
    await modalOk(); await page.waitForSelector('h1:has-text("Verified")');
    await signAs('AD2', who.checker || 'CHECKER'); await go('#/ad2/outward/' + id);
    await click('[data-act="or-authorise"]'); if (who.note) await page.fill('#vnote', who.note);
    await modalOk(); await page.waitForSelector('h1:has-text("Authorised")');
    await signAs('AD2', who.ops || 'OPS'); await go('#/ad2/outward/' + id);
    await click('[data-act="or-execute"]'); await modalOk();
    await page.waitForSelector('.modal .advice', { timeout: 8000 }); await closeModal();
    await page.waitForSelector('h1:has-text("Completed")');
  };
  const approveDisposal = async (id, who = {}) => {
    await signAs('AD2', who.maker || 'MAKER'); await go('#/ad2/disposals/' + id);
    await click('[data-act="di-verify"]'); await click('[data-act="vchk-all"]'); if (who.note) await page.fill('#vnote', who.note);
    await modalOk(); await page.waitForSelector('h1:has-text("Verified")');
    await signAs('AD2', who.checker || 'CHECKER'); await go('#/ad2/disposals/' + id);
    await click('[data-act="di-authorise"]'); if (who.note) await page.fill('#vnote', who.note);
    await modalOk(); await page.waitForSelector('h1:has-text("Authorised")');
    await signAs('AD2', who.ops || 'OPS'); await go('#/ad2/disposals/' + id);
    await click('[data-act="di-process"]'); await modalOk();
    await page.waitForSelector('.modal .advice', { timeout: 8000 });
  };
  const scenario = async (name, fn) => {
    process.stdout.write('• ' + name + ' … ');
    const t = Date.now();
    await fn();
    await noCrash(name);
    passed++;
    console.log(`ok (${((Date.now() - t) / 1000).toFixed(1)}s)`);
  };

  try {
    await page.goto(srv.base + '/app.html#/login');
    await page.waitForSelector('.login-panel');
    if (process.env.BASE) {
      await click('.sim-bar [data-act="reset-demo"]'); await modalOk(); await page.waitForSelector('.login-panel');
    }
    await shot('login', true);

    await scenario('Each role gets its own sidebar and every screen renders', async () => {
      const roles = [['AD2', 'SALES'], ['AD2', 'MAKER'], ['AD2', 'CHECKER'], ['AD2', 'OPS'], ['AD2', 'ADMIN'],
                     ['MERIDIANTEX', 'SMEUSER'], ['NILGIRISPICE', 'SMEUSER'], ['PUNEAUTO', 'SMEUSER'], ['ISHANICONS', 'APPLICANT']];
      const seen = {};
      for (const [d, l] of roles) {
        await signAs(d, l);
        const links = await page.$$eval('.nav a', as => as.map(a => a.getAttribute('href')));
        seen[d + '/' + l] = links;
        await shot('nav-' + d.toLowerCase() + '-' + l.toLowerCase());
        for (const h of links) await go(h);
      }
      const has = (k, h) => seen[k].includes(h);
      if (has('AD2/SALES', '#/ad2/queue')) throw new Error('Sales should not have a work queue');
      if (!has('AD2/ADMIN', '#/ad2/admin/users') || has('AD2/MAKER', '#/ad2/admin/users')) throw new Error('Only the Administrator manages users');
      if (has('AD2/ADMIN', '#/ad2/queue')) throw new Error('Administrator has no transaction queue');
      if (has('PUNEAUTO/SMEUSER', '#/sme/inward') || !has('NILGIRISPICE/SMEUSER', '#/sme/inward')) throw new Error('SME sidebar ignores permission');
      if (seen['ISHANICONS/APPLICANT'].length !== 1) throw new Error('Applicant sees more than the application');
      /* a role cannot open another role's screen by URL */
      await signAs('AD2', 'SALES'); await go('#/ad2/admin/users');
      if (!(await page.evaluate(() => location.hash)).startsWith('#/ad2/dashboard')) throw new Error('Sales opened the users screen');
    });

    await scenario('Sidebar collapses to a rail and stays collapsed after reload', async () => {
      await signAs('AD2', 'MAKER'); await go('#/ad2/dashboard');
      await click('.top [data-act="nav-mini"]');
      if (!(await page.evaluate(() => document.body.classList.contains('nav-mini')))) throw new Error('did not collapse');
      await shot('nav-collapsed');
      await page.reload(); await page.waitForSelector('.nav'); await wait(500);
      if (!(await page.evaluate(() => document.body.classList.contains('nav-mini')))) throw new Error('collapse not remembered');
      await click('.nav [data-act="nav-mini"]');
      if (await page.evaluate(() => document.body.classList.contains('nav-mini'))) throw new Error('did not expand');
    });

    await scenario('Switch user picker lists staff and businesses and filters', async () => {
      await click('[data-act="switch-open"]');
      const rows = await page.locator('.swrow').count();
      await page.fill('#sw-q', 'vikram'); await wait(200);
      const visible = await page.locator('.swrow:not([hidden])').count();
      await shot('switch-user');
      if (rows < 15 || visible !== 1) throw new Error(`picker rows ${rows}, filtered ${visible}`);
      await click('.swrow:not([hidden])');
      await page.waitForSelector('.who:has-text("Vikram Sethi")');
    });

    let di1, di2;
    await scenario('Partial disposal: knock off part of a receipt, advance the rest', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER');
      await go('#/sme/inward/IR-3303/dispose');
      await setVal('#di-amt', 60000);
      await setVal('[data-act="di-alloc"][data-bill="BL-24003"]', 50000);
      await select('#di-acct', 'BA-001');
      await click('[data-act="di-book-rate"]');
      await samples('di'); await declare('di');
      await shot('disposal-form-partial', true);
      await click('[data-act="di-submit"]'); await page.waitForSelector('h1:has-text("Submitted")');
      di1 = await hashId();
      await go('#/sme/inward/IR-3303');
      await page.waitForSelector('h1:has-text("Partially Disposed")');
      await click('button:has-text("Dispose the balance")');
      if (await page.inputValue('#di-amt') !== '37200') throw new Error('balance not prefilled: ' + await page.inputValue('#di-amt'));
      await click('[data-act="di-option"][data-id="advance"]');
      if (await page.locator('text=Commercial Export Invoice*').count()) throw new Error('advance still requires the export invoice');
      await select('#di-acct', 'BA-001'); await click('[data-act="di-book-rate"]');
      await samples('di'); await declare('di');
      await click('[data-act="di-submit"]'); await page.waitForSelector('h1:has-text("Submitted")');
      di2 = await hashId();
      await approveDisposal(di1);
      const firc1 = await page.locator('.modal .advice').textContent();
      if (!/Pending knock-off/.test(firc1)) throw new Error('FIRC does not show the unapplied 10,000');
      await shot('firc-partial');
      await closeModal();
      await approveDisposal(di2, { maker: 'MAKER2', checker: 'CHECKER2', ops: 'OPS2' });
      await closeModal();
      const st = await state(() => inwardRec('IR-3303'));
      if (st.status !== 'Processed' || st.fircs.length !== 2) throw new Error('receipt not fully processed: ' + st.status);
    });

    await scenario('FIRC pending knock-off is matched to an export bill and reported through UFI', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER');
      await go('#/sme/disposals/' + di2);
      await click('[data-act="ko-from-firc"]');
      await page.waitForSelector('h1:has-text("Bill Knock-off")');
      await select('#ko-bill', 'BL-24003');
      await page.fill('#ko-amt', '37200');
      await click('[data-act="ko-add"]'); await click('[data-act="ko-submit"]');
      await toastSays(/submitted for AD2 confirmation/);
      await shot('knockoff-export');
      await signAs('AD2', 'CHECKER'); await go('#/ad2/reconciliation');
      await click('[data-act="rec-confirm"]'); await toastSays(/EDPMS/);
      await click('[data-act="rec-tab"][data-t="Confirmed"]');
      await shot('recon-ufi', true);
      const b = await state(() => bill('BL-24003'));
      if (b.outstanding !== 97200 - 50000 - 37200) throw new Error('bill outstanding ' + b.outstanding);
      /* the seeded advance DI-9004 against BL-24012 */
      await signAs('MERIDIANTEX', 'SMEUSER'); await go('#/sme/disposals/DI-9004');
      await click('[data-act="ko-from-firc"]');
      await select('#ko-bill', 'BL-24012'); await page.fill('#ko-amt', '40000'); await click('[data-act="ko-add"]'); await click('[data-act="ko-submit"]');
      await signAs('AD2', 'CHECKER2'); await go('#/ad2/reconciliation'); await click('[data-act="rec-confirm"]');
      await signAs('AD2', 'OPS'); await go('#/ad2/reconciliation'); await click('[data-act="rec-tab"][data-t="Confirmed"]');
      await click('[data-act="rec-reverse"]'); await page.fill('#why', 'Matched to the wrong invoice'); await modalOk();
      await toastSays(/reversed/);
      const d = await state(() => disposalRec('DI-9004'));
      if (d.unallocated !== 40000) throw new Error('reversal did not restore the FIRC balance');
    });

    await scenario('Disposal to an EEFC account credits foreign currency', async () => {
      await signAs('NILGIRISPICE', 'SMEUSER');
      await go('#/sme/inward/IR-3305/dispose');
      await setVal('#di-amt', 20000);
      await click('[data-act="di-option"][data-id="advance"]');
      await select('#di-acct', 'BA-007');
      if (!(await page.locator('text=No conversion').count())) throw new Error('rate box still shown for EEFC');
      await samples('di'); await declare('di');
      await shot('disposal-eefc', true);
      await click('[data-act="di-submit"]'); await page.waitForSelector('h1:has-text("Submitted")');
      const id = await hashId();
      const before = await state(() => acct('BA-007').balance);
      await approveDisposal(id, { maker: 'MAKER2' });
      if (!/EEFC/.test(await page.locator('.modal .advice').textContent())) throw new Error('FIRC does not say EEFC');
      await closeModal();
      const after = await state(() => acct('BA-007').balance);
      if (after !== before + 20000) throw new Error(`EEFC balance ${before} → ${after}`);
    });

    await scenario('LC payment to a watchlist beneficiary scores High and needs reasons', async () => {
      await signAs('PUNEAUTO', 'SMEUSER');
      await go('#/sme/outward/new');
      const bene = await page.locator('#or-bene option', { hasText: 'Blocked Trading' }).getAttribute('value');
      await select('#or-bene', bene);
      await click('[data-act="or-product"][data-id="LC"]');
      await page.fill('#or-lcNumber', 'ILC/2026/0911'); await page.locator('#or-lcNumber').dispatchEvent('change');
      await select('#or-currency', 'USD');
      await click('[data-act="or-alloc-max"]');
      await setVal('#or-executionDate', new Date(Date.now() + 86400000).toISOString().slice(0, 10));
      const acc = await page.locator('#or-debit option:not([disabled])').nth(1).getAttribute('value');
      await select('#or-debit', acc);
      await click('[data-act="or-book-rate"]');
      await samples('or'); await declare('or');
      await shot('outward-lc-form', true);
      await click('[data-act="or-submit"]'); await page.waitForSelector('h1:has-text("Submitted")');
      const id = await hashId();
      await signAs('AD2', 'MAKER'); await go('#/ad2/outward/' + id);
      await page.waitForSelector('.risk-High');
      await shot('outward-risk-high', true);
      await click('[data-act="or-verify"]'); await click('[data-act="vchk-all"]'); await click('.modal [data-act="modal-ok"]');
      await toastSays(/record your reason/);
      await closeModal();
      await approveOutward(id, { note: 'Watchlist hit reviewed: different entity, confirmed with compliance.' });
      const o = await page.evaluate(i => outwardRec(i), id);
      if (!o.lcNumber || !/LC ILC/.test(await page.evaluate(i => mt103(outwardRec(i)), id))) throw new Error('LC number missing from the payment or MT103');
    });

    await scenario('OTT above ₹5 lakh asks for Form 146; below, it is optional', async () => {
      await signAs('MERIDIANTEX', 'SMEUSER');
      await go('#/sme/outward/new');
      await select('#or-bene', 'BEN-002');
      await click('[data-act="or-product"][data-id="OTT"]');
      await select('#or-purpose', 'S1006');
      await select('#or-currency', 'GBP');
      await setVal('#or-amount', 7000);
      const high = await page.locator('.docrow:has-text("Form 146")').textContent();
      await setVal('#or-amount', 3000);
      const low = await page.locator('.docrow:has-text("Form 146")').textContent();
      if (!/Required/.test(high) || !/Optional/.test(low)) throw new Error(`Form 146 rule wrong: "${high.trim()}" / "${low.trim()}"`);
    });

    await scenario('Advance payment (AIR) is knocked off against its Bill of Entry', async () => {
      await signAs('ARCADIACOMP', 'SMEUSER'); await go('#/sme/knockoff');
      await select('#ko-bill', 'BL-24013'); await select('#ko-rem', 'OR-5108');
      await page.fill('#ko-amt', '30000'); await click('[data-act="ko-add"]'); await click('[data-act="ko-submit"]');
      await signAs('AD2', 'CHECKER'); await go('#/ad2/queue');
      await page.waitForSelector('td:has-text("Knock-off")');
      await go('#/ad2/reconciliation'); await click('[data-act="rec-confirm"]'); await toastSays(/IDPMS/);
      if ((await state(() => bill('BL-24013'))).settlement !== 'Settled') throw new Error('BL-24013 not settled');
    });

    await scenario('Query goes back to the SME and returns to the maker', async () => {
      await signAs('AD2', 'MAKER'); await go('#/ad2/outward/OR-5106');
      await click('[data-act="or-query"]'); await page.fill('#why', 'Attach the signed proforma invoice.'); await modalOk();
      await page.waitForSelector('h1:has-text("Clarification Required")');
      await signAs('ARCADIACOMP', 'SMEUSER'); await go('#/sme/outward/OR-5106');
      await page.fill('#resp-text', 'Signed proforma attached.'); await page.locator('#resp-text').dispatchEvent('input');
      await click('[data-act="doc-sample"][data-scope="resp"]');
      await click('[data-act="or-respond"]'); await page.waitForSelector('h1:has-text("Submitted")');
      await signAs('AD2', 'MAKER2'); await go('#/ad2/outward/OR-5106');
      await click('[data-act="or-verify"]'); await click('[data-act="vchk-all"]'); await modalOk();
      await page.waitForSelector('h1:has-text("Verified")');
    });

    await scenario('Onboarding: lab applicant, maker prices, checker returns, then approves', async () => {
      await signAs('AD2', 'SALES'); await go('#/ad2/lab');
      await shot('lab', true);
      await click('[data-act="lab-create"][data-p="KERALACOIR"][data-stage="applicant"]');
      await page.waitForSelector('.modal:has-text("Test business created")');
      const txt = await page.locator('.modal').textContent();
      const smeId = /\((SME-\d+)\)/.exec(txt)[1];
      await closeModal();
      await signAs('AD2', 'MAKER'); await go('#/ad2/applications/' + smeId);
      await setVal('[data-act="rv-margin"][data-c="USD"]', 48);
      await click('[data-act="rv-charge-add"]'); await modalOk();
      await click('[data-act="rv-submit"]'); await toastSays(/checker/);
      await signAs('AD2', 'CHECKER'); await go('#/ad2/applications/' + smeId);
      await click('[data-act="rv-return"]'); await page.fill('#why', 'Margin too low for this volume.'); await modalOk();
      await signAs('AD2', 'MAKER'); await go('#/ad2/applications/' + smeId);
      await setVal('[data-act="rv-margin"][data-c="USD"]', 52);
      await click('[data-act="rv-submit"]'); await toastSays(/checker/);
      await signAs('AD2', 'CHECKER2'); await go('#/ad2/applications/' + smeId);
      await click('[data-act="rv-approve"]'); await modalOk(); await toastSays(/approved/);
      const login = await state(() => DB.logins.find(l => l.smeId === location.hash.split('/').pop()));
      if (!login || login.role !== 'SME User') throw new Error('applicant login not promoted');
    });

    await scenario('Duplicate PAN is flagged to the maker', async () => {
      await page.evaluate(() => { setSession(null); location.hash = '#/login'; render(); });
      const r = await page.evaluate(() => send('onboarding.submit', { application: { ...sampleBusiness(), domainId: 'DUPTEST1', pan: 'AAFCM4521K', loginId: 'ADMIN' }, password: 'Welcome2026' })
        .then(x => x).catch(e => ({ err: e.message })));
      if (r.err) throw new Error(r.err);
      await page.goto(srv.base + '/app.html#/login'); await page.waitForSelector('.login-panel'); await wait(300);
      await signAs('AD2', 'MAKER'); await go('#/ad2/applications/' + r.smeId);
      await page.waitForSelector('text=PAN matches SME-1001');
    });

    await scenario('Test data lab: new business, top-up and parked requests flow on', async () => {
      await signAs('AD2', 'MAKER'); await go('#/ad2/lab');
      await click('[data-act="lab-create"][data-p="HYDPHARMA"][data-stage="approved"]');
      await page.waitForSelector('.modal:has-text("Test business created")');
      const txt = await page.locator('.modal').textContent();
      const smeId = /\((SME-\d+)\)/.exec(txt)[1];
      await closeModal();
      await click(`[data-act="lab-queue"][data-id="${smeId}"]`); await toastSays(/parked/);
      await click(`[data-act="lab-topup"][data-id="${smeId}"]`); await toastSays(/Added/);
      const q = await state(() => myQueue().length);
      if (q < 2) throw new Error('parked requests did not reach the maker queue');
      await signAs('AD2', 'OPS'); await go('#/ad2/queue');
      await page.waitForSelector('td:has-text("Release payment")');
      await click('[data-act="go"]:has-text("Open") >> nth=0');
      await noCrash('queue open');
    });

    await scenario('Administrator: users, compliance, documents and settings', async () => {
      await signAs('AD2', 'ADMIN'); await go('#/ad2/admin/users');
      await click('[data-act="user-add"]');
      await select('#nu-role', 'AD2 Checker'); await page.fill('#nu-login', 'CHECKER3'); await page.fill('#nu-name', 'Asha Pillai');
      await modalOk(); await toastSays(/CHECKER3 added/);
      await click('[data-act="user-active"][data-l="CHECKER3"]'); await modalOk(); await toastSays(/deactivated/);
      await shot('admin-users', true);
      const r = await api('outward.authorise', { id: 'OR-5103' });
      if (r.ok || r.status !== 403) throw new Error('admin could authorise: ' + JSON.stringify(r));
      await go('#/ad2/admin/compliance');
      await page.uncheck('[data-act="rule-toggle"][data-id="newbene"]'); await idle(); await wait(300);
      await page.fill('#rw-amount', '35'); await click('[data-act="rule-save"][data-id="amount"]'); await toastSays(/updated/);
      await shot('admin-compliance', true);
      await go('#/ad2/admin/docs');
      await click('[data-act="doc-add"][data-product="OTT"]'); await page.fill('#nd-name', 'Insurance certificate'); await select('#nd-rule', 'optional');
      await modalOk(); await toastSays(/added/);
      await go('#/ad2/admin/settings');
      await page.fill('#set-band', '10'); await click('[data-act="set-band-save"]'); await toastSays(/saved/);
      await go('#/ad2/admin/audit'); await page.fill('[data-act="audit-filter"]', 'CHECKER3'); await wait(500);
      if ((await page.locator('tbody tr').count()) < 2) throw new Error('audit log misses the user changes');
      await go('#/ad2/admin/purpose');
      await page.fill('#ip-code', 'SVCEXP'); await page.fill('#ip-label', 'Export of services'); await click('[data-act="inpurpose-add"]'); await toastSays(/SVCEXP added/);
      /* a deactivated user cannot sign in */
      const ok = await page.evaluate(() => signIn('AD2', 'CHECKER3', 'demo').then(() => 'in').catch(e => e.status));
      if (ok !== 403) throw new Error('deactivated user signed in: ' + ok);
    });

    await scenario('Sales assisted journey with a margin inside the band', async () => {
      await signAs('AD2', 'SALES'); await go('#/ad2/directory');
      await click('[data-act="assist-start"][data-id="SME-1001"]');
      await click('.modal [data-act="assist-go"][data-dest="#/sme/outward/new"]');
      await page.waitForSelector('h1:has-text("New outward request")');
      await select('#or-bene', 'BEN-002');
      await click('[data-act="or-product"][data-id="OTT"]'); await select('#or-purpose', 'S1006');
      await select('#or-currency', 'GBP'); await setVal('#or-amount', 1500);
      await setVal('#or-executionDate', new Date(Date.now() + 86400000).toISOString().slice(0, 10));
      await select('#or-debit', 'BA-001');
      const m = Number(await page.inputValue('#or-margin'));
      await setVal('#or-margin', m - 8);
      await click('[data-act="or-book-rate"]');
      await samples('or'); await declare('or');
      await shot('assisted-margin', true);
      await click('[data-act="or-submit"]'); await page.waitForSelector('h1:has-text("Submitted")');
      const id = await hashId();
      const o = await state(() => outwardRec(location.hash.split('/').pop()));
      if (o.rate.margin !== m - 8 || o.source !== 'AD2 Assisted') throw new Error('assisted margin not applied: ' + o.rate.margin);
      await click('[data-act="assist-exit"]');
      await approveOutward(id);
    });

    await scenario('Phone width: drawer navigation and no horizontal scroll', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await signAs('MERIDIANTEX', 'SMEUSER'); await go('#/sme/dashboard');
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await click('.appbar [data-act="nav-toggle"]');
      await shot('mobile-nav');
      await page.setViewportSize({ width: 1440, height: 1000 });
      if (over > 2) throw new Error('horizontal overflow ' + over + 'px');
    });

    await scenario('A half-filled registration survives a reload', async () => {
      await page.evaluate(() => { setSession(null); resetDrafts(); location.hash = '#/register'; render(); });
      await page.waitForSelector('#ob-legalName');
      await page.fill('#ob-legalName', 'Konkan Cashew Traders'); await page.locator('#ob-legalName').dispatchEvent('input');
      await page.reload(); await page.waitForSelector('#ob-legalName'); await wait(300);
      if (await page.inputValue('#ob-legalName') !== 'Konkan Cashew Traders') throw new Error('draft not restored');
      await page.waitForSelector('text=We restored the application');
      await click('[data-act="ob-restart"]');
    });

    if (errors.length) throw new Error('Page errors: ' + [...new Set(errors)].join(' | '));
    console.log(`\nPASS — ${passed} scenarios. Screenshots in ${SHOTS}`);
  } catch (e) {
    await shot('failure', true).catch(() => {});
    console.error('\nFAIL:', e.message);
    if (errors.length) console.error('Page errors:', [...new Set(errors)]);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.stop();
  }
})();
