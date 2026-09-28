/* ==========================================================================
   Treasury Management Portal — core
   The treasury portal is its own front end on the same platform as the trade
   portal: one engine (engine.js, treasury.js, tmp-engine.js), one API, one
   sign-in. A booking made in the trade portal is a position here the moment
   it is made; what treasury publishes, holds or releases reaches the trade
   portal the same way.

   Every change is a command to the API (server mode). With no API — the
   files opened from disk — the same engine runs in the page against browser
   storage shared with the trade portal (local mode).

   Content Security Policy: no inline handlers. Every control is a data-*
   attribute handled by the delegated listeners at the end of this file.
   ========================================================================== */
'use strict';

/* ---------- 1. utilities ---------------------------------------------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const NOW = () => new Date().toISOString();
const V = Engine.tmp, TR = Engine.treasury;
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const plural = (n, w, pl) => `${n} ${n === 1 ? w : (pl || w.replace(/([^aeiou])y$/, '$1ie') + 's')}`;
const sum = (list, f) => round2(list.reduce((t, x) => t + (typeof f === 'function' ? f(x) : x[f]) , 0));

/* Grouping is a domain rule: INR in lakh and crore (1,00,000), foreign
   currency in international thousands (100,000). Currencies are never added
   together. */
const dp = cur => cur === 'JPY' ? 0 : 2;
const num = (n, cur) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: dp(cur), maximumFractionDigits: dp(cur) });
const fcy = (n, cur) => `${cur} ${num(n, cur)}`;
const inrN = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inr = n => '₹ ' + inrN(n);
const inrL = n => {                                   /* compact, for figures in a strip */
  const a = Math.abs(n || 0), sg = n < 0 ? '−' : '';
  if (a >= 1e7) return `${sg}₹ ${(a / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  if (a >= 1e5) return `${sg}₹ ${(a / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
  return sg + '₹ ' + a.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};
const rate = n => n == null || n === '' || !isFinite(n) ? '—' : Number(n).toFixed(4);
const signed = (n, f) => (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n));
const istClock = iso => iso ? V.istClock(iso) : '—';
/* a time on its own means today; anything older carries its date */
const ist = iso => iso ? (V.istDate(iso) === todayIST() ? '' : istDay(iso) + ' ') + V.istClock(iso) + ' IST' : '—';
const istDay = iso => iso ? new Date(new Date(iso).getTime() + 330 * 60000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '—';
const istDT = iso => iso ? `${istDay(iso)} ${istClock(iso)}` : '—';
const dmy = d => d ? new Date(d + (String(d).length === 10 ? 'T00:00:00Z' : '')).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
const todayIST = () => V.istDate(NOW());
const minsTo = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);
const dur = m => { m = Math.max(0, Math.round(m)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h`; };
const ago = iso => iso ? dur(minsTo(iso, NOW())) + ' ago' : '—';

/* ---------- 2. API client, session and state --------------------------------- */
const API = { mode: 'local', rev: null, epoch: null, view: null, store: '', persistent: true, passcodeRequired: false, tokens: {} };
const LOCAL_KEY = 'ad2-trade-state';            /* shared with the trade portal in local mode */
const MASTER_ROLE = 'Master Tester';
let DB = null, S = null, MASTER = null, LOCAL = null;

/* Inside an iframe (the screen index previews many screens at once) the
   portal runs locally with an in-memory session, never touching the
   signed-in session of the page around it. */
const EMBEDDED = (() => { try { return window.top !== window.self; } catch (e) { return true; } })();
const sessGet = k => { if (EMBEDDED) return null; try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const sessSet = (k, v) => { if (EMBEDDED) return; try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const localGet = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
const localSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

function setSession(v) {
  S = v;
  sessSet('ad2-session', v);
  if (v && v.role === MASTER_ROLE) { MASTER = { domainId: v.domainId, loginId: v.loginId, name: v.name }; sessSet('ad2-master', MASTER); }
  if (v && v.token) { API.tokens[v.domainId + '/' + v.loginId] = v.token; sessSet('ad2-tokens', API.tokens); }
}
class ApiError extends Error {
  constructor(message, status = 400, details = [], code = '') { super(message); this.status = status; this.details = details; this.code = code; }
}
async function http(path, { method = 'GET', body, token, timeout = 20000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(path, { method, signal: ctl.signal, cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status}).`, res.status, data.details || [], data.code || '');
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e.name === 'AbortError' ? 'The server took too long to respond.' : 'Cannot reach the server. Check your connection.', 0);
  } finally { clearTimeout(t); }
}
const API_ROOT = '../api/';
function loadLocal() {
  const s = localGet(LOCAL_KEY);
  if (s && s.version === SEED.version) return s;
  const fresh = Engine.freshState(SEED);
  localSet(LOCAL_KEY, fresh);
  return fresh;
}
const isNewer = r => {
  if (API.rev == null || !API.epoch) return true;
  const e = r.epoch || '';
  if (e !== API.epoch) return e > API.epoch;
  return Number(r.rev) >= Number(API.rev);
};
const myKey = () => S ? S.domainId + '/' + S.loginId : 'public';
function applyServer(r) {
  if (r.state && isNewer(r)) { DB = r.state; API.rev = r.rev; API.epoch = r.epoch || API.epoch; API.view = r.user ? r.user.domainId + '/' + r.user.loginId : 'public'; }
  if ('user' in r) {
    if (S && !r.user) setSession(null);
    else if (S && r.user) setSession({ ...S, role: r.user.role, smeId: r.user.smeId, name: r.user.name });
  }
}
const floorQuery = key => API.rev != null ? `?${key}=${encodeURIComponent(API.rev)}${API.epoch ? '&epoch=' + encodeURIComponent(API.epoch) : ''}` : '';
async function pull() {
  if (API.mode === 'local') {
    LOCAL = LOCAL || loadLocal();
    DB = Engine.scopeState(LOCAL, S ? { domainId: S.domainId, loginId: S.loginId } : null);
    return;
  }
  const r = await http(API_ROOT + 'state' + floorQuery('min'), { token: S && S.token });
  applyServer(r);
}
async function send(cmd, payload = {}) {
  if (API.mode === 'local') {
    const next = clone(LOCAL);
    try {
      const result = Engine.execute(next, S ? { domainId: S.domainId, loginId: S.loginId } : null, cmd, payload, { now: NOW() });
      LOCAL = next; localSet(LOCAL_KEY, LOCAL);
      DB = Engine.scopeState(LOCAL, S ? { domainId: S.domainId, loginId: S.loginId } : null);
      return result;
    } catch (e) {
      if (e instanceof Engine.EngineError) throw new ApiError(e.message, e.status, e.details, e.code);
      throw e;
    }
  }
  const r = await http(API_ROOT + 'command', { method: 'POST', body: { cmd, payload }, token: S && S.token });
  applyServer(r);
  return r.result;
}
/* Run a command from a control: one at a time, outcome as a toast, re-render. */
let IN_FLIGHT = false;
async function run(cmd, payload, { success, after, quiet } = {}) {
  if (IN_FLIGHT) return null;
  IN_FLIGHT = true; document.body.classList.add('busy');
  try {
    const res = await send(cmd, payload) || {};
    if (!quiet) toast(success || res.message || 'Done.', 'ok');
    if (after) after(res);
    render({ keepScroll: true });
    return res;
  } catch (e) { showError(e); return null; }
  finally { IN_FLIGHT = false; document.body.classList.remove('busy'); }
}
function showError(e) {
  if (e.status === 401) { setSession(null); closeAll(); toast(e.message || 'Sign in again.', 'bad'); go('SYS-01'); return; }
  toast(e.message || 'Something went wrong.', 'bad');
}
async function signIn(domainId, loginId, password) {
  domainId = String(domainId || '').trim().toUpperCase(); loginId = String(loginId || '').trim().toUpperCase();
  if (API.mode === 'local') {
    const l = (LOCAL || (LOCAL = loadLocal())).logins.find(x => x.domainId === domainId && x.loginId === loginId);
    if (!l || l.active === false) throw new ApiError('No active account matches that Domain ID and Login ID.', 401);
    setSession({ domainId: l.domainId, loginId: l.loginId, role: l.role, smeId: l.smeId, name: l.name, actingFor: null });
    await pull();
    return S;
  }
  const r = await http(API_ROOT + 'session', { method: 'POST', body: { domainId, loginId, password } });
  setSession({ ...r.user, actingFor: null, token: r.token });
  if (password && password !== 'demo') sessSet('ad2-passcode', password);
  API.view = null;
  await pull();
  return S;
}
/* The master test user opens any persona without a password: the server
   issues that persona's session against the master's own. */
