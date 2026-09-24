/* ==========================================================================
   Bill lodgement, knock-off and reconciliation
   ========================================================================== */

let billTab = 'register', billSearch = '', billReview = 'All';

function viewBills(type) {
  const me = scoped() ? sme(ctxSmeId()) : null;
  const ad2 = isAD2() && !acting();
  if (me) {
    const pm = perm(me);
    if ((type === 'Import' && !pm.importSide) || (type === 'Export' && !pm.exportSide))
      return shell(crumb('Bill Lodgement', type), denied(`${type} bill lodgement is not enabled`, `Your approved service permission is “${me.config?.permission || '—'}”.`));
  }
  if (ad2 && !['register'].includes(billTab)) billTab = 'register';
  let list = DB.bills.filter(b => (type === 'All' || b.type === type) && (!scoped() || b.smeId === ctxSmeId()));
  const counts = { All: list.length, 'To accept': list.filter(b => ['Submitted','Resubmitted'].includes(b.review)).length,
    'With customer': list.filter(b => b.review === 'Query Raised').length };
  if (billReview === 'To accept') list = list.filter(b => ['Submitted','Resubmitted'].includes(b.review));
  if (billReview === 'With customer') list = list.filter(b => b.review === 'Query Raised');
  if (billSearch) {
    const q = billSearch.toLowerCase();
    list = list.filter(b => (b.id + b.invoiceNumber + b.counterparty + (b.shipmentRef || '')).toLowerCase().includes(q));
  }
  const rowActions = b => {
    const out = [];
    if (ad2 && can('bills.accept') && ['Submitted','Resubmitted','Under Review'].includes(b.review)) {
      out.push(`<button class="btn btn-ghost btn-sm" type="button" data-act="bill-accept" data-id="${b.id}">Accept</button>`);
      out.push(`<button class="btn btn-link" type="button" data-act="bill-query" data-id="${b.id}">Query</button>`);
    }
    if (asSme() && b.review === 'Query Raised' && can('bills.lodge'))
      out.push(`<button class="btn btn-ghost btn-sm" type="button" data-act="bill-respond" data-id="${b.id}">Respond</button>`);
    if (ad2 && b.review === 'Query Raised' && can('txn.resolveQuery'))
      out.push(`<button class="btn btn-ghost btn-sm" type="button" data-act="bill-resolve" data-id="${b.id}">Answer for customer</button>`);
    return out.join(' ');
  };

  const panes = {
    register: `<div class="toolbar">
        <div class="seg-mini">${['All','To accept','With customer'].map(k => `<button type="button" data-act="bill-review" data-t="${k}" aria-pressed="${billReview === k}">${k} <span>${counts[k]}</span></button>`).join('')}</div>
        <input type="search" placeholder="Search bill, invoice, counterparty or reference" value="${esc(billSearch)}" data-act="bill-search" aria-label="Search bills">
        <div class="spacer"></div>
        <button class="btn btn-plain btn-sm" type="button" data-act="export-csv" data-what="bills">Export CSV</button></div>
      <div class="tablewrap"><table class="dt">
        <thead><tr><th data-sort>Bill</th>${ad2 ? '<th data-sort>SME</th>' : ''}${type === 'All' ? '<th data-sort>Type</th>' : ''}<th data-sort>Invoice</th><th data-sort>Counterparty</th><th data-sort>Currency</th>
          <th class="num" data-sort>Original</th><th class="num" data-sort>Adjusted</th><th class="num" data-sort>Outstanding</th>
          <th data-sort>Due</th><th data-sort>Source</th><th data-sort>Review</th><th data-sort>Settlement</th><th></th></tr></thead>
        <tbody>${list.length ? list.map(b => `
          <tr><td class="id">${esc(b.id)}</td>${ad2 ? `<td>${esc(sme(b.smeId)?.tradingName || '')}</td>` : ''}${type === 'All' ? `<td>${esc(b.type)}</td>` : ''}
            <td>${esc(b.invoiceNumber)}<br><span style="color:var(--muted);font-size:var(--fs-xs)">${dmy(b.invoiceDate)}${b.shipmentRef ? ' · ' + esc(b.shipmentRef) : ''}</span></td>
            <td>${esc(b.counterparty)}<br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(b.counterpartyCountry)}</span></td>
            <td>${esc(b.currency)}</td><td class="num">${money(b.amount)}</td>
            <td class="num">${money(b.adjusted)}</td><td class="num"><b>${money(b.outstanding)}</b></td>
            <td data-v="${esc(b.dueDate)}">${dmy(b.dueDate)}</td><td>${esc(b.source)}</td>
            <td>${badge(b.review)}${b.query && b.review === 'Query Raised' ? `<br><small style="color:var(--muted)">${esc(b.query.question)}</small>` : ''}</td>
            <td>${badge(b.settlement)}${(b.ufi || []).length ? `<br><small style="color:var(--muted)" title="${esc(b.ufi.join(', '))}">${b.type === 'Export' ? 'EDPMS' : 'IDPMS'} · ${plural(b.ufi.length, 'report')}</small>` : ''}</td>
            <td style="white-space:nowrap">${rowActions(b)}</td></tr>`).join('')
          : `<tr><td colspan="14">${empty(billReview === 'To accept' ? 'Nothing to accept' : 'No bills', billReview === 'To accept' ? 'Every lodged bill has been reviewed.' : 'Lodge a bill by form, CSV upload, SFTP or the SAP integration.')}</td></tr>`}</tbody>
      </table></div>`,
    form: billForm(type),
    upload: `<div class="card-body">
        <div class="note note-info" style="margin-bottom:16px"><span>
          Download the template, paste or upload rows, validate, then confirm. Failed rows are preserved for correction.</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <button class="btn btn-plain btn-sm" type="button" data-act="csv-template">Download CSV template</button>
          <button class="btn btn-plain btn-sm" type="button" data-act="csv-sample" data-type="${type}">Load sample rows</button>
          <button class="btn btn-plain btn-sm" type="button" data-act="csv-file">Choose a CSV file</button></div>
        <div class="f"><label for="csvbox">CSV rows</label>
          <textarea id="csvbox" style="min-height:150px;font-family:ui-monospace,Menlo,monospace;font-size:12px"
            placeholder="invoice_number,invoice_date,counterparty,country,currency,amount,due_date,order_ref,shipment_ref"></textarea></div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn btn-ghost" type="button" data-act="csv-validate" data-type="${type}">Validate rows</button></div>
        <div id="csv-preview" style="margin-top:18px"></div></div>`,
    sftp: `<div class="card-body">
        <div class="kv" style="margin-bottom:20px">
          <div><div class="k">Host</div><div class="v">sftp.ad2trade.example</div></div>
          <div><div class="k">Directory</div><div class="v">/inbound/${esc(type.toLowerCase())}-bills</div></div>
          <div><div class="k">Schedule</div><div class="v">Every 6 hours</div></div>
          <div><div class="k">Connection</div><div class="v"><span class="badge b-green">Connected</span> <span style="color:var(--muted);font-size:var(--fs-xs)">simulated</span></div></div>
        </div>${jobsTable('SFTP')}</div>`,
    sap: `<div class="card-body">
        <div class="kv" style="margin-bottom:20px">
          <div><div class="k">Endpoint</div><div class="v">https://sap.sme.example/odata/BillingDocument</div></div>
          <div><div class="k">Sync mode</div><div class="v">Automatic on invoice creation</div></div>
          <div><div class="k">Duplicate control</div><div class="v">Invoice number per SME</div></div>
          <div><div class="k">Connection</div><div class="v"><span class="badge b-green">Connected</span> <span style="color:var(--muted);font-size:var(--fs-xs)">simulated</span></div></div>
        </div>${jobsTable('SAP API')}</div>`,
  };
  const tabDefs = ad2 ? [['register','Bill register']]
    : [['register','Bill register'],['form','New bill'],['upload','File upload'],['sftp','SFTP'],['sap','SAP API']];

  return shell(crumb('Bill Lodgement', type === 'All' ? 'All bills' : type + ' bills'), `
    <div class="page-head"><div><h1>${type === 'All' ? 'Bills' : esc(type) + ' Bills'}</h1>
      <p>${type === 'All' ? 'Import and export bills lodged by every SME.' : type === 'Export'
        ? 'Lodged export bills are what inward receipts are disposed against.'
        : 'Lodged import bills are what DIR and LC payments settle.'}
        ${DB.settings.autoChecker ? 'AutoChecker is on — new bills are accepted on lodgement.' : 'An AD2 checker accepts each bill before it can be used.'}</p></div>
      <div class="acts">${ad2 ? `
        <button class="btn ${type === 'All' ? 'btn-primary' : 'btn-plain'} btn-sm" type="button" data-act="go" data-href="#/ad2/bills">All</button>
        <button class="btn ${type === 'Import' ? 'btn-primary' : 'btn-plain'} btn-sm" type="button" data-act="go" data-href="#/ad2/bills/import">Import</button>
        <button class="btn ${type === 'Export' ? 'btn-primary' : 'btn-plain'} btn-sm" type="button" data-act="go" data-href="#/ad2/bills/export">Export</button>` : ''}</div></div>
    <div class="card">
      <div class="tabs">${tabDefs.map(([k, l]) =>
        `<button type="button" data-act="bill-tab" data-t="${k}" aria-selected="${billTab === k}">${esc(l)}</button>`).join('')}</div>
      ${panes[billTab]}
    </div>`);
}

