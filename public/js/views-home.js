/* ==========================================================================
   Dashboards, work queue, onboarding review, directory, profile, reports,
   integrations and administration
   ========================================================================== */

/* ---------- SME dashboard -------------------------------------------------- */
function viewSmeDashboard() {
  const me = sme(ctxSmeId());
  if (!me) return shell(crumb('Dashboard'), empty('No business linked','This account is not linked to a business.'));
  if (me.status !== 'Approved') return shell(crumb('Application'), applicantHome(me));

  const out = DB.outward.filter(o => o.smeId === me.id);
  const inw = DB.inward.filter(i => i.smeId === me.id);
  const dis = DB.disposals.filter(d => d.smeId === me.id);
  const bills = DB.bills.filter(b => b.smeId === me.id);
  const pm = perm(me);
  const inFlight = [...out.filter(o => Engine.OPEN.includes(o.status)).map(o => ({ id:o.id, kind:'Outward', href:'#/sme/outward/' + o.id,
      what:`${o.remittanceType} · ${o.beneficiary}`, amt:money(o.amount, o.currency), status:o.status, with:o.pendingWith, at:o.requestDate })),
    ...dis.filter(d => Engine.OPEN.includes(d.status)).map(d => ({ id:d.id, kind:'Disposal', href:'#/sme/disposals/' + d.id,
      what:(d.purposeCode || 'TRADE') + ' · ' + (d.allocations.length ? d.allocations.map(a => a.billId).join(', ') : 'advance'), amt:money(d.amount, d.currency), status:d.status, with:d.pendingWith, at:d.submittedAt }))]
    .sort((a, b) => new Date(b.at) - new Date(a.at));
  const queries = out.filter(o => o.status === 'Clarification Required').length + dis.filter(d => d.status === 'Clarification Required').length
    + bills.filter(b => b.review === 'Query Raised').length;
  const awaiting = inw.filter(i => i.available > 0 && i.status !== 'Intimated');
  const reported = inw.filter(i => i.status === 'Intimated');
  const byCur = {};
  bills.filter(b => b.outstanding > 0 && b.review === 'Accepted').forEach(b => { byCur[b.currency] = (byCur[b.currency] || 0) + b.outstanding; });
  const inrAccts = smeAccounts(me.id).filter(a => a.currency === 'INR');
  const boeDue = out.filter(o => o.boeDueDate && !DB.allocations.some(l => l.remId === o.id && l.status === 'Confirmed'));
  const fircPending = dis.filter(d => d.status === 'Processed' && (d.unallocated || 0) > 0);

  return shell(crumb('Dashboard'), `
    <div class="page-head"><div>
      <h1>${esc(me.tradingName || me.legalName)}</h1>
      <p>${esc(me.config.permission)} services · ${esc(me.config.currencies.join(' · '))} · approved ${dmy(me.approvedAt)}</p></div>
      <div class="acts">
        ${pm.importSide ? `<button class="btn btn-primary" type="button" data-act="or-new">New outward payment</button>` : ''}
        ${pm.exportSide ? `<button class="btn btn-primary" type="button" data-act="in-new">New inward remittance</button>` : ''}
        <button class="btn btn-ghost" type="button" data-act="bill-lodge-pick">Lodge a bill</button>
        <button class="btn btn-plain" type="button" data-act="go" data-href="#/sme/knockoff">Knock off bills</button>
      </div></div>

    ${queries ? `<div class="note note-warn" style="margin-bottom:18px"><span><b>${plural(queries, 'query', 'queries')} from AD2</b> need your response. Open the items marked Clarification Required or Query Raised.</span></div>` : ''}
    ${fircPending.length ? `<div class="note note-info" style="margin-bottom:18px"><span><b>${plural(fircPending.length, 'FIRC')} pending knock-off</b> against export bills:
      ${fircPending.map(d => `<a href="#/sme/disposals/${d.id}">${esc(d.firc)} (${money(d.unallocated, d.currency)})</a>`).join(', ')}. <a href="#/sme/knockoff">Knock off now</a>.</span></div>` : ''}
    ${awaiting.length ? `<div class="note note-info" style="margin-bottom:18px"><span><b>${plural(awaiting.length, 'receipt')}</b> awaiting your disposal instruction:
      ${awaiting.map(i => `<a href="#/sme/inward/${i.id}/dispose">${esc(i.reference)} (${money(i.available, i.currency)})</a>`).join(', ')}.</span></div>` : ''}
    ${reported.length ? `<div class="note note-info" style="margin-bottom:18px"><span><b>${plural(reported.length, 'payment')}</b> you reported ${reported.length === 1 ? 'is' : 'are'} with AD2 Operations to confirm:
      ${reported.map(i => `<a href="#/sme/inward/${i.id}">${esc(i.remitter)} (${money(i.amount, i.currency)})</a>`).join(', ')}.</span></div>` : ''}

    ${myBookingsCard()}
    <div class="grid g4" style="margin-bottom:20px">
      ${kpi('In flight with AD2', inFlight.filter(x => x.with !== 'SME').length, { tone:'accent', go: pm.importSide ? '#/sme/outward' : '#/sme/inward' })}
      ${kpi('Awaiting your action', queries + awaiting.length, { tone: queries + awaiting.length ? 'warn' : '' })}
      ${kpi('Outstanding import bills', bills.filter(b => b.type === 'Import' && b.outstanding > 0).length, { go: pm.importSide ? '#/sme/bills/import' : null })}
      ${kpi('Outstanding export bills', bills.filter(b => b.type === 'Export' && b.outstanding > 0).length, { go: pm.exportSide ? '#/sme/bills/export' : null })}
    </div>

    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>In flight</h2></div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Reference</th><th>Type</th><th>Detail</th><th class="num">Amount</th><th>Status</th><th>With</th><th></th></tr></thead>
        <tbody>${inFlight.length ? inFlight.map(x => `
          <tr><td class="id" data-act="go" data-href="${x.href}">${esc(x.id)}</td><td>${esc(x.kind)}</td><td>${esc(x.what)}</td>
            <td class="num">${x.amt}</td><td>${badge(x.status)}</td><td>${esc(x.with)}</td>
            <td><button class="btn btn-link" type="button" data-act="go" data-href="${x.href}">Open</button></td></tr>`).join('')
          : `<tr><td colspan="7">${empty('Nothing in flight','Payments and disposal instructions you submit appear here until they complete.')}</td></tr>`}</tbody>
      </table></div></div></div>

    <div class="grid g2">
      <div class="card"><div class="card-head"><h2>Accounts</h2>
        <div class="acts"><button class="btn btn-link" type="button" data-act="go" data-href="#/sme/profile">Manage</button></div></div>
        <div class="card-body tight"><div class="tablewrap"><table class="dt">
          <thead><tr><th>Account</th><th>Status</th><th class="num">Balance</th></tr></thead>
          <tbody>${inrAccts.map(a => `<tr><td><b>${esc(a.bank)}</b><br><small style="color:var(--muted)">${esc(a.accountNumber)}</small></td>
            <td>${a.verified ? '<span class="badge b-green">Verified</span>' : '<span class="badge b-amber">Unverified</span>'}</td>
            <td class="num">${inr(a.balance)}</td></tr>`).join('')}</tbody></table></div></div></div>
      <div class="card"><div class="card-head"><h2>Outstanding bill value</h2></div>
        <div class="card-body tight"><div class="tablewrap"><table class="dt">
          <thead><tr><th>Currency</th><th class="num">Outstanding</th><th class="num">Bills</th></tr></thead>
          <tbody>${Object.keys(byCur).length ? Object.entries(byCur).map(([c, v]) => `
            <tr><td><b>${esc(c)}</b></td><td class="num">${money(v)}</td>
              <td class="num">${bills.filter(b => b.currency === c && b.outstanding > 0).length}</td></tr>`).join('')
            : `<tr><td colspan="3">${empty('Nothing outstanding','All accepted bills are settled.')}</td></tr>`}</tbody>
        </table></div>
        ${boeDue.length ? `<p style="padding:12px 20px;font-size:var(--fs-xs);color:var(--r4m-amber, #a15c00)">
          ${plural(boeDue.length, 'advance payment')} awaiting a Bill of Entry: ${boeDue.map(o => `${esc(o.id)} (due ${dmy(o.boeDueDate)})`).join(', ')}.</p>` : ''}
        </div></div>
    </div>

    <div class="card" style="margin-top:20px"><div class="card-head"><h2>Recent activity</h2></div>
      <div class="card-body">${DB.audit.filter(a => a.record).slice(0, 8).map(a => `
        <div class="tl" style="padding-left:0"><div class="act">${esc(a.action)}</div>
          <div class="meta">${esc(a.record)} · ${esc(a.actor)} · ${dmyt(a.at)}</div></div>`).join('') || '<p style="color:var(--muted)">No activity yet.</p>'}</div></div>`);
}

