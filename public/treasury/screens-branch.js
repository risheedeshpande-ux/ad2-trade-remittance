/* ==========================================================================
   Treasury Management Portal — sign in, and the branch workspace (B-01…B-10)
   A branch takes a rate, books the position (the exposure transfers to
   treasury), links the FX Plus bill back, and works its cut-off queue.
   ========================================================================== */
'use strict';

/* ---------- SYS-01 sign in ------------------------------------------------------ */
const PERSONA_ORDER = ['AD2 Treasury Dealer', 'AD2 Treasury Checker', 'AD2 Treasury Viewer', 'AD2 Branch Inputter', 'Agent Partner',
  'AD2 Regional Bulk', 'AD2 Finance', 'AD2 Administrator', MASTER_ROLE];
const PERSONA_NOTE = {
  'AD2 Treasury Dealer': 'Rate desk, positions, cover, liquidity', 'AD2 Treasury Checker': 'Approves what the dealer enters',
  'AD2 Treasury Viewer': 'Read-only treasury view', 'AD2 Branch Inputter': 'Quotes, books and links at the counter', 'Agent Partner': 'Quotes for its customers; the branch services it',
  'AD2 Regional Bulk': 'Requests bulk currency for its region', 'AD2 Finance': 'Card settlement reconciliation', 'AD2 Administrator': 'Users, masters, organisation, integrations',
  [MASTER_ROLE]: 'Oversees every workspace and opens any persona',
};
screen({ id: 'SYS-01', title: 'Sign in', render() {
  const people = (DB.logins || []).filter(l => PERSONA_ORDER.includes(l.role) && l.active !== false && l.demo)
    .sort((a, b) => PERSONA_ORDER.indexOf(a.role) - PERSONA_ORDER.indexOf(b.role));
  return `<div class=signin>
    <div class=brandmark><b>AD2 Treasury Management Portal</b><span>Part of the AD2 trade platform</span></div>
    <div class=cols>
      <div class=form>
        <h2 style="margin:0 0 12px;font-size:var(--t-base)">Sign in</h2>
        <div class="fgrid one">
          ${field('Domain ID', `<input type=text id=si-d value="AD2" autocomplete=organization>`, { for: 'si-d' })}
          ${field('Login ID', `<input type=text id=si-l autocomplete=username placeholder="DEALER">`, { for: 'si-l' })}
          ${field(API.mode === 'server' && API.passcodeRequired ? 'Demo passcode' : 'Password', `<input type=password id=si-p autocomplete=current-password placeholder="${API.mode === 'server' && !API.passcodeRequired ? 'demo' : ''}">`, { for: 'si-p', hint: API.mode === 'server' ? (API.passcodeRequired ? 'This deployment asks for its demo passcode.' : 'Demo accounts accept any password on this deployment.') : 'Local mode: no password needed.' })}
        </div>
        <div class=bar><button type=button class=btn data-act="sign-in">Sign in</button><span class=sp></span><a class=small href="../index.html">Platform home</a></div>
        <p class="hint">Trade users (SMEs, AD2 branch and operations) sign in to the <a href="../app.html">trade portal</a>. Both portals share one platform: a trade booking is a treasury position the moment it is made.</p>
      </div>
      <div>
        <div class=banner><span>&#9432;</span><div><b>Demo accounts</b>Choose a persona to sign in as. Each sees only what its role and branch scope allow.</div></div>
      </div>
    </div>
    <h2>Treasury personas</h2>
    <div class=personas>${people.map(l => `<button type=button class=persona data-act="persona" data-d="${esc(l.domainId)}" data-l="${esc(l.loginId)}">
      <b>${esc(l.name)}</b><span>${esc(l.role)}${l.branchScope ? ' · ' + esc(V.nodeName(DB, l.branchScope)) : ''}</span><span>${esc(l.domainId)} / ${esc(l.loginId)}</span><i>${esc(PERSONA_NOTE[l.role] || '')}</i></button>`).join('')}</div>
  </div>`;
}, after() { const l = $('#si-l'); if (l) l.focus(); } });
act('persona', async el => {
  const pass = API.mode === 'server' && API.passcodeRequired ? ($('#si-p').value || sessGet('ad2-passcode')) : 'demo';
  if (API.mode === 'server' && API.passcodeRequired && !pass) { $('#si-d').value = el.dataset.d; $('#si-l').value = el.dataset.l; $('#si-p').focus(); toast('Enter the demo passcode, then sign in.', 'warn'); return; }
  try { await signIn(el.dataset.d, el.dataset.l, pass); if (S.role === MASTER_ROLE) sessSet('ad2-master', MASTER); afterSignIn(); } catch (e) { showError(e); }
});
act('sign-in', async () => {
  try { await signIn($('#si-d').value, $('#si-l').value, $('#si-p').value || 'demo'); afterSignIn(); } catch (e) { showError(e); }
});
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.closest('.signin') && e.target.matches('input')) ACTS['sign-in'](); });

/* ---------- SYS-02 access restricted -------------------------------------------- */
screen({ id: 'SYS-02', title: 'Access restricted', render(q) {
  const trade = roleDef().portal && roleDef().portal !== 'TMP';
  return `<div class="state warn" style="text-align:left"><h3>${trade ? 'Your role works in the trade portal' : 'This screen is outside your role'}</h3>
    <p>${trade ? `${esc(S.role)} is a trade portal role. Treasury positions made from your work are visible to treasury here; you act on them in the trade portal.`
      : `${q.denied ? `<b>${esc(q.denied)}</b> is not part of your workspace. ` : ''}Access follows your role and branch scope. If you need it, ask your administrator.`}</p>
    <div class=bar>${trade ? `<a class=btn href="../app.html">Open the trade portal</a>` : gobtn('Go to my home', homeOf())}<button type=button class="btn sec" data-act="sign-out">Sign out</button></div></div>`;
} });

/* ---------- shared: the branch's view of its deals ------------------------------- */
const branchPositions = () => (DB.positions || []).filter(p => !V.tradeChannel(p) || p.channel === 'Treasury deal' && p.quoteId);
const bills = () => DB.fxpTxns || [];
const openResidual = p => p.status === 'Open' && TR.remaining(p) > 0.005;
const perCur = (list, f) => {                              /* per currency, never totalled across */
  const m = {}; list.forEach(x => { m[x.currency] = round2((m[x.currency] || 0) + f(x)); });
  return Object.entries(m).filter(([, v]) => Math.abs(v) > 0.005).map(([c, v]) => fcy(v, c)).join(' · ') || '—';
};

