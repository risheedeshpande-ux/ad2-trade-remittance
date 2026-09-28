/* ==========================================================================
   Master test user (TEST / MASTER)

   One sign-in to test the whole platform. The console lists every open item
   with its next step and who can take it, and opens the platform as that
   person in one click. While testing, a bar on every page shows who you are,
   what happens next on the item in front of you, and a button to become the
   person who does it. The master holds no authority itself: the server hands
   it the other user's own session, so each step is recorded against that
   user and four-eyes still applies.
   ========================================================================== */

const keyOf = l => l.domainId + '/' + l.loginId;
const roleOrder = id => roleDef(id)?.order || 99;
const shortRole = id => String(id || '').replace(/^AD2 /, '');

/* Everyone the master can open, customers first, then AD2 by role. */
function personas() {
  return DB.logins.filter(l => l.active !== false && l.role !== MASTER_ROLE)
    .sort((a, b) => roleOrder(a.role) - roleOrder(b.role) || (b.demo ? 1 : 0) - (a.demo ? 1 : 0)
      || a.domainId.localeCompare(b.domainId) || a.loginId.localeCompare(b.loginId));
}

/* Everyone who has already handled an item: none of them may take the next
   step. Stricter than the engine at some stages, so a suggestion is never
   refused. */
const touched = r => [r.createdByKey, ...Object.values(r.wf || {}).map(w => w && w.key)].filter(Boolean);

/* The next step on an item: who does it (a capability, or the business
   itself), and where they do it. Or { done } when nothing is left. */
function nextStep(kind, r) {
  if (!r) return null;
  const ad2 = (label, cap, dest, block) => ({ label, cap, dest, block: block || touched(r) });
  const cust = (label, dest, smeId) => ({ label, smeId: smeId || r.smeId, dest });
  const done = label => ({ done: true, label });
  switch (kind) {
    case 'outward': {
      const d = '#/ad2/outward/' + r.id, sd = '#/sme/outward/' + r.id;
      return ({
        'Draft':                  cust('Finish and submit the draft', sd),
        'Submitted':              ad2('Verify the payment', 'outward.verify', d),
        'Verified':               ad2('Authorise the payment', 'outward.approve', d),
        'Authorised':             ad2('Release the payment over SWIFT', 'outward.complete', d),
        'Clarification Required': cust('Answer AD2’s query', sd),
        'Completed':              done('Released' + (r.utr ? ' — UTR ' + r.utr : '')),
        'Rejected':               done('Rejected'),
      })[r.status] || null;
    }
    case 'disposal': {
      const d = '#/ad2/disposals/' + r.id, sd = '#/sme/disposals/' + r.id;
      return ({
        'Submitted':              ad2('Verify the disposal', 'inward.verifyDisposal', d),
        'Verified':               ad2('Authorise the disposal', 'inward.approveDisposal', d),
        'Authorised':             ad2('Credit the customer and issue the FIRC', 'inward.processDisposal', d),
        'Clarification Required': cust('Answer AD2’s query', sd),
        'Processed':              done('Credited — FIRC issued'),
        'Rejected':               done('Rejected'),
      })[r.status] || null;
    }
    case 'inward': {
      if (r.status === 'Intimated') return ad2('Confirm the credit against the nostro', 'inward.record', '#/ad2/inward/' + r.id, []);
      if (r.status === 'Not Received') return done('Declined — no matching credit');
      const open = DB.disposals.find(d => d.inwardId === r.id && Engine.OPEN.includes(d.status));
      if (open) { const st = nextStep('disposal', open); return st && { ...st, ref: open.id }; }
      if (r.available > 0) return cust('Dispose of the receipt', '#/sme/inward/' + r.id + '/dispose');
      return done('Fully disposed');
    }
    case 'application': {
      const d = '#/ad2/applications/' + r.id;
      return ({
        'Submitted':              ad2('Review and price the application', 'onboard.review', d, []),
        'Under Review':           ad2('Review and price the application', 'onboard.review', d, []),
        'Pending Approval':       ad2('Approve the customer', 'onboard.approve', d, [r.reviewedBy && r.reviewedBy.key].filter(Boolean)),
        'Clarification Required': cust('Answer the clarification', '#/sme/dashboard', r.id),
        'Approved':               done('Approved — the business can transact'),
        'Rejected':               done('Rejected'),
      })[r.status] || null;
    }
    case 'bill': {
      if (['Submitted', 'Resubmitted', 'Under Review'].includes(r.review))
        return ad2('Accept the bill', 'bills.accept', '#/ad2/bills?s=accept', [r.lodgedBy && r.lodgedBy.key].filter(Boolean));
      if (r.review === 'Query Raised') return cust('Answer the query on the bill', '#/sme/bills/' + String(r.type).toLowerCase());
      return done(r.outstanding > 0 ? 'Accepted — ' + money(r.outstanding, r.currency) + ' outstanding' : 'Settled');
    }
    case 'allocation': {
      if (r.status === 'Proposed')
        return ad2('Confirm the knock-off', 'recon.confirm', '#/ad2/reconciliation?s=Proposed', [r.proposedBy && r.proposedBy.key].filter(Boolean));
      return done(r.status === 'Confirmed' ? 'Confirmed — UFI portal updated' : r.status);
    }
  }
  return null;
}