function applicantHome(me) {
  const steps = [['Submitted','Application received'],['Review and pricing','AD2 maker reviews and prices'],['Compliance approval','AD2 Compliance approves'],['Live','Trade services open']];
  const at = { 'Submitted':1, 'Under Review':1, 'Clarification Required':1, 'Pending Approval':2, 'Approved':3, 'Rejected':-1 }[me.status] ?? 0;
  const open = me.status === 'Clarification Required' && me.query;
  const where = { 'Submitted':'An AD2 maker picks it up next, checks your documents and prepares your pricing.',
    'Under Review':'An AD2 maker is reviewing your documents and preparing your pricing.',
    'Clarification Required':'AD2 needs something from you before it can continue — answer below.',
    'Pending Approval':'The review is done. AD2 Compliance is giving the final approval.',
    'Approved':'Approved. Trade services are open on this same sign-in.' }[me.status] || '';
  return `
    <div class="page-head"><div><h1>Application ${esc(me.id)} ${badge(me.status)}</h1>
      <p>${esc(me.legalName)} · submitted ${dmy(me.submittedAt)} · ${esc(me.source)} channel</p></div></div>
    <div class="card" style="margin-bottom:18px"><div class="card-body"><div class="wf">${steps.map((s, i) => `
      <div class="wf-step ${i < at || (i === at && me.status === 'Approved') ? 'done' : i === at ? (open ? 'hold' : 'now') : ''}">
        <div class="wf-dot">${i < at ? '✓' : i + 1}</div><div class="wf-txt"><b>${esc(s[0])}</b><span>${esc(s[1])}</span></div></div>`).join('')}</div>
      ${where ? `<p style="margin:16px 0 0;font-size:var(--fs-md)"><b>Where it is now:</b> ${esc(where)}</p>` : ''}</div></div>
    ${me.status === 'Rejected' ? `<div class="note note-err"><span>This application was not approved. ${esc(me.rejectReason || '')}</span></div>` : ''}
    ${open ? `<div class="card" style="margin-bottom:18px"><div class="card-head"><h2>AD2 needs more information</h2></div><div class="card-body">
        <div class="note note-warn" style="margin-bottom:14px"><span>${esc(me.query.question)}<br><small>${esc(me.query.raisedBy)} · ${dmyt(me.query.raisedAt)}</small></span></div>
        <div class="grid g2 fields">
          <div class="f span2"><label for="ap-resp">Your response<span class="req">*</span></label><textarea id="ap-resp"></textarea></div>
          ${!me.iec ? `<div class="f"><label for="ap-iec">IEC</label><input id="ap-iec" type="text" placeholder="10 characters"></div>` : ''}
        </div>
        <p style="font-size:var(--fs-sm);color:var(--muted);margin:12px 0 0">Sending it returns the application to the AD2 maker, who continues the review.</p>
        <button class="btn btn-primary" style="margin-top:14px" type="button" data-act="ob-respond">Send response</button></div></div>` : ''}
    ${me.query && me.query.response && !open ? `<div class="note note-info" style="margin-bottom:18px"><span><b>Your last answer:</b> ${esc(me.query.response)} <small>· ${dmyt(me.query.respondedAt)}</small></span></div>` : ''}
    <div class="card"><div class="card-head"><h2>History</h2></div><div class="card-body">${timeline(me.id)}</div></div>`;
}

/* ---------- AD2 work queue ---------------------------------------------------- */
/* Items waiting on the signed-in AD2 user's role. */
function myQueue() {
  if (!S || !isAD2() || !DB) return [];
  const q = [];
  const me = myKey();
  const add = (kind, id, href, title, detail, status, at) => q.push({ kind, id, href, title, detail, status, at });
  const free = rec => !barred(rec);
  if (can('onboard.review')) DB.smes.filter(s => ['Submitted','Under Review'].includes(s.status)).forEach(s =>
    add('Application', s.id, '#/ad2/applications/' + s.id, 'Review and price', s.legalName, s.status, s.submittedAt));
  if (can('onboard.approve')) DB.smes.filter(s => s.status === 'Pending Approval' && s.reviewedBy?.key !== me).forEach(s =>
    add('Application', s.id, '#/ad2/applications/' + s.id, 'Approve', s.legalName, s.status, s.reviewedBy?.at || s.submittedAt));
  if (can('inward.record')) DB.inward.filter(i => i.status === 'Intimated').forEach(i =>
    add('Inward', i.id, '#/ad2/inward/' + i.id, 'Confirm credit', `${sme(i.smeId)?.tradingName} · ${money(i.amount, i.currency)} from ${i.remitter}`, i.status, i.intimatedBy?.at || i.valueDate));
  if (can('outward.verify')) DB.outward.filter(o => o.status === 'Submitted' && free(o)).forEach(o =>
    add('Outward', o.id, '#/ad2/outward/' + o.id, 'Verify', `${sme(o.smeId)?.tradingName} · ${o.remittanceType} ${o.purposeCode} · ${money(o.amount, o.currency)}`, o.status, o.requestDate));
  if (can('outward.approve')) DB.outward.filter(o => o.status === 'Verified' && free(o)).forEach(o =>
    add('Outward', o.id, '#/ad2/outward/' + o.id, 'Authorise', `${sme(o.smeId)?.tradingName} · ${o.remittanceType} ${o.purposeCode} · ${money(o.amount, o.currency)}`, o.status, o.wf?.verified?.at));
  if (can('outward.complete')) DB.outward.filter(o => o.status === 'Authorised' && free(o)).forEach(o =>
    add('Outward', o.id, '#/ad2/outward/' + o.id, 'Release payment', `${sme(o.smeId)?.tradingName} · ${money(o.amount, o.currency)} to ${o.beneficiary}`, o.status, o.wf?.authorised?.at));
  if (can('inward.verifyDisposal')) DB.disposals.filter(d => d.status === 'Submitted' && free(d)).forEach(d =>
    add('Disposal', d.id, '#/ad2/disposals/' + d.id, 'Verify', `${sme(d.smeId)?.tradingName} · ${money(d.amount, d.currency)}`, d.status, d.submittedAt));
  if (can('inward.approveDisposal')) DB.disposals.filter(d => d.status === 'Verified' && free(d)).forEach(d =>
    add('Disposal', d.id, '#/ad2/disposals/' + d.id, 'Authorise', `${sme(d.smeId)?.tradingName} · ${money(d.amount, d.currency)}`, d.status, d.wf?.verified?.at));
  if (can('inward.processDisposal')) DB.disposals.filter(d => d.status === 'Authorised' && free(d)).forEach(d =>
    add('Disposal', d.id, '#/ad2/disposals/' + d.id, 'Credit and issue FIRC', `${sme(d.smeId)?.tradingName} · ${money(d.amount, d.currency)}`, d.status, d.wf?.authorised?.at));
  if (can('bills.accept')) DB.bills.filter(b => ['Submitted','Resubmitted','Under Review'].includes(b.review) && b.lodgedBy?.key !== me).forEach(b =>
    add('Bill', b.id, '#/ad2/bills?s=accept', 'Accept', `${sme(b.smeId)?.tradingName} · ${b.type} ${b.invoiceNumber} · ${money(b.amount, b.currency)}`, b.review, b.lodgedBy?.at || b.invoiceDate));
  if (can('recon.confirm')) DB.allocations.filter(l => l.status === 'Proposed' && l.proposedBy?.key !== me).forEach(l =>
    add('Knock-off', l.id, '#/ad2/reconciliation?s=Proposed', 'Confirm', `${sme(l.smeId)?.tradingName} · ${l.billId} ← ${l.remId} · ${money(l.amount, l.currency)}`, l.status, l.at));
  /* the branch follows up queries with its customers and can answer for them */
  if (can('txn.resolveQuery') && can('outward.verify')) {
    DB.outward.filter(o => o.status === 'Clarification Required').forEach(o =>
      add('Query', o.id, '#/ad2/outward/' + o.id, 'Follow up with the customer', `${sme(o.smeId)?.tradingName} · ${o.query?.question || ''}`, o.status, o.query?.raisedAt));
    DB.disposals.filter(d => d.status === 'Clarification Required').forEach(d =>
      add('Query', d.id, '#/ad2/disposals/' + d.id, 'Follow up with the customer', `${sme(d.smeId)?.tradingName} · ${d.query?.question || ''}`, d.status, d.query?.raisedAt));
  }
  return q.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
}