/* ---------- B-01 branch overview --------------------------------------------------- */
screen({ id: 'B-01', title: 'Branch overview',
  sub: () => { const s = (DB.integrations || []).find(i => i.id === 'FXP-SFTP'); return `${esc(myScopeName())} &nbsp;·&nbsp; Today ${dmy(todayIST())} &nbsp;·&nbsp; All products &nbsp;·&nbsp; Last FX Plus sync <b>${s ? ist(s.lastSuccess) : '—'}</b>`; },
  acts: () => gobtn('Take FX rate', 'B-02') + gobtn('Cut-off queue', 'B-06', null, 'sec'),
  render() {
    const now = NOW(), day = todayIST();
    const mine = branchPositions();
    const today = mine.filter(p => V.istDate(p.bookedAt) === day && posStatus(p) !== 'Cancelled');
    const open = mine.filter(openResidual);
    const awaiting = open.filter(p => (p.linkedAmount || 0) <= 0.005 && V.linkTrack(DB, p, now) !== 'Excluded');
    const partial = open.filter(p => (p.linkedAmount || 0) > 0.005);
    const soon = open.filter(p => p.cutoffAt && minsTo(now, p.cutoffAt) <= 90);
    const rems = (DB.reminders || []).map(r => ({ ...r, state: V.reminderState(DB, r, now) })).filter(r => r.state !== 'Closed');
    const esc2 = rems.filter(r => r.state === 'Escalated');
    const held = mine.filter(p => p.status === 'Held');
    const cut = V.cutoffOf(DB, 'REM', myBranch()) || '16:00';
    const items = [];
    esc2.forEach(r => items.push({ k: `Escalated — ${esc(r.positionId)}`, d: `${esc(r.reason)} · raised ${ago(r.raisedAt)}`, a: golink('Open reminders', 'B-09') }));
    soon.forEach(p => items.push({ k: `Complete ${esc(p.id)}`, d: `${fcy(TR.remaining(p), p.currency)} remaining to link — ${clock(p.cutoffAt)}`, a: golink('Knock-off', 'B-05', { pos: p.id }) }));
    partial.filter(p => !soon.includes(p)).forEach(p => items.push({ k: `Finish ${esc(p.id)}`, d: `${fcy(TR.remaining(p), p.currency)} of ${fcy(p.amount, p.currency)} still to link`, a: golink('Knock-off', 'B-05', { pos: p.id }) }));
    held.forEach(p => items.push({ k: `${esc(p.id)} held`, d: `Waiting for a treasury checker — ${esc(p.heldReason || 'customer limit')}`, a: `<a href="#" data-pos="${esc(p.id)}">View</a>` }));
    const rows = mine.filter(p => V.istDate(p.bookedAt) === day || openResidual(p)).sort((a, b) => String(b.bookedAt).localeCompare(String(a.bookedAt)));
    return `${strip([
      { v: today.length, l: 'Booked positions today', go: 'B-04' },
      { v: awaiting.length, l: 'Awaiting txn link', go: 'B-05' },
      { v: partial.length, l: 'Partially linked', go: 'B-05' },
      { v: soon.length, l: `Due before ${esc(cut)} · cut-off`, kind: soon.length ? 'alert' : '', go: 'B-06' },
      { v: rems.length, l: `Open reminders${esc2.length ? ` · ${esc2.length} escalated` : ''}`, kind: esc2.length ? 'alert' : '', go: 'B-09' },
    ])}
    ${soon.length ? banner('bad', `${plural(soon.length, 'position')} reach cut-off in under 90 minutes`, `Unlinked residual ${perCur(soon, p => TR.remaining(p))}. <a href="#/B-06">Open the cut-off queue</a>.`) : ''}
    ${actionsPanel('Your next actions', items.slice(0, 6))}
    ${table('b01', [
      { h: 'Position', v: p => posRef(p), csv: p => p.id, cls: 'ref' },
      { h: 'Product / CCY', v: p => esc(posLabel(p)) + `<span class=sm>${esc(p.customerName || '')}</span>`, csv: p => posLabel(p) },
      { h: 'Booked FCY', num: true, v: p => num(p.amount, p.currency) },
      { h: 'Rate', num: true, v: p => rate(p.customerRate) },
      { h: 'Txn link', v: p => st(V.linkTrack(DB, p, now)) },
      { h: 'Bank cover', v: p => st(V.coverTrack(p)) },
      { h: 'Cut-off', v: p => openResidual(p) && p.cutoffAt ? clock(p.cutoffAt) : '<span class=dim>—</span>', csv: p => p.cutoffAt || '' },
      { h: 'Action', v: p => openResidual(p) ? golink((p.linkedAmount || 0) > 0 ? 'Complete link' : 'Link transaction', 'B-05', { pos: p.id }) : `<a href="#" data-pos="${esc(p.id)}">View position</a>`, csv: false },
    ], rows, { name: 'Branch positions today', noun: 'position', empty: 'No positions today. <a href="#/B-02">Take an FX rate</a> to book one.' })}`;
  } });

/* ---------- B-02 / B-02a take an FX rate -------------------------------------------- */
const BQ = Object.assign({ product: 'REM', currency: 'USD', side: 'SELL', amount: '', channel: 'Branch', valueDate: '', ctype: 'walkin', customerName: '',
  customerId: '', smeId: '', customerRef: '', branchId: '', override: '', quoteId: null }, sessGet('tmp-bq') || {});
