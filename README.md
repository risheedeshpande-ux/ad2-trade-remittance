# AD2 Trade Remittance

A working demo of the AD2 trade-remittance platform: the SME portal and the AD2 operations portal behind it.
Onboard a partner, then take a payment and an export receipt all the way through maker, checker and operations
to a UTR and a FIRC — with every rule enforced by a server, not just the screen.

**Every business and transaction is fictional.** FX rates, SWIFT, PennyDrop, sanctions screening, SFTP, SAP and
document AI are simulated. Uploads record only the file name and size; file contents never leave the browser.

## Run it

```bash
npm install
npm start            # http://localhost:8130 — state in .data/state.json
```

Open the demo and click **Demo guide** in the yellow bar. It walks one new business through 17 steps and signs in
as the right person at each one.

```bash
npm test             # engine and API tests
npm run test:e2e     # full browser journey on a throwaway server (Playwright + Chromium)
```

## The journey

| # | Who | Does |
|---|---|---|
| 1 | Business | Registers — 8 steps, documents, bank account, its own Login ID and password |
| 2 | AD2 Maker | Reviews and prices: permission, currencies, margins, charges |
| 3 | AD2 Checker | Approves — the applicant's sign-in becomes an SME User |
| 4–6 | SME, Checker | Beneficiary added; import bill lodged and accepted |
| 7 | SME | DIR payment against the bill: purpose code, booked rate, documents |
| 8–10 | Maker, Checker, Operations | Verify → authorise → release: INR debited, UTR and MT103, bill settled |
| 11–13 | SME, Checker, Operations | Export bill lodged and accepted; incoming SWIFT credit recorded |
| 14–17 | SME, Maker, Checker, Operations | Disposal instruction → verify → authorise → process: INR credited, bill knocked off, FIRC issued |

## Purpose codes and documents

From the business team's **Purpose / Doc Policy** workbook (`public/data.js`): 111 approved purpose codes — the two
duplicated OTT rows (S0801, S0802) merged and descriptions tidied.

| Product | Codes | Documents |
|---|---|---|
| AIR — Advance Import Remittance | 4 | Proforma Invoice |
| DIR — Direct Import Remittance | 6 | Transport Document, Commercial Invoice, Bill of Entry — and settles an accepted import bill |
| OTT — Miscellaneous Remittance | 110 | Invoice, Form 145 (was 15CA); Transport Document for goods-import codes; Form 146 (was 15CB) above ₹5,00,000 |
| TRADE — disposal instructions | — | Disposal Instruction Letter, Commercial Export Invoice, Shipping Bill |

The Administrator can stop a code being offered and change any document rule.

## Architecture

```
public/            the app (static): app.html, js/*, styles.css, plus
  engine.js        every business rule — runs on the server; in the browser only for offline previews
  data.js          masters (purpose codes, products, document policy, roles) and seed data
api/*.js           Vercel serverless functions → server/app.js
server/app.js      /api/health, session, state, command, status, reset
server/auth.js     signed session tokens, scrypt passwords, sign-in throttling
server/store.js    Vercel Blob (private) · JSON file locally · optimistic concurrency
server.js          local server: static files + API on one port
tests/             engine, API and end-to-end browser tests
```

Every button posts a command to `/api/command`. The engine checks the role's capabilities, the four-eyes rule
(whoever raised, verified or authorised a record cannot take the next step on it), the document policy, the rate,
balances and bill reservations, then writes the new state and an audit entry. Other users' screens poll every 5 seconds.

Without a reachable API — the screen-index previews, or `?mode=local` — the same engine runs in the page against
browser storage.

## Accounts

Demo accounts use the passcode **`demo`** (set `DEMO_PASSCODE` on a deployment to change it). A business registered
through the portal signs in with its own password.

| Domain ID | Login ID | Role |
|---|---|---|
| MERIDIANTEX | SMEUSER | SME User — Import and Export |
| ARCADIACOMP | SMEUSER | SME User — Import only |
| NILGIRISPICE | SMEUSER | SME User — Export only |
| HKTRADING | APPLICANT | SME Applicant — waiting on its IEC |
| ISHANICONS | APPLICANT | SME Applicant — priced, waiting on the checker |
| AD2 | MAKER, MAKER2 | AD2 Maker |
| AD2 | CHECKER | AD2 Checker |
| AD2 | OPS | AD2 Operations |
| AD2 | ADMIN | AD2 Administrator |

## Deploying to Vercel

The project deploys as-is: `public/` is served statically and `api/` becomes serverless functions.

| Variable | Needed | Purpose |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Yes | Set automatically when a **private** Vercel Blob store is connected to the project. Without it, state lives in function memory and can reset. |
| `SESSION_SECRET` | Recommended | Signs session tokens. Falls back to a value derived from the Blob token. |
| `DEMO_PASSCODE` | Optional | Replaces `demo` for the demo accounts and for **Reset demo data**. Set it before sharing a link publicly. |
| `STATE_PREFIX` | Optional | Blob path prefix, to run two demos from one store. |

## Security

- Signed, expiring session tokens; role and business re-read from the stored login on every request.
- Salted scrypt password hashes that never leave the server; sign-in throttling.
- An SME session receives only its own records; AD2 internal notes and pricing remarks are stripped for SME users.
- Server-side validation of every field; booked rates recomputed on the server; deal rates held within 3% of reference.
- Content Security Policy with no inline or third-party script, HSTS, nosniff, frame-ancestors self.

## Not in scope yet

The FX quotation formula (treasury), transaction limits (risk), SFTP and SAP contracts, document storage and
retention, SME-side maker-checker, and a relational database in place of the single-document store. The PRD in
`public/docs/` lists the open decisions.
