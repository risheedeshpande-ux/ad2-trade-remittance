/* ==========================================================================
   Treasury Management Portal — the treasury workspace (T-01…T-28)
   One book: trade portal bookings and FX deals, branch and agent deals,
   covered by bank deals or crossed internally. Currencies are never added
   together; stale figures stay visible but leave the fresh subtotal; the
   dealer enters, a checker approves, and a checker never approves its own.
   ========================================================================== */
'use strict';

const CURS = () => (DB.currencies || []).map(c => c.code);
const cur$ = code => (DB.currencies || []).find(c => c.code === code) || {};
const tradePos = () => (DB.positions || []).filter(p => V.tradeChannel(p));
const sortByBooked = list => list.slice().sort((a, b) => String(b.bookedAt).localeCompare(String(a.bookedAt)));
const smeName = id => ((DB.smes || []).find(s => s.id === id) || {}).tradingName || id || '—';
/* an event names the SME for a trade booking, else the branch or agent customer on the position */
const evCustomer = e => e.smeId ? smeName(e.smeId) : (((DB.positions || []).find(p => p.id === e.positionId) || {}).customerName || '—');
const eventsNewest = () => [...(DB.tmsEvents || [])].sort((x, y) => String(y.at).localeCompare(String(x.at)));
const evWhen = at => at && V.istDate(at) === todayIST() ? istClock(at) : istDT(at);
const dir = (net, c) => Math.abs(net) < 0.005 ? '<span class=dim>Flat</span>' : `<span class="${net > 0 ? 'v-bad' : 'v-ok'}">${net > 0 ? 'Short' : 'Long'} ${num(Math.abs(net), c)}</span>`;
const pendingApprovals = () => (DB.approvals || []).filter(a => a.status === 'Pending');

/* ---------- T-01 / T-01V overview -------------------------------------------------- */
function overview(viewer) {
  const now = NOW(), day = todayIST();
  const book = V.book(DB, now);
  const apr = V.approvals(DB, now).filter(a => a.status === 'Pending');
  const breach = apr.filter(a => a.breach);
  const exc = V.exceptions(DB, now);
  const integ = V.integrations(DB, now);
  const staleFeeds = integ.filter(i => i.freshness === 'Stale' && i.status !== 'Not selected' || ['Delayed', 'Failed'].includes(i.status));
  const unpublished = (DB.rateDesk || []).filter(r => r.status !== 'Published');
  const trade = tradePos().filter(p => V.istDate(p.bookedAt) === day);
  const branchToday = (DB.positions || []).filter(p => !V.tradeChannel(p) && V.istDate(p.bookedAt) === day);
  const held = (DB.positions || []).filter(p => p.status === 'Held');
  const fwdDue = (DB.covers || []).filter(c => c.type === 'Forward' && c.status === 'Active' && c.valueDate <= day && (c.settled || 0) < c.amount - 0.005);
  const escal = (DB.reminders || []).filter(r => V.reminderState(DB, r, now) === 'Escalated');
  const items = [];
  if (!viewer) {
    if (can('treasury.approve') && apr.length) items.push({ k: `${plural(apr.length, 'approval')} waiting`, d: `${breach.length ? `<span class=v-bad>${breach.length} past the ${(DB.settings || {}).approvalSlaMin || 120}-minute SLA</span> · ` : ''}${[...new Set(apr.map(a => a.type))].slice(0, 3).map(esc).join(', ')}`, a: golink('Approvals', 'T-21') });
    book.filter(r => Math.abs(r.net) > 0.005).slice(0, 2).forEach(r => items.push({ k: `${esc(r.currency)} ${r.direction.toLowerCase()} ${num(Math.abs(r.net), r.currency)}`, d: `Uncovered across ${plural(r.branches.length, 'branch', 'branches')}${TR.pastCutoff(DB, now) ? ' — past cut-off' : ''}`, a: golink('Cover it', 'T-04', { cur: r.currency, side: r.net > 0 ? 'BUY' : 'SELL', amt: Math.abs(r.net) }) }));
    if (held.length) items.push({ k: `${plural(held.length, 'deal')} held on limits`, d: held.map(p => `${esc(p.id)} ${esc(p.customerName)}`).join(', '), a: golink('Review', 'T-21', { type: 'Held deal' }) });
    if (unpublished.length) items.push({ k: `${plural(unpublished.length, 'card rate')} not published`, d: unpublished.slice(0, 5).map(r => `${esc(r.product)} ${esc(r.currency)}`).join(', ') + (unpublished.length > 5 ? '…' : '') + ' — nothing can be quoted there', a: golink('Rate desk', 'T-24') });
    if (fwdDue.length) items.push({ k: `${plural(fwdDue.length, 'forward cover')} due or overdue`, d: fwdDue.map(c => `${esc(c.id)} ${esc(c.currency)} value ${dmy(c.valueDate)}`).join(', '), a: golink('Forwards', 'T-12') });
    if (staleFeeds.length) items.push({ k: `${plural(staleFeeds.length, 'feed')} delayed or stale`, d: staleFeeds.map(i => esc(i.name)).join(', '), a: golink('Data health', 'T-18') });
    if (escal.length) items.push({ k: `${plural(escal.length, 'reminder')} escalated`, d: 'Branches past the escalation window without a bill', a: golink('Exceptions', 'T-06') });
  }
  const nostro = (DB.nostro || []).filter(n => n.kind === 'Correspondent' && n.status === 'Current');
  const ho = (DB.bankAccounts || []).filter(b => b.currency === 'INR' && b.owner === 'HO');
  const ev = eventsNewest().slice(0, 10);
  const conc = (DB.positions || []).filter(p => p.status === 'Concluded' && p.linkedAt && V.istDate(p.linkedAt) === day).length;
  return `<div class=flow>
      <div class=st><span>Trade portal bookings today</span><b>${trade.length}</b><span>${trade.filter(p => p.status === 'Attached').length} attached to requests</span></div><div class=ar>&rarr;</div>
      <div class=st><span>Branch & agent deals today</span><b>${branchToday.length}</b><span>${branchToday.filter(p => p.status === 'Open').length} open for a bill</span></div><div class=ar>&rarr;</div>
      <div class=st><span>Open exposure</span><b>${book.filter(r => Math.abs(r.net) > 0.005).length}</b><span>currencies uncovered</span></div><div class=ar>&rarr;</div>
      <div class=st><span>Concluded today</span><b>${conc}</b><span>linked to UTR, FIRC or FX Plus bill</span></div></div>
    ${strip([
      ...book.slice(0, 3).map(r => ({ v: `${Math.abs(r.net) < 0.005 ? 'Flat' : (r.net > 0 ? 'Short ' : 'Long ') + num(Math.abs(r.net), r.currency)}`, l: `${esc(r.currency)} net uncovered`, kind: r.net > 0.005 ? 'alert' : '', go: 'T-02?cur=' + r.currency, cls: 'cur' })),
      { v: apr.length, l: `Approvals pending${breach.length ? ` · ${breach.length} past SLA` : ''}`, kind: breach.length ? 'alert' : '', go: 'T-21' },
      { v: exc.length, l: 'Open exceptions', go: 'T-06' },
    ])}
    ${viewer ? '' : actionsPanel('Your next actions', items)}
    ${table('t01-book', [
      { h: 'Currency', v: r => golink(`<b>${esc(r.currency)}</b>`, 'T-02', { cur: r.currency }), csv: r => r.currency },
      { h: 'Remittance', num: true, v: r => num(r.REM, r.currency) }, { h: 'Forex card', num: true, v: r => num(r.FXC, r.currency) },
      { h: 'Cash', num: true, v: r => num(r.CSH, r.currency) }, { h: 'Inward (bought)', num: true, v: r => num(r.INW, r.currency) },
      { h: 'Unallocated cover', num: true, v: r => r.unallocatedCover ? num(r.unallocatedCover, r.currency) : '—' },
      { h: 'Net', num: true, v: r => dir(r.net, r.currency), csv: r => r.net },
      { h: 'Largest branch', v: r => r.branches[0] ? `${esc(node(r.branches[0].branchId))} <span class=sm>${num(Math.abs(r.branches[0].amount), r.currency)} · oldest ${ago(r.branches[0].oldest)}</span>` : '—', csv: r => r.branches[0] ? node(r.branches[0].branchId) : '' },
    ], book, { title: 'Uncovered position by currency and product — never totalled across currencies', name: 'Treasury book', noun: 'currency', empty: 'The book is flat.' })}
    <div class=cols>
      ${panel('Liquidity — correspondent Nostro', table('t01-nostro', [
        { h: 'Currency', k: 'currency' }, { h: 'Bank', v: n => esc(n.issuer) }, { h: 'Balance', num: true, v: n => num(n.balance, n.currency) },
        { h: 'Statement', v: n => fresh(freshOf(n.statementAt, 60, 720), n.statementAt), csv: n => n.statementAt }], nostro, { cap: false, name: 'Nostro' })
        + `<div class=pad>${ho.map(b => `<span class=small>${esc(b.bank)} ${esc(b.mask)} available <b>${inr(b.available)}</b> ${fresh(freshOf(b.asOf), b.asOf)}</span>`).join('<br>')}</div>`, golink('Liquidity', 'T-08', null, 'small'))}
      ${panel('Latest position events — trade portal, branches and agents', table('t01-ev', [
        { h: 'When', v: e => `<span class=dim>${evWhen(e.at)}</span>`, csv: e => e.at }, { h: 'Event', v: e => esc(e.type.replace('position.', '')) },
        { h: 'Position', v: e => posRef({ id: e.positionId }), csv: e => e.positionId }, { h: 'Customer', v: e => esc(evCustomer(e)) },
        { h: 'Amount', num: true, v: e => fcy(e.amount, e.currency) }], ev, { cap: false, name: 'Trade events', empty: 'No events yet.' }), golink('Trade desk', 'T-28', null, 'small'))}
    </div>`;
}
screen({ id: 'T-01', title: 'Treasury overview', when: () => !roleDef().readOnly,
  sub: () => `All branches and the trade portal &nbsp;·&nbsp; Today ${dmy(todayIST())} &nbsp;·&nbsp; positions by currency, never totalled across currencies`,
  acts: () => gobtn('Rate desk', 'T-24') + gobtn('Approvals', 'T-21', null, 'sec'), render: () => overview(false) });
screen({ id: 'T-01V', title: 'Treasury overview — read-only', when: () => readOnly(),
  sub: () => `Viewer &nbsp;·&nbsp; the same book the dealer sees, without the controls`, render: () => overview(true) });