const saveBQ = () => sessSet('tmp-bq', BQ);
const quoteOf = id => (DB.quotes || []).find(q => q.id === id);
const isAgent = () => can('tmp.agent') && !can('tmp.branch');
function quoteForm(agentView) {
  const now = NOW();
  const prods = (DB.tmpProducts || []).filter(p => p.status !== 'Inactive' && p.code !== 'INW');
  const prod = prods.find(p => p.code === BQ.product) || prods[0];
  if (prod && !prod.sides.includes(BQ.side)) BQ.side = prod.sides[0];
  const row = V.deskRow(DB, BQ.product, BQ.currency);
  const branchIds = V.branches(DB).filter(b => { const s = myBranch(); return !s || V.descendants(DB, s).has(b.id); }).map(b => b.id);
  if (!BQ.branchId || !branchIds.includes(BQ.branchId)) BQ.branchId = branchIds.includes(myBranch()) ? myBranch() : branchIds[0] || '';
  const fixed = branchIds.length === 1;
  const smes = (DB.smes || []).filter(s => s.status === 'Approved');
  const corp = (DB.limits || []).filter(l => !l.smeId);
  const q = BQ.quoteId && quoteOf(BQ.quoteId);
  const indicative = V.quoteRate(DB, BQ.product, BQ.currency, BQ.side, now);
  const custField = BQ.ctype === 'trade'
    ? field('Trade customer', `<select id=bq-smeId data-change="bq-set"><option value="">Choose…</option>${options(smes.map(s => [s.id, `${s.tradingName} (${s.id})`]), BQ.smeId)}</select>`, { hint: 'An approved trade portal customer. The rate becomes an FX deal reference AD2 applies to its payment in the trade portal.' })
    : BQ.ctype === 'corporate'
      ? field('Corporate customer', `<select id=bq-customerId data-change="bq-set"><option value="">Choose…</option>${options(corp.map(l => [l.id, `${l.name} (${l.id})`]), BQ.customerId)}</select>`, { hint: 'Deals are checked against the customer’s treasury limit; a breach is held for a checker.' })
      : field('Customer name', `<input type=text id=bq-customerName data-change="bq-set" value="${esc(BQ.customerName)}" placeholder="Walk-in — name">`);
  return `<div class=row>
  <div class="form grow">
    <div class=fgrid>
      ${field('Product', `<select id=bq-product data-change="bq-set">${options(prods.map(p => [p.code, p.name]), BQ.product)}</select>`, { req: true })}
      ${field('Currency', `<select id=bq-currency data-change="bq-set">${options((DB.currencies || []).map(c => { const r = V.deskRow(DB, BQ.product, c.code); return [c.code, `${c.code}${r && r.status !== 'Published' ? ' — not published' : ''}`]; }), BQ.currency)}</select>`, { req: true })}
      ${field('Company side', `<select id=bq-side data-change="bq-set">${options((prod ? prod.sides : ['SELL']).map(s => [s, s === 'SELL' ? 'Sell FCY to customer' : 'Buy FCY from customer']), BQ.side)}</select>`, { req: true })}
      ${field('FCY amount', `<div class=amt><span class=ccy>${esc(BQ.currency)}</span><input type=text inputmode=decimal id=bq-amount data-change="bq-set" value="${esc(BQ.amount)}" placeholder="0.00"></div>`, { req: true })}
      ${agentView ? field('Origin channel', readRO('Agent — ' + (me().agentName || me().name || ''))) : field('Origin channel', `<select id=bq-channel data-change="bq-set">${options(['Branch', 'DIY — mobile', 'DIY — web', 'Partner'], BQ.channel)}</select>`, { req: true })}
      ${field('Value date', `<input type=date id=bq-valueDate data-change="bq-set" value="${esc(BQ.valueDate || todayIST())}" min="${todayIST()}">`)}
      ${field('Customer type', `<select id=bq-ctype data-change="bq-set">${options([['walkin', 'Walk-in / retail'], ['corporate', 'Corporate (treasury limit)'], ...(agentView ? [] : [['trade', 'Trade portal customer (FX deal)']])], BQ.ctype)}</select>`)}
      ${custField}
      ${field('Customer / deal reference', `<input type=text id=bq-customerRef data-change="bq-set" value="${esc(BQ.customerRef)}" placeholder="CUST-… / DEAL-…">`)}
      ${fixed ? field('Branch', readRO(node(BQ.branchId)), { hint: agentView ? 'Your servicing branch' : 'Fixed to your permitted branch' })
        : field('Branch', `<select id=bq-branchId data-change="bq-set">${options(branchIds.map(b => [b, node(b)]), BQ.branchId)}</select>`)}
      ${agentView ? '' : field('Rate override (optional)', `<input type=text inputmode=decimal id=bq-override data-change="bq-set" value="${esc(BQ.override)}" placeholder="${indicative.rate ? rate(indicative.rate) : ''}">`, { hint: 'Between the base and the card rate. An override always takes the stepped review.' })}
    </div>
    <div class=bar>${btn('Get rate', 'bq-quote')}${btn('Clear', 'bq-clear', null, 'sec')}<span class=sp></span>
      <span class=src>${row && row.status === 'Published' ? `Card rate ${BQ.side === 'SELL' ? 'ceiling' : 'floor'} today: <b>${rate(row.card)}</b>` : `<span class=v-bad>${esc(BQ.currency)} ${esc(prodName(BQ.product))} has no published card rate — treasury publishes it on the rate desk.</span>`}</span></div>
  </div>
  <div style="width:320px">${quotePanel(q, indicative, row)}</div></div>`;
}
function quotePanel(q, ind, row) {
  const now = NOW();
  if (!q || q.status === 'Booked') {
    return `<div class=form><h2 style="margin-top:0;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted)">Rate summary</h2>
      ${q && q.status === 'Booked' ? banner('', `${esc(q.id)} booked as ${esc(q.positionId)}`, q.dealId ? `<br>Deal reference <b>${esc(q.dealId)}</b> — AD2 applies it in the trade portal.` : '<br>Exposure transferred to treasury.') : ''}
      ${ind && !ind.error ? `<p class=muted style="margin:0 0 4px">Indicative</p><p style="margin:0"><span class=big>${rate(ind.rate)}</span></p><p class=hint style="margin-top:0">INR per 1 ${esc(BQ.currency)} · before override and limit checks</p>`
        : `<p class=v-bad>${esc((ind && ind.error) || 'No rate')}</p>`}
      <p class=hint>Get a rate to fix it for ${(V.productOf(DB, BQ.product) || {}).quoteMinutes || 10} minutes.</p></div>`;
  }
  const live = q.status === 'Live' && q.validUntil > now;
  return `<div class="form ratebox">
    <h2 style="margin-top:0;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted)">Rate summary · ${esc(q.id)}${q.version > 1 ? ` v${q.version}` : ''}</h2>
    <p style="margin:0 0 4px"><span class=big>${rate(q.rate)}</span>${q.previousRate ? `<span class="delta ${q.rate > q.previousRate ? 'up' : 'dn'}">${signed(q.rate - q.previousRate, x => x.toFixed(4))}</span>` : ''}</p>
    <p class=hint style="margin-top:0">INR per 1 ${esc(q.currency)}${q.override ? ' · override' : ''}${q.agentSpread ? ` · includes agent spread ${rate(q.agentSpread)}` : ''}</p>
    <table class=dt style="margin-top:12px;min-width:0">
      <tr><td class=dim>Indicative principal</td><td class=num>${inr(q.inrPrincipal)}</td></tr>
      <tr><td class=dim>Valid until</td><td class=num>${ist(q.validUntil)}</td></tr>
      <tr><td class=dim>Card rate ${q.side === 'SELL' ? 'ceiling' : 'floor'}</td><td class=num>${rate(q.card)}</td></tr>
      <tr><td class=dim>Within limit</td><td class=num>${q.limit && q.limit.breach ? st('Held') : q.smeId || q.customerId ? pill('Yes', 'ok') : '<span class=dim>n/a</span>'}</td></tr>
    </table>
    <p style="margin:12px 0 0">${live ? clock(q.validUntil, 'remaining') : `<span class="clock now"><b>00:00</b><span>expired — requote keeps every field</span></span>`}</p>
    ${q.limit && q.limit.breach ? `<p class="small v-warn">${esc(q.limit.reason)} — booking goes to a treasury checker.</p>` : ''}
    ${q.stepped.length ? `<p class="small v-warn">Stepped review: ${esc(q.stepped.join(', '))}</p>` : ''}
    <div class=bar>${live ? (q.stepped.length ? gobtn('Review and confirm', 'B-03', { q: q.id }) : btn('Confirm and book position', 'bq-book', { id: q.id })) : ''}</div>
    <div class=bar>${btn('Requote now', 'bq-requote', { id: q.id }, 'sec')}${q.stepped.length ? '' : gobtn('Stepped review', 'B-03', { q: q.id }, 'sec')}</div>
    <p class=hint>Confirming books the position and transfers the exposure to treasury. The FX Plus bill links back automatically on punch.</p></div>`;
}
const recentQuotes = () => (DB.quotes || []).filter(q => q.byKey === myKey()).slice(0, 6);
function recentPanel() {
  const list = recentQuotes();
  return list.length ? `<div class=recent>${table('bq-recent', [
    { h: 'Quote', v: q => q.status === 'Live' ? golink(esc(q.id), 'B-03', { q: q.id }) : esc(q.id), csv: q => q.id, cls: 'ref' },
    { h: 'Deal', v: q => `${esc(prodName(q.product))} ${side(q.side).toLowerCase()} ${fcy(q.amount, q.currency)}`, csv: q => `${q.product} ${q.side} ${q.amount} ${q.currency}` },
    { h: 'Rate', num: true, v: q => rate(q.rate) }, { h: 'Customer', v: q => esc(q.customerName || '—') },
    { h: 'Status', v: q => st(q.status === 'Live' && q.validUntil <= NOW() ? 'Expired' : q.status) },
    { h: 'Position', v: q => q.positionId ? posRef({ id: q.positionId }) : '<span class=dim>—</span>', csv: q => q.positionId || '' },
  ], list, { title: 'Your recent quotes', noun: 'quote', name: 'Recent quotes' })}</div>` : '';
}
screen({ id: 'B-02', title: 'Take an FX rate', when: () => !isAgent(),
  sub: () => `Single screen &nbsp;·&nbsp; quote valid ${(V.productOf(DB, BQ.product) || {}).quoteMinutes || 10} minutes &nbsp;·&nbsp; stepped review only for overrides, large amounts and first-time users`,
  render: () => `<div class=filters><span class="chip on">Quick quote</span>${BQ.quoteId ? golink('Stepped review', 'B-03', { q: BQ.quoteId }, 'chip') : ''}<span class=sp></span>
    <span class=src>Stepped review is required for margin overrides and amounts above ${inr((DB.settings || {}).steppedThresholdInr || 4000000)}</span></div>
    ${quoteForm(false)}${recentPanel()}` });
screen({ id: 'B-02a', title: 'Take an FX rate — agent view', when: () => isAgent() || isMaster(),
  sub: () => `${esc(me().agentName || 'Agent')} &nbsp;·&nbsp; serviced by ${esc(myScopeName())} &nbsp;·&nbsp; the agent spread is added to the branch rate`,
  render: () => `${banner('', 'You quote and book; the branch services the deal', ' Cancellation is requested through your servicing branch. The FX Plus bill is punched by the branch.')}${quoteForm(true)}${recentPanel()}` });