function queueTable(q, limit) {
  const rows = limit ? q.slice(0, limit) : q;
  return rows.length ? `<div class="tablewrap"><table class="dt">
    <thead><tr><th>Item</th><th>Type</th><th>Your step</th><th>Detail</th><th>Waiting since</th><th></th></tr></thead>
    <tbody>${rows.map(x => `<tr><td class="id" data-act="go" data-href="${x.href}">${esc(x.id)}</td><td>${esc(x.kind)}</td>
      <td><b>${esc(x.title)}</b></td><td>${esc(x.detail)}</td><td>${dmyt(x.at)}</td>
      <td><button class="btn btn-ghost btn-sm" type="button" data-act="go" data-href="${x.href}">Open</button></td></tr>`).join('')}</tbody></table></div>`
    : empty('Queue clear', 'Nothing is waiting on your role right now.');
}

function viewQueue() {
  const q = myQueue();
  return shell(crumb('My work queue'), `
    <div class="page-head"><div><h1>My work queue</h1>
      <p>Everything waiting on <b>${esc(S.role)}</b>, oldest first. Items move to the next role as you act on them.</p></div></div>
    <div class="card"><div class="card-body tight">${queueTable(q)}</div></div>`);
}

/* ---------- AD2 dashboard ------------------------------------------------------ */
function viewAd2Dashboard() {
  if (S.role === 'AD2 Sales') return viewSalesDashboard();
  if (S.role === 'AD2 Administrator') return viewAdminDashboard();
  const q = myQueue();
  const volByCur = {};
  DB.outward.filter(o => o.status === 'Completed').forEach(o => volByCur[o.currency] = (volByCur[o.currency] || 0) + o.amount);
  const nc = navCount;
  const tiles = {
    'AD2 Maker': [
      kpi('Applications to price', nc('appsReview'), { go:'#/ad2/applications?s=review', tone:'accent' }),
      kpi('Payments to verify', nc('outVerify'), { go:'#/ad2/outward?s=Submitted', tone:'accent' }),
      kpi('Disposals to verify', nc('inwVerify'), { go:'#/ad2/inward?s=Submitted', tone:'accent' }),
      kpi('Queries with customers', DB.outward.concat(DB.disposals).filter(r => r.status === 'Clarification Required').length, { go:'#/ad2/queue', tone:'warn' })],
    'AD2 Checker': [
      kpi('Payments to authorise', nc('outAuth'), { go:'#/ad2/outward?s=Verified', tone:'accent' }),
      kpi('Disposals to authorise', nc('inwAuth'), { go:'#/ad2/inward?s=Verified', tone:'accent' }),
      kpi('Bills to accept', nc('billsAccept'), { go:'#/ad2/bills?s=accept' }),
      kpi('Knock-offs to confirm', nc('reconConfirm'), { go:'#/ad2/reconciliation?s=Proposed' })],
    'AD2 Compliance': [
      kpi('Applications to approve', nc('appsApprove'), { go:'#/ad2/applications?s=approve', tone:'accent' }),
      kpi('With the maker', DB.smes.filter(x => ['Submitted','Under Review'].includes(x.status)).length, { go:'#/ad2/applications' }),
      kpi('Waiting on applicants', DB.smes.filter(x => x.status === 'Clarification Required').length, { go:'#/ad2/applications', tone:'warn' }),
      kpi('Approved SMEs', DB.smes.filter(x => x.status === 'Approved').length, { go:'#/ad2/directory' })],
    'AD2 Operations': [
      kpi('Receipts to confirm', nc('inwReceipts'), { go:'#/ad2/inward?s=receipts', tone: nc('inwReceipts') ? 'warn' : '' }),
      kpi('Payments to release', nc('outRelease'), { go:'#/ad2/outward?s=Authorised', tone:'accent' }),
      kpi('Disposals to credit (FIRC)', nc('inwProcess'), { go:'#/ad2/inward?s=Authorised', tone:'accent' }),
      kpi('To authorise', nc('outAuth') + nc('inwAuth'), { go:'#/ad2/queue' })],
  }[S.role] || [];
  const blurb = {
    'AD2 Maker': 'Branch maker — onboard customers, transact for them, and verify what they submit.',
    'AD2 Checker': 'Trade checker — authorise verified payments and disposals, accept bills, confirm knock-offs.',
    'AD2 Compliance': 'Onboarding checker — approve the customers the maker has reviewed and priced.',
    'AD2 Operations': 'Trade operations — confirm receipts, authorise, release payments and credit disposals with the FIRC.',
  }[S.role] || '';
  return shell(crumb('Dashboard'), `
    <div class="page-head"><div><h1>${esc(S.role.replace('AD2 ', ''))} workspace</h1>
      <p>${esc(blurb)} Signed in as ${esc(S.name || S.role)}.</p></div>
      <div class="acts">
        ${can('inward.record') ? `<button class="btn btn-primary" type="button" data-act="in-record">Record incoming remittance</button>` : ''}
        ${can('onboard.createOffline') ? `<button class="btn btn-ghost" type="button" data-act="offline-app">Onboard a customer</button>` : ''}
        ${can('assist.transact') ? `<button class="btn btn-ghost" type="button" data-act="assist-pick" data-dir="outward">Outward for a customer</button>
          <button class="btn btn-plain" type="button" data-act="assist-pick" data-dir="inward">Inward for a customer</button>` : ''}
      </div></div>

    <div class="grid g4" style="margin-bottom:20px">${tiles.join('')}</div>

    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>Waiting on you (${q.length})</h2>
      <div class="acts"><button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/queue">Full queue</button></div></div>
      <div class="card-body tight">${queueTable(q, 8)}</div></div>

    <div class="grid g2">
      <div class="card"><div class="card-head"><h2>Completed outward volume</h2></div>
        <div class="card-body tight"><div class="tablewrap"><table class="dt">
          <thead><tr><th>Currency</th><th class="num">Volume</th><th class="num">Payments</th></tr></thead>
          <tbody>${Object.keys(volByCur).length ? Object.entries(volByCur).map(([c, v]) => `
            <tr><td><b>${esc(c)}</b></td><td class="num">${money(v)}</td>
              <td class="num">${DB.outward.filter(o => o.currency === c && o.status === 'Completed').length}</td></tr>`).join('')
            : `<tr><td colspan="3">${empty('No completed volume','Nothing has settled yet.')}</td></tr>`}</tbody>
        </table></div></div></div>
      <div class="card"><div class="card-head"><h2>Recent activity</h2></div>
        <div class="card-body">${DB.audit.slice(0, 7).map(a => `
          <div class="tl" style="padding-left:0"><div class="act">${esc(a.action)}</div>
            <div class="meta">${esc(a.record)} · ${esc(a.actor)} · ${dmyt(a.at)}</div></div>`).join('')}</div></div>
    </div>`);
}

/* ---------- applications and review ---------------------------------------- */
let appFilter = '';
const APP_FILTERS = { '':['All', () => true], review:['To review and price', s => ['Submitted','Under Review'].includes(s.status)],
  approve:['To approve', s => s.status === 'Pending Approval'], clarify:['With the applicant', s => s.status === 'Clarification Required'],
  mine:['In progress', s => !['Approved','Rejected'].includes(s.status)], done:['Decided', s => ['Approved','Rejected'].includes(s.status)] };
