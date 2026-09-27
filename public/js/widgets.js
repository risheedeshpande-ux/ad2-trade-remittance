/* ==========================================================================
   Shared transaction widgets: the rate card, the type-ahead purpose search,
   the bill picker, the review step before submitting, and the confirmation
   screen shown after it.
   ========================================================================== */

/* ---------- rate card ------------------------------------------------------
   Shows the live rate, how much foreign currency is being paid or converted,
   what that comes to in INR, and books it for exactly that amount. The
   customer sees only its own rate. AD2 also sees the reference rate and the
   margin, may price inside the band in an assisted journey, and may apply a
   deal reference negotiated with the treasury desk.                        */
function rateBoxHTML(draft, cur, smeRec, dir, prefix, amount) {
  const fx = Number(amount) || 0;
  const assisted = acting() && isAD2();
  const approved = seesMargin() ? marginFor(smeRec, cur) : null;
  const m = assisted && draft.marginOverride != null && draft.marginOverride !== '' ? Number(draft.marginOverride) : approved;
  const band = DB.settings.marginBand ?? 5;
  const what = dir === 'out' ? 'Foreign currency you pay' : 'Foreign currency converted';
  const lines = (rate, amt) => `<div class="rate-calc">
      <div><span>${what}</span><b>${amt ? money(amt, cur) : '—'}</b></div>
      <div><span>Rate</span><b>1 ${esc(cur)} = ₹ ${Number(rate).toFixed(4)}</b></div>
      <div class="tot"><span>${dir === 'out' ? 'INR equivalent' : 'INR to be credited'}</span><b>${amt ? inr(amt * rate) : '—'}</b></div>
    </div>`;
  const ad2Note = r => seesMargin() && r ? `<div class="tick">Reference ₹ ${Number(r.refRate || currency(cur)?.refRate || 0).toFixed(4)}
      ${dir === 'out' ? 'plus' : 'less'} margin ${r.margin != null ? r.margin : m} paise — AD2 only, never shown to the customer</div>` : '';

  if (draft.rate.mode === 'booked') {
    const amt = draft.rate.bookedAmount || fx;
    return `<div class="ratebox locked">
      <div class="row"><div><div class="k">Rate booked</div>
        <div class="live">1 ${esc(cur)} = ₹ ${Number(draft.rate.customerRate).toFixed(4)}</div>
        <div class="tick">Booked ${dmyt(draft.rate.bookedAt)} for ${money(amt, cur)} · <b>${esc(draft.rate.positionId || '')}</b> · locked until ${dmyt(draft.rate.expiresAt)}${typeof hoursLeft === 'function' ? ' (' + esc(hoursLeft(draft.rate.expiresAt)) + ')' : ''}</div>
        <div class="tick">The rate is held on the treasury book; submitting uses exactly this rate.</div>
        ${ad2Note(draft.rate)}</div>
        <div class="spacer"></div>
        <button class="btn btn-plain btn-sm" type="button" data-act="${prefix}-rate-clear">Release</button></div>
      ${lines(draft.rate.customerRate, amt)}</div>`;
  }
  if (draft.rate.mode === 'deal') return `<div class="ratebox locked">
      <div class="row"><div><div class="k">FX deal applied</div>
        <div class="live">Deal ${esc(draft.rate.dealRef)} · ₹ ${Number(draft.rate.customerRate).toFixed(4)}</div>
        <div class="tick">Issued by the treasury desk${draft.rate.positionId ? ' · position ' + esc(draft.rate.positionId) : ''}. Checked again when the request is submitted.</div></div>
        <div class="spacer"></div>
        <button class="btn btn-plain btn-sm" type="button" data-act="${prefix}-rate-clear">Clear</button></div>
      ${lines(draft.rate.customerRate, fx)}</div>`;

  const live = liveRate(smeRec, cur, dir, assisted ? draft.marginOverride : null);
  const marginIn = assisted ? `<div class="f" style="margin-top:12px;max-width:280px"><label for="${prefix}-margin">Margin (paise) — branch pricing</label>
      <input id="${prefix}-margin" type="number" data-act="${prefix}-margin" value="${m}" min="${Math.max(0, approved - band)}" max="${approved + 100}">
      <div class="hint">Approved ${approved}p. You may go down to ${Math.max(0, approved - band)}p (band ${band}p). Recorded in the audit trail.</div></div>` : '';
  return `<div class="ratebox">
    <div class="row"><div><div class="k">Live rate · simulated feed</div>
      <div class="live">1 ${esc(cur)} = ₹ ${live.toFixed(4)}</div>
      ${seesMargin() ? ad2Note({ margin: m, refRate: currency(cur)?.refRate }) : `<div class="tick">Your rate for ${dir === 'out' ? 'buying' : 'selling'} ${esc(cur)}, including AD2’s pricing.</div>`}</div>
      <div class="spacer"></div>
      <button class="btn btn-primary" type="button" data-act="${prefix}-book-rate">${fx ? 'Book rate for ' + money(fx, cur) : 'Book rate'}</button>
      ${can('fx.dealRef') && isAD2() ? `<button class="btn btn-ghost" type="button" data-act="${prefix}-deal-ref">FX deal reference</button>` : ''}</div>
    ${lines(live, fx)}
    <p class="tick" style="margin:10px 0 0">${fx ? 'Booking locks this rate for 48 hours and puts it on the treasury book straight away.' : 'Enter the amount to see what it comes to in INR.'}</p>
    ${marginIn}</div>`;
}

