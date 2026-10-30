'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Mail = require('../server/mail');

const withEnv = (vars, fn) => {
  const keep = {}; Object.keys(vars).forEach(k => { keep[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; });
  const restore = () => Object.keys(keep).forEach(k => { if (keep[k] == null) delete process.env[k]; else process.env[k] = keep[k]; });
  let out;
  try { out = fn(); } catch (e) { restore(); throw e; }
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore(); return out;
};

test('real mail is off without a Brevo key and a sender, and sends nothing', async () => {
  await withEnv({ BREVO_API_KEY: 'k', EMAIL_FROM: null }, () => assert.equal(Mail.enabled(), false));
  await withEnv({ BREVO_API_KEY: null, EMAIL_FROM: null }, async () => {
    assert.equal(Mail.enabled(), false);
    assert.deepEqual(await Mail.send([{ id: 'EM-1', to: ['a@mailinator.com'], link: '#/x' }], {}), []);
  });
});

test('only allowed addresses get mail: Mailinator by default, exact addresses or whole domains', () => {
  withEnv({ EMAIL_ALLOW: null, DEMO_EMAIL_TO: null }, () => {
    assert.equal(Mail.recipient(['kavita.meridiantextiles@mailinator.com']), 'kavita.meridiantextiles@mailinator.com');
    assert.equal(Mail.recipient(['someone@realcompany.com']), null);
    assert.equal(Mail.recipient(['x@notmailinator.com.evil']), null);
  });
  withEnv({ EMAIL_ALLOW: 'Me@Work.com, @remit4me.com', DEMO_EMAIL_TO: 'me@gmail.com' }, () => {
    assert.equal(Mail.recipient(['me@work.com']), 'me@work.com');
    assert.equal(Mail.recipient(['ops@remit4me.com']), 'ops@remit4me.com');
    assert.equal(Mail.recipient(['a@mailinator.com']), 'me@gmail.com');
  });
});

test('links point at production on Vercel, else at the request host', () => {
  withEnv({ PUBLIC_URL: null, VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'ad2.example.app' }, () =>
    assert.equal(Mail.baseUrl({ host: 'evil.example' }), 'https://ad2.example.app'));
  withEnv({ PUBLIC_URL: null, VERCEL_ENV: null }, () => {
    assert.equal(Mail.baseUrl({ host: 'localhost:8130' }), 'http://localhost:8130');
    assert.equal(Mail.baseUrl({ 'x-forwarded-host': 'preview.vercel.app', 'x-forwarded-proto': 'https' }), 'https://preview.vercel.app');
  });
  withEnv({ PUBLIC_URL: 'https://demo.remit4me.com/' }, () => assert.equal(Mail.baseUrl({}), 'https://demo.remit4me.com'));
});

test('a Brevo send posts to the allowed address; disallowed mail is not sent; a failure is reported, not thrown', async () => {
  const calls = [], keep = global.fetch;
  global.fetch = async (url, opt) => { calls.push({ url, body: JSON.parse(opt.body), key: opt.headers['api-key'] }); return { ok: calls.length === 1, status: 400, text: async () => 'bad' }; };
  try {
    await withEnv({ BREVO_API_KEY: 'xkeysib-test', EMAIL_FROM: 'sender@gmail.com', EMAIL_ALLOW: null, DEMO_EMAIL_TO: null, PUBLIC_URL: 'https://demo.example' }, async () => {
      const m = { id: 'EM-1', to: ['kavita.meridiantextiles@mailinator.com'], subject: 'AD2 has a query', body: 'Dear K,\n\n"Send it"\n\nSign in with the link below.', docs: ['PAN card'], link: '#/sme/dashboard?for=S&focus=S' };
      assert.deepEqual(await Mail.send([m, { ...m, id: 'EM-2', to: ['ceo@realbank.com'] }], {}), [{ id: 'EM-1', to: 'kavita.meridiantextiles@mailinator.com', ok: true }]);
      assert.equal(calls.length, 1, 'the real address is never emailed');
      assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email');
      assert.equal(calls[0].key, 'xkeysib-test');
      assert.deepEqual(calls[0].body.sender, { name: 'AD2 Trade Services', email: 'sender@gmail.com' });
      assert.deepEqual(calls[0].body.to, [{ email: 'kavita.meridiantextiles@mailinator.com' }]);
      assert.match(calls[0].body.htmlContent, /https:\/\/demo\.example\/app\.html#\/sme\/dashboard\?for=S&amp;focus=S/);
      assert.ok(calls[0].body.htmlContent.indexOf('<li>PAN card</li>') < calls[0].body.htmlContent.indexOf('Sign in with'), 'documents come before the sign-in line');
      assert.ok(!/redirected/.test(calls[0].body.htmlContent));
      assert.deepEqual(await Mail.send([m], {}), [{ id: 'EM-1', to: 'kavita.meridiantextiles@mailinator.com', ok: false }]);
    });
  } finally { global.fetch = keep; }
});
