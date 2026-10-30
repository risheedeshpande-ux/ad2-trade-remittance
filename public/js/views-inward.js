/* ==========================================================================
   Inward remittance and disposal instructions
   Operations records the SWIFT credit; the SME disposes of it against export
   bills; a maker verifies, a checker authorises and operations processes the
   credit and issues the FIRC.
   ========================================================================== */

let inTab = 'receipts', disStatus = '';
const INW_OPEN = i => ['Intimated'].includes(i.status);

function viewInwardList() {
  const me = scoped() ? sme(ctxSmeId()) : null;
  if (me && !perm(me).exportSide)
    return shell(crumb('Inward Remittance'), denied('Inward remittance is not enabled',
      `Your approved service permission is “${me.config?.permission || '—'}”. Inward disposal needs Export or Both.`));
  const ad2 = isAD2() && !acting();
  const root = ad2 ? 'ad2' : 'sme';
  const list = scoped() ? DB.inward.filter(i => i.smeId === ctxSmeId()) : DB.inward;
  const disAll = scoped() ? DB.disposals.filter(d => d.smeId === ctxSmeId()) : DB.disposals;
  const dis = disStatus ? disAll.filter(d => d.status === disStatus) : disAll;
  const openDis = disAll.filter(d => Engine.OPEN.includes(d.status)).length;
  const rowAct = i => {
    if (i.status === 'Intimated') return ad2 && can('inward.record')
      ? `<button class="btn btn-ghost btn-sm" type="button" data-act="in-confirm" data-id="${i.id}">Confirm credit</button>`
      : `<span class="badge b-grey">With AD2 Operations</span>`;
    if (i.available > 0 && asSme() && can('inward.dispose'))
      return `<button class="btn btn-ghost btn-sm" type="button" data-act="go" data-href="#/sme/inward/${i.id}/dispose">Dispose</button>`;
    if (i.available > 0 && ad2 && can('assist.transact'))
      return `<button class="btn btn-ghost btn-sm" type="button" data-act="assist-dispose" data-id="${i.id}">Dispose on behalf</button>`;
    return `<button class="btn btn-link" type="button" data-act="go" data-href="#/${root}/inward/${i.id}">Open</button>`;
  };

  const receipts = `<div class="tablewrap"><table class="dt">
      <thead><tr><th>Reference</th>${ad2 ? '<th>SME</th>' : ''}<th>Remitter</th><th>Value date</th>
        <th>Currency</th><th class="num">Received</th><th class="num">Still to dispose</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.length ? list.map(i => `
        <tr><td class="id" data-act="go" data-href="#/${root}/inward/${i.id}">${esc(/^INT-/.test(i.reference) ? i.id : i.reference)}</td>
          ${ad2 ? `<td>${esc(sme(i.smeId)?.tradingName || '')}</td>` : ''}
          <td>${esc(i.remitter)}<br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(i.remitterCountry)}</span></td>
          <td>${dmy(i.valueDate)}</td><td>${esc(i.currency)}</td>
          <td class="num">${money(i.amount)}</td><td class="num">${INW_OPEN(i) ? '—' : money(i.available)}</td>
          <td>${badge(i.status)}${i.source === 'SME' || i.intimatedBy ? '<br><small style="color:var(--muted)">reported by the SME</small>' : ''}</td>
          <td style="white-space:nowrap">${rowAct(i)}</td></tr>`).join('')
      : `<tr><td colspan="9">${empty('No inward remittance yet', ad2 ? 'Record an incoming SWIFT credit to start.' : 'Report a payment your buyer has sent, or wait for AD2 to record the credit.')}</td></tr>`}</tbody>
    </table></div>`;

  const statuses = ['', 'Submitted', 'Verified', 'Authorised', 'Clarification Required', 'Processed', 'Rejected'];
  const instructions = `<div class="toolbar"><div class="seg-mini">${statuses.map(st => `<button type="button" data-act="dis-status" data-t="${st}" aria-pressed="${disStatus === st}">
      ${st || 'All'} <span>${st ? disAll.filter(d => d.status === st).length : disAll.length}</span></button>`).join('')}</div></div>
    <div class="tablewrap"><table class="dt">
      <thead><tr><th>Instruction</th>${ad2 ? '<th>SME</th>' : ''}<th>Receipt</th><th class="num">Amount</th><th>Purpose</th><th>Bills</th>
        <th>Submitted</th><th>Status</th><th>With</th><th></th></tr></thead>
      <tbody>${dis.length ? dis.map(d => `
        <tr><td class="id" data-act="go" data-href="#/${root}/disposals/${d.id}">${esc(d.id)}</td>
          ${ad2 ? `<td>${esc(sme(d.smeId)?.tradingName || '')}</td>` : ''}
          <td>${esc(inwardRec(d.inwardId)?.reference || d.inwardId)}</td>
          <td class="num">${money(d.amount, d.currency)}</td><td>${esc(d.purposeCode || '')}</td>
          <td>${d.allocations.length ? d.allocations.map(a => esc(a.billId)).join(', ') : '<span class="badge b-grey">Advance</span>'}${(d.unallocated || 0) > 0 && d.status === 'Processed' ? ` <span class="badge b-amber">${money(d.unallocated)} to knock off</span>` : ''}</td>
          <td>${dmy(d.submittedAt)}</td><td>${badge(d.status)}</td><td>${esc(d.pendingWith || '—')}</td>
          <td><button class="btn btn-link" type="button" data-act="go" data-href="#/${root}/disposals/${d.id}">Open</button></td></tr>`).join('')
      : `<tr><td colspan="10">${empty('No instructions here','Disposal instructions appear here once submitted.')}</td></tr>`}</tbody>
    </table></div>`;

  return shell(crumb('Inward Remittance'), `
    <div class="page-head"><div><h1>Inward Remittance</h1>
      <p>${ad2 ? 'Incoming export proceeds, payments SMEs have reported, and the disposal instructions against them.'
               : 'Export proceeds from your buyers. Report a payment on its way, then tell AD2 how to apply it: which bills it settles and where to credit it.'}</p></div>
      <div class="acts">
        ${asSme() && can('inward.dispose') ? `<button class="btn btn-primary" type="button" data-act="in-new">New inward remittance</button>` : ''}
        ${ad2 && can('inward.record') ? `<button class="btn btn-primary" type="button" data-act="in-record">Record incoming remittance</button>` : ''}
        ${ad2 && can('assist.transact') ? `<button class="btn btn-ghost" type="button" data-act="assist-pick" data-dir="inward">Disposal for an SME</button>` : ''}
        <button class="btn btn-plain" type="button" data-act="export-csv" data-what="inward">Export CSV</button></div></div>
    <div class="card">
      <div class="tabs">
        <button type="button" data-act="in-tab" data-t="receipts" aria-selected="${inTab === 'receipts'}">Receipts<span class="n">${list.length}</span></button>
        <button type="button" data-act="in-tab" data-t="instructions" aria-selected="${inTab === 'instructions'}">Disposal instructions<span class="n">${openDis ? openDis + ' open' : disAll.length}</span></button>
      </div>
      <div class="card-body tight">${inTab === 'receipts' ? receipts : instructions}</div>
    </div>`);
}