/* ---------- T-02 positions by currency and product ------------------------------------ */
screen({ id: 'T-02', title: 'Position by currency and product',
  sub: () => `Trade portal bookings, FX deals and branch deals in one book &nbsp;·&nbsp; the transaction link and the bank cover are separate tracks`,
  acts: () => gobtn('Enter cover deal', 'T-04') + gobtn('Allocate cover', 'T-05', null, 'sec'),
  render(q) {
    const now = NOW();
    const view = ['uncovered', 'booked', 'covered'].includes(q.view) ? q.view : 'uncovered';
    const book = V.book(DB, now, view);
    const sugg = TR.suggestions(DB, now).filter(s => !q.cur || s.currency === q.cur);
    const all = sortByBooked(DB.positions || []).filter(p => posStatus(p) !== 'Expired');
    const cs = p => p.status === 'Held' ? 'Held' : p.status === 'Cancelled' ? 'Cancelled' : TR.coverState(p);
    const tabs = [['All'], ['Uncovered'], ['Partial', 'Part covered'], ['Covered', 'Fully covered'], ['Held'], ['Cancelled']];
    const tab = tabs.some(t => t[0] === q.tab) ? q.tab : 'All';
    let rows = all.filter(p => tab === 'All' || cs(p) === tab);
    if (q.cur) rows = rows.filter(p => p.currency === q.cur);
    if (q.prod) rows = rows.filter(p => p.product === q.prod);
    if (q.ch === 'trade') rows = rows.filter(p => V.tradeChannel(p)); else if (q.ch === 'branch') rows = rows.filter(p => !V.tradeChannel(p));
    if (q.br) rows = rows.filter(p => p.branchId === q.br);
    const branchesUsed = [...new Set(all.map(p => p.branchId).filter(Boolean))];
    return `<div class=filters><div class=seg>${[['uncovered', 'Uncovered'], ['booked', 'Booked'], ['covered', 'Covered']].map(([k, l]) => `<button type=button class="${k === view ? 'on' : ''}" data-q=view data-v="${k}">${l}</button>`).join('')}</div>
      <span class=sp></span><span class=src>${view === 'uncovered' ? 'Net = sales − purchases − unallocated bank cover' : view === 'booked' ? 'Live amounts booked (cancelled residuals excluded)' : 'Amounts covered by bank deals or internal crosses'}</span></div>
    ${table('t02-book', [
      { h: 'Currency', v: r => `<button type=button class=lnk data-q=cur data-v="${esc(r.currency)}">${esc(r.currency)}</button>`, csv: r => r.currency },
      { h: 'Remittance', num: true, v: r => num(r.REM, r.currency) }, { h: 'Forex card', num: true, v: r => num(r.FXC, r.currency) }, { h: 'Cash', num: true, v: r => num(r.CSH, r.currency) },
      { h: 'Inward / purchases', num: true, v: r => num(r.buy, r.currency) }, { h: 'Sales', num: true, v: r => num(r.sell, r.currency) },
      { h: view === 'uncovered' ? 'Unallocated cover' : '', num: true, v: r => view === 'uncovered' && r.unallocatedCover ? num(r.unallocatedCover, r.currency) : '', csv: r => r.unallocatedCover || '' },
      { h: 'Net', num: true, v: r => view === 'uncovered' ? dir(r.net, r.currency) : num(r.net, r.currency), csv: r => r.net },
      { h: 'Branches', v: r => r.branches.slice(0, 3).map(b => `${esc(node(b.branchId))} ${num(Math.abs(b.amount), r.currency)}`).join('<span class=sm></span>') || '—', cls: 'wrap', csv: r => r.branches.map(b => node(b.branchId) + ' ' + b.amount).join('; ') },
    ], book, { title: 'By currency and product line', name: 'Book ' + view, noun: 'currency' })}
    ${sugg.length && !readOnly() ? `<div class=actions><h2>Suggestions · rule-based, never executed on their own</h2><ul>${sugg.map(s => `<li><span class=k>${esc(s.currency)} — ${esc(s.kind === 'cover' ? 'Bank cover' : s.kind === 'cross' ? 'Internal cross' : 'Allocate')}</span><span class=d>${esc(s.text)} <span class=sm>${esc(s.rule)}</span></span>
      ${s.kind === 'cover' ? golink('Enter cover', 'T-04', { cur: s.currency, side: s.side, amt: s.amount }) : golink('Review', 'T-05', { src: s.source })}</li>`).join('')}</ul></div>` : ''}
    ${statusTabs('tab', tabs.map(([k, l]) => [k, all.filter(p => k === 'All' || cs(p) === k).length]), tab).replace(/>Partial</, '>Part covered<').replace(/>Covered</, '>Fully covered<')}
    <div class=filters>${chips('ch', [['', 'All channels'], ['trade', 'Trade portal & deals'], ['branch', 'Branch & agent']], q.ch || '')}<span class=sp></span>
      ${selectQ('cur', [['', 'All currencies'], ...CURS()], q.cur || '', 'Currency')} ${selectQ('prod', [['', 'All products'], ...(DB.tmpProducts || []).map(p => [p.code, p.name])], q.prod || '', 'Product')}
      ${selectQ('br', [['', 'All branches'], ...branchesUsed.map(b => [b, node(b)])], q.br || '', 'Branch')}</div>
    ${table('t02-pos', [
      { h: 'Position', v: p => posRef(p), csv: p => p.id, cls: 'ref' },
      { h: 'Product / CCY', v: p => esc(posLabel(p)) + `<span class=sm>${esc(p.channel || '')}</span>`, csv: p => `${posLabel(p)} ${p.channel}` },
      { h: 'Customer', v: p => esc(p.customerName || smeName(p.smeId)) + `<span class=sm>${esc(node(p.branchId))}</span>`, csv: p => p.customerName },
      { h: 'Side', v: p => side(p.side) }, { h: 'Live FCY', num: true, v: p => num(TR.live(p), p.currency) },
      { h: 'Rate', num: true, v: p => rate(p.customerRate) + `<span class=sm>base ${rate(p.refRate)}</span>`, csv: p => p.customerRate },
      { h: 'Covered', num: true, v: p => num(p.covered || 0, p.currency) }, { h: 'Uncovered', num: true, v: p => num(TR.uncovered(p), p.currency) },
      { h: 'Txn link', v: p => st(V.linkTrack(DB, p, now)) }, { h: 'Cover', v: p => st(V.coverTrack(p)) },
      { h: '', cls: 'acts', v: p => TR.uncovered(p) > 0.005 && !['Held', 'Cancelled'].includes(p.status) && can('treasury.deal') ? golink('Allocate', 'T-05', { pos: p.id }) : '', csv: false },
    ], rows, { name: 'Positions', noun: 'position' })}`;
  } });

/* ---------- T-03 open position calculation ----------------------------------------------- */
screen({ id: 'T-03', title: 'Open position calculation',
  sub: q => `${esc(q.cur || 'USD')}${q.prod ? ' · ' + esc(prodName(q.prod)) : ' · all products'} &nbsp;·&nbsp; IST business day ${dmy(todayIST())} &nbsp;·&nbsp; opening + sales − cashout − covered = open`,
  render(q) {
    const cur = q.cur || 'USD';
    const c = V.openCalc(DB, NOW(), cur, q.prod || null);
    return `<div class=filters>${chips('cur', CURS().map(x => [x, x]), cur)}<span class=sp></span>${selectQ('prod', [['', 'All products'], ...(DB.tmpProducts || []).map(p => [p.code, p.name])], q.prod || '', 'Product')}</div>
    <div class=calc><div class=term><span>Opening (carried in)</span><b>${num(c.opening, cur)}</b></div><div class=op>+</div>
      <div class=term><span>Sales today</span><b>${num(c.sales, cur)}</b></div><div class=op>−</div>
      <div class=term><span>Cashout / purchases</span><b>${num(c.cashout, cur)}</b></div><div class=op>−</div>
      <div class=term><span>Covered today</span><b>${num(c.covered, cur)}</b></div><div class=op>=</div>
      <div class="term result"><span>Open ${esc(cur)} (${c.open > 0 ? 'short' : c.open < 0 ? 'long' : 'flat'})</span><b>${num(c.open, cur)}</b></div></div>
    ${table('t03', [
      { h: 'Term', v: l => esc(l.term) }, { h: 'Reference', v: l => /^POS-/.test(l.ref) ? posRef({ id: l.ref }) : esc(l.ref), csv: l => l.ref },
      { h: 'Bill / request', v: l => /^POS-/.test(l.bill) ? posRef({ id: l.bill }) : esc(l.bill), csv: l => l.bill }, { h: 'Class', v: l => esc(l.cls) },
      { h: 'When', v: l => `<span class=dim>${istClock(l.at)}</span>`, csv: l => l.at }, { h: `Amount (${esc(cur)})`, num: true, v: l => num(l.amount, cur) },
    ], c.lines, { title: 'Line breakup behind each term', name: `Open position ${cur}`, noun: 'line', empty: 'No movement today in this currency.' })}`;
  } });

/* ---------- T-04 bank cover deal entry ------------------------------------------------- */
const T04 = { counterparty: '', type: 'Spot', currency: 'USD', side: 'BUY', amount: '', rate: '', valueDate: '', dealRef: '' };
screen({ id: 'T-04', title: 'Bank cover deal entry',
  sub: () => `A cover deal is live when saved &nbsp;·&nbsp; spot cover settles cash at once; a forward settles on its value date through a checker`,
  render(q) {
    if (q.cur && q.cur !== T04._cur) { T04.currency = q.cur; T04.side = q.side || T04.side; T04.amount = q.amt || ''; T04._cur = q.cur; }
    const now = NOW();
    const cps = (DB.counterparties || []).filter(c => c.status !== 'Suspended');
    if (!cps.some(c => c.name === T04.counterparty)) T04.counterparty = (cps[0] || {}).name || '';
    const cp = cps.find(c => c.name === T04.counterparty) || { dealTypes: ['Spot'] };
    if (!cp.dealTypes.includes(T04.type)) T04.type = cp.dealTypes[0];
    const net = (TR.netByCurrency(DB, now)[T04.currency] || { net: 0, buy: 0, sell: 0 });
    const c = cur$(T04.currency), mid = TR.marketRate(DB, T04.currency, now);
    const recent = (DB.covers || []).slice(0, 12);
    return `<div class=row><div class="form grow"><div class=fgrid>
      ${field('Counterparty bank', `<select id=cv-counterparty data-change="cv-set">${options(cps.map(x => x.name), T04.counterparty)}</select>`, { req: true, hint: `Deal types: ${esc(cp.dealTypes.join(', '))}` })}
      ${field('Deal type', `<select id=cv-type data-change="cv-set">${options(cp.dealTypes.filter(t => t !== 'Swap'), T04.type)}</select>`, { req: true })}
      ${field('Currency', `<select id=cv-currency data-change="cv-set">${options(CURS(), T04.currency)}</select>`, { req: true })}
      ${field('Company side with the bank', `<select id=cv-side data-change="cv-set">${options([['BUY', 'Buy FCY from the bank (covers sales)'], ['SELL', 'Sell FCY to the bank (covers purchases)']], T04.side)}</select>`, { req: true })}
      ${field('Amount', `<div class=amt><span class=ccy>${esc(T04.currency)}</span><input type=text id=cv-amount data-change="cv-set" value="${esc(T04.amount)}" inputmode=decimal></div>`, { req: true })}
      ${field('Dealt rate', `<input type=text id=cv-rate data-change="cv-set" value="${esc(T04.rate)}" inputmode=decimal placeholder="${rate(mid)}">`, { req: true, hint: `Within 3% of the base ${rate(c.refRate)}` })}
      ${field('Value date', `<input type=date id=cv-valueDate data-change="cv-set" value="${esc(T04.valueDate || todayIST())}" min="${todayIST()}">`, { req: true })}
      ${field('Bank deal reference', `<input type=text id=cv-dealRef data-change="cv-set" value="${esc(T04.dealRef)}" placeholder="e.g. HDFC-FX-40251">`)}
    </div><div class=bar>${btn('Save deal', 'cv-save')}${btn('Save and allocate', 'cv-save', { alloc: 1 }, 'sec')}</div></div>
    <div style="width:320px"><div class=form><h2 style="margin-top:0;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted)">${esc(T04.currency)} position</h2>
      ${kv([['Customer sales', num(net.sell || 0, T04.currency)], ['Customer purchases', num(net.buy || 0, T04.currency)], ['Unallocated cover', num((net.coverBuy || 0) - (net.coverSell || 0), T04.currency)],
            ['Net', dir(-(net.net || 0), T04.currency)], ['Base rate', rate(c.refRate)], ['IBR now', rate(mid)]])}
      ${Math.abs(net.net || 0) > 0.005 ? `<p class=hint>${net.net < 0 ? 'Buy' : 'Sell'} ${fcy(Math.abs(net.net), T04.currency)} to flatten ${esc(T04.currency)}.</p>` : '<p class=hint>Flat — nothing to cover.</p>'}</div></div></div>
    ${table('t04', [
      { h: 'Cover', v: c => esc(c.id) + `<span class=sm>${esc(c.dealRef || '')}</span>`, csv: c => c.id, cls: 'ref' }, { h: 'Type', v: c => esc(c.type || 'Spot') },
      { h: 'Bank', v: c => esc(c.counterparty) }, { h: 'Side', v: c => side(c.side) }, { h: 'Amount', num: true, v: c => fcy(c.amount, c.currency) },
      { h: 'Rate', num: true, v: c => rate(c.rate) }, { h: 'Value', v: c => dmy(c.valueDate), csv: c => c.valueDate },
      { h: 'Allocated', num: true, v: c => num(c.allocated || 0, c.currency) }, { h: 'Unallocated', num: true, v: c => num(c.amount - (c.allocated || 0), c.currency) },
      { h: 'Status', v: c => st(c.status) }, { h: 'Entered', v: c => `<span class=dim>${istDT(c.enteredAt)}</span><span class=sm>${esc(c.enteredBy || '')}</span>`, csv: c => c.enteredAt },
      { h: '', cls: 'acts', csv: false, v: c => c.status === 'Active' ? [c.amount - (c.allocated || 0) > 0.005 && can('treasury.deal') ? golink('Allocate', 'T-05', { src: c.id }) : '',
        (c.allocated || 0) <= 0.005 && !(c.settled > 0) && can('treasury.deal') ? lnk('Cancel', 'cv-cancel', { id: c.id }, 'danger') : ''].filter(Boolean).join(' · ') : '' },
    ], recent, { title: 'Recent cover deals', name: 'Cover deals', noun: 'deal' })}`;
  } });
act('cv-set', el => {
  ['counterparty', 'type', 'currency', 'side', 'amount', 'rate', 'valueDate', 'dealRef'].forEach(k => { const e = $('#cv-' + k); if (e) T04[k] = e.value; });
  if (['cv-counterparty', 'cv-type', 'cv-currency', 'cv-side'].includes(el.id)) render({ keepScroll: true });
});
act('cv-save', el => {
  ['counterparty', 'type', 'currency', 'side', 'amount', 'rate', 'valueDate', 'dealRef'].forEach(k => { const e = $('#cv-' + k); if (e) T04[k] = e.value; });
  const p = { ...T04, amount: Number(String(T04.amount).replace(/,/g, '')), rate: Number(T04.rate) };
  delete p._cur;
  run('cover.create', p, { after: r => { Object.assign(T04, { amount: '', rate: '', dealRef: '' }); if (el.dataset.alloc) setTimeout(() => go('T-05', { src: r.id }), 0); } });
});
act('cv-cancel', el => cmdDlg({ title: `Cancel ${esc(el.dataset.id)}`, ok: 'Cancel cover deal', okClass: 'danger', body: reasonBody('A spot deal’s cash movement is reversed. Only an unallocated, unsettled deal can be cancelled.') }, 'cover.cancel', () => ({ id: el.dataset.id, reason: $('#dlg-reason').value })));