function viewApplications() {
  const f = APP_FILTERS[appFilter] || APP_FILTERS[''];
  const list = [...DB.smes].filter(f[1]).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  return shell(crumb('SME Applications'), `
    <div class="page-head"><div><h1>SME Applications</h1>
      <p>Digital and offline applications. A maker reviews and prices; AD2 Compliance approves${DB.settings.autoChecker ? ' (AutoChecker is on — the maker’s review commits directly)' : ''}.</p></div>
      <div class="acts">${can('onboard.createOffline')
        ? `<button class="btn btn-primary" type="button" data-act="offline-app">Create offline application</button>` : ''}</div></div>
    <div class="card"><div class="toolbar"><div class="seg-mini">${Object.entries(APP_FILTERS).map(([k, [l, fn]]) => `
        <button type="button" data-act="app-filter" data-t="${k}" aria-pressed="${appFilter === k}">${esc(l)} <span>${DB.smes.filter(fn).length}</span></button>`).join('')}</div></div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Application</th><th>Legal name</th><th>Constitution</th><th>Domain ID</th>
        <th>Service</th><th>Channel</th><th>Submitted</th><th>Status</th><th>With</th><th></th></tr></thead>
      <tbody>${list.map(s => `
        <tr><td class="id" data-act="go" data-href="#/ad2/applications/${s.id}">${esc(s.id)}</td>
          <td>${esc(s.legalName)}</td><td>${esc(s.constitution)}</td><td>${esc(s.domainId)}</td>
          <td>${esc(s.service)}</td><td>${esc(s.source)}</td><td>${dmy(s.submittedAt)}</td>
          <td>${badge(s.status)}</td><td>${esc(s.pendingWith || '—')}</td>
          <td><button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/applications/${s.id}">
            ${['Approved','Rejected'].includes(s.status) ? 'View' : 'Open'}</button></td></tr>`).join('')
          || `<tr><td colspan="10">${empty('Nothing here', 'No applications match this filter.')}</td></tr>`}</tbody>
    </table></div></div></div>`);
}

