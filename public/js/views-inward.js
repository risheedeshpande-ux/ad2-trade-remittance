/* ==========================================================================
   Inward remittance and disposal instructions
   Operations records the SWIFT credit; the SME disposes of it against export
   bills; a maker verifies, a checker authorises and operations processes the
   credit and issues the FIRC.
   ========================================================================== */

let inTab = 'receipts';

function viewInwardList() {
  const me = scoped() ? sme(ctxSmeId()) : null;
  if (me && !perm(me).exportSide)
    return shell(crumb('Inward Remittance'), denied('Inward remittance is not enabled',
      `Your approved service permission is “${me.config?.permission || '—'}”. Inward disposal needs Export or Both.`));
  const ad2 = isAD2() && !acting();
  const root = ad2 ? 'ad2' : 'sme';
  const list = scoped() ? DB.inward.filter(i => i.smeId === ctxSmeId()) : DB.inward;
  const dis = scoped() ? DB.disposals.filter(d => d.smeId === ctxSmeId()) : DB.disposals;
  const openDis = dis.filter(d => Engine.OPEN.includes(d.status)).length;

  const receipts = `<div class="tablewrap"><table class="dt">
      <thead><tr><th>Reference</th>${ad2 ? '<th>SME</th>' : ''}<th>Remitter</th><th>Value date</th>
        <th>Currency</th><th class="num">Received</th><th class="num">Available</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.length ? list.map(i => `
        <tr><td class="id" data-act="go" data-href="#/${root}/inward/${i.id}">${esc(i.reference)}</td>
          ${ad2 ? `<td>${esc(sme(i.smeId)?.tradingName || '')}</td>` : ''}
          <td>${esc(i.remitter)}<br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(i.remitterCountry)}</span></td>
          <td>${dmy(i.valueDate)}</td><td>${esc(i.currency)}</td>
          <td class="num">${money(i.amount)}</td><td class="num">${money(i.available)}</td>
          <td>${badge(i.status)}</td>
          <td style="white-space:nowrap">${
            i.available > 0 && asSme() && can('inward.dispose')
              ? `<button class="btn btn-ghost btn-sm" type="button" data-act="go" data-href="#/sme/inward/${i.id}/dispose">Dispose</button>`
              : i.available > 0 && ad2 && can('assist.transact')
                ? `<button class="btn btn-ghost btn-sm" type="button" data-act="assist-dispose" data-id="${i.id}">Dispose on behalf</button>`
                : `<button class="btn btn-link" type="button" data-act="go" data-href="#/${root}/inward/${i.id}">Open</button>`}</td></tr>`).join('')
      : `<tr><td colspan="9">${empty('No inward remittance yet', ad2 ? 'Record an incoming SWIFT credit to start.' : 'Receipts appear here once AD2 records the incoming credit.')}</td></tr>`}</tbody>
    </table></div>`;

  const instructions = `<div class="tablewrap"><table class="dt">
      <thead><tr><th>Instruction</th>${ad2 ? '<th>SME</th>' : ''}<th>Receipt</th><th class="num">Amount</th><th>Bills</th>
        <th>Submitted</th><th>Status</th><th>With</th><th></th></tr></thead>
      <tbody>${dis.length ? dis.map(d => `
        <tr><td class="id" data-act="go" data-href="#/${root}/disposals/${d.id}">${esc(d.id)}</td>
          ${ad2 ? `<td>${esc(sme(d.smeId)?.tradingName || '')}</td>` : ''}
          <td>${esc(inwardRec(d.inwardId)?.reference || d.inwardId)}</td>
          <td class="num">${money(d.amount, d.currency)}</td>
          <td>${d.allocations.map(a => esc(a.billId)).join(', ')}</td>
          <td>${dmy(d.submittedAt)}</td><td>${badge(d.status)}</td><td>${esc(d.pendingWith || '—')}</td>
          <td><button class="btn btn-link" type="button" data-act="go" data-href="#/${root}/disposals/${d.id}">Open</button></td></tr>`).join('')
      : `<tr><td colspan="9">${empty('No instructions yet','Disposal instructions appear here once submitted.')}</td></tr>`}</tbody>
    </table></div>`;

  return shell(crumb('Inward Remittance'), `
    <div class="page-head"><div><h1>Inward Remittance</h1>
      <p>${ad2 ? 'Incoming export proceeds and the disposal instructions against them.'
               : 'Export proceeds received for you. Submit a disposal instruction to apply each receipt to your export bills.'}</p></div>
      <div class="acts">
        ${ad2 && can('inward.record') ? `<button class="btn btn-primary" type="button" data-act="in-record">Record incoming remittance</button>` : ''}
        ${ad2 && can('assist.transact') ? `<button class="btn btn-ghost" type="button" data-act="assist-pick" data-dir="inward">Disposal for an SME</button>` : ''}
        <button class="btn btn-plain" type="button" data-act="export-csv" data-what="inward">Export CSV</button></div></div>
    <div class="card">
      <div class="tabs">
        <button type="button" data-act="in-tab" data-t="receipts" aria-selected="${inTab === 'receipts'}">Receipts<span class="n">${list.length}</span></button>
        <button type="button" data-act="in-tab" data-t="instructions" aria-selected="${inTab === 'instructions'}">Disposal instructions<span class="n">${openDis ? openDis + ' open' : dis.length}</span></button>
      </div>
      <div class="card-body tight">${inTab === 'receipts' ? receipts : instructions}</div>
    </div>`);
}

