/* Demo inbox: shows the query emails the platform sends, refreshed every few
   seconds, so a presenter can show the email arriving and follow its link
   through sign-in to the answer screen. */
'use strict';
const $ = s => document.querySelector(s);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const when = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const store = { get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
                set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } } };

let mails = [], sel = null, known = null, real = false, last = null;
const opened = new Set(store.get('ib-opened') || []);

/* a sample customer's address is a real public inbox at mailinator.com */
const mailinator = m => { const a = (m.to || []).find(x => /@mailinator\.com$/i.test(x)); return a ? 'https://www.mailinator.com/v4/public/inboxes.jsp?to=' + encodeURIComponent(a.split('@')[0]) : ''; };
const bodyLines = m => String(m.body || '').split('\n').filter(l => !/^\s*-\s/.test(l) && !/^Documents requested:/.test(l));
/* the body with the requested documents listed just before the sign-in line */
function bodyHTML(m) {
  const lines = bodyLines(m), docs = m.docs && m.docs.length
    ? `<p><b>Documents requested</b></p><ul>${m.docs.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : '';
  let at = lines.findIndex(l => /^Sign in with/.test(l)); if (at < 0) at = lines.length;
  return lines.slice(0, at).map(l => l.trim() ? `<p>${esc(l)}</p>` : '').join('') + docs + lines.slice(at).map(l => l.trim() ? `<p>${esc(l)}</p>` : '').join('');
}

function draw(fresh) {
  const unread = mails.filter(m => !opened.has(m.id)).length;
  document.title = (unread ? `(${unread}) ` : '') + 'Demo inbox';
  $('#ib-list').innerHTML = mails.length ? mails.map(m => `
    <button type="button" class="ib-item${m.id === sel ? ' on' : ''}${opened.has(m.id) ? '' : ' unread'}${fresh.has(m.id) ? ' new' : ''}" data-id="${esc(m.id)}">
      <div class="r1"><b>AD2 Trade Services</b><span>${esc(when(m.sentAt))}</span></div>
      <div class="s">${esc(m.subject)}</div>
      <div class="p">${esc(bodyLines(m).find(l => l.startsWith('"')) || '')}</div></button>`).join('')
    : '<p class="ib-empty">No emails yet.<br>Raise a query as AD2 — on an application, a payment, a disposal or a bill — and it arrives here.</p>';
  const m = mails.find(x => x.id === sel);
  $('#ib-msg').innerHTML = !m ? '' : `<article class="ib-paper">
    <h1>${esc(m.subject)}</h1>
    <div class="ib-meta"><b>AD2 Trade Services</b> &lt;alerts@ad2trade.example&gt;<br>To: ${esc((m.to || []).join(', '))}<br>${esc(when(m.sentAt))}</div>
    <div class="ib-body">
      ${bodyHTML(m)}
      <a class="ib-cta" href="app.html${esc(m.link)}">Sign in and respond</a>
      <p class="ib-hint">Opens the platform. Sign in as the customer and you land on the answer, ready to upload.</p>
      ${real && mailinator(m) ? `<p class="ib-hint">Also delivered as a real email — <a href="${esc(mailinator(m))}" target="_blank" rel="noopener">open ${esc((m.to || [])[0])} in Mailinator ↗</a></p>` : ''}
    </div></article>`;
  if (m && !opened.has(m.id)) { opened.add(m.id); store.set('ib-opened', [...opened].slice(-200)); }
}

async function load() {
  try {
    const r = await fetch('/api/inbox', { cache: 'no-store' });
    const d = await r.json();
    if (!r.ok) { $('#ib-list').innerHTML = `<p class="ib-empty">${esc(d.error || 'The inbox is not available.')}</p>`; $('#ib-status').textContent = 'Off'; return; }
    $('#ib-status').textContent = 'Live';
    /* redraw only when the mail changed, so a click is never lost to a refresh */
    const sig = d.emails.map(m => m.id).join() + '|' + !!d.real;
    if (sig === last) return;
    last = sig;
    real = !!d.real;
    const fresh = new Set(known ? d.emails.filter(m => !known.has(m.id)).map(m => m.id) : []);
    known = new Set(d.emails.map(m => m.id));
    mails = d.emails;
    if (!mails.some(m => m.id === sel) || fresh.size) sel = mails.length ? mails[0].id : null;
    draw(fresh);
  } catch (e) {
    $('#ib-status').textContent = 'Reconnecting…';
  }
}

$('#ib-list').addEventListener('click', e => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  sel = b.dataset.id;
  draw(new Set());
});
load();
setInterval(() => { if (!document.hidden) load(); }, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
