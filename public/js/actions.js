/* ==========================================================================
   Router, event handlers and boot
   ========================================================================== */

/* ---------- router ---------------------------------------------------------- */
let lastHash = null;
function render(opts = {}) {
  const root = $('#root');
  if (!DB) return;
  const hash = location.hash || '#/login';
  const parts = hash.replace(/^#\//, '').split('/');
  const keep = opts.keepScroll !== false && hash === lastHash;
  const y = window.scrollY;

  if (!S && !['login','register','status'].includes(parts[0])) { location.hash = '#/login'; return; }
  let html;
  try {
    if (parts[0] === 'login') html = S ? (location.hash = S.role.startsWith('AD2') ? '#/ad2/dashboard' : '#/sme/dashboard', '') : viewLogin();
    else if (parts[0] === 'register') html = viewRegister();
    else if (parts[0] === 'status')   html = viewStatus();
    else if (parts[0] === 'sme') {
      if (!isSME() && !acting()) { location.hash = '#/ad2/dashboard'; return; }
      const me = sme(ctxSmeId());
      if (me && me.status !== 'Approved' && parts[1] !== 'dashboard') { location.hash = '#/sme/dashboard'; return; }
      switch (parts[1]) {
        case 'dashboard':    html = viewSmeDashboard(); break;
        case 'outward':      html = !parts[2] ? viewOutwardList() : parts[2] === 'new' ? viewOutwardNew() : viewOutwardDetail(parts[2]); break;
        case 'inward':       html = !parts[2] ? viewInwardList() : parts[3] === 'dispose' ? viewDispose(parts[2]) : viewInwardDetail(parts[2]); break;
        case 'disposals':    html = viewDisposalDetail(parts[2]); break;
        case 'bills':        html = viewBills(parts[2] === 'import' ? 'Import' : 'Export'); break;
        case 'knockoff':     html = viewKnockoff(); break;
        case 'reports':      html = viewReports(); break;
        case 'integrations': html = viewIntegrations(); break;
        case 'profile':      html = viewProfile(); break;
        default: location.hash = '#/sme/dashboard'; return;
      }
    }
    else if (parts[0] === 'ad2') {
      if (!isAD2()) { location.hash = '#/sme/dashboard'; return; }
      if (acting()) setSession({ ...S, actingFor:null });
      switch (parts[1]) {
        case 'dashboard':      html = viewAd2Dashboard(); break;
        case 'queue':          html = viewQueue(); break;
        case 'applications':   html = parts[2] ? viewApplicationReview(parts[2]) : viewApplications(); break;
        case 'directory':      html = viewDirectory(); break;
        case 'outward':        html = parts[2] ? viewOutwardDetail(parts[2]) : viewOutwardList(); break;
        case 'inward':         html = parts[2] ? viewInwardDetail(parts[2]) : viewInwardList(); break;
        case 'disposals':      html = viewDisposalDetail(parts[2]); break;
        case 'bills':          html = viewBills(parts[2] === 'import' ? 'Import' : 'Export'); break;
        case 'reconciliation': html = viewReconciliation(); break;
        case 'reports':        html = viewReports(); break;
        case 'admin':          html = viewAdmin(); break;
        default: location.hash = '#/ad2/dashboard'; return;
      }
    }
    else { location.hash = '#/login'; return; }
  } catch (err) {
    console.error(err);
    html = `<div class="page"><div class="card"><div class="denied"><div class="ic">!</div>
      <h3>Something went wrong rendering this screen</h3><p>${esc(err.message)}</p>
      <button class="btn btn-plain" style="margin-top:14px" type="button" data-act="go" data-href="#/login">Back to start</button>
      </div></div></div>`;
  }
  if (html === '') return;
  root.innerHTML = html;
  $('#guide-host').innerHTML = guideHTML();
  document.body.classList.toggle('with-guide', GUIDE_OPEN);
  document.body.classList.remove('nav-open');
  window.scrollTo(0, keep ? y : 0);
  lastHash = hash;
}
window.addEventListener('hashchange', () => render({ keepScroll:false }));

/* ---------- helpers for actions ------------------------------------------------ */
const val = sel => ($(sel)?.value || '').trim();
const reason = (label, hint) => `<div class="f"><label for="why">${esc(label)}</label><textarea id="why" maxlength="500"></textarea>
  ${hint ? `<div class="hint">${esc(hint)}</div>` : ''}</div>`;
const needText = (sel, msg) => { const v = val(sel); if (!v) throw msg; return v; };

let PICK = null;                     /* where a chosen file goes: { scope, id } */
function draftDocs(scope) {
  return { ob: DRAFT && DRAFT.docs, or: OR_DRAFT && OR_DRAFT.docs, di: DI_DRAFT && DI_DRAFT.docs, resp: RESP && RESP.docs }[scope];
}
function attach(scope, id, meta) {
  const docs = draftDocs(scope);
  if (!docs) return;
  docs[id] = meta;
  render();
  toast(`${meta.filename} attached.`, 'ok');
}
const kb = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

function beneFormHTML(v = {}, opts = {}) {
  const f = (k, label, req, ph) => `
    <div class="f"><label for="bn-${k}">${esc(label)}${req ? '<span class="req">*</span>' : ''}</label>
      <input id="bn-${k}" type="text" value="${esc(v[k] || '')}" placeholder="${esc(ph || '')}"></div>`;
  return `<div class="grid g2 fields">
      ${f('name','Beneficiary name',true)}
      ${f('country','Beneficiary country',true)}
      ${f('bank','Bank name',true)}
      ${f('bankCountry','Bank country',true)}
      ${f('accountNumber','Account number / IBAN',true)}
      ${f('swift','SWIFT / BIC',true,'8 or 11 characters, e.g. DEUTDEFF')}
      <div class="f"><label for="bn-currency">Account currency</label>
        <select id="bn-currency"><option value="">Not specified</option>
          ${DB.currencies.map(c => `<option ${v.currency === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}</select></div>
      ${f('relationship','Relationship or note', false)}
      <div class="f span2"><label for="bn-address">Address</label><input id="bn-address" type="text" value="${esc(v.address || '')}"></div>
    </div>
    ${opts.sample ? `<button class="btn btn-link" type="button" data-act="bene-sample" style="margin-top:8px">Fill a sample supplier</button>` : ''}
    ${opts.offerSave ? `<label class="chk" style="margin-top:var(--s4)">
        <input type="checkbox" id="bn-save" checked>
        <span>Save to the beneficiary master<small>Leave unticked for a genuine one-off payee.</small></span></label>` : ''}`;
}
function readBeneForm() {
  const g = k => (document.querySelector('#bn-' + k)?.value || '').trim();
  return { name:g('name'), country:g('country'), bank:g('bank'), bankCountry:g('bankCountry'),
           accountNumber:g('accountNumber'), swift:g('swift').toUpperCase(), currency:g('currency'),
           relationship:g('relationship'), address:g('address') };
}
function applyBeneToDraft(v, id) {
  Object.assign(OR_DRAFT, { beneficiaryId:id || '', beneficiary:v.name, beneficiaryCountry:v.country,
    beneficiaryAccount:v.accountNumber, swift:v.swift, beneficiaryBank:v.bank, beneficiaryBankCountry:v.bankCountry });
}
const SAMPLE_SUPPLIERS = [
  { name:'Werkzeugbau Kessler GmbH', country:'Germany', bank:'Deutsche Bank', bankCountry:'Germany', accountNumber:'DE44500105175407324931', swift:'DEUTDEFF', currency:'EUR', relationship:'Supplier — tooling' },
  { name:'Osaka Carbide Tools KK', country:'Japan', bank:'MUFG Bank', bankCountry:'Japan', accountNumber:'0012345678901', swift:'BOTKJPJT', currency:'USD', relationship:'Supplier — inserts' },
];

function startAssist(smeId, dest) {
  const target = sme(smeId);
  if (!target || target.status !== 'Approved') { toast('Only an approved SME can be transacted for.', 'err'); return; }
  send('assist.open', { smeId }).catch(() => {});
  setSession({ ...S, actingFor: target.id });
  resetDrafts(); closeModal();
  location.hash = dest || '#/sme/dashboard';
  render({ keepScroll:false });
  toast('Acting for ' + (target.tradingName || target.legalName) + '.', 'ok');
}

function rateBook(draft, cur, smeRec, dir) {
  const m = marginFor(smeRec, cur);
  draft.rate = { mode:'booked', refRate:currency(cur).refRate, margin:m, customerRate:customerRate(cur, dir === 'out' ? m : -m),
    bookedAt:nowISO(), expiresAt:new Date(Date.now() + 48 * 3600000).toISOString(), dealRef:null };
}
function dealModal(draft, cur, smeRec, dir) {
  const m = marginFor(smeRec, cur);
  const suggested = customerRate(cur, dir === 'out' ? m : -m);
  modal({ title:'FX deal reference', okLabel:'Apply deal', body:`
    <p style="font-size:var(--fs-sm);color:var(--muted);margin:0 0 14px">If you negotiated a rate with the treasury desk by phone, enter the deal reference and the agreed rate. It must be within 3% of the reference rate.</p>
    <div class="f"><label for="dref">FX deal reference</label><input id="dref" type="text" placeholder="e.g. FXD-2026-77412"></div>
    <div class="f" style="margin-top:12px"><label for="drate">Agreed rate (₹ per ${esc(cur)})</label>
      <input id="drate" type="number" step="0.0001" value="${suggested.toFixed(4)}"></div>`,
    onOk: () => {
      const ref = val('#dref'), rt = parseFloat(val('#drate'));
      if (!/^[A-Za-z0-9\-\/]{4,30}$/.test(ref)) { toast('Enter a deal reference of 4–30 letters, digits or dashes.', 'err'); return; }
      const refRate = currency(cur).refRate;
      if (!(rt > 0) || Math.abs(rt - refRate) / refRate > 0.03) { toast('The agreed rate must be within 3% of the reference rate ₹' + refRate + '.', 'err'); return; }
      draft.rate = { mode:'deal', refRate, margin:m, customerRate:rt, bookedAt:null, expiresAt:null, dealRef:ref };
      closeModal(); render(); toast('Deal reference applied.', 'ok');
    } });
}

/* Checklist modal used by makers when verifying. */
function verifyModal(title, items, cmd, id, intro) {
  modal({ title, okLabel:'Verify and send to checker', wide:true, body:`
    ${intro || ''}
    <div class="checks" style="gap:12px;margin-top:10px">${items.map(([k, l, sub]) => `
      <label class="chk"><input type="checkbox" data-vchk="${k}"><span>${esc(l)}<small>${esc(sub)}</small></span></label>`).join('')}</div>
    <button class="btn btn-link" type="button" data-act="vchk-all" style="margin-top:8px">Tick all</button>
    <div class="f" style="margin-top:14px"><label for="vnote">Note for the checker (optional)</label><textarea id="vnote" maxlength="500"></textarea></div>`,
    onOk: () => {
      const checks = {}; $$('[data-vchk]').forEach(x => { checks[x.dataset.vchk] = x.checked; });
      if (Object.values(checks).some(v => !v)) { toast('Complete every check before verifying.', 'err'); return; }
      run(cmd, { id, checks, note: val('#vnote') }, { after: () => closeModal() });
    } });
}

/* ---------- click handling ----------------------------------------------------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['button','submit'].includes(t.type))) return;

  /* generic */
  if (act === 'go')        { e.preventDefault(); location.hash = t.dataset.href; return; }
  if (act === 'logout')    { setSession(null); resetDrafts(); location.hash = '#/login'; render(); return; }
  if (act === 'reset-demo'){ resetDemo(); return; }
  if (act === 'nav-toggle'){ document.body.classList.toggle('nav-open'); return; }
  if (act === 'print')     { window.print(); return; }
  if (act === 'view-doc')  { modal({ title: t.dataset.n, body:`<div class="empty"><div class="ic">▤</div><h3>${esc(t.dataset.n)}</h3>
      <p>Only the file name and size are recorded in this demo, so there is nothing to display.</p></div>` }); return; }
  if (act === 'modal-close' || act === 'modal-dismiss') {
    if (act === 'modal-dismiss' && e.target !== t) return;
    closeModal(); return;
  }
  if (act === 'modal-ok') { const fn = modalOnOk; if (fn) fn(); return; }
  if (act === 'guide-open')  { GUIDE_OPEN = true; sessSet('ad2-guide-open', true); render(); return; }
  if (act === 'guide-close') { GUIDE_OPEN = false; sessSet('ad2-guide-open', null); render(); return; }
  if (act === 'guide-go')    { guideGo(+t.dataset.i); return; }
  if (act === 'guide-restart') { localSet(GUIDE_KEY, null); setSession(null); resetDrafts(); DRAFT = newDraft(); location.hash = '#/register'; render(); return; }
  if (act === 'notifications') { openNotifications(); return; }
  if (act === 'notif-open') { closeModal(); return; }
  if (act === 'vchk-all')   { $$('[data-vchk]').forEach(x => { x.checked = true; }); return; }

  /* documents */
  if (act === 'doc-pick')   { PICK = { scope:t.dataset.scope, id:t.dataset.id }; $('#file-pick').click(); return; }
  if (act === 'doc-sample') { attach(t.dataset.scope, t.dataset.id, { filename:`${t.dataset.id}-sample.pdf`, size:(120 + t.dataset.id.length * 23) + ' KB', type:'application/pdf', at:nowISO() }); return; }
  if (act === 'doc-del')    { const docs = draftDocs(t.dataset.scope); if (docs) { delete docs[t.dataset.id]; render(); } return; }

  /* sign-in */
  if (act === 'fill-login') {
    $('#li-domain').value = t.dataset.domain;
    $('#li-user').value = t.dataset.login;
    const own = !!t.dataset.own;
    $('#li-pass').value = own ? '' : (API.mode === 'local' || !API.passcodeRequired ? 'demo' : (sessGet('ad2-passcode') || ''));
    $('#li-pass').focus();
    return;
  }

  /* registration */
  if (act === 'ob-step')  { DRAFT.step = +t.dataset.i; render(); return; }
  if (act === 'ob-back')  { DRAFT.step = Math.max(0, DRAFT.step - 1); render(); return; }
  if (act === 'ob-next')  {
    if (DRAFT.step === 0 && !DRAFT.domainId) DRAFT.domainId = slugDomain(DRAFT.legalName);
    DRAFT.step = Math.min(7, DRAFT.step + 1); render(); return;
  }
  if (act === 'ob-sample') {
    const keep = { step:DRAFT.step, offline:DRAFT.offline };
    Object.assign(DRAFT, sampleBusiness(), keep, { loginId:'ADMIN' });
    if (!DRAFT.offline && API.mode === 'server') { DRAFT.password = 'Welcome2026'; DRAFT.password2 = 'Welcome2026'; }
    render();
    toast(API.mode === 'server' && !DRAFT.offline ? 'Sample filled. Sign-in: ' + DRAFT.domainId + ' / ADMIN, password Welcome2026.' : 'Sample business filled.', 'ok');
    return;
  }
  if (act === 'ob-bank-add') {
    modal({ title:'Add bank account', okLabel:'Add account', body:`
      <div class="grid g2 fields">
        <div class="f"><label for="nb-bank">Bank name</label><input id="nb-bank" type="text"></div>
        <div class="f"><label for="nb-branch">Branch</label><input id="nb-branch" type="text"></div>
        <div class="f"><label for="nb-acc">Account number</label><input id="nb-acc" type="text"></div>
        <div class="f"><label for="nb-ifsc">IFSC</label><input id="nb-ifsc" type="text" placeholder="HDFC0001234"></div>
        <div class="f"><label for="nb-cur">Currency</label><select id="nb-cur"><option>INR</option>
          ${DB.currencies.map(c => `<option>${c.code}</option>`).join('')}</select></div>
        <div class="f"><label for="nb-type">Account type</label><select id="nb-type"><option>Current</option><option>EEFC</option><option>Savings</option></select></div>
      </div>`,
      onOk: () => {
        const bank = val('#nb-bank'), accn = val('#nb-acc'), ifsc = val('#nb-ifsc').toUpperCase();
        if (!bank || !/^[A-Za-z0-9\-]{6,34}$/.test(accn)) { toast('Enter the bank name and a valid account number.', 'err'); return; }
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) { toast('IFSC must look like HDFC0001234.', 'err'); return; }
        DRAFT.banks.push({ bank, branch:val('#nb-branch'), accountNumber:accn, ifsc, currency:val('#nb-cur'), type:val('#nb-type'), verified:false });
        closeModal(); render(); toast('Account added. Verify it with PennyDrop.', 'ok');
      } });
    return;
  }
  if (act === 'ob-bank-del') { DRAFT.banks.splice(+t.dataset.i, 1); render(); return; }
  if (act === 'ob-penny') {
    const b = DRAFT.banks[+t.dataset.i];
    t.disabled = true; t.textContent = 'Verifying…';
    setTimeout(() => { b.verified = true; render(); toast('PennyDrop verified — ₹1.00 credited and name matched (simulated).', 'ok'); }, 700);
    return;
  }
  if (act === 'ob-submit') {
    const missing = onboardMissing(DRAFT);
    if (missing.length) {
      modal({ title:'Complete the application', body:`<ul style="margin:0 0 0 18px;font-size:var(--fs-md);line-height:1.8">
        ${missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` });
      return;
    }
    if (!$('#declare')?.checked) { toast('Tick the declaration before submitting.', 'err'); return; }
    const { step, offline, password, password2, loginId, ...application } = DRAFT;
    application.domainId = application.domainId.toUpperCase();
    const res = await run('onboarding.submit', { application, loginId, password: offline ? undefined : password }, { quiet:true, keepScroll:false });
    if (!res) return;
    setGuideTarget(res.smeId, res.domainId, res.loginId);
    DRAFT = null;
    if (offline) { toast(`Offline application ${res.smeId} captured.`, 'ok'); location.hash = '#/ad2/applications/' + res.smeId; return; }
    modal({ title:'Application submitted', okLabel:'Sign in and track it', body:`
      <div class="note note-ok"><span>Application <b>${esc(res.smeId)}</b> is with AD2. A maker reviews and prices it, then a checker approves it.</span></div>
      <div class="kv" style="margin-top:16px">
        <div><div class="k">Domain ID</div><div class="v">${esc(res.domainId)}</div></div>
        <div><div class="k">Login ID</div><div class="v">${esc(res.loginId)}</div></div>
      </div>
      <p style="font-size:var(--fs-sm);color:var(--muted);margin-top:14px">Sign in with the password you chose. The same sign-in opens trade services once you are approved.</p>`,
      onOk: async () => {
        try { await signIn(res.domainId, res.loginId, API.mode === 'server' ? password : 'demo'); closeModal(); afterSignIn('#/sme/dashboard'); }
        catch (err) { showError(err); }
      } });
    return;
  }
  if (act === 'ob-respond') {
    const response = val('#ap-resp');
    if (!response) { toast('Write a response first.', 'err'); return; }
    run('onboarding.respond', { response, iec: val('#ap-iec') || undefined });
    return;
  }
  if (act === 'offline-app') { resetDrafts(); DRAFT = newDraft(); location.hash = '#/register'; return; }

  /* beneficiaries */
  if (act === 'bene-sample') {
    const v = SAMPLE_SUPPLIERS[Math.floor(Math.random() * SAMPLE_SUPPLIERS.length)];
    Object.entries(v).forEach(([k, x]) => { const el = $('#bn-' + k); if (el) el.value = x; });
    return;
  }
  if (act === 'bene-new' || act === 'bene-edit') {
    const editing = act === 'bene-edit';
    const existing = editing ? (bene(OR_DRAFT.beneficiaryId) || { name:OR_DRAFT.beneficiary, country:OR_DRAFT.beneficiaryCountry,
        bank:OR_DRAFT.beneficiaryBank, bankCountry:OR_DRAFT.beneficiaryBankCountry, accountNumber:OR_DRAFT.beneficiaryAccount, swift:OR_DRAFT.swift }) : {};
    modal({ title: editing ? 'Beneficiary details' : 'Add a beneficiary', wide:true,
      okLabel: editing ? 'Use these details' : 'Add beneficiary',
      body: beneFormHTML(existing, { offerSave: !editing, sample: !editing }) + (editing ? `<div class="note note-info" style="margin-top:var(--s4)"><span>
          Changes here apply to this request only. Use Profile → Beneficiary master to change the saved record.</span></div>` : ''),
      onOk: async () => {
        const v = readBeneForm();
        if (!v.name || !v.country || !v.bank || !v.bankCountry || !v.accountNumber || !v.swift) { toast('Name, country, bank, bank country, account and SWIFT are required.', 'err'); return; }
        if (editing || !$('#bn-save')?.checked) { applyBeneToDraft(v, ''); closeModal(); render(); toast('Applied to this request only.'); return; }
        await run('beneficiary.add', { beneficiary:v }, { after: r => { applyBeneToDraft(v, r.id); closeModal(); } });
      } });
    return;
  }
  if (act === 'bene-clear') { applyBeneToDraft({ name:'', country:'', accountNumber:'', swift:'', bank:'', bankCountry:'' }, ''); render(); return; }
  if (act === 'bene-add-profile') {
    modal({ title:'Add a beneficiary', wide:true, okLabel:'Add beneficiary', body: beneFormHTML({}, { sample:true }),
      onOk: () => run('beneficiary.add', { beneficiary: readBeneForm() }, { after: () => closeModal() }) });
    return;
  }
  if (act === 'bene-del-profile') {
    const b = bene(t.dataset.id);
    commandModal({ title:'Remove beneficiary', okLabel:'Remove', okClass:'btn-danger', cmd:'beneficiary.remove',
      body:`<p style="font-size:var(--fs-md)">Remove <b>${esc(b.name)}</b>? Past payments keep the details they were sent with.</p>`,
      read: () => ({ id:b.id }) });
    return;
  }

  /* accounts */
  if (act === 'acct-add') {
    commandModal({ title:'Add bank account', okLabel:'Add account', cmd:'account.add', body:`
      <div class="grid g2 fields">
        <div class="f"><label for="ab">Bank name</label><input id="ab" type="text"></div>
        <div class="f"><label for="abr">Branch</label><input id="abr" type="text"></div>
        <div class="f"><label for="an">Account number</label><input id="an" type="text"></div>
        <div class="f"><label for="ai">IFSC</label><input id="ai" type="text" placeholder="HDFC0001234"></div>
        <div class="f"><label for="ac">Currency</label><select id="ac"><option>INR</option>${DB.currencies.map(c => `<option>${c.code}</option>`).join('')}</select></div>
        <div class="f"><label for="at">Type</label><select id="at"><option>Current</option><option>EEFC</option><option>Savings</option></select></div>
      </div>`,
      read: () => ({ account:{ bank:val('#ab'), branch:val('#abr'), accountNumber:val('#an'), ifsc:val('#ai'), currency:val('#ac'), type:val('#at') } }) });
    return;
  }
  if (act === 'penny') {
    t.disabled = true; t.textContent = 'Verifying…';
    setTimeout(() => run('account.verify', { id:t.dataset.id }), 600);
    return;
  }

  /* outward: draft */
  if (act === 'or-new') {
    if (isAD2() && !acting()) { t.dataset.dir = 'outward'; }
    else { OR_DRAFT = null; location.hash = '#/sme/outward/new'; render({ keepScroll:false }); return; }
  }
  if (act === 'or-product') {
    const p = product(t.dataset.id);
    OR_DRAFT.remittanceType = p.id;
    if (OR_DRAFT.purposeCode && !purposesFor(p.id).some(x => x.code === OR_DRAFT.purposeCode)) OR_DRAFT.purposeCode = '';
    if (p.purposes.length === 1) OR_DRAFT.purposeCode = p.purposes[0];
    if (p.id === 'DIR' && !OR_DRAFT.purposeCode) OR_DRAFT.purposeCode = 'S0102';
    if (p.id === 'AIR' && !OR_DRAFT.purposeCode) OR_DRAFT.purposeCode = 'S0101';
    OR_DRAFT.docs = {}; OR_DRAFT.purposeFilter = '';
    if (p.bills === 'none') OR_DRAFT.allocations = [];
    render(); toast(`${p.id} selected — ${purposesFor(p.id).length} purpose codes available.`); return;
  }
  if (act === 'or-alloc-max') {
    const b = bill(t.dataset.bill);
    const avail = Engine.billAvailable(DB, b, OR_DRAFT.id);
    const other = OR_DRAFT.allocations.filter(a => a.billId !== b.id).reduce((s, a) => s + a.amount, 0);
    const amt = Number(OR_DRAFT.amount) || 0;
    const use = amt ? Math.min(avail, Math.max(0, amt - other)) : avail;
    if (!amt) OR_DRAFT.amount = String(avail);
    if (!(use > 0)) { toast('Nothing left to allocate from the remittance amount.', 'err'); return; }
    OR_DRAFT.allocations = [...OR_DRAFT.allocations.filter(a => a.billId !== b.id), { billId:b.id, amount:+use.toFixed(2) }];
    if (!OR_DRAFT.beneficiary) toast('Bill allocated. Pick the supplier as the beneficiary.');
    render(); return;
  }
  if (act === 'or-book-rate') {
    if (!OR_DRAFT.currency) { toast('Select a currency first.', 'err'); return; }
    rateBook(OR_DRAFT, OR_DRAFT.currency, sme(OR_DRAFT.smeId), 'out');
    render(); toast('Rate booked and locked for 48 hours. Treasury notified.', 'ok'); return;
  }
  if (act === 'or-deal-ref') { if (!OR_DRAFT.currency) { toast('Select a currency first.', 'err'); return; } dealModal(OR_DRAFT, OR_DRAFT.currency, sme(OR_DRAFT.smeId), 'out'); return; }
  if (act === 'or-rate-clear') { OR_DRAFT.rate = RATE_NONE(); render(); return; }
  if (act === 'or-save') {
    run('outward.saveDraft', { draft: OR_DRAFT }, { after: r => { OR_DRAFT.id = r.id; } });
    return;
  }
  if (act === 'or-submit') {
    const missing = outwardMissing(OR_DRAFT);
    ['beneficiary','remittanceType','purposeCode','currency','amount','executionDate','debitAccountId'].forEach(k => markField(k, !!OR_DRAFT[k]));
    if (missing.length) {
      modal({ title:'Cannot submit yet', body:`<div class="note note-err"><span>Resolve the following before submitting:</span></div>
        <ul style="margin:14px 0 0 18px;font-size:var(--fs-md);line-height:1.8">${missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` });
      return;
    }
    run('outward.submit', { draft: OR_DRAFT }, { keepScroll:false, after: r => { OR_DRAFT = null; location.hash = '#/sme/outward/' + r.id; } });
    return;
  }
  if (act === 'or-continue') { OR_DRAFT = newOutwardDraft(outwardRec(t.dataset.id)); location.hash = '#/sme/outward/new'; return; }
  if (act === 'or-discard') {
    commandModal({ title:'Discard draft', okLabel:'Discard', okClass:'btn-danger', cmd:'outward.discardDraft',
      body:`<p style="font-size:var(--fs-md)">Discard draft ${esc(t.dataset.id)}? This cannot be undone.</p>`,
      read: () => ({ id:t.dataset.id }), after: () => { location.hash = '#/sme/outward'; } });
    return;
  }

  /* outward: approval chain */
  if (act === 'or-verify') {
    const o = outwardRec(t.dataset.id);
    verifyModal('Verify ' + o.id, [
      ['documents', 'Documents match the policy for ' + o.remittanceType + ' / ' + o.purposeCode, 'Every required document is on file and consistent with the amount and parties.'],
      ['sanctions', 'Sanctions and negative-list screening clear', `${o.beneficiary}, ${o.beneficiaryBank} and ${o.beneficiaryCountry} screened — no match (simulated).`],
      ['purpose', 'Purpose code is correct for the underlying transaction', purposeLabel(o.purposeCode)],
      ['beneficiary', 'Beneficiary and bank details verified', `${o.beneficiaryAccount} · ${o.swift}`],
    ], 'outward.verify', o.id, `<p style="font-size:var(--fs-md);margin:0">${money(o.amount, o.currency)} to ${esc(o.beneficiary)} for ${esc(sme(o.smeId)?.tradingName || '')}.</p>`);
    return;
  }
  if (act === 'or-authorise') {
    const o = outwardRec(t.dataset.id);
    commandModal({ title:'Authorise ' + o.id, okLabel:'Authorise payment', cmd:'outward.authorise', read: () => ({ id:o.id }), body:`
      <div class="kv">
        <div><div class="k">Pay</div><div class="v big">${money(o.amount, o.currency)}</div></div>
        <div><div class="k">To</div><div class="v">${esc(o.beneficiary)}<br><small>${esc(o.beneficiaryBank)} · ${esc(o.swift)}</small></div></div>
        <div><div class="k">Product / purpose</div><div class="v">${esc(o.remittanceType)} · ${esc(o.purposeCode)}</div></div>
        <div><div class="k">INR debit</div><div class="v">${inr(o.debitInr)}</div></div>
        <div class="span2"><div class="k">Verified by</div><div class="v">${esc(o.wf?.verified?.by || '')} · ${dmyt(o.wf?.verified?.at)}${o.wf?.verified?.note ? '<br><i>' + esc(o.wf.verified.note) + '</i>' : ''}</div></div>
      </div>
      <p style="font-size:var(--fs-sm);color:var(--muted);margin-top:14px">Operations releases the payment once you authorise it.</p>` });
    return;
  }
  if (act === 'or-execute') {
    const o = outwardRec(t.dataset.id), a = acct(o.debitAccountId);
    const short = a && a.balance < o.debitInr;
    commandModal({ title:'Release payment ' + o.id, okLabel:'Release over SWIFT', cmd:'outward.execute', read: () => ({ id:o.id }), body:`
      <div class="kv">
        <div><div class="k">Amount</div><div class="v big">${money(o.amount, o.currency)}</div></div>
        <div><div class="k">Beneficiary</div><div class="v">${esc(o.beneficiary)}<br><small>${esc(o.swift)}</small></div></div>
        <div><div class="k">Debit</div><div class="v">${inr(o.debitInr)}</div></div>
        <div><div class="k">From</div><div class="v">${a ? esc(a.bank + ' ' + a.accountNumber) : '—'}<br><small>Balance ${a ? inr(a.balance) : '—'}</small></div></div>
      </div>
      ${short ? `<div class="note note-err" style="margin-top:14px"><span>The account balance is below the debit amount. Release will be refused.</span></div>` : ''}
      <p style="font-size:var(--fs-sm);color:var(--muted);margin-top:14px">Releasing debits the account, generates the UTR and sends the MT103 (simulated). Linked bills are settled.</p>`,
      after: () => setTimeout(() => showAdvice(o.id), 80) });
    return;
  }
  if (act === 'or-query')  { commandModal({ title:'Raise a query', okLabel:'Send query', cmd:'outward.query',
      body: reason('What do you need from the SME?', 'The request returns to the SME and must be verified again after they respond.'),
      read: () => ({ id:t.dataset.id, question: needText('#why', 'Enter the query.') }) }); return; }
  if (act === 'or-reject') { commandModal({ title:'Reject request', okLabel:'Reject', okClass:'btn-danger', cmd:'outward.reject',
      body: reason('Reason for rejection', 'Shown to the SME. Any bill reservation is released.'),
      read: () => ({ id:t.dataset.id, reason: needText('#why', 'A reason is required.') }) }); return; }
  if (act === 'or-advice') { showAdvice(t.dataset.id); return; }
  if (act === 'or-mt103')  { const o = outwardRec(t.dataset.id);
    modal({ title:'SWIFT MT103 — ' + (o.utr || o.id), wide:true, printable:true, body:`<pre class="mt">${esc(mt103(o))}</pre>
      <p style="font-size:var(--fs-xs);color:var(--muted)">Simulated message — not sent to any network.</p>` }); return; }
  if (act === 'or-respond') {
    if (!RESP || !RESP.text.trim()) { toast('Write a response first.', 'err'); return; }
    run('outward.respond', { id:t.dataset.id, response:RESP.text, docs:RESP.docs }, { after: () => { RESP = null; } });
    return;
  }
  if (act === 'note-add') {
    const text = val('#note-text');
    if (!text) { toast('Write the note first.', 'err'); return; }
    run('note.add', { kind:t.dataset.kind, id:t.dataset.id, text });
    return;
  }

  /* inward and disposal */
  if (act === 'in-record')  { recordInwardModal(); return; }
  if (act === 'ri-suggest') { riSuggest(); return; }
  if (act === 'in-tab')     { inTab = t.dataset.t; render(); return; }
  if (act === 'di-alloc-max') {
    const b = bill(t.dataset.bill), i = inwardRec(DI_DRAFT.inwardId);
    const other = DI_DRAFT.allocations.filter(a => a.billId !== b.id).reduce((s, a) => s + a.amount, 0);
    const use = Math.min(Engine.billAvailable(DB, b), i.available - other);
    if (!(use > 0)) { toast('Nothing left on the receipt to apply.', 'err'); return; }
    DI_DRAFT.allocations = [...DI_DRAFT.allocations.filter(a => a.billId !== b.id), { billId:b.id, amount:+use.toFixed(2) }];
    render(); return;
  }
  if (act === 'di-book-rate') { const i = inwardRec(DI_DRAFT.inwardId); rateBook(DI_DRAFT, i.currency, sme(i.smeId), 'in'); render(); toast('Rate booked and locked for 48 hours. Treasury notified.', 'ok'); return; }
  if (act === 'di-deal-ref')  { const i = inwardRec(DI_DRAFT.inwardId); dealModal(DI_DRAFT, i.currency, sme(i.smeId), 'in'); return; }
  if (act === 'di-rate-clear'){ DI_DRAFT.rate = RATE_NONE(); render(); return; }
  if (act === 'di-submit') {
    const d = DI_DRAFT, errs = [];
    if (!d.allocations.length) errs.push('Apply the receipt to at least one export bill.');
    if (!d.creditAccountId) errs.push('Select an account to credit.');
    if (d.rate.mode === 'none') errs.push('Book a rate or enter an FX deal reference.');
    checklistFor('TRADE', '', 0).filter(x => x.required && !d.docs[x.id]).forEach(x => errs.push('Upload: ' + x.name));
    if (errs.length) { modal({ title:'Cannot submit yet', body:`<ul style="margin:0 0 0 18px;font-size:var(--fs-md);line-height:1.8">${errs.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` }); return; }
    run('disposal.submit', { draft:d }, { keepScroll:false, after: r => { DI_DRAFT = null; location.hash = '#/sme/disposals/' + r.id; } });
    return;
  }
  if (act === 'di-verify') {
    const d = disposalRec(t.dataset.id);
    verifyModal('Verify ' + d.id, [
      ['documents', 'TRADE documents on file and consistent', 'Disposal instruction letter, commercial export invoice and shipping bill.'],
      ['bills', 'Receipt matches the export bills applied', d.allocations.map(a => `${a.billId} ${money(a.amount, d.currency)}`).join(', ')],
      ['account', 'Credit account belongs to the exporter', acct(d.creditAccountId)?.accountNumber || ''],
    ], 'disposal.verify', d.id);
    return;
  }
  if (act === 'di-authorise') {
    const d = disposalRec(t.dataset.id);
    commandModal({ title:'Authorise ' + d.id, okLabel:'Authorise', cmd:'disposal.authorise', read: () => ({ id:d.id }), body:`
      <p style="font-size:var(--fs-md)">Authorise the disposal of <b>${money(d.amount, d.currency)}</b> against ${esc(d.allocations.map(a => a.billId).join(', '))},
        crediting ${inr(d.creditInr || d.amount * d.rate.customerRate)}?</p>
      <p style="font-size:var(--fs-sm);color:var(--muted)">Verified by ${esc(d.wf?.verified?.by || '')} · ${dmyt(d.wf?.verified?.at)}.</p>` });
    return;
  }
  if (act === 'di-process') {
    const d = disposalRec(t.dataset.id);
    commandModal({ title:'Process ' + d.id, okLabel:'Credit and issue FIRC', cmd:'disposal.process', read: () => ({ id:d.id }), body:`
      <p style="font-size:var(--fs-md)">Credit <b>${inr(d.amount * d.rate.customerRate)}</b> to ${esc(acct(d.creditAccountId)?.bank + ' ' + acct(d.creditAccountId)?.accountNumber)},
        knock off the export bills and issue the FIRC?</p>`,
      after: () => setTimeout(() => showFirc(d.id), 80) });
    return;
  }
  if (act === 'di-query')  { commandModal({ title:'Raise a query', okLabel:'Send query', cmd:'disposal.query', body: reason('What do you need from the SME?'),
      read: () => ({ id:t.dataset.id, question: needText('#why', 'Enter the query.') }) }); return; }
  if (act === 'di-reject') { commandModal({ title:'Reject instruction', okLabel:'Reject', okClass:'btn-danger', cmd:'disposal.reject',
      body: reason('Reason for rejection', 'The amount becomes available on the receipt again.'),
      read: () => ({ id:t.dataset.id, reason: needText('#why', 'A reason is required.') }) }); return; }
  if (act === 'di-firc')   { showFirc(t.dataset.id); return; }
  if (act === 'di-respond') {
    if (!RESP || !RESP.text.trim()) { toast('Write a response first.', 'err'); return; }
    run('disposal.respond', { id:t.dataset.id, response:RESP.text, docs:RESP.docs }, { after: () => { RESP = null; } });
    return;
  }

  /* bills */
  if (act === 'bill-tab')    { billTab = t.dataset.t; render(); return; }
  if (act === 'bill-review') { billReview = t.dataset.t; render(); return; }
  if (act === 'bill-clear')  { BILL_DRAFT = null; render(); return; }
  if (act === 'bill-accept') { run('bill.accept', { id:t.dataset.id }); return; }
  if (act === 'bill-query')  { commandModal({ title:'Query bill ' + t.dataset.id, okLabel:'Send query', cmd:'bill.query', body: reason('What needs correcting?'),
      read: () => ({ id:t.dataset.id, question: needText('#why', 'Enter the query.') }) }); return; }
  if (act === 'bill-respond') {
    const b = bill(t.dataset.id);
    commandModal({ title:'Respond on ' + b.id, okLabel:'Resubmit', cmd:'bill.respond', body:`
      <div class="note note-warn" style="margin-bottom:14px"><span>${esc(b.query?.question || '')}</span></div>
      <div class="f"><label for="br-ref">${b.type === 'Export' ? 'Shipping bill' : 'Bill of Entry'} number</label><input id="br-ref" type="text" value="${esc(b.shipmentRef || '')}"></div>
      <div class="f" style="margin-top:12px"><label for="why">Response</label><textarea id="why"></textarea></div>`,
      read: () => ({ id:b.id, response: needText('#why', 'Enter a response.'), shipmentRef: val('#br-ref') || undefined }) });
    return;
  }
  if (act === 'bill-ai') {
    const type = t.dataset.type, me = sme(ctxSmeId());
    t.disabled = true; t.textContent = 'Extracting…';
    setTimeout(() => {
      const n = Math.floor(1000 + Math.random() * 8999);
      const cur = (me.config.currencies.includes('EUR') ? 'EUR' : me.config.currencies[0]);
      const supplier = smeBenes(me.id).find(b => !b.currency || b.currency === cur) || smeBenes(me.id)[0];
      const inv = new Date(Date.now() - 12 * 86400000).toISOString().slice(0, 10);
      const due = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
      const sample = type === 'Export'
        ? { invoiceNumber:`EXP/2026/${n}`, invoiceDate:inv, counterparty:'Lederhaus Handels GmbH', counterpartyCountry:'Germany',
            currency:cur, amount:String(28000 + (n % 50) * 100), dueDate:due, orderRef:`PO-LH-${n}`, shipmentRef:`SB-23${n}` }
        : { invoiceNumber:`SUP-${n}`, invoiceDate:inv, counterparty: supplier ? supplier.name : 'Werkzeugbau Kessler GmbH',
            counterpartyCountry: supplier ? supplier.country : 'Germany', currency: supplier?.currency && me.config.currencies.includes(supplier.currency) ? supplier.currency : cur,
            amount:String(42000 + (n % 40) * 100), dueDate:due, orderRef:`PO-${n}`, shipmentRef:`BOE-77${n}` };
      BILL_DRAFT = { type, ...sample, docs:{}, extracted:{ invoiceNumber:0.97, invoiceDate:0.94, counterparty:0.91,
        counterpartyCountry:0.88, currency:0.99, amount:0.96, dueDate:0.72, orderRef:0.81, shipmentRef:0.69 } };
      render();
      toast('Invoice read. Check the highlighted fields before lodging.', 'ok');
    }, 900);
    return;
  }
  if (act === 'bill-save') {
    const d = BILL_DRAFT, type = t.dataset.type;
    const req = ['invoiceNumber','invoiceDate','counterparty','counterpartyCountry','currency','amount','dueDate'];
    let ok = true; req.forEach(k => { const good = !!d[k]; markField(k, good); if (!good) ok = false; });
    if (!ok) { toast('Complete the required fields.', 'err'); return; }
    const { extracted, docs, type:_t, ...b } = d;
    run('bill.lodge', { type, bill:b, source: extracted ? 'Document AI' : 'Form fill' }, { after: () => { BILL_DRAFT = null; billTab = 'register'; } });
    return;
  }
  if (act === 'csv-template') {
    csvDownload('bill-template.csv', [
      ['invoice_number','invoice_date','counterparty','country','currency','amount','due_date','order_ref','shipment_ref'],
      ['INV-0001','2026-09-01','Example Counterparty','Germany','EUR','10000.00','2026-12-01','PO-1234','SB-000001']]);
    return;
  }
  if (act === 'csv-sample') {
    const me = sme(ctxSmeId()), cur = me.config.currencies[0], n = Math.floor(100 + Math.random() * 899);
    $('#csvbox').value =
`invoice_number,invoice_date,counterparty,country,currency,amount,due_date,order_ref,shipment_ref
CSV/${n}/01,2026-09-15,Halden Trading AS,Norway,${cur},18400.00,2026-12-14,PO-H-${n},REF-${n}1
CSV/${n}/02,2026-09-16,Porto Mercantil Lda,Portugal,${cur},22750.00,2026-12-15,PO-P-${n},REF-${n}2
CSV/${n}/01,2026-09-17,Duplicate Row Ltd,France,${cur},9000.00,2026-12-16,PO-D-${n},REF-${n}3
BAD/${n},2026-09-18,Missing Currency Ltd,France,,15000.00,2026-12-20,PO-X,`;
    return;
  }
  if (act === 'csv-file') { $('#csv-pick').click(); return; }
  if (act === 'csv-validate') {
    const type = t.dataset.type;
    const text = ($('#csvbox').value || '').trim();
    if (!text) { toast('Paste or load some rows first.', 'err'); return; }
    const me = sme(ctxSmeId());
    const seen = new Set();
    const rows = text.split(/\r?\n/).filter(Boolean).slice(1, 201).map((l, idx) => {
      const c = l.split(',').map(x => x.trim());
      const rec = { line: idx + 2, invoiceNumber:c[0], invoiceDate:c[1], counterparty:c[2], counterpartyCountry:c[3],
                    currency:c[4], amount:c[5], dueDate:c[6], orderRef:c[7] || '', shipmentRef:c[8] || '' };
      const errs = [];
      if (!rec.invoiceNumber) errs.push('invoice number missing');
      if (!rec.currency) errs.push('currency missing');
      else if (!availableCurrencies(me).includes(rec.currency)) errs.push(`currency ${rec.currency} is not enabled`);
      if (!rec.counterpartyCountry) errs.push('country missing');
      if (!(Number(rec.amount) > 0)) errs.push('amount invalid');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.invoiceDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(rec.dueDate || '')) errs.push('dates must be YYYY-MM-DD');
      if (DB.bills.some(b => b.smeId === me.id && b.invoiceNumber === rec.invoiceNumber) || seen.has(rec.invoiceNumber)) errs.push('duplicate invoice number');
      seen.add(rec.invoiceNumber);
      rec.errs = errs; return rec;
    });
    const good = rows.filter(r => !r.errs.length), bad = rows.filter(r => r.errs.length);
    CSV_ROWS = { good, bad };
    $('#csv-preview').innerHTML = `
      <div class="note ${bad.length ? 'note-warn' : 'note-ok'}" style="margin-bottom:14px"><span>
        ${plural(good.length, 'row')} ready, ${bad.length} with errors. ${bad.length ? 'Failed rows are kept for download and correction.' : ''}</span></div>
      <div class="tablewrap"><table class="dt">
        <thead><tr><th>Line</th><th>Invoice</th><th>Counterparty</th><th>Currency</th><th class="num">Amount</th><th>Result</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r.line}</td><td>${esc(r.invoiceNumber || '—')}</td>
          <td>${esc(r.counterparty || '—')}</td><td>${esc(r.currency || '—')}</td><td class="num">${esc(r.amount || '—')}</td>
          <td>${r.errs.length ? `<span class="badge b-red">${esc(r.errs.join('; '))}</span>` : '<span class="badge b-green">Valid</span>'}</td></tr>`).join('')}</tbody>
      </table></div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-primary" type="button" data-act="csv-confirm" data-type="${type}" ${good.length ? '' : 'disabled'}>Lodge ${plural(good.length, 'row')}</button>
        ${bad.length ? `<button class="btn btn-plain" type="button" data-act="csv-errors">Download failed rows</button>` : ''}
      </div>`;
    return;
  }
  if (act === 'csv-errors') {
    csvDownload('failed-rows.csv', [['line','invoice_number','counterparty','currency','amount','errors'],
      ...CSV_ROWS.bad.map(r => [r.line, r.invoiceNumber, r.counterparty, r.currency, r.amount, r.errs.join('; ')])]);
    return;
  }
  if (act === 'csv-confirm') {
    const rows = CSV_ROWS.good.map(({ errs, ...r }) => r);
    run('bill.lodgeBatch', { type:t.dataset.type, rows }, { after: () => { billTab = 'register'; CSV_ROWS = { good:[], bad:[] }; } });
    return;
  }
  if (act === 'job-retry') { run('job.retry', { id:t.dataset.id }); return; }

  /* knock-off and reconciliation */
  if (act === 'ko-suggest') {
    const smeId = ctxSmeId();
    const bills = DB.bills.filter(b => b.smeId === smeId && b.type === KO.side && b.review === 'Accepted' && Engine.billAvailable(DB, b) > 0);
    const rems = koEligible(KO.side, smeId);
    const found = [];
    bills.forEach(b => {
      const m = rems.find(r => r.cur === b.currency && r.party === b.counterparty && !found.some(f => f.remId === r.id));
      if (m) found.push({ billId:b.id, remId:m.id, amount:+Math.min(Engine.billAvailable(DB, b), m.left).toFixed(2) });
    });
    if (!found.length) { toast('No matches on currency and counterparty. Add one manually below.'); return; }
    KO.allocations = found; render();
    toast(`${plural(found.length, 'match', 'matches')} proposed. Check them, then submit.`, 'ok');
    return;
  }
  if (act === 'ko-add') {
    const billId = val('#ko-bill'), remId = val('#ko-rem'), amount = Number(val('#ko-amt'));
    if (!billId || !remId || !(amount > 0)) { toast('Choose a bill, a remittance and an amount.', 'err'); return; }
    KO.allocations = [...KO.allocations.filter(a => !(a.billId === billId && a.remId === remId)), { billId, remId, amount }];
    render(); return;
  }
  if (act === 'ko-clear')  { KO.allocations = []; render(); return; }
  if (act === 'ko-remove') { KO.allocations.splice(+t.dataset.i, 1); render(); return; }
  if (act === 'ko-submit') { run('knockoff.propose', { side:KO.side, items:KO.allocations }, { after: () => { KO.allocations = []; } }); return; }
  if (act === 'rec-tab')     { recTab = t.dataset.t; render(); return; }
  if (act === 'rec-confirm') { run('recon.confirm', { id:t.dataset.id }); return; }
  if (act === 'rec-reject')  { commandModal({ title:'Reject allocation', okLabel:'Reject', okClass:'btn-danger', cmd:'recon.reject', body: reason('Reason'),
      read: () => ({ id:t.dataset.id, reason: needText('#why', 'A reason is required.') }) }); return; }
  if (act === 'rec-reverse') { commandModal({ title:'Reverse allocation', okLabel:'Reverse', okClass:'btn-danger', cmd:'recon.reverse',
      body: reason('Reason for reversal', 'The bill becomes outstanding again. Money already moved is not reversed.'),
      read: () => ({ id:t.dataset.id, reason: needText('#why', 'A reason is required.') }) }); return; }

  /* onboarding review */
  if (act === 'rv-charge-add') {
    modal({ title:'Add charge', okLabel:'Add', body:`
      <div class="grid g2 fields">
        <div class="f"><label for="ch-name">Charge</label><select id="ch-name">${DB.chargeCategories.map(c => `<option>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="f"><label for="ch-basis">Basis</label><select id="ch-basis"><option>Fixed</option><option>Percentage</option></select></div>
        <div class="f"><label for="ch-val">Value</label><input id="ch-val" type="number" step="0.01" value="500"></div>
        <div class="f"><label for="ch-cur">Currency</label><select id="ch-cur"><option>INR</option></select></div>
        <div class="f span2"><label for="ch-freq">Applied</label><select id="ch-freq"><option>Per transaction</option><option>Per document set</option><option>Monthly</option></select></div>
      </div>`,
      onOk: () => {
        const v = parseFloat(val('#ch-val'));
        if (isNaN(v) || v < 0) { toast('Enter a value, including zero.', 'err'); return; }
        REVIEW.charges.push({ name:val('#ch-name'), basis:val('#ch-basis'), value:v, currency:val('#ch-cur'), frequency:val('#ch-freq') });
        closeModal(); render();
      } });
    return;
  }
  if (act === 'rv-charge-del') { REVIEW.charges.splice(+t.dataset.i, 1); render(); return; }
  if (act === 'rv-save')   { run('onboarding.review', { smeId:t.dataset.id, config:REVIEW, submit:false }); return; }
  if (act === 'rv-submit') { run('onboarding.review', { smeId:t.dataset.id, config:REVIEW, submit:true }, { after: () => { REVIEW = null; } }); return; }
  if (act === 'rv-approve') {
    const s = sme(t.dataset.id), c = s.pendingConfig || REVIEW;
    commandModal({ title:'Approve ' + (s.tradingName || s.legalName), okLabel:'Approve', cmd:'onboarding.approve', read: () => ({ smeId:s.id }),
      after: () => { REVIEW = null; }, body:`
      <p style="font-size:var(--fs-md)">Approve with <b>${esc(c.permission)}</b> permission on ${esc(c.currencies.join(', '))}, effective ${dmy(c.effectiveDate)}?</p>
      <p style="font-size:var(--fs-sm);color:var(--muted)">The applicant's sign-in becomes an SME User and the pricing goes live immediately.</p>` });
    return;
  }
  if (act === 'rv-return')  { commandModal({ title:'Return to maker', okLabel:'Return', cmd:'onboarding.return', body: reason('What should the maker change?'),
      read: () => ({ smeId:t.dataset.id, note: needText('#why', 'A reason is required.') }), after: () => { REVIEW = null; } }); return; }
  if (act === 'rv-clarify') { commandModal({ title:'Request clarification', okLabel:'Send', cmd:'onboarding.clarify', body: reason('What is needed from the applicant?'),
      read: () => ({ smeId:t.dataset.id, question: needText('#why', 'Enter what is needed.') }) }); return; }
  if (act === 'rv-reject')  { commandModal({ title:'Reject application', okLabel:'Reject', okClass:'btn-danger', cmd:'onboarding.reject', body: reason('Reason for rejection'),
      read: () => ({ smeId:t.dataset.id, reason: needText('#why', 'A reason is required.') }) }); return; }

  /* assisted journey */
  if (act === 'or-new' || act === 'assist-pick') {
    const dir = t.dataset.dir || 'outward';
    const pool = DB.smes.filter(x => x.status === 'Approved' && (dir === 'outward' ? perm(x).importSide : perm(x).exportSide));
    if (!pool.length) { toast('No approved SME has the permission for this.', 'err'); return; }
    modal({ title: dir === 'outward' ? 'New outward request for an SME' : 'Disposal instruction for an SME', wide:true, body:`
      <p style="font-size:var(--fs-md);margin:0 0 16px">Pick the SME you are acting for. What you submit is recorded as raised by you on their behalf,
        and another maker verifies it.</p>
      <div class="tablewrap"><table class="dt">
        <thead><tr><th>SME</th><th>Permission</th><th>Currencies</th><th class="num">${dir === 'outward' ? 'Open import bills' : 'Receipts to dispose'}</th><th></th></tr></thead>
        <tbody>${pool.map(x => {
          const n = dir === 'outward' ? DB.bills.filter(b => b.smeId === x.id && b.type === 'Import' && b.outstanding > 0 && b.review === 'Accepted').length
                                      : DB.inward.filter(i => i.smeId === x.id && i.available > 0).length;
          return `<tr><td><b>${esc(x.tradingName || x.legalName)}</b><br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(x.id)}</span></td>
            <td>${esc(x.config.permission)}</td><td>${x.config.currencies.join(' · ')}</td><td class="num">${n}</td>
            <td><button class="btn btn-ghost btn-sm" type="button" data-act="assist-go" data-id="${x.id}" data-dest="${dir === 'outward' ? '#/sme/outward/new' : '#/sme/inward'}">Act for them</button></td></tr>`;
        }).join('')}</tbody></table></div>` });
    return;
  }
  if (act === 'assist-dispose') { const rec = inwardRec(t.dataset.id); if (rec) startAssist(rec.smeId, '#/sme/inward/' + rec.id + '/dispose'); return; }
  if (act === 'assist-go')      { startAssist(t.dataset.id, t.dataset.dest); return; }
  if (act === 'assist-start') {
    const target = sme(t.dataset.id);
    const pm = perm(target);
    modal({ title:'Act on behalf of ' + (target.tradingName || target.legalName), body:`
      <p style="font-size:var(--fs-md)">Choose what you are raising. It is recorded as raised by you on their behalf, and the audit trail names both parties.</p>
      <div style="display:grid;gap:8px;margin-top:16px">
        ${pm.importSide ? `<button class="btn btn-primary" type="button" data-act="assist-go" data-id="${target.id}" data-dest="#/sme/outward/new">New outward request</button>` : ''}
        ${pm.exportSide ? `<button class="btn btn-primary" type="button" data-act="assist-go" data-id="${target.id}" data-dest="#/sme/inward">Inward remittances and disposal</button>` : ''}
        <button class="btn btn-ghost" type="button" data-act="assist-go" data-id="${target.id}" data-dest="#/sme/bills/${pm.exportSide ? 'export' : 'import'}">Bill lodgement</button>
        <button class="btn btn-plain" type="button" data-act="assist-go" data-id="${target.id}" data-dest="#/sme/dashboard">Open their whole portal</button>
      </div>` });
    return;
  }
  if (act === 'assist-exit') {
    const was = sme(S.actingFor)?.tradingName || '';
    setSession({ ...S, actingFor:null }); resetDrafts();
    location.hash = '#/ad2/directory';
    toast('Left the assisted journey' + (was ? ' for ' + was : '') + '.');
    return;
  }

  /* lists, reports, admin */
  if (act === 'out-tab')      { outTab = t.dataset.t; render(); return; }
  if (act === 'admin-tab')    { adminTab = t.dataset.t; render(); return; }
  if (act === 'admin-product'){ adminProduct = t.dataset.id; render(); return; }
  if (act === 'report-reset') { reportCur = ''; render(); return; }
  if (act === 'export-report') { const { cols, rows } = reportRows(reportId); csvDownload(reportId + '-report.csv', [cols, ...rows]); return; }
  if (act === 'export-csv') {
    const what = t.dataset.what;
    if (what === 'outward') {
      const list = scoped() ? DB.outward.filter(o => o.smeId === ctxSmeId()) : DB.outward;
      csvDownload('outward-requests.csv', [['Request','SME','Beneficiary','Product','Purpose','Currency','Amount','Status','Requested','UTR'],
        ...list.map(o => [o.id, sme(o.smeId)?.tradingName || '', o.beneficiary, o.remittanceType, o.purposeCode, o.currency, o.amount, o.status, o.requestDate, o.utr || ''])]);
    } else if (what === 'inward') {
      const list = scoped() ? DB.inward.filter(i => i.smeId === ctxSmeId()) : DB.inward;
      csvDownload('inward-remittances.csv', [['Reference','SME','Remitter','Currency','Amount','Available','Status','Value date','FIRC'],
        ...list.map(i => [i.reference, sme(i.smeId)?.tradingName || '', i.remitter, i.currency, i.amount, i.available, i.status, i.valueDate, i.firc || ''])]);
    } else {
      const list = DB.bills.filter(b => !scoped() || b.smeId === ctxSmeId());
      csvDownload('bills.csv', [['Bill','SME','Type','Invoice','Counterparty','Currency','Original','Adjusted','Outstanding','Due','Review','Settlement'],
        ...list.map(b => [b.id, sme(b.smeId)?.tradingName || '', b.type, b.invoiceNumber, b.counterparty, b.currency, b.amount, b.adjusted, b.outstanding, b.dueDate, b.review, b.settlement])]);
    }
    return;
  }
});

let CSV_ROWS = { good:[], bad:[] };

function showAdvice(id) {
  const o = outwardRec(id);
  if (!o || o.status !== 'Completed') return;
  modal({ title:'Payment advice — ' + o.id, wide:true, printable:true, body: adviceHTML(o) +
    `<h3 style="font-size:var(--fs-sm);margin:18px 0 8px">SWIFT MT103</h3><pre class="mt">${esc(mt103(o))}</pre>` });
}
function showFirc(id) {
  const d = disposalRec(id);
  if (!d || d.status !== 'Processed') return;
  modal({ title:'FIRC and credit advice — ' + d.firc, wide:true, printable:true, body: fircHTML(d) });
}

/* ---------- forms ----------------------------------------------------------------- */
document.addEventListener('submit', async e => {
  const f = e.target.closest('[data-act]');
  if (!f) return;
  e.preventDefault();
  if (f.dataset.act === 'do-login') {
    const domain = val('#li-domain').toUpperCase(), login = val('#li-user').toUpperCase(), pass = $('#li-pass').value;
    if (!domain || !login || !pass) { toast('Enter Domain ID, Login ID and password.', 'err'); return; }
    try {
      await signIn(domain, login, pass);
      resetDrafts();
      toast('Signed in as ' + S.role + '.', 'ok');
      afterSignIn();
    } catch (err) { showError(err); }
  }
  if (f.dataset.act === 'status-lookup') {
    STATUS_Q = { app: val('#st-app').toUpperCase(), domain: val('#st-dom').toUpperCase(), result:null, error:'' };
    if (!STATUS_Q.app || !STATUS_Q.domain) { STATUS_Q.error = 'Enter both the Application ID and the Domain ID.'; render(); return; }
    try {
      if (API.mode === 'local') STATUS_Q.result = Engine.publicStatus(LOCAL, STATUS_Q.app, STATUS_Q.domain);
      else STATUS_Q.result = (await http('/api/status?app=' + encodeURIComponent(STATUS_Q.app) + '&domain=' + encodeURIComponent(STATUS_Q.domain))).application;
      if (!STATUS_Q.result) STATUS_Q.error = 'No application matches that Application ID and Domain ID.';
    } catch (err) { STATUS_Q.error = err.message; }
    render();
  }
});

/* ---------- change events ------------------------------------------------------------ */
document.addEventListener('change', e => {
  const t = e.target;

  if (t.id === 'file-pick') {
    const file = t.files && t.files[0];
    t.value = '';
    if (!file || !PICK) return;
    if (file.size > 10 * 1048576) { toast('That file is larger than 10 MB.', 'err'); return; }
    attach(PICK.scope, PICK.id, { filename:file.name.slice(0, 120), size:kb(file.size), type:file.type || 'application/octet-stream', at:nowISO() });
    PICK = null;
    return;
  }
  if (t.id === 'csv-pick') {
    const file = t.files && t.files[0];
    t.value = '';
    if (!file) return;
    if (file.size > 512 * 1024) { toast('CSV files up to 512 KB only.', 'err'); return; }
    file.text().then(txt => { $('#csvbox').value = txt; toast('Loaded ' + file.name + '. Validate the rows next.', 'ok'); });
    return;
  }

  if (t.dataset.act === 'switch-role') {
    const [d, l] = t.value.split('|');
    switchTo(d, l).then(ok => { if (ok) toast('Switched to ' + S.role + (S.name ? ' — ' + S.name : '') + '.'); else render(); });
    return;
  }

  /* registration fields */
  if (t.dataset.k) {
    const k = t.dataset.k;
    if (k === 'requestedCurrencies') {
      const set = new Set(DRAFT.requestedCurrencies);
      t.checked ? set.add(t.value) : set.delete(t.value);
      DRAFT.requestedCurrencies = [...set];
    } else {
      DRAFT[k] = ['domainId','loginId','pan','gstin','iec'].includes(k) ? t.value.trim().toUpperCase() : t.value;
      if (k === 'legalName' && !DRAFT.domainId) DRAFT.domainId = slugDomain(t.value);
    }
    return;
  }

  if (t.dataset.act === 'bene-pick') {
    const v = t.value;
    if (!v) { applyBeneToDraft({ name:'', country:'', accountNumber:'', swift:'', bank:'', bankCountry:'' }, ''); render(); return; }
    if (v === '__oneoff') return;
    const b = bene(v);
    if (b) {
      applyBeneToDraft(b, b.id);
      if (!OR_DRAFT.currency && b.currency && availableCurrencies(sme(OR_DRAFT.smeId)).includes(b.currency)) OR_DRAFT.currency = b.currency;
      render(); toast('Beneficiary ' + b.name + ' selected.');
    }
    return;
  }

  /* outward draft fields */
  if (t.dataset.ork) {
    const k = t.dataset.ork;
    OR_DRAFT[k] = t.value;
    if (k === 'currency') { OR_DRAFT.allocations = []; OR_DRAFT.rate = RATE_NONE(); }
    if (k === 'purposeCode' && t.value) toast('Document checklist updated for ' + t.value + '.');
    if (['currency','purposeCode','amount','debitAccountId'].includes(k)) render();
    return;
  }

  if (t.dataset.blk) { BILL_DRAFT[t.dataset.blk] = t.value; return; }
  if (t.dataset.dik) { DI_DRAFT[t.dataset.dik] = t.value; return; }

  /* review */
  if (t.dataset.act === 'rv-cur') {
    const set = new Set(REVIEW.currencies);
    t.checked ? set.add(t.dataset.c) : set.delete(t.dataset.c);
    REVIEW.currencies = [...set]; render(); return;
  }
  if (t.dataset.act === 'rv-margin') {
    const v = t.value === '' ? null : Number(t.value);
    if (v === null) delete REVIEW.margins[t.dataset.c]; else REVIEW.margins[t.dataset.c] = v;
    render(); return;
  }
  if (t.dataset.act === 'rv-perm')    { REVIEW.permission = t.value; return; }
  if (t.dataset.act === 'rv-eff')     { REVIEW.effectiveDate = t.value; return; }
  if (t.dataset.act === 'rv-remarks') { REVIEW.remarks = t.value; return; }

  if (t.dataset.act === 'ko-side')     { KO.side = t.value; KO.allocations = []; render(); return; }
  if (t.dataset.act === 'ko-currency') { KO.currency = t.value; render(); return; }
  if (t.dataset.act === 'report-pick') { reportId = t.value; render(); return; }
  if (t.dataset.act === 'report-cur')  { reportCur = t.value; render(); return; }
  if (t.dataset.act === 'ri-sme') {
    const s = sme(t.value);
    $('#ri-cur').innerHTML = s.config.currencies.map(c => `<option>${c}</option>`).join('');
    return;
  }

  /* admin */
  if (t.dataset.act === 'set-autochecker') { run('settings.update', { autoChecker:t.checked }); return; }
  if (t.dataset.act === 'set-unlinked')    { run('settings.update', { allowUnlinked:t.checked }); return; }
  if (t.dataset.act === 'purpose-toggle')  { run('purpose.setEnabled', { product:t.dataset.product, code:t.dataset.code, enabled:t.checked }); return; }
  if (t.dataset.act === 'policy-rule')     { run('policy.setRule', { product:t.dataset.product, docId:t.dataset.doc, rule:t.value }); return; }

  /* allocations */
  if (t.dataset.act === 'or-alloc') {
    const b = bill(t.dataset.bill), v = Number(t.value) || 0;
    const avail = Engine.billAvailable(DB, b, OR_DRAFT.id);
    OR_DRAFT.allocations = OR_DRAFT.allocations.filter(a => a.billId !== b.id);
    if (v > 0) {
      if (v > avail) toast(`Only ${money(avail, b.currency)} is available on ${b.id}.`, 'err');
      const amount = Math.min(v, avail);
      const other = OR_DRAFT.allocations.reduce((s, a) => s + a.amount, 0);
      if (other + amount > Number(OR_DRAFT.amount || 0)) { toast('Total allocation cannot exceed the remittance amount. Enter the amount first.', 'err'); render(); return; }
      OR_DRAFT.allocations.push({ billId:b.id, amount });
    }
    render(); return;
  }
  if (t.dataset.act === 'di-alloc') {
    const b = bill(t.dataset.bill), v = Number(t.value) || 0;
    const i = inwardRec(DI_DRAFT.inwardId);
    DI_DRAFT.allocations = DI_DRAFT.allocations.filter(a => a.billId !== b.id);
    if (v > 0) {
      const cap = Math.min(Engine.billAvailable(DB, b), i.available);
      if (v > cap) toast(`Cannot apply more than ${money(cap, b.currency)}.`, 'err');
      const amount = Math.min(v, cap);
      const other = DI_DRAFT.allocations.reduce((s, a) => s + a.amount, 0);
      if (other + amount > i.available) { toast('Total cannot exceed the amount available on the receipt.', 'err'); render(); return; }
      DI_DRAFT.allocations.push({ billId:b.id, amount });
    }
    render(); return;
  }
});

/* live typing: keep drafts in sync without re-rendering and losing focus */
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.act === 'out-search')  { outSearch = t.value; debounceRender(); return; }
  if (t.dataset.act === 'bill-search') { billSearch = t.value; debounceRender(); return; }
  if (t.dataset.act === 'admin-filter'){ adminFilter = t.value; debounceRender(); return; }
  if (t.dataset.act === 'purpose-filter') { OR_DRAFT.purposeFilter = t.value; debounceRender(); return; }
  if (t.dataset.act === 'resp-text' && RESP) { RESP.text = t.value; return; }
  if (t.dataset.k && t.type !== 'checkbox' && t.type !== 'radio') { DRAFT[t.dataset.k] = t.value; return; }
  if (t.dataset.ork && t.tagName !== 'SELECT') { OR_DRAFT[t.dataset.ork] = t.value; return; }
  if (t.dataset.blk) { BILL_DRAFT[t.dataset.blk] = t.value; return; }
  if (t.dataset.dik && t.tagName !== 'SELECT') { DI_DRAFT[t.dataset.dik] = t.value; return; }
  if (t.dataset.act === 'rv-remarks' && REVIEW) { REVIEW.remarks = t.value; return; }
});

