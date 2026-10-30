/* ==========================================================================
   Outward remittance: list, new request, detail with the approval chain
   ========================================================================== */

const OUT_TABS = ['All','Draft','Submitted','Verified','Authorised','Clarification Required','Completed','Rejected'];
let outTab = 'All', outSearch = '';

function outwardRows(list) {
  const root = isAD2() && !acting() ? 'ad2' : 'sme';
  return list.map(o => `
    <tr><td class="id" data-act="go" data-href="#/${root}/outward/${o.id}">${esc(o.id)}</td>
      ${root === 'ad2' ? `<td>${esc(sme(o.smeId)?.tradingName || '')}</td>` : ''}
      <td>${esc(o.beneficiary || '—')}<br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(o.beneficiaryCountry || '')}</span></td>
      <td>${esc(o.currency || '—')}</td><td class="num">${money(o.amount)}</td>
      <td><b>${esc(o.remittanceType || '—')}</b> ${esc(o.purposeCode || '')}</td>
      <td>${dmy(o.requestDate)}</td><td>${badge(o.status)}</td>
      <td>${esc(o.pendingWith || '—')}</td>
      <td><button class="btn btn-link" type="button" data-act="go" data-href="#/${root}/outward/${o.id}">Open</button></td></tr>`).join('');
}

function viewOutwardList() {
  const me = scoped() ? sme(ctxSmeId()) : null;
  if (me && !perm(me).importSide)
    return shell(crumb('Outward Remittance'), denied('Outward remittance is not enabled',
      `Your approved service permission is “${me.config?.permission || '—'}”. Outward requests need Import or Both. Contact AD2 to change it.`));
  const base = scoped() ? DB.outward.filter(o => o.smeId === ctxSmeId()) : DB.outward;
  let list = outTab === 'All' ? base : base.filter(o => o.status === outTab);
  if (outSearch) {
    const q = outSearch.toLowerCase();
    list = list.filter(o => (o.id + o.beneficiary + o.currency + (o.referenceNumber || '') + (o.purposeCode || '') + (o.utr || '')).toLowerCase().includes(q));
  }
  const tabs = OUT_TABS.map(t => `
    <button type="button" data-act="out-tab" data-t="${esc(t)}" aria-selected="${t === outTab}">
      ${esc(t)}<span class="n">${t === 'All' ? base.length : base.filter(o => o.status === t).length}</span></button>`).join('');
  const ad2 = isAD2() && !acting();
  return shell(crumb('Outward Remittance'), `
    <div class="page-head"><div><h1>Outward Remittance</h1>
      <p>${ad2 ? 'Requests from all SMEs. Each is verified by a maker, authorised by a checker and released by operations.'
               : 'Payments to your overseas suppliers and service providers.'}</p></div>
      <div class="acts">
        ${asSme() && can('outward.create') ? `<button class="btn btn-primary" type="button" data-act="or-new">New outward request</button>` : ''}
        ${ad2 && can('assist.transact') ? `<button class="btn btn-primary" type="button" data-act="assist-pick" data-dir="outward">New request for an SME</button>` : ''}
        <button class="btn btn-plain" type="button" data-act="export-csv" data-what="outward">Export CSV</button></div></div>
    <div class="card">
      <div class="tabs">${tabs}</div>
      <div class="toolbar">
        <input type="search" placeholder="Search request, beneficiary, purpose code or UTR" value="${esc(outSearch)}" data-act="out-search" aria-label="Search outward requests">
        <div class="spacer"></div>
        <span style="color:var(--muted);font-size:var(--fs-sm)">${list.length} of ${base.length}</span>
      </div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Request</th>${ad2 ? '<th>SME</th>' : ''}<th>Beneficiary</th><th>Currency</th>
          <th class="num">Amount</th><th>Product / purpose</th><th>Requested</th><th>Status</th><th>With</th><th></th></tr></thead>
        <tbody>${list.length ? outwardRows(list)
          : `<tr><td colspan="10">${empty('No outward remittance found','Nothing matches the current tab and search.')}</td></tr>`}</tbody>
      </table></div></div>
    </div>`);
}

/* ---------- new request ----------------------------------------------------
   Order follows how a payment is actually put together: who is paid, for
   what (product and purpose), which bills it settles, how much and from
   which account, then the rate for exactly that amount, documents, and a
   review before anything is sent.                                          */
