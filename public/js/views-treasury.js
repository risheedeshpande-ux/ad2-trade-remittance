/* ==========================================================================
   Treasury workspace — the desk, rate desk, positions, bank cover and
   allocation, exceptions, FX deal references, P&L and the integration log.
   Every figure comes from Engine.treasury, the same functions the server
   uses, so the screens and the server always agree.

   Rules carried over from the TMP design:
   - a position's settlement and its cover are two separate columns;
   - currencies are never totalled together (INR P&L is, and says so);
   - suggestions are rules, shown with the rule, and never act by themselves;
   - a blocked action stays visible with the reason.
   ========================================================================== */
const TR = () => Engine.treasury;
const r4s = n => Number(n || 0).toFixed(4);
const sideWord = s => s === 'SELL' ? 'Sale' : 'Purchase';
const sideHint = s => s === 'SELL' ? 'outward — AD2 sells' : 'inward — AD2 buys';
const signedInr = n => `<span style="color:${n < 0 ? 'var(--r4m-danger, #c0392b)' : n > 0 ? 'var(--r4m-success, #1e8e5a)' : 'inherit'}">${n < 0 ? '− ' : ''}${inr(Math.abs(n))}</span>`;
const hoursLeft = iso => { const min = Math.floor((new Date(iso) - new Date()) / 60000); return min <= 0 ? 'expired' : min < 60 ? min + ' min left' : Math.floor(min / 60) + 'h ' + (min % 60) + 'm left'; };
const isDealer = () => can('treasury.deal');
const isTChecker = () => can('treasury.approve');
const posStatus = p => TR().positionStatus(p, nowISO());
const custName = id => sme(id)?.tradingName || id;
const recWord = p => p.recordId ? `${p.recordId}${p.recordKind === 'outward' ? ' · ' + (outwardRec(p.recordId)?.status || '') : p.recordKind === 'disposal' ? ' · ' + (disposalRec(p.recordId)?.status || '') : ''}` : (p.dealId ? 'Deal ' + p.dealId : 'Not yet submitted');
Object.assign(BADGE, { 'Open':'b-blue', 'Attached':'b-purple', 'Concluded':'b-green', 'Cancelled':'b-grey', 'Expired':'b-red',
  'Covered':'b-green', 'Partial':'b-amber', 'Uncovered':'b-red', 'Linked':'b-green', 'Awaiting settlement':'b-purple', 'Not submitted':'b-grey',
  'Active':'b-teal', 'Pending Approval':'b-purple', 'Issued':'b-blue', 'Used':'b-green', 'Withdrawn':'b-grey', 'Applied':'b-green',
  'Superseded':'b-grey', 'Delivered':'b-green' });

function coverBar(p) {
  const live = TR().live(p), c = p.covered || 0;
  if (p.status === 'Cancelled' || live <= 0) return '<span style="color:var(--muted)">—</span>';
  const pct = Math.min(100, Math.round(c / live * 100));
  return `${badge(TR().coverState(p))}<div style="height:4px;background:#e6ebef;border-radius:2px;margin-top:4px;max-width:120px" aria-hidden="true">
    <div style="height:4px;width:${pct}%;background:var(--r4m-primary-500);border-radius:2px"></div></div>
    <small style="color:var(--muted)">${money(c)} of ${money(live)}</small>`;
}

/* ---------- router ----------------------------------------------------------- */
function viewTreasury(section, arg) {
  const q = new URLSearchParams((location.hash.split('?')[1]) || '');
  switch (section || 'desk') {
    case 'desk':       return viewTrDesk();
    case 'rates':      return viewTrRates();
    case 'positions':  return arg ? viewTrPosition(arg) : viewTrPositions();
    case 'cover':      return viewTrCover();
    case 'allocate':   return viewTrAllocate(q.get('src'));
    case 'exceptions': return viewTrExceptions();
    case 'deals':      return viewTrDeals();
    case 'pnl':        return viewTrPnl();
    case 'events':     return viewTrEvents();
    case 'approvals':  return viewTrApprovals();
    default: location.hash = '#/ad2/treasury'; return '';
  }
}
const trCrumb = (...p) => crumb('Treasury', ...p);