function viewApplicationReview(id) {
  const s = sme(id);
  if (!s) return shell(crumb('SME Applications','Not found'), empty('Application not found',''));
  const makerTurn = ['Submitted','Under Review'].includes(s.status) && can('onboard.review');
  const checkerTurn = s.status === 'Pending Approval' && can('onboard.approve') && s.reviewedBy?.key !== myKey();
  const editable = makerTurn;
  const source = s.status === 'Approved' ? s.config : (s.pendingConfig || null);
  if (!REVIEW || REVIEW.id !== id) {
    REVIEW = source ? { id, ...clone(source) }
      : { id, permission:s.service, currencies:[...s.requestedCurrencies], margins:{}, marginBasis:'paise', charges:[], effectiveDate:todayISO(), remarks:'' };
  }
  const r = REVIEW;
  const dis = editable ? '' : 'disabled';

  const curRows = DB.currencies.map(c => {
    const on = r.currencies.includes(c.code);
    const m = r.margins[c.code];
    const derived = r.margins.USD != null ? Math.round(r.margins.USD * c.marginMultiplier) : '';
    if (!editable && !on) return '';
    return `<tr class="${on ? 'sel' : ''}">
      <td><label class="chk"><input type="checkbox" data-act="rv-cur" data-c="${c.code}" ${on ? 'checked' : ''} ${dis}>
        <span><b>${c.code}</b> <small>${esc(c.name)}</small></span></label></td>
      <td class="num">${c.marginMultiplier.toFixed(2)}</td>
      <td class="num"><input type="number" class="alloc-in" style="width:90px"
        data-act="rv-margin" data-c="${c.code}" value="${m != null ? m : ''}" placeholder="${derived}" ${editable && on ? '' : 'disabled'} aria-label="${c.code} margin"></td>
      <td class="num">₹ ${c.refRate.toFixed(4)}</td>
      <td class="num">₹ ${customerRate(c.code, m != null ? m : (derived || 0)).toFixed(4)}</td></tr>`;
  }).join('');

  const missing = [];
  if (!r.currencies.length) missing.push('at least one enabled currency');
  r.currencies.forEach(c => { if (r.margins[c] == null && r.margins.USD == null) missing.push('margin for ' + c); });
  if (!r.effectiveDate) missing.push('effective date');
  if (!s.iec) missing.push('IEC (raise a clarification)');

  let decision;
  if (['Approved','Rejected'].includes(s.status)) {
    decision = `<div class="note ${s.status === 'Approved' ? 'note-ok' : 'note-err'}"><span>
      ${s.status === 'Approved' ? `Approved ${dmy(s.approvedAt)}${s.approvedBy ? ' by ' + esc(s.approvedBy.by) : ''}${s.reviewedBy ? '; prepared by ' + esc(s.reviewedBy.by) : ''}.`
                                : 'Rejected. ' + esc(s.rejectReason || '')}</span></div>`;
  } else if (makerTurn) {
    decision = `${missing.length ? `<div class="note note-warn"><span>Needed before sending: ${esc(missing.join('; '))}</span></div>` : ''}
      <div style="display:grid;gap:8px;margin-top:14px">
        <button class="btn btn-primary" type="button" data-act="rv-submit" data-id="${s.id}">${DB.settings.autoChecker ? 'Approve (AutoChecker)' : 'Send to Compliance for approval'}</button>
        <button class="btn btn-plain" type="button" data-act="rv-save" data-id="${s.id}">Save review</button>
        ${can('onboard.query') ? `<button class="btn btn-plain" type="button" data-act="rv-clarify" data-id="${s.id}">Request clarification from the applicant</button>` : ''}
      </div>`;
  } else if (checkerTurn) {
    decision = `<div class="note note-info"><span>Prepared by <b>${esc(s.reviewedBy?.by || 'the maker')}</b> on ${dmyt(s.reviewedBy?.at)}. Check the pricing, then approve or return it.</span></div>
      <div style="display:grid;gap:8px;margin-top:14px">
        <button class="btn btn-primary" type="button" data-act="rv-approve" data-id="${s.id}">Approve application</button>
        <button class="btn btn-plain" type="button" data-act="rv-return" data-id="${s.id}">Return to maker</button>
        <button class="btn btn-plain" type="button" data-act="rv-clarify" data-id="${s.id}">Request clarification from the applicant</button>
        <button class="btn btn-danger" type="button" data-act="rv-reject" data-id="${s.id}">Reject</button>
      </div>`;
  } else {
    const who = s.pendingWith || '—';
    decision = `<div class="note note-warn"><span>This application is with <b>${esc(who)}</b>.
      ${s.status === 'Pending Approval' && segregated('onboard.approve') ? 'Approval sits with AD2 Compliance, so that the person who prepared it does not approve it.' : ''}
      ${s.status === 'Pending Approval' && can('onboard.approve') && s.reviewedBy?.key === myKey() ? 'You prepared this review, so another Compliance user approves it.' : ''}
      ${['Submitted','Under Review'].includes(s.status) && segregated('onboard.review') ? 'Compliance does not prepare reviews — a maker prices it first.' : ''}</span></div>`;
  }

  return shell(crumb('SME Applications', s.id), `
    <div class="page-head"><div><h1>${esc(s.legalName)} ${badge(s.status)}</h1>
      <p>${esc(s.id)} · ${esc(s.constitution)} · ${esc(s.source)} · submitted ${dmy(s.submittedAt)} · with ${esc(s.pendingWith || '—')}</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="go" data-href="#/ad2/applications">Back</button></div></div>

    ${(s.dupFlags || []).length && !['Approved','Rejected'].includes(s.status) ? `<div class="note note-warn" style="margin-bottom:18px"><span>
      <b>Duplicate check:</b> ${s.dupFlags.map(esc).join('; ')}. Confirm this is a genuine new application before pricing it.</span></div>` : ''}
    ${s.query ? `<div class="note ${s.status === 'Clarification Required' ? 'note-warn' : 'note-info'}" style="margin-bottom:18px"><span>
      <b>Clarification:</b> ${esc(s.query.question)} <small>· ${esc(s.query.raisedBy)} · ${dmyt(s.query.raisedAt)}</small>
      ${s.query.response ? `<br><b>Applicant:</b> ${esc(s.query.response)} <small>· ${dmyt(s.query.respondedAt)}</small>` : '<br><i>Awaiting the applicant.</i>'}</span></div>` : ''}

    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start">
      <div class="grid" style="gap:20px">
        <div class="card"><div class="card-head"><h2>Business</h2></div><div class="card-body"><div class="kv">
          <div><div class="k">Legal name</div><div class="v">${esc(s.legalName)}</div></div>
          <div><div class="k">Trading name</div><div class="v">${esc(s.tradingName || '—')}</div></div>
          <div><div class="k">Constitution</div><div class="v">${esc(s.constitution)}</div></div>
          <div><div class="k">Registration</div><div class="v">${esc(s.regNumber)}</div></div>
          <div><div class="k">Domain ID</div><div class="v">${esc(s.domainId)}</div></div>
          <div><div class="k">Incorporated</div><div class="v">${dmy(s.incorporationDate)}</div></div>
          <div><div class="k">PAN</div><div class="v">${esc(s.pan)}</div></div>
          <div><div class="k">GSTIN</div><div class="v">${esc(s.gstin)}</div></div>
          <div><div class="k">IEC</div><div class="v">${s.iec ? esc(s.iec) : '<span class="badge b-red">Missing — mandatory</span>'}</div></div>
          <div class="span2"><div class="k">Address</div><div class="v">${esc(s.address)}</div></div>
        </div></div></div>
        <div class="card"><div class="card-head"><h2>Profile and contact</h2></div><div class="card-body"><div class="kv">
          <div><div class="k">Contact</div><div class="v">${esc(s.contactName)}, ${esc(s.designation)}</div></div>
          <div><div class="k">Email</div><div class="v">${esc(s.email)}</div></div>
          <div><div class="k">Mobile</div><div class="v">${esc(s.mobile)}</div></div>
          <div><div class="k">Industry</div><div class="v">${esc(s.industry)}</div></div>
          <div><div class="k">Expected volume</div><div class="v">${esc(s.expectedVolume)}</div></div>
          <div><div class="k">Requested service</div><div class="v">${esc(s.service)}</div></div>
          <div class="span2"><div class="k">Requested currencies</div><div class="v">${s.requestedCurrencies.join(' · ')}</div></div>
          <div class="span2"><div class="k">Description</div><div class="v">${esc(s.description)}</div></div>
        </div></div></div>
        <div class="card"><div class="card-head"><h2>Bank accounts</h2></div><div class="card-body tight"><div class="tablewrap"><table class="dt">
          <thead><tr><th>Bank</th><th>Account</th><th>IFSC</th><th>Type</th><th>PennyDrop</th></tr></thead>
          <tbody>${smeAccounts(s.id).map(a => `<tr><td>${esc(a.bank)}</td><td>${esc(a.accountNumber)}</td><td>${esc(a.ifsc)}</td>
            <td>${esc(a.currency)} · ${esc(a.type)}</td><td>${a.verified ? '<span class="badge b-green">Verified</span>' : '<span class="badge b-amber">Pending</span>'}</td></tr>`).join('')}</tbody>
        </table></div></div></div>
        <div class="card"><div class="card-head"><h2>Documents</h2></div><div class="card-body">
          ${docRows(DB.onboardDocs, s.docs || {}, 'view', { readonly:true })}</div></div>
        <div class="card"><div class="card-head"><h2>Activity</h2></div><div class="card-body">${timeline(s.id)}</div></div>
      </div>

      <div class="grid" style="gap:20px;align-items:start">
        <div class="card"><div class="card-head"><h2>Service permission</h2></div><div class="card-body">
          <div class="pillset">${['Import','Export','Both'].map(p => `
            <label><input type="radio" name="perm" data-act="rv-perm" value="${p}" ${r.permission === p ? 'checked' : ''} ${dis}> ${p}</label>`).join('')}</div>
          <p class="hint" style="margin-top:10px;font-size:var(--fs-xs);color:var(--muted)">
            Import opens AIR/DIR/OTT payments and import bills. Export opens inward disposal and export bills.</p></div></div>
        <div class="card"><div class="card-head"><h2>Currencies and margins</h2>
          ${editable ? `<div class="acts"><button class="btn btn-link" type="button" data-act="rv-cur-all">Select all</button>
            <button class="btn btn-link" type="button" data-act="rv-cur-req">As requested</button>
            <button class="btn btn-link" type="button" data-act="rv-cur-none">Clear</button></div>` : ''}</div>
          ${editable ? `<div class="card-body" style="border-bottom:1px solid var(--r4m-border)">
            <div class="grid fields" style="grid-template-columns:1fr auto auto;gap:10px;align-items:end">
              <div class="f"><label for="rv-all-m">One margin for every selected currency (paise)</label>
                <input id="rv-all-m" type="number" min="0" max="500" placeholder="e.g. 50"></div>
              <button class="btn btn-ghost btn-sm" type="button" data-act="rv-margin-all">Apply to all</button>
              <button class="btn btn-plain btn-sm" type="button" data-act="rv-margin-derive" title="Keep the USD margin and derive the rest with each currency's multiplier">Derive from USD</button>
            </div>
            <div class="hint" style="margin-top:6px">${r.currencies.length} of ${DB.currencies.length} currencies selected. Apply one margin across the board, then adjust any currency below.</div>
          </div>` : ''}
          <div class="card-body tight">
          <div class="tablewrap"><table class="dt">
            <thead><tr><th>Enabled</th><th class="num">Multiplier</th><th class="num">Margin (paise)</th>
              <th class="num">Reference</th><th class="num">Customer rate</th></tr></thead>
            <tbody>${curRows}</tbody></table></div>
          <p style="padding:12px 20px;font-size:var(--fs-xs);color:var(--muted)">
            Leave a margin blank to derive it from USD with the currency multiplier.</p></div></div>
        <div class="card"><div class="card-head"><h2>Charges</h2>
          <div class="acts">${editable ? `<button class="btn btn-ghost btn-sm" type="button" data-act="rv-charge-add">Add charge</button>` : ''}</div></div>
          <div class="card-body tight">
            ${r.charges.length ? `<div class="tablewrap"><table class="dt">
              <thead><tr><th>Charge</th><th>Basis</th><th class="num">Value</th><th>Applied</th><th></th></tr></thead>
              <tbody>${r.charges.map((c, i) => `<tr><td>${esc(c.name)}</td><td>${esc(c.basis)}</td>
                <td class="num">${c.basis === 'Percentage' ? c.value + '%' : money(c.value) + ' ' + esc(c.currency || 'INR')}</td><td>${esc(c.frequency)}</td>
                <td>${editable ? `<button class="btn btn-link" type="button" data-act="rv-charge-del" data-i="${i}">Remove</button>` : ''}</td></tr>`).join('')}</tbody>
            </table></div>` : empty('No charges', 'Charges are optional. With none, the customer pays only the FX rate. Add one if you charge a fee.')}
          </div></div>
        <div class="card"><div class="card-head"><h2>Decision</h2></div><div class="card-body">
          <div class="f"><label for="rv-eff">Effective date<span class="req">*</span></label>
            <input id="rv-eff" type="date" data-act="rv-eff" value="${esc(r.effectiveDate)}" ${dis}></div>
          <div class="f" style="margin-top:14px"><label for="rv-rem">Internal remarks</label>
            <textarea id="rv-rem" data-act="rv-remarks" ${dis}>${esc(r.remarks || '')}</textarea>
            <div class="hint">Not visible to the SME.</div></div>
          <div style="margin-top:16px">${decision}</div>
        </div></div>
        ${notesCard('sme', s)}
      </div>
    </div>`);
}

function viewDirectory() {
  const list = DB.smes.filter(s => s.status === 'Approved');
  const openApp = navAllows('#/ad2/applications');
  return shell(crumb('SME Directory'), `
    <div class="page-head"><div><h1>SME Directory</h1>
      <p>Approved SMEs with their live permissions and pricing. <b>Transact on behalf</b> opens that SME's portal as an assisted journey.</p></div></div>
    <div class="card"><div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>SME</th><th>Constitution</th><th>IEC</th><th>Permission</th><th>Currencies</th>
        <th class="num">USD margin</th><th>Effective</th><th></th></tr></thead>
      <tbody>${list.map(s => `
        <tr><td class="id" ${openApp ? `data-act="go" data-href="#/ad2/applications/${s.id}"` : ''}>${esc(s.tradingName || s.legalName)}
            <br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(s.id)} · ${esc(s.domainId)}</span></td>
          <td>${esc(s.constitution)}</td><td>${esc(s.iec || '—')}</td>
          <td>${esc(s.config.permission)}</td><td>${s.config.currencies.join(' · ')}</td>
          <td class="num">${s.config.margins.USD ?? '—'}</td><td>${dmy(s.config.effectiveDate)}</td>
          <td style="white-space:nowrap">
            ${can('assist.transact') ? `<button class="btn btn-ghost btn-sm" type="button" data-act="assist-start" data-id="${s.id}">Transact on behalf</button>` : ''}
            ${openApp ? `<button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/applications/${s.id}">Open</button>` : ''}</td></tr>`).join('')}</tbody>
    </table></div></div></div>`);
}