/* SME: start a new inward — dispose of a receipt already confirmed, or
   report a payment the buyer has sent that AD2 has not recorded yet. */
function newInwardModal() {
  const me = sme(ctxSmeId());
  const ready = DB.inward.filter(i => i.smeId === me.id && i.available > 0 && !INW_OPEN(i));
  modal({ title:'New inward remittance', wide:true, body:`
    <div class="optcards">
      <div class="optcard" style="cursor:default"><b>Dispose of money already received</b>
        <small>AD2 has the credit. Choose the purpose, the export bills it settles and the account to credit.</small>
        ${ready.length ? `<div class="f" style="margin-top:12px"><label for="nin-rec">Receipt</label><select id="nin-rec">
            ${ready.map(i => `<option value="${i.id}">${esc(i.reference)} · ${esc(i.remitter)} · ${money(i.available, i.currency)} to dispose</option>`).join('')}</select></div>
          <button class="btn btn-primary btn-sm" style="margin-top:10px" type="button" data-act="nin-dispose">Continue to the instruction</button>`
          : `<p style="margin:10px 0 0;font-size:var(--fs-sm);color:var(--muted)">Nothing is waiting to be disposed right now.</p>`}</div>
      <div class="optcard" style="cursor:default"><b>Report a payment from a buyer</b>
        <small>Your buyer has paid, or is about to. Tell us the amount and attach the SWIFT copy — AD2 Operations matches it to the credit and it becomes ready to dispose.</small>
        <button class="btn btn-ghost btn-sm" style="margin-top:12px" type="button" data-act="nin-report">Report a payment</button></div>
    </div>` });
}

