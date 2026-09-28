/* End-to-end browser test: one new partner from registration to a released
   payment and a disposed export receipt, clicking through the UI the way a
   presenter would, driven by the demo guide.

     npm run test:e2e                  starts a throwaway local server
     BASE=https://… npm run test:e2e   runs against a deployment (resets it)

   Uses the Chromium that ships with the environment when present. */
'use strict';
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), 'ad2-e2e');
fs.mkdirSync(SHOTS, { recursive: true });

async function startServer() {
  if (process.env.BASE) return { base: process.env.BASE.replace(/\/$/, ''), stop: () => {} };
  const port = 8140 + Math.floor(Math.random() * 500);
  const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ad2-e2e-')), 'state.json');
  const proc = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT: String(port), STATE_FILE: stateFile }, stdio: 'pipe' });
  await new Promise((res, rej) => { proc.stdout.on('data', d => /on http/.test(d) && res()); proc.on('exit', rej); setTimeout(res, 3000); });
  return { base: `http://localhost:${port}`, stop: () => proc.kill() };
}

(async () => {
  const srv = await startServer();
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  let n = 0;
  const shot = async name => page.screenshot({ path: path.join(SHOTS, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: false });
  const click = async (sel, opts) => { await page.locator(sel).first().click(opts); await page.waitForTimeout(250); };
  const idle = () => page.waitForFunction(() => !document.body.classList.contains('busy'), null, { timeout: 15000 });
  const modalOk = async () => { await click('[data-act="modal-ok"]'); await idle(); await page.waitForTimeout(300); };
  const toastSays = async re => {
    await page.waitForFunction(r => [...document.querySelectorAll('.toast')].some(t => new RegExp(r).test(t.textContent)), re.source, { timeout: 10000 });
  };
  const guideNext = async () => {
    await page.waitForSelector('.guide');
    const title = await page.locator('.guide-steps li.next b').first().textContent();
    console.log('  →', title);
    await click('.guide-steps li.next [data-act="guide-go"]');
    await idle(); await page.waitForTimeout(500);
    return title;
  };
  const step = async (label, fn) => {
    process.stdout.write(label + '\n');
    await fn();
    await shot(label.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40));
  };

  try {
    await page.goto(srv.base + '/app.html#/login');
    await page.waitForSelector('.login-panel');
    if (process.env.BASE) {
      await click('[data-act="reset-demo"]').catch(() => {});
    }
    await click('.sim-bar [data-act="guide-open"]');

    await step('1 register', async () => {
      await guideNext();
      await click('[data-act="ob-sample"]');
      for (let i = 0; i < 7; i++) await click('[data-act="ob-next"]');
      await page.check('#declare');
      await click('[data-act="ob-submit"]');
      await idle();
      await page.waitForSelector('.modal');
      await modalOk();                                          // sign in and track it
      await page.waitForSelector('h1:has-text("Application")');
    });

    await step('2 maker prices', async () => {
      await guideNext();
      await page.fill('[data-act="rv-margin"][data-c="USD"]', '50');
      await page.locator('[data-act="rv-margin"][data-c="USD"]').dispatchEvent('change');
      await click('[data-act="rv-charge-add"]'); await modalOk();
      await click('[data-act="rv-submit"]'); await idle();
      await toastSays(/Compliance/i);
    });

    await step('3 compliance approves', async () => {
      await guideNext();
      await click('[data-act="rv-approve"]'); await modalOk();
      await toastSays(/approved/i);
    });

    await step('4 sme adds beneficiary', async () => {
      await guideNext();
      await page.waitForSelector('h1');
      await click('[data-act="bene-add-profile"]');
      await click('[data-act="bene-sample"]');
      await modalOk();
      await toastSays(/Beneficiary added/);
    });

    await step('5 sme lodges import bill', async () => {
      await guideNext();
      await click('[data-act="bill-ai"]');
      await page.waitForSelector('.ai-field', { timeout: 5000 });
      await click('[data-act="bill-save"]'); await idle();
      await page.waitForSelector('.done-card h1:has-text("lodged")');
    });

    await step('6 checker accepts import bill', async () => {
      await guideNext();
      await click('[data-act="bill-accept"]'); await idle();
      await toastSays(/accepted/);
    });

    await step('7 sme raises DIR payment', async () => {
      await guideNext();
      const bene = await page.locator('#or-bene option').nth(1).getAttribute('value');
      await page.selectOption('#or-bene', bene); await page.waitForTimeout(300);
      await click('[data-act="or-product"][data-id="DIR"]');
      await page.selectOption('#or-billpick', { index: 1 }); await page.waitForTimeout(300);
      const exec = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      await page.fill('#or-executionDate', exec); await page.locator('#or-executionDate').dispatchEvent('change');
      const acctOpt = await page.locator('#or-debit option:not([disabled])').nth(1).getAttribute('value');
      await page.selectOption('#or-debit', acctOpt); await page.waitForTimeout(250);
      await click('[data-act="or-book-rate"]');
      while (await page.locator('[data-act="doc-sample"][data-scope="or"]').count()) await click('[data-act="doc-sample"][data-scope="or"]');
      await page.check('[data-act="or-dec"][data-dk="fema"]'); await page.check('[data-act="or-dec"][data-dk="ofac"]');
      await click('[data-act="or-submit"]');
      await page.waitForSelector('.modal .review-t'); await modalOk();
      await page.waitForSelector('.done-card h1:has-text("submitted")');
    });

    /* treasury, in the Treasury Management Portal: the booking is already a
       position on the book; the dealer covers it and allocates the cover */
    let posId;
    const backToTrade = async () => { await page.goto(srv.base + '/app.html'); await page.waitForSelector('.guide'); await page.waitForTimeout(300); };
    await step('7a dealer enters cover in the treasury portal', async () => {
      await guideNext();
      await page.waitForSelector('.pagehead h1:has-text("Bank cover deal entry")');
      posId = await page.evaluate(() => { const x = DB.positions.filter(q => q.status === 'Attached' && q.side === 'SELL' && q.channel === 'Trade portal')
        .sort((a, b) => String(b.bookedAt).localeCompare(String(a.bookedAt)))[0]; return x.id; });
      console.log('    position', posId);
      const mid = await page.locator('#cv-rate').getAttribute('placeholder');
      await page.fill('#cv-rate', mid);
      await click('[data-act="cv-save"]:not([data-alloc])'); await page.waitForTimeout(600);
      await toastSays(/cover COV-/);
      await backToTrade();
    });
    await step('7b dealer allocates the cover to the booking', async () => {
      await guideNext();
      await page.waitForSelector('.pagehead h1:has-text("Allocate bank cover")');
      if (!(await page.locator(`[data-al="${posId}"]`).isChecked())) await page.check(`[data-al="${posId}"]`);
      await click('[data-act="al-confirm"]'); await page.waitForTimeout(600);
      await toastSays(/Allocated/);
      const state = await page.evaluate(id => Engine.treasury.coverState(DB.positions.find(p => p.id === id)), posId);
      if (!['Covered', 'Partial'].includes(state)) throw new Error('Position not covered: ' + state);
      await backToTrade();
    });

    await step('8 maker verifies', async () => {
      await guideNext();
      await click('[data-act="or-verify"]');
      await click('[data-act="vchk-all"]'); await modalOk();
      await page.waitForSelector('h1:has-text("Verified")');
    });
    await step('9 checker authorises', async () => {
      await guideNext();
      await click('[data-act="or-authorise"]'); await modalOk();
      await page.waitForSelector('h1:has-text("Authorised")');
    });
    await step('10 ops releases', async () => {
      await guideNext();
      await click('[data-act="or-execute"]'); await modalOk();
      await page.waitForSelector('.modal .advice', { timeout: 8000 });
      const utr = await page.locator('.advice-head b').nth(1).textContent();
      if (!/^AD2O\d+/.test(utr)) throw new Error('No UTR on the advice: ' + utr);
      console.log('    UTR', utr);
      await click('[data-act="modal-close"]');
      await page.waitForSelector('h1:has-text("Completed")');
    });

    await step('10a dealer sees the position concluded and the Nostro move', async () => {
      await guideNext();
      await page.waitForSelector('.pagehead h1:has-text("Trade desk")');
      const row = page.locator(`tr:has(a[data-pos="${posId}"])`).first();
      const t = await row.textContent();
      if (!/Complete/.test(t) || !/AD2O\d+/.test(t)) throw new Error('Position not concluded by the UTR: ' + t);
      await backToTrade();
    });

    await step('11 sme lodges export bill', async () => {
      await guideNext();
      await click('[data-act="bill-ai"]');
      await page.waitForSelector('.ai-field', { timeout: 5000 });
      await click('[data-act="bill-save"]'); await idle();
      await page.waitForSelector('.done-card h1:has-text("lodged")');
    });
    await step('12 checker accepts export bill', async () => {
      await guideNext();
      await click('[data-act="bill-accept"]'); await idle();
      await toastSays(/accepted/);
    });
    await step('13 ops records inward', async () => {
      await guideNext();
      await page.waitForSelector('#ri-sme');
      const smeOpt = await page.locator('#ri-sme option').last().getAttribute('value');
      await page.selectOption('#ri-sme', smeOpt);
      await click('[data-act="ri-suggest"]');
      await modalOk();
      await page.waitForSelector('h1:has-text("Awaiting Instruction")');
    });
    await step('14 sme disposes', async () => {
      await guideNext();
      await page.selectOption('#di-billpick', { index: 1 }); await page.waitForTimeout(300);
      const acctOpt = await page.locator('#di-acct option:not([disabled])').nth(1).getAttribute('value');
      await page.selectOption('#di-acct', acctOpt);
      await click('[data-act="di-book-rate"]');
      while (await page.locator('[data-act="doc-sample"][data-scope="di"]').count()) await click('[data-act="doc-sample"][data-scope="di"]');
      await page.check('[data-act="di-dec"][data-dk="fema"]'); await page.check('[data-act="di-dec"][data-dk="ofac"]');
      await click('[data-act="di-submit"]');
      await page.waitForSelector('.modal .review-t'); await modalOk();
      await page.waitForSelector('.done-card h1:has-text("submitted")');
    });
    await step('15 maker verifies disposal', async () => {
      await guideNext();
      await click('[data-act="di-verify"]'); await click('[data-act="vchk-all"]'); await modalOk();
      await page.waitForSelector('h1:has-text("Verified")');
    });
    await step('16 checker authorises disposal', async () => {
      await guideNext();
      await click('[data-act="di-authorise"]'); await modalOk();
      await page.waitForSelector('h1:has-text("Authorised")');
    });
    await step('17 ops credits and issues FIRC', async () => {
      await guideNext();
      await click('[data-act="di-process"]'); await modalOk();
      await page.waitForSelector('.modal .advice', { timeout: 8000 });
      const firc = await page.locator('.advice-head b').nth(1).textContent();
      if (!/^FIRC-/.test(firc)) throw new Error('No FIRC: ' + firc);
      console.log('    FIRC', firc);
      await click('[data-act="modal-close"]');
      await page.waitForSelector('h1:has-text("Processed")');
      await page.waitForSelector('.guide .note-ok:has-text("Journey complete")');
    });

    await step('18 refusals hold in the browser', async () => {
      /* the maker cannot authorise, even by calling the API directly */
      await page.evaluate(() => switchTo('AD2', 'MAKER')); await idle(); await page.waitForTimeout(600);
      const res = await page.evaluate(async () => {
        try { await send('outward.authorise', { id: 'OR-5103' }); return 'allowed'; } catch (e) { return e.status + ' ' + e.message; }
      });
      if (!/^403/.test(res)) throw new Error('Maker was able to authorise: ' + res);
      console.log('    maker authorise →', res.slice(0, 80));
    });

    if (errors.length) throw new Error('Page errors: ' + errors.join(' | '));
    console.log(`\nPASS — full journey completed. Screenshots in ${SHOTS}`);
  } catch (e) {
    await shot('failure');
    console.error('\nFAIL:', e.message);
    if (errors.length) console.error('Page errors:', errors);
    process.exitCode = 1;
  } finally {
    await browser.close();
    srv.stop();
  }
})();