/* Who may take a step. */
function eligible(step) {
  if (!step || step.done) return [];
  return personas().filter(l => {
    if (step.smeId) return l.smeId === step.smeId && l.role.startsWith('SME');
    const r = roleDef(l.role);
    return r && r.portal === 'AD2' && r.can.includes(step.cap) && !step.block.includes(keyOf(l));
  });
}

const FIND = {
  outward: id => outwardRec(id), disposal: id => disposalRec(id), inward: id => inwardRec(id),
  application: id => sme(id), bill: id => bill(id), allocation: id => (DB.allocations || []).find(l => l.id === id),
};
const KIND_LABEL = { outward:'Outward payment', disposal:'Inward disposal', inward:'Inward remittance',
                     application:'Application', bill:'Bill', allocation:'Knock-off' };

/* The item on screen, if the page is about one. */
function currentRecord() {
  if (!S || !DB) return null;
  const [area, page, a, b] = (location.hash || '').split('?')[0].replace(/^#\//, '').split('/');
  const pick = (kind, rec) => rec ? { kind, rec } : null;
  if (page === 'done') {
    if (a === 'outward')    return pick('outward', outwardRec(b));
    if (a === 'disposal')   return pick('disposal', disposalRec(b));
    if (a === 'intimation') return pick('inward', inwardRec(b));
    if (a === 'bill')       return pick('bill', bill(b));
    if (a === 'knockoff') {
      const ids = String(b || '').split(','), list = (DB.allocations || []).filter(l => ids.includes(l.id));
      return pick('allocation', list.find(l => l.status === 'Proposed') || list[0]);
    }
  }
  if (page === 'outward' && a && a !== 'new') return pick('outward', outwardRec(a));
  if (page === 'disposals' && a) return pick('disposal', disposalRec(a));
  if (page === 'inward' && a) return pick('inward', inwardRec(a));
  if (page === 'applications' && a) return pick('application', sme(a));
  if (area === 'sme' && page === 'dashboard' && S.role === 'SME Applicant') return pick('application', sme(S.smeId));
  return null;
}
/* The item being followed: the one on screen, else the last one opened. */
function focusRecord() {
  const cur = currentRecord();
  if (cur) {
    if (!MASTER.focus || MASTER.focus.kind !== cur.kind || MASTER.focus.id !== cur.rec.id) {
      MASTER.focus = { kind: cur.kind, id: cur.rec.id }; sessSet('ad2-master', MASTER);
    }
    return cur;
  }
  const f = MASTER.focus, rec = f && FIND[f.kind] && FIND[f.kind](f.id);
  return rec ? { kind: f.kind, rec } : null;
}

const goBtn = (l, dest, label, focus, cls) => `<button type="button" class="${cls || 'btn btn-primary btn-sm'}" data-act="mt-go"
    data-d="${esc(l.domainId)}" data-l="${esc(l.loginId)}" data-dest="${esc(dest || '')}"
    ${focus ? `data-kind="${esc(focus.kind)}" data-id="${esc(focus.id)}"` : ''}>${label}</button>`;

/* ---------- the bar shown on every page while testing -------------------- */
function masterBarHTML() {
  if (!MASTER || isMaster()) return '';
  let who = 'Registering a new business, as the public', next = '';
  if (S && DB) {
    const biz = S.smeId && sme(S.smeId);
    who = `Testing as <b>${esc(S.name || S.loginId)}</b> · ${esc(S.role)}${biz ? ' · ' + esc(biz.tradingName || biz.legalName) : ''}`;
    const cur = focusRecord();
    const st = cur && nextStep(cur.kind, cur.rec);
    if (st) {
      const ref = esc(st.ref || cur.rec.id);
      if (st.done) next = `<span class="mb-step mb-ok">✓ ${ref}: ${esc(st.label)}</span>`;
      else {
        const list = eligible(st), me = list.find(l => keyOf(l) === myKey());
        const here = (location.hash || '').split('?')[0] === st.dest.split('?')[0];
        if (me) next = here ? `<span class="mb-step">Next on ${ref}: <b>${esc(st.label)}</b> — you can do this here</span>`
          : `<span class="mb-step">Next on ${ref}: <b>${esc(st.label)}</b></span>
             <button type="button" class="mb-go" data-act="go" data-href="${esc(st.dest)}">Open it →</button>`;
        else if (list[0]) next = `<span class="mb-step">Next on ${ref}: <b>${esc(st.label)}</b></span>
          ${goBtn(list[0], st.dest, `Do it as ${esc(list[0].name || list[0].loginId)} (${esc(shortRole(list[0].role))}) →`, { kind: cur.kind, id: cur.rec.id }, 'mb-go')}`;
        else next = `<span class="mb-step">Next on ${ref}: <b>${esc(st.label)}</b> — no one left who has not handled it; add a user in Administration</span>`;
      }
    }
  }
  const groups = [['Businesses', l => l.role.startsWith('SME')], ['AD2 trade staff', l => l.domainId === 'AD2' && portalOf(l.role) !== 'TMP'],
    ['Treasury portal', l => portalOf(l.role) === 'TMP']];
  const opts = groups.map(([g, f]) => `<optgroup label="${g}">${personas().filter(f).map(l => `<option value="${esc(keyOf(l))}" ${S && keyOf(l) === myKey() ? 'selected' : ''}>
      ${esc(l.name || l.loginId)} — ${esc(l.role.startsWith('SME') ? (l.tradingName || l.domainId) : shortRole(l.role))}</option>`).join('')}</optgroup>`).join('');
  return `<div class="mbar" role="region" aria-label="Master test user">
    <span class="mb-tag">Master test</span>
    <span class="mb-who">${who}</span>
    ${next}
    <span class="mb-tools">
      ${S ? `<select data-act="mt-as" aria-label="Open the platform as another user"><option value="">Open as…</option>${opts}</select>` : ''}
      <button type="button" data-act="mt-console">Test console</button>
    </span>
  </div>`;
}

/* ---------- open the platform as someone --------------------------------- */
async function masterAs(d, l, dest, focus) {
  if (!MASTER) return;
  if (focus) { MASTER.focus = focus; sessSet('ad2-master', MASTER); }
  if (S && S.domainId === d && S.loginId === l) {
    if ((dest && dest.startsWith('treasury/')) || isTreasury()) { location.href = dest && dest.startsWith('treasury/') ? dest : TMP_HOME; return; }
    location.hash = dest || homeHash(); render({ keepScroll:false }); return;
  }
  if (IN_FLIGHT) return;
  IN_FLIGHT = true; document.body.classList.add('busy');
  try {
    closeModal();
    if (API.mode === 'local') {
      const next = clone(LOCAL);
      Engine.execute(next, { domainId: MASTER.domainId, loginId: MASTER.loginId }, 'test.actAs', { domainId: d, loginId: l }, { now: nowISO() });
      LOCAL = next; DB = LOCAL; localSet(LOCAL_KEY, LOCAL);
      const a = LOCAL.logins.find(x => x.domainId === d && x.loginId === l);
      setSession({ domainId: a.domainId, loginId: a.loginId, role: a.role, smeId: a.smeId || null, name: a.name, actingFor: null });
    } else {
      const token = API.tokens[MASTER.domainId + '/' + MASTER.loginId];
      const r = await http('/api/session', { method: 'POST', body: { as: { domainId: d, loginId: l } }, token });
      setSession({ ...r.user, actingFor: null, token: r.token });
      applyServer(r);
    }
    resetDrafts();
    /* treasury personas and treasury steps open the Treasury Management Portal */
    if ((dest && dest.startsWith('treasury/')) || isTreasury()) { location.href = dest && dest.startsWith('treasury/') ? dest : TMP_HOME; return; }
    location.hash = dest || homeHash();
    render({ keepScroll: false });
    toast('Now testing as ' + (S.name || S.loginId) + ' — ' + S.role + '.', 'ok');
  } catch (e) {
    showError(e);
  } finally {
    IN_FLIGHT = false; document.body.classList.remove('busy');
  }
}
function masterConsole() {
  if (!MASTER) return;
  if (isMaster()) { location.hash = '#/test'; render(); return; }
  switchTo(MASTER.domainId, MASTER.loginId, { dest: '#/test' });
}

/* ---------- the console --------------------------------------------------- */
function openItems() {
  const items = [];
  const add = (kind, rec) => { const step = nextStep(kind, rec); if (step && !step.done) items.push({ kind, rec, step }); };
  DB.smes.filter(s => ['Submitted', 'Under Review', 'Pending Approval', 'Clarification Required'].includes(s.status)).forEach(s => add('application', s));
  DB.outward.filter(o => ['Draft', 'Submitted', 'Verified', 'Authorised', 'Clarification Required'].includes(o.status)).forEach(o => add('outward', o));
  DB.disposals.filter(d => Engine.OPEN.includes(d.status)).forEach(d => add('disposal', d));
  DB.inward.filter(i => i.status === 'Intimated' || (i.available > 0 && !['Not Received'].includes(i.status)
    && !DB.disposals.some(d => d.inwardId === i.id && Engine.OPEN.includes(d.status)))).forEach(i => add('inward', i));
  DB.bills.filter(b => ['Submitted', 'Resubmitted', 'Under Review', 'Query Raised'].includes(b.review)).forEach(b => add('bill', b));
  (DB.allocations || []).filter(l => l.status === 'Proposed').forEach(l => add('allocation', l));
  /* the demo businesses first; businesses made in the test data lab after them */
  const lab = it => { const s = sme(it.kind === 'application' ? it.rec.id : it.rec.smeId); return s && s.test ? 1 : 0; };
  return items.map((it, i) => ({ it, i })).sort((a, b) => lab(a.it) - lab(b.it) || a.i - b.i).map(x => x.it);
}
let MT_ALL = {};           /* which console tables are showing every row */

const QUICK = [
  ['Pay a supplier against a bill', 'DIR: pick the bill, book the rate, review, submit — then verify, authorise and release.', 'MERIDIANTEX', 'SMEUSER', '#/sme/outward/new'],
  ['Pay an advance', 'AIR before the goods arrive; knock it off later against the Bill of Entry.', 'ARCADIACOMP', 'SMEUSER', '#/sme/outward/new'],
  ['Report a buyer’s payment', '“New inward remittance”, then Operations confirms the credit and the customer disposes of it.', 'NILGIRISPICE', 'SMEUSER', '#/sme/inward'],
  ['Dispose of a receipt', 'Purpose code, bills and account for money already credited; FIRC at the end.', 'MERIDIANTEX', 'SMEUSER', '#/sme/inward?s=receipts'],
  ['Lodge a bill', 'Lodge an export bill; the Checker or Operations accepts it.', 'NILGIRISPICE', 'SMEUSER', '#/sme/bills/export'],
  ['Knock off an advance', 'Match an advance to its bill; the Checker confirms and the UFI portal is updated.', 'ARCADIACOMP', 'SMEUSER', '#/sme/knockoff'],
  ['Register a business online', 'The public registration form, then pricing by the maker and approval by Compliance.', null, null, '#/register'],
  ['Onboard a business at the branch', 'AD2 Sales captures an offline application for a walk-in customer.', 'AD2', 'SALES', '#/ad2/applications?s=mine'],
  ['Transact for a customer', 'Sales opens a customer’s portal and books a payment on its behalf.', 'AD2', 'SALES', '#/ad2/directory'],
  ['Change the controls', 'Administrator: purpose codes, documents, users, settings and the audit log.', 'AD2', 'ADMIN', '#/ad2/admin/settings'],
];
/* Journeys in the Treasury Management Portal — the same platform: a trade
   booking above is already a position there. */
const QUICK_TMP = [
  ['Quote and book at the counter', 'Branch: take a rate, book it (the exposure goes to treasury), punch the FX Plus bill so it links back.', 'AD2', 'BRANCH', 'treasury/index.html#/B-02'],
  ['Quote a trade customer at the branch', 'The rate becomes an FX deal reference; AD2 applies it to the customer’s payment here.', 'AD2', 'BRANCH', 'treasury/index.html#/B-02'],
  ['Cover the book', 'Dealer: see trade bookings and branch deals by currency, enter bank cover, allocate it.', 'AD2', 'DEALER', 'treasury/index.html#/T-02'],
  ['Publish card rates', 'Dealer proposes base and card rates; a checker publishes them. No card rate, no trade booking.', 'AD2', 'DEALER', 'treasury/index.html#/T-24'],
  ['Issue an FX deal', 'Dealer issues a negotiated rate for a trade customer; AD2 applies it in the trade portal.', 'AD2', 'DEALER', 'treasury/index.html#/T-28'],
  ['Approve treasury entries', 'Checker: card rates, forward settlements, held deals, Nostro replacements — before and after.', 'AD2', 'TCHECKER', 'treasury/index.html#/T-21'],
  ['Work the cut-off queue', 'Branch: residuals cancel at cut-off unless linked, kept with a reason, or cancelled now.', 'AD2', 'BRANCH', 'treasury/index.html#/B-06'],
  ['Book as an agent', 'Agent partner quotes for its servicing branch, with its spread on top.', 'SUNDARFX', 'AGENT', 'treasury/index.html#/B-02a'],
];
/* What treasury has waiting: approvals (never for their maker), and branch
   deals still waiting on a bill before cut-off. */
function treasuryItems() {
  const out = [];
  const logins = DB.logins.filter(l => l.active !== false);
  const can2 = (l, cap) => { const r = roleDef(l.role); return r && r.can.includes(cap); };
  (DB.approvals || []).filter(a => a.status === 'Pending').forEach(a => {
    const who = logins.filter(l => can2(l, 'treasury.approve') && keyOf(l) !== a.makerKey);
    out.push({ ref: a.id, what: a.type + ' — ' + a.title, amount: a.amount != null ? (a.currency === 'INR' ? inr(a.amount) : money(a.amount, a.currency || '')) : '—',
      next: 'Approve or reject', who, dest: 'treasury/index.html#/T-21?id=' + a.id });
  });
  const now = nowISO();
  (DB.positions || []).filter(p => !p.smeId && p.status === 'Open' && p.cutoffAt && Engine.treasury.remaining(p) > 0.005).forEach(p => {
    const who = logins.filter(l => can2(l, 'tmp.link') && (!l.branchScope || l.branchScope === p.branchId));
    out.push({ ref: p.id, what: `${p.product} ${p.currency} at ${Engine.tmp.nodeName(DB, p.branchId)} — cut-off ${Engine.tmp.istClock(p.cutoffAt)} IST`, amount: money(Engine.treasury.remaining(p), p.currency),
      next: (p.linkedAmount || 0) > 0 ? 'Link the rest of the bill' : 'Link the FX Plus bill', who, dest: 'treasury/index.html#/B-05?pos=' + p.id });
  });
  return out;
}

function viewTestConsole() {
  const off = DB.settings.testLab === false;
  const items = openItems();
  const bizName = id => { const s = sme(id); return s ? esc(s.tradingName || s.legalName) : '—'; };
  const amount = (kind, r) => kind === 'application' ? '—' : money(r.amount, r.currency);
  const stage = (kind, r) => badge(kind === 'bill' ? r.review : r.status);
  const row = ({ kind, rec, step }) => {
    const who = eligible(step);
    const ref = step.ref ? ` <small style="color:var(--muted)">via ${esc(step.ref)}</small>` : '';
    return `<tr>
      <td><b>${esc(rec.id)}</b>${ref}<br><small style="color:var(--muted)">${esc(kind === 'bill' ? rec.type + ' bill' : KIND_LABEL[kind])}</small></td>
      <td>${bizName(kind === 'application' ? rec.id : rec.smeId)}</td>
      <td class="num">${amount(kind, rec)}</td>
      <td>${stage(kind, rec)}</td>
      <td>${esc(step.label)}</td>
      <td>${who[0] ? goBtn(who[0], step.dest, `As ${esc(who[0].name || who[0].loginId)}`, { kind, id: rec.id })
          + `<br><small style="color:var(--muted)">${esc(who[0].role)}${who.length > 1 ? ' · or ' + who.slice(1, 3).map(l => esc(l.name || l.loginId)).join(', ') : ''}</small>`
        : '<small style="color:var(--r4m-red)">No eligible user left</small>'}</td>
    </tr>`;
  };
  const LIMIT = 10;
  const table = (key, list, emptyMsg) => {
    if (!list.length) return `<div class="card-body"><p style="color:var(--muted);margin:0">${emptyMsg}</p></div>`;
    const all = MT_ALL[key] || list.length <= LIMIT;
    return `<div class="tablewrap"><table class="dt">
      <thead><tr><th>Item</th><th>Business</th><th class="num">Amount</th><th>Stage</th><th>Next step</th><th>Who does it</th></tr></thead>
      <tbody>${(all ? list : list.slice(0, LIMIT)).map(row).join('')}</tbody></table></div>
      ${list.length > LIMIT ? `<div class="card-body" style="padding-top:var(--s2)"><button type="button" class="btn btn-link" data-act="mt-all" data-k="${key}">
        ${all ? 'Show the first ' + LIMIT : 'Show all ' + list.length}</button></div>` : ''}`;
  };
  const withAd2 = items.filter(i => !i.step.smeId), withCust = items.filter(i => i.step.smeId);

  const quick = QUICK.map(([t, blurb, d, l, dest]) => {
    const who = d && DB.logins.find(x => x.domainId === d && x.loginId === l && x.active !== false);
    const btn = !d ? `<button type="button" class="btn btn-plain btn-sm" data-act="mt-register">Open the form</button>`
      : who ? goBtn(who, dest, `Start as ${esc(who.name)}`, null, 'btn btn-plain btn-sm') : '';
    return `<div class="mt-quick"><b>${esc(t)}</b><p>${esc(blurb)}</p>${btn}</div>`;
  }).join('');

  const quickTmp = QUICK_TMP.map(([t, blurb, d, l, dest]) => {
    const who = DB.logins.find(x => x.domainId === d && x.loginId === l && x.active !== false);
    return `<div class="mt-quick"><b>${esc(t)}</b><p>${esc(blurb)}</p>${who ? goBtn(who, dest, `Start as ${esc(who.name)}`, null, 'btn btn-plain btn-sm') : ''}</div>`;
  }).join('');
  const tItems = treasuryItems();
  const tRow = x => `<tr><td><b>${esc(x.ref)}</b></td><td>${esc(x.what)}</td><td class="num">${x.amount}</td><td>${esc(x.next)}</td>
    <td>${x.who[0] ? goBtn(x.who[0], x.dest, `As ${esc(x.who[0].name || x.who[0].loginId)}`) + `<br><small style="color:var(--muted)">${esc(x.who[0].role)}</small>` : '<small style="color:var(--r4m-red)">No eligible user left</small>'}</td></tr>`;
  const tAll = MT_ALL.tmp || tItems.length <= LIMIT;
  const tTable = tItems.length ? `<div class="tablewrap"><table class="dt"><thead><tr><th>Item</th><th>What</th><th class="num">Amount</th><th>Next step</th><th>Who does it</th></tr></thead>
    <tbody>${(tAll ? tItems : tItems.slice(0, LIMIT)).map(tRow).join('')}</tbody></table></div>
    ${tItems.length > LIMIT ? `<div class="card-body" style="padding-top:var(--s2)"><button type="button" class="btn btn-link" data-act="mt-all" data-k="tmp">${tAll ? 'Show the first ' + LIMIT : 'Show all ' + tItems.length}</button></div>` : ''}`
    : `<div class="card-body"><p style="color:var(--muted);margin:0">Nothing is waiting in treasury.</p></div>`;

  const people = personas();
  const groups = [['Customers', people.filter(l => l.role === 'SME User')], ['Applications in progress', people.filter(l => l.role === 'SME Applicant')],
    ...[...new Set(people.filter(l => !l.role.startsWith('SME')).map(l => l.role))].map(r => [portalOf(r) === 'TMP' ? r + ' — treasury portal' : r, people.filter(l => l.role === r)])];
  const card = l => `<div class="mt-person">
      <div><b>${esc(l.name || l.loginId)}</b>
        <span>${esc(l.role.startsWith('SME') ? (l.tradingName || l.domainId) : shortRole(l.role))}${l.test ? ' · test' : ''}${l.demo ? '' : ' · registered'}</span>
        <small>${esc(l.domainId)} / ${esc(l.loginId)}</small></div>
      ${goBtn(l, '', 'Open', null, 'btn btn-plain btn-sm')}</div>`;
  const peopleHTML = groups.filter(([, list]) => list.length).map(([g, list]) =>
    `<div class="mt-group"><h3 class="swh">${esc(g)}</h3><div class="mt-people">${list.map(card).join('')}</div></div>`).join('');

  const recent = [...(DB.audit || [])].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 8).map(a => `<tr><td style="white-space:nowrap">${dmyt(a.at)}</td><td>${esc(a.record)}</td>
      <td>${esc(a.actor)}</td><td>${esc(a.action)}</td></tr>`).join('');

  return shell(crumb('Test console'), `
    <div class="page-head"><div><h1>Test console</h1>
      <p>Open the platform as any customer or AD2 user in one click and run a journey end to end. Each step is taken as the person
        you open, so four-eyes still applies — the console always offers someone who has not handled the item yet.</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="reset-demo">Reset demo data</button></div></div>
    ${off ? `<div class="note note-warn" style="margin-bottom:var(--s5)"><span>Test tools are switched off in Administration → Settings, so the console
      cannot open other users. Sign in as <b>AD2 / ADMIN</b> to switch them back on.</span></div>` : ''}
    <div class="grid g3" style="margin-bottom:var(--s5)">
      ${kpi('Waiting on AD2', withAd2.length, { tone:'accent' })}
      ${kpi('Waiting on a customer', withCust.length)}
      ${kpi('People to test as', people.length)}
    </div>
    <div class="card" style="margin-bottom:var(--s5)"><div class="card-head"><h2>Start a journey</h2></div>
      <div class="card-body"><div class="mt-quicks">${quick}</div></div></div>
    <div class="card" style="margin-bottom:var(--s5)"><div class="card-head"><h2>Waiting on AD2 (${withAd2.length})</h2>
      <div class="acts"><small style="color:var(--muted)">Click to become the person who takes the next step</small></div></div>
      ${table('ad2', withAd2, 'Nothing is waiting on AD2. Start a journey above.')}</div>
    <div class="card" style="margin-bottom:var(--s5)"><div class="card-head"><h2>Waiting on a customer (${withCust.length})</h2></div>
      ${table('cust', withCust, 'Nothing is waiting on a customer.')}</div>
    <div class="card" style="margin-bottom:var(--s5)"><div class="card-head"><h2>Treasury Management Portal</h2>
      <div class="acts"><a class="btn btn-plain btn-sm" href="${TMP_HOME}">Open it as the master (read-only)</a></div></div>
      <div class="card-body"><p style="margin:0 0 12px;color:var(--muted)">The treasury portal runs on this same platform: every rate booked above is a position there, deals
        treasury issues are applied here, and UTRs and FIRCs conclude the positions and move the Nostro.</p><div class="mt-quicks">${quickTmp}</div></div>
      <div class="card-head" style="border-top:1px solid var(--line)"><h2>Waiting in treasury (${tItems.length})</h2></div>${tTable}</div>
    <div class="card" style="margin-bottom:var(--s5)"><div class="card-head"><h2>Open the platform as</h2></div>
      <div class="card-body">${peopleHTML}</div></div>
    <div class="card"><div class="card-head"><h2>Latest activity</h2>
      <div class="acts"><small style="color:var(--muted)">Every switch you make is recorded here too</small></div></div>
      <div class="tablewrap"><table class="dt"><thead><tr><th>When</th><th>Record</th><th>By</th><th>What</th></tr></thead>
      <tbody>${recent || '<tr><td colspan="4">No activity yet.</td></tr>'}</tbody></table></div></div>`);
}

/* ---------- handlers ------------------------------------------------------ */
document.addEventListener('click', e => {
  const t = e.target.closest && e.target.closest('[data-act^="mt-"]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'mt-go') {
    const focus = t.dataset.kind ? { kind: t.dataset.kind, id: t.dataset.id } : null;
    masterAs(t.dataset.d, t.dataset.l, t.dataset.dest || '', focus);
  }
  if (act === 'mt-console') masterConsole();
  if (act === 'mt-all') { MT_ALL[t.dataset.k] = !MT_ALL[t.dataset.k]; render({ keepScroll: true }); }
  if (act === 'mt-register') {
    /* the registration form is public: step out of any session, keep the master */
    setSession(null); resetDrafts(); DRAFT = null; MASTER.focus = null; sessSet('ad2-master', MASTER);
    location.hash = '#/register'; render({ keepScroll: false });
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (!t || t.dataset.act !== 'mt-as' || !t.value) return;
  const [d, l] = t.value.split('/');
  masterAs(d, l);
});