function viewInwardDetail(id) {
  const i = inwardRec(id);
  if (!i || (scoped() && i.smeId !== ctxSmeId())) return shell(crumb('Inward Remittance','Not found'), empty('Receipt not found','It does not exist or belongs to another business.'));
  const ad2 = isAD2() && !acting();
  const root = ad2 ? 'ad2' : 'sme';
  const dis = DB.disposals.filter(d => d.inwardId === i.id);
  return shell(crumb('Inward Remittance', i.reference), `
    <div class="page-head"><div><h1>${esc(i.reference)} ${badge(i.status)}</h1>
      <p>${esc(i.remitter)} · ${money(i.amount, i.currency)} received ${dmy(i.valueDate)}${ad2 ? ' · ' + esc(sme(i.smeId)?.tradingName || '') : ''}</p></div>
      <div class="acts">
        ${i.available > 0 && asSme() && can('inward.dispose') ? `<button class="btn btn-primary" type="button" data-act="go" data-href="#/sme/inward/${i.id}/dispose">Submit disposal instruction</button>` : ''}
        ${i.available > 0 && ad2 && can('assist.transact') ? `<button class="btn btn-primary" type="button" data-act="assist-dispose" data-id="${i.id}">Dispose on behalf</button>` : ''}
        <button class="btn btn-plain" type="button" data-act="go" data-href="#/${root}/inward">Back to list</button></div></div>
    <div class="grid g2" style="align-items:start">
      <div class="card"><div class="card-head"><h2>Receipt</h2></div><div class="card-body"><div class="kv">
        <div><div class="k">SWIFT reference</div><div class="v">${esc(i.reference)}</div></div>
        <div><div class="k">Value date</div><div class="v">${dmy(i.valueDate)}</div></div>
        <div><div class="k">Remitter</div><div class="v">${esc(i.remitter)}</div></div>
        <div><div class="k">Remitter country</div><div class="v">${esc(i.remitterCountry)}</div></div>
        <div><div class="k">Received</div><div class="v big">${money(i.amount, i.currency)}</div></div>
        <div><div class="k">Available for disposal</div><div class="v big">${money(i.available, i.currency)}</div></div>
        <div><div class="k">Product</div><div class="v">${esc(productLabel('TRADE'))}</div></div>
        <div><div class="k">FIRC</div><div class="v">${i.firc ? esc(i.firc) : 'Issued when a disposal is processed'}</div></div>
        <div class="span2"><div class="k">Remarks</div><div class="v">${esc(i.remarks || '—')}</div></div>
      </div></div></div>
      <div class="card"><div class="card-head"><h2>Disposal instructions</h2></div><div class="card-body tight">
        ${dis.length ? `<div class="tablewrap"><table class="dt">
          <thead><tr><th>Instruction</th><th class="num">Amount</th><th>Status</th><th>With</th><th></th></tr></thead>
          <tbody>${dis.map(d => `<tr><td class="id" data-act="go" data-href="#/${root}/disposals/${d.id}">${esc(d.id)}</td>
              <td class="num">${money(d.amount, d.currency)}</td><td>${badge(d.status)}</td><td>${esc(d.pendingWith || '—')}</td>
              <td><button class="btn btn-link" type="button" data-act="go" data-href="#/${root}/disposals/${d.id}">Open</button></td></tr>`).join('')}</tbody></table></div>`
          : empty('No instruction yet','Submit a disposal instruction to apply this receipt.')}</div></div>
    </div>
    <div class="card" style="margin-top:20px"><div class="card-head"><h2>Activity</h2></div>
      <div class="card-body">${timeline(i.id)}</div></div>`);
}

