/* ==========================================================================
   AD2 Trade Remittance — domain engine
   Every state change in the platform goes through execute(). The same file
   runs in two places:
     - on the server (api/), where it is the system of record and the only
       thing allowed to change the stored state;
     - in the browser, only when no server is reachable (the screen index
       previews, or opening the files straight from disk).
   Nothing here trusts its caller: permissions, four-eyes rules, document
   policy, rates, balances and bill reservations are all re-checked on every
   command, whatever the interface did or did not show.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./treasury.js'), require('./tmp-engine.js'));
  else root.Engine = factory(root.Treasury, root.TmpEngine);
})(typeof self !== 'undefined' ? self : this, function (installTreasury, installTmp) {
  'use strict';

  /* ---------- errors ------------------------------------------------------ */
  class EngineError extends Error {
    constructor(message, code = 'invalid', status = 400, details = []) {
      super(message);
      this.name = 'EngineError';
      this.code = code;
      this.status = status;
      this.details = details;
    }
  }
  const fail = (msg, details) => { throw new EngineError(msg, 'invalid', 400, details || []); };
  const need = (cond, msg, details) => { if (!cond) fail(msg, details); };
  const forbid = msg => { throw new EngineError(msg, 'forbidden', 403); };
  const missing = what => { throw new EngineError(what + ' was not found.', 'not_found', 404); };

  /* ---------- small helpers ---------------------------------------------- */
  const clone = o => JSON.parse(JSON.stringify(o));
  const round2 = n => Math.round(n * 100) / 100;
  const addHours = (iso, h) => new Date(new Date(iso).getTime() + h * 3600000).toISOString();
  const addDays = (iso, d) => new Date(new Date(iso).getTime() + d * 86400000).toISOString();
  const fmt = (n, cur) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '');
  const inr = n => '₹ ' + fmt(n);

  const nextId = (arr, prefix, pad = 4) => {
    const n = arr.reduce((m, r) => {
      const v = parseInt(String(r.id).split('-')[1], 10);
      return isNaN(v) ? m : Math.max(m, v);
    }, 0);
    return `${prefix}-${String(n + 1).padStart(pad, '0')}`;
  };
  const seq = (db, k) => { db.seq = db.seq || {}; db.seq[k] = (db.seq[k] || 0) + 1; return db.seq[k]; };

  /* ---------- input validation ------------------------------------------- */
  function txt(v, label, { max = 200, required = true, pattern, patternMsg } = {}) {
    const s = v == null ? '' : String(v).trim();
    if (required && !s) fail(label + ' is required.');
    if (s.length > max) fail(`${label} must be ${max} characters or fewer.`);
    if (s && pattern && !pattern.test(s)) fail(patternMsg || `${label} is not in the expected format.`);
    return s;
  }
  function amount(v, label) {
    const n = Number(v);
    if (!isFinite(n) || n <= 0) fail(label + ' must be a positive number.');
    if (n > 1e12) fail(label + ' is too large.');
    return round2(n);
  }
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function date(v, label, required = true) {
    const s = v == null ? '' : String(v).trim();
    if (!s) { if (required) fail(label + ' is required.'); return ''; }
    if (!DATE_RE.test(s) || isNaN(new Date(s))) fail(label + ' must be a date (YYYY-MM-DD).');
    return s;
  }
  const oneOf = (v, list, label) => { if (!list.includes(v)) fail(`${label} is not valid.`); return v; };
  const bool = v => v === true || v === 'true';
  const SWIFT_RE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

  /* Uploaded documents are recorded as metadata only; file content is never
     sent to or stored by the platform in this demo. */
  function docsIn(v, allowedIds) {
    const out = Object.create(null);
    if (!v || typeof v !== 'object') return out;
    Object.keys(v).slice(0, 30).forEach(id => {
      if (!/^[a-z0-9_-]{1,30}$/i.test(id) || id === '__proto__') return;
      if (allowedIds && !allowedIds.includes(id)) return;
      const d = v[id];
      if (!d || typeof d !== 'object') return;
      const filename = String(d.filename || '').trim().slice(0, 120);
      if (!filename) return;
      out[id] = { filename, size: String(d.size || '').slice(0, 20), type: String(d.type || '').slice(0, 60),
                  at: typeof d.at === 'string' ? d.at.slice(0, 30) : '' };
    });
    return out;
  }

  /* ---------- lookups ----------------------------------------------------- */
  const find = (arr, id) => (arr || []).find(x => x.id === id);
  const smeOf = (db, id) => find(db.smes, id);
  const productOf = (db, id) => (db.products || []).find(p => p.id === id);
  const purposeOf = (db, code) => (db.purposeCodes || []).find(p => p.code === code);
  const currencyOf = (db, code) => (db.currencies || []).find(c => c.code === code);
  const roleDef = (db, id) => (db.roles || []).find(r => r.id === id);
  const currencyCodes = db => db.currencies.map(c => c.code);

  function purposesFor(db, productId) {
    const p = productOf(db, productId);
    if (!p) return [];
    const off = p.disabled || [];
    return p.purposes.filter(c => !off.includes(c)).map(c => purposeOf(db, c)).filter(Boolean);
  }

  function perm(s) {
    const p = (s && s.config && s.config.permission) || '';
    return { importSide: p === 'Import' || p === 'Both', exportSide: p === 'Export' || p === 'Both' };
  }

  /* Document checklist for a product + purpose code. inrAmount drives the
     threshold rule (Form 146). */
  function checklist(db, productId, purposeCode, inrAmount, opts) {
    const option = (opts && opts.option) || 'knockoff';
    return (db.docPolicy || []).filter(d => d.product === productId).map(d => {
      let required = d.rule === 'required', note = '';
      if (d.rule === 'optional') note = 'Optional';
      if (d.rule === 'knockoff') {
        required = option === 'knockoff';
        note = required ? 'Required — this instruction knocks off bills' : 'Optional — advance credit, no bill knocked off yet';
      }
      if (d.rule === 'goods') {
        required = (db.goodsCodes || []).includes(purposeCode);
        note = required ? 'Required — purpose code is an import of goods' : 'Optional — not an import of goods';
      }
      if (d.rule === 'threshold') {
        required = (Number(inrAmount) || 0) > (d.threshold || 0);
        note = required ? `Required — above ${inr(d.threshold)} INR equivalent`
                        : `Optional — up to ${inr(d.threshold)} INR equivalent`;
      }
      return { id: d.id, name: d.name, required, rule: d.rule, note };
    });
  }

  /* ---------- pricing ----------------------------------------------------- */
  function marginFor(db, s, code) {
    if (!s || !s.config) return 0;
    const m = s.config.margins || {};
    if (m[code] != null) return m[code];
    if (m.USD == null) return 0;
    return Math.round(m.USD * ((currencyOf(db, code) || {}).marginMultiplier ?? 1));
  }
  /* Outward: reference + margin. Inward disposal: reference − margin. */
  const customerRate = (db, code, marginPaise) =>
    +(((currencyOf(db, code) || {}).refRate ?? 0) + (marginPaise || 0) / 100).toFixed(4);

  function chargesFor(s, amt, rate) {
    return ((s.config && s.config.charges) || []).map(c => ({
      name: c.name,
      amount: round2(c.basis === 'Fixed' ? c.value : amt * rate * c.value / 100),
    }));
  }

  /* ---------- compliance scoring ---------------------------------------------
     Runs on every outward request and disposal instruction at submission.
     Rules and weights come from the compliance master (Administration).   */
  const usdEq = (db, amt, cur) => round2(amt * ((currencyOf(db, cur) || {}).refRate || 0) / ((currencyOf(db, 'USD') || {}).refRate || 1));
  function riskScore(db, facts) {
    const flags = [];
    const rule = id => (db.complianceRules || []).find(r => r.id === id && r.enabled);
    const add = (r, detail) => flags.push({ rule: r.id, label: r.label, weight: r.weight, detail });
    let r;
    if ((r = rule('amount')) && facts.usd > Number(r.param || 0)) add(r, `≈ USD ${fmt(facts.usd)} is above USD ${fmt(r.param)}`);
    if ((r = rule('country'))) {
      const list = (r.param || []).map(x => String(x).toLowerCase());
      const hit = (facts.countries || []).find(c => c && list.includes(String(c).toLowerCase()));
      if (hit) add(r, hit + ' is on the high-risk list');
    }
    if ((r = rule('sanctions'))) {
      const names = (facts.names || []).filter(Boolean).map(n => String(n).toLowerCase());
      const hit = (r.param || []).find(w => names.some(n => n.includes(String(w).toLowerCase())));
      if (hit) add(r, `Name matches watchlist entry “${hit}”`);
    }
    if ((r = rule('newbene')) && facts.newBene) add(r, 'No earlier payment to this account');
    if ((r = rule('firsttxn')) && facts.first) add(r, 'First transaction of this kind for the SME');
    if ((r = rule('capital')) && /^S00\d\d$/.test(facts.purpose || '')) add(r, facts.purpose + ' is a capital-account code');
    if ((r = rule('docai')) && (facts.files || []).some(f => /mismatch/i.test(f))) add(r, 'Document AI could not match an uploaded document to the transaction');
    if ((r = rule('bankctry')) && facts.beneCountry && facts.bankCountry && facts.beneCountry !== facts.bankCountry)
      add(r, `Beneficiary in ${facts.beneCountry}, bank in ${facts.bankCountry}`);
    if ((r = rule('deal')) && facts.deal) add(r, 'Rate from FX deal reference');
    const score = Math.min(100, flags.reduce((t, f) => t + f.weight, 0));
    return { score, level: score >= 60 ? 'High' : score >= 25 ? 'Medium' : 'Low', flags };
  }

  /* Rates are settled by the treasury module (treasury.js): a request points
     at a booking or a treasury deal, and uses the rate stored there. */

  /* ---------- actors, capabilities, four-eyes ----------------------------- */
  const actorKey = a => a ? `${a.domainId}/${a.loginId}` : '';
  const actorLabel = a => a ? `${a.role}${a.name ? ' (' + a.name + ')' : ''}` : 'Public';
  const isAD2 = a => !!a && String(a.role).startsWith('AD2');

  /* Build the acting identity from a login and an optional assisted-journey
     target. Role and SME always come from the stored login, never the caller. */
  function resolveActor(db, who, actingFor) {
    if (!who) return null;
    const login = (db.logins || []).find(l => l.domainId === who.domainId && l.loginId === who.loginId);
    if (!login) throw new EngineError('Your session is no longer valid. Sign in again.', 'auth', 401);
    if (login.active === false) throw new EngineError('This user has been deactivated. Contact your administrator.', 'auth', 401);
    const a = { domainId: login.domainId, loginId: login.loginId, role: login.role, smeId: login.smeId || null,
                name: login.name || '', actingFor: null };
    if (actingFor) {
      const r = roleDef(db, a.role);
      if (!r || !r.can.includes('assist.transact')) forbid('Your role cannot transact on behalf of an SME.');
      const target = smeOf(db, actingFor);
      if (!target || target.status !== 'Approved') fail('Only an approved SME can be transacted for.');
      a.actingFor = target.id;
    }
    return a;
  }

  function can(db, a, cap) {
    if (!a) return false;
    const r = roleDef(db, a.role);
    if (!r) return false;
    if (r.can.includes(cap)) return true;
    if (a.actingFor && r.can.includes('assist.transact')) {
      const smeRole = roleDef(db, 'SME User');
      if (smeRole && smeRole.can.includes(cap)) return true;
    }
    return false;
  }
  function requireCap(db, a, cap) {
    if (!can(db, a, cap)) {
      const c = (db.capabilities || []).find(x => x.id === cap);
      const r = roleDef(db, a && a.role);
      const seg = r && (r.segregated || []).includes(cap);
      forbid(`${a ? a.role : 'You'} cannot ${c ? c.label.charAt(0).toLowerCase() + c.label.slice(1) : cap}` +
        (seg ? ' — withheld by design to keep maker and checker apart.' : '.'));
    }
  }
  /* The SME an actor is operating as: its own, or the one it is assisting. */
  function ownSme(db, a) {
    const id = a && (a.actingFor || a.smeId);
    const s = id && smeOf(db, id);
    if (!s) forbid('No SME is linked to this session.');
    return s;
  }
  function requireApproved(s) {
    if (s.status !== 'Approved') forbid('Transactions open once AD2 approves the application.');
  }
  /* Four-eyes: the same person may not act at two stages of one record. */
  function distinct(a, stages, what) {
    const k = actorKey(a);
    const clash = stages.filter(Boolean).find(st => st.key === k);
    if (clash) forbid(`You ${clash.verb || 'handled'} this ${what} earlier, so another user must ${what === 'application' ? 'approve' : 'take'} this step.`);
  }
  const stamp = (a, now, verb) => ({ by: actorLabel(a) + (a.actingFor ? ' — assisted' : ''), key: actorKey(a), at: now, verb });

  /* ---------- audit and notifications ------------------------------------- */
  /* internal entries (compliance scores, reviewer reasons, pricing overrides)
     are never shown to the SME. */
  function audit(db, a, now, record, action, internal) {
    const who = a ? actorLabel(a) : 'Public';
    const behalf = a && a.actingFor ? ` on behalf of ${(smeOf(db, a.actingFor) || {}).tradingName || a.actingFor}` : '';
    db.audit.unshift({ id: 'AU-' + seq(db, 'audit'), record, actor: who + behalf, action, at: now, ...(internal ? { internal: true } : {}) });
    if (db.audit.length > 3000) db.audit.length = 3000;
  }
  function notify(db, now, { toRole, toSmeId, text, link }) {
    db.notifications = db.notifications || [];
    db.notifications.unshift({ id: 'NT-' + seq(db, 'notif'), toRole: toRole || null, toSmeId: toSmeId || null,
                               text, link: link || '', at: now });
    if (db.notifications.length > 400) db.notifications.length = 400;
  }

  /* ---------- bill reservation ------------------------------------------- */
  const OPEN = ['Submitted', 'Verified', 'Authorised', 'Clarification Required'];

  /* What can still be allocated to a bill: its outstanding balance less
     anything held by open outward requests, open disposals and proposed
     knock-offs. exclude skips one record (the one being resubmitted). */
  function billAvailable(db, b, exclude) {
    let held = 0;
    db.outward.filter(o => OPEN.includes(o.status) && o.id !== exclude)
      .forEach(o => (o.allocations || []).forEach(x => { if (x.billId === b.id) held += x.amount; }));
    db.disposals.filter(d => OPEN.includes(d.status) && d.id !== exclude)
      .forEach(d => (d.allocations || []).forEach(x => { if (x.billId === b.id) held += x.amount; }));
    (db.allocations || []).filter(l => l.status === 'Proposed' && l.billId === b.id).forEach(l => { held += l.amount; });
    return round2(Math.max(0, b.outstanding - held));
  }
  function applyToBill(b, amt) {
    b.adjusted = round2(b.adjusted + amt);
    b.outstanding = round2(Math.max(0, b.amount - b.adjusted));
    b.settlement = b.adjusted <= 0 ? 'Unsettled' : b.outstanding <= 0 ? 'Settled' : 'Partially Settled';
  }
  function ledger(db, now, entry) {
    const id = nextId(db.allocations, 'AL');
    db.allocations.unshift({ id, at: now, ...entry });
    return id;
  }

  function allocationsIn(db, s, list, { type, currency, cap, exclude, label }) {
    const out = [];
    (Array.isArray(list) ? list : []).slice(0, 20).forEach(x => {
      const amt = Number(x && x.amount);
      if (!(amt > 0)) return;
      const b = find(db.bills, x && x.billId);
      if (!b || b.smeId !== s.id) fail('An allocated bill does not belong to this SME.');
      if (b.type !== type) fail(`Bill ${b.id} is not an ${type.toLowerCase()} bill.`);
      if (b.review !== 'Accepted') fail(`Bill ${b.id} has not been accepted by AD2 yet.`);
      if (b.currency !== currency) fail(`Bill ${b.id} is in ${b.currency}, not ${currency}. Settling a bill in another currency is not supported yet.`);
      if (out.some(o => o.billId === b.id)) fail(`Bill ${b.id} is allocated twice.`);
      const avail = billAvailable(db, b, exclude);
      if (amt > avail + 0.001) fail(`Bill ${b.id} has only ${fmt(avail, b.currency)} available to allocate.`);
      out.push({ billId: b.id, amount: round2(amt) });
    });
    const total = round2(out.reduce((t, x) => t + x.amount, 0));
    if (cap != null && total > cap + 0.001) fail(`${label || 'Allocations'} (${fmt(total, currency)}) exceed ${fmt(cap, currency)}.`);
    return { list: out, total };
  }

  /* ---------- seeding ------------------------------------------------------ */
  /* opts.rev lets a reset continue the revision count of the state it
     replaces, so no client mistakes the old state for the newer one. */
  function freshState(SEED, nowIso, opts) {
    const db = clone(SEED);
    const now = nowIso || new Date().toISOString();
    db.rev = Math.max(0, Number(opts && opts.rev) || 0);
    db.epoch = now + '~' + Math.random().toString(36).slice(2, 8);
    db.settings = { autoChecker: false, allowUnlinked: false, testLab: true, marginBand: 5,
      cutoff: '16:00', marketSim: true, maxOpenBookings: 5, rateBand: 2, agedDays: 3, ...(db.settings || {}) };
    /* Seeded transactions carry the documents their policy asked for. */
    const fill = (rec, product, purpose, inrAmt, opts) => {
      if (rec.status === 'Draft') return;
      rec.docs = rec.docs && Object.keys(rec.docs).length ? rec.docs : {};
      checklist(db, product, purpose, inrAmt, opts).forEach(d => {
        if (d.required || d.rule === 'goods') rec.docs[d.id] = rec.docs[d.id] ||
          { filename: `${rec.id}-${d.id}.pdf`, size: (120 + d.id.length * 37) + ' KB', type: 'application/pdf', at: rec.requestDate || rec.submittedAt };
      });
    };
    const seedStamp = at => ({ fema: true, ofac: true, at });
    db.outward.forEach(o => {
      fill(o, o.remittanceType, o.purposeCode, o.amount * (o.rate.customerRate || 0));
      if (o.rate.customerRate && o.inrAmount == null) {
        o.inrAmount = round2(o.amount * o.rate.customerRate);
        o.debitInr = round2(o.inrAmount + (o.charges || []).reduce((t, c) => t + c.amount, 0));
      }
      if (o.status === 'Draft') return;
      o.declarations = o.declarations || seedStamp(o.requestDate);
      o.risk = o.risk || riskScore(db, { usd: usdEq(db, o.amount, o.currency), purpose: o.purposeCode, deal: o.rate.mode === 'deal',
        countries: [o.beneficiaryCountry, o.beneficiaryBankCountry], names: [o.beneficiary, o.beneficiaryBank],
        beneCountry: o.beneficiaryCountry, bankCountry: o.beneficiaryBankCountry, newBene: !o.beneficiaryId, first: false, files: [] });
    });
    db.disposals.forEach(d => {
      d.option = d.option || 'knockoff';
      d.purposeCode = d.purposeCode && d.purposeCode !== 'TRADE' ? d.purposeCode : (d.option === 'advance' ? 'P0103' : 'P0102');
      d.creditCurrency = d.creditCurrency || 'INR';
      d.allocatedTotal = d.allocatedTotal ?? round2((d.allocations || []).reduce((t, x) => t + x.amount, 0));
      d.unallocated = d.unallocated ?? round2(d.amount - d.allocatedTotal);
      d.creditFcy = d.creditFcy || 0;
      fill(d, 'TRADE', d.purposeCode, 0, { option: d.option });
      d.declarations = d.declarations || seedStamp(d.submittedAt);
      const i = find(db.inward, d.inwardId) || {};
      d.risk = d.risk || riskScore(db, { usd: usdEq(db, d.amount, d.currency), purpose: d.purposeCode, deal: d.rate.mode === 'deal',
        countries: [i.remitterCountry], names: [i.remitter], first: false, files: [] });
      if (d.status === 'Processed' && !d.fircUfi) d.fircUfi = ufiReport(db, d.wf.processed.at, 'Export', 'FIRC / realisation');
    });
    db.inward.forEach(i => { if (i.firc && !i.fircs) i.fircs = [i.firc]; });
    db.allocations.slice().reverse().forEach(l => {
      if (l.status !== 'Confirmed' || l.ufi) return;
      l.ufi = ufiReport(db, l.at, l.side, 'knock-off');
      const b = find(db.bills, l.billId); if (b) (b.ufi = b.ufi || []).push(l.ufi.ref);
    });
    db.smes.forEach(s => {
      s.pendingWith = smePendingWith(s.status);
      if (!s.docs) { s.docs = {}; (db.onboardDocs || []).forEach(d => { s.docs[d.id] = { filename: `${s.id}-${d.id}.pdf`, size: '210 KB', type: 'application/pdf', at: s.submittedAt }; }); }
    });
    /* Ready-to-use test businesses, each with its own accounts, bills and
       receipts, so every journey can be tried on more than one business. */
    (db.testSmes || []).forEach(prof => labCreateSme(db, prof, 'approved', now));
    /* The treasury book behind the seeded payments and disposals. */
    T.seed(db, now);
    /* The Treasury Management Portal: branches, rate desk, FX Plus bills,
       liquidity, limits and approvals, around the same book. */
    X.seed(db, now);
    return db;
  }
  const smePendingWith = st => ({ 'Submitted': 'AD2 Maker', 'Under Review': 'AD2 Maker', 'Pending Approval': 'AD2 Compliance',
                                  'Clarification Required': 'SME', 'Approved': '—', 'Rejected': '—' }[st] || '—');

  /* ======================================================================== */
  /*  Commands                                                                */
  /* ======================================================================== */
  const C = {};
  /* Treasury: the position book (treasury.js), and the Treasury Management
     Portal around it (tmp-engine.js). They share these helpers and the
     hooks the book calls when trade reaches treasury. */
  const E = { C, EngineError, fail, need, forbid, missing, txt, amount, date, oneOf, bool, round2, addHours, clone,
    find, smeOf, currencyOf, marginFor, customerRate, can, requireCap, isAD2, actorKey, actorLabel, stamp, distinct, audit, notify,
    seq, fmt, inr, ownSme, requireApproved, hooks: {} };
  const T = installTreasury(E);
  const X = installTmp(E, T, E.hooks);

  /* ---------- onboarding -------------------------------------------------- */
  function readApplication(db, app) {
    app = app || {};
    const out = {
      legalName: txt(app.legalName, 'Legal name', { max: 150 }),
      tradingName: txt(app.tradingName, 'Trading name', { max: 100, required: false }),
      constitution: oneOf(app.constitution, db.constitutions, 'Constitution'),
      incorporationDate: date(app.incorporationDate, 'Incorporation date'),
      regNumber: txt(app.regNumber, 'Registration number', { max: 40 }),
      country: txt(app.country || 'India', 'Country', { max: 60 }),
      address: txt(app.address, 'Registered address', { max: 400 }),
      domainId: txt(String(app.domainId || '').toUpperCase(), 'Domain ID', { max: 12, pattern: /^[A-Z0-9]{3,12}$/,
        patternMsg: 'Domain ID must be 3–12 capital letters or digits.' }),
      ad2Name: 'AD2 Trade Services', category: 'SME',
      pan: txt(String(app.pan || '').toUpperCase(), 'PAN', { max: 10, pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
        patternMsg: 'PAN must look like AAAAA9999A.' }),
      gstin: txt(String(app.gstin || '').toUpperCase(), 'GSTIN', { max: 15, pattern: /^[0-9]{2}[A-Z0-9]{13}$/,
        patternMsg: 'GSTIN must be 15 characters starting with the two-digit state code.' }),
      iec: txt(String(app.iec || '').toUpperCase(), 'IEC', { max: 10, pattern: /^[A-Z0-9]{10}$/,
        patternMsg: 'IEC must be 10 letters or digits. It is mandatory for regular exporters and importers.' }),
      contactName: txt(app.contactName, 'Contact name', { max: 100 }),
      designation: txt(app.designation, 'Designation', { max: 80 }),
      email: txt(app.email, 'Email', { max: 120, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMsg: 'Enter a valid email address.' }),
      mobile: txt(app.mobile, 'Mobile number', { max: 20, pattern: /^\+?[0-9 \-]{8,20}$/, patternMsg: 'Enter a valid mobile number.' }),
      industry: txt(app.industry, 'Industry', { max: 100 }),
      description: txt(app.description, 'Business description', { max: 1000 }),
      expectedVolume: txt(app.expectedVolume, 'Expected annual volume', { max: 60 }),
      service: oneOf(app.service, ['Import', 'Export', 'Both'], 'Requested service'),
    };
    const curs = Array.isArray(app.requestedCurrencies) ? app.requestedCurrencies.filter(c => currencyCodes(db).includes(c)) : [];
    need(curs.length, 'Request at least one currency.');
    out.requestedCurrencies = [...new Set(curs)];
    const banks = Array.isArray(app.banks) ? app.banks.slice(0, 6) : [];
    need(banks.length, 'Add at least one bank account.');
    out.banks = banks.map((b, i) => ({
      bank: txt(b.bank, `Bank ${i + 1} name`, { max: 80 }),
      branch: txt(b.branch, `Bank ${i + 1} branch`, { max: 80, required: false }),
      accountNumber: txt(b.accountNumber, `Bank ${i + 1} account number`, { max: 34, pattern: /^[A-Za-z0-9\-]{6,34}$/ }),
      ifsc: txt(String(b.ifsc || '').toUpperCase(), `Bank ${i + 1} IFSC`, { max: 11, pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/,
        patternMsg: `Bank ${i + 1} IFSC must look like HDFC0001234.` }),
      currency: oneOf(b.currency || 'INR', ['INR', ...currencyCodes(db)], `Bank ${i + 1} currency`),
      type: oneOf(b.type || 'Current', ['Current', 'EEFC', 'Savings'], `Bank ${i + 1} account type`),
      verified: bool(b.verified),
    }));
    out.docs = docsIn(app.docs, (db.onboardDocs || []).map(d => d.id));
    const miss = (db.onboardDocs || []).filter(d => d.required && !out.docs[d.id]).map(d => d.name);
    need(!miss.length, 'Upload the required documents: ' + miss.join(', ') + '.', miss);
    return out;
  }

  C['onboarding.submit'] = {
    public: true,
    run(db, a, p, ctx) {
      const offline = !!a;
      if (offline) requireCap(db, a, 'onboard.createOffline');
      const app = readApplication(db, p.application);
      const taken = db.smes.some(s => s.domainId === app.domainId) || db.logins.some(l => l.domainId === app.domainId) || app.domainId === 'AD2';
      need(!taken, `Domain ID ${app.domainId} is already in use. Choose another.`);
      const loginId = txt(String(p.loginId || 'ADMIN').toUpperCase(), 'Login ID', { max: 20, pattern: /^[A-Z0-9]{3,20}$/,
        patternMsg: 'Login ID must be 3–20 capital letters or digits.' });
      let pw = null;
      if (!offline && ctx.hashPassword) {
        const raw = String(p.password || '');
        need(raw.length >= 8 && raw.length <= 72, 'Choose a password of at least 8 characters.');
        need(/[A-Za-z]/.test(raw) && /[0-9]/.test(raw), 'Use at least one letter and one digit in the password.');
        pw = ctx.hashPassword(raw);
      }
      const id = nextId(db.smes, 'SME');
      const { banks, ...rest } = app;
      /* A PAN or GSTIN already on the platform is flagged for the maker, not
         blocked: a rejected business may apply again. */
      const dupFlags = db.smes.filter(x => x.pan === app.pan || x.gstin === app.gstin)
        .map(x => `${x.pan === app.pan ? 'PAN' : 'GSTIN'} matches ${x.id} — ${x.tradingName || x.legalName} (${x.status})`);
      db.smes.push({ ...rest, id, source: offline ? 'Offline' : 'Digital',
        createdBy: offline ? actorLabel(a) : 'SME Applicant', status: 'Submitted', pendingWith: 'AD2 Maker',
        submittedAt: ctx.now, approvedAt: null, config: null, ...(dupFlags.length ? { dupFlags } : {}) });
      if (dupFlags.length) audit(db, null, ctx.now, id, 'Duplicate check — ' + dupFlags.join('; '), true);
      banks.forEach((b, i) => db.accounts.push({ id: nextId(db.accounts, 'BA', 3), smeId: id, holder: app.legalName, ...b,
        verifiedOn: b.verified ? ctx.now : null, primary: i === 0, balance: b.currency === 'INR' ? 25000000 : 50000 }));
      db.logins.push({ domainId: app.domainId, loginId, role: 'SME Applicant', smeId: id, name: app.contactName,
        demo: !pw, ...(pw ? { pw } : {}) });
      audit(db, a, ctx.now, id, offline ? 'Offline application captured by AD2' : 'Application submitted through digital onboarding');
      notify(db, ctx.now, { toRole: 'AD2 Maker', text: `New ${offline ? 'offline' : 'digital'} application ${id} — ${app.legalName}`, link: '#/ad2/applications/' + id });
      return { smeId: id, domainId: app.domainId, loginId, demo: !pw, message: `Application ${id} submitted.` };
    },
  };

  function readConfig(db, s, c) {
    c = c || {};
    const permission = oneOf(c.permission, ['Import', 'Export', 'Both'], 'Service permission');
    const currencies = [...new Set((Array.isArray(c.currencies) ? c.currencies : []).filter(x => currencyCodes(db).includes(x)))];
    const margins = {};
    Object.keys(c.margins || {}).forEach(k => {
      if (!currencyCodes(db).includes(k)) return;
      const v = c.margins[k];
      if (v === null || v === '' || v === undefined) return;
      const n = Number(v);
      if (!isFinite(n) || n < 0 || n > 500) fail(`Margin for ${k} must be between 0 and 500 paise.`);
      margins[k] = Math.round(n);
    });
    const charges = (Array.isArray(c.charges) ? c.charges : []).slice(0, 10).map(ch => {
      const v = Number(ch.value);
      if (!isFinite(v) || v < 0) fail('Each charge needs a value, zero or more.');
      const basis = oneOf(ch.basis, ['Fixed', 'Percentage'], 'Charge basis');
      if (basis === 'Percentage' && v > 5) fail('A percentage charge cannot exceed 5%.');
      const cat = (db.chargeCategories || []).find(x => x.name === ch.name);
      if (!cat) fail('Choose a charge from the charge master.');
      return { category: cat.id, name: cat.name, basis, value: round2(v),
               currency: oneOf(ch.currency || 'INR', ['INR', ...currencyCodes(db)], 'Charge currency'),
               frequency: oneOf(ch.frequency || 'Per transaction', ['Per transaction', 'Per document set', 'Monthly'], 'Charge frequency') };
    });
    const errs = [];
    if (!currencies.length) errs.push('at least one enabled currency');
    currencies.forEach(x => { if (margins[x] == null && margins.USD == null) errs.push('margin for ' + x); });
    const effectiveDate = date(c.effectiveDate, 'Effective date', false);
    if (!effectiveDate) errs.push('effective date');
    if (!s.iec) errs.push('IEC on the application (raise a clarification to collect it)');
    return { cfg: { permission, currencies, margins, marginBasis: 'paise', charges, effectiveDate,
                    remarks: txt(c.remarks, 'Remarks', { max: 500, required: false }) }, errs };
  }

  function commitApproval(db, s, a, now, cfg, via) {
    s.config = cfg;
    delete s.pendingConfig;
    s.status = 'Approved'; s.pendingWith = '—';
    s.approvedAt = now;
    s.approvedBy = stamp(a, now, 'approved');
    db.logins.filter(l => l.smeId === s.id && l.role === 'SME Applicant').forEach(l => { l.role = 'SME User'; });
    audit(db, a, now, s.id, `Application approved${via ? ' ' + via : ''} — ${cfg.permission}, ${cfg.currencies.join('/')}, effective ${cfg.effectiveDate}`);
    notify(db, now, { toSmeId: s.id, text: `Your application ${s.id} is approved. Trade services are now open.`, link: '#/sme/dashboard' });
  }

  C['onboarding.review'] = {
    cap: 'onboard.review',
    run(db, a, p, ctx) {
      const s = smeOf(db, p.smeId) || missing('Application');
      need(['Submitted', 'Under Review'].includes(s.status), `This application is ${s.status.toLowerCase()} and cannot be reviewed now.`);
      const { cfg, errs } = readConfig(db, s, p.config);
      s.pendingConfig = cfg;
      if (!bool(p.submit)) {
        s.status = 'Under Review'; s.pendingWith = 'AD2 Maker';
        audit(db, a, ctx.now, s.id, 'Review saved');
        return { message: 'Review saved.' };
      }
      need(!errs.length, 'Complete the review before sending it on: ' + errs.join('; ') + '.', errs);
      s.reviewedBy = stamp(a, ctx.now, 'reviewed');
      if (db.settings.autoChecker) {
        commitApproval(db, s, a, ctx.now, cfg, 'by AutoChecker');
        return { message: 'Approved under AutoChecker. The SME can transact now.', approved: true };
      }
      s.status = 'Pending Approval'; s.pendingWith = 'AD2 Compliance';
      audit(db, a, ctx.now, s.id, `Review complete — sent to compliance with ${cfg.permission} permission, ${cfg.currencies.join('/')}`);
      audit(db, a, ctx.now, s.id, `Pricing prepared — ${cfg.currencies.map(c => `${c} ${cfg.margins[c] != null ? cfg.margins[c] : marginFor(db, { config: cfg }, c)}p`).join(', ')}; ${cfg.charges.length ? cfg.charges.length + ' charge(s)' : 'no charges'}`, true);
      notify(db, ctx.now, { toRole: 'AD2 Compliance', text: `Application ${s.id} (${s.legalName}) is ready for approval`, link: '#/ad2/applications/' + s.id });
      return { message: 'Sent to AD2 Compliance for approval.' };
    },
  };

  C['onboarding.approve'] = {
    cap: 'onboard.approve',
    run(db, a, p, ctx) {
      const s = smeOf(db, p.smeId) || missing('Application');
      need(s.status === 'Pending Approval', 'Only an application the maker has sent for approval can be approved.');
      distinct(a, [s.reviewedBy], 'application');
      const { cfg, errs } = readConfig(db, s, s.pendingConfig);
      need(!errs.length, 'The prepared configuration is incomplete: ' + errs.join('; '), errs);
      commitApproval(db, s, a, ctx.now, cfg, '');
      return { message: `${s.tradingName || s.legalName} approved. The SME portal now reflects this pricing.` };
    },
  };

  C['onboarding.return'] = {
    cap: 'onboard.approve',
    run(db, a, p, ctx) {
      const s = smeOf(db, p.smeId) || missing('Application');
      need(s.status === 'Pending Approval', 'Only an application awaiting approval can be returned.');
      const note = txt(p.note, 'Reason for returning', { max: 500 });
      s.status = 'Under Review'; s.pendingWith = 'AD2 Maker';
      audit(db, a, ctx.now, s.id, 'Returned to maker: ' + note);
      notify(db, ctx.now, { toRole: 'AD2 Maker', text: `Application ${s.id} returned by compliance: ${note}`, link: '#/ad2/applications/' + s.id });
      return { message: 'Returned to the maker.' };
    },
  };

  C['onboarding.clarify'] = {
    cap: 'onboard.query',
    run(db, a, p, ctx) {
      const s = smeOf(db, p.smeId) || missing('Application');
      need(['Submitted', 'Under Review', 'Pending Approval'].includes(s.status), 'This application is not open for queries.');
      const q = txt(p.question, 'Clarification', { max: 500 });
      s.status = 'Clarification Required'; s.pendingWith = 'SME';
      s.query = { question: q, raisedBy: actorLabel(a), raisedAt: ctx.now, response: null };
      audit(db, a, ctx.now, s.id, 'Clarification requested: ' + q);
      notify(db, ctx.now, { toSmeId: s.id, text: `AD2 needs more information on application ${s.id}`, link: '#/sme/dashboard' });
      return { message: 'Clarification sent to the applicant.' };
    },
  };

  C['onboarding.respond'] = {
    cap: 'onboard.apply',
    run(db, a, p, ctx) {
      const s = ownSme(db, a);
      need(s.status === 'Clarification Required', 'There is no open query on this application.');
      const r = txt(p.response, 'Response', { max: 1000 });
      if (p.iec) s.iec = txt(String(p.iec).toUpperCase(), 'IEC', { max: 10, pattern: /^[A-Z0-9]{10}$/, patternMsg: 'IEC must be 10 letters or digits.' });
      Object.assign(s.docs = s.docs || {}, docsIn(p.docs, (db.onboardDocs || []).map(d => d.id)));
      s.query = { ...(s.query || {}), response: r, respondedAt: ctx.now };
      s.status = 'Submitted'; s.pendingWith = 'AD2 Maker';
      audit(db, a, ctx.now, s.id, 'Applicant responded to clarification' + (p.iec ? ' and supplied IEC' : ''));
      notify(db, ctx.now, { toRole: 'AD2 Maker', text: `Applicant responded on ${s.id}`, link: '#/ad2/applications/' + s.id });
      return { message: 'Response sent. AD2 will continue the review.' };
    },
  };

  C['onboarding.reject'] = {
    cap: 'onboard.approve',
    run(db, a, p, ctx) {
      const s = smeOf(db, p.smeId) || missing('Application');
      need(!['Approved', 'Rejected'].includes(s.status), 'This application is already closed.');
      const r = txt(p.reason, 'Reason for rejection', { max: 500 });
      s.status = 'Rejected'; s.pendingWith = '—'; s.rejectReason = r;
      audit(db, a, ctx.now, s.id, 'Application rejected: ' + r);
      notify(db, ctx.now, { toSmeId: s.id, text: `Application ${s.id} was not approved.`, link: '#/sme/dashboard' });
      return { message: 'Application rejected.' };
    },
  };

  /* ---------- masters: beneficiaries and accounts ------------------------ */
  function readBeneficiary(db, v) {
    v = v || {};
    return {
      name: txt(v.name, 'Beneficiary name', { max: 120 }),
      country: txt(v.country, 'Beneficiary country', { max: 60 }),
      bank: txt(v.bank, 'Bank name', { max: 100 }),
      bankCountry: txt(v.bankCountry, 'Bank country', { max: 60 }),
      accountNumber: txt(String(v.accountNumber || '').replace(/\s+/g, ''), 'Account number / IBAN', { max: 34, pattern: /^[A-Za-z0-9\-]{5,34}$/,
        patternMsg: 'Account number / IBAN should be 5–34 letters or digits.' }),
      swift: txt(String(v.swift || '').toUpperCase().replace(/\s+/g, ''), 'SWIFT / BIC', { max: 11, pattern: SWIFT_RE,
        patternMsg: 'SWIFT / BIC must be 8 or 11 characters, e.g. BARCGB22.' }),
      currency: v.currency ? oneOf(v.currency, currencyCodes(db), 'Account currency') : '',
      relationship: txt(v.relationship, 'Relationship', { max: 120, required: false }),
      address: txt(v.address, 'Address', { max: 200, required: false }),
    };
  }

  C['beneficiary.add'] = {
    cap: 'masters.beneficiary',
    run(db, a, p, ctx) {
      const s = ownSme(db, a); requireApproved(s);
      const v = readBeneficiary(db, p.beneficiary);
      need(!db.beneficiaries.some(b => b.smeId === s.id && b.accountNumber === v.accountNumber && b.swift === v.swift),
        'This beneficiary account is already in your master.');
      const id = nextId(db.beneficiaries, 'BEN', 3);
      db.beneficiaries.push({ id, smeId: s.id, ...v, addedBy: actorLabel(a) + (a.actingFor ? ' (assisted)' : ''), addedOn: ctx.now, lastUsed: null });
      audit(db, a, ctx.now, s.id, `Beneficiary ${v.name} added to the master`);
      return { id, message: 'Beneficiary added.' };
    },
  };
  C['beneficiary.remove'] = {
    cap: 'masters.beneficiary',
    run(db, a, p, ctx) {
      const s = ownSme(db, a);
      const b = find(db.beneficiaries, p.id);
      if (!b || b.smeId !== s.id) missing('Beneficiary');
      db.beneficiaries = db.beneficiaries.filter(x => x.id !== b.id);
      audit(db, a, ctx.now, s.id, `Beneficiary ${b.name} removed from the master`);
      return { message: 'Beneficiary removed.' };
    },
  };
  C['account.add'] = {
    cap: 'masters.beneficiary',
    run(db, a, p, ctx) {
      const s = ownSme(db, a);
      const v = p.account || {};
      const rec = {
        id: nextId(db.accounts, 'BA', 3), smeId: s.id, holder: s.legalName,
        bank: txt(v.bank, 'Bank name', { max: 80 }),
        branch: txt(v.branch, 'Branch', { max: 80, required: false }),
        accountNumber: txt(v.accountNumber, 'Account number', { max: 34, pattern: /^[A-Za-z0-9\-]{6,34}$/ }),
        ifsc: txt(String(v.ifsc || '').toUpperCase(), 'IFSC', { max: 11, pattern: /^[A-Z]{4}0[A-Z0-9]{6}$/, patternMsg: 'IFSC must look like HDFC0001234.' }),
        currency: oneOf(v.currency || 'INR', ['INR', ...currencyCodes(db)], 'Currency'),
        type: oneOf(v.type || 'Current', ['Current', 'EEFC', 'Savings'], 'Account type'),
        verified: false, verifiedOn: null, primary: false, balance: 0,
      };
      need(!db.accounts.some(x => x.smeId === s.id && x.accountNumber === rec.accountNumber), 'This account is already in your master.');
      db.accounts.push(rec);
      audit(db, a, ctx.now, s.id, `Bank account ${rec.bank} ${rec.accountNumber.slice(-4).padStart(8, '•')} added — verification pending`);
      return { id: rec.id, message: 'Account added. Verify it before using it on a transaction.' };
    },
  };
  C['account.verify'] = {
    cap: 'masters.beneficiary',
    run(db, a, p, ctx) {
      const s = ownSme(db, a);
      const acc = find(db.accounts, p.id);
      if (!acc || acc.smeId !== s.id) missing('Account');
      acc.verified = true; acc.verifiedOn = ctx.now;
      audit(db, a, ctx.now, s.id, `PennyDrop verification passed for ${acc.bank} ${acc.accountNumber.slice(-4).padStart(8, '•')}`);
      return { message: 'PennyDrop verified — ₹1.00 credited and name matched (simulated).' };
    },
  };

  /* ---------- outward remittance ------------------------------------------ */
  function readOutward(db, a, s, d, now, forDraft) {
    d = d || {};
    const out = {};
    const g = (k, label, opts) => (out[k] = txt(d[k], label, { required: !forDraft, ...opts }));
    g('beneficiary', 'Beneficiary', { max: 120 });
    g('beneficiaryCountry', 'Beneficiary country', { max: 60 });
    g('beneficiaryBank', 'Beneficiary bank', { max: 100 });
    g('beneficiaryBankCountry', 'Bank country', { max: 60 });
    out.beneficiaryAccount = txt(String(d.beneficiaryAccount || '').replace(/\s+/g, ''), 'Account number / IBAN', { max: 34, required: !forDraft });
    out.swift = txt(String(d.swift || '').toUpperCase(), 'SWIFT / BIC', { max: 11, required: !forDraft,
      pattern: forDraft ? undefined : SWIFT_RE, patternMsg: 'SWIFT / BIC must be 8 or 11 characters.' });
    out.beneficiaryId = d.beneficiaryId && find(db.beneficiaries, d.beneficiaryId) && find(db.beneficiaries, d.beneficiaryId).smeId === s.id ? d.beneficiaryId : '';
    out.referenceNumber = txt(d.referenceNumber, 'Reference number', { max: 40, required: false });
    out.executionDate = date(d.executionDate, 'Requested execution date', !forDraft);
    out.remittanceType = d.remittanceType ? oneOf(d.remittanceType, db.products.filter(p => p.direction === 'outward').map(p => p.id), 'Product') : '';
    out.purposeCode = d.purposeCode ? String(d.purposeCode) : '';
    out.currency = d.currency ? oneOf(d.currency, currencyCodes(db), 'Currency') : '';
    out.amount = forDraft ? (Number(d.amount) > 0 ? round2(Number(d.amount)) : 0) : amount(d.amount, 'Amount');
    out.debitAccountId = d.debitAccountId || '';
    out.lcNumber = txt(d.lcNumber, 'LC number', { max: 30, required: false });
    if (forDraft) {
      out.docs = docsIn(d.docs);
      return out;
    }
    need(out.remittanceType, 'Select a product (AIR, DIR, OTT or LC).');
    if (out.remittanceType === 'LC') need(out.lcNumber, 'Enter the letter of credit number for an LC settlement.');
    const dec = d.declarations || {};
    need(bool(dec.fema) && bool(dec.ofac), 'Accept the FEMA and sanctions (OFAC) declarations before submitting.');
    out.declarations = { fema: true, ofac: true, at: now };
    need(purposesFor(db, out.remittanceType).some(p => p.code === out.purposeCode),
      `Purpose code ${out.purposeCode || '(none)'} is not available under ${out.remittanceType}.`);
    need(out.currency, 'Select a currency.');
    if (!(a.actingFor && isAD2(a))) need(((s.config || {}).currencies || []).includes(out.currency), `${out.currency} is not enabled for ${s.tradingName}.`);
    need(out.executionDate >= now.slice(0, 10), 'The execution date cannot be in the past.');
    const acc = find(db.accounts, out.debitAccountId);
    need(acc && acc.smeId === s.id, 'Select a remitter account from your account master.');
    need(acc.verified, `Account ${acc.accountNumber} is not verified yet. Verify it with PennyDrop first.`);
    need(acc.currency === 'INR', 'Outward payments debit an INR account. Choose an INR account.');
    return out;
  }

  function finishOutward(db, a, s, o, d, now, excludeId) {
    const prod = productOf(db, o.remittanceType);
    const rr = T.resolveRate(db, a, s, o.currency, 'out', o.amount, d.rate, now);
    o.rate = rr.rate;
    const inrAmt = round2(o.amount * o.rate.customerRate);
    const list = checklist(db, o.remittanceType, o.purposeCode, inrAmt);
    o.docs = docsIn(d.docs, list.map(x => x.id));
    const missingDocs = list.filter(x => x.required && !o.docs[x.id]).map(x => x.name);
    need(!missingDocs.length, 'Upload the required documents: ' + missingDocs.join(', ') + '.', missingDocs);
    if (prod.bills === 'none') {
      o.allocations = [];
    } else {
      const { list: al, total } = allocationsIn(db, s, d.allocations, { type: 'Import', currency: o.currency, cap: o.amount, exclude: excludeId, label: 'Bill allocations' });
      if (prod.bills === 'required' && !db.settings.allowUnlinked) need(al.length, `${prod.id} payments settle a lodged import bill. Allocate at least one accepted import bill.`);
      if (al.length) need(Math.abs(total - o.amount) < 0.005, `The bills add up to ${fmt(total, o.currency)} but the amount is ${fmt(o.amount, o.currency)}. When bills are chosen, the amount must equal their total.`);
      o.allocations = al;
      o.allocatedTotal = total;
    }
    o.inrAmount = inrAmt;
    o.charges = chargesFor(s, o.amount, o.rate.customerRate);
    o.debitInr = round2(inrAmt + o.charges.reduce((t, c) => t + c.amount, 0));
    o.risk = riskScore(db, {
      usd: usdEq(db, o.amount, o.currency), purpose: o.purposeCode, deal: o.rate.mode === 'deal',
      countries: [o.beneficiaryCountry, o.beneficiaryBankCountry], names: [o.beneficiary, o.beneficiaryBank],
      beneCountry: o.beneficiaryCountry, bankCountry: o.beneficiaryBankCountry,
      newBene: !db.outward.some(x => x.id !== o.id && x.smeId === s.id && x.status === 'Completed' && x.beneficiaryAccount === o.beneficiaryAccount),
      first: !db.outward.some(x => x.id !== o.id && x.smeId === s.id && x.status === 'Completed'),
      files: Object.values(o.docs).map(f => f.filename),
    });
    T.attach(db, a, rr, 'outward', o.id, o.amount, now);
  }

  /* A High risk score needs a written reason at each approval stage. */
  function riskNote(rec, p, stage) {
    const note = txt(p.note, 'Note', { max: 500, required: false });
    if (rec.risk && rec.risk.level === 'High') need(note, `Risk score is High (${rec.risk.score}). Record your reason for ${stage} it.`);
    return note;
  }

  C['outward.saveDraft'] = {
    cap: 'outward.create',
    run(db, a, p, ctx) {
      const s = ownSme(db, a); requireApproved(s);
      need(perm(s).importSide, 'Outward remittance is not enabled for this SME.');
      const d = p.draft || {};
      const v = readOutward(db, a, s, d, ctx.now, true);
      let o = d.id && find(db.outward, d.id);
      if (o) { need(o.smeId === s.id && o.status === 'Draft', 'Only your own drafts can be updated.'); Object.assign(o, v); }
      else {
        o = { id: nextId(db.outward, 'OR'), smeId: s.id, ...v, status: 'Draft', pendingWith: 'SME', requestDate: ctx.now,
              rate: { mode: 'none' }, charges: [], allocations: [], createdBy: a.name || a.role, createdByKey: actorKey(a),
              source: a.actingFor ? 'AD2 Assisted' : 'SME' };
        db.outward.unshift(o);
        audit(db, a, ctx.now, o.id, 'Draft saved');
      }
      /* A saved draft keeps its rate booking, so continuing it later does not
         leave the booking behind. */
      const bk = d.rate && d.rate.mode === 'booked' && d.rate.positionId && find(db.positions, d.rate.positionId);
      o.rate = bk && bk.smeId === s.id && bk.source === 'Booked' && T.positionStatus(bk, ctx.now) === 'Open'
        ? { mode: 'booked', positionId: bk.id, refRate: bk.refRate, margin: bk.margin, customerRate: bk.customerRate,
            bookedAt: bk.bookedAt, expiresAt: bk.expiresAt, dealRef: null, bookedAmount: bk.amount }
        : { mode: 'none' };
      return { id: o.id, message: `Draft ${o.id} saved.` };
    },
  };

  C['outward.discardDraft'] = {
    cap: 'outward.create',
    run(db, a, p, ctx) {
      const s = ownSme(db, a);
      const o = find(db.outward, p.id);
      if (!o || o.smeId !== s.id) missing('Draft');
      need(o.status === 'Draft', 'Only a draft can be discarded.');
      T.release(db, a, o, 'Draft discarded', ctx.now);
      db.outward = db.outward.filter(x => x.id !== o.id);
      audit(db, a, ctx.now, o.id, 'Draft discarded');
      return { message: 'Draft discarded.' };
    },
  };

  C['outward.submit'] = {
    cap: 'outward.create',
    run(db, a, p, ctx) {
      const s = ownSme(db, a); requireApproved(s);
      need(perm(s).importSide, 'Outward remittance requires Import or Both permission.');
      const d = p.draft || {};
      const existing = d.id ? find(db.outward, d.id) : null;
      if (existing) need(existing.smeId === s.id && existing.status === 'Draft', 'This request has already been submitted.');
      const v = readOutward(db, a, s, d, ctx.now, false);
      const o = existing || { id: nextId(db.outward, 'OR') };
      Object.assign(o, v, { smeId: s.id });
      finishOutward(db, a, s, o, d, ctx.now, o.id);
      Object.assign(o, { status: 'Submitted', pendingWith: 'AD2 Maker', requestDate: ctx.now,
        source: a.actingFor ? 'AD2 Assisted' : 'SME', createdBy: a.name || a.role, createdByKey: actorKey(a),
        wf: { submitted: stamp(a, ctx.now, 'submitted') } });
      delete o.query; delete o.rejectReason;
      if (!existing) db.outward.unshift(o);
      const b = find(db.beneficiaries, o.beneficiaryId); if (b) b.lastUsed = ctx.now;
      const prod = productOf(db, o.remittanceType);
      audit(db, a, ctx.now, o.id, `Outward request submitted — ${fmt(o.amount, o.currency)}, ${prod.id} (${prod.label}) under ${o.purposeCode}${o.lcNumber ? ', LC ' + o.lcNumber : ''}`);
      audit(db, a, ctx.now, o.id, `Compliance check — risk ${o.risk.level} (${o.risk.score})${o.risk.flags.length ? ': ' + o.risk.flags.map(f => f.label).join(', ') : ''}`, true);
      if (o.rate.margin !== marginFor(db, s, o.currency)) audit(db, a, ctx.now, o.id, `Margin set to ${o.rate.margin} paise by ${a.name || a.role} within the branch band`, true);
      audit(db, a, ctx.now, o.id, o.rate.mode === 'booked'
        ? `Booked rate ${o.rate.customerRate.toFixed(4)} applied — treasury position ${o.rate.positionId}`
        : `FX deal ${o.rate.dealRef} applied at ${o.rate.customerRate.toFixed(4)} — treasury position ${o.rate.positionId}`);
      notify(db, ctx.now, { toRole: 'AD2 Maker', text: `Outward ${o.id} from ${s.tradingName} — ${fmt(o.amount, o.currency)} to verify`, link: '#/ad2/outward/' + o.id });
      return { id: o.id, message: `Outward request ${o.id} submitted. It is now with the AD2 maker.` };
    },
  };

  const outwardFor = (db, id) => find(db.outward, id) || missing('Outward request');

  C['outward.verify'] = {
    cap: 'outward.verify',
    run(db, a, p, ctx) {
      const o = outwardFor(db, p.id);
      need(o.status === 'Submitted', `This request is ${o.status.toLowerCase()} — only a submitted request can be verified.`);
      const checks = p.checks || {};
      const req = ['documents', 'sanctions', 'purpose', 'beneficiary'];
      const notDone = req.filter(k => !bool(checks[k]));
      need(!notDone.length, 'Complete every verification check before verifying.', notDone);
      distinct(a, [{ key: o.createdByKey, verb: 'raised' }], 'request');
      o.wf = o.wf || {};
      o.wf.verified = { ...stamp(a, ctx.now, 'verified'), note: riskNote(o, p, 'verifying') };
      o.status = 'Verified'; o.pendingWith = 'AD2 Checker';
      audit(db, a, ctx.now, o.id, 'Verified — documents, sanctions screening, purpose code and beneficiary checked');
      if (o.wf.verified.note) audit(db, a, ctx.now, o.id, 'Maker note: ' + o.wf.verified.note, true);
      notify(db, ctx.now, { toRole: 'AD2 Checker', text: `Outward ${o.id} verified — ready to authorise`, link: '#/ad2/outward/' + o.id });
      return { message: `${o.id} verified and passed to the checker.` };
    },
  };

  C['outward.authorise'] = {
    cap: 'outward.approve',
    run(db, a, p, ctx) {
      const o = outwardFor(db, p.id);
      need(o.status === 'Verified', 'Only a verified request can be authorised.');
      distinct(a, [{ key: o.createdByKey, verb: 'raised' }, o.wf && o.wf.verified], 'request');
      o.wf.authorised = { ...stamp(a, ctx.now, 'authorised'), note: riskNote(o, p, 'authorising') };
      o.status = 'Authorised'; o.pendingWith = 'AD2 Operations';
      audit(db, a, ctx.now, o.id, 'Authorised for payment');
      if (o.wf.authorised.note) audit(db, a, ctx.now, o.id, 'Checker note: ' + o.wf.authorised.note, true);
      notify(db, ctx.now, { toRole: 'AD2 Operations', text: `Outward ${o.id} authorised — release the payment`, link: '#/ad2/outward/' + o.id });
      notify(db, ctx.now, { toSmeId: o.smeId, text: `Your payment ${o.id} is authorised and queued for release`, link: '#/sme/outward/' + o.id });
      return { message: `${o.id} authorised. Operations can now release it.` };
    },
  };

  C['outward.execute'] = {
    cap: 'outward.complete',
    run(db, a, p, ctx) {
      const o = outwardFor(db, p.id);
      need(o.status === 'Authorised', 'Only an authorised request can be executed.');
      distinct(a, [{ key: o.createdByKey, verb: 'raised' }, o.wf.verified, o.wf.authorised], 'request');
      const acc = find(db.accounts, o.debitAccountId);
      need(acc, 'The remitter account no longer exists.');
      const debit = o.debitInr != null ? o.debitInr
        : round2(o.amount * (o.rate.customerRate || 0) + (o.charges || []).reduce((t, c) => t + c.amount, 0));
      if ((acc.balance ?? Infinity) < debit)
        fail(`Insufficient funds in ${acc.bank} ${acc.accountNumber}: needs ${inr(debit)}, available ${inr(acc.balance)}.`);
      if (acc.balance != null) acc.balance = round2(acc.balance - debit);
      const n = seq(db, 'utr');
      const ymd = ctx.now.slice(2, 10).replace(/-/g, '');
      o.utr = `AD2O${ymd}${String(n).padStart(5, '0')}`;
      o.swiftRef = `MT103-AD2-${ymd}${String(n).padStart(4, '0')}`;
      o.debitInr = debit;
      o.wf.executed = stamp(a, ctx.now, 'executed');
      o.status = 'Completed'; o.pendingWith = '—';
      (o.allocations || []).forEach(x => {
        const b = find(db.bills, x.billId);
        if (!b) return;
        applyToBill(b, x.amount);
        confirmLedger(db, ctx.now, { smeId: o.smeId, side: 'Import', billId: b.id, remKind: 'outward', remId: o.id, ref: o.utr, amount: x.amount,
                                     currency: o.currency, source: 'Outward payment' });
      });
      if (o.remittanceType === 'AIR') o.boeDueDate = addDays(ctx.now, 90).slice(0, 10);
      T.link(db, a, o, o.utr, ctx.now);
      audit(db, a, ctx.now, o.id, `Payment released over SWIFT — UTR ${o.utr}, ${inr(debit)} debited from ${acc.bank} ${acc.accountNumber}`);
      notify(db, ctx.now, { toSmeId: o.smeId, text: `Payment ${o.id} sent — UTR ${o.utr}`, link: '#/sme/outward/' + o.id });
      return { utr: o.utr, message: `Payment released. UTR ${o.utr}.` };
    },
  };

  C['outward.query'] = {
    cap: 'outward.query',
    run(db, a, p, ctx) {
      const o = outwardFor(db, p.id);
      need(['Submitted', 'Verified'].includes(o.status), 'A query can be raised only before authorisation.');
      const q = txt(p.question, 'Query', { max: 500 });
      o.query = { question: q, raisedBy: actorLabel(a), raisedAt: ctx.now, response: null, stage: o.status };
      o.status = 'Clarification Required'; o.pendingWith = 'SME';
      if (o.wf) delete o.wf.verified;
      audit(db, a, ctx.now, o.id, 'Clarification requested: ' + q);
      notify(db, ctx.now, { toSmeId: o.smeId, text: `AD2 has a query on ${o.id}`, link: '#/sme/outward/' + o.id });
      return { message: 'Query sent to the SME.' };
    },
  };

  C['outward.respond'] = {
    cap: 'outward.create',
    run(db, a, p, ctx) {
      const s = ownSme(db, a);
      const o = outwardFor(db, p.id);
      need(o.smeId === s.id, 'This request belongs to another SME.');
      need(o.status === 'Clarification Required', 'There is no open query on this request.');
      const r = txt(p.response, 'Response', { max: 1000 });
      const list = checklist(db, o.remittanceType, o.purposeCode, o.inrAmount || o.amount * (o.rate.customerRate || 0));
      Object.assign(o.docs = o.docs || {}, docsIn(p.docs, list.map(x => x.id)));
      o.query.response = r; o.query.respondedAt = ctx.now;
      o.status = 'Submitted'; o.pendingWith = 'AD2 Maker';
      audit(db, a, ctx.now, o.id, 'SME responded to the query — back with the maker' + (p.docs && Object.keys(p.docs).length ? ' (documents updated)' : ''));
      notify(db, ctx.now, { toRole: 'AD2 Maker', text: `SME responded on ${o.id}`, link: '#/ad2/outward/' + o.id });
      return { message: 'Response sent. The request is back with AD2.' };
    },
  };

  /* AD2 answers a query on the customer's behalf, with what the customer
     handed in at the branch or sent by email. The record returns to the
     maker exactly as if the SME had answered it. */
  function resolvedBy(a) { return actorLabel(a) + ' on behalf of the SME'; }
  C['outward.resolveQuery'] = {
    cap: 'txn.resolveQuery',
    run(db, a, p, ctx) {
      const o = outwardFor(db, p.id);
      need(o.status === 'Clarification Required', 'There is no open query on this request.');
      const r = txt(p.response, 'The customer’s answer', { max: 1000 });
      const list = checklist(db, o.remittanceType, o.purposeCode, o.inrAmount || o.amount * (o.rate.customerRate || 0));
      const added = docsIn(p.docs, list.map(x => x.id));
      Object.assign(o.docs = o.docs || {}, added);
      o.query = { ...(o.query || {}), response: r, respondedAt: ctx.now, respondedBy: resolvedBy(a) };
      o.status = 'Submitted'; o.pendingWith = 'AD2 Maker';
      const n = Object.keys(added).length;
      audit(db, a, ctx.now, o.id, `Query answered on the customer’s behalf${n ? ` — ${n} document(s) received from the customer attached` : ''}; back with the maker`);
      notify(db, ctx.now, { toRole: 'AD2 Maker', text: `Query on ${o.id} answered by ${a.name || a.role} for the SME — verify again`, link: '#/ad2/outward/' + o.id });
      notify(db, ctx.now, { toSmeId: o.smeId, text: `AD2 recorded your answer to the query on ${o.id}`, link: '#/sme/outward/' + o.id });
      return { message: 'Answer recorded for the customer. The request is back with the maker to verify.' };
    },
  };

  C['outward.reject'] = {
    cap: 'outward.reject',
    run(db, a, p, ctx) {
      const o = outwardFor(db, p.id);
      need(OPEN.includes(o.status), 'This request can no longer be rejected.');
      const r = txt(p.reason, 'Reason for rejection', { max: 500 });
      o.status = 'Rejected'; o.pendingWith = '—'; o.rejectReason = r;
      o.wf = o.wf || {}; o.wf.rejected = stamp(a, ctx.now, 'rejected');
      T.release(db, a, o, 'Request rejected: ' + r, ctx.now);
      audit(db, a, ctx.now, o.id, 'Request rejected: ' + r);
      notify(db, ctx.now, { toSmeId: o.smeId, text: `Outward ${o.id} was rejected`, link: '#/sme/outward/' + o.id });
      return { message: 'Request rejected. Bill reservations are released.' };
    },
  };

  /* ---------- inward and disposal ------------------------------------------ */
  C['inward.record'] = {
    cap: 'inward.record',
    run(db, a, p, ctx) {
      const v = p.inward || {};
      const s = smeOf(db, v.smeId);
      need(s && s.status === 'Approved', 'Choose an approved SME.');
      need(perm(s).exportSide, `${s.tradingName} does not have Export permission, so it cannot receive trade proceeds here.`);
      const cur = oneOf(v.currency, currencyCodes(db), 'Currency');
      need(s.config.currencies.includes(cur), `${cur} is not enabled for ${s.tradingName}.`);
      const amt = amount(v.amount, 'Amount');
      const ref = v.reference ? txt(String(v.reference).toUpperCase(), 'SWIFT reference', { max: 30, pattern: /^[A-Z0-9\-]{6,30}$/ })
                              : `SWF-INW-${seq(db, 'inw')}`;
      need(!db.inward.some(i => i.reference === ref), `Reference ${ref} is already recorded.`);
      const id = nextId(db.inward, 'IR');
      const rec = { id, smeId: s.id, reference: ref, valueDate: date(v.valueDate || ctx.now.slice(0, 10), 'Value date'),
        remitter: txt(v.remitter, 'Remitter', { max: 120 }), remitterCountry: txt(v.remitterCountry, 'Remitter country', { max: 60 }),
        currency: cur, amount: amt, available: amt, status: 'Awaiting Instruction', remittanceType: 'TRADE', purposeCode: '',
        remarks: txt(v.remarks, 'Remarks', { max: 300, required: false }), firc: null, recordedBy: stamp(a, ctx.now, 'recorded') };
      db.inward.unshift(rec);
      E.onInwardCredit(db, rec, ctx.now);
      audit(db, a, ctx.now, id, `Inward SWIFT credit recorded — ${fmt(amt, cur)} from ${rec.remitter}, ${ref}`);
      notify(db, ctx.now, { toSmeId: s.id, text: `${fmt(amt, cur)} received from ${rec.remitter} — submit a disposal instruction`, link: '#/sme/inward/' + id });
      return { id, message: `Receipt ${ref} recorded for ${s.tradingName}.` };
    },
  };

  /* The SME (or AD2 for it) reports a payment its buyer has sent. Operations
     matches it to the credit in the nostro and confirms it — only then can
     it be disposed of. */
  C['inward.intimate'] = {
    cap: 'inward.dispose',
    run(db, a, p, ctx) {
      const s = ownSme(db, a); requireApproved(s);
      need(perm(s).exportSide, 'Inward remittance needs Export or Both permission.');
      const v = p.inward || {};
      const cur = oneOf(v.currency, currencyCodes(db), 'Currency');
      if (!(a.actingFor && isAD2(a))) need(((s.config || {}).currencies || []).includes(cur), `${cur} is not enabled for ${s.tradingName}.`);
      const amt = amount(v.amount, 'Amount');
      const ref = v.reference ? txt(String(v.reference).toUpperCase(), 'SWIFT / UTR reference', { max: 30, pattern: /^[A-Z0-9\-\/]{4,30}$/,
        patternMsg: 'The SWIFT or UTR reference should be 4–30 letters, digits or dashes.' }) : '';
      if (ref) need(!db.inward.some(i => i.reference === ref), `Reference ${ref} is already on the platform.`);
      const id = nextId(db.inward, 'IR');
      const rec = { id, smeId: s.id, reference: ref || `INT-${seq(db, 'inw')}`, valueDate: date(v.valueDate || ctx.now.slice(0, 10), 'Value date'),
        remitter: txt(v.remitter, 'Remitter (buyer)', { max: 120 }), remitterCountry: txt(v.remitterCountry, 'Remitter country', { max: 60 }),
        currency: cur, amount: amt, available: 0, status: 'Intimated', pendingWith: 'AD2 Operations', remittanceType: 'TRADE', purposeCode: '',
        remarks: txt(v.remarks, 'Remarks', { max: 300, required: false }), firc: null, docs: docsIn(p.docs, ['swiftcopy', 'invoice']),
        intimatedBy: stamp(a, ctx.now, 'reported'), source: a.actingFor ? 'AD2 Assisted' : 'SME' };
      db.inward.unshift(rec);
      audit(db, a, ctx.now, id, `Inward remittance reported — ${fmt(amt, cur)} from ${rec.remitter}${ref ? ', ' + ref : ''}; awaiting confirmation against the nostro credit`);
      notify(db, ctx.now, { toRole: 'AD2 Operations', text: `${s.tradingName} reports ${fmt(amt, cur)} from ${rec.remitter} — confirm the credit`, link: '#/ad2/inward/' + id });
      return { id, message: `Inward remittance ${id} reported. AD2 Operations confirms it against the credit received, then you can dispose of it.` };
    },
  };
  C['inward.confirm'] = {
    cap: 'inward.record',
    run(db, a, p, ctx) {
      const i = find(db.inward, p.id) || missing('Inward remittance');
      need(i.status === 'Intimated', 'Only a reported remittance waiting for confirmation can be confirmed.');
      const amt = p.amount != null && p.amount !== '' ? amount(p.amount, 'Amount credited') : i.amount;
      const ref = p.reference ? txt(String(p.reference).toUpperCase(), 'SWIFT reference', { max: 30, pattern: /^[A-Z0-9\-\/]{4,30}$/ })
        : (/^INT-/.test(i.reference) ? `SWF-INW-${seq(db, 'inw')}` : i.reference);
      need(!db.inward.some(x => x !== i && x.reference === ref), `Reference ${ref} is already recorded.`);
      const was = i.amount;
      Object.assign(i, { amount: amt, available: amt, reference: ref, valueDate: date(p.valueDate || i.valueDate, 'Value date'),
        status: 'Awaiting Instruction', pendingWith: 'SME', recordedBy: stamp(a, ctx.now, 'confirmed') });
      E.onInwardCredit(db, i, ctx.now);
      audit(db, a, ctx.now, i.id, `Credit confirmed in the nostro — ${fmt(amt, i.currency)}, ${ref}${amt !== was ? ` (reported ${fmt(was, i.currency)})` : ''}`);
      notify(db, ctx.now, { toSmeId: i.smeId, text: `${fmt(amt, i.currency)} from ${i.remitter} confirmed — submit your disposal instruction`, link: '#/sme/inward/' + i.id });
      return { id: i.id, message: `Credit confirmed. ${fmt(amt, i.currency)} is ready for the SME to dispose.` };
    },
  };
  C['inward.decline'] = {
    cap: 'inward.record',
    run(db, a, p, ctx) {
      const i = find(db.inward, p.id) || missing('Inward remittance');
      need(i.status === 'Intimated', 'Only a reported remittance waiting for confirmation can be declined.');
      const r = txt(p.reason, 'Reason', { max: 300 });
      Object.assign(i, { status: 'Not Received', pendingWith: '—', declineReason: r, declinedBy: stamp(a, ctx.now, 'declined') });
      audit(db, a, ctx.now, i.id, 'No matching credit — ' + r);
      notify(db, ctx.now, { toSmeId: i.smeId, text: `We could not match ${i.reference} to a credit: ${r}`, link: '#/sme/inward/' + i.id });
      return { message: 'Marked as not received. The SME has been told why.' };
    },
  };

  /* A receipt can be disposed of in parts. available is what no instruction
     covers yet; an instruction may credit the whole amount or only part. */
  function inwardStatus(db, i) {
    if (['Intimated', 'Not Received'].includes(i.status)) return i.status;
    const live = db.disposals.filter(d => d.inwardId === i.id && d.status !== 'Rejected');
    if (i.available > 0) return live.length ? 'Partially Disposed' : 'Awaiting Instruction';
    return live.some(d => OPEN.includes(d.status)) ? 'Instruction Submitted' : 'Processed';
  }

  /* What a processed disposal (its FIRC) still has to knock off against
     export bills: the part not applied to bills, less proposed knock-offs. */
  function fircAvailable(db, d) {
    if (!d || d.status !== 'Processed') return 0;
    const held = (db.allocations || []).filter(l => l.status === 'Proposed' && l.remKind === 'disposal' && l.remId === d.id)
      .reduce((t, l) => t + l.amount, 0);
    return round2(Math.max(0, (d.unallocated || 0) - held));
  }

  /* Reporting to RBI's Unified Portal (UFI), which carries EDPMS (export)
     and IDPMS (import) knock-offs. Simulated: every confirmed or reversed
     bill match gets a report reference. */
  function ufiReport(db, now, side, what) {
    const n = seq(db, 'ufi');
    return { ref: `UFI-${side === 'Export' ? 'E' : 'I'}-${now.slice(0, 4)}-${String(n).padStart(6, '0')}`,
             system: side === 'Export' ? 'EDPMS' : 'IDPMS', status: 'Reported', what, at: now };
  }
  function confirmLedger(db, now, entry) {
    const b = find(db.bills, entry.billId);
    const id = ledger(db, now, { ...entry, status: 'Confirmed', ufi: ufiReport(db, now, entry.side, 'knock-off') });
    if (b) { b.ufi = b.ufi || []; b.ufi.push(find(db.allocations, id).ufi.ref); }
    return id;
  }

  function readDisposal(db, a, s, i, d, now) {
    const amt = amount(d.amount == null || d.amount === '' ? i.available : d.amount, 'Amount to dispose');
    need(amt <= i.available + 0.001, `Only ${fmt(i.available, i.currency)} of this receipt is left to dispose.`);
    const option = oneOf(d.option || 'knockoff', (db.disposalOptions || []).map(o => o.id), 'Disposal option');
    const fallback = option === 'advance' ? 'P0103' : 'P0102';
    const pc = !d.purposeCode || d.purposeCode === 'TRADE' ? fallback : d.purposeCode;
    const purposeCode = oneOf(pc, (db.inwardPurposes || []).filter(x => !x.disabled).map(x => x.code), 'Purpose of remittance');
    let al = [], total = 0;
    if (option === 'knockoff') {
      ({ list: al, total } = allocationsIn(db, s, d.allocations, { type: 'Export', currency: i.currency, cap: amt, label: 'The amount applied to bills' }));
      need(al.length, 'Apply the amount against at least one accepted export bill, or choose “Credit as advance”.');
    }
    const acc = find(db.accounts, d.creditAccountId);
    need(acc && acc.smeId === s.id, 'Select an account to credit from your account master.');
    need(acc.verified, `Account ${acc.accountNumber} is not verified yet. Verify it with PennyDrop first.`);
    need(acc.currency === 'INR' || acc.currency === i.currency,
      `Credit an INR account (converted at the booked rate) or an EEFC account in ${i.currency}.`);
    /* Crediting INR converts at a booked rate (a treasury position); crediting
       EEFC converts nothing and opens no position. */
    const rr = acc.currency === 'INR' ? T.resolveRate(db, a, s, i.currency, 'in', amt, d.rate, now) : null;
    const rate = rr ? rr.rate
      : { mode: 'none', refRate: (currencyOf(db, i.currency) || {}).refRate || 0, margin: 0, customerRate: 0, bookedAt: null, expiresAt: null, dealRef: null };
    const list = checklist(db, 'TRADE', purposeCode, 0, { option });
    const docs = docsIn(d.docs, list.map(x => x.id));
    const missingDocs = list.filter(x => x.required && !docs[x.id]).map(x => x.name);
    need(!missingDocs.length, 'Upload the required documents: ' + missingDocs.join(', ') + '.', missingDocs);
    const dec = d.declarations || {};
    need(bool(dec.fema) && bool(dec.ofac), 'Accept the FEMA and sanctions (OFAC) declarations before submitting.');
    return { amt, option, purposeCode, al, total, acc, rate, rr, docs, declarations: { fema: true, ofac: true, at: now } };
  }

  C['disposal.submit'] = {
    cap: 'inward.dispose',
    run(db, a, p, ctx) {
      const s = ownSme(db, a); requireApproved(s);
      need(perm(s).exportSide, 'Inward disposal requires Export or Both permission.');
      const d = p.draft || {};
      const i = find(db.inward, d.inwardId);
      if (!i || i.smeId !== s.id) missing('Inward receipt');
      need(i.status !== 'Intimated', 'AD2 Operations has not confirmed this remittance against the credit yet.');
      need(i.available > 0, 'Nothing is left to dispose on this receipt.');
      const v = readDisposal(db, a, s, i, d, ctx.now);
      const inrCredit = v.acc.currency === 'INR';
      const id = nextId(db.disposals, 'DI');
      const rec = { id, inwardId: i.id, smeId: s.id, amount: v.amt, currency: i.currency, option: v.option,
        purposeCode: v.purposeCode, remittanceType: 'TRADE', creditAccountId: v.acc.id, creditCurrency: v.acc.currency,
        allocations: v.al, allocatedTotal: v.total, unallocated: round2(v.amt - v.total), rate: v.rate, docs: v.docs,
        creditInr: inrCredit ? round2(v.amt * v.rate.customerRate) : 0, creditFcy: inrCredit ? 0 : v.amt,
        declarations: v.declarations,
        status: 'Submitted', pendingWith: 'AD2 Maker', submittedAt: ctx.now,
        remarks: txt(d.remarks, 'Remarks', { max: 500, required: false }),
        source: a.actingFor ? 'AD2 Assisted' : 'SME', createdBy: a.name || a.role, createdByKey: actorKey(a),
        wf: { submitted: stamp(a, ctx.now, 'submitted') } };
      rec.risk = riskScore(db, {
        usd: usdEq(db, v.amt, i.currency), purpose: v.purposeCode, deal: v.rate.mode === 'deal',
        countries: [i.remitterCountry], names: [i.remitter],
        first: !db.disposals.some(x => x.smeId === s.id && x.status === 'Processed'),
        files: Object.values(v.docs).map(f => f.filename),
      });
      db.disposals.unshift(rec);
      if (v.rr) T.attach(db, a, v.rr, 'disposal', id, v.amt, ctx.now);
      i.available = round2(i.available - v.amt);
      i.status = inwardStatus(db, i);
      const what = v.option === 'knockoff'
        ? `against ${v.al.map(x => x.billId).join(', ')}${rec.unallocated > 0 ? `, ${fmt(rec.unallocated, i.currency)} as advance` : ''}`
        : 'as an advance — bills to be knocked off later';
      const to = inrCredit ? `credit INR at ${v.rate.customerRate.toFixed(4)}` : `credit ${v.acc.currency} to EEFC`;
      audit(db, a, ctx.now, i.id, `Disposal instruction ${id} submitted for ${fmt(v.amt, i.currency)} of ${fmt(i.amount, i.currency)}`);
      audit(db, a, ctx.now, id, `Disposal instruction submitted — ${fmt(v.amt, i.currency)} under ${v.purposeCode}, ${what}; ${to}`);
      audit(db, a, ctx.now, id, `Compliance check — risk ${rec.risk.level} (${rec.risk.score})${rec.risk.flags.length ? ': ' + rec.risk.flags.map(f => f.label).join(', ') : ''}`, true);
      notify(db, ctx.now, { toRole: 'AD2 Maker', text: `Disposal ${id} from ${s.tradingName} — ${fmt(v.amt, i.currency)} to verify`, link: '#/ad2/disposals/' + id });
      return { id, message: `Disposal instruction ${id} submitted.${i.available > 0 ? ` ${fmt(i.available, i.currency)} of the receipt is still to dispose.` : ''}` };
    },
  };

  const disposalFor = (db, id) => find(db.disposals, id) || missing('Disposal instruction');
  const disposalChecks = d => ['documents', 'account', 'sanctions', ...((d.allocations || []).length ? ['bills'] : [])];

  C['disposal.verify'] = {
    cap: 'inward.verifyDisposal',
    run(db, a, p, ctx) {
      const d = disposalFor(db, p.id);
      need(d.status === 'Submitted', 'Only a submitted instruction can be verified.');
      const checks = p.checks || {};
      const notDone = disposalChecks(d).filter(k => !bool(checks[k]));
      need(!notDone.length, 'Complete every verification check before verifying.', notDone);
      distinct(a, [{ key: d.createdByKey, verb: 'raised' }], 'instruction');
      d.wf.verified = { ...stamp(a, ctx.now, 'verified'), note: riskNote(d, p, 'verifying') };
      d.status = 'Verified'; d.pendingWith = 'AD2 Checker';
      audit(db, a, ctx.now, d.id, 'Verified — documents, sanctions screening, ' + ((d.allocations || []).length ? 'bill match ' : '') + 'and credit account checked');
      if (d.wf.verified.note) audit(db, a, ctx.now, d.id, 'Maker note: ' + d.wf.verified.note, true);
      notify(db, ctx.now, { toRole: 'AD2 Checker', text: `Disposal ${d.id} verified — ready to authorise`, link: '#/ad2/disposals/' + d.id });
      return { message: `${d.id} verified and passed to the checker.` };
    },
  };

  C['disposal.authorise'] = {
    cap: 'inward.approveDisposal',
    run(db, a, p, ctx) {
      const d = disposalFor(db, p.id);
      need(d.status === 'Verified', 'Only a verified instruction can be authorised.');
      distinct(a, [{ key: d.createdByKey, verb: 'raised' }, d.wf.verified], 'instruction');
      d.wf.authorised = { ...stamp(a, ctx.now, 'authorised'), note: riskNote(d, p, 'authorising') };
      d.status = 'Authorised'; d.pendingWith = 'AD2 Operations';
      audit(db, a, ctx.now, d.id, 'Authorised for processing');
      if (d.wf.authorised.note) audit(db, a, ctx.now, d.id, 'Checker note: ' + d.wf.authorised.note, true);
      notify(db, ctx.now, { toRole: 'AD2 Operations', text: `Disposal ${d.id} authorised — process the credit`, link: '#/ad2/disposals/' + d.id });
      return { message: `${d.id} authorised. Operations can now process it.` };
    },
  };

  C['disposal.process'] = {
    cap: 'inward.processDisposal',
    run(db, a, p, ctx) {
      const d = disposalFor(db, p.id);
      need(d.status === 'Authorised', 'Only an authorised instruction can be processed.');
      distinct(a, [{ key: d.createdByKey, verb: 'raised' }, d.wf.verified, d.wf.authorised], 'instruction');
      const acc = find(db.accounts, d.creditAccountId);
      need(acc, 'The credit account no longer exists.');
      const fcy = (d.creditCurrency || 'INR') !== 'INR';
      if (fcy) { d.creditFcy = d.amount; d.creditInr = 0; }
      else d.creditInr = round2(d.amount * d.rate.customerRate);
      if (acc.balance != null) acc.balance = round2(acc.balance + (fcy ? d.amount : d.creditInr));
      d.firc = `FIRC-${ctx.now.slice(0, 4)}-${seq(db, 'firc')}`;
      let applied = 0;
      (d.allocations || []).forEach(x => {
        const b = find(db.bills, x.billId);
        if (!b) return;
        const amt = Math.min(x.amount, b.outstanding);
        if (!(amt > 0)) return;
        applyToBill(b, amt);
        applied += amt;
        confirmLedger(db, ctx.now, { smeId: d.smeId, side: 'Export', billId: b.id, remKind: 'disposal', remId: d.id, inwardId: d.inwardId,
                                     disposalId: d.id, ref: d.firc, amount: amt, currency: d.currency, source: 'Disposal instruction' });
      });
      d.allocatedTotal = round2(applied);
      d.unallocated = round2(d.amount - applied);
      d.fircUfi = ufiReport(db, ctx.now, 'Export', 'FIRC / realisation');
      d.wf.processed = stamp(a, ctx.now, 'processed');
      T.link(db, a, d, d.firc, ctx.now);
      d.status = 'Processed'; d.pendingWith = '—';
      const i = find(db.inward, d.inwardId);
      if (i) { i.firc = d.firc; (i.fircs = i.fircs || []).push(d.firc); i.status = inwardStatus(db, i); }
      const credited = fcy ? fmt(d.amount, d.currency) : inr(d.creditInr);
      audit(db, a, ctx.now, d.id, `Processed — ${credited} credited to ${acc.bank} ${acc.accountNumber}; ${d.firc} issued and reported to EDPMS (${d.fircUfi.ref})`);
      if (d.unallocated > 0) audit(db, a, ctx.now, d.id, `${fmt(d.unallocated, d.currency)} of ${d.firc} is pending knock-off against export bills`);
      if (i) audit(db, a, ctx.now, i.id, `${d.firc} issued against disposal ${d.id}`);
      notify(db, ctx.now, { toSmeId: d.smeId, text: `${credited} credited — ${d.firc} issued for ${d.id}${d.unallocated > 0 ? ' (knock off the balance against bills)' : ''}`, link: '#/sme/disposals/' + d.id });
      return { firc: d.firc, message: `Processed. ${credited} credited and ${d.firc} issued.` };
    },
  };

  C['disposal.query'] = {
    cap: 'outward.query',
    run(db, a, p, ctx) {
      const d = disposalFor(db, p.id);
      need(['Submitted', 'Verified'].includes(d.status), 'A query can be raised only before authorisation.');
      const q = txt(p.question, 'Query', { max: 500 });
      d.query = { question: q, raisedBy: actorLabel(a), raisedAt: ctx.now, response: null };
      d.status = 'Clarification Required'; d.pendingWith = 'SME';
      delete d.wf.verified;
      audit(db, a, ctx.now, d.id, 'Clarification requested: ' + q);
      notify(db, ctx.now, { toSmeId: d.smeId, text: `AD2 has a query on disposal ${d.id}`, link: '#/sme/disposals/' + d.id });
      return { message: 'Query sent to the SME.' };
    },
  };
  C['disposal.respond'] = {
    cap: 'inward.dispose',
    run(db, a, p, ctx) {
      const s = ownSme(db, a);
      const d = disposalFor(db, p.id);
      need(d.smeId === s.id, 'This instruction belongs to another SME.');
      need(d.status === 'Clarification Required', 'There is no open query on this instruction.');
      d.query.response = txt(p.response, 'Response', { max: 1000 }); d.query.respondedAt = ctx.now;
      Object.assign(d.docs = d.docs || {}, docsIn(p.docs, checklist(db, 'TRADE', d.purposeCode, 0, { option: d.option }).map(x => x.id)));
      d.status = 'Submitted'; d.pendingWith = 'AD2 Maker';
      audit(db, a, ctx.now, d.id, 'SME responded to the query — back with the maker');
      notify(db, ctx.now, { toRole: 'AD2 Maker', text: `SME responded on disposal ${d.id}`, link: '#/ad2/disposals/' + d.id });
      return { message: 'Response sent.' };
    },
  };
  C['disposal.resolveQuery'] = {
    cap: 'txn.resolveQuery',
    run(db, a, p, ctx) {
      const d = disposalFor(db, p.id);
      need(d.status === 'Clarification Required', 'There is no open query on this instruction.');
      const r = txt(p.response, 'The customer’s answer', { max: 1000 });
      const added = docsIn(p.docs, checklist(db, 'TRADE', d.purposeCode, 0, { option: d.option }).map(x => x.id));
      Object.assign(d.docs = d.docs || {}, added);
      d.query = { ...(d.query || {}), response: r, respondedAt: ctx.now, respondedBy: resolvedBy(a) };
      d.status = 'Submitted'; d.pendingWith = 'AD2 Maker';
      const n = Object.keys(added).length;
      audit(db, a, ctx.now, d.id, `Query answered on the customer’s behalf${n ? ` — ${n} document(s) received from the customer attached` : ''}; back with the maker`);
      notify(db, ctx.now, { toRole: 'AD2 Maker', text: `Query on disposal ${d.id} answered for the SME — verify again`, link: '#/ad2/disposals/' + d.id });
      notify(db, ctx.now, { toSmeId: d.smeId, text: `AD2 recorded your answer to the query on ${d.id}`, link: '#/sme/disposals/' + d.id });
      return { message: 'Answer recorded for the customer. The instruction is back with the maker to verify.' };
    },
  };
  /* Disposal queries use the outward query capability for both maker and
     checker; the explicit caps below keep the matrix readable. */
  C['disposal.reject'] = {
    cap: 'outward.reject',
    run(db, a, p, ctx) {
      const d = disposalFor(db, p.id);
      need(['Submitted', 'Verified', 'Authorised', 'Clarification Required'].includes(d.status), 'This instruction can no longer be rejected.');
      const r = txt(p.reason, 'Reason for rejection', { max: 500 });
      d.status = 'Rejected'; d.pendingWith = '—'; d.rejectReason = r;
      d.wf.rejected = stamp(a, ctx.now, 'rejected');
      T.release(db, a, d, 'Instruction rejected: ' + r, ctx.now);
      const i = find(db.inward, d.inwardId);
      if (i) { i.available = round2(i.available + d.amount); i.status = inwardStatus(db, i); }
      audit(db, a, ctx.now, d.id, 'Instruction rejected: ' + r);
      notify(db, ctx.now, { toSmeId: d.smeId, text: `Disposal ${d.id} was rejected — the amount is available again`, link: '#/sme/inward/' + d.inwardId });
      return { message: 'Instruction rejected. The receipt balance is available again.' };
    },
  };

  /* ---------- bills ---------------------------------------------------------- */
  function readBill(db, a, s, v, type) {
    v = v || {};
    const b = {
      type,
      invoiceNumber: txt(v.invoiceNumber, 'Invoice number', { max: 40 }),
      invoiceDate: date(v.invoiceDate, 'Invoice date'),
      counterparty: txt(v.counterparty, 'Counterparty', { max: 120 }),
      counterpartyCountry: txt(v.counterpartyCountry, 'Counterparty country', { max: 60 }),
      currency: oneOf(v.currency, currencyCodes(db), 'Currency'),
      amount: amount(v.amount, 'Invoice amount'),
      dueDate: date(v.dueDate, 'Due date'),
      orderRef: txt(v.orderRef, 'Order reference', { max: 40, required: false }),
      shipmentRef: txt(v.shipmentRef, type === 'Export' ? 'Shipping bill reference' : 'Bill of Entry reference', { max: 40, required: false }),
    };
    need(b.dueDate >= b.invoiceDate, 'The due date cannot be before the invoice date.');
    if (!(a.actingFor && isAD2(a))) need(s.config.currencies.includes(b.currency), `Currency ${b.currency} is not enabled for this SME.`);
    need(!db.bills.some(x => x.smeId === s.id && x.invoiceNumber === b.invoiceNumber),
      `Invoice ${b.invoiceNumber} is already lodged for this SME. Duplicates are blocked on the invoice number.`);
    return b;
  }
  function billSide(s, type) {
    const pm = perm(s);
    need(type === 'Import' ? pm.importSide : pm.exportSide, `${type} bill lodgement is not enabled for this SME.`);
  }

  C['bill.lodge'] = {
    cap: 'bills.lodge',
    run(db, a, p, ctx) {
      const s = ownSme(db, a); requireApproved(s);
      const type = oneOf(p.type, ['Import', 'Export'], 'Bill type');
      billSide(s, type);
      const b = readBill(db, a, s, p.bill, type);
      const id = nextId(db.bills, 'BL', 5);
      const accepted = !!db.settings.autoChecker;
      db.bills.unshift({ id, smeId: s.id, ...b, adjusted: 0, outstanding: b.amount,
        source: p.source === 'Document AI' ? 'Document AI' : 'Form fill', review: accepted ? 'Accepted' : 'Submitted', settlement: 'Unsettled',
        docs: docsIn(p.docs), lodgedBy: stamp(a, ctx.now, 'lodged') });
      audit(db, a, ctx.now, id, `${type} bill lodged — ${b.invoiceNumber}, ${fmt(b.amount, b.currency)}${accepted ? ' — accepted by AutoChecker' : ' — awaiting checker'}`);
      if (!accepted) notify(db, ctx.now, { toRole: 'AD2 Checker', text: `${type} bill ${id} from ${s.tradingName} to accept`, link: '#/ad2/bills/' + type.toLowerCase() });
      return { id, message: `Bill ${id} lodged${accepted ? ' and accepted' : '. AD2 will accept it shortly'}.` };
    },
  };

  C['bill.lodgeBatch'] = {
    cap: 'bills.lodge',
    run(db, a, p, ctx) {
      const s = ownSme(db, a); requireApproved(s);
      const type = oneOf(p.type, ['Import', 'Export'], 'Bill type');
      billSide(s, type);
      const rows = Array.isArray(p.rows) ? p.rows.slice(0, 200) : [];
      need(rows.length, 'There are no rows to lodge.');
      const ids = [], errors = [];
      rows.forEach((r, idx) => {
        try {
          const b = readBill(db, a, s, r, type);
          const id = nextId(db.bills, 'BL', 5);
          db.bills.unshift({ id, smeId: s.id, ...b, adjusted: 0, outstanding: b.amount, source: 'CSV upload',
            review: db.settings.autoChecker ? 'Accepted' : 'Submitted', settlement: 'Unsettled', lodgedBy: stamp(a, ctx.now, 'lodged') });
          ids.push(id);
        } catch (e) {
          if (!(e instanceof EngineError)) throw e;
          errors.push({ row: String(r && r.line || idx + 2), message: e.message });
        }
      });
      const jobId = nextId(db.jobs, 'JOB');
      db.jobs.unshift({ id: jobId, smeId: s.id, source: 'CSV upload', runAt: ctx.now, received: rows.length,
                        accepted: ids.length, rejected: errors.length, errors });
      audit(db, a, ctx.now, jobId, `CSV upload — ${ids.length} ${type.toLowerCase()} bill(s) lodged, ${errors.length} rejected`);
      if (ids.length && !db.settings.autoChecker) notify(db, ctx.now, { toRole: 'AD2 Checker', text: `${ids.length} ${type.toLowerCase()} bill(s) from ${s.tradingName} to accept`, link: '#/ad2/bills/' + type.toLowerCase() });
      return { ids, errors, jobId, message: `${ids.length} bill${ids.length === 1 ? '' : 's'} lodged${errors.length ? `, ${errors.length} row(s) rejected` : ''}.` };
    },
  };

  const billFor = (db, id) => find(db.bills, id) || missing('Bill');
  C['bill.accept'] = {
    cap: 'bills.accept',
    run(db, a, p, ctx) {
      const b = billFor(db, p.id);
      need(['Submitted', 'Resubmitted', 'Under Review'].includes(b.review), `Bill ${b.id} is ${b.review.toLowerCase()} — nothing to accept.`);
      distinct(a, [b.lodgedBy], 'bill');
      b.review = 'Accepted'; b.acceptedBy = stamp(a, ctx.now, 'accepted');
      delete b.query;
      audit(db, a, ctx.now, b.id, 'Bill accepted');
      notify(db, ctx.now, { toSmeId: b.smeId, text: `Bill ${b.id} (${b.invoiceNumber}) accepted`, link: '#/sme/bills/' + b.type.toLowerCase() });
      return { message: `Bill ${b.id} accepted.` };
    },
  };
  C['bill.query'] = {
    cap: 'bills.accept',
    run(db, a, p, ctx) {
      const b = billFor(db, p.id);
      need(['Submitted', 'Resubmitted', 'Under Review'].includes(b.review), 'This bill is not awaiting review.');
      const q = txt(p.question, 'Query', { max: 500 });
      b.review = 'Query Raised'; b.query = { question: q, raisedBy: actorLabel(a), raisedAt: ctx.now };
      audit(db, a, ctx.now, b.id, 'Query raised: ' + q);
      notify(db, ctx.now, { toSmeId: b.smeId, text: `Query on bill ${b.id}: ${q}`, link: '#/sme/bills/' + b.type.toLowerCase() });
      return { message: 'Query sent to the SME.' };
    },
  };
  C['bill.respond'] = {
    cap: 'bills.lodge',
    run(db, a, p, ctx) {
      const s = ownSme(db, a);
      const b = billFor(db, p.id);
      need(b.smeId === s.id, 'This bill belongs to another SME.');
      need(b.review === 'Query Raised', 'There is no open query on this bill.');
      const r = txt(p.response, 'Response', { max: 500 });
      if (p.shipmentRef) b.shipmentRef = txt(p.shipmentRef, 'Reference', { max: 40 });
      b.query = { ...(b.query || {}), response: r, respondedAt: ctx.now };
      b.review = 'Resubmitted';
      audit(db, a, ctx.now, b.id, 'Resubmitted after query: ' + r);
      notify(db, ctx.now, { toRole: 'AD2 Checker', text: `Bill ${b.id} resubmitted by ${s.tradingName}`, link: '#/ad2/bills/' + b.type.toLowerCase() });
      return { message: 'Bill resubmitted.' };
    },
  };

  C['bill.resolveQuery'] = {
    cap: 'txn.resolveQuery',
    run(db, a, p, ctx) {
      const b = billFor(db, p.id);
      need(b.review === 'Query Raised', 'There is no open query on this bill.');
      const r = txt(p.response, 'The customer’s answer', { max: 500 });
      if (p.shipmentRef) b.shipmentRef = txt(p.shipmentRef, 'Reference', { max: 40 });
      b.query = { ...(b.query || {}), response: r, respondedAt: ctx.now, respondedBy: resolvedBy(a) };
      b.review = 'Resubmitted';
      audit(db, a, ctx.now, b.id, 'Query answered on the customer’s behalf: ' + r);
      notify(db, ctx.now, { toRole: 'AD2 Checker', text: `Bill ${b.id} resubmitted for the SME`, link: '#/ad2/bills/' + b.type.toLowerCase() });
      return { message: 'Answer recorded. The bill is back with the checker to accept.' };
    },
  };

  C['job.retry'] = {
    cap: 'bills.lodge',
    run(db, a, p, ctx) {
      const s = ownSme(db, a);
      const j = find(db.jobs, p.id);
      if (!j || j.smeId !== s.id) missing('Job');
      need(j.rejected > 0, 'Nothing to retry on this job.');
      const dup = j.errors.filter(e => /duplicate/i.test(e.message));
      j.accepted += (j.rejected - dup.length); j.rejected = dup.length; j.errors = dup; j.retriedAt = ctx.now;
      audit(db, a, ctx.now, j.id, 'Job retried — duplicates skipped, no bill created twice');
      return { message: dup.length ? 'Retried. Duplicates were skipped, so no bills were created twice.' : 'Retry succeeded. All rows accepted.' };
    },
  };

  /* ---------- knock-off and reconciliation ----------------------------------
     Import side: a completed outward payment (for example an advance, AIR)
     is matched to import bills once the Bill of Entry is lodged.
     Export side: a FIRC with an amount pending knock-off (an advance
     disposal, or the part of a disposal not applied to bills) is matched to
     export bills. A proposal holds the amounts until a checker confirms it;
     confirmation reports the match to IDPMS / EDPMS through UFI.           */
  function outwardUnapplied(db, o) {
    const used = (db.allocations || []).filter(l => l.remKind === 'outward' && l.remId === o.id && ['Confirmed', 'Proposed'].includes(l.status))
      .reduce((t, l) => t + l.amount, 0);
    return round2(Math.max(0, o.amount - used));
  }

  C['knockoff.propose'] = {
    cap: 'recon.propose',
    run(db, a, p, ctx) {
      const s = ownSme(db, a); requireApproved(s);
      const side = oneOf(p.side, ['Import', 'Export'], 'Side');
      billSide(s, side);
      const items = Array.isArray(p.items) ? p.items.slice(0, 30) : [];
      need(items.length, 'Add at least one allocation.');
      const made = [];
      items.forEach(x => {
        const amt = amount(x.amount, 'Allocation');
        const b = find(db.bills, x.billId);
        need(b && b.smeId === s.id && b.type === side && b.review === 'Accepted', `Bill ${x.billId} cannot be knocked off.`);
        need(amt <= billAvailable(db, b) + 0.001, `Bill ${b.id} has only ${fmt(billAvailable(db, b), b.currency)} available.`);
        let remKind, remId, ref;
        if (side === 'Import') {
          const o = find(db.outward, x.remId);
          need(o && o.smeId === s.id && o.status === 'Completed' && o.currency === b.currency, `Payment ${x.remId} is not an eligible completed payment in ${b.currency}.`);
          const left = outwardUnapplied(db, o);
          need(amt <= left + 0.001, `Payment ${o.id} has only ${fmt(left, o.currency)} left to apply.`);
          remKind = 'outward'; remId = o.id; ref = o.utr || o.id;
        } else {
          const d = find(db.disposals, x.remId);
          need(d && d.smeId === s.id && d.status === 'Processed' && d.currency === b.currency, `${x.remId} is not a processed FIRC in ${b.currency}.`);
          const left = fircAvailable(db, d);
          need(amt <= left + 0.001, `${d.firc} has only ${fmt(left, d.currency)} pending knock-off.`);
          remKind = 'disposal'; remId = d.id; ref = d.firc;
        }
        made.push(ledger(db, ctx.now, { smeId: s.id, side, billId: b.id, remKind, remId, ref, amount: amt, currency: b.currency,
          source: 'Knock-off', status: 'Proposed', proposedBy: stamp(a, ctx.now, 'proposed') }));
        audit(db, a, ctx.now, b.id, `Knock-off proposed against ${ref} for ${fmt(amt, b.currency)}`);
      });
      notify(db, ctx.now, { toRole: 'AD2 Checker', text: `${made.length} knock-off allocation(s) from ${s.tradingName} to confirm`, link: '#/ad2/reconciliation' });
      return { ids: made, message: `${made.length} allocation${made.length === 1 ? '' : 's'} submitted for AD2 confirmation.` };
    },
  };

  const allocFor = (db, id) => find(db.allocations, id) || missing('Allocation');
  C['recon.confirm'] = {
    cap: 'recon.confirm',
    run(db, a, p, ctx) {
      const l = allocFor(db, p.id);
      need(l.status === 'Proposed', 'Only a proposed allocation can be confirmed.');
      distinct(a, [l.proposedBy], 'allocation');
      const b = find(db.bills, l.billId);
      need(b && l.amount <= b.outstanding + 0.001, 'The bill no longer has enough outstanding to confirm this allocation.');
      if (l.remKind === 'disposal') {
        const d = find(db.disposals, l.remId);
        need(d && l.amount <= (d.unallocated || 0) + 0.001, 'The FIRC no longer has enough pending knock-off to confirm this allocation.');
        d.unallocated = round2(d.unallocated - l.amount);
        d.allocatedTotal = round2((d.allocatedTotal || 0) + l.amount);
        (d.knockoffs = d.knockoffs || []).push({ billId: b.id, amount: l.amount, allocationId: l.id, at: ctx.now });
      }
      if (l.remKind === 'outward') { const o = find(db.outward, l.remId); if (o) (o.allocations = o.allocations || []).push({ billId: b.id, amount: l.amount, via: 'knock-off' }); }
      applyToBill(b, l.amount);
      l.status = 'Confirmed'; l.confirmedBy = stamp(a, ctx.now, 'confirmed');
      l.ufi = ufiReport(db, ctx.now, l.side, 'knock-off');
      (b.ufi = b.ufi || []).push(l.ufi.ref);
      audit(db, a, ctx.now, b.id, `Knock-off against ${l.ref || l.remId} confirmed — ${fmt(l.amount, l.currency)}; reported to ${l.ufi.system} (${l.ufi.ref})`);
      notify(db, ctx.now, { toSmeId: l.smeId, text: `Knock-off of ${b.id} against ${l.ref || l.remId} confirmed`, link: '#/sme/knockoff' });
      return { message: `Allocation confirmed. Bill balance updated and reported to ${l.ufi.system} through UFI.` };
    },
  };
  C['recon.reject'] = {
    cap: 'recon.confirm',
    run(db, a, p, ctx) {
      const l = allocFor(db, p.id);
      need(l.status === 'Proposed', 'Only a proposed allocation can be rejected.');
      const r = txt(p.reason, 'Reason', { max: 300 });
      l.status = 'Rejected'; l.rejectReason = r; l.rejectedBy = stamp(a, ctx.now, 'rejected');
      audit(db, a, ctx.now, l.billId, `Knock-off against ${l.ref || l.remId} rejected: ${r}`);
      notify(db, ctx.now, { toSmeId: l.smeId, text: `Knock-off of ${l.billId} against ${l.ref || l.remId} was rejected: ${r}`, link: '#/sme/knockoff' });
      return { message: 'Allocation rejected. The amounts are free to allocate again.' };
    },
  };
  C['recon.reverse'] = {
    cap: 'recon.reverse',
    run(db, a, p, ctx) {
      const l = allocFor(db, p.id);
      need(l.status === 'Confirmed', 'Only a confirmed allocation can be reversed.');
      const r = txt(p.reason, 'Reason for reversal', { max: 300 });
      const b = find(db.bills, l.billId);
      if (b) applyToBill(b, -l.amount);
      l.status = 'Reversed'; l.reversedBy = { ...stamp(a, ctx.now, 'reversed'), reason: r };
      l.ufiReversal = ufiReport(db, ctx.now, l.side, 'reversal');
      /* The money stays credited; the FIRC amount is pending knock-off again. */
      const d = find(db.disposals, l.remKind === 'disposal' ? l.remId : l.disposalId);
      if (d && l.side === 'Export') { d.unallocated = round2((d.unallocated || 0) + l.amount); d.allocatedTotal = round2(Math.max(0, (d.allocatedTotal || 0) - l.amount)); }
      if (l.remKind === 'outward') { const o = find(db.outward, l.remId); if (o && o.allocations) { const k = o.allocations.findIndex(x => x.billId === l.billId && x.amount === l.amount); if (k >= 0) o.allocations.splice(k, 1); } }
      audit(db, a, ctx.now, l.billId, `Allocation against ${l.ref || l.remId} reversed: ${r}; reversal reported to ${l.ufiReversal.system} (${l.ufiReversal.ref})`);
      notify(db, ctx.now, { toSmeId: l.smeId, text: `Allocation of ${l.billId} against ${l.ref || l.remId} was reversed: ${r}`, link: '#/sme/knockoff' });
      return { message: 'Allocation reversed and reported. The bill is outstanding again.' };
    },
  };

  /* ---------- notes, administration, assisted journey ----------------------- */
  C['note.add'] = {
    run(db, a, p, ctx) {
      if (!isAD2(a)) forbid('Internal notes are for AD2 users only.');
      const coll = { outward: db.outward, disposal: db.disposals, sme: db.smes }[p.kind];
      need(coll, 'Unknown record type.');
      const rec = find(coll, p.id) || missing('Record');
      const text = txt(p.text, 'Note', { max: 1000 });
      (rec.notes = rec.notes || []).push({ by: actorLabel(a), at: ctx.now, text });
      audit(db, a, ctx.now, rec.id, 'Internal note added');
      return { message: 'Internal note saved. It is not visible to the SME.' };
    },
  };

  C['settings.update'] = {
    cap: 'admin.settings',
    run(db, a, p, ctx) {
      const changes = [];
      if (p.cutoff !== undefined) {
        need(/^([01]\d|2[0-3]):[0-5]\d$/.test(String(p.cutoff)), 'The treasury cut-off must be a time like 16:00.');
        db.settings.cutoff = String(p.cutoff); changes.push(`cut-off ${db.settings.cutoff} IST`);
      }
      [['maxOpenBookings', 1, 20, 'open rate bookings per customer'], ['rateBand', 0.5, 5, 'rate revision band (%)'], ['agedDays', 1, 30, 'days before an attached position is aged']]
        .forEach(([k, lo, hi, label]) => {
          if (p[k] === undefined) return;
          const v = Number(p[k]);
          need(isFinite(v) && v >= lo && v <= hi, `The ${label} must be between ${lo} and ${hi}.`);
          db.settings[k] = v; changes.push(`${k} ${v}`);
        });
      ['autoChecker', 'allowUnlinked', 'testLab', 'marketSim'].forEach(k => {
        if (p[k] === undefined) return;
        db.settings[k] = bool(p[k]);
        changes.push(`${k} ${db.settings[k] ? 'on' : 'off'}`);
      });
      if (p.marginBand !== undefined) {
        const v = Number(p.marginBand);
        need(isFinite(v) && v >= 0 && v <= 50, 'The margin band must be between 0 and 50 paise.');
        db.settings.marginBand = Math.round(v);
        changes.push(`marginBand ${db.settings.marginBand}p`);
      }
      need(changes.length, 'Nothing to change.');
      audit(db, a, ctx.now, 'SETTINGS', 'Settings changed: ' + changes.join(', '));
      return { message: 'Settings saved.' };
    },
  };
  const RULES = ['required', 'optional', 'goods', 'threshold', 'knockoff'];
  C['policy.setRule'] = {
    cap: 'admin.masters',
    run(db, a, p, ctx) {
      const d = (db.docPolicy || []).find(x => x.product === p.product && x.id === p.docId) || missing('Document rule');
      const rule = oneOf(p.rule, RULES, 'Rule');
      if (rule === 'knockoff') need(d.product === 'TRADE', 'The knock-off rule applies to disposal (TRADE) documents only.');
      if (rule === 'threshold') {
        const t = p.threshold != null && p.threshold !== '' ? Number(p.threshold) : (d.threshold || 500000);
        need(isFinite(t) && t > 0, 'The threshold must be a positive INR amount.');
        d.threshold = round2(t);
      }
      const was = d.rule; d.rule = rule;
      audit(db, a, ctx.now, 'POLICY', `${d.product} · ${d.name}: ${was} → ${rule}${rule === 'threshold' ? ' above ' + inr(d.threshold) : ''}`);
      return { message: `${d.name} under ${d.product} is now ${rule}.` };
    },
  };
  C['policy.addDoc'] = {
    cap: 'admin.masters',
    run(db, a, p, ctx) {
      const prod = productOf(db, p.product) || missing('Product');
      const name = txt(p.name, 'Document name', { max: 80 });
      const rule = oneOf(p.rule || 'required', RULES, 'Rule');
      if (rule === 'knockoff') need(prod.id === 'TRADE', 'The knock-off rule applies to disposal (TRADE) documents only.');
      const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'doc';
      let id = base, k = 1;
      while (db.docPolicy.some(x => x.product === prod.id && x.id === id)) id = base + (++k);
      need(!db.docPolicy.some(x => x.product === prod.id && x.name.toLowerCase() === name.toLowerCase()), `${name} is already on the ${prod.id} checklist.`);
      db.docPolicy.push({ product: prod.id, id, name, rule, ...(rule === 'threshold' ? { threshold: 500000 } : {}), added: true });
      audit(db, a, ctx.now, 'POLICY', `${prod.id} · ${name} added as ${rule}`);
      return { message: `${name} added to the ${prod.id} checklist.` };
    },
  };
  C['policy.removeDoc'] = {
    cap: 'admin.masters',
    run(db, a, p, ctx) {
      const d = (db.docPolicy || []).find(x => x.product === p.product && x.id === p.docId) || missing('Document rule');
      need(db.docPolicy.filter(x => x.product === d.product).length > 1, 'Keep at least one document on each product checklist.');
      db.docPolicy = db.docPolicy.filter(x => x !== d);
      audit(db, a, ctx.now, 'POLICY', `${d.product} · ${d.name} removed from the checklist`);
      return { message: `${d.name} removed from the ${d.product} checklist.` };
    },
  };
  C['purpose.setEnabled'] = {
    cap: 'admin.masters',
    run(db, a, p, ctx) {
      const prod = productOf(db, p.product) || missing('Product');
      need(prod.purposes.includes(p.code), `${p.code} is not mapped to ${prod.id}.`);
      const off = new Set(prod.disabled || []);
      bool(p.enabled) ? off.delete(p.code) : off.add(p.code);
      need(prod.purposes.some(c => !off.has(c)), `Keep at least one purpose code enabled under ${prod.id}.`);
      prod.disabled = [...off];
      audit(db, a, ctx.now, 'POLICY', `${prod.id} · ${p.code} ${bool(p.enabled) ? 'enabled' : 'disabled'}`);
      return { message: `${p.code} ${bool(p.enabled) ? 'enabled' : 'disabled'} under ${prod.id}.` };
    },
  };
  C['purpose.addInward'] = {
    cap: 'admin.masters',
    run(db, a, p, ctx) {
      const code = txt(String(p.code || '').toUpperCase(), 'Code', { max: 10, pattern: /^[A-Z0-9]{3,10}$/, patternMsg: 'Code must be 3–10 capital letters or digits.' });
      const label = txt(p.label, 'Description', { max: 120 });
      need(!(db.inwardPurposes || []).some(x => x.code === code), `${code} is already an inward purpose.`);
      (db.inwardPurposes = db.inwardPurposes || []).push({ code, label, added: true });
      audit(db, a, ctx.now, 'POLICY', `Inward purpose ${code} added — ${label}`);
      return { message: `${code} added. SMEs can choose it on a disposal instruction.` };
    },
  };
  C['purpose.setInwardEnabled'] = {
    cap: 'admin.masters',
    run(db, a, p, ctx) {
      const x = (db.inwardPurposes || []).find(y => y.code === p.code) || missing('Inward purpose');
      x.disabled = !bool(p.enabled);
      need(db.inwardPurposes.some(y => !y.disabled), 'Keep at least one inward purpose enabled.');
      audit(db, a, ctx.now, 'POLICY', `Inward purpose ${x.code} ${x.disabled ? 'disabled' : 'enabled'}`);
      return { message: `${x.code} ${x.disabled ? 'disabled' : 'enabled'}.` };
    },
  };
  C['compliance.setRule'] = {
    cap: 'admin.masters',
    run(db, a, p, ctx) {
      const r = (db.complianceRules || []).find(x => x.id === p.id) || missing('Compliance rule');
      const changes = [];
      if (p.enabled !== undefined) { r.enabled = bool(p.enabled); changes.push(r.enabled ? 'switched on' : 'switched off'); }
      if (p.weight !== undefined && p.weight !== '') {
        const w = Number(p.weight);
        need(isFinite(w) && w >= 0 && w <= 100, 'A weight must be between 0 and 100.');
        r.weight = Math.round(w); changes.push('weight ' + r.weight);
      }
      if (p.param !== undefined && p.param !== '') {
        if (Array.isArray(r.param)) {
          const list = (Array.isArray(p.param) ? p.param : String(p.param).split(/[,\n]/)).map(x => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, 60);
          need(list.length, 'Enter at least one entry.');
          r.param = list; changes.push(list.length + ' entries');
        } else if (r.param != null) {
          const v = Number(p.param);
          need(isFinite(v) && v > 0, 'The threshold must be a positive number.');
          r.param = round2(v); changes.push('threshold ' + fmt(r.param));
        }
      }
      need(changes.length, 'Nothing to change.');
      audit(db, a, ctx.now, 'COMPLIANCE', `${r.label}: ${changes.join(', ')}`);
      return { message: `${r.label} updated. New submissions are scored with it.` };
    },
  };

  /* ---------- users ------------------------------------------------------------ */
  const loginOf = (db, d, l) => (db.logins || []).find(x => x.domainId === String(d || '').trim().toUpperCase() && x.loginId === String(l || '').trim().toUpperCase());
  function readPassword(raw) {
    raw = String(raw || '');
    need(raw.length >= 8 && raw.length <= 72, 'Choose a password of at least 8 characters.');
    need(/[A-Za-z]/.test(raw) && /[0-9]/.test(raw), 'Use at least one letter and one digit in the password.');
    return raw;
  }
  C['user.add'] = {
    cap: 'admin.users',
    run(db, a, p, ctx) {
      const u = p.user || {};
      const domainId = txt(String(u.domainId || '').toUpperCase(), 'Domain ID', { max: 12, pattern: /^[A-Z0-9]{2,12}$/, patternMsg: 'Domain ID must be 2–12 capital letters or digits.' });
      const loginId = txt(String(u.loginId || '').toUpperCase(), 'Login ID', { max: 20, pattern: /^[A-Z0-9]{3,20}$/, patternMsg: 'Login ID must be 3–20 capital letters or digits.' });
      need(!loginOf(db, domainId, loginId), `${domainId}/${loginId} already exists.`);
      const name = txt(u.name, 'Name', { max: 100 });
      let role, smeId = null;
      if (domainId === 'AD2') role = oneOf(u.role, db.roles.filter(r => r.portal === 'AD2').map(r => r.id), 'Role');
      else {
        const s = db.smes.find(x => x.domainId === domainId);
        need(s, `No SME uses Domain ID ${domainId}.`);
        need(s.status === 'Approved', 'SME users can be added once the SME is approved.');
        role = 'SME User'; smeId = s.id;
      }
      const pw = u.password && ctx.hashPassword ? ctx.hashPassword(readPassword(u.password)) : null;
      db.logins.push({ domainId, loginId, role, smeId, name, demo: !pw, ...(pw ? { pw } : {}), active: true, addedBy: actorLabel(a), addedAt: ctx.now });
      audit(db, a, ctx.now, 'USERS', `User ${domainId}/${loginId} (${name}) added as ${role}`);
      return { message: `${domainId}/${loginId} added as ${role}. ${pw ? 'They sign in with the password you set.' : 'They sign in with the demo passcode.'}` };
    },
  };
  C['user.setActive'] = {
    cap: 'admin.users',
    run(db, a, p, ctx) {
      const l = loginOf(db, p.domainId, p.loginId) || missing('User');
      const on = bool(p.active);
      need(!(l.domainId === a.domainId && l.loginId === a.loginId) || on, 'You cannot deactivate your own user.');
      if (!on && l.role === 'AD2 Administrator')
        need(db.logins.some(x => x !== l && x.role === 'AD2 Administrator' && x.active !== false), 'Keep at least one active Administrator.');
      l.active = on;
      audit(db, a, ctx.now, 'USERS', `User ${l.domainId}/${l.loginId} ${on ? 'reactivated' : 'deactivated'}`);
      return { message: `${l.domainId}/${l.loginId} ${on ? 'can sign in again' : 'is deactivated and cannot sign in'}.` };
    },
  };
  C['user.setRole'] = {
    cap: 'admin.users',
    run(db, a, p, ctx) {
      const l = loginOf(db, p.domainId, p.loginId) || missing('User');
      need(l.domainId === 'AD2', 'Only AD2 users change role here. SME roles follow the application status.');
      need(!(l.domainId === a.domainId && l.loginId === a.loginId), 'You cannot change your own role.');
      const role = oneOf(p.role, db.roles.filter(r => r.portal === 'AD2').map(r => r.id), 'Role');
      if (l.role === 'AD2 Administrator' && role !== l.role)
        need(db.logins.some(x => x !== l && x.role === 'AD2 Administrator' && x.active !== false), 'Keep at least one active Administrator.');
      const was = l.role; l.role = role;
      audit(db, a, ctx.now, 'USERS', `User ${l.domainId}/${l.loginId} role changed: ${was} → ${role}`);
      return { message: `${l.domainId}/${l.loginId} is now ${role}. It takes effect on their next action.` };
    },
  };
  C['user.resetPassword'] = {
    cap: 'admin.users',
    run(db, a, p, ctx) {
      const l = loginOf(db, p.domainId, p.loginId) || missing('User');
      delete l.pw; l.demo = true;
      audit(db, a, ctx.now, 'USERS', `Password reset for ${l.domainId}/${l.loginId} — signs in with the demo passcode`);
      return { message: `${l.domainId}/${l.loginId} now signs in with the demo passcode.` };
    },
  };

  /* ---------- test data lab ------------------------------------------------------
     Makes fresh, realistic data on demand so any flow can be run again once
     the seeded items are used up: whole new businesses (approved, or as an
     application waiting for review), more accepted bills and receipts for a
     business, and requests parked at each workflow stage. Everything it
     creates is marked test:true and is stamped as coming from the lab.     */
  const LAB_PARTIES = {
    USD: { supplier: ['Pacific Rim Components Inc', 'United States', 'Bank of America', 'BOFAUS3N'], buyer: ['Atlantic Home Stores Inc', 'United States'] },
    EUR: { supplier: ['Rheinwerk Maschinen GmbH', 'Germany', 'Deutsche Bank', 'DEUTDEFF'], buyer: ['Maison Durand SARL', 'France'] },
    GBP: { supplier: ['Thames Industrial Supplies Ltd', 'United Kingdom', 'HSBC UK', 'HBUKGB4B'], buyer: ['Halden Retail plc', 'United Kingdom'] },
    AED: { supplier: ['Emirates Trade Hub FZE', 'United Arab Emirates', 'Emirates NBD', 'EBILAEAD'], buyer: ['Gulf Retail LLC', 'United Arab Emirates'] },
    SGD: { supplier: ['Lion City Logistics Pte Ltd', 'Singapore', 'DBS Bank', 'DBSSSGSG'], buyer: ['Straits Merchants Pte Ltd', 'Singapore'] },
    JPY: { supplier: ['Osaka Seimitsu KK', 'Japan', 'MUFG Bank', 'BOTKJPJT'], buyer: ['Kyoto Trading Co', 'Japan'] },
    CHF: { supplier: ['Basel Chem Supplies AG', 'Switzerland', 'UBS Switzerland', 'UBSWCHZH80A'], buyer: ['Alpine Pharma AG', 'Switzerland'] },
    AUD: { supplier: ['Southern Cross Traders Pty Ltd', 'Australia', 'ANZ', 'ANZBAU3M'], buyer: ['Koala Living Pty Ltd', 'Australia'] },
  };
  const party = cur => LAB_PARTIES[cur] || LAB_PARTIES.USD;
  const ymd = iso => iso.slice(0, 10);
  const labStamp = (now, verb) => ({ by: 'Test data lab', key: 'LAB/DATA', at: now, verb: verb || 'generated' });
  const LAB = {
    sme: { domainId: 'LAB', loginId: 'SME', role: 'SME User', name: 'Test data lab', actingFor: null },
    maker: { domainId: 'LAB', loginId: 'MAKER', role: 'AD2 Maker', name: 'Test data lab', smeId: null, actingFor: null },
    checker: { domainId: 'LAB', loginId: 'CHECKER', role: 'AD2 Checker', name: 'Test data lab', smeId: null, actingFor: null },
  };
  function labAmount(db, cur, usd) {
    const r = ((currencyOf(db, 'USD') || {}).refRate || 88) / ((currencyOf(db, cur) || {}).refRate || 88);
    const v = usd * r;
    const step = v > 1e6 ? 10000 : 100;
    return Math.max(step, Math.round(v / step) * step);
  }
  const labDoc = (name, now) => ({ filename: name, size: (140 + name.length * 7) + ' KB', type: 'application/pdf', at: now });

  function labBills(db, s, now, type, count, opts) {
    const ids = [];
    const curs = (s.config.currencies || ['USD']).slice(0, 2);
    const k = seq(db, 'lab');
    for (let j = 0; j < count; j++) {
      const cur = curs[j % curs.length];
      const [cp, cc] = type === 'Export' ? party(cur).buyer : party(cur).supplier;
      const usd = [18000, 42000, 26500, 61000, 9500][(j + k) % 5] * (1 + (k % 5) * 0.04);
      const amt = labAmount(db, cur, usd);
      const n = seq(db, 'lab');
      const accepted = !(opts && opts.pendingLast && j === count - 1);
      const id = nextId(db.bills, 'BL', 5);
      db.bills.unshift({ id, smeId: s.id, type, invoiceNumber: `${s.domainId.slice(0, 4)}/${type === 'Export' ? 'EXP' : 'IMP'}/${now.slice(2, 4)}/${String(n).padStart(4, '0')}`,
        invoiceDate: ymd(addDays(now, -12 - j * 3)), counterparty: cp, counterpartyCountry: cc, currency: cur, amount: amt, adjusted: 0, outstanding: amt,
        dueDate: ymd(addDays(now, 60 + j * 10)), orderRef: `PO-${String(40000 + n)}`, shipmentRef: `${type === 'Export' ? 'SB' : 'BOE'}-${String(7800000 + n * 13)}`,
        source: 'Test data lab', review: accepted ? 'Accepted' : 'Submitted', settlement: 'Unsettled',
        docs: { invoice: labDoc(`${type.toLowerCase()}-invoice-${n}.pdf`, now) }, lodgedBy: labStamp(now, 'lodged'),
        ...(accepted ? { acceptedBy: labStamp(now, 'accepted') } : {}), test: true });
      ids.push(id);
    }
    return ids;
  }
  function labReceipt(db, s, now, cur, amt, remark) {
    const [rm, rc] = party(cur).buyer;
    const id = nextId(db.inward, 'IR');
    db.inward.unshift({ id, smeId: s.id, reference: `SWF-INW-${seq(db, 'inw')}`, valueDate: ymd(now), remitter: rm, remitterCountry: rc,
      currency: cur, amount: amt, available: amt, status: 'Awaiting Instruction', remittanceType: 'TRADE', purposeCode: '',
      remarks: remark || '', firc: null, recordedBy: labStamp(now, 'recorded'), test: true });
    return id;
  }
  /* A set of accepted bills and matching receipts for one business. */
  function labTopUp(db, s, now) {
    const pm = perm(s), made = { bills: [], receipts: [] };
    if (pm.importSide) made.bills.push(...labBills(db, s, now, 'Import', 4, { pendingLast: true }));
    if (pm.exportSide) {
      const ex = labBills(db, s, now, 'Export', 4, { pendingLast: true });
      made.bills.push(...ex);
      const [b1, b2] = ex.map(id => find(db.bills, id));
      made.receipts.push(labReceipt(db, s, now, b1.currency, b1.amount, `Full settlement of ${b1.invoiceNumber}`));
      made.receipts.push(labReceipt(db, s, now, b2.currency, round2(Math.round(b2.amount * 1.4 / 100) * 100), `Against ${b2.invoiceNumber} plus advance for the next order`));
      const c2 = (s.config.currencies || [])[1] || b1.currency;
      made.receipts.push(labReceipt(db, s, now, c2, labAmount(db, c2, 15000), 'Advance for an order not yet shipped'));
    }
    db.accounts.filter(x => x.smeId === s.id && x.currency === 'INR' && x.verified).forEach(x => { x.balance = Math.max(x.balance || 0, 50000000); });
    return made;
  }
  function labDomain(db, key) {
    const taken = d => d === 'AD2' || db.smes.some(s => s.domainId === d) || db.logins.some(l => l.domainId === d);
    if (!taken(key)) return key;
    for (let k = 2; k < 1000; k++) { const d = key.slice(0, 12 - String(k).length) + k; if (!taken(d)) return d; }
    fail('No free Domain ID for this profile.');
  }
  function labCreateSme(db, prof, stage, now) {
    const domainId = labDomain(db, prof.key);
    const n = seq(db, 'lab');
    const suffix = domainId === prof.key ? '' : ' ' + domainId.replace(/^[A-Z]+/, '#');
    const letters = (prof.key + 'XXXX').replace(/[^A-Z]/g, '');
    const kind = prof.constitution === 'Proprietorship' ? 'P' : prof.constitution === 'Partnership' ? 'F' : 'C';
    const pan = letters.slice(0, 3) + kind + letters[3] + String(1000 + (n * 37) % 9000).padStart(4, '0') + 'Z';
    const id = nextId(db.smes, 'SME');
    const approved = stage !== 'applicant';
    const cur0 = prof.currencies[0];
    const docs = {}; (db.onboardDocs || []).forEach(d => { docs[d.id] = labDoc(`${domainId}-${d.id}.pdf`, now); });
    const s = { id, legalName: prof.legalName + suffix, tradingName: prof.tradingName + suffix, constitution: prof.constitution,
      incorporationDate: '2017-06-15', regNumber: `U${String(10000 + n)}${prof.state}2017PTC${String(100000 + n * 7)}`, country: 'India',
      address: `Plot ${10 + (n % 80)}, Industrial Area, ${prof.city}`, domainId, ad2Name: 'AD2 Trade Services', category: 'SME',
      pan, gstin: prof.state + pan + '1Z' + String(n % 10), iec: pan,
      contactName: prof.contact, designation: 'Director', email: `${domainId.toLowerCase()}@test.example`, mobile: `+91 90000 ${String(10000 + n).slice(-5)}`,
      industry: prof.industry, description: `Test business — ${prof.industry}.`, expectedVolume: 'USD 2,500,000',
      requestedCurrencies: prof.currencies.slice(), service: prof.permission, source: 'Test data lab', createdBy: 'Test data lab',
      status: approved ? 'Approved' : 'Submitted', pendingWith: approved ? '—' : 'AD2 Maker', submittedAt: now, approvedAt: approved ? now : null,
      docs, config: null, test: true, profile: prof.key };
    if (approved) {
      const margins = {}; prof.currencies.forEach((c, j) => { margins[c] = Math.round(45 * ((currencyOf(db, c) || {}).marginMultiplier ?? 1)) + j; });
      s.config = { permission: prof.permission, currencies: prof.currencies.slice(), margins, marginBasis: 'paise',
        charges: [{ category: 'txn', name: 'Transaction handling fee', basis: 'Fixed', value: 500, currency: 'INR', frequency: 'Per transaction' },
                  { category: 'swift', name: 'SWIFT charge', basis: 'Fixed', value: 750, currency: 'INR', frequency: 'Per transaction' }],
        effectiveDate: ymd(now), remarks: 'Test data pricing.' };
      s.approvedBy = labStamp(now, 'approved');
    }
    db.smes.push(s);
    const acct = (bank, ifsc, cur, type, verified, balance, primary) => db.accounts.push({ id: nextId(db.accounts, 'BA', 3), smeId: id, holder: s.legalName, bank,
      branch: prof.city, accountNumber: String(50200000000000 + n * 1000 + db.accounts.length), ifsc, currency: cur, type, verified,
      verifiedOn: verified ? now : null, primary, balance, test: true });
    acct('HDFC Bank', 'HDFC0001234', 'INR', 'Current', approved, 50000000, true);
    acct('ICICI Bank', 'ICIC0004321', 'INR', 'Current', false, 2000000, false);
    if (prof.permission !== 'Import') acct('HDFC Bank', 'HDFC0001234', cur0, 'EEFC', approved, labAmount(db, cur0, 5000), false);
    db.logins.push({ domainId, loginId: approved ? 'SMEUSER' : 'APPLICANT', role: approved ? 'SME User' : 'SME Applicant', smeId: id,
      name: prof.contact, demo: true, test: true });
    if (approved && perm(s).importSide) {
      prof.currencies.slice(0, 3).forEach(c => {
        const [nm, ct, bk, sw] = party(c).supplier;
        db.beneficiaries.push({ id: nextId(db.beneficiaries, 'BEN', 3), smeId: id, name: nm, country: ct, bank: bk, bankCountry: ct, swift: sw,
          accountNumber: `${ct.slice(0, 2).toUpperCase()}${String(7700000000 + n * 10 + db.beneficiaries.length)}`, currency: c,
          relationship: 'Supplier', address: ct, addedBy: 'Test data lab', addedOn: now, lastUsed: null, test: true });
      });
      db.beneficiaries.push({ id: nextId(db.beneficiaries, 'BEN', 3), smeId: id, name: 'Blocked Trading LLC', country: 'Iran', bank: 'Bank Melli Iran',
        bankCountry: 'Iran', swift: 'MELIIRTH', accountNumber: `IR${String(8800000000 + n)}`, currency: 'USD',
        relationship: 'Test only — watchlist and high-risk country, scores High', address: 'Tehran', addedBy: 'Test data lab', addedOn: now, lastUsed: null, test: true });
    }
    if (approved) labTopUp(db, s, now);
    return s;
  }
  function labActorOk(db, a, s) {
    need(db.settings.testLab !== false, 'The test data lab is switched off in Administration → Settings.');
    if (!isAD2(a)) need(a.smeId === s.id, 'You can generate test data only for your own business.');
  }
  C['lab.createSme'] = {
    cap: 'lab.use',
    run(db, a, p, ctx) {
      need(db.settings.testLab !== false, 'The test data lab is switched off in Administration → Settings.');
      need(isAD2(a), 'New test businesses are created from the AD2 portal.');
      const prof = (db.testSmes || []).find(x => x.key === p.profile) || missing('Test profile');
      const stage = oneOf(p.stage || 'approved', ['approved', 'applicant'], 'Stage');
      const s = labCreateSme(db, prof, stage, ctx.now);
      const login = db.logins.find(l => l.smeId === s.id);
      audit(db, a, ctx.now, s.id, `Test business created from the ${prof.key} profile — ${stage === 'approved' ? 'approved with accounts, beneficiaries, bills and receipts' : 'application submitted for review'}`);
      if (stage === 'applicant') notify(db, ctx.now, { toRole: 'AD2 Maker', text: `New test application ${s.id} — ${s.legalName}`, link: '#/ad2/applications/' + s.id });
      return { smeId: s.id, domainId: login.domainId, loginId: login.loginId,
               message: `${s.tradingName} created (${s.id}). Sign in as ${login.domainId} / ${login.loginId} with the demo passcode.` };
    },
  };
  C['lab.topUp'] = {
    cap: 'lab.use',
    run(db, a, p, ctx) {
      const s = smeOf(db, p.smeId || a.smeId) || missing('SME');
      labActorOk(db, a, s);
      need(s.status === 'Approved', 'Only an approved business can receive test bills and receipts.');
      const made = labTopUp(db, s, ctx.now);
      audit(db, a, ctx.now, s.id, `Test data added — ${made.bills.length} bill(s), ${made.receipts.length} receipt(s); INR balances topped up`);
      if (made.receipts.length) notify(db, ctx.now, { toSmeId: s.id, text: `${made.receipts.length} test receipt(s) waiting for a disposal instruction`, link: '#/sme/inward' });
      return { ...made, message: `Added ${made.bills.length} bill${made.bills.length === 1 ? '' : 's'}${made.receipts.length ? ` and ${made.receipts.length} receipts` : ''} for ${s.tradingName}.` };
    },
  };
  /* Parks real requests at each stage by running the real commands as lab
     users, so every check (documents, rates, reservations) still applies. */
  C['lab.queue'] = {
    cap: 'lab.use',
    run(db, a, p, ctx) {
      const s = smeOf(db, p.smeId || a.smeId) || missing('SME');
      labActorOk(db, a, s);
      need(s.status === 'Approved', 'Only an approved business can have requests generated.');
      const pm = perm(s), out = [], now = ctx.now;
      const sme = { ...LAB.sme, smeId: s.id };
      const acc = db.accounts.find(x => x.smeId === s.id && x.currency === 'INR' && x.verified);
      need(acc, `${s.tradingName} has no verified INR account.`);
      const docsFor = (prod, purpose, inrAmt, opts) => {
        const d = {}; checklist(db, prod, purpose, inrAmt, opts).forEach(x => { d[x.id] = labDoc(`${x.id}-${seq(db, 'lab')}.pdf`, now); }); return d;
      };
      const dec = { fema: true, ofac: true };
      const run = (cmd, actor, payload) => C[cmd].run(db, actor, payload, ctx);
      if (pm.importSide) {
        const freeBills = () => db.bills.filter(b => b.smeId === s.id && b.test && b.type === 'Import' && b.review === 'Accepted' && billAvailable(db, b) > 0);
        if (freeBills().length < 2) labBills(db, s, now, 'Import', 3);
        const outward = (prod, purpose, bill, stages) => {
          const bene = db.beneficiaries.find(b => b.smeId === s.id && b.currency === (bill ? bill.currency : s.config.currencies[0]) && b.name !== 'Blocked Trading LLC')
                    || db.beneficiaries.find(b => b.smeId === s.id && b.name !== 'Blocked Trading LLC');
          need(bene, `${s.tradingName} has no beneficiary to pay.`);
          const cur = bill ? bill.currency : (bene.currency || s.config.currencies[0]);
          const amt = bill ? billAvailable(db, bill) : labAmount(db, cur, 12000);
          const rate = customerRate(db, cur, marginFor(db, s, cur));
          const r = run('outward.submit', sme, { draft: {
            beneficiaryId: bene.id, beneficiary: bene.name, beneficiaryCountry: bene.country, beneficiaryBank: bene.bank,
            beneficiaryBankCountry: bene.bankCountry, beneficiaryAccount: bene.accountNumber, swift: bene.swift,
            referenceNumber: 'LAB-' + seq(db, 'lab'), executionDate: ymd(addDays(now, 2)), remittanceType: prod, purposeCode: purpose,
            currency: cur, amount: amt, debitAccountId: acc.id, rate: { mode: 'booked', bookedAt: now },
            lcNumber: prod === 'LC' ? 'LC/' + now.slice(2, 4) + '/' + seq(db, 'lab') : '',
            docs: docsFor(prod, purpose, amt * rate), allocations: bill ? [{ billId: bill.id, amount: amt }] : [], declarations: dec } });
          const note = { note: 'Generated by the test data lab' };
          if (stages > 1) run('outward.verify', LAB.maker, { id: r.id, checks: { documents: true, sanctions: true, purpose: true, beneficiary: true }, ...note });
          if (stages > 2) run('outward.authorise', LAB.checker, { id: r.id, ...note });
          out.push(r.id);
        };
        const fb = freeBills();
        outward('DIR', 'S0102', fb[0], 1);
        outward('LC', 'S0101', fb[1], 2);
        outward('AIR', 'S0101', null, 3);
      }
      if (pm.exportSide) {
        const freeReceipt = () => db.inward.find(i => i.smeId === s.id && i.test && i.available > 0);
        if (!freeReceipt()) labTopUp(db, s, now);
        const rc = freeReceipt();
        const bill = db.bills.find(b => b.smeId === s.id && b.test && b.type === 'Export' && b.review === 'Accepted' && b.currency === rc.currency && billAvailable(db, b) > 0);
        const applied = bill ? Math.min(billAvailable(db, bill), rc.available) : 0;
        const option = applied > 0 ? 'knockoff' : 'advance';
        const r = run('disposal.submit', sme, { draft: { inwardId: rc.id, amount: rc.available, option, purposeCode: 'TRADE', creditAccountId: acc.id,
          rate: { mode: 'booked', bookedAt: now }, allocations: applied > 0 ? [{ billId: bill.id, amount: applied }] : [],
          docs: docsFor('TRADE', 'TRADE', 0, { option }), declarations: dec, remarks: 'Generated by the test data lab' } });
        out.push(r.id);
      }
      audit(db, a, ctx.now, s.id, `Test requests generated for ${s.tradingName}: ${out.join(', ')}`);
      return { ids: out, message: `Generated ${out.join(', ')} — parked at submitted, verified and authorised stages.` };
    },
  };
  /* The master test user opens the platform as someone else. It gains no
     authority of its own: the server issues a session for the user it opens,
     so every step is recorded against that user and four-eyes still holds. */
  C['test.actAs'] = {
    cap: 'test.master',
    run(db, a, p, ctx) {
      need(db.settings.testLab !== false, 'Test tools are switched off in Administration → Settings.');
      const t = loginOf(db, p.domainId, p.loginId);
      if (!t) missing('User');
      need(!can(db, { role: t.role }, 'test.master'), 'Open a customer or AD2 user, not another master test user.');
      need(t.active !== false, `${t.domainId}/${t.loginId} is deactivated.`);
      const s = t.smeId && smeOf(db, t.smeId);
      need(!(s && s.status === 'Rejected'), 'This business was rejected, so it cannot sign in.');
      audit(db, a, ctx.now, 'USERS', `Opened the platform as ${t.domainId}/${t.loginId} (${t.name || t.role}) for testing`, true);
      return { message: `Now testing as ${t.name || t.loginId} — ${t.role}.`, domainId: t.domainId, loginId: t.loginId };
    },
  };

  C['assist.open'] = {
    cap: 'assist.transact',
    run(db, a, p, ctx) {
      const s = smeOf(db, p.smeId);
      need(s && s.status === 'Approved', 'Only an approved SME can be transacted for.');
      audit(db, { ...a, actingFor: null }, ctx.now, s.id, `Assisted journey opened by ${a.name || a.role}`);
      return { message: 'Acting for ' + s.tradingName + '.' };
    },
  };

  /* ======================================================================== */
  function execute(db, who, cmd, payload, ctx) {
    const def = C[cmd];
    if (!def) throw new EngineError('Unknown action: ' + cmd, 'unknown', 400);
    payload = payload && typeof payload === 'object' ? payload : {};
    ctx = { now: new Date().toISOString(), ...(ctx || {}) };
    const a = resolveActor(db, who, payload.actingFor || (who && who.actingFor));
    if (!a && !def.public) throw new EngineError('Sign in to continue.', 'auth', 401);
    if (a && a.smeId) {
      const own = smeOf(db, a.smeId);
      if (own && own.status === 'Rejected') forbid('This application was rejected. Access is not available.');
    }
    if (def.cap) requireCap(db, a, def.cap);
    T.sweep(db, ctx.now);
    const result = def.run(db, a, payload, ctx) || {};
    db.rev = (db.rev || 0) + 1;
    return result;
  }

  /* ---------- what each user may see -------------------------------------- */
  const publicLogin = db => l => ({ domainId: l.domainId, loginId: l.loginId, role: l.role, smeId: l.smeId, name: l.name,
    branchScope: l.branchScope || null, agentName: l.agentName || null,
    demo: !!l.demo, active: l.active !== false, test: !!l.test, addedAt: l.addedAt || null,
    tradingName: (smeOf(db, l.smeId) || {}).tradingName || '' });
  const MASTER_KEYS = ['version', 'rev', 'currencies', 'constitutions', 'purposeCodes', 'products', 'docPolicy', 'goodsCodes',
    'inwardPurposes', 'disposalOptions', 'testSmes', 'capabilities', 'roles', 'chargeCategories', 'onboardDocs', 'settings'];
  const BUSINESS_KEYS = ['smes', 'accounts', 'beneficiaries', 'bills', 'outward', 'inward', 'disposals', 'allocations', 'jobs', 'audit', 'notifications'];

  function scopeState(db, who) {
    const out = {};
    MASTER_KEYS.forEach(k => { out[k] = clone(db[k]); });
    let a = null;
    try { a = resolveActor(db, who, null); } catch (e) { a = null; }
    /* Sign-in shortcuts list the shared demo accounts; a password account is
       visible only to AD2 and to its own business. */
    const master = !!a && can(db, a, 'test.master');
    out.logins = db.logins.filter(l => l.demo && l.active !== false || (a && (isAD2(a) || master || l.smeId === a.smeId))).map(publicLogin(db));
    /* Reference rates are AD2's: a customer (or anyone signed out) sees only
       its own ready-made rate, never the rate its margin is added to. */
    const hideRef = () => { out.currencies = out.currencies.map(c => { const { refRate, marginMultiplier, marketBase, ...rest } = c; return rest; }); };
    if (!a) { BUSINESS_KEYS.forEach(k => { out[k] = []; }); hideRef(); T.scope(out, db, null, 'public'); X.scope(out, db, null, 'public'); out.scope = 'public'; return out; }
    /* Treasury Management Portal users (treasury, branch, agent, bulk,
       finance) see the book as their role and branch scope allow. */
    const kind = X.scopeKind(db, a);
    const role = roleDef(db, a.role) || {};
    if (role.portal === 'TMP' && !master) {
      if (kind === 'full') {
        BUSINESS_KEYS.forEach(k => { out[k] = clone(db[k] || []); });
        T.scope(out, db, a, 'treasury');
      } else {
        BUSINESS_KEYS.forEach(k => { out[k] = []; });
        T.scope(out, db, a, 'public');
        /* the trade customers a branch may quote (a quote becomes their FX deal) */
        out.smes = db.smes.filter(s => s.status === 'Approved').map(s => ({ id: s.id, legalName: s.legalName, tradingName: s.tradingName, gstin: s.gstin,
          domainId: s.domainId, status: s.status, branchId: s.branchId, config: { currencies: ((s.config || {}).currencies || []).slice() } }));
      }
      X.scope(out, db, a, kind);
      const seen = new Set([...(out.positions || []).map(p => p.id), ...(out.quotes || []).map(q => q.id), ...(out.approvals || []).map(x => x.id)]);
      if (kind !== 'full') out.audit = clone(db.audit.filter(x => seen.has(x.record)));
      out.notifications = clone((db.notifications || []).filter(n => n.toRole === a.role));
      out.scope = 'tmp-' + kind;
      return out;
    }
    if (isAD2(a) || master) {
      BUSINESS_KEYS.forEach(k => { out[k] = clone(db[k] || []); });
      out.complianceRules = clone(db.complianceRules || []);
      out.notifications = out.notifications.filter(n => n.toRole === a.role);
      T.scope(out, db, a, master || can(db, a, 'treasury.view') ? 'treasury' : 'ad2');
      X.scope(out, db, a, master || kind === 'full' ? 'full' : 'trade');
      out.scope = master ? 'master' : 'ad2';
      return out;
    }
    const sid = a.smeId;
    const mine = r => r.smeId === sid;
    /* The customer sees its own rate, never AD2's margin or the reference
       rate it is built from. */
    const hideMargin = r => { if (r.rate) { delete r.rate.margin; delete r.rate.refRate; } return r; };
    const strip = r => { delete r.notes; delete r.risk; if (r.wf) Object.values(r.wf).forEach(w => { if (w) delete w.note; }); return hideMargin(r); };
    hideRef();
    T.scope(out, db, a, 'sme');
    /* whether a currency can be booked today, never the card rate itself */
    X.scope(out, db, a, 'trade');
    out.rateDesk = out.rateDesk.filter(r => ['REM', 'INW'].includes(r.product)).map(r => ({ product: r.product, currency: r.currency, status: r.status }));
    out.smes = clone(db.smes.filter(s => s.id === sid)).map(s => {
      delete s.notes; delete s.pendingConfig; delete s.reviewedBy; delete s.dupFlags;
      if (s.config) {
        delete s.config.remarks;
        const live = smeOf(db, s.id);
        s.config.customerRates = {};
        (s.config.currencies || []).forEach(c => {
          const m = marginFor(db, live, c);
          s.config.customerRates[c] = { out: customerRate(db, c, m), in: customerRate(db, c, -m) };
        });
        delete s.config.margins; delete s.config.marginBasis;
      }
      return s;
    });
    ['accounts', 'beneficiaries', 'bills', 'inward', 'allocations', 'jobs'].forEach(k => { out[k] = clone((db[k] || []).filter(mine)); });
    out.outward = clone(db.outward.filter(mine)).map(strip);
    out.disposals = clone(db.disposals.filter(mine)).map(strip);
    const ids = new Set([sid, ...out.outward.map(x => x.id), ...out.inward.map(x => x.id), ...out.disposals.map(x => x.id),
                         ...out.bills.map(x => x.id), ...out.jobs.map(x => x.id), ...out.positions.map(x => x.id)]);
    out.audit = clone(db.audit.filter(x => ids.has(x.record) && !x.internal));
    out.notifications = clone((db.notifications || []).filter(n => n.toSmeId === sid));
    out.scope = 'sme';
    return out;
  }

  /* Public application tracker: needs both the application ID and Domain ID. */
  function publicStatus(db, appId, domainId) {
    const s = db.smes.find(x => x.id === String(appId || '').trim().toUpperCase() &&
                                x.domainId === String(domainId || '').trim().toUpperCase());
    if (!s) return null;
    return { id: s.id, legalName: s.legalName, domainId: s.domainId, source: s.source, submittedAt: s.submittedAt,
             status: s.status, pendingWith: s.pendingWith || smePendingWith(s.status),
             query: s.status === 'Clarification Required' && s.query ? s.query.question : null };
  }

  return {
    EngineError, freshState, execute, scopeState, publicStatus, resolveActor,
    checklist, purposesFor, marginFor, customerRate, chargesFor, billAvailable, perm, can,
    actorKey, actorLabel, smePendingWith, OPEN, COMMANDS: Object.keys(C),
    /* read-only treasury views, shared by every screen so they agree */
    treasury: { positionStatus: T.positionStatus, coverState: T.coverState, linkState: T.linkState, uncovered: T.uncovered, live: T.live,
      remaining: T.remaining, isTrade: T.isTrade, netByCurrency: T.netByCurrency, suggestions: T.suggestions, marketRate: T.marketRate,
      pnl: T.pnl, exceptions: T.exceptions, pastCutoff: T.pastCutoff, istDate: T.istDate },
    /* read-only Treasury Management Portal views */
    tmp: { ...X.views, scopeKind: X.scopeKind },
  };
});
