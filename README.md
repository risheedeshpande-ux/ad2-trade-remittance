# AD2 Trade Remittance

A working product demo of the AD2 trade-remittance platform: the SME portal and the AD2 operations portal behind it.
Onboard a partner, then take payments and export receipts through sales, maker, checker and operations to a UTR and
a FIRC — with every rule enforced by a server, not just the screen. Customers book the live rate and never see AD2's
margin; every submission is reviewed before it is sent and ends on a confirmation with its reference.

**Every business and transaction is fictional.** FX rates, SWIFT, PennyDrop, sanctions screening, UFI (EDPMS/IDPMS)
reporting, SFTP, SAP and document AI are simulated. Uploads record only the file name and size; file contents never
leave the browser.

## Run it

```bash
npm install
npm start            # http://localhost:8130 — state in .data/state.json
```

Open the demo and click **Demo guide** in the yellow bar. It walks one new business through 17 steps and signs in
as the right person at each one. For everything else, open **Test data lab** from the sidebar.

```bash
npm test             # engine and API tests
npm run test:e2e     # the guided journey in a real browser, on a throwaway server
npm run test:qa      # 34 journeys across every role and product; writes qa-report.md (see tests/qa.js)
```

## Workspaces

Each role signs in to its own workspace: its own sidebar, dashboard and screens. The sidebar collapses to an icon
rail (remembered per browser), and **Switch user** in the top bar moves between demo users.

| Role | Sidebar | Does |
|---|---|---|
| SME User | Transact · Bills · Records · Settings | Outward payments (Import); reports buyers' payments and disposes of receipts (Export); bills, knock-off, masters |
| SME Applicant | Application | Tracks its application and answers queries |
| AD2 Sales | Customers · Track · Insight | Branch RM: captures offline applications; transacts for customers (assisted journey) |
| AD2 Maker | Home + queue · Onboarding · Verify · Transactions | Branch maker: onboards and prices; verifies payments and disposals; transacts for customers; answers queries for them |
| AD2 Checker | Home + queue · Authorise · Records | Trade checker: authorises payments and disposals; accepts bills; confirms knock-offs |
| AD2 Compliance | Home + queue · Onboarding · Oversight | Onboarding checker: approves, returns or rejects applications — no transaction authority |
| AD2 Operations | Home + queue · Settle · Authorise · Records | Confirms receipts; authorises; accepts bills; releases payments; credits disposals and issues FIRCs; reverses |
| AD2 Administrator | Configuration · Access · Oversight | Purpose codes, documents, compliance rules, users, settings, audit — no transaction authority |

Menu entries name the work (“Verify payments”, “Authorise disposals”, “Receipts to confirm”) and open the list filtered
to it, with a count. A role cannot open another role's screens by URL, and the API refuses anything outside its
capabilities. Every transaction needs a different person at each stage: raise → verify → authorise → release. Per the
24 Sep review the branch maker is common to onboarding and transactions, but checking is split: Compliance approves
customers; a Checker or Operations approves money.

## Journeys

| Journey | Flow |
|---|---|
| Onboarding (digital or offline) | Applicant → Maker prices (select all currencies, one margin across the board, charges optional) → Compliance approves / returns / rejects; clarifications to the applicant; duplicate PAN/GSTIN flagged |
| DIR payment against an import bill | SME picks the bill (amount follows), books the rate for it, reviews, confirms → Maker → Checker or Operations → Operations: INR debited, UTR and MT103, bill settled, IDPMS report |
| LC settlement | As DIR, with the LC number and LC copy |
| AIR advance, then knock-off | Payment before the Bill of Entry; knocked off once the bill is lodged; Checker confirms |
| OTT services | Form 145 always; Form 146 above ₹5,00,000 INR equivalent |
| Inward reported by the SME | SME reports a buyer's payment (with the MT103 copy) → Operations confirms it against the nostro credit (or declines with a reason) → SME disposes |
| Disposal of export proceeds | Any part of a receipt, per instruction, under an RBI inward purpose code (P0102, P0103…): knock off bills, or credit as an advance; INR at a booked rate or EEFC in the receipt currency; one FIRC per instruction, reported to EDPMS |
| FIRC pending knock-off | Advance or unapplied part of a FIRC matched to export bills later; Checker confirms; reversible |
| Compliance | Every outward request and disposal scored on submission; High needs a written reason from maker and checker |
| Assisted journey | Sales, Maker or Operations raises for an SME; margin adjustable within the configured band; another maker verifies |
| Queries and rejections | Maker or Checker queries; the SME answers with documents — or AD2 records the customer's answer and documents for it; rejections release reservations |

## Test data lab

Seeded data runs out once it has been used. The lab (**Test data lab** for AD2, **Test data** for an SME) makes more:

- **Create a test business** from six profiles (Export, Import or Both, 3–4 currencies each) — approved, with
  verified INR and EEFC accounts, suppliers (including a watchlist test payee), accepted import and export bills,
  one bill waiting for the checker, and receipts ready to dispose; or as an application for onboarding review.
- **Add bills & receipts** to any business.
- **Park requests** — creates a DIR at Submitted, an LC at Verified, an AIR at Authorised and a disposal at Submitted,
  by running the real commands, so each role has something to act on.