/* ---------- T-05 allocate bank cover --------------------------------------------------- */
screen({ id: 'T-05', title: 'Allocate bank cover',
  sub: () => `A source — a bank cover deal, or a customer position on the other side (an internal cross) — is allocated to positions &nbsp;·&nbsp; a position is never covered beyond its live amount`,
  render(q) {
    const now = NOW();
    const covers = (DB.covers || []).filter(c => c.status === 'Active' && c.amount - (c.allocated || 0) > 0.005);
    const target = q.pos && posFind(q.pos);
    let srcId = q.src;
    if (!srcId && target) { const c = covers.find(c => c.currency === target.currency && (c.side === 'BUY' ? 'SELL' : 'BUY') === target.side); srcId = c ? c.id : ''; }
    if (!srcId && covers[0]) srcId = covers[0].id;
    const cover = covers.find(c => c.id === srcId) || (DB.covers || []).find(c => c.id === srcId);
    const cross = /^POS-/.test(srcId || '') ? posFind(srcId) : null;
    const src = cover || cross;
    const crossSources = (DB.positions || []).filter(p => TR.uncovered(p) > 0.005 && !['Cancelled', 'Held'].includes(p.status) && posStatus(p) !== 'Expired' && p.side === 'BUY');
    let body = `<div class=state><h3>No source selected</h3><p>Enter a cover deal first, or choose a customer purchase to cross.</p>${gobtn('Enter cover deal', 'T-04')}</div>`;
    if (src) {
      const curr = src.currency, want = src.side === 'BUY' ? 'SELL' : 'BUY';
      const avail = cover ? round2(cover.amount - (cover.allocated || 0)) : TR.uncovered(cross);
      const cands = sortByBooked((DB.positions || []).filter(p => p.currency === curr && p.side === want && p !== cross && TR.uncovered(p) > 0.005
        && !['Cancelled', 'Held'].includes(p.status) && posStatus(p) !== 'Expired')).sort((a, b) => (b.id === q.pos) - (a.id === q.pos));
      let left = avail;
      body = `<div class=recon id=al-recon data-avail="${avail}" data-cur="${esc(curr)}">
        <div><span>${esc(src.id)} available</span><b>${fcy(avail, curr)}</b></div><div><span>Selected</span><b id=al-sel>${fcy(0, curr)}</b></div>
        <div class=left><span>Left on the source</span><b id=al-left>${fcy(avail, curr)}</b></div><span class=sp></span>
        <div><span>${cover ? `${esc(cover.type || 'Spot')} · ${esc(cover.counterparty)}` : 'Internal cross'}</span><b style="font-size:var(--t-base)">${cover ? `${side(cover.side)} at ${rate(cover.rate)}` : `${esc(cross.customerName)} buys at base ${rate(cross.refRate)}`}</b></div></div>
        <div class="banner bad" id=al-over hidden><span>&#9888;</span><div><b>More than the source holds</b>Reduce an amount.</div></div>
        ${table('t05', [
          { h: '', w: '32px', v: p => `<input type=checkbox data-al="${esc(p.id)}" data-change="al-recalc"${p.id === q.pos ? ' checked' : ''} aria-label="Select ${esc(p.id)}">`, csv: false },
          { h: 'Position', v: p => posRef(p), csv: p => p.id, cls: 'ref' }, { h: 'Product / channel', v: p => esc(posLabel(p)) + `<span class=sm>${esc(p.channel)}</span>` },
          { h: 'Customer', v: p => esc(p.customerName || '—') + `<span class=sm>${esc(node(p.branchId))}</span>` },
          { h: 'Base', num: true, v: p => rate(p.refRate) }, { h: 'Uncovered', num: true, v: p => num(TR.uncovered(p), curr) },
          { h: 'Allocate', num: true, csv: false, v: p => { const a = Math.min(TR.uncovered(p), Math.max(0, left)); left -= a; return `<input type=text inputmode=decimal data-alamt="${esc(p.id)}" data-input="al-recalc" value="${a > 0 ? a : ''}">`; } },
          { h: 'Txn link', v: p => st(V.linkTrack(DB, p, now)) },
        ], cands, { title: `${want === 'SELL' ? 'Customer sales' : 'Customer purchases'} in ${esc(curr)} this source offsets`, noun: 'position', name: 'Allocation candidates', empty: `No uncovered ${want === 'SELL' ? 'sales' : 'purchases'} in ${esc(curr)}.` })}
        <div class=bar>${btn('Confirm allocations', 'al-confirm', { src: src.id })}<span class=sp></span><span class=src>Allocations are recorded against both sides; releasing a position returns its cover to the pool.</span></div>`;
    }
    const recent = (DB.coverAllocations || []).filter(x => x.status === 'Active').slice(0, 15);
    return `<div class=filters><span class=src>Source</span><select data-qsel=src style="width:auto;padding:3px 6px">
        <optgroup label="Bank cover with an unallocated balance">${covers.map(c => opt(c.id, `${c.id} · ${c.type || 'Spot'} ${c.side} ${fcy(c.amount - (c.allocated || 0), c.currency)} · ${c.counterparty}`, srcId)).join('')}</optgroup>
        <optgroup label="Internal cross — a customer purchase">${crossSources.map(p => opt(p.id, `${p.id} · buy ${fcy(TR.uncovered(p), p.currency)} · ${p.customerName}`, srcId)).join('')}</optgroup></select>
      <span class=sp></span>${gobtn('Enter cover deal', 'T-04', null, 'sec')}</div>
    ${body}
    ${table('t05-recent', [
      { h: 'Allocation', v: x => esc(x.id) }, { h: 'Source', v: x => esc(x.coverId || x.crossId) + `<span class=sm>${x.kind === 'cross' ? 'internal cross' : 'bank cover'}</span>` },
      { h: 'Position', v: x => posRef({ id: x.positionId }), csv: x => x.positionId }, { h: 'Amount', num: true, v: x => num(x.amount, (posFind(x.positionId) || {}).currency) },
      { h: 'Rate', num: true, v: x => rate(x.rate) }, { h: 'When', v: x => `<span class=dim>${istDT(x.at)}</span>`, csv: x => x.at }, { h: 'By', v: x => esc(x.by || '') },
    ], recent, { title: 'Recent allocations', noun: 'allocation', name: 'Allocations' })}`;
  },
  after() { if ($('#al-recon')) ACTS['al-recalc'](); } });
act('al-recalc', () => {
  const box = $('#al-recon'); if (!box) return;
  const avail = Number(box.dataset.avail), cur = box.dataset.cur;
  let sel = 0;
  $$('[data-al]').forEach(cb => { const i = $(`[data-alamt="${cb.dataset.al}"]`); if (cb.checked) sel += Number(String(i && i.value || 0).replace(/,/g, '')) || 0; cb.closest('tr').classList.toggle('sel', cb.checked); });
  sel = round2(sel);
  $('#al-sel').textContent = fcy(sel, cur); $('#al-left').textContent = fcy(Math.max(0, avail - sel), cur);
  $('#al-over').hidden = sel <= avail + 0.005;
  const b = $('[data-act="al-confirm"]'); if (b) b.disabled = !(sel > 0) || sel > avail + 0.005;
});
act('al-confirm', el => {
  const rows = $$('[data-al]').filter(c => c.checked).map(c => ({ positionId: c.dataset.al, amount: Number(String(($(`[data-alamt="${c.dataset.al}"]`) || {}).value || 0).replace(/,/g, '')) }));
  if (!rows.length) { toast('Tick at least one position.', 'warn'); return; }
  run('cover.allocate', { source: el.dataset.src, rows });
});

/* ---------- T-06 exceptions ---------------------------------------------------------------- */
screen({ id: 'T-06', title: 'Exceptions and missing references',
  sub: () => `Separate, owned and aged &nbsp;·&nbsp; never one merged “errors” list &nbsp;·&nbsp; resolved exceptions leave the queue with their notes kept`,
  render(q) {
    const now = NOW();
    const tmp = V.exceptions(DB, now);
    const book = TR.exceptions(DB, now).filter(x => x.type !== 'Unallocated cover').map(x => ({ key: 'BOOK:' + x.type + ':' + x.ref, type: x.type, pill: x.type, ref: x.ref, currency: x.currency, amount: x.amount,
      age: Math.max(0, minsTo(x.at, now)), owner: x.owner, resolution: x.detail, recordId: x.recordId }));
    const types = ['Position without transaction', 'Transaction without position', 'Currency mismatch', 'Unallocated cover', 'Book and trade'];
    const all = [...tmp, ...book.map(x => ({ ...x, group: 'Book and trade' }))];
    const grp = x => x.group || x.type;
    const tab = types.includes(q.tab) ? q.tab : types.find(t => all.some(x => grp(x) === t)) || types[0];
    const rows = all.filter(x => grp(x) === tab).sort((a, b) => b.age - a.age);
    return `${statusTabs('tab', types.map(t => [t, all.filter(x => grp(x) === t).length]), tab)}
    ${table('t06', [
      { h: 'Reference', v: x => /^POS-/.test(x.ref) ? posRef({ id: x.ref }) : esc(x.ref), csv: x => x.ref, cls: 'ref' },
      { h: 'Exception', v: x => st(x.pill === x.type ? x.type : x.pill) + (tab === 'Book and trade' ? '' : ''), csv: x => x.type },
      { h: 'Amount', num: true, v: x => x.amount != null ? fcy(x.amount, x.currency) : '—' },
      { h: 'Age', num: true, v: x => `<span class="${x.age > 120 ? 'v-bad' : ''}">${dur(x.age)}</span>`, csv: x => x.age },
      { h: 'Owner', v: x => esc((x.note && x.note.owner) || x.owner) },
      { h: tab === 'Book and trade' ? 'Detail' : 'Resolution', v: x => esc(x.resolution), cls: 'wrap' },
      { h: 'Notes', v: x => x.note ? `${st(x.note.status)}<span class=sm>${esc(x.note.findings)}</span>` : '<span class=dim>—</span>', csv: x => x.note ? x.note.findings : '', cls: 'wrap' },
      { h: '', cls: 'acts', csv: false, v: x => [
        can('tmp.exceptions') ? lnk('Investigate', 'exc-note', { key: x.key }) : '',
        x.type === 'Position without transaction' && can('tmp.exceptions') ? lnk('Remind branch', 'remind', { id: x.positionId }) : '',
        x.type === 'Transaction without position' && can('tmp.exceptions') ? lnk('Ask branch', 'exc-ask', { id: x.fxpId }) : '',
        x.type === 'Unallocated cover' && can('treasury.deal') ? golink('Allocate', 'T-05', { src: x.coverId }) : '',
        x.type === 'Currency mismatch' && x.positionId ? `<a href="#" data-pos="${esc(x.positionId)}">Position</a>` : '',
      ].filter(Boolean).join(' · ') },
    ], rows, { name: 'Exceptions — ' + tab, noun: 'exception', empty: 'Nothing in this queue.' })}`;
  } });
act('exc-note', el => cmdDlg({ title: 'Investigate exception', ok: 'Save', body: `<p class=small><b>${esc(el.dataset.key)}</b></p><div class=fgrid>${field('Owner', `<input type=text id=ex-owner value="Treasury">`)}${field('Status', `<select id=ex-status><option value=open>Investigating</option><option value=resolve>Resolved — close it</option></select>`)}</div>${field('Findings', `<textarea id=dlg-reason data-required></textarea>`, { req: true })}` },
  'exception.note', () => ({ key: el.dataset.key, owner: $('#ex-owner').value, findings: $('#dlg-reason').value, resolve: $('#ex-status').value === 'resolve' })));
act('exc-ask', el => cmdDlg({ title: `Ask the branch to raise a position for ${esc(el.dataset.id)}`, ok: 'Send', body: field('Note to the branch', `<textarea id=dlg-reason data-required>Bill received with no position — please raise one or tell us why.</textarea>`, { req: true }) },
  'exception.askBranch', () => ({ fxpId: el.dataset.id, note: $('#dlg-reason').value })));

/* ---------- liquidity: T-07 inventory, T-19 cash, T-08 banks, T-09 Nostro, T-10 cards ---------- */
const refreshBtn = (id, label) => can('tmp.liquidity') || can('tmp.finance') || can('tmp.admin') ? btn(label || 'Refresh', 'int-pull', { id }, 'sec') : '';
act('int-pull', el => run('integration.pull', { id: el.dataset.id }));
screen({ id: 'T-07', title: 'Currency inventory',
  sub: () => `Branch and airport stock from FX Plus &nbsp;·&nbsp; stale rows stay visible but leave the fresh subtotal &nbsp;·&nbsp; valued at the current IBR`,
  acts: () => refreshBtn('FXP-API', 'Refresh from FX Plus'),
  render(q) {
    const now = NOW();
    const inv = V.inventory(DB, now).filter(r => !q.cur || r.currency === q.cur);
    const byCur = {};
    inv.forEach(r => { const c = byCur[r.currency] = byCur[r.currency] || { qty: 0, fresh: 0, aged: 0, stale: 0, inr: 0 }; c.qty += r.qty; c.aged += r.aged; c.inr += r.inr; if (freshOf(r.asOf) === 'Stale') c.stale += r.qty; else c.fresh += r.qty; });
    return `<div class=filters>${chips('cur', [['', 'All'], ...Object.keys(byCur).sort().map(c => [c, c])], q.cur || '')}</div>
    ${table('t07-sum', [{ h: 'Currency', v: ([c]) => esc(c) }, { h: 'Total', num: true, v: ([c, x]) => num(x.qty, c) }, { h: 'Fresh subtotal', num: true, v: ([c, x]) => num(x.fresh, c) },
      { h: 'Stale (excluded)', num: true, v: ([c, x]) => x.stale ? `<span class=v-bad>${num(x.stale, c)}</span>` : '0' }, { h: 'Aged > 7 days', num: true, v: ([c, x]) => x.aged ? `<span class=v-warn>${num(x.aged, c)}</span>` : '0' },
      { h: 'Value (INR)', num: true, v: ([, x]) => inrN(x.inr) }], Object.entries(byCur), { title: 'By currency — each on its own line, never added together', name: 'Inventory summary', noun: 'currency' })}
    ${table('t07', [
      { h: 'Location', v: r => esc(node(r.locationId)) + `<span class=sm>${esc(r.type || '')}</span>`, csv: r => node(r.locationId) }, { h: 'Currency', k: 'currency' },
      { h: 'Stock', num: true, v: r => num(r.qty, r.currency) }, { h: 'Aged', num: true, v: r => num(r.aged, r.currency) }, { h: 'IBR', num: true, v: r => rate(r.rate) },
      { h: 'Value (INR)', num: true, v: r => inrN(r.inr) }, { h: 'Freshness', v: r => fresh(freshOf(r.asOf), r.asOf), csv: r => r.asOf },
    ], inv, { title: 'By location', name: 'Currency inventory', noun: 'holding' })}`;
  } });
