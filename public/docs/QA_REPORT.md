# AD2 Trade Remittance — QA report

28 September 2026 · run with `npm run test:qa` (rerun any time; it writes a fresh `qa-report.md`)

**Result: all 45 journeys pass, 198 checks.** Also green: 63 engine, treasury, treasury-portal and API tests
(`npm test`) and the guided journey through both portals (`npm run test:e2e`). Every journey is driven through the real
screens as the role that does it, on a server, with a different person at each approval stage. Nine journeys run in the
Treasury Management Portal and across the two portals.

## Master test user

**Domain ID `TEST`, Login ID `MASTER`, passcode `demo`** is the first account on the sign-in page. It opens a
**test console**:
- **Start a journey:** ten common journeys, and eight in the treasury portal, each opened as the right person.
- **Waiting in treasury:** approvals and branch deals waiting on a bill, each with someone eligible to act.
- **Waiting on AD2 / Waiting on a customer:** every open item, its next step, and a button that opens the platform as
  someone who can take that step.
- **Open the platform as:** every customer, applicant and AD2 user, one click each, with no password.
- **Latest activity**, including each switch you make.

While testing, a dark bar on every page shows who you are and the next step on the item in front of you. It offers
**Do it as …** for the next person, and never someone who already handled the item. A payment goes customer → maker
→ checker → operations in four clicks. An online registration goes applicant → maker → Compliance. The bar also
has **Open as…** to jump to anyone, and **Test console** to go back.

The master cannot approve anything itself. The server gives it the chosen user's own session, so every step is
recorded against that user and four-eyes holds. Journey 31 below, and new engine and API tests, prove this.


## Treasury Management Portal (28 Sep)

The treasury portal (`/treasury/`) is the TMP design built out on the same platform as the trade portal. What the
QA journeys prove, across the two portals:

| Where | What is checked |
|---|---|
| Trade → treasury | A customer's booking is on the treasury book the moment it is made, at its home branch (Mumbai Fort for a Maharashtra GSTIN), as an outward remittance from the trade portal; a rate the checker publishes afterwards leaves it unchanged, while new bookings take the new base |
| Rate desk gates quoting | A card rate that is not published cannot be quoted (the form says so); the dealer proposes the missing rates, a second checker publishes them, and quoting opens |
| Branch counter | First quote takes the stepped review; booking needs the review ticked; a bill with the position reference links itself; the rest is knocked off; the deal concludes and USD 2,000 leaves the branch's stock |
| Cut-off | Keeping a deal needs a reason; cancelling releases the residual and its cover |
| Cover | A spot deal is live when saved and pays the INR from its settlement account; over-allocation is flagged at once and confirm is disabled |
| Treasury → trade | A branch quote for a trade customer becomes an FX deal reference that Sales applies to the customer's payment in the trade portal; the UTR concludes the treasury position and the USD Nostro falls by the payment |
| Limits | A tightened limit (maker, then checker) makes the next booking held; the customer sees it held; a second checker releases it |
| Approvals | A rejection needs a reason; the maker resubmits as version 2; exceptions resolve with notes; an internal cross; P&L shows sales margin and dealing result apart |
| Who sees what | Trade staff have no treasury screens and are turned back by the treasury portal; a branch sees only its branch without base rates or approvals; an agent only its own deals; a customer never the base or card rate |

Also checked in a browser: every treasury screen opens without error for every persona (dealer, checker, viewer,
branch, agent, regional bulk, finance, administrator, master); the portal works in local mode, at phone width with no
horizontal scroll, and in the screen index's previews.

## What the 24 Sep review found, and what changed