async function openAs(domainId, loginId, dest) {
  if (API.mode === 'local') { await signIn(domainId, loginId, 'demo'); afterSignIn(dest); return; }
  const key = domainId + '/' + loginId;
  const mtoken = MASTER && API.tokens[MASTER.domainId + '/' + MASTER.loginId];
  try {
    if (API.tokens[key]) {
      const r = await http(API_ROOT + 'state', { token: API.tokens[key] });
      if (r.user) { setSession({ ...r.user, actingFor: null, token: API.tokens[key] }); API.rev = null; API.epoch = null; applyServer(r); afterSignIn(dest); return; }
    }
    if (mtoken) {
      const r = await http(API_ROOT + 'session', { method: 'POST', body: { as: { domainId, loginId } }, token: mtoken });
      setSession({ ...r.user, actingFor: null, token: r.token }); API.rev = null; API.epoch = null;
      await pull(); afterSignIn(dest); return;
    }
    const pass = API.passcodeRequired ? sessGet('ad2-passcode') : 'demo';
    await signIn(domainId, loginId, pass || 'demo'); afterSignIn(dest);
  } catch (e) { showError(e); }
}
function afterSignIn(dest) { go(dest || homeOf()); }
async function backToMaster() {
  if (!MASTER) return;
  await openAs(MASTER.domainId, MASTER.loginId);
  location.href = '../app.html#/test';
}
function signOut() {
  if (S) delete API.tokens[myKey()];
  sessSet('ad2-tokens', API.tokens);
  setSession(null); MASTER = null; sessSet('ad2-master', null);
  pull().then(() => go('SYS-01')).catch(() => go('SYS-01'));
}
async function resetDemo() {
  dlg({ title: 'Reset demo data', ok: 'Reset', okClass: 'danger',
    body: `<p>Restore the platform — trade and treasury — to its starting data? Everything created since is removed for ${API.mode === 'server' ? '<b>everyone using this deployment</b>' : 'this browser'}.</p>
      ${API.mode === 'server' && API.passcodeRequired ? `<div class=f><label for=rs-pass>Demo passcode</label><input id=rs-pass type=password data-required><div class=err hidden>Enter the passcode.</div></div>` : ''}`,
    onOk: async () => {
      try {
        if (API.mode === 'local') { LOCAL = Engine.freshState(SEED); localSet(LOCAL_KEY, LOCAL); }
        else { const r = await http(API_ROOT + 'reset', { method: 'POST', body: { passcode: ($('#rs-pass') || {}).value || sessGet('ad2-passcode') || 'demo' } }); API.rev = null; API.epoch = null; applyServer(r); }
        API.tokens = {}; sessSet('ad2-tokens', null); setSession(null); MASTER = null; sessSet('ad2-master', null);
        await pull(); toast('Demo data reset.', 'ok'); go('SYS-01');
      } catch (e) { showError(e); return false; }
    } });
}

/* Poll for other people's work, so a checker sees a maker's entry arrive. */
let pendingRender = false, lastTouch = 0;
async function poll() {
  if (document.visibilityState !== 'visible' || IN_FLIGHT) return;
  if (API.mode === 'local') { dueHousekeeping(); return; }
  try {
    const q = floorQuery(API.view === myKey() ? 'since' : 'min');
    const r = await http(API_ROOT + 'state' + q, { token: S && S.token, timeout: 8000 });
    if (r.unchanged) { if (pendingRender) safeRender(); dueHousekeeping(); return; }
    const had = S && S.token;
    applyServer(r);
    if (had && !S) { toast('Your session ended. Sign in again.', 'bad'); go('SYS-01'); return; }
    pendingRender = true; safeRender(); dueHousekeeping();
  } catch (e) {
    if (e.status === 401 && S) { setSession(null); toast('Your session expired. Sign in again.', 'bad'); go('SYS-01'); }
  }
}
/* Cut-off, quote expiry and reminders run before every command. When
   something on screen falls due and nobody has acted, nudge the book. */
function dueHousekeeping() {
  if (!S || !DB || IN_FLIGHT || Date.now() - lastTouch < 60000) return;
  const now = NOW();
  const due = (DB.positions || []).some(p => p.status === 'Open' && p.cutoffAt && p.cutoffAt <= now && !V.tradeChannel(p))
    || (DB.quotes || []).some(q => q.status === 'Live' && q.validUntil <= now)
    || (DB.positions || []).some(p => p.status === 'Open' && p.expiresAt && p.expiresAt <= now);
  if (!due) return;
  lastTouch = Date.now();
  send('tmp.touch', {}).then(() => safeRender()).catch(() => {});
}
function safeRender() {
  const a = document.activeElement;
  const typing = a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && !a.closest('.search');
  if ($('dialog[open]') || typing || $('.drawer')) { pendingRender = true; return; }
  pendingRender = false; render({ keepScroll: true });
}

/* ---------- 3. who is signed in --------------------------------------------- */
const roleDef = () => S && DB ? (DB.roles || []).find(r => r.id === S.role) || {} : {};
const me = () => S && DB ? (DB.logins || []).find(l => l.domainId === S.domainId && l.loginId === S.loginId) || {} : {};
const can = cap => !!S && !!DB && Engine.can(DB, { role: S.role }, cap);
const isMaster = () => !!S && S.role === MASTER_ROLE;
const readOnly = () => isMaster() || !!roleDef().readOnly;
/* A user works in one or more workspaces; the master sees all of them, read-only. */
function workspaces() {
  if (!S || !DB) return [];
  if (isMaster()) return ['treasury', 'branch', 'finance', 'bulk', 'admin'];
  if (can('tmp.admin')) return ['admin'];
  const r = roleDef();
  if (r.portal !== 'TMP') return [];
  if (r.workspace === 'treasury') return ['treasury'];
  if (can('tmp.agent')) return ['agent'];
  if (can('tmp.branch')) return ['branch'];
  if (can('tmp.finance')) return ['finance'];
  if (can('tmp.bulk.request')) return ['bulk'];
  return [];
}
const myScopeName = () => { const l = me(); return l.branchScope ? V.nodeName(DB, l.branchScope) : 'All branches'; };
const myBranch = () => me().branchScope || null;