function intimateModal() {
  const me = sme(ctxSmeId());
  const curs = availableCurrencies(me);
  const buyers = [...new Map(DB.bills.filter(b => b.smeId === me.id && b.type === 'Export' && b.review === 'Accepted' && b.outstanding > 0)
    .map(b => [b.counterparty, b])).values()];
  INT_DOCS = {};
  modal({ title:'Report an inward remittance', wide:true, okLabel:'Report payment', body:`
    <p style="font-size:var(--fs-md);margin:0 0 14px">AD2 Operations confirms this against the credit in the nostro account, usually the same day. You then submit the disposal instruction.</p>
    <div class="grid g2 fields">
      <div class="f"><label for="int-rem">Remitter (buyer)<span class="req">*</span></label><input id="int-rem" type="text" list="int-buyers">
        <datalist id="int-buyers">${buyers.map(b => `<option value="${esc(b.counterparty)}">`).join('')}</datalist></div>
      <div class="f"><label for="int-cty">Remitter country<span class="req">*</span></label><input id="int-cty" type="text"></div>
      <div class="f"><label for="int-cur">Currency<span class="req">*</span></label><select id="int-cur">${curs.map(c => `<option>${c}</option>`).join('')}</select></div>
      <div class="f"><label for="int-amt">Amount<span class="req">*</span></label><input id="int-amt" type="number" step="0.01" min="0"></div>
      <div class="f"><label for="int-vd">Value date</label><input id="int-vd" type="date" value="${todayISO()}"></div>
      <div class="f"><label for="int-ref">SWIFT / UTR reference</label><input id="int-ref" type="text" placeholder="From the buyer’s MT103, if you have it"></div>
      <div class="f span2"><label for="int-rmk">Remarks</label><input id="int-rmk" type="text" maxlength="300" placeholder="e.g. against invoice MTX/EXP/2026/0178"></div>
    </div>
    <div class="docrow" style="margin-top:14px"><span class="nm">SWIFT copy (MT103) from the buyer<small id="int-doc-note">Optional — helps operations match the credit</small></span><span class="spacer"></span>
      <button class="btn btn-link" type="button" data-act="int-doc-sample">Attach sample</button></div>
    ${buyers.length ? `<button class="btn btn-link" type="button" data-act="int-fill" style="margin-top:10px">Fill from an outstanding export bill</button>` : ''}`,
    onOk: () => {
      const v = { remitter: val('#int-rem'), remitterCountry: val('#int-cty'), currency: val('#int-cur'), amount: val('#int-amt'),
        valueDate: val('#int-vd'), reference: val('#int-ref'), remarks: val('#int-rmk') };
      if (!v.remitter || !v.remitterCountry || !(Number(v.amount) > 0)) { toast('Enter the remitter, country and amount.', 'err'); return; }
      run('inward.intimate', { inward: v, docs: INT_DOCS }, { keepScroll:false, after: r => { closeModal(); location.hash = '#/sme/done/intimation/' + r.id; } });
    } });
}
let INT_DOCS = {};

function viewInwardDetail(id) {
  const i = inwardRec(id);
  if (!i || (scoped() && i.smeId !== ctxSmeId())) return shell(crumb('Inward Remittance','Not found'), empty('Receipt not found','It does not exist or belongs to another business.'));
  const ad2 = isAD2() && !acting();
  const root = ad2 ? 'ad2' : 'sme';
  const dis = DB.disposals.filter(d => d.inwardId === i.id);
  const intimated = i.status === 'Intimated';
  const title = /^INT-/.test(i.reference) ? i.id : i.reference;
  return shell(crumb('Inward Remittance', title), `
    <div class="page-head"><div><h1>${esc(title)} ${badge(i.status)}</h1>
      <p>${esc(i.remitter)} · ${money(i.amount, i.currency)} ${intimated ? 'reported' : 'received'} ${dmy(i.valueDate)}${ad2 ? ' · ' + esc(sme(i.smeId)?.tradingName || '') : ''}</p></div>
      <div class="acts">
        ${intimated && ad2 && can('inward.record') ? `<button class="btn btn-primary" type="button" data-act="in-confirm" data-id="${i.id}">Confirm credit</button>
          <button class="btn btn-danger" type="button" data-act="in-decline" data-id="${i.id}">No matching credit</button>` : ''}
        ${i.available > 0 && asSme() && can('inward.dispose') ? `<button class="btn btn-primary" type="button" data-act="go" data-href="#/sme/inward/${i.id}/dispose">${i.available < i.amount ? 'Dispose the balance' : 'Submit disposal instruction'}</button>` : ''}
        ${i.available > 0 && ad2 && can('assist.transact') ? `<button class="btn btn-primary" type="button" data-act="assist-dispose" data-id="${i.id}">Dispose on behalf</button>` : ''}
        <button class="btn btn-plain" type="button" data-act="go" data-href="#/${root}/inward">Back to list</button></div></div>
    ${intimated ? `<div class="note note-info" style="margin-bottom:18px"><span><b>Reported by the SME</b> ${i.intimatedBy ? '— ' + esc(i.intimatedBy.by) + ', ' + dmyt(i.intimatedBy.at) : ''}.
      ${ad2 ? 'Match it to the credit in the nostro account, then confirm it — the SME can then dispose of it.' : 'AD2 Operations is matching it to the credit received. You can dispose of it once it is confirmed.'}</span></div>` : ''}
    ${i.status === 'Not Received' ? `<div class="note note-err" style="margin-bottom:18px"><span><b>No matching credit:</b> ${esc(i.declineReason || '')}</span></div>` : ''}
    <div class="grid g2" style="align-items:start">
      <div class="card"><div class="card-head"><h2>Receipt</h2></div><div class="card-body"><div class="kv">
        <div><div class="k">SWIFT reference</div><div class="v">${esc(/^INT-/.test(i.reference) ? 'Assigned on confirmation' : i.reference)}</div></div>
        <div><div class="k">Value date</div><div class="v">${dmy(i.valueDate)}</div></div>
        <div><div class="k">Remitter</div><div class="v">${esc(i.remitter)}</div></div>
        <div><div class="k">Remitter country</div><div class="v">${esc(i.remitterCountry)}</div></div>
        <div><div class="k">${intimated ? 'Reported' : 'Received'}</div><div class="v big">${money(i.amount, i.currency)}</div></div>
        <div><div class="k">Still to dispose</div><div class="v big">${intimated ? '—' : money(i.available, i.currency)}</div></div>
        <div><div class="k">Product</div><div class="v">${esc(productLabel('TRADE'))}</div></div>
        <div><div class="k">FIRC${(i.fircs || []).length > 1 ? 's' : ''}</div><div class="v">${(i.fircs || (i.firc ? [i.firc] : [])).length ? esc((i.fircs || [i.firc]).join(', ')) : 'Issued when a disposal is processed'}</div></div>
        <div class="span2"><div class="k">Remarks</div><div class="v">${esc(i.remarks || '—')}</div></div>
        ${i.docs && Object.keys(i.docs).length ? `<div class="span2"><div class="k">Documents</div><div class="v">${Object.values(i.docs).map(f => `<button class="btn btn-link" type="button" data-act="view-doc" data-n="${esc(f.filename)}">${esc(f.filename)}</button>`).join(' ')}</div></div>` : ''}
      </div></div></div>
      <div class="card"><div class="card-head"><h2>Disposal instructions</h2></div><div class="card-body tight">
        ${dis.length ? `<div class="tablewrap"><table class="dt">
          <thead><tr><th>Instruction</th><th class="num">Amount</th><th>Status</th><th>With</th><th></th></tr></thead>
          <tbody>${dis.map(d => `<tr><td class="id" data-act="go" data-href="#/${root}/disposals/${d.id}">${esc(d.id)}</td>
              <td class="num">${money(d.amount, d.currency)}</td><td>${badge(d.status)}</td><td>${esc(d.pendingWith || '—')}</td>
              <td><button class="btn btn-link" type="button" data-act="go" data-href="#/${root}/disposals/${d.id}">Open</button></td></tr>`).join('')}</tbody></table></div>`
          : empty('No instruction yet', intimated ? 'Once AD2 confirms the credit, submit a disposal instruction.' : 'Submit a disposal instruction to apply this receipt.')}</div></div>
    </div>
    <div class="card" style="margin-top:20px"><div class="card-head"><h2>Activity</h2></div>
      <div class="card-body">${timeline(i.id)}</div></div>`);
}

