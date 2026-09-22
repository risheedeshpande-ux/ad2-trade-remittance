/* ==========================================================================
   AD2 Trade Remittance — prototype application
   Vanilla JS. State persists in localStorage. All data is fictional and all
   external processing (auth, FX, payments, SFTP, SAP, OCR) is simulated.
   ========================================================================== */

/* ---------- 1. utilities -------------------------------------------------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const money = (n, cur) => {
  const v = Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });
  return cur ? `${v} ${cur}` : v;
};
const inr = n => '₹ ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 });

const dmy = s => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
};
const dmyt = s => {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d)) return '—';
  return d.toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
};
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);
const nowISO = () => new Date().toISOString();

const agingBucket = d =>
  d <= 7 ? '0–7 days' : d <= 15 ? '8–15 days' : d <= 30 ? '16–30 days' : 'Over 30 days';

/* ---------- 2. store ------------------------------------------------------ */
const KEY = 'ad2-trade-state';

function freshState() {
  const s = JSON.parse(JSON.stringify(SEED));
  s.settings = { autoChecker: true, allowUnlinked: false };
  s.queries = [];
  return s;
}
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version === SEED.version) {
        /* Back-fill any top-level key the stored state predates. Without this a
           new master added after someone's last visit reads as undefined and
           takes the screen down, because their version still matches. */
        const base = freshState();
        Object.keys(base).forEach(k => {
          if (parsed[k] === undefined) parsed[k] = base[k];
        });
        return parsed;
      }
    }
  } catch (e) { /* fall through to a fresh seed */ }
  return freshState();
}
let DB = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch (e) { toast('Could not save prototype state to this browser.', 'err'); }
}
function resetDemo() {
  DB = freshState(); save();
  toast('Demo data reset.', 'ok');
  location.hash = '#/login';
  render();
}

/* ---------- 3. lookups ---------------------------------------------------- */
const sme       = id => DB.smes.find(s => s.id === id);
const acct      = id => DB.accounts.find(a => a.id === id);
const bill      = id => DB.bills.find(b => b.id === id);
const purpose   = code => DB.purposeCodes.find(p => p.code === code);
const currency  = code => DB.currencies.find(c => c.code === code);
const smeAccounts = smeId => DB.accounts.filter(a => a.smeId === smeId);
const bene        = id => DB.beneficiaries.find(x => x.id === id);
const smeBenes    = smeId => DB.beneficiaries.filter(x => x.smeId === smeId);
const rtype     = id => DB.remittanceTypes.find(t => t.id === id);

/* Remittance types for a direction, and the purpose codes a chosen type allows.
   Type narrows purpose; with no type chosen, every purpose for that direction
   is on offer. */
const typesFor = dir => DB.remittanceTypes.filter(t => t.direction === dir);
function purposesFor(dir, typeId) {
  const all = DB.purposeCodes.filter(p => p.direction === dir);
  const t = rtype(typeId);
  return t ? all.filter(p => t.purposes.includes(p.code)) : all;
}
/* The full checklist = the purpose code's documents plus any the type adds. */
function checklistFor(purposeCode, typeId) {
  const p = purpose(purposeCode);
  const t = rtype(typeId);
  const rows = [...(p ? p.docs : [])];
  (t ? t.docs : []).forEach(d => { if (!rows.some(x => x.id === d.id)) rows.push(d); });
  return rows;
}

const nextId = (arr, prefix, pad = 4) => {
  const n = arr.reduce((m, r) => {
    const v = parseInt(String(r.id).split('-')[1], 10);
    return isNaN(v) ? m : Math.max(m, v);
  }, 0);
  return `${prefix}-${String(n + 1).padStart(pad, '0')}`;
};

function logAudit(record, action) {
  DB.audit.unshift({
    id: 'AU-' + (DB.audit.length + 1),
    record, actor: `${S.role}${S.name ? ' (' + S.name + ')' : ''}`,
    action, at: nowISO()
  });
}

/* margin for an SME + currency: explicit override, else derived from USD
   via the currency master multiplier (per the requirements call). */
function marginFor(smeRec, code) {
  if (!smeRec || !smeRec.config) return 0;
  const m = smeRec.config.margins || {};
  if (m[code] != null) return m[code];
  const base = m.USD;
  if (base == null) return 0;
  return Math.round(base * (currency(code)?.marginMultiplier ?? 1));
}
const customerRate = (code, marginPaise) =>
  +( (currency(code)?.refRate ?? 0) + (marginPaise || 0) / 100 ).toFixed(4);

/* ---------- 4. session ---------------------------------------------------- */
/* When the app runs inside an iframe — the screen index renders many at once —
   the session is held in memory only. sessionStorage is shared across same-origin
   frames, so persisting it would make every tile fight over the active role. */
const EMBEDDED = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();

let S = null;
if (!EMBEDDED) { try { S = JSON.parse(sessionStorage.getItem('ad2-session') || 'null'); } catch (e) { S = null; } }
function setSession(v) {
  S = v;
  if (EMBEDDED) return;
  try {
    if (v) sessionStorage.setItem('ad2-session', JSON.stringify(v));
    else sessionStorage.removeItem('ad2-session');
  } catch (e) { /* private mode — the in-memory session still works */ }
}
const isAD2 = () => !!S && S.role.startsWith('AD2');
const isSME = () => !!S && S.role.startsWith('SME');

/* Assisted journey: an AD2 user picks an SME up from the directory and then
   works inside the SME portal on its behalf. Every screen is reused as-is;
   only the SME the data resolves to changes. */
const acting    = () => !!(S && S.actingFor);
/* Anyone operating as the SME — the SME's own user, or an AD2 user acting for
   them. Action gates use this; data-isolation guards still use isSME(). */
const asSme     = () => isSME() || acting();
const ctxSmeId  = () => (S && (S.actingFor || S.smeId)) || null;
/* true when the current view should be scoped to one SME rather than the book */
const scoped    = () => !isAD2() || acting();

/* service permission gates */
function perm(smeRec) {
  const p = smeRec?.config?.permission || '';
  return {
    importSide: p === 'Import' || p === 'Both',
    exportSide: p === 'Export' || p === 'Both',
  };
}

