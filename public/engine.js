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
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
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
  function checklist(db, productId, purposeCode, inrAmount) {
    return (db.docPolicy || []).filter(d => d.product === productId).map(d => {
      let required = d.rule === 'required', note = '';
      if (d.rule === 'optional') note = 'Optional';
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

  /* A booked rate is recomputed here from the currency master — the client's
     figure is never trusted. A deal reference must sit within 3% of the
     reference rate. */
  function settleRate(db, s, cur, rate, dir, now) {
    const m = marginFor(db, s, cur);
    const ref = (currencyOf(db, cur) || {}).refRate || 0;
    const expect = customerRate(db, cur, dir === 'out' ? m : -m);
    rate = rate || {};
    if (rate.mode === 'booked') {
      const at = rate.bookedAt && !isNaN(new Date(rate.bookedAt)) ? new Date(rate.bookedAt).toISOString() : now;
      const age = (new Date(now) - new Date(at)) / 3600000;
      if (age > 48) fail('The booked rate has expired (48-hour lock). Book the rate again.');
      if (age < -0.1) fail('The rate booking time is in the future.');
      return { mode: 'booked', refRate: ref, margin: m, customerRate: expect, bookedAt: at,
               expiresAt: addHours(at, 48), dealRef: null };
    }
    if (rate.mode === 'deal') {
      const dealRef = txt(rate.dealRef, 'FX deal reference', { max: 30, pattern: /^[A-Za-z0-9\-\/]{4,30}$/,
        patternMsg: 'FX deal reference should be 4–30 letters, digits or dashes.' });
      let r = Number(rate.customerRate);
      if (!isFinite(r) || r <= 0) r = expect;
      if (Math.abs(r - ref) / ref > 0.03) fail(`The agreed rate ${r} is more than 3% away from the reference rate ${ref}. Check the deal.`);
      return { mode: 'deal', refRate: ref, margin: m, customerRate: +r.toFixed(4), bookedAt: null, expiresAt: null, dealRef };
    }
    fail('Book a rate or enter an FX deal reference.');
  }

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
  function audit(db, a, now, record, action) {
    const who = a ? actorLabel(a) : 'Public';
    const behalf = a && a.actingFor ? ` on behalf of ${(smeOf(db, a.actingFor) || {}).tradingName || a.actingFor}` : '';
    db.audit.unshift({ id: 'AU-' + seq(db, 'audit'), record, actor: who + behalf, action, at: now });
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
      if (b.currency !== currency) fail(`Bill ${b.id} is in ${b.currency}, not ${currency}.`);
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
  function freshState(SEED) {
    const db = clone(SEED);
    db.rev = 0;
    /* Seeded transactions carry the documents their policy asked for. */
    const fill = (rec, product, purpose, inrAmt) => {
      if (rec.status === 'Draft') return;
      rec.docs = rec.docs && Object.keys(rec.docs).length ? rec.docs : {};
      checklist(db, product, purpose, inrAmt).forEach(d => {
        if (d.required || d.rule === 'goods') rec.docs[d.id] = rec.docs[d.id] ||
          { filename: `${rec.id}-${d.id}.pdf`, size: (120 + d.id.length * 37) + ' KB', type: 'application/pdf', at: rec.requestDate || rec.submittedAt };
      });
    };
    db.outward.forEach(o => {
      fill(o, o.remittanceType, o.purposeCode, o.amount * (o.rate.customerRate || 0));
      if (o.rate.customerRate && o.inrAmount == null) {
        o.inrAmount = round2(o.amount * o.rate.customerRate);
        o.debitInr = round2(o.inrAmount + (o.charges || []).reduce((t, c) => t + c.amount, 0));
      }
    });
    db.disposals.forEach(d => fill(d, 'TRADE', '', 0));
    db.smes.forEach(s => {
      s.pendingWith = smePendingWith(s.status);
      if (!s.docs) { s.docs = {}; (db.onboardDocs || []).forEach(d => { s.docs[d.id] = { filename: `${s.id}-${d.id}.pdf`, size: '210 KB', type: 'application/pdf', at: s.submittedAt }; }); }
    });
    return db;
  }
  const smePendingWith = st => ({ 'Submitted': 'AD2 Maker', 'Under Review': 'AD2 Maker', 'Pending Approval': 'AD2 Checker',
                                  'Clarification Required': 'SME', 'Approved': '—', 'Rejected': '—' }[st] || '—');

  /* ======================================================================== */
  /*  Commands                                                                */
  /* ======================================================================== */
  const C = {};

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
      db.smes.push({ ...rest, id, source: offline ? 'Offline' : 'Digital',
        createdBy: offline ? actorLabel(a) : 'SME Applicant', status: 'Submitted', pendingWith: 'AD2 Maker',
        submittedAt: ctx.now, approvedAt: null, config: null });
      banks.forEach((b, i) => db.accounts.push({ id: nextId(db.accounts, 'BA', 3), smeId: id, holder: app.legalName, ...b,
        verifiedOn: b.verified ? ctx.now : null, primary: i === 0, balance: b.currency === 'INR' ? 25000000 : 50000 }));
      db.logins.push({ domainId: app.domainId, loginId, role: 'SME Applicant', smeId: id, name: app.contactName,
        demo: !pw, ...(pw ? { pw } : {}) });
      audit(db, a, ctx.now, id, offline ? 'Offline application captured by AD2' : 'Application submitted through digital onboarding');
      notify(db, ctx.now, { toRole: 'AD2 Maker', text: `New ${offline ? 'offline' : 'digital'} application ${id} — ${app.legalName}`, link: '#/ad2/applications/' + id });
      return { smeId: id, domainId: app.domainId, loginId, message: `Application ${id} submitted.` };
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
    if (!charges.length) errs.push('at least one charge (enter zero if there is none)');
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
      s.status = 'Pending Approval'; s.pendingWith = 'AD2 Checker';
      audit(db, a, ctx.now, s.id, `Review complete — sent to checker with ${cfg.permission} permission, ${cfg.currencies.join('/')}`);
      notify(db, ctx.now, { toRole: 'AD2 Checker', text: `Application ${s.id} (${s.legalName}) is ready for approval`, link: '#/ad2/applications/' + s.id });
      return { message: 'Sent to the checker for approval.' };
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
      notify(db, ctx.now, { toRole: 'AD2 Maker', text: `Application ${s.id} returned by the checker: ${note}`, link: '#/ad2/applications/' + s.id });
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
    if (forDraft) {
      out.docs = docsIn(d.docs);
      return out;
    }
    need(out.remittanceType, 'Select a product (AIR, DIR or OTT).');
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
    o.rate = settleRate(db, s, o.currency, d.rate, 'out', now);
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
      o.allocations = al;
      o.allocatedTotal = total;
    }
    o.inrAmount = inrAmt;
    o.charges = chargesFor(s, o.amount, o.rate.customerRate);
    o.debitInr = round2(inrAmt + o.charges.reduce((t, c) => t + c.amount, 0));
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
      audit(db, a, ctx.now, o.id, `Outward request submitted — ${fmt(o.amount, o.currency)}, ${prod.id} (${prod.label}) under ${o.purposeCode}`);
      audit(db, a, ctx.now, o.id, o.rate.mode === 'booked'
        ? `Rate booked at ${o.rate.customerRate.toFixed(4)}, locked until ${o.rate.expiresAt.slice(0, 16).replace('T', ' ')} UTC — treasury notified`
        : `FX deal reference ${o.rate.dealRef} applied at ${o.rate.customerRate.toFixed(4)}`);
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
      o.wf.verified = { ...stamp(a, ctx.now, 'verified'), note: txt(p.note, 'Note', { max: 500, required: false }) };
      o.status = 'Verified'; o.pendingWith = 'AD2 Checker';
      audit(db, a, ctx.now, o.id, 'Verified — documents, sanctions screening, purpose code and beneficiary checked' + (o.wf.verified.note ? ': ' + o.wf.verified.note : ''));
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
      o.wf.authorised = stamp(a, ctx.now, 'authorised');
      o.status = 'Authorised'; o.pendingWith = 'AD2 Operations';
      audit(db, a, ctx.now, o.id, 'Authorised for payment');
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
        ledger(db, ctx.now, { smeId: o.smeId, side: 'Import', billId: b.id, remKind: 'outward', remId: o.id, amount: x.amount,
                             currency: o.currency, source: 'Outward payment', status: 'Confirmed' });
      });
      if (o.remittanceType === 'AIR') o.boeDueDate = addDays(ctx.now, 90).slice(0, 10);
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

  C['outward.reject'] = {
    cap: 'outward.reject',
    run(db, a, p, ctx) {
      const o = outwardFor(db, p.id);
      need(['Submitted', 'Verified', 'Authorised'].includes(o.status), 'This request can no longer be rejected.');
      const r = txt(p.reason, 'Reason for rejection', { max: 500 });
      o.status = 'Rejected'; o.pendingWith = '—'; o.rejectReason = r;
      o.wf = o.wf || {}; o.wf.rejected = stamp(a, ctx.now, 'rejected');
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
      audit(db, a, ctx.now, id, `Inward SWIFT credit recorded — ${fmt(amt, cur)} from ${rec.remitter}, ${ref}`);
      notify(db, ctx.now, { toSmeId: s.id, text: `${fmt(amt, cur)} received from ${rec.remitter} — submit a disposal instruction`, link: '#/sme/inward/' + id });
      return { id, message: `Receipt ${ref} recorded for ${s.tradingName}.` };
    },
  };

  function inwardStatus(db, i) {
    if (i.available > 0) return 'Awaiting Instruction';
    return db.disposals.some(d => d.inwardId === i.id && OPEN.includes(d.status)) ? 'Instruction Submitted' : 'Processed';
  }

  C['disposal.submit'] = {
    cap: 'inward.dispose',
    run(db, a, p, ctx) {
      const s = ownSme(db, a); requireApproved(s);
      need(perm(s).exportSide, 'Inward disposal requires Export or Both permission.');
      const d = p.draft || {};
      const i = find(db.inward, d.inwardId);
      if (!i || i.smeId !== s.id) missing('Inward receipt');
      need(i.available > 0, 'Nothing is left to dispose on this receipt.');
      const { list: al, total } = allocationsIn(db, s, d.allocations, { type: 'Export', currency: i.currency, cap: i.available, label: 'The amount applied' });
      need(al.length, 'Apply the receipt against at least one accepted export bill.');
      const acc = find(db.accounts, d.creditAccountId);
      need(acc && acc.smeId === s.id, 'Select an account to credit from your account master.');
      need(acc.verified, `Account ${acc.accountNumber} is not verified yet.`);
      need(acc.currency === 'INR', 'Disposal proceeds are credited to an INR account.');
      const rate = settleRate(db, s, i.currency, d.rate, 'in', ctx.now);
      const list = checklist(db, 'TRADE', '', 0);
      const docs = docsIn(d.docs, list.map(x => x.id));
      const missingDocs = list.filter(x => x.required && !docs[x.id]).map(x => x.name);
      need(!missingDocs.length, 'Upload the required documents: ' + missingDocs.join(', ') + '.', missingDocs);
      const id = nextId(db.disposals, 'DI');
      db.disposals.unshift({ id, inwardId: i.id, smeId: s.id, amount: total, currency: i.currency, creditAccountId: acc.id,
        allocations: al, rate, purposeCode: '', remittanceType: 'TRADE', docs,
        creditInr: round2(total * rate.customerRate),
        status: 'Submitted', pendingWith: 'AD2 Maker', submittedAt: ctx.now,
        remarks: txt(d.remarks, 'Remarks', { max: 500, required: false }),
        source: a.actingFor ? 'AD2 Assisted' : 'SME', createdBy: a.name || a.role, createdByKey: actorKey(a),
        wf: { submitted: stamp(a, ctx.now, 'submitted') } });
      i.available = round2(i.available - total);
      i.status = inwardStatus(db, i);
      audit(db, a, ctx.now, i.id, `Disposal instruction ${id} submitted for ${fmt(total, i.currency)} — TRADE`);
      audit(db, a, ctx.now, id, `Disposal instruction submitted — ${fmt(total, i.currency)} against ${al.map(x => x.billId).join(', ')}`);
      notify(db, ctx.now, { toRole: 'AD2 Maker', text: `Disposal ${id} from ${s.tradingName} — ${fmt(total, i.currency)} to verify`, link: '#/ad2/disposals/' + id });
      return { id, message: `Disposal instruction ${id} submitted.` };
    },
  };

  const disposalFor = (db, id) => find(db.disposals, id) || missing('Disposal instruction');

  C['disposal.verify'] = {
    cap: 'inward.verifyDisposal',
    run(db, a, p, ctx) {
      const d = disposalFor(db, p.id);
      need(d.status === 'Submitted', 'Only a submitted instruction can be verified.');
      const checks = p.checks || {};
      const notDone = ['documents', 'bills', 'account'].filter(k => !bool(checks[k]));
      need(!notDone.length, 'Complete every verification check before verifying.', notDone);
      distinct(a, [{ key: d.createdByKey, verb: 'raised' }], 'instruction');
      d.wf.verified = { ...stamp(a, ctx.now, 'verified'), note: txt(p.note, 'Note', { max: 500, required: false }) };
      d.status = 'Verified'; d.pendingWith = 'AD2 Checker';
      audit(db, a, ctx.now, d.id, 'Verified — documents, bill match and credit account checked');
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
      d.wf.authorised = stamp(a, ctx.now, 'authorised');
      d.status = 'Authorised'; d.pendingWith = 'AD2 Operations';
      audit(db, a, ctx.now, d.id, 'Authorised for processing');
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
      d.creditInr = round2(d.amount * d.rate.customerRate);
      if (acc.balance != null) acc.balance = round2(acc.balance + d.creditInr);
      d.allocations.forEach(x => {
        const b = find(db.bills, x.billId);
        if (!b) return;
        applyToBill(b, x.amount);
        ledger(db, ctx.now, { smeId: d.smeId, side: 'Export', billId: b.id, remKind: 'inward', remId: d.inwardId, disposalId: d.id,
                             amount: x.amount, currency: d.currency, source: 'Disposal instruction', status: 'Confirmed' });
      });
      d.firc = `FIRC-${ctx.now.slice(0, 4)}-${seq(db, 'firc')}`;
      d.wf.processed = stamp(a, ctx.now, 'processed');
      d.status = 'Processed'; d.pendingWith = '—';
      const i = find(db.inward, d.inwardId);
      if (i) { i.firc = d.firc; i.status = inwardStatus(db, i); }
      audit(db, a, ctx.now, d.id, `Processed — ${inr(d.creditInr)} credited to ${acc.bank} ${acc.accountNumber}; ${d.firc} issued`);
      if (i) audit(db, a, ctx.now, i.id, `${d.firc} issued against disposal ${d.id}`);
      notify(db, ctx.now, { toSmeId: d.smeId, text: `${inr(d.creditInr)} credited — ${d.firc} issued for ${d.id}`, link: '#/sme/disposals/' + d.id });
      return { firc: d.firc, message: `Processed. ${inr(d.creditInr)} credited and ${d.firc} issued.` };
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
      Object.assign(d.docs = d.docs || {}, docsIn(p.docs, checklist(db, 'TRADE', '', 0).map(x => x.id)));
      d.status = 'Submitted'; d.pendingWith = 'AD2 Maker';
      audit(db, a, ctx.now, d.id, 'SME responded to the query — back with the maker');
      notify(db, ctx.now, { toRole: 'AD2 Maker', text: `SME responded on disposal ${d.id}`, link: '#/ad2/disposals/' + d.id });
      return { message: 'Response sent.' };
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

  /* ---------- knock-off and reconciliation ---------------------------------- */
  C['knockoff.propose'] = {
    cap: 'recon.propose',
    run(db, a, p, ctx) {
      const s = ownSme(db, a); requireApproved(s);
      const side = oneOf(p.side, ['Import', 'Export'], 'Side');
      const items = Array.isArray(p.items) ? p.items.slice(0, 30) : [];
      need(items.length, 'Add at least one allocation.');
      const made = [];
      items.forEach(x => {
        const amt = amount(x.amount, 'Allocation');
        const b = find(db.bills, x.billId);
        need(b && b.smeId === s.id && b.type === side && b.review === 'Accepted', `Bill ${x.billId} cannot be knocked off.`);
        need(amt <= billAvailable(db, b) + 0.001, `Bill ${b.id} has only ${fmt(billAvailable(db, b), b.currency)} available.`);
        let remKind, remId;
        if (side === 'Import') {
          const o = find(db.outward, x.remId);
          need(o && o.smeId === s.id && o.status === 'Completed' && o.currency === b.currency, `Payment ${x.remId} is not an eligible completed payment in ${b.currency}.`);
          const used = (db.allocations || []).filter(l => l.remKind === 'outward' && l.remId === o.id && ['Confirmed', 'Proposed'].includes(l.status))
            .reduce((t, l) => t + l.amount, 0);
          need(amt <= o.amount - used + 0.001, `Payment ${o.id} has only ${fmt(o.amount - used, o.currency)} left to apply.`);
          remKind = 'outward'; remId = o.id;
        } else {
          const i = find(db.inward, x.remId);
          need(i && i.smeId === s.id && i.currency === b.currency && i.available >= amt - 0.001, `Receipt ${x.remId} does not have ${fmt(amt, b.currency)} available.`);
          i.available = round2(i.available - amt); i.status = inwardStatus(db, i);
          remKind = 'inward'; remId = i.id;
        }
        made.push(ledger(db, ctx.now, { smeId: s.id, side, billId: b.id, remKind, remId, amount: amt, currency: b.currency,
          source: 'Knock-off', status: 'Proposed', proposedBy: stamp(a, ctx.now, 'proposed') }));
        audit(db, a, ctx.now, b.id, `Knock-off proposed against ${remId} for ${fmt(amt, b.currency)}`);
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
      applyToBill(b, l.amount);
      l.status = 'Confirmed'; l.confirmedBy = stamp(a, ctx.now, 'confirmed');
      if (l.remKind === 'outward') { const o = find(db.outward, l.remId); if (o) (o.allocations = o.allocations || []).push({ billId: b.id, amount: l.amount, via: 'knock-off' }); }
      audit(db, a, ctx.now, b.id, `Knock-off against ${l.remId} confirmed — ${fmt(l.amount, l.currency)}`);
      notify(db, ctx.now, { toSmeId: l.smeId, text: `Knock-off of ${b.id} against ${l.remId} confirmed`, link: '#/sme/knockoff' });
      return { message: 'Allocation confirmed. Bill balance updated.' };
    },
  };
  C['recon.reject'] = {
    cap: 'recon.confirm',
    run(db, a, p, ctx) {
      const l = allocFor(db, p.id);
      need(l.status === 'Proposed', 'Only a proposed allocation can be rejected.');
      const r = txt(p.reason, 'Reason', { max: 300 });
      l.status = 'Rejected'; l.rejectReason = r;
      if (l.remKind === 'inward') { const i = find(db.inward, l.remId); if (i) { i.available = round2(i.available + l.amount); i.status = inwardStatus(db, i); } }
      audit(db, a, ctx.now, l.billId, `Knock-off against ${l.remId} rejected: ${r}`);
      return { message: 'Allocation rejected.' };
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
      if (l.source === 'Knock-off' && l.remKind === 'inward') {
        const i = find(db.inward, l.remId); if (i) { i.available = round2(i.available + l.amount); i.status = inwardStatus(db, i); }
      }
      audit(db, a, ctx.now, l.billId, `Allocation against ${l.remId} reversed: ${r}`);
      return { message: 'Allocation reversed. The bill is outstanding again.' };
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
      ['autoChecker', 'allowUnlinked'].forEach(k => {
        if (p[k] === undefined) return;
        db.settings[k] = bool(p[k]);
        changes.push(`${k} ${db.settings[k] ? 'on' : 'off'}`);
      });
      need(changes.length, 'Nothing to change.');
      audit(db, a, ctx.now, 'SETTINGS', 'Settings changed: ' + changes.join(', '));
      return { message: 'Settings saved.' };
    },
  };
  C['policy.setRule'] = {
    cap: 'admin.masters',
    run(db, a, p, ctx) {
      const d = (db.docPolicy || []).find(x => x.product === p.product && x.id === p.docId) || missing('Document rule');
      const rule = oneOf(p.rule, ['required', 'optional', 'goods', 'threshold'], 'Rule');
      if (rule === 'threshold' && !d.threshold) d.threshold = 500000;
      const was = d.rule; d.rule = rule;
      audit(db, a, ctx.now, 'POLICY', `${d.product} · ${d.name}: ${was} → ${rule}`);
      return { message: `${d.name} under ${d.product} is now ${rule}.` };
    },
  };
  C['purpose.setEnabled'] = {
    cap: 'admin.masters',
    run(db, a, p, ctx) {
      const prod = productOf(db, p.product) || missing('Product');
      need(prod.purposes.includes(p.code), `${p.code} is not mapped to ${prod.id}.`);
      const off = new Set(prod.disabled || []);
      bool(p.enabled) ? off.delete(p.code) : off.add(p.code);
      prod.disabled = [...off];
      audit(db, a, ctx.now, 'POLICY', `${prod.id} · ${p.code} ${bool(p.enabled) ? 'enabled' : 'disabled'}`);
      return { message: `${p.code} ${bool(p.enabled) ? 'enabled' : 'disabled'} under ${prod.id}.` };
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
    const result = def.run(db, a, payload, ctx) || {};
    db.rev = (db.rev || 0) + 1;
    return result;
  }

  /* ---------- what each user may see -------------------------------------- */
  const publicLogin = db => l => ({ domainId: l.domainId, loginId: l.loginId, role: l.role, smeId: l.smeId, name: l.name,
    demo: !!l.demo, tradingName: (smeOf(db, l.smeId) || {}).tradingName || '' });
  const MASTER_KEYS = ['version', 'rev', 'currencies', 'constitutions', 'purposeCodes', 'products', 'docPolicy', 'goodsCodes',
    'capabilities', 'roles', 'chargeCategories', 'onboardDocs', 'settings'];
  const BUSINESS_KEYS = ['smes', 'accounts', 'beneficiaries', 'bills', 'outward', 'inward', 'disposals', 'allocations', 'jobs', 'audit', 'notifications'];

  function scopeState(db, who) {
    const out = {};
    MASTER_KEYS.forEach(k => { out[k] = clone(db[k]); });
    out.logins = db.logins.map(publicLogin(db));
    let a = null;
    try { a = resolveActor(db, who, null); } catch (e) { a = null; }
    if (!a) { BUSINESS_KEYS.forEach(k => { out[k] = []; }); out.scope = 'public'; return out; }
    if (isAD2(a)) {
      BUSINESS_KEYS.forEach(k => { out[k] = clone(db[k] || []); });
      out.notifications = out.notifications.filter(n => n.toRole === a.role);
      out.scope = 'ad2';
      return out;
    }
    const sid = a.smeId;
    const mine = r => r.smeId === sid;
    const strip = r => { delete r.notes; return r; };
    out.smes = clone(db.smes.filter(s => s.id === sid)).map(s => {
      delete s.notes; delete s.pendingConfig; delete s.reviewedBy;
      if (s.config) delete s.config.remarks;
      return s;
    });
    ['accounts', 'beneficiaries', 'bills', 'inward', 'allocations', 'jobs'].forEach(k => { out[k] = clone((db[k] || []).filter(mine)); });
    out.outward = clone(db.outward.filter(mine)).map(strip);
    out.disposals = clone(db.disposals.filter(mine)).map(strip);
    const ids = new Set([sid, ...out.outward.map(x => x.id), ...out.inward.map(x => x.id), ...out.disposals.map(x => x.id),
                         ...out.bills.map(x => x.id), ...out.jobs.map(x => x.id)]);
    out.audit = clone(db.audit.filter(x => ids.has(x.record)));
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
  };
});