/* ---------- disposal instruction form -------------------------------------
   The SME chooses how much of the receipt to dispose of now, the purpose,
   whether to knock off bills or take it as an advance, and where to credit
   it: INR at a booked rate, or an EEFC account in the receipt currency.   */
function newDisposalDraft(i) {
  return { inwardId:i.id, smeId:i.smeId, amount:String(i.available), option:'knockoff', purposeCode:'P0102', purposeQuery:null,
           creditAccountId:'', allocations:[], remarks:'', docs:{}, rate:RATE_NONE(), declarations:{ fema:false, ofac:false } };
}
const diAmount = (d, i) => Math.min(Number(d.amount) > 0 ? Number(d.amount) : 0, i.available);

function declarationsHTML(draft, prefix) {
  const dec = draft.declarations || {};
  return `<div class="checks" style="gap:12px">
    <label class="chk"><input type="checkbox" data-act="${prefix}-dec" data-dk="fema" ${dec.fema ? 'checked' : ''}>
      <span>FEMA declaration<small>This transaction complies with the Foreign Exchange Management Act, 1999 and the rules and directions under it, and the information given is true and complete.</small></span></label>
    <label class="chk"><input type="checkbox" data-act="${prefix}-dec" data-dk="ofac" ${dec.ofac ? 'checked' : ''}>
      <span>Sanctions declaration<small>No party, bank, vessel or country involved is on a UN, OFAC, EU or Indian sanctions list, and the goods or services are not restricted.</small></span></label>
  </div>`;
}