/* ---------- purpose search ---------------------------------------------------
   Type anything — a code, "freight", "software" — and pick from the matches,
   like a search box. The list filters in place, so typing never loses focus. */
function purposePickerHTML({ id, list, value, query, placeholder, disabled }) {
  const sel = list.find(x => x.code === value);
  return `<div class="pp" data-pp="${id}">
    <input type="search" class="pp-in" id="${id}" data-act="pp-input" data-pp="${id}" autocomplete="off" ${disabled ? 'disabled' : ''}
      value="${esc(query != null ? query : sel ? sel.code + ' — ' + sel.label : '')}" placeholder="${esc(placeholder || 'Type a code or a word, e.g. freight')}"
      aria-label="Search purpose codes" aria-autocomplete="list">
    <div class="pp-list" role="listbox" hidden>${list.map(x => `
      <button type="button" role="option" class="pp-opt ${x.code === value ? 'on' : ''}" data-act="pp-pick" data-pp="${id}" data-code="${esc(x.code)}"
        data-q="${esc((x.code + ' ' + x.label).toLowerCase())}"><b>${esc(x.code)}</b><span>${esc(x.label)}</span></button>`).join('')}
      <div class="pp-none" hidden>No purpose code matches. Try another word.</div></div>
    ${sel ? `<div class="pp-sel"><span class="badge b-teal">${esc(sel.code)}</span> ${esc(sel.label)}</div>` : ''}
  </div>`;
}
function ppFilter(input) {
  const box = input.closest('.pp');
  const list = box.querySelector('.pp-list');
  const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  list.querySelectorAll('.pp-opt').forEach(o => {
    const hit = !words.length || words.every(w => o.dataset.q.includes(w));
    o.hidden = !hit; if (hit) shown++;
  });
  list.querySelector('.pp-none').hidden = shown > 0;
  list.hidden = false;
}

/* ---------- bill picker ------------------------------------------------------
   A dropdown of the bills that can take money now, with the bill amount,
   what is still outstanding and what is free (less anything held by other
   open requests). The counterparty's bills come first. */
