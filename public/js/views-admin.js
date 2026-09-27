/* ==========================================================================
   Administration (one screen per master), the test data lab, and the
   dashboards for roles that do not work a queue (Sales, Administrator)
   ========================================================================== */

/* ---------- administration --------------------------------------------------- */
let adminProduct = 'OTT', adminFilter = '', auditFilter = '';
const ADMIN_PAGES = {
  purpose:    ['Purpose codes', 'Which purpose codes each product offers, and the purposes an SME can choose on a disposal.'],
  docs:       ['Document policy', 'The documents each product asks for, and when each one is required.'],
  compliance: ['Compliance rules', 'How outward requests and disposal instructions are scored when they are submitted.'],
  masters:    ['Currencies and checklists', 'Reference rates, margin multipliers, onboarding documents and charge categories.'],
  settings:   ['Platform settings', 'Switches that change how the workflow behaves for everyone.'],
  users:      ['Users', 'Who can sign in, with which role. Changes take effect on the user’s next action.'],
  roles:      ['Roles and permissions', 'What each role can do. Enforced by the API on every action.'],
  audit:      ['Audit log', 'Every action on the platform, newest first.'],
};

function viewAdmin(tab) {
  tab = ADMIN_PAGES[tab] ? tab : 'purpose';
  const [title, sub] = ADMIN_PAGES[tab];
  const body = { purpose: adminPurpose, docs: adminDocs, compliance: adminCompliance, masters: adminMasters,
                 settings: adminSettings, users: adminUsers, roles: () => `<div class="card">${rolesPane()}</div>`, audit: adminAudit }[tab]();
  const ro = !can('admin.masters') && ['purpose','docs','compliance'].includes(tab);
  return shell(crumb('Administration', title), `
    <div class="page-head"><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>
      ${tab === 'audit' ? `<div class="acts"><button class="btn btn-plain" type="button" data-act="audit-export">Export CSV</button></div>` : ''}
      ${tab === 'users' && can('admin.users') ? `<div class="acts"><button class="btn btn-primary" type="button" data-act="user-add">Add user</button></div>` : ''}</div>
    ${ro ? `<div class="note note-warn" style="margin-bottom:18px"><span>Your role can see this master but only the Administrator can change it.</span></div>` : ''}
    ${body}`);
}

