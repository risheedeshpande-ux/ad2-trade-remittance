'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Mail = require('../server/mail');

const withEnv = (vars, fn) => {
  const keep = {}; Object.keys(vars).forEach(k => { keep[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; });
  try { return fn(); } finally { Object.keys(keep).forEach(k => { if (keep[k] == null) delete process.env[k]; else process.env[k] = keep[k]; }); }
};

test('mail is off without Gmail credentials, and sends nothing', async () => {
  await withEnv({ GMAIL_USER: null, GMAIL_APP_PASSWORD: null }, async () => {
    assert.equal(Mail.enabled(), false);
    assert.deepEqual(await Mail.send([{ id: 'EM-1', to: ['a@b.example'], link: '#/x' }], {}), []);
  });
});

test('only allow-listed addresses get mail; the rest goes to the demo inbox', () => {
  withEnv({ GMAIL_USER: 'me@gmail.com', EMAIL_ALLOW: 'Me@Work.com, other@x.com', DEMO_EMAIL_TO: null }, () => {
    assert.equal(Mail.recipient(['me@work.com']), 'me@work.com');
    assert.equal(Mail.recipient(['kavita@meridiantextiles.example']), 'me@gmail.com');
  });
  withEnv({ GMAIL_USER: 'me@gmail.com', EMAIL_ALLOW: null, DEMO_EMAIL_TO: 'demo@gmail.com' }, () => {
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
