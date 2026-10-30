/* ==========================================================================
   AD2 Trade Remittance — treasury module
   Rate desk, positions, bank cover, internal crosses, FX deal references and
   P&L. engine.js loads it (Node: require; browser: this file is loaded first
   and sits on window.Treasury) and hands it the engine's helpers.

   Trade and treasury meet at four events, written to db.tmsEvents inside the
   same command as the trade action, so a payment and its position change are
   saved together or not at all:
     position.opened · position.attached · position.linked · position.cancelled

   A position has two independent tracks. Never merge them.
     lifecycle  Open ──submit──► Attached ──UTR / FIRC──► Concluded
                  │                 │
                  └─release/expiry──┴──reject──► Cancelled
                (expiry applies only to Open: attaching freezes the lock)
                Held: a booking over the customer's limit, until a treasury
                checker releases it (→ Open) or declines it (→ Cancelled).
     cover      Uncovered → Partial → Covered   (bank cover or an internal cross)
   Invariant: amount = linkedAmount + remaining + cancelledAmount.

   The same book holds the branch deals of the Treasury Management Portal
   (tmp-engine.js): those link to FX Plus bills in parts, and whatever is
   not linked by cut-off is released as a residual. tmp-engine fills
   E.hooks, which this module calls at the points where trade meets the
   rest of treasury (rate desk, limits, liquidity, cut-off).

   Side is AD2's side of the trade: an outward payment is a SELL of foreign
   currency to the customer (treasury short), a disposal credited in INR is a
   BUY (treasury long). A disposal credited to EEFC converts nothing, so it
   opens no position.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Treasury = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  return function install(E) {
    const H = E.hooks = E.hooks || {};
    const { C, fail, need, missing, txt, amount, date, oneOf, bool, round2, addHours, find, smeOf, currencyOf, marginFor,
            customerRate, can, requireCap, isAD2, actorKey, actorLabel, distinct, audit, notify, seq, fmt, ownSme,
            requireApproved } = E;

    const LOCK_HOURS = 48;
    const SYSTEM = { domainId: 'SYSTEM', loginId: 'TREASURY', role: 'System', name: 'Treasury', actingFor: null };
    const r4 = n => +Number(n || 0).toFixed(4);
    const sideOf = dir => dir === 'out' ? 'SELL' : 'BUY';
    const dirWord = side => side === 'SELL' ? 'outward payment' : 'inward conversion';
    const pad = (n, w) => String(n).padStart(w, '0');
    const arr = (db, k) => (db[k] = db[k] || []);

    /* ---------- position arithmetic ------------------------------------------ */
    const live = p => round2(p.amount - (p.cancelledAmount || 0));
    const remaining = p => round2(Math.max(0, p.amount - (p.cancelledAmount || 0) - (p.linkedAmount || 0)));
    const isTrade = p => !!p.smeId;
    const uncovered = p => p.status === 'Cancelled' ? 0 : round2(Math.max(0, live(p) - (p.covered || 0)));
    function positionStatus(p, now) {
      if (!p) return '—';
      if (p.status === 'Open' && p.expiresAt && now && String(now) >= String(p.expiresAt)) return 'Expired';
      return p.status;
    }
    function coverState(p) {
      if (p.status === 'Cancelled' || live(p) <= 0) return '—';
      const c = p.covered || 0;
      return c >= live(p) - 0.005 ? 'Covered' : c > 0 ? 'Partial' : 'Uncovered';
    }
    const linkState = p => p.status === 'Concluded' ? 'Linked' : p.status === 'Attached' ? 'Awaiting settlement'
      : p.status === 'Cancelled' ? '—' : p.status === 'Held' ? 'Held for approval' : (p.linkedAmount || 0) > 0.005 ? 'Partly linked' : 'Not submitted';

    /* ---------- events: what trade told treasury ----------------------------- */
    function emit(db, now, type, p, extra) {
      arr(db, 'tmsEvents').unshift({ id: 'EV-' + pad(seq(db, 'evt'), 6), type, at: now, positionId: p.id, recordId: p.recordId || null,
        smeId: p.smeId, currency: p.currency, side: p.side, amount: p.amount, rate: p.customerRate, ...(extra || {}), status: 'Delivered' });
      if (db.tmsEvents.length > 1000) db.tmsEvents.length = 1000;
    }

    /* ---------- pricing -------------------------------------------------------- */
    /* Reference rate (published by treasury) ± the customer's approved margin.
       In an assisted journey AD2 may price inside the configured band below
       the approved margin, never above +100 paise. */
    function priceFor(db, s, cur, dir, reqMargin, a) {
      let m = marginFor(db, s, cur);
      if (reqMargin != null && reqMargin !== '' && Number(reqMargin) !== m) {
        const want = Math.round(Number(reqMargin));
        if (!(a && a.actingFor && isAD2(a))) fail('Only AD2 in an assisted journey can change the margin.');
        const band = Number((db.settings || {}).marginBand ?? 5);
        if (!isFinite(want) || want < Math.max(0, m - band) || want > m + 100)
          fail(`Margin must be between ${Math.max(0, m - band)} and ${m + 100} paise (approved ${m}, band ${band}).`);
        m = want;
      }
      const ref = (currencyOf(db, cur) || {}).refRate || 0;
      need(ref > 0, `No rate is published for ${cur}. Treasury publishes it on the rate desk.`);
      /* Treasury's rate desk gates trade pricing: no card rate published for
         the product line, no booking. */
      if (a && H.rateCheck) H.rateCheck(db, dir === 'out' ? 'REM' : 'INW', cur);
      return { refRate: ref, margin: m, customerRate: customerRate(db, cur, dir === 'out' ? m : -m) };
    }

    /* ---------- booking -------------------------------------------------------- */
    /* One position shape for the whole book. A trade position belongs to an
       SME (smeId) and sits at its home branch; a branch deal has no smeId,
       carries its product line and cut-off, and links to FX Plus bills. */
    function newPosition(db, a, s, v, now) {
      const assisted = !!(a && a.actingFor);
      const p = { id: 'POS-' + pad(seq(db, 'pos'), 4), smeId: s ? s.id : null, currency: v.currency, side: v.side, amount: v.amount,
        customerRate: r4(v.customerRate), refRate: r4(v.refRate), margin: v.margin, source: v.source, dealId: v.dealId || null,
        bookedAt: now, expiresAt: v.expiresAt || null, status: 'Open', recordKind: null, recordId: null, attachedAt: null,
        covered: 0, linkedAmount: 0, cancelledAmount: 0, linkRef: null, linkedAt: null, links: [],
        product: v.product || (v.side === 'SELL' ? 'REM' : 'INW'),
        branchId: v.branchId || (s && H.homeBranch ? H.homeBranch(db, s) : null),
        channel: v.channel || (assisted ? 'Assisted' : v.source === 'Deal' ? 'Treasury deal' : 'Trade portal'),
        customerName: v.customerName || (s && s.tradingName) || '', customerRef: v.customerRef || null, customerId: v.customerId || null,
        quoteId: v.quoteId || null, valueDate: v.valueDate || null, ibrAtBooking: v.ibrAtBooking != null ? r4(v.ibrAtBooking) : r4(v.refRate),
        agentName: v.agentName || null, cutoffAt: v.cutoffAt || null, ...(v.offline ? { offline: v.offline } : {}),
        bookedBy: a ? actorLabel(a) + (assisted ? ' — assisted' : '') : 'System', bookedByKey: a ? actorKey(a) : '', assisted };
      arr(db, 'positions').unshift(p);
      emit(db, now, 'position.opened', p, { source: p.source, product: p.product, branchId: p.branchId, channel: p.channel });
      return p;
    }
    /* A customer limit breach holds the position for a treasury checker. */
    function holdIfOverLimit(db, a, p, now) {
      if (!H.limitCheck) return null;
      const breach = H.limitCheck(db, p.smeId || p.customerId, round2(live(p) * p.customerRate), p.currency, p.side, now);
      if (!breach) return null;
      p.status = 'Held'; p.heldReason = breach.reason;
      if (H.onHeld) H.onHeld(db, a, p, breach, now);
      return breach;
    }

    /* Book the live rate for an amount. The customer's rate is fixed here and
       stored on the position; submitting uses this stored rate, whatever the
       rate desk publishes in between. */
    function book(db, a, s, v, now, opts) {
      const dir = oneOf(v.dir, ['out', 'in'], 'Direction');
      const cur = oneOf(v.currency, db.currencies.map(c => c.code), 'Currency');
      const amt = amount(v.amount, 'Amount');
      if (!(a.actingFor && isAD2(a))) need(((s.config || {}).currencies || []).includes(cur), `${cur} is not enabled for ${s.tradingName}.`);
      const pr = priceFor(db, s, cur, dir, v.margin, a);
      /* A new booking for the same draft replaces the old one. */
      if (v.replaces) {
        const old = find(db.positions, v.replaces);
        if (old && old.smeId === s.id && old.status === 'Open' && old.source === 'Booked') cancel(db, a, old, 'Replaced by a new booking', now);
      }
      if (!(opts && opts.inline)) {
        const open = (db.positions || []).filter(p => p.smeId === s.id && p.source === 'Booked' && positionStatus(p, now) === 'Open');
        const max = Number((db.settings || {}).maxOpenBookings ?? 5);
        need(open.length < max, `${s.tradingName} already holds ${open.length} open rate bookings (${open.map(p => p.id).join(', ')}). ` +
          'Submit a request against one, or release one, before booking another.');
      }
      const p = newPosition(db, a, s, { currency: cur, side: sideOf(dir), amount: amt, ...pr, source: 'Booked',
        expiresAt: addHours(now, LOCK_HOURS) }, now);
      audit(db, a, now, p.id, `Rate booked for ${s.tradingName} — ${fmt(amt, cur)} ${dirWord(p.side)} at ${p.customerRate.toFixed(4)}, locked for ${LOCK_HOURS} hours`);
      if (pr.margin !== marginFor(db, s, cur)) audit(db, a, now, p.id, `Margin set to ${pr.margin} paise within the branch band`, true);
      const breach = holdIfOverLimit(db, a, p, now);
      if (breach) {
        need(!(opts && opts.inline), `This ${dirWord(p.side)} would take ${s.tradingName} over its treasury limit (${breach.reason}). ` +
          'Book the rate first — the booking goes to a treasury checker — and submit once it is released.');
        audit(db, a, now, p.id, `Held for a treasury checker — ${breach.reason}`);
      }
      return p;
    }

    /* What a submitted request's rate resolves to: a booking (by reference, or
       booked in the same step when none is given), or a treasury deal. The
       position is attached once the request exists (attach below). */
    function resolveRate(db, a, s, cur, dir, amt, req, now) {
      req = req || {};
      const side = sideOf(dir);
      if (req.mode === 'deal') {
        if (!can(db, a, 'fx.dealRef') || !isAD2(a)) fail('FX deal references are applied by AD2 (branch or treasury). Book the live rate instead.');
        const ref = dealRefOf(req.dealRef);
        const dl = (db.deals || []).find(x => x.id === ref);
        /* a rate typed with the reference: the deal the desk dealt by phone */
        const typed = req.customerRate != null && req.customerRate !== '' && Number(req.customerRate) !== 0;
        if (!dl) {
          need(typed, `Deal ${ref} was not issued by treasury on the platform. Enter the rate the treasury desk dealt, or ask the desk to issue it here.`);
          return phoneDeal(db, a, s, ref, cur, dir, amt, req.customerRate, now);
        }
        if (typed) need(Math.abs(Number(req.customerRate) - dl.rate) < 0.00005,
          `Deal ${dl.id} was issued at ${r4(dl.rate).toFixed(4)}. Enter that rate, or ask the treasury desk to reissue the deal.`);
        need(dl.smeId === s.id, `Deal ${dl.id} was issued for another customer.`);
        const p = find(db.positions, dl.positionId);
        const st = positionStatus(p, now);
        need(!(dl.status === 'Issued' && st === 'Held'), `Deal ${dl.id} is held for a treasury checker (customer limit). Apply it once it is released.`);
        need(dl.status === 'Issued' && st === 'Open', `Deal ${dl.id} is ${dl.status === 'Issued' && st === 'Expired' ? 'past its validity' : dl.status.toLowerCase()} and cannot be applied.`);
        need(dl.currency === cur, `Deal ${dl.id} is in ${dl.currency}, not ${cur}.`);
        need(dl.side === side, `Deal ${dl.id} is for an ${dirWord(dl.side)}, not an ${dirWord(side)}.`);
        need(amt <= dl.amount + 0.005, `Deal ${dl.id} covers up to ${fmt(dl.amount, cur)}; this request is ${fmt(amt, cur)}.`);
        return { position: p, deal: dl, rate: { mode: 'deal', positionId: p.id, refRate: p.refRate, margin: p.margin, customerRate: p.customerRate,
          bookedAt: null, expiresAt: null, dealRef: dl.id } };
      }
      if (req.mode === 'booked') {
        let p;
        if (req.positionId) {
          p = find(db.positions, req.positionId);
          need(p && p.smeId === s.id, 'That rate booking was not found for this customer. Book the rate again.');
          const st = positionStatus(p, now);
          const expired = st === 'Expired' || (st === 'Cancelled' && /expired/i.test(p.cancelReason || ''));
          need(st !== 'Held', `Rate booking ${p.id} is held for a treasury checker (customer limit). Submit once it is released.`);
          need(st === 'Open', expired ? `The booked rate has expired (${LOCK_HOURS}-hour lock). Book the rate again.`
                                              : `Rate booking ${p.id} is already ${st.toLowerCase()}. Book the rate again.`);
          need(p.source === 'Booked', `${p.id} is a deal position; apply its deal reference instead.`);
          need(p.currency === cur && p.side === side, `Rate booking ${p.id} is for an ${dirWord(p.side)} in ${p.currency}. Book the rate again.`);
          need(Math.abs(p.amount - amt) < 0.005, `Rate booking ${p.id} is for ${fmt(p.amount, cur)}, this request is ${fmt(amt, cur)}. Book the rate again for the new amount.`);
        } else {
          p = book(db, a, s, { dir, currency: cur, amount: amt, margin: req.margin }, now, { inline: true });
        }
        return { position: p, rate: { mode: 'booked', positionId: p.id, refRate: p.refRate, margin: p.margin, customerRate: p.customerRate,
          bookedAt: p.bookedAt, expiresAt: p.expiresAt, dealRef: null } };
      }
      fail('Book a rate or enter an FX deal reference.');
    }

    const dealRefOf = v => txt(v, 'FX deal reference', { max: 30, pattern: /^[A-Za-z0-9\-\/]{4,30}$/,
      patternMsg: 'FX deal reference should be 4–30 letters, digits or dashes.' }).toUpperCase();
    const dealMargin = (dir, rate, ref) => Math.round((dir === 'out' ? rate - ref : ref - rate) * 100);
    /* A dealt rate is held within 3% of the reference, as on deal issue and cover. */
    function dealRate(db, cur, v) {
      const rate = Number(v), ref = (currencyOf(db, cur) || {}).refRate || 0;
      need(isFinite(rate) && rate > 0, 'Enter the deal rate as a positive number.');
      need(Math.abs(rate - ref) / ref <= 0.03, `The deal rate ${rate} is more than 3% from the reference ${ref}. Check it with the treasury desk.`);
      return r4(rate);
    }
    /* A deal the desk dealt by phone, entered by AD2 with its rate: it goes on
       the book under the desk's reference, ready to attach. */
    function phoneDeal(db, a, s, ref, cur, dir, amt, v, now) {
      const rate = dealRate(db, cur, v), refRate = currencyOf(db, cur).refRate;
      if (H.rateCheck) H.rateCheck(db, dir === 'out' ? 'REM' : 'INW', cur);
      const p = newPosition(db, a, s, { currency: cur, side: sideOf(dir), amount: amt, customerRate: rate, refRate, margin: dealMargin(dir, rate, refRate),
        source: 'Deal', dealId: ref, ibrAtBooking: marketRate(db, cur, now) }, now);
      const dl = { id: ref, smeId: s.id, currency: cur, side: p.side, amount: amt, rate, refRate, positionId: p.id, validUntil: now, status: 'Issued',
        issuedAt: now, issuedBy: actorLabel(a), issuedByKey: actorKey(a), note: 'Dealt by phone with the treasury desk; entered by AD2', phone: true };
      arr(db, 'deals').unshift(dl);
      audit(db, a, now, p.id, `Deal ${ref} entered for ${s.tradingName} — ${fmt(amt, cur)} ${dirWord(p.side)} at ${rate.toFixed(4)}, dealt by phone with the treasury desk`);
      const breach = holdIfOverLimit(db, a, p, now);
      need(!breach, `Deal ${ref} would take ${s.tradingName} over its treasury limit (${breach && breach.reason}). Ask the treasury desk to issue it on the platform.`);
      return { position: p, deal: dl, rate: { mode: 'deal', positionId: p.id, refRate, margin: p.margin, customerRate: rate, bookedAt: null, expiresAt: null, dealRef: ref } };
    }
    /* AD2 changes a submitted request's rate to a deal. Its old position is
       released and the deal attached; the same phone deal is corrected in place. */
    function replaceRate(db, a, s, rec, kind, dir, req, now) {
      const ref = dealRefOf(req.dealRef);
      const old = rec.rate && rec.rate.positionId && find(db.positions, rec.rate.positionId);
      if (old && old.dealId === ref && old.status === 'Attached') {
        const dl = find(db.deals, ref);
        need(dl && dl.phone, `Deal ${ref} was issued by the treasury desk at ${r4(old.customerRate).toFixed(4)}. Ask the desk to reissue it at the new rate.`);
        const rate = dealRate(db, rec.currency, req.customerRate);
        need(rate !== old.customerRate, `Deal ${ref} is already at ${rate.toFixed(4)}.`);
        audit(db, a, now, old.id, `Deal ${ref} rate corrected from ${r4(old.customerRate).toFixed(4)} to ${rate.toFixed(4)} on ${rec.id}`);
        old.customerRate = dl.rate = rate; old.margin = dealMargin(dir, rate, old.refRate);
        return { ...rec.rate, customerRate: rate, margin: old.margin };
      }
      if (old) {
        cancel(db, a, old, `Rate on ${rec.id} replaced by deal ${ref}`, now);
        const d0 = old.dealId && find(db.deals, old.dealId);
        if (d0 && d0.usedOn === rec.id) d0.status = 'Withdrawn';
      }
      const rr = resolveRate(db, a, s, rec.currency, dir, rec.amount, { mode: 'deal', dealRef: ref, customerRate: req.customerRate }, now);
      attach(db, a, rr, kind, rec.id, rec.amount, now);
      return rr.rate;
    }

    /* The request now exists: the position carries it until settlement. */
    function attach(db, a, rr, kind, recordId, amt, now) {
      const p = rr.position;
      p.status = 'Attached'; p.recordKind = kind; p.recordId = recordId; p.attachedAt = now;
      if (rr.deal) {
        rr.deal.status = 'Used'; rr.deal.usedOn = recordId; rr.deal.usedAt = now;
        const unused = round2(p.amount - amt);
        if (unused > 0.005) {
          p.cancelledAmount = unused;
          releaseCover(db, p, Math.max(0, (p.covered || 0) - live(p)));
          audit(db, a, now, p.id, `${fmt(unused, p.currency)} of deal ${rr.deal.id} not used by ${recordId} — released`);
        }
      }
      audit(db, a, now, p.id, `Attached to ${recordId} — the rate is now committed until settlement`);
      emit(db, now, 'position.attached', p);
    }

    /* Payment released (UTR) or proceeds credited (FIRC). */
    function link(db, a, rec, ref, now) {
      const p = rec && rec.rate && find(db.positions, rec.rate.positionId);
      if (!p || p.status !== 'Attached') return;
      addLink(db, a, p, { ref, amount: remaining(p), kind: rec.utr ? 'UTR' : 'FIRC', at: now, by: a ? actorLabel(a) : 'Trade portal', recordId: rec.id }, now, true);
      audit(db, a, now, p.id, `Linked to ${rec.id} — ${ref}; position concluded (${coverState(p).toLowerCase()})`);
      if (H.onLinked) H.onLinked(db, p, rec, ref, now);
    }

    /* A transaction linked to a position: a UTR or FIRC for a trade position
       (all of it at once), or an FX Plus bill for a branch deal (in parts).
       The position concludes when nothing is left to link. */
    function addLink(db, a, p, l, now, quiet) {
      const amt = round2(Math.min(Number(l.amount) || 0, remaining(p)));
      if (amt <= 0) return;
      (p.links = p.links || []).push({ ref: l.ref, amount: amt, kind: l.kind || 'FX Plus', at: l.at || now, by: l.by || (a ? actorLabel(a) : 'System'),
        ...(l.rate ? { rate: r4(l.rate) } : {}), ...(l.recordId ? { recordId: l.recordId } : {}) });
      p.linkedAmount = round2((p.linkedAmount || 0) + amt);
      p.linkRef = l.ref;
      if (!quiet && a) audit(db, a, now, p.id, `${l.kind || 'FX Plus'} ${l.ref} linked — ${fmt(amt, p.currency)}; ${fmt(remaining(p), p.currency)} remaining`);
      if (remaining(p) <= 0.005) conclude(db, p, now, l.ref, quiet === 'seed');
    }
    function conclude(db, p, now, ref, seeding) {
      p.status = 'Concluded'; p.linkedAt = now;
      emit(db, now, 'position.linked', p, { ref, linked: p.linkedAmount });
      if (!isTrade(p) && H.onBranchConcluded && !seeding && p.linkedAmount > 0.005) H.onBranchConcluded(db, p, now);
    }
    /* Release what is left of a position. Nothing linked: the position is
       cancelled. Partly linked: it concludes at what was linked, and the
       residual goes back (with any cover above what remains live). */
    function cancelResidual(db, a, p, reason, now) {
      if (!p || !['Open', 'Attached', 'Held'].includes(p.status)) return 0;
      const res = remaining(p);
      if ((p.linkedAmount || 0) <= 0.005) { cancel(db, a, p, reason, now); return res; }
      p.cancelledAmount = round2((p.cancelledAmount || 0) + res);
      releaseCover(db, p, Math.max(0, (p.covered || 0) - live(p)));
      p.cancelReason = reason; p.cancelledAt = now;
      audit(db, a || SYSTEM, now, p.id, `Residual ${fmt(res, p.currency)} released — ${reason}`);
      emit(db, now, 'position.cancelled', p, { reason, residual: res });
      conclude(db, p, now, p.linkRef, false);
      return res;
    }
    /* A linked bill reduced or reversed after the fact (an FX Plus
       amendment): the link shrinks, and the amount is released as a
       forward-dated adjustment, never by rewriting the original link. */
    function unwind(db, a, p, ref, amt, reason, now) {
      amt = round2(Math.min(Number(amt) || 0, p.linkedAmount || 0));
      if (amt <= 0) return 0;
      (p.adjustments = p.adjustments || []).push({ ref, amount: -amt, reason, at: now, by: a ? actorLabel(a) : 'System' });
      p.linkedAmount = round2(p.linkedAmount - amt);
      if (p.status === 'Open') { audit(db, a || SYSTEM, now, p.id, `${fmt(amt, p.currency)} unlinked from ${ref} — ${reason}`); return 0; }
      p.cancelledAmount = round2((p.cancelledAmount || 0) + amt);
      const freed = Math.max(0, (p.covered || 0) - live(p));
      releaseCover(db, p, freed);
      audit(db, a || SYSTEM, now, p.id, `${fmt(amt, p.currency)} released from the concluded position — ${reason}${freed > 0.005 ? `; ${fmt(freed, p.currency)} of cover returned to the pool` : ''}`);
      emit(db, now, 'position.cancelled', p, { reason, residual: amt });
      return freed;
    }
    /* An FX deal reference for a position already on the book: the rate the
       trade portal applies to the customer's request. */
    function issueDeal(db, a, s, p, hours, note, now) {
      const id = `FXD-${now.slice(0, 4)}-${pad(seq(db, 'fxd'), 5)}`;
      p.source = 'Deal'; p.dealId = id; p.expiresAt = addHours(now, hours);
      const dl = { id, smeId: s.id, currency: p.currency, side: p.side, amount: p.amount, rate: r4(p.customerRate), refRate: p.refRate, positionId: p.id,
        validUntil: p.expiresAt, status: 'Issued', issuedAt: now, issuedBy: actorLabel(a), issuedByKey: actorKey(a), note: note || '' };
      arr(db, 'deals').unshift(dl);
      audit(db, a, now, p.id, `Deal ${id} issued for ${s.tradingName} — ${fmt(p.amount, p.currency)} ${dirWord(p.side)} at ${r4(p.customerRate).toFixed(4)}, valid ${hours}h`);
      ['AD2 Maker', 'AD2 Sales', 'AD2 Operations'].forEach(r => notify(db, now, { toRole: r, text: `Deal ${id} issued for ${s.tradingName}: ${fmt(p.amount, p.currency)} at ${r4(p.customerRate).toFixed(4)}`, link: '#/ad2/directory' }));
      return dl;
    }

    /* Undo cover allocations when a position (or part of it) goes away. */
    function releaseCover(db, p, cap) {
      let left = cap == null ? Infinity : cap;
      (db.coverAllocations || []).filter(x => x.status === 'Active' && (x.positionId === p.id || x.crossId === p.id)).forEach(x => {
        if (left <= 0) return;
        const amt = Math.min(x.amount, left);
        if (x.kind === 'bank') { const c = find(db.covers, x.coverId); if (c) c.allocated = round2(c.allocated - amt); }
        const other = find(db.positions, x.positionId === p.id ? x.crossId : x.positionId);
        if (other) other.covered = round2(Math.max(0, (other.covered || 0) - amt));
        p.covered = round2(Math.max(0, (p.covered || 0) - amt));
        x.amount = round2(x.amount - amt);
        if (x.amount <= 0.005) x.status = 'Released';
        left -= amt;
      });
    }
    function cancel(db, a, p, reason, now) {
      if (!p || !['Open', 'Attached', 'Held'].includes(p.status)) return;
      releaseCover(db, p);
      p.cancelledAmount = round2(p.amount - (p.linkedAmount || 0));
      p.status = 'Cancelled'; p.cancelReason = reason; p.cancelledAt = now;
      const dl = p.dealId && find(db.deals, p.dealId);
      if (dl && dl.status === 'Issued') dl.status = /expir/i.test(reason) ? 'Expired' : 'Withdrawn';
      audit(db, a || SYSTEM, now, p.id, 'Position cancelled — ' + reason);
      emit(db, now, 'position.cancelled', p, { reason });
      if (H.onCancelled) H.onCancelled(db, a, p, reason, now);
    }
    /* A request that is rejected or discarded releases its rate. */
    function release(db, a, rec, reason, now) {
      const p = rec && rec.rate && rec.rate.positionId && find(db.positions, rec.rate.positionId);
      if (p) cancel(db, a, p, reason, now);
    }

    /* ---------- time-based housekeeping ---------------------------------------
       There is no scheduler: every command sweeps first, and every screen
       derives expiry through positionStatus(), so an expired lock never shows
       as open even when nobody has acted since.                              */
    function istDate(iso) { return new Date(new Date(iso).getTime() + 330 * 60000).toISOString().slice(0, 10); }
    function pastCutoff(db, now) {
      const [h, m] = String((db.settings || {}).cutoff || '16:00').split(':').map(Number);
      const ist = new Date(new Date(now).getTime() + 330 * 60000);
      return ist.getUTCHours() * 60 + ist.getUTCMinutes() >= h * 60 + (m || 0);
    }
    function sweep(db, now) {
      if (!db.positions) return;
      db.positions.forEach(p => {
        if (positionStatus(p, now) === 'Expired') cancel(db, SYSTEM, p, p.source === 'Deal' ? 'Deal expired — not applied within its validity' : `Lock expired — not used within ${LOCK_HOURS} hours`, now);
      });
      if (pastCutoff(db, now)) {
        const flags = db.tmsFlags = db.tmsFlags || {};
        const day = istDate(now);
        Object.values(netByCurrency(db, now)).forEach(r => {
          const k = day + ':' + r.currency;
          if (Math.abs(r.net) < 0.005 || flags[k]) return;
          flags[k] = true;
          notify(db, now, { toRole: 'AD2 Treasury Dealer', text: `Cut-off passed with ${r.currency} ${r.net < 0 ? 'short' : 'long'} ${fmt(Math.abs(r.net), r.currency)} uncovered`, link: '#/T-02' });
        });
        Object.keys(flags).forEach(k => { if (k.slice(0, 10) < istDate(addHours(now, -24 * 7))) delete flags[k]; });
      }
      if (H.sweep) H.sweep(db, now);
    }

    /* ---------- the book ------------------------------------------------------ */
    /* Net open position per currency: customer positions not yet covered,
       plus bank cover bought but not allocated. Long is positive. */
    function netByCurrency(db, now) {
      const out = {};
      const row = cur => out[cur] = out[cur] || { currency: cur, buy: 0, sell: 0, coverBuy: 0, coverSell: 0, positions: [] };
      (db.positions || []).forEach(p => {
        if (positionStatus(p, now) === 'Expired') return;
        const u = uncovered(p);
        if (u <= 0) return;
        const r = row(p.currency);
        r[p.side === 'BUY' ? 'buy' : 'sell'] += u;
        r.positions.push(p.id);
      });
      (db.covers || []).filter(c => c.status === 'Active').forEach(c => {
        const u = round2(c.amount - c.allocated);
        if (u <= 0) return;
        row(c.currency)[c.side === 'BUY' ? 'coverBuy' : 'coverSell'] += u;
      });
      Object.values(out).forEach(r => {
        ['buy', 'sell', 'coverBuy', 'coverSell'].forEach(k => { r[k] = round2(r[k]); });
        r.net = round2(r.buy - r.sell + r.coverBuy - r.coverSell);
        r.crossable = round2(Math.min(r.buy, r.sell));
      });
      return out;
    }

    /* Rule-based suggestions for the dealer. They never execute themselves. */
    function suggestions(db, now) {
      const out = [];
      Object.values(netByCurrency(db, now)).forEach(r => {
        (db.covers || []).filter(c => c.status === 'Active' && c.currency === r.currency && c.amount - c.allocated > 0.005).forEach(c => {
          const want = c.side === 'BUY' ? r.sell : r.buy;
          if (want > 0) out.push({ kind: 'allocate', currency: r.currency, source: c.id, amount: round2(Math.min(want, c.amount - c.allocated)),
            text: `Allocate ${fmt(Math.min(want, c.amount - c.allocated), r.currency)} of ${c.id} to open ${c.side === 'BUY' ? 'sales' : 'purchases'}`, rule: 'Unallocated cover on the offsetting side' });
        });
        if (r.crossable > 0) {
          const first = side => (db.positions || []).filter(p => p.currency === r.currency && p.side === side && uncovered(p) > 0 && positionStatus(p, now) !== 'Expired')
            .sort((x, y) => String(x.bookedAt).localeCompare(String(y.bookedAt)))[0];
          const src = first('BUY');
          if (src) out.push({ kind: 'cross', currency: r.currency, source: src.id, amount: r.crossable,
            text: `Cross ${fmt(r.crossable, r.currency)} internally — customer purchases against customer sales, no bank deal`, rule: 'Both sides open in one currency' });
        }
        if (Math.abs(r.net) > 0.005) out.push({ kind: 'cover', currency: r.currency, side: r.net < 0 ? 'BUY' : 'SELL', amount: Math.abs(r.net),
          text: `${r.net < 0 ? 'Buy' : 'Sell'} ${fmt(Math.abs(r.net), r.currency)} from a bank to flatten ${r.currency}`, rule: `Net ${r.net < 0 ? 'short' : 'long'} after offsets` });
      });
      return out;
    }

    /* Simulated market: a smooth, repeatable drift around each currency's
       market base (±0.45%), so the desk moves during a demo and the same
       moment always gives the same rate. Off → the published rate. */
    function marketRate(db, cur, now) {
      const c = currencyOf(db, cur) || {};
      if (!c.refRate) return 0;
      if ((db.settings || {}).marketSim === false) return r4(c.refRate);
      const base = c.marketBase || c.refRate;
      const h = ([...cur].reduce((t, ch) => (t * 31 + ch.charCodeAt(0)) % 100003, 7) / 100003) * 2 * Math.PI;
      const t = new Date(now).getTime() / 3600000;
      const d = 0.0028 * Math.sin(2 * Math.PI * t / 9 + h) + 0.0012 * Math.sin(2 * Math.PI * t / 2.7 + 2 * h) + 0.0005 * Math.sin(2 * Math.PI * t / 0.55 + 3 * h);
      return r4(base * (1 + d));
    }

    /* P&L in INR, in two parts that are never mixed:
         sales margin    customer rate vs the published reference at booking
         dealing result  reference vs what treasury covered at (realised),
                         or vs the market for what is still open (unrealised)
       SELL: AD2 is short at the reference, so cover below it is a gain.
       BUY:  AD2 is long at the reference, so selling above it is a gain.     */
    function pnl(db, now) {
      const rows = [];
      (db.positions || []).forEach(p => {
        const lv = live(p);
        if (lv <= 0 && !(p.covered > 0)) return;
        const sgn = p.side === 'SELL' ? 1 : -1;
        const sales = round2(sgn * (p.customerRate - p.refRate) * lv);
        let realised = 0;
        (db.coverAllocations || []).filter(x => x.status === 'Active' && x.positionId === p.id).forEach(x => {
          if (x.kind === 'bank') realised += sgn * (p.refRate - x.rate) * x.amount;
          else { const o = find(db.positions, x.crossId); if (o) realised += (p.side === 'SELL' ? p.refRate - o.refRate : o.refRate - p.refRate) * x.amount; }
        });
        const open = uncovered(p);
        const mkt = open > 0 ? marketRate(db, p.currency, now) : 0;
        const unrealised = open > 0 ? round2(sgn * (p.refRate - mkt) * open) : 0;
        rows.push({ positionId: p.id, smeId: p.smeId, currency: p.currency, side: p.side, day: istDate(p.bookedAt), status: p.status,
          amount: lv, sales, realised: round2(realised), unrealised, total: round2(sales + realised + unrealised) });
      });
      const sum = (list, k) => round2(list.reduce((t, r) => t + r[k], 0));
      const group = key => {
        const g = {};
        rows.forEach(r => { (g[r[key]] = g[r[key]] || []).push(r); });
        return Object.entries(g).map(([k, list]) => ({ key: k, n: list.length, sales: sum(list, 'sales'), realised: sum(list, 'realised'),
          unrealised: sum(list, 'unrealised'), total: sum(list, 'total') })).sort((x, y) => y.total - x.total);
      };
      return { rows, totals: { sales: sum(rows, 'sales'), realised: sum(rows, 'realised'), unrealised: sum(rows, 'unrealised'), total: sum(rows, 'total') },
        byCurrency: group('currency'), byCustomer: group('smeId'), byDay: group('day').sort((x, y) => y.key.localeCompare(x.key)) };
    }

    /* Exceptions: separate, owned, never one merged "errors" list. */
    function exceptions(db, now) {
      const out = [];
      const aged = Number((db.settings || {}).agedDays ?? 3);
      if (pastCutoff(db, now)) Object.values(netByCurrency(db, now)).filter(r => Math.abs(r.net) > 0.005).forEach(r =>
        out.push({ type: 'Uncovered after cut-off', owner: 'Treasury Dealer', currency: r.currency, amount: Math.abs(r.net), ref: r.currency,
          detail: `${r.currency} ${r.net < 0 ? 'short' : 'long'} ${fmt(Math.abs(r.net), r.currency)} after the ${db.settings.cutoff || '16:00'} IST cut-off`, at: now }));
      (db.covers || []).filter(c => c.status === 'Active' && c.amount - c.allocated > 0.005).forEach(c =>
        out.push({ type: 'Unallocated cover', owner: 'Treasury Dealer', currency: c.currency, amount: round2(c.amount - c.allocated), ref: c.id,
          detail: `${c.id} ${c.side} ${fmt(c.amount, c.currency)} from ${c.counterparty}: ${fmt(c.amount - c.allocated, c.currency)} not allocated`, at: c.approvedAt || c.enteredAt }));
      (db.positions || []).filter(p => p.status === 'Attached' && p.attachedAt && (new Date(now) - new Date(p.attachedAt)) / 86400000 > aged).forEach(p =>
        out.push({ type: 'Aged — awaiting settlement', owner: 'Trade operations', currency: p.currency, amount: live(p), ref: p.id,
          detail: `${p.id} attached to ${p.recordId} for ${Math.floor((new Date(now) - new Date(p.attachedAt)) / 86400000)} days`, at: p.attachedAt, recordId: p.recordId }));
      (db.positions || []).filter(p => p.status === 'Cancelled' && /expired/i.test(p.cancelReason || '') && (new Date(now) - new Date(p.cancelledAt)) / 86400000 <= 7).forEach(p =>
        out.push({ type: 'Expired lock', owner: 'Branch', currency: p.currency, amount: p.amount, ref: p.id,
          detail: `${p.id} for ${(smeOf(db, p.smeId) || {}).tradingName || p.smeId} expired unused — ${p.cancelReason}`, at: p.cancelledAt }));
      (db.currencies || []).forEach(c => {
        const m = marketRate(db, c.code, now);
        if (m && Math.abs(c.refRate - m) / m > 0.003) out.push({ type: 'Published rate off market', owner: 'Treasury Dealer', currency: c.code, amount: null, ref: c.code,
          detail: `${c.code} published ${c.refRate.toFixed(4)}, market ${m.toFixed(4)} (${((c.refRate - m) / m * 100).toFixed(2)}%)`, at: c.publishedAt || now });
      });
      return out;
    }

    /* ======================================================================== */
    /*  Commands                                                                */
    /* ======================================================================== */
    const posFor = (db, id) => find(db.positions, id) || missing('Position');

    C['rate.book'] = {
      run(db, a, p, ctx) {
        const dir = oneOf(p.dir, ['out', 'in'], 'Direction');
        requireCap(db, a, dir === 'out' ? 'outward.create' : 'inward.dispose');
        const s = ownSme(db, a); requireApproved(s);
        const pos = book(db, a, s, { dir, currency: p.currency, amount: p.amount, margin: p.margin, replaces: p.replaces }, ctx.now);
        const held = pos.status === 'Held';
        return { positionId: pos.id, customerRate: pos.customerRate, bookedAt: pos.bookedAt, expiresAt: pos.expiresAt, held,
          ...(isAD2(a) ? { refRate: pos.refRate, margin: pos.margin } : {}),
          message: held ? `Rate booked (${pos.id}) but held: this takes ${s.tradingName} over its treasury limit, so a treasury checker releases it before it can be submitted.`
            : `Rate booked: ${fmt(pos.amount, pos.currency)} at ${pos.customerRate.toFixed(4)}, locked for ${LOCK_HOURS} hours (${pos.id}).` };
      },
    };
    C['rate.release'] = {
      run(db, a, p, ctx) {
        const s = ownSme(db, a);
        const pos = posFor(db, p.positionId);
        need(pos.smeId === s.id, 'That booking belongs to another customer.');
        need(['Open', 'Held'].includes(pos.status) && pos.source === 'Booked', 'Only an unused rate booking can be released.');
        cancel(db, a, pos, txt(p.reason, 'Reason', { max: 120, required: false }) || 'Released before use', ctx.now);
        return { message: `Rate booking ${pos.id} released.` };
      },
    };

    /* The rate desk (base and card rates, maker-checker) is the Treasury
       Management Portal's: tmp-engine.js. */

    /* ---------- bank cover ------------------------------------------------------ */
    /* A bank cover deal is live when saved (spot or forward): the dealer has
       already dealt with the bank, and the book must show it at once.
       Settling a forward is what goes to a checker (tmp-engine). */
    C['cover.create'] = {
      cap: 'treasury.deal',
      run(db, a, p, ctx) {
        const cur = oneOf(p.currency, db.currencies.map(c => c.code), 'Currency');
        const side = oneOf(p.side, ['BUY', 'SELL'], 'Side');
        const type = oneOf(p.type || 'Spot', ['Spot', 'Forward'], 'Deal type');
        const amt = amount(p.amount, 'Amount');
        const rate = Number(p.rate);
        const ref = currencyOf(db, cur).refRate;
        need(isFinite(rate) && rate > 0, 'Enter the dealt rate.');
        need(Math.abs(rate - ref) / ref <= 0.03, `The dealt rate ${rate} is more than 3% from the reference ${ref}. Check the deal.`);
        const valueDate = date(p.valueDate || ctx.now.slice(0, 10), 'Value date');
        need(valueDate >= istDate(ctx.now), 'The value date cannot be in the past.');
        if (type === 'Forward') need(valueDate > istDate(ctx.now), 'A forward cover settles after today — choose a later value date, or book it as spot.');
        const known = (db.counterparties || []).filter(c => c.status !== 'Inactive');
        const counterparty = known.length ? oneOf(p.counterparty, known.map(c => c.name), 'Counterparty bank') : txt(p.counterparty, 'Counterparty bank', { max: 80 });
        const cp = known.find(c => c.name === counterparty);
        if (cp && cp.dealTypes) need(cp.dealTypes.includes(type), `${counterparty} is not set up for ${type.toLowerCase()} deals (${cp.dealTypes.join(', ')}).`);
        const id = 'COV-' + pad(seq(db, 'cov'), 4);
        const c = { id, currency: cur, side, type, amount: amt, rate: r4(rate), allocated: 0, counterparty,
          dealRef: txt(p.dealRef, 'Bank deal reference', { max: 40, required: false }), valueDate, status: 'Active',
          settled: 0, settlements: [], enteredAt: ctx.now, enteredBy: actorLabel(a), enteredByKey: actorKey(a) };
        arr(db, 'covers').unshift(c);
        audit(db, a, ctx.now, id, `${type} cover deal saved — ${side} ${fmt(amt, cur)} at ${r4(rate).toFixed(4)} with ${counterparty}, value ${valueDate}`);
        if (H.onCoverSaved) H.onCoverSaved(db, c, ctx.now);
        return { id, message: `${type} cover ${id} saved — ${fmt(amt, cur)} ready to allocate to positions.` };
      },
    };

    /* Allocate a source to positions. The source is an approved bank cover
       deal, or a customer position on the other side (an internal cross:
       one customer's purchase offsets another's sale, no bank involved). */
    C['cover.allocate'] = {
      cap: 'treasury.deal',
      run(db, a, p, ctx) {
        const srcId = String(p.source || '');
        const cover = /^COV-/.test(srcId) ? find(db.covers, srcId) : null;
        const cross = /^POS-/.test(srcId) ? find(db.positions, srcId) : null;
        need(cover || cross, 'Choose a cover deal or a position to allocate from.');
        let cur, wantSide, avail;
        if (cover) {
          need(cover.status === 'Active', `${cover.id} is ${cover.status.toLowerCase()} — only an approved cover deal can be allocated.`);
          cur = cover.currency; wantSide = cover.side === 'BUY' ? 'SELL' : 'BUY'; avail = round2(cover.amount - cover.allocated);
        } else {
          need(!['Cancelled', 'Held'].includes(cross.status) && positionStatus(cross, ctx.now) !== 'Expired', `${cross.id} is ${cross.status === 'Held' ? 'held for approval' : 'no longer live'}.`);
          cur = cross.currency; wantSide = cross.side === 'BUY' ? 'SELL' : 'BUY'; avail = uncovered(cross);
        }
        const rows = [];
        (Array.isArray(p.rows) ? p.rows : []).slice(0, 50).forEach(r => {
          const amt = Number(r && r.amount);
          if (!(amt > 0)) return;
          const pos = find(db.positions, r.positionId);
          need(pos, `Position ${r.positionId} was not found.`);
          need(!rows.some(x => x.pos === pos) && pos !== cross, `${pos.id} is listed twice.`);
          need(pos.currency === cur, `${pos.id} is in ${pos.currency}, not ${cur}.`);
          need(pos.side === wantSide, `${pos.id} is a ${pos.side === 'SELL' ? 'sale' : 'purchase'}; ${srcId} offsets ${wantSide === 'SELL' ? 'sales' : 'purchases'}.`);
          const st = positionStatus(pos, ctx.now);
          need(!['Cancelled', 'Expired', 'Held'].includes(st), `${pos.id} is ${st === 'Held' ? 'held for a treasury checker' : st.toLowerCase()} — refresh and try again.`);
          need(amt <= uncovered(pos) + 0.005, `${pos.id} has only ${fmt(uncovered(pos), cur)} uncovered — refresh and try again.`);
          rows.push({ pos, amt: round2(amt) });
        });
        need(rows.length, 'Tick at least one position to allocate to.');
        const total = round2(rows.reduce((t, r) => t + r.amt, 0));
        need(total <= avail + 0.005, `Allocating ${fmt(total, cur)} is more than the ${fmt(avail, cur)} left on ${srcId}.`);
        rows.forEach(({ pos, amt }) => {
          const x = { id: 'CA-' + pad(seq(db, 'cal'), 4), kind: cover ? 'bank' : 'cross', coverId: cover ? cover.id : null, crossId: cross ? cross.id : null,
            positionId: pos.id, amount: amt, rate: cover ? cover.rate : cross.refRate, at: ctx.now, by: actorLabel(a), byKey: actorKey(a), status: 'Active' };
          arr(db, 'coverAllocations').unshift(x);
          pos.covered = round2((pos.covered || 0) + amt);
          if (cross) cross.covered = round2((cross.covered || 0) + amt);
          audit(db, a, ctx.now, pos.id, `${cover ? 'Covered by ' + cover.id + ' at ' + cover.rate.toFixed(4) : 'Crossed internally against ' + cross.id} — ${fmt(amt, cur)} (${coverState(pos).toLowerCase()})`);
        });
        if (cover) cover.allocated = round2(cover.allocated + total);
        audit(db, a, ctx.now, srcId, `Allocated ${fmt(total, cur)} to ${rows.map(r => r.pos.id).join(', ')}${cover ? `; ${fmt(cover.amount - cover.allocated, cur)} left` : ''}`);
        return { message: `Allocated ${fmt(total, cur)} from ${srcId} to ${rows.length === 1 ? rows[0].pos.id : rows.length + ' positions'}.` };
      },
    };

    /* ---------- FX deal references ------------------------------------------------
       A rate negotiated with the desk. Issuing it opens the position at once,
       so the exposure is on the book before the request is raised.          */
    C['deal.issue'] = {
      cap: 'treasury.deal',
      run(db, a, p, ctx) {
        const s = smeOf(db, p.smeId);
        need(s && s.status === 'Approved', 'Choose an approved customer.');
        const dir = oneOf(p.dir, ['out', 'in'], 'Direction');
        const cur = oneOf(p.currency, db.currencies.map(c => c.code), 'Currency');
        need(((s.config || {}).currencies || []).includes(cur), `${cur} is not enabled for ${s.tradingName}.`);
        const amt = amount(p.amount, 'Amount');
        const rate = dealRate(db, cur, p.rate);
        const ref = currencyOf(db, cur).refRate;
        if (H.rateCheck) H.rateCheck(db, dir === 'out' ? 'REM' : 'INW', cur);
        const hours = Math.round(Number(p.validHours || 24));
        need(hours >= 1 && hours <= 72, 'Validity must be between 1 and 72 hours.');
        const pos = newPosition(db, a, s, { currency: cur, side: sideOf(dir), amount: amt, customerRate: rate, refRate: ref, margin: dealMargin(dir, rate, ref),
          source: 'Deal', channel: 'Treasury deal', ibrAtBooking: marketRate(db, cur, ctx.now) }, ctx.now);
        const dl = issueDeal(db, a, s, pos, hours, txt(p.note, 'Note', { max: 200, required: false }), ctx.now);
        const breach = holdIfOverLimit(db, a, pos, ctx.now);
        return { id: dl.id, positionId: pos.id, held: !!breach,
          message: breach ? `Deal ${dl.id} issued as ${pos.id}, but held — it takes ${s.tradingName} over its limit and goes to a treasury checker.`
                          : `Deal ${dl.id} issued and on the book as ${pos.id}.` };
      },
    };
    C['deal.withdraw'] = {
      cap: 'treasury.deal',
      run(db, a, p, ctx) {
        const dl = find(db.deals, p.id) || missing('Deal');
        need(dl.status === 'Issued', `Deal ${dl.id} is ${dl.status.toLowerCase()}.`);
        const why = txt(p.reason, 'Reason', { max: 200 });
        cancel(db, a, find(db.positions, dl.positionId), 'Deal withdrawn: ' + why, ctx.now);
        dl.status = 'Withdrawn';
        return { message: `Deal ${dl.id} withdrawn.` };
      },
    };

    /* ---------- what each user may see -----------------------------------------
       Treasury roles (and the administrator and master test user, read-only)
       see the whole book. The branch sees positions without cover detail,
       and the deals it may apply. A customer sees its own bookings: its rate,
       never the reference or the margin.                                     */
    const TKEYS = ['positions', 'covers', 'coverAllocations', 'deals', 'tmsEvents'];
    function scope(out, db, a, kind) {
      TKEYS.forEach(k => { out[k] = []; });
      if (kind === 'public' || !a) return;
      const pos = db.positions || [];
      if (kind === 'treasury') { TKEYS.forEach(k => { out[k] = E.clone(db[k] || []); }); return; }
      const base = p => ({ id: p.id, smeId: p.smeId, currency: p.currency, side: p.side, amount: p.amount, customerRate: p.customerRate,
        source: p.source, dealId: p.dealId, bookedAt: p.bookedAt, expiresAt: p.expiresAt, status: p.status, recordKind: p.recordKind,
        recordId: p.recordId, linkRef: p.linkRef, cancelReason: p.cancelReason, cancelledAmount: p.cancelledAmount, heldReason: p.heldReason || null,
        product: p.product, branchId: p.branchId, channel: p.channel });
      if (kind === 'ad2') {
        out.positions = pos.filter(isTrade).map(p => ({ ...base(p), refRate: p.refRate, margin: p.margin, coverState: coverState(p) }));
        out.deals = (db.deals || []).filter(d => ['Issued', 'Used'].includes(d.status)).map(d => ({ id: d.id, smeId: d.smeId, currency: d.currency,
          side: d.side, amount: d.amount, rate: d.rate, validUntil: d.validUntil, status: d.status, usedOn: d.usedOn || null, positionId: d.positionId }));
        return;
      }
      out.positions = pos.filter(p => p.smeId === a.smeId && p.source === 'Booked').map(base);
    }

    /* ---------- seed ------------------------------------------------------------
       The book behind the seeded payments and disposals, cover bought against
       most of it, one open booking on a saved draft, one issued deal, one
       expired lock and a rate revision waiting for the checker. Treasury
       timestamps are placed relative to the moment the demo is seeded, so
       "today", expiry and ageing read correctly whatever day it is opened. */
    const ANCHOR = Date.parse('2026-09-24T12:00:00Z');
    function seed(db, now) {
      const nowMs = new Date(now).getTime();
      const rel = t => t ? new Date(nowMs - (ANCHOR - Date.parse(String(t).length <= 19 ? t + 'Z' : t))).toISOString() : null;
      const ago = h => new Date(nowMs - h * 3600000).toISOString();
      TKEYS.forEach(k => { db[k] = []; });
      db.tmsFlags = {};
      db.currencies.forEach(c => { c.marketBase = c.marketBase || c.refRate; c.publishedAt = c.publishedAt || ago(20); });
      const trail = [];
      const ev = (type, p, at, extra) => trail.push({ type, p, at, extra });
      const mk = (rec, kind) => {
        const s = smeOf(db, rec.smeId); const r = rec.rate;
        const dir = kind === 'outward' ? 'out' : 'in';
        const deal = r.mode === 'deal';
        const bookedAt = rel(deal ? (rec.requestDate || rec.submittedAt) : (r.bookedAt || rec.requestDate || rec.submittedAt));
        const p = { id: 'POS-' + pad(seq(db, 'pos'), 4), smeId: s.id, currency: rec.currency, side: sideOf(dir), amount: rec.amount,
          customerRate: r4(r.customerRate), refRate: r4(r.refRate), margin: r.margin, source: deal ? 'Deal' : 'Booked', dealId: deal ? r.dealRef : null,
          bookedAt, expiresAt: deal ? bookedAt : addHours(bookedAt, LOCK_HOURS), status: 'Attached', recordKind: kind, recordId: rec.id,
          attachedAt: rel(rec.requestDate || rec.submittedAt), covered: 0, linkedAmount: 0, cancelledAmount: 0, linkRef: null, linkedAt: null,
          bookedBy: rec.createdBy ? 'SME User (' + rec.createdBy + ')' : 'SME User', bookedByKey: '', assisted: false };
        ev('position.opened', p, bookedAt); ev('position.attached', p, p.attachedAt);
        if (['Completed', 'Processed'].includes(rec.status)) {
          const at = rel((rec.wf.executed || rec.wf.processed).at);
          Object.assign(p, { status: 'Concluded', linkedAmount: p.amount, linkRef: rec.utr || rec.firc, linkedAt: at });
          ev('position.linked', p, at, { ref: p.linkRef });
        }
        if (rec.status === 'Rejected') {
          const at = rel(rec.wf.rejected.at);
          Object.assign(p, { status: 'Cancelled', cancelledAmount: p.amount, cancelReason: 'Request rejected: ' + rec.rejectReason, cancelledAt: at });
          ev('position.cancelled', p, at, { reason: p.cancelReason });
        }
        if (deal) db.deals.push({ id: r.dealRef, smeId: s.id, currency: rec.currency, side: p.side, amount: rec.amount, rate: p.customerRate, refRate: p.refRate,
          positionId: p.id, validUntil: addHours(bookedAt, 24), status: 'Used', usedOn: rec.id, usedAt: p.attachedAt, issuedAt: bookedAt,
          issuedBy: 'AD2 Treasury Dealer (Nikhil Bansal)', issuedByKey: 'AD2/DEALER' });
        rec.rate = { ...r, positionId: p.id };
        db.positions.push(p);
        return p;
      };
      const byRec = {};
      [...db.outward].reverse().forEach(o => { if (o.status !== 'Draft' && ['booked', 'deal'].includes(o.rate.mode)) byRec[o.id] = mk(o, 'outward'); });
      [...db.disposals].reverse().forEach(d => { if (d.rate && ['booked', 'deal'].includes(d.rate.mode) && (d.creditCurrency || 'INR') === 'INR') byRec[d.id] = mk(d, 'disposal'); });

      /* a booking on a saved draft, not yet submitted: exposure treasury now sees */
      const draft = db.outward.find(o => o.id === 'OR-5105');
      if (draft) {
        const s = smeOf(db, draft.smeId);
        const pr = priceFor(db, s, draft.currency, 'out', null, null);
        const at = ago(6);
        const p = { id: 'POS-' + pad(seq(db, 'pos'), 4), smeId: s.id, currency: draft.currency, side: 'SELL', amount: draft.amount, ...pr,
          source: 'Booked', dealId: null, bookedAt: at, expiresAt: addHours(at, LOCK_HOURS), status: 'Open', recordKind: null, recordId: null,
          attachedAt: null, covered: 0, linkedAmount: 0, cancelledAmount: 0, linkRef: null, linkedAt: null,
          bookedBy: 'SME User (Kavita Raghunathan)', bookedByKey: 'MERIDIANTEX/SMEUSER', assisted: false };
        db.positions.push(p); ev('position.opened', p, at);
        draft.rate = { mode: 'booked', positionId: p.id, refRate: pr.refRate, margin: pr.margin, customerRate: pr.customerRate,
          bookedAt: at, expiresAt: p.expiresAt, dealRef: null, bookedAmount: draft.amount };
      }
      /* a deal issued this morning for Arcadia, ready for the branch to apply */
      const arc = smeOf(db, 'SME-1002');
      if (arc) {
        const ref = currencyOf(db, 'USD').refRate, rate = r4(ref + 0.40), at = ago(3);
        const id = `FXD-${now.slice(0, 4)}-${pad(seq(db, 'fxd'), 5)}`;
        const p = { id: 'POS-' + pad(seq(db, 'pos'), 4), smeId: arc.id, currency: 'USD', side: 'SELL', amount: 60000, customerRate: rate, refRate: ref,
          margin: 40, source: 'Deal', dealId: id, bookedAt: at, expiresAt: addHours(at, 24), status: 'Open', recordKind: null, recordId: null, attachedAt: null,
          covered: 0, linkedAmount: 0, cancelledAmount: 0, linkRef: null, linkedAt: null, bookedBy: 'AD2 Treasury Dealer (Nikhil Bansal)', bookedByKey: 'AD2/DEALER', assisted: false };
        db.positions.push(p); ev('position.opened', p, at, { source: 'Deal' });
        db.deals.push({ id, smeId: arc.id, currency: 'USD', side: 'SELL', amount: 60000, rate, refRate: ref, positionId: p.id, validUntil: p.expiresAt,
          status: 'Issued', issuedAt: at, issuedBy: 'AD2 Treasury Dealer (Nikhil Bansal)', issuedByKey: 'AD2/DEALER', note: 'Agreed by phone with Devansh Mehta for the Q4 component order' });
      }
      /* a lock that ran out unused */
      const nil = smeOf(db, 'SME-1003');
      if (nil) {
        const at = ago(60), ref = currencyOf(db, 'USD').refRate;
        const p = { id: 'POS-' + pad(seq(db, 'pos'), 4), smeId: nil.id, currency: 'USD', side: 'BUY', amount: 25000, customerRate: r4(ref - 0.48), refRate: ref,
          margin: 48, source: 'Booked', dealId: null, bookedAt: at, expiresAt: addHours(at, LOCK_HOURS), status: 'Cancelled', recordKind: null, recordId: null,
          attachedAt: null, covered: 0, linkedAmount: 0, cancelledAmount: 25000, linkRef: null, linkedAt: null, cancelReason: `Lock expired — not used within ${LOCK_HOURS} hours`,
          cancelledAt: addHours(at, LOCK_HOURS), bookedBy: 'SME User (Suresh Palaniappan)', bookedByKey: 'NILGIRISPICE/SMEUSER', assisted: false };
        db.positions.push(p); ev('position.opened', p, at); ev('position.cancelled', p, p.cancelledAt, { reason: p.cancelReason });
      }

      /* bank cover, and what it was allocated to */
      const cov = (cur, side, amt, rate, bank, hoursAgo, status, allocs) => {
        const at = ago(hoursAgo);
        const n = seq(db, 'cov');
        const c = { id: 'COV-' + pad(n, 4), currency: cur, side, amount: amt, rate, allocated: 0, counterparty: bank,
          dealRef: bank.split(' ')[0].toUpperCase().slice(0, 4) + '-FX-' + (40210 + n * 7), valueDate: at.slice(0, 10), status,
          enteredAt: at, enteredBy: 'AD2 Treasury Dealer (Nikhil Bansal)', enteredByKey: 'AD2/DEALER',
          type: 'Spot', settled: 0, settlements: [] };
        db.covers.push(c);
        (allocs || []).forEach(([recId, part]) => {
          const p = byRec[recId]; if (!p) return;
          const x = part || p.amount;
          db.coverAllocations.push({ id: 'CA-' + pad(seq(db, 'cal'), 4), kind: 'bank', coverId: c.id, crossId: null, positionId: p.id, amount: x, rate,
            at: ago(hoursAgo - 1), by: c.enteredBy, byKey: c.enteredByKey, status: 'Active' });
          p.covered = round2(p.covered + x); c.allocated = round2(c.allocated + x);
        });
        return c;
      };
      cov('USD', 'BUY', 172300, 88.10, 'HDFC Bank', 400, 'Active', [['OR-5101'], ['OR-5108']]);
      cov('GBP', 'SELL', 184500, 112.46, 'Standard Chartered', 480, 'Active', [['DI-9001']]);
      cov('EUR', 'SELL', 120000, 95.68, 'Axis Bank', 330, 'Active', [['DI-9002']]);
      cov('AED', 'SELL', 180000, 24.12, 'Emirates NBD', 125, 'Active', [['DI-9000']]);
      cov('EUR', 'BUY', 50000, 95.62, 'ICICI Bank', 30, 'Active', [['OR-5103', 50000]]);
      cov('USD', 'BUY', 10000, 88.36, 'Kotak Mahindra Bank', 1, 'Active');
      db.covers.reverse(); db.coverAllocations.reverse();

      trail.sort((x, y) => String(x.at).localeCompare(String(y.at))).forEach(t => emit(db, t.at, t.type, t.p, t.extra));
      db.positions.sort((x, y) => String(y.bookedAt).localeCompare(String(x.bookedAt)));
    }

    return { priceFor, book, resolveRate, replaceRate, attach, link, release, sweep, scope, seed,
      newPosition, issueDeal, addLink, cancelResidual, unwind, cancel, remaining, isTrade,
      positionStatus, coverState, linkState, uncovered, live, netByCurrency, suggestions, marketRate, pnl, exceptions, istDate, pastCutoff };
  };
});