screen({ id: 'T-19', title: 'Cash balances',
  sub: () => `INR cash at branches and airports &nbsp;·&nbsp; lakh and crore grouping &nbsp;·&nbsp; aged cash over 7 days`,
  acts: () => refreshBtn('FXP-API', 'Refresh from FX Plus'),
  render() {
    const rows = V.cash(DB, NOW());
    const fr = rows.filter(r => freshOf(r.asOf) !== 'Stale');
    return `${strip([{ v: inrL(sum(fr, 'total')), l: 'Fresh subtotal (INR)' }, { v: inrL(sum(rows, 'aged')), l: 'Aged over 7 days', kind: sum(rows, 'aged') > 0 ? 'alert' : '' }, { v: rows.length, l: 'Locations' }])}
    ${table('t19', [{ h: 'Location', v: r => esc(node(r.locationId)) + `<span class=sm>${esc(r.type || '')}</span>`, csv: r => node(r.locationId) },
      { h: 'Total (INR)', num: true, v: r => inrN(r.total) }, { h: 'Fresh', num: true, v: r => inrN(r.fresh) }, { h: 'Aged', num: true, v: r => r.aged ? `<span class=v-warn>${inrN(r.aged)}</span>` : '0.00' },
      { h: 'Last counted', v: r => istDT(r.lastCounted), csv: r => r.lastCounted }, { h: 'Freshness', v: r => fresh(freshOf(r.asOf), r.asOf), csv: r => r.asOf }], rows, { name: 'Cash balances', noun: 'location' })}`;
  } });
screen({ id: 'T-08', title: 'Bank account balances',
  sub: () => `From the bank aggregator &nbsp;·&nbsp; trade settlements, spot cover and bulk bookings move these balances &nbsp;·&nbsp; stale accounts leave the fresh subtotal`,
  acts: () => refreshBtn('BANKAGG', 'Refresh balances'),
  render() {
    const now = NOW(), rows = DB.bankAccounts || [];
    const f = r => r.feedDown ? 'Stale' : freshOf(r.asOf);
    const byCur = {};
    rows.forEach(r => { const c = byCur[r.currency] = byCur[r.currency] || { fresh: 0, stale: 0 }; if (f(r) === 'Stale') c.stale += r.available; else c.fresh += r.available; });
    return `${rows.some(r => r.feedDown) ? banner('bad', 'A bank feed is down', `<br>${rows.filter(r => r.feedDown).map(r => `${esc(r.bank)} ${esc(r.mask)} last updated ${istDT(r.asOf)}`).join('; ')} — shown, but excluded from the fresh subtotal.`) : ''}
    ${strip(Object.entries(byCur).map(([c, x]) => ({ v: c === 'INR' ? inrL(x.fresh) : fcy(x.fresh, c), l: `${esc(c)} fresh subtotal${x.stale ? ` · ${c === 'INR' ? inrL(x.stale) : num(x.stale, c)} stale excluded` : ''}`, cls: 'cur' })))}
    ${table('t08', [{ h: 'Bank', v: r => esc(r.bank) + `<span class=sm>${esc(r.mask)}</span>`, csv: r => r.bank + ' ' + r.mask }, { h: 'Owner', v: r => esc(r.owner === 'HO' ? 'Head office' : node(r.owner)) },
      { h: 'Currency', k: 'currency' }, { h: 'Ledger', num: true, v: r => r.currency === 'INR' ? inrN(r.ledger) : num(r.ledger, r.currency) },
      { h: 'Available', num: true, v: r => r.currency === 'INR' ? inrN(r.available) : num(r.available, r.currency) }, { h: 'Source', v: r => esc(r.source) },
      { h: 'Freshness', v: r => fresh(f(r), r.asOf), csv: r => r.asOf }], rows, { name: 'Bank balances', noun: 'account' })}`;
  } });
screen({ id: 'T-09', title: 'Nostro balances and upload',
  sub: () => `Correspondent Nostro from SWIFT MT950 (trade payments and receipts move them) &nbsp;·&nbsp; issuer Nostro uploaded by hand; a duplicate statement date is replaced only through a checker`,
  render(q) {
    const cur = (DB.nostro || []).filter(n => n.status === 'Current');
    const hist = (DB.nostro || []).filter(n => n.status !== 'Current');
    const cols = [{ h: 'Bank / issuer', v: n => esc(n.issuer) }, { h: 'Currency', k: 'currency' }, { h: 'Balance', num: true, v: n => num(n.balance, n.currency) },
      { h: 'Statement', v: n => istDT(n.statementAt), csv: n => n.statementAt }, { h: 'Source', v: n => esc(n.source) + `<span class=sm>${esc(n.updatedBy || '')}</span>`, cls: 'wrap' },
      { h: 'Freshness', v: n => fresh(freshOf(n.statementAt, 240, 1440), n.statementAt), csv: false }];
    return `${table('t09-c', cols, cur.filter(n => n.kind === 'Correspondent'), { title: 'Correspondent Nostro', name: 'Correspondent Nostro', noun: 'account' })}
    ${table('t09-i', cols, cur.filter(n => n.kind === 'Issuer'), { title: 'Issuer Nostro (card programmes)', name: 'Issuer Nostro', noun: 'account' })}
    ${can('tmp.liquidity') && !readOnly() ? `<div class=form><h2 style="margin:0 0 8px">Upload an issuer statement</h2>
      <p class=hint style="margin-top:0">One row per line: issuer, currency, balance, statement date (YYYY-MM-DD).</p>
      <div class=fgrid>${field('Rows', `<textarea id=nu-rows rows=4 style="width:100%;font:var(--t-small) monospace">Visa,USD,203500,${todayIST()}\nMastercard,USD,98000,${todayIST()}</textarea>`)}
        <div>${field('File name', `<input type=text id=nu-file value="issuer_balances_${todayIST()}.xlsx">`)}${field('If a statement date already exists', `<select id=nu-dup>${options([['ask', 'Stop and tell me'], ['skip', 'Skip duplicates'], ['replace', 'Replace — with a reason, through a checker']])}</select>`)}
        ${field('Reason for replacing', `<input type=text id=nu-reason placeholder="e.g. revised statement received 13:00">`)}</div></div>
      <div class=bar>${btn('Upload', 'nu-upload')}</div></div>` : ''}
    ${q.hist ? table('t09-h', cols, hist, { title: 'Superseded rows (kept for audit)', name: 'Nostro history', noun: 'row' }) : `<p class=small>${golink('Show superseded rows', 'T-09', { hist: 1 })}</p>`}`;
  } });
act('nu-upload', () => {
  const rows = $('#nu-rows').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [issuer, currency, balance, statementDate] = l.split(',').map(x => x.trim()); return { issuer, currency, balance: Number(balance), statementDate }; });
  run('nostro.upload', { rows, file: $('#nu-file').value, onDuplicate: $('#nu-dup').value, reason: $('#nu-reason').value });
});
screen({ id: 'T-10', title: 'Customer card and wallet balances',
  sub: () => `Card programme balances from Euronet and Pine Labs &nbsp;·&nbsp; branch cards load and reload from forex card deals`,
  acts: () => refreshBtn('EURONET', 'Refresh Euronet') + refreshBtn('PINELABS', 'Refresh Pine Labs'),
  render() {
    const rows = DB.cardBalances || [];
    return `${table('t10', [{ h: 'Network', v: r => esc(r.network) }, { h: 'Currency', k: 'currency' },
      { h: 'Balance', num: true, v: r => r.balance == null ? '<span class=dim>Set-up pending</span>' : r.currency === 'INR' ? inrN(r.balance) : num(r.balance, r.currency), csv: r => r.balance },
      { h: 'Branches', v: r => Object.entries(r.branches || {}).map(([b, x]) => `${esc(node(b))} ${x.cards} cards · ${num(x.balance, r.currency)}`).join('<br>') || '—', cls: 'wrap', csv: r => Object.keys(r.branches || {}).length },
      { h: 'Source', v: r => esc(r.source) }, { h: 'Freshness', v: r => r.asOf ? fresh(freshOf(r.asOf), r.asOf) : st('Not selected'), csv: r => r.asOf || '' }], rows, { name: 'Card balances', noun: 'programme' })}`;
  } });

/* ---------- credit: T-11 lines, T-25 customer limits --------------------------------------- */
screen({ id: 'T-11', title: 'Credit lines and funding',
  sub: () => `Bank lines behind card funding and forward cover &nbsp;·&nbsp; a funding-rule version is a preview until a checker approves it`,
  render(q) {
    const lines = DB.creditLines || [];
    const l = lines.find(x => x.id === q.line) || lines[0];
    const act2 = l && !readOnly() && can('tmp.settle') ? btn('Enter settlement', 'cl-settle', { id: l.id }) + (l.purpose === 'Card funding' ? btn('Propose rule version', 'cl-rule', { id: l.id }, 'sec') : '') : '';
    return `${table('t11', [
      { h: 'Line', v: x => `<a href="#/T-11?line=${esc(x.id)}">${esc(x.id)}</a><span class=sm>${esc(x.bank)}</span>`, csv: x => x.id },
      { h: 'Purpose', v: x => esc(x.purpose) }, { h: 'Limit (INR)', num: true, v: x => inrN(x.limit) },
      { h: 'Utilised', num: true, v: x => inrN(V.lineUse(x).utilised) }, { h: 'Available', num: true, v: x => inrN(V.lineUse(x).available) },
      { h: 'Utilisation', v: x => { const u = V.lineUse(x); return `<div class=meter style="width:120px"><i class="${u.pct > 90 ? 'bad' : u.pct > 75 ? 'warn' : ''}" style="width:${Math.min(100, u.pct)}%"></i></div><span class=sm>${u.pct}%</span>`; }, csv: x => V.lineUse(x).pct },
      { h: 'Rule', v: x => esc(x.ruleVersion || '—') },
    ], lines, { name: 'Credit lines', noun: 'line', row: x => l && x.id === l.id ? ' class=sel' : '' })}
    ${l ? `${l.purpose === 'Card funding' ? table('t11-rules', [{ h: 'Rule version', v: v => esc(v) + (v === l.ruleVersion ? ' ' + pill('In force', 'ok') : '') },
        { h: 'Counts', v: v => esc({ 'v0.1': 'Loads and reloads', 'v0.2': 'Loads, reloads and cashouts', 'v0.3': 'Loads, reloads, cashouts and settlements' }[v]) },
        { h: 'Utilised (INR)', num: true, v: v => inrN(V.lineUse(l, v).utilised) }, { h: 'Utilisation', num: true, v: v => V.lineUse(l, v).pct + '%' }],
        ['v0.1', 'v0.2', 'v0.3'], { title: `${esc(l.bank)} — what each funding rule would show (preview)`, name: 'Funding rule preview', noun: 'version' }) : ''}
      ${table('t11-act', [{ h: 'Reference', v: a => esc(a.id) }, { h: 'Kind', v: a => esc(a.kind) }, { h: 'Source', v: a => esc(a.source) },
        { h: 'Amount (INR)', num: true, v: a => inrN(a.amount) }, { h: 'State', v: a => st(a.state) }, { h: 'When', v: a => istDT(a.at), csv: a => a.at }, { h: 'By', v: a => esc(a.by || '') }],
        l.activity || [], { title: `${esc(l.bank)} activity`, name: `${l.id} activity`, noun: 'movement', cap: `<span>${plural((l.activity || []).length, 'movement')}</span><span class=sp></span>${act2}` })}` : ''}`;
  } });
act('cl-settle', el => cmdDlg({ title: 'Enter a credit line settlement', ok: 'Send to checker', body: `<div class=fgrid>${field('Amount (INR)', `<input type=text id=cs-amt data-required inputmode=decimal>`, { req: true })}${field('Settlement reference', `<input type=text id=cs-ref data-required placeholder="SET-…">`, { req: true })}</div><p class=hint>Utilisation changes only when a checker approves.</p>` },
  'credit.settle', () => ({ lineId: el.dataset.id, amount: Number($('#cs-amt').value.replace(/,/g, '')), ref: $('#cs-ref').value })));
act('cl-rule', el => { const l = (DB.creditLines || []).find(x => x.id === el.dataset.id); cmdDlg({ title: `Funding rule for ${esc(l.bank)}`, ok: 'Send to checker', body: field('New rule version', `<select id=cr-v>${options(['v0.1', 'v0.2', 'v0.3'].filter(v => v !== l.ruleVersion).map(v => [v, `${v} — utilisation ${inr(V.lineUse(l, v).utilised)}`]))}</select>`, { hint: `Currently ${esc(l.ruleVersion)}: ${inr(V.lineUse(l).utilised)}` }) },
  'credit.ruleVersion', () => ({ lineId: l.id, version: $('#cr-v').value })); });