/* ---------- desk ---------------------------------------------------------------- */
function trApprovalsCount() {
  const me = myKey();
  return (DB.rateRevisions || []).filter(r => r.status === 'Proposed' && r.proposedByKey !== me).length
       + (DB.covers || []).filter(c => c.status === 'Pending Approval' && c.enteredByKey !== me).length;
}
function netTable(withActions) {
  const now = nowISO(), net = Object.values(TR().netByCurrency(DB, now));
  const sugg = TR().suggestions(DB, now);
  if (!net.length) return empty('The book is flat', 'Every customer booking is covered and no cover is left unallocated.');
  return `<div class="tablewrap"><table class="dt">
    <thead><tr><th>Currency</th><th class="num">Sales uncovered</th><th class="num">Purchases uncovered</th><th class="num">Unallocated cover</th>
      <th class="num">Net position</th><th>Suggested next step <small style="font-weight:400;color:var(--muted)">— rules, never automatic</small></th></tr></thead>
    <tbody>${net.sort((a, b) => Math.abs(b.net) - Math.abs(a.net)).map(r => {
      const mine = sugg.filter(s => s.currency === r.currency);
      const unal = r.coverBuy - r.coverSell;
      return `<tr><td><b>${esc(r.currency)}</b></td>
        <td class="num">${r.sell ? money(r.sell) : '—'}</td><td class="num">${r.buy ? money(r.buy) : '—'}</td>
        <td class="num">${unal ? (unal > 0 ? 'bought ' : 'sold ') + money(Math.abs(unal)) : '—'}</td>
        <td class="num"><b>${Math.abs(r.net) < 0.005 ? 'flat' : (r.net < 0 ? 'short ' : 'long ') + money(Math.abs(r.net))}</b></td>
        <td style="min-width:300px">${mine.map(s => `<div style="margin:4px 0;line-height:1.35">${esc(s.text)}<small style="display:block;color:var(--muted)">Rule: ${esc(s.rule)}</small>
          ${withActions && isDealer() ? (s.kind === 'cover'
            ? ` <button class="btn btn-link" type="button" data-act="tr-cover-new" data-cur="${esc(s.currency)}" data-side="${s.side}" data-amt="${s.amount}">Enter cover deal</button>`
            : ` <button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/treasury/allocate?src=${esc(s.source)}">${s.kind === 'cross' ? 'Cross' : 'Allocate'}</button>`) : ''}</div>`).join('') || '<span style="color:var(--muted)">—</span>'}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="hint" style="padding:10px 16px;margin:0;color:var(--muted);font-size:var(--fs-xs)">Each currency is shown on its own — currencies are never added together. Short means customers have bought more than treasury has covered.</p>`;
}
function ratesMini() {
  const now = nowISO();
  return `<div class="tablewrap"><table class="dt"><thead><tr><th>Currency</th><th class="num">Published</th><th class="num">Market${DB.settings.marketSim === false ? '' : ' <small>(simulated)</small>'}</th><th class="num">Gap</th></tr></thead>
    <tbody>${DB.currencies.map(c => { const m = TR().marketRate(DB, c.code, now), g = m ? (c.refRate - m) / m * 100 : 0;
      return `<tr><td><b>${esc(c.code)}</b></td><td class="num">${r4s(c.refRate)}</td><td class="num">${r4s(m)}</td>
        <td class="num" style="color:${Math.abs(g) > 0.3 ? 'var(--r4m-danger, #c0392b)' : 'inherit'}">${g >= 0 ? '+' : ''}${g.toFixed(2)}%</td></tr>`; }).join('')}</tbody></table></div>`;
}
function viewTrDesk() {
  const now = nowISO(), T = TR();
  const pos = DB.positions || [];
  const open = pos.filter(p => ['Open', 'Attached'].includes(T.positionStatus(p, now)));
  const exc = T.exceptions(DB, now);
  const pl = T.pnl(DB, now);
  const today = T.istDate(now);
  const plToday = pl.rows.filter(r => r.day === today).reduce((t, r) => t + r.total, 0);
  const cutPassed = T.pastCutoff(DB, now);
  const n = trApprovalsCount();
  const evts = (DB.tmsEvents || []).slice(0, 8);
  return shell(trCrumb('Desk'), `
    <div class="page-head"><div><h1>Treasury desk</h1>
      <p>Every customer booking lands here the moment it is made. Cover it from a bank, cross it against an opposite booking, and watch it settle.
        ${isDealer() ? '' : isTChecker() ? 'You approve rate revisions and cover deals — never your own.' : 'Read-only oversight.'}</p></div>
      <div class="acts">
        ${isDealer() ? `<button class="btn btn-primary" type="button" data-act="tr-cover-new">Enter cover deal</button>
          <button class="btn btn-ghost" type="button" data-act="tr-deal-new">Issue deal reference</button>
          <button class="btn btn-plain" type="button" data-act="go" data-href="#/ad2/treasury/rates">Rate desk</button>` : ''}
        ${isTChecker() ? `<button class="btn btn-primary" type="button" data-act="go" data-href="#/ad2/treasury/approvals">Approvals${n ? ' (' + n + ')' : ''}</button>` : ''}
      </div></div>
    <div class="note ${cutPassed ? 'note-warn' : 'note-info'}" style="margin-bottom:16px"><span>
      Cut-off ${esc(DB.settings.cutoff || '16:00')} IST ${cutPassed ? '<b>has passed</b> — anything still uncovered is listed under exceptions. Nothing is cancelled: customers keep their 48-hour lock.' : 'is later today. Uncovered positions are flagged after it, never cancelled.'}</span></div>
    <div class="grid g4" style="margin-bottom:20px">
      ${kpi('Live positions', open.length, { go:'#/ad2/treasury/positions', tone:'accent', delta: open.filter(p => p.status === 'Open').length + ' booked, not yet submitted' })}
      ${kpi('Currencies not flat', Object.values(T.netByCurrency(DB, now)).filter(r => Math.abs(r.net) > 0.005).length, { go:'#/ad2/treasury', tone: cutPassed ? 'warn' : '' })}
      ${kpi('Exceptions', exc.length, { go:'#/ad2/treasury/exceptions', tone: exc.length ? 'warn' : '' })}
      ${isTChecker() ? kpi('Waiting for your approval', n, { go:'#/ad2/treasury/approvals', tone: n ? 'accent' : '' })
        : kpi('P&L on today’s bookings', inr(plToday), { go:'#/ad2/treasury/pnl', delta:'Book total ' + inr(pl.totals.total) })}
    </div>
    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>Net open position</h2>
      <div class="acts"><button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/treasury/positions">All positions</button></div></div>
      <div class="card-body tight">${netTable(true)}</div></div>
    <div class="grid g2">
      <div class="card"><div class="card-head"><h2>Published rate vs market</h2>
        <div class="acts"><button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/treasury/rates">Rate desk</button></div></div>
        <div class="card-body tight">${ratesMini()}</div></div>
      <div class="card"><div class="card-head"><h2>From trade, just now</h2>
        <div class="acts"><button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/treasury/events">Integration log</button></div></div>
        <div class="card-body">${evts.length ? evts.map(e => `<div class="tl" style="padding-left:0"><div class="act">${esc(eventLine(e))}</div>
          <div class="meta">${esc(e.id)} · ${dmyt(e.at)}</div></div>`).join('') : empty('Nothing yet', 'Bookings from the trade platform appear here.')}</div></div>
    </div>`);
}
function eventLine(e) {
  const what = { 'position.opened': 'booked', 'position.attached': 'attached to ' + (e.recordId || ''), 'position.linked': 'settled — ' + (e.ref || ''),
    'position.cancelled': 'cancelled' + (e.reason ? ' — ' + e.reason : '') }[e.type] || e.type;
  return `${e.positionId} ${custName(e.smeId)} ${sideWord(e.side).toLowerCase()} ${money(e.amount, e.currency)} ${what}`;
}

/* ---------- rate desk ----------------------------------------------------------- */
function viewTrRates() {
  const now = nowISO(), me = myKey();
  const pending = (DB.rateRevisions || []).find(r => r.status === 'Proposed');
  const band = DB.settings.rateBand ?? 2;
  return shell(trCrumb('Rate desk'), `
    <div class="page-head"><div><h1>Rate desk</h1>
      <p>The reference rate for each currency. A customer's rate is this reference plus (for payments) or minus (for receipts) its approved margin.
        A revision goes to a treasury checker; bookings already made keep the rate they were booked at.</p></div></div>
    ${pending ? revisionCard(pending, me) : ''}
    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>Published rates</h2></div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Currency</th><th class="num">Published</th><th>Published at</th><th class="num">Market${DB.settings.marketSim === false ? '' : ' (simulated)'}</th><th class="num">Gap</th>
          ${isDealer() ? '<th class="num">Propose</th>' : ''}</tr></thead>
        <tbody>${DB.currencies.map(c => { const m = TR().marketRate(DB, c.code, now), g = m ? (c.refRate - m) / m * 100 : 0;
          return `<tr><td><b>${esc(c.code)}</b> <small style="color:var(--muted)">${esc(c.name)}</small></td><td class="num">${r4s(c.refRate)}</td>
            <td>${dmyt(c.publishedAt)}</td><td class="num">${r4s(m)}</td><td class="num">${g >= 0 ? '+' : ''}${g.toFixed(2)}%</td>
            ${isDealer() ? `<td class="num"><input type="number" step="0.0001" style="width:120px" data-rate="${esc(c.code)}" placeholder="${r4s(m)}" aria-label="New ${esc(c.code)} rate"></td>` : ''}</tr>`; }).join('')}</tbody>
      </table></div></div>
      ${isDealer() ? `<div class="formfoot" style="padding:14px 16px;display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <div class="f" style="flex:1;min-width:240px"><label for="rr-reason">Reason</label><input id="rr-reason" type="text" maxlength="200" placeholder="e.g. Dollar firmer after the RBI reference rate"></div>
        <button class="btn btn-ghost" type="button" data-act="tr-rate-market">Fill with market</button>
        <button class="btn btn-primary" type="button" data-act="tr-rate-propose">Send to checker</button>
        <p class="hint" style="width:100%;margin:0;color:var(--muted);font-size:var(--fs-xs)">Only changed rows are sent. A rate more than ${band}% from the published one is refused as a likely typing error.</p></div>` : ''}
    </div>
    <div class="card"><div class="card-head"><h2>Revision history</h2></div><div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Revision</th><th>Change</th><th>Proposed</th><th>Decided</th><th>Status</th></tr></thead>
      <tbody>${(DB.rateRevisions || []).map(r => `<tr><td class="id">${esc(r.id)}</td>
        <td>${Object.entries(r.rates).map(([k, v]) => `${esc(k)} ${r4s(r.before[k])} → <b>${r4s(v)}</b>`).join('<br>')}${r.reason ? `<br><small style="color:var(--muted)">${esc(r.reason)}</small>` : ''}</td>
        <td>${esc(r.proposedBy)}<br><small>${dmyt(r.proposedAt)}</small></td>
        <td>${r.approvedBy ? esc(r.approvedBy) + '<br><small>' + dmyt(r.approvedAt) + '</small>' : '—'}${r.rejectReason ? `<br><small>${esc(r.rejectReason)}</small>` : ''}</td>
        <td>${badge(r.status)}</td></tr>`).join('') || `<tr><td colspan="5">${empty('No revisions', '')}</td></tr>`}</tbody></table></div></div></div>`);
}
function revisionCard(r, me) {
  const own = r.proposedByKey === me;
  return `<div class="card" style="margin-bottom:20px;border-color:var(--r4m-primary-500)"><div class="card-head"><h2>Revision ${esc(r.id)} waiting for approval</h2>
    <div class="acts">${badge('Proposed')}</div></div><div class="card-body">
    <table class="advice-t review-t"><tr><th>Currency</th><td><b>Before → after</b></td></tr>
      ${Object.entries(r.rates).map(([k, v]) => { const d = (v - r.before[k]) / r.before[k] * 100;
        return `<tr><th>${esc(k)}</th><td>${r4s(r.before[k])} → <b>${r4s(v)}</b> <small style="color:var(--muted)">(${d >= 0 ? '+' : ''}${d.toFixed(3)}%)</small></td></tr>`; }).join('')}
      <tr><th>Reason</th><td>${esc(r.reason || '—')}</td></tr><tr><th>Proposed by</th><td>${esc(r.proposedBy)} · ${dmyt(r.proposedAt)}</td></tr></table>
    ${isTChecker() ? `<div style="display:flex;gap:8px;margin-top:14px;align-items:center">
      <button class="btn btn-primary" type="button" data-act="tr-rate-approve" data-id="${esc(r.id)}" ${own ? 'disabled' : ''}>Approve and publish</button>
      <button class="btn btn-plain" type="button" data-act="tr-rate-reject" data-id="${esc(r.id)}" ${own ? 'disabled' : ''}>Reject</button>
      ${own ? '<small style="color:var(--muted)">You proposed this revision, so another checker must decide it.</small>' : ''}</div>`
      : '<p style="margin:12px 0 0;color:var(--muted);font-size:var(--fs-sm)">With the treasury checker. Proposing again replaces it.</p>'}
  </div></div>`;
}

/* ---------- positions ------------------------------------------------------------ */
let trPosTab = 'Live', trPosCur = '', trSearch = '';
const POS_TABS = { Live: p => ['Open', 'Attached'].includes(posStatus(p)), 'Booked, not submitted': p => posStatus(p) === 'Open',
  'Awaiting settlement': p => posStatus(p) === 'Attached', Uncovered: p => TR().uncovered(p) > 0 && posStatus(p) !== 'Expired',
  Concluded: p => p.status === 'Concluded', Cancelled: p => ['Cancelled', 'Expired'].includes(posStatus(p)), All: () => true };
function viewTrPositions() {
  const all = DB.positions || [];
  let list = all.filter(POS_TABS[trPosTab] || POS_TABS.Live).filter(p => !trPosCur || p.currency === trPosCur);
  if (trSearch) { const q = trSearch.toLowerCase(); list = list.filter(p => (p.id + custName(p.smeId) + (p.recordId || '') + (p.dealId || '') + (p.linkRef || '')).toLowerCase().includes(q)); }
  const tabs = Object.keys(POS_TABS).map(t => `<button type="button" data-act="tr-postab" data-t="${esc(t)}" aria-selected="${t === trPosTab}">${esc(t)}
    <span class="n">${all.filter(POS_TABS[t]).length}</span></button>`).join('');
  const curs = [...new Set(all.map(p => p.currency))].sort();
  return shell(trCrumb('Positions'), `
    <div class="page-head"><div><h1>Positions</h1>
      <p>One row per customer booking or deal. <b>Settlement</b> (has the payment or FIRC gone out?) and <b>cover</b> (has treasury offset it?) are separate — a position can be covered with nothing settled, or settled with nothing covered.</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="tr-csv" data-what="positions">Export CSV</button></div></div>
    <div class="card"><div class="tabs">${tabs}</div>
      <div class="toolbar"><input type="search" placeholder="Search position, customer, request, deal or UTR" value="${esc(trSearch)}" data-act="tr-search" aria-label="Search positions">
        <select data-act="tr-poscur" aria-label="Currency"><option value="">All currencies</option>${curs.map(c => `<option ${c === trPosCur ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <div class="spacer"></div><span style="color:var(--muted);font-size:var(--fs-sm)">${list.length} of ${all.length}</span></div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Position</th><th>Customer</th><th>Side</th><th class="num">Amount</th><th class="num">Customer rate</th><th class="num">Reference</th>
          <th>Lifecycle</th><th>Settlement</th><th>Cover</th><th>Lock</th></tr></thead>
        <tbody>${list.length ? list.map(p => { const st = posStatus(p);
          return `<tr><td class="id" style="white-space:nowrap" data-act="go" data-href="#/ad2/treasury/positions/${esc(p.id)}">${esc(p.id)}</td>
            <td>${esc(custName(p.smeId))}<br><small style="color:var(--muted)">${esc(recWord(p))}</small></td>
            <td>${sideWord(p.side)}<br><small style="color:var(--muted)">${sideHint(p.side)}</small></td>
            <td class="num">${money(p.amount, p.currency)}${p.cancelledAmount && st !== 'Cancelled' ? `<br><small style="color:var(--muted)">${money(p.cancelledAmount)} released</small>` : ''}</td>
            <td class="num">${r4s(p.customerRate)}</td><td class="num">${r4s(p.refRate)}</td>
            <td>${badge(st)}</td><td>${badge(TR().linkState(p))}${p.linkRef ? `<br><small style="color:var(--muted)">${esc(p.linkRef)}</small>` : ''}</td>
            <td>${coverBar(p)}</td>
            <td>${st === 'Open' ? esc(hoursLeft(p.expiresAt)) : st === 'Attached' ? '<small>frozen at submission</small>' : '—'}</td></tr>`; }).join('')
          : `<tr><td colspan="10">${empty('No positions here', 'Nothing matches this tab and filter.')}</td></tr>`}</tbody></table></div></div></div>`);
}
function viewTrPosition(id) {
  const p = (DB.positions || []).find(x => x.id === id);
  if (!p) return shell(trCrumb('Positions', id), empty('Position not found', ''));
  const st = posStatus(p), T = TR();
  const allocs = (DB.coverAllocations || []).filter(x => x.positionId === p.id || x.crossId === p.id);
  const pl = T.pnl(DB, nowISO()).rows.find(r => r.positionId === p.id);
  const evts = (DB.tmsEvents || []).filter(e => e.positionId === p.id);
  if (p.status === 'Concluded') sessSet('ad2-guide-pnl', 1);
  return shell(trCrumb('Positions', p.id), `
    <div class="page-head"><div><h1>${esc(p.id)} ${badge(st)}</h1>
      <p>${esc(custName(p.smeId))} · ${sideWord(p.side)} of ${money(p.amount, p.currency)} (${sideHint(p.side)}) · ${p.source === 'Deal' ? 'deal ' + esc(p.dealId) : 'booked rate'}</p></div>
      <div class="acts">${isDealer() && T.uncovered(p) > 0 && !['Cancelled', 'Expired'].includes(st) ? `<button class="btn btn-primary" type="button" data-act="tr-cover-new" data-cur="${esc(p.currency)}" data-side="${p.side === 'SELL' ? 'BUY' : 'SELL'}" data-amt="${T.uncovered(p)}">Cover it</button>` : ''}
        <button class="btn btn-plain" type="button" data-act="go" data-href="#/ad2/treasury/positions">All positions</button></div></div>
    <div class="grid g2" style="margin-bottom:20px">
      <div class="card"><div class="card-head"><h2>Booking</h2></div><div class="card-body"><table class="advice-t review-t">
        <tr><th>Customer rate</th><td><b>${r4s(p.customerRate)}</b></td></tr><tr><th>Reference at booking</th><td>${r4s(p.refRate)} · margin ${esc(p.margin)} paise</td></tr>
        <tr><th>Booked</th><td>${dmyt(p.bookedAt)} by ${esc(p.bookedBy)}</td></tr>
        <tr><th>Lock</th><td>${st === 'Open' ? 'until ' + dmyt(p.expiresAt) + ' · ' + esc(hoursLeft(p.expiresAt)) : st === 'Attached' ? 'frozen — the request was submitted ' + dmyt(p.attachedAt) : st === 'Concluded' ? 'used' : esc(p.cancelReason || '—')}</td></tr>
        <tr><th>Request</th><td>${esc(recWord(p))}</td></tr>
        <tr><th>Settlement</th><td>${badge(T.linkState(p))} ${p.linkRef ? esc(p.linkRef) + ' · ' + dmyt(p.linkedAt) : ''}</td></tr>
        <tr><th>Invariant</th><td><small>booked ${money(p.amount)} = settled ${money(p.linkedAmount || 0)} + remaining ${money(p.amount - (p.linkedAmount || 0) - (p.cancelledAmount || 0))} + released ${money(p.cancelledAmount || 0)}</small></td></tr>
      </table></div></div>
      <div class="card"><div class="card-head"><h2>Cover and P&L</h2></div><div class="card-body">
        <div style="margin-bottom:12px">${coverBar(p)}</div>
        ${pl ? `<table class="advice-t review-t"><tr><th>Sales margin</th><td>${signedInr(pl.sales)}</td></tr><tr><th>Dealing — realised</th><td>${signedInr(pl.realised)}</td></tr>
          <tr><th>Dealing — unrealised</th><td>${signedInr(pl.unrealised)} <small style="color:var(--muted)">on ${money(T.uncovered(p), p.currency)} still open, at market</small></td></tr>
          <tr><th>Total</th><td><b>${signedInr(pl.total)}</b></td></tr></table>` : '<p style="color:var(--muted)">No P&L — nothing of this position is live.</p>'}
      </div></div></div>
    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>Cover allocations</h2></div><div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Allocation</th><th>Source</th><th class="num">Amount</th><th class="num">Rate</th><th>By</th><th>Status</th></tr></thead>
      <tbody>${allocs.map(x => `<tr><td class="id">${esc(x.id)}</td><td>${x.kind === 'bank' ? 'Bank cover ' + esc(x.coverId) + ' · ' + esc((DB.covers || []).find(c => c.id === x.coverId)?.counterparty || '')
          : 'Internal cross ' + esc(x.positionId === p.id ? x.crossId : x.positionId)}</td>
        <td class="num">${money(x.amount, p.currency)}</td><td class="num">${r4s(x.rate)}</td><td>${esc(x.by)}<br><small>${dmyt(x.at)}</small></td><td>${badge(x.status)}</td></tr>`).join('')
        || `<tr><td colspan="6">${empty('Not covered yet', 'Allocate a bank cover deal or cross it against an opposite booking.')}</td></tr>`}</tbody></table></div></div></div>
    <div class="grid g2">
      <div class="card"><div class="card-head"><h2>Events from trade</h2></div><div class="card-body">${evts.map(e => `<div class="tl" style="padding-left:0">
        <div class="act">${esc(e.type)}${e.ref ? ' — ' + esc(e.ref) : ''}${e.reason ? ' — ' + esc(e.reason) : ''}</div><div class="meta">${esc(e.id)} · ${dmyt(e.at)}</div></div>`).join('')}</div></div>
      <div class="card"><div class="card-head"><h2>Activity</h2></div><div class="card-body">${timeline(p.id)}</div></div></div>`);
}

/* ---------- cover deals ------------------------------------------------------------ */
let trCovTab = 'Active';
function viewTrCover() {
  const all = DB.covers || [], me = myKey();
  const TABS = { 'Pending Approval': c => c.status === 'Pending Approval', Active: c => c.status === 'Active', Rejected: c => c.status === 'Rejected', All: () => true };
  const list = all.filter(TABS[trCovTab] || TABS.Active);
  return shell(trCrumb('Cover deals'), `
    <div class="page-head"><div><h1>Bank cover deals</h1>
      <p>Currency bought from or sold to a bank to offset customer positions. The dealer enters a deal, a treasury checker approves it, then it is allocated to positions.</p></div>
      <div class="acts">${isDealer() ? '<button class="btn btn-primary" type="button" data-act="tr-cover-new">Enter cover deal</button>' : ''}</div></div>
    <div class="card"><div class="tabs">${Object.keys(TABS).map(t => `<button type="button" data-act="tr-covtab" data-t="${esc(t)}" aria-selected="${t === trCovTab}">${esc(t)}<span class="n">${all.filter(TABS[t]).length}</span></button>`).join('')}</div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Deal</th><th>Side</th><th class="num">Amount</th><th class="num">Rate</th><th>Counterparty</th><th>Value date</th>
          <th class="num">Allocated</th><th class="num">Left</th><th>Status</th><th></th></tr></thead>
        <tbody>${list.length ? list.map(c => { const left = c.amount - c.allocated, own = c.enteredByKey === me;
          return `<tr><td class="id" style="white-space:nowrap">${esc(c.id)}<br><small style="color:var(--muted)">${esc(c.dealRef || '')}</small></td>
            <td>${c.side === 'BUY' ? 'Bought' : 'Sold'} ${esc(c.currency)}</td><td class="num">${money(c.amount, c.currency)}</td><td class="num">${r4s(c.rate)}</td>
            <td>${esc(c.counterparty)}<br><small style="color:var(--muted)">${esc(c.enteredBy)}</small></td><td>${dmy(c.valueDate)}</td>
            <td class="num">${money(c.allocated)}</td><td class="num">${left > 0.005 ? money(left) : '—'}</td>
            <td>${badge(c.status)}${c.rejectReason ? `<br><small>${esc(c.rejectReason)}</small>` : ''}</td>
            <td>${c.status === 'Active' && left > 0.005 && isDealer() ? `<button class="btn btn-ghost btn-sm" type="button" data-act="go" data-href="#/ad2/treasury/allocate?src=${esc(c.id)}">Allocate</button>` : ''}
              ${c.status === 'Pending Approval' && isTChecker() ? `<button class="btn btn-primary btn-sm" type="button" data-act="tr-cover-approve" data-id="${esc(c.id)}" ${own ? 'disabled title="You entered this deal"' : ''}>Approve</button>
                <button class="btn btn-link" type="button" data-act="tr-cover-reject" data-id="${esc(c.id)}" ${own ? 'disabled' : ''}>Reject</button>` : ''}</td></tr>`; }).join('')
          : `<tr><td colspan="10">${empty('No cover deals here', '')}</td></tr>`}</tbody></table></div></div></div>`);
}
function coverModal(pre = {}) {
  const cur = pre.cur || 'USD', ref = currency(cur)?.refRate || 0;
  commandModal({ title:'Enter a bank cover deal', okLabel:'Send to checker', cmd:'cover.create', success:'Cover deal sent to the treasury checker.', body:`
    <p style="font-size:var(--fs-sm);color:var(--muted);margin:0 0 14px">Record the deal you struck with the bank. It needs a treasury checker's approval before it can be allocated.</p>
    <div class="fields" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="f"><label for="cv-side">Side</label><select id="cv-side"><option value="BUY" ${pre.side !== 'SELL' ? 'selected' : ''}>Buy from the bank (covers customer sales)</option>
        <option value="SELL" ${pre.side === 'SELL' ? 'selected' : ''}>Sell to the bank (covers customer purchases)</option></select></div>
      <div class="f"><label for="cv-cur">Currency</label><select id="cv-cur">${DB.currencies.map(c => `<option ${c.code === cur ? 'selected' : ''}>${esc(c.code)}</option>`).join('')}</select></div>
      <div class="f"><label for="cv-amt">Amount</label><input id="cv-amt" type="number" step="0.01" min="0" value="${pre.amt || ''}"></div>
      <div class="f"><label for="cv-rate">Dealt rate (₹)</label><input id="cv-rate" type="number" step="0.0001" value="${r4s(TR().marketRate(DB, cur, nowISO()) || ref)}"></div>
      <div class="f"><label for="cv-bank">Counterparty bank</label><select id="cv-bank">${['HDFC Bank','ICICI Bank','Axis Bank','Kotak Mahindra Bank','Standard Chartered','Emirates NBD','State Bank of India'].map(b => `<option>${b}</option>`).join('')}</select></div>
      <div class="f"><label for="cv-ref">Bank deal reference</label><input id="cv-ref" type="text" maxlength="40" placeholder="Optional"></div>
      <div class="f"><label for="cv-vd">Value date</label><input id="cv-vd" type="date" value="${todayISO()}"></div>
    </div>`,
    read: () => ({ side: val('#cv-side'), currency: val('#cv-cur'), amount: val('#cv-amt'), rate: val('#cv-rate'), counterparty: val('#cv-bank'), dealRef: val('#cv-ref'), valueDate: val('#cv-vd') }) });
}

/* ---------- allocation (T-05) ---------------------------------------------------
   One source on one side, candidate positions on the other. Totals, what is
   left and any over-allocation recompute as rows are ticked; confirm is a
   human action and disabled until something valid is selected.          */
let ALLOC = { src:null, rows:{} };
function allocSource(src) {
  const c = (DB.covers || []).find(x => x.id === src);
  if (c) return { id:c.id, kind:'bank', currency:c.currency, side:c.side === 'BUY' ? 'SELL' : 'BUY', avail: +(c.amount - c.allocated).toFixed(2),
    label:`${c.id} — ${c.side === 'BUY' ? 'bought' : 'sold'} ${money(c.amount, c.currency)} at ${r4s(c.rate)} from ${c.counterparty}`, ok: c.status === 'Active' };
  const p = (DB.positions || []).find(x => x.id === src);
  if (p) return { id:p.id, kind:'cross', currency:p.currency, side:p.side === 'BUY' ? 'SELL' : 'BUY', avail: TR().uncovered(p),
    label:`${p.id} — ${custName(p.smeId)} ${sideWord(p.side).toLowerCase()} ${money(p.amount, p.currency)} at ref ${r4s(p.refRate)} (internal cross)`, ok: !['Cancelled','Expired'].includes(posStatus(p)) };
  return null;
}
function allocCandidates(s) {
  return (DB.positions || []).filter(p => p.currency === s.currency && p.side === s.side && p.id !== s.id && TR().uncovered(p) > 0
    && !['Cancelled', 'Expired'].includes(posStatus(p))).sort((a, b) => String(a.bookedAt).localeCompare(String(b.bookedAt)));
}
function allocTotals(s) {
  const sel = Object.values(ALLOC.rows).reduce((t, v) => t + (Number(v) || 0), 0);
  return { sel: +sel.toFixed(2), left: +(s.avail - sel).toFixed(2), over: sel > s.avail + 0.005 };
}
function allocSummaryHTML(s) {
  const t = allocTotals(s), n = Object.keys(ALLOC.rows).length;
  return `<table class="advice-t review-t" style="margin-bottom:12px">
      <tr><th>Available on ${esc(s.id)}</th><td>${money(s.avail, s.currency)}</td></tr>
      <tr><th>Selected</th><td><b>${money(t.sel, s.currency)}</b> <small>· ${plural(n, 'position')}</small></td></tr>
      <tr><th>Left afterwards</th><td>${money(Math.max(0, t.left), s.currency)}${t.left > 0.005 && n ? '<br><small>stays unallocated, shown under exceptions</small>' : ''}</td></tr></table>
    ${t.over ? `<div class="note note-err"><span><b>Over-allocated by ${money(t.sel - s.avail, s.currency)}.</b> Reduce the amounts before confirming.</span></div>` : ''}
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-primary" type="button" data-act="tr-alloc-confirm" ${!n || t.over || t.sel <= 0 ? 'disabled' : ''}>Confirm allocation</button>
      <button class="btn btn-plain" type="button" data-act="tr-alloc-fifo">Suggest — oldest first</button>
      <button class="btn btn-link" type="button" data-act="tr-alloc-clear">Clear</button></div>`;
}
function viewTrAllocate(src) {
  const sources = [...(DB.covers || []).filter(c => c.status === 'Active' && c.amount - c.allocated > 0.005).map(c => c.id),
    ...Object.values(TR().netByCurrency(DB, nowISO())).filter(r => r.crossable > 0).flatMap(r => (DB.positions || []).filter(p => p.currency === r.currency && TR().uncovered(p) > 0 && !['Cancelled','Expired'].includes(posStatus(p))).map(p => p.id))];
  if (!src && sources.length) src = sources[0];
  const s = src && allocSource(src);
  if (ALLOC.src !== src) ALLOC = { src, rows:{} };
  const pick = `<div class="f" style="max-width:640px"><label for="al-src">Allocate from</label><select id="al-src" data-act="tr-alloc-src">
    ${sources.map(id => { const x = allocSource(id); return `<option value="${esc(id)}" ${id === src ? 'selected' : ''}>${esc(x.label)} · ${money(x.avail)} available</option>`; }).join('')}
    ${s && !sources.includes(src) ? `<option value="${esc(src)}" selected>${esc(s.label)}</option>` : ''}</select></div>`;
  if (!s) return shell(trCrumb('Allocate'), `<div class="page-head"><div><h1>Allocate cover</h1></div></div>
    ${empty('Nothing to allocate', 'There is no approved cover with a balance and no opposite bookings to cross.')}`);
  const cands = allocCandidates(s);
  return shell(trCrumb('Allocate'), `
    <div class="page-head"><div><h1>Allocate ${s.kind === 'bank' ? 'bank cover' : '— internal cross'}</h1>
      <p>${s.kind === 'bank' ? 'Tick the customer positions this cover offsets.' : 'A customer purchase offsets customer sales in the same currency, with no bank deal: treasury earns the difference between the two reference rates.'}
        Matching is by rule — same currency, opposite side — and nothing is committed until you confirm.</p></div></div>
    ${!isDealer() ? denied('Read-only', 'Only a treasury dealer allocates cover.') : ''}
    <div class="card" style="margin-bottom:20px"><div class="card-body">${pick}
      ${!s.ok ? `<div class="note note-err" style="margin-top:10px"><span>${esc(s.id)} cannot be allocated now.</span></div>` : ''}</div></div>
    <div class="grid g2" style="grid-template-columns:2fr 1fr;align-items:start">
      <div class="card"><div class="card-head"><h2>${sideWord(s.side)}s in ${esc(s.currency)} with cover to find</h2></div>
        <div class="card-body tight"><div class="tablewrap"><table class="dt">
          <thead><tr><th></th><th>Position</th><th>Customer</th><th class="num">Uncovered</th><th>Rule</th><th class="num">Allocate</th></tr></thead>
          <tbody>${cands.length ? cands.map(p => { const on = ALLOC.rows[p.id] != null, u = TR().uncovered(p);
            const rule = u <= s.avail ? 'Exact currency, fits in full' : 'Partial — larger than what is left';
            return `<tr class="${on ? 'sel' : ''}"><td><input type="checkbox" data-act="tr-alloc-tick" data-id="${esc(p.id)}" ${on ? 'checked' : ''} aria-label="Allocate to ${esc(p.id)}" ${isDealer() ? '' : 'disabled'}></td>
              <td class="id" style="white-space:nowrap">${esc(p.id)}<br><small style="color:var(--muted)">${esc(recWord(p))}</small></td><td>${esc(custName(p.smeId))}</td>
              <td class="num">${money(u, p.currency)}</td><td><small>${rule}</small></td>
              <td class="num"><input type="number" class="alloc-in" step="0.01" min="0" max="${u}" style="width:120px" data-act="tr-alloc-amt" data-id="${esc(p.id)}" value="${on ? ALLOC.rows[p.id] : ''}" ${on ? '' : 'disabled'} aria-label="Amount for ${esc(p.id)}"></td></tr>`; }).join('')
            : `<tr><td colspan="6">${empty('Nothing to offset', `No uncovered ${sideWord(s.side).toLowerCase()}s in ${s.currency}.`)}</td></tr>`}</tbody></table></div></div></div>
      <div class="card"><div class="card-head"><h2>Before you confirm</h2></div><div class="card-body" id="alloc-sum">${allocSummaryHTML(s)}</div></div>
    </div>`);
}

/* ---------- exceptions ---------------------------------------------------------- */
function viewTrExceptions() {
  const list = TR().exceptions(DB, nowISO());
  const types = [...new Set(list.map(x => x.type))];
  return shell(trCrumb('Exceptions'), `
    <div class="page-head"><div><h1>Exceptions</h1>
      <p>Kept apart by type, because each has a different owner and a different fix. Nothing here cancels a customer's booking.</p></div></div>
    ${list.length ? types.map(t => { const rows = list.filter(x => x.type === t);
      return `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>${esc(t)} (${rows.length})</h2><div class="acts"><small>Owner: ${esc(rows[0].owner)}</small></div></div>
        <div class="card-body tight"><div class="tablewrap"><table class="dt"><thead><tr><th>Item</th><th>Detail</th><th>Since</th><th></th></tr></thead>
        <tbody>${rows.map(x => `<tr><td class="id">${esc(x.ref)}</td><td>${esc(x.detail)}</td><td>${dmyt(x.at)}</td>
          <td>${/^POS-/.test(x.ref) ? `<button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/treasury/positions/${esc(x.ref)}">Open</button>`
            : /^COV-/.test(x.ref) && isDealer() ? `<button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/treasury/allocate?src=${esc(x.ref)}">Allocate</button>`
            : x.type === 'Published rate off market' ? `<button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/treasury/rates">Rate desk</button>`
            : `<button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/treasury">Desk</button>`}</td></tr>`).join('')}</tbody></table></div></div></div>`; }).join('')
      : empty('No exceptions', 'Every position is covered or within its day, and all cover is allocated.')}`);
}

/* ---------- deal references ------------------------------------------------------ */
function viewTrDeals() {
  const list = DB.deals || [];
  return shell(trCrumb('Deal references'), `
    <div class="page-head"><div><h1>FX deal references</h1>
      <p>A rate negotiated with the desk for a customer. Issuing it puts the position on the book immediately; the branch applies the reference to the customer's request, once.</p></div>
      <div class="acts">${isDealer() ? '<button class="btn btn-primary" type="button" data-act="tr-deal-new">Issue deal reference</button>' : ''}</div></div>
    <div class="card"><div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Deal</th><th>Customer</th><th>Side</th><th class="num">Up to</th><th class="num">Rate</th><th>Valid until</th><th>Status</th><th>Used on</th><th></th></tr></thead>
      <tbody>${list.length ? list.map(d => `<tr><td class="id" style="white-space:nowrap">${esc(d.id)}<br><small style="color:var(--muted)">${esc(d.positionId)}</small></td>
        <td>${esc(custName(d.smeId))}${d.note ? `<br><small style="color:var(--muted)">${esc(d.note)}</small>` : ''}</td><td>${sideWord(d.side)}<br><small>${sideHint(d.side)}</small></td>
        <td class="num">${money(d.amount, d.currency)}</td><td class="num">${r4s(d.rate)}</td>
        <td>${dmyt(d.validUntil)}${d.status === 'Issued' ? '<br><small>' + esc(hoursLeft(d.validUntil)) + '</small>' : ''}</td><td>${badge(d.status)}</td><td>${esc(d.usedOn || '—')}</td>
        <td>${d.status === 'Issued' && isDealer() ? `<button class="btn btn-link" type="button" data-act="tr-deal-withdraw" data-id="${esc(d.id)}">Withdraw</button>` : ''}</td></tr>`).join('')
        : `<tr><td colspan="9">${empty('No deals', '')}</td></tr>`}</tbody></table></div></div></div>`);
}
function dealIssueModal() {
  const smes = DB.smes.filter(s => s.status === 'Approved' && s.config);
  const first = smes[0];
  const curOpts = s => (s?.config?.currencies || []).map(c => `<option>${esc(c)}</option>`).join('');
  commandModal({ title:'Issue an FX deal reference', okLabel:'Issue deal', cmd:'deal.issue', wide:true, body:`
    <p style="font-size:var(--fs-sm);color:var(--muted);margin:0 0 14px">For a rate agreed with a customer by phone. The position goes on the book now; the branch applies the reference to the customer's request before it expires.</p>
    <div class="fields" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="f"><label for="dl-sme">Customer</label><select id="dl-sme" data-act="tr-deal-sme">${smes.map(s => `<option value="${esc(s.id)}">${esc(s.tradingName)} · ${esc(s.id)}</option>`).join('')}</select></div>
      <div class="f"><label for="dl-dir">For</label><select id="dl-dir"><option value="out">An outward payment (AD2 sells)</option><option value="in">An inward conversion (AD2 buys)</option></select></div>
      <div class="f"><label for="dl-cur">Currency</label><select id="dl-cur">${curOpts(first)}</select></div>
      <div class="f"><label for="dl-amt">Up to amount</label><input id="dl-amt" type="number" step="0.01" min="0"></div>
      <div class="f"><label for="dl-rate">Agreed rate (₹)</label><input id="dl-rate" type="number" step="0.0001" placeholder="within 3% of the reference"></div>
      <div class="f"><label for="dl-hrs">Valid for (hours)</label><input id="dl-hrs" type="number" min="1" max="72" value="24"></div>
      <div class="f span2" style="grid-column:1/-1"><label for="dl-note">Note</label><input id="dl-note" type="text" maxlength="200" placeholder="Who agreed it, and for what"></div>
    </div>`,
    read: () => ({ smeId: val('#dl-sme'), dir: val('#dl-dir'), currency: val('#dl-cur'), amount: val('#dl-amt'), rate: val('#dl-rate'), validHours: val('#dl-hrs'), note: val('#dl-note') }) });
  window._dlCurs = Object.fromEntries(smes.map(s => [s.id, curOpts(s)]));
}

/* ---------- P&L ----------------------------------------------------------------- */
function viewTrPnl() {
  const pl = TR().pnl(DB, nowISO()), t = pl.totals;
  sessSet('ad2-guide-pnl', 1);
  const grp = (title, list, label) => `<div class="card" style="margin-bottom:16px"><div class="card-head"><h2>${esc(title)}</h2></div>
    <div class="card-body tight"><div class="tablewrap"><table class="dt"><thead><tr><th>${esc(label)}</th><th class="num">Positions</th><th class="num">Sales margin</th>
      <th class="num">Dealing — realised</th><th class="num">Dealing — unrealised</th><th class="num">Total</th></tr></thead>
    <tbody>${list.map(g => `<tr><td><b>${esc(label === 'Customer' ? custName(g.key) : label === 'Booking day' ? dmy(g.key) : g.key)}</b></td><td class="num">${g.n}</td>
      <td class="num">${signedInr(g.sales)}</td><td class="num">${signedInr(g.realised)}</td><td class="num">${signedInr(g.unrealised)}</td><td class="num"><b>${signedInr(g.total)}</b></td></tr>`).join('')}</tbody>
    <tfoot><tr><td>All (INR)</td><td></td><td class="num">${signedInr(t.sales)}</td><td class="num">${signedInr(t.realised)}</td><td class="num">${signedInr(t.unrealised)}</td><td class="num">${signedInr(t.total)}</td></tr></tfoot></table></div></div></div>`;
  return shell(trCrumb('P&L'), `
    <div class="page-head"><div><h1>Treasury P&L</h1>
      <p>In rupees, in two parts that are never mixed. <b>Sales margin</b>: the customer's rate against the reference at booking — the branch's pricing.
        <b>Dealing result</b>: the reference against what treasury covered at (realised), or against the market for what is still open (unrealised) — the desk's skill.</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="tr-csv" data-what="pnl">Export CSV</button></div></div>
    <div class="grid g4" style="margin-bottom:20px">${kpi('Sales margin', signedInr(t.sales))}${kpi('Dealing — realised', signedInr(t.realised))}
      ${kpi('Dealing — unrealised', signedInr(t.unrealised), { delta: DB.settings.marketSim === false ? 'at the published rate' : 'marked to the simulated market' })}${kpi('Total', signedInr(t.total), { tone:'accent' })}</div>
    ${grp('By currency', pl.byCurrency, 'Currency')}${grp('By customer', pl.byCustomer, 'Customer')}${grp('By booking day (IST)', pl.byDay, 'Booking day')}`);
}

/* ---------- integration log ------------------------------------------------------ */
let trEvType = '';
function viewTrEvents() {
  const all = DB.tmsEvents || [];
  const list = trEvType ? all.filter(e => e.type === trEvType) : all;
  const types = ['position.opened', 'position.attached', 'position.linked', 'position.cancelled'];
  return shell(trCrumb('Integration log'), `
    <div class="page-head"><div><h1>Integration log — trade to treasury</h1>
      <p>Everything the trade platform tells treasury, in order. This is the contract a separate treasury system would subscribe to:
        four events, each carrying the position, customer, currency, side, amount and rate, plus the request, UTR/FIRC or reason where it applies.
        Each event is written in the same step as the trade action, so neither side can be ahead of the other.</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="tr-csv" data-what="events">Export CSV</button></div></div>
    <div class="card"><div class="tabs"><button type="button" data-act="tr-evtype" data-t="" aria-selected="${!trEvType}">All<span class="n">${all.length}</span></button>
      ${types.map(t => `<button type="button" data-act="tr-evtype" data-t="${t}" aria-selected="${t === trEvType}">${t}<span class="n">${all.filter(e => e.type === t).length}</span></button>`).join('')}</div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Event</th><th>Type</th><th>At</th><th>Position</th><th>Request</th><th>Customer</th><th class="num">Amount</th><th class="num">Rate</th><th>Detail</th><th>Status</th></tr></thead>
        <tbody>${list.slice(0, 300).map(e => `<tr><td class="id">${esc(e.id)}</td><td><code>${esc(e.type)}</code></td><td>${dmyt(e.at)}</td>
          <td><a href="#/ad2/treasury/positions/${esc(e.positionId)}">${esc(e.positionId)}</a></td><td>${esc(e.recordId || '—')}</td><td>${esc(custName(e.smeId))}</td>
          <td class="num">${sideWord(e.side)} ${money(e.amount, e.currency)}</td><td class="num">${r4s(e.rate)}</td><td><small>${esc(e.ref || e.reason || e.source || '')}</small></td><td>${badge(e.status)}</td></tr>`).join('')
          || `<tr><td colspan="10">${empty('No events', '')}</td></tr>`}</tbody></table></div></div></div>`);
}

/* ---------- approvals (treasury checker) ------------------------------------------ */
function viewTrApprovals() {
  const me = myKey();
  const revs = (DB.rateRevisions || []).filter(r => r.status === 'Proposed');
  const covs = (DB.covers || []).filter(c => c.status === 'Pending Approval');
  return shell(trCrumb('Approvals'), `
    <div class="page-head"><div><h1>Approvals</h1><p>Rate revisions and bank cover deals from the dealers. You cannot approve anything you entered yourself.</p></div></div>
    ${revs.map(r => revisionCard(r, me)).join('')}
    <div class="card"><div class="card-head"><h2>Cover deals to approve (${covs.length})</h2></div><div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Deal</th><th>Side</th><th class="num">Amount</th><th class="num">Rate</th><th class="num">vs reference</th><th>Counterparty</th><th>Entered</th><th></th></tr></thead>
      <tbody>${covs.map(c => { const ref = currency(c.currency)?.refRate || 0, own = c.enteredByKey === me;
        return `<tr><td class="id">${esc(c.id)}</td><td>${c.side === 'BUY' ? 'Buy' : 'Sell'} ${esc(c.currency)}</td><td class="num">${money(c.amount, c.currency)}</td>
          <td class="num">${r4s(c.rate)}</td><td class="num">${ref ? ((c.rate - ref) / ref * 100).toFixed(2) + '%' : '—'}</td><td>${esc(c.counterparty)}</td>
          <td>${esc(c.enteredBy)}<br><small>${dmyt(c.enteredAt)}</small></td>
          <td><button class="btn btn-primary btn-sm" type="button" data-act="tr-cover-approve" data-id="${esc(c.id)}" ${own ? 'disabled' : ''}>Approve</button>
            <button class="btn btn-link" type="button" data-act="tr-cover-reject" data-id="${esc(c.id)}" ${own ? 'disabled' : ''}>Reject</button>
            ${own ? '<br><small style="color:var(--muted)">You entered it — another checker decides</small>' : ''}</td></tr>`; }).join('')
        || `<tr><td colspan="8">${empty('Nothing to approve', 'Cover deals from the dealers appear here.')}</td></tr>`}</tbody></table></div></div></div>
    ${!revs.length && !covs.length ? '' : ''}`);
}

/* ---------- actions -------------------------------------------------------------- */
function treasuryClick(act, t) {
  if (act === 'tr-postab') { trPosTab = t.dataset.t; render(); return; }
  if (act === 'tr-covtab') { trCovTab = t.dataset.t; render(); return; }
  if (act === 'tr-evtype') { trEvType = t.dataset.t; render(); return; }
  if (act === 'tr-cover-new') { coverModal({ cur: t.dataset.cur, side: t.dataset.side, amt: t.dataset.amt }); return; }
  if (act === 'tr-cover-approve') {
    const c = (DB.covers || []).find(x => x.id === t.dataset.id);
    modal({ title:'Approve cover deal ' + c.id, okLabel:'Approve', body:`<table class="advice-t review-t">
      <tr><th>Deal</th><td>${c.side === 'BUY' ? 'Buy' : 'Sell'} <b>${money(c.amount, c.currency)}</b> at ${r4s(c.rate)} with ${esc(c.counterparty)}</td></tr>
      <tr><th>Reference now</th><td>${r4s(currency(c.currency)?.refRate)}</td></tr><tr><th>Value date</th><td>${dmy(c.valueDate)}</td></tr>
      <tr><th>Entered by</th><td>${esc(c.enteredBy)} · ${dmyt(c.enteredAt)}</td></tr></table>`,
      onOk: () => run('cover.approve', { id: c.id }, { after: closeModal }) });
    return;
  }
  if (act === 'tr-cover-reject' || act === 'tr-rate-reject') {
    const cmd = act === 'tr-cover-reject' ? 'cover.reject' : 'rates.reject';
    commandModal({ title:'Reject ' + t.dataset.id, okLabel:'Reject', okClass:'btn-danger', cmd, body:`<div class="f"><label for="rj-why">Reason<span class="req">*</span></label>
      <textarea id="rj-why" maxlength="300"></textarea><div class="hint">It goes back to the dealer.</div></div>`,
      read: () => { const r = val('#rj-why'); if (!r) throw 'Give a reason — it goes back to the dealer.'; return { id: t.dataset.id, reason: r }; } });
    return;
  }
  if (act === 'tr-rate-approve') { run('rates.approve', { id: t.dataset.id }); return; }
  if (act === 'tr-rate-market') { $$('[data-rate]').forEach(i => { i.value = i.placeholder; }); return; }
  if (act === 'tr-rate-propose') {
    const rates = {};
    $$('[data-rate]').forEach(i => { if (i.value !== '') rates[i.dataset.rate] = i.value; });
    run('rates.propose', { rates, reason: val('#rr-reason') });
    return;
  }
  if (act === 'tr-deal-new') { dealIssueModal(); return; }
  if (act === 'tr-deal-withdraw') {
    commandModal({ title:'Withdraw deal ' + t.dataset.id, okLabel:'Withdraw', okClass:'btn-danger', cmd:'deal.withdraw', body:`<div class="f"><label for="wd-why">Reason<span class="req">*</span></label><input id="wd-why" type="text" maxlength="200"></div>`,
      read: () => { const r = val('#wd-why'); if (!r) throw 'Give a reason.'; return { id: t.dataset.id, reason: r }; } });
    return;
  }
  if (act === 'tr-alloc-fifo' || act === 'tr-alloc-clear') {
    const s = allocSource(ALLOC.src); if (!s) return;
    ALLOC.rows = {};
    if (act === 'tr-alloc-fifo') {
      let left = s.avail;
      allocCandidates(s).forEach(p => { if (left <= 0.005) return; const a = Math.min(TR().uncovered(p), left); ALLOC.rows[p.id] = +a.toFixed(2); left -= a; });
    }
    render(); return;
  }
  if (act === 'tr-alloc-confirm') {
    const rows = Object.entries(ALLOC.rows).map(([positionId, amount]) => ({ positionId, amount: Number(amount) })).filter(r => r.amount > 0);
    run('cover.allocate', { source: ALLOC.src, rows }, { after: () => { ALLOC = { src:null, rows:{} }; location.hash = '#/ad2/treasury'; } });
    return;
  }
  if (act === 'tr-csv') {
    const w = t.dataset.what;
    if (w === 'positions') csvDownload('treasury-positions.csv', [['Position','Customer','Side','Currency','Amount','Customer rate','Reference','Lifecycle','Settlement','Cover','Covered','Request','UTR/FIRC'],
      ...(DB.positions || []).map(p => [p.id, custName(p.smeId), p.side, p.currency, p.amount, p.customerRate, p.refRate, posStatus(p), TR().linkState(p), TR().coverState(p), p.covered || 0, p.recordId || '', p.linkRef || ''])]);
    if (w === 'pnl') csvDownload('treasury-pnl.csv', [['Position','Customer','Currency','Side','Booking day','Status','Amount','Sales margin INR','Dealing realised INR','Dealing unrealised INR','Total INR'],
      ...TR().pnl(DB, nowISO()).rows.map(r => [r.positionId, custName(r.smeId), r.currency, r.side, r.day, r.status, r.amount, r.sales, r.realised, r.unrealised, r.total])]);
    if (w === 'events') csvDownload('trade-to-treasury-events.csv', [['Event','Type','At','Position','Request','Customer','Currency','Side','Amount','Rate','Ref/reason','Status'],
      ...(DB.tmsEvents || []).map(e => [e.id, e.type, e.at, e.positionId, e.recordId || '', custName(e.smeId), e.currency, e.side, e.amount, e.rate, e.ref || e.reason || '', e.status])]);
    return;
  }
}
function treasuryInput(t) {
  const act = t.dataset.act;
  if (act === 'tr-search') { trSearch = t.value; debounceRender(); return true; }
  if (act === 'tr-alloc-amt') {
    ALLOC.rows[t.dataset.id] = t.value === '' ? 0 : Number(t.value);
    const s = allocSource(ALLOC.src); const host = $('#alloc-sum');
    if (s && host) host.innerHTML = allocSummaryHTML(s);
    return true;
  }
  return false;
}
function treasuryChange(t) {
  const act = t.dataset.act;
  if (act === 'tr-poscur') { trPosCur = t.value; render(); return true; }
  if (act === 'tr-alloc-src') { location.hash = '#/ad2/treasury/allocate?src=' + t.value; return true; }
  if (act === 'tr-alloc-tick') {
    const s = allocSource(ALLOC.src); if (!s) return true;
    if (t.checked) {
      const used = Object.values(ALLOC.rows).reduce((a, v) => a + (Number(v) || 0), 0);
      const p = (DB.positions || []).find(x => x.id === t.dataset.id);
      ALLOC.rows[t.dataset.id] = +Math.max(0, Math.min(TR().uncovered(p), s.avail - used)).toFixed(2);
    } else delete ALLOC.rows[t.dataset.id];
    render(); return true;
  }
  if (act === 'tr-deal-sme') { const c = $('#dl-cur'); if (c && window._dlCurs) c.innerHTML = window._dlCurs[t.value] || ''; return true; }
  return false;
}

/* ---------- the customer's own bookings (SME portal) --------------------------------- */
function myBookingsCard() {
  const mine = (DB.positions || []).filter(p => p.smeId === ctxSmeId() && posStatus(p) === 'Open');
  if (!mine.length) return '';
  return `<div class="card" style="margin-bottom:20px"><div class="card-head"><h2>Your rate bookings (${mine.length})</h2></div>
    <div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Booking</th><th>For</th><th class="num">Amount</th><th class="num">Your rate</th><th>Locked until</th><th></th></tr></thead>
      <tbody>${mine.map(p => `<tr><td class="id">${esc(p.id)}</td><td>${p.side === 'SELL' ? 'Outward payment' : 'Inward conversion'}</td>
        <td class="num">${money(p.amount, p.currency)}</td><td class="num">${r4s(p.customerRate)}</td><td>${dmyt(p.expiresAt)}<br><small>${esc(hoursLeft(p.expiresAt))}</small></td>
        <td><button class="btn btn-link" type="button" data-act="bk-release" data-id="${esc(p.id)}">Release</button></td></tr>`).join('')}</tbody></table></div></div>
    <p style="padding:0 16px 14px;margin:0;color:var(--muted);font-size:var(--fs-xs)">A booking holds its rate for 48 hours. Use it on a request, or release it if you no longer need it.</p></div>`;
}

/* The treasury position behind a request, on its detail page. The branch
   sees whether treasury has covered it; the customer sees its booking. */
function positionLine(rec) {
  const id = rec && rec.rate && rec.rate.positionId;
  if (!id) return '';
  const p = (DB.positions || []).find(x => x.id === id);
  if (!p) return `<div class="line"><span>Rate booking</span><b>${esc(id)}</b></div>`;
  if (!isAD2() || acting()) return `<div class="line"><span>Rate booking</span><b>${esc(id)}</b></div>`;
  const cover = p.coverState || (TR().coverState ? TR().coverState(p) : '');
  return `<div class="line"><span>Treasury position</span><b>${can('treasury.view') ? `<a href="#/ad2/treasury/positions/${esc(id)}">${esc(id)}</a>` : esc(id)} · ${badge(posStatus(p))}${cover && cover !== '—' ? ' ' + badge(cover) : ''}</b></div>`;
}