/* ---------- disposal instruction form ------------------------------------- */
function viewDispose(inwardId) {
  const i = inwardRec(inwardId);
  if (!i || i.smeId !== ctxSmeId()) return shell(crumb('Inward Remittance','Not found'), empty('Receipt not found',''));
  if (i.available <= 0) return shell(crumb('Inward Remittance', i.reference), `<div class="note note-ok"><span>Nothing is left to dispose on ${esc(i.reference)}.</span></div>`);
  if (!DI_DRAFT || DI_DRAFT.inwardId !== inwardId) {
    DI_DRAFT = { inwardId, smeId:i.smeId, creditAccountId:'', allocations:[], remarks:'', docs:{}, rate:RATE_NONE() };
  }
  const d = DI_DRAFT;
  const me = sme(i.smeId);
  const accounts = smeAccounts(i.smeId).filter(a => a.currency === 'INR');
  const openBills = DB.bills.filter(b => b.smeId === i.smeId && b.type === 'Export'
    && b.outstanding > 0 && b.currency === i.currency && b.review === 'Accepted');
  const allocated = d.allocations.reduce((s, a) => s + a.amount, 0);
  const margin = marginFor(me, i.currency);
  const rate = d.rate.mode === 'none' ? customerRate(i.currency, -margin) : d.rate.customerRate;
  const list = checklistFor('TRADE', '', 0);

  let rateBox;
  if (d.rate.mode === 'booked') {
    rateBox = `<div class="ratebox locked"><div class="row"><div>
        <div class="live">1 ${esc(i.currency)} = ₹ ${d.rate.customerRate.toFixed(4)}</div>
        <div class="tick">Booked ${dmyt(d.rate.bookedAt)} · locked 48 hours · treasury notified</div></div>
      <div class="spacer"></div>
      <button class="btn btn-plain btn-sm" type="button" data-act="di-rate-clear">Release</button></div></div>`;
  } else if (d.rate.mode === 'deal') {
    rateBox = `<div class="ratebox locked"><div class="row"><div>
        <div class="live">Deal ${esc(d.rate.dealRef)} · ₹ ${Number(d.rate.customerRate).toFixed(4)}</div>
        <div class="tick">Rate agreed with the treasury desk.</div></div>
      <div class="spacer"></div>
      <button class="btn btn-plain btn-sm" type="button" data-act="di-rate-clear">Clear</button></div></div>`;
  } else {
    rateBox = `<div class="ratebox"><div class="row"><div>
        <div class="k" style="font-size:var(--fs-xs);text-transform:uppercase;color:#0b5f61">Live rate (simulated feed)</div>
        <div class="live">1 ${esc(i.currency)} = ₹ ${rate.toFixed(4)}</div>
        <div class="tick">Reference ₹${currency(i.currency).refRate.toFixed(4)} less your margin ${margin} paise</div></div>
      <div class="spacer"></div>
      <button class="btn btn-primary" type="button" data-act="di-book-rate">Book rate</button>
      <button class="btn btn-ghost" type="button" data-act="di-deal-ref">Enter FX deal reference</button></div></div>`;
  }

  return shell(crumb('Inward Remittance', i.reference, 'Disposal instruction'), `
    <div class="page-head"><div><h1>Disposal instruction</h1>
      <p>${esc(i.reference)} · ${esc(i.remitter)} · ${money(i.available, i.currency)} available</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="go" data-href="#/sme/inward/${i.id}">Cancel</button></div></div>

    <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);align-items:start">
      <div class="grid" style="gap:20px">
        <div class="card"><div class="card-head"><h2>1 · Export bill to knock off<span class="req">*</span></h2></div>
          <div class="card-body tight">
            ${openBills.length ? `<div class="tablewrap"><table class="dt">
              <thead><tr><th>Bill</th><th>Invoice</th><th>Counterparty</th><th>Due</th>
                <th class="num">Available</th><th class="num">Apply</th></tr></thead>
              <tbody>${openBills.map(b => { const a = d.allocations.find(x => x.billId === b.id);
                const avail = Engine.billAvailable(DB, b);
                const cap = Math.min(avail, i.available);
                return `<tr class="${a ? 'sel' : ''}"><td class="id">${esc(b.id)}</td><td>${esc(b.invoiceNumber)}</td>
                  <td>${esc(b.counterparty)}${b.counterparty === i.remitter ? ' <span class="badge b-teal">remitter</span>' : ''}</td><td>${dmy(b.dueDate)}</td>
                  <td class="num">${money(avail, b.currency)}</td>
                  <td class="num"><input type="number" class="alloc-in" data-act="di-alloc" data-bill="${b.id}" value="${a ? a.amount : ''}" placeholder="0.00" min="0" max="${cap}" aria-label="Apply to ${esc(b.id)}">
                    ${!a && cap > 0 ? `<button class="btn btn-link" type="button" data-act="di-alloc-max" data-bill="${b.id}">Use ${money(cap)}</button>` : ''}</td></tr>`;
              }).join('')}</tbody></table></div>`
            : empty('No outstanding export bills', `No accepted export bills outstanding in ${i.currency}. Lodge the export bill first — an AD2 checker accepts it.`)}
          </div></div>

        <div class="card"><div class="card-head"><h2>2 · Account to credit<span class="req">*</span></h2></div><div class="card-body">
          <div class="f" data-fld="creditAccountId"><label for="di-acct">Credit account (INR)</label>
            <select id="di-acct" data-dik="creditAccountId"><option value="">Select…</option>
              ${accounts.map(a => `<option value="${a.id}" ${d.creditAccountId === a.id ? 'selected' : ''} ${a.verified ? '' : 'disabled'}>
                ${esc(a.bank)} · ${esc(a.accountNumber)} · ${esc(a.type)}${a.verified ? '' : ' (unverified)'}</option>`).join('')}</select>
            <div class="hint">Verified INR accounts from your master. <button class="btn-link" type="button" data-act="go" data-href="#/sme/profile">Manage accounts</button></div>
            <div class="err">Select an account to credit.</div></div>
          </div></div>

        <div class="card"><div class="card-head"><h2>3 · Rate</h2></div><div class="card-body">${rateBox}</div></div>

        <div class="card"><div class="card-head"><h2>4 · Documents</h2>
          <div class="acts"><span style="color:var(--muted);font-size:var(--fs-sm)">TRADE document policy</span></div></div>
          <div class="card-body">${docRows(list, d.docs, 'di')}</div></div>

        <div class="card"><div class="card-head"><h2>Remarks</h2></div><div class="card-body">
          <div class="f"><label for="di-rem">Remarks</label>
            <textarea id="di-rem" data-dik="remarks" maxlength="500">${esc(d.remarks)}</textarea></div>
        </div></div>
      </div>

      <div class="card" style="position:sticky;top:130px"><div class="card-head"><h2>Summary</h2></div><div class="card-body">
        <div class="calc">
          <div class="line"><span>Receipt available</span><b>${money(i.available, i.currency)}</b></div>
          <div class="line"><span>Applied to bills</span><b>${money(allocated, i.currency)}</b></div>
          <div class="line"><span>Conversion rate</span><b>₹ ${Number(rate).toFixed(4)}</b></div>
          <div class="line total"><span>Credit to account</span><b>${inr(allocated * rate)}</b></div>
          <div class="line"><span>Remaining on receipt</span><b>${money(i.available - allocated, i.currency)}</b></div>
        </div>
        <p style="font-size:var(--fs-xs);color:var(--muted);margin:12px 0 0">
          Partial disposal is allowed. The remaining balance stays available for a later instruction.</p>
        <div class="note note-info" style="margin-top:14px"><span style="font-size:var(--fs-xs)">
          After you submit: an AD2 maker verifies, a checker authorises, and operations credits your account and issues the FIRC.</span></div>
        <div style="display:grid;gap:8px;margin-top:18px">
          <button class="btn btn-primary" type="button" data-act="di-submit" data-id="${i.id}">Submit instruction</button>
        </div></div></div>
    </div>`);
}