const BQ_LAYOUT = ['product', 'currency', 'side', 'ctype', 'branchId'];
act('bq-set', el => {
  ['product', 'currency', 'side', 'amount', 'channel', 'valueDate', 'ctype', 'customerName', 'customerId', 'smeId', 'customerRef', 'branchId', 'override'].forEach(k => {
    const x = $('#bq-' + k); if (x) BQ[k] = x.value;
  });
  if (BQ.ctype === 'trade') { BQ.product = 'REM'; BQ.side = 'SELL'; }
  saveBQ();
  if (BQ_LAYOUT.includes(String(el.id).replace('bq-', ''))) render({ keepScroll: true });
});
function bqPayload() {
  const amt = Number(String(BQ.amount).replace(/,/g, ''));
  if (!(amt > 0)) { toast('Enter the FCY amount.', 'bad'); const a = $('#bq-amount'); if (a) a.focus(); return null; }
  return { product: BQ.product, currency: BQ.currency, side: BQ.side, amount: amt, channel: isAgent() ? undefined : BQ.channel, valueDate: BQ.valueDate || undefined,
    customerName: BQ.ctype === 'walkin' ? BQ.customerName : undefined, customerId: BQ.ctype === 'corporate' ? BQ.customerId || undefined : undefined,
    smeId: BQ.ctype === 'trade' ? BQ.smeId || undefined : undefined, customerRef: BQ.customerRef, branchId: BQ.branchId,
    overrideRate: BQ.override ? Number(BQ.override) : undefined };
}
act('bq-quote', () => { ACTS['bq-set-silent'](); const p = bqPayload(); if (p) run('quote.get', p, { after: r => { BQ.quoteId = r.quote.id; saveBQ(); } }); });
act('bq-set-silent', () => { ['product', 'currency', 'side', 'amount', 'channel', 'valueDate', 'ctype', 'customerName', 'customerId', 'smeId', 'customerRef', 'branchId', 'override'].forEach(k => { const el = $('#bq-' + k); if (el) BQ[k] = el.value; }); saveBQ(); });
act('bq-requote', el => run('quote.requote', { id: el.dataset.id }, { after: r => { BQ.quoteId = r.quote.id; saveBQ(); if (route().sid === 'B-03') setTimeout(() => go('B-03', { q: r.quote.id }), 0); } }));
act('bq-clear', () => { Object.assign(BQ, { amount: '', customerName: '', customerId: '', smeId: '', customerRef: '', override: '', quoteId: null }); saveBQ(); render({ keepScroll: true }); });
act('bq-book', el => bookQuote(el.dataset.id, false));
function bookQuote(id, reviewed) {
  run('quote.book', { id, reviewed: true }, { after: r => {
    BQ.quoteId = id; saveBQ();
    setTimeout(() => { openPosition(r.positionId); }, 50);
  } });
}

/* ---------- B-03 review and confirm rate (stepped) ----------------------------------- */
screen({ id: 'B-03', title: 'Review and confirm rate',
  sub: q => { const x = quoteOf(q.q); return x ? `Stepped review &nbsp;·&nbsp; Quote <b>${esc(x.id)}</b> &nbsp;·&nbsp; ${esc((x.stepped || []).join(', ') || 'optional review')}` : 'Stepped review'; },
  render(q) {
    const x = quoteOf(q.q || BQ.quoteId);
    if (!x) return `<div class=state><h3>No quote to review</h3><p>Take a rate first.</p>${gobtn('Take FX rate', isAgent() ? 'B-02a' : 'B-02')}</div>`;
    const now = NOW(), live = x.status === 'Live' && x.validUntil > now;
    const booked = x.status === 'Booked';
    const step = booked ? 3 : 2;
    return `<div class=steps><div class=done><b>&#10003;</b>Deal details</div><div class="${step === 2 ? 'on' : 'done'}"><b>${step > 2 ? '&#10003;' : 2}</b>Review rate</div><div class="${step === 3 ? 'on' : ''}"><b>3</b>Confirm position</div></div>
    ${booked ? banner('', `${esc(x.id)} booked as ${esc(x.positionId)}`, `<br>${x.dealId ? `FX deal reference <b>${esc(x.dealId)}</b> issued to ${esc(x.customerName)} — AD2 applies it to the payment in the trade portal.` : 'The exposure is on the treasury book. The FX Plus bill links back automatically on punch.'} <a href="#" data-pos="${esc(x.positionId)}">Open position</a>`)
      : live ? banner('warn', `Quote expires in <span data-until="${esc(x.validUntil)}"><b>${clockText(x.validUntil)}</b></span>`, `<br>After ${ist(x.validUntil)} the rate refreshes in place. Entered details are preserved.`)
      : banner('bad', 'This quote has expired', '<br>Requote — every entered field is kept, and a changed rate is shown as a difference to accept again.')}
    ${x.limit && x.limit.breach ? banner('warn', 'This deal breaches the customer’s treasury limit', `<br>${esc(x.limit.reason)}. Booking holds the position for a treasury checker; nothing settles until it is released.`) : ''}
    <div class=tbl><table class=dt><thead><tr><th style="width:260px">Review item</th><th>Accepted details</th></tr></thead><tbody>
      <tr><td class=dim>Product and side</td><td>${esc(prodName(x.product))} — company ${x.side === 'SELL' ? 'sells' : 'buys'} ${esc(x.currency)}</td></tr>
      <tr><td class=dim>Amount and rate</td><td class=fig>${fcy(x.amount, x.currency)} at INR ${rate(x.rate)} per ${esc(x.currency)}${x.previousRate ? ` <span class="delta ${x.rate > x.previousRate ? 'up' : 'dn'}">(${signed(x.rate - x.previousRate, v => v.toFixed(4))} vs ${rate(x.previousRate)})</span>` : ''}</td></tr>
      <tr><td class=dim>Principal and value date</td><td class=fig>${inr(x.inrPrincipal)} &nbsp;/&nbsp; ${dmy(x.valueDate)}</td></tr>
      <tr><td class=dim>Rate band</td><td class=fig>Base ${rate(x.base)} · IBR ${rate(x.ibr)} · card ${rate(x.card)}${x.override ? ' · <b>override</b>' : ''}</td></tr>
      <tr><td class=dim>Branch and source</td><td>${esc(node(x.branchId))} — ${esc(x.channel)}${x.agentName ? ` (${esc(x.agentName)})` : ''}</td></tr>
      <tr><td class=dim>Customer</td><td>${esc(x.customerName || 'Walk-in')}${x.customerRef ? ` · ${esc(x.customerRef)}` : ''}</td></tr>
      <tr><td class=dim>Why this review</td><td>${esc((x.stepped || []).join(', ') || 'Chosen by the user')}</td></tr>
      <tr><td class=dim>After confirmation</td><td>${x.smeId ? `Book the position and issue an <b>FX deal reference</b> for ${esc(x.customerName)} (valid 24 hours) — applied in the trade portal` : 'Create the position and transfer the exposure to treasury'}</td></tr>
    </tbody></table></div>
    ${!booked && live && !readOnly() ? `<div class=form><label class=check style="display:flex;gap:8px;align-items:center;font-size:var(--t-base)"><input type=checkbox id=b03-ok style="width:16px;height:16px;accent-color:var(--brand)"> I have reviewed the rate, the amount and the customer details with the customer.</label></div>` : ''}
    <div class=bar>${!booked && live ? btn('Confirm and book position', 'b03-book', { id: x.id }) : ''}${!booked ? btn('Requote now', 'bq-requote', { id: x.id }, 'sec') : ''}${gobtn('Back to deal details', isAgent() ? 'B-02a' : 'B-02', null, 'sec')}</div>`;
  } });
act('b03-book', el => { const c = $('#b03-ok'); if (c && !c.checked) { toast('Tick the review confirmation first.', 'warn'); c.focus(); return; } bookQuote(el.dataset.id, true); });