function billOptionLabel(b, avail) {
  return `${b.id} · ${b.invoiceNumber} · ${b.counterparty} · bill ${money(b.amount, b.currency)} · free ${money(avail, b.currency)}`;
}
function heldBy(b, exclude) {
  const out = DB.outward.filter(o => Engine.OPEN.includes(o.status) && o.id !== exclude && (o.allocations || []).some(x => x.billId === b.id)).map(o => o.id);
  const dis = DB.disposals.filter(d => Engine.OPEN.includes(d.status) && d.id !== exclude && (d.allocations || []).some(x => x.billId === b.id)).map(d => d.id);
  const ko = DB.allocations.filter(l => l.status === 'Proposed' && l.billId === b.id).map(l => l.id);
  return [...out, ...dis, ...ko];
}
function billPickerHTML({ prefix, pool, chosen, currency: cur, party, exclude, cap }) {
  const avail = b => Engine.billAvailable(DB, b, exclude);
  const open = pool.filter(b => !chosen.some(a => a.billId === b.id) && (!cur || b.currency === cur) && avail(b) > 0)
    .sort((a, b) => (b.counterparty === party) - (a.counterparty === party) || new Date(a.dueDate) - new Date(b.dueDate));
  const held = pool.filter(b => !chosen.some(a => a.billId === b.id) && (!cur || b.currency === cur) && avail(b) <= 0 && b.outstanding > 0);
  const total = chosen.reduce((t, a) => t + a.amount, 0);
  const rows = chosen.map(a => {
    const b = bill(a.billId); if (!b) return '';
    const free = avail(b);
    const others = heldBy(b, exclude);
    return `<tr class="sel"><td><span class="id">${esc(b.id)}</span><br><small style="color:var(--muted)">${esc(b.invoiceNumber)} · due ${dmy(b.dueDate)}</small></td>
      <td>${esc(b.counterparty)}</td>
      <td class="num">${money(b.amount, b.currency)}<br><small style="color:var(--muted)">outstanding ${money(b.outstanding)}</small></td>
      <td class="num">${money(free, b.currency)}${others.length ? `<br><small style="color:var(--muted)">rest held by ${esc(others.join(', '))}</small>` : ''}</td>
      <td class="num"><input type="number" class="alloc-in" style="width:110px" step="0.01" min="0" max="${free}" data-act="${prefix}-alloc" data-bill="${b.id}" value="${a.amount}" aria-label="Amount for ${esc(b.id)}">
        <br><button class="btn btn-link" type="button" data-act="${prefix}-alloc-del" data-bill="${b.id}">Remove</button></td></tr>`;
  }).join('');
  return `
    ${chosen.length ? `<div class="tablewrap" style="margin-bottom:12px"><table class="dt">
      <thead><tr><th>Bill</th><th>Counterparty</th><th class="num">Bill amount</th>
        <th class="num">Free now</th><th class="num">${prefix === 'di' ? 'Apply' : 'Pay'}</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="4">Total against bills</td><td class="num">${money(total, cur || '')}</td></tr></tfoot></table></div>` : ''}
    <div class="f" style="max-width:720px"><label for="${prefix}-billpick">${chosen.length ? 'Add another bill' : 'Choose a bill'}</label>
      <select id="${prefix}-billpick" data-act="${prefix}-billpick" ${open.length ? '' : 'disabled'}>
        <option value="">${open.length ? `Select from ${plural(open.length, 'bill')} with money free${cur ? ' in ' + cur : ''}…` : 'No bill has money free' + (cur ? ' in ' + cur : '')}</option>
        ${open.map(b => `<option value="${b.id}">${esc(billOptionLabel(b, avail(b)))}</option>`).join('')}</select>
      <div class="hint">${cap != null && cap > 0 ? `Picking a bill fills in what it can take, up to ${money(Math.max(0, cap - total), cur || '')} still to place.` : 'Picking a bill fills in the amount free on it — change it if you are paying part.'}
        ${held.length ? `<br>${plural(held.length, 'bill')} fully held by requests already in progress: ${held.map(b => `${esc(b.id)} (${esc(heldBy(b, exclude).join(', '))})`).join('; ')}.` : ''}</div></div>`;
}

/* ---------- review before submit, and the confirmation after ----------------- */
function reviewModal({ title, rows, note, okLabel, onOk }) {
  modal({ title, wide:true, okLabel: okLabel || 'Confirm and submit', onOk, body:`
    <p style="font-size:var(--fs-md);margin:0 0 14px">Check the details. Nothing is sent until you confirm.</p>
    <table class="advice-t review-t">${rows.filter(Boolean).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</table>
    ${note ? `<div class="note note-info" style="margin-top:14px"><span>${note}</span></div>` : ''}` });
}

