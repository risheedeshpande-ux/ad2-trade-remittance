# AD2 Trade Remittance

A working product demo of the AD2 trade-remittance platform: the SME portal, the AD2 operations portal behind it,
and the treasury desk that manages the currency. Onboard a partner, then take payments and export receipts through
sales, maker, checker and operations to a UTR and a FIRC — with every rule enforced by a server, not just the screen.
Customers book the live rate and never see AD2's margin. Every booking is a treasury position the moment it is made:
treasury covers it from a bank or crosses it against an opposite booking, and the payment or FIRC settles it.

**Every business and transaction is fictional.** FX rates, SWIFT, PennyDrop, sanctions screening, UFI (EDPMS/IDPMS)
reporting, SFTP, SAP and document AI are simulated. Uploads record only the file name and size; file contents never
leave the browser.

## Run it

```bash
npm install
npm start            # http://localhost:8130 — state in .data/state.json
```

**To test everything with one sign-in, use the master test user: Domain ID `TEST`, Login ID `MASTER`, passcode `demo`.**
It opens a test console with:
- every open item, its next step and who can take it;
- journeys to start;
- every customer and AD2 user, each one click away with no password.

While you test, a dark bar at the top follows the item you are on. It shows what happens next and offers
**Do it as …** for the next person. It never offers someone who has already handled the item, so four-eyes still applies.

The master holds no authority itself. The server hands it the other user's own session, so every step is recorded
against that user. Each switch is written to the audit log. Switch it off with **Test tools** in Platform settings.

Or click **Demo guide** in the yellow bar. It walks one new business through 21 steps, treasury included, and signs in as the right
person at each one. To create more test data, open **Test data lab** from the sidebar.

```bash
npm test             # engine and API tests
npm run test:e2e     # the guided journey in a real browser, on a throwaway server
npm run test:qa      # 40 journeys across every role and product, treasury included; writes qa-report.md (see tests/qa.js)
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
| AD2 Treasury Dealer | Desk · Dealing · Book · Insight | Rate desk proposals, bank cover deals, allocation and internal crosses, FX deal references, exceptions, P&L — no trade authority |
| AD2 Treasury Checker | Desk · Approvals · Book · Insight | Approves rate revisions and cover deals, never its own — no dealing or trade authority |
| AD2 Administrator | Configuration · Access · Oversight · Treasury | Purpose codes, documents, compliance rules, users, settings, audit; treasury read-only — no transaction authority |

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
| Rate booking → treasury | SME (or AD2 for it) books the rate → a treasury position opens at once → submitting attaches it (the rate is fixed) → the UTR or FIRC settles it; release, rejection or the 48-hour expiry cancels it |
| Cover | Dealer enters a bank cover deal → Treasury checker approves → dealer allocates it to positions (or crosses opposite bookings) |
| Rate desk | Dealer proposes revised reference rates (within the band) → Treasury checker approves → new bookings use them; existing bookings keep theirs |
| FX deal reference | Dealer issues a deal for a customer (the position opens) → the branch applies it to one request, up to its amount |
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

## Treasury

The treasury module (`public/treasury.js`) is the trade side's treasury management system, built from the TMP design
(`risheedeshpande-ux/r4m`, `TMP/WORKFLOW.md`). Sign in as **AD2 / DEALER** or **AD2 / TCHECKER**.

- **One idea it rests on:** a position has two independent tracks — *settlement* (has the payment or FIRC gone out?)
  and *cover* (has treasury offset it?). They are separate columns everywhere.
- **Bookings are positions.** Booking a rate is a server command (`rate.book`) that opens a position holding the rate.
  A request points at it, so the rate cannot move between booking and submitting, whatever the rate desk publishes.
  An outward payment is a sale of foreign currency (treasury short); a disposal credited in INR is a purchase (long);
  a credit to EEFC converts nothing and opens no position.
- **The lock and the cut-off.** A booking holds its rate for 48 hours (agreed in the 22 Sep review). Submitting freezes
  it. At the daily cut-off (16:00 IST, set by the Administrator) any currency not flat is flagged — nothing is cancelled.
- **Cover** is per currency, net: customer sales and purchases in one currency can cross each other internally; the rest
  is bought or sold from a bank (entered by a dealer, approved by a treasury checker, allocated to positions).
- **P&L**, in rupees and never mixed: *sales margin* (customer rate vs the reference at booking) and *dealing result*
  (reference vs the cover rate, or vs the market for what is still open).
- **Simulated market.** Rates drift gently and repeatably so the desk moves in a demo; switch it off in Platform settings.
- **Integration contract.** Trade tells treasury four things — `position.opened`, `.attached`, `.linked`, `.cancelled` —
  written in the same step as the trade action and listed on the Integration log. A separate treasury system would
  subscribe to exactly these.
- **Who sees what.** Treasury roles see the whole book; the Administrator and master test user see it read-only; the
  branch sees positions and whether they are covered (no cover rates or P&L) and the deals it may apply; a customer sees
  its own bookings without the reference rate; a signed-out visitor sees no rates at all.

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
  treasury.js      the treasury module: positions, rate desk, cover, crosses, deals, P&L — loaded by engine.js
  data.js          masters (purpose codes, products, documents, compliance rules, roles, test profiles) and seed data
api/*.js           Vercel serverless functions → server/app.js
server/app.js      /api/health, session, state, command, status, reset
server/auth.js     signed session tokens, scrypt passwords, sign-in throttling
server/store.js    Supabase Postgres (or Vercel Blob) · JSON file locally · optimistic concurrency
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
| TEST | MASTER | **Master test user** — opens the platform as anyone (see *Run it*) |
| MERIDIANTEX | SMEUSER | SME User — Import and Export |
| ARCADIACOMP | SMEUSER | SME User — Import only |
| NILGIRISPICE | SMEUSER | SME User — Export only |
| COASTALCASH, PUNEAUTO, MYSOREMACH, KERALACOIR, HYDPHARMA, DELHIDECOR | SMEUSER | Test businesses |
| HKTRADING | APPLICANT | SME Applicant — waiting on its IEC |
| ISHANICONS | APPLICANT | SME Applicant — priced, waiting on Compliance |
| AD2 | SALES | AD2 Sales |
| AD2 | MAKER, MAKER2 | AD2 Maker |
| AD2 | CHECKER, CHECKER2 | AD2 Checker |
| AD2 | COMPLIANCE, COMPLIANCE2 | AD2 Compliance |
| AD2 | OPS, OPS2 | AD2 Operations |
| AD2 | DEALER, DEALER2 | AD2 Treasury Dealer |
| AD2 | TCHECKER, TCHECKER2 | AD2 Treasury Checker |
| AD2 | ADMIN | AD2 Administrator |

## Deploying to Vercel

The project deploys as-is: `public/` is served statically and `api/` becomes serverless functions in Mumbai (`bom1`).

### Connect the database (once)

The live site needs one shared store. Without one, each serverless instance keeps its own copy and actions can seem
to vanish. Use **Supabase** (Postgres):

1. **Create the project in Mumbai.** In Vercel: *ad2-trade-remittance* → **Storage** → **Create Database** →
   **Supabase**, region **Mumbai**, connected to Production and Preview. Vercel adds `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` itself. Mumbai matters: the functions run there, so the database should too.
   *Already have a Supabase account?* Create the project there instead, again in Mumbai. Then copy the Project URL and
   the `service_role` (or secret) key from **Project Settings → API**, and add them to Vercel as `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY`.
2. **Create the table.** Open the project in Supabase → **SQL Editor** → paste [`supabase/schema.sql`](supabase/schema.sql)
   → **Run**. It creates one table with row-level security on, so only the server's key can reach it.
3. **Redeploy.** Vercel → Deployments → the latest → **Redeploy**.
4. **Check.** `https://<your site>/api/health` shows `"store":"supabase","storeOk":true`. If something is off, the
   yellow bar on the site says what: for example, that the table is missing or the key is the public one.