| Reported | Cause | Fix |
|---|---|---|
| The customer can see the margin | Margin and reference rate were shown in the rate box, pricing summary, request detail, profile, charges report and activity feed, and sent in the customer's data | Removed from every customer screen and stripped from the customer's data; it receives its own rates ready-made. AD2 still sees them, marked "AD2 only" |
| "Enter FX deal" offered to the customer | Deal reference was open to the SME | Only AD2 (Sales, Maker, Operations) applies a deal reference; the server refuses one from a customer |
| Book rate does not say how much is being converted | Rate box showed only the rate | Rate card shows the foreign currency amount, the rate and the INR; the booking is for that amount and is released if the amount changes |
| Bill shows "Available 0"; only one bill offered | Meridian's only accepted Filatura bill was fully held by an in-flight request (OR-5103); the table gave no reason | Bills picked from a dropdown with bill amount and what is free, and which request holds the rest; bills come before the rate and the amount follows them; seed now has free bills for every business |
| Purpose code should work like a search | Select list with a separate filter | Type a code or words ("freight", "consultancy") and pick from the matches |
| "Request not found" after submit; "submit instruction… goes off"; actions not reflecting; reset not working | On the deployment a lagging server instance or CDN copy could send the browser an older state, undoing what was just done | The browser never accepts an older state; the server re-reads when the caller is ahead; public Blob reads bypass the CDN; reset overwrites the store |
| Buttons "not working" | Clicking a button right after typing an amount re-rendered the page mid-click and the browser dropped the click; "Book rate" also stayed disabled until the field lost focus | The interrupted click is replayed; "Book rate" is always clickable and explains if the amount is missing |
| No confirmation screen | Submit went straight to the list or detail | Review step before sending; confirmation screen with the reference, where it is and what happens next |
| Inward purpose of remittance missing | Only "TRADE" was offered | RBI inward purpose codes (P0102 by default, P0103 for an advance), searchable |
| No "new inward" for the customer; odd "Dispose" first button | Inward only started from AD2 recording a credit | "New inward remittance": dispose of a receipt, or report a buyer's payment that Operations confirms or declines; dashboard actions are New outward, New inward, Lodge a bill, Knock off |
| Knock-off amounts do not update | Panes ignored allocations being built | Panes subtract allocations as they are added and drop fully used items |
| Trade operations cannot accept and process | Operations could only release | Operations can authorise, accept bills and confirm knock-offs as well as release and credit — never authorising and releasing the same request |
| Same person approves customers and transactions | One checker did both | Branch maker common to both; new **AD2 Compliance** approves customers; **Checker or Operations** approves money |
| Menus look the same for every role | Shared menu labels | Each menu names the role's work ("Verify payments", "Receipts to confirm") and opens a filtered list with a count |
| Maker or checker should upload the customer's clarification | Only the SME could answer a query | Maker, Checker or Operations can answer for the customer with the documents it sent in |
| Onboarding pricing: select all currencies, one margin, charges optional | One currency at a time; a charge was mandatory | Select all, one margin across the board, per-currency override; charges optional |
| Outstanding bills lack the gross amount; aging blank; FIRC not downloadable; UFI knock-off not shown | — | Bill amount beside outstanding; aging lists every open bill, receipt and FIRC; FIRC downloads from the report; "UFI portal updated" on realised bills |
| Offline onboarding: could not sign in as the new business | Credentials were not shown | Sales / Maker see the Domain ID and Login ID after capturing an offline application |

## Journeys run

