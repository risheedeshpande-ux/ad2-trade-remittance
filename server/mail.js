/* Real email for query alerts, through Gmail SMTP with an app password.
   Without GMAIL_USER and GMAIL_APP_PASSWORD nothing is sent and the outbox
   stays simulated. The demo is public, so mail only reaches addresses in
   EMAIL_ALLOW; anything else goes to DEMO_EMAIL_TO (default: GMAIL_USER),
   with the intended recipient named in the message. */
'use strict';

const env = k => String(process.env[k] || '').trim();
const enabled = () => !!(env('GMAIL_USER') && env('GMAIL_APP_PASSWORD'));
const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let transport = null;
const mailer = () => transport || (transport = require('nodemailer').createTransport({
  service: 'gmail', auth: { user: env('GMAIL_USER'), pass: env('GMAIL_APP_PASSWORD').replace(/\s+/g, '') } }));

function recipient(to) {
  const allow = env('EMAIL_ALLOW').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
  return (to || []).find(a => allow.includes(String(a).toLowerCase())) || env('DEMO_EMAIL_TO') || env('GMAIL_USER');
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
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1f2937;max-width:560px">
  <p style="font-size:12px;color:#6b7280;margin:0 0 16px">AD2 Trade Services · Remit4Me demo</p>
  ${lines.map(l => l.trim() ? `<p style="margin:0 0 10px">${esc(l)}</p>` : '').join('')}
  ${m.docs && m.docs.length ? `<p style="margin:14px 0 6px"><b>Documents requested</b></p><ul style="margin:0 0 14px;padding-left:20px">${m.docs.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
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
      await mailer().sendMail({ from: `AD2 Trade Services <${env('GMAIL_USER')}>`, to, subject: m.subject,
        text: `${m.body}\n\n${url}${intended ? `\n\n(Demo: meant for ${intended}, redirected to you.)` : ''}`, html: html(m, url, intended) });
      return { id: m.id, to, ok: true };
    } catch (e) {
      console.error('mail failed', m.id, e && e.message);
      return { id: m.id, to, ok: false };
    }
  }));
}

module.exports = { send, enabled, baseUrl, recipient };
