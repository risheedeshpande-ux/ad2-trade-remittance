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
        ${asSme() && can('outward.create') ? `<button class="btn btn-primary" type="button" data-act="or-new">New request</button>` : ''}
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

/* ---------- new request ---------------------------------------------------- */
const RATE_NONE = () => ({ mode:'none', refRate:0, margin:0, customerRate:0, bookedAt:null, expiresAt:null, dealRef:null });
function newOutwardDraft(from) {
  const base = {
    id:null, smeId:ctxSmeId(), beneficiaryId:'', beneficiary:'', beneficiaryCountry:'', beneficiaryAccount:'',
    beneficiaryBank:'', beneficiaryBankCountry:'', swift:'',
    currency:'', amount:'', remittanceType:'', purposeCode:'', executionDate:'', debitAccountId:'',
    referenceNumber:'', allocations:[], docs:{}, rate:RATE_NONE(), purposeFilter:'',
  };
  if (!from) return base;
  return { ...base, ...clone(from), rate:RATE_NONE(), purposeFilter:'', allocations:clone(from.allocations || []), docs:clone(from.docs || {}) };
}
function availableCurrencies(smeRec) {
  if (isAD2()) return DB.currencies.map(c => c.code);
  return smeRec?.config?.currencies || [];
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

  const margin = d.currency ? marginFor(me, d.currency) : 0;
  const rate = d.rate.mode === 'none' ? customerRate(d.currency, margin) : d.rate.customerRate;
  const amt = Number(d.amount) || 0;
  const charges = me?.config?.charges || [];
  const chargeTotal = charges.reduce((s, c) => s + (c.basis === 'Fixed' ? c.value : amt * rate * c.value / 100), 0);
  const inrAmt = d.currency ? amt * rate : 0;
  const debitEstimate = inrAmt + chargeTotal;
  const checklist = prod && p ? checklistFor(prod.id, p.code, inrAmt) : [];

  /* purpose codes: narrowed by product, then by the search box */
  const allPurposes = prod ? purposesFor(prod.id) : [];
  const q = (d.purposeFilter || '').toLowerCase();
  const shown = q ? allPurposes.filter(x => (x.code + ' ' + x.label).toLowerCase().includes(q)) : allPurposes;
  if (p && !shown.some(x => x.code === p.code)) shown.unshift(p);

  let rateBox;
  if (d.rate.mode === 'booked') {
    const left = Math.max(0, Math.round((new Date(d.rate.expiresAt) - Date.now()) / 3600000));
    rateBox = `<div class="ratebox locked"><div class="row">
        <div><div class="k" style="font-size:var(--fs-xs);text-transform:uppercase;color:#14663a">Booked rate</div>
          <div class="live">1 ${esc(d.currency)} = ₹ ${d.rate.customerRate.toFixed(4)}</div>
          <div class="tick">Locked ${dmyt(d.rate.bookedAt)} · expires in ${left} hours · treasury notified</div></div>
        <div class="spacer"></div>
        <button class="btn btn-plain btn-sm" type="button" data-act="or-rate-clear">Release rate</button>
      </div></div>`;
  } else if (d.rate.mode === 'deal') {
    rateBox = `<div class="ratebox locked"><div class="row">
        <div><div class="k" style="font-size:var(--fs-xs);text-transform:uppercase;color:#14663a">Negotiated deal</div>
          <div class="live">Deal ${esc(d.rate.dealRef)} · ₹ ${Number(d.rate.customerRate).toFixed(4)}</div>
          <div class="tick">Rate agreed with the treasury desk. It must be within 3% of the reference rate.</div></div>
        <div class="spacer"></div>
        <button class="btn btn-plain btn-sm" type="button" data-act="or-rate-clear">Clear</button>
      </div></div>`;
  } else if (!d.currency) {
    rateBox = `<div class="note note-info"><span>Select a currency to see the live rate.</span></div>`;
  } else {
    rateBox = `<div class="ratebox"><div class="row">
        <div><div class="k" style="font-size:var(--fs-xs);text-transform:uppercase;color:#0b5f61">Live rate (simulated feed)</div>
          <div class="live">1 ${esc(d.currency)} = ₹ ${rate.toFixed(4)}</div>
          <div class="tick">Reference ₹${currency(d.currency).refRate.toFixed(4)} + your margin ${margin} paise</div></div>
        <div class="spacer"></div>
        <button class="btn btn-primary" type="button" data-act="or-book-rate">Book rate</button>
        <button class="btn btn-ghost" type="button" data-act="or-deal-ref">Enter FX deal reference</button>
      </div>
      <p style="margin:10px 0 0;font-size:var(--fs-xs);color:#0b5f61">
        Booking locks the rate for 48 hours and notifies treasury. The server recalculates it from your approved margin on submission.</p></div>`;
  }

  const openBills = DB.bills.filter(b =>
    b.smeId === d.smeId && b.type === 'Import' && b.outstanding > 0 &&
    (!d.currency || b.currency === d.currency) && b.review === 'Accepted');
  const allocated = d.allocations.reduce((s, a) => s + a.amount, 0);
  const billCard = !prod ? '' : prod.bills === 'none'
    ? `<div class="card"><div class="card-head"><h2>Bill allocation</h2></div><div class="card-body">
        <div class="note note-info"><span><b>Advance payment — no bill yet.</b> The Bill of Entry is due within 90 days of payment.
        Once the goods arrive, lodge the import bill and knock it off against this payment.</span></div></div></div>`
    : `<div class="card"><div class="card-head"><h2>Bill allocation ${prod.bills === 'required' ? '<span class="req">*</span>' : '<small style="color:var(--muted);font-weight:400">optional</small>'}</h2>
        <div class="acts"><span style="color:var(--muted);font-size:var(--fs-sm)">Allocated ${money(allocated)} of ${money(amt)}</span></div></div>
        <div class="card-body tight">
          ${openBills.length ? `<div class="tablewrap"><table class="dt">
            <thead><tr><th>Bill</th><th>Invoice</th><th>Counterparty</th><th class="num">Available</th><th class="num">Allocate</th></tr></thead>
            <tbody>${openBills.map(b => {
              const a = d.allocations.find(x => x.billId === b.id);
              const avail = Engine.billAvailable(DB, b, d.id);
              return `<tr class="${a ? 'sel' : ''}"><td class="id">${esc(b.id)}</td><td>${esc(b.invoiceNumber)}</td>
                <td>${esc(b.counterparty)}</td><td class="num">${money(avail, b.currency)}${avail < b.outstanding ? '<br><small style="color:var(--muted)">rest held by open requests</small>' : ''}</td>
                <td class="num"><input type="number" class="alloc-in" data-act="or-alloc" data-bill="${b.id}" value="${a ? a.amount : ''}" placeholder="0.00" min="0" max="${avail}" aria-label="Allocate to ${esc(b.id)}">
                  ${!a && avail > 0 ? `<button class="btn btn-link" type="button" data-act="or-alloc-max" data-bill="${b.id}">Use ${money(Math.min(avail, amt || avail))}</button>` : ''}</td></tr>`;
            }).join('')}</tbody></table></div>`
          : empty('No matching import bills', d.currency
              ? `No accepted import bills outstanding in ${d.currency}. Lodge the bill first — an AD2 checker accepts it before it can be paid.`
              : 'Select a currency to see matching import bills.')}
        </div></div>`;

  return shell(crumb('Outward Remittance', d.id ? d.id + ' (draft)' : 'New request'), `
    <div class="page-head"><div><h1>${d.id ? 'Continue draft ' + esc(d.id) : 'New outward request'}</h1>
      <p>Choose the product and purpose code — they decide which documents and bills this payment needs.</p></div>
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
              <div class="hint">${prod ? esc(prod.hint) : 'From the purpose and document policy: AIR, DIR and OTT.'}</div>
              <div class="err">Select a product.</div></div>
            <div class="f span2" data-fld="purposeCode"><label for="or-purpose">Purpose of remittance<span class="req">*</span></label>
              ${prod && allPurposes.length > 8 ? `<input type="search" class="purpose-search" data-act="purpose-filter" value="${esc(d.purposeFilter || '')}"
                  placeholder="Search ${allPurposes.length} purpose codes by code or description" aria-label="Search purpose codes">` : ''}
              <select id="or-purpose" data-ork="purposeCode" ${prod ? '' : 'disabled'}><option value="">${prod ? 'Select…' : 'Choose a product first'}</option>
                ${shown.map(x => `<option value="${x.code}" ${d.purposeCode === x.code ? 'selected' : ''}>${x.code} — ${esc(x.label)}</option>`).join('')}</select>
              <div class="hint">${prod ? `Showing ${shown.length} of ${allPurposes.length} RBI purpose codes approved for ${prod.id}.` : 'RBI purpose code.'}</div>
              <div class="err">Select a purpose code.</div></div>
          </div></div></div>

        <div class="card"><div class="card-head"><h2>3 · Payment</h2></div><div class="card-body">
          <div class="grid g2 fields">
            <div class="f" data-fld="currency"><label for="or-currency">Currency<span class="req">*</span></label>
              <select id="or-currency" data-ork="currency"><option value="">Select…</option>
                ${curs.map(c => `<option ${d.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
              <div class="hint">${isAD2() ? 'AD2-assisted requests may use any supported currency.' : 'Only currencies enabled on your approval are listed.'}</div>
              <div class="err">Select a currency.</div></div>
            ${fldOR('amount','Amount',d.amount,{required:true,type:'number'})}
            ${fldOR('executionDate','Requested execution date',d.executionDate,{required:true,type:'date', min: todayISO()})}
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

        <div class="card"><div class="card-head"><h2>4 · Rate</h2></div><div class="card-body">${rateBox}</div></div>

        ${billCard}

        <div class="card"><div class="card-head"><h2>Documents</h2>
          ${prod && p ? `<div class="acts"><span style="color:var(--muted);font-size:var(--fs-sm)">${esc(prod.id)} · ${esc(p.code)}</span></div>` : ''}</div>
          <div class="card-body">${!prod || !p
            ? `<div class="note note-info"><span>Select a product and purpose code to load the document checklist.</span></div>`
            : `<div class="note note-info" style="margin-bottom:14px"><span>Document policy for <b>${esc(prod.id)} — ${esc(prod.label)}</b>.
                ${checklist.some(x => x.rule === 'threshold' || x.rule === 'goods') ? 'Some documents depend on the purpose code or the INR amount — the list updates as you type.' : ''}</span></div>
               ${docRows(checklist, d.docs, 'or')}`}</div></div>
      </div>

      <div class="card" style="position:sticky;top:130px"><div class="card-head"><h2>Pricing</h2></div>
        <div class="card-body">
          <div class="calc">
            <div class="line"><span>Amount</span><b>${d.currency ? money(amt, d.currency) : '—'}</b></div>
            <div class="line"><span>Reference rate</span><b>${d.currency ? '₹ ' + currency(d.currency).refRate.toFixed(4) : '—'}</b></div>
            <div class="line"><span>Margin</span><b>${margin} paise</b></div>
            <div class="line"><span>Customer rate</span><b>${d.currency ? '₹ ' + Number(rate).toFixed(4) : '—'}</b></div>
            <div class="line"><span>INR equivalent</span><b>${inr(inrAmt)}</b></div>
            ${charges.map(c => `<div class="line"><span>${esc(c.name)}</span><b>${inr(c.basis === 'Fixed' ? c.value : amt * rate * c.value / 100)}</b></div>`).join('')}
            <div class="line total"><span>Estimated debit</span><b>${inr(debitEstimate)}</b></div>
          </div>
          <p style="font-size:var(--fs-xs);color:var(--muted);margin:12px 0 0">
            ${d.rate.mode === 'none'
              ? 'Illustrative — book a rate or enter a deal reference before submitting.'
              : 'Based on your ' + (d.rate.mode === 'booked' ? 'booked rate.' : 'negotiated deal.')}</p>
          <div class="note note-info" style="margin-top:14px"><span style="font-size:var(--fs-xs)">
            After you submit: an AD2 maker verifies the documents, a checker authorises, and operations releases the payment over SWIFT.</span></div>
          <div style="display:grid;gap:8px;margin-top:18px">
            <button class="btn btn-plain" type="button" data-act="or-save">Save draft</button>
            <button class="btn btn-primary" type="button" data-act="or-submit">Submit request</button>
          </div>
        </div></div>
    </div>`);
}

const fldOR = (id, label, val, opts = {}) => `
  <div class="f ${opts.span2 ? 'span2' : ''}" data-fld="${id}">
    <label for="or-${id}">${esc(label)}${opts.required ? '<span class="req">*</span>' : ''}</label>
    <input id="or-${id}" data-ork="${id}" type="${opts.type || 'text'}" value="${esc(val)}" placeholder="${esc(opts.ph || '')}" ${opts.min ? `min="${opts.min}"` : ''}>
    ${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ''}
    <div class="err">This field is required.</div>
  </div>`;

/* Quick client-side check before the server's full validation. */
function outwardMissing(d) {
  const m = [];
  if (!d.beneficiary) m.push('Beneficiary');
  if (!d.remittanceType) m.push('Product (AIR, DIR or OTT)');
  if (!d.purposeCode) m.push('Purpose code');
  if (!d.currency) m.push('Currency');
  if (!(Number(d.amount) > 0)) m.push('Amount');
  if (!d.executionDate) m.push('Requested execution date');
  if (!d.debitAccountId) m.push('Remitter account');
  if (d.rate.mode === 'none') m.push('Booked rate or FX deal reference');
  const prod = product(d.remittanceType);
  if (prod && d.purposeCode) {
    const inrAmt = Number(d.amount) * (d.rate.customerRate || customerRate(d.currency, marginFor(sme(d.smeId), d.currency)));
    checklistFor(prod.id, d.purposeCode, inrAmt).filter(x => x.required && !d.docs[x.id]).forEach(x => m.push('Document: ' + x.name));
    const allocated = d.allocations.reduce((s, a) => s + a.amount, 0);
    if (allocated > Number(d.amount)) m.push('Allocations exceed the remittance amount');
    if (prod.bills === 'required' && !allocated && !DB.settings.allowUnlinked) m.push('At least one accepted import bill (DIR settles a lodged bill)');
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
    if (['Submitted','Verified'].includes(o.status) && can('outward.query')) actions.push(`<button class="btn btn-plain" type="button" data-act="or-query" data-id="${o.id}">Raise query</button>`);
    if (['Submitted','Verified','Authorised'].includes(o.status) && can('outward.reject')) actions.push(`<button class="btn btn-danger" type="button" data-act="or-reject" data-id="${o.id}">Reject</button>`);
    const waiting = { 'Submitted':'outward.verify', 'Verified':'outward.approve', 'Authorised':'outward.complete' }[o.status];
    if (waiting && !can(waiting)) actions.push(`<span class="badge b-amber" style="align-self:center">With ${esc(o.pendingWith)} — ${segregated(waiting) ? 'withheld from your role by design' : 'not your step'}</span>`);
  }
  if (o.status === 'Completed') {
    actions.push(`<button class="btn btn-ghost" type="button" data-act="or-advice" data-id="${o.id}">Payment advice</button>`);
    actions.push(`<button class="btn btn-plain" type="button" data-act="or-mt103" data-id="${o.id}">SWIFT MT103</button>`);
  }

  /* the SME's response to a query happens inline, with document replacement */
  const respond = asSme() && o.status === 'Clarification Required' && o.query;
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
      ${o.query.response ? `<br><b>Response:</b> ${esc(o.query.response)} <small>· ${dmyt(o.query.respondedAt)}</small>` : ''}</span></div>` : ''}
    ${respond ? `<div class="card" style="margin-bottom:18px"><div class="card-head"><h2>Respond to the query</h2></div><div class="card-body">
        <div class="f"><label for="resp-text">Your response<span class="req">*</span></label>
          <textarea id="resp-text" data-act="resp-text">${esc(RESP.text)}</textarea></div>
        <h3 style="font-size:var(--fs-sm);margin:16px 0 8px">Replace or add documents (optional)</h3>
        ${docRows(checklist.map(x => ({ ...x, required:false, note: o.docs && o.docs[x.id] ? 'On file: ' + o.docs[x.id].filename : 'Not on file' })), RESP.docs, 'resp')}
        <button class="btn btn-primary" style="margin-top:16px" type="button" data-act="or-respond" data-id="${o.id}">Send response</button>
      </div></div>` : ''}
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
          <div><div class="k">Product</div><div class="v">${esc(productLabel(o.remittanceType))}</div></div>
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
            <thead><tr><th>Bill</th><th>Invoice</th><th class="num">Allocated</th><th>Bill settlement</th></tr></thead>
            <tbody>${o.allocations.map(al => { const b = bill(al.billId);
              return `<tr><td class="id">${esc(al.billId)}</td><td>${esc(b?.invoiceNumber || '—')}</td>
                <td class="num">${money(al.amount, o.currency)}${al.via ? '<br><small style="color:var(--muted)">via knock-off</small>' : ''}</td><td>${badge(b?.settlement || 'Unsettled')}</td></tr>`;
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
            <div class="line"><span>Reference rate</span><b>₹ ${(o.rate.refRate || 0).toFixed(4)}</b></div>
            <div class="line"><span>Margin</span><b>${o.rate.margin || 0} paise</b></div>
            <div class="line"><span>Customer rate</span><b>₹ ${(o.rate.customerRate || 0).toFixed(4)}</b></div>
            ${(o.charges || []).map(c => `<div class="line"><span>${esc(c.name)}</span><b>${inr(c.amount)}</b></div>`).join('')}
            <div class="line total"><span>${o.status === 'Completed' ? 'Debited' : 'Debit amount'}</span><b>${inr(debit)}</b></div>
          </div></div></div>
        ${ad2 ? notesCard('outward', o) : ''}
      </div>
    </div>`);
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
    ':70:/PURP/' + o.purposeCode + ' ' + o.remittanceType + (o.referenceNumber ? ' REF ' + o.referenceNumber.toUpperCase() : ''),
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
