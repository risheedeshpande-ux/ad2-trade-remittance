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

test('real mail is off without a Resend key and a demo address, and sends nothing', async () => {
  await withEnv({ RESEND_API_KEY: 're_x', DEMO_EMAIL_TO: null }, () => assert.equal(Mail.enabled(), false));
  await withEnv({ RESEND_API_KEY: null, DEMO_EMAIL_TO: null }, async () => {
    assert.equal(Mail.enabled(), false);
    assert.deepEqual(await Mail.send([{ id: 'EM-1', to: ['a@b.example'], link: '#/x' }], {}), []);
  });
});

test('only allow-listed addresses get mail; the rest goes to the demo inbox', () => {
  withEnv({ EMAIL_ALLOW: 'Me@Work.com, other@x.com', DEMO_EMAIL_TO: 'me@gmail.com' }, () => {
    assert.equal(Mail.recipient(['me@work.com']), 'me@work.com');
    assert.equal(Mail.recipient(['kavita@meridiantextiles.example']), 'me@gmail.com');
  });
  withEnv({ EMAIL_ALLOW: null, DEMO_EMAIL_TO: 'demo@gmail.com' }, () => {
    assert.equal(Mail.recipient(['anyone@x.com']), 'demo@gmail.com');
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

test('a Resend send posts the email to the redirected address, and a failure is reported, not thrown', async () => {
  const calls = [], keep = global.fetch;
  global.fetch = async (url, opt) => { calls.push({ url, body: JSON.parse(opt.body), auth: opt.headers.authorization }); return { ok: calls.length === 1, status: 422, text: async () => 'bad' }; };
  try {
    await withEnv({ RESEND_API_KEY: 're_test', DEMO_EMAIL_TO: 'me@gmail.com', EMAIL_ALLOW: null, PUBLIC_URL: 'https://demo.example' }, async () => {
      const m = { id: 'EM-1', to: ['kavita@x.example'], subject: 'AD2 has a query', body: 'Dear K,\n\n"Send it"', docs: ['PAN card'], link: '#/sme/dashboard?for=S&focus=S' };
      assert.deepEqual(await Mail.send([m], {}), [{ id: 'EM-1', to: 'me@gmail.com', ok: true }]);
      assert.equal(calls[0].url, 'https://api.resend.com/emails');
      assert.equal(calls[0].auth, 'Bearer re_test');
      assert.deepEqual(calls[0].body.to, ['me@gmail.com']);
      assert.match(calls[0].body.html, /https:\/\/demo\.example\/app\.html#\/sme\/dashboard\?for=S&amp;focus=S/);
      assert.match(calls[0].body.html, /meant for kavita@x\.example/);
      assert.match(calls[0].body.html, /<li>PAN card<\/li>/);
      assert.deepEqual(await Mail.send([m], {}), [{ id: 'EM-1', to: 'me@gmail.com', ok: false }]);
    });
  } finally { global.fetch = keep; }
});