| # | Area | Journey | Who acts | Checks |
|---|---|---|---|---|
| 1 | Roles | Each role has its own menu of the work it does, and every screen renders | All | 11 |
| 2 | Roles | Four-eyes and segregation are enforced by the server, not just the screen | Maker, Checker, Compliance, Ops, Admin, SME | 6 |
| 3 | Customer | The customer never sees AD2’s margin or a deal-reference box | SME | 12 |
| 4 | Outward | DIR: pick the bill, amount follows, book the rate for it, review, confirm — then maker, checker, operations | SME → Maker → Checker → Ops | 13 |
| 5 | Outward | Pay part of a bill; the rest stays free; a rejection releases the reservation | SME → Maker → Checker | 3 |
| 6 | Outward | LC to a watchlist beneficiary scores High; Operations authorises, a second operations user releases | SME → Maker → Ops → Ops2 | 5 |
| 7 | Outward | AIR advance, then its Bill of Entry by document AI, then a knock-off that updates the balances as you go | SME → Maker → Checker → Ops → SME → Ops → SME → Checker | 8 |
| 8 | Outward | OTT: type a word to find the purpose code; Form 146 appears above ₹5 lakh | SME | 3 |
| 9 | Outward | Save a draft, continue it later and submit | SME | 2 |
| 10 | Outward | Query: the maker asks, the SME answers with a document, another maker verifies | Maker → SME → Maker2 | 2 |
| 11 | Outward | Query answered by AD2 for the customer, with the documents it sent in | Maker (for SME) → Maker2 → Checker → Ops | 3 |
| 12 | Outward | Release a payment already authorised (seeded) and see the account debited | Ops | 2 |
| 13 | Inward | SME reports a buyer’s payment; Operations confirms it; the SME disposes of it; FIRC issued and downloadable | SME → Ops → SME → Maker → Checker → Ops | 6 |
| 14 | Inward | Partial disposal: part against a bill, the rest as an advance — two FIRCs; the advance is knocked off later | SME → Maker → Checker → Ops → SME → Checker2 | 5 |
| 15 | Inward | Advance receipt credited now, knocked off against the export bill later; a reversal restores it | SME → Maker → Checker → Ops → SME → Checker → Ops | 5 |
| 16 | Inward | Credit to an EEFC account: foreign currency, no conversion, no rate | SME → Maker → Checker → Ops | 2 |
| 17 | Inward | Operations records a credit; the SME starts the disposal from “New inward remittance” | Ops → SME → Maker → Checker → Ops | 2 |
| 18 | Inward | Operations cannot match a reported payment and tells the SME why | SME → Ops | 1 |
| 19 | Assisted | Treasury issues a deal; Sales applies it to a customer payment; Ops authorises, Ops2 releases | Dealer → Sales (for SME) → Maker → Ops → Ops2 | 5 |
| 20 | Assisted | Maker disposes of a receipt on the customer’s behalf from the AD2 inward list | Maker (for SME) → Maker2 → Checker → Ops | 3 |
| 21 | Assisted | Sales lodges an export bill for a customer; the checker accepts it | Sales (for SME) → Checker | 1 |
| 22 | Treasury | Trade → treasury: a customer’s booking is a position on the treasury book at its branch at once; a rate published after it does not change it | SME → Dealer → Treasury checker → SME | 10 |
| 23 | Treasury | The rate desk gates quoting: a card rate that is not published cannot be quoted until a checker publishes it | Branch → Dealer → Treasury checker 2 → Branch | 5 |
| 24 | Treasury | Branch counter: quote, stepped review, book; the FX Plus bill links back on punch; knock off the rest; concluded and stock moves | Branch (Delhi CP) | 7 |
| 25 | Treasury | Cut-off: keep one deal past cut-off with a reason, cancel another — its residual and cover go back to the pool | Branch (Mumbai Fort) | 4 |
| 26 | Treasury | Cover: a spot deal is live when saved and pays from its settlement account; over-allocation is blocked; then allocated | Dealer | 4 |
| 27 | Treasury | Treasury → trade: a branch quote for a trade customer becomes an FX deal AD2 applies to the payment; the UTR concludes it and moves the Nostro | Dealer → Branch → Sales (for SME) → Maker → Checker → Ops → Dealer | 4 |
| 28 | Treasury | Limits: a trade booking over the customer’s treasury limit is held until a treasury checker releases it | Dealer → Treasury checker → SME → Treasury checker 2 | 4 |
| 29 | Treasury | Approvals, exceptions, an internal cross and P&L — reasons are mandatory and a rejected entry is resubmitted as a new version | Dealer → Treasury checker → Dealer | 5 |
| 30 | Treasury | Who sees what across the two portals: trade staff, branch, agent, customer and the public | Maker, Branch, Agent, SME, signed out | 10 |
| 31 | Bills | CSV upload keeps failed rows; a query on a bill is answered for the customer; Operations accepts | SME → Checker → Maker (for SME) → Ops | 3 |
| 32 | Onboarding | Digital: register, maker prices (select all, one margin, no charge), Compliance approves, the business trades | Applicant → Maker → Compliance → SME | 6 |
| 33 | Onboarding | Offline by Sales: credentials shown; Compliance returns it; the maker reprices; a second Compliance user approves | Sales → Maker → Compliance → Maker → Compliance2 | 2 |
| 34 | Onboarding | Clarification: the applicant supplies its IEC; the maker prices; Compliance approves | Applicant → Maker → Compliance | 1 |
| 35 | Onboarding | Compliance rejects an application; the applicant can no longer sign in | Compliance | 1 |
| 36 | Onboarding | A duplicate PAN is flagged to the maker | Applicant → Maker | 1 |
| 37 | Admin | Administrator adds a Compliance user and changes the controls; the audit log records it | Admin | 3 |
| 38 | Reports | Reports: bill amount beside outstanding, aging with rows, UFI status, FIRC downloads, CSV export | SME, Ops | 5 |
| 39 | Lab | Test data lab: a new business with parked requests that carry on through the real workflow | Maker, Ops | 2 |
| 40 | Testing | Master test user: one sign-in; “Do it as …” carries a payment through every stage, never to someone who already handled it | Master → SME → Maker → Checker → Ops | 13 |
| 41 | Platform | Type an amount and click straight away: the first click counts | SME | 2 |
| 42 | Platform | The browser never goes back to an older copy of the state | Any | 1 |
| 43 | Platform | Phone width: drawer navigation, no horizontal scroll | SME | 1 |
| 44 | Platform | A half-filled registration survives a reload | Applicant | 1 |
| 45 | Platform | Reset demo data restores the starting data for everyone | Any | 3 |

