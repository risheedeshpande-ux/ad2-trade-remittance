# AD2 Trade Remittance

Demo platform: trade portal (`/app.html`) + Treasury Management Portal (`/treasury/`) on one engine, one API, one sign-in. All businesses, rates and integrations are fictional. `README.md` has the role, journey and deployment tables; read it before changing behaviour.

## Commands

```bash
npm start            # http://localhost:8130, state in .data/state.json (gitignored)
npm test             # 63 unit/API tests, <1s; run before every commit
npm run test:e2e     # guided journey in a real browser (Playwright), throwaway server
npm run test:qa      # 45 journeys / 198 checks; writes qa-report.md
```

Sign in locally as Domain `TEST`, Login `MASTER`, passcode `demo` (master test user; switches to any persona).

## Architecture rules that are easy to break

- `public/engine.js` (trade) and `public/tmp-engine.js` (treasury) are **one codebase running in the browser and on the server**. Every state change goes through `execute()`; the server is the system of record. Never add a rule only in a screen: enforce it in the engine, then reflect it in the UI.
- Entry path: `api/*.js` (2-line shims) -> `server/app.js` -> engine. Adding a route means updating `ROUTES` in `server.js` too, or it works on Vercel but 404s locally.
- State is **one JSON document**, written with optimistic concurrency (`server/store.js`). Conflicts replay the command on fresh state; do not bypass with direct writes.
- Seed data lives in `public/data.js`. The server **reseeds when the stored seed version differs**: changing the seed on a branch wipes the shared store. That is why previews use their own row (`STATE_PREFIX` defaults to `ad2-trade-preview`). Never point a local run at production keys without setting `STATE_PREFIX`.
- Four-eyes everywhere: raise -> verify -> authorise -> release must be different people; a checker never approves their own entry. Don't weaken this in tests or the master user.
- Customers book the live rate and must never see AD2's margin. SME sessions receive only their own records (no compliance scores, reviewer reasons, internal notes).
- Treasury invariants: a booking is a position the moment it's made; UTR/FIRC conclude it; no published card rate means no booking for that currency; currencies are never totalled together; INR in lakh/crore, FX in international grouping.

## Gotchas

- CSP is strict (`script-src 'self'`, no inline scripts, `connect-src 'self'`). `server.js` applies the same headers as `vercel.json` so violations show up locally. No inline `<script>`, no external scripts/CDNs; only Google Fonts for CSS/fonts.
- Vercel: `public/` is static, functions are `bom1` (Mumbai) with 15s max. Keep the DB in Mumbai too. `/api/health` is pinged daily by a cron to stop the free Supabase project pausing.
- `DEMO_PASSCODE` must be set before sharing any deployment publicly.
- Times: a bare IST clock means *today only*; anything older shows its date.
- Pluralise via the existing helper, not `+ 's'` ("currencys" shipped once).

## Env vars

`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`) - database, server-side only, never to the browser. `SESSION_SECRET`, `DEMO_PASSCODE`, `STATE_PREFIX`, `STATE_STORE` (`supabase|blob|file|memory`), `STATE_FILE`, `BLOB_READ_WRITE_TOKEN` (legacy alternative). Schema: `supabase/schema.sql` (RLS on, no public policies).

## Workflow

- Develop on the branch assigned to the session; open a draft PR. Commit messages explain the *why* and name the tests run.
- After UI or engine changes run `npm test`; after journey changes also `npm run test:e2e` / `test:qa`. Add engine/API tests in `tests/*.test.js` for new rules.
- Keep `README.md` journey/role tables in sync with behaviour changes.