function adminPurpose() {
  const edit = can('admin.masters');
  const prod = product(adminProduct) || DB.products[0];
  const q = adminFilter.toLowerCase();
  const codes = prod.purposes.map(c => purpose(c)).filter(Boolean).filter(p => !q || (p.code + ' ' + p.label).toLowerCase().includes(q));
  const off = prod.disabled || [];
  return `
    <div class="card" style="margin-bottom:20px">
      <div class="card-head"><h2>Outward products</h2></div>
      <div class="card-body">
        <div class="note note-info" style="margin-bottom:16px"><span>From the business team's <b>Purpose / Doc Policy</b> workbook: ${DB.purposeCodes.length} approved
          purpose codes across AIR, DIR and OTT. LC was added on review and uses the import-of-goods codes. ${edit ? 'Untick a code to stop it being offered on new requests.' : ''}</span></div>
        <div class="toolbar" style="padding:0 0 12px">
          ${DB.products.filter(p => p.purposes.length).map(p => `<button class="btn ${p.id === prod.id ? 'btn-primary' : 'btn-plain'} btn-sm" type="button"
            data-act="admin-product" data-id="${p.id}">${esc(p.id)} · ${p.purposes.length - (p.disabled || []).length}/${p.purposes.length}</button>`).join('')}
          <input type="search" data-act="admin-filter" value="${esc(adminFilter)}" placeholder="Search codes" aria-label="Search purpose codes">
        </div>
        <p style="margin:0 0 10px;color:var(--muted);font-size:var(--fs-sm)"><b>${esc(prod.id)} — ${esc(prod.label)}.</b> ${esc(prod.hint)}
          ${prod.added ? ' <span class="badge b-purple">Added on review</span>' : ''}</p>
        <div class="tablewrap"><table class="dt">
          <thead><tr><th style="width:90px">Offered</th><th data-sort>Code</th><th data-sort>Description</th><th>Also under</th></tr></thead>
          <tbody>${codes.map(p => `<tr><td><input type="checkbox" data-act="purpose-toggle" data-product="${prod.id}" data-code="${p.code}"
              ${off.includes(p.code) ? '' : 'checked'} ${edit ? '' : 'disabled'} aria-label="Offer ${p.code}"></td>
            <td><b>${esc(p.code)}</b></td><td>${esc(p.label)}</td>
            <td>${DB.products.filter(x => x.id !== prod.id && x.purposes.includes(p.code)).map(x => x.id).join(', ') || '—'}</td></tr>`).join('')}</tbody>
        </table></div></div></div>
    <div class="card">
      <div class="card-head"><h2>Inward purposes (disposal)</h2></div>
      <div class="card-body">
        <p style="margin:0 0 12px;color:var(--muted);font-size:var(--fs-sm)">The purpose an SME declares on a disposal instruction. The workbook names one, TRADE.</p>
        <div class="tablewrap"><table class="dt">
          <thead><tr><th style="width:90px">Offered</th><th>Code</th><th>Description</th><th></th></tr></thead>
          <tbody>${(DB.inwardPurposes || []).map(x => `<tr><td><input type="checkbox" data-act="inpurpose-toggle" data-code="${esc(x.code)}"
            ${x.disabled ? '' : 'checked'} ${edit ? '' : 'disabled'} aria-label="Offer ${esc(x.code)}"></td>
            <td><b>${esc(x.code)}</b></td><td>${esc(x.label)}</td><td>${x.added ? '<span class="badge b-purple">Added</span>' : '<span class="badge b-grey">Workbook</span>'}</td></tr>`).join('')}</tbody>
        </table></div>
        ${edit ? `<div class="grid g3 fields" style="margin-top:14px;align-items:end">
          <div class="f"><label for="ip-code">Code</label><input id="ip-code" type="text" placeholder="e.g. SVCEXP" maxlength="10"></div>
          <div class="f"><label for="ip-label">Description</label><input id="ip-label" type="text" placeholder="e.g. Export of services"></div>
          <div><button class="btn btn-ghost" type="button" data-act="inpurpose-add">Add inward purpose</button></div></div>` : ''}
        <h3 style="font-size:var(--fs-md);margin:20px 0 8px">Disposal options</h3>
        <div class="optcards">${(DB.disposalOptions || []).map(o => `<div class="optcard" style="cursor:default"><b>${esc(o.label)}</b><small>${esc(o.hint)}</small></div>`).join('')}</div>
      </div></div>`;
}