/* ---------- disposal detail ------------------------------------------------ */
function viewDisposalDetail(id) {
  const d = disposalRec(id);
  if (!d || (scoped() && d.smeId !== ctxSmeId())) return shell(crumb('Inward Remittance','Not found'), empty('Instruction not found',''));
  const ad2 = isAD2() && !acting();
  const root = ad2 ? 'ad2' : 'sme';
  const i = inwardRec(d.inwardId), a = acct(d.creditAccountId), s = sme(d.smeId);
  const list = checklistFor('TRADE', '', 0);
  const actions = [];
  if (ad2) {
    if (d.status === 'Submitted' && can('inward.verifyDisposal')) actions.push(`<button class="btn btn-primary" type="button" data-act="di-verify" data-id="${d.id}">Verify</button>`);
    if (d.status === 'Verified' && can('inward.approveDisposal')) actions.push(`<button class="btn btn-primary" type="button" data-act="di-authorise" data-id="${d.id}">Authorise</button>`);
    if (d.status === 'Authorised' && can('inward.processDisposal')) actions.push(`<button class="btn btn-primary" type="button" data-act="di-process" data-id="${d.id}">Credit and issue FIRC</button>`);
    if (['Submitted','Verified'].includes(d.status) && can('outward.query')) actions.push(`<button class="btn btn-plain" type="button" data-act="di-query" data-id="${d.id}">Raise query</button>`);
    if (['Submitted','Verified','Authorised','Clarification Required'].includes(d.status) && can('outward.reject')) actions.push(`<button class="btn btn-danger" type="button" data-act="di-reject" data-id="${d.id}">Reject</button>`);
    const waiting = { 'Submitted':'inward.verifyDisposal', 'Verified':'inward.approveDisposal', 'Authorised':'inward.processDisposal' }[d.status];
    if (waiting && !can(waiting)) actions.push(`<span class="badge b-amber" style="align-self:center">With ${esc(d.pendingWith)} — ${segregated(waiting) ? 'withheld from your role by design' : 'not your step'}</span>`);
  }
  if (d.status === 'Processed') actions.push(`<button class="btn btn-ghost" type="button" data-act="di-firc" data-id="${d.id}">FIRC / credit advice</button>`);
  const respond = asSme() && d.status === 'Clarification Required' && d.query;
  if (respond && (!RESP || RESP.id !== d.id)) RESP = { id:d.id, text:'', docs:{} };

  return shell(crumb('Inward Remittance', d.id), `
    <div class="page-head"><div><h1>${esc(d.id)} ${badge(d.status)}</h1>
      <p>Disposal of ${money(d.amount, d.currency)} from ${esc(i?.reference || d.inwardId)}${ad2 ? ' · ' + esc(s?.tradingName || '') : ''}
        ${d.source === 'AD2 Assisted' ? ' · <span class="badge b-purple">Assisted</span>' : ''}</p></div>
      <div class="acts">${actions.join('')}
        <button class="btn btn-plain" type="button" data-act="go" data-href="#/${root}/inward/${d.inwardId}">Open receipt</button></div></div>

    <div class="card" style="margin-bottom:18px"><div class="card-body">${wfStepper(d, 'disposal')}</div></div>
    ${d.status === 'Processed' ? `<div class="note note-ok" style="margin-bottom:18px"><span>
      <b>Credited.</b> ${inr(d.creditInr)} to ${a ? esc(a.bank + ' ' + a.accountNumber) : 'the account'} · <b>${esc(d.firc)}</b> issued.</span></div>` : ''}
    ${d.query ? `<div class="note ${d.status === 'Clarification Required' ? 'note-warn' : 'note-info'}" style="margin-bottom:18px">
      <span><b>Query from AD2:</b> ${esc(d.query.question)}<br><small>${esc(d.query.raisedBy)} · ${dmyt(d.query.raisedAt)}</small>
      ${d.query.response ? `<br><b>Response:</b> ${esc(d.query.response)}` : ''}</span></div>` : ''}
    ${respond ? `<div class="card" style="margin-bottom:18px"><div class="card-head"><h2>Respond to the query</h2></div><div class="card-body">
        <div class="f"><label for="resp-text">Your response<span class="req">*</span></label>
          <textarea id="resp-text" data-act="resp-text">${esc(RESP.text)}</textarea></div>
        <h3 style="font-size:var(--fs-sm);margin:16px 0 8px">Replace or add documents (optional)</h3>
        ${docRows(list.map(x => ({ ...x, required:false, note: d.docs && d.docs[x.id] ? 'On file: ' + d.docs[x.id].filename : 'Not on file' })), RESP.docs, 'resp')}
        <button class="btn btn-primary" style="margin-top:16px" type="button" data-act="di-respond" data-id="${d.id}">Send response</button>
      </div></div>` : ''}
    ${d.status === 'Rejected' ? `<div class="note note-err" style="margin-bottom:18px"><span><b>Rejected:</b> ${esc(d.rejectReason || '')} The amount is available on the receipt again.</span></div>` : ''}

    <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);align-items:start">
      <div class="grid" style="gap:20px">
        <div class="card"><div class="card-head"><h2>Export bills</h2></div><div class="card-body tight"><div class="tablewrap"><table class="dt">
          <thead><tr><th>Bill</th><th>Invoice</th><th>Counterparty</th><th class="num">Applied</th><th>Bill settlement</th></tr></thead>
          <tbody>${d.allocations.map(x => { const b = bill(x.billId);
            return `<tr><td class="id">${esc(x.billId)}</td><td>${esc(b?.invoiceNumber || '—')}</td><td>${esc(b?.counterparty || '—')}</td>
              <td class="num">${money(x.amount, d.currency)}</td><td>${badge(b?.settlement || '—')}</td></tr>`; }).join('')}</tbody></table></div></div></div>
        <div class="card"><div class="card-head"><h2>Documents</h2></div><div class="card-body">${docRows(list, d.docs || {}, 'view', { readonly:true })}</div></div>
        <div class="card"><div class="card-head"><h2>Activity</h2></div><div class="card-body">${timeline(d.id)}</div></div>
      </div>
      <div class="grid" style="gap:20px;align-items:start">
        <div class="card"><div class="card-head"><h2>Credit</h2></div><div class="card-body">
          <div class="calc">
            <div class="line"><span>Amount</span><b>${money(d.amount, d.currency)}</b></div>
            <div class="line"><span>Rate</span><b>₹ ${(d.rate.customerRate || 0).toFixed(4)}${d.rate.dealRef ? ' · ' + esc(d.rate.dealRef) : ''}</b></div>
            <div class="line total"><span>${d.status === 'Processed' ? 'Credited' : 'To credit'}</span><b>${inr(d.creditInr || d.amount * d.rate.customerRate)}</b></div>
          </div>
          <div class="kv" style="margin-top:14px"><div class="span2"><div class="k">Credit account</div>
            <div class="v">${a ? esc(a.bank + ' · ' + a.accountNumber) : '—'}</div></div>
            <div class="span2"><div class="k">Remarks</div><div class="v">${esc(d.remarks || '—')}</div></div></div>
        </div></div>
        ${ad2 ? notesCard('disposal', d) : ''}
      </div>
    </div>`);
}