/* ---------- B-04 my positions ---------------------------------------------------------- */
screen({ id: 'B-04', title: () => isAgent() ? 'My deals' : 'My positions',
  sub: () => `${esc(myScopeName())} &nbsp;·&nbsp; two independent tracks: the transaction link and the bank cover, never merged`,
  acts: () => gobtn('Take FX rate', isAgent() ? 'B-02a' : 'B-02'),
  render(q) {
    const now = NOW();
    const all = branchPositions().sort((a, b) => String(b.bookedAt).localeCompare(String(a.bookedAt)));
    const lc = p => V.lifecycle(DB, p, now);
    const tabs = ['All', 'Created', 'Cover allocated', 'Txn tagged', 'Held', 'Concluded', 'Cancelled'];
    const tab = tabs.includes(q.tab) ? q.tab : 'All';
    let rows = all.filter(p => tab === 'All' || lc(p) === tab);
    if (q.prod) rows = rows.filter(p => p.product === q.prod);
    if (q.cur) rows = rows.filter(p => p.currency === q.cur);
    const curs = [...new Set(all.map(p => p.currency))].sort();
    return `${statusTabs('tab', tabs.map(t => [t, t === 'All' ? all.length : all.filter(p => lc(p) === t).length]), tab)}
    <div class=filters>${chips('prod', [['', 'All products'], ...(DB.tmpProducts || []).filter(p => p.code !== 'INW').map(p => [p.code, p.name])], q.prod || '')}
      <span class=sp></span>${selectQ('cur', [['', 'All currencies'], ...curs], q.cur || '', 'Currency')}</div>
    ${table('b04', [
      { h: 'Position', v: p => posRef(p), csv: p => p.id, cls: 'ref' },
      { h: 'Product / CCY', v: p => esc(posLabel(p)), csv: p => posLabel(p) },
      { h: 'Customer', v: p => esc(p.customerName || '—') + (p.customerRef ? `<span class=sm>${esc(p.customerRef)}</span>` : ''), csv: p => `${p.customerName || ''} ${p.customerRef || ''}` },
      { h: 'Side', v: p => side(p.side) }, { h: 'Booked FCY', num: true, v: p => num(p.amount, p.currency) },
      { h: 'Rate', num: true, v: p => rate(p.customerRate) },
      { h: 'Remaining', num: true, v: p => openResidual(p) ? num(TR.remaining(p), p.currency) : '<span class=dim>—</span>', csv: p => TR.remaining(p) },
      { h: 'Txn link', v: p => st(V.linkTrack(DB, p, now)) }, { h: 'Bank cover', v: p => st(V.coverTrack(p)) },
      { h: 'Status', v: p => st(lc(p)) },
      { h: 'Cut-off', v: p => openResidual(p) && p.cutoffAt ? clock(p.cutoffAt) : `<span class=dim>${p.cutoffAt ? istClock(p.cutoffAt) : '—'}</span>`, csv: p => p.cutoffAt || '' },
      { h: 'Booked', v: p => `<span class=dim>${istDT(p.bookedAt)}</span>`, csv: p => p.bookedAt },
    ], rows, { name: 'Positions', noun: 'position', empty: 'No positions match these filters.' })}`;
  } });

/* ---------- B-05 transaction knock-off -------------------------------------------------- */
screen({ id: 'B-05', title: 'Transaction knock-off',
  sub: () => `Link FX Plus bills to positions &nbsp;·&nbsp; a bill carrying the position reference links itself on punch; the rest are matched here`,
  acts: q => q.pos ? btn('Punch FX Plus bill', 'punch', { id: q.pos }, 'sec') : '',
  render(q) {
    const now = NOW();
    const open = branchPositions().filter(p => openResidual(p) && V.linkTrack(DB, p, now) !== 'Excluded').sort((a, b) => String(a.cutoffAt).localeCompare(String(b.cutoffAt)));
    const pos = posFind(q.pos) || open[0];
    const unmatched = bills().filter(t => V.fxpAvail(t) > 0.005);
    const left = table('b05-pos', [
      { h: 'Position', v: p => `<a href="#/B-05?pos=${esc(p.id)}">${esc(p.id)}</a>`, csv: p => p.id, cls: 'ref' },
      { h: 'Product / CCY', v: p => esc(posLabel(p)) }, { h: 'Remaining', num: true, v: p => num(TR.remaining(p), p.currency) },
      { h: 'Cut-off', v: p => clock(p.cutoffAt) },
    ], open, { title: 'Positions to link', noun: 'position', row: p => pos && p.id === pos.id ? ' class=sel' : '', empty: 'Every position is linked.', name: 'Positions to link' });
    let main = `<div class=state><h3>Nothing to knock off</h3><p>All positions in your scope are fully linked.</p></div>`;
    if (pos) {
      const cands = bills().filter(t => V.eligible(pos, t));
      const rem = TR.remaining(pos);
      let alloc = rem;
      main = `<div class=recon id=ko-recon data-remaining="${rem}" data-cur="${esc(pos.currency)}">
          <div><span>${esc(pos.id)} remaining</span><b>${fcy(rem, pos.currency)}</b></div>
          <div><span>Selected</span><b id=ko-sel>${fcy(0, pos.currency)}</b></div>
          <div class=left><span>Left after knock-off</span><b id=ko-left>${fcy(rem, pos.currency)}</b></div><span class=sp></span>
          <div><span>Customer</span><b style="font-size:var(--t-base)">${esc(pos.customerName || '—')}</b></div></div>
        <div class="banner bad" id=ko-over hidden><span>&#9888;</span><div><b>Selection exceeds the remaining amount</b>Reduce an amount — a position can never be over-linked.</div></div>
        ${table('b05-bills', [
          { h: '', w: '32px', v: t => `<input type=checkbox data-ko="${esc(t.id)}" data-change="ko-recalc" aria-label="Select ${esc(t.id)}">`, csv: false },
          { h: 'FX Plus bill', v: t => esc(t.id) + (t.positionRef ? `<span class=sm>ref ${esc(t.positionRef)}</span>` : '<span class=sm>no position reference</span>'), csv: t => t.id, cls: 'ref' },
          { h: 'Received', v: t => `<span class=dim>${istDT(t.receivedAt)}</span>`, csv: t => t.receivedAt },
          { h: 'Bill rate', num: true, v: t => rate(t.rate) + (t.rate && Math.abs(t.rate - pos.customerRate) > 0.00005 ? `<span class=sm>${signed(t.rate - pos.customerRate, x => x.toFixed(4))} vs deal</span>` : '') },
          { h: 'Available', num: true, v: t => num(V.fxpAvail(t), t.currency) },
          { h: 'Link amount', num: true, v: t => { const a = Math.min(V.fxpAvail(t), Math.max(0, alloc)); alloc -= a; return `<input type=text inputmode=decimal data-koamt="${esc(t.id)}" data-input="ko-recalc" value="${a > 0 ? a : ''}" aria-label="Amount for ${esc(t.id)}">`; }, csv: false },
        ], cands, { title: `FX Plus bills matching ${esc(pos.id)} — ${esc(node(pos.branchId))} · ${esc(prodName(pos.product))} · ${esc(pos.currency)} · ${side(pos.side).toLowerCase()}`, noun: 'bill', name: 'Candidate bills',
          empty: `No FX Plus bill matches ${esc(pos.id)} yet. If the bill is keyed but not reflected, <button type=button class=lnk data-act="inform" data-id="${esc(pos.id)}">tell treasury it is delayed</button>.` })}
        <div class=bar>${btn('Confirm knock-off', 'ko-confirm', { id: pos.id })}${btn('Punch FX Plus bill', 'punch', { id: pos.id }, 'sec')}<span class=sp></span><span class=src>Every link is recorded on the position and the bill; nothing is overwritten.</span></div>`;
    }
    return `<div class=row><div style="width:420px">${left}</div><div class=grow>${main}</div></div>
      ${table('b05-unmatched', [
        { h: 'FX Plus bill', v: t => esc(t.id), csv: t => t.id, cls: 'ref' }, { h: 'Branch', v: t => esc(node(t.branchId)) },
        { h: 'Product / CCY', v: t => esc(prodName(t.product)) + ' / ' + esc(t.currency) }, { h: 'Side', v: t => side(t.side) },
        { h: 'Available', num: true, v: t => num(V.fxpAvail(t), t.currency) }, { h: 'Reference', v: t => esc(t.positionRef || t.customerRef || '—') },
        { h: 'Received', v: t => `<span class=dim>${ago(t.receivedAt)}</span>`, csv: t => t.receivedAt },
      ], unmatched, { title: 'FX Plus bills not fully linked', noun: 'bill', name: 'Unmatched FX Plus bills', empty: 'Every bill is linked.' })}`;
  },
  after() { if ($('#ko-recon')) ACTS['ko-recalc'](); } });