function viewDispose(inwardId) {
  const i = inwardRec(inwardId);
  if (!i || i.smeId !== ctxSmeId()) return shell(crumb('Inward Remittance','Not found'), empty('Receipt not found',''));
  if (INW_OPEN(i)) return shell(crumb('Inward Remittance', i.id), `<div class="note note-info"><span>${esc(i.id)} is waiting for AD2 Operations to confirm the credit. You can dispose of it once it is confirmed.</span></div>`);
  if (i.available <= 0) return shell(crumb('Inward Remittance', i.reference), `<div class="note note-ok"><span>Nothing is left to dispose on ${esc(i.reference)}.</span></div>`);
  if (!DI_DRAFT || DI_DRAFT.inwardId !== inwardId) DI_DRAFT = newDisposalDraft(i);
  const d = DI_DRAFT;
  const me = sme(i.smeId);
  const amt = diAmount(d, i);
  const accounts = smeAccounts(i.smeId).filter(a => a.currency === 'INR' || a.currency === i.currency);
  const acc = acct(d.creditAccountId);
  const inrCredit = !acc || acc.currency === 'INR';
  const billPool = DB.bills.filter(b => b.smeId === i.smeId && b.type === 'Export' && b.outstanding > 0 && b.review === 'Accepted');
  const allocated = d.option === 'knockoff' ? d.allocations.reduce((s, a) => s + a.amount, 0) : 0;
  const rate = d.rate.mode === 'none' ? liveRate(me, i.currency, 'in', acting() && isAD2() ? d.marginOverride : null) : d.rate.customerRate;
  const list = Engine.checklist(DB, 'TRADE', d.purposeCode, 0, { option: d.option });
  const purposes = (DB.inwardPurposes || []).filter(x => !x.disabled);

  return shell(crumb('Inward Remittance', i.reference, 'Disposal instruction'), `
    <div class="page-head"><div><h1>Disposal instruction</h1>
      <p>${esc(i.reference)} · ${esc(i.remitter)} · ${money(i.available, i.currency)} of ${money(i.amount, i.currency)} still to dispose</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="go" data-href="#/sme/inward/${i.id}">Cancel</button></div></div>

    <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);align-items:start">
      <div class="grid" style="gap:20px">
        <div class="card"><div class="card-head"><h2>1 · Amount and purpose of remittance</h2></div><div class="card-body">
          <div class="grid g2 fields">
            <div class="f" data-fld="amount"><label for="di-amt">Amount to dispose now (${esc(i.currency)})<span class="req">*</span></label>
              <input id="di-amt" type="number" step="0.01" min="0" max="${i.available}" data-dik="amount" value="${esc(d.amount)}">
              <div class="hint">Up to ${money(i.available, i.currency)}. Leave the rest for a later instruction.</div></div>
            <div class="f"><label>Product</label><input type="text" value="TRADE — export proceeds" disabled></div>
            <div class="f span2" data-fld="purposeCode"><label for="di-purpose">Purpose of remittance (RBI inward code)<span class="req">*</span></label>
              ${purposePickerHTML({ id:'di-purpose', list: purposes, value: d.purposeCode, query: d.purposeQuery, placeholder:'Type a code or a word, e.g. advance, software, P0102' })}
              <div class="hint">Reported with the FIRC. P0102 for proceeds of goods already shipped, P0103 for an advance before shipment.</div></div>
          </div></div></div>

        <div class="card"><div class="card-head"><h2>2 · How to apply it</h2></div><div class="card-body">
          <div class="optcards" role="radiogroup" aria-label="Disposal option">${(DB.disposalOptions || []).map(o => `
            <button type="button" class="optcard" data-act="di-option" data-id="${o.id}" aria-pressed="${d.option === o.id}"><b>${esc(o.label)}</b><small>${esc(o.hint)}</small></button>`).join('')}</div>
          ${d.option === 'knockoff' ? `<div style="margin-top:16px">${billPool.length || d.allocations.length
              ? billPickerHTML({ prefix:'di', pool: billPool, chosen: d.allocations, currency: i.currency, party: i.remitter, cap: amt })
              : empty('No outstanding export bills', `No accepted export bills outstanding in ${i.currency}. Lodge the export bill first, or choose “Credit as advance”.`)}
              ${amt - allocated > 0.001 && allocated > 0 ? `<div class="note note-info" style="margin-top:12px"><span>${money(amt - allocated, i.currency)} is not applied to a bill. It is credited too, and the FIRC shows it as pending knock-off.</span></div>` : ''}</div>`
            : `<div class="note note-info" style="margin-top:16px"><span>The whole ${money(amt, i.currency)} is credited now. Once the goods ship and the export bill is lodged, knock the FIRC off against it on the Knock-off screen.</span></div>`}
        </div></div>

        <div class="card"><div class="card-head"><h2>3 · Account to credit</h2></div><div class="card-body">
          <div class="f" data-fld="creditAccountId"><label for="di-acct">Credit account<span class="req">*</span></label>
            <select id="di-acct" data-dik="creditAccountId"><option value="">Select…</option>
              ${accounts.map(a => `<option value="${a.id}" ${d.creditAccountId === a.id ? 'selected' : ''} ${a.verified ? '' : 'disabled'}>
                ${esc(a.bank)} · ${esc(a.accountNumber)} · ${esc(a.currency)} ${esc(a.type)}${a.verified ? '' : ' (unverified)'}</option>`).join('')}</select>
            <div class="hint">INR accounts are credited at the rate you book. An EEFC account in ${esc(i.currency)} is credited in ${esc(i.currency)} with no conversion.
              <button class="btn-link" type="button" data-act="go" data-href="#/sme/profile">Manage accounts</button></div>
            <div class="err">Select an account to credit.</div></div>
        </div></div>

        ${inrCredit ? `<div class="card"><div class="card-head"><h2>4 · Book the rate</h2></div><div class="card-body">${rateBoxHTML(d, i.currency, me, 'in', 'di', amt)}</div></div>`
          : `<div class="card"><div class="card-head"><h2>4 · Rate</h2></div><div class="card-body"><div class="note note-ok"><span>No conversion — ${money(amt, i.currency)} is credited to the EEFC account.</span></div></div></div>`}

        <div class="card"><div class="card-head"><h2>5 · Documents</h2>
          <div class="acts"><span style="color:var(--muted);font-size:var(--fs-sm)">TRADE document policy · ${d.option === 'knockoff' ? 'knock-off' : 'advance'}</span></div></div>
          <div class="card-body">${docRows(list, d.docs, 'di')}</div></div>

        <div class="card"><div class="card-head"><h2>6 · Declarations and remarks</h2></div><div class="card-body">
          ${declarationsHTML(d, 'di')}
          <div class="f" style="margin-top:16px"><label for="di-rem">Remarks</label>
            <textarea id="di-rem" data-dik="remarks" maxlength="500">${esc(d.remarks)}</textarea></div>
        </div></div>
      </div>

      <div class="card" style="position:sticky;top:130px"><div class="card-head"><h2>Summary</h2></div><div class="card-body">
        <div class="calc">
          <div class="line"><span>Receipt still to dispose</span><b>${money(i.available, i.currency)}</b></div>
          <div class="line"><span>This instruction</span><b>${money(amt, i.currency)}</b></div>
          <div class="line"><span>Applied to bills</span><b>${money(allocated, i.currency)}</b></div>
          <div class="line"><span>Pending knock-off (advance)</span><b>${money(amt - allocated, i.currency)}</b></div>
          ${inrCredit ? `<div class="line"><span>${d.rate.mode === 'none' ? 'Live rate' : 'Booked rate'}</span><b>₹ ${Number(rate).toFixed(4)}</b></div>
            <div class="line total"><span>INR to your account</span><b>${inr(amt * rate)}</b></div>`
            : `<div class="line total"><span>Credit to EEFC</span><b>${money(amt, i.currency)}</b></div>`}
          <div class="line"><span>Left on the receipt</span><b>${money(i.available - amt, i.currency)}</b></div>
        </div>
        <div class="note note-info" style="margin-top:14px"><span style="font-size:var(--fs-xs)">
          After you submit: an AD2 maker verifies, a checker or operations authorises, and operations credits the account and issues the FIRC, reported to EDPMS through UFI.</span></div>
        <div style="display:grid;gap:8px;margin-top:18px">
          <button class="btn btn-primary" type="button" data-act="di-submit" data-id="${i.id}">Review and submit</button>
        </div></div></div>
    </div>`);
}