screen({ id: 'T-25', title: 'Customer credit limits',
  sub: () => `Trade customers and branch corporates &nbsp;·&nbsp; outstanding = open, attached and held positions at the customer rate &nbsp;·&nbsp; a booking over the limit is held for a checker`,
  render() {
    const now = NOW(), rows = V.limits(DB, now);
    const held = (DB.positions || []).filter(p => p.status === 'Held');
    return `${held.length ? banner('warn', `${plural(held.length, 'deal')} held on limits`, `<br>${held.map(p => `${posRef(p)} ${esc(p.customerName)} ${fcy(p.amount, p.currency)} — ${esc(p.heldReason || '')}`).join('<br>')}<br>${golink('Decide them on the approvals worklist', 'T-21', { type: 'Held deal' })}`) : ''}
    ${table('t25', [
      { h: 'Customer', v: l => `<b>${esc(l.name)}</b><span class=sm>${esc(l.id)}${l.smeId ? ' · trade portal ' + esc(l.smeId) : ' · branch corporate'}</span>`, csv: l => l.name },
      { h: 'Limit (INR)', num: true, v: l => inrN(l.limit) }, { h: 'Outstanding', num: true, v: l => inrN(l.outstanding) }, { h: 'Available', num: true, v: l => `<span class="${l.available < 0 ? 'v-bad' : ''}">${inrN(l.available)}</span>` },
      { h: 'Utilisation', v: l => `<div class=meter style="width:120px"><i class="${l.pct > 100 ? 'bad' : l.pct > 80 ? 'warn' : ''}" style="width:${Math.min(100, l.pct)}%"></i></div><span class=sm>${l.pct}% · ${plural(l.positions.length, 'position')}</span>`, csv: l => l.pct },
      { h: 'Restrictions', v: l => esc([l.restrictions && l.restrictions.currencies && l.restrictions.currencies.length ? l.restrictions.currencies.join('/') : '', l.restrictions && l.restrictions.sides && l.restrictions.sides.length ? l.restrictions.sides.map(side).join('/') + ' only' : '', l.restrictions && l.restrictions.dealCap ? 'deal cap ' + inr(l.restrictions.dealCap) : ''].filter(Boolean).join(' · ') || 'None') },
      { h: 'Status', v: l => st(l.status) },
      { h: '', cls: 'acts', csv: false, v: l => can('tmp.limits') ? lnk('Raise limit', 'lim-raise', { id: l.id }) : '' },
    ], rows, { name: 'Customer limits', noun: 'customer' })}`;
  } });
act('lim-raise', el => { const l = (DB.limits || []).find(x => x.id === el.dataset.id); cmdDlg({ title: `Change the limit — ${esc(l.name)}`, ok: 'Send to checker', body: `<div class=fgrid>${field('Current limit', readRO(inr(l.limit)))}${field('New limit (INR)', `<input type=text id=lr-amt data-required inputmode=decimal>`, { req: true })}</div>${reasonBody('', 'Justification', 'e.g. sanction letter reference')}` },
  'limits.raise', () => ({ id: l.id, limit: Number($('#lr-amt').value.replace(/,/g, '')), reason: $('#dlg-reason').value })); });

/* ---------- forwards: T-12 by value date, T-13 settlement approval ----------------------------- */
screen({ id: 'T-12', title: 'Forward covers by value date',
  sub: () => `Settling a forward is entered by the dealer and approved by a checker &nbsp;·&nbsp; the approved balance does not change until then`,
  render(q) {
    const day = todayIST();
    const fw = (DB.covers || []).filter(c => c.type === 'Forward' && c.status !== 'Cancelled').sort((a, b) => String(a.valueDate).localeCompare(String(b.valueDate)));
    const state = c => (c.settled || 0) >= c.amount - 0.005 ? 'Settled' : c.valueDate < day ? 'Overdue' : c.valueDate === day ? 'Due today' : 'Pending';
    const tabs = ['Pending', 'Due today', 'Overdue', 'Settled'];
    const tab = tabs.includes(q.tab) ? q.tab : 'Pending';
    const pend = c => (DB.approvals || []).find(a => a.type === 'Forward settlement' && a.status === 'Pending' && a.payload.coverId === c.id);
    return `${statusTabs('tab', tabs.map(t => [t, fw.filter(c => state(c) === t).length]), tab)}
    ${table('t12', [{ h: 'Cover', v: c => esc(c.id) + `<span class=sm>${esc(c.dealRef || '')}</span>`, csv: c => c.id, cls: 'ref' }, { h: 'Bank', v: c => esc(c.counterparty) },
      { h: 'Side', v: c => side(c.side) }, { h: 'Amount', num: true, v: c => fcy(c.amount, c.currency) }, { h: 'Rate', num: true, v: c => rate(c.rate) },
      { h: 'Value date', v: c => `<span class="${state(c) === 'Overdue' ? 'v-bad' : ''}">${dmy(c.valueDate)}</span>`, csv: c => c.valueDate },
      { h: 'Settled', num: true, v: c => num(c.settled || 0, c.currency) }, { h: 'Pending', num: true, v: c => num(c.amount - (c.settled || 0), c.currency) },
      { h: 'Status', v: c => st(state(c)) + (pend(c) ? `<span class=sm>${esc(pend(c).id)} with checker</span>` : '') },
      { h: '', cls: 'acts', csv: false, v: c => state(c) !== 'Settled' && !pend(c) && can('tmp.settle') ? lnk('Update settlement', 'fw-settle', { id: c.id }) : pend(c) ? golink('Approval', 'T-13') : '' }],
      fw.filter(c => state(c) === tab), { name: 'Forward covers', noun: 'forward' })}`;
  } });
act('fw-settle', el => { const c = (DB.covers || []).find(x => x.id === el.dataset.id); const pend = round2(c.amount - (c.settled || 0)); cmdDlg({ title: `Settle ${esc(c.id)}`, ok: 'Send to checker',
  body: `<div class=impact><b>${esc(c.counterparty)} · ${side(c.side)} ${fcy(c.amount, c.currency)} at ${rate(c.rate)}</b>${fcy(c.settled || 0, c.currency)} settled, ${fcy(pend, c.currency)} pending. The approved balance changes only on approval.</div>
    <div class=fgrid>${field('Settlement amount', `<div class=amt><span class=ccy>${esc(c.currency)}</span><input type=text id=fs-amt value="${pend}" data-required></div>`, { req: true })}${field('Evidence reference', `<input type=text id=fs-ev data-required placeholder="bank confirmation">`, { req: true })}</div>${field('Note', `<input type=text id=fs-note>`)}` },
  'forward.settle', () => ({ id: c.id, amount: Number($('#fs-amt').value.replace(/,/g, '')), evidence: $('#fs-ev').value, note: $('#fs-note').value })); });
function approvalCard(a) {
  const own = a.makerKey === myKey();
  const canDecide = can('treasury.approve') && a.status === 'Pending';
  return `<div class=panel><h2>${esc(a.id)} · ${esc(a.type)}${a.version > 1 ? ` · v${a.version}` : ''}<span class=sp></span>${st(a.status)}</h2><div class=pad>
    <p style="margin:0 0 8px"><b>${esc(a.title)}</b></p>
    <div class=tbl><table class="dt diff"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${(a.diff || []).map(d => `<tr><td class=dim>${esc(d.field)}</td><td class=was>${esc(d.before)}</td><td class=now>${esc(d.after)}</td></tr>`).join('')}</tbody></table></div>
    ${kv([['Maker', esc(a.maker)], ['Submitted', `${istDT(a.submittedAt)} IST · ${ago(a.submittedAt)}${a.breach ? ' ' + pill('Past SLA', 'bad') : ''}`], a.note ? ['Note', esc(a.note)] : null,
      a.checker ? ['Checker', esc(a.checker) + (a.decidedAt ? ` · ${istDT(a.decidedAt)}` : '')] : null, a.reason ? ['Reason', esc(a.reason)] : null, a.supersedes ? ['Supersedes', esc(a.supersedes)] : null])}
    ${canDecide ? `<div class=bar>${own ? `<button type=button class=btn disabled>Approve</button><span class=why>You entered this — it routes to another checker.</span>` : btn('Approve', 'apr-ok', { id: a.id })}${own ? '' : btn('Reject', 'apr-no', { id: a.id }, 'danger')}</div>` : ''}
    ${a.status === 'Rejected' && own && !readOnly() ? `<div class=bar>${btn('Amend and resubmit', 'apr-resubmit', { id: a.id }, 'sec')}</div>` : ''}
  </div></div>`;
}
screen({ id: 'T-13', title: 'Forward settlement approval',
  sub: () => `Before and after, side by side &nbsp;·&nbsp; a rejection needs a reason &nbsp;·&nbsp; a checker never approves their own entry`,
  render() {
    const list = V.approvals(DB, NOW()).filter(a => a.type === 'Forward settlement').sort((a, b) => (a.status === 'Pending' ? 0 : 1) - (b.status === 'Pending' ? 0 : 1) || String(b.submittedAt).localeCompare(String(a.submittedAt)));
    return list.length ? `<div class=cols>${list.slice(0, 8).map(approvalCard).join('')}</div>` : `<div class=state><h3>No forward settlements</h3><p>Settlements entered on T-12 arrive here.</p></div>`;
  } });
act('apr-ok', el => { const a = (DB.approvals || []).find(x => x.id === el.dataset.id); cmdDlg({ title: `Approve ${esc(a.id)}`, ok: 'Approve', body: `<p>${esc(a.type)}: <b>${esc(a.title)}</b></p><p class=small>Approving applies the change now and records you as the checker.</p>` }, 'approval.approve', { id: a.id }); });
act('apr-no', el => cmdDlg({ title: `Reject ${esc(el.dataset.id)}`, ok: 'Reject', okClass: 'danger', body: reasonBody('The maker sees your reason and can amend and resubmit.', 'Rejection reason') }, 'approval.reject', () => ({ id: el.dataset.id, reason: $('#dlg-reason').value })));
act('apr-resubmit', el => cmdDlg({ title: `Amend and resubmit ${esc(el.dataset.id)}`, ok: 'Resubmit', body: reasonBody('A new version goes to a checker; this one is kept.', 'What changed') }, 'approval.resubmit', () => ({ id: el.dataset.id, note: $('#dlg-reason').value })));

/* ---------- settlements: T-14 card MIS, T-15 pending, T-16 profitability, T-23 report ------------ */
screen({ id: 'T-14', title: 'Card sales against settlement',
  sub: () => `By issuer and currency &nbsp;·&nbsp; opening + sales − cashout − covered = open &nbsp;·&nbsp; EEFC-funded loads are excluded, unmapped card prefixes flagged`,
  render() {
    const rows = V.cardMis(DB, NOW());
    return `${table('t14', [{ h: 'Issuer', v: r => esc(r.issuer) + (r.unmapped ? ' ' + pill('Unmapped prefix', 'bad') : ''), csv: r => r.issuer }, { h: 'CCY', k: 'currency' },
      { h: 'Opening', num: true, v: r => num(r.opening, r.currency) }, { h: '+ Sales', num: true, v: r => num(r.sales, r.currency) }, { h: '− Cashout', num: true, v: r => num(r.cashout, r.currency) },
      { h: '− Covered', num: true, v: r => num(r.covered, r.currency) }, { h: '= Open', num: true, v: r => `<b>${num(r.open, r.currency)}</b>`, csv: r => r.open },
      { h: 'Avg sales', num: true, v: r => rate(r.avgSales) }, { h: 'Avg DSR', num: true, v: r => rate(r.avgDsr) }, { h: 'IBR', num: true, v: r => rate(r.ibr) },
      { h: 'MTM (INR)', num: true, v: r => `<span class="${r.mtm < 0 ? 'v-bad' : 'v-ok'}">${inrN(r.mtm)}</span>`, csv: r => r.mtm },
      { h: 'EEFC excluded', num: true, v: r => r.excluded ? num(r.excluded, r.currency) : '—' }], rows, { name: 'Card sales against settlement', noun: 'line' })}`;
  } });
