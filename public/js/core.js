/* ==========================================================================
   AD2 Trade Remittance — core: utilities, API client, session, shared UI
   The browser never changes platform state itself. Every action is a command
   sent to the API (server mode). When no API is reachable — the screen index
   previews, or the files opened from disk — the same engine runs in the page
   against browser storage instead (local mode).
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
const todayISO = () => new Date().toISOString().slice(0, 10);
const agingBucket = d =>
  d <= 7 ? '0–7 days' : d <= 15 ? '8–15 days' : d <= 30 ? '16–30 days' : 'Over 30 days';
const clone = o => JSON.parse(JSON.stringify(o));
const plural = (n, w, pl) => `${n} ${n === 1 ? w : (pl || w + 's')}`;

/* ---------- 2. API client and state -------------------------------------- */
/* When the app runs inside an iframe — the screen index renders many at once —
   it always uses local mode with an in-memory session, so the previews never
   sign in to the server or fight over one session. */
const EMBEDDED = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();

const API = {
  mode: 'local',            // 'server' | 'local'
  rev: null,                // server state revision last seen
  store: '', persistent: true, passcodeRequired: false,
  tokens: {},               // account key -> session token, for quick role switching
};
const LOCAL_KEY = 'ad2-trade-state';
let DB = null;              // what the signed-in user may see
let S = null;               // { domainId, loginId, role, smeId, name, actingFor, token }