/* ---------- 5. toast + modal --------------------------------------------- */
function toast(msg, kind = '') {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

let modalOnOk = null;
function modal({ title, body, okLabel = 'Confirm', okClass = 'btn-primary', wide = false, onOk }) {
  modalOnOk = onOk || null;
  $('#modal-host').innerHTML = `
    <div class="modal-back" data-act="modal-dismiss">
      <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head"><h2>${esc(title)}</h2>
          <button type="button" data-act="modal-close" aria-label="Close">&times;</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">
          <button class="btn btn-plain" type="button" data-act="modal-close">Cancel</button>
          ${onOk ? `<button class="btn ${okClass}" type="button" data-act="modal-ok">${esc(okLabel)}</button>` : ''}
        </div>
      </div>
    </div>`;
}
function closeModal() { $('#modal-host').innerHTML = ''; modalOnOk = null; }

/* ---------- 6. shared view pieces ---------------------------------------- */
const BADGE = {
  'Draft':'b-grey','Submitted':'b-blue','Under Review':'b-blue','Clarification Required':'b-amber',
  'Query Raised':'b-amber','Resubmitted':'b-blue','Processing':'b-purple','Completed':'b-green',
  'Processed':'b-green','Approved':'b-green','Accepted':'b-green','Rejected':'b-red','Failed':'b-red',
  'Awaiting Instruction':'b-amber','Instruction Submitted':'b-blue',
  'Unsettled':'b-grey','Partially Settled':'b-amber','Settled':'b-green',
};
const badge = s => `<span class="badge ${BADGE[s] || 'b-grey'}">${esc(s)}</span>`;

const kpi = (label, value, opts = {}) => `
  <button class="kpi ${opts.tone || ''}" type="button" ${opts.go ? `data-act="go" data-href="${opts.go}"` : ''}>
    <div class="lbl">${esc(label)}</div>
    <div class="val">${value}${opts.unit ? `<small>${esc(opts.unit)}</small>` : ''}</div>
    ${opts.delta ? `<div class="delta ${opts.deltaTone || ''}">${esc(opts.delta)}</div>` : ''}
  </button>`;

const empty = (title, msg) => `
  <div class="empty"><div class="ic">◇</div><h3>${esc(title)}</h3><p>${esc(msg)}</p></div>`;

const simBanner = `
  <div class="sim-bar">
    <b>Prototype</b>
    <span>Fictional data. Authentication, FX rates, payments, SFTP, SAP and document AI are simulated.</span>
    <a href="screens.html" style="margin-left:auto;color:#7a5c00;font-size:var(--fs-xs)">All screens</a>
    <a href="map.html" style="margin-left:var(--s3);color:#7a5c00;font-size:var(--fs-xs)">Screen map</a>
    <button type="button" data-act="reset-demo" style="margin-left:var(--s3)">Reset demo data</button>
  </div>`;

function timeline(recordId) {
  const rows = DB.audit.filter(a => a.record === recordId);
  if (!rows.length) return `<p style="color:var(--muted);font-size:var(--fs-sm)">No activity recorded yet.</p>`;
  return `<div class="timeline">${rows.map(r => `
    <div class="tl"><div class="act">${esc(r.action)}</div>
      <div class="meta">${esc(r.actor)} · ${dmyt(r.at)}</div></div>`).join('')}</div>`;
}

/* ---------- 7. navigation ------------------------------------------------- */
const SME_NAV = [
  { grp:'Transact' },
  { href:'#/sme/dashboard',    label:'Dashboard',             chip:'DB', tone:'--chip-db' },
  { href:'#/sme/outward',      label:'Outward Remittance',    chip:'OR', tone:'--chip-or' },
  { href:'#/sme/inward',       label:'Inward Remittance',     chip:'IR', tone:'--chip-ir' },
  { grp:'Bill Lodgement' },
  { href:'#/sme/bills/export', label:'Export Bill Lodgement', chip:'EB', tone:'--chip-im', sub:true },
  { href:'#/sme/bills/import', label:'Import Bill Lodgement', chip:'IB', tone:'--chip-er', sub:true },
  { href:'#/sme/knockoff',     label:'Bill Knock-off',        chip:'KO', tone:'--chip-di' },
  { grp:'Insight' },
  { href:'#/sme/reports',      label:'Reports',               chip:'RP', tone:'--chip-rp' },
  { href:'#/sme/integrations', label:'Integrations',          chip:'UP', tone:'--chip-up' },
  { href:'#/sme/profile',      label:'Profile',               chip:'PR', tone:'--chip-pr' },
];

const AD2_NAV = [
  { grp:'Operations' },
  { href:'#/ad2/dashboard',      label:'Dashboard',          chip:'DB', tone:'--chip-db' },
  { href:'#/ad2/applications',   label:'SME Applications',   chip:'SA', tone:'--chip-or' },
  { href:'#/ad2/directory',      label:'SME Directory',      chip:'SD', tone:'--chip-pr' },
  { grp:'Transactions' },
  { href:'#/ad2/outward',        label:'Outward Requests',   chip:'OR', tone:'--chip-or' },
  { href:'#/ad2/inward',         label:'Inward Remittances', chip:'IR', tone:'--chip-ir' },
  { href:'#/ad2/bills',          label:'Bills',              chip:'BL', tone:'--chip-bl' },
  { href:'#/ad2/reconciliation', label:'Reconciliation',     chip:'RC', tone:'--chip-rc' },
  { grp:'Administration' },
  { href:'#/ad2/reports',        label:'Reports',            chip:'RP', tone:'--chip-rp' },
  { href:'#/ad2/admin',          label:'Administration',     chip:'AD', tone:'--chip-ad' },
];

function navHTML() {
  const items = (isAD2() && !acting()) ? AD2_NAV : SME_NAV;
  const hash = location.hash || '';
  const rows = items.map(it => {
    if (it.grp) return `<div class="grp">${esc(it.grp)}</div>`;
    const on = hash.startsWith(it.href) ? 'on' : '';
    return `<a href="${it.href}" class="${on} ${it.sub ? 'sub-item' : ''}">
      <span class="ic" style="background:var(${it.tone})">${esc(it.chip)}</span>${esc(it.label)}</a>`;
  }).join('');
  const title = (isAD2() && !acting()) ? 'AD2 Trade Operations' : (acting() ? 'Assisted — SME Portal' : 'SME Trade Portal');
  const sub = (isAD2() && !acting()) ? 'Trade remittance operations' : (sme(ctxSmeId())?.tradingName || 'Trade services');
  return `<nav class="nav" aria-label="Main">
    <div class="brand"><span class="mark">◈</span>
      <span><span class="name">${esc(title)}</span><span class="mod">${esc(sub)}</span></span></div>
    ${rows}
    <div class="navfoot">AD2 Trade Remittance · prototype</div>
  </nav>`;
}

/* role switcher — clearly labelled, per the BRD */
function topHTML(crumb) {
  const opts = DB.logins.map(a =>
    `<option value="${a.domainId}|${a.loginId}" ${S.domainId === a.domainId && S.loginId === a.loginId ? 'selected' : ''}>
       ${esc(a.role)}${a.smeId ? ' — ' + esc(sme(a.smeId)?.tradingName || '') : ''}</option>`).join('');
  const initials = (S.name || S.role).split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return `<div class="top">
    <div class="crumb">${crumb}</div>
    <div class="spacer"></div>
    <div class="rolepick"><label for="roleswitch">Demo role</label>
      <select id="roleswitch" data-act="switch-role">${opts}</select></div>
    <div class="who"><span class="av">${esc(initials)}</span>
      <span class="meta"><b>${esc(S.name || '')}</b><span>${esc(S.role)}</span></span></div>
    <button class="btn btn-plain btn-sm" type="button" data-act="logout">Sign out</button>
  </div>`;
}

function shell(crumb, body) {
  return `
  <div class="appbar">
    <button class="ibtn navtoggle" type="button" data-act="nav-toggle" aria-label="Menu">☰</button>
    <span class="wordmark">Remit<i>4</i>Me</span>
    <div class="spacer"></div>
    <div class="icons">
      <button class="ibtn" type="button" data-act="go" data-href="${isAD2() ? '#/ad2/dashboard' : '#/sme/dashboard'}" aria-label="Home">⌂</button>
      <button class="ibtn" type="button" data-act="apps" aria-label="Applications">▦</button>
      <button class="ibtn" type="button" data-act="logout" aria-label="Sign out">⏻</button>
    </div>
  </div>
  ${simBanner}
  ${acting() ? `<div class="sim-bar" style="background:#e0f4f4;border-color:#9ad4d5;color:#0b5f61">
      <b>Assisted journey</b>
      <span style="flex:1">You are acting for <b>${esc(sme(S.actingFor)?.tradingName || '')}</b>.
        Anything you submit is recorded as raised by ${esc(S.name || S.role)} on their behalf.</span>
      <a href="#/sme/outward" style="color:#0b5f61;font-size:var(--fs-xs);margin-left:var(--s3)">Outward</a>
      <a href="#/sme/inward" style="color:#0b5f61;font-size:var(--fs-xs);margin-left:var(--s3)">Inward</a>
      <button type="button" data-act="assist-exit" style="border-color:#6fbfc0;color:#0b5f61;margin-left:var(--s3)">Exit assisted journey</button>
    </div>` : ''}
  <div class="app">
    ${navHTML()}
    <div class="main">
      ${topHTML(crumb)}
      <div class="page">${body}</div>
    </div>
  </div>`;
}

const crumb = (...parts) =>
  parts.map((p, i) => i === parts.length - 1 ? `<b>${esc(p)}</b>` : esc(p)).join(' / ');

/* ---------- 8. login ------------------------------------------------------ */
function viewLogin() {
  const demo = DB.logins.map(a => `
    <button type="button" data-act="fill-login" data-domain="${a.domainId}" data-login="${a.loginId}">
      ${esc(a.domainId)} / ${esc(a.loginId)} — ${esc(a.role)}${a.smeId ? ' · ' + esc(sme(a.smeId)?.tradingName || '') : ''}
    </button>`).join('');

  return `<div class="login-wrap">
    <div class="login-art">
      <h2>Trade remittance for small and mid-sized exporters and importers</h2>
      <p>Onboard once, then transact: outward payments, inward disposal, bill lodgement and knock-off in a single portal.</p>
      <div class="feats">
        <div><span>1</span>Digital onboarding with AD2 maker-checker approval</div>
        <div><span>2</span>Live rates with a 48-hour booked rate lock</div>
        <div><span>3</span>Bill lodgement by form, CSV, SFTP or SAP</div>
        <div><span>4</span>Automatic knock-off against outstanding bills</div>
      </div>
    </div>
    <div class="login-panel">
      <div class="logo">Remit<b>4</b>Me</div>
      <div class="sub">AD2 Trade Remittance</div>
      <h1>Sign In</h1>
      <div class="seg" role="tablist">
        <button role="tab" aria-selected="true" type="button">Non-Individual</button>
        <button role="tab" aria-selected="false" type="button" data-act="noop-individual">Individual/DSE/DSA</button>
      </div>
      <form class="f fields" data-act="do-login">
        <div class="f"><label for="li-domain">Domain ID<span class="req">*</span></label>
          <input id="li-domain" name="domain" type="text" placeholder="Domain ID" autocomplete="off" required>
          <div class="err">Enter a Domain ID.</div></div>
        <div class="f"><label for="li-user">Login ID<span class="req">*</span></label>
          <input id="li-user" name="login" type="text" placeholder="Login ID" autocomplete="off" required>
          <div class="err">Enter a Login ID.</div></div>
        <div class="f"><label for="li-pass">Password<span class="req">*</span></label>
          <input id="li-pass" name="pass" type="password" placeholder="Password" autocomplete="off" required>
          <div class="hint">Simulated — any value is accepted. Never enter a real password here.</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" type="submit">Sign in</button>
          <button class="btn btn-plain" type="button" data-act="go" data-href="#/register">Register SME</button>
          <button class="btn btn-link" type="button" data-act="go" data-href="#/status">Application status</button>
        </div>
      </form>
      <div class="demo-note"><b>Demo accounts — click to fill</b>${demo}</div>
    </div>
  </div>`;
}

/* ---------- 9. SME onboarding (7 steps + review) -------------------------- */
let DRAFT = null;
function newDraft() {
  return {
    id:null, legalName:'', tradingName:'', constitution:'', incorporationDate:'', regNumber:'',
    country:'India', address:'',
    domainId:'', ad2Name:'AD2 Trade Services', category:'SME',
    pan:'', gstin:'', iec:'',
    contactName:'', designation:'', email:'', mobile:'',
    industry:'', description:'', expectedVolume:'', requestedCurrencies:[], service:'',
    banks:[], docs:{}, source:'Digital', status:'Draft', step:0
  };
}

const ONBOARD_STEPS = [
  'Business details','Domain','Identifiers','Contact','Business profile','Bank accounts','Documents','Review'
];

const ONBOARD_DOCS = [
  { id:'coi',   name:'Certificate of incorporation / registration', required:true },
  { id:'pan',   name:'PAN card',                                    required:true },
  { id:'gst',   name:'GST registration certificate',                required:true },
  { id:'iec',   name:'IEC certificate',                             required:true },
  { id:'addr',  name:'Registered address proof',                    required:true },
  { id:'board', name:'Board resolution / authority letter',         required:false },
  { id:'fin',   name:'Latest audited financials',                   required:false },
];

function slugDomain(name) {
  return (name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) || '';
}

function viewRegister() {
  if (!DRAFT) DRAFT = newDraft();
  const d = DRAFT;
  const step = d.step;

  const steps = ONBOARD_STEPS.map((s, i) => `
    <button type="button" data-act="ob-step" data-i="${i}"
      ${i === step ? 'aria-current="step"' : ''} class="${i < step ? 'done' : ''}">
      <span class="n">${i < step ? '✓' : i + 1}</span>${esc(s)}</button>`).join('');

  const bodies = [ obBusiness, obDomain, obIdent, obContact, obProfile, obBanks, obDocs, obReview ];

  return `<div class="appbar"><span class="wordmark">Remit<i>4</i>Me</span><div class="spacer"></div>
      <button class="btn btn-plain btn-sm" type="button" data-act="go" data-href="#/login">Back to sign in</button></div>
    ${simBanner}
    <div class="page" style="max-width:980px;margin:0 auto">
      <div class="page-head"><div>
        <h1>Register your business</h1>
        <p>Digital onboarding. Your progress is saved as a draft at each step.</p></div></div>
      <div class="card">
        <div class="stepper">${steps}</div>
        <div class="card-body">${bodies[step](d)}</div>
        <div class="formfoot">
          <button class="btn btn-plain" type="button" data-act="ob-back" ${step === 0 ? 'disabled' : ''}>Back</button>
          <button class="btn btn-plain" type="button" data-act="ob-save">Save draft</button>
          <div class="spacer"></div>
          ${step < 7
            ? `<button class="btn btn-primary" type="button" data-act="ob-next">Next</button>`
            : `<button class="btn btn-primary" type="button" data-act="ob-submit">Submit application</button>`}
        </div>
      </div>
    </div>`;
}

const fld = (id, label, val, opts = {}) => `
  <div class="f" data-fld="${id}">
    <label for="ob-${id}">${esc(label)}${opts.required ? '<span class="req">*</span>' : ''}</label>
    ${opts.type === 'textarea'
      ? `<textarea id="ob-${id}" data-k="${id}">${esc(val)}</textarea>`
      : opts.options
        ? `<select id="ob-${id}" data-k="${id}"><option value="">Select…</option>${
            opts.options.map(o => `<option ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : `<input id="ob-${id}" data-k="${id}" type="${opts.type || 'text'}" value="${esc(val)}"
             ${opts.readonly ? 'readonly disabled' : ''} placeholder="${esc(opts.ph || '')}">`}
    ${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ''}
    <div class="err">${esc(opts.err || 'This field is required.')}</div>
  </div>`;

function obBusiness(d) {
  return `<div class="fields g2 grid">
    ${fld('legalName','Legal name',d.legalName,{required:true})}
    ${fld('tradingName','Trading name',d.tradingName,{})}
    ${fld('constitution','Constitution',d.constitution,{required:true,options:DB.constitutions,
      hint:'HUF and Individual are available for sole consultants and family entities.'})}
    ${fld('incorporationDate','Incorporation / registration date',d.incorporationDate,{required:true,type:'date'})}
    ${fld('regNumber','Registration number (CIN / LLPIN / other)',d.regNumber,{required:true})}
    ${fld('country','Country',d.country,{required:true})}
    <div class="span2">${fld('address','Registered address',d.address,{required:true,type:'textarea'})}</div>
  </div>`;
}

function obDomain(d) {
  return `<div class="note note-info" style="margin-bottom:16px">
      The AD2 name is set by the platform and the Domain ID is generated from your legal name.
      Category is fixed to SME. Partner ID is held in the backend and is not collected here.
    </div>
    <div class="fields g2 grid">
      ${fld('ad2Name','AD2 name',d.ad2Name,{readonly:true})}
      ${fld('category','Category',d.category,{readonly:true})}
      ${fld('domainId','Domain ID',d.domainId || slugDomain(d.legalName),{required:true,
        hint:'Generated from your legal name. You may edit it before submission.'})}
    </div>`;
}

function obIdent(d) {
  return `<div class="fields g2 grid">
    ${fld('pan','PAN',d.pan,{required:true})}
    ${fld('gstin','GSTIN',d.gstin,{required:true})}
    ${fld('iec','Importer Exporter Code (IEC)',d.iec,{required:true,
      hint:'Mandatory. Regular transacting exporters and importers must hold an IEC.',
      err:'IEC is mandatory for all regular transacting customers.'})}
  </div>`;
}

function obContact(d) {
  return `<div class="fields g2 grid">
    ${fld('contactName','Contact name',d.contactName,{required:true})}
    ${fld('designation','Designation',d.designation,{required:true})}
    ${fld('email','Email',d.email,{required:true,type:'email'})}
    ${fld('mobile','Mobile number',d.mobile,{required:true,type:'tel'})}
  </div>`;
}

function obProfile(d) {
  const curs = DB.currencies.map(c => `
    <label><input type="checkbox" data-k="requestedCurrencies" value="${c.code}"
      ${d.requestedCurrencies.includes(c.code) ? 'checked' : ''}> ${c.code}</label>`).join('');
  const svc = ['Import','Export','Both'].map(s => `
    <label><input type="radio" name="svc" data-k="service" value="${s}" ${d.service === s ? 'checked' : ''}> ${s}</label>`).join('');
  return `<div class="fields grid g2">
      ${fld('industry','Industry',d.industry,{required:true})}
      ${fld('expectedVolume','Expected annual volume',d.expectedVolume,{required:true,ph:'e.g. USD 2,000,000'})}
      <div class="span2">${fld('description','Business description',d.description,{required:true,type:'textarea'})}</div>
    </div>
    <div style="margin-top:20px">
      <label style="font-size:var(--fs-sm);font-weight:500;color:var(--ink-soft)">Requested currencies<span class="req">*</span></label>
      <div class="pillset" style="margin-top:6px" data-fld="requestedCurrencies">${curs}</div>
    </div>
    <div style="margin-top:20px">
      <label style="font-size:var(--fs-sm);font-weight:500;color:var(--ink-soft)">Requested service<span class="req">*</span></label>
      <div class="pillset" style="margin-top:6px" data-fld="service">${svc}</div>
    </div>`;
}

function obBanks(d) {
  const rows = d.banks.length ? d.banks.map((b, i) => `
    <tr><td><b>${esc(b.bank)}</b><br><span style="color:var(--muted);font-size:var(--fs-sm)">${esc(b.branch || '')}</span></td>
      <td>${esc(b.accountNumber)}</td><td>${esc(b.ifsc)}</td><td>${esc(b.currency)} · ${esc(b.type)}</td>
      <td>${b.verified ? badge('Approved').replace('Approved','Verified') : `<button class="btn btn-ghost btn-sm" type="button" data-act="ob-penny" data-i="${i}">Verify (PennyDrop)</button>`}</td>
      <td><button class="btn btn-link" type="button" data-act="ob-bank-del" data-i="${i}">Remove</button></td></tr>`).join('')
    : `<tr><td colspan="6"><div class="empty"><h3>No accounts added</h3>
        <p>Add at least one account. These become your account master for debit and credit selection.</p></div></td></tr>`;
  return `<div class="note note-info" style="margin-bottom:16px">
      Accounts added here form your account master. Transactions select from this list rather than
      capturing account details each time.</div>
    <div class="card" style="box-shadow:none"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Bank</th><th>Account number</th><th>IFSC</th><th>Currency / type</th><th>Verification</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>
    <button class="btn btn-ghost" style="margin-top:14px" type="button" data-act="ob-bank-add">Add bank account</button>`;
}

function obDocs(d) {
  return `<div class="doclist">${ONBOARD_DOCS.map(doc => {
    const up = d.docs[doc.id];
    return `<div class="docrow ${up ? 'uploaded' : ''}">
      <span class="nm">${esc(doc.name)}${doc.required ? '<span class="req">*</span>' : ''}
        <small>${up ? esc(up.filename) + ' · uploaded ' + dmy(up.at) : (doc.required ? 'Required' : 'Optional')}</small></span>
      <span class="spacer"></span>
      ${up ? `<button class="btn btn-link" type="button" data-act="ob-doc-del" data-id="${doc.id}">Remove</button>`
           : `<button class="btn btn-plain btn-sm" type="button" data-act="ob-doc-add" data-id="${doc.id}">Upload</button>`}
    </div>`; }).join('')}</div>
    <p style="color:var(--muted);font-size:var(--fs-sm);margin-top:14px">
      Uploads are simulated. No file leaves your browser and nothing is stored.</p>`;
}

function obReview(d) {
  const row = (k, v) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v || '—')}</div></div>`;
  const missing = onboardMissing(d);
  return `
    ${missing.length ? `<div class="note note-err" style="margin-bottom:16px">
      <span>Complete before submitting: ${esc(missing.join('; '))}</span></div>`
      : `<div class="note note-ok" style="margin-bottom:16px"><span>All required fields and documents are complete.</span></div>`}
    <h3 style="font-size:var(--fs-md);margin-bottom:10px">Business</h3>
    <div class="kv">${row('Legal name',d.legalName)}${row('Trading name',d.tradingName)}
      ${row('Constitution',d.constitution)}${row('Registration number',d.regNumber)}
      ${row('Domain ID',d.domainId)}${row('Category',d.category)}</div>
    <h3 style="font-size:var(--fs-md);margin:22px 0 10px">Identifiers</h3>
    <div class="kv">${row('PAN',d.pan)}${row('GSTIN',d.gstin)}${row('IEC',d.iec)}</div>
    <h3 style="font-size:var(--fs-md);margin:22px 0 10px">Profile</h3>
    <div class="kv">${row('Industry',d.industry)}${row('Expected volume',d.expectedVolume)}
      ${row('Requested currencies',d.requestedCurrencies.join(', '))}${row('Requested service',d.service)}</div>
    <h3 style="font-size:var(--fs-md);margin:22px 0 10px">Bank accounts</h3>
    <div class="kv">${d.banks.length ? d.banks.map(b =>
      row(b.bank, `${b.accountNumber} · ${b.currency}${b.verified ? ' · verified' : ' · unverified'}`)).join('') : row('Accounts','None added')}</div>
    <div class="checks" style="margin-top:24px">
      <label class="chk"><input type="checkbox" id="declare">
        <span>I confirm the information and documents provided are accurate and complete.
        <small>Required before submission.</small></span></label>
    </div>`;
}

function onboardMissing(d) {
  const m = [];
  if (!d.legalName) m.push('legal name');
  if (!d.constitution) m.push('constitution');
  if (!d.regNumber) m.push('registration number');
  if (!d.address) m.push('registered address');
  if (!d.domainId) m.push('Domain ID');
  if (!d.pan) m.push('PAN');
  if (!d.gstin) m.push('GSTIN');
  if (!d.iec) m.push('IEC (mandatory)');
  if (!d.contactName || !d.email || !d.mobile) m.push('contact details');
  if (!d.industry || !d.description || !d.expectedVolume) m.push('business profile');
  if (!d.requestedCurrencies.length) m.push('at least one requested currency');
  if (!d.service) m.push('requested service');
  if (!d.banks.length) m.push('at least one bank account');
  const docs = ONBOARD_DOCS.filter(x => x.required && !d.docs[x.id]).map(x => x.name);
  if (docs.length) m.push('documents: ' + docs.join(', '));
  return m;
}

/* application status (public) */
function viewStatus() {
  const rows = DB.smes.map(s => `
    <tr><td class="id">${esc(s.id)}</td><td>${esc(s.legalName)}</td><td>${esc(s.domainId)}</td>
      <td>${esc(s.source)}</td><td>${dmy(s.submittedAt)}</td><td>${badge(s.status)}</td></tr>`).join('');
  return `<div class="appbar"><span class="wordmark">Remit<i>4</i>Me</span><div class="spacer"></div>
      <button class="btn btn-plain btn-sm" type="button" data-act="go" data-href="#/login">Back to sign in</button></div>
    ${simBanner}
    <div class="page" style="max-width:1080px;margin:0 auto">
      <div class="page-head"><div><h1>Application status</h1>
        <p>Track a submitted onboarding application.</p></div></div>
      <div class="card"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Application</th><th>Legal name</th><th>Domain ID</th><th>Channel</th><th>Submitted</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>
    </div>`;
}

/* ---------- 10. SME dashboard --------------------------------------------- */
function viewSmeDashboard() {
  const me = sme(ctxSmeId());
  if (!me) return shell(crumb('Dashboard'), empty('No SME linked','This demo account is not linked to an approved SME.'));
  if (me.status !== 'Approved') {
    return shell(crumb('Dashboard'), `
      <div class="page-head"><div><h1>Application ${esc(me.status)}</h1>
        <p>Transaction access opens once AD2 approves your application.</p></div></div>
      <div class="card"><div class="card-body">
        <div class="kv">
          <div><div class="k">Application</div><div class="v">${esc(me.id)}</div></div>
          <div><div class="k">Submitted</div><div class="v">${dmy(me.submittedAt)}</div></div>
          <div><div class="k">Status</div><div class="v">${badge(me.status)}</div></div>
          <div><div class="k">Channel</div><div class="v">${esc(me.source)}</div></div>
        </div>
        <h3 style="font-size:var(--fs-md);margin:24px 0 10px">Activity</h3>${timeline(me.id)}
      </div></div>`);
  }

  const out = DB.outward.filter(o => o.smeId === me.id);
  const inw = DB.inward.filter(i => i.smeId === me.id);
  const bills = DB.bills.filter(b => b.smeId === me.id);
  const openImport = bills.filter(b => b.type === 'Import' && b.outstanding > 0);
  const openExport = bills.filter(b => b.type === 'Export' && b.outstanding > 0);
  const awaiting = inw.filter(i => i.available > 0);
  const pendingOut = out.filter(o => ['Submitted','Under Review','Clarification Required','Processing'].includes(o.status));
  const queries = out.filter(o => o.status === 'Clarification Required').length;

  const byCur = {};
  bills.filter(b => b.outstanding > 0).forEach(b => {
    byCur[b.currency] = (byCur[b.currency] || 0) + b.outstanding;
  });

  const aging = { '0–7 days':0, '8–15 days':0, '16–30 days':0, 'Over 30 days':0 };
  bills.filter(b => b.outstanding > 0).forEach(b => {
    aging[agingBucket(Math.max(0, daysBetween(b.invoiceDate, new Date())))] += 1;
  });

  const recent = [...out].sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate)).slice(0, 5);

  return shell(crumb('Dashboard'), `
    <div class="page-head"><div>
      <h1>${esc(me.tradingName)}</h1>
      <p>Trade remittance activity across outward payments, inward receipts and lodged bills.</p></div>
      <div class="acts">
        ${perm(me).importSide ? `<button class="btn btn-primary" type="button" data-act="go" data-href="#/sme/outward/new">New outward request</button>` : ''}
        ${perm(me).exportSide ? `<button class="btn btn-ghost" type="button" data-act="go" data-href="#/sme/bills/export">Lodge export bill</button>` : ''}
      </div></div>

    <div class="grid g4" style="margin-bottom:20px">
      ${kpi('Outward awaiting action', pendingOut.length, { tone:'accent', go:'#/sme/outward' })}
      ${kpi('Inward awaiting disposal', awaiting.length, { tone:'warn', go:'#/sme/inward' })}
      ${kpi('Outstanding import bills', openImport.length, { go:'#/sme/bills/import' })}
      ${kpi('Outstanding export bills', openExport.length, { go:'#/sme/bills/export' })}
    </div>
    <div class="grid g4" style="margin-bottom:20px">
      ${kpi('Unmatched remittances', inw.filter(i => i.available > 0).length, { go:'#/sme/knockoff' })}
      ${kpi('Open queries', queries, { tone: queries ? 'bad' : '', go:'#/sme/outward' })}
      ${kpi('Enabled currencies', me.config.currencies.join(' · '), {})}
      ${kpi('Approved service', me.config.permission, {})}
    </div>

    <div class="grid g2">
      <div class="card"><div class="card-head"><h2>Outstanding bill value by currency</h2></div>
        <div class="card-body tight"><div class="tablewrap"><table class="dt">
          <thead><tr><th>Currency</th><th class="num">Outstanding</th><th class="num">Bills</th></tr></thead>
          <tbody>${Object.keys(byCur).length ? Object.entries(byCur).map(([c, v]) => `
            <tr><td><b>${esc(c)}</b></td><td class="num">${money(v)}</td>
              <td class="num">${bills.filter(b => b.currency === c && b.outstanding > 0).length}</td></tr>`).join('')
            : `<tr><td colspan="3">${empty('Nothing outstanding','All lodged bills are settled.')}</td></tr>`}</tbody>
        </table></div>
        <p style="padding:12px 20px;color:var(--muted);font-size:var(--fs-xs)">
          Totals are kept separate by currency and are not aggregated.</p></div></div>

      <div class="card"><div class="card-head"><h2>Outstanding bills by age</h2></div>
        <div class="card-body tight"><div class="tablewrap"><table class="dt">
          <thead><tr><th>Bucket</th><th class="num">Bills</th></tr></thead>
          <tbody>${Object.entries(aging).map(([k, v]) => `
            <tr><td>${esc(k)}</td><td class="num">${v}</td></tr>`).join('')}</tbody>
        </table></div></div></div>
    </div>

    <div class="card" style="margin-top:20px"><div class="card-head"><h2>Recent outward requests</h2>
      <div class="acts"><button class="btn btn-link" type="button" data-act="go" data-href="#/sme/outward">View all</button></div></div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Request</th><th>Beneficiary</th><th>Currency</th><th class="num">Amount</th>
          <th>Requested</th><th>Status</th></tr></thead>
        <tbody>${recent.length ? recent.map(o => `
          <tr><td class="id" data-act="go" data-href="#/sme/outward/${o.id}">${esc(o.id)}</td>
            <td>${esc(o.beneficiary)}</td><td>${esc(o.currency)}</td>
            <td class="num">${money(o.amount)}</td><td>${dmy(o.requestDate)}</td>
            <td>${badge(o.status)}</td></tr>`).join('')
          : `<tr><td colspan="6">${empty('No requests yet','Create an outward request to get started.')}</td></tr>`}</tbody>
      </table></div></div></div>`);
}

/* ---------- 11. outward remittance ---------------------------------------- */
const OUT_TABS = ['All','Draft','Submitted','Under Review','Clarification Required','Processing','Completed','Rejected'];
let outTab = 'All', outSearch = '';

function outwardRows(list) {
  return list.map(o => `
    <tr><td class="id" data-act="go" data-href="#/${isAD2() ? 'ad2' : 'sme'}/outward/${o.id}">${esc(o.id)}</td>
      ${isAD2() ? `<td>${esc(sme(o.smeId)?.tradingName || '')}</td>` : ''}
      <td>${esc(o.beneficiary)}<br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(o.beneficiaryCountry)}</span></td>
      <td>${esc(o.currency)}</td><td class="num">${money(o.amount)}</td>
      <td>${esc(purpose(o.purposeCode)?.code || '')}</td>
      <td>${dmy(o.requestDate)}</td><td>${badge(o.status)}</td>
      <td>${esc(o.pendingWith || '—')}</td>
      <td><button class="btn btn-link" type="button" data-act="go"
        data-href="#/${isAD2() ? 'ad2' : 'sme'}/outward/${o.id}">Open</button></td></tr>`).join('');
}

function viewOutwardList() {
  const me = scoped() ? sme(ctxSmeId()) : null;
  if (me && !perm(me).importSide) {
    return shell(crumb('Outward Remittance'), `<div class="card"><div class="denied">
      <div class="ic">⊘</div><h3>Outward remittance is not enabled</h3>
      <p>Your approved service permission is “${esc(me.config.permission)}”. Outward requests require Import or Both.
         Contact AD2 to change your permission.</p></div></div>`);
  }
  let list = scoped() ? DB.outward.filter(o => o.smeId === ctxSmeId()) : DB.outward;
  if (outTab !== 'All') list = list.filter(o => o.status === outTab);
  if (outSearch) {
    const q = outSearch.toLowerCase();
    list = list.filter(o => (o.id + o.beneficiary + o.currency + (o.referenceNumber || '')).toLowerCase().includes(q));
  }
  const base = scoped() ? DB.outward.filter(o => o.smeId === ctxSmeId()) : DB.outward;
  const tabs = OUT_TABS.map(t => `
    <button type="button" data-act="out-tab" data-t="${esc(t)}" aria-selected="${t === outTab}">
      ${esc(t)}<span class="n">${t === 'All' ? base.length : base.filter(o => o.status === t).length}</span></button>`).join('');

  return shell(crumb('Outward Remittance'), `
    <div class="page-head"><div><h1>Outward Remittance</h1>
      <p>${isAD2() ? 'Requests from all onboarded SMEs.' : 'Payments to your overseas suppliers and service providers.'}</p></div>
      <div class="acts">
        ${asSme() ? `<button class="btn btn-primary" type="button" data-act="go" data-href="#/sme/outward/new">New request</button>` : ''}
        ${isAD2() && !acting() ? `<button class="btn btn-primary" type="button" data-act="assist-pick" data-dir="outward">New request for an SME</button>` : ''}
        <button class="btn btn-plain" type="button" data-act="export-csv" data-what="outward">Export CSV</button></div></div>
    <div class="card">
      <div class="tabs">${tabs}</div>
      <div class="toolbar">
        <input type="search" placeholder="Search request, beneficiary or reference" value="${esc(outSearch)}" data-act="out-search" aria-label="Search outward requests">
        <div class="spacer"></div>
        <span style="color:var(--muted);font-size:var(--fs-sm)">${list.length} of ${base.length}</span>
      </div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Request</th>${isAD2() ? '<th>SME</th>' : ''}<th>Beneficiary</th><th>Currency</th>
          <th class="num">Amount</th><th>Purpose</th><th>Requested</th><th>Status</th><th>Pending with</th><th></th></tr></thead>
        <tbody>${list.length ? outwardRows(list)
          : `<tr><td colspan="10">${empty('No outward remittance found','Nothing matches the current tab and search.')}</td></tr>`}</tbody>
      </table></div></div>
    </div>`);
}

/* ---------- 12. outward: create ------------------------------------------- */
let OR_DRAFT = null;
function newOutwardDraft() {
  return {
    id:null, smeId:ctxSmeId(), beneficiaryId:'', beneficiary:'', beneficiaryCountry:'', beneficiaryAccount:'',
    beneficiaryBank:'', beneficiaryBankCountry:'', swift:'',
    currency:'', amount:'', remittanceType:'', purposeCode:'', executionDate:'', debitAccountId:'',
    referenceNumber:'', allocations:[], docs:{},
    rate:{ mode:'none', refRate:0, margin:0, customerRate:0, bookedAt:null, expiresAt:null, dealRef:null },
    status:'Draft'
  };
}

/* currencies available: enabled list for an SME, everything for an AD2 maker */
function availableCurrencies(smeRec) {
  if (isAD2()) return DB.currencies.map(c => c.code);
  return smeRec?.config?.currencies || [];
}

function viewOutwardNew() {
  const me = sme(OR_DRAFT ? OR_DRAFT.smeId : ctxSmeId()) || sme(ctxSmeId());
  if (!OR_DRAFT) OR_DRAFT = newOutwardDraft();
  const d = OR_DRAFT;
  const p = purpose(d.purposeCode);
  const rt = rtype(d.remittanceType);
  const accounts = smeAccounts(d.smeId);
  const curs = availableCurrencies(me);
  const checklist = checklistFor(d.purposeCode, d.remittanceType);
  const benePool = smeBenes(d.smeId);
  const selBene = bene(d.beneficiaryId);
  const beneCurWarn = !!(selBene && d.currency && selBene.currency && selBene.currency !== d.currency);

  /* pricing */
  const margin = d.currency ? marginFor(me, d.currency) : 0;
  const rate = d.rate.mode === 'none' ? customerRate(d.currency, margin) : d.rate.customerRate;
  const amt = Number(d.amount) || 0;
  const charges = me?.config?.charges || [];
  const chargeTotal = charges.reduce((s, c) => s + (c.basis === 'Fixed' ? c.value : amt * rate * c.value / 100), 0);
  const debitEstimate = amt * rate + chargeTotal;

  /* documents resolved from the purpose code, plus anything the remittance type
     adds — the fix for the shared-list defect */
  const docSection = !p ? `
      <div class="note note-info"><span>Select a remittance type and purpose code to load the document checklist.</span></div>`
    : `<div class="note note-info" style="margin-bottom:14px">
        <span>Checklist for <b>${esc(p.code)} — ${esc(p.label)}</b>${rt ? ` settled as <b>${esc(rt.label)}</b>` : ''}.
        Changing either replaces this list.</span></div>
      <div class="doclist">${checklist.map(doc => {
        const up = d.docs[doc.id];
        return `<div class="docrow ${up ? 'uploaded' : ''}">
          <span class="nm">${esc(doc.name)}${doc.required ? '<span class="req">*</span>' : ''}
            <small>${up ? esc(up.filename) : (doc.required ? 'Required' : 'Optional')}</small></span>
          <span class="spacer"></span>
          ${up ? `<button class="btn btn-link" type="button" data-act="or-doc-del" data-id="${doc.id}">Remove</button>`
               : `<button class="btn btn-plain btn-sm" type="button" data-act="or-doc-add" data-id="${doc.id}">Upload</button>`}
        </div>`; }).join('')}</div>`;

  /* rate box */
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
          <div class="live">Deal ${esc(d.rate.dealRef)}</div>
          <div class="tick">Rate agreed with the bank offline. Pricing below is indicative.</div></div>
        <div class="spacer"></div>
        <button class="btn btn-plain btn-sm" type="button" data-act="or-rate-clear">Clear</button>
      </div></div>`;
  } else if (!d.currency) {
    rateBox = `<div class="note note-info"><span>Select a currency to see the live rate.</span></div>`;
  } else {
    rateBox = `<div class="ratebox"><div class="row">
        <div><div class="k" style="font-size:var(--fs-xs);text-transform:uppercase;color:#0b5f61">Live rate (simulated feed)</div>
          <div class="live">1 ${esc(d.currency)} = ₹ ${rate.toFixed(4)}</div>
          <div class="tick">Reference ₹${currency(d.currency).refRate.toFixed(4)} + margin ${margin} paise · refreshes every 30 seconds</div></div>
        <div class="spacer"></div>
        <button class="btn btn-primary" type="button" data-act="or-book-rate">Book rate</button>
        <button class="btn btn-ghost" type="button" data-act="or-deal-ref">Enter FX deal reference</button>
      </div>
      <p style="margin:10px 0 0;font-size:var(--fs-xs);color:#0b5f61">
        Booking locks the rate for 48 hours and notifies treasury. No bank approval is required.
        If you have negotiated a rate by phone, enter the deal reference instead.</p></div>`;
  }

  /* bill allocation — import bills only */
  const openBills = DB.bills.filter(b =>
    b.smeId === d.smeId && b.type === 'Import' && b.outstanding > 0 &&
    (!d.currency || b.currency === d.currency) && b.review === 'Accepted');
  const allocated = d.allocations.reduce((s, a) => s + a.amount, 0);

  return shell(crumb('Outward Remittance','New request'), `
    <div class="page-head"><div><h1>New outward request</h1>
      <p>Payment to an overseas beneficiary. Documents are driven by the purpose code you select.</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="go" data-href="#/sme/outward">Cancel</button></div></div>

    <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);align-items:start">
      <div class="grid" style="gap:20px">

        <div class="card"><div class="card-head"><h2>Beneficiary</h2>
          <div class="acts">
            <button class="btn btn-ghost btn-sm" type="button" data-act="bene-new">Add new beneficiary</button>
          </div></div><div class="card-body">
          <div class="f" data-fld="beneficiary" style="margin-bottom:${d.beneficiary ? 'var(--s4)' : '0'}">
            <label for="or-bene">Select a beneficiary<span class="req">*</span></label>
            <select id="or-bene" data-act="bene-pick">
              <option value="">Select from your beneficiary master…</option>
              ${benePool.map(x => `<option value="${x.id}" ${d.beneficiaryId === x.id ? 'selected' : ''}>
                ${esc(x.name)} · ${esc(x.bank)} · ${esc(x.currency)}${x.country ? ' · ' + esc(x.country) : ''}</option>`).join('')}
              ${d.beneficiary && !d.beneficiaryId ? `<option value="__oneoff" selected>${esc(d.beneficiary)} (one-off, not saved)</option>` : ''}
            </select>
            <div class="hint">${benePool.length
              ? benePool.length + ' saved beneficiar' + (benePool.length === 1 ? 'y' : 'ies') + '. Add a new one if the payee is not listed.'
              : 'No beneficiaries saved yet — add the first one.'}</div>
            <div class="err">Select a beneficiary, or add a new one.</div></div>

          ${d.beneficiary ? `
            <div class="note ${beneCurWarn ? 'note-warn' : 'note-ok'}" style="margin-bottom:var(--s4)"><span>
              ${beneCurWarn
                ? `This beneficiary's account is held in <b>${esc(selBene.currency)}</b> but you are remitting <b>${esc(d.currency)}</b>. Confirm the payee can receive ${esc(d.currency)}.`
                : 'Details below are what will be sent. They are snapshotted onto the request, so later edits to the master will not change this payment.'}</span></div>
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

        <div class="card"><div class="card-head"><h2>Remittance</h2></div><div class="card-body">
          <div class="grid g2 fields">
            <div class="f" data-fld="currency"><label for="or-currency">Currency<span class="req">*</span></label>
              <select id="or-currency" data-ork="currency"><option value="">Select…</option>
                ${curs.map(c => `<option ${d.currency === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
              <div class="hint">${isAD2() ? 'AD2-initiated requests may use any supported currency.' : 'Only currencies enabled on your approval are listed.'}</div>
              <div class="err">Select a currency.</div></div>
            ${fldOR('amount','Amount',d.amount,{required:true,type:'number'})}
            <div class="f span2" data-fld="remittanceType"><label for="or-rtype">Remittance type<span class="req">*</span></label>
              <select id="or-rtype" data-ork="remittanceType"><option value="">Select…</option>
                ${typesFor('outward').map(x =>
                  `<option value="${x.id}" ${d.remittanceType === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
              <div class="hint">${rt ? esc(rt.hint) : 'How the payment settles. This narrows the purpose codes below.'}</div>
              <div class="err">Select a remittance type.</div></div>
            <div class="f span2" data-fld="purposeCode"><label for="or-purpose">Purpose of remittance<span class="req">*</span></label>
              <select id="or-purpose" data-ork="purposeCode"><option value="">Select…</option>
                ${purposesFor('outward', d.remittanceType).map(x =>
                  `<option value="${x.code}" ${d.purposeCode === x.code ? 'selected' : ''}>${x.code} — ${esc(x.label)}</option>`).join('')}</select>
              <div class="hint">${d.remittanceType
                  ? `Showing the ${purposesFor('outward', d.remittanceType).length} purpose code(s) valid for this remittance type.`
                  : 'RBI purpose code. The document checklist below is resolved from this.'}</div>
              <div class="err">Select a purpose code.</div></div>
            ${fldOR('executionDate','Requested execution date',d.executionDate,{required:true,type:'date'})}
            <div class="f" data-fld="debitAccountId"><label for="or-debit">Remitter account<span class="req">*</span></label>
              <select id="or-debit" data-ork="debitAccountId"><option value="">Select…</option>
                ${accounts.map(a => `<option value="${a.id}" ${d.debitAccountId === a.id ? 'selected' : ''}>
                  ${esc(a.bank)} · ${esc(a.accountNumber)} · ${esc(a.currency)}${a.verified ? '' : ' (unverified)'}</option>`).join('')}</select>
              <div class="hint">From your account master. <button class="btn-link" type="button" data-act="go" data-href="#/sme/profile">Manage accounts</button></div>
              <div class="err">Select a remitter account.</div></div>
            <div class="f span2"><label for="or-ref">Reference number</label>
              <input id="or-ref" data-ork="referenceNumber" type="text" value="${esc(d.referenceNumber)}" placeholder="Optional free text">
              <div class="hint">Optional. Your own reference, carried through to the advice.</div></div>
          </div></div></div>

        <div class="card"><div class="card-head"><h2>Rate</h2></div><div class="card-body">${rateBox}</div></div>

        <div class="card"><div class="card-head"><h2>Bill allocation</h2>
          <div class="acts"><span style="color:var(--muted);font-size:var(--fs-sm)">
            Allocated ${money(allocated)} of ${money(amt)}</span></div></div>
          <div class="card-body tight">
            ${openBills.length ? `<div class="tablewrap"><table class="dt">
              <thead><tr><th>Bill</th><th>Invoice</th><th>Counterparty</th><th class="num">Outstanding</th><th class="num">Allocate</th></tr></thead>
              <tbody>${openBills.map(b => {
                const a = d.allocations.find(x => x.billId === b.id);
                return `<tr class="${a ? 'sel' : ''}"><td class="id">${esc(b.id)}</td><td>${esc(b.invoiceNumber)}</td>
                  <td>${esc(b.counterparty)}</td><td class="num">${money(b.outstanding, b.currency)}</td>
                  <td class="num"><input type="number" style="width:130px;text-align:right;border:1px solid var(--r4m-input-border);border-radius:6px;padding:6px 8px;font-family:inherit"
                    data-act="or-alloc" data-bill="${b.id}" value="${a ? a.amount : ''}" placeholder="0.00" min="0" max="${b.outstanding}"></td></tr>`;
              }).join('')}</tbody></table></div>`
            : empty('No matching import bills', d.currency
                ? `No accepted import bills outstanding in ${d.currency}. Lodge a bill first, or submit unlinked if your configuration permits it.`
                : 'Select a currency to see matching import bills.')}
          </div></div>

        <div class="card"><div class="card-head"><h2>Documents</h2></div>
          <div class="card-body">${docSection}</div></div>
      </div>

      <div class="card" style="position:sticky;top:130px"><div class="card-head"><h2>Pricing</h2></div>
        <div class="card-body">
          <div class="calc">
            <div class="line"><span>Amount</span><b>${d.currency ? money(amt, d.currency) : '—'}</b></div>
            <div class="line"><span>Reference rate</span><b>${d.currency ? '₹ ' + currency(d.currency).refRate.toFixed(4) : '—'}</b></div>
            <div class="line"><span>Margin</span><b>${margin} paise</b></div>
            <div class="line"><span>Customer rate</span><b>${d.currency ? '₹ ' + rate.toFixed(4) : '—'}</b></div>
            ${charges.map(c => `<div class="line"><span>${esc(c.name)}</span><b>${inr(c.basis === 'Fixed' ? c.value : amt * rate * c.value / 100)}</b></div>`).join('')}
            <div class="line total"><span>Estimated debit</span><b>${inr(debitEstimate)}</b></div>
          </div>
          <p style="font-size:var(--fs-xs);color:var(--muted);margin:12px 0 0">
            ${d.rate.mode === 'none'
              ? 'Illustrative — not backed by a booked rate. Book a rate or enter a deal reference before submitting.'
              : 'Based on your ' + (d.rate.mode === 'booked' ? 'booked rate.' : 'negotiated deal reference.')}
            Quote timestamp ${dmyt(nowISO())}.</p>
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
    <input id="or-${id}" data-ork="${id}" type="${opts.type || 'text'}" value="${esc(val)}" placeholder="${esc(opts.ph || '')}">
    ${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ''}
    <div class="err">This field is required.</div>
  </div>`;

const OR_LABELS = {
  beneficiary:'Beneficiary (select one or add a new one)',
  beneficiaryCountry:'Beneficiary country', beneficiaryAccount:'Account number / IBAN',
  swift:'SWIFT / BIC', beneficiaryBank:'Bank name', beneficiaryBankCountry:'Bank country',
  currency:'Currency', remittanceType:'Remittance type', purposeCode:'Purpose of remittance',
  executionDate:'Requested execution date',
  debitAccountId:'Remitter account', amount:'Amount',
};

function outwardMissing(d) {
  const m = [];
  ['beneficiary','beneficiaryCountry','beneficiaryAccount','swift','beneficiaryBank','beneficiaryBankCountry',
   'currency','remittanceType','purposeCode','executionDate','debitAccountId'].forEach(k => { if (!d[k]) m.push(OR_LABELS[k]); });
  if (!(Number(d.amount) > 0)) m.push(OR_LABELS.amount);
  checklistFor(d.purposeCode, d.remittanceType)
    .filter(x => x.required && !d.docs[x.id]).forEach(x => m.push('document: ' + x.name));
  if (d.rate.mode === 'none') m.push('booked rate or FX deal reference');
  const allocated = d.allocations.reduce((s, a) => s + a.amount, 0);
  if (allocated > Number(d.amount)) m.push('allocation exceeds the remittance amount');
  if (!allocated && !DB.settings.allowUnlinked) m.push('at least one linked import bill');
  return m;
}

/* ---------- 13. outward: detail ------------------------------------------- */
function viewOutwardDetail(id) {
  const o = DB.outward.find(x => x.id === id);
  if (!o) return shell(crumb('Outward Remittance','Not found'), empty('Request not found','This request does not exist or you cannot access it.'));
  if (isSME() && o.smeId !== ctxSmeId())
    return shell(crumb('Outward Remittance'), `<div class="card"><div class="denied"><div class="ic">⊘</div>
      <h3>Access denied</h3><p>This request belongs to another SME.</p></div></div>`);

  const s = sme(o.smeId), p = purpose(o.purposeCode), a = acct(o.debitAccountId);
  const ort = rtype(o.remittanceType);
  const chargeTotal = (o.charges || []).reduce((x, c) => x + c.amount, 0);
  const debit = o.amount * (o.rate.customerRate || 0) + chargeTotal;
  const root = isAD2() ? 'ad2' : 'sme';

  const actions = [];
  if (asSme() && o.status === 'Draft') actions.push(`<button class="btn btn-primary" type="button" data-act="or-submit-existing" data-id="${o.id}">Submit</button>`);
  if (asSme() && o.status === 'Clarification Required') actions.push(`<button class="btn btn-primary" type="button" data-act="or-respond" data-id="${o.id}">Respond to query</button>`);
  if (isAD2() && ['Submitted','Under Review'].includes(o.status)) {
    actions.push(`<button class="btn btn-primary" type="button" data-act="or-approve" data-id="${o.id}">Approve for processing</button>`);
    actions.push(`<button class="btn btn-plain" type="button" data-act="or-query" data-id="${o.id}">Raise query</button>`);
    actions.push(`<button class="btn btn-danger" type="button" data-act="or-reject" data-id="${o.id}">Reject</button>`);
  }
  if (isAD2() && o.status === 'Processing') actions.push(`<button class="btn btn-primary" type="button" data-act="or-complete" data-id="${o.id}">Mark completed</button>`);

  return shell(crumb('Outward Remittance', o.id), `
    <div class="page-head"><div><h1>${esc(o.id)} ${badge(o.status)}</h1>
      <p>${esc(o.beneficiary)} · ${money(o.amount, o.currency)}${isAD2() ? ' · ' + esc(s?.tradingName || '') : ''}</p></div>
      <div class="acts">${actions.join('')}
        <button class="btn btn-plain" type="button" data-act="go" data-href="#/${root}/outward">Back to list</button></div></div>

    ${o.status === 'Clarification Required' && o.query ? `<div class="note note-warn" style="margin-bottom:18px">
      <span><b>Query from AD2:</b> ${esc(o.query.question)} <br>
      <small>${esc(o.query.raisedBy)} · ${dmyt(o.query.raisedAt)}</small>
      ${o.query.response ? `<br><b>Response:</b> ${esc(o.query.response)}` : ''}</span></div>` : ''}
    ${o.status === 'Rejected' && o.rejectReason ? `<div class="note note-err" style="margin-bottom:18px">
      <span><b>Rejected:</b> ${esc(o.rejectReason)}</span></div>` : ''}

    <div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);align-items:start">
      <div class="grid" style="gap:20px">
        <div class="card"><div class="card-head"><h2>Beneficiary</h2></div><div class="card-body"><div class="kv">
          <div><div class="k">Name</div><div class="v">${esc(o.beneficiary)}
            ${o.beneficiaryId && bene(o.beneficiaryId) ? '<br><span class="badge b-teal" style="margin-top:4px">From beneficiary master</span>'
              : '<br><span class="badge b-grey" style="margin-top:4px">One-off payee</span>'}</div></div>
          <div><div class="k">Country</div><div class="v">${esc(o.beneficiaryCountry)}</div></div>
          <div><div class="k">Account / IBAN</div><div class="v">${esc(o.beneficiaryAccount)}</div></div>
          <div><div class="k">SWIFT</div><div class="v">${esc(o.swift)}</div></div>
          <div><div class="k">Bank</div><div class="v">${esc(o.beneficiaryBank)}</div></div>
          <div><div class="k">Bank country</div><div class="v">${esc(o.beneficiaryBankCountry)}</div></div>
        </div></div></div>

        <div class="card"><div class="card-head"><h2>Remittance</h2></div><div class="card-body"><div class="kv">
          <div><div class="k">Currency</div><div class="v">${esc(o.currency)}</div></div>
          <div><div class="k">Amount</div><div class="v big">${money(o.amount)}</div></div>
          <div><div class="k">Remittance type</div><div class="v">${esc(ort ? ort.label : '—')}</div></div>
          <div><div class="k">Purpose of remittance</div><div class="v">${esc(p ? p.code + ' — ' + p.label : '—')}</div></div>
          <div><div class="k">Execution date</div><div class="v">${dmy(o.executionDate)}</div></div>
          <div><div class="k">Remitter account</div><div class="v">${a ? esc(a.bank + ' · ' + a.accountNumber) : '—'}</div></div>
          <div><div class="k">Reference number</div><div class="v">${esc(o.referenceNumber || '—')}</div></div>
          <div><div class="k">Raised by</div><div class="v">${o.source === 'AD2 Assisted'
              ? `<span class="badge b-purple">Assisted</span> ${esc(o.createdBy || 'AD2')}`
              : esc(o.createdBy || 'SME user')}</div></div>
        </div></div></div>

        <div class="card"><div class="card-head"><h2>Documents</h2></div><div class="card-body">
          ${p ? `<div class="doclist">${checklistFor(o.purposeCode, o.remittanceType).map(doc => `
            <div class="docrow uploaded"><span class="nm">${esc(doc.name)}
              <small>${doc.required ? 'Required' : 'Optional'} · on file (simulated)</small></span>
              <span class="spacer"></span><span class="badge b-green">Received</span></div>`).join('')}</div>`
            : empty('No checklist','No purpose code is set on this request.')}</div></div>

        <div class="card"><div class="card-head"><h2>Bill allocation</h2></div><div class="card-body tight">
          ${o.allocations && o.allocations.length ? `<div class="tablewrap"><table class="dt">
            <thead><tr><th>Bill</th><th>Invoice</th><th class="num">Allocated</th><th>Settlement</th></tr></thead>
            <tbody>${o.allocations.map(al => { const b = bill(al.billId);
              return `<tr><td class="id">${esc(al.billId)}</td><td>${esc(b?.invoiceNumber || '—')}</td>
                <td class="num">${money(al.amount, o.currency)}</td><td>${badge(b?.settlement || 'Unsettled')}</td></tr>`;
            }).join('')}</tbody></table></div>`
            : empty('Unlinked request','No import bills are linked to this remittance.')}</div></div>

        <div class="card"><div class="card-head"><h2>Activity</h2></div>
          <div class="card-body">${timeline(o.id)}</div></div>
      </div>

      <div class="grid" style="gap:20px;align-items:start">
        <div class="card"><div class="card-head"><h2>Rate and pricing</h2></div><div class="card-body">
          <div class="note ${o.rate.mode === 'none' ? 'note-warn' : 'note-ok'}" style="margin-bottom:14px"><span>
            ${o.rate.mode === 'booked' ? `Booked rate, locked for 48 hours from ${dmyt(o.rate.bookedAt)}.`
              : o.rate.mode === 'deal' ? `Negotiated offline. Deal reference <b>${esc(o.rate.dealRef)}</b>.`
              : 'No rate booked. Pricing is illustrative.'}</span></div>
          <div class="calc">
            <div class="line"><span>Reference rate</span><b>₹ ${(o.rate.refRate || 0).toFixed(4)}</b></div>
            <div class="line"><span>Margin</span><b>${o.rate.margin || 0} paise</b></div>
            <div class="line"><span>Customer rate</span><b>₹ ${(o.rate.customerRate || 0).toFixed(4)}</b></div>
            ${(o.charges || []).map(c => `<div class="line"><span>${esc(c.name)}</span><b>${inr(c.amount)}</b></div>`).join('')}
            <div class="line total"><span>Debit amount</span><b>${inr(debit)}</b></div>
          </div></div></div>
        ${isAD2() ? `<div class="card"><div class="card-head"><h2>Internal notes</h2></div><div class="card-body">
          <p style="font-size:var(--fs-sm);color:var(--muted)">Visible to AD2 users only. Hidden from the SME portal.</p>
          <div class="f"><textarea placeholder="Add an internal note"></textarea></div>
          <button class="btn btn-plain btn-sm" type="button" data-act="noop-note">Save note</button></div></div>` : ''}
      </div>
    </div>`);
}

/* ---------- 14. inward remittance ----------------------------------------- */
function viewInwardList() {
  const me = scoped() ? sme(ctxSmeId()) : null;
  if (me && !perm(me).exportSide) {
    return shell(crumb('Inward Remittance'), `<div class="card"><div class="denied"><div class="ic">⊘</div>
      <h3>Inward remittance is not enabled</h3>
      <p>Your approved service permission is “${esc(me.config.permission)}”. Inward disposal requires Export or Both.</p>
      </div></div>`);
  }
  const list = scoped() ? DB.inward.filter(i => i.smeId === ctxSmeId()) : DB.inward;
  const root = isAD2() ? 'ad2' : 'sme';
  return shell(crumb('Inward Remittance'), `
    <div class="page-head"><div><h1>Inward Remittance</h1>
      <p>Receipts recorded by AD2. Submit a disposal instruction to apply each receipt.</p></div>
      <div class="acts">
        ${isAD2() && !acting() ? `<button class="btn btn-primary" type="button" data-act="assist-pick" data-dir="inward">Disposal for an SME</button>` : ''}
        <button class="btn btn-plain" type="button" data-act="export-csv" data-what="inward">Export CSV</button></div></div>
    <div class="card"><div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Reference</th>${isAD2() ? '<th>SME</th>' : ''}<th>Remitter</th><th>Value date</th>
        <th>Currency</th><th class="num">Received</th><th class="num">Available</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.length ? list.map(i => `
        <tr><td class="id" data-act="go" data-href="#/${root}/inward/${i.id}">${esc(i.reference)}</td>
          ${isAD2() ? `<td>${esc(sme(i.smeId)?.tradingName || '')}</td>` : ''}
          <td>${esc(i.remitter)}<br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(i.remitterCountry)}</span></td>
          <td>${dmy(i.valueDate)}</td><td>${esc(i.currency)}</td>
          <td class="num">${money(i.amount)}</td><td class="num">${money(i.available)}</td>
          <td>${badge(i.status)}</td>
          <td style="white-space:nowrap">${
            i.available > 0 && asSme()
              ? `<button class="btn btn-ghost btn-sm" type="button" data-act="go" data-href="#/sme/inward/${i.id}/dispose">Dispose</button>`
              : i.available > 0 && isAD2()
                ? `<button class="btn btn-ghost btn-sm" type="button" data-act="assist-dispose" data-id="${i.id}">Dispose on behalf</button>`
                : `<button class="btn btn-link" type="button" data-act="go" data-href="#/${root}/inward/${i.id}">Open</button>`}</td></tr>`).join('')
        : `<tr><td colspan="9">${empty('No inward remittance found','Receipts appear here once AD2 records them.')}</td></tr>`}</tbody>
    </table></div></div></div>`);
}

function viewInwardDetail(id) {
  const i = DB.inward.find(x => x.id === id);
  if (!i) return shell(crumb('Inward Remittance','Not found'), empty('Receipt not found',''));
  if (isSME() && i.smeId !== ctxSmeId())
    return shell(crumb('Inward Remittance'), `<div class="card"><div class="denied"><div class="ic">⊘</div>
      <h3>Access denied</h3><p>This receipt belongs to another SME.</p></div></div>`);
  const root = isAD2() ? 'ad2' : 'sme';
  const dis = DB.disposals.filter(d => d.inwardId === i.id);
  return shell(crumb('Inward Remittance', i.reference), `
    <div class="page-head"><div><h1>${esc(i.reference)} ${badge(i.status)}</h1>
      <p>${esc(i.remitter)} · ${money(i.amount, i.currency)} received ${dmy(i.valueDate)}</p></div>
      <div class="acts">
        ${i.available > 0 && asSme() ? `<button class="btn btn-primary" type="button" data-act="go" data-href="#/sme/inward/${i.id}/dispose">Submit disposal instruction</button>` : ''}
        ${i.available > 0 && isAD2() && !acting() ? `<button class="btn btn-primary" type="button" data-act="assist-dispose" data-id="${i.id}">Dispose on behalf</button>` : ''}
        <button class="btn btn-plain" type="button" data-act="go" data-href="#/${root}/inward">Back to list</button></div></div>
    <div class="grid g2" style="align-items:start">
      <div class="card"><div class="card-head"><h2>Receipt</h2></div><div class="card-body"><div class="kv">
        <div><div class="k">Reference</div><div class="v">${esc(i.reference)}</div></div>
        <div><div class="k">Value date</div><div class="v">${dmy(i.valueDate)}</div></div>
        <div><div class="k">Remitter</div><div class="v">${esc(i.remitter)}</div></div>
        <div><div class="k">Remitter country</div><div class="v">${esc(i.remitterCountry)}</div></div>
        <div><div class="k">Received</div><div class="v big">${money(i.amount, i.currency)}</div></div>
        <div><div class="k">Available for disposal</div><div class="v big">${money(i.available, i.currency)}</div></div>
        <div><div class="k">Remittance type</div><div class="v">${esc(rtype(i.remittanceType)?.label || '—')}</div></div>
        <div><div class="k">Purpose of remittance</div><div class="v">${esc(purpose(i.purposeCode) ? i.purposeCode + ' — ' + purpose(i.purposeCode).label : (i.purposeCode || '—'))}</div></div>
        <div><div class="k">FIRC</div><div class="v">${i.firc ? esc(i.firc) : 'Issued on processing'}</div></div>
        <div class="span2"><div class="k">Remarks</div><div class="v">${esc(i.remarks || '—')}</div></div>
      </div>
      ${i.firc ? `<div class="note note-ok" style="margin-top:16px"><span>
        FIRC ${esc(i.firc)} issued by AD1 and sent to the customer.</span></div>` : ''}
      </div></div>
      <div class="card"><div class="card-head"><h2>Disposal instructions</h2></div><div class="card-body tight">
        ${dis.length ? `<div class="tablewrap"><table class="dt">
          <thead><tr><th>Instruction</th><th class="num">Amount</th><th>Credit account</th><th>Status</th></tr></thead>
          <tbody>${dis.map(d => { const a = acct(d.creditAccountId);
            return `<tr><td class="id">${esc(d.id)}</td><td class="num">${money(d.amount, d.currency)}</td>
              <td>${a ? esc(a.bank + ' · ' + a.accountNumber) : '—'}</td><td>${badge(d.status)}</td></tr>`;
          }).join('')}</tbody></table></div>`
          : empty('No instruction yet','Submit a disposal instruction to apply this receipt.')}</div></div>
    </div>
    <div class="card" style="margin-top:20px"><div class="card-head"><h2>Activity</h2></div>
      <div class="card-body">${timeline(i.id)}</div></div>`);
}

/* ---------- 15. disposal instruction --------------------------------------
   Reduced to two decisions per the requirements call: which export bill to
   knock off, and which account to credit. Trade-finance disposal is out.    */
let DI_DRAFT = null;
function viewDispose(inwardId) {
  const i = DB.inward.find(x => x.id === inwardId);
  if (!i) return shell(crumb('Inward Remittance','Not found'), empty('Receipt not found',''));
  if (!DI_DRAFT || DI_DRAFT.inwardId !== inwardId) {
    DI_DRAFT = { inwardId, smeId:i.smeId, amount:'', currency:i.currency, creditAccountId:'',
      allocations:[], remarks:'', docs:{},
      /* seeded from the receipt AD2 recorded; the SME can correct either */
      remittanceType:i.remittanceType || '', purposeCode:i.purposeCode || '',
      rate:{ mode:'none', refRate:0, margin:0, customerRate:0, bookedAt:null, dealRef:null } };
  }
  const d = DI_DRAFT;
  const me = sme(i.smeId);
  const accounts = smeAccounts(i.smeId);
  const openBills = DB.bills.filter(b => b.smeId === i.smeId && b.type === 'Export'
    && b.outstanding > 0 && b.currency === i.currency && b.review === 'Accepted');
  const allocated = d.allocations.reduce((s, a) => s + a.amount, 0);
  const margin = marginFor(me, i.currency);
  const rate = d.rate.mode === 'none' ? customerRate(i.currency, -margin) : d.rate.customerRate;
  const drt = rtype(d.remittanceType);
  const dp  = purpose(d.purposeCode);
  const dChecklist = checklistFor(d.purposeCode, d.remittanceType);

  let rateBox;
  if (d.rate.mode === 'booked') {
    rateBox = `<div class="ratebox locked"><div class="row"><div>
        <div class="live">1 ${esc(i.currency)} = ₹ ${d.rate.customerRate.toFixed(4)}</div>
        <div class="tick">Booked ${dmyt(d.rate.bookedAt)} · locked 48 hours · treasury notified</div></div>
      <div class="spacer"></div>
      <button class="btn btn-plain btn-sm" type="button" data-act="di-rate-clear">Release</button></div></div>`;
  } else if (d.rate.mode === 'deal') {
    rateBox = `<div class="ratebox locked"><div class="row"><div>
        <div class="live">Deal ${esc(d.rate.dealRef)}</div>
        <div class="tick">Rate agreed with the bank offline.</div></div>
      <div class="spacer"></div>
      <button class="btn btn-plain btn-sm" type="button" data-act="di-rate-clear">Clear</button></div></div>`;
  } else {
    rateBox = `<div class="ratebox"><div class="row"><div>
        <div class="k" style="font-size:var(--fs-xs);text-transform:uppercase;color:#0b5f61">Live rate (simulated feed)</div>
        <div class="live">1 ${esc(i.currency)} = ₹ ${rate.toFixed(4)}</div>
        <div class="tick">Reference ₹${currency(i.currency).refRate.toFixed(4)} less margin ${margin} paise</div></div>
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
        <div class="card"><div class="card-head"><h2>1 · Export bill to knock off</h2></div>
          <div class="card-body tight">
            ${openBills.length ? `<div class="tablewrap"><table class="dt">
              <thead><tr><th>Bill</th><th>Invoice</th><th>Counterparty</th><th>Due</th>
                <th class="num">Outstanding</th><th class="num">Apply</th></tr></thead>
              <tbody>${openBills.map(b => { const a = d.allocations.find(x => x.billId === b.id);
                return `<tr class="${a ? 'sel' : ''}"><td class="id">${esc(b.id)}</td><td>${esc(b.invoiceNumber)}</td>
                  <td>${esc(b.counterparty)}</td><td>${dmy(b.dueDate)}</td>
                  <td class="num">${money(b.outstanding, b.currency)}</td>
                  <td class="num"><input type="number" style="width:130px;text-align:right;border:1px solid var(--r4m-input-border);border-radius:6px;padding:6px 8px;font-family:inherit"
                    data-act="di-alloc" data-bill="${b.id}" value="${a ? a.amount : ''}" placeholder="0.00" min="0" max="${Math.min(b.outstanding, i.available)}"></td></tr>`;
              }).join('')}</tbody></table></div>`
            : empty('No outstanding export bills', `No accepted export bills outstanding in ${i.currency}. Lodge an export bill first.`)}
          </div></div>

        <div class="card"><div class="card-head"><h2>2 · Account to credit</h2></div><div class="card-body">
          <div class="f" data-fld="creditAccountId"><label for="di-acct">Credit account<span class="req">*</span></label>
            <select id="di-acct" data-dik="creditAccountId"><option value="">Select…</option>
              ${accounts.map(a => `<option value="${a.id}" ${d.creditAccountId === a.id ? 'selected' : ''}>
                ${esc(a.bank)} · ${esc(a.accountNumber)} · ${esc(a.currency)} · ${esc(a.type)}${a.verified ? '' : ' (unverified)'}</option>`).join('')}</select>
            <div class="hint">From your saved accounts. <button class="btn-link" type="button" data-act="go" data-href="#/sme/profile">Manage accounts</button></div>
            <div class="err">Select an account to credit.</div></div>
          </div></div>

        <div class="card"><div class="card-head"><h2>Purpose and remittance type</h2>
          <div class="acts"><span style="color:var(--muted);font-size:var(--fs-sm)">Regulatory classification of the receipt</span></div></div>
          <div class="card-body">
          <div class="note note-info" style="margin-bottom:14px"><span>
            Pre-filled from the receipt AD2 recorded. Correct it here if the receipt was classified
            before the underlying trade was known.</span></div>
          <div class="grid g2 fields">
            <div class="f" data-fld="di-remittanceType"><label for="di-rtype">Remittance type<span class="req">*</span></label>
              <select id="di-rtype" data-dik="remittanceType"><option value="">Select…</option>
                ${typesFor('inward').map(x =>
                  `<option value="${x.id}" ${d.remittanceType === x.id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select>
              <div class="hint">${drt ? esc(drt.hint) : 'How the receipt arises. This narrows the purpose codes.'}</div>
              <div class="err">Select a remittance type.</div></div>
            <div class="f" data-fld="di-purposeCode"><label for="di-purpose">Purpose of remittance<span class="req">*</span></label>
              <select id="di-purpose" data-dik="purposeCode"><option value="">Select…</option>
                ${purposesFor('inward', d.remittanceType).map(x =>
                  `<option value="${x.code}" ${d.purposeCode === x.code ? 'selected' : ''}>${x.code} — ${esc(x.label)}</option>`).join('')}</select>
              <div class="hint">${d.remittanceType
                  ? `Showing the ${purposesFor('inward', d.remittanceType).length} purpose code(s) valid for this type.`
                  : 'RBI purpose code for the inward receipt.'}</div>
              <div class="err">Select a purpose code.</div></div>
          </div>
          ${dp ? `<div style="margin-top:18px">
            <div class="k" style="font-size:var(--fs-xs);text-transform:uppercase;color:var(--muted);margin-bottom:8px">
              Documents required for ${esc(dp.code)}${drt ? ' · ' + esc(drt.label) : ''}</div>
            <div class="doclist">${dChecklist.map(doc => {
              const up = d.docs[doc.id];
              return `<div class="docrow ${up ? 'uploaded' : ''}">
                <span class="nm">${esc(doc.name)}${doc.required ? '<span class="req">*</span>' : ''}
                  <small>${up ? esc(up.filename) : (doc.required ? 'Required' : 'Optional')}</small></span>
                <span class="spacer"></span>
                ${up ? `<button class="btn btn-link" type="button" data-act="di-doc-del" data-id="${doc.id}">Remove</button>`
                     : `<button class="btn btn-plain btn-sm" type="button" data-act="di-doc-add" data-id="${doc.id}">Upload</button>`}
              </div>`; }).join('')}</div></div>` : ''}
        </div></div>

        <div class="card"><div class="card-head"><h2>Rate</h2></div><div class="card-body">${rateBox}</div></div>

        <div class="card"><div class="card-head"><h2>Remarks</h2></div><div class="card-body">
          <div class="f"><label for="di-rem">Remarks</label>
            <textarea id="di-rem" data-dik="remarks">${esc(d.remarks)}</textarea></div>
        </div></div>
      </div>

      <div class="card" style="position:sticky;top:130px"><div class="card-head"><h2>Summary</h2></div><div class="card-body">
        <div class="calc">
          <div class="line"><span>Receipt available</span><b>${money(i.available, i.currency)}</b></div>
          <div class="line"><span>Applied to bills</span><b>${money(allocated, i.currency)}</b></div>
          <div class="line"><span>Conversion rate</span><b>₹ ${rate.toFixed(4)}</b></div>
          <div class="line total"><span>Credit to account</span><b>${inr(allocated * rate)}</b></div>
          <div class="line"><span>Remaining balance</span><b>${money(i.available - allocated, i.currency)}</b></div>
        </div>
        <p style="font-size:var(--fs-xs);color:var(--muted);margin:12px 0 0">
          Partial disposal is allowed. The remaining balance stays available for a later instruction.</p>
        <div style="display:grid;gap:8px;margin-top:18px">
          <button class="btn btn-plain" type="button" data-act="di-save">Save draft</button>
          <button class="btn btn-primary" type="button" data-act="di-submit" data-id="${i.id}">Submit instruction</button>
        </div></div></div>
    </div>`);
}

/* ---------- 16. bill lodgement -------------------------------------------- */
let billTab = 'register', billSearch = '';

function viewBills(type) {
  const me = scoped() ? sme(ctxSmeId()) : null;
  if (me) {
    const pm = perm(me);
    if ((type === 'Import' && !pm.importSide) || (type === 'Export' && !pm.exportSide)) {
      return shell(crumb('Bill Lodgement', type), `<div class="card"><div class="denied"><div class="ic">⊘</div>
        <h3>${esc(type)} bill lodgement is not enabled</h3>
        <p>Your approved service permission is “${esc(me.config.permission)}”.</p></div></div>`);
    }
  }
  let list = DB.bills.filter(b => b.type === type && (!scoped() || b.smeId === ctxSmeId()));
  if (billSearch) {
    const q = billSearch.toLowerCase();
    list = list.filter(b => (b.id + b.invoiceNumber + b.counterparty).toLowerCase().includes(q));
  }

  const panes = {
    register: `<div class="toolbar">
        <input type="search" placeholder="Search bill, invoice or counterparty" value="${esc(billSearch)}" data-act="bill-search" aria-label="Search bills">
        <div class="spacer"></div>
        <button class="btn btn-plain btn-sm" type="button" data-act="export-csv" data-what="bills">Export CSV</button></div>
      <div class="tablewrap"><table class="dt">
        <thead><tr><th>Bill</th>${isAD2() ? '<th>SME</th>' : ''}<th>Invoice</th><th>Counterparty</th><th>Currency</th>
          <th class="num">Original</th><th class="num">Adjusted</th><th class="num">Outstanding</th>
          <th>Due</th><th>Source</th><th>Review</th><th>Settlement</th></tr></thead>
        <tbody>${list.length ? list.map(b => `
          <tr><td class="id">${esc(b.id)}</td>${isAD2() ? `<td>${esc(sme(b.smeId)?.tradingName || '')}</td>` : ''}
            <td>${esc(b.invoiceNumber)}<br><span style="color:var(--muted);font-size:var(--fs-xs)">${dmy(b.invoiceDate)}</span></td>
            <td>${esc(b.counterparty)}<br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(b.counterpartyCountry)}</span></td>
            <td>${esc(b.currency)}</td><td class="num">${money(b.amount)}</td>
            <td class="num">${money(b.adjusted)}</td><td class="num"><b>${money(b.outstanding)}</b></td>
            <td>${dmy(b.dueDate)}</td><td>${esc(b.source)}</td>
            <td>${badge(b.review)}</td><td>${badge(b.settlement)}</td></tr>`).join('')
          : `<tr><td colspan="12">${empty('No bills lodged','Lodge a bill by form, CSV upload, SFTP or the SAP integration.')}</td></tr>`}</tbody>
      </table></div>`,

    form: billForm(type),

    upload: `<div class="card-body">
        <div class="note note-info" style="margin-bottom:16px"><span>
          Download the template, paste or upload rows, validate, then confirm. Failed rows are preserved for correction.</span></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          <button class="btn btn-plain btn-sm" type="button" data-act="csv-template">Download CSV template</button>
          <button class="btn btn-plain btn-sm" type="button" data-act="csv-sample">Load sample rows</button></div>
        <div class="f"><label for="csvbox">CSV rows</label>
          <textarea id="csvbox" style="min-height:150px;font-family:ui-monospace,Menlo,monospace;font-size:12px"
            placeholder="invoice_number,invoice_date,counterparty,country,currency,amount,due_date,order_ref"></textarea></div>
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
          <div><div class="k">Duplicate control</div><div class="v">External reference key</div></div>
          <div><div class="k">Connection</div><div class="v"><span class="badge b-green">Connected</span> <span style="color:var(--muted);font-size:var(--fs-xs)">simulated</span></div></div>
        </div>${jobsTable('SAP API')}</div>`,
  };

  const tabDefs = [['register','Bill register'],['form','New bill'],['upload','File upload'],['sftp','SFTP'],['sap','SAP API']];

  return shell(crumb('Bill Lodgement', type + ' Bill Lodgement'), `
    <div class="page-head"><div><h1>${esc(type)} Bill Lodgement</h1>
      <p>${type === 'Export'
        ? 'Lodged export bills drive knock-off against inward remittances.'
        : 'Lodged import bills drive allocation against outward remittances.'}</p></div></div>
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
        <td>${j.rejected ? `<button class="btn btn-plain btn-sm" type="button" data-act="job-retry" data-id="${j.id}">Retry</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>`;
}

let BILL_DRAFT = null;
function billForm(type) {
  if (!BILL_DRAFT || BILL_DRAFT.type !== type) {
    BILL_DRAFT = { type, invoiceNumber:'', invoiceDate:'', counterparty:'', counterpartyCountry:'',
      currency:'', amount:'', dueDate:'', orderRef:'', shipmentRef:'', extracted:null };
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
      Upload the invoice and document AI will prefill these fields. Every extracted value stays editable and
      you confirm before the bill is created.</span></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
      <button class="btn btn-ghost" type="button" data-act="bill-ai" data-type="${type}">Upload invoice and extract</button>
      <button class="btn btn-plain" type="button" data-act="bill-doc">Attach bill document</button></div>
    <div class="grid g2 fields">
      ${f('invoiceNumber','Invoice number',{required:true})}
      ${f('invoiceDate','Invoice date',{required:true,type:'date'})}
      ${f('counterparty','Counterparty name',{required:true})}
      ${f('counterpartyCountry','Counterparty country',{required:true})}
      ${f('currency','Currency',{required:true,options:curs})}
      ${f('amount','Invoice amount',{required:true,type:'number'})}
      ${f('dueDate','Due date',{required:true,type:'date'})}
      ${f('orderRef',type === 'Export' ? 'Sales order reference' : 'Purchase order reference',{})}
      ${f('shipmentRef',type === 'Export' ? 'Shipping bill reference' : 'Bill of Entry reference',{})}
    </div>
    <div class="formfoot" style="margin:24px -20px -20px">
      <span style="font-size:var(--fs-sm);color:var(--muted)">
        Maker-checker: AutoChecker ${DB.settings.autoChecker ? 'enabled — bills are accepted on submission' : 'disabled — a checker must approve'}</span>
      <div class="spacer"></div>
      <button class="btn btn-plain" type="button" data-act="bill-clear">Clear</button>
      <button class="btn btn-primary" type="button" data-act="bill-save" data-type="${type}">Lodge bill</button>
    </div></div>`;
}

/* ---------- 17. bill knock-off -------------------------------------------- */
let KO = { side:'Export', currency:'', counterparty:'', allocations:[] };

function viewKnockoff() {
  const smeId = ctxSmeId();
  const bills = DB.bills.filter(b => b.smeId === smeId && b.type === KO.side && b.outstanding > 0 && b.review === 'Accepted'
    && (!KO.currency || b.currency === KO.currency)
    && (!KO.counterparty || b.counterparty === KO.counterparty));
  const rems = KO.side === 'Export'
    ? DB.inward.filter(i => i.smeId === smeId && i.available > 0 && (!KO.currency || i.currency === KO.currency))
    : DB.outward.filter(o => o.smeId === smeId && ['Completed','Processing'].includes(o.status)
        && (!KO.currency || o.currency === KO.currency));

  const counterparties = [...new Set(DB.bills.filter(b => b.smeId === smeId && b.type === KO.side).map(b => b.counterparty))];
  const totalAlloc = KO.allocations.reduce((s, a) => s + a.amount, 0);

  return shell(crumb('Bill Knock-off'), `
    <div class="page-head"><div><h1>Bill Knock-off</h1>
      <p>Apply remittances against outstanding bills. Export bills match inward receipts; import bills match outward payments.</p></div></div>

    <div class="card" style="margin-bottom:18px"><div class="toolbar">
      <select data-act="ko-side" aria-label="Bill type">
        <option ${KO.side === 'Export' ? 'selected' : ''}>Export</option>
        <option ${KO.side === 'Import' ? 'selected' : ''}>Import</option></select>
      <select data-act="ko-currency" aria-label="Currency"><option value="">All currencies</option>
        ${DB.currencies.map(c => `<option ${KO.currency === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}</select>
      <select data-act="ko-counterparty" aria-label="Counterparty"><option value="">All counterparties</option>
        ${counterparties.map(c => `<option ${KO.counterparty === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <div class="spacer"></div>
      <button class="btn btn-ghost btn-sm" type="button" data-act="ko-suggest">Suggest matches</button>
      <button class="btn btn-plain btn-sm" type="button" data-act="ko-clear">Clear allocations</button>
    </div></div>

    <div class="knock">
      <div class="pane"><h3>Outstanding ${esc(KO.side.toLowerCase())} bills</h3>
        <div class="tablewrap"><table class="dt">
          <thead><tr><th>Bill</th><th>Invoice</th><th>Counterparty</th><th class="num">Outstanding</th></tr></thead>
          <tbody>${bills.length ? bills.map(b => `
            <tr class="${KO.allocations.some(a => a.billId === b.id) ? 'sel' : ''}">
              <td class="id">${esc(b.id)}</td><td>${esc(b.invoiceNumber)}</td>
              <td>${esc(b.counterparty)}</td><td class="num">${money(b.outstanding, b.currency)}</td></tr>`).join('')
            : `<tr><td colspan="4">${empty('Nothing outstanding','No bills match these filters.')}</td></tr>`}</tbody>
        </table></div></div>

      <div class="pane"><h3>Eligible ${KO.side === 'Export' ? 'inward receipts' : 'outward payments'}</h3>
        <div class="tablewrap"><table class="dt">
          <thead><tr><th>Reference</th><th>Counterparty</th><th class="num">${KO.side === 'Export' ? 'Available' : 'Amount'}</th></tr></thead>
          <tbody>${rems.length ? rems.map(r => `
            <tr><td class="id">${esc(r.reference || r.id)}</td>
              <td>${esc(r.remitter || r.beneficiary)}</td>
              <td class="num">${money(KO.side === 'Export' ? r.available : r.amount, r.currency)}</td></tr>`).join('')
            : `<tr><td colspan="3">${empty('Nothing eligible','No remittances match these filters.')}</td></tr>`}</tbody>
        </table></div></div>
    </div>

    <div class="allocbar" style="margin-top:18px">
      <div><div class="m">Proposed allocations</div><div class="v">${KO.allocations.length}</div></div>
      <div><div class="m">Total allocated</div><div class="v">${money(totalAlloc)}</div></div>
      <div class="spacer"></div>
      <button class="btn btn-ghost" type="button" data-act="ko-submit" ${KO.allocations.length ? '' : 'disabled'}>Submit for review</button>
    </div>

    ${KO.allocations.length ? `<div class="card" style="margin-top:18px">
      <div class="card-head"><h2>Allocations</h2>
        <div class="acts"><span class="badge b-amber">Proposed — not yet confirmed</span></div></div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Bill</th><th>Remittance</th><th class="num">Amount</th>
          <th class="num">Bill balance before</th><th class="num">After</th><th></th></tr></thead>
        <tbody>${KO.allocations.map((a, i) => { const b = bill(a.billId);
          return `<tr><td class="id">${esc(a.billId)}</td><td>${esc(a.remId)}</td>
            <td class="num">${money(a.amount, b?.currency)}</td>
            <td class="num">${money(b?.outstanding, b?.currency)}</td>
            <td class="num">${money((b?.outstanding || 0) - a.amount, b?.currency)}</td>
            <td><button class="btn btn-link" type="button" data-act="ko-remove" data-i="${i}">Remove</button></td></tr>`;
        }).join('')}</tbody></table></div></div></div>` : ''}`);
}

/* ---------- 18. reports ---------------------------------------------------- */
const REPORTS = [
  { id:'onboarding',  name:'Onboarding Pendency' },
  { id:'outward',     name:'Outward Remittance Pendency' },
  { id:'inward',      name:'Inward Disposal Pendency' },
  { id:'lodgement',   name:'Bill Lodgement Pendency' },
  { id:'outstanding', name:'Outstanding Bills' },
  { id:'recon',       name:'Reconciliation Pendency' },
  { id:'aging',       name:'Aging Report' },
  { id:'charges',     name:'Charges Report' },
  { id:'firc',        name:'FIRC Pending for Knock-off' },
  { id:'realised',    name:'Bills Lodged and Realised' },
  { id:'notlodged',   name:'Bills Not Lodged and Realised' },
];
let reportId = 'outstanding', reportCur = '';

function reportRows(id) {
  const mine = r => !scoped() || r.smeId === ctxSmeId();
  const today = new Date();
  const wrap = (cols, rows) => ({ cols, rows });

  switch (id) {
    case 'onboarding':
      return wrap(['Application','SME','Channel','Status','Pending with','Submitted','Days'],
        DB.smes.filter(s => s.status !== 'Approved' && s.status !== 'Rejected').map(s =>
          [s.id, s.legalName, s.source, s.status,
           s.status === 'Clarification Required' ? 'SME' : 'AD2', dmy(s.submittedAt),
           String(daysBetween(s.submittedAt, today))]));
    case 'outward':
      return wrap(['Request','SME','Currency','Amount','Status','Pending with','Requested','Days'],
        DB.outward.filter(mine).filter(o => !['Completed','Rejected'].includes(o.status)).map(o =>
          [o.id, sme(o.smeId)?.tradingName || '', o.currency, money(o.amount), o.status,
           o.pendingWith || '—', dmy(o.requestDate), String(daysBetween(o.requestDate, today))]));
    case 'inward':
      return wrap(['Receipt','SME','Currency','Available','Status','Value date','Days'],
        DB.inward.filter(mine).filter(i => i.available > 0 || i.status === 'Instruction Submitted').map(i =>
          [i.reference, sme(i.smeId)?.tradingName || '', i.currency, money(i.available), i.status,
           dmy(i.valueDate), String(daysBetween(i.valueDate, today))]));
    case 'lodgement':
      return wrap(['Bill','SME','Type','Invoice','Review status','Source','Lodged'],
        DB.bills.filter(mine).filter(b => ['Draft','Submitted','Under Review','Query Raised'].includes(b.review)).map(b =>
          [b.id, sme(b.smeId)?.tradingName || '', b.type, b.invoiceNumber, b.review, b.source, dmy(b.invoiceDate)]));
    case 'outstanding':
      return wrap(['Bill','SME','Type','Counterparty','Currency','Outstanding','Due date','Aging'],
        DB.bills.filter(mine).filter(b => b.outstanding > 0).filter(b => !reportCur || b.currency === reportCur).map(b =>
          [b.id, sme(b.smeId)?.tradingName || '', b.type, b.counterparty, b.currency, money(b.outstanding),
           dmy(b.dueDate), agingBucket(daysBetween(b.invoiceDate, today))]));
    case 'recon':
      return wrap(['Reference','SME','Type','Currency','Unapplied','Reason'],
        [...DB.inward.filter(mine).filter(i => i.available > 0).map(i =>
            [i.reference, sme(i.smeId)?.tradingName || '', 'Inward receipt', i.currency, money(i.available), 'Awaiting disposal instruction']),
         ...DB.bills.filter(mine).filter(b => b.settlement === 'Partially Settled').map(b =>
            [b.id, sme(b.smeId)?.tradingName || '', 'Bill', b.currency, money(b.outstanding), 'Partially settled'])]);
    case 'aging': {
      const buckets = { '0–7 days':[], '8–15 days':[], '16–30 days':[], 'Over 30 days':[] };
      DB.bills.filter(mine).filter(b => b.outstanding > 0).forEach(b =>
        buckets[agingBucket(daysBetween(b.invoiceDate, today))].push(b));
      return wrap(['Bucket','Bills','Currencies','Total outstanding (by currency)'],
        Object.entries(buckets).map(([k, arr]) => {
          const by = {}; arr.forEach(b => by[b.currency] = (by[b.currency] || 0) + b.outstanding);
          return [k, String(arr.length), Object.keys(by).join(', ') || '—',
            Object.entries(by).map(([c, v]) => `${money(v)} ${c}`).join(' · ') || '—'];
        }));
    }
    case 'charges':
      return wrap(['Request','SME','Currency','Amount','Margin (paise)','Charges','Customer rate'],
        DB.outward.filter(mine).map(o =>
          [o.id, sme(o.smeId)?.tradingName || '', o.currency, money(o.amount), String(o.rate.margin || 0),
           inr((o.charges || []).reduce((s, c) => s + c.amount, 0)), '₹ ' + (o.rate.customerRate || 0).toFixed(4)]));
    case 'firc':
      return wrap(['Receipt','SME','Currency','Amount','FIRC','Applied to bills'],
        DB.inward.filter(mine).filter(i => i.firc).map(i => {
          const applied = DB.disposals.filter(d => d.inwardId === i.id)
            .flatMap(d => d.allocations).reduce((s, a) => s + a.amount, 0);
          return [i.reference, sme(i.smeId)?.tradingName || '', i.currency, money(i.amount), i.firc,
                  applied ? money(applied) : 'None'];
        }));
    case 'realised':
      return wrap(['Bill','SME','Type','Invoice','Currency','Original','Adjusted','Settlement'],
        DB.bills.filter(mine).filter(b => b.adjusted > 0).map(b =>
          [b.id, sme(b.smeId)?.tradingName || '', b.type, b.invoiceNumber, b.currency,
           money(b.amount), money(b.adjusted), b.settlement]));
    case 'notlodged':
      return wrap(['Receipt','SME','Remitter','Currency','Amount','Value date','Note'],
        DB.inward.filter(mine).filter(i => {
          const hasBill = DB.bills.some(b => b.smeId === i.smeId && b.type === 'Export'
            && b.counterparty === i.remitter && b.currency === i.currency);
          return !hasBill;
        }).map(i => [i.reference, sme(i.smeId)?.tradingName || '', i.remitter, i.currency,
                     money(i.amount), dmy(i.valueDate), 'No matching export bill lodged']));
    default: return wrap([], []);
  }
}

function viewReports() {
  const { cols, rows } = reportRows(reportId);
  const def = REPORTS.find(r => r.id === reportId);
  return shell(crumb('Reports', def.name), `
    <div class="page-head"><div><h1>Reports</h1>
      <p>Pendency, outstanding and charge reporting. Exports reflect the active filters and totals stay separate by currency.</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="export-report">Export CSV</button></div></div>
    <div class="card">
      <div class="toolbar">
        <select data-act="report-pick" aria-label="Report">
          ${REPORTS.map(r => `<option value="${r.id}" ${r.id === reportId ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select>
        <select data-act="report-cur" aria-label="Currency"><option value="">All currencies</option>
          ${DB.currencies.map(c => `<option ${reportCur === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}</select>
        <button class="btn btn-plain btn-sm" type="button" data-act="report-reset">Reset filters</button>
        <div class="spacer"></div>
        <span style="color:var(--muted);font-size:var(--fs-sm)">${rows.length} rows</span>
      </div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${rows.length ? rows.map(r => `<tr>${r.map((v, i) =>
          `<td${i > 0 && /^[\d,.\s₹]+$/.test(String(v)) ? ' class="num"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')
          : `<tr><td colspan="${cols.length || 1}">${empty('Nothing to report','No records match the selected report and filters.')}</td></tr>`}</tbody>
      </table></div></div>
    </div>`);
}

/* ---------- 19. integrations + profile ------------------------------------ */
function viewIntegrations() {
  return shell(crumb('Integrations'), `
    <div class="page-head"><div><h1>Integrations</h1>
      <p>Channels that lodge bills automatically. All connections are simulated in this prototype.</p></div></div>
    <div class="grid g2" style="margin-bottom:20px">
      <div class="card"><div class="card-head"><h2>SFTP</h2><div class="acts"><span class="badge b-green">Connected</span></div></div>
        <div class="card-body"><div class="kv">
          <div><div class="k">Host</div><div class="v">sftp.ad2trade.example</div></div>
          <div><div class="k">Schedule</div><div class="v">Every 6 hours</div></div>
        </div></div></div>
      <div class="card"><div class="card-head"><h2>SAP API</h2><div class="acts"><span class="badge b-green">Connected</span></div></div>
        <div class="card-body"><div class="kv">
          <div><div class="k">Endpoint</div><div class="v">sap.sme.example/odata</div></div>
          <div><div class="k">Sync</div><div class="v">On invoice creation</div></div>
        </div></div></div>
    </div>
    <div class="card"><div class="card-head"><h2>Recent synchronisation jobs</h2></div>
      <div class="card-body tight">${jobsTable('SAP API')}</div></div>
    <div class="card" style="margin-top:20px"><div class="card-head"><h2>SFTP jobs</h2></div>
      <div class="card-body tight">${jobsTable('SFTP')}</div></div>`);
}

function viewProfile() {
  const me = sme(ctxSmeId());
  if (!me) return shell(crumb('Profile'), empty('No SME linked',''));
  const accounts = smeAccounts(me.id);
  const c = me.config;
  return shell(crumb('Profile'), `
    <div class="page-head"><div><h1>${esc(me.tradingName)}</h1>
      <p>Business details, account master and the pricing AD2 approved for you.</p></div></div>

    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>Business</h2></div>
      <div class="card-body"><div class="kv">
        <div><div class="k">Legal name</div><div class="v">${esc(me.legalName)}</div></div>
        <div><div class="k">Constitution</div><div class="v">${esc(me.constitution)}</div></div>
        <div><div class="k">Domain ID</div><div class="v">${esc(me.domainId)}</div></div>
        <div><div class="k">Category</div><div class="v">${esc(me.category)}</div></div>
        <div><div class="k">PAN</div><div class="v">${esc(me.pan)}</div></div>
        <div><div class="k">GSTIN</div><div class="v">${esc(me.gstin)}</div></div>
        <div><div class="k">IEC</div><div class="v">${esc(me.iec || '—')}</div></div>
        <div><div class="k">Onboarding channel</div><div class="v">${esc(me.source)}</div></div>
      </div></div></div>

    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>Bank account master</h2>
      <div class="acts"><button class="btn btn-ghost btn-sm" type="button" data-act="acct-add">Add account</button></div></div>
      <div class="card-body tight"><div class="tablewrap"><table class="dt">
        <thead><tr><th>Bank</th><th>Account number</th><th>IFSC</th><th>Currency</th><th>Type</th><th>Verification</th><th></th></tr></thead>
        <tbody>${accounts.map(a => `
          <tr><td><b>${esc(a.bank)}</b><br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(a.branch)}</span></td>
            <td>${esc(a.accountNumber)}</td><td>${esc(a.ifsc)}</td><td>${esc(a.currency)}</td><td>${esc(a.type)}</td>
            <td>${a.verified ? `<span class="badge b-green">Verified ${dmy(a.verifiedOn)}</span>` : `<span class="badge b-amber">Unverified</span>`}</td>
            <td>${a.verified ? '' : `<button class="btn btn-ghost btn-sm" type="button" data-act="penny" data-id="${a.id}">Verify (PennyDrop)</button>`}</td></tr>`).join('')}
        </tbody></table></div>
        <p style="padding:12px 20px;color:var(--muted);font-size:var(--fs-xs)">
          These accounts populate the remitter and credit selectors on transactions. PennyDrop verification is simulated.</p>
      </div></div>

    <div class="card" style="margin-bottom:20px"><div class="card-head"><h2>Beneficiary master</h2>
      <div class="acts"><button class="btn btn-ghost btn-sm" type="button" data-act="bene-add-profile">Add beneficiary</button></div></div>
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
            <td><button class="btn btn-link" type="button" data-act="bene-del-profile" data-id="${x.id}">Remove</button></td></tr>`).join('')}
        </tbody></table></div>
        <p style="padding:12px 20px;color:var(--muted);font-size:var(--fs-xs)">
          Outward requests select from this list. A request snapshots the details it was sent with, so
          removing or editing a beneficiary never rewrites past payments.</p>`
        : empty('No beneficiaries yet','Add the overseas payees you remit to, so a request can select one rather than retyping bank details.')}
      </div></div>

    <div class="card"><div class="card-head"><h2>Approved configuration</h2>
      <div class="acts"><span style="color:var(--muted);font-size:var(--fs-sm)">Effective ${dmy(c.effectiveDate)}</span></div></div>
      <div class="card-body">
        <div class="kv" style="margin-bottom:20px">
          <div><div class="k">Service permission</div><div class="v">${esc(c.permission)}</div></div>
          <div><div class="k">Enabled currencies</div><div class="v">${c.currencies.join(' · ')}</div></div>
          <div><div class="k">Margin basis</div><div class="v">${esc(c.marginBasis)}</div></div>
        </div>
        <div class="tablewrap"><table class="dt">
          <thead><tr><th>Currency</th><th class="num">Margin (paise)</th><th class="num">Reference rate</th><th class="num">Your rate</th></tr></thead>
          <tbody>${c.currencies.map(code => {
            const m = marginFor(me, code);
            return `<tr><td><b>${esc(code)}</b></td><td class="num">${m}</td>
              <td class="num">₹ ${currency(code).refRate.toFixed(4)}</td>
              <td class="num">₹ ${customerRate(code, m).toFixed(4)}</td></tr>`;
          }).join('')}</tbody></table></div>
        <h3 style="font-size:var(--fs-md);margin:22px 0 10px">Charges</h3>
        <div class="tablewrap"><table class="dt">
          <thead><tr><th>Charge</th><th>Basis</th><th class="num">Value</th><th>Currency</th><th>Applied</th></tr></thead>
          <tbody>${c.charges.map(ch => `<tr><td>${esc(ch.name)}</td><td>${esc(ch.basis)}</td>
            <td class="num">${money(ch.value)}</td><td>${esc(ch.currency)}</td><td>${esc(ch.frequency)}</td></tr>`).join('')}</tbody>
        </table></div></div></div>`);
}

/* ---------- 20. AD2 dashboard --------------------------------------------- */
function viewAd2Dashboard() {
  const pendingApps = DB.smes.filter(s => !['Approved','Rejected'].includes(s.status));
  const outPending = DB.outward.filter(o => ['Submitted','Under Review'].includes(o.status));
  const inwAwaiting = DB.inward.filter(i => i.available > 0);
  const disPending = DB.disposals.filter(d => d.status === 'Under Review');
  const billsReview = DB.bills.filter(b => ['Submitted','Under Review','Query Raised'].includes(b.review));
  const failedJobs = DB.jobs.filter(j => j.rejected > 0).length;

  const volByCur = {};
  DB.outward.filter(o => o.status === 'Completed').forEach(o =>
    volByCur[o.currency] = (volByCur[o.currency] || 0) + o.amount);

  return shell(crumb('Dashboard'), `
    <div class="page-head"><div><h1>Trade Operations</h1>
      <p>Portfolio-wide view across onboarded SMEs, remittances, bills and reconciliation.</p></div></div>

    <div class="grid g4" style="margin-bottom:20px">
      ${kpi('Applications awaiting review', pendingApps.length, { tone:'accent', go:'#/ad2/applications' })}
      ${kpi('Outward requests pending', outPending.length, { tone:'warn', go:'#/ad2/outward' })}
      ${kpi('Receipts awaiting disposal', inwAwaiting.length, { go:'#/ad2/inward' })}
      ${kpi('Bills awaiting review', billsReview.length, { go:'#/ad2/bills' })}
    </div>
    <div class="grid g4" style="margin-bottom:20px">
      ${kpi('Disposal instructions to approve', disPending.length, { go:'#/ad2/inward' })}
      ${kpi('Approved SMEs', DB.smes.filter(s => s.status === 'Approved').length, { go:'#/ad2/directory' })}
      ${kpi('Integration jobs with errors', failedJobs, { tone: failedJobs ? 'bad' : '', go:'#/ad2/bills' })}
      ${kpi('Avg. processing time', '1.4', { unit:'days', delta:'0% vs last period', deltaTone:'up' })}
    </div>

    <div class="grid g2">
      <div class="card"><div class="card-head"><h2>Completed outward volume by currency</h2></div>
        <div class="card-body tight"><div class="tablewrap"><table class="dt">
          <thead><tr><th>Currency</th><th class="num">Volume</th><th class="num">Transactions</th></tr></thead>
          <tbody>${Object.keys(volByCur).length ? Object.entries(volByCur).map(([c, v]) => `
            <tr><td><b>${esc(c)}</b></td><td class="num">${money(v)}</td>
              <td class="num">${DB.outward.filter(o => o.currency === c && o.status === 'Completed').length}</td></tr>`).join('')
            : `<tr><td colspan="3">${empty('No completed volume','Nothing has settled yet.')}</td></tr>`}</tbody>
        </table></div></div></div>

      <div class="card"><div class="card-head"><h2>Applications by status</h2></div>
        <div class="card-body tight"><div class="tablewrap"><table class="dt">
          <thead><tr><th>Status</th><th class="num">Applications</th></tr></thead>
          <tbody>${['Submitted','Under Review','Clarification Required','Approved','Rejected'].map(st => `
            <tr><td>${badge(st)}</td><td class="num">${DB.smes.filter(s => s.status === st).length}</td></tr>`).join('')}</tbody>
        </table></div></div></div>
    </div>

    <div class="card" style="margin-top:20px"><div class="card-head"><h2>Recent activity</h2></div>
      <div class="card-body">${DB.audit.slice(0, 8).map(a => `
        <div class="tl" style="padding-left:0"><div class="act">${esc(a.action)}</div>
          <div class="meta">${esc(a.record)} · ${esc(a.actor)} · ${dmyt(a.at)}</div></div>`).join('')}</div></div>`);
}

/* ---------- 21. AD2 applications + review --------------------------------- */
function viewApplications() {
  const list = DB.smes;
  return shell(crumb('SME Applications'), `
    <div class="page-head"><div><h1>SME Applications</h1>
      <p>Digital and offline onboarding applications. Approval requires permissions, currencies, margins and charges.</p></div>
      <div class="acts"><button class="btn btn-primary" type="button" data-act="offline-app">Create offline application</button></div></div>
    <div class="card"><div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Application</th><th>Legal name</th><th>Constitution</th><th>Domain ID</th>
        <th>Service</th><th>Channel</th><th>Submitted</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map(s => `
        <tr><td class="id" data-act="go" data-href="#/ad2/applications/${s.id}">${esc(s.id)}</td>
          <td>${esc(s.legalName)}</td><td>${esc(s.constitution)}</td><td>${esc(s.domainId)}</td>
          <td>${esc(s.service)}</td><td>${esc(s.source)}</td><td>${dmy(s.submittedAt)}</td>
          <td>${badge(s.status)}</td>
          <td><button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/applications/${s.id}">
            ${['Approved','Rejected'].includes(s.status) ? 'View' : 'Review'}</button></td></tr>`).join('')}</tbody>
    </table></div></div></div>`);
}

let REVIEW = null;
function viewApplicationReview(id) {
  const s = sme(id);
  if (!s) return shell(crumb('SME Applications','Not found'), empty('Application not found',''));
  const done = ['Approved','Rejected'].includes(s.status);
  if (!REVIEW || REVIEW.id !== id) {
    REVIEW = s.config
      ? JSON.parse(JSON.stringify({ id, ...s.config }))
      : { id, permission:s.service, currencies:[...s.requestedCurrencies], margins:{}, marginBasis:'paise',
          charges:[], effectiveDate:'', remarks:'' };
  }
  const r = REVIEW;

  const curRows = DB.currencies.map(c => {
    const on = r.currencies.includes(c.code);
    const m = r.margins[c.code];
    const derived = r.margins.USD != null ? Math.round(r.margins.USD * c.marginMultiplier) : '';
    return `<tr class="${on ? 'sel' : ''}">
      <td><label class="chk"><input type="checkbox" data-act="rv-cur" data-c="${c.code}" ${on ? 'checked' : ''} ${done ? 'disabled' : ''}>
        <span><b>${c.code}</b> <small>${esc(c.name)}</small></span></label></td>
      <td class="num">${c.marginMultiplier.toFixed(2)}</td>
      <td class="num"><input type="number" style="width:100px;text-align:right;border:1px solid var(--r4m-input-border);border-radius:6px;padding:6px 8px;font-family:inherit"
        data-act="rv-margin" data-c="${c.code}" value="${m != null ? m : ''}" placeholder="${derived}" ${done || !on ? 'disabled' : ''}></td>
      <td class="num">₹ ${c.refRate.toFixed(4)}</td>
      <td class="num">₹ ${customerRate(c.code, m != null ? m : (derived || 0)).toFixed(4)}</td></tr>`;
  }).join('');

  const missing = [];
  if (!r.permission) missing.push('transaction permission');
  if (!r.currencies.length) missing.push('at least one enabled currency');
  r.currencies.forEach(c => { if (r.margins[c] == null && r.margins.USD == null) missing.push('margin for ' + c); });
  if (!r.charges.length) missing.push('at least one charge');
  if (!r.effectiveDate) missing.push('effective date');

  return shell(crumb('SME Applications', s.id), `
    <div class="page-head"><div><h1>${esc(s.legalName)} ${badge(s.status)}</h1>
      <p>${esc(s.id)} · ${esc(s.constitution)} · ${esc(s.source)} onboarding · submitted ${dmy(s.submittedAt)}</p></div>
      <div class="acts"><button class="btn btn-plain" type="button" data-act="go" data-href="#/ad2/applications">Back</button></div></div>

    <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start">
      <div class="grid" style="gap:20px">
        <div class="card"><div class="card-head"><h2>Business</h2></div><div class="card-body"><div class="kv">
          <div><div class="k">Legal name</div><div class="v">${esc(s.legalName)}</div></div>
          <div><div class="k">Trading name</div><div class="v">${esc(s.tradingName)}</div></div>
          <div><div class="k">Constitution</div><div class="v">${esc(s.constitution)}</div></div>
          <div><div class="k">Registration</div><div class="v">${esc(s.regNumber)}</div></div>
          <div><div class="k">Domain ID</div><div class="v">${esc(s.domainId)}</div></div>
          <div><div class="k">Category</div><div class="v">${esc(s.category)}</div></div>
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

        <div class="card"><div class="card-head"><h2>Documents</h2></div><div class="card-body">
          <div class="doclist">${ONBOARD_DOCS.map(d => `
            <div class="docrow uploaded"><span class="nm">${esc(d.name)}<small>On file (simulated)</small></span>
              <span class="spacer"></span>
              <button class="btn btn-link" type="button" data-act="view-doc" data-n="${esc(d.name)}">View</button>
              <span class="badge b-green">Received</span></div>`).join('')}</div></div></div>

        <div class="card"><div class="card-head"><h2>Activity</h2></div>
          <div class="card-body">${timeline(s.id)}</div></div>
      </div>

      <div class="grid" style="gap:20px;align-items:start">
        <div class="card"><div class="card-head"><h2>Service permission</h2></div><div class="card-body">
          <div class="pillset">${['Import','Export','Both'].map(p => `
            <label><input type="radio" name="perm" data-act="rv-perm" value="${p}" ${r.permission === p ? 'checked' : ''} ${done ? 'disabled' : ''}> ${p}</label>`).join('')}</div>
          <p class="hint" style="margin-top:10px;font-size:var(--fs-xs);color:var(--muted)">
            Import enables import bills and outward requests. Export enables export bills and inward disposal. Both enables all.</p>
        </div></div>

        <div class="card"><div class="card-head"><h2>Currencies and margins</h2></div><div class="card-body tight">
          <div class="tablewrap"><table class="dt">
            <thead><tr><th>Enabled</th><th class="num">Multiplier</th><th class="num">Margin (paise)</th>
              <th class="num">Reference</th><th class="num">Customer rate</th></tr></thead>
            <tbody>${curRows}</tbody></table></div>
          <p style="padding:12px 20px;font-size:var(--fs-xs);color:var(--muted)">
            Leave a margin blank to derive it from USD using the currency multiplier. Enter zero explicitly for a zero margin.</p>
        </div></div>

        <div class="card"><div class="card-head"><h2>Charges</h2>
          <div class="acts">${done ? '' : `<button class="btn btn-ghost btn-sm" type="button" data-act="rv-charge-add">Add charge</button>`}</div></div>
          <div class="card-body tight">
            ${r.charges.length ? `<div class="tablewrap"><table class="dt">
              <thead><tr><th>Charge</th><th>Basis</th><th class="num">Value</th><th>Currency</th><th>Applied</th><th></th></tr></thead>
              <tbody>${r.charges.map((c, i) => `<tr><td>${esc(c.name)}</td><td>${esc(c.basis)}</td>
                <td class="num">${money(c.value)}</td><td>${esc(c.currency)}</td><td>${esc(c.frequency)}</td>
                <td>${done ? '' : `<button class="btn btn-link" type="button" data-act="rv-charge-del" data-i="${i}">Remove</button>`}</td></tr>`).join('')}</tbody>
            </table></div>` : empty('No charges configured','At least one charge is required. Enter zero explicitly if there is no charge.')}
          </div></div>

        <div class="card"><div class="card-head"><h2>Approval</h2></div><div class="card-body">
          <div class="f"><label for="rv-eff">Effective date<span class="req">*</span></label>
            <input id="rv-eff" type="date" data-act="rv-eff" value="${esc(r.effectiveDate)}" ${done ? 'disabled' : ''}></div>
          <div class="f" style="margin-top:14px"><label for="rv-rem">Internal remarks</label>
            <textarea id="rv-rem" data-act="rv-remarks" ${done ? 'disabled' : ''}>${esc(r.remarks)}</textarea>
            <div class="hint">Not visible to the SME.</div></div>
          ${done ? `<div class="note note-ok" style="margin-top:16px"><span>
              Application ${esc(s.status.toLowerCase())}${s.approvedAt ? ' on ' + dmy(s.approvedAt) : ''}.
              Configuration changes are retained in the audit history.</span></div>`
            : `${missing.length ? `<div class="note note-warn" style="margin-top:16px"><span>
                 Required before approval: ${esc(missing.join('; '))}</span></div>` : ''}
              <div style="display:grid;gap:8px;margin-top:18px">
                <button class="btn btn-primary" type="button" data-act="rv-approve" data-id="${s.id}">
                  ${DB.settings.autoChecker ? 'Approve' : 'Send to checker'}</button>
                <button class="btn btn-plain" type="button" data-act="rv-save" data-id="${s.id}">Save review</button>
                <button class="btn btn-plain" type="button" data-act="rv-clarify" data-id="${s.id}">Request clarification</button>
                <button class="btn btn-danger" type="button" data-act="rv-reject" data-id="${s.id}">Reject</button>
              </div>`}
        </div></div>
      </div>
    </div>`);
}

function viewDirectory() {
  const list = DB.smes.filter(s => s.status === 'Approved');
  return shell(crumb('SME Directory'), `
    <div class="page-head"><div><h1>SME Directory</h1>
      <p>Approved SMEs with their live service permissions and pricing.
         <b>Transact on behalf</b> opens that SME's portal as an assisted journey.</p></div></div>
    <div class="card"><div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>SME</th><th>Constitution</th><th>IEC</th><th>Permission</th><th>Currencies</th>
        <th class="num">USD margin</th><th>Effective</th><th></th></tr></thead>
      <tbody>${list.map(s => `
        <tr><td class="id" data-act="go" data-href="#/ad2/applications/${s.id}">${esc(s.tradingName)}
            <br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(s.id)}</span></td>
          <td>${esc(s.constitution)}</td><td>${esc(s.iec || '—')}</td>
          <td>${esc(s.config.permission)}</td><td>${s.config.currencies.join(' · ')}</td>
          <td class="num">${s.config.margins.USD ?? '—'}</td><td>${dmy(s.config.effectiveDate)}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-ghost btn-sm" type="button" data-act="assist-start" data-id="${s.id}">Transact on behalf</button>
            <button class="btn btn-link" type="button" data-act="go" data-href="#/ad2/applications/${s.id}">Open</button></td></tr>`).join('')}</tbody>
    </table></div></div></div>`);
}

/* ---------- 22. AD2 reconciliation + administration ----------------------- */
function viewReconciliation() {
  const proposed = [];
  DB.outward.forEach(o => (o.allocations || []).forEach(a =>
    proposed.push({ type:'Outward', rem:o.id, bill:a.billId, amount:a.amount, cur:o.currency,
      smeId:o.smeId, status:o.status === 'Completed' ? 'Confirmed' : 'Proposed' })));
  DB.disposals.forEach(d => (d.allocations || []).forEach(a =>
    proposed.push({ type:'Inward', rem:d.inwardId, bill:a.billId, amount:a.amount, cur:d.currency,
      smeId:d.smeId, status:d.status === 'Processed' ? 'Confirmed' : 'Proposed' })));

  return shell(crumb('Reconciliation'), `
    <div class="page-head"><div><h1>Reconciliation</h1>
      <p>Allocations between bills and remittances. Proposed allocations need AD2 confirmation.</p></div></div>
    <div class="card"><div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>SME</th><th>Direction</th><th>Remittance</th><th>Bill</th><th>Currency</th>
        <th class="num">Allocated</th><th>Status</th><th></th></tr></thead>
      <tbody>${proposed.length ? proposed.map((p, i) => `
        <tr><td>${esc(sme(p.smeId)?.tradingName || '')}</td><td>${esc(p.type)}</td>
          <td class="id">${esc(p.rem)}</td><td class="id">${esc(p.bill)}</td><td>${esc(p.cur)}</td>
          <td class="num">${money(p.amount)}</td>
          <td><span class="badge ${p.status === 'Confirmed' ? 'b-green' : 'b-amber'}">${esc(p.status)}</span></td>
          <td>${p.status === 'Proposed'
            ? `<button class="btn btn-ghost btn-sm" type="button" data-act="rec-confirm" data-rem="${esc(p.rem)}" data-bill="${esc(p.bill)}">Confirm</button>`
            : `<button class="btn btn-link" type="button" data-act="rec-reverse" data-rem="${esc(p.rem)}" data-bill="${esc(p.bill)}">Reverse</button>`}</td></tr>`).join('')
        : `<tr><td colspan="8">${empty('No allocations','Nothing has been allocated yet.')}</td></tr>`}</tbody>
    </table></div></div></div>`);
}

let adminTab = 'purpose';
function viewAdmin() {
  const panes = {
    purpose: `<div class="card-body tight">
      <div class="note note-info" style="margin:20px">
        <span>The document checklist served on an outward request is resolved from the purpose code selected here.
        This mapping is provisional until the full workbook is loaded.</span></div>
      <div class="tablewrap"><table class="dt">
        <thead><tr><th>Code</th><th>Description</th><th>Direction</th><th>Category</th><th>Documents</th></tr></thead>
        <tbody>${DB.purposeCodes.map(p => `
          <tr><td><b>${esc(p.code)}</b></td><td>${esc(p.label)}</td><td>${esc(p.direction)}</td><td>${esc(p.category)}</td>
            <td>${p.docs.map(d => `<div style="font-size:var(--fs-xs)">${esc(d.name)}${d.required ? ' <span style="color:var(--r4m-red)">*</span>' : ''}</div>`).join('')}</td></tr>`).join('')}</tbody>
      </table></div></div>`,

    rtypes: `<div class="card-body tight">
      <div class="note note-info" style="margin:20px">
        <span>The settlement method, held separately from the RBI purpose code. A type narrows the
        purpose codes on offer and can add documents of its own. Letter-of-credit settlement is not
        listed — the requirements call put trade-finance instruments out of scope for this journey.</span></div>
      <div class="tablewrap"><table class="dt">
        <thead><tr><th>Type</th><th>Direction</th><th>Valid purpose codes</th><th>Documents it adds</th></tr></thead>
        <tbody>${DB.remittanceTypes.map(t => `
          <tr><td><b>${esc(t.label)}</b><br><span style="color:var(--muted);font-size:var(--fs-xs)">${esc(t.hint)}</span></td>
            <td>${esc(t.direction)}</td>
            <td>${t.purposes.map(c => `<div style="font-size:var(--fs-xs)"><b>${esc(c)}</b> ${esc(purpose(c)?.label || '')}</div>`).join('')}</td>
            <td>${t.docs.length ? t.docs.map(d => `<div style="font-size:var(--fs-xs)">${esc(d.name)}${d.required ? ' <span style="color:var(--r4m-red)">*</span>' : ''}</div>`).join('') : '<span style="color:var(--muted)">—</span>'}</td></tr>`).join('')}</tbody>
      </table></div></div>`,

    currencies: `<div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Code</th><th>Name</th><th class="num">Margin multiplier</th><th class="num">Reference rate</th></tr></thead>
      <tbody>${DB.currencies.map(c => `<tr><td><b>${esc(c.code)}</b></td><td>${esc(c.name)}</td>
        <td class="num">${c.marginMultiplier.toFixed(2)}</td><td class="num">₹ ${c.refRate.toFixed(4)}</td></tr>`).join('')}</tbody>
    </table></div>
    <p style="padding:12px 20px;color:var(--muted);font-size:var(--fs-xs)">
      The multiplier derives a non-USD margin from the approved USD margin unless a margin is entered explicitly.</p></div>`,

    checklists: `<div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Onboarding document</th><th>Requirement</th></tr></thead>
      <tbody>${ONBOARD_DOCS.map(d => `<tr><td>${esc(d.name)}</td>
        <td>${d.required ? '<span class="badge b-red">Mandatory</span>' : '<span class="badge b-grey">Optional</span>'}</td></tr>`).join('')}</tbody>
    </table></div></div>`,

    users: `<div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Domain ID</th><th>Login ID</th><th>Role</th><th>Linked SME</th></tr></thead>
      <tbody>${DB.logins.map(a => `<tr><td>${esc(a.domainId)}</td><td>${esc(a.loginId)}</td>
        <td>${esc(a.role)}</td><td>${a.smeId ? esc(sme(a.smeId)?.tradingName || '') : '—'}</td></tr>`).join('')}</tbody>
    </table></div></div>`,

    settings: `<div class="card-body">
      <div class="checks" style="gap:18px">
        <label class="chk"><input type="checkbox" data-act="set-autochecker" ${DB.settings.autoChecker ? 'checked' : ''}>
          <span>AutoChecker approval<small>Maker actions commit without a second approver. Switch off to route to a checker queue.</small></span></label>
        <label class="chk"><input type="checkbox" data-act="set-unlinked" ${DB.settings.allowUnlinked ? 'checked' : ''}>
          <span>Permit unlinked outward requests<small>Allows an outward request with no import bill allocated.</small></span></label>
      </div></div>`,
  };
  const tabs = [['purpose','Purpose code mapping'],['rtypes','Remittance types'],['currencies','Currency master'],
    ['checklists','Document checklists'],['users','Users and roles'],['settings','Settings']];

  return shell(crumb('Administration'), `
    <div class="page-head"><div><h1>Administration</h1>
      <p>Masters and controls behind the trade journey.</p></div></div>
    <div class="card">
      <div class="tabs">${tabs.map(([k, l]) =>
        `<button type="button" data-act="admin-tab" data-t="${k}" aria-selected="${adminTab === k}">${esc(l)}</button>`).join('')}</div>
      ${panes[adminTab]}
    </div>`);
}

/* ---------- 23. router ---------------------------------------------------- */
function render() {
  const root = $('#root');
  const hash = location.hash || '#/login';
  const parts = hash.replace(/^#\//, '').split('/');

  if (!S && !['login','register','status'].includes(parts[0])) { location.hash = '#/login'; return; }

  let html;
  try {
    if (parts[0] === 'login')    html = viewLogin();
    else if (parts[0] === 'register') html = viewRegister();
    else if (parts[0] === 'status')   html = viewStatus();
    else if (parts[0] === 'sme') {
      if (!isSME() && !acting()) { location.hash = '#/ad2/dashboard'; return; }
      switch (parts[1]) {
        case 'dashboard':    html = viewSmeDashboard(); break;
        case 'outward':
          html = !parts[2] ? viewOutwardList()
               : parts[2] === 'new' ? viewOutwardNew()
               : viewOutwardDetail(parts[2]); break;
        case 'inward':
          html = !parts[2] ? viewInwardList()
               : parts[3] === 'dispose' ? viewDispose(parts[2])
               : viewInwardDetail(parts[2]); break;
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
      /* an AD2 user stepping back into its own portal leaves the assisted context */
      if (acting() && parts[1] !== 'directory') setSession({ ...S, actingFor:null });
      switch (parts[1]) {
        case 'dashboard':      html = viewAd2Dashboard(); break;
        case 'applications':   html = parts[2] ? viewApplicationReview(parts[2]) : viewApplications(); break;
        case 'directory':      html = viewDirectory(); break;
        case 'outward':        html = parts[2] ? viewOutwardDetail(parts[2]) : viewOutwardList(); break;
        case 'inward':         html = parts[2] ? viewInwardDetail(parts[2]) : viewInwardList(); break;
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
      <h3>Something went wrong rendering this screen</h3>
      <p>${esc(err.message)}</p>
      <button class="btn btn-plain" style="margin-top:14px" type="button" data-act="reset-demo">Reset demo data</button>
      </div></div></div>`;
  }
  root.innerHTML = html;
  document.body.classList.remove('nav-open');
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);

/* ---------- 24. helpers for actions --------------------------------------- */
function csvDownload(filename, rows) {
  const body = rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([body], { type:'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast('Export downloaded: ' + filename, 'ok');
}

function markField(key, ok) {
  const el = document.querySelector(`[data-fld="${key}"]`);
  if (el) el.classList.toggle('invalid', !ok);
}

function recalcBillSettlement(b) {
  b.outstanding = Math.max(0, b.amount - b.adjusted);
  b.settlement = b.adjusted <= 0 ? 'Unsettled' : b.outstanding <= 0 ? 'Settled' : 'Partially Settled';
}

function simulateFile(name) {
  return { filename: name, at: nowISO(), size: Math.floor(40 + Math.random() * 600) + ' KB' };
}

/* Enter the assisted context and go straight to a function, not a dashboard. */
function startAssist(smeId, dest) {
  const target = sme(smeId);
  if (!target || target.status !== 'Approved') { toast('Only an approved SME can be transacted for.', 'err'); return; }
  setSession({ ...S, actingFor: target.id });
  OR_DRAFT = null; DI_DRAFT = null; BILL_DRAFT = null;
  logAudit(target.id, `Assisted journey opened by ${S.name || S.role}`);
  save(); closeModal();
  location.hash = dest || '#/sme/dashboard';
  render();
  toast('Acting for ' + target.tradingName + '.', 'ok');
}

/* A beneficiary form used by both the transaction screen and the profile.
   `save` decides whether it lands in the master or stays a one-off. */
function beneFormHTML(v = {}, opts = {}) {
  const f = (k, label, req) => `
    <div class="f"><label for="bn-${k}">${esc(label)}${req ? '<span class="req">*</span>' : ''}</label>
      <input id="bn-${k}" type="text" value="${esc(v[k] || '')}"></div>`;
  return `<div class="grid g2 fields">
      ${f('name','Beneficiary name',true)}
      ${f('country','Beneficiary country',true)}
      ${f('bank','Bank name',true)}
      ${f('bankCountry','Bank country',true)}
      ${f('accountNumber','Account number / IBAN',true)}
      ${f('swift','SWIFT / BIC',true)}
      <div class="f"><label for="bn-currency">Account currency</label>
        <select id="bn-currency"><option value="">Not specified</option>
          ${DB.currencies.map(c => `<option ${v.currency === c.code ? 'selected' : ''}>${c.code}</option>`).join('')}</select>
        <div class="hint">Used to warn if a remittance currency does not match.</div></div>
      ${f('relationship','Relationship or note', false)}
      <div class="f span2"><label for="bn-address">Address</label>
        <input id="bn-address" type="text" value="${esc(v.address || '')}"></div>
    </div>
    ${opts.offerSave ? `<label class="chk" style="margin-top:var(--s4)">
        <input type="checkbox" id="bn-save" checked>
        <span>Save to the beneficiary master<small>Leave unticked for a genuine one-off payee.</small></span></label>` : ''}`;
}

function readBeneForm() {
  const g = k => (document.querySelector('#bn-' + k)?.value || '').trim();
  return { name:g('name'), country:g('country'), bank:g('bank'), bankCountry:g('bankCountry'),
           accountNumber:g('accountNumber'), swift:g('swift'), currency:g('currency'),
           relationship:g('relationship'), address:g('address') };
}
const beneMissing = v => ['name','country','bank','bankCountry','accountNumber','swift']
  .filter(k => !v[k]).length > 0;

/* Copy a beneficiary onto the outward draft as the payment snapshot. */
function applyBeneToDraft(v, id) {
  OR_DRAFT.beneficiaryId = id || '';
  OR_DRAFT.beneficiary = v.name;
  OR_DRAFT.beneficiaryCountry = v.country;
  OR_DRAFT.beneficiaryAccount = v.accountNumber;
  OR_DRAFT.swift = v.swift;
  OR_DRAFT.beneficiaryBank = v.bank;
  OR_DRAFT.beneficiaryBankCountry = v.bankCountry;
}

/* ---------- 25. event delegation ------------------------------------------ */
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;

  /* --- generic --- */
  if (act === 'go')        { e.preventDefault(); location.hash = t.dataset.href; return; }
  if (act === 'logout')    { setSession(null); location.hash = '#/login'; render(); return; }
  if (act === 'reset-demo'){ resetDemo(); return; }
  if (act === 'nav-toggle'){ document.body.classList.toggle('nav-open'); return; }
  if (act === 'apps')      { toast('Application launcher is out of scope for this prototype.'); return; }
  if (act === 'noop-note') { toast('Internal note saved.', 'ok'); return; }
  if (act === 'noop-individual') { toast('Individual, DSE and DSA sign-in is handled by the retail portal.'); return; }
  if (act === 'view-doc')  { modal({ title: t.dataset.n, body:
      `<div class="empty"><div class="ic">▤</div><h3>Document viewer</h3>
       <p>Document rendering is simulated in this prototype. No file is stored.</p></div>` }); return; }

  if (act === 'modal-close' || act === 'modal-dismiss') {
    if (act === 'modal-dismiss' && e.target !== t) return;
    closeModal(); return;
  }
  if (act === 'modal-ok') { const fn = modalOnOk; if (fn) fn(); return; }

  /* --- login --- */
  if (act === 'fill-login') {
    $('#li-domain').value = t.dataset.domain;
    $('#li-user').value = t.dataset.login;
    $('#li-pass').value = 'demo';
    $('#li-pass').focus();
    return;
  }

  /* --- onboarding --- */
  if (act === 'ob-step')  { DRAFT.step = +t.dataset.i; render(); return; }
  if (act === 'ob-back')  { DRAFT.step = Math.max(0, DRAFT.step - 1); render(); return; }
  if (act === 'ob-save')  { toast('Draft saved.', 'ok'); return; }
  if (act === 'ob-next')  {
    if (DRAFT.step === 0 && !DRAFT.domainId) DRAFT.domainId = slugDomain(DRAFT.legalName);
    DRAFT.step = Math.min(7, DRAFT.step + 1); render(); return;
  }
  if (act === 'ob-bank-add') {
    modal({ title:'Add bank account', okLabel:'Add account', body:`
      <div class="f fields grid g2">
        <div class="f"><label for="nb-bank">Bank name</label><input id="nb-bank" type="text"></div>
        <div class="f"><label for="nb-branch">Branch</label><input id="nb-branch" type="text"></div>
        <div class="f"><label for="nb-acc">Account number</label><input id="nb-acc" type="text"></div>
        <div class="f"><label for="nb-ifsc">IFSC</label><input id="nb-ifsc" type="text"></div>
        <div class="f"><label for="nb-cur">Currency</label><select id="nb-cur"><option>INR</option>
          ${DB.currencies.map(c => `<option>${c.code}</option>`).join('')}</select></div>
        <div class="f"><label for="nb-type">Account type</label><select id="nb-type">
          <option>Current</option><option>EEFC</option><option>Savings</option></select></div>
      </div>`,
      onOk: () => {
        const bank = $('#nb-bank').value.trim(), accn = $('#nb-acc').value.trim();
        if (!bank || !accn) { toast('Bank name and account number are required.', 'err'); return; }
        DRAFT.banks.push({ bank, branch:$('#nb-branch').value.trim(), accountNumber:accn,
          ifsc:$('#nb-ifsc').value.trim(), currency:$('#nb-cur').value, type:$('#nb-type').value, verified:false });
        closeModal(); render(); toast('Account added.', 'ok');
      }});
    return;
  }
  if (act === 'ob-bank-del') { DRAFT.banks.splice(+t.dataset.i, 1); render(); return; }
  if (act === 'ob-penny') {
    const b = DRAFT.banks[+t.dataset.i];
    t.disabled = true; t.textContent = 'Verifying…';
    setTimeout(() => { b.verified = true; render(); toast('PennyDrop verified — ₹1.00 credited and name matched (simulated).', 'ok'); }, 900);
    return;
  }
  if (act === 'ob-doc-add') { DRAFT.docs[t.dataset.id] = simulateFile(t.dataset.id + '-upload.pdf'); render(); toast('Document uploaded (simulated).', 'ok'); return; }
  if (act === 'ob-doc-del') { delete DRAFT.docs[t.dataset.id]; render(); return; }
  if (act === 'ob-submit') {
    const missing = onboardMissing(DRAFT);
    if (missing.length) { toast('Complete the application first: ' + missing[0], 'err'); return; }
    if (!$('#declare')?.checked) { toast('Tick the declaration before submitting.', 'err'); return; }
    const id = nextId(DB.smes, 'SME');
    DB.smes.push({ ...DRAFT, id, status:'Submitted', submittedAt:nowISO(), approvedAt:null, config:null,
      country:DRAFT.country || 'India', createdBy:'SME Applicant' });
    DRAFT.banks.forEach((b, i) => DB.accounts.push({
      id: nextId(DB.accounts, 'BA', 3), smeId:id, holder:DRAFT.legalName, ...b,
      verifiedOn: b.verified ? nowISO() : null, primary: i === 0 }));
    logAudit(id, 'Application submitted through digital onboarding');
    save(); DRAFT = null;
    modal({ title:'Application submitted', body:
      `<div class="note note-ok"><span>Your application <b>${esc(id)}</b> has been submitted.
       AD2 will review it and may raise a query. Track progress under Application Status.</span></div>`,
      okLabel:'View status', onOk: () => { closeModal(); location.hash = '#/status'; } });
    return;
  }

  /* --- beneficiary master --- */
  if (act === 'bene-new' || act === 'bene-edit') {
    const editing = act === 'bene-edit';
    const existing = editing
      ? (bene(OR_DRAFT.beneficiaryId) || { name:OR_DRAFT.beneficiary, country:OR_DRAFT.beneficiaryCountry,
          bank:OR_DRAFT.beneficiaryBank, bankCountry:OR_DRAFT.beneficiaryBankCountry,
          accountNumber:OR_DRAFT.beneficiaryAccount, swift:OR_DRAFT.swift })
      : {};
    modal({ title: editing ? 'Beneficiary details' : 'Add a beneficiary', wide:true,
      okLabel: editing ? 'Use these details' : 'Add beneficiary',
      body: beneFormHTML(existing, { offerSave: !editing }) +
        (editing ? `<div class="note note-info" style="margin-top:var(--s4)"><span>
            Editing here changes only this request. Use Profile → Beneficiary master to change the
            saved record.</span></div>` : ''),
      onOk: () => {
        const v = readBeneForm();
        if (beneMissing(v)) { toast('Name, country, bank, bank country, account and SWIFT are required.', 'err'); return; }
        if (editing) { applyBeneToDraft(v, ''); closeModal(); render(); toast('Details applied to this request only.'); return; }
        const keep = document.querySelector('#bn-save')?.checked;
        let id = '';
        if (keep) {
          id = nextId(DB.beneficiaries, 'BEN', 3);
          DB.beneficiaries.push({ id, smeId:ctxSmeId(), ...v,
            addedBy: acting() ? `${S.name || S.role} (assisted)` : (S.name || S.role),
            addedOn: nowISO(), lastUsed: null });
          logAudit(ctxSmeId(), `Beneficiary ${v.name} added to the master${acting() ? ' by AD2 on the SME\u2019s behalf' : ''}`);
          save();
        }
        applyBeneToDraft(v, id);
        closeModal(); render();
        toast(keep ? 'Beneficiary added and selected.' : 'One-off beneficiary applied, not saved.', 'ok');
      }});
    return;
  }
  if (act === 'bene-clear') {
    applyBeneToDraft({ name:'', country:'', accountNumber:'', swift:'', bank:'', bankCountry:'' }, '');
    render(); return;
  }
  if (act === 'bene-add-profile') {
    modal({ title:'Add a beneficiary', wide:true, okLabel:'Add beneficiary', body: beneFormHTML({}, {}),
      onOk: () => {
        const v = readBeneForm();
        if (beneMissing(v)) { toast('Name, country, bank, bank country, account and SWIFT are required.', 'err'); return; }
        const id = nextId(DB.beneficiaries, 'BEN', 3);
        DB.beneficiaries.push({ id, smeId:ctxSmeId(), ...v,
          addedBy: acting() ? `${S.name || S.role} (assisted)` : (S.name || S.role),
          addedOn: nowISO(), lastUsed: null });
        logAudit(ctxSmeId(), `Beneficiary ${v.name} added to the master${acting() ? ' by AD2 on the SME\u2019s behalf' : ''}`);
        save(); closeModal(); render(); toast('Beneficiary added.', 'ok');
      }});
    return;
  }
  if (act === 'bene-del-profile') {
    const b = bene(t.dataset.id);
    if (!b) return;
    const used = DB.outward.some(o => o.beneficiaryId === b.id);
    modal({ title:'Remove beneficiary', okLabel:'Remove', okClass:'btn-danger', body:
      `<p style="font-size:var(--fs-md)">Remove <b>${esc(b.name)}</b> from the beneficiary master?</p>
       ${used ? `<div class="note note-info" style="margin-top:var(--s3)"><span>
         Past remittances to this beneficiary keep the details they were sent with, so nothing in the
         history changes.</span></div>` : ''}`,
      onOk: () => {
        DB.beneficiaries = DB.beneficiaries.filter(x => x.id !== b.id);
        logAudit(ctxSmeId(), `Beneficiary ${b.name} removed from the master`);
        save(); closeModal(); render(); toast('Beneficiary removed.');
      }});
    return;
  }

  /* --- outward create --- */
  if (act === 'or-book-rate') {
    const d = OR_DRAFT, me = sme(d.smeId);
    if (!d.currency) { toast('Select a currency first.', 'err'); return; }
    const m = marginFor(me, d.currency);
    d.rate = { mode:'booked', refRate:currency(d.currency).refRate, margin:m,
      customerRate:customerRate(d.currency, m), bookedAt:nowISO(),
      expiresAt:new Date(Date.now() + 48 * 3600000).toISOString(), dealRef:null };
    render(); toast('Rate booked and locked for 48 hours. Treasury notified.', 'ok'); return;
  }
  if (act === 'or-deal-ref') {
    modal({ title:'FX deal reference', okLabel:'Apply deal', body:`
      <p style="font-size:var(--fs-sm);color:var(--muted);margin:0 0 14px">
        Where you have negotiated a rate with the bank by phone, enter the deal reference the dealer gave you.</p>
      <div class="f"><label for="dref">FX deal reference</label>
        <input id="dref" type="text" placeholder="e.g. FXD-2026-77412"></div>
      <div class="f" style="margin-top:12px"><label for="drate">Agreed rate</label>
        <input id="drate" type="number" step="0.0001" placeholder="e.g. 88.9000"></div>`,
      onOk: () => {
        const ref = $('#dref').value.trim(), rt = parseFloat($('#drate').value);
        if (!ref) { toast('Enter the deal reference.', 'err'); return; }
        const d = OR_DRAFT;
        d.rate = { mode:'deal', refRate:currency(d.currency).refRate, margin:marginFor(sme(d.smeId), d.currency),
          customerRate: isNaN(rt) ? customerRate(d.currency, marginFor(sme(d.smeId), d.currency)) : rt,
          bookedAt:null, expiresAt:null, dealRef:ref };
        closeModal(); render(); toast('Deal reference applied.', 'ok');
      }});
    return;
  }
  if (act === 'or-rate-clear') {
    OR_DRAFT.rate = { mode:'none', refRate:0, margin:0, customerRate:0, bookedAt:null, expiresAt:null, dealRef:null };
    render(); return;
  }
  if (act === 'or-doc-add') { OR_DRAFT.docs[t.dataset.id] = simulateFile(t.dataset.id + '.pdf'); render(); toast('Document uploaded (simulated).', 'ok'); return; }
  if (act === 'or-doc-del') { delete OR_DRAFT.docs[t.dataset.id]; render(); return; }
  if (act === 'or-save')    { toast('Draft saved.', 'ok'); return; }
  if (act === 'or-submit') {
    const d = OR_DRAFT;
    const missing = outwardMissing(d);
    ['beneficiary','beneficiaryCountry','beneficiaryAccount','swift','beneficiaryBank',
     'beneficiaryBankCountry','currency','purposeCode','executionDate','debitAccountId','amount']
      .forEach(k => markField(k, !!d[k]));
    if (missing.length) {
      modal({ title:'Cannot submit yet', body:
        `<div class="note note-err"><span>Resolve the following before submitting:</span></div>
         <ul style="margin:14px 0 0 18px;font-size:var(--fs-md);line-height:1.8">
           ${missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` });
      return;
    }
    const me = sme(d.smeId);
    const id = nextId(DB.outward, 'OR');
    const charges = (me.config.charges || []).map(c => ({ name:c.name,
      amount: c.basis === 'Fixed' ? c.value : Number(d.amount) * d.rate.customerRate * c.value / 100 }));
    DB.outward.unshift({ ...d, id, amount:Number(d.amount), charges,
      status:'Submitted', requestDate:nowISO(), pendingWith:'AD2 Maker',
      source: acting() ? 'AD2 Assisted' : 'SME', createdBy: S.name || S.role });
    const usedBene = bene(d.beneficiaryId);
    if (usedBene) usedBene.lastUsed = nowISO();
    logAudit(id, `Outward request submitted — ${money(d.amount, d.currency)}, ${rtype(d.remittanceType)?.label || ''} under ${d.purposeCode}${acting() ? ' (assisted, on behalf of ' + (sme(d.smeId)?.tradingName || '') + ')' : ''}`);
    if (d.rate.mode === 'booked') logAudit(id, `Rate booked at ${d.rate.customerRate.toFixed(4)}, locked 48 hours`);
    if (d.rate.mode === 'deal')   logAudit(id, `FX deal reference ${d.rate.dealRef} applied`);
    save(); OR_DRAFT = null;
    toast('Outward request ' + id + ' submitted.', 'ok');
    location.hash = '#/sme/outward/' + id;
    return;
  }

  /* --- outward workflow --- */
  if (act === 'or-submit-existing') {
    const o = DB.outward.find(x => x.id === t.dataset.id);
    o.status = 'Submitted'; o.pendingWith = 'AD2 Maker';
    logAudit(o.id, 'Draft submitted for review'); save(); render();
    toast('Request submitted.', 'ok'); return;
  }
  if (act === 'or-approve') {
    const o = DB.outward.find(x => x.id === t.dataset.id);
    modal({ title:'Approve for processing', okLabel:'Approve',
      body:`<p style="font-size:var(--fs-md)">Approve <b>${esc(o.id)}</b> for processing?
        ${money(o.amount, o.currency)} to ${esc(o.beneficiary)}.</p>`,
      onOk: () => {
        o.status = 'Processing'; o.pendingWith = 'AD2 Operations';
        logAudit(o.id, 'Approved for processing'); save(); closeModal(); render();
        toast('Request approved.', 'ok');
      }});
    return;
  }
  if (act === 'or-complete') {
    const o = DB.outward.find(x => x.id === t.dataset.id);
    o.status = 'Completed'; o.pendingWith = '—';
    (o.allocations || []).forEach(a => { const b = bill(a.billId); if (b) { b.adjusted += a.amount; recalcBillSettlement(b); } });
    logAudit(o.id, 'Payment executed and marked completed'); save(); render();
    toast('Marked completed. Linked bills updated.', 'ok'); return;
  }
  if (act === 'or-query') {
    const o = DB.outward.find(x => x.id === t.dataset.id);
    modal({ title:'Raise query', okLabel:'Send query', body:
      `<div class="f"><label for="qtext">Query for the SME</label>
       <textarea id="qtext" placeholder="Describe what is needed"></textarea>
       <div class="hint">A reason is required. The request returns to the SME.</div></div>`,
      onOk: () => {
        const q = $('#qtext').value.trim();
        if (!q) { toast('Enter the query.', 'err'); return; }
        o.status = 'Clarification Required'; o.pendingWith = 'SME';
        o.query = { question:q, raisedBy:S.role, raisedAt:nowISO(), response:null };
        logAudit(o.id, 'Clarification requested'); save(); closeModal(); render();
        toast('Query sent to the SME.', 'ok');
      }});
    return;
  }
  if (act === 'or-respond') {
    const o = DB.outward.find(x => x.id === t.dataset.id);
    modal({ title:'Respond to query', okLabel:'Send response', body:
      `<div class="note note-warn" style="margin-bottom:14px"><span>${esc(o.query.question)}</span></div>
       <div class="f"><label for="rtext">Your response</label><textarea id="rtext"></textarea></div>`,
      onOk: () => {
        const r = $('#rtext').value.trim();
        if (!r) { toast('Enter a response.', 'err'); return; }
        o.query.response = r; o.status = 'Under Review'; o.pendingWith = 'AD2 Operations';
        logAudit(o.id, 'SME responded to query — returned for review'); save(); closeModal(); render();
        toast('Response sent.', 'ok');
      }});
    return;
  }
  if (act === 'or-reject') {
    const o = DB.outward.find(x => x.id === t.dataset.id);
    modal({ title:'Reject request', okLabel:'Reject', okClass:'btn-danger', body:
      `<div class="f"><label for="rjt">Reason for rejection</label><textarea id="rjt"></textarea>
       <div class="hint">A reason is required and is shown to the SME.</div></div>`,
      onOk: () => {
        const r = $('#rjt').value.trim();
        if (!r) { toast('A reason is required.', 'err'); return; }
        o.status = 'Rejected'; o.pendingWith = '—'; o.rejectReason = r;
        logAudit(o.id, 'Request rejected'); save(); closeModal(); render();
        toast('Request rejected.', 'ok');
      }});
    return;
  }

  /* --- disposal --- */
  if (act === 'di-book-rate') {
    const i = DB.inward.find(x => x.id === DI_DRAFT.inwardId);
    const m = marginFor(sme(i.smeId), i.currency);
    DI_DRAFT.rate = { mode:'booked', refRate:currency(i.currency).refRate, margin:m,
      customerRate:customerRate(i.currency, -m), bookedAt:nowISO(), dealRef:null };
    render(); toast('Rate booked and locked for 48 hours. Treasury notified.', 'ok'); return;
  }
  if (act === 'di-deal-ref') {
    modal({ title:'FX deal reference', okLabel:'Apply deal', body:
      `<div class="f"><label for="ddref">FX deal reference</label><input id="ddref" type="text" placeholder="e.g. FXD-2026-77188"></div>
       <div class="f" style="margin-top:12px"><label for="ddrate">Agreed rate</label>
         <input id="ddrate" type="number" step="0.0001"></div>`,
      onOk: () => {
        const ref = $('#ddref').value.trim(), rt = parseFloat($('#ddrate').value);
        if (!ref) { toast('Enter the deal reference.', 'err'); return; }
        const i = DB.inward.find(x => x.id === DI_DRAFT.inwardId);
        const m = marginFor(sme(i.smeId), i.currency);
        DI_DRAFT.rate = { mode:'deal', refRate:currency(i.currency).refRate, margin:m,
          customerRate: isNaN(rt) ? customerRate(i.currency, -m) : rt, bookedAt:null, dealRef:ref };
        closeModal(); render(); toast('Deal reference applied.', 'ok');
      }});
    return;
  }
  if (act === 'di-rate-clear') { DI_DRAFT.rate = { mode:'none', refRate:0, margin:0, customerRate:0, bookedAt:null, dealRef:null }; render(); return; }
  if (act === 'di-doc-add') { DI_DRAFT.docs[t.dataset.id] = simulateFile(t.dataset.id + '.pdf'); render(); toast('Document uploaded (simulated).', 'ok'); return; }
  if (act === 'di-doc-del') { delete DI_DRAFT.docs[t.dataset.id]; render(); return; }
  if (act === 'di-save') { toast('Draft saved.', 'ok'); return; }
  if (act === 'di-submit') {
    const i = DB.inward.find(x => x.id === t.dataset.id);
    const d = DI_DRAFT;
    const allocated = d.allocations.reduce((s, a) => s + a.amount, 0);
    const errs = [];
    if (!allocated) errs.push('Apply the receipt against at least one export bill.');
    if (allocated > i.available) errs.push('Applied amount exceeds the available receipt balance.');
    if (!d.creditAccountId) { errs.push('Select an account to credit.'); markField('creditAccountId', false); }
    if (!d.remittanceType) { errs.push('Select a remittance type.'); markField('di-remittanceType', false); }
    if (!d.purposeCode)    { errs.push('Select a purpose of remittance.'); markField('di-purposeCode', false); }
    checklistFor(d.purposeCode, d.remittanceType)
      .filter(x => x.required && !d.docs[x.id]).forEach(x => errs.push('Upload: ' + x.name));
    if (d.rate.mode === 'none') errs.push('Book a rate or enter an FX deal reference.');
    if (errs.length) {
      modal({ title:'Cannot submit yet', body:
        `<div class="note note-err"><span>Resolve the following:</span></div>
         <ul style="margin:14px 0 0 18px;font-size:var(--fs-md);line-height:1.8">
           ${errs.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` });
      return;
    }
    const id = nextId(DB.disposals, 'DI');
    DB.disposals.unshift({ id, inwardId:i.id, smeId:i.smeId, amount:allocated, currency:i.currency,
      creditAccountId:d.creditAccountId, allocations:[...d.allocations], rate:d.rate,
      purposeCode:d.purposeCode, remittanceType:d.remittanceType,
      status:'Under Review', submittedAt:nowISO(), remarks:d.remarks,
      source: acting() ? 'AD2 Assisted' : 'SME', createdBy: S.name || S.role });
    /* the instruction is the authoritative classification — write it back to the receipt */
    i.purposeCode = d.purposeCode; i.remittanceType = d.remittanceType;
    i.available -= allocated;
    i.status = i.available > 0 ? 'Instruction Submitted' : 'Instruction Submitted';
    logAudit(i.id, `Disposal instruction ${id} submitted for ${money(allocated, i.currency)} — ${rtype(d.remittanceType)?.label || ''} under ${d.purposeCode}`);
    save(); DI_DRAFT = null;
    toast('Disposal instruction ' + id + ' submitted.', 'ok');
    location.hash = '#/sme/inward/' + i.id;
    return;
  }

  /* --- bills --- */
  if (act === 'bill-tab')   { billTab = t.dataset.t; render(); return; }
  if (act === 'bill-clear') { BILL_DRAFT = null; render(); return; }
  if (act === 'bill-doc')   { toast('Bill document attached (simulated).', 'ok'); return; }
  if (act === 'bill-ai') {
    const type = t.dataset.type;
    t.disabled = true; t.textContent = 'Extracting…';
    setTimeout(() => {
      const sample = type === 'Export'
        ? { invoiceNumber:'MTX/EXP/2026/0172', invoiceDate:'2026-09-20', counterparty:'Bergmann Textilhandel GmbH',
            counterpartyCountry:'Germany', currency:'EUR', amount:'141300', dueDate:'2026-12-19',
            orderRef:'PO-BTH-4462', shipmentRef:'SB-2301188' }
        : { invoiceNumber:'SUP-IT-99077', invoiceDate:'2026-09-18', counterparty:'Filatura Ponti S.p.A.',
            counterpartyCountry:'Italy', currency:'EUR', amount:'52400', dueDate:'2026-11-17',
            orderRef:'MTX-PO-2266', shipmentRef:'BOE-7752901' };
      BILL_DRAFT = { type, ...sample, extracted:{ invoiceNumber:0.97, invoiceDate:0.94, counterparty:0.91,
        counterpartyCountry:0.88, currency:0.99, amount:0.96, dueDate:0.72, orderRef:0.81, shipmentRef:0.69 } };
      render();
      toast('Invoice parsed. Check the highlighted fields before lodging.', 'ok');
    }, 1100);
    return;
  }
  if (act === 'bill-save') {
    const type = t.dataset.type, d = BILL_DRAFT;
    const req = ['invoiceNumber','invoiceDate','counterparty','counterpartyCountry','currency','amount','dueDate'];
    let ok = true;
    req.forEach(k => { const good = !!d[k]; markField(k, good); if (!good) ok = false; });
    if (!ok) { toast('Complete the required fields.', 'err'); return; }
    if (DB.bills.some(b => b.smeId === ctxSmeId() && b.invoiceNumber === d.invoiceNumber)) {
      modal({ title:'Duplicate bill', body:
        `<div class="note note-err"><span>Invoice <b>${esc(d.invoiceNumber)}</b> is already lodged for this SME.
         Duplicates are blocked on the agreed business key.</span></div>` });
      return;
    }
    const id = nextId(DB.bills, 'BL', 5);
    const accepted = DB.settings.autoChecker;
    DB.bills.unshift({ id, smeId:ctxSmeId(), type, invoiceNumber:d.invoiceNumber, invoiceDate:d.invoiceDate,
      counterparty:d.counterparty, counterpartyCountry:d.counterpartyCountry, currency:d.currency,
      amount:Number(d.amount), adjusted:0, outstanding:Number(d.amount), dueDate:d.dueDate,
      orderRef:d.orderRef, shipmentRef:d.shipmentRef, source:'Form fill',
      review: accepted ? 'Accepted' : 'Submitted', settlement:'Unsettled' });
    logAudit(id, `${type} bill lodged${accepted ? ' and auto-accepted by AutoChecker' : ' — awaiting checker'}`);
    save(); BILL_DRAFT = null; billTab = 'register'; render();
    toast(`Bill ${id} lodged.`, 'ok');
    return;
  }
  if (act === 'csv-template') {
    csvDownload('bill-template.csv', [
      ['invoice_number','invoice_date','counterparty','country','currency','amount','due_date','order_ref'],
      ['INV-0001','2026-09-01','Example Counterparty','Germany','EUR','10000.00','2026-12-01','PO-1234']]);
    return;
  }
  if (act === 'csv-sample') {
    $('#csvbox').value =
`invoice_number,invoice_date,counterparty,country,currency,amount,due_date,order_ref
MTX/EXP/2026/0181,2026-09-21,Halstead Retail Group,United Kingdom,GBP,64200.00,2026-12-20,PO-HRG-88512
MTX/EXP/2026/0182,2026-09-21,Bergmann Textilhandel GmbH,Germany,EUR,88900.00,2026-12-20,PO-BTH-4471
MTX/EXP/2026/0141,2026-07-18,Halstead Retail Group,United Kingdom,GBP,184500.00,2026-10-16,PO-HRG-88213
BAD-ROW,2026-09-21,Missing Currency Ltd,France,,15000.00,2026-12-20,PO-X`;
    return;
  }
  if (act === 'csv-validate') {
    const type = t.dataset.type;
    const text = ($('#csvbox').value || '').trim();
    if (!text) { toast('Paste or load some rows first.', 'err'); return; }
    const lines = text.split('\n').filter(Boolean);
    const rows = lines.slice(1).map((l, idx) => {
      const c = l.split(',');
      const rec = { line: idx + 2, invoiceNumber:c[0], invoiceDate:c[1], counterparty:c[2],
        counterpartyCountry:c[3], currency:c[4], amount:c[5], dueDate:c[6], orderRef:c[7] };
      const errs = [];
      if (!rec.invoiceNumber) errs.push('invoice number missing');
      if (!rec.currency) errs.push('currency missing');
      if (!rec.counterpartyCountry) errs.push('country missing');
      if (!(Number(rec.amount) > 0)) errs.push('amount invalid');
      if (rec.currency && !availableCurrencies(sme(ctxSmeId())).includes(rec.currency))
        errs.push(`currency ${rec.currency} is not enabled`);
      if (DB.bills.some(b => b.smeId === ctxSmeId() && b.invoiceNumber === rec.invoiceNumber))
        errs.push('duplicate — already lodged');
      rec.errs = errs;
      return rec;
    });
    const good = rows.filter(r => !r.errs.length), bad = rows.filter(r => r.errs.length);
    $('#csv-preview').innerHTML = `
      <div class="note ${bad.length ? 'note-warn' : 'note-ok'}" style="margin-bottom:14px"><span>
        ${good.length} row${good.length === 1 ? '' : 's'} ready, ${bad.length} with errors.
        ${bad.length ? 'Failed rows are preserved and can be downloaded for correction.' : ''}</span></div>
      <div class="tablewrap"><table class="dt">
        <thead><tr><th>Line</th><th>Invoice</th><th>Counterparty</th><th>Currency</th>
          <th class="num">Amount</th><th>Result</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r.line}</td><td>${esc(r.invoiceNumber || '—')}</td>
          <td>${esc(r.counterparty || '—')}</td><td>${esc(r.currency || '—')}</td>
          <td class="num">${esc(r.amount || '—')}</td>
          <td>${r.errs.length ? `<span class="badge b-red">${esc(r.errs.join('; '))}</span>` : '<span class="badge b-green">Valid</span>'}</td></tr>`).join('')}</tbody>
      </table></div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
        <button class="btn btn-primary" type="button" data-act="csv-confirm" data-type="${type}" ${good.length ? '' : 'disabled'}>
          Confirm ${good.length} row${good.length === 1 ? '' : 's'}</button>
        ${bad.length ? `<button class="btn btn-plain" type="button" data-act="csv-errors">Download failed rows</button>` : ''}
      </div>`;
    window.__csvGood = good; window.__csvBad = bad;
    return;
  }
  if (act === 'csv-errors') {
    csvDownload('failed-rows.csv', [['line','invoice_number','counterparty','currency','amount','errors'],
      ...window.__csvBad.map(r => [r.line, r.invoiceNumber, r.counterparty, r.currency, r.amount, r.errs.join('; ')])]);
    return;
  }
  if (act === 'csv-confirm') {
    const type = t.dataset.type;
    let n = 0;
    (window.__csvGood || []).forEach(r => {
      const id = nextId(DB.bills, 'BL', 5);
      DB.bills.unshift({ id, smeId:ctxSmeId(), type, invoiceNumber:r.invoiceNumber, invoiceDate:r.invoiceDate,
        counterparty:r.counterparty, counterpartyCountry:r.counterpartyCountry, currency:r.currency,
        amount:Number(r.amount), adjusted:0, outstanding:Number(r.amount), dueDate:r.dueDate,
        orderRef:r.orderRef, shipmentRef:'', source:'CSV upload',
        review: DB.settings.autoChecker ? 'Accepted' : 'Submitted', settlement:'Unsettled' });
      n++;
    });
    DB.jobs.unshift({ id: nextId(DB.jobs, 'JOB'), smeId:ctxSmeId(), source:'CSV upload', runAt:nowISO(),
      received:(window.__csvGood.length + window.__csvBad.length), accepted:n, rejected:window.__csvBad.length,
      errors: window.__csvBad.map(r => ({ row:String(r.line), message:r.errs.join('; ') })) });
    save(); billTab = 'register'; render();
    toast(`${n} bill${n === 1 ? '' : 's'} lodged from upload.`, 'ok');
    return;
  }
  if (act === 'job-retry') {
    const j = DB.jobs.find(x => x.id === t.dataset.id);
    t.disabled = true; t.textContent = 'Retrying…';
    setTimeout(() => {
      const dup = j.errors.filter(e => /duplicate/i.test(e.message));
      j.accepted += (j.rejected - dup.length); j.rejected = dup.length; j.errors = dup;
      save(); render();
      toast(dup.length ? 'Retried. Duplicates were skipped, so no bills were created twice.'
                       : 'Retry succeeded. All rows accepted.', 'ok');
    }, 900);
    return;
  }

  /* --- knock-off --- */
  if (act === 'ko-suggest') {
    const smeId = ctxSmeId();
    const bills = DB.bills.filter(b => b.smeId === smeId && b.type === KO.side && b.outstanding > 0 && b.review === 'Accepted');
    const rems = KO.side === 'Export'
      ? DB.inward.filter(i => i.smeId === smeId && i.available > 0)
      : DB.outward.filter(o => o.smeId === smeId && o.status === 'Completed');
    const found = [];
    bills.forEach(b => {
      const m = rems.find(r => r.currency === b.currency &&
        (r.remitter === b.counterparty || r.beneficiary === b.counterparty) &&
        !found.some(f => f.remId === (r.reference || r.id)));
      if (m) found.push({ billId:b.id, remId:m.reference || m.id,
        amount: Math.min(b.outstanding, KO.side === 'Export' ? m.available : m.amount) });
    });
    if (!found.length) { toast('No matches found on currency, counterparty and amount.'); return; }
    KO.allocations = found; render();
    toast(`${found.length} match${found.length === 1 ? '' : 'es'} proposed. Confirm before submitting.`, 'ok');
    return;
  }
  if (act === 'ko-clear')  { KO.allocations = []; render(); return; }
  if (act === 'ko-remove') { KO.allocations.splice(+t.dataset.i, 1); render(); return; }
  if (act === 'ko-submit') {
    modal({ title:'Submit allocations for review', okLabel:'Submit', body:
      `<p style="font-size:var(--fs-md)">Submit ${KO.allocations.length} proposed allocation${KO.allocations.length === 1 ? '' : 's'} for AD2 confirmation?</p>
       <p style="font-size:var(--fs-sm);color:var(--muted)">Balances update only once AD2 confirms.</p>`,
      onOk: () => {
        KO.allocations.forEach(a => logAudit(a.billId, `Allocation proposed against ${a.remId} for ${money(a.amount)}`));
        KO.allocations = []; save(); closeModal(); render();
        toast('Allocations submitted for AD2 review.', 'ok');
      }});
    return;
  }

  /* --- AD2 review --- */
  if (act === 'rv-charge-add') {
    modal({ title:'Add charge', okLabel:'Add', body:`
      <div class="fields grid g2">
        <div class="f"><label for="ch-name">Charge name</label><select id="ch-name">
          ${DB.chargeCategories.map(c => `<option>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="f"><label for="ch-basis">Basis</label><select id="ch-basis"><option>Fixed</option><option>Percentage</option></select></div>
        <div class="f"><label for="ch-val">Value</label><input id="ch-val" type="number" step="0.01" value="0"></div>
        <div class="f"><label for="ch-cur">Currency</label><select id="ch-cur"><option>INR</option>
          ${DB.currencies.map(c => `<option>${c.code}</option>`).join('')}</select></div>
        <div class="f span2"><label for="ch-freq">Applied</label><select id="ch-freq">
          <option>Per transaction</option><option>Per document set</option><option>Monthly</option></select></div>
      </div>
      <p style="font-size:var(--fs-xs);color:var(--muted);margin-top:12px">
        Enter zero explicitly if there is no charge — a blank value is not accepted.</p>`,
      onOk: () => {
        const v = parseFloat($('#ch-val').value);
        if (isNaN(v)) { toast('Enter a value, including zero.', 'err'); return; }
        REVIEW.charges.push({ category:'txn', name:$('#ch-name').value, basis:$('#ch-basis').value,
          value:v, currency:$('#ch-cur').value, frequency:$('#ch-freq').value });
        closeModal(); render(); }});
    return;
  }
  if (act === 'rv-charge-del') { REVIEW.charges.splice(+t.dataset.i, 1); render(); return; }
  if (act === 'rv-save') { toast('Review saved.', 'ok'); return; }
  if (act === 'rv-approve') {
    const s = sme(t.dataset.id), r = REVIEW;
    const missing = [];
    if (!r.permission) missing.push('transaction permission');
    if (!r.currencies.length) missing.push('at least one enabled currency');
    if (!r.charges.length) missing.push('at least one charge');
    if (!r.effectiveDate) missing.push('effective date');
    r.currencies.forEach(c => { if (r.margins[c] == null && r.margins.USD == null) missing.push('margin for ' + c); });
    if (missing.length) {
      modal({ title:'Cannot approve yet', body:
        `<div class="note note-err"><span>Approval requires complete permissions, currencies, margins and charges.</span></div>
         <ul style="margin:14px 0 0 18px;font-size:var(--fs-md);line-height:1.8">
           ${missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` });
      return;
    }
    if (!s.iec) {
      modal({ title:'IEC missing', body:
        `<div class="note note-err"><span>IEC is mandatory for all regular transacting customers.
         Raise a clarification to collect it before approving.</span></div>` });
      return;
    }
    modal({ title: DB.settings.autoChecker ? 'Approve application' : 'Send to checker',
      okLabel: DB.settings.autoChecker ? 'Approve' : 'Send', body:
      `<p style="font-size:var(--fs-md)">Approve <b>${esc(s.legalName)}</b> with
        ${esc(r.permission)} permission on ${r.currencies.join(', ')}?</p>
       <p style="font-size:var(--fs-sm);color:var(--muted)">
        ${DB.settings.autoChecker
          ? 'AutoChecker is enabled, so this commits immediately.'
          : 'A checker must confirm before the SME portal reflects these settings.'}</p>`,
      onOk: () => {
        const margins = {};
        r.currencies.forEach(c => { margins[c] = r.margins[c] != null ? r.margins[c] : marginFor({ config:{ margins:r.margins } }, c); });
        s.config = { permission:r.permission, currencies:[...r.currencies], margins,
          marginBasis:r.marginBasis, charges:[...r.charges], effectiveDate:r.effectiveDate, remarks:r.remarks };
        s.status = 'Approved'; s.approvedAt = nowISO();
        logAudit(s.id, `Application approved — ${r.permission}, ${r.currencies.join('/')}, effective ${dmy(r.effectiveDate)}`);
        save(); closeModal(); REVIEW = null; render();
        toast('Application approved. The SME portal now reflects these settings.', 'ok');
      }});
    return;
  }
  if (act === 'rv-clarify') {
    const s = sme(t.dataset.id);
    modal({ title:'Request clarification', okLabel:'Send', body:
      `<div class="f"><label for="cl">What is needed from the SME</label><textarea id="cl"></textarea>
       <div class="hint">A reason is required.</div></div>`,
      onOk: () => {
        const v = $('#cl').value.trim();
        if (!v) { toast('Enter a reason.', 'err'); return; }
        s.status = 'Clarification Required';
        logAudit(s.id, 'Clarification requested: ' + v);
        save(); closeModal(); render(); toast('Clarification sent.', 'ok');
      }});
    return;
  }
  if (act === 'rv-reject') {
    const s = sme(t.dataset.id);
    modal({ title:'Reject application', okLabel:'Reject', okClass:'btn-danger', body:
      `<div class="f"><label for="rj">Reason for rejection</label><textarea id="rj"></textarea>
       <div class="hint">A reason is required.</div></div>`,
      onOk: () => {
        const v = $('#rj').value.trim();
        if (!v) { toast('A reason is required.', 'err'); return; }
        s.status = 'Rejected'; logAudit(s.id, 'Application rejected: ' + v);
        save(); closeModal(); render(); toast('Application rejected.', 'ok');
      }});
    return;
  }
  /* Start an assisted journey and land on the function the user came from,
     never a dashboard. dest is a hash route; smeId is the SME picked up. */
  if (act === 'assist-pick') {
    const dir = t.dataset.dir;                       /* 'outward' | 'inward' */
    const pool = DB.smes.filter(x => x.status === 'Approved' &&
      (dir === 'outward' ? perm(x).importSide : perm(x).exportSide));
    if (!pool.length) {
      modal({ title:'No eligible SME', body:
        `<div class="note note-warn"><span>No approved SME currently has
         ${dir === 'outward' ? 'Import or Both' : 'Export or Both'} permission, so there is nobody to
         raise ${dir === 'outward' ? 'an outward request' : 'a disposal instruction'} for.</span></div>` });
      return;
    }
    modal({ title: dir === 'outward' ? 'New outward request for an SME' : 'Disposal instruction for an SME',
      wide:true, body:
      `<p style="font-size:var(--fs-md);margin:0 0 16px">Pick the SME you are acting for. You will go
        straight to ${dir === 'outward' ? 'their outward request form' : 'their inward remittances'},
        and what you submit is recorded as raised by you on their behalf.</p>
       <div class="tablewrap"><table class="dt">
         <thead><tr><th>SME</th><th>Permission</th><th>Currencies</th>
           <th class="num">${dir === 'outward' ? 'Open import bills' : 'Receipts to dispose'}</th><th></th></tr></thead>
         <tbody>${pool.map(x => {
           const n = dir === 'outward'
             ? DB.bills.filter(b => b.smeId === x.id && b.type === 'Import' && b.outstanding > 0 && b.review === 'Accepted').length
             : DB.inward.filter(i => i.smeId === x.id && i.available > 0).length;
           return `<tr><td><b>${esc(x.tradingName)}</b><br>
               <span style="color:var(--muted);font-size:var(--fs-xs)">${esc(x.id)} · ${esc(x.constitution)}</span></td>
             <td>${esc(x.config.permission)}</td><td>${x.config.currencies.join(' · ')}</td>
             <td class="num">${n}</td>
             <td><button class="btn btn-ghost btn-sm" type="button" data-act="assist-go"
                   data-id="${x.id}" data-dest="${dir === 'outward' ? '#/sme/outward/new' : '#/sme/inward'}">Act for them</button></td></tr>`;
         }).join('')}</tbody></table></div>` });
    return;
  }

  if (act === 'assist-dispose') {
    const rec = DB.inward.find(x => x.id === t.dataset.id);
    if (!rec) return;
    startAssist(rec.smeId, '#/sme/inward/' + rec.id + '/dispose');
    return;
  }

  if (act === 'assist-go') { startAssist(t.dataset.id, t.dataset.dest); return; }

  if (act === 'assist-start') {
    const target = sme(t.dataset.id);
    if (!target || target.status !== 'Approved') { toast('Only an approved SME can be transacted for.', 'err'); return; }
    const pm = perm(target);
    modal({ title:'Act on behalf of ' + target.tradingName, okLabel:null, body:
      `<p style="font-size:var(--fs-md)">Choose what you are raising for
        <b>${esc(target.tradingName)}</b>. What you submit is recorded as raised by you on their
        behalf, and the audit trail names both parties.</p>
       <div class="kv" style="margin:16px 0">
         <div><div class="k">Service permission</div><div class="v">${esc(target.config.permission)}</div></div>
         <div><div class="k">Enabled currencies</div><div class="v">${target.config.currencies.join(' · ')}</div></div>
       </div>
       <div style="display:grid;gap:8px">
         ${pm.importSide ? `<button class="btn btn-primary" type="button" data-act="assist-go"
            data-id="${target.id}" data-dest="#/sme/outward/new">New outward request</button>` : ''}
         ${pm.exportSide ? `<button class="btn btn-primary" type="button" data-act="assist-go"
            data-id="${target.id}" data-dest="#/sme/inward">Inward remittances and disposal</button>` : ''}
         <button class="btn btn-ghost" type="button" data-act="assist-go"
            data-id="${target.id}" data-dest="#/sme/bills/${pm.exportSide ? 'export' : 'import'}">Bill lodgement</button>
         <button class="btn btn-plain" type="button" data-act="assist-go"
            data-id="${target.id}" data-dest="#/sme/dashboard">Open their whole portal</button>
       </div>
       <div class="note note-info" style="margin-top:16px"><span>
         As an AD2 maker you may transact in any supported currency, not only the SME's enabled
         list. Their permissions, allocation limits and document rules still apply.</span></div>` });
    return;
  }

  if (act === 'assist-exit') {
    const was = sme(S.actingFor)?.tradingName || '';
    setSession({ ...S, actingFor: null });
    OR_DRAFT = null; DI_DRAFT = null; BILL_DRAFT = null;
    location.hash = '#/ad2/directory'; render();
    toast('Left the assisted journey' + (was ? ' for ' + was : '') + '.');
    return;
  }
  if (act === 'offline-app') {
    DRAFT = newDraft(); DRAFT.source = 'Offline';
    toast('Offline application started. The channel is recorded as Offline.');
    location.hash = '#/register';
    return;
  }

  /* --- reconciliation --- */
  if (act === 'rec-confirm') {
    const remId = t.dataset.rem, billId = t.dataset.bill;
    const b = bill(billId);
    modal({ title:'Confirm allocation', okLabel:'Confirm', body:
      `<p style="font-size:var(--fs-md)">Confirm the allocation of <b>${esc(remId)}</b> against bill <b>${esc(billId)}</b>?</p>`,
      onOk: () => {
        const o = DB.outward.find(x => x.id === remId);
        const d = DB.disposals.find(x => x.inwardId === remId);
        if (o) { o.status = 'Completed'; o.pendingWith = '—'; }
        if (d) { d.status = 'Processed';
          const i = DB.inward.find(x => x.id === d.inwardId);
          if (i) { i.status = i.available > 0 ? 'Awaiting Instruction' : 'Processed';
                   if (!i.firc) i.firc = 'FIRC-2026-' + Math.floor(100000 + Math.random() * 899999); } }
        const alloc = (o?.allocations || d?.allocations || []).find(a => a.billId === billId);
        if (b && alloc) { b.adjusted += alloc.amount; recalcBillSettlement(b); }
        logAudit(billId, `Allocation confirmed against ${remId}`);
        save(); closeModal(); render(); toast('Allocation confirmed. Balances updated.', 'ok');
      }});
    return;
  }
  if (act === 'rec-reverse') {
    const remId = t.dataset.rem, billId = t.dataset.bill;
    modal({ title:'Reverse allocation', okLabel:'Reverse', okClass:'btn-danger', body:
      `<div class="f"><label for="rv">Reason for reversal</label><textarea id="rv"></textarea>
       <div class="hint">A reason is required and writes an audit event.</div></div>`,
      onOk: () => {
        const v = $('#rv').value.trim();
        if (!v) { toast('A reason is required.', 'err'); return; }
        const b = bill(billId);
        const o = DB.outward.find(x => x.id === remId);
        const d = DB.disposals.find(x => x.inwardId === remId);
        const alloc = (o?.allocations || d?.allocations || []).find(a => a.billId === billId);
        if (b && alloc) { b.adjusted = Math.max(0, b.adjusted - alloc.amount); recalcBillSettlement(b); }
        logAudit(billId, `Allocation against ${remId} reversed: ${v}`);
        save(); closeModal(); render(); toast('Allocation reversed.', 'ok');
      }});
    return;
  }

  /* --- profile accounts --- */
  if (act === 'penny') {
    const a = acct(t.dataset.id);
    t.disabled = true; t.textContent = 'Verifying…';
    setTimeout(() => {
      a.verified = true; a.verifiedOn = nowISO(); save(); render();
      toast('PennyDrop verified — ₹1.00 credited and name matched (simulated).', 'ok');
    }, 1000);
    return;
  }
  if (act === 'acct-add') {
    modal({ title:'Add bank account', okLabel:'Add account', body:`
      <div class="fields grid g2">
        <div class="f"><label for="ab">Bank name</label><input id="ab" type="text"></div>
        <div class="f"><label for="abr">Branch</label><input id="abr" type="text"></div>
        <div class="f"><label for="an">Account number</label><input id="an" type="text"></div>
        <div class="f"><label for="ai">IFSC</label><input id="ai" type="text"></div>
        <div class="f"><label for="ac">Currency</label><select id="ac"><option>INR</option>
          ${DB.currencies.map(c => `<option>${c.code}</option>`).join('')}</select></div>
        <div class="f"><label for="at">Type</label><select id="at">
          <option>Current</option><option>EEFC</option><option>Savings</option></select></div>
      </div>`,
      onOk: () => {
        const bank = $('#ab').value.trim(), n = $('#an').value.trim();
        if (!bank || !n) { toast('Bank name and account number are required.', 'err'); return; }
        DB.accounts.push({ id: nextId(DB.accounts, 'BA', 3), smeId:ctxSmeId(), holder:sme(ctxSmeId()).legalName,
          bank, branch:$('#abr').value.trim(), accountNumber:n, ifsc:$('#ai').value.trim(),
          currency:$('#ac').value, type:$('#at').value, verified:false, verifiedOn:null, primary:false });
        save(); closeModal(); render(); toast('Account added. Verify it before using it on a transaction.', 'ok');
      }});
    return;
  }

  /* --- tabs, filters, exports --- */
  if (act === 'out-tab')    { outTab = t.dataset.t; render(); return; }
  if (act === 'admin-tab')  { adminTab = t.dataset.t; render(); return; }
  if (act === 'report-reset'){ reportCur = ''; render(); return; }
  if (act === 'export-report') {
    const { cols, rows } = reportRows(reportId);
    csvDownload(reportId + '-report.csv', [cols, ...rows]);
    return;
  }
  if (act === 'export-csv') {
    const what = t.dataset.what;
    if (what === 'outward') {
      const list = scoped() ? DB.outward.filter(o => o.smeId === ctxSmeId()) : DB.outward;
      csvDownload('outward-requests.csv',
        [['Request','SME','Beneficiary','Currency','Amount','Purpose','Status','Requested'],
         ...list.map(o => [o.id, sme(o.smeId)?.tradingName || '', o.beneficiary, o.currency,
           o.amount, o.purposeCode, o.status, o.requestDate])]);
    } else if (what === 'inward') {
      const list = scoped() ? DB.inward.filter(i => i.smeId === ctxSmeId()) : DB.inward;
      csvDownload('inward-remittances.csv',
        [['Reference','SME','Remitter','Currency','Amount','Available','Status','Value date'],
         ...list.map(i => [i.reference, sme(i.smeId)?.tradingName || '', i.remitter, i.currency,
           i.amount, i.available, i.status, i.valueDate])]);
    } else {
      const list = DB.bills.filter(b => !scoped() || b.smeId === ctxSmeId());
      csvDownload('bills.csv',
        [['Bill','SME','Type','Invoice','Counterparty','Currency','Original','Adjusted','Outstanding','Due','Review','Settlement'],
         ...list.map(b => [b.id, sme(b.smeId)?.tradingName || '', b.type, b.invoiceNumber, b.counterparty,
           b.currency, b.amount, b.adjusted, b.outstanding, b.dueDate, b.review, b.settlement])]);
    }
    return;
  }
});

/* ---------- 26. form submit + change + input ------------------------------ */
document.addEventListener('submit', e => {
  const f = e.target.closest('[data-act="do-login"]');
  if (!f) return;
  e.preventDefault();
  const domain = $('#li-domain').value.trim().toUpperCase();
  const login  = $('#li-user').value.trim().toUpperCase();
  const pass   = $('#li-pass').value;
  markField('domain', !!domain);
  if (!domain || !login || !pass) { toast('Enter Domain ID, Login ID and password.', 'err'); return; }

  const a = DB.logins.find(x => x.domainId === domain && x.loginId === login);
  if (!a) { toast('No demo account matches that Domain ID and Login ID.', 'err'); return; }

  const linked = a.smeId ? sme(a.smeId) : null;
  if (linked && linked.status === 'Rejected') { toast('This application was rejected. Access is not available.', 'err'); return; }

  setSession({ domainId:a.domainId, loginId:a.loginId, role:a.role, smeId:a.smeId, name:a.name });
  if (linked && linked.status !== 'Approved') toast('Signed in. Your application is still ' + linked.status.toLowerCase() + '.');
  else toast('Signed in as ' + a.role + '.', 'ok');
  location.hash = a.role.startsWith('AD2') ? '#/ad2/dashboard' : '#/sme/dashboard';
  render();
});

document.addEventListener('change', e => {
  const t = e.target;

  if (t.dataset.act === 'switch-role') {
    const [d, l] = t.value.split('|');
    const a = DB.logins.find(x => x.domainId === d && x.loginId === l);
    setSession({ domainId:a.domainId, loginId:a.loginId, role:a.role, smeId:a.smeId, name:a.name, actingFor:null });
    OR_DRAFT = null; DI_DRAFT = null; REVIEW = null; BILL_DRAFT = null;
    location.hash = a.role.startsWith('AD2') ? '#/ad2/dashboard' : '#/sme/dashboard';
    render(); toast('Switched to ' + a.role + '.');
    return;
  }

  /* onboarding fields */
  if (t.dataset.k) {
    const k = t.dataset.k;
    if (k === 'requestedCurrencies') {
      const set = new Set(DRAFT.requestedCurrencies);
      t.checked ? set.add(t.value) : set.delete(t.value);
      DRAFT.requestedCurrencies = [...set];
    } else if (t.type === 'radio') { DRAFT[k] = t.value; }
    else { DRAFT[k] = t.value; if (k === 'legalName' && !DRAFT.domainId) DRAFT.domainId = slugDomain(t.value); }
    return;
  }

  if (t.dataset.act === 'bene-pick') {
    const v = t.value;
    if (!v) { applyBeneToDraft({ name:'', country:'', accountNumber:'', swift:'', bank:'', bankCountry:'' }, ''); render(); return; }
    if (v === '__oneoff') return;
    const b = bene(v);
    if (b) { applyBeneToDraft(b, b.id); render(); toast('Beneficiary ' + b.name + ' selected.'); }
    return;
  }

  /* outward draft fields */
  if (t.dataset.ork) {
    const k = t.dataset.ork;
    OR_DRAFT[k] = t.value;
    if (k === 'currency' || k === 'purposeCode' || k === 'remittanceType') {
      if (k === 'currency') OR_DRAFT.allocations = [];
      /* the checklist is rebuilt whenever either half of the pair changes */
      if (k === 'purposeCode' || k === 'remittanceType') OR_DRAFT.docs = {};
      /* a type change can invalidate the chosen purpose — drop it rather than
         leaving a combination the master does not allow */
      let dropped = false;
      if (k === 'remittanceType' && OR_DRAFT.purposeCode) {
        const ok = purposesFor('outward', t.value).some(x => x.code === OR_DRAFT.purposeCode);
        if (!ok) { OR_DRAFT.purposeCode = ''; dropped = true; }
      }
      OR_DRAFT.rate = { mode:'none', refRate:0, margin:0, customerRate:0, bookedAt:null, expiresAt:null, dealRef:null };
      render();
      if (dropped) toast('Purpose code cleared — it is not valid for this remittance type.', 'err');
      else if (k === 'purposeCode' && t.value) toast('Document checklist updated for ' + t.value + '.');
      else if (k === 'remittanceType' && t.value) toast('Purpose codes narrowed to this remittance type.');
    }
    return;
  }

  /* bill draft fields */
  if (t.dataset.blk) { BILL_DRAFT[t.dataset.blk] = t.value; return; }

  /* disposal fields */
  if (t.dataset.dik) {
    const k = t.dataset.dik;
    DI_DRAFT[k] = t.value;
    if (k === 'remittanceType' || k === 'purposeCode') {
      DI_DRAFT.docs = {};
      let dropped = false;
      if (k === 'remittanceType' && DI_DRAFT.purposeCode) {
        const ok = purposesFor('inward', t.value).some(x => x.code === DI_DRAFT.purposeCode);
        if (!ok) { DI_DRAFT.purposeCode = ''; dropped = true; }
      }
      render();
      if (dropped) toast('Purpose code cleared — it is not valid for this remittance type.', 'err');
      else if (k === 'remittanceType' && t.value) toast('Purpose codes narrowed to this remittance type.');
    }
    return;
  }

  /* AD2 review */
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

  /* knock-off filters */
  if (t.dataset.act === 'ko-side')         { KO.side = t.value; KO.allocations = []; render(); return; }
  if (t.dataset.act === 'ko-currency')     { KO.currency = t.value; render(); return; }
  if (t.dataset.act === 'ko-counterparty') { KO.counterparty = t.value; render(); return; }

  /* reports */
  if (t.dataset.act === 'report-pick') { reportId = t.value; render(); return; }
  if (t.dataset.act === 'report-cur')  { reportCur = t.value; render(); return; }

  /* settings */
  if (t.dataset.act === 'set-autochecker') { DB.settings.autoChecker = t.checked; save(); toast('AutoChecker ' + (t.checked ? 'enabled' : 'disabled') + '.', 'ok'); return; }
  if (t.dataset.act === 'set-unlinked')    { DB.settings.allowUnlinked = t.checked; save(); toast('Unlinked outward requests ' + (t.checked ? 'permitted' : 'blocked') + '.', 'ok'); return; }

  /* allocations */
  if (t.dataset.act === 'or-alloc') {
    const b = bill(t.dataset.bill), v = Number(t.value) || 0;
    OR_DRAFT.allocations = OR_DRAFT.allocations.filter(a => a.billId !== b.id);
    if (v > 0) {
      if (v > b.outstanding) { toast(`Allocation cannot exceed the bill balance of ${money(b.outstanding, b.currency)}.`, 'err'); t.value = b.outstanding; }
      const amount = Math.min(v, b.outstanding);
      const other = OR_DRAFT.allocations.reduce((s, a) => s + a.amount, 0);
      if (other + amount > Number(OR_DRAFT.amount || 0)) {
        toast('Total allocation cannot exceed the remittance amount.', 'err'); t.value = ''; render(); return;
      }
      OR_DRAFT.allocations.push({ billId:b.id, amount });
    }
    render(); return;
  }
  if (t.dataset.act === 'di-alloc') {
    const b = bill(t.dataset.bill), v = Number(t.value) || 0;
    const i = DB.inward.find(x => x.id === DI_DRAFT.inwardId);
    DI_DRAFT.allocations = DI_DRAFT.allocations.filter(a => a.billId !== b.id);
    if (v > 0) {
      const cap = Math.min(b.outstanding, i.available);
      if (v > cap) { toast(`Cannot apply more than ${money(cap, b.currency)}.`, 'err'); t.value = cap; }
      const amount = Math.min(v, cap);
      const other = DI_DRAFT.allocations.reduce((s, a) => s + a.amount, 0);
      if (other + amount > i.available) {
        toast('Total disposal cannot exceed the available receipt amount.', 'err'); t.value = ''; render(); return;
      }
      DI_DRAFT.allocations.push({ billId:b.id, amount });
    }
    render(); return;
  }
});

/* live search without a full re-render losing focus */
document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.act === 'out-search')  { outTab = outTab; outSearch = t.value; debounceRender(); }
  if (t.dataset.act === 'bill-search') { billSearch = t.value; debounceRender(); }
  if (t.dataset.k)   { const k = t.dataset.k;   if (t.type !== 'checkbox' && t.type !== 'radio') DRAFT[k] = t.value; }
  if (t.dataset.ork) { const k = t.dataset.ork; if (!['currency','purposeCode','remittanceType'].includes(k)) OR_DRAFT[k] = t.value; }
  if (t.dataset.blk) { BILL_DRAFT[t.dataset.blk] = t.value; }
  if (t.dataset.dik) { const k = t.dataset.dik; if (!['remittanceType','purposeCode'].includes(k)) DI_DRAFT[k] = t.value; }
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
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) {} }
    }
  }, 220);
}

/* escape closes the modal */
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

/* ---------- 27. boot ------------------------------------------------------ */
/* Deep-link bootstrap. The screen index links to a screen with
   ?as=DOMAIN:LOGIN (optionally &acting=SME-xxxx) so a reviewer lands on it
   already signed in rather than bouncing to the login page. */
(function bootstrapFromQuery() {
  const q = new URLSearchParams(location.search);
  const as = q.get('as');
  if (!as) return;
  const [d, l] = as.split(':');
  const a = DB.logins.find(x =>
    x.domainId === String(d || '').toUpperCase() && x.loginId === String(l || '').toUpperCase());
  if (!a) return;
  const wants = q.get('acting');
  const canAct = wants && a.role.startsWith('AD2') && sme(wants) && sme(wants).status === 'Approved';
  setSession({ domainId:a.domainId, loginId:a.loginId, role:a.role, smeId:a.smeId, name:a.name,
               actingFor: canAct ? wants : null });
})();

if (!location.hash) location.hash = '#/login';
render();