const RATE_NONE = () => ({ mode:'none', refRate:0, margin:0, customerRate:0, bookedAt:null, expiresAt:null, dealRef:null });
function newOutwardDraft(from) {
  const base = {
    id:null, smeId:ctxSmeId(), beneficiaryId:'', beneficiary:'', beneficiaryCountry:'', beneficiaryAccount:'',
    beneficiaryBank:'', beneficiaryBankCountry:'', swift:'',
    currency:'', amount:'', remittanceType:'', purposeCode:'', executionDate:todayISO(), debitAccountId:'',
    referenceNumber:'', lcNumber:'', allocations:[], docs:{}, rate:RATE_NONE(), purposeQuery:null,
    declarations:{ fema:false, ofac:false }, marginOverride:null, amountFromBills:true,
  };
  if (!from) return base;
  /* a saved draft keeps its rate booking while the lock lasts */
  const kept = from.rate && from.rate.mode === 'booked' && from.rate.positionId
    && (DB.positions || []).some(p => p.id === from.rate.positionId && Engine.treasury.positionStatus(p, nowISO()) === 'Open');
  return { ...base, ...clone(from), rate: kept ? clone(from.rate) : RATE_NONE(), purposeQuery:null, allocations:clone(from.allocations || []), docs:clone(from.docs || {}),
           executionDate: from.executionDate && from.executionDate >= todayISO() ? from.executionDate : todayISO(),
           declarations:{ fema:false, ofac:false }, amountFromBills:false };
}
function availableCurrencies(smeRec) {
  if (isAD2()) return DB.currencies.map(c => c.code);
  return smeRec?.config?.currencies || [];
}
/* The INR a draft comes to, at its booked rate or today's live rate. */
function outwardQuote(d, me) {
  const amt = Number(d.amount) || 0;
  const rate = d.rate.mode === 'none' ? liveRate(me, d.currency, 'out', acting() && isAD2() ? d.marginOverride : null) : d.rate.customerRate;
  const charges = me ? Engine.chargesFor(me, amt, rate, d.currency) : [];
  const inrAmt = d.currency ? amt * rate : 0;
  return { amt, rate, charges, inrAmt, debit: inrAmt + charges.reduce((t, c) => t + c.amount, 0) };
}