const pendingCard = () => {
  const now = NOW();
  return (DB.cardActivity || []).filter(x => x.kind === 'Sale' && x.funding !== 'EEFC' && x.amount - (x.mapped || 0) > 0.005).map(x => {
    const days = (new Date(now) - new Date(x.at)) / 86400000;
    return { ...x, pending: round2(x.amount - (x.mapped || 0)), days, bucket: days <= 1 ? '0–1 day' : days <= 3 ? '1–3 days' : days <= 7 ? '3–7 days' : 'Over 7 days', issuer: V.issuerOf(DB, x.prefix) || 'Unmapped prefix' };
  });
};
function pendingMis(print) {
  const rows = pendingCard();
  const buckets = ['0–1 day', '1–3 days', '3–7 days', 'Over 7 days'];
  const g = {};
  rows.forEach(r => { const k = r.issuer + '|' + r.currency; const x = g[k] = g[k] || { issuer: r.issuer, currency: r.currency, total: 0 }; x[r.bucket] = round2((x[r.bucket] || 0) + r.pending); x.total = round2(x.total + r.pending); });
  return `${table(print ? 't23' : 't15-sum', [{ h: 'Issuer', v: r => esc(r.issuer) }, { h: 'CCY', k: 'currency' }, ...buckets.map(b => ({ h: b, num: true, v: r => r[b] ? `<span class="${b === 'Over 7 days' ? 'v-bad' : ''}">${num(r[b], r.currency)}</span>` : '—', csv: r => r[b] || 0 })),
    { h: 'Pending', num: true, v: r => `<b>${num(r.total, r.currency)}</b>`, csv: r => r.total }], Object.values(g), { title: 'Pending settlement by age — per issuer and currency', name: 'Pending settlement MIS', noun: 'line' })}
  ${table(print ? 't23-d' : 't15', [{ h: 'Invoice', v: r => esc(r.id) }, { h: 'Issuer', v: r => esc(r.issuer) + `<span class=sm>prefix ${esc(r.prefix)}</span>` }, { h: 'CCY', k: 'currency' },
    { h: 'Sale', num: true, v: r => num(r.amount, r.currency) }, { h: 'Mapped', num: true, v: r => num(r.mapped || 0, r.currency) }, { h: 'Pending', num: true, v: r => num(r.pending, r.currency) },
    { h: 'Sold', v: r => istDT(r.at), csv: r => r.at }, { h: 'Age', v: r => `<span class="${r.days > 7 ? 'v-bad' : ''}">${esc(r.bucket)}</span>` }, { h: 'Branch', v: r => esc(node(r.branchId)) }],
    rows.sort((a, b) => b.days - a.days), { title: 'Invoices awaiting settlement', name: 'Pending card invoices', noun: 'invoice' })}`;
}
screen({ id: 'T-15', title: 'Pending settlement MIS', sub: () => 'INR-funded card sales not yet matched to an issuer settlement &nbsp;·&nbsp; aged', acts: () => gobtn('Print report', 'T-23', null, 'sec'), render: () => pendingMis(false) });
screen({ id: 'T-23', title: 'Card pending settlement MIS — report', sub: () => `As at ${istDT(NOW())} IST &nbsp;·&nbsp; printable`, acts: () => `<button type=button class="btn sec" data-act="print">Print / save as PDF</button>`, render: () => pendingMis(true) });
act('print', () => window.print());
screen({ id: 'T-16', title: 'Treasury and branch profitability',
  sub: () => `Customer rate › internal transfer rate › bank cover rate &nbsp;·&nbsp; sales margin and dealing result kept apart, all in INR`,
  render(q) {
    const now = NOW(), pl = TR.pnl(DB, now);
    const by = q.by === 'product' ? 'product' : 'branch';
    const g = {};
    (DB.positions || []).filter(p => TR.live(p) > 0.005).forEach(p => {
      const m = V.margin(DB, p), k = by === 'product' ? prodName(p.product) : node(p.branchId);
      const x = g[k] = g[k] || { key: k, n: 0, branch: 0, treasury: 0 };
      x.n++; x.branch = round2(x.branch + m.branch); x.treasury = round2(x.treasury + (m.treasury || 0));
    });
    return `${strip([{ v: inrL(pl.totals.sales), l: 'Sales margin (INR)' }, { v: inrL(pl.totals.realised), l: 'Dealing — realised' }, { v: inrL(pl.totals.unrealised), l: 'Dealing — unrealised at IBR', kind: pl.totals.unrealised < 0 ? 'alert' : '' }, { v: inrL(pl.totals.total), l: 'Total (INR)', kind: 'brand' }])}
    <div class=filters>${chips('by', [['branch', 'By branch'], ['product', 'By product line']], by)}</div>
    ${table('t16', [{ h: by === 'product' ? 'Product line' : 'Branch', v: r => esc(r.key) }, { h: 'Positions', num: true, v: r => r.n },
      { h: 'Branch margin (INR)', num: true, v: r => inrN(r.branch) }, { h: 'Treasury margin (INR)', num: true, v: r => inrN(r.treasury) }, { h: 'Total', num: true, v: r => `<b>${inrN(r.branch + r.treasury)}</b>`, csv: r => r.branch + r.treasury }],
      Object.values(g).sort((a, b) => (b.branch + b.treasury) - (a.branch + a.treasury)), { title: 'Margin split — customer vs transfer (branch), transfer vs cover (treasury)', name: 'Profitability ' + by, noun: 'line' })}
    ${table('t16-cur', [{ h: 'Currency', v: r => esc(r.key) }, { h: 'Positions', num: true, v: r => r.n }, { h: 'Sales margin', num: true, v: r => inrN(r.sales) },
      { h: 'Realised', num: true, v: r => inrN(r.realised) }, { h: 'Unrealised', num: true, v: r => inrN(r.unrealised) }, { h: 'Total', num: true, v: r => `<b>${inrN(r.total)}</b>`, csv: r => r.total }],
      pl.byCurrency, { title: 'P&L by currency (INR)', name: 'P&L by currency', noun: 'currency' })}`;
  } });

/* ---------- T-17 regional bulk bookings --------------------------------------------------- */
screen({ id: 'T-17', title: 'Regional bulk currency booking',
  sub: () => `Requests from regional bulk teams &nbsp;·&nbsp; the dealer books with a bank; a checker approves the detail before stock and INR move`,
  render(q) {
    const all = (DB.bulkRequests || []).slice().sort((a, b) => String(b.raisedAt).localeCompare(String(a.raisedAt)));
    const grp = r => ['With Treasury', 'Needs detail', 'Awaiting checker'].includes(r.status) ? 'Open' : r.status === 'Booked' ? 'Confirmed' : 'Rejected';
    const tabs = ['Open', 'Confirmed', 'Rejected'];
    const tab = tabs.includes(q.tab) ? q.tab : 'Open';
    return `${statusTabs('tab', tabs.map(t => [t, all.filter(r => grp(r) === t).length]), tab)}
    ${table('t17', bulkCols(true), all.filter(r => grp(r) === tab), { name: 'Bulk bookings', noun: 'request' })}`;
  } });
function bulkCols(treasury) {
  return [{ h: 'Request', v: r => esc(r.id), cls: 'ref' }, { h: 'Branch', v: r => esc(node(r.branchId)) + `<span class=sm>${esc(node(r.regionId))}</span>`, csv: r => node(r.branchId) },
    { h: 'Amount', num: true, v: r => fcy(r.amount, r.currency) }, { h: 'Required', v: r => dmy(r.requiredDate), csv: r => r.requiredDate }, { h: 'Purpose', v: r => esc(r.purpose) },
    { h: 'Status', v: r => st(r.status) + (r.query ? `<span class=sm>${esc(r.query)}</span>` : '') + (r.response ? `<span class=sm>Reply: ${esc(r.response)}</span>` : '') + (r.rejectReason ? `<span class=sm>${esc(r.rejectReason)}</span>` : ''), cls: 'wrap', csv: r => r.status },
    { h: 'Booking', v: r => r.booking ? `${esc(r.booking.counterparty)} ${rate(r.booking.rate)}<span class=sm>${esc(r.booking.bankRef)} · value ${dmy(r.booking.valueDate)}</span>` : '<span class=dim>—</span>', csv: r => r.booking ? r.booking.bankRef : '' },
    { h: 'Raised', v: r => `<span class=dim>${istDT(r.raisedAt)}</span><span class=sm>${esc(r.raisedBy || '')}</span>`, csv: r => r.raisedAt },
    { h: '', cls: 'acts', csv: false, v: r => treasury ? ([
      ['With Treasury', 'Needs detail'].includes(r.status) && can('tmp.bulk.book') ? lnk('Book', 'bk-book', { id: r.id }) : '',
      r.status === 'With Treasury' && can('tmp.bulk.book') ? lnk('Needs detail', 'bk-detail', { id: r.id }) : '',
      ['With Treasury', 'Needs detail'].includes(r.status) && can('tmp.bulk.book') ? lnk('Reject', 'bk-reject', { id: r.id }, 'danger') : ''].filter(Boolean).join(' · '))
      : r.status === 'Needs detail' && can('tmp.bulk.request') ? lnk('Respond', 'bk-update', { id: r.id }) : '' }];
}
act('bk-book', el => { const r = (DB.bulkRequests || []).find(x => x.id === el.dataset.id); cmdDlg({ title: `Book ${esc(r.id)} — ${fcy(r.amount, r.currency)} for ${esc(node(r.branchId))}`, ok: 'Send to checker',
  body: `<div class=fgrid>${field('Bank', `<select id=bb-cp>${options((DB.counterparties || []).map(c => c.name))}</select>`)}${field('Rate', `<input type=text id=bb-rate data-required value="${rate(cur$(r.currency).refRate)}">`, { req: true })}
  ${field('Bank reference', `<input type=text id=bb-ref data-required>`, { req: true })}${field('Value date', `<input type=date id=bb-vd value="${esc(r.requiredDate)}">`)}${field('Legacy booking reference', `<input type=text id=bb-legacy>`)}</div>` },
  'bulk.book', () => ({ id: r.id, counterparty: $('#bb-cp').value, rate: Number($('#bb-rate').value), bankRef: $('#bb-ref').value, valueDate: $('#bb-vd').value, legacyRef: $('#bb-legacy').value })); });
act('bk-detail', el => cmdDlg({ title: `Ask for detail on ${esc(el.dataset.id)}`, ok: 'Return to requester', body: reasonBody('', 'What is missing') }, 'bulk.needsDetail', () => ({ id: el.dataset.id, note: $('#dlg-reason').value })));
act('bk-reject', el => cmdDlg({ title: `Reject ${esc(el.dataset.id)}`, ok: 'Reject', okClass: 'danger', body: reasonBody() }, 'bulk.reject', () => ({ id: el.dataset.id, reason: $('#dlg-reason').value })));

/* ---------- T-18 data health and audit ------------------------------------------------------ */
screen({ id: 'T-18', title: 'Data health and audit history',
  sub: () => `Every feed with its freshness &nbsp;·&nbsp; every change with who made it and when`,
  render(q) {
    const now = NOW(), integ = V.integrations(DB, now);
    const term = (q.find || '').toLowerCase();
    const audit = (DB.audit || []).filter(a => !term || [a.record, a.action, a.actor].some(x => String(x || '').toLowerCase().includes(term))).slice(0, 80);
    return `${table('t18-int', [{ h: 'Feed', v: i => `<b>${esc(i.name)}</b><span class=sm>${esc(i.data)}</span>`, csv: i => i.name }, { h: 'Transport', v: i => esc(i.transport) + `<span class=sm>${esc(i.mode)}</span>` },
      { h: 'Schedule', v: i => esc(i.schedule) }, { h: 'Last success', v: i => i.lastSuccess ? istDT(i.lastSuccess) : '—', csv: i => i.lastSuccess || '' }, { h: 'Freshness', v: i => fresh(i.freshness, i.lastSuccess), csv: i => i.freshness },
      { h: 'Status', v: i => st(i.status) + (i.pending ? `<span class=sm>${i.pending} pending</span>` : '') },
      { h: '', cls: 'acts', csv: false, v: i => i.status === 'Not selected' ? '' : ['Delayed', 'Failed'].includes(i.status) ? lnk('Retry job', 'int-retry', { id: i.id }) : (can('tmp.liquidity') || can('tmp.admin') || can('tmp.rates')) && i.id !== 'TRADE' ? lnk('Refresh', 'int-pull', { id: i.id }) : '' }],
      integ, { title: 'Data health', name: 'Integrations', noun: 'feed' })}
    <div class=filters><span class=src>Audit</span><input type=search value="${esc(q.find || '')}" placeholder="Filter by reference, action or user" data-qsel=find style="width:300px;padding:4px 8px"><span class=sp></span></div>
    ${table('t18-audit', [{ h: 'When (IST)', v: a => istDT(a.at), csv: a => a.at }, { h: 'Record', v: a => /^POS-/.test(a.record) ? posRef({ id: a.record }) : esc(a.record), csv: a => a.record },
      { h: 'Action', v: a => esc(a.action), cls: 'wrap' }, { h: 'By', v: a => esc(a.actor || '') }], audit, { title: 'Audit history (latest 80)', name: 'Audit history', noun: 'entry' })}`;
  } });
act('int-retry', el => run('integration.retry', { id: el.dataset.id }));

/* ---------- T-20 open position rates and P&L ------------------------------------------------ */
screen({ id: 'T-20', title: 'Open position rates and P&L',
  sub: () => `For what is still uncovered: average sales rate, average card (DSR) rate and the P&L at the current IBR &nbsp;·&nbsp; and the assessment P&L of what was covered`,
  render() {
    const now = NOW();
    return `${table('t20', [{ h: 'Currency', k: 'currency' }, { h: 'Open', num: true, v: r => num(r.open, r.currency) }, { h: 'Direction', v: r => esc(r.direction) },
      { h: 'Avg sales rate', num: true, v: r => rate(r.avgSales) }, { h: 'Avg DSR', num: true, v: r => rate(r.avgDsr) }, { h: 'IBR now', num: true, v: r => rate(r.ibr) },
      { h: 'P&L at IBR (INR)', num: true, v: r => `<span class="${r.pnl < 0 ? 'v-bad' : 'v-ok'}">${inrN(r.pnl)}</span>`, csv: r => r.pnl }], V.openRates(DB, now), { title: 'Open position — rates and P&L', name: 'Open position P&L', noun: 'currency' })}
    ${table('t20-as', [{ h: 'Currency', k: 'currency' }, { h: 'Side', v: l => side(l.side) }, { h: 'Sale day', v: l => dmy(l.saleDay), csv: l => l.saleDay }, { h: 'Cover day', v: l => dmy(l.coverDay), csv: l => l.coverDay },
      { h: 'Amount', num: true, v: l => num(l.amount, l.currency) }, { h: 'Closing IBR sale', num: true, v: l => rate(l.saleIbr) }, { h: 'Closing IBR cover', num: true, v: l => rate(l.coverIbr) },
      { h: 'Assessment P&L (INR)', num: true, v: l => inrN(l.pnl) }], V.assessment(DB, now), { title: 'Assessment P&L per covered lot', name: 'Assessment P&L', noun: 'lot' })}`;
  } });