function jobsTable(source) {
  const rows = DB.jobs.filter(j => j.source === source && (!scoped() || j.smeId === ctxSmeId()));
  if (!rows.length) return empty('No jobs yet','Synchronisation jobs appear here once the integration runs.');
  return `<div class="tablewrap"><table class="dt">
    <thead><tr><th>Job</th><th>Run at</th><th class="num">Received</th><th class="num">Accepted</th>
      <th class="num">Rejected</th><th>Errors</th><th></th></tr></thead>
    <tbody>${rows.map(j => `
      <tr><td class="id">${esc(j.id)}</td><td>${dmyt(j.runAt)}</td>
        <td class="num">${j.received}</td><td class="num">${j.accepted}</td>
        <td class="num">${j.rejected ? `<b style="color:var(--r4m-red)">${j.rejected}</b>` : '0'}</td>
        <td>${j.errors.length ? j.errors.map(e => `<div style="font-size:var(--fs-xs)"><b>${esc(e.row)}</b> — ${esc(e.message)}</div>`).join('') : '—'}</td>
        <td>${j.rejected && asSme() ? `<button class="btn btn-plain btn-sm" type="button" data-act="job-retry" data-id="${j.id}">Retry</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
}

function billForm(type) {
  if (!BILL_DRAFT || BILL_DRAFT.type !== type) {
    BILL_DRAFT = { type, invoiceNumber:'', invoiceDate:'', counterparty:'', counterpartyCountry:'',
      currency:'', amount:'', dueDate:'', orderRef:'', shipmentRef:'', extracted:null, docs:{} };
  }
  const d = BILL_DRAFT;
  const curs = availableCurrencies(sme(ctxSmeId()));
  const conf = k => {
    if (!d.extracted || !d.extracted[k]) return '';
    const c = d.extracted[k];
    const cls = c >= 0.9 ? 'hi' : c >= 0.75 ? 'mid' : 'lo';
    return `<div class="ai-field"><span class="conf ${cls}">AI ${Math.round(c * 100)}%</span>
      <span style="font-size:var(--fs-xs);color:var(--muted)">extracted — check and edit if wrong</span></div>`;
  };
  const f = (k, label, opts = {}) => `
    <div class="f" data-fld="${k}"><label for="bl-${k}">${esc(label)}${opts.required ? '<span class="req">*</span>' : ''}</label>
      ${opts.options
        ? `<select id="bl-${k}" data-blk="${k}"><option value="">Select…</option>${opts.options.map(o =>
            `<option ${d[k] === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : `<input id="bl-${k}" data-blk="${k}" type="${opts.type || 'text'}" value="${esc(d[k])}">`}
      ${conf(k)}<div class="err">This field is required.</div></div>`;
  return `<div class="card-body">
    <div class="note note-info" style="margin-bottom:18px"><span>
      Upload the invoice and document AI prefills these fields (simulated). Every value stays editable and you confirm before the bill is lodged.</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
      <button class="btn btn-ghost" type="button" data-act="bill-ai" data-type="${type}">Upload invoice and extract</button></div>
    <div class="grid g2 fields">
      ${f('invoiceNumber','Invoice number',{required:true})}
      ${f('invoiceDate','Invoice date',{required:true,type:'date'})}
      ${f('counterparty', type === 'Export' ? 'Buyer' : 'Supplier',{required:true})}
      ${f('counterpartyCountry','Counterparty country',{required:true})}
      ${f('currency','Currency',{required:true,options:curs})}
      ${f('amount','Invoice amount',{required:true,type:'number'})}
      ${f('dueDate','Due date',{required:true,type:'date'})}
      ${f('orderRef',type === 'Export' ? 'Sales order reference' : 'Purchase order reference',{})}
      ${f('shipmentRef',type === 'Export' ? 'Shipping bill number' : 'Bill of Entry number',{})}
    </div>
    <div class="formfoot" style="margin:24px -20px -20px">
      <span style="font-size:var(--fs-sm);color:var(--muted)">
        ${DB.settings.autoChecker ? 'AutoChecker on — accepted on lodgement.' : 'An AD2 checker accepts the bill before it can be paid or disposed against.'}</span>
      <div class="spacer"></div>
      <button class="btn btn-plain" type="button" data-act="bill-clear">Clear</button>
      ${can('bills.lodge')
        ? `<button class="btn btn-primary" type="button" data-act="bill-save" data-type="${type}">Lodge bill</button>`
        : `<span class="badge b-amber">Your role cannot lodge bills</span>`}
    </div></div>`;
}

/* ---------- knock-off -------------------------------------------------------- */
let KO = { side:'Import', currency:'', allocations:[], focus:'' };

/* What a processed disposal's FIRC still has to knock off. */
function fircLeft(d) {
  const held = DB.allocations.filter(l => l.status === 'Proposed' && l.remKind === 'disposal' && l.remId === d.id).reduce((t, l) => t + l.amount, 0);
  return +Math.max(0, (d.unallocated || 0) - held).toFixed(2);
}
function koEligible(side, smeId) {
  return side === 'Export'
    ? DB.disposals.filter(d => d.smeId === smeId && d.status === 'Processed' && fircLeft(d) > 0).map(d => {
        const i = inwardRec(d.inwardId) || {};
        return { id:d.id, ref:d.firc + ' (' + d.id + ')', party:i.remitter || '', cur:d.currency, left:fircLeft(d) };
      })
    : DB.outward.filter(o => o.smeId === smeId && o.status === 'Completed').map(o => {
        const used = DB.allocations.filter(l => l.remKind === 'outward' && l.remId === o.id && ['Confirmed','Proposed'].includes(l.status))
          .reduce((t, l) => t + l.amount, 0);
        return { id:o.id, ref:o.id + (o.remittanceType === 'AIR' ? ' (advance)' : ''), party:o.beneficiary, cur:o.currency, left:+(o.amount - used).toFixed(2) };
      }).filter(r => r.left > 0);
}

/* What is still free on a bill or a remittance once the allocations being
   put together on this screen are counted — so the panes shrink as you go
   and anything used up drops out. */
const koDraftOn = (key, id) => KO.allocations.filter(a => a[key] === id).reduce((t, a) => t + a.amount, 0);
const koBillLeft = b => +(Engine.billAvailable(DB, b) - koDraftOn('billId', b.id)).toFixed(2);

function viewKnockoff() {
  const smeId = ctxSmeId();
  const me = sme(smeId);
  const pm = perm(me);
  if (KO.side === 'Import' && !pm.importSide) KO.side = 'Export';
  if (KO.side === 'Export' && !pm.exportSide) KO.side = 'Import';
  const allBills = DB.bills.filter(b => b.smeId === smeId && b.type === KO.side && b.review === 'Accepted'
    && Engine.billAvailable(DB, b) > 0 && (!KO.currency || b.currency === KO.currency));
  const bills = allBills.filter(b => koBillLeft(b) > 0.001);
  const allRems = koEligible(KO.side, smeId).filter(r => !KO.currency || r.cur === KO.currency)
    .map(r => ({ ...r, left: +(r.left - koDraftOn('remId', r.id)).toFixed(2), used: koDraftOn('remId', r.id) }));
  const rems = allRems.filter(r => r.left > 0.001);
  const totalAlloc = KO.allocations.reduce((s, a) => s + a.amount, 0);
  const mine = DB.allocations.filter(l => l.smeId === smeId && l.source === 'Knock-off');
  const usedUp = allBills.length - bills.length + allRems.length - rems.length;

  return shell(crumb('Bill Knock-off'), `
    <div class="page-head"><div><h1>Bill Knock-off</h1>
      <p>Match money that moved before its bill existed: an advance (AIR) payment against the import bill that followed, or an export FIRC pending knock-off
        (an advance receipt) against the export bill. AD2 confirms each match and the UFI portal (IDPMS / EDPMS) is updated.</p></div></div>

    <div class="card" style="margin-bottom:18px"><div class="toolbar">
      <select data-act="ko-side" aria-label="Bill type">
        ${pm.importSide ? `<option value="Import" ${KO.side === 'Import' ? 'selected' : ''}>Import bills ↔ outward payments</option>` : ''}
        ${pm.exportSide ? `<option value="Export" ${KO.side === 'Export' ? 'selected' : ''}>Export bills ↔ FIRCs pending knock-off</option>` : ''}</select>
      <select data-act="ko-currency" aria-label="Currency"><option value="">All currencies</option>
        ${DB.currencies.map(c => `<option ${KO.currency === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}</select>
      <div class="spacer"></div>
      ${usedUp ? `<span style="color:var(--muted);font-size:var(--fs-sm)">${plural(usedUp, 'item')} fully used in this batch</span>` : ''}
      <button class="btn btn-ghost btn-sm" type="button" data-act="ko-suggest">Suggest matches</button>
      <button class="btn btn-plain btn-sm" type="button" data-act="ko-clear">Clear</button>
    </div></div>

    <div class="knock">
      <div class="pane"><h3>Outstanding ${esc(KO.side.toLowerCase())} bills</h3>
        <div class="tablewrap"><table class="dt">
          <thead><tr><th>Bill</th><th>Invoice</th><th>Counterparty</th><th class="num">Bill amount</th><th class="num">Free to knock off</th></tr></thead>
          <tbody>${bills.length ? bills.map(b => { const used = koDraftOn('billId', b.id); return `
            <tr class="${used ? 'sel' : ''}">
              <td class="id">${esc(b.id)}</td><td>${esc(b.invoiceNumber)}</td>
              <td>${esc(b.counterparty)}</td><td class="num">${money(b.amount, b.currency)}</td>
              <td class="num"><b>${money(koBillLeft(b), b.currency)}</b>${used ? `<br><small style="color:var(--muted)">${money(used)} in this batch</small>` : ''}</td></tr>`; }).join('')
            : `<tr><td colspan="5">${empty('Nothing outstanding','No accepted bills with a balance left for these filters.')}</td></tr>`}</tbody>
        </table></div></div>
      <div class="pane"><h3>${KO.side === 'Export' ? 'FIRCs pending knock-off' : 'Completed payments not yet matched'}</h3>
        <div class="tablewrap"><table class="dt">
          <thead><tr><th>Reference</th><th>Counterparty</th><th class="num">Unapplied</th></tr></thead>
          <tbody>${rems.length ? rems.map(r => `
            <tr class="${r.used ? 'sel' : ''}"><td class="id">${esc(r.ref)}</td><td>${esc(r.party)}</td>
              <td class="num"><b>${money(r.left, r.cur)}</b>${r.used ? `<br><small style="color:var(--muted)">${money(r.used)} in this batch</small>` : ''}</td></tr>`).join('')
            : `<tr><td colspan="3">${empty('Nothing eligible', KO.side === 'Export' ? 'No FIRC has an amount pending knock-off. Dispose of a receipt as an advance to create one.' : 'No completed payment has an unapplied balance.')}</td></tr>`}</tbody>
        </table></div></div>
    </div>

    <div class="card" style="margin-top:18px"><div class="card-head"><h2>Add an allocation</h2></div><div class="card-body">
      <div class="grid fields" style="grid-template-columns:2fr 2fr 1fr auto;align-items:end;gap:12px">
        <div class="f"><label for="ko-bill">Bill</label><select id="ko-bill" data-act="ko-pick"><option value="">Select…</option>
          ${bills.map(b => `<option value="${b.id}">${esc(b.id)} · ${esc(b.invoiceNumber)} · ${esc(b.counterparty)} · free ${money(koBillLeft(b), b.currency)}</option>`).join('')}</select></div>
        <div class="f"><label for="ko-rem">${KO.side === 'Export' ? 'FIRC' : 'Payment'}</label><select id="ko-rem" data-act="ko-pick"><option value="">Select…</option>
          ${rems.map(r => `<option value="${r.id}" ${KO.focus === r.id ? 'selected' : ''}>${esc(r.ref)} · ${esc(r.party)} · ${money(r.left, r.cur)}</option>`).join('')}</select></div>
        <div class="f"><label for="ko-amt">Amount</label><input id="ko-amt" type="number" step="0.01" placeholder="Filled when both are chosen"></div>
        <button class="btn btn-ghost" type="button" data-act="ko-add">Add</button>
      </div></div></div>

    <div class="allocbar" style="margin-top:18px">
      <div><div class="m">Allocations in this batch</div><div class="v">${KO.allocations.length}</div></div>
      <div><div class="m">Total</div><div class="v">${money(totalAlloc)}</div></div>
      <div class="spacer"></div>
      <button class="btn btn-primary" type="button" data-act="ko-submit" ${KO.allocations.length ? '' : 'disabled'}>Submit for AD2 confirmation</button>
    </div>
    ${KO.allocations.length ? `<div class="card" style="margin-top:18px">
      <div class="card-head"><h2>To submit</h2></div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Bill</th><th>Remittance</th><th class="num">Amount</th><th class="num">Bill outstanding after</th><th></th></tr></thead>
        <tbody>${KO.allocations.map((a, i) => { const b = bill(a.billId);
          const after = (b?.outstanding || 0) - KO.allocations.filter((x, j) => j <= i && x.billId === a.billId).reduce((t, x) => t + x.amount, 0);
          return `<tr><td class="id">${esc(a.billId)}</td><td>${esc(a.remId)}</td>
            <td class="num">${money(a.amount, b?.currency)}</td>
            <td class="num">${money(after, b?.currency)}${after <= 0.001 ? ' <span class="badge b-green">settles</span>' : ''}</td>
            <td><button class="btn btn-link" type="button" data-act="ko-remove" data-i="${i}">Remove</button></td></tr>`;
        }).join('')}</tbody></table></div></div></div>` : ''}

    <div class="card" style="margin-top:18px"><div class="card-head"><h2>Your knock-off history</h2></div><div class="card-body tight">
      ${mine.length ? ledgerTable(mine, false) : empty('None yet','Allocations you submit appear here with their confirmation status.')}</div></div>`);
}

function ledgerTable(rows, withActions) {
  return `<div class="tablewrap"><table class="dt">
    <thead><tr><th data-sort>Allocation</th>${withActions ? '<th data-sort>SME</th>' : ''}<th data-sort>Side</th><th>Remittance</th><th data-sort>Bill</th><th class="num" data-sort>Amount</th>
      <th>Source</th><th data-sort>Status</th><th>Reported (UFI)</th><th data-sort>When</th>${withActions ? '<th></th>' : ''}</tr></thead>
    <tbody>${rows.map(l => `
      <tr><td class="id">${esc(l.id)}</td>${withActions ? `<td>${esc(sme(l.smeId)?.tradingName || '')}</td>` : ''}
        <td>${esc(l.side)}</td><td class="id">${esc(l.ref || l.disposalId || l.remId)}${l.ref ? `<br><small style="color:var(--muted)">${esc(l.remId)}</small>` : ''}</td><td class="id">${esc(l.billId)}</td>
        <td class="num">${money(l.amount, l.currency)}</td><td>${esc(l.source)}</td>
        <td>${badge(l.status)}${l.rejectReason ? `<br><small style="color:var(--muted)">${esc(l.rejectReason)}</small>` : ''}
          ${l.reversedBy ? `<br><small style="color:var(--muted)">${esc(l.reversedBy.reason)}</small>` : ''}</td>
        <td>${l.ufi ? ufiTag(l.ufi) + '<br><small style="color:var(--r4m-green)">UFI portal updated</small>' : l.status === 'Proposed' ? '<span style="color:var(--muted)">On confirmation</span>' : '<span style="color:var(--muted)">—</span>'}${l.ufiReversal ? '<br>' + ufiTag(l.ufiReversal) + ' <small>reversal</small>' : ''}</td>
        <td data-v="${esc(l.at)}">${dmy(l.at)}</td>
        ${withActions ? `<td style="white-space:nowrap">${
          l.status === 'Proposed'
            ? (can('recon.confirm')
                ? `<button class="btn btn-ghost btn-sm" type="button" data-act="rec-confirm" data-id="${l.id}">Confirm</button>
                   <button class="btn btn-link" type="button" data-act="rec-reject" data-id="${l.id}">Reject</button>`
                : `<span class="badge b-grey">${segregated('recon.confirm') ? 'Checker action' : '—'}</span>`)
            : l.status === 'Confirmed' && can('recon.reverse')
              ? `<button class="btn btn-link" type="button" data-act="rec-reverse" data-id="${l.id}">Reverse</button>` : ''}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>`;
}

let recTab = 'Proposed';
function viewReconciliation() {
  const all = DB.allocations;
  const list = recTab === 'All' ? all : all.filter(l => l.status === recTab);
  return shell(crumb('Reconciliation'), `
    <div class="page-head"><div><h1>Reconciliation</h1>
      <p>The allocation ledger. Payments and disposals write confirmed entries when they settle; knock-off proposals wait for a checker.
        Every confirmation and reversal is reported to IDPMS (import) or EDPMS (export) through UFI.</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="export-ledger">Export CSV</button></div></div>
    <div class="card">
      <div class="tabs">${['Proposed','Confirmed','Reversed','Rejected','All'].map(t => `
        <button type="button" data-act="rec-tab" data-t="${t}" aria-selected="${recTab === t}">${t}<span class="n">${t === 'All' ? all.length : all.filter(l => l.status === t).length}</span></button>`).join('')}</div>
      <div class="card-body tight">${list.length ? ledgerTable(list, true) : empty('Nothing here','No allocations in this state.')}</div>
    </div>`);
}