function viewOutwardNew() {
  if (!OR_DRAFT || OR_DRAFT.smeId !== ctxSmeId()) OR_DRAFT = newOutwardDraft();
  const d = OR_DRAFT;
  const me = sme(d.smeId);
  if (!me || me.status !== 'Approved') return shell(crumb('Outward Remittance'), denied('Not available', 'Transactions open once AD2 approves the application.'));
  if (!perm(me).importSide) return shell(crumb('Outward Remittance'), denied('Outward remittance is not enabled', 'Import or Both permission is required.'));
  const prod = product(d.remittanceType);
  const p = purpose(d.purposeCode);
  const accounts = smeAccounts(d.smeId).filter(a => a.currency === 'INR');
  const curs = availableCurrencies(me);
  const benePool = smeBenes(d.smeId);
  const selBene = bene(d.beneficiaryId);
  const beneCurWarn = !!(selBene && d.currency && selBene.currency && selBene.currency !== d.currency);
  const q = outwardQuote(d, me);
  const checklist = prod && p ? checklistFor(prod.id, p.code, q.inrAmt) : [];
  const allocated = d.allocations.reduce((s, a) => s + a.amount, 0);
  const billPool = DB.bills.filter(b => b.smeId === d.smeId && b.type === 'Import' && b.review === 'Accepted' && b.outstanding > 0);

  const billCard = !prod ? '' : prod.bills === 'none'
    ? `<div class="card"><div class="card-head"><h2>3 · Bills</h2></div><div class="card-body">
        <div class="note note-info"><span><b>Advance payment — no bill yet.</b> The Bill of Entry is due within 90 days of payment.
        Once the goods arrive, lodge the import bill and knock it off against this payment.</span></div></div></div>`
    : `<div class="card"><div class="card-head"><h2>3 · Bills this payment settles ${prod.bills === 'required' ? '<span class="req">*</span>' : '<small style="color:var(--muted);font-weight:400">optional</small>'}</h2>
        <div class="acts"><span style="color:var(--muted);font-size:var(--fs-sm)">${d.allocations.length ? `${money(allocated, d.currency)} against ${plural(d.allocations.length, 'bill')}` : 'None chosen yet'}</span></div></div>
        <div class="card-body">
          ${billPool.length || d.allocations.length
            ? billPickerHTML({ prefix:'or', pool: billPool, chosen: d.allocations, currency: d.currency || '', party: d.beneficiary, exclude: d.id })
            : empty('No accepted import bills', 'Lodge the import bill first — AD2 accepts it, then it can be paid here.')}
          ${prod.bills === 'required' ? '' : `<p class="hint" style="margin:10px 0 0;font-size:var(--fs-xs);color:var(--muted)">OTT payments for goods may settle a bill; for services leave this empty.</p>`}
        </div></div>`;
  const hasBillStep = !!prod;
  const step = k => k + (hasBillStep ? 1 : 0);

  return shell(crumb('Outward Remittance', d.id ? d.id + ' (draft)' : 'New request'), `
    <div class="page-head"><div><h1>${d.id ? 'Continue draft ' + esc(d.id) : 'New outward request'}</h1>
      <p>Pick the supplier, the product and purpose, the bills you are paying — then book the rate for that amount.</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="go" data-href="#/sme/outward">Cancel</button></div></div>

    <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);align-items:start">
      <div class="grid" style="gap:20px">

        <div class="card"><div class="card-head"><h2>1 · Beneficiary</h2>
          <div class="acts"><button class="btn btn-ghost btn-sm" type="button" data-act="bene-new">Add new beneficiary</button></div></div>
          <div class="card-body">
          <div class="f" data-fld="beneficiary" style="margin-bottom:${d.beneficiary ? 'var(--s4)' : '0'}">
            <label for="or-bene">Select a beneficiary<span class="req">*</span></label>
            <select id="or-bene" data-act="bene-pick">
              <option value="">Select from your beneficiary master…</option>
              ${benePool.map(x => `<option value="${x.id}" ${d.beneficiaryId === x.id ? 'selected' : ''}>
                ${esc(x.name)} · ${esc(x.bank)} · ${esc(x.currency || '')}${x.country ? ' · ' + esc(x.country) : ''}</option>`).join('')}
              ${d.beneficiary && !d.beneficiaryId ? `<option value="__oneoff" selected>${esc(d.beneficiary)} (one-off, not saved)</option>` : ''}
            </select>
            <div class="hint">${benePool.length ? plural(benePool.length, 'saved beneficiary', 'saved beneficiaries') + '.' : 'No beneficiaries saved yet — add the first one.'}</div>
            <div class="err">Select a beneficiary, or add a new one.</div></div>
          ${d.beneficiary ? `
            <div class="note ${beneCurWarn ? 'note-warn' : 'note-ok'}" style="margin-bottom:var(--s4)"><span>
              ${beneCurWarn
                ? `This beneficiary's account is held in <b>${esc(selBene.currency)}</b> but you are remitting <b>${esc(d.currency)}</b>. Confirm the payee can receive ${esc(d.currency)}.`
                : 'These details are snapshotted onto the request, so later edits to the master will not change this payment.'}</span></div>
            <div class="kv">
              <div><div class="k">Name</div><div class="v">${esc(d.beneficiary)}</div></div>
              <div><div class="k">Country</div><div class="v">${esc(d.beneficiaryCountry || '—')}</div></div>
              <div><div class="k">Account / IBAN</div><div class="v">${esc(d.beneficiaryAccount || '—')}</div></div>
              <div><div class="k">SWIFT / BIC</div><div class="v">${esc(d.swift || '—')}</div></div>
              <div><div class="k">Bank</div><div class="v">${esc(d.beneficiaryBank || '—')}</div></div>
              <div><div class="k">Bank country</div><div class="v">${esc(d.beneficiaryBankCountry || '—')}</div></div>
            </div>
            <div style="display:flex;gap:var(--s2);margin-top:var(--s4)">
              <button class="btn btn-plain btn-sm" type="button" data-act="bene-edit">Edit these details</button>
              <button class="btn btn-link" type="button" data-act="bene-clear">Clear</button>
            </div>` : ''}
        </div></div>

        <div class="card"><div class="card-head"><h2>2 · Product and purpose</h2></div><div class="card-body">
          <div class="grid g2 fields">
            <div class="f span2" data-fld="remittanceType"><label>Product<span class="req">*</span></label>
              <div class="prodpick">${productsFor('outward').map(x => `
                <button type="button" class="prod ${d.remittanceType === x.id ? 'on' : ''}" data-act="or-product" data-id="${x.id}" aria-pressed="${d.remittanceType === x.id}">
                  <b>${esc(x.id)}</b><span>${esc(x.label)}</span><small>${plural(purposesFor(x.id).length, 'purpose code')}</small></button>`).join('')}</div>
              <div class="hint">${prod ? esc(prod.hint) : 'From the purpose and document policy: AIR, DIR and OTT, plus LC.'}</div>
              <div class="err">Select a product.</div></div>
            ${prod && prod.id === 'LC' ? `<div class="f span2" data-fld="lcNumber"><label for="or-lcNumber">Letter of credit number<span class="req">*</span></label>
              <input id="or-lcNumber" data-ork="lcNumber" type="text" maxlength="30" value="${esc(d.lcNumber || '')}" placeholder="e.g. ILC/2026/0457">
              <div class="hint">The import LC this payment settles. Attach the LC copy below.</div><div class="err">Enter the LC number.</div></div>` : ''}
            <div class="f span2" data-fld="purposeCode"><label for="or-purpose">Purpose of remittance<span class="req">*</span></label>
              ${prod ? purposePickerHTML({ id:'or-purpose', list: purposesFor(prod.id), value: d.purposeCode, query: d.purposeQuery,
                  placeholder: `Search ${purposesFor(prod.id).length} purpose codes — type a code or a word, e.g. freight, software, S0102` })
                : `<input type="search" disabled placeholder="Choose a product first">`}
              <div class="hint">${prod ? `RBI purpose codes approved for ${prod.id}. The document checklist follows the code you pick.` : 'RBI purpose code.'}</div>
              <div class="err">Select a purpose code.</div></div>
          </div></div></div>

        ${billCard}

        <div class="card"><div class="card-head"><h2>${step(3)} · Amount and account</h2></div><div class="card-body">
          <div class="grid g2 fields">
            <div class="f" data-fld="currency"><label for="or-currency">Currency<span class="req">*</span></label>
              <select id="or-currency" data-ork="currency"><option value="">Select…</option>
                ${curs.map(c => `<option ${d.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
              <div class="hint">${isAD2() ? 'AD2-assisted requests may use any supported currency.' : 'Only currencies enabled on your approval are listed.'}${d.allocations.length ? ' Set by the bills you chose.' : ''}</div>
              <div class="err">Select a currency.</div></div>
            <div class="f" data-fld="amount"><label for="or-amount">Amount to remit${d.currency ? ' (' + esc(d.currency) + ')' : ''}<span class="req">*</span></label>
              <input id="or-amount" data-ork="amount" type="number" step="0.01" min="0" value="${esc(d.amount)}">
              <div class="hint">${d.allocations.length ? `Bills account for ${money(allocated, d.currency)}. ${Number(d.amount) > allocated + 0.001 ? money(Number(d.amount) - allocated, d.currency) + ' is not against a bill.' : ''}` : 'The amount the beneficiary is paid, in the remittance currency.'}</div>
              <div class="err">Enter the amount.</div></div>
            <div class="f" data-fld="executionDate"><label for="or-executionDate">Requested execution date<span class="req">*</span></label>
              <input id="or-executionDate" data-ork="executionDate" type="date" value="${esc(d.executionDate)}" min="${todayISO()}">
              <div class="hint">Today by default. Change it to schedule the payment.</div><div class="err">Choose a date.</div></div>
            <div class="f" data-fld="debitAccountId"><label for="or-debit">Remitter account (INR)<span class="req">*</span></label>
              <select id="or-debit" data-ork="debitAccountId"><option value="">Select…</option>
                ${accounts.map(a => `<option value="${a.id}" ${d.debitAccountId === a.id ? 'selected' : ''} ${a.verified ? '' : 'disabled'}>
                  ${esc(a.bank)} · ${esc(a.accountNumber)}${a.verified ? ' · balance ' + inr(a.balance) : ' (unverified — verify in Profile)'}</option>`).join('')}</select>
              <div class="hint">Verified INR accounts from your account master. <button class="btn-link" type="button" data-act="go" data-href="#/sme/profile">Manage accounts</button></div>
              <div class="err">Select a remitter account.</div></div>
            <div class="f span2"><label for="or-ref">Your reference</label>
              <input id="or-ref" data-ork="referenceNumber" type="text" maxlength="40" value="${esc(d.referenceNumber)}" placeholder="Optional — carried through to the SWIFT message and advice">
            </div>
          </div></div></div>

        <div class="card"><div class="card-head"><h2>${step(4)} · Book the rate</h2></div><div class="card-body">
          ${!d.currency ? `<div class="note note-info"><span>Choose the currency and amount to see the live rate and what it comes to in INR.</span></div>`
            : rateBoxHTML(d, d.currency, me, 'out', 'or', d.amount)}</div></div>

        <div class="card"><div class="card-head"><h2>${step(5)} · Documents</h2>
          ${prod && p ? `<div class="acts"><span style="color:var(--muted);font-size:var(--fs-sm)">${esc(prod.id)} · ${esc(p.code)}</span></div>` : ''}</div>
          <div class="card-body">${!prod || !p
            ? `<div class="note note-info"><span>Select a product and purpose code to load the document checklist.</span></div>`
            : `<div class="note note-info" style="margin-bottom:14px"><span>Document policy for <b>${esc(prod.id)} — ${esc(prod.label)}</b>.
                ${checklist.some(x => x.rule === 'threshold' || x.rule === 'goods') ? 'Some documents depend on the purpose code or the INR amount — the list updates as you go.' : ''}</span></div>
               ${docRows(checklist, d.docs, 'or')}`}</div></div>

        <div class="card"><div class="card-head"><h2>${step(6)} · Declarations<span class="req">*</span></h2></div><div class="card-body">
          ${declarationsHTML(d, 'or')}</div></div>
      </div>

      <div class="card" style="position:sticky;top:130px"><div class="card-head"><h2>Summary</h2></div>
        <div class="card-body">
          <div class="calc">
            <div class="line"><span>You pay</span><b>${d.currency && q.amt ? money(q.amt, d.currency) : '—'}</b></div>
            ${seesMargin() && d.currency ? `<div class="line"><span>Reference rate <small>(AD2 only)</small></span><b>₹ ${Number(currency(d.currency).refRate).toFixed(4)}</b></div>
              <div class="line"><span>Margin <small>(AD2 only)</small></span><b>${d.rate.mode !== 'none' ? d.rate.margin : (acting() && d.marginOverride != null && d.marginOverride !== '' ? d.marginOverride : marginFor(me, d.currency))} paise</b></div>` : ''}
            <div class="line"><span>${d.rate.mode === 'none' ? 'Live rate' : d.rate.mode === 'deal' ? 'Deal rate' : 'Booked rate'}</span><b>${d.currency ? '₹ ' + Number(q.rate).toFixed(4) : '—'}</b></div>
            <div class="line"><span>INR equivalent</span><b>${inr(q.inrAmt)}</b></div>
            ${q.charges.map(c => `<div class="line"><span>${esc(c.name)}</span><b>${inr(c.amount)}</b></div>`).join('')}
            <div class="line total"><span>Estimated debit</span><b>${inr(q.debit)}</b></div>
            ${d.allocations.length ? `<div class="line"><span>Settles</span><b>${esc(d.allocations.map(a => a.billId).join(', '))}</b></div>` : ''}
          </div>
          <p style="font-size:var(--fs-xs);color:var(--muted);margin:12px 0 0">
            ${d.rate.mode === 'none' ? 'Live rate — book it before submitting.' : d.rate.mode === 'booked' ? 'Booked rate, locked for 48 hours.' : 'Negotiated deal rate.'}</p>
          <div class="note note-info" style="margin-top:14px"><span style="font-size:var(--fs-xs)">
            After you submit: an AD2 maker verifies the documents, a checker or operations authorises, and operations releases the payment over SWIFT.</span></div>
          <div style="display:grid;gap:8px;margin-top:18px">
            <button class="btn btn-plain" type="button" data-act="or-save">Save draft</button>
            <button class="btn btn-primary" type="button" data-act="or-submit">Review and submit</button>
          </div>
        </div></div>
    </div>`);
}

/* Quick client-side check before the server's full validation. */
function outwardMissing(d) {
  const m = [];
  if (!d.beneficiary) m.push('Beneficiary');
  if (!d.remittanceType) m.push('Product (AIR, DIR, OTT or LC)');
  if (d.remittanceType === 'LC' && !String(d.lcNumber || '').trim()) m.push('Letter of credit number');
  if (!d.purposeCode) m.push('Purpose code');
  if (!d.currency) m.push('Currency');
  if (!(Number(d.amount) > 0)) m.push('Amount');
  if (!d.executionDate) m.push('Requested execution date');
  if (!d.debitAccountId) m.push('Remitter account');
  if (d.rate.mode === 'none') m.push('Book the rate');
  if (!d.declarations || !d.declarations.fema || !d.declarations.ofac) m.push('FEMA and sanctions declarations');
  const prod = product(d.remittanceType);
  if (prod && d.purposeCode) {
    const q = outwardQuote(d, sme(d.smeId));
    checklistFor(prod.id, d.purposeCode, q.inrAmt).filter(x => x.required && !d.docs[x.id]).forEach(x => m.push('Document: ' + x.name));
    const allocated = d.allocations.reduce((s, a) => s + a.amount, 0);
    if (allocated > Number(d.amount) + 0.001) m.push('Bills add up to more than the amount');
    if (prod.bills === 'required' && !allocated && !DB.settings.allowUnlinked) m.push(`At least one accepted import bill (${prod.id} settles a lodged bill)`);
  }
  return m;
}

/* ---------- detail ---------------------------------------------------------- */
function viewOutwardDetail(id) {
  const o = outwardRec(id);
  const ad2 = isAD2() && !acting();
  if (!o || (scoped() && o.smeId !== ctxSmeId()))
    return shell(crumb('Outward Remittance','Not found'), empty('Request not found','This request does not exist or belongs to another business.'));
  const s = sme(o.smeId), a = acct(o.debitAccountId), prod = product(o.remittanceType);
  const chargeTotal = (o.charges || []).reduce((x, c) => x + c.amount, 0);
  const debit = o.debitInr != null ? o.debitInr : o.amount * (o.rate.customerRate || 0) + chargeTotal;
  const root = ad2 ? 'ad2' : 'sme';
  const inrAmt = o.inrAmount || o.amount * (o.rate.customerRate || 0);
  const checklist = prod ? checklistFor(prod.id, o.purposeCode, inrAmt) : [];

  const actions = [];
  if (asSme() && o.status === 'Draft' && can('outward.create')) {
    actions.push(`<button class="btn btn-primary" type="button" data-act="or-continue" data-id="${o.id}">Continue editing</button>`);
    actions.push(`<button class="btn btn-plain" type="button" data-act="or-discard" data-id="${o.id}">Discard draft</button>`);
  }
  if (ad2) {
    if (o.status === 'Submitted' && can('outward.verify')) actions.push(`<button class="btn btn-primary" type="button" data-act="or-verify" data-id="${o.id}">Verify</button>`);
    if (o.status === 'Verified' && can('outward.approve')) actions.push(`<button class="btn btn-primary" type="button" data-act="or-authorise" data-id="${o.id}">Authorise</button>`);
    if (o.status === 'Authorised' && can('outward.complete')) actions.push(`<button class="btn btn-primary" type="button" data-act="or-execute" data-id="${o.id}">Release payment</button>`);
    if (['Submitted','Verified'].includes(o.status) && can('outward.verify') && can('fx.dealRef')) actions.push(`<button class="btn btn-plain" type="button" data-act="or-deal-update" data-id="${o.id}">Update FX deal</button>`);
    if (['Submitted','Verified'].includes(o.status) && can('outward.query')) actions.push(`<button class="btn btn-plain" type="button" data-act="or-query" data-id="${o.id}">Raise query</button>`);
    if (['Submitted','Verified','Authorised'].includes(o.status) && can('outward.reject')) actions.push(`<button class="btn btn-danger" type="button" data-act="or-reject" data-id="${o.id}">Reject</button>`);
    const waiting = { 'Submitted':'outward.verify', 'Verified':'outward.approve', 'Authorised':'outward.complete' }[o.status];
    if (waiting && !can(waiting)) actions.push(`<span class="badge b-amber" style="align-self:center">With ${esc(o.pendingWith)} — ${segregated(waiting) ? 'withheld from your role by design' : 'not your step'}</span>`);
    else if (waiting && barred(o)) actions.push(`<span class="badge b-amber" style="align-self:center">Four-eyes: you acted on this earlier, so another user takes this step</span>`);
  }
  if (o.status === 'Completed') {
    actions.push(`<button class="btn btn-ghost" type="button" data-act="or-advice" data-id="${o.id}">Payment advice</button>`);
    actions.push(`<button class="btn btn-plain" type="button" data-act="or-mt103" data-id="${o.id}">SWIFT MT103</button>`);
  }

  /* the response to a query happens inline, with documents: by the SME, or
     by AD2 for it with what the customer sent in */
  const respond = o.status === 'Clarification Required' && o.query && (asSme() || (ad2 && can('txn.resolveQuery')));
  if (respond && (!RESP || RESP.id !== o.id)) RESP = { id:o.id, text:'', docs:{} };

  return shell(crumb('Outward Remittance', o.id), `
    <div class="page-head"><div><h1>${esc(o.id)} ${badge(o.status)}</h1>
      <p>${esc(o.beneficiary || '—')} · ${money(o.amount, o.currency)}${ad2 ? ' · ' + esc(s?.tradingName || '') : ''}
        ${o.source === 'AD2 Assisted' ? ' · <span class="badge b-purple">Assisted</span>' : ''}</p></div>
      <div class="acts">${actions.join('')}
        <button class="btn btn-plain" type="button" data-act="go" data-href="#/${root}/outward">Back to list</button></div></div>

    ${o.status !== 'Draft' ? `<div class="card" style="margin-bottom:18px"><div class="card-body">${wfStepper(o, 'outward')}</div></div>` : ''}

    ${o.status === 'Completed' ? `<div class="note note-ok" style="margin-bottom:18px"><span>
      <b>Payment released.</b> UTR <b>${esc(o.utr)}</b> · SWIFT ${esc(o.swiftRef)} · ${inr(debit)} debited from ${a ? esc(a.bank + ' ' + a.accountNumber) : 'the remitter account'}.
      ${o.boeDueDate ? `<br>Advance payment — the Bill of Entry is due by <b>${dmy(o.boeDueDate)}</b>. Knock it off against the import bill once lodged.` : ''}</span></div>` : ''}
    ${o.query && (o.status === 'Clarification Required' || o.query.response) ? `<div class="note ${o.status === 'Clarification Required' ? 'note-warn' : 'note-info'}" style="margin-bottom:18px">
      <span><b>Query from AD2:</b> ${esc(o.query.question)}<br><small>${esc(o.query.raisedBy)} · ${dmyt(o.query.raisedAt)}</small>
      ${o.query.response ? `<br><b>Response:</b> ${esc(o.query.response)} <small>· ${o.query.respondedBy ? 'recorded by ' + esc(o.query.respondedBy) + ' · ' : ''}${dmyt(o.query.respondedAt)}</small>` : ''}</span></div>` : ''}
    ${respond ? queryResponseCard(ad2, checklist, o.docs, ad2 ? 'or-resolve' : 'or-respond', o.id) : ''}
    ${o.status === 'Rejected' && o.rejectReason ? `<div class="note note-err" style="margin-bottom:18px">
      <span><b>Rejected:</b> ${esc(o.rejectReason)}</span></div>` : ''}

    <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);align-items:start">
      <div class="grid" style="gap:20px">
        <div class="card"><div class="card-head"><h2>Beneficiary</h2></div><div class="card-body"><div class="kv">
          <div><div class="k">Name</div><div class="v">${esc(o.beneficiary || '—')}
            ${o.beneficiaryId && bene(o.beneficiaryId) ? '<br><span class="badge b-teal" style="margin-top:4px">From beneficiary master</span>'
              : '<br><span class="badge b-grey" style="margin-top:4px">One-off payee</span>'}</div></div>
          <div><div class="k">Country</div><div class="v">${esc(o.beneficiaryCountry || '—')}</div></div>
          <div><div class="k">Account / IBAN</div><div class="v">${esc(o.beneficiaryAccount || '—')}</div></div>
          <div><div class="k">SWIFT</div><div class="v">${esc(o.swift || '—')}</div></div>
          <div><div class="k">Bank</div><div class="v">${esc(o.beneficiaryBank || '—')}</div></div>
          <div><div class="k">Bank country</div><div class="v">${esc(o.beneficiaryBankCountry || '—')}</div></div>
        </div></div></div>

        <div class="card"><div class="card-head"><h2>Remittance</h2></div><div class="card-body"><div class="kv">
          <div><div class="k">Currency</div><div class="v">${esc(o.currency || '—')}</div></div>
          <div><div class="k">Amount</div><div class="v big">${money(o.amount)}</div></div>
          <div><div class="k">Product</div><div class="v">${esc(productLabel(o.remittanceType))}${o.lcNumber ? '<br><small>LC ' + esc(o.lcNumber) + '</small>' : ''}</div></div>
          <div class="span2"><div class="k">Purpose of remittance</div><div class="v">${esc(purposeLabel(o.purposeCode))}</div></div>
          <div><div class="k">Execution date</div><div class="v">${dmy(o.executionDate)}</div></div>
          <div><div class="k">Remitter account</div><div class="v">${a ? esc(a.bank + ' · ' + a.accountNumber) : '—'}</div></div>
          <div><div class="k">Reference</div><div class="v">${esc(o.referenceNumber || '—')}</div></div>
          <div><div class="k">Raised by</div><div class="v">${o.source === 'AD2 Assisted'
              ? `<span class="badge b-purple">Assisted</span> ${esc(o.createdBy || 'AD2')}` : esc(o.createdBy || 'SME user')}</div></div>
        </div></div></div>

        <div class="card"><div class="card-head"><h2>Documents</h2>
          <div class="acts"><span style="color:var(--muted);font-size:var(--fs-sm)">${esc(prod ? prod.id + ' policy' : '')}</span></div></div>
          <div class="card-body">${checklist.length ? docRows(checklist, o.docs || {}, 'view', { readonly:true }) : empty('No checklist','No product is set on this request.')}</div></div>

        <div class="card"><div class="card-head"><h2>Bill allocation</h2></div><div class="card-body tight">
          ${o.allocations && o.allocations.length ? `<div class="tablewrap"><table class="dt">
            <thead><tr><th>Bill</th><th>Invoice</th><th class="num">Allocated</th><th>Bill settlement</th><th>Reported</th></tr></thead>
            <tbody>${o.allocations.map(al => { const b = bill(al.billId);
              const l = DB.allocations.find(y => y.remKind === 'outward' && y.remId === o.id && y.billId === al.billId && y.status === 'Confirmed');
              return `<tr><td class="id">${esc(al.billId)}</td><td>${esc(b?.invoiceNumber || '—')}</td>
                <td class="num">${money(al.amount, o.currency)}${al.via ? '<br><small style="color:var(--muted)">via knock-off</small>' : ''}</td><td>${badge(b?.settlement || 'Unsettled')}</td>
                <td>${l ? ufiTag(l.ufi) : '<span style="color:var(--muted)">On release</span>'}</td></tr>`;
            }).join('')}</tbody></table></div>`
            : empty(prod?.bills === 'none' ? 'Advance payment' : 'Unlinked request',
                    prod?.bills === 'none' ? 'AIR payments are made before the import bill exists.' : 'No import bills are linked to this remittance.')}</div></div>

        <div class="card"><div class="card-head"><h2>Activity</h2></div>
          <div class="card-body">${timeline(o.id)}</div></div>
      </div>

      <div class="grid" style="gap:20px;align-items:start">
        <div class="card"><div class="card-head"><h2>Rate and pricing</h2></div><div class="card-body">
          <div class="note ${o.rate.mode === 'none' ? 'note-warn' : 'note-ok'}" style="margin-bottom:14px"><span>
            ${o.rate.mode === 'booked' ? `Booked rate, locked 48 hours from ${dmyt(o.rate.bookedAt)}.`
              : o.rate.mode === 'deal' ? `Negotiated deal <b>${esc(o.rate.dealRef)}</b>.`
              : 'No rate yet (draft).'}</span></div>
          <div class="calc">
            <div class="line"><span>Amount</span><b>${money(o.amount, o.currency)}</b></div>
            ${positionLine(o)}
            ${seesMargin() ? `<div class="line"><span>Reference rate <small>(AD2 only)</small></span><b>₹ ${(o.rate.refRate || 0).toFixed(4)}</b></div>
            <div class="line"><span>Margin <small>(AD2 only)</small></span><b>${o.rate.margin || 0} paise</b></div>` : ''}
            <div class="line"><span>${seesMargin() ? 'Customer rate' : 'Your rate'}</span><b>₹ ${(o.rate.customerRate || 0).toFixed(4)}</b></div>
            <div class="line"><span>INR equivalent</span><b>${inr(inrAmt)}</b></div>
            ${(o.charges || []).map(c => `<div class="line"><span>${esc(c.name)}</span><b>${inr(c.amount)}</b></div>`).join('')}
            <div class="line total"><span>${o.status === 'Completed' ? 'Debited' : 'Debit amount'}</span><b>${inr(debit)}</b></div>
          </div></div></div>
        ${riskPanel(o)}
        ${ad2 ? notesCard('outward', o) : ''}
      </div>
    </div>`);
}

/* Four-eyes: this AD2 user raised or already acted on the record. */
function barred(rec) {
  const me = myKey();
  return rec.createdByKey === me || Object.values(rec.wf || {}).some(w => w && w.key === me);
}

/* Answering a query, inline with the documents. On the AD2 side it records
   what the customer sent in (by email or at the branch), so the request can
   carry on without waiting for the customer to log in. */
function queryResponseCard(ad2, checklist, onFile, act, id) {
  return `<div class="card" id="query-${esc(id)}" style="margin-bottom:18px"><div class="card-head"><h2>${ad2 ? 'Answer for the customer' : 'Respond to the query'}</h2></div><div class="card-body">
    ${ad2 ? `<div class="note note-info" style="margin-bottom:14px"><span>Received the answer or documents from the customer by email or at the branch?
      Record them here — the request goes back to the maker to verify, exactly as if the customer had answered.</span></div>` : ''}
    <div class="f"><label for="resp-text">${ad2 ? 'The customer’s answer' : 'Your response'}<span class="req">*</span></label>
      <textarea id="resp-text" data-act="resp-text" placeholder="${ad2 ? 'e.g. Customer sent the corrected invoice by email on …' : ''}">${esc(RESP.text)}</textarea></div>
    <h3 style="font-size:var(--fs-sm);margin:16px 0 8px">Upload or replace documents${ad2 ? ' received from the customer' : ''} (optional)</h3>
    ${docRows(checklist.map(x => ({ ...x, required:false, note: onFile && onFile[x.id] ? 'On file: ' + onFile[x.id].filename : 'Not on file' })), RESP.docs, 'resp')}
    <button class="btn btn-primary" style="margin-top:16px" type="button" data-act="${act}" data-id="${id}">${ad2 ? 'Record answer and send back to the maker' : 'Send response'}</button>
  </div></div>`;
}

/* AD2-only internal notes on a record. */
function notesCard(kind, rec) {
  return `<div class="card"><div class="card-head"><h2>Internal notes</h2></div><div class="card-body">
    <p style="font-size:var(--fs-sm);color:var(--muted);margin:0 0 10px">Visible to AD2 only — never shown in the SME portal.</p>
    ${(rec.notes || []).map(n => `<div class="tl" style="padding-left:0"><div class="act">${esc(n.text)}</div>
      <div class="meta">${esc(n.by)} · ${dmyt(n.at)}</div></div>`).join('')}
    <div class="f"><textarea id="note-text" placeholder="Add an internal note" aria-label="Internal note"></textarea></div>
    <button class="btn btn-plain btn-sm" style="margin-top:8px" type="button" data-act="note-add" data-kind="${kind}" data-id="${rec.id}">Save note</button></div></div>`;
}

/* ---------- SWIFT MT103 and payment advice --------------------------------- */
function mt103(o) {
  const s = sme(o.smeId), a = acct(o.debitAccountId);
  const ymd = (o.wf?.executed?.at || o.executionDate || '').slice(2, 10).replace(/-/g, '');
  const amt = Number(o.amount).toFixed(2).replace('.', ',');
  return [
    '{1:F01AD2TINBBAXXX0000000000}{2:I103' + (o.swift || 'XXXXXXXXXXX').padEnd(11, 'X') + 'N}',
    '{4:',
    ':20:' + (o.utr || o.id),
    ':23B:CRED',
    ':32A:' + ymd + o.currency + amt,
    ':50K:/' + (a ? a.accountNumber : ''),
    (s?.legalName || '').toUpperCase().slice(0, 35),
    (s?.address || '').toUpperCase().slice(0, 35),
    ':59:/' + (o.beneficiaryAccount || ''),
    (o.beneficiary || '').toUpperCase().slice(0, 35),
    (o.beneficiaryCountry || '').toUpperCase().slice(0, 35),
    ':70:/PURP/' + o.purposeCode + ' ' + o.remittanceType + (o.lcNumber ? ' LC ' + o.lcNumber.toUpperCase() : '') + (o.referenceNumber ? ' REF ' + o.referenceNumber.toUpperCase() : ''),
    ':71A:OUR',
    ':72:/IEC/' + (s?.iec || '') + ' /RATE/' + (o.rate.customerRate || 0).toFixed(4),
    '-}',
  ].join('\n');
}
function adviceHTML(o) {
  const s = sme(o.smeId), a = acct(o.debitAccountId);
  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  return `<div class="advice">
    <div class="advice-head"><div><b>AD2 Trade Services</b><br><small>Outward remittance — debit advice</small></div>
      <div style="text-align:right"><b>${esc(o.utr || '')}</b><br><small>${dmyt(o.wf?.executed?.at)}</small></div></div>
    <table class="advice-t">
      ${row('Remitter', esc(s?.legalName || '') + '<br><small>IEC ' + esc(s?.iec || '') + ' · ' + esc(s?.address || '') + '</small>')}
      ${row('Beneficiary', esc(o.beneficiary) + '<br><small>' + esc(o.beneficiaryAccount) + ' · ' + esc(o.beneficiaryBank) + ' (' + esc(o.swift) + ')</small>')}
      ${row('Product / purpose', esc(productLabel(o.remittanceType)) + '<br><small>' + esc(purposeLabel(o.purposeCode)) + '</small>')}
      ${row('Amount', '<b>' + money(o.amount, o.currency) + '</b>')}
      ${row('Exchange rate', '₹ ' + (o.rate.customerRate || 0).toFixed(4) + (o.rate.dealRef ? ' (deal ' + esc(o.rate.dealRef) + ')' : ' (booked)'))}
      ${(o.charges || []).map(c => row(c.name, inr(c.amount))).join('')}
      ${row('Total debited', '<b>' + inr(o.debitInr) + '</b> from ' + (a ? esc(a.bank + ' ' + a.accountNumber) : ''))}
      ${row('SWIFT reference', esc(o.swiftRef || ''))}
      ${row('Approvals', ['submitted','verified','authorised','executed'].filter(k => o.wf?.[k]).map(k =>
          `${k.charAt(0).toUpperCase() + k.slice(1)}: ${esc(o.wf[k].by)} · ${dmyt(o.wf[k].at)}`).join('<br>'))}
    </table>
    <p class="advice-foot">Demo document — generated by the AD2 Trade Remittance prototype. Not a real bank advice.</p></div>`;
}