/* ---------- T-21 approvals worklist -------------------------------------------------------- */
screen({ id: 'T-21', title: 'Approvals worklist',
  sub: () => `Everything that moves money or changes a control &nbsp;·&nbsp; before and after for every item &nbsp;·&nbsp; SLA ${(DB.settings || {}).approvalSlaMin || 120} minutes`,
  acts: () => can('treasury.approve') ? btn('Bulk reject with reason', 'apr-bulk', null, 'sec') : '',
  render(q) {
    const all = V.approvals(DB, NOW()).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    const tabs = ['Pending', 'Approved', 'Rejected', 'All'];
    const tab = tabs.includes(q.tab) ? q.tab : 'Pending';
    let rows = all.filter(a => tab === 'All' || a.status === tab);
    if (q.type) rows = rows.filter(a => a.type === q.type);
    const types = [...new Set(all.map(a => a.type))].sort();
    const one = q.id && all.find(a => a.id === q.id);
    return `${statusTabs('tab', tabs.map(t => [t, all.filter(a => t === 'All' || a.status === t).length]), tab)}
    <div class=filters>${selectQ('type', [['', 'All types'], ...types], q.type || '', 'Type')}<span class=sp></span><span class=src>Items you entered cannot be approved by you — they route to another checker.</span></div>
    ${one ? approvalCard(one) : ''}
    ${table('t21', [
      { h: '', w: '32px', v: a => a.status === 'Pending' && can('treasury.approve') && a.makerKey !== myKey() ? `<input type=checkbox data-apr="${esc(a.id)}" aria-label="Select ${esc(a.id)}">` : '', csv: false },
      { h: 'Item', v: a => `<a href="#/T-21?${new URLSearchParams({ ...q, id: a.id })}">${esc(a.id)}</a>${a.version > 1 ? `<span class=sm>v${a.version}</span>` : ''}`, csv: a => a.id },
      { h: 'Type', v: a => esc(a.type) }, { h: 'What', v: a => esc(a.title), cls: 'wrap' },
      { h: 'Amount', num: true, v: a => a.amount != null ? (a.currency === 'INR' ? inr(a.amount) : fcy(a.amount, a.currency || '')) : '—', csv: a => a.amount },
      { h: 'Maker', v: a => esc(a.maker) }, { h: 'Age', v: a => `${dur(a.age)}${a.breach ? ' ' + pill('Past SLA', 'bad') : ''}`, csv: a => a.age },
      { h: 'Status', v: a => st(a.status) + (a.reason ? `<span class=sm>${esc(a.reason)}</span>` : ''), csv: a => a.status },
      { h: '', cls: 'acts', csv: false, v: a => a.status === 'Pending' && can('treasury.approve') ? (a.makerKey === myKey() ? '<span class=why>Your entry</span>' : lnk('Approve', 'apr-ok', { id: a.id }) + ' · ' + lnk('Reject', 'apr-no', { id: a.id }, 'danger'))
        : a.status === 'Rejected' && a.makerKey === myKey() && !readOnly() ? lnk('Resubmit', 'apr-resubmit', { id: a.id }) : '' },
    ], rows, { name: 'Approvals', noun: 'item', empty: tab === 'Pending' ? 'Nothing waiting for approval.' : 'None.' })}`;
  } });
act('apr-bulk', () => {
  const ids = $$('[data-apr]').filter(c => c.checked).map(c => c.dataset.apr);
  if (!ids.length) { toast('Tick the items to reject.', 'warn'); return; }
  cmdDlg({ title: `Reject ${plural(ids.length, 'item')}`, ok: 'Reject all', okClass: 'danger', body: reasonBody('One reason goes to every maker.', 'Rejection reason') }, 'approval.bulkReject', () => ({ ids, reason: $('#dlg-reason').value }));
});

/* ---------- T-22 reports ------------------------------------------------------------------------ */
screen({ id: 'T-22', title: 'Reports',
  sub: () => `Registers for the day and the book &nbsp;·&nbsp; each exports as CSV`,
  render(q) {
    const now = NOW();
    const rep = q.r || 'positions';
    const R = {
      positions: () => table('r-pos', [{ h: 'Position', v: p => esc(p.id) }, { h: 'Channel', v: p => esc(p.channel) }, { h: 'Branch', v: p => esc(node(p.branchId)) }, { h: 'Customer', v: p => esc(p.customerName || '') },
        { h: 'Product', v: p => esc(p.product) }, { h: 'CCY', k: 'currency' }, { h: 'Side', v: p => esc(p.side) }, { h: 'Amount', num: true, v: p => num(p.amount, p.currency) },
        { h: 'Rate', num: true, v: p => rate(p.customerRate) }, { h: 'Base', num: true, v: p => rate(p.refRate) }, { h: 'Linked', num: true, v: p => num(p.linkedAmount || 0, p.currency) },
        { h: 'Released', num: true, v: p => num(p.cancelledAmount || 0, p.currency) }, { h: 'Covered', num: true, v: p => num(p.covered || 0, p.currency) }, { h: 'Status', v: p => esc(posStatus(p)) },
        { h: 'Booked', v: p => istDT(p.bookedAt), csv: p => p.bookedAt }], sortByBooked(DB.positions || []), { name: 'Position register', noun: 'position' }),
      covers: () => table('r-cov', [{ h: 'Cover', k: 'id' }, { h: 'Type', v: c => esc(c.type || 'Spot') }, { h: 'Bank', v: c => esc(c.counterparty) }, { h: 'Side', k: 'side' }, { h: 'CCY', k: 'currency' },
        { h: 'Amount', num: true, v: c => num(c.amount, c.currency) }, { h: 'Rate', num: true, v: c => rate(c.rate) }, { h: 'Allocated', num: true, v: c => num(c.allocated || 0, c.currency) },
        { h: 'Settled', num: true, v: c => num(c.settled || 0, c.currency) }, { h: 'Value date', k: 'valueDate' }, { h: 'Status', k: 'status' }], DB.covers || [], { name: 'Cover deal register', noun: 'deal' }),
      allocations: () => table('r-al', [{ h: 'Allocation', k: 'id' }, { h: 'Kind', k: 'kind' }, { h: 'Source', v: x => esc(x.coverId || x.crossId) }, { h: 'Position', k: 'positionId' },
        { h: 'Amount', num: true, v: x => num(x.amount) }, { h: 'Rate', num: true, v: x => rate(x.rate) }, { h: 'Status', k: 'status' }, { h: 'At', v: x => istDT(x.at), csv: x => x.at }], DB.coverAllocations || [], { name: 'Allocation register', noun: 'allocation' }),
      deals: () => table('r-deal', [{ h: 'Deal', k: 'id' }, { h: 'Customer', v: d => esc(smeName(d.smeId)) }, { h: 'Side', k: 'side' }, { h: 'CCY', k: 'currency' }, { h: 'Amount', num: true, v: d => num(d.amount, d.currency) },
        { h: 'Rate', num: true, v: d => rate(d.rate) }, { h: 'Status', k: 'status' }, { h: 'Used on', v: d => esc(d.usedOn || '') }, { h: 'Issued', v: d => istDT(d.issuedAt), csv: d => d.issuedAt }, { h: 'By', v: d => esc(d.issuedBy || '') }], DB.deals || [], { name: 'FX deal register', noun: 'deal' }),
      approvals: () => table('r-apr', [{ h: 'Item', k: 'id' }, { h: 'Type', k: 'type' }, { h: 'Title', k: 'title' }, { h: 'Maker', k: 'maker' }, { h: 'Checker', v: a => esc(a.checker || '') },
        { h: 'Status', k: 'status' }, { h: 'Reason', v: a => esc(a.reason || '') }, { h: 'Submitted', v: a => istDT(a.submittedAt), csv: a => a.submittedAt }, { h: 'Decided', v: a => a.decidedAt ? istDT(a.decidedAt) : '', csv: a => a.decidedAt || '' }], DB.approvals || [], { name: 'Approvals log', noun: 'item' }),
      events: () => table('r-ev', [{ h: 'Event', k: 'id' }, { h: 'Type', k: 'type' }, { h: 'At', v: e => istDT(e.at), csv: e => e.at }, { h: 'Position', k: 'positionId' }, { h: 'Request', v: e => esc(e.recordId || '') },
        { h: 'Customer', v: e => esc(evCustomer(e)) }, { h: 'Side', k: 'side' }, { h: 'Amount', num: true, v: e => fcy(e.amount, e.currency) }, { h: 'Rate', num: true, v: e => rate(e.rate) }], eventsNewest(), { name: 'Trade-to-treasury events', noun: 'event' }),
      pnl: () => table('r-pnl', [{ h: 'Position', k: 'positionId' }, { h: 'CCY', k: 'currency' }, { h: 'Side', k: 'side' }, { h: 'Day', k: 'day' }, { h: 'Amount', num: true, v: r => num(r.amount, r.currency) },
        { h: 'Sales margin', num: true, v: r => inrN(r.sales) }, { h: 'Realised', num: true, v: r => inrN(r.realised) }, { h: 'Unrealised', num: true, v: r => inrN(r.unrealised) }, { h: 'Total', num: true, v: r => inrN(r.total) }], TR.pnl(DB, now).rows, { name: 'P&L by position', noun: 'position' }),
    };
    const names = { positions: 'Position register', covers: 'Cover deals', allocations: 'Allocations', deals: 'FX deals', approvals: 'Approvals log', events: 'Trade events', pnl: 'P&L by position' };
    return `<div class=filters>${chips('r', Object.entries(names), rep)}<span class=sp></span>${golink('Card pending settlement MIS', 'T-23')}</div>${(R[rep] || R.positions)()}`;
  } });

/* ---------- T-24 rate desk -------------------------------------------------------------------- */
screen({ id: 'T-24', title: 'Rate desk — base rates and card rate',
  sub: () => `The base rate is the reference trade pricing is built on; the card rate is the ceiling a branch may sell at (the floor it may buy at) &nbsp;·&nbsp; nothing publishes until a checker approves &nbsp;·&nbsp; no card rate, no quote and no trade booking`,
  acts: () => (can('tmp.rates') ? btn('Re-import now', 'rd-import', null, 'sec') + btn('Propose rates', 'rd-propose') : '') + (can('tmp.admin') ? btn('Add product line', 'rd-product', null, 'sec') : ''),
  render(q) {
    const now = NOW();
    const prods = (DB.tmpProducts || []).filter(p => p.status !== 'Inactive');
    const pend = pendingApprovals().filter(a => a.type === 'Card rate');
    const unpub = (DB.rateDesk || []).filter(r => r.status !== 'Published');
    const ibr = (DB.integrations || []).find(i => i.id === 'IBR');
    return `${pend.length ? banner('warn', `${plural(pend.length, 'rate revision')} waiting for a checker`, `<br>${pend.map(a => `${esc(a.id)} — ${esc(a.title)} (${esc(a.maker)}, ${ago(a.submittedAt)})`).join('<br>')}. The current rates stay live until approved. ${golink('Open approvals', 'T-21', { type: 'Card rate' })}`) : ''}
    ${unpub.length ? banner('bad', `${plural(unpub.length, 'card rate')} not published`, `<br>${unpub.map(r => `${esc(prodName(r.product))} ${esc(r.currency)}`).join(', ')} — nothing can be quoted${unpub.some(r => ['REM', 'INW'].includes(r.product)) ? ' or booked in the trade portal' : ''} there.`) : ''}
    ${table('t24', [
      { h: 'Currency', v: c => `<b>${esc(c.code)}</b><span class=sm>${esc(c.name || '')}</span>`, csv: c => c.code },
      { h: 'Base (published)', num: true, v: c => `<b>${rate(c.refRate)}</b><span class=sm>${c.publishedAt ? ist(c.publishedAt) : ''}</span>`, csv: c => c.refRate },
      { h: 'Imported base', num: true, v: c => rate(c.importedBase) + `<span class=sm>${c.importedAt ? ago(c.importedAt) : ''}</span>`, csv: c => c.importedBase },
      { h: 'IBR now', num: true, v: c => rate(TR.marketRate(DB, c.code, now)) },
      ...prods.map(p => ({ h: esc(p.name), num: true, csv: c => { const r = V.deskRow(DB, p.code, c.code); return r && r.status === 'Published' ? r.card : 'Not published'; },
        v: c => { const r = V.deskRow(DB, p.code, c.code); if (!r) return '—';
          const cell = r.status === 'Published' ? `${rate(r.card)}<span class=sm>${p.sides.includes('SELL') ? '+' : '−'}${rate(Math.abs(r.card - c.refRate))}${r.pendingId ? ' · ' + esc(r.pendingId) : ''}</span>` : `<span class=v-bad>Not published</span>${r.pendingId ? `<span class=sm>${esc(r.pendingId)}</span>` : ''}`;
          return can('tmp.rates') && !readOnly() ? `<button type=button class=lnk style="font-weight:normal;text-align:right" data-act="rd-propose" data-p="${esc(p.code)}" data-c="${esc(c.code)}">${cell}</button>` : cell; } })),
    ], DB.currencies || [], { title: 'Base and card rates — select a card rate to revise it', name: 'Rate desk', noun: 'currency' })}
    <p class=small>IBR source: ${ibr ? `${esc(ibr.transport)} — ${st(ibr.status)} ${fresh(freshOf(ibr.lastSuccess, 10, 60), ibr.lastSuccess)}` : '—'} &nbsp;·&nbsp; Trade portal pricing: <b>outward</b> uses the base ± the customer’s approved margin and needs the <b>Outward remittance</b> card rate published; <b>inward</b> conversions need <b>Inward remittance</b>.</p>
    ${table('t24-h', [{ h: 'Revision', v: a => esc(a.id) }, { h: 'What', v: a => esc(a.title) + `<span class=sm>${(a.diff || []).map(d => `${d.field}: ${d.before} → ${d.after}`).join('; ')}</span>`, cls: 'wrap' },
      { h: 'Maker', v: a => esc(a.maker) }, { h: 'Checker', v: a => esc(a.checker || '—') }, { h: 'Status', v: a => st(a.status) }, { h: 'When', v: a => istDT(a.decidedAt || a.submittedAt), csv: a => a.decidedAt || a.submittedAt }],
      (DB.approvals || []).filter(a => a.type === 'Card rate').slice(0, 12), { title: 'Rate history', name: 'Rate history', noun: 'revision' })}`;
  } });
