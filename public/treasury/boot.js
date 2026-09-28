/* Treasury Management Portal — start up: find the server (or run locally),
   restore the session shared with the trade portal, and keep in sync. */
'use strict';
(async function boot() {
  API.tokens = sessGet('ad2-tokens') || {};
  MASTER = sessGet('ad2-master');
  const saved = sessGet('ad2-session');
  const qs = new URLSearchParams(location.search);
  if (!EMBEDDED && /^https?:$/.test(location.protocol) && qs.get('mode') !== 'local') {
    try {
      const h = await http(API_ROOT + 'health', { timeout: 5000 });
      if (h && h.ok !== false && h.mode === 'server') {
        API.mode = 'server'; API.store = h.store; API.persistent = h.persistent; API.passcodeRequired = h.passcodeRequired;
      }
    } catch (e) { API.mode = 'local'; }
  }
  if (saved && (API.mode === 'local' || saved.token)) S = saved;
  /* deep link ?as=DOMAIN:LOGIN — the screen index opens a screen as its persona */
  const as = qs.get('as');
  if (as) {
    const [d, l] = as.toUpperCase().split(':');
    if (!S || S.domainId !== d || S.loginId !== l) {
      try { if (API.mode === 'local' || !API.passcodeRequired) await signIn(d, l, 'demo'); } catch (e) { /* fall back to sign in */ }
    }
  }
  try { await pull(); }
  catch (e) {
    if (e.status === 401) { setSession(null); await pull().catch(() => {}); }
    else { $('#root').innerHTML = `<div class=boot>${esc(e.message || 'The portal could not load.')} <a href="">Retry</a></div>`; return; }
  }
  if (S && MASTER && S.role === MASTER_ROLE) MASTER = { domainId: S.domainId, loginId: S.loginId, name: S.name };
  render();
  setInterval(poll, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
})();