**Why Supabase.** It is real Postgres, so the single state row can grow into proper tables. Its Storage can later hold
the uploaded documents, which today record only a file name. The app reaches it over HTTPS with no driver to install.
Polls ask only for a version stamp and fetch the ~150 KB state only when it changed. A free Supabase project pauses
after a week without activity, so Vercel pings `/api/health` daily (`crons` in `vercel.json`) to keep it awake.

**Vercel Blob** also works (`BLOB_READ_WRITE_TOKEN`), but it is no longer recommended. Blob is file storage charged
per operation. This app writes on every action and re-reads every few seconds while anyone has it open, which uses
up a free plan's monthly allowance quickly.

| Variable | Needed | Purpose |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Yes | The database. Set by the Vercel Supabase integration. `SUPABASE_SECRET_KEY` (a newer `sb_secret_…` key) works in place of the service role key. Server-side only; never sent to a browser. |
| `SESSION_SECRET` | Recommended | Signs session tokens. Falls back to a value derived from the store's key. |
| `DEMO_PASSCODE` | Optional | Replaces `demo` for the demo accounts, the master test user and **Reset demo data**. Set it before sharing a link publicly. |
| `STATE_PREFIX` | Optional | The row (Supabase) or path (Blob) the state is kept under, to run two demos from one store. Preview deployments default to `ad2-trade-preview`, so a preview never reseeds production's row; set it locally too if you run with production's keys. |
| `STATE_STORE` | Optional | `supabase`, `blob`, `file` or `memory`, when more than one is configured. |
| `BLOB_READ_WRITE_TOKEN` | Alternative | Vercel Blob instead of Supabase (see above). |

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
- The Supabase table has row-level security on and no policy for the public or signed-in roles; only the server's
  service role key, held in a Vercel environment variable, can read or write it.
- Content Security Policy with no inline or third-party script, HSTS, nosniff, frame-ancestors self.
- The master test user (TEST / MASTER) signs in with the demo passcode and can open **any** user. That includes
  businesses that registered with their own password. It is a test tool. Set `DEMO_PASSCODE` before sharing a link,
  or switch off **Test tools** in Platform settings for a deployment that holds real sign-ins. It never gains
  authority of its own: it receives the chosen user's session, and each switch is audited.

## Not in scope yet

The FX quotation formula and a live rate feed (the market is simulated), counterparty bank credit lines on cover deals,
forward covers, transaction limits (risk), real sanctions and UFI connectivity, SFTP and SAP contracts, document storage
and retention, SME-side maker-checker, and a relational database in place of the single-document store. The PRD in
`public/docs/` lists the open decisions.