/* ---------- 4. screens, sections and routing --------------------------------- */
const SCREENS = {};
const screen = def => { SCREENS[def.id] = def; };
const WS_LABEL = { branch: 'Branch', agent: 'Agent', treasury: 'Treasury', finance: 'Finance', bulk: 'Regional bulk', admin: 'Administration' };
/* workspace → section → ordered screens (drives the sidebar, tabs and pager) */
const SECTIONS = {
  branch: [['Overview', ['B-01']], ['Take a rate', ['B-02', 'B-03']], ['Positions', ['B-04', 'B-05']], ['Cut-off', ['B-06', 'B-09']],
           ['Balances', ['B-07']], ['Reports', ['B-08']], ['Offline', ['B-10']]],
  agent: [['Take a rate', ['B-02a', 'B-03']], ['My deals', ['B-04']]],
  treasury: [['Overview', ['T-01', 'T-01V']], ['Rates', ['T-24', 'T-27']], ['Positions', ['T-02', 'T-03', 'T-20']], ['Trade desk', ['T-28']],
             ['Covers', ['T-04', 'T-05', 'T-12', 'T-13']], ['Amendments', ['T-26']], ['Exceptions', ['T-06']],
             ['Liquidity', ['T-07', 'T-19', 'T-08', 'T-09', 'T-10']], ['Credit', ['T-11', 'T-25']], ['Settlements', ['T-14', 'T-15', 'T-16']],
             ['Bulk', ['T-17']], ['Approvals', ['T-21']], ['Reports', ['T-22', 'T-23']], ['Data & audit', ['T-18']]],
  finance: [['Reconciliation', ['OPS-02']], ['Cards', ['T-14', 'T-15', 'T-10']], ['Reports', ['OPS-03']]],
  bulk: [['Bulk bookings', ['OPS-01']], ['Reports', ['OPS-03']]],
  admin: [['Users', ['ADM-01', 'ADM-02']], ['Configuration', ['ADM-03', 'ADM-05', 'ADM-04']], ['Oversight', ['T-21', 'T-18']]],
};
const NAV = {
  branch: [['Overview', 'B-01'], ['Take FX rate', 'B-02'], ['My positions', 'B-04'], ['Knock-off', 'B-05'], ['Cut-off queue', 'B-06'],
           ['Reminders', 'B-09'], ['Balances', 'B-07'], ['Reports', 'B-08'], ['Offline capture', 'B-10']],
  agent: [['Take FX rate', 'B-02a'], ['My deals', 'B-04']],
  treasury: [['Overview', 'T-01'], ['Rate desk', 'T-24'], ['Positions', 'T-02'], ['Trade desk', 'T-28'], ['Cover deals', 'T-04'], ['Allocations', 'T-05'],
             ['Amendments', 'T-26'], ['Exceptions', 'T-06'], ['Liquidity', 'T-07'], ['Cards & funding', 'T-10'], ['Credit lines', 'T-11'],
             ['Settlements', 'T-14'], ['Bulk bookings', 'T-17'], ['Reports', 'T-22'], ['Approvals', 'T-21'], ['Data & audit', 'T-18']],
  finance: [['Reconciliation', 'OPS-02'], ['Card sales', 'T-14'], ['Pending settlement', 'T-15'], ['Card balances', 'T-10'], ['Reports', 'OPS-03']],
  bulk: [['Bulk bookings', 'OPS-01'], ['Reports', 'OPS-03']],
  admin: [['Users', 'ADM-01'], ['Roles & permissions', 'ADM-02'], ['Masters', 'ADM-03'], ['Org hierarchy', 'ADM-05'], ['Integrations', 'ADM-04'],
          ['Approvals', 'T-21'], ['Audit', 'T-18']],
};
const HOME = { branch: 'B-01', agent: 'B-02a', treasury: 'T-01', finance: 'OPS-02', bulk: 'OPS-01', admin: 'ADM-01' };
function homeOf() {
  const w = workspaces();
  if (!S) return 'SYS-01';
  if (!w.length) return 'SYS-02';
  if (roleDef().readOnly && w[0] === 'treasury') return 'T-01V';
  return HOME[w[0]];
}
/* Where a screen sits for this user: the first of its workspaces the user holds. */
function locate(sid) {
  const ws = workspaces();
  const order = [...new Set([...(ROUTE_WS ? [ROUTE_WS] : []), ...ws])];
  for (const w of order) {
    if (!ws.includes(w)) continue;
    for (const [name, ids] of SECTIONS[w] || []) if (ids.includes(sid)) return { ws: w, sec: name, ids };
  }
  return null;
}
let ROUTE_WS = null;                /* the workspace the user last worked in (master switches) */
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [sid, qs] = h.split('?');
  const q = {};
  new URLSearchParams(qs || '').forEach((v, k) => { q[k] = v; });
  return { sid: sid || '', q };
}
const qstr = q => { const s = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null && v !== '')).toString(); return s ? '?' + s : ''; };
function go(sid, q) { const h = '#/' + sid + qstr(q || {}); if (location.hash === h) render(); else location.hash = h; }
function setQ(patch) {
  const r = route();
  const q = { ...r.q, ...patch };
  Object.keys(q).forEach(k => { if (q[k] == null || q[k] === '') delete q[k]; });
  history.replaceState(null, '', '#/' + r.sid + qstr(q));
  render({ keepScroll: true });
}

/* ---------- 5. building blocks ------------------------------------------------ */
const pill = (t, k) => `<span class="pill${k ? ' ' + k : ''}">${esc(t)}</span>`;
const KIND = {
  Complete: 'ok', Concluded: 'ok', Covered: 'ok', Published: 'ok', Approved: 'ok', Healthy: 'ok', Fresh: 'ok', Booked: 'ok', Active: 'ok', Adjusted: 'ok',
  Settled: 'ok', Linked: 'ok', Closed: 'off', Normal: 'ok', Yes: 'ok',
  Partial: 'warn', 'Awaiting txn': 'bad', 'Awaiting settlement': 'warn', Held: 'warn', Pending: 'warn', 'With checker': 'warn', 'Action needed': 'bad', Ageing: 'warn',
  Delayed: 'warn', 'Not published': 'bad', Open: '', Escalated: 'bad', Acknowledged: 'warn', 'Needs detail': 'warn', 'With Treasury': 'warn',
  'Awaiting checker': 'warn', Investigate: 'bad', Stale: 'bad', Failed: 'bad', 'Cancellation requested': 'warn', 'Open residual': 'bad',
  Cancelled: 'off', Expired: 'off', Rejected: 'bad', Superseded: 'off', Withdrawn: 'off', Released: 'off', 'Cancelled today': 'off', 'Not selected': 'off',
  'Proposed source': 'warn', 'Txn tagged': 'warn', 'Cover allocated': 'warn', Created: '', 'Not submitted': '', Excluded: 'off', Overdue: 'bad', 'Due today': 'warn',
  Investigating: 'warn', Resolved: 'ok', Suspended: 'bad', Disabled: 'off', Draft: '', Applied: 'ok', 'Pending funding': 'warn', 'Awaiting rule application': 'warn',
};
const st = t => pill(t, KIND[t] != null ? KIND[t] : '');
const posStatus = p => TR.positionStatus(p, NOW());
const tracks = p => `<span class=tracks>${st(V.linkTrack(DB, p, NOW()))} ${p.coverState !== undefined || p.covered !== undefined ? st(V.coverTrack(p)) : ''}</span>`;
const prodName = code => V.productName(DB, code);
const node = id => V.nodeName(DB, id);
const posLabel = p => `${prodName(p.product)} / ${p.currency}`;
const posRef = p => `<a href="#" data-pos="${esc(p.id)}">${esc(p.id)}</a>`;
const side = s => s === 'SELL' ? 'Sell' : 'Buy';

function fresh(state, asOf) {
  const cls = state === 'Fresh' ? '' : state === 'Ageing' ? ' aging' : ' stale';
  return `<span class="fresh${cls}" title="${esc(asOf ? 'As of ' + istDT(asOf) : 'No data')}">${esc(state)}${asOf ? ' · ' + esc(ago(asOf)) : ''}</span>`;
}
const freshOf = (asOf, cycle = 30, stale = 360) => V.freshness(asOf, NOW(), cycle, stale);