/* Compliance score for AD2 users; the SME never receives it. */
function riskPanel(rec) {
  if (!rec.risk || !isAD2() || acting()) return '';
  const r = rec.risk;
  return `<div class="card"><div class="card-head"><h2>Compliance check</h2>
      <div class="acts"><span class="risk risk-${r.level}"><span class="risk-dot"></span>${esc(r.level)} · ${r.score}</span></div></div>
    <div class="card-body">${r.flags.length ? `<ul class="riskflags">${r.flags.map(f => `<li><span><b>${esc(f.label)}</b><br><small>${esc(f.detail)}</small></span><small>+${f.weight}</small></li>`).join('')}</ul>`
      : '<p style="margin:0;color:var(--muted)">No rule fired.</p>'}
      ${r.level === 'High' ? `<div class="note note-warn" style="margin-top:12px"><span>High risk: the maker and the checker must each record a reason to pass it.</span></div>` : ''}
      ${rec.declarations ? `<p style="margin:12px 0 0;font-size:var(--fs-xs);color:var(--muted)">FEMA and sanctions declarations accepted ${dmyt(rec.declarations.at)}.</p>` : ''}
    </div></div>`;
}
const ufiTag = u => u ? `<span class="badge b-teal" title="${esc(u.system)} via UFI · ${dmyt(u.at)}">${esc(u.system)} ${esc(u.ref)}</span>` : '';