## Try it yourself

Sign in as **TEST / MASTER** (passcode **demo**). On the console, click **Start as Kavita Raghunathan** under *Pay a
supplier against a bill*. Choose DIR, pick BL-24014 from the dropdown, book the rate, review and confirm. Then click
**Do it as …** in the dark bar three times: the maker verifies, the checker authorises and Operations releases.

To sign in as each role separately instead, use the passcode **demo** with:
- **MERIDIANTEX / SMEUSER**, **AD2 / MAKER**, **AD2 / CHECKER** and **AD2 / OPS** for payments;
- **NILGIRISPICE / SMEUSER** for inward; its reported payment waits for **AD2 / OPS** under Receipts to confirm;
- **AD2 / COMPLIANCE** for onboarding approvals;
- **AD2 / DEALER**, **AD2 / TCHECKER** and **AD2 / BRANCH** for the treasury portal (`/treasury/`) — signing in as any of them from either portal lands there.

## Decisions taken

- **Role names.** Kept as built. *AD2 Compliance* approves customers; *AD2 Checker* or *AD2 Operations* approves
  money, matching the 24 Sep call ("onboarding checker will be different and bill checker will be an operational
  role"). If the bank uses other titles, renaming means changing the role in `public/data.js` and where the
  menus and queues refer to it.
- **Assisted journey.** Kept inside the customer's portal, with the banner and the "Done — back to my AD2
  workspace" button. It reuses the same screens and checks the customer uses, so there is one form to maintain.
  The master test user now covers the "act as someone else" testing need.
- **Deployment storage (action for the project owner).** The store is Supabase Postgres, in Mumbai next to the
  functions. Vercel Blob is no longer recommended: it is charged per operation, and this app's constant writes and
  polls would use up a free plan's allowance. Setup takes four steps (README → *Connect the database*): create the
  Supabase project from Vercel's Storage tab, run `supabase/schema.sql`, redeploy, and check `/api/health` shows
  `"store":"supabase"`. Until then, each server instance keeps its own copy of the data, so a step can seem to vanish
  or a reset seem not to take.