/* ---------- profile --------------------------------------------------------- */
function viewProfile() {
  const me = sme(ctxSmeId());
  if (!me) return shell(crumb('Profile'), empty('No business linked',''));
  const accounts = smeAccounts(me.id);
  const c = me.config;
  return shell(crumb('Profile'), `
    <div class="page-head"><div><h1>${esc(me.tradingName || me.legalName)}</h1>
      <p>Business details, account and beneficiary masters, and the pricing AD2 approved for you.</p></div></div>
    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>Business</h2></div>
      <div class="card-body"><div class="kv">
        <div><div class="k">Legal name</div><div class="v">${esc(me.legalName)}</div></div>
        <div><div class="k">Constitution</div><div class="v">${esc(me.constitution)}</div></div>
        <div><div class="k">Domain ID</div><div class="v">${esc(me.domainId)}</div></div>
        <div><div class="k">PAN</div><div class="v">${esc(me.pan)}</div></div>
        <div><div class="k">GSTIN</div><div class="v">${esc(me.gstin)}</div></div>
        <div><div class="k">IEC</div><div class="v">${esc(me.iec || '—')}</div></div>
        <div><div class="k">Onboarding channel</div><div class="v">${esc(me.source)}</div></div>
      </div></div></div>

    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>Bank account master</h2>
      <div class="acts">${can('masters.beneficiary') ? `<button class="btn btn-ghost btn-sm" type="button" data-act="acct-add">Add account</button>` : ''}</div></div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Bank</th><th>Account number</th><th>IFSC</th><th>Currency</th><th>Type</th><th class="num">Balance</th><th>Verification</th><th></th></tr></thead>
        <tbody>${accounts.map(a => `
          <tr><td><b>${esc(a.bank)}</b><br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(a.branch || '')}</span></td>
            <td>${esc(a.accountNumber)}</td><td>${esc(a.ifsc)}</td><td>${esc(a.currency)}</td><td>${esc(a.type)}</td>
            <td class="num">${a.currency === 'INR' ? inr(a.balance) : money(a.balance, a.currency)}</td>
            <td>${a.verified ? `<span class="badge b-green">Verified ${dmy(a.verifiedOn)}</span>` : `<span class="badge b-amber">Unverified</span>`}</td>
            <td>${a.verified || !can('masters.beneficiary') ? '' : `<button class="btn btn-ghost btn-sm" type="button" data-act="penny" data-id="${a.id}">Verify (PennyDrop)</button>`}</td></tr>`).join('')}
        </tbody></table></div>
        <p style="padding:12px 20px;color:var(--muted);font-size:var(--fs-xs)">
          Verified INR accounts are debited for payments and credited with export proceeds. Balances are simulated.</p></div></div>

    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>Beneficiary master</h2>
      <div class="acts">${can('masters.beneficiary') ? `<button class="btn btn-ghost btn-sm" type="button" data-act="bene-add-profile">Add beneficiary</button>` : ''}</div></div>
      <div class="card-body tight">${smeBenes(me.id).length ? `<div class="tablewrap"><table class="dt">
        <thead><tr><th>Beneficiary</th><th>Bank</th><th>Account / IBAN</th><th>SWIFT</th>
          <th>Currency</th><th>Added by</th><th>Last used</th><th></th></tr></thead>
        <tbody>${smeBenes(me.id).map(x => `
          <tr><td><b>${esc(x.name)}</b><br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(x.country)}${x.relationship ? ' · ' + esc(x.relationship) : ''}</span></td>
            <td>${esc(x.bank)}<br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(x.bankCountry)}</span></td>
            <td style="word-break:break-all">${esc(x.accountNumber)}</td><td>${esc(x.swift)}</td>
            <td>${esc(x.currency || '—')}</td>
            <td style="font-size:var(--fs-xs)">${esc(x.addedBy || '—')}<br><span style="color:var(--muted)">${dmy(x.addedOn)}</span></td>
            <td style="font-size:var(--fs-xs)">${x.lastUsed ? dmy(x.lastUsed) : '<span style="color:var(--muted)">never</span>'}</td>
            <td>${can('masters.beneficiary') ? `<button class="btn btn-link" type="button" data-act="bene-del-profile" data-id="${x.id}">Remove</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div>`
        : empty('No beneficiaries yet','Add the overseas payees you remit to, so a request can select one rather than retyping bank details.')}
      </div></div>

    ${c ? `<div class="card"><div class="card-head"><h2>Approved services and rates</h2>
      <div class="acts"><span style="color:var(--muted);font-size:var(--fs-sm)">Effective ${dmy(c.effectiveDate)}</span></div></div>
      <div class="card-body">
        <div class="kv" style="margin-bottom:20px">
          <div><div class="k">Service permission</div><div class="v">${esc(c.permission)}</div></div>
          <div><div class="k">Enabled currencies</div><div class="v">${c.currencies.join(' · ')}</div></div>
        </div>
        <div class="tablewrap"><table class="dt">
          <thead><tr><th>Currency</th>${seesMargin() ? '<th class="num">Margin (paise) <small>AD2 only</small></th><th class="num">Reference rate</th>' : ''}
            <th class="num">Your rate to pay (outward)</th><th class="num">Your rate to receive (inward)</th></tr></thead>
          <tbody>${c.currencies.map(code => `<tr><td><b>${esc(code)}</b></td>
              ${seesMargin() ? `<td class="num">${marginFor(me, code)}</td><td class="num">₹ ${currency(code).refRate.toFixed(4)}</td>` : ''}
              <td class="num">₹ ${liveRate(me, code, 'out').toFixed(4)}</td><td class="num">₹ ${liveRate(me, code, 'in').toFixed(4)}</td></tr>`).join('')}</tbody></table></div>
        <p style="font-size:var(--fs-xs);color:var(--muted);margin:10px 0 0">Indicative live rates. The rate you book on a transaction is locked for 48 hours.</p>
        <h3 style="font-size:var(--fs-md);margin:22px 0 10px">Charges</h3>
        ${c.charges.length ? `<div class="tablewrap"><table class="dt">
          <thead><tr><th>Charge</th><th>Basis</th><th class="num">Value</th><th>Applied</th></tr></thead>
          <tbody>${c.charges.map(ch => `<tr><td>${esc(ch.name)}</td><td>${esc(ch.basis)}</td>
            <td class="num">${ch.basis === 'Percentage' ? ch.value + '%' : money(ch.value) + ' ' + esc(ch.currency)}</td><td>${esc(ch.frequency)}</td></tr>`).join('')}</tbody>
        </table></div>` : '<p style="color:var(--muted);margin:0">No charges — you pay only the FX rate.</p>'}</div></div>` : ''}`);
}

/* ---------- reports ----------------------------------------------------------- */
const REPORTS = [
  { id:'onboarding',  name:'Onboarding Pendency', ad2:true },
  { id:'outward',     name:'Outward Remittance Pendency' },
  { id:'inward',      name:'Inward Disposal Pendency' },
  { id:'lodgement',   name:'Bill Lodgement Pendency' },
  { id:'outstanding', name:'Outstanding Bills' },
  { id:'boe',         name:'Advance Payments Awaiting Bill of Entry' },
  { id:'recon',       name:'Reconciliation Pendency' },
  { id:'aging',       name:'Aging Report' },
  { id:'charges',     name:'Charges Report' },
  { id:'firc',        name:'FIRCs Issued' },
  { id:'fircpending', name:'FIRCs Pending Knock-off' },
  { id:'ufi',         name:'UFI Reporting (EDPMS / IDPMS)', ad2:true },
  { id:'realised',    name:'Bills Lodged and Realised' },
  { id:'notlodged',   name:'Receipts With No Matching Bill' },
];
let reportId = 'outward', reportCur = '';

function reportRows(id) {
  const mine = r => !scoped() || r.smeId === ctxSmeId();
  const cur = r => !reportCur || r.currency === reportCur;
  const today = new Date();
  const wrap = (cols, rows, acts) => ({ cols, rows, acts });
  const nm = id => sme(id)?.tradingName || '';
  switch (id) {
    case 'onboarding':
      return wrap(['Application','SME','Channel','Status','With','Submitted','Days'],
        DB.smes.filter(s => !['Approved','Rejected'].includes(s.status)).map(s =>
          [s.id, s.legalName, s.source, s.status, s.pendingWith || '—', dmy(s.submittedAt), String(daysBetween(s.submittedAt, today))]));
    case 'outward':
      return wrap(['Request','SME','Product','Purpose','Currency','Amount','Status','With','Requested','Days'],
        DB.outward.filter(mine).filter(cur).filter(o => Engine.OPEN.includes(o.status) || o.status === 'Draft').map(o =>
          [o.id, nm(o.smeId), o.remittanceType, o.purposeCode, o.currency, money(o.amount), o.status,
           o.pendingWith || '—', dmy(o.requestDate), String(daysBetween(o.requestDate, today))]));
    case 'inward':
      return wrap(['Reference','SME','Currency','Available','Receipt status','Open instructions','Value date','Days'],
        DB.inward.filter(mine).filter(cur).filter(i => i.available > 0 || i.status === 'Instruction Submitted').map(i =>
          [i.reference, nm(i.smeId), i.currency, money(i.available), i.status,
           DB.disposals.filter(d => d.inwardId === i.id && Engine.OPEN.includes(d.status)).map(d => d.id + ' (' + d.status + ')').join(', ') || '—',
           dmy(i.valueDate), String(daysBetween(i.valueDate, today))]));
    case 'lodgement':
      return wrap(['Bill','SME','Type','Invoice','Review status','Source','Invoice date'],
        DB.bills.filter(mine).filter(cur).filter(b => ['Submitted','Resubmitted','Under Review','Query Raised'].includes(b.review)).map(b =>
          [b.id, nm(b.smeId), b.type, b.invoiceNumber, b.review, b.source, dmy(b.invoiceDate)]));
    case 'outstanding':
      return wrap(['Bill','SME','Type','Invoice','Counterparty','Currency','Bill amount','Realised / paid','Outstanding','Due date','Days to due','Aging'],
        DB.bills.filter(mine).filter(cur).filter(b => b.outstanding > 0 && b.review !== 'Rejected').map(b =>
          [b.id, nm(b.smeId), b.type, b.invoiceNumber, b.counterparty, b.currency, money(b.amount), money(b.adjusted), money(b.outstanding), dmy(b.dueDate),
           String(daysBetween(today, b.dueDate)), agingBucket(daysBetween(b.invoiceDate, today))]));
    case 'boe':
      return wrap(['Payment','SME','Beneficiary','Currency','Amount','Paid','Bill of Entry due','Days left'],
        DB.outward.filter(mine).filter(cur).filter(o => o.boeDueDate && !DB.allocations.some(l => l.remId === o.id && l.status === 'Confirmed')).map(o =>
          [o.id, nm(o.smeId), o.beneficiary, o.currency, money(o.amount), dmy(o.wf?.executed?.at), dmy(o.boeDueDate), String(daysBetween(today, o.boeDueDate))]));
    case 'recon':
      return wrap(['Allocation','SME','Side','Remittance','Bill','Currency','Amount','Proposed'],
        DB.allocations.filter(mine).filter(cur).filter(l => l.status === 'Proposed').map(l =>
          [l.id, nm(l.smeId), l.side, l.remId, l.billId, l.currency, money(l.amount), dmy(l.at)]));
    case 'aging': {
      /* One row per open item, aged from its start date (invoice date for a
         bill, value date for a receipt, processing date for a FIRC). */
      const rows = [];
      DB.bills.filter(mine).filter(cur).filter(b => b.outstanding > 0 && b.review !== 'Rejected').forEach(b => {
        const days = daysBetween(b.invoiceDate, today);
        rows.push([b.type + ' bill', b.id + ' · ' + b.invoiceNumber, nm(b.smeId), b.counterparty, b.currency, money(b.outstanding), dmy(b.invoiceDate), String(days), agingBucket(days)]);
      });
      DB.inward.filter(mine).filter(cur).filter(i => i.available > 0).forEach(i => {
        const days = daysBetween(i.valueDate, today);
        rows.push(['Receipt to dispose', i.reference, nm(i.smeId), i.remitter, i.currency, money(i.available), dmy(i.valueDate), String(days), agingBucket(days)]);
      });
      DB.disposals.filter(mine).filter(cur).filter(d => d.status === 'Processed' && (d.unallocated || 0) > 0).forEach(d => {
        const days = daysBetween(d.wf?.processed?.at, today);
        rows.push(['FIRC to knock off', d.firc, nm(d.smeId), inwardRec(d.inwardId)?.remitter || '', d.currency, money(d.unallocated), dmy(d.wf?.processed?.at), String(days), agingBucket(days)]);
      });
      const order = ['0–7 days', '8–15 days', '16–30 days', 'Over 30 days'];
      rows.sort((a, b) => order.indexOf(b[8]) - order.indexOf(a[8]) || Number(b[7]) - Number(a[7]));
      return wrap(['Item','Reference','SME','Counterparty','Currency','Open amount','Aging from','Days','Bucket'], rows);
    }
    case 'charges':
      /* the margin column is AD2's; the customer sees its rate and charges */
      return seesMargin()
        ? wrap(['Request','SME','Status','Currency','Amount','Margin (paise)','Charges','Customer rate'],
            DB.outward.filter(mine).filter(cur).filter(o => o.status !== 'Draft').map(o =>
              [o.id, nm(o.smeId), o.status, o.currency, money(o.amount), String(o.rate.margin || 0),
               inr((o.charges || []).reduce((s, c) => s + c.amount, 0)), '₹ ' + (o.rate.customerRate || 0).toFixed(4)]))
        : wrap(['Request','Status','Currency','Amount','Your rate','INR amount','Charges','Total debit'],
            DB.outward.filter(mine).filter(cur).filter(o => o.status !== 'Draft').map(o =>
              [o.id, o.status, o.currency, money(o.amount), '₹ ' + (o.rate.customerRate || 0).toFixed(4), inr(o.inrAmount || 0),
               inr((o.charges || []).reduce((s, c) => s + c.amount, 0)), inr(o.debitInr || 0)]));
    case 'firc': {
      const list = DB.disposals.filter(mine).filter(cur).filter(d => d.firc);
      return wrap(['FIRC','SME','Instruction','Receipt','Purpose','Currency','Amount','Credited','Pending knock-off','Issued','UFI portal'],
        list.map(d =>
          [d.firc, nm(d.smeId), d.id, inwardRec(d.inwardId)?.reference || d.inwardId, d.purposeCode || '', d.currency, money(d.amount),
           (d.creditCurrency || 'INR') === 'INR' ? inr(d.creditInr) : money(d.amount) + ' ' + d.currency + ' (EEFC)', money(d.unallocated || 0),
           dmy(d.wf?.processed?.at), d.fircUfi ? 'Updated · ' + d.fircUfi.ref : '—']),
        list.map(d => d.status === 'Processed' ? `<button class="btn btn-link" type="button" data-act="di-firc" data-id="${d.id}">Download</button>` : ''));
    }
    case 'fircpending':
      return wrap(['FIRC','SME','Instruction','Remitter','Currency','Pending knock-off','Issued','Days'],
        DB.disposals.filter(mine).filter(cur).filter(d => d.status === 'Processed' && (d.unallocated || 0) > 0).map(d =>
          [d.firc, nm(d.smeId), d.id, inwardRec(d.inwardId)?.remitter || '', d.currency, money(d.unallocated), dmy(d.wf?.processed?.at), String(daysBetween(d.wf?.processed?.at, today))]));
    case 'ufi': {
      const rows = [];
      DB.allocations.filter(mine).filter(cur).forEach(l => {
        if (l.ufi) rows.push([l.ufi.ref, l.ufi.system, 'Knock-off', nm(l.smeId), l.billId, l.ref || l.remId, l.currency, money(l.amount), dmyt(l.ufi.at)]);
        if (l.ufiReversal) rows.push([l.ufiReversal.ref, l.ufiReversal.system, 'Reversal', nm(l.smeId), l.billId, l.ref || l.remId, l.currency, money(l.amount), dmyt(l.ufiReversal.at)]);
      });
      DB.disposals.filter(mine).filter(cur).filter(d => d.fircUfi).forEach(d =>
        rows.push([d.fircUfi.ref, d.fircUfi.system, 'FIRC / realisation', nm(d.smeId), '—', d.firc, d.currency, money(d.amount), dmyt(d.fircUfi.at)]));
      return wrap(['UFI reference','System','Report','SME','Bill','Remittance','Currency','Amount','Reported'], rows.sort((a, b) => a[0] < b[0] ? 1 : -1));
    }
    case 'realised':
      return wrap(['Bill','SME','Type','Invoice','Currency','Bill amount','Realised / paid','Outstanding','Settlement','Knocked off in UFI portal'],
        DB.bills.filter(mine).filter(cur).filter(b => b.adjusted > 0).map(b => {
          const led = DB.allocations.filter(l => l.billId === b.id && l.status === 'Confirmed' && l.ufi);
          return [b.id, nm(b.smeId), b.type, b.invoiceNumber, b.currency, money(b.amount), money(b.adjusted), money(b.outstanding), b.settlement,
            led.length ? `Yes — ${b.type === 'Export' ? 'EDPMS' : 'IDPMS'} updated (${led.map(l => l.ufi.ref).join(', ')})` : 'Pending'];
        }));
    case 'notlodged':
      return wrap(['Receipt','SME','Remitter','Currency','Amount','Value date','Note'],
        DB.inward.filter(mine).filter(cur).filter(i => !DB.bills.some(b => b.smeId === i.smeId && b.type === 'Export'
          && b.counterparty === i.remitter && b.currency === i.currency)).map(i =>
          [i.reference, nm(i.smeId), i.remitter, i.currency, money(i.amount), dmy(i.valueDate), 'No export bill lodged for this buyer']));
    default: return wrap([], []);
  }
}

function viewReports() {
  const available = REPORTS.filter(r => !r.ad2 || !scoped());
  if (!available.some(r => r.id === reportId)) reportId = available[0].id;
  const { cols, rows, acts } = reportRows(reportId);
  const def = REPORTS.find(r => r.id === reportId);
  return shell(crumb('Reports', def.name), `
    <div class="page-head"><div><h1>Reports</h1>
      <p>Pendency, outstanding and regulatory reporting from live data. Totals stay separate by currency.</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="export-report">Export CSV</button></div></div>
    <div class="card">
      <div class="toolbar">
        <select data-act="report-pick" aria-label="Report">
          ${available.map(r => `<option value="${r.id}" ${r.id === reportId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
        <select data-act="report-cur" aria-label="Currency"><option value="">All currencies</option>
          ${DB.currencies.map(c => `<option ${reportCur === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}</select>
        <button class="btn btn-plain btn-sm" type="button" data-act="report-reset">Reset filters</button>
        <div class="spacer"></div>
        <span style="color:var(--muted);font-size:var(--fs-sm)">${plural(rows.length, 'row')}</span>
      </div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr>${cols.map(c => `<th data-sort>${esc(c)}</th>`).join('')}${acts ? '<th></th>' : ''}</tr></thead>
        <tbody>${rows.length ? rows.map((r, k) => `<tr>${r.map((v, i) =>
          `<td${i > 0 && /^[\d,.\s₹-]+$/.test(String(v)) ? ' class="num"' : ''}>${esc(v)}</td>`).join('')}${acts ? `<td>${acts[k] || ''}</td>` : ''}</tr>`).join('')
          : `<tr><td colspan="${cols.length || 1}">${empty('Nothing to report','No records match the selected report and filters.')}</td></tr>`}</tbody>
      </table></div></div>
    </div>`);
}

function viewIntegrations() {
  return shell(crumb('Integrations'), `
    <div class="page-head"><div><h1>Integrations</h1>
      <p>Channels that lodge bills automatically. Connections are simulated in this demo.</p></div></div>
    <div class="grid g2" style="margin-bottom:20px">
      <div class="card"><div class="card-head"><h2>SFTP</h2><div class="acts"><span class="badge b-green">Connected</span></div></div>
        <div class="card-body"><div class="kv">
          <div><div class="k">Host</div><div class="v">sftp.ad2trade.example</div></div>
          <div><div class="k">Schedule</div><div class="v">Every 6 hours</div></div></div></div></div>
      <div class="card"><div class="card-head"><h2>SAP API</h2><div class="acts"><span class="badge b-green">Connected</span></div></div>
        <div class="card-body"><div class="kv">
          <div><div class="k">Endpoint</div><div class="v">sap.sme.example/odata</div></div>
          <div><div class="k">Sync</div><div class="v">On invoice creation</div></div></div></div></div>
    </div>
    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>SAP jobs</h2></div><div class="card-body tight">${jobsTable('SAP API')}</div></div>
    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>SFTP jobs</h2></div><div class="card-body tight">${jobsTable('SFTP')}</div></div>
    <div class="card"><div class="card-head"><h2>CSV uploads</h2></div><div class="card-body tight">${jobsTable('CSV upload')}</div></div>`);
}

/* ---------- administration ------------------------------------------------------ */
function rolesPane() {
  const roles = [...DB.roles].sort((a, b) => a.order - b.order);
  const groups = [...new Set(DB.capabilities.map(c => c.group))];
  const cell = (r, capId) => r.can.includes(capId) ? '<span class="badge b-green">Yes</span>'
    : (r.segregated || []).includes(capId) ? '<span class="badge b-amber">No — segregated</span>' : '<span style="color:var(--muted)">No</span>';
  const matrix = groups.map(g => `
    <tr><td colspan="${roles.length + 1}" style="background:var(--surface-alt);font-weight:600;
      font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:.05em;color:var(--r4m-table-header)">${esc(g)}</td></tr>
    ${DB.capabilities.filter(c => c.group === g).map(c => `
      <tr><td>${esc(c.label)}<br><span style="color:var(--muted);font-size:var(--fs-xs);font-family:ui-monospace,Menlo,monospace">${esc(c.id)}</span></td>
        ${roles.map(r => `<td>${cell(r, c.id)}</td>`).join('')}</tr>`).join('')}`).join('');
  const defs = roles.map(r => `
    <div class="card" style="box-shadow:none;margin-bottom:var(--s3)">
      <div class="card-head"><h2>${esc(r.id)}</h2>
        <div class="acts"><span class="badge ${r.portal === 'AD2' ? 'b-blue' : 'b-teal'}">${esc(r.portal)} portal</span>
          <span style="color:var(--muted);font-size:var(--fs-sm)">${r.can.length} capabilities</span></div></div>
      <div class="card-body">
        <p style="margin:0 0 var(--s3);font-size:var(--fs-md)">${esc(r.summary)}</p>
        ${(r.segregated || []).length ? `<div class="note note-warn" style="margin-bottom:var(--s3)"><span>
          <b>Withheld by design:</b> ${r.segregated.map(id => esc(DB.capabilities.find(c => c.id === id)?.label || id)).join(' · ')}</span></div>` : ''}
        ${r.note ? `<div class="note note-info"><span>${esc(r.note)}</span></div>` : ''}
      </div></div>`).join('');
  return `<div class="card-body">
      <div class="note note-ok" style="margin-bottom:var(--s5)"><span>These permissions are enforced by the API on every action, not only by hiding buttons.
        Each transaction also needs a different person at each stage — submit, verify, authorise, release.</span></div>
      <h3 style="font-size:var(--fs-md);margin:0 0 var(--s3)">What each role is for</h3>${defs}
      <h3 style="font-size:var(--fs-md);margin:var(--s6) 0 var(--s3)">Permission matrix</h3>
      <div class="tablewrap"><table class="dt">
        <thead><tr><th style="min-width:260px">Action</th>
          ${roles.map(r => `<th>${esc(r.id).replace('AD2 ', 'AD2<br>').replace('SME ', 'SME<br>')}</th>`).join('')}</tr></thead>
        <tbody>${matrix}</tbody></table></div></div>`;
}