/* ---------- disposal detail ------------------------------------------------ */
function viewDisposalDetail(id) {
  const d = disposalRec(id);
  if (!d || (scoped() && d.smeId !== ctxSmeId())) return shell(crumb('Inward Remittance','Not found'), empty('Instruction not found',''));
  const ad2 = isAD2() && !acting();
  const root = ad2 ? 'ad2' : 'sme';
  const i = inwardRec(d.inwardId), a = acct(d.creditAccountId), s = sme(d.smeId);
  const fcy = (d.creditCurrency || 'INR') !== 'INR';
  const list = Engine.checklist(DB, 'TRADE', d.purposeCode, 0, { option: d.option || 'knockoff' });
  const opt = (DB.disposalOptions || []).find(o => o.id === (d.option || 'knockoff'));
  const actions = [];
  if (ad2) {
    if (d.status === 'Submitted' && can('inward.verifyDisposal')) actions.push(`<button class="btn btn-primary" type="button" data-act="di-verify" data-id="${d.id}">Verify</button>`);
    if (d.status === 'Verified' && can('inward.approveDisposal')) actions.push(`<button class="btn btn-primary" type="button" data-act="di-authorise" data-id="${d.id}">Authorise</button>`);
    if (d.status === 'Authorised' && can('inward.processDisposal')) actions.push(`<button class="btn btn-primary" type="button" data-act="di-process" data-id="${d.id}">Credit and issue FIRC</button>`);
    if (['Submitted','Verified'].includes(d.status) && !fcy && can('inward.verifyDisposal') && can('fx.dealRef')) actions.push(`<button class="btn btn-plain" type="button" data-act="di-deal-update" data-id="${d.id}">Update FX deal</button>`);
    if (['Submitted','Verified'].includes(d.status) && can('outward.query')) actions.push(`<button class="btn btn-plain" type="button" data-act="di-query" data-id="${d.id}">Raise query</button>`);
    if (['Submitted','Verified','Authorised','Clarification Required'].includes(d.status) && can('outward.reject')) actions.push(`<button class="btn btn-danger" type="button" data-act="di-reject" data-id="${d.id}">Reject</button>`);
    const waiting = { 'Submitted':'inward.verifyDisposal', 'Verified':'inward.approveDisposal', 'Authorised':'inward.processDisposal' }[d.status];
    if (waiting && !can(waiting)) actions.push(`<span class="badge b-amber" style="align-self:center">With ${esc(d.pendingWith)} — ${segregated(waiting) ? 'withheld from your role by design' : 'not your step'}</span>`);
    else if (waiting && barred(d)) actions.push(`<span class="badge b-amber" style="align-self:center">Four-eyes: you acted on this earlier, so another user takes this step</span>`);
  }
  if (d.status === 'Processed') actions.push(`<button class="btn btn-ghost" type="button" data-act="di-firc" data-id="${d.id}">Download FIRC</button>`);
  if (d.status === 'Processed' && (d.unallocated || 0) > 0 && asSme() && can('recon.propose'))
    actions.push(`<button class="btn btn-primary" type="button" data-act="ko-from-firc" data-id="${d.id}">Knock off ${money(d.unallocated, d.currency)}</button>`);
  const respond = d.status === 'Clarification Required' && d.query && (asSme() || (ad2 && can('txn.resolveQuery')));
  if (respond && (!RESP || RESP.id !== d.id)) RESP = { id:d.id, text:'', docs:{} };
  const credited = fcy ? money(d.amount, d.currency) : inr(d.creditInr || d.amount * d.rate.customerRate);
  const kos = DB.allocations.filter(l => l.remKind === 'disposal' && l.remId === d.id);

  return shell(crumb('Inward Remittance', d.id), `
    <div class="page-head"><div><h1>${esc(d.id)} ${badge(d.status)}</h1>
      <p>Disposal of ${money(d.amount, d.currency)} from ${esc(i?.reference || d.inwardId)}${ad2 ? ' · ' + esc(s?.tradingName || '') : ''} · ${esc(d.purposeCode || '')} · ${esc(opt ? opt.label : '')}
        ${d.source === 'AD2 Assisted' ? ' · <span class="badge b-purple">Assisted</span>' : ''}</p></div>
      <div class="acts">${actions.join('')}
        <button class="btn btn-plain" type="button" data-act="go" data-href="#/${root}/inward/${d.inwardId}">Open receipt</button></div></div>

    <div class="card" style="margin-bottom:18px"><div class="card-body">${wfStepper(d, 'disposal')}</div></div>
    ${d.status === 'Processed' ? `<div class="note note-ok" style="margin-bottom:18px"><span>
      <b>Credited.</b> ${credited} to ${a ? esc(a.bank + ' ' + a.accountNumber) : 'the account'} · <b>${esc(d.firc)}</b> issued ${ufiTag(d.fircUfi)}
      ${(d.unallocated || 0) > 0 ? `<br><b>${money(d.unallocated, d.currency)} pending knock-off</b> against export bills.` : ''}</span></div>` : ''}
    ${d.query ? `<div class="note ${d.status === 'Clarification Required' ? 'note-warn' : 'note-info'}" style="margin-bottom:18px">
      <span><b>Query from AD2:</b> ${esc(d.query.question)}<br><small>${esc(d.query.raisedBy)} · ${dmyt(d.query.raisedAt)}</small>
      ${d.query.response ? `<br><b>Response:</b> ${esc(d.query.response)}${d.query.respondedBy ? ` <small>· recorded by ${esc(d.query.respondedBy)}</small>` : ''}` : ''}</span></div>` : ''}
    ${respond ? queryResponseCard(ad2, list, d.docs, ad2 ? 'di-resolve' : 'di-respond', d.id) : ''}
    ${d.status === 'Rejected' ? `<div class="note note-err" style="margin-bottom:18px"><span><b>Rejected:</b> ${esc(d.rejectReason || '')} The amount is available on the receipt again.</span></div>` : ''}

    <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);align-items:start">
      <div class="grid" style="gap:20px">
        <div class="card"><div class="card-head"><h2>Export bills</h2></div><div class="card-body tight">
          ${d.allocations.length || kos.length ? `<div class="tablewrap"><table class="dt">
          <thead><tr><th>Bill</th><th>Invoice</th><th>Counterparty</th><th class="num">Applied</th><th>Reported (UFI)</th></tr></thead>
          <tbody>${d.allocations.map(x => { const b = bill(x.billId), l = DB.allocations.find(y => y.disposalId === d.id && y.billId === x.billId && y.source === 'Disposal instruction');
            return `<tr><td class="id">${esc(x.billId)}</td><td>${esc(b?.invoiceNumber || '—')}</td><td>${esc(b?.counterparty || '—')}</td>
              <td class="num">${money(x.amount, d.currency)}<br><small style="color:var(--muted)">with the instruction</small></td><td>${l ? (l.status === 'Reversed' ? badge('Reversed') : ufiTag(l.ufi)) : '<span style="color:var(--muted)">On processing</span>'}</td></tr>`; }).join('')}
            ${kos.map(l => { const b = bill(l.billId); return `<tr><td class="id">${esc(l.billId)}</td><td>${esc(b?.invoiceNumber || '—')}</td><td>${esc(b?.counterparty || '—')}</td>
              <td class="num">${money(l.amount, l.currency)}<br><small style="color:var(--muted)">knock-off</small></td><td>${l.status === 'Confirmed' ? ufiTag(l.ufi) : badge(l.status)}</td></tr>`; }).join('')}</tbody></table></div>`
          : empty('No bills applied', d.option === 'advance' ? 'Credited as an advance. Knock the FIRC off against export bills once they are lodged.' : 'No bill applied.')}
        </div></div>
        <div class="card"><div class="card-head"><h2>Documents</h2></div><div class="card-body">${docRows(list, d.docs || {}, 'view', { readonly:true })}</div></div>
        <div class="card"><div class="card-head"><h2>Activity</h2></div><div class="card-body">${timeline(d.id)}</div></div>
      </div>
      <div class="grid" style="gap:20px;align-items:start">
        <div class="card"><div class="card-head"><h2>Credit</h2></div><div class="card-body">
          <div class="calc">
            <div class="line"><span>Amount</span><b>${money(d.amount, d.currency)}</b></div>
            <div class="line"><span>Applied to bills</span><b>${money(d.allocatedTotal ?? d.allocations.reduce((t, x) => t + x.amount, 0), d.currency)}</b></div>
            <div class="line"><span>Pending knock-off</span><b>${money(d.unallocated || 0, d.currency)}</b></div>
            ${fcy ? '' : `${positionLine(d)}${seesMargin() && d.rate.refRate ? `<div class="line"><span>Reference / margin <small>(AD2 only)</small></span><b>₹ ${Number(d.rate.refRate).toFixed(4)} · ${d.rate.margin}p</b></div>` : ''}
              <div class="line"><span>Rate</span><b>₹ ${(d.rate.customerRate || 0).toFixed(4)}${d.rate.dealRef ? ' · ' + esc(d.rate.dealRef) : ''}</b></div>`}
            <div class="line total"><span>${d.status === 'Processed' ? 'Credited' : 'To credit'}</span><b>${credited}</b></div>
          </div>
          <div class="kv" style="margin-top:14px"><div class="span2"><div class="k">Credit account</div>
            <div class="v">${a ? esc(a.bank + ' · ' + a.accountNumber + ' · ' + a.currency + ' ' + a.type) : '—'}</div></div>
            <div class="span2"><div class="k">Purpose of remittance</div><div class="v">${esc(purposeLabelIn(d.purposeCode))}</div></div>
            <div class="span2"><div class="k">Option</div><div class="v">${esc(opt ? opt.label : '—')}</div></div>
            <div class="span2"><div class="k">Remarks</div><div class="v">${esc(d.remarks || '—')}</div></div></div>
        </div></div>
        ${riskPanel(d)}
        ${ad2 ? notesCard('disposal', d) : ''}
      </div>
    </div>`);
}