const sessGet = k => { if (EMBEDDED) return null; try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const sessSet = (k, v) => { if (EMBEDDED) return; try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const localGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const localSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

function setSession(v) {
  S = v;
  sessSet('ad2-session', v);
  if (v && v.token) { API.tokens[v.domainId + '/' + v.loginId] = v.token; sessSet('ad2-tokens', API.tokens); }
}

class ApiError extends Error {
  constructor(message, status = 400, details = [], code = '') { super(message); this.status = status; this.details = details; this.code = code; }
}

async function http(path, { method = 'GET', body, token, timeout = 20000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(path, {
      method, signal: ctl.signal, cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status}).`, res.status, data.details || [], data.code || '');
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e.name === 'AbortError' ? 'The server took too long to respond.' : 'Cannot reach the server. Check your connection.', 0);
  } finally { clearTimeout(t); }
}

/* local mode store */
function loadLocal() {
  const s = localGet(LOCAL_KEY);
  if (s && s.version === SEED.version) return s;
  const fresh = Engine.freshState(SEED);
  localSet(LOCAL_KEY, fresh);
  return fresh;
}
let LOCAL = null;           // full local state (local mode only)

function refreshUser(user) {
  if (!S) return;
  if (API.mode === 'server') {
    if (user) setSession({ ...S, role:user.role, smeId:user.smeId, name:user.name });
    return;
  }
  try {
    const a = Engine.resolveActor(LOCAL, S, null);
    if (a.role !== S.role) setSession({ ...S, role:a.role });
  } catch (e) { setSession(null); }
}

function applyServer(r) {
  if (r.state) { DB = r.state; API.rev = r.rev; }
  if ('user' in r) {
    if (S && !r.user) { setSession(null); }
    else refreshUser(r.user);
  }
}

/* Load the current view of the platform. */
async function pull() {
  if (API.mode === 'local') {
    LOCAL = LOCAL || loadLocal();
    DB = LOCAL;
    refreshUser();
    return;
  }
  const r = await http('/api/state', { token: S && S.token });
  applyServer(r);
}

/* Send one command. Resolves with the engine's result; rejects with ApiError. */
async function send(cmd, payload = {}) {
  if (S && S.actingFor) payload = { ...payload, actingFor: S.actingFor };
  if (API.mode === 'local') {
    const next = clone(LOCAL);
    try {
      const result = Engine.execute(next, S ? { domainId:S.domainId, loginId:S.loginId } : null, cmd, payload, { now: nowISO() });
      LOCAL = next; DB = LOCAL; localSet(LOCAL_KEY, LOCAL);
      refreshUser();
      return result;
    } catch (e) {
      if (e instanceof Engine.EngineError) throw new ApiError(e.message, e.status, e.details, e.code);
      throw e;
    }
  }
  const r = await http('/api/command', { method:'POST', body:{ cmd, payload }, token: S && S.token });
  applyServer(r);
  return r.result;
}

/* Run a command from a button: blocks double clicks, shows the outcome,
   re-renders. Returns the result, or null if it was refused. */
let IN_FLIGHT = false;
async function run(cmd, payload, { success, after, keepScroll = true, quiet = false } = {}) {
  if (IN_FLIGHT) return null;
  IN_FLIGHT = true; document.body.classList.add('busy');
  try {
    const res = await send(cmd, payload);
    if (!quiet) toast(success || res.message || 'Done.', 'ok');
    if (after) after(res);
    render({ keepScroll });
    return res;
  } catch (e) {
    showError(e);
    return null;
  } finally {
    IN_FLIGHT = false; document.body.classList.remove('busy');
  }
}

function showError(e) {
  if (e.status === 401) {
    setSession(null); closeModal();
    toast(e.message || 'Sign in again.', 'err');
    location.hash = '#/login'; render();
    return;
  }
  if (e.details && e.details.length > 1) {
    modal({ title:'Cannot continue yet', body:
      `<div class="note note-err"><span>${esc(e.message.split(':')[0])}:</span></div>
       <ul style="margin:14px 0 0 18px;font-size:var(--fs-md);line-height:1.8">
         ${e.details.map(m => `<li>${esc(m)}</li>`).join('')}</ul>` });
    return;
  }
  toast(e.message || 'Something went wrong.', 'err');
}

/* Sign in with a password (server) or any password (local). */
async function signIn(domainId, loginId, password) {
  domainId = String(domainId).trim().toUpperCase(); loginId = String(loginId).trim().toUpperCase();
  if (API.mode === 'local') {
    const a = (LOCAL || loadLocal()).logins.find(x => x.domainId === domainId && x.loginId === loginId);
    if (!a) throw new ApiError('No account matches that Domain ID and Login ID.', 401);
    const linked = a.smeId && LOCAL.smes.find(s => s.id === a.smeId);
    if (linked && linked.status === 'Rejected') throw new ApiError('This application was rejected. Access is not available.', 403);
    setSession({ domainId:a.domainId, loginId:a.loginId, role:a.role, smeId:a.smeId, name:a.name, actingFor:null });
    await pull();
    return S;
  }
  const r = await http('/api/session', { method:'POST', body:{ domainId, loginId, password } });
  setSession({ ...r.user, actingFor:null, token:r.token });
  if (password && isDemoLogin(domainId, loginId)) sessSet('ad2-passcode', password);
  await pull();
  return S;
}
const isDemoLogin = (d, l) => !!(DB && (DB.logins || []).find(x => x.domainId === d && x.loginId === l && x.demo));

/* Switch to another account without retyping where possible: reuse a token
   from earlier in this browser session, else the demo passcode, else ask. */
async function switchTo(domainId, loginId, { dest } = {}) {
  const key = domainId + '/' + loginId;
  resetDrafts();
  if (API.mode === 'server' && API.tokens[key]) {
    const prev = S;
    try {
      S = { domainId, loginId, token: API.tokens[key] };
      const r = await http('/api/state', { token: API.tokens[key] });
      if (!r.user) throw new ApiError('expired', 401);
      setSession({ ...r.user, actingFor:null, token:API.tokens[key] });
      applyServer(r);
      afterSignIn(dest);
      return true;
    } catch (e) { S = prev; delete API.tokens[key]; sessSet('ad2-tokens', API.tokens); }
  }
  const demo = isDemoLogin(domainId, loginId);
  const pass = API.mode === 'local' ? 'demo' : (demo ? (API.passcodeRequired ? sessGet('ad2-passcode') : 'demo') : null);
  if (pass) {
    try { await signIn(domainId, loginId, pass); afterSignIn(dest); return true; }
    catch (e) { if (e.status !== 401) { showError(e); return false; } }
  }
  return new Promise(resolve => {
    modal({ title:'Sign in as ' + domainId + ' / ' + loginId, okLabel:'Sign in', body:
      `<p style="font-size:var(--fs-md);margin:0 0 14px">${demo
        ? 'Enter the demo passcode for this deployment.'
        : 'This business registered through the portal and set its own password.'}</p>
       <div class="f"><label for="sw-pass">${demo ? 'Demo passcode' : 'Password'}</label>
         <input id="sw-pass" type="password" autocomplete="current-password"></div>`,
      onOk: async () => {
        try { await signIn(domainId, loginId, $('#sw-pass').value); closeModal(); afterSignIn(dest); resolve(true); }
        catch (e) { showError(e); }
      } });
    setTimeout(() => $('#sw-pass')?.focus(), 30);
  });
}
function afterSignIn(dest) {
  const home = S.role.startsWith('AD2') ? '#/ad2/dashboard' : '#/sme/dashboard';
  location.hash = dest || home;
  render();
}

/* Poll for changes other users make, so a checker sees the maker's work
   arrive without reloading. Re-render only when it will not disturb input. */
let pendingRender = false;
async function poll() {
  if (API.mode !== 'server' || document.visibilityState !== 'visible' || IN_FLIGHT) return;
  try {
    const q = API.rev != null ? '?since=' + encodeURIComponent(API.rev) : '';
    const r = await http('/api/state' + q, { token: S && S.token, timeout: 8000 });
    if (r.unchanged) { if (pendingRender) safeRender(); return; }
    const had = S && S.token;
    applyServer(r);
    if (had && !S) { toast('Your session ended. Sign in again.', 'err'); location.hash = '#/login'; render(); return; }
    pendingRender = true;
    safeRender();
  } catch (e) {
    if (e.status === 401 && S) { setSession(null); toast('Your session expired. Sign in again.', 'err'); location.hash = '#/login'; render(); }
  }
}
function safeRender() {
  const a = document.activeElement;
  const typing = a && ['INPUT','TEXTAREA','SELECT'].includes(a.tagName);
  if ($('#modal-host').innerHTML || typing) { pendingRender = true; updateChrome(); return; }
  pendingRender = false;
  render({ keepScroll:true });
}

async function resetDemo() {
  const go = async (passcode) => {
    try {
      if (API.mode === 'local') { LOCAL = Engine.freshState(SEED); localSet(LOCAL_KEY, LOCAL); DB = LOCAL; }
      else await http('/api/reset', { method:'POST', body:{ passcode } });
      API.tokens = {}; sessSet('ad2-tokens', null); localSet('ad2-guide', null);
      setSession(null); resetDrafts(); closeModal();
      await pull();
      toast('Demo data reset.', 'ok');
      location.hash = '#/login'; render();
    } catch (e) { showError(e); }
  };
  if (API.mode === 'local' || !API.passcodeRequired) {
    modal({ title:'Reset demo data', okLabel:'Reset', okClass:'btn-danger', body:
      `<p style="font-size:var(--fs-md)">Restore the demo to its starting data? Everything created since —
        applications, payments, receipts — is removed for ${API.mode === 'server' ? '<b>everyone using this deployment</b>' : 'this browser'}.</p>`,
      onOk: () => go(sessGet('ad2-passcode') || 'demo') });
    return;
  }
  modal({ title:'Reset demo data', okLabel:'Reset', okClass:'btn-danger', body:
    `<p style="font-size:var(--fs-md);margin:0 0 14px">Resetting affects everyone using this deployment. Enter the demo passcode to confirm.</p>
     <div class="f"><label for="rs-pass">Demo passcode</label><input id="rs-pass" type="password"></div>`,
    onOk: () => go($('#rs-pass').value) });
}

/* ---------- 3. lookups ---------------------------------------------------- */
const sme       = id => DB.smes.find(s => s.id === id);
const acct      = id => DB.accounts.find(a => a.id === id);
const bill      = id => DB.bills.find(b => b.id === id);
const purpose   = code => DB.purposeCodes.find(p => p.code === code);
const currency  = code => DB.currencies.find(c => c.code === code);
const product   = id => DB.products.find(p => p.id === id);
const smeAccounts = smeId => DB.accounts.filter(a => a.smeId === smeId);
const bene        = id => DB.beneficiaries.find(x => x.id === id);
const smeBenes    = smeId => DB.beneficiaries.filter(x => x.smeId === smeId);
const outwardRec  = id => DB.outward.find(x => x.id === id);
const inwardRec   = id => DB.inward.find(x => x.id === id);
const disposalRec = id => DB.disposals.find(x => x.id === id);

const productsFor = dir => DB.products.filter(p => p.direction === dir);
const purposesFor = productId => Engine.purposesFor(DB, productId);
const checklistFor = (productId, code, inrAmt) => Engine.checklist(DB, productId, code, inrAmt);
const marginFor = (s, code) => Engine.marginFor(DB, s, code);
const customerRate = (code, m) => Engine.customerRate(DB, code, m);
const productLabel = id => { const p = product(id); return p ? `${p.id} — ${p.label}` : (id || '—'); };
const purposeLabel = code => { const p = purpose(code); return p ? `${p.code} — ${p.label}` : (code || '—'); };

/* ---------- 4. session and capabilities ----------------------------------- */
const isAD2 = () => !!S && S.role.startsWith('AD2');
const isSME = () => !!S && S.role.startsWith('SME');
const acting = () => !!(S && S.actingFor);
const asSme  = () => isSME() || acting();
const roleDef = id => DB.roles.find(r => r.id === id);

function can(capId) {
  if (!S) return false;
  const r = roleDef(S.role);
  if (!r) return false;
  if (r.can.includes(capId)) return true;
  if (acting() && r.can.includes('assist.transact')) {
    const smeRole = roleDef('SME User');
    if (smeRole && smeRole.can.includes(capId)) return true;
  }
  return false;
}
const segregated = capId => {
  const r = S && roleDef(S.role);
  return !!(r && (r.segregated || []).includes(capId));
};
const myKey = () => S ? S.domainId + '/' + S.loginId : '';
const ctxSmeId = () => (S && (S.actingFor || S.smeId)) || null;
const scoped   = () => !isAD2() || acting();

function perm(smeRec) { return Engine.perm(smeRec); }

/* ---------- 5. toast, modal, busy ---------------------------------------- */
function toast(msg, kind = '') {
  const host = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 6000 : 4200);
}

let modalOnOk = null;
function modal({ title, body, okLabel = 'Confirm', okClass = 'btn-primary', wide = false, onOk, cancelLabel = 'Cancel', printable = false }) {
  modalOnOk = onOk || null;
  $('#modal-host').innerHTML = `
    <div class="modal-back" data-act="modal-dismiss">
      <div class="modal ${wide ? 'wide' : ''} ${printable ? 'printable' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="modal-head"><h2>${esc(title)}</h2>
          <button type="button" data-act="modal-close" aria-label="Close">&times;</button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-foot">
          ${printable ? `<button class="btn btn-plain" type="button" data-act="print">Print / save as PDF</button><div class="spacer"></div>` : ''}
          <button class="btn btn-plain" type="button" data-act="modal-close">${esc(onOk ? cancelLabel : 'Close')}</button>
          ${onOk ? `<button class="btn ${okClass}" type="button" data-act="modal-ok">${esc(okLabel)}</button>` : ''}
        </div>
      </div>
    </div>`;
}
function closeModal() { $('#modal-host').innerHTML = ''; modalOnOk = null; if (pendingRender) setTimeout(safeRender, 50); }

/* A modal whose OK runs a command. `read` pulls the payload from the form
   and may throw a message string to keep the modal open. */
function commandModal({ title, body, okLabel, okClass, wide, cmd, read, success, after }) {
  modal({ title, body, okLabel, okClass, wide, onOk: async () => {
    let payload;
    try { payload = read ? read() : {}; } catch (msg) { toast(String(msg), 'err'); return; }
    const res = await run(cmd, payload, { success, after: r => { closeModal(); if (after) after(r); } });
    return res;
  } });
}

/* ---------- 6. shared view pieces ---------------------------------------- */
const BADGE = {
  'Draft':'b-grey','Submitted':'b-blue','Under Review':'b-blue','Pending Approval':'b-purple','Clarification Required':'b-amber',
  'Query Raised':'b-amber','Resubmitted':'b-blue','Verified':'b-purple','Authorised':'b-teal','Processing':'b-purple',
  'Completed':'b-green','Processed':'b-green','Approved':'b-green','Accepted':'b-green','Rejected':'b-red','Failed':'b-red',
  'Awaiting Instruction':'b-amber','Instruction Submitted':'b-blue',
  'Unsettled':'b-grey','Partially Settled':'b-amber','Settled':'b-green',
  'Proposed':'b-amber','Confirmed':'b-green','Reversed':'b-grey',
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
const denied = (title, msg) => `<div class="card"><div class="denied"><div class="ic">⊘</div>
  <h3>${esc(title)}</h3><p>${esc(msg)}</p></div></div>`;

function simBanner() {
  const mode = API.mode === 'server'
    ? (API.storeError ? 'Live demo — storage problem: ' + API.storeError
      : API.persistent ? 'Live demo — shared state on the server' : 'Live demo — server storage is not configured, so state may reset')
    : (EMBEDDED ? 'Preview — local demo data' : 'Offline demo — state is kept in this browser only');
  return `
  <div class="sim-bar">
    <b>Demo</b>
    <span>${esc(mode)}. Fictional businesses; FX, SWIFT, PennyDrop and document AI are simulated.</span>
    <button type="button" data-act="guide-open">Demo guide</button>
    <a href="screens.html" style="margin-left:var(--s3);color:#7a5c00;font-size:var(--fs-xs)">All screens</a>
    <button type="button" data-act="reset-demo" style="margin-left:var(--s3)">Reset demo data</button>
  </div>`;
}

function timeline(recordId) {
  const rows = DB.audit.filter(a => a.record === recordId);
  if (!rows.length) return `<p style="color:var(--muted);font-size:var(--fs-sm)">No activity recorded yet.</p>`;
  return `<div class="timeline">${rows.map(r => `
    <div class="tl"><div class="act">${esc(r.action)}</div>
      <div class="meta">${esc(r.actor)} · ${dmyt(r.at)}</div></div>`).join('')}</div>`;
}

/* The approval chain on a transaction: who did each stage and who is next. */
function wfStepper(rec, kind) {
  const wf = rec.wf || {};
  const last = kind === 'disposal' ? ['processed', 'Processed', 'AD2 Operations', 'Credit and FIRC']
                                   : ['executed', 'Executed', 'AD2 Operations', 'Payment released'];
  const stages = [
    ['submitted', 'Submitted', 'SME', 'Raised with documents'],
    ['verified', 'Verified', 'AD2 Maker', 'Documents and screening'],
    ['authorised', 'Authorised', 'AD2 Checker', 'Four-eyes approval'],
    last,
  ];
  const nextIdx = stages.findIndex(s => !wf[s[0]]);
  const stopped = rec.status === 'Rejected';
  return `<div class="wf" role="list">${stages.map((s, i) => {
    const done = !!wf[s[0]];
    const here = !done && i === nextIdx && !stopped && rec.status !== 'Draft';
    const cls = done ? 'done' : here ? (rec.status === 'Clarification Required' ? 'hold' : 'now') : '';
    const meta = done ? `${esc(wf[s[0]].by)}<br>${dmyt(wf[s[0]].at)}`
      : here ? (rec.status === 'Clarification Required' ? 'On hold — query with the SME' : `Pending with ${esc(s[2])}`)
      : `<span style="color:var(--muted)">${esc(s[3])}</span>`;
    return `<div class="wf-step ${cls}" role="listitem">
      <div class="wf-dot">${done ? '✓' : i + 1}</div>
      <div class="wf-txt"><b>${esc(s[1])}</b><small>${esc(s[2])}</small><span>${meta}</span></div></div>`;
  }).join('')}
  ${stopped ? `<div class="wf-step stop"><div class="wf-dot">✕</div><div class="wf-txt"><b>Rejected</b>
    <span>${wf.rejected ? esc(wf.rejected.by) + '<br>' + dmyt(wf.rejected.at) : ''}</span></div></div>` : ''}
  </div>`;
}

/* Document rows with upload. scope names the draft the file goes into. */
function docRows(list, docs, scope, { readonly = false } = {}) {
  if (!list.length) return empty('No documents', 'Nothing is required for this selection.');
  return `<div class="doclist">${list.map(doc => {
    const up = docs[doc.id];
    return `<div class="docrow ${up ? 'uploaded' : ''}">
      <span class="nm">${esc(doc.name)}${doc.required ? '<span class="req">*</span>' : ''}
        <small>${up ? esc(up.filename) + (up.size ? ' · ' + esc(up.size) : '')
                    : esc(doc.note || (doc.required ? 'Required' : 'Optional'))}</small></span>
      <span class="spacer"></span>
      ${readonly ? (up ? `<button class="btn btn-link" type="button" data-act="view-doc" data-n="${esc(up.filename)}">View</button><span class="badge b-green">On file</span>`
                       : `<span class="badge ${doc.required ? 'b-red' : 'b-grey'}">${doc.required ? 'Missing' : 'Not provided'}</span>`)
        : up ? `<button class="btn btn-link" type="button" data-act="doc-del" data-scope="${scope}" data-id="${doc.id}">Remove</button>`
             : `<button class="btn btn-plain btn-sm" type="button" data-act="doc-pick" data-scope="${scope}" data-id="${doc.id}">Upload</button>
                <button class="btn btn-link" type="button" data-act="doc-sample" data-scope="${scope}" data-id="${doc.id}" title="Attach a sample file">Sample</button>`}
    </div>`; }).join('')}</div>`;
}

/* ---------- 7. navigation ------------------------------------------------- */
const SME_NAV = [
  { grp:'Transact' },
  { href:'#/sme/dashboard',    label:'Dashboard',             chip:'DB', tone:'--chip-db' },
  { href:'#/sme/outward',      label:'Outward Remittance',    chip:'OR', tone:'--chip-or', side:'import' },
  { href:'#/sme/inward',       label:'Inward Remittance',     chip:'IR', tone:'--chip-ir', side:'export' },
  { grp:'Bill Lodgement' },
  { href:'#/sme/bills/export', label:'Export Bill Lodgement', chip:'EB', tone:'--chip-im', sub:true, side:'export' },
  { href:'#/sme/bills/import', label:'Import Bill Lodgement', chip:'IB', tone:'--chip-er', sub:true, side:'import' },
  { href:'#/sme/knockoff',     label:'Bill Knock-off',        chip:'KO', tone:'--chip-di' },
  { grp:'Insight' },
  { href:'#/sme/reports',      label:'Reports',               chip:'RP', tone:'--chip-rp' },
  { href:'#/sme/integrations', label:'Integrations',          chip:'UP', tone:'--chip-up' },
  { href:'#/sme/profile',      label:'Profile',               chip:'PR', tone:'--chip-pr' },
];

const AD2_NAV = [
  { grp:'Operations' },
  { href:'#/ad2/dashboard',      label:'Dashboard',          chip:'DB', tone:'--chip-db' },
  { href:'#/ad2/queue',          label:'My work queue',      chip:'WQ', tone:'--chip-di', count:true },
  { href:'#/ad2/applications',   label:'SME Applications',   chip:'SA', tone:'--chip-or' },
  { href:'#/ad2/directory',      label:'SME Directory',      chip:'SD', tone:'--chip-pr' },
  { grp:'Transactions' },
  { href:'#/ad2/outward',        label:'Outward Requests',   chip:'OR', tone:'--chip-or' },
  { href:'#/ad2/inward',         label:'Inward & Disposal',  chip:'IR', tone:'--chip-ir' },
  { href:'#/ad2/bills',          label:'Bills',              chip:'BL', tone:'--chip-bl' },
  { href:'#/ad2/reconciliation', label:'Reconciliation',     chip:'RC', tone:'--chip-rc' },
  { grp:'Administration' },
  { href:'#/ad2/reports',        label:'Reports',            chip:'RP', tone:'--chip-rp' },
  { href:'#/ad2/admin',          label:'Administration',     chip:'AD', tone:'--chip-ad' },
];

function navHTML() {
  const ad2Home = isAD2() && !acting();
  const me = !ad2Home ? sme(ctxSmeId()) : null;
  let items = ad2Home ? AD2_NAV : SME_NAV;
  if (me && me.status !== 'Approved') items = [{ grp:'Application' }, SME_NAV[1]];
  else if (me) items = items.filter(it => !it.side || (it.side === 'import' ? perm(me).importSide : perm(me).exportSide));
  const hash = location.hash || '';
  const qn = ad2Home ? myQueue().length : 0;
  const rows = items.map(it => {
    if (it.grp) return `<div class="grp">${esc(it.grp)}</div>`;
    const on = hash.startsWith(it.href) ? 'on' : '';
    return `<a href="${it.href}" class="${on} ${it.sub ? 'sub-item' : ''}">
      <span class="ic" style="background:var(${it.tone})">${esc(it.chip)}</span>${esc(it.label)}
      ${it.count && qn ? `<span class="navcount">${qn}</span>` : ''}</a>`;
  }).join('');
  const title = ad2Home ? 'AD2 Trade Operations' : (acting() ? 'Assisted — SME Portal' : 'SME Trade Portal');
  const sub = ad2Home ? 'Trade remittance operations' : (me?.tradingName || me?.legalName || 'Trade services');
  return `<nav class="nav" aria-label="Main">
    <div class="brand"><span class="mark">◈</span>
      <span><span class="name">${esc(title)}</span><span class="mod">${esc(sub)}</span></span></div>
    ${rows}
    <div class="navfoot">AD2 Trade Remittance · ${API.mode === 'server' ? 'live demo' : 'local demo'}</div>
  </nav>`;
}

/* Notifications addressed to this user since they last looked. */
const seenKey = () => 'ad2-seen-' + myKey();
function myNotifications() {
  if (!S || !DB.notifications) return [];
  return DB.notifications.filter(n => isAD2() ? n.toRole === S.role : n.toSmeId === S.smeId);
}
function unreadCount() {
  const seen = localGet(seenKey()) || '';
  return myNotifications().filter(n => n.at > seen).length;
}

function topHTML(crumb) {
  const opts = DB.logins.map(a =>
    `<option value="${esc(a.domainId)}|${esc(a.loginId)}" ${S.domainId === a.domainId && S.loginId === a.loginId ? 'selected' : ''}>
       ${esc(a.role)}${a.tradingName ? ' — ' + esc(a.tradingName) : (a.name ? ' — ' + esc(a.name) : '')}</option>`).join('');
  const initials = (S.name || S.role).split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const n = unreadCount();
  return `<div class="top">
    <div class="crumb">${crumb}</div>
    <div class="spacer"></div>
    <div class="rolepick"><label for="roleswitch">Demo role</label>
      <select id="roleswitch" data-act="switch-role">${opts}</select></div>
    <button class="bell" type="button" data-act="notifications" aria-label="Notifications${n ? ', ' + n + ' new' : ''}">🔔${n ? `<span>${n}</span>` : ''}</button>
    <div class="who"><span class="av">${esc(initials)}</span>
      <span class="meta"><b>${esc(S.name || '')}</b><span>${esc(S.role)}</span></span></div>
    <button class="btn btn-plain btn-sm" type="button" data-act="logout">Sign out</button>
  </div>`;
}
/* Refresh the counters in the chrome without re-rendering the page. */
function updateChrome() {
  if (!S || !DB) return;
  const b = $('.bell');
  if (b) { const n = unreadCount(); b.innerHTML = '🔔' + (n ? `<span>${n}</span>` : ''); }
}

function shell(crumbHtml, body) {
  return `
  <div class="appbar">
    <button class="ibtn navtoggle" type="button" data-act="nav-toggle" aria-label="Menu">☰</button>
    <span class="wordmark">Remit<i>4</i>Me</span>
    <div class="spacer"></div>
    <div class="icons">
      <button class="ibtn" type="button" data-act="go" data-href="${isAD2() && !acting() ? '#/ad2/dashboard' : '#/sme/dashboard'}" aria-label="Home">⌂</button>
      <button class="ibtn" type="button" data-act="guide-open" aria-label="Demo guide">?</button>
      <button class="ibtn" type="button" data-act="logout" aria-label="Sign out">⏻</button>
    </div>
  </div>
  ${simBanner()}
  ${acting() ? `<div class="sim-bar" style="background:#e0f4f4;border-color:#9ad4d5;color:#0b5f61">
      <b>Assisted journey</b>
      <span style="flex:1">You are acting for <b>${esc(sme(S.actingFor)?.tradingName || '')}</b>.
        Anything you submit is recorded as raised by ${esc(S.name || S.role)} on their behalf, and needs a different maker to verify it.</span>
      <a href="#/sme/outward" style="color:#0b5f61;font-size:var(--fs-xs);margin-left:var(--s3)">Outward</a>
      <a href="#/sme/inward" style="color:#0b5f61;font-size:var(--fs-xs);margin-left:var(--s3)">Inward</a>
      <button type="button" data-act="assist-exit" style="border-color:#6fbfc0;color:#0b5f61;margin-left:var(--s3)">Exit assisted journey</button>
    </div>` : ''}
  <div class="app">
    ${navHTML()}
    <div class="main">
      ${topHTML(crumbHtml)}
      <div class="page">${body}</div>
    </div>
  </div>`;
}

const crumb = (...parts) =>
  parts.map((p, i) => i === parts.length - 1 ? `<b>${esc(p)}</b>` : esc(p)).join(' / ');

/* A page for public screens (sign-in, registration, status). */
const publicTop = back => `<div class="appbar"><span class="wordmark">Remit<i>4</i>Me</span><div class="spacer"></div>
  ${back ? `<button class="btn btn-plain btn-sm" type="button" data-act="go" data-href="#/login">Back to sign in</button>` : ''}</div>`;

/* ---------- 8. drafts shared across views --------------------------------- */
let DRAFT = null, OR_DRAFT = null, DI_DRAFT = null, BILL_DRAFT = null, REVIEW = null, RESP = null;
function resetDrafts() { DRAFT = null; OR_DRAFT = null; DI_DRAFT = null; BILL_DRAFT = null; REVIEW = null; RESP = null; }

function markField(key, ok) {
  const el = document.querySelector(`[data-fld="${key}"]`);
  if (el) el.classList.toggle('invalid', !ok);
}
function csvDownload(filename, rows) {
  const body = rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([body], { type:'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Export downloaded: ' + filename, 'ok');
}
