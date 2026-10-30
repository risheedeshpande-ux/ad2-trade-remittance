/* Optional real email for query alerts, through Resend (one API key).
   Every query email is in the demo inbox (/inbox.html) either way; with
   RESEND_API_KEY and DEMO_EMAIL_TO set, it is also delivered. The demo is
   public, so mail only reaches addresses in EMAIL_ALLOW; anything else goes
   to DEMO_EMAIL_TO, with the intended recipient named in the message.
   Without a verified domain Resend delivers only to the account's own
   address — so DEMO_EMAIL_TO should be that address. */
'use strict';

const env = k => String(process.env[k] || '').trim();
const enabled = () => !!(env('RESEND_API_KEY') && env('DEMO_EMAIL_TO'));
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function recipient(to) {
  const allow = env('EMAIL_ALLOW').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  return (to || []).find(a => allow.includes(String(a).toLowerCase())) || env('DEMO_EMAIL_TO');
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
  return Promise.all(emails.map(async m => {
    const to = recipient(m.to), url = base + '/app.html' + m.link;
    const intended = (m.to || []).some(a => String(a).toLowerCase() === to.toLowerCase()) ? '' : (m.to || []).join(', ');
    try {
      const r = await fetch('https://api.resend.com/emails', { method: 'POST',
        headers: { authorization: 'Bearer ' + env('RESEND_API_KEY'), 'content-type': 'application/json' },
        body: JSON.stringify({ from: env('EMAIL_FROM') || 'AD2 Trade Services <onboarding@resend.dev>', to: [to], subject: m.subject,
          text: `${m.body}\n\n${url}${intended ? `\n\n(Demo: meant for ${intended}, redirected to you.)` : ''}`, html: html(m, url, intended) }) });
      if (!r.ok) throw new Error(r.status + ' ' + (await r.text()).slice(0, 200));
      return { id: m.id, to, ok: true };
    } catch (e) {
      console.error('mail failed', m.id, e && e.message);
      return { id: m.id, to, ok: false };
    }
  }));
}

module.exports = { send, enabled, baseUrl, recipient };