let debounceTimer = null;
function debounceRender() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const active = document.activeElement;
    const key = active?.dataset?.act, pos = active?.selectionStart;
    render();
    if (key) {
      const again = document.querySelector(`[data-act="${key}"]`);
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (err) {} }
    }
  }, 220);
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------- boot --------------------------------------------------------------------- */
(async function boot() {
  const q = new URLSearchParams(location.search);
  if (!EMBEDDED && /^https?:$/.test(location.protocol) && q.get('mode') !== 'local') {
    try {
      const h = await http('/api/health', { timeout:5000 });
      if (h.ok && h.mode === 'server') {
        API.mode = 'server'; API.store = h.store; API.persistent = h.persistent; API.passcodeRequired = h.passcodeRequired;
        API.storeError = h.storeOk === false ? (h.storeError || 'unknown error') : null;
      }
    } catch (e) { /* no API — run locally */ }
  }
  if (API.mode === 'server') { API.tokens = sessGet('ad2-tokens') || {}; S = sessGet('ad2-session'); }
  else { LOCAL = loadLocal(); S = EMBEDDED ? null : sessGet('ad2-session'); }

  try { await pull(); }
  catch (e) {
    if (e.status === 401) { setSession(null); try { await pull(); } catch (e2) { return bootFail(e2); } }
    else return bootFail(e);
  }

  /* deep link: ?as=DOMAIN:LOGIN[&acting=SME-xxxx] — used by the screen index */
  const as = q.get('as');
  if (as) {
    const [d, l] = as.toUpperCase().split(':');
    try {
      if (API.mode === 'local' || (!API.passcodeRequired && isDemoLogin(d, l))) {
        if (!S || S.domainId !== d || S.loginId !== l) await signIn(d, l, 'demo');
        const wants = q.get('acting');
        if (wants && isAD2() && sme(wants)?.status === 'Approved') setSession({ ...S, actingFor:wants });
      }
    } catch (e) { /* fall back to the sign-in screen */ }
  }
  if (!location.hash) location.hash = '#/login';
  render({ keepScroll:false });
  if (API.mode === 'server') {
    setInterval(poll, 5000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
  }
})();

function bootFail(e) {
  $('#root').innerHTML = `<div class="page" style="max-width:640px;margin:60px auto"><div class="card"><div class="denied">
    <div class="ic">!</div><h3>Cannot load the platform</h3><p>${esc(e.message || 'Unknown error')}</p>
    <p><a href="?mode=local">Open the offline demo instead</a></p></div></div></div>`;
}