function fircHTML(d) {
  const s = sme(d.smeId), i = inwardRec(d.inwardId), a = acct(d.creditAccountId);
  const fcy = (d.creditCurrency || 'INR') !== 'INR';
  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const purposeTxt = (DB.inwardPurposes || []).find(x => x.code === d.purposeCode)?.label || 'Trade';
  return `<div class="advice">
    <div class="advice-head"><div><b>AD2 Trade Services</b><br><small>Foreign Inward Remittance Certificate and credit advice</small></div>
      <div style="text-align:right"><b>${esc(d.firc)}</b><br><small>${dmyt(d.wf?.processed?.at)}</small></div></div>
    <table class="advice-t">
      ${row('Beneficiary (exporter)', esc(s?.legalName || '') + '<br><small>IEC ' + esc(s?.iec || '') + '</small>')}
      ${row('Remitter', esc(i?.remitter || '') + ', ' + esc(i?.remitterCountry || ''))}
      ${row('SWIFT reference', esc(i?.reference || '') + ' · value date ' + dmy(i?.valueDate))}
      ${row('Amount disposed', '<b>' + money(d.amount, d.currency) + '</b>' + (i && i.amount !== d.amount ? ` <small>of ${money(i.amount, i.currency)} received</small>` : ''))}
      ${fcy ? row('Credited', '<b>' + money(d.amount, d.currency) + '</b> to EEFC ' + (a ? esc(a.bank + ' ' + a.accountNumber) : ''))
            : row('Exchange rate', '₹ ' + (d.rate.customerRate || 0).toFixed(4)) + row('INR credited', '<b>' + inr(d.creditInr) + '</b> to ' + (a ? esc(a.bank + ' ' + a.accountNumber) : ''))}
      ${row('Purpose of remittance', esc(d.purposeCode || '') + ' — ' + esc(purposeTxt))}
      ${row('Bills realised', d.allocations.length ? d.allocations.map(x => `${esc(x.billId)} (${esc(bill(x.billId)?.invoiceNumber || '')}) — ${money(x.amount, d.currency)}`).join('<br>') : '—')}
      ${(d.unallocated || 0) > 0 ? row('Pending knock-off', money(d.unallocated, d.currency) + ' <small>— advance, to be matched to export bills</small>') : ''}
      ${d.fircUfi ? row('Reported', `UFI portal updated — ${esc(d.fircUfi.system)} · ${esc(d.fircUfi.ref)} · ${dmyt(d.fircUfi.at)}`) : ''}
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
