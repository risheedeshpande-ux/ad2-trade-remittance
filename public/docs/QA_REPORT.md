# AD2 Trade Remittance — QA report

25 September 2026 · run with `npm run test:qa` (rerun any time; it writes a fresh `qa-report.md`)

**Result: all 36 journeys pass, 144 checks.** Also green: 28 engine and API tests (`npm test`) and the 18-step guided
journey (`npm run test:e2e`). Every journey is driven through the real screens as the role that does it, on a server,
with a different person at each approval stage.

## Master test user

**Domain ID `TEST`, Login ID `MASTER`, passcode `demo`** is the first account on the sign-in page. It opens a
**test console**:
- **Start a journey:** ten common journeys, each opened as the right person.
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
| 3 | Customer | The customer never sees AD2's margin or a deal-reference box | SME | 12 |
| 4 | Outward | DIR: pick the bill, amount follows, book the rate for it, review, confirm, then maker, checker, operations | SME → Maker → Checker → Ops | 13 |
| 5 | Outward | Pay part of a bill; the rest stays free; a rejection releases the reservation | SME → Maker → Checker | 3 |
| 6 | Outward | LC to a watchlist beneficiary scores High; Operations authorises, a second operations user releases | SME → Maker → Ops → Ops2 | 5 |
| 7 | Outward | AIR advance, its Bill of Entry by document AI, then a knock-off that updates the balances as you go | SME → Maker → Checker → Ops → SME → Ops → SME → Checker | 8 |
| 8 | Outward | OTT: type a word to find the purpose code; Form 146 appears above ₹5 lakh | SME | 3 |
| 9 | Outward | Save a draft, continue it later and submit | SME | 2 |
| 10 | Outward | Query: the maker asks, the SME answers with a document, another maker verifies | Maker → SME → Maker2 | 2 |
| 11 | Outward | Query answered by AD2 for the customer, with the documents it sent in | Maker (for SME) → Maker2 → Checker → Ops | 3 |
| 12 | Outward | Release a payment already authorised and see the account debited | Ops | 2 |
| 13 | Inward | SME reports a buyer's payment; Operations confirms it; the SME disposes; FIRC issued and downloadable | SME → Ops → SME → Maker → Checker → Ops | 6 |
| 14 | Inward | Partial disposal: part against a bill, the rest as an advance, two FIRCs; the advance knocked off later | SME → Maker → Checker → Ops → SME → Checker2 | 5 |
| 15 | Inward | Advance receipt credited now, knocked off later; a reversal restores it | SME → Maker → Checker → Ops → SME → Checker → Ops | 5 |
| 16 | Inward | Credit to an EEFC account: foreign currency, no conversion | SME → Maker → Checker → Ops | 2 |
| 17 | Inward | Operations records a credit; the SME starts the disposal from "New inward remittance" | Ops → SME → Maker → Checker → Ops | 2 |
| 18 | Inward | Operations cannot match a reported payment and tells the SME why | SME → Ops | 1 |
| 19 | Assisted | Sales books a payment for a customer at a branch margin with a treasury deal | Sales (for SME) → Maker → Ops → Ops2 | 4 |
| 20 | Assisted | Maker disposes of a receipt on the customer's behalf | Maker (for SME) → Maker2 → Checker → Ops | 3 |
| 21 | Assisted | Sales lodges an export bill for a customer; the checker accepts it | Sales (for SME) → Checker | 1 |
| 22 | Bills | CSV upload keeps failed rows; a bill query is answered for the customer; Operations accepts | SME → Checker → Maker (for SME) → Ops | 3 |
| 23 | Onboarding | Digital: register, maker prices (select all, one margin, no charge), Compliance approves, the business trades | Applicant → Maker → Compliance → SME | 6 |
| 24 | Onboarding | Offline by Sales: credentials shown; Compliance returns it; the maker reprices; a second Compliance user approves | Sales → Maker → Compliance → Maker → Compliance2 | 2 |
| 25 | Onboarding | Clarification: the applicant supplies its IEC; the maker prices; Compliance approves | Applicant → Maker → Compliance | 1 |
| 26 | Onboarding | Compliance rejects an application; the applicant can no longer sign in | Compliance | 1 |
| 27 | Onboarding | A duplicate PAN is flagged to the maker | Applicant → Maker | 1 |
| 28 | Admin | Administrator adds a Compliance user and changes the controls; the audit log records it | Admin | 3 |
| 29 | Reports | Bill amount beside outstanding, aging with rows, UFI status, FIRC downloads, CSV export | SME, Ops | 5 |
| 30 | Lab | A new test business with parked requests that carry on through the real workflow | Maker, Ops | 2 |
| 31 | Testing | Master test user: one sign-in; “Do it as …” carries a payment through every stage, never to someone who already handled it | Master → SME → Maker → Checker → Ops | 13 |
| 32 | Platform | Type an amount and click straight away: the first click counts | SME | 2 |
| 33 | Platform | The browser never goes back to an older copy of the state | Any | 1 |
| 34 | Platform | Phone width: drawer navigation, no horizontal scroll | SME | 1 |
| 35 | Platform | A half-filled registration survives a reload | Applicant | 1 |
| 36 | Platform | Reset demo data restores the starting data for everyone | Any | 3 |

## Try it yourself

Sign in as **TEST / MASTER** (passcode **demo**). On the console, click **Start as Kavita Raghunathan** under *Pay a
supplier against a bill*. Choose DIR, pick BL-24014 from the dropdown, book the rate, review and confirm. Then click
**Do it as …** in the dark bar three times: the maker verifies, the checker authorises and Operations releases.

To sign in as each role separately instead, use the passcode **demo** with:
- **MERIDIANTEX / SMEUSER**, **AD2 / MAKER**, **AD2 / CHECKER** and **AD2 / OPS** for payments;
- **NILGIRISPICE / SMEUSER** for inward; its reported payment waits for **AD2 / OPS** under Receipts to confirm;
- **AD2 / COMPLIANCE** for onboarding approvals.

## Decisions taken

- **Role names.** Kept as built. *AD2 Compliance* approves customers; *AD2 Checker* or *AD2 Operations* approves
  money, matching the 24 Sep call ("onboarding checker will be different and bill checker will be an operational
  role"). If the bank uses other titles, renaming means changing the role in `public/data.js` and where the
  menus and queues refer to it.
- **Assisted journey.** Kept inside the customer's portal, with the banner and the "Done — back to my AD2
  workspace" button. It reuses the same screens and checks the customer uses, so there is one form to maintain.
  The master test user now covers the "act as someone else" testing need.
- **Deployment storage (action for the project owner).** Connect a Vercel Blob store to the project: Storage →
  Create → Blob, private access, then connect it to *ad2-trade-remittance* for Production and Preview. Vercel sets
  `BLOB_READ_WRITE_TOKEN` itself, and the code picks it up with no change. Until then, each server instance keeps its
  own copy of the data, so a step can seem to vanish or a reset seem not to take. `/api/health` reports
  `"store":"blob"` once it is connected.
