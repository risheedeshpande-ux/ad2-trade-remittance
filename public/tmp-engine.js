/* ==========================================================================
   Treasury Management Portal (TMP) — the treasury back office
   The TMP front end (public/tmp/) is its own portal; this module is its
   engine. It shares one state, one sign-in and the treasury position book
   (treasury.js) with the trade portal, so a trade booking is a TMP position
   the moment it is made, and treasury decisions reach the trade portal:

     rate desk        published card rates gate every quote; the base rate is
                      the reference trade pricing is built on
     positions        trade bookings and branch quotes, one book, two tracks
                      (transaction link and bank cover), never merged
     FX Plus bills    branch deals link back on punch, or by knock-off
     cut-off          branch positions not concluded are cancelled; trade
                      bookings keep their 48-hour lock
     approvals        one maker-checker inbox for everything that moves money
                      or changes a control
     liquidity        trade settlements, cover and cash deals move Nostro,
                      bank and cash balances
     credit           customer limits hold a booking for authorisation

   engine.js installs it after treasury.js and hands it the engine helpers
   and the treasury module (T). It fills `hooks`, which treasury.js calls.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TmpEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return function install(E, T, hooks) {
    const { C, fail, need, forbid, missing, txt, amount, date, oneOf, round2, addHours, clone, find, smeOf, currencyOf,
            can, requireCap, isAD2, actorKey, actorLabel, distinct, audit, notify, seq, fmt, inr } = E;

    const r4 = n => +Number(n || 0).toFixed(4);
    const pad = (n, w) => String(n).padStart(w, '0');
    const arr = (db, k) => (db[k] = db[k] || []);
    const settings = db => db.settings || {};
    const roleOf = (db, a) => (db.roles || []).find(r => r.id === (a && a.role)) || {};
    const loginOf = (db, a) => (db.logins || []).find(l => a && l.domainId === a.domainId && l.loginId === a.loginId) || {};
    const minutesBetween = (a, b) => (new Date(b) - new Date(a)) / 60000;
    const SYSTEM = { domainId: 'SYSTEM', loginId: 'TMP', role: 'System', name: 'Treasury Management Portal', actingFor: null };

    /* ---------- IST time ------------------------------------------------------- */
    const IST = 330 * 60000;
    const istDate = iso => new Date(new Date(iso).getTime() + IST).toISOString().slice(0, 10);
    const istMinutes = iso => { const d = new Date(new Date(iso).getTime() + IST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
    const istAt = (day, hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return new Date(Date.parse(day + 'T00:00:00Z') + (h * 60 + (m || 0)) * 60000 - IST).toISOString(); };
    const nextDay = day => new Date(Date.parse(day + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    const istClock = iso => { const d = new Date(new Date(iso).getTime() + IST); return pad(d.getUTCHours(), 2) + ':' + pad(d.getUTCMinutes(), 2); };

    /* ---------- organisation ---------------------------------------------------- */
    const node = (db, id) => (db.org || []).find(n => n.id === id);
    const branches = db => (db.org || []).filter(n => ['Branch', 'Airport'].includes(n.type) && n.status !== 'Closed');
    const nodeName = (db, id) => (node(db, id) || {}).name || id || '—';
    function ancestors(db, id) { const out = []; let n = node(db, id); while (n) { out.push(n.id); n = node(db, n.parent); } return out; }
    function descendants(db, id) {
      const out = new Set([id]);
      let grew = true;
      while (grew) { grew = false; (db.org || []).forEach(n => { if (n.parent && out.has(n.parent) && !out.has(n.id)) { out.add(n.id); grew = true; } }); }
      return out;
    }
    const regionOf = (db, id) => ancestors(db, id).map(x => node(db, x)).find(n => n && n.type === 'Region') || null;
    /* An SME is serviced by the branch for its state (from the GSTIN), unless set. */
    function homeBranch(db, s) {
      if (!s) return null;
      if (s.branchId && node(db, s.branchId)) return s.branchId;
      const st = String(s.gstin || '').slice(0, 2);
      const b = branches(db).find(n => (n.states || []).includes(st));
      return b ? b.id : 'BR-MUMFORT';
    }
    /* What a user may see: the branches under its scope node (all, if none). */
    function scopeBranches(db, a) {
      const l = loginOf(db, a);
      if (!l.branchScope) return null;
      return descendants(db, l.branchScope);
    }
    const inScope = (db, a, branchId) => { const s = scopeBranches(db, a); return !s || s.has(branchId); };

    /* ---------- products and cut-off -------------------------------------------- */
    const productOf = (db, code) => (db.tmpProducts || []).find(p => p.code === code);
    const productName = (db, code) => (productOf(db, code) || {}).name || code;
    function cutoffOf(db, product, branchId) {
      const p = productOf(db, product);
      if (!p || !p.cutoff || p.autoCancel === false) return null;
      const b = node(db, branchId);
      return (b && b.cutoff) || p.cutoff;
    }
    /* The next cut-off at or after `from` for this product and branch. */
    function nextCutoff(db, product, branchId, from) {
      const t = cutoffOf(db, product, branchId);
      if (!t) return null;
      let at = istAt(istDate(from), t);
      if (at <= from) at = istAt(nextDay(istDate(from)), t);
      return at;
    }
    const tradeChannel = p => ['Trade portal', 'Assisted', 'Treasury deal'].includes(p.channel);

    /* ---------- rate desk -------------------------------------------------------- */
    const deskRow = (db, product, cur) => (db.rateDesk || []).find(r => r.product === product && r.currency === cur);
    const ibr = (db, cur, now) => T.marketRate(db, cur, now);
    /* Quote a customer: the IBR plus the product markup, never above the card
       rate (the ceiling a branch may sell at) nor below the base rate (the
       floor). Buying is the mirror image. */
    function quoteRate(db, product, cur, side, now) {
      const p = productOf(db, product), row = deskRow(db, product, cur), c = currencyOf(db, cur);
      need(p && p.status !== 'Inactive', `${productName(db, product)} is not an active product line.`);
      need(row && row.status === 'Published' && row.card > 0,
        `${cur} has no published card rate for ${p.name}. Treasury publishes it on the rate desk before anyone can quote it.`);
      need((p.sides || []).includes(side), `${p.name} does not ${side === 'SELL' ? 'sell' : 'buy'} foreign currency.`);
      const base = c.refRate, card = row.card, mid = ibr(db, cur, now) || base;
      const markup = r4(base * (p.markupPct || 0.3) / 100);
      let rate;
      if (side === 'SELL') rate = r4(Math.min(card, Math.max(base, mid + markup)));
      else { const floor = r4(base - (row.card - base)); rate = r4(Math.max(Math.min(floor, base), Math.min(base, mid - markup))); }
      return { base, card, ibr: r4(mid), markup, rate };
    }
    /* Called by treasury.js before any trade booking: nothing is priced in a
       currency whose card rate is not published. */
    hooks.rateCheck = (db, product, cur) => {
      const row = deskRow(db, product, cur);
      need(row && row.status === 'Published',
        `No card rate is published for ${cur} (${productName(db, product)}). Treasury publishes it on the rate desk before it can be booked.`);
    };
    hooks.homeBranch = homeBranch;
    hooks.nextCutoff = nextCutoff;

    /* ---------- customer credit limits ---------------------------------------- */
    const limitFor = (db, key) => key ? (db.limits || []).find(l => l.id === key || l.smeId === key) : null;
    const inrOf = p => round2((p.amount - (p.cancelledAmount || 0) - (p.linkedAmount || 0)) * (p.customerRate || 0));
    function limitUse(db, l, now) {
      const open = (db.positions || []).filter(p => (p.smeId && p.smeId === l.smeId || p.customerId && p.customerId === l.id)
        && ['Open', 'Attached', 'Held'].includes(T.positionStatus(p, now)));
      const outstanding = round2(open.reduce((t, p) => t + inrOf(p), 0));
      return { outstanding, available: round2(l.limit - outstanding), pct: l.limit ? Math.round(outstanding / l.limit * 100) : 0, positions: open.map(p => p.id) };
    }
    /* A booking that would breach the customer's limit is held for a
       treasury checker rather than passed silently. */
    hooks.limitCheck = (db, key, inrAmount, cur, side, now) => {
      const l = limitFor(db, key);
      if (!l || l.status === 'Suspended') return null;
      const u = limitUse(db, l, now);
      const r = l.restrictions || {};
      const why = [];
      if (u.outstanding + inrAmount > l.limit + 0.5) why.push(`limit ${inr(l.limit)}, outstanding ${inr(u.outstanding)}, this deal ${inr(inrAmount)}`);
      if (r.currencies && r.currencies.length && !r.currencies.includes(cur)) why.push(`${cur} is outside the limit’s currencies (${r.currencies.join(', ')})`);
      if (r.sides && r.sides.length && !r.sides.includes(side)) why.push(`${side === 'SELL' ? 'outward' : 'inward'} deals are outside the limit`);
      if (r.dealCap && inrAmount > r.dealCap) why.push(`deal above the ${inr(r.dealCap)} cap`);
      return why.length ? { limitId: l.id, reason: why.join('; ') } : null;
    };
    hooks.onHeld = (db, a, p, breach, now) => {
      submitApproval(db, a, now, { type: 'Held deal', ref: p.id, title: `${p.id} held — customer limit`, amount: p.amount, currency: p.currency,
        payload: { positionId: p.id, limitId: breach.limitId },
        diff: [['Position', p.id, p.id], ['Customer', p.customerName || p.smeId, p.customerName || p.smeId],
               ['Deal', '—', `${p.side === 'SELL' ? 'Sell' : 'Buy'} ${fmt(p.amount, p.currency)} at ${p.customerRate.toFixed(4)}`],
               ['Breach', '—', breach.reason]],
        note: 'Held automatically: the booking breaches the customer limit.' }, true);
    };

    /* ---------- approvals: one maker-checker inbox ------------------------------ */
    const APPLY = {};
    function submitApproval(db, a, now, item, system) {
      const id = 'APR-' + pad(seq(db, 'apr'), 4);
      const rec = { id, status: 'Pending', submittedAt: now, maker: system ? 'System — ' + (actorLabel(a) || '') : actorLabel(a),
        makerKey: system ? 'SYSTEM/TMP' : actorKey(a), version: 1, ...item,
        diff: (item.diff || []).map(([field, before, after]) => ({ field, before: before == null ? '—' : String(before), after: after == null ? '—' : String(after) })) };
      arr(db, 'approvals').unshift(rec);
      audit(db, a, now, id, `${item.type} submitted for authorisation — ${item.title}`);
      notify(db, now, { toRole: 'AD2 Treasury Checker', text: `${item.type}: ${item.title} awaits your approval`, link: '#/T-21' });
      return rec;
    }
    const approvalFor = (db, id) => find(db.approvals, id) || missing('Approval item');
    C['approval.approve'] = {
      cap: 'treasury.approve',
      run(db, a, p, ctx) {
        const r = approvalFor(db, p.id);
        need(r.status === 'Pending', `${r.id} is ${r.status.toLowerCase()}.`);
        if (r.makerKey === actorKey(a)) forbid('A checker cannot approve their own entry. It routes to another checker.');
        const fn = APPLY[r.type];
        need(fn, `No handler for ${r.type}.`);
        const msg = fn(db, a, r, ctx.now) || '';
        Object.assign(r, { status: 'Approved', decidedAt: ctx.now, checker: actorLabel(a), checkerKey: actorKey(a) });
        audit(db, a, ctx.now, r.ref || r.id, `${r.type} approved (${r.id})${msg ? ' — ' + msg : ''}`);
        notify(db, ctx.now, { toRole: 'AD2 Treasury Dealer', text: `${r.id} ${r.type} approved`, link: '#/T-21' });
        return { message: `${r.id} approved.${msg ? ' ' + msg : ''}` };
      },
    };
    const REJECT = {};
    function rejectOne(db, a, r, why, now) {
      need(r.status === 'Pending', `${r.id} is ${r.status.toLowerCase()}.`);
      if (r.makerKey === actorKey(a)) forbid('A checker cannot decide their own entry.');
      Object.assign(r, { status: 'Rejected', decidedAt: now, checker: actorLabel(a), checkerKey: actorKey(a), reason: why });
      if (REJECT[r.type]) REJECT[r.type](db, a, r, now);
      audit(db, a, now, r.ref || r.id, `${r.type} rejected (${r.id}): ${why}`);
      notify(db, now, { toRole: 'AD2 Treasury Dealer', text: `${r.id} ${r.type} rejected: ${why}`, link: '#/T-21' });
    }
    C['approval.reject'] = {
      cap: 'treasury.approve',
      run(db, a, p, ctx) {
        rejectOne(db, a, approvalFor(db, p.id), txt(p.reason, 'Rejection reason', { max: 300 }), ctx.now);
        return { message: 'Rejected — returned to the maker with your reason.' };
      },
    };
    C['approval.bulkReject'] = {
      cap: 'treasury.approve',
      run(db, a, p, ctx) {
        const why = txt(p.reason, 'Rejection reason', { max: 300 });
        const ids = (Array.isArray(p.ids) ? p.ids : []).slice(0, 50);
        need(ids.length, 'Select at least one item.');
        ids.forEach(id => rejectOne(db, a, approvalFor(db, id), why, ctx.now));
        return { message: `${ids.length} item${ids.length === 1 ? '' : 's'} rejected — makers notified.` };
      },
    };
    /* A rejected entry is reopened by its maker and resubmitted as a new version. */
    C['approval.resubmit'] = {
      run(db, a, p, ctx) {
        const r = approvalFor(db, p.id);
        need(r.status === 'Rejected', 'Only a rejected entry can be amended and resubmitted.');
        need(r.makerKey === actorKey(a), 'Only its maker can resubmit this entry.');
        const note = txt(p.note, 'What changed', { max: 300 });
        const next = submitApproval(db, a, ctx.now, { type: r.type, ref: r.ref, title: r.title, amount: r.amount, currency: r.currency,
          payload: r.payload, diff: r.diff.map(d => [d.field, d.before, d.after]), note });
        next.version = (r.version || 1) + 1; next.supersedes = r.id;
        r.status = 'Superseded';
        return { id: next.id, message: `Resubmitted as ${next.id} (v${next.version}); v${r.version || 1} retained.` };
      },
    };

    /* Time-based housekeeping (cut-off, expiry, reminders) runs before every
       command. A portal that notices something falling due sends this, so
       the book catches up without waiting for someone to act. */
    C['tmp.touch'] = { run() { return { message: 'Up to date.' }; } };

    /* ---------- rate desk commands ------------------------------------------------ */
    /* Base rates come from the provider (the IBR feed); importing does not
       publish — card rates are set and published separately. */
    C['rates.import'] = {
      cap: 'tmp.rates',
      run(db, a, p, ctx) {
        const n = [];
        (db.currencies || []).forEach(c => {
          const mid = ibr(db, c.code, ctx.now);
          if (!mid) return;
          c.importedBase = r4(mid * (1 - 0.0012)); c.importedAt = ctx.now; n.push(c.code);
        });
        touchIntegration(db, 'IBR', ctx.now, n.length + ' currencies');
        audit(db, a, ctx.now, 'RATE-DESK', `Base rates re-imported from the provider — ${n.length} currencies (not yet published)`);
        return { message: `Base rates re-imported — ${n.length} currencies updated. Nothing is published until a checker approves.` };
      },
    };
    /* Propose card rates (and the base they sit on) for publication. */
    C['rates.propose'] = {
      cap: 'tmp.rates',
      run(db, a, p, ctx) {
        const rows = (Array.isArray(p.rows) ? p.rows : []).slice(0, 40);
        need(rows.length, 'Choose at least one rate to publish.');
        const band = Number(settings(db).rateBand ?? 2);
        const out = [], diff = [];
        rows.forEach(r => {
          const prod = productOf(db, r.product); need(prod, 'Unknown product line.');
          const c = currencyOf(db, r.currency); need(c, 'Unknown currency.');
          const row = deskRow(db, prod.code, c.code);
          const base = r.base != null && r.base !== '' ? r4(r.base) : r4(c.importedBase || c.refRate);
          const card = r4(r.card);
          need(base > 0 && card > 0, `${c.code}: enter the base and card rates.`);
          const mid = ibr(db, c.code, ctx.now) || c.refRate;
          need(Math.abs(base - mid) / mid * 100 <= band, `${c.code} base ${base} is more than ${band}% from the IBR ${r4(mid)}. Check the figure.`);
          if ((prod.sides || []).includes('SELL') && !(prod.sides || []).includes('BUY')) need(card >= base, `${prod.name} ${c.code}: the card rate is the ceiling a branch may sell at, so it cannot be below the base rate.`);
          if ((prod.sides || []).includes('BUY') && !(prod.sides || []).includes('SELL')) need(card <= base, `${prod.name} ${c.code}: the buying card rate is the floor, so it cannot be above the base rate.`);
          need(Math.abs(card - base) / base * 100 <= band * 2, `${c.code} card rate ${card} is too far from the base ${base}.`);
          out.push({ product: prod.code, currency: c.code, base, card });
          diff.push([`${prod.name} ${c.code} — card`, row && row.status === 'Published' ? row.card.toFixed(4) : 'Not published', card.toFixed(4)]);
          if (Math.abs(base - c.refRate) > 0.00005) diff.push([`${c.code} — base`, c.refRate.toFixed(4), base.toFixed(4)]);
        });
        (db.approvals || []).filter(x => x.type === 'Card rate' && x.status === 'Pending' && x.makerKey === actorKey(a)).forEach(x => { x.status = 'Superseded'; });
        const reason = txt(p.reason, 'Reason', { max: 200, required: false });
        const item = submitApproval(db, a, ctx.now, { type: 'Card rate', ref: 'RATE-DESK',
          title: out.length === 1 ? `${productName(db, out[0].product)} ${out[0].currency} card rate` : `${out.length} card rates`,
          payload: { rows: out }, diff, note: reason || (p.intraday ? 'Intraday revision' : 'Publication') });
        out.forEach(o => { const row = deskRow(db, o.product, o.currency); if (row) row.pendingId = item.id; });
        return { id: item.id, message: `Sent to a treasury checker (${item.id}). The current rates stay live until it is approved.` };
      },
    };
    APPLY['Card rate'] = (db, a, r, now) => {
      const named = new Set(r.payload.rows.map(o => o.product + ':' + o.currency));
      r.payload.rows.forEach(o => {
        const c = currencyOf(db, o.currency);
        if (c && Math.abs(o.base - c.refRate) > 0.00005) {
          /* a new base carries every other published card rate with it: the
             spread is what the desk maintains, the base moves under it */
          const delta = r4(o.base - c.refRate);
          (db.rateDesk || []).filter(x => x.currency === c.code && x.status === 'Published' && !named.has(x.product + ':' + x.currency))
            .forEach(x => { x.card = r4(x.card + delta); x.publishedAt = now; x.version = (x.version || 0) + 1; });
          c.refRate = o.base; c.publishedAt = now;
        }
        let row = deskRow(db, o.product, o.currency);
        if (!row) { row = { product: o.product, currency: o.currency, version: 0 }; arr(db, 'rateDesk').push(row); }
        Object.assign(row, { card: o.card, spread: r4(Math.abs(o.card - o.base)), status: 'Published', publishedAt: now,
          publishedBy: r.maker, approvedBy: actorLabel(a), version: (row.version || 0) + 1, pendingId: null });
      });
      return 'Rates published. Quotes already issued run to their validity window; trade bookings already made keep their rate.';
    };
    REJECT['Card rate'] = (db, a, r) => r.payload.rows.forEach(o => { const row = deskRow(db, o.product, o.currency); if (row && row.pendingId === r.id) row.pendingId = null; });
    C['product.add'] = {
      cap: 'tmp.admin',
      run(db, a, p, ctx) {
        const name = txt(p.name, 'Product name', { max: 60 });
        const code = txt(String(p.code || name.replace(/[^A-Za-z]/g, '').slice(0, 3)).toUpperCase(), 'Code', { max: 4, pattern: /^[A-Z]{2,4}$/, patternMsg: 'Code must be 2–4 letters.' });
        need(!productOf(db, code), `${code} already exists.`);
        const sides = p.sides === 'BUY' ? ['BUY'] : p.sides === 'BOTH' ? ['SELL', 'BUY'] : ['SELL'];
        arr(db, 'tmpProducts').push({ code, name, sides, tagging: 'Required', cutoff: '16:00', autoCancel: true, quoteMinutes: 10,
          spreadPct: 1.0, markupPct: 0.4, transferPct: 0.12, status: 'Active', basis: txt(p.basis, 'Rate basis', { max: 40, required: false }) || 'Base rate + spread' });
        (db.currencies || []).forEach(c => arr(db, 'rateDesk').push({ product: code, currency: c.code, card: 0, spread: 0, status: 'Not published', version: 0 }));
        audit(db, a, ctx.now, 'MASTERS', `Product line ${name} (${code}) added`);
        return { message: `Product line added — set card rates before branches can quote it.` };
      },
    };

    /* ---------- quotes and branch bookings ------------------------------------------ */
    const CHANNELS = ['Branch', 'DIY — mobile', 'DIY — web', 'Agent', 'Partner'];
    function readDeal(db, a, p, now) {
      const agent = can(db, a, 'tmp.agent') && !can(db, a, 'tmp.branch');
      const l = loginOf(db, a);
      const product = oneOf(p.product, (db.tmpProducts || []).filter(x => x.status !== 'Inactive').map(x => x.code), 'Product');
      const prod = productOf(db, product);
      need(product !== 'INW', 'Inward remittances are priced when the customer disposes of them, not quoted at the counter.');
      const currency = oneOf(p.currency, db.currencies.map(c => c.code), 'Currency');
      const side = oneOf(p.side || prod.sides[0], prod.sides, 'Company side');
      const amt = amount(p.amount, 'FCY amount');
      let branchId = agent ? l.branchScope : String(p.branchId || l.branchScope || '');
      need(node(db, branchId) && ['Branch', 'Airport'].includes(node(db, branchId).type), 'Choose the branch.');
      if (!inScope(db, a, branchId)) forbid(`You can quote only for ${nodeName(db, l.branchScope)}.`);
      const channel = agent ? 'Agent' : oneOf(p.channel || 'Branch', CHANNELS, 'Origin channel');
      const valueDate = date(p.valueDate || istDate(now), 'Value date');
      need(valueDate >= istDate(now), 'The value date cannot be in the past.');
      let smeId = null, customerName = txt(p.customerName, 'Customer', { max: 100, required: false });
      let customerId = null;
      if (p.smeId) {
        const s = smeOf(db, p.smeId);
        need(s && s.status === 'Approved', 'Choose an approved trade customer.');
        need(product === 'REM' && side === 'SELL', 'A trade customer’s rate is booked as an outward remittance; its receipts are priced when it disposes of them.');
        smeId = s.id; customerName = s.tradingName;
      } else if (p.customerId) {
        const lim = limitFor(db, p.customerId); need(lim, 'Unknown corporate customer.');
        customerId = lim.id; customerName = lim.name;
      }
      const customerRef = txt(p.customerRef, 'Customer / deal reference', { max: 60, required: false });
      return { product, currency, side, amount: amt, branchId, channel, valueDate, smeId, customerId, customerName, customerRef, agent,
               agentName: agent ? (l.agentName || l.name) : null };
    }
    function stepReasons(db, a, d, q, override) {
      const why = [];
      if (override) why.push('Rate override');
      if (d.amount * q.rate >= Number(settings(db).steppedThresholdInr || 4000000)) why.push(`Above ${inr(Number(settings(db).steppedThresholdInr || 4000000))}`);
      if (!loginOf(db, a).quotedBefore) why.push('First quote by this user');
      return why;
    }
    function makeQuote(db, a, d, now, prev, overrideRate) {
      const q = quoteRate(db, d.product, d.currency, d.side, now);
      let rate = q.rate, override = false;
      if (overrideRate != null && overrideRate !== '') {
        const o = r4(overrideRate);
        if (Math.abs(o - q.rate) > 0.00005) {
          override = true;
          if (d.side === 'SELL') need(o <= q.card && o >= q.base, `An override must sit between the base ${q.base.toFixed(4)} and the card rate ${q.card.toFixed(4)}.`);
          else need(o >= r4(q.base - (q.card - q.base)) && o <= q.base, `An override must sit between the floor and the base rate ${q.base.toFixed(4)}.`);
          rate = o;
        }
      }
      const agentSpread = d.agent ? r4(q.base * 0.002) : 0;
      if (d.agent) rate = d.side === 'SELL' ? r4(Math.min(q.card, rate + agentSpread)) : r4(rate - agentSpread);
      const prod = productOf(db, d.product);
      const id = 'Q-' + pad(seq(db, 'quote'), 4);
      const quote = { id, ...d, ...q, rate, agentSpread, override, inrPrincipal: round2(d.amount * rate), createdAt: now,
        validUntil: addHours(now, (prod.quoteMinutes || 10) / 60), status: 'Live', version: prev ? (prev.version || 1) + 1 : 1,
        previousId: prev ? prev.id : null, previousRate: prev ? prev.rate : null, by: actorLabel(a), byKey: actorKey(a) };
      quote.stepped = stepReasons(db, a, d, quote, override);
      const lim = hooks.limitCheck(db, d.smeId || d.customerId, quote.inrPrincipal, d.currency, d.side, now);
      quote.limit = lim ? { breach: true, reason: lim.reason } : { breach: false };
      arr(db, 'quotes').unshift(quote);
      if (db.quotes.length > 400) db.quotes.length = 400;
      return quote;
    }
    C['quote.get'] = {
      cap: 'tmp.quote',
      run(db, a, p, ctx) {
        const d = readDeal(db, a, p, ctx.now);
        const q = makeQuote(db, a, d, ctx.now, null, p.overrideRate);
        return { quote: q, message: `Rate quoted — ${q.id} at ${q.rate.toFixed(4)}, valid ${productOf(db, d.product).quoteMinutes || 10} minutes.` };
      },
    };
    /* Refresh the rate in place: every entered field is kept. */
    C['quote.requote'] = {
      cap: 'tmp.quote',
      run(db, a, p, ctx) {
        const prev = find(db.quotes, p.id) || missing('Quote');
        need(prev.byKey === actorKey(a) || inScope(db, a, prev.branchId), 'That quote belongs to another branch.');
        need(prev.status !== 'Booked', `${prev.id} is already booked.`);
        prev.status = 'Requoted';
        const d = { product: prev.product, currency: prev.currency, side: prev.side, amount: p.amount ? amount(p.amount, 'FCY amount') : prev.amount,
          branchId: prev.branchId, channel: prev.channel, valueDate: prev.valueDate, smeId: prev.smeId, customerId: prev.customerId,
          customerName: prev.customerName, customerRef: prev.customerRef, agent: prev.agent, agentName: prev.agentName };
        const q = makeQuote(db, a, d, ctx.now, prev, p.overrideRate);
        if (p.residualOf) q.residualOf = String(p.residualOf);
        const delta = r4(q.rate - prev.rate);
        return { quote: q, delta, message: `Rate refreshed — ${q.id} at ${q.rate.toFixed(4)} (${delta >= 0 ? '+' : ''}${delta.toFixed(4)}).` };
      },
    };
    /* Confirming books the position and transfers the exposure to treasury. */
    C['quote.book'] = {
      cap: 'tmp.quote',
      run(db, a, p, ctx) {
        const q = find(db.quotes, p.id) || missing('Quote');
        need(q.byKey === actorKey(a) || inScope(db, a, q.branchId), 'That quote belongs to another branch.');
        need(q.status === 'Live', `${q.id} is ${q.status.toLowerCase()} — requote to book.`);
        if (ctx.now >= q.validUntil) { q.status = 'Expired'; fail(`${q.id} expired at ${istClock(q.validUntil)} IST. Requote — every entered field is kept.`); }
        if (q.stepped.length) need(p.reviewed === true, `This deal needs the stepped review (${q.stepped.join(', ')}). Review and confirm it.`);
        const row = deskRow(db, q.product, q.currency);
        need(row && row.status === 'Published', `${q.currency} card rate is no longer published — requote.`);
        const s = q.smeId ? smeOf(db, q.smeId) : null;
        const pos = T.newPosition(db, a, s, { currency: q.currency, side: q.side, amount: q.amount, customerRate: q.rate, refRate: q.base,
          margin: Math.round((q.side === 'SELL' ? q.rate - q.base : q.base - q.rate) * 100), source: s ? 'Deal' : 'Branch', dealId: null,
          expiresAt: null, product: q.product, branchId: q.branchId, channel: q.channel, customerName: q.customerName, customerRef: q.customerRef,
          customerId: q.customerId, quoteId: q.id, valueDate: q.valueDate, ibrAtBooking: q.ibr, agentName: q.agentName,
          cutoffAt: s ? null : nextCutoff(db, q.product, q.branchId, ctx.now) }, ctx.now);
        if (s) {
          /* A trade customer's rate becomes an FX deal reference the branch
             applies to the customer's payment in the trade portal. */
          const dl = T.issueDeal(db, a, s, pos, 24, `Quoted at ${nodeName(db, q.branchId)} (${q.id})`, ctx.now);
          pos.channel = 'Treasury deal';
          q.dealId = dl.id;
        }
        q.status = 'Booked'; q.positionId = pos.id; q.bookedAt = ctx.now;
        const l = (db.logins || []).find(x => x.domainId === a.domainId && x.loginId === a.loginId); if (l) l.quotedBefore = true;
        if (q.residualOf) {
          const old = find(db.positions, q.residualOf);
          if (old && T.remaining(old) > 0.005) T.cancelResidual(db, a, old, `Requoted as ${pos.id}`, ctx.now);
        }
        if (q.limit && q.limit.breach) {
          pos.status = 'Held'; pos.heldReason = q.limit.reason;
          hooks.onHeld(db, a, pos, { limitId: (limitFor(db, q.smeId || q.customerId) || {}).id, reason: q.limit.reason }, ctx.now);
        }
        audit(db, a, ctx.now, pos.id, `Position booked at ${nodeName(db, q.branchId)} against ${q.id} — ${q.side === 'SELL' ? 'sell' : 'buy'} ${fmt(q.amount, q.currency)} at ${q.rate.toFixed(4)} (${productName(db, q.product)}, ${q.channel})`);
        return { positionId: pos.id, dealId: q.dealId || null, held: pos.status === 'Held',
          message: pos.status === 'Held' ? `${pos.id} booked but held — it breaches the customer limit and goes to a treasury checker.`
            : q.dealId ? `${pos.id} booked. Deal reference ${q.dealId} — apply it to ${q.customerName}’s request in the trade portal.`
            : `${pos.id} booked — exposure transferred to Treasury. The FX Plus bill links back automatically on punch.` };
      },
    };
    APPLY['Held deal'] = (db, a, r, now) => {
      const pos = find(db.positions, r.payload.positionId);
      need(pos && pos.status === 'Held', 'That position is no longer held.');
      pos.status = 'Open'; pos.heldReleasedAt = now; pos.heldApprovedBy = actorLabel(a);
      if (pos.cutoffAt && pos.cutoffAt <= now) pos.cutoffAt = nextCutoff(db, pos.product, pos.branchId, now);
      if (pos.source === 'Booked' && pos.expiresAt) pos.expiresAt = addHours(now, 48);
      return `${pos.id} released — the limit breach is recorded against the approval.`;
    };
    /* A held position cancelled elsewhere (released by the customer, the
       request rejected) closes its approval item: nothing is left to decide. */
    hooks.onCancelled = (db, a, p, reason, now) => {
      (db.approvals || []).filter(x => x.type === 'Held deal' && x.status === 'Pending' && x.payload.positionId === p.id)
        .forEach(x => Object.assign(x, { status: 'Withdrawn', decidedAt: now, reason: 'Position cancelled — ' + reason }));
    };
    REJECT['Held deal'] = (db, a, r, now) => {
      const pos = find(db.positions, r.payload.positionId);
      if (pos && pos.status === 'Held') T.cancelResidual(db, a, pos, 'Held deal declined: ' + r.reason, now);
    };

    /* ---------- FX Plus transactions ------------------------------------------------ */
    const fxpFor = (db, id) => find(db.fxpTxns, id) || missing('FX Plus transaction');
    const fxpLinked = t => round2((t.links || []).reduce((s, l) => s + l.amount, 0));
    const fxpAvail = t => t.reversed ? 0 : round2(t.amount - fxpLinked(t));
    const eligible = (p, t) => !t.reversed && t.branchId === p.branchId && t.product === p.product && t.currency === p.currency && t.side === p.side && fxpAvail(t) > 0.005;
    function linkTxn(db, a, p, t, amt, now, auto) {
      need(['Open'].includes(p.status), `${p.id} is ${String(T.positionStatus(p, now)).toLowerCase()} and takes no more links.`);
      need(productOf(db, p.product).tagging !== 'Excluded', `${productName(db, p.product)} is excluded from transaction tagging.`);
      need(eligible(p, t), `${t.id} does not match ${p.id} on branch, product, currency, direction or available amount.`);
      need(amt <= fxpAvail(t) + 0.005, `${t.id} has only ${fmt(fxpAvail(t), t.currency)} available.`);
      need(amt <= T.remaining(p) + 0.005, `${p.id} has only ${fmt(T.remaining(p), p.currency)} left to link.`);
      (t.links = t.links || []).push({ positionId: p.id, amount: round2(amt), at: now, by: auto ? 'Automatic on bill punch' : actorLabel(a) });
      T.addLink(db, a, p, { ref: t.id, amount: round2(amt), kind: 'FX Plus', at: now, by: auto ? 'Automatic on bill punch' : actorLabel(a), rate: t.rate }, now);
      if (T.remaining(p) <= 0.005) (db.reminders || []).filter(x => x.positionId === p.id && x.state !== 'Closed').forEach(x => { x.state = 'Closed'; x.closedAt = now; });
    }
    C['knockoff.confirm'] = {
      cap: 'tmp.link',
      run(db, a, p, ctx) {
        const pos = find(db.positions, p.positionId) || missing('Position');
        if (!inScope(db, a, pos.branchId)) forbid('That position belongs to another branch.');
        need(pos.status === 'Open', `${pos.id} is ${String(T.positionStatus(pos, ctx.now)).toLowerCase()} and takes no more links.`);
        const rows = (Array.isArray(p.links) ? p.links : []).slice(0, 20).filter(r => Number(r.amount) > 0);
        need(rows.length, 'Select at least one FX Plus transaction to link.');
        const total = round2(rows.reduce((t, r) => t + Number(r.amount), 0));
        need(total <= T.remaining(pos) + 0.005, `Linking ${fmt(total, pos.currency)} is more than the ${fmt(T.remaining(pos), pos.currency)} remaining on ${pos.id}.`);
        rows.forEach(r => linkTxn(db, a, pos, fxpFor(db, r.fxpId), amount(r.amount, 'Link amount'), ctx.now));
        audit(db, a, ctx.now, pos.id, `Knock-off confirmed — ${rows.map(r => r.fxpId).join(', ')} (${fmt(total, pos.currency)}); ${fmt(T.remaining(pos), pos.currency)} remaining`);
        return { message: T.remaining(pos) <= 0.005 ? `Transactions linked — ${pos.id} now complete.` : `Linked ${fmt(total, pos.currency)} — ${fmt(T.remaining(pos), pos.currency)} still to link on ${pos.id}.` };
      },
    };
    /* Simulated FX Plus: the counter punches the bill; it reflects back into
       the portal. A bill that carries the position reference links itself;
       one without a reference waits in the knock-off queue. */
    C['fxp.punch'] = {
      cap: 'tmp.link',
      run(db, a, p, ctx) {
        const pos = p.positionId ? find(db.positions, p.positionId) : null;
        if (p.positionId) need(pos, 'Position not found.');
        const branchId = pos ? pos.branchId : String(p.branchId || loginOf(db, a).branchScope || '');
        if (!inScope(db, a, branchId)) forbid('That branch is outside your scope.');
        const product = pos ? pos.product : oneOf(p.product, (db.tmpProducts || []).map(x => x.code), 'Product');
        const currency = p.currency ? oneOf(p.currency, db.currencies.map(c => c.code), 'Currency') : pos.currency;
        const amt = amount(p.amount || (pos && T.remaining(pos)), 'Bill amount');
        const withRef = p.withRef !== false && !!pos;
        const id = 'FXP-' + (88000 + seq(db, 'fxp'));
        const t = { id, branchId, product, currency, side: pos ? pos.side : (p.side === 'BUY' ? 'BUY' : 'SELL'), amount: amt,
          rate: pos ? r4(pos.customerRate + (Number(p.drift) || 0)) : null, receivedAt: ctx.now, source: 'FX Plus SFTP',
          positionRef: withRef ? pos.id : null, customerRef: pos ? pos.customerRef || null : null, links: [] };
        arr(db, 'fxpTxns').unshift(t);
        touchIntegration(db, 'FXP-SFTP', ctx.now, '1 bill');
        let auto = false;
        if (withRef && pos && eligible(pos, t) && pos.status === 'Open' && T.remaining(pos) > 0.005) {
          linkTxn(db, a, pos, t, Math.min(amt, T.remaining(pos)), ctx.now, true); auto = true;
        }
        audit(db, a, ctx.now, id, `FX Plus bill ${id} punched (simulated) — ${fmt(amt, currency)} ${productName(db, product)} at ${nodeName(db, branchId)}${auto ? `, linked to ${pos.id} automatically` : ', no position reference'}`);
        return { id, auto, message: auto ? `${id} reflected back and linked to ${pos.id} automatically.` : `${id} reflected back — no position reference, so it waits in the knock-off queue.` };
      },
    };
    /* An amended or reversed bill: the change lands as an amendment for the dealer. */
    C['fxp.amend'] = {
      cap: 'tmp.link',
      run(db, a, p, ctx) {
        const t = fxpFor(db, p.id);
        const change = oneOf(p.change, ['Amount reduced', 'Reversed in full', 'Value date moved'], 'Change');
        const newAmount = change === 'Reversed in full' ? 0 : change === 'Amount reduced' ? amount(p.newAmount, 'New amount') : t.amount;
        if (change === 'Amount reduced') need(newAmount < t.amount, 'The new amount must be lower than the bill.');
        const link = (t.links || [])[0];
        const pos = link && find(db.positions, link.positionId);
        const am = { id: 'AMD-' + pad(seq(db, 'amd'), 4), fxpId: t.id, positionId: pos ? pos.id : null, change, before: t.amount, after: newAmount,
          valueDate: change === 'Value date moved' ? date(p.valueDate, 'New value date') : null, at: ctx.now, status: 'Action needed', by: actorLabel(a) };
        am.coverReleased = pos ? round2(Math.min(pos.covered || 0, Math.max(0, (t.amount - newAmount)))) : 0;
        arr(db, 'amendments').unshift(am);
        audit(db, a, ctx.now, t.id, `Source change recorded — ${change}${change === 'Amount reduced' ? ` ${fmt(t.amount, t.currency)} → ${fmt(newAmount, t.currency)}` : ''}`);
        notify(db, ctx.now, { toRole: 'AD2 Treasury Dealer', text: `${t.id}: ${change} — unwind ${am.positionId || 'check'} on the amendments screen`, link: '#/T-26' });
        return { id: am.id, message: `${am.id} raised for the treasury dealer.` };
      },
    };

    /* ---------- amendments and reversals: unwind ------------------------------------ */
    function applyAmendment(db, a, am, now) {
      need(am.status !== 'Adjusted', `${am.id} is already adjusted.`);
      const t = find(db.fxpTxns, am.fxpId);
      const pos = am.positionId && find(db.positions, am.positionId);
      if (am.change === 'Value date moved') { if (pos) pos.valueDate = am.valueDate; if (t) t.valueDate = am.valueDate; }
      else if (pos && t) {
        const delta = round2(t.amount - am.after);
        const link = (t.links || []).find(l => l.positionId === pos.id);
        const cut = Math.min(delta, link ? link.amount : 0);
        if (link) link.amount = round2(link.amount - cut);
        t.amount = am.after; if (am.after === 0) t.reversed = true;
        am.coverReleased = T.unwind(db, a, pos, t.id, cut, `${am.change} (${t.id}) — forward-dated adjustment`, now);
      }
      Object.assign(am, { status: 'Adjusted', adjustedAt: now, adjustedBy: actorLabel(a) });
      return `${am.id} applied as a forward-dated adjustment.`;
    }
    C['amend.apply'] = {
      cap: 'tmp.amend',
      run(db, a, p, ctx) {
        const am = find(db.amendments, p.id) || missing('Amendment');
        const msg = applyAmendment(db, a, am, ctx.now);
        audit(db, a, ctx.now, am.positionId || am.fxpId, msg);
        return { message: msg + (am.coverReleased ? ` ${fmt(am.coverReleased, (find(db.positions, am.positionId) || {}).currency)} of cover returned to the pool.` : '') };
      },
    };
    C['amend.toChecker'] = {
      cap: 'tmp.amend',
      run(db, a, p, ctx) {
        const am = find(db.amendments, p.id) || missing('Amendment');
        need(am.status === 'Action needed', `${am.id} is ${am.status.toLowerCase()}.`);
        const pos = am.positionId && find(db.positions, am.positionId);
        am.status = 'With checker';
        submitApproval(db, a, ctx.now, { type: 'Amendment', ref: am.positionId || am.fxpId, title: `${am.fxpId} — ${am.change}`, amount: am.before - am.after,
          currency: pos ? pos.currency : null, payload: { id: am.id },
          diff: [['FCY amount', fmt(am.before), fmt(am.after)], ['Cover returned to pool', '—', fmt(am.coverReleased || 0)]] });
        return { message: `${am.id} sent to a checker.` };
      },
    };
    APPLY['Amendment'] = (db, a, r, now) => applyAmendment(db, a, find(db.amendments, r.payload.id), now);
    REJECT['Amendment'] = (db, a, r) => { const am = find(db.amendments, r.payload.id); if (am) am.status = 'Action needed'; };

    /* ---------- cut-off, cancellation, reminders ---------------------------------------- */
    const posFor = (db, id) => find(db.positions, id) || missing('Position');
    function branchPos(db, a, id) {
      const p = posFor(db, id);
      if (!inScope(db, a, p.branchId)) forbid('That position belongs to another branch.');
      return p;
    }
    C['position.cancel'] = {
      cap: 'tmp.cancel',
      run(db, a, p, ctx) {
        const pos = branchPos(db, a, p.id);
        need(['Open', 'Held'].includes(pos.status) || (pos.status === 'Attached' && !can(db, a, 'tmp.branch')),
          `${pos.id} is ${String(T.positionStatus(pos, ctx.now)).toLowerCase()} — nothing to cancel.`);
        if (pos.status === 'Attached') forbid(`${pos.id} is attached to ${pos.recordId} in the trade portal; it is cancelled there by rejecting the request.`);
        need(!tradeChannel(pos) || can(db, a, 'treasury.view'), 'Trade bookings are released from the trade portal.');
        const why = txt(p.reason, 'Cancellation reason', { max: 300 });
        const res = T.remaining(pos);
        T.cancelResidual(db, a, pos, why + (p.dead ? ' (deal is dead)' : ''), ctx.now);
        (db.reminders || []).filter(x => x.positionId === pos.id && x.state !== 'Closed').forEach(x => { x.state = 'Closed'; x.closedAt = ctx.now; });
        notify(db, ctx.now, { toRole: 'AD2 Treasury Dealer', text: `${pos.id} residual ${fmt(res, pos.currency)} cancelled at ${nodeName(db, pos.branchId)} — cover returned to pool`, link: '#/T-02' });
        return { message: `${pos.id} cancelled — ${fmt(res, pos.currency)} residual released and any cover returned to the pool.` };
      },
    };
    /* An agent cannot cancel: the request routes through the servicing branch. */
    C['position.requestCancel'] = {
      run(db, a, p, ctx) {
        need(can(db, a, 'tmp.agent') || can(db, a, 'tmp.cutoff'), 'Your role cannot request a cancellation.');
        const pos = branchPos(db, a, p.id);
        need(pos.status === 'Open', `${pos.id} is not open.`);
        pos.cancelRequest = { by: actorLabel(a), at: ctx.now, reason: txt(p.reason, 'Reason', { max: 300 }), dead: p.dead !== false };
        audit(db, a, ctx.now, pos.id, 'Cancellation requested — ' + pos.cancelRequest.reason);
        notify(db, ctx.now, { toRole: 'AD2 Branch Inputter', text: `Cancellation requested on ${pos.id}`, link: '#/B-06' });
        return { message: `Cancellation requested — ${nodeName(db, pos.branchId)} confirms it.` };
      },
    };
    C['position.keep'] = {
      cap: 'tmp.cutoff',
      run(db, a, p, ctx) {
        const pos = branchPos(db, a, p.id);
        need(pos.status === 'Open' && pos.cutoffAt, `${pos.id} has no cut-off to hold past.`);
        const until = istAt(nextDay(istDate(pos.cutoffAt)), '11:00');
        pos.kept = { until, reason: txt(p.reason, 'Reason', { max: 300 }), by: actorLabel(a), at: ctx.now };
        pos.cutoffAt = until;
        audit(db, a, ctx.now, pos.id, `Held past cut-off until ${istClock(until)} IST next working day — ${pos.kept.reason}`);
        notify(db, ctx.now, { toRole: 'AD2 Treasury Dealer', text: `${pos.id} held past cut-off by ${nodeName(db, pos.branchId)}`, link: '#/T-02' });
        return { message: `${pos.id} held past cut-off — Treasury notified.` };
      },
    };
    C['position.inform'] = {
      cap: 'tmp.cutoff',
      run(db, a, p, ctx) {
        const pos = branchPos(db, a, p.id);
        const msg = txt(p.message, 'Message', { max: 300 });
        (pos.notes = pos.notes || []).push({ at: ctx.now, by: actorLabel(a), text: msg, to: 'Treasury' });
        if (p.delayed) pos.delayReported = ctx.now;
        audit(db, a, ctx.now, pos.id, 'Treasury informed — ' + msg);
        notify(db, ctx.now, { toRole: 'AD2 Treasury Dealer', text: `${nodeName(db, pos.branchId)} on ${pos.id}: ${msg}`, link: '#/T-06' });
        return { message: 'Treasury informed.' };
      },
    };
    C['reminder.ack'] = {
      cap: 'tmp.cutoff',
      run(db, a, p, ctx) {
        const ids = (Array.isArray(p.ids) ? p.ids : []).slice(0, 50);
        need(ids.length, 'Select at least one reminder.');
        ids.forEach(id => {
          const r = find(db.reminders, id) || missing('Reminder');
          if (!inScope(db, a, r.branchId)) forbid('That reminder belongs to another branch.');
          Object.assign(r, { state: 'Acknowledged', ackAt: ctx.now, ackBy: actorLabel(a), note: txt(p.note, 'Note', { max: 200, required: false }) || r.note });
        });
        return { message: `${ids.length} reminder${ids.length === 1 ? '' : 's'} acknowledged — escalation paused for 2 hours.` };
      },
    };
    C['reminder.raise'] = {
      cap: 'tmp.exceptions',
      run(db, a, p, ctx) {
        const pos = posFor(db, p.positionId);
        raiseReminder(db, pos, txt(p.reason, 'Reason', { max: 120, required: false }) || 'No FX Plus reference', ctx.now, actorLabel(a));
        notify(db, ctx.now, { toRole: 'AD2 Branch Inputter', text: `Treasury reminder on ${pos.id}`, link: '#/B-09' });
        return { message: `${nodeName(db, pos.branchId)} reminded about ${pos.id}.` };
      },
    };
    function raiseReminder(db, pos, reason, now, by) {
      if ((db.reminders || []).some(r => r.positionId === pos.id && r.state !== 'Closed')) return;
      arr(db, 'reminders').unshift({ id: 'RM-' + pad(seq(db, 'rem'), 4), positionId: pos.id, branchId: pos.branchId, raisedAt: now,
        reason, state: 'Open', by: by || 'System' });
    }
    function reminderState(db, r, now) {
      if (r.state === 'Closed') return 'Closed';
      const esc = Number(settings(db).escalateAfterMin || 120);
      if (r.state === 'Acknowledged' && minutesBetween(r.ackAt, now) < esc) return 'Acknowledged';
      return minutesBetween(r.raisedAt, now) >= esc ? 'Escalated' : r.state === 'Acknowledged' ? 'Acknowledged' : 'Open';
    }

    /* Every command sweeps first (there is no scheduler). */
    hooks.sweep = (db, now) => {
      if (!db.positions) return;
      const after = Number(settings(db).reminderAfterMin || 30);
      db.positions.forEach(p => {
        if (tradeChannel(p) || !p.cutoffAt) return;
        if (p.status === 'Open' && T.remaining(p) > 0.005) {
          if (p.cutoffAt <= now) {
            T.cancelResidual(db, SYSTEM, p, p.cancelRequest ? 'Cancelled at cut-off — ' + p.cancelRequest.reason : 'Not concluded by cut-off', now);
            (db.reminders || []).filter(x => x.positionId === p.id && x.state !== 'Closed').forEach(x => { x.state = 'Closed'; x.closedAt = now; });
            notify(db, now, { toRole: 'AD2 Branch Inputter', text: `${p.id} cancelled at cut-off — residual released`, link: '#/B-06' });
          } else if ((p.linkedAmount || 0) <= 0.005 && minutesBetween(p.bookedAt, now) >= after) raiseReminder(db, p, 'No FX Plus reference', now);
        }
      });
      (db.quotes || []).forEach(q => { if (q.status === 'Live' && q.validUntil <= now) q.status = 'Expired'; });
    };

    /* ---------- covers: type, forward settlement, liquidity ------------------------------ */
    hooks.onCoverSaved = (db, c, now) => {
      if (c.type === 'Spot') settleCoverCash(db, c, c.amount, now);
    };
    function settleCoverCash(db, c, amt, now) {
      const cp = (db.counterparties || []).find(x => x.name === c.counterparty) || {};
      const bank = find(db.bankAccounts, cp.settlementAccount) || (db.bankAccounts || []).find(b => b.currency === 'INR' && b.owner === 'HO');
      const inrAmt = round2(amt * c.rate);
      if (bank) { const sg = c.side === 'BUY' ? -1 : 1; bank.ledger = round2(bank.ledger + sg * inrAmt); bank.available = round2(bank.available + sg * inrAmt); }
      moveNostro(db, c.currency, c.side === 'BUY' ? amt : -amt, now, `${c.id} ${c.counterparty}`);
    }
    C['forward.settle'] = {
      cap: 'tmp.settle',
      run(db, a, p, ctx) {
        const c = find(db.covers, p.id) || missing('Cover deal');
        need(c.type === 'Forward', `${c.id} is a ${String(c.type || 'spot').toLowerCase()} deal; only forward covers settle here.`);
        need(c.status === 'Active', `${c.id} is ${c.status.toLowerCase()}.`);
        const pendingDraft = (db.approvals || []).some(x => x.type === 'Forward settlement' && x.status === 'Pending' && x.payload.coverId === c.id);
        need(!pendingDraft, `${c.id} already has a settlement waiting for the checker.`);
        const settled = c.settled || 0, pending = round2(c.amount - settled);
        const amt = amount(p.amount, 'Settlement amount');
        need(amt <= pending + 0.005, `${c.id} has ${fmt(pending, c.currency)} pending; ${fmt(amt, c.currency)} is more.`);
        const evidence = txt(p.evidence, 'Evidence reference', { max: 60 });
        const r = submitApproval(db, a, ctx.now, { type: 'Forward settlement', ref: c.id, title: `${c.id} — settle ${fmt(amt, c.currency)}`,
          amount: amt, currency: c.currency, payload: { coverId: c.id, amount: amt, evidence },
          diff: [[`Settled ${c.currency}`, fmt(settled), fmt(settled + amt)], [`Pending ${c.currency}`, fmt(pending), fmt(pending - amt)],
                 ['Settlement amount', '—', fmt(amt, c.currency)], [`INR principal at ${c.rate.toFixed(4)}`, '—', fmt(round2(amt * c.rate))],
                 ['Evidence / date', '—', `${evidence} / ${istDate(ctx.now)}`]],
          note: txt(p.note, 'Note', { max: 300, required: false }) });
        return { id: r.id, message: `Settlement sent to a checker (${r.id}). The approved balance does not change until approval.` };
      },
    };
    APPLY['Forward settlement'] = (db, a, r, now) => {
      const c = find(db.covers, r.payload.coverId);
      need(c && c.status === 'Active', 'That cover deal is no longer active.');
      const amt = r.payload.amount;
      need(amt <= c.amount - (c.settled || 0) + 0.005, 'The settlement is now more than the pending amount.');
      c.settled = round2((c.settled || 0) + amt);
      (c.settlements = c.settlements || []).push({ amount: amt, at: now, evidence: r.payload.evidence, maker: r.maker, checker: actorLabel(a), approval: r.id });
      settleCoverCash(db, c, amt, now);
      if (c.settled >= c.amount - 0.005) c.settledAt = now;
      return `${fmt(amt, c.currency)} settled on ${c.id}; ${fmt(c.amount - c.settled, c.currency)} pending.`;
    };
    C['cover.cancel'] = {
      cap: 'treasury.deal',
      run(db, a, p, ctx) {
        const c = find(db.covers, p.id) || missing('Cover deal');
        need(c.status === 'Active', `${c.id} is ${c.status.toLowerCase()}.`);
        need((c.allocated || 0) <= 0.005, `${c.id} has ${fmt(c.allocated, c.currency)} allocated — release the allocations first.`);
        need(!(c.settled > 0), `${c.id} is partly settled.`);
        c.status = 'Cancelled'; c.cancelReason = txt(p.reason, 'Reason', { max: 200 }); c.cancelledAt = ctx.now;
        if (c.type === 'Spot') settleCoverCash(db, { ...c, side: c.side === 'BUY' ? 'SELL' : 'BUY' }, c.amount, ctx.now);
        audit(db, a, ctx.now, c.id, 'Cover deal cancelled — ' + c.cancelReason);
        return { message: `${c.id} cancelled.` };
      },
    };

    /* ---------- liquidity --------------------------------------------------------------- */
    function moveNostro(db, cur, amt, now, why) {
      const n = (db.nostro || []).find(x => x.kind === 'Correspondent' && x.currency === cur && x.status === 'Current');
      if (!n) return;
      n.balance = round2(n.balance + amt); n.statementAt = now; n.updatedBy = 'SWIFT MT950 — ' + why;
    }
    const hoInr = db => find(db.bankAccounts, 'BK-HDFC-1042') || (db.bankAccounts || []).find(b => b.currency === 'INR');
    const moveInr = (db, amt) => { const b = hoInr(db); if (b) { b.ledger = round2(b.ledger + amt); b.available = round2(b.available + amt); } };
    /* Trade settlements move company liquidity. */
    hooks.onLinked = (db, p, rec, ref, now) => {
      if (!rec) return;
      if (rec.utr) { moveNostro(db, rec.currency, -rec.amount, now, 'payment ' + rec.utr); moveInr(db, rec.debitInr || round2(rec.amount * p.customerRate)); }
      else if (rec.firc) moveInr(db, -(rec.creditInr || round2(rec.amount * p.customerRate)));
    };
    E.onInwardCredit = (db, i, now) => moveNostro(db, i.currency, i.amount, now, 'receipt ' + (i.reference || i.id));
    /* Branch deals move stock: cash deals move currency and INR cash, card
       loads move customer card balances, remittances move the Nostro. */
    hooks.onBranchConcluded = (db, p, now) => {
      const sgn = p.side === 'SELL' ? -1 : 1;
      if (p.product === 'CSH') {
        const inv = invFor(db, p.branchId, p.currency);
        if (sgn < 0) consumeLots(inv, p.linkedAmount); else inv.lots.push({ qty: p.linkedAmount, at: now });
        const cash = cashFor(db, p.branchId);
        const inrAmt = round2(p.linkedAmount * p.customerRate);
        if (sgn < 0) cash.lots.push({ amount: inrAmt, at: now }); else consumeLots(cash, inrAmt, 'amount');
      } else if (p.product === 'FXC') {
        const cb = (db.cardBalances || []).find(x => x.network === 'Visa' && x.currency === p.currency) || (db.cardBalances || []).find(x => x.currency === p.currency);
        if (cb) { cb.balance = round2(cb.balance + p.linkedAmount); cb.branches = cb.branches || {}; const br = cb.branches[p.branchId] = cb.branches[p.branchId] || { cards: 0, balance: 0 }; br.cards += 1; br.balance = round2(br.balance + p.linkedAmount); }
        arr(db, 'cardActivity').unshift({ id: 'INV-' + pad(seq(db, 'inv'), 5), kind: 'Sale', prefix: '4', issuer: 'Visa', currency: p.currency,
          amount: p.linkedAmount, rate: p.customerRate, dsr: (deskRow(db, 'FXC', p.currency) || {}).card || p.customerRate, at: now, funding: 'INR',
          branchId: p.branchId, positionId: p.id, mapped: 0 });
      } else if (p.product === 'REM') moveNostro(db, p.currency, sgn * p.linkedAmount, now, 'branch remittance ' + p.id);
    };
    const invFor = (db, loc, cur) => { let i = (db.inventory || []).find(x => x.locationId === loc && x.currency === cur); if (!i) { i = { locationId: loc, currency: cur, lots: [] }; arr(db, 'inventory').push(i); } return i; };
    const cashFor = (db, loc) => { let c = (db.cash || []).find(x => x.locationId === loc); if (!c) { c = { locationId: loc, lots: [], lastCounted: null }; arr(db, 'cash').push(c); } return c; };
    function consumeLots(holder, amt, key) {
      const k = key || 'qty';
      let left = amt;
      holder.lots.sort((x, y) => String(x.at).localeCompare(String(y.at)));
      holder.lots.forEach(l => { if (left <= 0) return; const take = Math.min(l[k], left); l[k] = round2(l[k] - take); left = round2(left - take); });
      holder.lots = holder.lots.filter(l => l[k] > 0.005);
      if (left > 0.005) holder.lots.push({ [k]: -left, at: new Date().toISOString(), short: true });
    }
    /* Nostro statements are uploaded by hand. A duplicate statement date is
       replaced only with a reason, and only after a checker approves. */
    C['nostro.upload'] = {
      cap: 'tmp.liquidity',
      run(db, a, p, ctx) {
        const rows = (Array.isArray(p.rows) ? p.rows : []).slice(0, 60);
        need(rows.length, 'The statement has no rows.');
        const onDup = oneOf(p.onDuplicate || 'ask', ['ask', 'replace', 'skip'], 'Duplicate handling');
        const clean = rows.map((r, i) => ({ issuer: txt(r.issuer, `Row ${i + 1} issuer`, { max: 60 }), currency: oneOf(r.currency, db.currencies.map(c => c.code), `Row ${i + 1} currency`),
          balance: Number(r.balance), statementDate: date(r.statementDate, `Row ${i + 1} statement date`) }));
        clean.forEach((r, i) => need(isFinite(r.balance), `Row ${i + 1}: the balance is not a number.`));
        const dup = r => (db.nostro || []).find(n => n.kind === 'Issuer' && n.issuer === r.issuer && n.currency === r.currency && n.status === 'Current' && String(n.statementAt).slice(0, 10) === r.statementDate);
        const dups = clean.filter(dup), fresh = clean.filter(r => !dup(r));
        if (dups.length && onDup === 'ask') fail(`${dups.length} duplicate row${dups.length === 1 ? '' : 's'}: ${dups.map(r => `${r.issuer} / ${r.currency} / ${r.statementDate}`).join('; ')}. Choose replace with a reason, or skip.`);
        const file = txt(p.file, 'File name', { max: 120, required: false }) || 'statement.xlsx';
        fresh.forEach(r => {
          (db.nostro || []).filter(n => n.kind === 'Issuer' && n.issuer === r.issuer && n.currency === r.currency && n.status === 'Current').forEach(n => { n.status = 'Superseded'; });
          arr(db, 'nostro').unshift({ id: 'NOS-' + pad(seq(db, 'nos'), 4), kind: 'Issuer', issuer: r.issuer, currency: r.currency, balance: round2(r.balance),
            statementAt: istAt(r.statementDate, '13:00'), updatedBy: actorLabel(a), source: 'Manual upload — ' + file, status: 'Current', uploadedAt: ctx.now });
        });
        let apr = null;
        if (dups.length && onDup === 'replace') {
          const reason = txt(p.reason, 'Reason for replacing', { max: 200 });
          apr = submitApproval(db, a, ctx.now, { type: 'Nostro upload — replace', ref: file, title: `${dups.length} replacement row${dups.length === 1 ? '' : 's'} from ${file}`,
            amount: dups[0].balance, currency: dups[0].currency, payload: { rows: dups, file },
            diff: dups.map(r => [`${r.issuer} ${r.currency} ${r.statementDate}`, fmt(dup(r).balance), fmt(r.balance)]), note: reason });
        }
        audit(db, a, ctx.now, 'NOSTRO', `Statement ${file} uploaded — ${fresh.length} row(s) committed${dups.length ? `, ${dups.length} duplicate(s) ${onDup === 'replace' ? 'sent to checker' : 'skipped'}` : ''}`);
        return { committed: fresh.length, message: `${fresh.length} row${fresh.length === 1 ? '' : 's'} committed${dups.length ? ` — ${dups.length} duplicate${dups.length === 1 ? '' : 's'} ${onDup === 'replace' ? `sent to a checker (${apr.id})` : 'skipped'}` : ''}.` };
      },
    };
    APPLY['Nostro upload — replace'] = (db, a, r, now) => {
      r.payload.rows.forEach(row => {
        (db.nostro || []).filter(n => n.kind === 'Issuer' && n.issuer === row.issuer && n.currency === row.currency && n.status === 'Current').forEach(n => { n.status = 'Superseded'; });
        arr(db, 'nostro').unshift({ id: 'NOS-' + pad(seq(db, 'nos'), 4), kind: 'Issuer', issuer: row.issuer, currency: row.currency, balance: round2(row.balance),
          statementAt: istAt(row.statementDate, '13:00'), updatedBy: r.maker, source: 'Manual upload — ' + r.payload.file + ' (replacement)', status: 'Current', uploadedAt: now, reason: r.note });
      });
      return `${r.payload.rows.length} Nostro row(s) replaced; prior versions retained.`;
    };

    /* ---------- integrations and freshness ------------------------------------------------ */
    const integ = (db, id) => (db.integrations || []).find(x => x.id === id);
    function touchIntegration(db, id, now, what) {
      const i = integ(db, id);
      if (!i) return;
      i.lastSuccess = now; i.status = 'Healthy'; i.pending = 0; i.lastBatch = what || i.lastBatch;
    }
    /* A figure is fresh within its expected interval, ageing past one cycle,
       stale past the threshold: stale figures stay visible but leave the
       fresh subtotal, and the screen says so. */
    function freshness(asOf, now, cycleMin, staleMin) {
      if (!asOf) return 'Stale';
      const m = minutesBetween(asOf, now);
      return m <= (cycleMin || 30) ? 'Fresh' : m <= (staleMin || 360) ? 'Ageing' : 'Stale';
    }
    C['integration.pull'] = {
      run(db, a, p, ctx) {
        need(can(db, a, 'tmp.liquidity') || can(db, a, 'tmp.rates') || can(db, a, 'tmp.admin') || can(db, a, 'tmp.finance'), 'Your role cannot refresh integrations.');
        const i = integ(db, p.id) || missing('Integration');
        need(i.status !== 'Not selected', `${i.name} has no source configured.`);
        let what = 'refreshed';
        if (i.id === 'BANKAGG') (db.bankAccounts || []).filter(b => b.source === 'Bank aggregator' && !b.feedDown).forEach(b => { b.asOf = ctx.now; });
        if (i.id === 'EURONET' || i.id === 'PINELABS') (db.cardBalances || []).filter(b => b.source === (i.id === 'EURONET' ? 'Euronet' : 'Pine Labs')).forEach(b => { b.asOf = ctx.now; });
        if (i.id === 'FXP-API') { (db.inventory || []).forEach(x => { x.asOf = ctx.now; }); (db.cash || []).forEach(x => { x.asOf = ctx.now; }); }
        if (i.id === 'IBR') { (db.currencies || []).forEach(c => { c.importedBase = r4(ibr(db, c.code, ctx.now) * (1 - 0.0012)); c.importedAt = ctx.now; }); what = 'IBR snapshot'; }
        if (i.id === 'FXP-SFTP') {
          const due = (db.fxpInbox || []).filter(t => t.arrivesAt <= ctx.now);
          due.forEach(t => { const { arrivesAt, ...rest } = t; arr(db, 'fxpTxns').unshift({ ...rest, receivedAt: ctx.now, links: [] }); });
          db.fxpInbox = (db.fxpInbox || []).filter(t => t.arrivesAt > ctx.now);
          what = `${due.length} bill${due.length === 1 ? '' : 's'}`;
        }
        touchIntegration(db, i.id, ctx.now, what);
        audit(db, a, ctx.now, i.id, `${i.name} refreshed — ${what}`);
        return { message: `${i.name} refreshed — ${what}.` };
      },
    };
    C['integration.retry'] = {
      run(db, a, p, ctx) {
        need(can(db, a, 'tmp.liquidity') || can(db, a, 'tmp.admin'), 'Your role cannot retry integration jobs.');
        const i = integ(db, p.id) || missing('Integration');
        need(['Delayed', 'Failed'].includes(i.status), `${i.name} is ${i.status.toLowerCase()} — nothing to retry.`);
        const n = i.pending || 0;
        C['integration.pull'].run(db, a, { id: i.id }, ctx);
        return { message: `${i.name} job requeued — ${n} row${n === 1 ? '' : 's'} recovered, none duplicated.` };
      },
    };
    C['integration.configure'] = {
      cap: 'tmp.admin',
      run(db, a, p, ctx) {
        const i = integ(db, p.id) || missing('Integration');
        if (p.transport) i.transport = txt(p.transport, 'Transport', { max: 60 });
        if (p.schedule) i.schedule = txt(p.schedule, 'Schedule', { max: 40 });
        if (p.rotate) i.credsRotatedAt = ctx.now;
        if (i.id === 'IBR' && p.transport) i.status = 'Healthy';
        audit(db, a, ctx.now, i.id, `${i.name} configuration changed${p.rotate ? ' — credentials rotated' : ''}${p.transport ? ` — transport ${i.transport}` : ''}${p.schedule ? ` — schedule ${i.schedule}` : ''}`);
        return { message: `${i.name} updated.` };
      },
    };

    /* ---------- credit lines ------------------------------------------------------------ */
    /* The ICICI funding rule is a proposal (BR-07): each version counts a
       different set of activity, so switching re-derives utilisation. */
    const RULES = { 'v0.1': ['Load / reload'], 'v0.2': ['Load / reload', 'Cashout'], 'v0.3': ['Load / reload', 'Cashout', 'Settlement'] };
    function lineUse(l, version) {
      const counts = RULES[version || l.ruleVersion] || RULES['v0.3'];
      let u = l.opening || 0;
      (l.activity || []).filter(x => x.state === 'Applied' && counts.includes(x.kind)).forEach(x => { u += x.kind === 'Load / reload' ? x.amount : -x.amount; });
      if (l.purpose !== 'Card funding') u = l.opening + (l.drawn || 0);
      u = round2(Math.max(0, u));
      return { utilised: u, available: round2(l.limit - u), pct: l.limit ? Math.round(u / l.limit * 100) : 0 };
    }
    C['credit.settle'] = {
      cap: 'tmp.settle',
      run(db, a, p, ctx) {
        const l = find(db.creditLines, p.lineId) || missing('Credit line');
        const amt = amount(p.amount, 'Settlement amount (INR)');
        const ref = txt(p.ref, 'Settlement reference', { max: 40 });
        const before = lineUse(l);
        const act = { id: ref, kind: 'Settlement', source: 'Manual entry', amount: amt, state: 'Draft', at: ctx.now, by: actorLabel(a) };
        arr(l, 'activity').unshift(act);
        const after = lineUse({ ...l, activity: l.activity.map(x => x === act ? { ...x, state: 'Applied' } : x) });
        submitApproval(db, a, ctx.now, { type: 'Credit line settlement', ref, title: `${l.bank} settlement ${ref}`, amount: amt, currency: 'INR',
          payload: { lineId: l.id, ref }, diff: [['Utilised (INR)', fmt(before.utilised), fmt(after.utilised)], ['Available (INR)', fmt(before.available), fmt(after.available)]] });
        return { message: `Settlement ${ref} sent to a checker — utilisation changes on approval.` };
      },
    };
    APPLY['Credit line settlement'] = (db, a, r) => {
      const l = find(db.creditLines, r.payload.lineId);
      const act = l && (l.activity || []).find(x => x.id === r.payload.ref && x.state === 'Draft');
      need(act, 'The draft settlement was not found.');
      act.state = 'Applied'; act.approvedBy = actorLabel(a);
      return `${l.bank} utilisation now ${inr(lineUse(l).utilised)}.`;
    };
    REJECT['Credit line settlement'] = (db, a, r) => { const l = find(db.creditLines, r.payload.lineId); const act = l && (l.activity || []).find(x => x.id === r.payload.ref); if (act) act.state = 'Rejected'; };
    C['credit.ruleVersion'] = {
      cap: 'tmp.settle',
      run(db, a, p, ctx) {
        const l = find(db.creditLines, p.lineId) || missing('Credit line');
        const v = oneOf(p.version, Object.keys(RULES), 'Rule version');
        need(v !== l.ruleVersion, `${l.bank} already uses ${v}.`);
        const b = lineUse(l), n = lineUse(l, v);
        submitApproval(db, a, ctx.now, { type: 'Funding rule version', ref: l.id, title: `${l.bank} funding rule ${l.ruleVersion} → ${v}`, amount: null, currency: 'INR',
          payload: { lineId: l.id, version: v }, diff: [['Rule version', l.ruleVersion, v], ['Utilised (INR)', fmt(b.utilised), fmt(n.utilised)], ['Utilisation', b.pct + '%', n.pct + '%']] });
        return { message: `Rule ${v} sent to a checker — preview only until approved.` };
      },
    };
    APPLY['Funding rule version'] = (db, a, r) => { const l = find(db.creditLines, r.payload.lineId); l.ruleVersion = r.payload.version; return `${l.bank} now on rule ${l.ruleVersion}.`; };

    /* ---------- customer limits ----------------------------------------------------------- */
    C['limits.raise'] = {
      cap: 'tmp.limits',
      run(db, a, p, ctx) {
        const l = limitFor(db, p.id) || missing('Customer limit');
        const to = amount(p.limit, 'New limit (INR)');
        need(Math.abs(to - l.limit) > 0.5, 'The new limit is the same as the current one.');
        const why = txt(p.reason, 'Justification', { max: 300 });
        const u = limitUse(db, l, ctx.now);
        submitApproval(db, a, ctx.now, { type: 'Limit change', ref: l.id, title: `${l.name} limit ${inr(l.limit)} → ${inr(to)}`, amount: to, currency: 'INR',
          payload: { id: l.id, limit: to }, diff: [['Limit (INR)', fmt(l.limit), fmt(to)], ['Available (INR)', fmt(u.available), fmt(round2(to - u.outstanding))],
            ['Utilised', u.pct + '%', (to ? Math.round(u.outstanding / to * 100) : 0) + '%']], note: why });
        return { message: 'Limit change sent to a checker.' };
      },
    };
    APPLY['Limit change'] = (db, a, r) => { const l = limitFor(db, r.payload.id); l.limit = r.payload.limit; l.changedAt = new Date().toISOString(); return `${l.name} limit now ${inr(l.limit)}.`; };

    /* ---------- card settlements and reconciliation ---------------------------------------- */
    const issuerOf = (db, prefix) => ((db.cardPrefixes || []).slice().sort((x, y) => y.prefix.length - x.prefix.length).find(x => String(prefix).startsWith(x.prefix)) || {}).issuer || null;
    C['card.map'] = {
      cap: 'tmp.finance',
      run(db, a, p, ctx) {
        const st = find(db.cardSettlements, p.id) || missing('Settlement');
        const rows = (Array.isArray(p.rows) ? p.rows : []).slice(0, 50).filter(r => Number(r.amount) > 0);
        need(rows.length, 'Select at least one invoice to map.');
        const left = round2(st.amount - (st.mappings || []).reduce((t, m) => t + m.amount, 0));
        const total = round2(rows.reduce((t, r) => t + Number(r.amount), 0));
        need(total <= left + 0.005, `Mapping ${fmt(total, st.currency)} is more than the ${fmt(left, st.currency)} unmapped on ${st.id}.`);
        rows.forEach(r => {
          const inv = find(db.cardActivity, r.invoiceId) || missing('Invoice');
          need(inv.kind === 'Sale' && inv.funding !== 'EEFC', `${inv.id} is not an INR-funded card sale.`);
          need(issuerOf(db, inv.prefix) === st.issuer && inv.currency === st.currency, `${inv.id} is not a ${st.issuer} ${st.currency} sale.`);
          const amt = amount(r.amount, 'Map amount');
          need(amt <= inv.amount - (inv.mapped || 0) + 0.005, `${inv.id} has only ${fmt(inv.amount - (inv.mapped || 0), inv.currency)} pending.`);
          inv.mapped = round2((inv.mapped || 0) + amt);
          (st.mappings = st.mappings || []).push({ invoiceId: inv.id, amount: amt, at: ctx.now, by: actorLabel(a) });
        });
        audit(db, a, ctx.now, st.id, `${rows.length} invoice(s) mapped — ${fmt(total, st.currency)}`);
        return { message: `${rows.length} invoice${rows.length === 1 ? '' : 's'} mapped — ${fmt(left - total, st.currency)} unmapped on ${st.id}.` };
      },
    };
    C['recon.adjust'] = {
      cap: 'tmp.finance',
      run(db, a, p, ctx) {
        const st = find(db.cardSettlements, p.id) || missing('Settlement');
        const amt = amount(p.amount, 'Adjustment (INR)');
        const why = txt(p.reason, 'Adjustment reason', { max: 300 });
        submitApproval(db, a, ctx.now, { type: 'Reconciliation adjustment', ref: st.id, title: `${st.id} adjustment ${inr(amt)}`, amount: amt, currency: 'INR',
          payload: { id: st.id, amount: amt }, diff: [['Residual (INR)', fmt(reconOf(db, st).residualInr), fmt(Math.max(0, reconOf(db, st).residualInr - amt))]], note: why });
        return { message: 'Adjustment sent to a checker.' };
      },
    };
    APPLY['Reconciliation adjustment'] = (db, a, r) => { const st = find(db.cardSettlements, r.payload.id); st.adjustedInr = round2((st.adjustedInr || 0) + r.payload.amount); return `${st.id} adjusted.`; };
    function reconOf(db, st) {
      const mapped = round2((st.mappings || []).reduce((t, m) => t + m.amount, 0));
      const rate = st.inrRate || (currencyOf(db, st.currency) || {}).refRate || 1;
      const amountInr = round2(st.amount * rate), matchedInr = round2(mapped * rate + (st.adjustedInr || 0));
      return { mapped, amountInr, matchedInr: Math.min(amountInr, matchedInr), residualInr: round2(Math.max(0, amountInr - matchedInr)) };
    }

    /* ---------- regional bulk bookings -------------------------------------------------------- */
    C['bulk.request'] = {
      cap: 'tmp.bulk.request',
      run(db, a, p, ctx) {
        const b = node(db, p.branchId);
        need(b && ['Branch', 'Airport'].includes(b.type), 'Choose the branch the currency is for.');
        if (!inScope(db, a, b.id)) forbid('That branch is outside your region.');
        const id = 'REQ-' + (3080 + seq(db, 'bulk'));
        const req = { id, regionId: (regionOf(db, b.id) || {}).id, branchId: b.id, currency: oneOf(p.currency, db.currencies.map(c => c.code), 'Currency'),
          amount: amount(p.amount, 'Amount'), requiredDate: date(p.requiredDate, 'Required date'), purpose: txt(p.purpose, 'Purpose', { max: 120, required: false }) || 'Currency inventory',
          status: 'With Treasury', raisedAt: ctx.now, raisedBy: actorLabel(a), raisedByKey: actorKey(a) };
        need(req.requiredDate >= istDate(ctx.now), 'The required date cannot be in the past.');
        arr(db, 'bulkRequests').unshift(req);
        audit(db, a, ctx.now, id, `Bulk booking requested — ${fmt(req.amount, req.currency)} for ${b.name} by ${req.requiredDate}`);
        notify(db, ctx.now, { toRole: 'AD2 Treasury Dealer', text: `Bulk booking ${id}: ${fmt(req.amount, req.currency)} for ${b.name}`, link: '#/T-17' });
        return { id, message: `Booking request ${id} raised with Treasury.` };
      },
    };
    const bulkFor = (db, id) => find(db.bulkRequests, id) || missing('Booking request');
    C['bulk.book'] = {
      cap: 'tmp.bulk.book',
      run(db, a, p, ctx) {
        const r = bulkFor(db, p.id);
        need(['With Treasury', 'Needs detail'].includes(r.status), `${r.id} is ${r.status.toLowerCase()}.`);
        const rate = Number(p.rate); const ref = currencyOf(db, r.currency).refRate;
        need(isFinite(rate) && rate > 0 && Math.abs(rate - ref) / ref < 0.03, `Enter the booked rate (within 3% of ${ref}).`);
        const det = { bankRef: txt(p.bankRef, 'Bank reference', { max: 40 }), counterparty: txt(p.counterparty, 'Bank', { max: 60 }), rate: r4(rate),
          valueDate: date(p.valueDate, 'Value date'), legacyRef: txt(p.legacyRef, 'Legacy reference', { max: 40, required: false }) };
        r.status = 'Awaiting checker';
        submitApproval(db, a, ctx.now, { type: 'Bulk booking detail', ref: r.id, title: `${r.id} — ${fmt(r.amount, r.currency)} for ${nodeName(db, r.branchId)}`,
          amount: r.amount, currency: r.currency, payload: { id: r.id, detail: det },
          diff: [['Status', 'With Treasury', 'Booked'], ['Bank reference', '—', det.bankRef], ['Rate', '—', det.rate.toFixed(4)], ['Value date', '—', det.valueDate],
                 [`INR principal`, '—', fmt(round2(r.amount * det.rate))]] });
        return { message: `${r.id} booking detail sent to a checker.` };
      },
    };
    APPLY['Bulk booking detail'] = (db, a, r, now) => {
      const q = bulkFor(db, r.payload.id);
      q.status = 'Booked'; q.booking = r.payload.detail; q.bookedAt = now;
      invFor(db, q.branchId, q.currency).lots.push({ qty: q.amount, at: now, bulk: q.id });
      moveInr(db, -round2(q.amount * q.booking.rate));
      notify(db, now, { toRole: 'AD2 Regional Bulk', text: `${q.id} booked — ${fmt(q.amount, q.currency)} for ${nodeName(db, q.branchId)}`, link: '#/OPS-01' });
      return `${q.id} booked; currency added to ${nodeName(db, q.branchId)} inventory.`;
    };
    REJECT['Bulk booking detail'] = (db, a, r) => { const q = find(db.bulkRequests, r.payload.id); if (q) q.status = 'With Treasury'; };
    C['bulk.needsDetail'] = {
      cap: 'tmp.bulk.book',
      run(db, a, p, ctx) {
        const r = bulkFor(db, p.id);
        need(r.status === 'With Treasury', `${r.id} is ${r.status.toLowerCase()}.`);
        r.status = 'Needs detail'; r.query = txt(p.note, 'What is missing', { max: 300 });
        notify(db, ctx.now, { toRole: 'AD2 Regional Bulk', text: `${r.id} needs detail: ${r.query}`, link: '#/OPS-01' });
        return { message: `${r.id} returned to the requester.` };
      },
    };
    C['bulk.update'] = {
      cap: 'tmp.bulk.request',
      run(db, a, p, ctx) {
        const r = bulkFor(db, p.id);
        need(r.status === 'Needs detail', `${r.id} is not waiting on you.`);
        if (p.amount) r.amount = amount(p.amount, 'Amount');
        if (p.requiredDate) r.requiredDate = date(p.requiredDate, 'Required date');
        r.response = txt(p.note, 'Response', { max: 300 }); r.status = 'With Treasury';
        return { message: `${r.id} back with Treasury.` };
      },
    };
    C['bulk.reject'] = {
      cap: 'tmp.bulk.book',
      run(db, a, p, ctx) {
        const r = bulkFor(db, p.id);
        need(['With Treasury', 'Needs detail'].includes(r.status), `${r.id} is ${r.status.toLowerCase()}.`);
        r.status = 'Rejected'; r.rejectReason = txt(p.reason, 'Reason', { max: 300 });
        notify(db, ctx.now, { toRole: 'AD2 Regional Bulk', text: `${r.id} rejected: ${r.rejectReason}`, link: '#/OPS-01' });
        return { message: `${r.id} rejected.` };
      },
    };

    /* ---------- exceptions: separate, owned, aged ------------------------------------------- */
    function exceptionList(db, now) {
      const out = [];
      const age = at => at ? Math.max(0, Math.round(minutesBetween(at, now))) : 0;
      (db.positions || []).filter(p => !tradeChannel(p) && p.status === 'Open' && (p.linkedAmount || 0) <= 0.005 && minutesBetween(p.bookedAt, now) >= Number(settings(db).reminderAfterMin || 30))
        .forEach(p => out.push({ key: 'NOTXN:' + p.id, type: 'Position without transaction', pill: 'No txn link', ref: p.id, currency: p.currency, amount: T.remaining(p),
          age: age(p.bookedAt), owner: nodeName(db, p.branchId), branchId: p.branchId, resolution: 'Remind branch', positionId: p.id }));
      (db.fxpTxns || []).filter(t => !t.reversed && fxpAvail(t) > 0.005).forEach(t => {
        const cands = (db.positions || []).filter(p => p.status === 'Open' && p.branchId === t.branchId && p.product === t.product && p.side === t.side && T.remaining(p) > 0.005);
        const same = cands.filter(p => p.currency === t.currency);
        const ref = t.positionRef && find(db.positions, t.positionRef);
        if (ref && ref.currency !== t.currency || (!same.length && cands.length && t.customerRef))
          out.push({ key: 'MISMATCH:' + t.id, type: 'Currency mismatch', pill: 'Mismatch', ref: t.id, currency: t.currency, amount: fxpAvail(t), age: age(t.receivedAt),
            owner: nodeName(db, t.branchId), branchId: t.branchId, resolution: 'Review currency', fxpId: t.id, positionId: ref ? ref.id : (cands[0] || {}).id });
        else if (!same.length && minutesBetween(t.receivedAt, now) >= 15)
          out.push({ key: 'NOPOS:' + t.id, type: 'Transaction without position', pill: 'No position', ref: t.id, currency: t.currency, amount: fxpAvail(t), age: age(t.receivedAt),
            owner: nodeName(db, t.branchId), branchId: t.branchId, resolution: 'Ask branch to raise a position', fxpId: t.id });
      });
      (db.covers || []).filter(c => c.status === 'Active' && c.amount - (c.allocated || 0) > 0.005).forEach(c =>
        out.push({ key: 'COVER:' + c.id, type: 'Unallocated cover', pill: 'Unused cover', ref: c.id, currency: c.currency, amount: round2(c.amount - c.allocated),
          age: age(c.enteredAt), owner: 'Treasury', resolution: 'Allocate', coverId: c.id }));
      const notes = db.excNotes || {};
      return out.map(x => ({ ...x, note: notes[x.key] || null })).filter(x => !(x.note && x.note.status === 'Resolved'));
    }
    C['exception.note'] = {
      cap: 'tmp.exceptions',
      run(db, a, p, ctx) {
        const key = txt(p.key, 'Exception', { max: 60 });
        db.excNotes = db.excNotes || {};
        db.excNotes[key] = { owner: txt(p.owner, 'Owner', { max: 60, required: false }) || (db.excNotes[key] || {}).owner || 'Treasury',
          findings: txt(p.findings, 'Findings', { max: 400 }), status: p.resolve ? 'Resolved' : 'Investigating', at: ctx.now, by: actorLabel(a) };
        audit(db, a, ctx.now, key.split(':')[1], `Exception ${p.resolve ? 'resolved' : 'annotated'} — ${db.excNotes[key].findings}`);
        return { message: p.resolve ? 'Exception resolved.' : 'Exception assigned and annotated.' };
      },
    };
    C['exception.askBranch'] = {
      cap: 'tmp.exceptions',
      run(db, a, p, ctx) {
        const t = fxpFor(db, p.fxpId);
        db.excNotes = db.excNotes || {};
        const note = txt(p.note, 'Note', { max: 300 });
        db.excNotes['NOPOS:' + t.id] = { owner: nodeName(db, t.branchId), findings: 'Branch asked to raise a position — ' + note, status: 'Investigating', at: ctx.now, by: actorLabel(a) };
        notify(db, ctx.now, { toRole: 'AD2 Branch Inputter', text: `Treasury: raise a position for ${t.id} (${fmt(t.amount, t.currency)}) — ${note}`, link: '#/B-02' });
        return { message: `${nodeName(db, t.branchId)} asked to raise a position.` };
      },
    };

    /* ---------- offline capture ----------------------------------------------------------- */
    C['offline.submit'] = {
      cap: 'tmp.offline',
      run(db, a, p, ctx) {
        const entries = (Array.isArray(p.entries) ? p.entries : []).slice(0, 20);
        need(entries.length, 'Nothing queued.');
        const made = [];
        entries.forEach((e, i) => {
          const d = readDeal(db, a, { ...e, channel: 'Branch' }, ctx.now);
          const rate = Number(e.rate);
          need(isFinite(rate) && rate > 0, `Entry ${i + 1}: enter the rate committed to the customer.`);
          const at = String(e.committedAt || '');
          need(at && at <= ctx.now && minutesBetween(at, ctx.now) <= 24 * 60, `Entry ${i + 1}: the time committed must be within the last 24 hours.`);
          const reason = oneOf(e.reason, ['Network outage', 'Portal error', 'Power failure'], 'Reason');
          const pos = T.newPosition(db, a, null, { currency: d.currency, side: d.side, amount: d.amount, customerRate: r4(rate), refRate: currencyOf(db, d.currency).refRate,
            margin: 0, source: 'Branch', product: d.product, branchId: d.branchId, channel: 'Offline capture', customerName: d.customerName,
            customerRef: d.customerRef, valueDate: d.valueDate, bookedAt: at, cutoffAt: nextCutoff(db, d.product, d.branchId, ctx.now), offline: { reason, committedAt: at, submittedAt: ctx.now } }, ctx.now);
          pos.bookedAt = at;
          audit(db, a, ctx.now, pos.id, `Offline capture — rate ${r4(rate).toFixed(4)} committed at ${istClock(at)} IST outside the system (${reason}); flagged for treasury review`);
          made.push(pos.id);
        });
        notify(db, ctx.now, { toRole: 'AD2 Treasury Dealer', text: `${made.length} offline deal(s) from ${nodeName(db, loginOf(db, a).branchScope)} to review`, link: '#/T-02' });
        return { ids: made, message: `${made.length} offline entr${made.length === 1 ? 'y' : 'ies'} submitted — ${made.join(', ')} flagged for treasury review.` };
      },
    };

    /* ---------- administration --------------------------------------------------------------- */
    const TMP_ROLES = db => (db.roles || []).filter(r => r.portal === 'TMP').map(r => r.id);
    C['tmpuser.add'] = {
      cap: 'tmp.admin',
      run(db, a, p, ctx) {
        const name = txt(p.name, 'Name', { max: 100 });
        const loginId = txt(String(p.loginId || '').toUpperCase(), 'Login ID', { max: 20, pattern: /^[A-Z0-9]{3,20}$/, patternMsg: 'Login ID must be 3–20 capital letters or digits.' });
        need(!(db.logins || []).some(l => l.domainId === 'AD2' && l.loginId === loginId), `AD2/${loginId} already exists.`);
        const role = oneOf(p.role, TMP_ROLES(db).filter(r => r !== 'Agent Partner'), 'Role');
        const scope = p.branchScope ? String(p.branchScope) : null;
        if (scope) need(node(db, scope), 'Choose a node from the organisation hierarchy.');
        need(!(role === 'AD2 Branch Inputter') || scope, 'A branch user needs a branch scope.');
        submitApproval(db, a, ctx.now, { type: 'New user', ref: 'AD2/' + loginId, title: `${name} — ${role}`, amount: null, currency: null,
          payload: { domainId: 'AD2', loginId, name, role, branchScope: scope },
          diff: [['User', '—', `AD2/${loginId} — ${name}`], ['Role', '—', role], ['Branch scope', '—', scope ? nodeName(db, scope) : 'All branches']] });
        return { message: 'User created — pending checker approval.' };
      },
    };
    APPLY['New user'] = (db, a, r, now) => {
      const u = r.payload;
      need(!(db.logins || []).some(l => l.domainId === u.domainId && l.loginId === u.loginId), `${u.domainId}/${u.loginId} already exists.`);
      db.logins.push({ domainId: u.domainId, loginId: u.loginId, role: u.role, smeId: null, name: u.name, demo: true, active: true,
        branchScope: u.branchScope || undefined, addedBy: r.maker, addedAt: now });
      return `${u.domainId}/${u.loginId} can sign in with the demo passcode.`;
    };
    C['tmpuser.update'] = {
      cap: 'tmp.admin',
      run(db, a, p, ctx) {
        const l = (db.logins || []).find(x => x.domainId === p.domainId && x.loginId === p.loginId) || missing('User');
        need(TMP_ROLES(db).includes(l.role), 'Only Treasury Management Portal users are edited here.');
        if (p.active != null) {
          need(!(l.domainId === a.domainId && l.loginId === a.loginId), 'You cannot deactivate yourself.');
          l.active = p.active === true || p.active === 'true';
          audit(db, a, ctx.now, 'USERS', `${l.domainId}/${l.loginId} ${l.active ? 'enabled' : 'disabled'}`);
          return { message: `${l.name} ${l.active ? 'enabled' : 'disabled'}.` };
        }
        const role = p.role ? oneOf(p.role, TMP_ROLES(db), 'Role') : l.role;
        const scope = p.branchScope === '' ? null : p.branchScope ? String(p.branchScope) : l.branchScope || null;
        if (scope) need(node(db, scope), 'Choose a node from the organisation hierarchy.');
        submitApproval(db, a, ctx.now, { type: 'User change', ref: `${l.domainId}/${l.loginId}`, title: `${l.name} — role or scope`, payload: { domainId: l.domainId, loginId: l.loginId, role, branchScope: scope },
          diff: [['Role', l.role, role], ['Branch scope', l.branchScope ? nodeName(db, l.branchScope) : 'All branches', scope ? nodeName(db, scope) : 'All branches']] });
        return { message: 'Change sent to a checker.' };
      },
    };
    APPLY['User change'] = (db, a, r) => { const u = r.payload; const l = db.logins.find(x => x.domainId === u.domainId && x.loginId === u.loginId); l.role = u.role; l.branchScope = u.branchScope || undefined; return `${l.name} updated.`; };
    C['master.cutoff'] = {
      cap: 'tmp.admin',
      run(db, a, p, ctx) {
        const prod = productOf(db, p.product) || missing('Product');
        const time = txt(p.time, 'Cut-off time', { max: 5, pattern: /^([01]\d|2[0-3]):[0-5]\d$/, patternMsg: 'Use HH:MM (24-hour IST).' });
        const eff = date(p.effectiveFrom, 'Effective from');
        submitApproval(db, a, ctx.now, { type: 'Cut-off change', ref: prod.code, title: `${prod.name} cut-off ${prod.cutoff || '—'} → ${time} IST`, payload: { product: prod.code, time, effectiveFrom: eff },
          diff: [['Cut-off (IST)', prod.cutoff || 'Not applicable', time], ['Effective from', '—', eff]], note: txt(p.reason, 'Reason', { max: 300 }) });
        return { message: 'Saved — sent to a checker. Configuration changes are versioned.' };
      },
    };
    APPLY['Cut-off change'] = (db, a, r) => { const prod = productOf(db, r.payload.product); prod.cutoff = r.payload.time; prod.cutoffVersion = (prod.cutoffVersion || 1) + 1; return `${prod.name} cut-off now ${prod.cutoff} IST (from ${r.payload.effectiveFrom}).`; };
    C['master.currencyLimit'] = {
      cap: 'tmp.admin',
      run(db, a, p, ctx) {
        const c = currencyOf(db, p.currency) || missing('Currency');
        const lim = amount(p.limit, 'Intraday exposure limit');
        submitApproval(db, a, ctx.now, { type: 'Exposure limit', ref: c.code, title: `${c.code} intraday exposure limit`, payload: { currency: c.code, limit: lim },
          diff: [['Intraday exposure limit', c.exposureLimit ? fmt(c.exposureLimit) : 'Not set', fmt(lim)]] });
        return { message: 'Sent to a checker.' };
      },
    };
    APPLY['Exposure limit'] = (db, a, r) => { const c = currencyOf(db, r.payload.currency); c.exposureLimit = r.payload.limit; return `${c.code} limit ${fmt(c.exposureLimit)}.`; };
    C['master.marginVersion'] = {
      cap: 'tmp.admin',
      run(db, a, p, ctx) {
        const prod = productOf(db, p.product) || missing('Product');
        const markup = Number(p.markupPct), transfer = Number(p.transferPct);
        need(isFinite(markup) && markup > 0 && markup < 3, 'Default spread must be between 0 and 3%.');
        need(isFinite(transfer) && transfer >= 0 && transfer < markup, 'The transfer spread must be below the customer spread.');
        submitApproval(db, a, ctx.now, { type: 'Margin version', ref: prod.code, title: `${prod.name} spreads`, payload: { product: prod.code, markupPct: markup, transferPct: transfer },
          diff: [['Customer spread over IBR', prod.markupPct + '%', markup + '%'], ['Internal transfer spread', prod.transferPct + '%', transfer + '%'], ['Version', 'v' + (prod.marginVersion || 3) / 10, 'v' + ((prod.marginVersion || 3) + 1) / 10]] });
        return { message: 'New margin version sent to a checker.' };
      },
    };
    APPLY['Margin version'] = (db, a, r) => { const prod = productOf(db, r.payload.product); prod.markupPct = r.payload.markupPct; prod.transferPct = r.payload.transferPct; prod.marginVersion = (prod.marginVersion || 3) + 1; return `${prod.name} on margin v${prod.marginVersion / 10}.`; };
    C['master.counterparty'] = {
      cap: 'tmp.admin',
      run(db, a, p, ctx) {
        const name = txt(p.name, 'Bank', { max: 60 });
        let cp = (db.counterparties || []).find(x => x.name === name);
        if (!cp) { cp = { name, dealTypes: ['Spot'], creditLine: null, settlementAccount: 'BK-HDFC-1042', status: 'Active' }; arr(db, 'counterparties').push(cp); }
        if (p.dealTypes) cp.dealTypes = (Array.isArray(p.dealTypes) ? p.dealTypes : String(p.dealTypes).split(',')).map(x => String(x).trim()).filter(x => ['Spot', 'Forward', 'Swap'].includes(x));
        if (p.status) cp.status = oneOf(p.status, ['Active', 'Suspended'], 'Status');
        audit(db, a, ctx.now, 'MASTERS', `Counterparty ${name} saved`);
        return { message: `${name} saved.` };
      },
    };
    C['org.update'] = {
      cap: 'tmp.admin',
      run(db, a, p, ctx) {
        const n = node(db, p.id);
        const isNew = !n;
        const id = isNew ? txt(String(p.newId || '').toUpperCase(), 'Node code', { max: 20, pattern: /^[A-Z0-9-]{3,20}$/, patternMsg: 'Use 3–20 capitals, digits or dashes.' }) : n.id;
        if (isNew) need(!node(db, id), `${id} already exists.`);
        const name = txt(p.name || (n && n.name), 'Node name', { max: 60 });
        const type = oneOf(p.type || (n && n.type), ['Region', 'Cluster', 'Branch', 'Airport'], 'Type');
        const parent = type === 'Region' ? null : String(p.parent || (n && n.parent) || '');
        if (type !== 'Region') need(node(db, parent), 'Choose a parent.');
        if (!isNew) need(!descendants(db, id).has(parent), 'A node cannot move under itself.');
        const cutoff = p.cutoff ? txt(p.cutoff, 'Cut-off', { max: 5, pattern: /^([01]\d|2[0-3]):[0-5]\d$/ }) : null;
        const users = (db.logins || []).filter(l => l.branchScope && descendants(db, id).has(l.branchScope)).length;
        submitApproval(db, a, ctx.now, { type: 'Org change', ref: id, title: isNew ? `New ${type.toLowerCase()} ${name}` : `${name} — ${n.parent !== parent ? 'moved' : 'edited'}`,
          payload: { id, name, type, parent, cutoff, isNew },
          diff: [['Name', n ? n.name : '—', name], ['Type', n ? n.type : '—', type], ['Parent', n && n.parent ? nodeName(db, n.parent) : '—', parent ? nodeName(db, parent) : '—'],
                 ['Cut-off', n && n.cutoff ? n.cutoff : 'Inherit', cutoff || 'Inherit'], ['Users re-scoped', '—', String(users)]] });
        return { message: `Sent to a checker — moving this node re-scopes ${users} user${users === 1 ? '' : 's'}.` };
      },
    };
    APPLY['Org change'] = (db, a, r) => {
      const u = r.payload;
      let n = node(db, u.id);
      if (!n) { n = { id: u.id }; arr(db, 'org').push(n); }
      Object.assign(n, { name: u.name, type: u.type, parent: u.parent || null });
      if (u.cutoff) n.cutoff = u.cutoff; else delete n.cutoff;
      return `${n.name} saved in the hierarchy.`;
    };

    /* ======================================================================== */
    /*  Read models — the same functions render the portal and back the tests    */
    /* ======================================================================== */
    const V = {};
    V.istDate = istDate; V.istClock = istClock; V.istAt = istAt; V.nodeName = nodeName; V.node = node; V.branches = branches;
    V.descendants = descendants; V.regionOf = regionOf; V.homeBranch = homeBranch; V.productName = productName; V.productOf = productOf;
    V.cutoffOf = cutoffOf; V.nextCutoff = nextCutoff; V.deskRow = deskRow; V.quoteRate = (db, pr, cur, side, now) => { try { return quoteRate(db, pr, cur, side, now); } catch (e) { return { error: e.message }; } };
    V.fxpAvail = fxpAvail; V.fxpLinked = fxpLinked; V.eligible = eligible; V.reminderState = reminderState; V.freshness = freshness;
    V.lineUse = lineUse; V.limitUse = limitUse; V.issuerOf = issuerOf; V.reconOf = reconOf; V.tradeChannel = tradeChannel; V.minutesBetween = minutesBetween;
    V.exceptions = exceptionList;
    /* Transaction-link track, from the link ledger; bank-cover track, from allocations. */
    V.linkTrack = (db, p, now) => {
      const st = T.positionStatus(p, now);
      if (st === 'Cancelled' && !(p.linkedAmount > 0)) return 'Cancelled';
      if (st === 'Held') return 'Held';
      if (tradeChannel(p)) return st === 'Concluded' ? 'Complete' : st === 'Attached' ? 'Awaiting settlement' : st === 'Expired' ? 'Expired' : 'Not submitted';
      if (productOf(db, p.product) && productOf(db, p.product).tagging === 'Excluded') return 'Excluded';
      const l = p.linkedAmount || 0;
      return l <= 0.005 ? 'Awaiting txn' : T.remaining(p) > 0.005 ? 'Partial' : 'Complete';
    };
    V.coverTrack = p => { const c = T.coverState(p); return c === '—' ? (p.status === 'Cancelled' ? 'Released' : '—') : c === 'Uncovered' ? 'Open' : c; };
    V.lifecycle = (db, p, now) => {
      const st = T.positionStatus(p, now);
      if (st === 'Cancelled' || st === 'Expired') return 'Cancelled';
      if (st === 'Concluded') return 'Concluded';
      if (st === 'Held') return 'Held';
      if ((p.linkedAmount || 0) > 0.005 || st === 'Attached') return 'Txn tagged';
      if ((p.covered || 0) > 0.005) return 'Cover allocated';
      return 'Created';
    };
    /* Positions by currency and product; never a total across currencies. */
    V.book = (db, now, view) => {
      const rows = {};
      (db.positions || []).forEach(p => {
        const st = T.positionStatus(p, now);
        if (st === 'Expired') return;
        const lv = T.live(p);
        const val = view === 'booked' ? (st === 'Cancelled' ? 0 : lv) : view === 'covered' ? (p.covered || 0) : T.uncovered(p);
        if (val <= 0.005) return;
        const r = rows[p.currency] = rows[p.currency] || { currency: p.currency, REM: 0, FXC: 0, CSH: 0, INW: 0, other: 0, sell: 0, buy: 0, branches: {} };
        const sg = p.side === 'SELL' ? 1 : -1;
        if (p.side === 'BUY') r.INW += val; else if (r[p.product] != null) r[p.product] += val; else r.other += val;
        r[p.side === 'SELL' ? 'sell' : 'buy'] += val;
        const b = r.branches[p.branchId] = r.branches[p.branchId] || { branchId: p.branchId, amount: 0, n: 0, oldest: null };
        b.amount = round2(b.amount + sg * val); b.n++; if (!b.oldest || p.bookedAt < b.oldest) b.oldest = p.bookedAt;
      });
      (db.covers || []).filter(c => c.status === 'Active').forEach(c => {
        const u = round2(c.amount - (c.allocated || 0));
        if (u <= 0.005 || view === 'booked') return;
        const r = rows[c.currency] = rows[c.currency] || { currency: c.currency, REM: 0, FXC: 0, CSH: 0, INW: 0, other: 0, sell: 0, buy: 0, branches: {} };
        r.unallocatedCover = round2((r.unallocatedCover || 0) + (c.side === 'BUY' ? u : -u));
      });
      return Object.values(rows).map(r => {
        ['REM', 'FXC', 'CSH', 'INW', 'other', 'sell', 'buy'].forEach(k => { r[k] = round2(r[k]); });
        r.net = round2(r.sell - r.buy - (view === 'uncovered' || !view ? (r.unallocatedCover || 0) : 0));
        r.direction = Math.abs(r.net) < 0.005 ? 'Flat' : r.net > 0 ? 'Short' : 'Long';
        r.branches = Object.values(r.branches).sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount));
        return r;
      }).sort((x, y) => Math.abs(y.net) * ((currencyOf(db, y.currency) || {}).refRate || 1) - Math.abs(x.net) * ((currencyOf(db, x.currency) || {}).refRate || 1));
    };
    /* BR-01: open position = opening + sales − cashout − covered, with the
       bill-wise breakup behind each term. Scope: a currency, optionally a
       product line, over today's IST business day. */
    V.openCalc = (db, now, cur, product) => {
      const day = istDate(now);
      const inScopeP = p => p.currency === cur && (!product || p.product === product);
      const lines = [];
      let opening = 0, sales = 0, cashout = 0, covered = 0;
      (db.positions || []).filter(inScopeP).forEach(p => {
        const st = T.positionStatus(p, now);
        if (st === 'Expired') return;
        const lv = T.live(p), sg = p.side === 'SELL' ? 1 : -1;
        const cov = (db.coverAllocations || []).filter(x => x.status === 'Active' && x.positionId === p.id);
        const today = istDate(p.bookedAt) === day;
        if (!today) {
          const covBefore = cov.filter(x => istDate(x.at) < day).reduce((t, x) => t + x.amount, 0);
          const open = round2(sg * (st === 'Cancelled' && istDate(p.cancelledAt || now) < day ? 0 : lv) - sg * covBefore);
          if (Math.abs(open) > 0.005) { opening += open; }
        } else if (st !== 'Cancelled' || lv > 0) {
          if (sg > 0) { sales += lv; lines.push({ term: 'Sales', ref: p.id, bill: (p.links || []).map(l => l.ref).join(', ') || p.recordId || p.quoteId || '—', at: p.bookedAt, amount: lv, cls: `${productName(db, p.product)} — ${p.channel || ''}` }); }
          else { cashout += lv; lines.push({ term: 'Cashout', ref: p.id, bill: (p.links || []).map(l => l.ref).join(', ') || p.recordId || '—', at: p.bookedAt, amount: -lv, cls: `${productName(db, p.product)} — purchase` }); }
        }
        cov.filter(x => istDate(x.at) === day).forEach(x => {
          covered += sg * x.amount;
          lines.push({ term: 'Covered', ref: x.coverId || x.crossId, bill: p.id, at: x.at, amount: -sg * x.amount, cls: x.kind === 'bank' ? 'Allocated bank cover' : 'Internal cross' });
        });
      });
      opening = round2(opening); sales = round2(sales); cashout = round2(cashout); covered = round2(covered);
      return { currency: cur, product: product || null, opening, sales, cashout, covered, open: round2(opening + sales - cashout - covered),
        lines: lines.sort((x, y) => String(x.at).localeCompare(String(y.at))) };
    };
    /* FR-10 / BR-04 / BR-05: average sales rate, average DSR and P&L on the
       current IBR for the open (uncovered) position, per currency. */
    V.openRates = (db, now) => {
      const out = {};
      (db.positions || []).forEach(p => {
        const u = T.uncovered(p);
        if (u <= 0.005) return;
        const r = out[p.currency] = out[p.currency] || { currency: p.currency, sell: 0, buy: 0, sellRate: 0, buyRate: 0, dsr: 0 };
        if (p.side === 'SELL') { r.sell += u; r.sellRate += u * p.customerRate; } else { r.buy += u; r.buyRate += u * p.customerRate; }
        r.dsr += u * ((deskRow(db, p.product, p.currency) || {}).card || p.customerRate);
      });
      return Object.values(out).map(r => {
        const net = round2(r.sell - r.buy), gross = r.sell + r.buy;
        const avgSales = r.sell > 0 ? r4(r.sellRate / r.sell) : r4(r.buyRate / (r.buy || 1));
        const avgDsr = gross > 0 ? r4(r.dsr / gross) : 0, mid = r4(ibr(db, r.currency, now));
        const pnl = round2(net > 0 ? net * (avgSales - mid) : -net * (mid - (r.buy ? r.buyRate / r.buy : mid)));
        return { currency: r.currency, open: Math.abs(net), direction: net > 0 ? 'Short' : net < 0 ? 'Long' : 'Flat', avgSales, avgDsr, ibr: mid, pnl };
      }).sort((x, y) => Math.abs(y.pnl) - Math.abs(x.pnl));
    };
    /* Closing IBR for an IST day (17:00 IST fix of the simulated market). */
    V.closingIbr = (db, cur, day) => r4(ibr(db, cur, istAt(day, '17:00')));
    /* BR-06: assessment P&L per covered lot = FCY × (closing IBR on the sale
       date − closing IBR on the cover date), signed by side. */
    V.assessment = (db, now) => {
      const lots = {};
      (db.coverAllocations || []).filter(x => x.status === 'Active').forEach(x => {
        const p = find(db.positions, x.positionId); if (!p) return;
        const saleDay = istDate(p.bookedAt), coverDay = istDate(x.at);
        const k = `${p.currency}|${saleDay}|${coverDay}|${p.side}`;
        const l = lots[k] = lots[k] || { currency: p.currency, saleDay, coverDay, side: p.side, amount: 0 };
        l.amount = round2(l.amount + x.amount);
      });
      return Object.values(lots).map(l => {
        const sale = V.closingIbr(db, l.currency, l.saleDay), cover = V.closingIbr(db, l.currency, l.coverDay <= istDate(now) ? l.coverDay : istDate(now));
        const sg = l.side === 'SELL' ? 1 : -1;
        return { ...l, saleIbr: sale, coverIbr: cover, pnl: round2(sg * (sale - cover) * l.amount) };
      }).sort((x, y) => String(y.coverDay).localeCompare(String(x.coverDay)));
    };
    /* Customer rate › internal transfer rate › bank cover rate, for one position. */
    V.margin = (db, p) => {
      const prod = productOf(db, p.product) || {};
      const transfer = r4(p.side === 'SELL' ? p.refRate + p.refRate * (prod.transferPct || 0.1) / 100 : p.refRate - p.refRate * (prod.transferPct || 0.1) / 100);
      const alloc = (db.coverAllocations || []).filter(x => x.status === 'Active' && x.positionId === p.id);
      const covAmt = alloc.reduce((t, x) => t + x.amount, 0);
      const coverRate = covAmt ? r4(alloc.reduce((t, x) => t + x.amount * x.rate, 0) / covAmt) : null;
      const amt = T.live(p), sg = p.side === 'SELL' ? 1 : -1;
      return { customer: p.customerRate, transfer, cover: coverRate, branch: round2(sg * (p.customerRate - transfer) * amt),
        treasury: coverRate != null ? round2(sg * (transfer - coverRate) * covAmt) : null, amount: amt };
    };
    /* Quote-to-bill drift: time from booking to the first bill, and the gap
       between the committed rate and the rate the bill carries. */
    V.drift = (db, now, by) => {
      const groups = {};
      (db.positions || []).filter(p => (p.links || []).length && !tradeChannel(p) && p.status !== 'Cancelled').forEach(p => {
        const first = p.links.slice().sort((x, y) => String(x.at).localeCompare(String(y.at)))[0];
        const k = by === 'product' ? productName(db, p.product) : by === 'user' ? (p.bookedBy || '—') : nodeName(db, p.branchId);
        const g = groups[k] = groups[k] || { key: k, times: [], drifts: [], impact: 0 };
        g.times.push(Math.max(0, minutesBetween(p.bookedAt, first.at)));
        p.links.forEach(l => { if (l.rate) { const d = r4(l.rate - p.customerRate); g.drifts.push(Math.abs(d)); g.impact += (p.side === 'SELL' ? 1 : -1) * d * l.amount; } });
      });
      const med = a => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
      const rows = Object.values(groups).map(g => ({ key: g.key, n: g.times.length, median: med(g.times), meanDrift: g.drifts.length ? r4(g.drifts.reduce((t, x) => t + x, 0) / g.drifts.length) : 0,
        worst: g.drifts.length ? r4(Math.max(...g.drifts)) : 0, impact: round2(g.impact) }));
      const all = rows.map(r => r.median);
      const groupMedian = med(all);
      rows.forEach(r => { r.signal = r.n >= 1 && (r.median > 2 * Math.max(groupMedian, 1) || r.meanDrift > 0.03) ? 'Investigate' : 'Normal'; });
      return { rows: rows.sort((x, y) => y.n - x.n), groupMedian, n: rows.reduce((t, r) => t + r.n, 0), impact: round2(rows.reduce((t, r) => t + r.impact, 0)) };
    };
    V.inventory = (db, now) => (db.inventory || []).map(i => {
      const mid = ibr(db, i.currency, now) || (currencyOf(db, i.currency) || {}).refRate || 0;
      const qty = round2(i.lots.reduce((t, l) => t + l.qty, 0));
      const aged = round2(i.lots.filter(l => (new Date(now) - new Date(l.at)) / 86400000 > 7).reduce((t, l) => t + l.qty, 0));
      return { locationId: i.locationId, type: (node(db, i.locationId) || {}).type, currency: i.currency, qty, inr: round2(qty * mid), aged, agedInr: round2(aged * mid),
        freshInr: round2((qty - aged) * mid), rate: r4(mid), asOf: i.asOf };
    }).filter(r => Math.abs(r.qty) > 0.005);
    V.cash = (db, now) => (db.cash || []).map(c => {
      const total = round2(c.lots.reduce((t, l) => t + l.amount, 0));
      const aged = round2(c.lots.filter(l => (new Date(now) - new Date(l.at)) / 86400000 > 7).reduce((t, l) => t + l.amount, 0));
      return { locationId: c.locationId, type: (node(db, c.locationId) || {}).type, total, aged, fresh: round2(total - aged), lastCounted: c.lastCounted, asOf: c.asOf };
    });
    V.limits = (db, now) => (db.limits || []).map(l => ({ ...l, ...limitUse(db, l, now) }));
    V.cardMis = (db, now) => {
      const rows = {};
      const row = (issuer, cur) => rows[issuer + '|' + cur] = rows[issuer + '|' + cur] || { issuer, currency: cur, opening: 0, sales: 0, cashout: 0, covered: 0, rateSum: 0, dsrSum: 0, excluded: 0, unmapped: false };
      (db.cardOpening || []).forEach(o => { row(o.issuer, o.currency).opening += o.amount; });
      (db.cardActivity || []).forEach(x => {
        const iss = issuerOf(db, x.prefix);
        const r = row(iss || 'Unmapped prefix', x.currency);
        if (!iss) r.unmapped = true;
        if (x.funding === 'EEFC') { r.excluded += x.amount; return; }
        if (x.kind === 'Sale') { r.sales += x.amount; r.rateSum += x.amount * (x.rate || 0); r.dsrSum += x.amount * (x.dsr || x.rate || 0); }
        else r.cashout += x.amount;
      });
      (db.cardCovers || []).forEach(c => { row(c.issuer, c.currency).covered += c.amount; });
      return Object.values(rows).map(r => {
        const open = round2(r.opening + r.sales - r.cashout - r.covered);
        const avgSales = r.sales ? r4(r.rateSum / r.sales) : 0, avgDsr = r.sales ? r4(r.dsrSum / r.sales) : 0, mid = r4(ibr(db, r.currency, now));
        return { ...r, opening: round2(r.opening), sales: round2(r.sales), cashout: round2(r.cashout), covered: round2(r.covered), open,
          avgSales, avgDsr, ibr: mid, mtm: round2(open * (avgSales - mid)) };
      }).sort((x, y) => (x.unmapped ? 1 : 0) - (y.unmapped ? 1 : 0) || x.issuer.localeCompare(y.issuer) || x.currency.localeCompare(y.currency));
    };
    V.approvals = (db, now) => (db.approvals || []).map(r => {
      const age = Math.round(minutesBetween(r.submittedAt, r.decidedAt || now));
      return { ...r, age, breach: r.status === 'Pending' && age > Number(settings(db).approvalSlaMin || 120) };
    });
    V.integrations = (db, now) => (db.integrations || []).map(i => ({ ...i, freshness: i.status === 'Not selected' ? 'Stale' : freshness(i.lastSuccess, now, i.cycleMin || 30, i.staleMin || 360) }));
    V.cutoffQueue = (db, now, scope) => (db.positions || []).filter(p => !tradeChannel(p) && p.cutoffAt && (!scope || scope.has(p.branchId)))
      .filter(p => p.status === 'Open' && T.remaining(p) > 0.005 || (p.status !== 'Open' && p.cancelledAt && istDate(p.cancelledAt) === istDate(now) && (p.cancelledAmount || 0) > 0))
      .map(p => {
        const open = p.status === 'Open';
        const dead = !!(p.cancelRequest && p.cancelRequest.dead) || /withdrew|dead/i.test(p.cancelReason || '');
        return { id: p.id, positionId: p.id, branchId: p.branchId, currency: p.currency, residual: open ? T.remaining(p) : p.cancelledAmount, cutoffAt: p.cutoffAt,
          minutesLeft: open ? Math.round(minutesBetween(now, p.cutoffAt)) : 0, state: open ? (p.cancelRequest ? 'Cancellation requested' : 'Open residual') : 'Cancelled today',
          reason: dead ? 'Customer withdrew' : p.delayReported ? 'Source transaction delayed' : 'Branch has not tagged', recoverable: !dead,
          cover: V.coverTrack(p), kept: p.kept || null, cancelRequest: p.cancelRequest || null, cancelReason: p.cancelReason || null };
      }).sort((x, y) => String(x.cutoffAt).localeCompare(String(y.cutoffAt)));

    /* ======================================================================== */
    /*  What each TMP user may see                                              */
    /* ======================================================================== */
    const TMP_KEYS = ['tmpProducts', 'org', 'counterparties', 'cardPrefixes', 'correspondents', 'rateDesk', 'quotes', 'fxpTxns', 'reminders', 'approvals',
      'amendments', 'inventory', 'cash', 'bankAccounts', 'nostro', 'cardBalances', 'creditLines', 'limits', 'cardActivity', 'cardSettlements', 'cardOpening',
      'cardCovers', 'bulkRequests', 'integrations', 'excNotes'];
    const NONE = { quotes: [], fxpTxns: [], reminders: [], approvals: [], amendments: [], inventory: [], cash: [], bankAccounts: [], nostro: [], cardBalances: [],
      creditLines: [], limits: [], cardActivity: [], cardSettlements: [], cardOpening: [], cardCovers: [], bulkRequests: [], integrations: [], excNotes: {} };
    /* kind: 'full' (treasury, admin, master), 'branch', 'agent', 'bulk', 'finance', 'trade' (the trade portal), 'public'. */
    function scope(out, db, a, kind) {
      const all = () => TMP_KEYS.forEach(k => { out[k] = clone(db[k] == null ? (k === 'excNotes' ? {} : []) : db[k]); });
      if (kind === 'full') { all(); return; }
      ['tmpProducts', 'org', 'counterparties', 'cardPrefixes', 'correspondents'].forEach(k => { out[k] = clone(db[k] || []); });
      Object.entries(NONE).forEach(([k, v]) => { out[k] = clone(v); });
      out.rateDesk = (db.rateDesk || []).map(r => ({ product: r.product, currency: r.currency, card: r.card, status: r.status, publishedAt: r.publishedAt }));
      if (kind === 'public' || kind === 'trade') return;
      const sc = scopeBranches(db, a);
      const mine = x => !sc || sc.has(x.branchId);
      const cleanPos = p => ({ ...clone(p), coverState: T.coverState(p), coverTrack: V.coverTrack(p), covered: undefined, refRate: undefined, margin: undefined, ibrAtBooking: undefined });
      if (kind === 'branch' || kind === 'agent') {
        const agentKey = kind === 'agent' ? actorKey(a) : null;
        out.positions = (db.positions || []).filter(p => mine(p) && (!agentKey || p.bookedByKey === agentKey)).map(cleanPos);
        out.quotes = clone((db.quotes || []).filter(q => mine(q) && (!agentKey || q.byKey === agentKey)));
        if (kind === 'branch') {
          out.fxpTxns = clone((db.fxpTxns || []).filter(mine));
          out.reminders = clone((db.reminders || []).filter(mine));
          out.inventory = clone((db.inventory || []).filter(x => !sc || sc.has(x.locationId)));
          out.cash = clone((db.cash || []).filter(x => !sc || sc.has(x.locationId)));
          out.integrations = clone((db.integrations || []).filter(i => ['FXP-SFTP', 'FXP-API'].includes(i.id)));
          out.limits = clone((db.limits || []).map(l => ({ id: l.id, name: l.name, smeId: l.smeId, status: l.status, restrictions: l.restrictions })));
        }
        out.covers = []; out.coverAllocations = []; out.tmsEvents = [];
        out.deals = clone((db.deals || []).filter(d => { const p = find(db.positions, d.positionId); return p && mine(p); }));
        return;
      }
      if (kind === 'bulk') {
        out.bulkRequests = clone((db.bulkRequests || []).filter(r => !sc || sc.has(r.branchId)));
        out.inventory = clone((db.inventory || []).filter(x => !sc || sc.has(x.locationId)));
        ['positions', 'covers', 'coverAllocations', 'deals', 'tmsEvents'].forEach(k => { out[k] = []; });
        return;
      }
      if (kind === 'finance') {
        ['inventory', 'cash', 'bankAccounts', 'nostro', 'cardBalances', 'creditLines', 'cardActivity', 'cardSettlements', 'cardOpening', 'cardCovers', 'integrations', 'approvals']
          .forEach(k => { out[k] = clone(db[k] || []); });
        out.approvals = out.approvals.filter(x => ['Reconciliation adjustment', 'Nostro upload — replace'].includes(x.type));
        return;
      }
    }
    function scopeKind(db, a) {
      if (!a) return 'public';
      const r = roleOf(db, a);
      if (can(db, a, 'test.master') || can(db, a, 'tmp.admin')) return 'full';
      if (r.portal !== 'TMP') return 'trade';
      if (can(db, a, 'treasury.view') && r.workspace === 'treasury') return 'full';
      if (can(db, a, 'tmp.finance')) return 'finance';
      if (can(db, a, 'tmp.branch')) return 'branch';
      if (can(db, a, 'tmp.agent')) return 'agent';
      if (can(db, a, 'tmp.bulk.request')) return 'bulk';
      return 'public';
    }

    /* ======================================================================== */
    /*  Seed — relative to the moment the demo is seeded                        */
    /* ======================================================================== */
    function seed(db, now) {
      const nowMs = new Date(now).getTime();
      const ago = h => new Date(nowMs - h * 3600000).toISOString();
      const lastCut = istAt(istDate(now), '16:00') <= now ? istAt(istDate(now), '16:00') : istAt(istDate(ago(24)), '16:00');
      /* inside today's working window: never before the last cut-off */
      const since = h => { const t = ago(h); return t > lastCut ? t : new Date(Math.max(Date.parse(lastCut) + 60000, nowMs - h * 3600000 / 6)).toISOString(); };
      const DEALER = 'AD2 Treasury Dealer (Nikhil Bansal)', DEALER2 = 'AD2 Treasury Dealer (Sana Sheikh)', CHECK = 'AD2 Treasury Checker (Leela Varghese)';
      (db.smes || []).forEach(s => { if (!s.branchId) s.branchId = homeBranch(db, s); });
      /* seeded trade positions sit at the customer's branch */
      (db.positions || []).forEach(p => {
        const s = smeOf(db, p.smeId);
        p.branchId = p.branchId || homeBranch(db, s);
        p.product = p.product || (p.side === 'SELL' ? 'REM' : 'INW');
        p.channel = p.channel || (p.source === 'Deal' ? 'Treasury deal' : 'Trade portal');
        p.customerName = p.customerName || (s && s.tradingName) || '';
        p.links = p.links || (p.status === 'Concluded' ? [{ ref: p.linkRef, amount: p.linkedAmount, kind: /^AD2O/.test(p.linkRef || '') ? 'UTR' : 'FIRC', at: p.linkedAt, by: 'Trade portal' }] : []);
        p.ibrAtBooking = p.ibrAtBooking || p.refRate;
      });
      (db.covers || []).forEach(c => { c.type = c.type || 'Spot'; c.status = c.status === 'Pending Approval' ? 'Active' : c.status; });

      /* rate desk: every product line and currency; a few deliberately unpublished */
      db.rateDesk = [];
      const pubAt = ago(Math.min(20, (nowMs - Date.parse(istAt(istDate(now), '09:14'))) / 3600000 > 0 ? (nowMs - Date.parse(istAt(istDate(now), '09:14'))) / 3600000 : 20));
      (db.tmpProducts || []).forEach(p => (db.currencies || []).forEach(c => {
        const off = (p.code === 'FXC' && ['JPY', 'CHF'].includes(c.code)) || (p.code === 'CSH' && ['JPY', 'AUD'].includes(c.code)) || (p.code === 'FXC' && c.code === 'SGD');
        const spread = r4(c.refRate * p.spreadPct / 100);
        const card = p.sides.includes('SELL') ? r4(c.refRate + spread) : r4(c.refRate - spread);
        db.rateDesk.push({ product: p.code, currency: c.code, card: off ? 0 : card, spread: off ? 0 : spread, status: off ? 'Not published' : 'Published',
          publishedAt: off ? null : pubAt, publishedBy: off ? null : DEALER, approvedBy: off ? null : CHECK, version: off ? 0 : 1, suggested: card });
        c.importedBase = r4(c.refRate); c.importedAt = ago(Math.max(0.5, (nowMs - Date.parse(istAt(istDate(now), '09:02'))) / 3600000));
      }));

      /* organisation, integrations, liquidity */
      db.integrations = [
        { id: 'FXP-API', name: 'FX Plus API', data: 'Balances, card activity', transport: 'REST API', mode: 'API — BRD', schedule: 'Every 15 min', lastSuccess: ago(0.1), status: 'Healthy', credsRotatedAt: ago(24 * 26), cycleMin: 30 },
        { id: 'FXP-SFTP', name: 'FX Plus SFTP', data: 'Transaction references', transport: 'SFTP or API — unresolved', mode: 'SFTP — diagram', schedule: 'Every 30 min', lastSuccess: ago(0.6), status: 'Delayed', pending: 37, credsRotatedAt: ago(24 * 26), cycleMin: 30 },
        { id: 'MTSS', name: 'MTSS API', data: 'Inward transactions', transport: 'REST API', mode: 'API — diagram only', schedule: 'Push', lastSuccess: ago(0.2), status: 'Healthy', credsRotatedAt: ago(24 * 26), cycleMin: 60 },
        { id: 'BANKAGG', name: 'Bank aggregator', data: 'Bank balances', transport: 'REST API', mode: 'API', schedule: 'Every 15 min', lastSuccess: ago(0.1), status: 'Healthy', credsRotatedAt: ago(24 * 43), cycleMin: 30 },
        { id: 'EURONET', name: 'Euronet', data: 'Customer card balances', transport: 'REST API', mode: 'API', schedule: 'Every 15 min', lastSuccess: ago(0.2), status: 'Healthy', credsRotatedAt: ago(24 * 43), cycleMin: 30 },
        { id: 'PINELABS', name: 'Pine Labs', data: 'Customer card balances', transport: 'REST API', mode: 'API', schedule: 'Every 15 min', lastSuccess: ago(0.25), status: 'Healthy', credsRotatedAt: ago(24 * 43), cycleMin: 30 },
        { id: 'IBR', name: 'IBR source', data: 'Current and closing rates', transport: 'Proposed provider', mode: 'To confirm', schedule: 'Every 5 min', lastSuccess: ago(0.05), status: 'Proposed source', credsRotatedAt: null, cycleMin: 10 },
        { id: 'TRADE', name: 'Trade portal', data: 'Bookings, requests, UTRs and FIRCs', transport: 'In-platform events', mode: 'Same platform', schedule: 'Real time', lastSuccess: now, status: 'Healthy', credsRotatedAt: null, cycleMin: 1440 },
        { id: 'LEGACYCB', name: 'Currency booking module', data: 'Legacy bulk bookings', transport: 'Map / integrate / rebuild', mode: 'Unresolved', schedule: '—', lastSuccess: null, status: 'Not selected', credsRotatedAt: null, cycleMin: 1440 },
      ];
      const lot = (qty, d) => ({ qty, at: ago(24 * d) });
      const inv = [
        ['BR-MUMFORT', 'USD', [lot(60000, 2), lot(28000, 5), lot(12000, 11)]], ['BR-MUMFORT', 'EUR', [lot(20000, 3)]], ['BR-MUMFORT', 'GBP', [lot(5000, 1)]],
        ['BR-DELCP', 'EUR', [lot(30000, 4), lot(10000, 9)]], ['BR-DELCP', 'USD', [lot(25000, 3)]], ['BR-DELCP', 'AED', [lot(40000, 2)]],
        ['BR-MUMT2', 'USD', [lot(55000, 1), lot(16000, 12)]], ['BR-MUMT2', 'GBP', [lot(8000, 2)]], ['BR-DELT3', 'USD', [lot(30000, 2)]],
        ['BR-BLRMG', 'USD', [lot(18000, 3)]], ['BR-CHENNAI', 'SGD', [lot(12000, 6)]], ['BR-KOCHI', 'AED', [lot(60000, 5), lot(15000, 10)]],
      ];
      db.inventory = inv.map(([l, c, lots]) => ({ locationId: l, currency: c, lots, asOf: ago(0.1) }));
      const cashLots = (a, b) => [{ amount: a, at: ago(24 * 2) }, { amount: b, at: ago(24 * 9) }];
      db.cash = [['BR-MUMFORT', 2400000, 400000], ['BR-DELCP', 1900000, 300000], ['BR-MUMT2', 1800000, 200000], ['BR-DELT3', 900000, 150000],
        ['BR-BLRMG', 1100000, 0], ['BR-CHENNAI', 750000, 120000], ['BR-KOCHI', 820000, 90000], ['BR-PUNE', 600000, 0], ['BR-AHD', 950000, 110000], ['BR-HYD', 700000, 0]]
        .map(([l, a, b]) => ({ locationId: l, lots: b ? cashLots(a, b) : [{ amount: a, at: ago(24 * 2) }], lastCounted: istAt(istDate(now), '09:00') <= now ? istAt(istDate(now), '09:00') : ago(15), asOf: ago(0.1) }));
      db.bankAccounts = [
        { id: 'BK-HDFC-1042', bank: 'HDFC Bank', mask: '••1042', owner: 'HO', currency: 'INR', ledger: 200000000, available: 180000000, asOf: ago(0.1), source: 'Bank aggregator' },
        { id: 'BK-ICICI-2051', bank: 'ICICI Bank', mask: '••2051', owner: 'HO', currency: 'INR', ledger: 165000000, available: 150000000, asOf: ago(0.1), source: 'Bank aggregator' },
        { id: 'BK-SBI-3068', bank: 'State Bank of India', mask: '••3068', owner: 'BR-MUMFORT', currency: 'INR', ledger: 100000000, available: 90000000, asOf: ago(0.15), source: 'Bank aggregator' },
        { id: 'BK-AXIS-5520', bank: 'Axis Bank', mask: '••5520', owner: 'BR-BLRMG', currency: 'INR', ledger: 42000000, available: 40500000, asOf: ago(3.2), source: 'Bank aggregator' },
        { id: 'BK-OTH-4053', bank: 'Other', mask: '••4053', owner: 'BR-DELCP', currency: 'USD', ledger: 20000, available: 18000, asOf: ago(30), source: 'Bank aggregator', feedDown: true },
      ];
      const nos = (issuer, cur, bal, h, extra) => ({ id: 'NOS-' + pad(seq(db, 'nos'), 4), kind: 'Issuer', issuer, currency: cur, balance: bal, statementAt: ago(h),
        updatedBy: DEALER, source: 'Manual upload — issuer_balances.xlsx', status: 'Current', uploadedAt: ago(h - 0.1), ...(extra || {}) });
      db.nostro = [
        nos('Visa', 'USD', 200000, 3), nos('Mastercard', 'USD', 100000, 3), nos('Visa', 'EUR', 8888.89, 3),
        { ...nos('Visa', 'USD', 185000, 27), status: 'Superseded' },
      ];
      Object.entries(db.correspondents || {}).forEach(([cur, bank]) => {
        const base = { USD: 1850000, EUR: 620000, GBP: 410000, AED: 2400000, SGD: 180000, JPY: 42000000, CHF: 150000, AUD: 260000 }[cur] || 100000;
        db.nostro.push({ id: 'NOS-' + pad(seq(db, 'nos'), 4), kind: 'Correspondent', issuer: bank, currency: cur, balance: base, statementAt: ago(0.3),
          updatedBy: 'SWIFT MT950', source: 'SWIFT MT950 (system)', status: 'Current' });
      });
      db.cardBalances = [
        { network: 'Visa', currency: 'USD', balance: 200000, source: 'Euronet', asOf: ago(0.2), branches: { 'BR-MUMFORT': { cards: 412, balance: 96400 }, 'BR-DELCP': { cards: 288, balance: 71200 }, 'BR-MUMT2': { cards: 134, balance: 32400 } } },
        { network: 'Mastercard', currency: 'USD', balance: 100000, source: 'Pine Labs', asOf: ago(0.25), branches: { 'BR-MUMFORT': { cards: 190, balance: 52000 }, 'BR-BLRMG': { cards: 160, balance: 48000 } } },
        { network: 'Visa', currency: 'EUR', balance: 64444.44, source: 'Euronet', asOf: ago(0.2), branches: { 'BR-DELCP': { cards: 120, balance: 40444.44 }, 'BR-MUMFORT': { cards: 80, balance: 24000 } } },
        { network: 'INR wallet', currency: 'INR', balance: null, source: 'To confirm', asOf: null, setup: true, branches: {} },
      ];

      /* credit lines and customer limits */
      const act = (id, kind, source, amt, state, h) => ({ id, kind, source, amount: amt, state, at: ago(h), by: kind === 'Settlement' ? DEALER : 'FX Plus API' });
      db.creditLines = [
        { id: 'CL-ICICI', bank: 'ICICI Bank', purpose: 'Card funding', limit: 20000000, opening: 12400000, ruleVersion: 'v0.3',
          activity: [act('BATCH-L-01', 'Load / reload', 'FX Plus API', 1000000, 'Applied', 5), act('BATCH-C-01', 'Cashout', 'FX Plus API', 200000, 'Applied', 4),
                     act('BATCH-L-02', 'Load / reload', 'FX Plus API', 1000000, 'Pending funding', 1), act('BATCH-C-02', 'Cashout', 'FX Plus API', 200000, 'Awaiting rule application', 0.8),
                     act('SET-3102', 'Settlement', 'Manual entry', 500000, 'Draft', 0.6)] },
        { id: 'CL-HDFC', bank: 'HDFC Bank', purpose: 'Forward cover line', limit: 50000000, opening: 9500000, drawn: 8400000, ruleVersion: 'v0.3', activity: [] },
      ];
      const mer = smeOf(db, 'SME-1001'), arc = smeOf(db, 'SME-1002'), nil = smeOf(db, 'SME-1003');
      db.limits = [];
      /* trade customers carry sanctioned treasury lines well above their book; a
         booking beyond one is held for a checker, never silently passed */
      if (mer) db.limits.push({ id: 'CORP-1180', smeId: mer.id, name: mer.tradingName, limit: 500000000, restrictions: { currencies: [], sides: [] }, status: 'Active' });
      if (arc) db.limits.push({ id: 'CORP-1204', smeId: arc.id, name: arc.tradingName, limit: 250000000, restrictions: { currencies: [], sides: [] }, status: 'Active' });
      if (nil) db.limits.push({ id: 'CORP-1218', smeId: nil.id, name: nil.tradingName, limit: 150000000, restrictions: { currencies: [], sides: [] }, status: 'Active' });
      db.limits.push({ id: 'CORP-1211', smeId: null, name: 'Havelock Traders', limit: 10000000, restrictions: { currencies: ['USD', 'GBP'], sides: ['SELL'] }, status: 'Active' });
      db.limits.push({ id: 'CORP-1233', smeId: null, name: 'Orient Mercantile', limit: 30000000, restrictions: { currencies: [], sides: [] }, status: 'Active' });
      db.limits.push({ id: 'CORP-1240', smeId: null, name: 'Sankalp Industries', limit: 15000000, restrictions: { currencies: ['USD'], sides: ['SELL'], dealCap: 2500000 }, status: 'Active' });

      /* branch positions: the TMP worked examples, on this platform's rates */
      const usd = currencyOf(db, 'USD').refRate;
      const mk = (o) => {
        const c = currencyOf(db, o.currency);
        const row = deskRow(db, o.product, o.currency);
        const mid = c.refRate;
        const rate = r4(o.side === 'SELL' ? Math.min(row.card, mid + mid * productOf(db, o.product).markupPct / 100) : mid - mid * productOf(db, o.product).markupPct / 100);
        const bookedAt = o.bookedAt || since(o.h || 2);
        const p = T.newPosition(db, { domainId: 'AD2', loginId: o.by || 'BRANCH', role: 'AD2 Branch Inputter', name: o.byName || 'Anil Kulkarni', actingFor: null }, null,
          { currency: o.currency, side: o.side, amount: o.amount, customerRate: rate, refRate: mid, margin: Math.round(Math.abs(rate - mid) * 100), source: 'Branch',
            product: o.product, branchId: o.branchId, channel: o.channel || 'Branch', customerName: o.customer, customerRef: o.ref, customerId: o.customerId || null,
            quoteId: 'Q-' + pad(seq(db, 'quote'), 4), valueDate: o.valueDate || istDate(now), ibrAtBooking: r4(mid * 0.9995), agentName: o.agentName,
            cutoffAt: nextCutoff(db, o.product, o.branchId, now) }, bookedAt);
        p.bookedAt = bookedAt;
        return p;
      };
      const bill = (p, amt, h, opts) => {
        const t = { id: 'FXP-' + (88000 + seq(db, 'fxp')), branchId: p.branchId, product: p.product, currency: (opts && opts.currency) || p.currency, side: p.side, amount: amt,
          rate: r4(p.customerRate + ((opts && opts.drift) || 0)), receivedAt: since(h), source: 'FX Plus SFTP', positionRef: opts && opts.ref === false ? null : p.id,
          customerRef: p.customerRef || null, links: [] };
        arr(db, 'fxpTxns').push(t);
        if (!(opts && opts.link === false)) {
          t.links.push({ positionId: p.id, amount: amt, at: t.receivedAt, by: 'Automatic on bill punch' });
          T.addLink(db, null, p, { ref: t.id, amount: amt, kind: 'FX Plus', at: t.receivedAt, by: 'Automatic on bill punch', rate: t.rate }, t.receivedAt, 'seed');
        }
        return t;
      };
      db.fxpTxns = []; db.reminders = []; db.quotes = [];
      const p42 = mk({ branchId: 'BR-MUMFORT', product: 'REM', currency: 'USD', side: 'SELL', amount: 25000, h: 3, customer: 'Walk-in — R. Menon', ref: 'CUST-99120 / DEAL-4471' });
      bill(p42, 12000, 2.8); bill(p42, 8000, 2.5);
      bill(p42, 3000, 1.1, { ref: false, link: false }); bill(p42, 2000, 0.9, { ref: false, link: false });
      const p43 = mk({ branchId: 'BR-MUMFORT', product: 'FXC', currency: 'EUR', side: 'SELL', amount: 10000, h: 5, customer: 'Walk-in — S. Iyer', ref: 'CUST-98844' });
      const p44 = mk({ branchId: 'BR-MUMFORT', product: 'CSH', currency: 'GBP', side: 'SELL', amount: 5000, h: 5.5, customer: 'Walk-in — A. Khan', ref: 'CUST-98812' });
      bill(p44, 5000, 5.2);
      const p50 = mk({ branchId: 'BR-DELCP', product: 'FXC', currency: 'USD', side: 'SELL', amount: 40000, h: 6, by: 'BRANCH2', byName: 'Deepa Rao', customer: 'Northern Travels Pvt Ltd', ref: 'CUST-99201' });
      bill(p50, 40000, 5.8);
      const p47 = mk({ branchId: 'BR-DELCP', product: 'REM', currency: 'USD', side: 'SELL', amount: 3500, h: 4, by: 'BRANCH2', byName: 'Deepa Rao', customer: 'Walk-in — P. Gupta', ref: 'CUST-99214' });
      p47.delayReported = since(1.5); (p47.notes = []).push({ at: since(1.5), by: 'AD2 Branch Inputter (Deepa Rao)', text: 'FX Plus bill keyed but not reflected yet', to: 'Treasury' });
      const p49 = mk({ branchId: 'BR-MUMT2', product: 'CSH', currency: 'GBP', side: 'SELL', amount: 2000, h: 1.2, by: 'AIRPORT', byName: 'Rahul Nair', customer: 'Walk-in — traveller', ref: 'CUST-99233' });
      p49.cancelRequest = { by: 'AD2 Branch Inputter (Rahul Nair)', at: since(0.8), reason: 'Customer withdrew before paying', dead: true };
      const p51 = mk({ branchId: 'BR-MUMT2', product: 'REM', currency: 'USD', side: 'SELL', amount: 30000, h: 2.2, by: 'AIRPORT', byName: 'Rahul Nair', customer: 'Orient Mercantile', customerId: 'CORP-1233', ref: 'CORP-1233 / DEAL-4490' });
      const p55 = mk({ branchId: 'BR-MUMFORT', product: 'CSH', currency: 'USD', side: 'SELL', amount: 10000, h: 1.8, customer: 'Walk-in — tour group', ref: 'CUST-99240', valueDate: istDate(ago(-72)) });
      const p52 = mk({ branchId: 'BR-MUMFORT', product: 'REM', currency: 'USD', side: 'SELL', amount: 1200, h: 0.25, customer: 'Walk-in — K. Das', ref: 'CUST-99251' });
      const p60 = mk({ branchId: 'BR-BLRMG', product: 'FXC', currency: 'USD', side: 'SELL', amount: 15000, h: 4.5, by: 'BRANCH', byName: 'Anil Kulkarni', customer: 'Walk-in — V. Rao', ref: 'CUST-98110' });
      bill(p60, 15000, 4.3, { drift: 0.02 });
      const p61 = mk({ branchId: 'BR-DELCP', product: 'CSH', currency: 'AED', side: 'BUY', amount: 8000, h: 3.5, by: 'BRANCH2', byName: 'Deepa Rao', customer: 'Walk-in — returning traveller', ref: 'CUST-99260' });
      bill(p61, 8000, 3.3);
      const p62 = mk({ branchId: 'BR-PUNE', product: 'REM', currency: 'USD', side: 'SELL', amount: 8000, h: 1, by: 'AGENT', byName: 'Sundar Raman', channel: 'Agent', agentName: 'Sundar Forex, Pune', customer: 'Havelock Traders', customerId: 'CORP-1211', ref: 'CORP-1211 / DEAL-4502' });
      p62.bookedByKey = 'SUNDARFX/AGENT'; p62.bookedBy = 'Agent Partner (Sundar Raman)';
      const p63 = mk({ branchId: 'BR-DELCP', product: 'FXC', currency: 'GBP', side: 'SELL', amount: 6000, h: 2.6, by: 'BRANCH2', byName: 'Deepa Rao', customer: 'Walk-in — students', ref: 'CUST-99270' });
      p63.kept = { until: istAt(nextDay(istDate(p63.cutoffAt)), '11:00'), reason: 'Customer returning tomorrow with the balance', by: 'AD2 Branch Inputter (Deepa Rao)', at: since(0.4) };
      p63.cutoffAt = p63.kept.until;
      const p31 = mk({ branchId: 'BR-MUMFORT', product: 'REM', currency: 'USD', side: 'SELL', amount: 2000, h: 20, customer: 'Walk-in — J. Pinto', ref: 'CUST-99102', bookedAt: ago(26) });
      Object.assign(p31, { status: 'Cancelled', cancelledAmount: 2000, cancelReason: 'Not concluded by cut-off', cancelledAt: lastCut, cutoffAt: lastCut });
      /* an unmatched bill, a currency mismatch, and bills still in the SFTP pipe */
      arr(db, 'fxpTxns').push({ id: 'FXP-' + (88000 + seq(db, 'fxp')), branchId: 'BR-DELCP', product: 'CSH', currency: 'EUR', side: 'SELL', amount: 4000, rate: r4(currencyOf(db, 'EUR').refRate + 0.55),
        receivedAt: since(0.8), source: 'FX Plus SFTP', positionRef: null, customerRef: null, links: [] });
      arr(db, 'fxpTxns').push({ id: 'FXP-' + (88000 + seq(db, 'fxp')), branchId: 'BR-MUMFORT', product: 'REM', currency: 'GBP', side: 'SELL', amount: 2000, rate: 113.10,
        receivedAt: since(0.3), source: 'FX Plus SFTP', positionRef: p42.id, customerRef: p42.customerRef, links: [] });
      db.fxpInbox = [{ id: 'FXP-' + (88000 + seq(db, 'fxp')), branchId: 'BR-MUMT2', product: 'REM', currency: 'USD', side: 'SELL', amount: 5000, rate: p51.customerRate,
        source: 'FX Plus SFTP', positionRef: null, customerRef: p51.customerRef, arrivesAt: ago(0.05) }];
      db.fxpTxns.sort((x, y) => String(y.receivedAt).localeCompare(String(x.receivedAt)));
      /* reminders: escalated, acknowledged and open */
      const rem = (p, h, reason, state, ackH) => db.reminders.push({ id: 'RM-' + pad(seq(db, 'rem'), 4), positionId: p.id, branchId: p.branchId, raisedAt: since(h), reason,
        state: state || 'Open', by: 'System', ...(state === 'Acknowledged' ? { ackAt: since(ackH), ackBy: 'AD2 Branch Inputter (Rahul Nair)' } : {}) });
      rem(p43, 2.4, 'No FX Plus reference'); rem(p47, 1.8, 'Source transaction delayed'); rem(p49, 0.75, 'Customer withdrew', 'Acknowledged', 0.5); rem(p52, 0.05, 'No FX Plus reference');
      db.reminders.reverse();

      /* bank cover for branch positions: spot and forward */
      const addCover = (o) => {
        const c = { id: 'COV-' + pad(seq(db, 'cov'), 4), currency: o.currency, side: o.side, amount: o.amount, rate: o.rate, allocated: 0, type: o.type || 'Spot',
          counterparty: o.bank, dealRef: o.dealRef || o.bank.split(' ')[0].toUpperCase().slice(0, 4) + '-' + (1100 + seq(db, 'cov')), valueDate: o.valueDate || istDate(since(o.h)),
          status: o.status || 'Active', enteredAt: since(o.h), enteredBy: o.by || DEALER, enteredByKey: o.byKey || 'AD2/DEALER', settled: o.settled || 0, settlements: [] };
        db.covers.unshift(c);
        (o.alloc || []).forEach(([p, amt]) => {
          db.coverAllocations.unshift({ id: 'CA-' + pad(seq(db, 'cal'), 4), kind: 'bank', coverId: c.id, crossId: null, positionId: p.id, amount: amt, rate: c.rate,
            at: since(o.h - 0.1), by: c.enteredBy, byKey: c.enteredByKey, status: 'Active' });
          p.covered = round2((p.covered || 0) + amt); c.allocated = round2(c.allocated + amt);
        });
        return c;
      };
      addCover({ currency: 'USD', side: 'BUY', amount: 90000, rate: r4(usd - 0.40), bank: 'HDFC Bank', h: 2.4, alloc: [[p42, 25000], [p50, 40000], [p51, 25000]] });
      addCover({ currency: 'GBP', side: 'BUY', amount: 5000, rate: r4(currencyOf(db, 'GBP').refRate - 0.5), bank: 'ICICI Bank', h: 4.5, alloc: [[p44, 2500]], by: DEALER2, byKey: 'AD2/DEALER2' });
      addCover({ currency: 'USD', side: 'BUY', amount: 10000, rate: r4(usd - 0.35), bank: 'Kotak Mahindra Bank', h: 0.4, alloc: [[p47, 3500]] });
      addCover({ currency: 'EUR', side: 'BUY', amount: 15000, rate: r4(currencyOf(db, 'EUR').refRate - 0.45), bank: 'ICICI Bank', h: 1.5, alloc: [] });
      /* forwards bought against trade portal payments */
      const tradeUsd = db.positions.filter(p => p.smeId && p.currency === 'USD' && p.side === 'SELL' && p.status !== 'Cancelled' && T.uncovered(p) >= 40000)
        .sort((a, b) => T.uncovered(b) - T.uncovered(a));
      addCover({ currency: 'USD', side: 'BUY', amount: 60000, rate: r4(usd - 0.30), bank: 'HDFC Bank', h: 30, type: 'Forward', valueDate: istDate(now), settled: 20000, dealRef: 'HDFC-FWD-3101',
        alloc: tradeUsd[0] ? [[tradeUsd[0], 40000]] : [] });
      addCover({ currency: 'EUR', side: 'BUY', amount: 20000, rate: r4(currencyOf(db, 'EUR').refRate - 0.30), bank: 'ICICI Bank', h: 28, type: 'Forward', valueDate: istDate(ago(-72)), dealRef: 'ICICI-FWD-3102' });
      addCover({ currency: 'GBP', side: 'BUY', amount: 10000, rate: r4(currencyOf(db, 'GBP').refRate - 0.40), bank: 'State Bank of India', h: 50, type: 'Forward', valueDate: istDate(ago(24)), dealRef: 'SBI-FWD-3103' });
      const f4 = addCover({ currency: 'USD', side: 'BUY', amount: 25000, rate: r4(usd - 0.50), bank: 'HDFC Bank', h: 80, type: 'Forward', valueDate: istDate(ago(48)), settled: 25000, dealRef: 'HDFC-FWD-3104',
        alloc: (tradeUsd[1] || tradeUsd[0]) && T.uncovered(tradeUsd[1] || tradeUsd[0]) >= 25000 ? [[tradeUsd[1] || tradeUsd[0], 25000]] : [] });
      f4.settledAt = ago(48); f4.settlements = [{ amount: 25000, at: ago(48), evidence: 'HDFC-S0909', maker: DEALER, checker: CHECK }];
      db.covers.forEach(c => { if (c.type === 'Forward' && !c.settlements) c.settlements = []; });

      /* cards: opening, activity by prefix (EEFC excluded), settlements, cover lots */
      db.cardOpening = [{ issuer: 'Visa', currency: 'USD', amount: 100000 }, { issuer: 'Mastercard', currency: 'USD', amount: 20000 }, { issuer: 'ICICI', currency: 'EUR', amount: 10000 }];
      const eur = currencyOf(db, 'EUR').refRate;
      const ca = (kind, prefix, cur, amt, h, rate, funding) => ({ id: (kind === 'Sale' ? 'INV-' : 'CO-') + pad(seq(db, 'inv'), 5), kind, prefix, issuer: issuerOf(db, prefix),
        currency: cur, amount: amt, rate: rate || null, dsr: rate ? r4(rate - 0.07) : null, at: since(h), funding: funding || 'INR', branchId: 'BR-MUMFORT', mapped: 0 });
      db.cardActivity = [
        ca('Sale', '4147', 'USD', 150000, 5, r4(usd + 0.30)), ca('Sale', '4532', 'USD', 100000, 3, r4(usd + 0.32)), ca('Cashout', '4147', 'USD', 30000, 2),
        ca('Sale', '5213', 'USD', 80000, 4, r4(usd + 0.35)), ca('Cashout', '5213', 'USD', 10000, 1.5),
        ca('Sale', '6522', 'EUR', 30000, 3.5, r4(eur + 0.40)), ca('Cashout', '6522', 'EUR', 5000, 2),
        ca('Sale', '3712', 'USD', 2000, 1, r4(usd + 0.30)), ca('Sale', '4147', 'USD', 12000, 2.2, r4(usd + 0.30), 'EEFC'),
      ];
      const inv9 = ca('Sale', '4147', 'USD', 30000, 60, r4(usd + 0.28)); inv9.at = ago(60);
      const inv10 = ca('Sale', '4532', 'USD', 25000, 36, r4(usd + 0.29)); inv10.at = ago(36); inv10.mapped = 5000;
      const inv11 = ca('Sale', '4147', 'USD', 10000, 12, r4(usd + 0.30)); inv11.at = ago(12);
      db.cardActivity.push(inv9, inv10, inv11);
      db.cardSettlements = [
        { id: 'SET-3201', issuer: 'Visa', currency: 'USD', amount: 50000, receivedAt: since(1), mappings: [] },
        { id: 'STL-7742', issuer: 'Visa', currency: 'USD', amount: 70000, receivedAt: since(3), mappings: [{ invoiceId: 'PRIOR', amount: 70000, at: since(3), by: 'Finance' }] },
        { id: 'STL-7741', issuer: 'Mastercard', currency: 'USD', amount: 54000, receivedAt: since(2), mappings: [{ invoiceId: 'PRIOR', amount: 50000, at: since(2), by: 'Finance' }] },
        { id: 'STL-7728', issuer: 'Visa', currency: 'USD', amount: 14000, receivedAt: ago(24 * 9), mappings: [] },
      ];
      db.cardCovers = [{ issuer: 'Visa', currency: 'USD', coverId: 'CARD-COV-2040', amount: 100000, at: since(4) }, { issuer: 'Mastercard', currency: 'USD', coverId: 'CARD-COV-2041', amount: 50000, at: since(4) },
                       { issuer: 'ICICI', currency: 'EUR', coverId: 'CARD-COV-2042', amount: 20000, at: since(4) }];

      /* regional bulk requests */
      db.bulkRequests = [
        { id: 'REQ-3081', regionId: 'WEST', branchId: 'BR-MUMFORT', currency: 'USD', amount: 100000, requiredDate: istDate(ago(-24)), purpose: 'Currency inventory', status: 'With Treasury', raisedAt: since(3.5), raisedBy: 'AD2 Regional Bulk (Imran Shaikh)', raisedByKey: 'AD2/RBULK' },
        { id: 'REQ-3080', regionId: 'WEST', branchId: 'BR-MUMT2', currency: 'EUR', amount: 60000, requiredDate: istDate(ago(-48)), purpose: 'Airport counter stock', status: 'With Treasury', raisedAt: since(4), raisedBy: 'AD2 Regional Bulk (Imran Shaikh)', raisedByKey: 'AD2/RBULK' },
        { id: 'REQ-3079', regionId: 'WEST', branchId: 'BR-PUNE', currency: 'GBP', amount: 25000, requiredDate: istDate(now), purpose: 'Currency inventory', status: 'Booked', raisedAt: ago(26), raisedBy: 'AD2 Regional Bulk (Imran Shaikh)', raisedByKey: 'AD2/RBULK',
          bookedAt: since(2), booking: { bankRef: 'BK-1140', counterparty: 'HDFC Bank', rate: r4(currencyOf(db, 'GBP').refRate + 0.2), valueDate: istDate(now), legacyRef: 'CB-7741' } },
        { id: 'REQ-3078', regionId: 'WEST', branchId: 'BR-AHD', currency: 'AED', amount: 50000, requiredDate: istDate(ago(-24)), purpose: 'Festival demand', status: 'Needs detail', query: 'Confirm denomination split before we book', raisedAt: ago(20), raisedBy: 'AD2 Regional Bulk (Imran Shaikh)', raisedByKey: 'AD2/RBULK' },
      ];
      db.seq.bulk = Math.max(db.seq.bulk || 0, 2);

      /* amendments from FX Plus */
      db.amendments = [];
      const amb = bill(p60, 0.01, 4.2, { ref: false, link: false }); db.fxpTxns = db.fxpTxns.filter(t => t !== amb);
      const b61 = db.fxpTxns.find(t => (t.links || []).some(l => l.positionId === p61.id));
      const b44 = db.fxpTxns.find(t => (t.links || []).some(l => l.positionId === p44.id));
      db.amendments.push({ id: 'AMD-' + pad(seq(db, 'amd'), 4), fxpId: b44.id, positionId: p44.id, change: 'Amount reduced', before: 5000, after: 3000, at: since(0.7), status: 'Action needed', by: 'FX Plus API', coverReleased: 2000 });
      db.amendments.push({ id: 'AMD-' + pad(seq(db, 'amd'), 4), fxpId: b61.id, positionId: p61.id, change: 'Value date moved', before: 8000, after: 8000, valueDate: istDate(ago(-24)), at: since(2), status: 'Adjusted', adjustedAt: since(1.8), adjustedBy: DEALER, by: 'FX Plus API', coverReleased: 0 });
      p61.valueDate = istDate(ago(-24));

      /* the approvals inbox */
      db.approvals = [];
      const sys = { domainId: 'AD2', loginId: 'DEALER', role: 'AD2 Treasury Dealer', name: 'Nikhil Bansal', actingFor: null };
      const sys2 = { domainId: 'AD2', loginId: 'DEALER2', role: 'AD2 Treasury Dealer', name: 'Sana Sheikh', actingFor: null };
      const fwd = db.covers.find(c => c.dealRef === 'HDFC-FWD-3101');
      const at = (r, h) => { r.submittedAt = since(h); return r; };
      at(submitApproval(db, sys, now, { type: 'Forward settlement', ref: fwd.id, title: `${fwd.id} — settle ${fmt(20000, 'USD')}`, amount: 20000, currency: 'USD',
        payload: { coverId: fwd.id, amount: 20000, evidence: 'HDFC-S0911' },
        diff: [['Settled USD', fmt(20000), fmt(40000)], ['Pending USD', fmt(40000), fmt(20000)], ['Settlement amount', '—', fmt(20000, 'USD')],
               [`INR principal at ${fwd.rate.toFixed(4)}`, '—', fmt(round2(20000 * fwd.rate))], ['Evidence / date', '—', `HDFC-S0911 / ${istDate(now)}`]],
        note: 'Partial settlement against bank confirmation HDFC-S0911.' }), 2.4);
      const icici = db.creditLines[0], setAct = icici.activity.find(x => x.id === 'SET-3102'), b0 = lineUse(icici);
      at(submitApproval(db, sys, now, { type: 'Credit line settlement', ref: 'SET-3102', title: 'ICICI Bank settlement SET-3102', amount: 500000, currency: 'INR',
        payload: { lineId: icici.id, ref: setAct.id }, diff: [['Utilised (INR)', fmt(b0.utilised), fmt(b0.utilised - 500000)], ['Available (INR)', fmt(b0.available), fmt(b0.available + 500000)]] }), 2.9);
      at(submitApproval(db, sys2, now, { type: 'Nostro upload — replace', ref: 'issuer_balances.xlsx', title: '1 replacement row from issuer_balances.xlsx', amount: 205000, currency: 'USD',
        payload: { rows: [{ issuer: 'Visa', currency: 'USD', balance: 205000, statementDate: String(db.nostro[0].statementAt).slice(0, 10) }], file: 'issuer_balances.xlsx' },
        diff: [[`Visa USD ${String(db.nostro[0].statementAt).slice(0, 10)}`, fmt(200000), fmt(205000)]], note: 'Revised statement received 13:00' }), 1.5);
      const breq = db.bulkRequests[1]; breq.status = 'Awaiting checker';
      const bdet = { bankRef: 'BK-1152', counterparty: 'ICICI Bank', rate: r4(eur + 0.25), valueDate: breq.requiredDate, legacyRef: 'CB-7752' };
      at(submitApproval(db, sys, now, { type: 'Bulk booking detail', ref: breq.id, title: `${breq.id} — ${fmt(breq.amount, breq.currency)} for ${nodeName(db, breq.branchId)}`, amount: breq.amount, currency: breq.currency,
        payload: { id: breq.id, detail: bdet }, diff: [['Status', 'With Treasury', 'Booked'], ['Bank reference', '—', bdet.bankRef], ['Rate', '—', bdet.rate.toFixed(4)], ['Value date', '—', bdet.valueDate],
          ['INR principal', '—', fmt(round2(breq.amount * bdet.rate))]] }), 0.9);
      /* a card rate revision waiting for the checker (GBP remittance) */
      const gbp = currencyOf(db, 'GBP'), gRow = deskRow(db, 'REM', 'GBP');
      const gCard = r4(gRow.card + 0.12);
      const rr = at(submitApproval(db, sys, now, { type: 'Card rate', ref: 'RATE-DESK', title: 'Outward remittance GBP card rate', payload: { rows: [{ product: 'REM', currency: 'GBP', base: gbp.refRate, card: gCard }] },
        diff: [['Outward remittance GBP — card', gRow.card.toFixed(4), gCard.toFixed(4)]], note: 'Sterling firmer after the BoE decision — intraday revision' }), 0.6);
      gRow.pendingId = rr.id;
      /* the agent's deal for Havelock breaches its limit and is held */
      p62.status = 'Held'; p62.heldReason = 'limit ' + inr(10000000) + ', outstanding above the limit';
      const hv = db.limits.find(l => l.id === 'CORP-1211');
      const hvUse = limitUse(db, hv, now);
      hv.limit = Math.max(1000000, Math.round((hvUse.outstanding - inrOf(p62)) * 0.97 / 100000) * 100000 || 500000);
      at(submitApproval(db, sys, now, { type: 'Held deal', ref: p62.id, title: `${p62.id} held — customer limit`, amount: p62.amount, currency: p62.currency,
        payload: { positionId: p62.id, limitId: 'CORP-1211' },
        diff: [['Position', p62.id, p62.id], ['Customer', 'Havelock Traders', 'Havelock Traders'], ['Deal', '—', `Sell ${fmt(p62.amount, 'USD')} at ${p62.customerRate.toFixed(4)}`],
               ['Breach', '—', `limit ${inr(hv.limit)}, outstanding ${inr(limitUse(db, hv, now).outstanding - inrOf(p62))}, this deal ${inr(inrOf(p62))}`]],
        note: 'Held automatically: the booking breaches the customer limit.' }, true), 0.9).maker = 'System — Agent Partner (Sundar Raman)';
      /* one decided yesterday, rejected back to the maker */
      const rej = at(submitApproval(db, sys, now, { type: 'Limit change', ref: 'CORP-1240', title: 'Sankalp Industries limit ' + inr(15000000) + ' → ' + inr(25000000), amount: 25000000, currency: 'INR',
        payload: { id: 'CORP-1240', limit: 25000000 }, diff: [['Limit (INR)', fmt(15000000), fmt(25000000)]], note: 'Q4 order book' }), 20);
      Object.assign(rej, { status: 'Rejected', decidedAt: ago(19), checker: CHECK, checkerKey: 'AD2/TCHECKER', reason: 'Latest audited financials not on file — attach them and resubmit.' });
      db.approvals.sort((x, y) => String(y.submittedAt).localeCompare(String(x.submittedAt)));
      db.notifications = (db.notifications || []).filter(n => !/awaits your approval/.test(n.text));
      db.excNotes = {};
      db.audit = (db.audit || []).filter(x => !/submitted for authorisation/.test(x.action) || true);
    }

    return { seed, scope, scopeKind, views: V, quoteRate, nextCutoff, homeBranch, submitApproval, TMP_KEYS };
  };
});