act('ko-recalc', () => {
  const box = $('#ko-recon'); if (!box) return;
  const cur = box.dataset.cur, rem = Number(box.dataset.remaining);
  let sel = 0;
  $$('[data-ko]').forEach(cb => { const a = $(`[data-koamt="${cb.dataset.ko}"]`); if (cb.checked) sel += Number(String(a && a.value || 0).replace(/,/g, '')) || 0; cb.closest('tr').classList.toggle('sel', cb.checked); });
  sel = round2(sel);
  $('#ko-sel').textContent = fcy(sel, cur); $('#ko-left').textContent = fcy(Math.max(0, rem - sel), cur);
  $('#ko-over').hidden = sel <= rem + 0.005;
  const b = $('[data-act="ko-confirm"]'); if (b) b.disabled = !(sel > 0) || sel > rem + 0.005;
});
act('ko-confirm', el => {
  const links = $$('[data-ko]').filter(c => c.checked).map(c => ({ fxpId: c.dataset.ko, amount: Number(String(($(`[data-koamt="${c.dataset.ko}"]`) || {}).value || 0).replace(/,/g, '')) }));
  if (!links.length) { toast('Select at least one FX Plus bill.', 'warn'); return; }
  run('knockoff.confirm', { positionId: el.dataset.id, links });
});
/* Simulated FX Plus: the counter punches the bill; it reflects back here. */
act('punch', el => {
  const p = posFind(el.dataset.id); if (!p) return;
  closeDrawer();
  cmdDlg({ title: `Punch FX Plus bill — ${esc(p.id)}`, ok: 'Punch bill', body: `<p class=small>FX Plus is the branch billing system. This simulates the counter punching the bill; it reflects back into the portal in seconds.</p>
    <div class=fgrid>${field('Bill amount', `<div class=amt><span class=ccy>${esc(p.currency)}</span><input type=text id=pb-amt value="${TR.remaining(p)}" data-required></div>`, { req: true })}
    ${field('Bill carries the position reference', `<select id=pb-ref><option value=yes>Yes — ${esc(p.id)} on the bill (links itself)</option><option value=no>No — leave it for knock-off</option></select>`)}
    ${field('Rate on the bill', `<input type=text id=pb-rate value="${rate(p.customerRate)}">`, { hint: 'A different rate shows as quote-to-bill drift (T-27).' })}</div>` },
  'fxp.punch', () => ({ positionId: p.id, amount: Number($('#pb-amt').value.replace(/,/g, '')), withRef: $('#pb-ref').value === 'yes', drift: round2((Number($('#pb-rate').value) || p.customerRate) - p.customerRate) }));
});

/* ---------- B-06 cut-off and cancellation queue ---------------------------------------- */
screen({ id: 'B-06', title: 'Cut-off and cancellation queue',
  sub: () => { const c = V.cutoffOf(DB, 'REM', myBranch()) || '16:00'; return `${esc(myScopeName())} &nbsp;·&nbsp; at cut-off (${esc(c)} IST for remittance${myBranch() && (V.node(DB, myBranch()) || {}).cutoff ? ', branch override' : ''}) open residuals are cancelled automatically and any cover returns to the treasury pool`; },
  render(q) {
    const now = NOW();
    const sc = myBranch() ? V.descendants(DB, myBranch()) : null;
    const all = V.cutoffQueue(DB, now, sc);
    const tabs = ['Open residual', 'Cancellation requested', 'Cancelled today'];
    const tab = tabs.includes(q.tab) ? q.tab : 'Open residual';
    const rows = all.filter(r => r.state === tab);
    const within = all.filter(r => r.state !== 'Cancelled today' && r.minutesLeft <= 60);
    return `${within.length ? banner('bad', `${plural(within.length, 'residual')} cancel within the hour`, `<br>${perCur(within, r => r.residual)} — link the bill, keep the deal past cut-off with a reason, or cancel it now.`) : ''}
    ${statusTabs('tab', tabs.map(t => [t, all.filter(r => r.state === t).length]), tab)}
    ${table('b06', [
      { h: 'Position', v: r => posRef({ id: r.id }), csv: r => r.id, cls: 'ref' },
      { h: 'Branch', v: r => esc(node(r.branchId)) },
      { h: tab === 'Cancelled today' ? 'Released' : 'Residual', num: true, v: r => fcy(r.residual, r.currency) },
      { h: tab === 'Cancelled today' ? 'Cancelled' : 'Cut-off', v: r => tab === 'Cancelled today' ? `<span class=dim>${esc(r.cancelReason || '')}</span>` : clock(r.cutoffAt) + (r.kept ? `<span class=sm>kept — ${esc(r.kept.reason)}</span>` : ''), csv: r => r.cutoffAt },
      { h: 'Reason', v: r => esc(r.cancelRequest ? `Requested: ${r.cancelRequest.reason}` : r.reason) },
      { h: 'Cover', v: r => st(r.cover) },
      { h: 'Action', cls: 'acts', v: r => tab === 'Cancelled today' ? '<span class=dim>—</span>' : [
        can('tmp.cancel') ? lnk('Cancel now', 'cancel-pos', { id: r.id }, 'danger') : '',
        can('tmp.cutoff') && !r.kept && r.recoverable ? lnk('Keep past cut-off', 'keep', { id: r.id }) : '',
        can('tmp.quote') && r.recoverable ? lnk('Requote residual', 'requote-residual', { id: r.id }) : '',
        can('tmp.link') ? golink('Link bill', 'B-05', { pos: r.id }) : '',
      ].filter(Boolean).join(' · '), csv: false },
    ], rows, { name: 'Cut-off queue', noun: 'position', empty: tab === 'Open residual' ? 'Nothing is waiting on cut-off.' : 'None.' })}`;
  } });