/* countdown to an instant; ticks every second (see the ticker below) */
function clock(until, label) {
  if (!until) return '<span class=dim>—</span>';
  const m = minsTo(NOW(), until);
  const cls = m <= 0 ? ' now' : m <= 90 ? ' soon' : '';
  return `<span class="clock${cls}" data-until="${esc(until)}"><b>${clockText(until)}</b><span>${esc(label || 'to ' + istClock(until))}</span></span>`;
}
function clockText(until) {
  const s = Math.round((new Date(until) - Date.now()) / 1000);
  if (s <= 0) return '00:00';
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}m`;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
setInterval(() => {
  $$('[data-until]').forEach(el => {
    const b = el.querySelector('b'); if (b) b.textContent = clockText(el.dataset.until);
    const m = (new Date(el.dataset.until) - Date.now()) / 60000;
    el.classList.toggle('now', m <= 0); el.classList.toggle('soon', m > 0 && m <= 90);
  });
  const c = $('#asof-clock'); if (c) c.textContent = istDT(NOW()) + ' IST';
}, 1000);

const strip = items => `<div class=strip>${items.map(i => `<div class="stat${i.plain ? ' plain' : ''}${i.cls ? ' ' + i.cls : ''}">${i.go ? `<a href="#/${i.go}">` : ''}<b class="${i.kind || ''}">${i.v}</b><span>${i.l}</span>${i.go ? '</a>' : ''}</div>`).join('')}</div>`;
const banner = (kind, title, text) => `<div class="banner ${kind || ''}"><span>${kind === 'bad' || kind === 'warn' ? '&#9888;' : '&#9432;'}</span><div><b>${title}</b>${text || ''}</div></div>`;
const actionsPanel = (title, items) => items.length ? `<div class=actions><h2>${esc(title)} &middot; ${items.length} ${items.length === 1 ? 'priority' : 'priorities'}</h2><ul>${items.map(i =>
  `<li><span class=k>${i.k}</span><span class=d>${i.d}</span>${i.a || ''}</li>`).join('')}</ul></div>` : '';
const panel = (title, inner, extra) => `<div class=panel><h2>${title}<span class=sp></span>${extra || ''}</h2>${inner}</div>`;
const kv = pairs => `<dl class=kv>${pairs.filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
/* a button that opens a named action; hidden (not disabled) for read-only users */
const btn = (label, act, data, cls) => readOnly() && !/\bsec\b|\bnav\b/.test(cls || '') ? '' :
  `<button type=button class="btn${cls ? ' ' + cls : ''}" data-act="${act}"${dataAttrs(data)}>${label}</button>`;
const lnk = (label, act, data, cls) => readOnly() && !(cls || '').includes('ro-ok') ? '' : `<button type=button class="lnk${cls ? ' ' + cls : ''}" data-act="${act}"${dataAttrs(data)}>${label}</button>`;
const golink = (label, sid, q, cls) => `<a class="${cls || ''}" href="#/${sid}${qstr(q || {})}">${label}</a>`;
const gobtn = (label, sid, q, cls) => `<a class="btn${cls ? ' ' + cls : ''}" style="text-decoration:none;display:inline-flex;align-items:center" href="#/${sid}${qstr(q || {})}">${label}</a>`;
function dataAttrs(d) { return d ? Object.entries(d).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('') : ''; }
const opt = (v, label, sel) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(label == null ? v : label)}</option>`;
const options = (list, sel) => list.map(x => Array.isArray(x) ? opt(x[0], x[1], sel) : opt(x, x, sel)).join('');
const field = (label, input, opts = {}) => `<div class=f${opts.cls ? ' ' + opts.cls : ''}><label${opts.for ? ` for="${opts.for}"` : ''}>${label}${opts.req ? ' <span class=req>*</span>' : ''}</label>${input}${opts.hint ? `<p class=hint>${opts.hint}</p>` : ''}${opts.req ? `<div class=err hidden>${esc(opts.err || 'Required.')}</div>` : ''}</div>`;
const readRO = v => `<input type=text class=computed value="${esc(v)}" readonly>`;

/* status tabs: a worklist is filtered by lifecycle state constantly */
function statusTabs(key, items, active) {
  return `<div class=statustabs role=tablist>${items.map(([label, n]) =>
    `<button type=button class="${label === active ? 'on' : ''}" data-q="${esc(key)}" data-v="${esc(label)}" role=tab aria-selected="${label === active}">${esc(label)}${n != null ? `<span class=n>${n}</span>` : ''}</button>`).join('')}</div>`;
}
function chips(key, items, active, label) {
  return `${label ? `<span class=src>${esc(label)}</span>` : ''}${items.map(([v, l]) => `<button type=button class="chip${String(v) === String(active || '') ? ' on' : ''}" data-q="${esc(key)}" data-v="${esc(v)}">${esc(l)}</button>`).join('')}`;
}
const selectQ = (key, list, sel, label) => `<label class=src>${esc(label)} <select data-qsel="${esc(key)}" style="width:auto;padding:3px 6px">${options(list, sel)}</select></label>`;

/* tables, each registered for export (CSV) with the filters on screen applied */
const EXPORTS = {};
function table(id, cols, rows, opts = {}) {
  EXPORTS[id] = { name: opts.name || id, cols, rows };
  const head = cols.map(c => `<th class="${c.num ? 'num' : ''}"${c.w ? ` style="width:${c.w}"` : ''}>${c.h}</th>`).join('');
  const body = rows.length ? rows.map((r, i) => `<tr${opts.row ? opts.row(r, i) : ''}>${cols.map(c => `<td class="${[c.num ? 'num' : '', c.cls ? (typeof c.cls === 'function' ? c.cls(r) : c.cls) : ''].join(' ').trim()}">${c.v ? c.v(r, i) : esc(r[c.k] ?? '—')}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan=${cols.length}><div class=empty>${opts.empty || 'Nothing here.'}</div></td></tr>`;
  const cap = opts.cap !== false ? `<div class=cap>${opts.cap || `<span>${plural(rows.length, opts.noun || 'row')}</span>`}<span class=sp></span>${opts.export !== false ? `<button type=button class="btn sec" style="padding:3px 10px" data-export="${esc(id)}">Export CSV</button>` : ''}</div>` : '';
  return `<div class=tbl${opts.alloc ? ` data-alloc="${esc(opts.alloc)}"` : ''}>${opts.title ? `<h2>${opts.title}</h2>` : ''}${cap}<table class=dt><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${opts.foot ? `<tfoot>${opts.foot}</tfoot>` : ''}</table></div>`;
}
const strip$ = h => String(h ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
function exportCsv(id) {
  const e = EXPORTS[id]; if (!e) return;
  const cols = e.cols.filter(c => c.csv !== false && !/^\s*$/.test(strip$(c.h)));
  const cell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [cols.map(c => cell(strip$(c.h))).join(','), ...e.rows.map((r, i) => cols.map(c => cell(c.csv ? c.csv(r, i) : c.v ? strip$(c.v(r, i)) : r[c.k])).join(','))];
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${e.name.replace(/[^A-Za-z0-9]+/g, '-')}-${todayIST()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast(`Exported ${plural(e.rows.length, 'row')} — ${e.name}.`, 'ok');
}

/* ---------- 6. toasts, dialogs and the detail drawer -------------------------- */
function toast(msg, kind) {
  const host = $('#toasts');
  const t = document.createElement('div');
  t.className = 'toast ' + (kind || 'ok');
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.classList.add('out'), kind === 'bad' ? 6000 : 3600);
  setTimeout(() => t.remove(), kind === 'bad' ? 6400 : 4000);
}
/* A native <dialog>: focus trap, Esc and backdrop come free. onOk may return
   false to keep it open (a refused command keeps what was typed). */
function dlg({ title, body, ok = 'Confirm', okClass = '', wide = false, cancel = 'Cancel', onOk, onOpen, noOk = false }) {
  const host = $('#dlg-host');
  host.innerHTML = '';
  const d = document.createElement('dialog');
  if (wide) d.className = 'wide';
  d.innerHTML = `<h2>${title}</h2><div class=body>${body}</div><div class=foot><span class=sp></span>
    <button type=button class="btn sec" data-dlg-close>${esc(noOk ? 'Close' : cancel)}</button>${noOk ? '' : `<button type=button class="btn ${okClass}" data-dlg-ok>${esc(ok)}</button>`}</div>`;
  host.appendChild(d);
  d.addEventListener('close', () => { d.remove(); if (pendingRender) safeRender(); });
  d.addEventListener('click', e => { if (e.target === d) d.close(); });
  d.querySelector('[data-dlg-close]').addEventListener('click', () => d.close());
  const okBtn = d.querySelector('[data-dlg-ok]');
  if (okBtn) okBtn.addEventListener('click', async () => {
    let bad = null;
    d.querySelectorAll('[data-required]').forEach(i => {
      const empty = i.type === 'checkbox' ? !i.checked : !String(i.value || '').trim();
      const err = i.closest('.f') && i.closest('.f').querySelector('.err');
      if (err) err.hidden = !empty;
      i.classList.toggle('invalid', empty);
      if (empty && !bad) bad = i;
    });
    if (bad) { bad.focus(); return; }
    okBtn.disabled = true;
    try { const r = onOk ? await onOk(d) : true; if (r !== false && d.open) d.close(); }
    finally { okBtn.disabled = false; }
  });
  d.showModal();
  if (onOpen) onOpen(d);
  const first = d.querySelector('input:not([readonly]):not([type=checkbox]),select,textarea');
  if (first) first.focus();
  return d;
}
/* dialog that runs one command; keeps the dialog open if it is refused */
function cmdDlg(opts, cmd, payloadFn, runOpts) {
  return dlg({ ...opts, onOk: async d => {
    const p = typeof payloadFn === 'function' ? payloadFn(d) : payloadFn;
    if (p === false) return false;
    const r = await run(cmd, p, runOpts || {});
    return r ? true : false;
  } });
}
const reasonBody = (text, label = 'Reason', hint) => `${text ? `<p>${text}</p>` : ''}${field(label, `<textarea id=dlg-reason data-required></textarea>`, { req: true, err: 'A reason is required — it is kept in the audit trail.', hint })}`;
function closeAll() { const d = $('dialog[open]'); if (d) d.close(); closeDrawer(); }
function drawer(title, pillHtml, body, foot) {
  closeDrawer();
  const w = document.createElement('div');
  w.id = 'drawer-wrap';
  w.innerHTML = `<div class=drawer-back data-close-drawer></div><aside class=drawer role=dialog aria-label="${esc(strip$(title))}">
    <div class=hd><h2>${title}</h2>${pillHtml || ''}<span class=sp></span><button type=button class=x data-close-drawer aria-label=Close>&times;</button></div>
    <div class=body>${body}</div>${foot ? `<div class=foot>${foot}</div>` : ''}</aside>`;
  document.body.appendChild(w);
  const x = w.querySelector('.x'); if (x) x.focus();
}
function closeDrawer() { const w = $('#drawer-wrap'); if (w) { w.remove(); if (pendingRender) safeRender(); } }

/* ---------- 7. the shell -------------------------------------------------------- */
function render({ keepScroll } = {}) {
  const root = $('#root');
  const y = keepScroll ? window.scrollY : 0;
  if (!DB) { root.innerHTML = '<div class=boot>Loading…</div>'; return; }
  let { sid, q } = route();
  if (!S) {
    if (sid !== 'SYS-01') history.replaceState(null, '', '#/SYS-01');
    root.innerHTML = SCREENS['SYS-01'].render(q); SCREENS['SYS-01'].after(q); return;
  }
  if (!sid || sid === 'SYS-01') { sid = homeOf(); history.replaceState(null, '', '#/' + sid); }
  /* the same place, the version for this user: a viewer's overview, an agent's quote */
  const alt = ALIAS[sid] && SCREENS[sid] && SCREENS[sid].when && !SCREENS[sid].when() ? ALIAS[sid] : null;
  if (alt) { sid = alt; history.replaceState(null, '', '#/' + sid + qstr(q)); }
  let def = SCREENS[sid];
  if (def && def.when && !def.when()) def = null;
  let loc = def && def.id.startsWith('SYS') ? null : locate(sid);
  if (!def || (!loc && !(def.id === 'SYS-02'))) { def = SCREENS['SYS-02']; loc = null; q = { denied: sid }; }
  if (loc) ROUTE_WS = loc.ws;
  const ws = loc ? loc.ws : (workspaces()[0] || null);
  let page;
  try { page = def.render(q) || ''; }
  catch (e) { console.error(e); page = banner('bad', 'This screen could not be shown', `<br>${esc(e.message)}`); }
  const title = typeof def.title === 'function' ? def.title(q) : def.title;
  const sub = def.sub ? (typeof def.sub === 'function' ? def.sub(q) : def.sub) : '';
  const acts = def.acts ? def.acts(q) : '';
  root.innerHTML = `<div class="app${readOnly() ? ' ro' : ''}">
    <a class=skip href="#main">Skip to content</a>
    ${navHtml(ws, sid)}
    <div class=main>
      ${masterBar()}
      ${topHtml(ws, sid)}
      ${loc ? subnavHtml(loc, sid) : ''}
      ${loc ? sectionTabsHtml(loc, sid) : ''}
      <div class=page id=main role=main tabindex=-1>
        <div class=pagehead><h1>${title}</h1><span class=sp></span><div class=pageacts>${acts}</div></div>
        ${sub ? `<p class=sub>${sub}</p>` : ''}
        ${readOnly() && loc ? `<div class=roview style="display:block"><b>Read-only view.</b> ${isMaster() ? 'The master test user oversees every workspace but acts only as a persona — use “Act as” in the top bar.' : 'You hold a viewer role, so actions are absent rather than shown-and-disabled. Ask a Treasury Dealer to act on anything you find here.'}</div>` : ''}
        ${page}
        ${relatedHtml(sid)}
      </div>
    </div>
  </div>`;
  document.title = `${sid} — ${strip$(title)} · Treasury Management Portal`;
  try { guideSync(); } catch (e) { /* the guide is a convenience */ }
  after();
  if (keepScroll) window.scrollTo(0, y); else window.scrollTo(0, 0);
  function after() { if (def && def.after) try { def.after(q); } catch (e) { console.error(e); } }
}
const ALIAS = { 'T-01': 'T-01V', 'T-01V': 'T-01', 'B-02': 'B-02a', 'B-02a': 'B-02' };
const navId = id => ALIAS[id] && SCREENS[id] && SCREENS[id].when && !SCREENS[id].when() ? ALIAS[id] : id;
/* The trade portal's demo guide follows one customer's payment through
   treasury. Treasury's book is not visible from there, so what treasury has
   done to that payment's position is noted for it (same-origin storage). */
function guideSync() {
  const g = localGet('ad2-guide');
  if (!g || !g.smeId || !DB || !(DB.covers || []).length) return;
  const seen = localGet('ad2-guide-tr') || {};
  let changed = false;
  (DB.positions || []).filter(p => p.smeId === g.smeId && V.tradeChannel(p)).forEach(p => {
    const was = seen[p.id] || {};
    const now = { entered: was.entered || (DB.covers || []).some(c => c.currency === p.currency && c.enteredAt >= p.bookedAt),
      covered: was.covered || (p.covered || 0) > 0, concluded: was.concluded || p.status === 'Concluded' };
    if (JSON.stringify(now) !== JSON.stringify(was)) { seen[p.id] = now; changed = true; }
  });
  if (changed) localSet('ad2-guide-tr', seen);
}
function navHtml(ws, sid) {
  const w = workspaces();
  const items = (NAV[ws] || []).map(([label, id]) => [label, navId(id)]);
  const sec = ((SECTIONS[ws] || []).find(([, ids]) => ids.includes(sid)) || [null, []])[1];
  const on = items.some(([, id]) => id === sid) ? sid : (items.find(([, id]) => sec.includes(id)) || [])[1];
  const links = items.map(([label, id]) => `<a href="#/${id}"${id === on ? ' class=on aria-current=page' : ''}>${esc(label)}</a>`).join('');
  const sw = w.length > 1 ? `<div class=grp>Workspace</div>${w.map(x => `<a href="#/${x === 'treasury' && roleDef().readOnly ? 'T-01V' : HOME[x]}"${x === ws ? ' class=on' : ''}>${esc(WS_LABEL[x])}</a>`).join('')}` : '';
  const tradeLink = isMaster() || ['AD2 Administrator'].includes(S.role) ? `<a href="../app.html">Trade portal ↗</a>` : '';
  return `<nav class=nav aria-label=Primary>
    <div class=brand>AD2 Treasury<span>Treasury Management</span></div>
    ${ws ? `<div class=grp>${esc(WS_LABEL[ws])}</div>` : ''}${links}${sw}
    <div class=foot>One platform with the trade portal: bookings, deals and settlements flow in here as they happen.
      ${tradeLink}<a href="design/index.html" target=_blank rel=noopener>Design reference ↗</a></div>
  </nav>`;
}
function topHtml(ws, sid) {
  const env = API.mode === 'server' ? `<span class="env live" title="Shared state: ${esc(API.store)}">Live · ${esc(API.store || 'server')}</span>` : `<span class="env local" title="No server reachable: the engine runs in this browser">Local mode</span>`;
  const act = isMaster() ? `<button type=button class="btn sec" style="padding:3px 10px" data-act="act-as">Act as…</button>` : '';
  return `<div class=top>
    <span class=crumb>${esc(WS_LABEL[ws] || 'Treasury')} / <b>${esc(ws === 'branch' || ws === 'agent' ? myScopeName() : ws === 'bulk' ? myScopeName() : (DB.settings || {}).orgName || 'AD2 Trade Services')}</b></span>
    <label class=search><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5"/><line x1="11" y1="11" x2="15" y2="15"/></svg><input id=globalsearch type=search autocomplete=off placeholder="Search position, quote, bill, deal or customer" aria-label="Search position, quote, bill, deal or customer"><div class=results id=search-results hidden></div></label>
    <label class=asof title="Everything on screen is computed at this moment (IST)"><span>As at</span><b id=asof-clock class=fig style="font-weight:normal">${istDT(NOW())} IST</b></label>
    ${env}${act}
    <span class=user data-act="user-menu" tabindex=0>${esc(S.name || S.loginId)} · ${esc(S.role.replace(/^AD2 /, ''))}</span>
    <span class=sid>${esc(sid)}</span>
  </div>`;
}
function masterBar() {
  if (!MASTER || isMaster()) return '';
  return `<div class=masterbar><span>Master test session — acting as <b>${esc(S.name)}</b> (${esc(S.role)}). Every step is recorded against this persona.</span><span class=sp></span>
    <button type=button data-act="act-as">Switch persona</button><button type=button data-act="back-master">Back to test console</button></div>`;
}
const titleOf = id => { const d = SCREENS[id]; if (!d) return id; const t = typeof d.title === 'function' ? d.title({}) : d.title; return strip$(t); };
function subnavHtml(loc, sid) {
  const home = HOME[loc.ws];
  const crumbs = [`<a href="#/${home}">${esc(WS_LABEL[loc.ws])}</a>`];
  crumbs.push(loc.ids[0] !== sid ? `<a href="#/${loc.ids[0]}">${esc(loc.sec)}</a>` : `<span aria-current=page>${esc(loc.sec)}</span>`);
  if (loc.ids[0] !== sid || titleOf(sid) !== loc.sec) crumbs.push(`<span aria-current=page>${esc(titleOf(sid))}</span>`);
  const ids = loc.ids.filter(allowed);
  let pager = '';
  if (ids.length > 1) {
    const i = ids.indexOf(sid);
    pager = `<div class=pager>${i > 0 ? `<a href="#/${ids[i - 1]}" title="${esc(titleOf(ids[i - 1]))}">&lsaquo; Prev</a>` : '<span class=off>&lsaquo; Prev</span>'}
      <span class=count>${i + 1} of ${ids.length}</span>${i < ids.length - 1 ? `<a href="#/${ids[i + 1]}" title="${esc(titleOf(ids[i + 1]))}">Next &rsaquo;</a>` : '<span class=off>Next &rsaquo;</span>'}</div>`;
  }
  return `<div class=subnav><button class=back type=button data-act="back">&larr; Back</button><nav class=crumbs aria-label=Breadcrumb>${crumbs.join('<span class=sep>/</span>')}</nav><span class=sp></span>${pager}</div>`;
}
/* screens a user may open inside its section (the viewer overview is the viewer's) */
function allowed(id) {
  const d = SCREENS[id]; if (!d) return false;
  if (d.when && !d.when()) return false;
  return true;
}
function sectionTabsHtml(loc, sid) {
  const ids = loc.ids.filter(allowed);
  if (ids.length < 2) return '';
  return `<div class=sectiontabs role=tablist aria-label="${esc(loc.sec)}">${ids.map(i => `<a href="#/${i}"${i === sid ? ' class=on' : ''}>${esc(titleOf(i))}</a>`).join('')}</div>`;
}
const NEXT = {
  'B-01': ['B-02', 'B-05', 'B-06'], 'B-02': ['B-04', 'B-05'], 'B-03': ['B-04', 'B-01'], 'B-04': ['B-05', 'B-06'], 'B-05': ['B-04', 'B-09'],
  'B-06': ['B-05', 'B-09'], 'B-09': ['B-06', 'B-05'], 'B-10': ['B-04', 'B-01'],
  'T-01': ['T-24', 'T-02', 'T-21'], 'T-24': ['T-02', 'T-04', 'T-27'], 'T-02': ['T-03', 'T-04', 'T-05'], 'T-03': ['T-20', 'T-05'], 'T-04': ['T-05', 'T-12'],
  'T-05': ['T-06', 'T-02'], 'T-06': ['T-05', 'T-02'], 'T-11': ['T-25', 'T-10'], 'T-12': ['T-13', 'T-04'], 'T-13': ['T-21', 'T-12'], 'T-14': ['T-15', 'T-16'],
  'T-15': ['T-20', 'T-16'], 'T-16': ['T-20', 'T-27'], 'T-21': ['T-13', 'T-26'], 'T-26': ['T-05', 'T-18'], 'T-27': ['T-24', 'T-16'], 'T-28': ['T-02', 'T-25', 'T-24'],
  'OPS-01': ['OPS-03'], 'OPS-02': ['OPS-03'], 'ADM-01': ['ADM-02', 'ADM-05'], 'ADM-05': ['ADM-03', 'ADM-01'],
};
function relatedHtml(sid) {
  const items = (NEXT[sid] || []).filter(t => locate(t) && allowed(t)).map(t => `<a href="#/${t}">${esc(titleOf(t))}</a>`).join('');
  return items ? `<div class=related><span>Where to next</span>${items}</div>` : '';
}

/* ---------- 8. the position drawer ------------------------------------------------ */
const posFind = id => (DB.positions || []).find(p => p.id === id);
const tradeRecord = p => p && p.recordId ? [...(DB.outward || []), ...(DB.disposals || [])].find(r => r.id === p.recordId) : null;
function openPosition(id) {
  const p = posFind(id);
  if (!p) { toast(`${id} is not in your view.`, 'warn'); return; }
  const now = NOW(), lc = V.lifecycle(DB, p, now);
  const rec = tradeRecord(p);
  const deal = p.dealId && (DB.deals || []).find(d => d.id === p.dealId);
  const allocs = (DB.coverAllocations || []).filter(x => x.positionId === p.id || x.crossId === p.id);
  const audit = (DB.audit || []).filter(a => a.record === p.id).slice(0, 12);
  const remaining = TR.remaining(p);
  const body = `
    ${p.status === 'Held' ? banner('warn', 'Held for a treasury checker', `${esc(p.heldReason || 'Customer limit')} — released or declined on the approvals worklist.`) : ''}
    ${kv([
      ['Product / currency', esc(posLabel(p))], ['Side', `${side(p.side)} ${esc(p.currency)} — ${p.side === 'SELL' ? 'company sells to the customer (short)' : 'company buys (long)'}`],
      ['Amount', `<b>${fcy(p.amount, p.currency)}</b>`], ['Customer rate', rate(p.customerRate)],
      p.refRate !== undefined ? ['Base rate at booking', rate(p.refRate)] : null,
      ['INR principal', inr(p.amount * p.customerRate)],
      ['Customer', esc(p.customerName || '—') + (p.customerRef ? `<span class=sm>${esc(p.customerRef)}</span>` : '')],
      ['Branch', esc(node(p.branchId))], ['Channel', esc(p.channel || '—') + (p.agentName ? ` — ${esc(p.agentName)}` : '')],
      ['Booked', `${istDT(p.bookedAt)} IST — ${esc(p.bookedBy || '')}`],
      p.cutoffAt ? ['Cut-off', `${istDT(p.cutoffAt)} IST ${p.status === 'Open' ? clock(p.cutoffAt) : ''}${p.kept ? `<span class=sm>Held past cut-off — ${esc(p.kept.reason)}</span>` : ''}`] : null,
      p.expiresAt && !p.cutoffAt ? ['Rate lock', `${istDT(p.expiresAt)} IST ${p.status === 'Open' ? clock(p.expiresAt) : ''}`] : null,
      p.valueDate ? ['Value date', dmy(p.valueDate)] : null,
      p.quoteId ? ['Quote', esc(p.quoteId)] : null,
      deal ? ['FX deal reference', `${esc(deal.id)} ${st(deal.status)}${deal.usedOn ? ` <span class=sm>applied to ${esc(deal.usedOn)}</span>` : ''}`] : null,
      p.offline ? ['Offline capture', `${esc(p.offline.reason)} — committed ${istDT(p.offline.committedAt)} IST`] : null,
    ])}
    <h3>Transaction link</h3>
    ${kv([['Status', st(V.linkTrack(DB, p, now))], ['Linked', fcy(p.linkedAmount || 0, p.currency)], ['Remaining', fcy(remaining, p.currency)],
          ['Cancelled / released', fcy(p.cancelledAmount || 0, p.currency) + (p.cancelReason ? `<span class=sm>${esc(p.cancelReason)}</span>` : '')]])}
    ${(p.links || []).length ? `<div class="tbl mt"><table class=dt><thead><tr><th>Reference</th><th>Kind</th><th class=num>Amount</th><th>When</th></tr></thead><tbody>${p.links.map(l =>
      `<tr><td class=ref>${esc(l.ref)}</td><td>${esc(l.kind)}</td><td class=num>${num(l.amount, p.currency)}</td><td class=dim>${istDT(l.at)}</td></tr>`).join('')}</tbody></table></div>` : ''}
    ${(p.adjustments || []).length ? `<p class="small muted">Forward-dated adjustments: ${p.adjustments.map(a => `${esc(a.ref)} ${num(a.amount, p.currency)} (${esc(a.reason)})`).join('; ')}</p>` : ''}
    ${p.coverState !== undefined || p.covered !== undefined ? `<h3>Bank cover</h3>${kv([['Status', st(V.coverTrack(p))], p.covered !== undefined ? ['Covered', fcy(p.covered || 0, p.currency)] : null,
      p.covered !== undefined ? ['Uncovered', fcy(TR.uncovered(p), p.currency)] : null])}
      ${allocs.length ? `<div class="tbl mt"><table class=dt><thead><tr><th>Allocation</th><th>Source</th><th class=num>Amount</th><th class=num>Rate</th></tr></thead><tbody>${allocs.map(x =>
        `<tr${x.status !== 'Active' ? ' class=off' : ''}><td>${esc(x.id)}</td><td>${esc(x.coverId || (x.crossId === p.id ? x.positionId : x.crossId))} ${x.kind === 'cross' ? '<span class=sm>internal cross</span>' : ''}</td><td class=num>${num(x.amount, p.currency)}</td><td class=num>${rate(x.rate)}</td></tr>`).join('')}</tbody></table></div>` : ''}` : ''}
    ${rec ? `<h3>Trade portal request</h3>${kv([['Request', `${esc(rec.id)} ${st(rec.status)}`], ['Customer', esc(((DB.smes || []).find(s => s.id === rec.smeId) || {}).tradingName || rec.smeId)],
      ['Amount', fcy(rec.amount, rec.currency)], rec.utr ? ['UTR', esc(rec.utr)] : null, rec.firc ? ['FIRC', esc(rec.firc)] : null,
      rec.beneficiary ? ['Beneficiary', esc(rec.beneficiary)] : null, rec.remitter ? ['Remitter', esc(rec.remitter)] : null])}` : ''}
    ${audit.length ? `<h3>History</h3><ul class=tl>${audit.map(a => `<li><time>${istDT(a.at)} IST</time><p>${esc(a.action)}<span class="chg"> — ${esc(a.actor || '')}</span></p></li>`).join('')}</ul>` : ''}`;
  const acts = positionActions(p);
  drawer(`${esc(p.id)}`, st(lc), body, acts);
}
function positionActions(p) {
  if (readOnly()) return '';
  const out = [];
  const open = p.status === 'Open', branchDeal = !V.tradeChannel(p);
  if (open && branchDeal && can('tmp.link') && TR.remaining(p) > 0.005) {
    out.push(btn('Punch FX Plus bill', 'punch', { id: p.id }));
    out.push(gobtn('Knock-off', 'B-05', { pos: p.id }, 'sec'));
  }
  if (open && branchDeal && can('tmp.cutoff') && p.cutoffAt) out.push(btn('Keep past cut-off', 'keep', { id: p.id }, 'sec'), btn('Inform treasury', 'inform', { id: p.id }, 'sec'));
  if (open && can('tmp.agent') && !can('tmp.branch')) out.push(btn('Request cancellation', 'req-cancel', { id: p.id }, 'danger'));
  if (['Open', 'Held'].includes(p.status) && can('tmp.cancel') && (branchDeal || can('treasury.view'))) out.push(btn('Cancel residual', 'cancel-pos', { id: p.id }, 'danger'));
  if (can('treasury.deal') && TR.uncovered(p) > 0.005 && !['Cancelled', 'Held'].includes(p.status)) out.push(gobtn('Allocate cover', 'T-05', { pos: p.id }));
  if (can('tmp.exceptions') && open && branchDeal) out.push(btn('Remind branch', 'remind', { id: p.id }, 'sec'));
  return out.join('');
}

/* ---------- 9. global search -------------------------------------------------- */
function searchIndex(qs) {
  const q = qs.trim().toUpperCase();
  if (q.length < 2) return [];
  const hit = s => String(s || '').toUpperCase().includes(q);
  const out = [];
  (DB.positions || []).forEach(p => { if ([p.id, p.customerName, p.customerRef, p.recordId, p.dealId, p.quoteId].some(hit)) out.push({ ref: p.id, text: `${posLabel(p)} · ${fcy(p.amount, p.currency)} · ${p.customerName || ''}`, pos: p.id }); });
  (DB.quotes || []).forEach(x => { if (hit(x.id)) out.push({ ref: x.id, text: `Quote ${x.status} · ${fcy(x.amount, x.currency)}`, go: x.status === 'Live' ? 'B-03' : 'B-04', q: { q: x.id } }); });
  (DB.fxpTxns || []).forEach(t => { if (hit(t.id) || hit(t.positionRef)) out.push({ ref: t.id, text: `FX Plus bill · ${fcy(t.amount, t.currency)} · ${node(t.branchId)}`, go: can('treasury.view') ? 'T-06' : 'B-05' }); });
  (DB.covers || []).forEach(c => { if (hit(c.id) || hit(c.dealRef)) out.push({ ref: c.id, text: `${c.type || 'Spot'} cover ${c.side} ${fcy(c.amount, c.currency)} · ${c.counterparty}`, go: c.type === 'Forward' ? 'T-12' : 'T-05', q: { src: c.id } }); });
  (DB.deals || []).forEach(d => { if (hit(d.id)) out.push({ ref: d.id, text: `FX deal ${d.status} · ${fcy(d.amount, d.currency)}`, pos: d.positionId }); });
  (DB.approvals || []).forEach(a => { if (hit(a.id) || hit(a.ref)) out.push({ ref: a.id, text: `${a.type} · ${a.status}`, go: 'T-21', q: { id: a.id } }); });
  (DB.bulkRequests || []).forEach(r => { if (hit(r.id)) out.push({ ref: r.id, text: `Bulk booking ${r.status} · ${fcy(r.amount, r.currency)}`, go: can('tmp.bulk.book') ? 'T-17' : 'OPS-01' }); });
  (DB.limits || []).forEach(l => { if (hit(l.id) || hit(l.name)) out.push({ ref: l.id, text: `Customer limit · ${l.name}`, go: 'T-25' }); });
  return out.filter(r => !r.go || locate(r.go)).slice(0, 12);
}

/* ---------- 10. delegated events ----------------------------------------------- */
const ACTS = {};                    /* name → (el, ev) handler; screens register theirs */
const act = (name, fn) => { ACTS[name] = fn; };
document.addEventListener('click', e => {
  const x = e.target.closest('[data-pos]');
  if (x) { e.preventDefault(); openPosition(x.dataset.pos); return; }
  if (e.target.closest('[data-close-drawer]')) { e.preventDefault(); closeDrawer(); return; }
  const ex = e.target.closest('[data-export]');
  if (ex) { e.preventDefault(); exportCsv(ex.dataset.export); return; }
  const qb = e.target.closest('[data-q]');
  if (qb && !qb.matches('select')) { e.preventDefault(); const r = route(); setQ({ [qb.dataset.q]: r.q[qb.dataset.q] === qb.dataset.v && qb.classList.contains('chip') ? '' : qb.dataset.v }); return; }
  const sr = e.target.closest('#search-results button');
  if (sr) { e.preventDefault(); $('#search-results').hidden = true; if (sr.dataset.p) openPosition(sr.dataset.p); else go(sr.dataset.g, JSON.parse(sr.dataset.qq || '{}')); return; }
  const a = e.target.closest('[data-act]');
  if (a && ACTS[a.dataset.act]) { e.preventDefault(); ACTS[a.dataset.act](a, e); return; }
  if (!e.target.closest('.menu') && !e.target.closest('[data-act="user-menu"]')) { const m = $('.menu'); if (m) m.remove(); }
  if (!e.target.closest('.search')) { const r = $('#search-results'); if (r) r.hidden = true; }
});
document.addEventListener('change', e => {
  const s = e.target.closest('[data-qsel]');
  if (s) { setTimeout(() => setQ({ [s.dataset.qsel]: s.value }), 0); return; }
  /* after the change event settles: a re-render inside a blur would lose the click that caused it */
  const a = e.target.closest('[data-change]');
  if (a && ACTS[a.dataset.change]) setTimeout(() => ACTS[a.dataset.change](a, e), 0);
});
document.addEventListener('input', e => {
  if (e.target.id === 'globalsearch') {
    const res = searchIndex(e.target.value), box = $('#search-results');
    box.hidden = !e.target.value.trim();
    box.innerHTML = res.length ? res.map(r => `<button type=button ${r.pos ? `data-p="${esc(r.pos)}"` : `data-g="${esc(r.go)}" data-qq='${esc(JSON.stringify(r.q || {}))}'`}><b>${esc(r.ref)}</b><span>${esc(r.text)}</span></button>`).join('')
      : `<div class="small muted" style="padding:8px 12px">No match in your view.</div>`;
    return;
  }
  const a = e.target.closest('[data-input]');
  if (a && ACTS[a.dataset.input]) ACTS[a.dataset.input](a, e);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#drawer-wrap')) { closeDrawer(); return; }
  if (e.key === 'Enter' && e.target.matches('[data-act="user-menu"]')) { ACTS['user-menu'](e.target, e); return; }
  if (e.key === 'Enter' && e.target.id === 'globalsearch') { const b = $('#search-results button'); if (b) b.click(); }
});
window.addEventListener('hashchange', () => { closeAll(); render(); });

/* shell actions */
act('back', () => { if (history.length > 1) history.back(); else go(homeOf()); });
act('user-menu', el => {
  const old = $('.menu'); if (old) { old.remove(); return; }
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = `<div class=hd><b>${esc(S.name)}</b><span>${esc(S.domainId)} / ${esc(S.loginId)} · ${esc(S.role)}</span><span>${esc(myScopeName())}</span></div>
    ${MASTER && !isMaster() ? `<button type=button data-act="back-master">Back to test console</button>` : ''}
    ${isMaster() ? `<a href="../app.html#/test">Test console (trade portal)</a>` : ''}
    <a href="../app.html">${isMaster() || S.role === 'AD2 Administrator' ? 'Open the trade portal' : 'Trade portal (demo guide, switch user)'}</a>
    <a href="design/index.html" target=_blank rel=noopener>Design reference (prototype)</a>
    ${isMaster() || can('tmp.admin') ? `<button type=button data-act="reset-demo">Reset demo data</button>` : ''}
    <button type=button data-act="sign-out">Sign out</button>`;
  el.appendChild(m);
});
act('sign-out', () => signOut());
act('reset-demo', () => resetDemo());
act('back-master', () => backToMaster());
act('act-as', () => {
  const tmp = (DB.roles || []).filter(r => r.portal === 'TMP' || r.id === 'AD2 Administrator').map(r => r.id);
  const people = (DB.logins || []).filter(l => tmp.includes(l.role) && l.active !== false);
  dlg({ title: 'Act as a treasury persona', noOk: true, wide: true, body: `<p class=small>Each step is taken as — and recorded against — the persona you open, so maker-checker still applies. The trade portal personas are on the test console.</p>
    <div class=personas>${people.map(l => `<button type=button class=persona data-act="open-as" data-d="${esc(l.domainId)}" data-l="${esc(l.loginId)}"><b>${esc(l.name)}</b><span>${esc(l.role)}</span><span>${esc(l.domainId)} / ${esc(l.loginId)}${l.branchScope ? ' · ' + esc(V.nodeName(DB, l.branchScope)) : ''}</span></button>`).join('')}</div>` });
});
act('open-as', el => { const d = $('dialog[open]'); if (d) d.close(); openAs(el.dataset.d, el.dataset.l); });