function fircHTML(d) {
  const s = sme(d.smeId), i = inwardRec(d.inwardId), a = acct(d.creditAccountId);
  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  return `<div class="advice">
    <div class="advice-head"><div><b>AD2 Trade Services</b><br><small>Foreign Inward Remittance Certificate and credit advice</small></div>
      <div style="text-align:right"><b>${esc(d.firc)}</b><br><small>${dmyt(d.wf?.processed?.at)}</small></div></div>
    <table class="advice-t">
      ${row('Beneficiary (exporter)', esc(s?.legalName || '') + '<br><small>IEC ' + esc(s?.iec || '') + '</small>')}
      ${row('Remitter', esc(i?.remitter || '') + ', ' + esc(i?.remitterCountry || ''))}
      ${row('SWIFT reference', esc(i?.reference || '') + ' · value date ' + dmy(i?.valueDate))}
      ${row('Amount disposed', '<b>' + money(d.amount, d.currency) + '</b>')}
      ${row('Exchange rate', '₹ ' + (d.rate.customerRate || 0).toFixed(4))}
      ${row('INR credited', '<b>' + inr(d.creditInr) + '</b> to ' + (a ? esc(a.bank + ' ' + a.accountNumber) : ''))}
      ${row('Purpose', 'TRADE — receipts against export of goods')}
      ${row('Bills realised', d.allocations.map(x => `${esc(x.billId)} (${esc(bill(x.billId)?.invoiceNumber || '')}) — ${money(x.amount, d.currency)}`).join('<br>'))}
    </table>
    <p class="advice-foot">Demo document — generated by the AD2 Trade Remittance prototype. Not a real FIRC.</p></div>`;
}