act('cancel-pos', el => {
  const p = posFind(el.dataset.id); closeDrawer();
  cmdDlg({ title: `Cancel ${esc(el.dataset.id)}`, ok: 'Cancel residual', okClass: 'danger', body: `${p ? `<div class=impact><b>Impact</b>${fcy(TR.remaining(p), p.currency)} residual released${p.coverState !== 'Uncovered' ? '; cover above the linked amount returns to the pool' : ''}. ${(p.linkedAmount || 0) > 0 ? `The ${fcy(p.linkedAmount, p.currency)} already linked stays concluded.` : 'Nothing was linked, so the position is cancelled.'}</div>` : ''}
    ${reasonBody('', 'Cancellation reason')}<label class=check style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:var(--t-small);color:var(--ink)"><input type=checkbox id=cx-dead style="width:auto"> The deal is dead (the customer withdrew)</label>` },
  'position.cancel', () => ({ id: el.dataset.id, reason: $('#dlg-reason').value, dead: $('#cx-dead').checked }));
});
act('keep', el => { closeDrawer(); cmdDlg({ title: `Keep ${esc(el.dataset.id)} past cut-off`, ok: 'Keep and notify treasury', body: reasonBody('The position stays open until 11:00 IST on the next working day. Treasury is notified.', 'Why it stays open') }, 'position.keep', () => ({ id: el.dataset.id, reason: $('#dlg-reason').value })); });
act('inform', el => { closeDrawer(); cmdDlg({ title: `Tell treasury about ${esc(el.dataset.id)}`, ok: 'Send', body: `${field('Message', `<textarea id=dlg-reason data-required>FX Plus bill keyed but not reflected yet</textarea>`, { req: true })}<label class=check style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:var(--t-small);color:var(--ink)"><input type=checkbox id=inf-delay checked style="width:auto"> The source transaction is delayed</label>` }, 'position.inform', () => ({ id: el.dataset.id, message: $('#dlg-reason').value, delayed: $('#inf-delay').checked })); });
act('req-cancel', el => { closeDrawer(); cmdDlg({ title: `Request cancellation of ${esc(el.dataset.id)}`, ok: 'Send to the branch', body: reasonBody('Agents cannot cancel. The servicing branch confirms the cancellation.', 'Reason') }, 'position.requestCancel', () => ({ id: el.dataset.id, reason: $('#dlg-reason').value })); });
act('remind', el => { closeDrawer(); cmdDlg({ title: `Remind the branch — ${esc(el.dataset.id)}`, ok: 'Send reminder', body: field('Reason', `<input type=text id=dlg-reason value="No FX Plus reference">`) }, 'reminder.raise', () => ({ positionId: el.dataset.id, reason: $('#dlg-reason').value })); });
act('requote-residual', el => {
  const p = posFind(el.dataset.id);
  if (!p || !p.quoteId) { toast('This position has no quote to requote from — take a new rate.', 'warn'); return; }
  run('quote.requote', { id: p.quoteId, amount: TR.remaining(p), residualOf: p.id }, { after: r => { BQ.quoteId = r.quote.id; saveBQ(); setTimeout(() => go('B-03', { q: r.quote.id }), 0); } });
});

/* ---------- B-07 branch balances ---------------------------------------------------------- */
screen({ id: 'B-07', title: 'Branch balances',
  sub: () => `${esc(myScopeName())} &nbsp;·&nbsp; currency stock and INR cash from FX Plus &nbsp;·&nbsp; aged stock (over 7 days) shown separately`,
  render() {
    const now = NOW();
    const inv = V.inventory(DB, now), cash = V.cash(DB, now);
    const curTotals = {};
    inv.forEach(i => { const c = curTotals[i.currency] = curTotals[i.currency] || { currency: i.currency, qty: 0, aged: 0 }; c.qty += i.qty; c.aged += i.aged; });
    return `${strip(Object.values(curTotals).slice(0, 5).map(c => ({ v: num(c.qty, c.currency) + `<span class=u>${esc(c.currency)}</span>`, l: `${esc(c.currency)} stock${c.aged > 0 ? ` · ${num(c.aged, c.currency)} aged` : ''}`, cls: 'cur' })))}
    ${table('b07-inv', [
      { h: 'Location', v: r => esc(node(r.locationId)) + `<span class=sm>${esc(r.type || '')}</span>`, csv: r => node(r.locationId) },
      { h: 'Currency', k: 'currency' }, { h: 'Stock (FCY)', num: true, v: r => num(r.qty, r.currency) }, { h: 'Aged > 7 days', num: true, v: r => r.aged ? `<span class=v-warn>${num(r.aged, r.currency)}</span>` : '0' },
      { h: 'Value at IBR (INR)', num: true, v: r => inrN(r.inr) }, { h: 'IBR', num: true, v: r => rate(r.rate) }, { h: 'Freshness', v: r => fresh(freshOf(r.asOf), r.asOf), csv: r => r.asOf },
    ], inv, { title: 'Currency inventory', name: 'Currency inventory', noun: 'holding' })}
    ${table('b07-cash', [
      { h: 'Location', v: r => esc(node(r.locationId)), csv: r => node(r.locationId) }, { h: 'INR cash', num: true, v: r => inrN(r.total) },
      { h: 'Fresh', num: true, v: r => inrN(r.fresh) }, { h: 'Aged > 7 days', num: true, v: r => r.aged ? `<span class=v-warn>${inrN(r.aged)}</span>` : '0.00' },
      { h: 'Last counted', v: r => `<span class=dim>${istDT(r.lastCounted)}</span>`, csv: r => r.lastCounted }, { h: 'Freshness', v: r => fresh(freshOf(r.asOf), r.asOf), csv: r => r.asOf },
    ], cash, { title: 'INR cash (grouped in lakh and crore)', name: 'INR cash', noun: 'location' })}`;
  } });

/* ---------- B-08 branch reports --------------------------------------------------------------- */
screen({ id: 'B-08', title: 'Branch reports',
  sub: () => `${esc(myScopeName())} &nbsp;·&nbsp; every table exports with the filters applied`,
  render(q) {
    const now = NOW(), day = q.day || todayIST();
    const pos = branchPositions().filter(p => V.istDate(p.bookedAt) === day || (p.cancelledAt && V.istDate(p.cancelledAt) === day));
    const links = []; pos.forEach(p => (p.links || []).forEach(l => links.push({ ...l, p })));
    const d = V.drift({ ...DB, positions: branchPositions() }, now, 'user');
    return `<div class=filters><span class=src>Business day</span><input type=date value="${esc(day)}" max="${todayIST()}" data-qsel="day" style="width:auto;padding:3px 6px"><span class=sp></span><span class=src>IST business day</span></div>
    ${table('b08-pos', [
      { h: 'Position', v: p => posRef(p), csv: p => p.id }, { h: 'Product / CCY', v: p => esc(posLabel(p)) }, { h: 'Customer', v: p => esc(p.customerName || '—') },
      { h: 'Side', v: p => side(p.side) }, { h: 'FCY', num: true, v: p => num(p.amount, p.currency) }, { h: 'Rate', num: true, v: p => rate(p.customerRate) },
      { h: 'INR', num: true, v: p => inrN(p.amount * p.customerRate) }, { h: 'Linked', num: true, v: p => num(p.linkedAmount || 0, p.currency) },
      { h: 'Released', num: true, v: p => num(p.cancelledAmount || 0, p.currency) }, { h: 'Status', v: p => st(V.lifecycle(DB, p, now)) }, { h: 'By', v: p => esc(p.bookedBy || '') },
    ], pos, { title: 'Deal register', name: 'Deal register ' + day, noun: 'deal' })}
    ${table('b08-links', [
      { h: 'Bill / reference', v: l => esc(l.ref) }, { h: 'Position', v: l => esc(l.p.id) }, { h: 'CCY', v: l => esc(l.p.currency) },
      { h: 'Amount', num: true, v: l => num(l.amount, l.p.currency) }, { h: 'Bill rate', num: true, v: l => rate(l.rate) }, { h: 'Linked', v: l => istDT(l.at) }, { h: 'By', v: l => esc(l.by || '') },
    ], links, { title: 'Transaction links', name: 'Transaction links ' + day, noun: 'link' })}
    ${table('b08-drift', [
      { h: 'User', v: r => esc(r.key) }, { h: 'Deals', num: true, v: r => r.n }, { h: 'Median to first bill', num: true, v: r => dur(r.median) },
      { h: 'Mean rate drift', num: true, v: r => rate(r.meanDrift) }, { h: 'INR impact', num: true, v: r => inrN(r.impact) }, { h: 'Signal', v: r => st(r.signal) },
    ], d.rows, { title: 'Quote-to-bill drift by user', name: 'Quote-to-bill drift', noun: 'user' })}`;
  } });