const RULE_LABELS = [['required','Required'],['optional','Optional'],['goods','Required for goods imports'],['threshold','Required above a threshold'],['knockoff','Required when knocking off bills']];
function adminDocs() {
  const edit = can('admin.masters');
  return `<div class="note note-info" style="margin-bottom:18px"><span>From the workbook's Document Policy sheet. Form 145 and Form 146 replace Form 15CA and 15CB under the Income-tax Act 2025.
      ${edit ? 'A change applies to the next request; requests already submitted keep the documents they were checked against.' : ''}</span></div>
    ${DB.products.map(p => `<div class="card" style="margin-bottom:18px">
      <div class="card-head"><h2>${esc(p.id)} — ${esc(p.label)}</h2>
        <div class="acts"><span style="color:var(--muted);font-size:var(--fs-sm)">${p.direction === 'inward' ? 'Disposal instructions' : 'Outward remittance'}</span>
          ${edit ? `<button class="btn btn-ghost btn-sm" type="button" data-act="doc-add" data-product="${p.id}">Add document</button>` : ''}</div></div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt"><thead><tr><th>Document</th><th style="width:300px">Rule</th><th style="width:170px">Threshold (INR)</th><th></th></tr></thead>
        <tbody>${DB.docPolicy.filter(d => d.product === p.id).map(d => `<tr><td>${esc(d.name)}${d.added ? ' <span class="badge b-purple">Added</span>' : ''}</td>
          <td><select data-act="policy-rule" data-product="${p.id}" data-doc="${d.id}" ${edit ? '' : 'disabled'} aria-label="Rule for ${esc(d.name)}">
            ${RULE_LABELS.filter(([k]) => k !== 'knockoff' || p.id === 'TRADE').map(([k, l]) => `<option value="${k}" ${d.rule === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
          <td>${d.rule === 'threshold' ? `<input type="number" min="1" step="1000" value="${d.threshold}" data-act="policy-threshold" data-product="${p.id}" data-doc="${d.id}" ${edit ? '' : 'disabled'} style="width:140px" aria-label="Threshold">` : '<span style="color:var(--muted)">—</span>'}</td>
          <td>${edit ? `<button class="btn btn-link" type="button" data-act="doc-remove" data-product="${p.id}" data-doc="${d.id}">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div></div>`).join('')}
    <p style="color:var(--muted);font-size:var(--fs-xs)">Goods-import purpose codes: ${DB.goodsCodes.join(', ')}.</p>`;
}

function adminCompliance() {
  const edit = can('admin.masters');
  const rules = DB.complianceRules || [];
  return `<div class="note note-info" style="margin-bottom:18px"><span>Each rule adds its weight when it fires. A score of <b>60 or more is High</b> — the maker and checker must each record a reason to pass it;
      <b>25–59 is Medium</b>; below 25 is Low. The SME never sees the score.</span></div>
    <div class="card"><div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th style="width:70px">On</th><th>Rule</th><th style="width:110px">Weight</th><th>Parameter</th><th></th></tr></thead>
      <tbody>${rules.map(r => `<tr>
        <td><input type="checkbox" data-act="rule-toggle" data-id="${r.id}" ${r.enabled ? 'checked' : ''} ${edit ? '' : 'disabled'} aria-label="${esc(r.label)} on"></td>
        <td><b>${esc(r.label)}</b><br><small style="color:var(--muted)">${esc(r.help)}</small></td>
        <td><input type="number" min="0" max="100" value="${r.weight}" id="rw-${r.id}" ${edit ? '' : 'disabled'} style="width:80px" aria-label="Weight"></td>
        <td>${Array.isArray(r.param) ? `<textarea id="rp-${r.id}" rows="2" ${edit ? '' : 'disabled'} style="min-width:260px" aria-label="List">${esc(r.param.join(', '))}</textarea>`
            : r.param != null ? `<input type="number" id="rp-${r.id}" value="${r.param}" ${edit ? '' : 'disabled'} style="width:130px" aria-label="Threshold"> <small style="color:var(--muted)">USD</small>`
            : '<span style="color:var(--muted)">—</span>'}</td>
        <td>${edit ? `<button class="btn btn-ghost btn-sm" type="button" data-act="rule-save" data-id="${r.id}">Save</button>` : ''}</td></tr>`).join('')}</tbody>
    </table></div></div></div>`;
}

function adminMasters() {
  return `<div class="grid g2" style="align-items:start">
    <div class="card"><div class="card-head"><h2>Currency master</h2></div><div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Code</th><th>Name</th><th class="num">Margin multiplier</th><th class="num">Reference rate</th></tr></thead>
      <tbody>${DB.currencies.map(c => `<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.name)}</td>
        <td class="num">${c.marginMultiplier.toFixed(2)}</td><td class="num">₹ ${c.refRate.toFixed(4)}</td></tr>`).join('')}</tbody>
    </table></div></div></div>
    <div class="grid" style="gap:20px">
      <div class="card"><div class="card-head"><h2>Onboarding documents</h2></div><div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Document</th><th>Requirement</th></tr></thead>
        <tbody>${DB.onboardDocs.map(d => `<tr><td>${esc(d.name)}</td>
          <td>${d.required ? '<span class="badge b-red">Mandatory</span>' : '<span class="badge b-grey">Optional</span>'}</td></tr>`).join('')}</tbody>
      </table></div></div></div>
      <div class="card"><div class="card-head"><h2>Charge categories</h2></div><div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Charge</th><th>Code</th></tr></thead>
        <tbody>${DB.chargeCategories.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.id)}</td></tr>`).join('')}</tbody>
      </table></div></div></div>
    </div></div>`;
}

function adminSettings() {
  const ed = can('admin.settings') ? '' : 'disabled';
  const st = DB.settings;
  return `<div class="card"><div class="card-body">
    ${ed ? `<div class="note note-warn" style="margin-bottom:var(--s4)"><span>Your role can see these settings but not change them.</span></div>` : ''}
    <div class="checks" style="gap:18px">
      <label class="chk"><input type="checkbox" data-act="set-autochecker" ${st.autoChecker ? 'checked' : ''} ${ed}>
        <span>AutoChecker for onboarding and bills<small>A maker's application review and SME bill lodgements commit without a checker. Outward payments and disposals always need a checker.</small></span></label>
      <label class="chk"><input type="checkbox" data-act="set-unlinked" ${st.allowUnlinked ? 'checked' : ''} ${ed}>
        <span>Permit DIR and LC payments without a linked import bill<small>Off by default: DIR and LC payments settle a lodged bill.</small></span></label>
      <label class="chk"><input type="checkbox" data-act="set-testlab" ${st.testLab !== false ? 'checked' : ''} ${ed}>
        <span>Test tools<small>The test data lab, which generates test businesses, bills, receipts and parked requests, and the master test user (TEST / MASTER), which opens the platform as anyone. Switch off for a clean walkthrough.</small></span></label>
    </div>
    <div class="grid g3 fields" style="margin-top:22px;align-items:end">
      <div class="f"><label for="set-band">Assisted margin band (paise)</label>
        <input id="set-band" type="number" min="0" max="50" value="${st.marginBand ?? 5}" ${ed}>
        <div class="hint">How far below the approved margin AD2 may price in an assisted journey.</div></div>
      <div>${ed ? '' : `<button class="btn btn-ghost" type="button" data-act="set-band-save">Save band</button>`}</div>
    </div>
    <h3 style="margin:28px 0 6px;font-size:var(--fs-md)">Treasury</h3>
    <div class="checks"><label class="chk"><input type="checkbox" data-act="set-marketsim" ${st.marketSim !== false ? 'checked' : ''} ${ed}>
      <span>Simulated market<small>Rates drift gently during the day so the rate desk, exceptions and unrealised P&L move in a demo. Off: the market equals the published rate.</small></span></label></div>
    <div class="grid g4 fields" style="margin-top:14px;align-items:end">
      <div class="f"><label for="set-cutoff">Daily cut-off (IST)</label><input id="set-cutoff" type="time" value="${esc(st.cutoff || '16:00')}" ${ed}>
        <div class="hint">After it, uncovered currencies are flagged. Nothing is cancelled.</div></div>
      <div class="f"><label for="set-maxbk">Open rate bookings per customer</label><input id="set-maxbk" type="number" min="1" max="20" value="${st.maxOpenBookings ?? 5}" ${ed}></div>
      <div class="f"><label for="set-rband">Rate revision band (%)</label><input id="set-rband" type="number" step="0.5" min="0.5" max="5" value="${st.rateBand ?? 2}" ${ed}></div>
      <div class="f"><label for="set-aged">Aged after (days)</label><input id="set-aged" type="number" min="1" max="30" value="${st.agedDays ?? 3}" ${ed}></div>
    </div>
    ${ed ? '' : `<div style="margin-top:12px"><button class="btn btn-ghost" type="button" data-act="set-treasury-save">Save treasury settings</button></div>`}
    </div></div>`;
}

function adminUsers() {
  const edit = can('admin.users');
  const list = [...DB.logins].sort((a, b) => (a.domainId === 'AD2' ? 0 : 1) - (b.domainId === 'AD2' ? 0 : 1) || a.domainId.localeCompare(b.domainId));
  const ad2Roles = DB.roles.filter(r => r.portal === 'AD2').sort((a, b) => a.order - b.order).map(r => r.id);
  const self = l => S && l.domainId === S.domainId && l.loginId === S.loginId;
  return `<div class="card"><div class="toolbar">
      <input type="search" data-act="table-filter" data-target="#users-t" placeholder="Filter users" aria-label="Filter users">
      <div class="spacer"></div><span style="color:var(--muted);font-size:var(--fs-sm)">${plural(list.length, 'user')} · ${list.filter(l => !l.active).length} inactive</span></div>
    <div class="card-body tight"><div class="tablewrap"><table class="dt" id="users-t">
    <thead><tr><th data-sort>Domain ID</th><th data-sort>Login ID</th><th data-sort>Name</th><th data-sort>Role</th><th data-sort>Business</th><th>Sign-in</th><th data-sort>Status</th><th></th></tr></thead>
    <tbody>${list.map(l => `<tr>
      <td>${esc(l.domainId)}</td><td>${esc(l.loginId)}</td><td>${esc(l.name || '')}${self(l) ? ' <span class="badge b-teal">You</span>' : ''}</td>
      <td>${edit && l.domainId === 'AD2' && !self(l)
        ? `<select data-act="user-role" data-d="${esc(l.domainId)}" data-l="${esc(l.loginId)}" aria-label="Role">${ad2Roles.map(r => `<option ${r === l.role ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>`
        : `<b>${esc(l.role)}</b>`}</td>
      <td>${esc(l.tradingName || '—')}${l.test ? ' <span class="badge b-grey">test</span>' : ''}</td>
      <td>${l.demo ? '<span class="badge b-grey">Demo passcode</span>' : '<span class="badge b-teal">Own password</span>'}</td>
      <td>${l.active ? '<span class="badge b-green">Active</span>' : '<span class="badge b-red">Deactivated</span>'}</td>
      <td style="white-space:nowrap">${edit && !self(l) ? `
        <button class="btn btn-link" type="button" data-act="user-active" data-d="${esc(l.domainId)}" data-l="${esc(l.loginId)}" data-on="${l.active ? '' : '1'}">${l.active ? 'Deactivate' : 'Reactivate'}</button>
        ${l.demo ? '' : `<button class="btn btn-link" type="button" data-act="user-reset" data-d="${esc(l.domainId)}" data-l="${esc(l.loginId)}">Reset password</button>`}` : ''}</td></tr>`).join('')}</tbody>
  </table></div></div></div>`;
}

function adminAudit() {
  const q = auditFilter.toLowerCase();
  const rows = DB.audit.filter(a => !q || (a.record + ' ' + a.actor + ' ' + a.action).toLowerCase().includes(q)).slice(0, 400);
  return `<div class="card"><div class="toolbar">
      <input type="search" data-act="audit-filter" value="${esc(auditFilter)}" placeholder="Filter by record, user or action" aria-label="Filter audit log" style="min-width:320px">
      <div class="spacer"></div><span style="color:var(--muted);font-size:var(--fs-sm)">${plural(rows.length, 'entry', 'entries')}${rows.length === 400 ? ' (latest 400)' : ''}</span></div>
    <div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th data-sort>When</th><th data-sort>Record</th><th data-sort>Who</th><th>Action</th></tr></thead>
      <tbody>${rows.map(a => `<tr><td style="white-space:nowrap" data-v="${esc(a.at)}">${dmyt(a.at)}</td><td>${auditLink(a.record)}</td>
        <td>${esc(a.actor)}</td><td>${esc(a.action)}</td></tr>`).join('') || `<tr><td colspan="4">${empty('Nothing matches', 'Try a different filter.')}</td></tr>`}</tbody>
    </table></div></div></div>`;
}
function auditLink(rec) {
  const r = String(rec || '');
  const href = /^OR-/.test(r) ? '#/ad2/outward/' + r : /^DI-/.test(r) ? '#/ad2/disposals/' + r : /^IR-/.test(r) ? '#/ad2/inward/' + r
    : /^SME-/.test(r) ? '#/ad2/applications/' + r : '';
  return href && navAllows(href) ? `<a href="${href}">${esc(r)}</a>` : esc(r);
}

/* ---------- test data lab ------------------------------------------------------ */
function labCounts(s) {
  const bills = DB.bills.filter(b => b.smeId === s.id && b.review === 'Accepted');
  return {
    imp: bills.filter(b => b.type === 'Import' && Engine.billAvailable(DB, b) > 0).length,
    exp: bills.filter(b => b.type === 'Export' && Engine.billAvailable(DB, b) > 0).length,
    rec: DB.inward.filter(i => i.smeId === s.id && i.available > 0).length,
    firc: DB.disposals.filter(d => d.smeId === s.id && d.status === 'Processed' && (d.unallocated || 0) > 0).length,
    open: DB.outward.filter(o => o.smeId === s.id && Engine.OPEN.includes(o.status)).length + DB.disposals.filter(d => d.smeId === s.id && Engine.OPEN.includes(d.status)).length,
  };
}
const LAB_SCENARIOS = [
  ['Onboard a new business', 'Create an application below (or register one, or capture it offline as Sales or Maker), then AD2 Maker reviews and prices it, AD2 Compliance approves it, and the business signs in.', 'Maker → Compliance'],
  ['Pay a supplier against a bill (DIR)', 'Sign in as any Import or Both business, open Outward remittance, pick DIR, allocate an accepted import bill, upload the three documents, book a rate and submit. Maker verifies, Checker authorises, Operations releases.', 'SME → Maker → Checker → Ops'],
  ['Settle under a letter of credit (LC)', 'Same as DIR but choose LC, enter the LC number and attach the LC copy.', 'SME → Maker → Checker → Ops'],
  ['Advance payment, then knock-off (AIR)', 'Arcadia Components already has a completed advance, OR-5108, and its Bill of Entry, BL-24013. Propose the knock-off, and a Checker or Operations confirms it — the UFI portal (IDPMS) is updated.', 'SME → Checker'],
  ['A payment that needs Form 146', 'An OTT payment above ₹5,00,000 INR equivalent (for example USD 7,000 of services) asks for Form 146. Below that, it is optional.', 'SME → Maker → Checker → Ops'],
  ['A High-risk payment', 'Every Import business created here has the beneficiary “Blocked Trading LLC” (Iran). Paying it scores High, so the maker and checker must each write a reason.', 'SME → Maker → Checker'],
  ['Partial disposal of a receipt', 'Open a receipt, dispose of part of it against a bill, then dispose of the rest in a second instruction. Each gets its own FIRC.', 'SME → Maker → Checker → Ops'],
  ['Advance receipt, knocked off later', 'Dispose of a receipt with the option “Credit as advance”. After Operations processes it, the FIRC is pending knock-off — match it to an export bill on the Knock-off screen. Meridian’s DI-9004 is ready to try.', 'SME → Maker → Checker → Ops → SME → Checker'],
  ['Credit to an EEFC account', 'On a disposal, pick the EEFC account in the receipt currency. No rate is booked and the foreign currency is credited as it is.', 'SME → Maker → Checker → Ops'],
  ['Report a payment from a buyer', 'As an Export business, open Inward remittance → New inward remittance → Report a payment. AD2 Operations confirms the credit (Receipts to confirm), then the business disposes of it.', 'SME → Ops → SME → Maker → Checker → Ops'],
  ['Queries and rejections', 'As Maker, raise a query on any submitted request; the SME answers — or the maker records the answer and documents for them — and it returns. As Checker, reject one — any bill reservation is released.', 'Maker ↔ SME, Checker'],
];

function viewLab() {
  if (DB.settings.testLab === false) return shell(crumb('Test data lab'), denied('The test data lab is off', 'An Administrator can switch it on in Platform settings.'));
  const ad2 = isAD2() && !acting();
  const pool = ad2 ? DB.smes.filter(s => s.status === 'Approved') : [sme(ctxSmeId())].filter(Boolean);
  const loginOf = s => DB.logins.find(l => l.smeId === s.id && l.active !== false && l.demo) || DB.logins.find(l => l.smeId === s.id);
  const apps = DB.smes.filter(s => !['Approved', 'Rejected'].includes(s.status));
  return shell(crumb('Test data lab'), `
    <div class="page-head"><div><h1>Test data lab</h1>
      <p>Fresh data on demand, so any journey can be run again once the seeded items are used up. Everything here is fictional and marked as test data.</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="reset-demo">Reset all demo data</button></div></div>

    ${ad2 ? `<div class="card" style="margin-bottom:20px"><div class="card-head"><h2>Create a test business</h2></div><div class="card-body">
      <p style="margin:0 0 14px;font-size:var(--fs-md)">Each approved business comes with verified INR and EEFC accounts, suppliers, accepted import and export bills,
        one bill awaiting the checker, and receipts ready to dispose. It signs in with the demo passcode.</p>
      <div class="optcards">${(DB.testSmes || []).map(p => `<div class="optcard" style="cursor:default">
        <b>${esc(p.tradingName)}</b><small>${esc(p.industry)} · ${esc(p.city)}<br>${esc(p.permission)} · ${p.currencies.join(' · ')}</small>
        <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" type="button" data-act="lab-create" data-p="${p.key}" data-stage="approved">Approved business</button>
          <button class="btn btn-plain btn-sm" type="button" data-act="lab-create" data-p="${p.key}" data-stage="applicant">As an application</button></div></div>`).join('')}</div>
    </div></div>` : ''}

    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>${ad2 ? 'Businesses' : 'Your business'}</h2>
      <div class="acts"><span style="color:var(--muted);font-size:var(--fs-sm)">Counts are what is still free to use</span></div></div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th data-sort>Business</th><th data-sort>Permission</th><th class="num" data-sort>Import bills</th><th class="num" data-sort>Export bills</th>
          <th class="num" data-sort>Receipts</th><th class="num" data-sort>FIRCs to knock off</th><th class="num" data-sort>In flight</th><th style="width:170px"></th></tr></thead>
        <tbody>${pool.map(s => { const c = labCounts(s), l = loginOf(s); return `<tr>
          <td><b>${esc(s.tradingName || s.legalName)}</b>${s.test ? ' <span class="badge b-grey">test</span>' : ''}
            <br><small style="color:var(--muted)">${esc(s.id)}${l ? ` · sign in ${esc(l.domainId)} / ${esc(l.loginId)}` : ''}</small></td>
          <td>${esc(s.config.permission)}</td><td class="num">${c.imp}</td><td class="num">${c.exp}</td><td class="num">${c.rec}</td><td class="num">${c.firc}</td><td class="num">${c.open}</td>
          <td><div style="display:grid;gap:6px">
            <button class="btn btn-ghost btn-sm" type="button" data-act="lab-topup" data-id="${s.id}" title="Add accepted bills and receipts">Add bills & receipts</button>
            <button class="btn btn-plain btn-sm" type="button" data-act="lab-queue" data-id="${s.id}" title="Create requests parked at submitted, verified and authorised">Park requests</button>
            ${ad2 && l && l.demo ? `<button class="btn btn-link" type="button" data-act="switch-user" data-d="${esc(l.domainId)}" data-l="${esc(l.loginId)}">Sign in as them</button>` : ''}
          </div></td></tr>`; }).join('')}</tbody></table></div></div></div>

    ${ad2 && apps.length ? `<div class="card" style="margin-bottom:20px"><div class="card-head"><h2>Applications waiting</h2></div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Application</th><th>Business</th><th>Status</th><th>With</th><th>Applicant sign-in</th><th></th></tr></thead>
        <tbody>${apps.map(s => { const l = loginOf(s); return `<tr><td>${esc(s.id)}</td><td>${esc(s.legalName)}</td><td>${badge(s.status)}</td><td>${esc(s.pendingWith || '—')}</td>
          <td>${l ? esc(l.domainId + ' / ' + l.loginId) : '—'}</td>
          <td>${navAllows('#/ad2/applications') ? `<button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/applications/${s.id}">Open</button>` : ''}</td></tr>`; }).join('')}</tbody>
      </table></div></div></div>` : ''}

    <div class="card"><div class="card-head"><h2>Journeys to try</h2></div><div class="card-body">
      <div class="tablewrap"><table class="dt"><thead><tr><th style="width:240px">Journey</th><th>How</th><th style="width:200px">Who acts</th></tr></thead>
        <tbody>${LAB_SCENARIOS.map(([t, h, w]) => `<tr><td><b>${esc(t)}</b></td><td>${esc(h)}</td><td>${esc(w)}</td></tr>`).join('')}</tbody></table></div>
      <p style="margin:14px 0 0;color:var(--muted);font-size:var(--fs-sm)">Demo users: two makers (Rohit, Priya), two trade checkers (Shalini, Vikram), two compliance users (Meera, Arvind) and two operations users (Farhan, Neha),
        so four-eyes never blocks you. Use <b>Switch user</b> in the top bar.</p>
    </div></div>`);
}

/* ---------- dashboards for Sales and the Administrator ---------------------------- */
function viewSalesDashboard() {
  const list = DB.smes.filter(s => s.status === 'Approved');
  const apps = DB.smes.filter(s => !['Approved', 'Rejected'].includes(s.status));
  const waiting = DB.inward.filter(i => i.available > 0);
  const inflight = DB.outward.filter(o => Engine.OPEN.includes(o.status)).length + DB.disposals.filter(d => Engine.OPEN.includes(d.status)).length;
  return shell(crumb('Dashboard'), `
    <div class="page-head"><div><h1>My customers</h1><p>Signed in as ${esc(S.role)}${S.name ? ' — ' + esc(S.name) : ''}. Onboard customers and raise requests on their behalf; a maker verifies and a checker authorises them.</p></div>
      <div class="acts"><button class="btn btn-primary" type="button" data-act="offline-app">Capture an offline application</button></div></div>
    <div class="grid g4" style="margin-bottom:20px">
      ${kpi('Active customers', list.length, { go:'#/ad2/directory' })}
      ${kpi('Applications in progress', apps.length, { go:'#/ad2/applications' })}
      ${kpi('Receipts awaiting instruction', waiting.length, { go:'#/ad2/inward', tone: waiting.length ? 'warn' : '' })}
      ${kpi('Requests in flight', inflight, { go:'#/ad2/outward' })}
    </div>
    <div class="card"><div class="card-head"><h2>Customers</h2></div><div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th data-sort>Customer</th><th data-sort>Permission</th><th>Currencies</th><th class="num" data-sort>Open import bills</th><th class="num" data-sort>Receipts to dispose</th><th></th></tr></thead>
      <tbody>${list.map(s => `<tr><td><b>${esc(s.tradingName || s.legalName)}</b><br><small style="color:var(--muted)">${esc(s.id)} · ${esc(s.domainId)}</small></td>
        <td>${esc(s.config.permission)}</td><td>${s.config.currencies.join(' · ')}</td>
        <td class="num">${DB.bills.filter(b => b.smeId === s.id && b.type === 'Import' && b.review === 'Accepted' && b.outstanding > 0).length}</td>
        <td class="num">${DB.inward.filter(i => i.smeId === s.id && i.available > 0).length}</td>
        <td><button class="btn btn-ghost btn-sm" type="button" data-act="assist-start" data-id="${s.id}">Transact on behalf</button></td></tr>`).join('')}</tbody>
    </table></div></div></div>`);
}

function viewAdminDashboard() {
  const cfg = DB.audit.filter(a => ['POLICY', 'SETTINGS', 'USERS', 'COMPLIANCE'].includes(a.record)).slice(0, 8);
  const enabledCodes = DB.products.reduce((t, p) => t + p.purposes.length - (p.disabled || []).length, 0);
  return shell(crumb('Dashboard'), `
    <div class="page-head"><div><h1>Platform administration</h1>
      <p>Signed in as ${esc(S.role)}${S.name ? ' — ' + esc(S.name) : ''}. You maintain the controls; you hold no transaction authority.</p></div></div>
    <div class="grid g4" style="margin-bottom:20px">
      ${kpi('Active users', DB.logins.filter(l => l.active !== false).length, { go:'#/ad2/admin/users' })}
      ${kpi('Purpose codes offered', enabledCodes, { go:'#/ad2/admin/purpose' })}
      ${kpi('Document rules', DB.docPolicy.length, { go:'#/ad2/admin/docs' })}
      ${kpi('Compliance rules on', (DB.complianceRules || []).filter(r => r.enabled).length + ' / ' + (DB.complianceRules || []).length, { go:'#/ad2/admin/compliance' })}
    </div>
    <h2 style="font-size:var(--fs-md);margin:0 0 10px;color:var(--ink-soft)">Platform activity</h2>
    <div class="grid g4" style="margin-bottom:20px">
      ${kpi('Approved SMEs', DB.smes.filter(x => x.status === 'Approved').length, { go:'#/ad2/directory' })}
      ${kpi('Requests in flight', DB.outward.filter(o => Engine.OPEN.includes(o.status)).length + DB.disposals.filter(d => Engine.OPEN.includes(d.status)).length, { go:'#/ad2/outward' })}
      ${kpi('High-risk items open', DB.outward.concat(DB.disposals).filter(r => Engine.OPEN.includes(r.status) && r.risk && r.risk.level === 'High').length, { go:'#/ad2/outward', tone:'warn' })}
      ${kpi('FIRCs pending knock-off', DB.disposals.filter(d => d.status === 'Processed' && (d.unallocated || 0) > 0).length, { go:'#/ad2/reports' })}
    </div>
    <div class="grid g2">
      <div class="card"><div class="card-head"><h2>Settings in force</h2><div class="acts"><button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/admin/settings">Change</button></div></div>
        <div class="card-body"><div class="kv">
          <div><div class="k">AutoChecker</div><div class="v">${DB.settings.autoChecker ? 'On' : 'Off'}</div></div>
          <div><div class="k">DIR/LC without a bill</div><div class="v">${DB.settings.allowUnlinked ? 'Permitted' : 'Blocked'}</div></div>
          <div><div class="k">Test data lab</div><div class="v">${DB.settings.testLab !== false ? 'On' : 'Off'}</div></div>
          <div><div class="k">Assisted margin band</div><div class="v">${DB.settings.marginBand ?? 5} paise</div></div>
        </div></div></div>
      <div class="card"><div class="card-head"><h2>Recent configuration changes</h2><div class="acts"><button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/admin/audit">Audit log</button></div></div>
        <div class="card-body">${cfg.map(a => `<div class="tl" style="padding-left:0"><div class="act">${esc(a.action)}</div>
          <div class="meta">${esc(a.actor)} · ${dmyt(a.at)}</div></div>`).join('') || '<p style="color:var(--muted)">No configuration changes yet.</p>'}</div></div>
    </div>`);
}