act('rd-import', () => run('rates.import', {}));
act('rd-propose', el => {
  const now = NOW();
  const prods = (DB.tmpProducts || []).filter(p => p.status !== 'Inactive');
  const rowsFor = el.dataset.p ? [[el.dataset.p, el.dataset.c]] : (DB.rateDesk || []).filter(r => r.status !== 'Published').map(r => [r.product, r.currency]);
  const list = rowsFor.length ? rowsFor : [['REM', 'USD']];
  const line = ([p, c], i) => {
    const cur = cur$(c), prod = prods.find(x => x.code === p) || {}, r = V.deskRow(DB, p, c) || {};
    const base = cur.importedBase || cur.refRate, sugg = r.status === 'Published' ? r.card : r.suggested || +(prod.sides.includes('SELL') ? base * (1 + prod.spreadPct / 100) : base * (1 - prod.spreadPct / 100)).toFixed(4);
    return `<tr><td>${esc(prod.name || p)}<span class=sm>${esc(c)} · IBR ${rate(TR.marketRate(DB, c, now))}</span></td>
      <td><input type=text data-rp="${i}" data-k=base data-p="${esc(p)}" data-c="${esc(c)}" value="${rate(base)}"></td><td><input type=text data-rp="${i}" data-k=card value="${rate(sugg)}"></td><td class=dim>${r.status === 'Published' ? rate(r.card) : 'Not published'}</td></tr>`;
  };
  cmdDlg({ title: 'Propose rates for publication', ok: 'Send to checker', wide: true, body: `<p class=small>The base changes the trade reference for that currency; each card rate keeps its spread over the base. The checker sees before and after.</p>
    <div class="tbl scroll"><table class=dt><thead><tr><th>Product / currency</th><th>Base</th><th>Card rate</th><th>Now</th></tr></thead><tbody>${list.map(line).join('')}</tbody></table></div>
    ${field('Reason', `<input type=text id=rp-reason placeholder="e.g. opening rates, intraday revision">`)}` },
  'rates.propose', () => ({ rows: $$('[data-k=base]').map(b => ({ product: b.dataset.p, currency: b.dataset.c, base: Number(b.value), card: Number(($(`[data-rp="${b.dataset.rp}"][data-k=card]`) || {}).value) })), reason: $('#rp-reason').value }));
});
act('rd-product', () => cmdDlg({ title: 'Add a product line', ok: 'Add', body: `<div class=fgrid>${field('Name', `<input type=text id=pa-name data-required>`, { req: true })}${field('Code', `<input type=text id=pa-code maxlength=4 placeholder="3 letters">`)}
  ${field('Sides', `<select id=pa-sides>${options([['SELL', 'Sell only'], ['BUY', 'Buy only'], ['BOTH', 'Sell and buy']])}</select>`)}${field('Rate basis', `<input type=text id=pa-basis value="Base rate + spread">`)}</div>` },
  'product.add', () => ({ name: $('#pa-name').value, code: $('#pa-code').value, sides: $('#pa-sides').value, basis: $('#pa-basis').value })));

/* ---------- T-26 amendments and reversals ----------------------------------------------------- */
screen({ id: 'T-26', title: 'Amendments and reversals',
  sub: () => `When FX Plus amends or reverses a linked bill, the position is unwound as a forward-dated adjustment — the original link is never rewritten`,
  render(q) {
    const all = (DB.amendments || []).slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const tabs = ['Action needed', 'With checker', 'Adjusted'];
    const tab = tabs.includes(q.tab) ? q.tab : 'Action needed';
    return `${statusTabs('tab', tabs.map(t => [t, all.filter(a => a.status === t).length]), tab)}
    ${table('t26', [{ h: 'Amendment', v: a => esc(a.id), cls: 'ref' }, { h: 'FX Plus bill', v: a => esc(a.fxpId) }, { h: 'Position', v: a => a.positionId ? posRef({ id: a.positionId }) : '—', csv: a => a.positionId },
      { h: 'Change', v: a => esc(a.change) + (a.valueDate ? `<span class=sm>value ${dmy(a.valueDate)}</span>` : '') }, { h: 'Before', num: true, v: a => num(a.before) }, { h: 'After', num: true, v: a => num(a.after) },
      { h: 'Cover to release', num: true, v: a => num(a.coverReleased || 0) }, { h: 'Raised', v: a => `${istDT(a.at)}<span class=sm>${esc(a.by || '')}</span>`, csv: a => a.at },
      { h: 'Status', v: a => st(a.status) + (a.adjustedBy ? `<span class=sm>${esc(a.adjustedBy)}</span>` : '') },
      { h: '', cls: 'acts', csv: false, v: a => a.status === 'Action needed' && can('tmp.amend') ? lnk('Preview and apply', 'am-apply', { id: a.id }) + ' · ' + lnk('Send to checker', 'am-check', { id: a.id }) : '' }],
      all.filter(a => a.status === tab), { name: 'Amendments', noun: 'amendment', empty: 'Nothing here.' })}`;
  } });
act('am-apply', el => { const a = (DB.amendments || []).find(x => x.id === el.dataset.id); const p = a.positionId && posFind(a.positionId);
  cmdDlg({ title: `Apply ${esc(a.id)}`, ok: 'Apply adjustment', body: `<div class=impact><b>Impact</b>${esc(a.change)} on ${esc(a.fxpId)}: ${num(a.before)} → ${num(a.after)}.
    ${p ? `${esc(p.id)} linked ${fcy(p.linkedAmount || 0, p.currency)} → ${fcy(Math.max(0, (p.linkedAmount || 0) - (a.before - a.after)), p.currency)}${p.status === 'Concluded' ? '; the difference is released and cover above the live amount returns to the pool' : '; the difference is open to link again'}.` : ''}</div>
    <p class=small>Applied as a forward-dated adjustment. The original link stays on record.</p>` }, 'amend.apply', { id: a.id }); });
act('am-check', el => run('amend.toChecker', { id: el.dataset.id }));

/* ---------- T-27 quote-to-bill drift ------------------------------------------------------------ */
screen({ id: 'T-27', title: 'Quote-to-bill drift',
  sub: () => `Time from booking to the first FX Plus bill, and the gap between the committed rate and the billed rate &nbsp;·&nbsp; a signal to investigate, not a verdict`,
  render(q) {
    const by = ['branch', 'product', 'user'].includes(q.by) ? q.by : 'branch';
    const d = V.drift(DB, NOW(), by);
    return `${strip([{ v: d.n, l: 'Deals with a bill' }, { v: dur(d.groupMedian), l: 'Median time to first bill' }, { v: inrL(d.impact), l: 'Rate drift impact (INR)', kind: d.impact < 0 ? 'alert' : '' }])}
    <div class=filters>${chips('by', [['branch', 'By branch'], ['product', 'By product'], ['user', 'By user']], by)}</div>
    ${table('t27', [{ h: by === 'user' ? 'User' : by === 'product' ? 'Product' : 'Branch', v: r => esc(r.key) }, { h: 'Deals', num: true, v: r => r.n },
      { h: 'Median to first bill', num: true, v: r => dur(r.median) }, { h: 'Mean rate drift', num: true, v: r => rate(r.meanDrift) }, { h: 'Worst drift', num: true, v: r => rate(r.worst) },
      { h: 'Impact (INR)', num: true, v: r => inrN(r.impact) }, { h: 'Signal', v: r => st(r.signal) }], d.rows, { name: 'Quote-to-bill drift', noun: 'group' })}`;
  } });

/* ---------- T-28 trade desk: where the trade portal meets treasury ------------------------------ */
screen({ id: 'T-28', title: 'Trade desk',
  sub: () => `Trade portal bookings and FX deals for trade customers &nbsp;·&nbsp; a booking is a position the moment it is made; UTR and FIRC conclude it &nbsp;·&nbsp; deals issued here are applied by AD2 in the trade portal`,
  acts: () => can('treasury.deal') ? btn('Issue FX deal', 'td-issue') : '',
  render(q) {
    const now = NOW(), day = todayIST();
    const tp = sortByBooked(tradePos());
    const deals = (DB.deals || []).slice().sort((a, b) => String(b.issuedAt).localeCompare(String(a.issuedAt)));
    const tabs = ['Open', 'Attached', 'Held', 'Concluded', 'Cancelled', 'All'];
    const tab = tabs.includes(q.tab) ? q.tab : 'Open';
    const stt = p => posStatus(p) === 'Expired' ? 'Cancelled' : posStatus(p);
    const rows = tp.filter(p => tab === 'All' || stt(p) === tab);
    return `${strip([{ v: tp.filter(p => p.status === 'Open').length, l: 'Booked, not yet submitted' }, { v: tp.filter(p => p.status === 'Attached').length, l: 'Attached — awaiting UTR / FIRC' },
      { v: tp.filter(p => p.status === 'Concluded' && V.istDate(p.linkedAt || '') === day).length, l: 'Concluded today' }, { v: deals.filter(d => d.status === 'Issued').length, l: 'FX deals ready to apply' },
      { v: tp.filter(p => p.status === 'Held').length, l: 'Held on limits', kind: tp.some(p => p.status === 'Held') ? 'alert' : '' }])}
    ${table('t28-deals', [{ h: 'Deal', v: d => esc(d.id), cls: 'ref' }, { h: 'Customer', v: d => esc(smeName(d.smeId)) }, { h: 'Deal', v: d => `${side(d.side)} ${fcy(d.amount, d.currency)}`, csv: d => `${d.side} ${d.amount} ${d.currency}` },
      { h: 'Rate', num: true, v: d => rate(d.rate) + `<span class=sm>base ${rate(d.refRate)}</span>`, csv: d => d.rate }, { h: 'Valid until', v: d => d.status === 'Issued' ? clock(d.validUntil) : `<span class=dim>${istDT(d.validUntil)}</span>`, csv: d => d.validUntil },
      { h: 'Status', v: d => st(d.status) + (d.usedOn ? `<span class=sm>applied to ${esc(d.usedOn)}</span>` : ''), csv: d => d.status }, { h: 'Position', v: d => posRef({ id: d.positionId }), csv: d => d.positionId },
      { h: 'Issued', v: d => `<span class=dim>${istDT(d.issuedAt)}</span><span class=sm>${esc(d.issuedBy || '')}${d.note ? ' — ' + esc(d.note) : ''}</span>`, cls: 'wrap', csv: d => d.issuedAt },
      { h: '', cls: 'acts', csv: false, v: d => d.status === 'Issued' && can('treasury.deal') ? lnk('Withdraw', 'td-withdraw', { id: d.id }, 'danger') : '' }], deals.slice(0, 20), { title: 'FX deal references', name: 'FX deals', noun: 'deal' })}
    ${statusTabs('tab', tabs.map(t => [t, tp.filter(p => t === 'All' || stt(p) === t).length]), tab)}
    ${table('t28-pos', [{ h: 'Position', v: p => posRef(p), csv: p => p.id, cls: 'ref' }, { h: 'Customer', v: p => esc(p.customerName || smeName(p.smeId)) + `<span class=sm>${esc(node(p.branchId))}</span>` },
      { h: 'Channel', v: p => esc(p.channel) }, { h: 'Request', v: p => { const r = tradeRecord(p); return r ? `${esc(r.id)}<span class=sm>${esc(r.status)}${r.utr ? ' · ' + esc(r.utr) : r.firc ? ' · ' + esc(r.firc) : ''}</span>` : p.dealId ? `<span class=dim>deal ${esc(p.dealId)}</span>` : '<span class=dim>not submitted</span>'; }, csv: p => p.recordId || '' },
      { h: 'Side', v: p => side(p.side) }, { h: 'Amount', num: true, v: p => fcy(p.amount, p.currency) }, { h: 'Customer rate', num: true, v: p => rate(p.customerRate) + `<span class=sm>base ${rate(p.refRate)} · ${p.margin} p</span>`, csv: p => p.customerRate },
      { h: 'Txn link', v: p => st(V.linkTrack(DB, p, now)) }, { h: 'Cover', v: p => st(V.coverTrack(p)) }, { h: 'Booked', v: p => `<span class=dim>${istDT(p.bookedAt)}</span>`, csv: p => p.bookedAt }],
      rows, { name: 'Trade positions', noun: 'position' })}`;
  } });
act('td-issue', () => {
  const smes = (DB.smes || []).filter(s => s.status === 'Approved');
  const usd = cur$('USD').refRate;
  cmdDlg({ title: 'Issue an FX deal reference', ok: 'Issue deal', body: `<p class=small>The rate agreed with the customer’s treasury. Issuing puts the exposure on the book at once; AD2 applies the reference to the customer’s request in the trade portal.</p>
    <div class=fgrid>${field('Trade customer', `<select id=di-sme data-required><option value="">Choose…</option>${options(smes.map(s => [s.id, `${s.tradingName} (${s.id})`]))}</select>`, { req: true })}
    ${field('Direction', `<select id=di-dir>${options([['out', 'Outward payment — company sells'], ['in', 'Inward conversion — company buys']])}</select>`)}
    ${field('Currency', `<select id=di-cur data-change="di-cur">${options(CURS(), 'USD')}</select>`)}${field('Amount', `<input type=text id=di-amt data-required inputmode=decimal>`, { req: true })}
    ${field('Agreed rate', `<input type=text id=di-rate data-required value="${rate(usd + 0.3)}">`, { req: true, hint: `Base <span id=di-base>${rate(usd)}</span> · within 3%` })}${field('Valid for (hours)', `<input type=text id=di-h value="24">`)}</div>${field('Note', `<input type=text id=di-note placeholder="e.g. agreed by phone with the customer’s CFO">`)}` },
  'deal.issue', () => ({ smeId: $('#di-sme').value, dir: $('#di-dir').value, currency: $('#di-cur').value, amount: Number($('#di-amt').value.replace(/,/g, '')), rate: Number($('#di-rate').value), validHours: Number($('#di-h').value), note: $('#di-note').value }));
});
act('di-cur', el => { const b = cur$(el.value).refRate; $('#di-base').textContent = rate(b); $('#di-rate').value = rate(b + ($('#di-dir').value === 'out' ? 0.3 : -0.3)); });
act('td-withdraw', el => cmdDlg({ title: `Withdraw ${esc(el.dataset.id)}`, ok: 'Withdraw', okClass: 'danger', body: reasonBody('The position is cancelled; AD2 can no longer apply the reference.') }, 'deal.withdraw', () => ({ id: el.dataset.id, reason: $('#dlg-reason').value })));