/* Operations: record an incoming SWIFT credit. */
function recordInwardModal() {
  const pool = DB.smes.filter(s => s.status === 'Approved' && perm(s).exportSide);
  if (!pool.length) { toast('No approved SME has Export permission yet.', 'err'); return; }
  const first = pool[0];
  modal({ title:'Record incoming remittance', okLabel:'Record receipt', wide:true, body:`
    <p style="font-size:var(--fs-md);margin:0 0 14px">Record the SWIFT MT103 credit received for an exporter. The SME is notified to submit a disposal instruction.</p>
    <div class="grid g2 fields">
      <div class="f span2"><label for="ri-sme">Beneficiary SME</label><select id="ri-sme" data-act="ri-sme">
        ${pool.map(s => `<option value="${s.id}">${esc(s.tradingName)} · ${esc(s.config.currencies.join('/'))}</option>`).join('')}</select></div>
      <div class="f"><label for="ri-rem">Remitter</label><input id="ri-rem" type="text"></div>
      <div class="f"><label for="ri-cty">Remitter country</label><input id="ri-cty" type="text"></div>
      <div class="f"><label for="ri-cur">Currency</label><select id="ri-cur">${first.config.currencies.map(c => `<option>${c}</option>`).join('')}</select></div>
      <div class="f"><label for="ri-amt">Amount</label><input id="ri-amt" type="number" step="0.01"></div>
      <div class="f"><label for="ri-vd">Value date</label><input id="ri-vd" type="date" value="${todayISO()}"></div>
      <div class="f"><label for="ri-ref">SWIFT reference</label><input id="ri-ref" type="text" placeholder="Generated if left blank"></div>
      <div class="f span2"><label for="ri-rmk">Remarks (field 70)</label><input id="ri-rmk" type="text" maxlength="300"></div>
    </div>
    <button class="btn btn-link" type="button" data-act="ri-suggest" style="margin-top:10px">Fill from an outstanding export bill</button>`,
    onOk: async () => {
      const payload = { inward: { smeId:$('#ri-sme').value, remitter:$('#ri-rem').value, remitterCountry:$('#ri-cty').value,
        currency:$('#ri-cur').value, amount:$('#ri-amt').value, valueDate:$('#ri-vd').value, reference:$('#ri-ref').value, remarks:$('#ri-rmk').value } };
      await run('inward.record', payload, { after: r => { closeModal(); inTab = 'receipts'; location.hash = '#/ad2/inward/' + r.id; } });
    } });
}
function riSuggest() {
    const suggest = s => DB.bills.find(b => b.smeId === s.id && b.type === 'Export' && b.review === 'Accepted' && Engine.billAvailable(DB, b) > 0);
    const s = sme($('#ri-sme').value);
    $('#ri-cur').innerHTML = s.config.currencies.map(c => `<option>${c}</option>`).join('');
    const b = suggest(s);
    if (!b) { toast('No accepted export bill with a balance for ' + s.tradingName + '.', 'err'); return; }
    $('#ri-rem').value = b.counterparty; $('#ri-cty').value = b.counterpartyCountry; $('#ri-cur').value = b.currency;
    $('#ri-amt').value = Engine.billAvailable(DB, b); $('#ri-rmk').value = 'Payment against invoice ' + b.invoiceNumber;
}