The six test businesses are also created on every reset, and the named businesses carry bills and receipts that are
free to use from the start (Meridian's BL-24014/15/16, Arcadia's BL-24018, receipts IR-3308/09, a reported payment
IR-3310). There are two makers, two checkers, two compliance users and two operations users, so four-eyes never
blocks a walkthrough. The Administrator can switch the lab off.

## Purpose codes and documents

From the business team's **Purpose / Doc Policy** workbook (`public/data.js`): 111 approved purpose codes — the two
duplicated OTT rows (S0801, S0802) merged and descriptions tidied. LC was added on review.

| Product | Codes | Documents |
|---|---|---|
| AIR — Advance Import Remittance | 4 | Proforma Invoice |
| DIR — Direct Import Remittance | 6 | Transport Document, Commercial Invoice, Bill of Entry — settles an accepted import bill |
| LC — Letter of Credit Settlement | 5 | LC copy, Commercial Invoice, Transport Document; Bill of Entry optional |
| OTT — Miscellaneous Remittance | 110 | Invoice, Form 145 (was 15CA); Transport Document for goods-import codes; Form 146 (was 15CB) above ₹5,00,000 |
| TRADE — disposal instructions | RBI inward codes P0101–P0104, P0108, P0802, P0807, P1006, P1008 | Disposal Instruction Letter; Export Invoice and Shipping Bill when bills are knocked off |

The Administrator can stop a code being offered, add inward purposes, add or remove documents and change any rule.

## Architecture

```
public/            the app (static): app.html, js/*, styles.css, plus
  engine.js        every business rule — runs on the server; in the browser only for offline previews
  data.js          masters (purpose codes, products, documents, compliance rules, roles, test profiles) and seed data
api/*.js           Vercel serverless functions → server/app.js
server/app.js      /api/health, session, state, command, status, reset
server/auth.js     signed session tokens, scrypt passwords, sign-in throttling
server/store.js    Vercel Blob · JSON file locally · optimistic concurrency
server.js          local server: static files + API on one port
tests/             engine and API tests; e2e.js and qa.js browser suites
```

Every button posts a command to `/api/command`. The engine checks the role's capabilities, the four-eyes rule,
the document policy, the rate and margin band, balances and bill and FIRC reservations, scores compliance, then
writes the new state and an audit entry. Other users' screens poll every 8 seconds.

Without a reachable API — the screen-index previews, or `?mode=local` — the same engine runs in the page against
browser storage.

## Accounts

Demo accounts use the passcode **`demo`** (set `DEMO_PASSCODE` on a deployment to change it). A business registered
through the portal, or a user added with a password, signs in with its own password.

| Domain ID | Login ID | Role |
|---|---|---|
| MERIDIANTEX | SMEUSER | SME User — Import and Export |
| ARCADIACOMP | SMEUSER | SME User — Import only |
| NILGIRISPICE | SMEUSER | SME User — Export only |
| COASTALCASH, PUNEAUTO, MYSOREMACH, KERALACOIR, HYDPHARMA, DELHIDECOR | SMEUSER | Test businesses |
| HKTRADING | APPLICANT | SME Applicant — waiting on its IEC |
| ISHANICONS | APPLICANT | SME Applicant — priced, waiting on the checker |
| AD2 | SALES | AD2 Sales |
| AD2 | MAKER, MAKER2 | AD2 Maker |
| AD2 | CHECKER, CHECKER2 | AD2 Checker |
| AD2 | COMPLIANCE, COMPLIANCE2 | AD2 Compliance |
| AD2 | OPS, OPS2 | AD2 Operations |
| AD2 | ADMIN | AD2 Administrator |

## Deploying to Vercel

The project deploys as-is: `public/` is served statically and `api/` becomes serverless functions.

| Variable | Needed | Purpose |
|---|---|---|
| `BLOB_READ_WRITE_TOKEN` | Yes | Set automatically when a Vercel Blob store is connected to the project. Without it, state lives in function memory and can reset. |
| `SESSION_SECRET` | Recommended | Signs session tokens. Falls back to a value derived from the Blob token. |
| `DEMO_PASSCODE` | Optional | Replaces `demo` for the demo accounts and for **Reset demo data**. Set it before sharing a link publicly. |
| `STATE_PREFIX` | Optional | Blob path prefix, to run two demos from one store. |

## Security

- Signed, expiring session tokens; role, business and active status re-read from the stored login on every request.
- Salted scrypt password hashes that never leave the server; sign-in throttling; deactivated users are refused.
- An SME session receives only its own records. Compliance scores, reviewer reasons, internal notes, duplicate
  checks, pricing remarks, margins and reference rates are stripped for SME users — the customer gets its own rates
  ready-made; the sign-in list shows only shared demo accounts. FX deal references are applied by AD2 only.
- The browser never replaces its state with an older copy (each state carries a seeding epoch and a revision that
  continues across resets), and public Blob reads bypass the CDN cache, so a lagging server instance cannot make an
  action look undone. Reset overwrites the store unconditionally.
- Server-side validation of every field; booked rates recomputed on the server; deal rates held within 3% of
  reference; assisted margins held within the configured band.
- Content Security Policy with no inline or third-party script, HSTS, nosniff, frame-ancestors self.

## Not in scope yet

The FX quotation formula (treasury), transaction limits (risk), real sanctions and UFI connectivity, SFTP and SAP
contracts, document storage and retention, SME-side maker-checker, and a relational database in place of the
single-document store. The PRD in `public/docs/` lists the open decisions.
