/* Real email for query alerts, through Brevo's API (free: 300 a day).
   Every query email is in the demo inbox (/inbox.html) either way; with
   BREVO_API_KEY and EMAIL_FROM (a sender verified in Brevo) it is also
   delivered. The demo is public, so mail only goes to allowed addresses:
   EMAIL_ALLOW lists addresses or whole domains ("@mailinator.com" by
   default — public test inboxes, where the sample customers live). Anything
   else goes to DEMO_EMAIL_TO if set, naming who it was meant for, or is not
   sent at all. */
'use strict';

const env = k => String(process.env[k] || '').trim();
const enabled = () => !!(env('BREVO_API_KEY') && env('EMAIL_FROM'));
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function recipient(to) {
  const allow = (env('EMAIL_ALLOW') || '@mailinator.com').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  const ok = a => { a = String(a).toLowerCase(); return allow.some(x => x.startsWith('@') ? a.endsWith(x) : a === x); };
  return (to || []).find(ok) || env('DEMO_EMAIL_TO') || null;
}

/* The deployment's own address for the link. A Vercel production deploy
   knows its domain; otherwise trust the request (local or preview). */
function baseUrl(headers) {
  if (env('PUBLIC_URL')) return env('PUBLIC_URL').replace(/\/$/, '');
  if (env('VERCEL_ENV') === 'production' && env('VERCEL_PROJECT_PRODUCTION_URL')) return 'https://' + env('VERCEL_PROJECT_PRODUCTION_URL');
  const h = headers || {};
  const host = String(h['x-forwarded-host'] || h.host || 'localhost:8130').split(',')[0].trim();
  const proto = String(h['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https')).split(',')[0].trim();
  return `${proto}://${host}`;
}

function html(m, url, intended) {
  const lines = String(m.body).split('\n').filter(l => !/^\s*-\s/.test(l) && !/^Documents requested:/.test(l));
  const para = ls => ls.map(l => l.trim() ? `<p style="margin:0 0 10px">${esc(l)}</p>` : '').join('');
  const docs = m.docs && m.docs.length ? `<p style="margin:14px 0 6px"><b>Documents requested</b></p><ul style="margin:0 0 14px;padding-left:20px">${m.docs.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : '';
  let at = lines.findIndex(l => /^Sign in with/.test(l)); if (at < 0) at = lines.length;
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;max-width:560px">
  <p style="font-size:12px;color:#6b7280;margin:0 0 16px">AD2 Trade Services · Remit4Me demo</p>
  ${para(lines.slice(0, at))}${docs}${para(lines.slice(at))}
  <p style="margin:22px 0"><a href="${esc(url)}" style="background:#0f766e;color:#fff;padding:11px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Sign in and respond</a></p>
  <p style="font-size:12px;color:#6b7280">Or open: ${esc(url)}</p>
  ${intended ? `<p style="font-size:12px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:10px">Demo: this message was meant for ${esc(intended)} and was redirected to you.</p>` : ''}
</div>`;
}

/* Send the emails a command just queued. Never throws: a mail failure must
   not undo a query that has already been recorded. */
async function send(emails, headers) {
  if (!enabled() || !emails || !emails.length) return [];
  const base = baseUrl(headers);
  return Promise.all(emails.filter(m => recipient(m.to)).map(async m => {
    const to = recipient(m.to), url = base + '/app.html' + m.link;
    const intended = (m.to || []).some(a => String(a).toLowerCase() === to.toLowerCase()) ? '' : (m.to || []).join(', ');
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST',
        headers: { 'api-key': env('BREVO_API_KEY'), 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { name: env('EMAIL_FROM_NAME') || 'AD2 Trade Services', email: env('EMAIL_FROM') }, to: [{ email: to }],
          subject: m.subject, htmlContent: html(m, url, intended),
          textContent: `${m.body}\n\n${url}${intended ? `\n\n(Demo: meant for ${intended}, redirected to you.)` : ''}` }) });
      if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200));
      return { id: m.id, to, ok: true };
    } catch (e) {
      console.error('mail failed', m.id, e && e.message);
      return { id: m.id, to, ok: false };
    }
  }));
}

module.exports = { send, enabled, baseUrl, recipient };