/* ---------- B-09 reminders ------------------------------------------------------------------ */
screen({ id: 'B-09', title: 'Reminders',
  sub: () => `${esc(myScopeName())} &nbsp;·&nbsp; raised ${(DB.settings || {}).reminderAfterMin || 30} minutes after booking with no bill &nbsp;·&nbsp; escalated to treasury after ${(DB.settings || {}).escalateAfterMin || 120} minutes`,
  acts: () => btn('Acknowledge selected', 'rem-ack'),
  render(q) {
    const now = NOW();
    const all = (DB.reminders || []).map(r => ({ ...r, state: V.reminderState(DB, r, now), pos: posFind(r.positionId) }));
    const tabs = ['Open', 'Escalated', 'Acknowledged', 'Closed'];
    const tab = tabs.includes(q.tab) ? q.tab : 'Open';
    const rows = all.filter(r => r.state === tab);
    return `${statusTabs('tab', tabs.map(t => [t, all.filter(r => r.state === t).length]), tab)}
    ${table('b09', [
      { h: '', w: '32px', v: r => r.state !== 'Closed' && !readOnly() ? `<input type=checkbox data-rem="${esc(r.id)}" aria-label="Select ${esc(r.id)}">` : '', csv: false },
      { h: 'Reminder', v: r => esc(r.id), cls: 'ref' }, { h: 'Position', v: r => posRef({ id: r.positionId }), csv: r => r.positionId },
      { h: 'Residual', num: true, v: r => r.pos ? fcy(TR.remaining(r.pos), r.pos.currency) : '—' },
      { h: 'Reason', v: r => esc(r.reason) }, { h: 'Raised', v: r => `${istClock(r.raisedAt)}<span class=sm>${ago(r.raisedAt)}</span>`, csv: r => r.raisedAt },
      { h: 'State', v: r => st(r.state) + (r.ackBy ? `<span class=sm>${esc(r.ackBy)}${r.note ? ' — ' + esc(r.note) : ''}</span>` : '') },
      { h: 'Cut-off', v: r => r.pos && openResidual(r.pos) ? clock(r.pos.cutoffAt) : '<span class=dim>—</span>', csv: false },
      { h: 'Action', v: r => r.pos && openResidual(r.pos) && can('tmp.link') ? golink('Link bill', 'B-05', { pos: r.positionId }) : '', csv: false },
    ], rows, { name: 'Reminders', noun: 'reminder', empty: 'No reminders here.' })}`;
  } });
act('rem-ack', () => {
  const ids = $$('[data-rem]').filter(c => c.checked).map(c => c.dataset.rem);
  if (!ids.length) { toast('Select at least one reminder.', 'warn'); return; }
  cmdDlg({ title: `Acknowledge ${plural(ids.length, 'reminder')}`, ok: 'Acknowledge', body: `<p class=small>Escalation pauses for two hours. The reminder closes when the position is linked or cancelled.</p>${field('Note (optional)', `<input type=text id=ra-note placeholder="e.g. customer paying at 15:00">`)}` },
    'reminder.ack', () => ({ ids, note: $('#ra-note').value }));
});

/* ---------- B-10 offline capture ------------------------------------------------------------ */
const OFFLINE_KEY = () => 'tmp-offline-' + myKey();
const offlineQueue = () => localGet(OFFLINE_KEY()) || [];
screen({ id: 'B-10', title: 'Offline capture',
  sub: () => `When the portal was unreachable, a rate committed to a customer is captured here within 24 hours &nbsp;·&nbsp; every entry is flagged for treasury review`,
  render() {
    const qd = offlineQueue();
    const prods = (DB.tmpProducts || []).filter(p => p.status !== 'Inactive' && p.code !== 'INW');
    const past = branchPositions().filter(p => p.offline);
    return `${banner('warn', 'Use only when the portal was down', '<br>Entries are queued on this device until you submit them. The committed time must be within the last 24 hours.')}
    <div class=form><div class=fgrid>
      ${field('Product', `<select id=of-product>${options(prods.map(p => [p.code, p.name]), 'CSH')}</select>`, { req: true })}
      ${field('Currency', `<select id=of-currency>${options((DB.currencies || []).map(c => c.code), 'USD')}</select>`, { req: true })}
      ${field('Company side', `<select id=of-side>${options([['SELL', 'Sell FCY to customer'], ['BUY', 'Buy FCY from customer']])}</select>`)}
      ${field('FCY amount', `<input type=text id=of-amount inputmode=decimal>`, { req: true })}
      ${field('Rate committed', `<input type=text id=of-rate inputmode=decimal>`, { req: true })}
      ${field('Time committed (IST)', `<input type=datetime-local id=of-at>`, { req: true })}
      ${field('Customer', `<input type=text id=of-customer placeholder="Walk-in — name">`)}
      ${field('Reason', `<select id=of-reason>${options(['Network outage', 'Portal error', 'Power failure'])}</select>`)}
    </div><div class=bar>${btn('Add to queue', 'of-add', null, 'sec')}<span class=sp></span>${btn(`Submit ${plural(qd.length, 'entry', 'entries')}`, 'of-submit')}</div></div>
    ${table('b10-q', [
      { h: '#', v: (e, i) => i + 1 }, { h: 'Deal', v: e => `${esc(prodName(e.product))} ${side(e.side).toLowerCase()} ${fcy(e.amount, e.currency)}` },
      { h: 'Rate', num: true, v: e => rate(e.rate) }, { h: 'Committed', v: e => istDT(e.committedAt) }, { h: 'Customer', v: e => esc(e.customerName || '—') },
      { h: 'Reason', v: e => esc(e.reason) }, { h: '', v: (e, i) => lnk('Remove', 'of-rm', { i }, 'danger'), csv: false },
    ], qd, { title: 'Queued on this device', noun: 'entry', name: 'Offline queue', empty: 'Nothing queued.' })}
    ${table('b10-past', [
      { h: 'Position', v: p => posRef(p), csv: p => p.id }, { h: 'Deal', v: p => esc(posLabel(p)) + ' ' + num(p.amount, p.currency) }, { h: 'Rate', num: true, v: p => rate(p.customerRate) },
      { h: 'Committed', v: p => istDT(p.offline.committedAt) }, { h: 'Submitted', v: p => istDT(p.offline.submittedAt) }, { h: 'Reason', v: p => esc(p.offline.reason) },
      { h: 'Status', v: p => st(V.lifecycle(DB, p, NOW())) },
    ], past, { title: 'Submitted offline captures', noun: 'capture', name: 'Offline captures' })}`;
  },
  after() { const a = $('#of-at'); if (a && !a.value) { const d = new Date(Date.now() + 330 * 60000 - 20 * 60000); a.value = d.toISOString().slice(0, 16); } } });
act('of-add', () => {
  const at = $('#of-at').value;
  const e = { product: $('#of-product').value, currency: $('#of-currency').value, side: $('#of-side').value, amount: Number($('#of-amount').value.replace(/,/g, '')),
    rate: Number($('#of-rate').value), committedAt: at ? new Date(Date.parse(at + ':00Z') - 330 * 60000).toISOString() : '', customerName: $('#of-customer').value, reason: $('#of-reason').value, branchId: myBranch() };
  if (!(e.amount > 0) || !(e.rate > 0) || !e.committedAt) { toast('Enter the amount, the rate committed and the time.', 'bad'); return; }
  localSet(OFFLINE_KEY(), [...offlineQueue(), e]);
  render({ keepScroll: true }); toast('Queued on this device.', 'ok');
});
act('of-rm', el => { const qd = offlineQueue(); qd.splice(Number(el.dataset.i), 1); localSet(OFFLINE_KEY(), qd); render({ keepScroll: true }); });
act('of-submit', () => {
  const entries = offlineQueue();
  if (!entries.length) { toast('Nothing queued.', 'warn'); return; }
  run('offline.submit', { entries }, { after: () => localSet(OFFLINE_KEY(), []) });
});