/* After a submission: a receipt with the reference, where it is now, and
   what happens next — rather than dropping straight onto a list. */
function viewDone(kind, id) {
  const root = isAD2() && !acting() ? 'ad2' : 'sme';
  const steps = (list, at) => `<div class="wf" role="list">${list.map((s, i) => `
    <div class="wf-step ${i < at ? 'done' : i === at ? 'now' : ''}" role="listitem"><div class="wf-dot">${i < at ? '✓' : i + 1}</div>
      <div class="wf-txt"><b>${esc(s[0])}</b><small>${esc(s[1])}</small></div></div>`).join('')}</div>`;
  let head, rows = [], flow = '', acts = [], at = null;
  if (kind === 'outward') {
    const o = outwardRec(id);
    if (!o) return shell(crumb('Submitted'), empty('Not found', 'This request is not visible to you.'));
    head = `Outward request ${o.id} submitted`; at = o.requestDate;
    rows = [['Beneficiary', esc(o.beneficiary)], ['Product / purpose', esc(productLabel(o.remittanceType)) + '<br><small>' + esc(purposeLabel(o.purposeCode)) + '</small>'],
      ['Amount', '<b>' + money(o.amount, o.currency) + '</b>'], ['Rate', '₹ ' + (o.rate.customerRate || 0).toFixed(4) + (o.rate.dealRef ? ' · deal ' + esc(o.rate.dealRef) : ' · booked')],
      ['INR debit (estimate)', inr(o.debitInr)], ['Bills', (o.allocations || []).map(a => `${esc(a.billId)} — ${money(a.amount, o.currency)}`).join('<br>') || '—'],
      ['Status', badge(o.status) + ' · with ' + esc(o.pendingWith)]];
    flow = steps([['Submitted', 'You'], ['Verify', 'AD2 Maker'], ['Authorise', 'AD2 Checker / Operations'], ['Release', 'AD2 Operations — UTR and MT103']], 1);
    acts = [`<button class="btn btn-primary" type="button" data-act="go" data-href="#/${root}/outward/${o.id}">View request</button>`,
      `<button class="btn btn-plain" type="button" data-act="or-new">New outward request</button>`];
  } else if (kind === 'disposal') {
    const d = disposalRec(id);
    if (!d) return shell(crumb('Submitted'), empty('Not found', 'This instruction is not visible to you.'));
    const i = inwardRec(d.inwardId);
    const fcy = (d.creditCurrency || 'INR') !== 'INR';
    head = `Disposal instruction ${d.id} submitted`; at = d.submittedAt;
    rows = [['Receipt', esc(i?.reference || d.inwardId) + ' · ' + esc(i?.remitter || '')], ['Amount disposed', '<b>' + money(d.amount, d.currency) + '</b>'],
      ['Purpose', esc(purposeLabelIn(d.purposeCode))], ['Bills knocked off', d.allocations.map(a => `${esc(a.billId)} — ${money(a.amount, d.currency)}`).join('<br>') || 'None — credited as an advance'],
      ['Credit', fcy ? money(d.amount, d.currency) + ' to EEFC' : inr(d.creditInr) + ' at ₹ ' + (d.rate.customerRate || 0).toFixed(4)],
      ['Left on the receipt', i ? money(i.available, i.currency) : '—'], ['Status', badge(d.status) + ' · with ' + esc(d.pendingWith)]];
    flow = steps([['Submitted', 'You'], ['Verify', 'AD2 Maker'], ['Authorise', 'AD2 Checker / Operations'], ['Credit + FIRC', 'AD2 Operations — reported to EDPMS']], 1);
    acts = [`<button class="btn btn-primary" type="button" data-act="go" data-href="#/${root}/disposals/${d.id}">View instruction</button>`,
      i && i.available > 0 ? `<button class="btn btn-ghost" type="button" data-act="go" data-href="#/sme/inward/${i.id}/dispose">Dispose the balance</button>` : '',
      `<button class="btn btn-plain" type="button" data-act="go" data-href="#/sme/inward">Inward remittances</button>`];
  } else if (kind === 'intimation') {
    const i = inwardRec(id);
    if (!i) return shell(crumb('Reported'), empty('Not found', ''));
    head = `Inward remittance ${i.id} reported`;
    rows = [['Remitter', esc(i.remitter) + ', ' + esc(i.remitterCountry)], ['Amount', '<b>' + money(i.amount, i.currency) + '</b>'],
      ['Value date', dmy(i.valueDate)], ['Reference', esc(/^INT-/.test(i.reference) ? 'to be assigned on confirmation' : i.reference)], ['Status', badge(i.status) + ' · with AD2 Operations']];
    flow = steps([['Reported', 'You'], ['Confirm credit', 'AD2 Operations matches it to the nostro'], ['Dispose', 'You — purpose, bills, account'], ['FIRC', 'AD2']], 1);
    acts = [`<button class="btn btn-primary" type="button" data-act="go" data-href="#/sme/inward/${i.id}">View remittance</button>`,
      `<button class="btn btn-plain" type="button" data-act="go" data-href="#/sme/inward">Inward remittances</button>`];
  } else if (kind === 'knockoff') {
    const ids = String(id).split(',');
    const list = DB.allocations.filter(l => ids.includes(l.id));
    head = `${plural(list.length, 'knock-off')} submitted`;
    rows = list.map(l => [l.id, `${esc(l.billId)} ← ${esc(l.ref || l.remId)} · <b>${money(l.amount, l.currency)}</b> · ${badge(l.status)}`]);
    flow = steps([['Proposed', 'You'], ['Confirm', 'AD2 Checker / Operations'], ['Reported', 'UFI portal — IDPMS / EDPMS updated']], 1);
    acts = [`<button class="btn btn-primary" type="button" data-act="go" data-href="#/sme/knockoff">Back to knock-off</button>`];
  } else if (kind === 'bill') {
    const b = bill(id);
    if (!b) return shell(crumb('Lodged'), empty('Not found', ''));
    head = `${b.type} bill ${b.id} lodged`;
    rows = [['Invoice', esc(b.invoiceNumber) + ' · ' + dmy(b.invoiceDate)], ['Counterparty', esc(b.counterparty) + ', ' + esc(b.counterpartyCountry)],
      ['Amount', '<b>' + money(b.amount, b.currency) + '</b>'], ['Due', dmy(b.dueDate)], ['Review', badge(b.review)]];
    flow = steps([['Lodged', 'You'], ['Accept', 'AD2 Checker / Operations'], [b.type === 'Import' ? 'Pay it' : 'Dispose against it', b.type === 'Import' ? 'DIR or LC payment' : 'Inward disposal']], b.review === 'Accepted' ? 2 : 1);
    acts = [`<button class="btn btn-primary" type="button" data-act="go" data-href="#/sme/bills/${b.type.toLowerCase()}">Bill register</button>`,
      `<button class="btn btn-plain" type="button" data-act="bill-another" data-type="${b.type}">Lodge another</button>`];
  } else return shell(crumb('Done'), empty('Nothing to show', ''));
  return shell(crumb('Confirmation'), `
    <div class="done-card card"><div class="card-body">
      <div class="done-tick" aria-hidden="true">✓</div>
      <h1>${esc(head)}</h1>
      <p class="done-sub">Reference <b>${esc(id)}</b> · ${dmyt(at || nowISO())}</p>
      <div style="margin:22px 0">${flow}</div>
      <table class="advice-t review-t">${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`).join('')}</table>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:22px">${acts.filter(Boolean).join('')}
        <button class="btn btn-plain" type="button" data-act="go" data-href="#/${root}/dashboard">Dashboard</button></div>
    </div></div>`);
}
const purposeLabelIn = code => { const p = (DB.inwardPurposes || []).find(x => x.code === code); return p ? `${p.code} — ${p.label}` : (code || '—'); };
