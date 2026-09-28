# AD2 Trade Remittance Platform — Product Requirements

Version 1.4 · 25 September 2026
Source: AD2 Trade Remittance BRD v1.0, requirements call of 22 September 2026, the product reviews of 22–23 and 24 September 2026, and the live Remit4Me operations platform (uat1.remit4me.com).

---

## 1. What this describes

An SME trade-remittance portal operated by AD2, plus the AD2-side operations portal that approves and processes it. The scope is outward remittance, inward remittance with disposal instructions, import and export bill lodgement, and knock-off of bills against remittances.

The deliverable this document specifies is an interactive frontend prototype with fictional data. Authentication, payment execution, document storage, FX quotes, SFTP and SAP connectivity are simulated.

The prototype reuses the visual system of the existing Remit4Me operations platform so that AD2 Trade reads as a module of the same product rather than a separate application.

---

## 2. Changes from the BRD

The requirements call revised the BRD in ten places (C1–C10); two further changes (C11–C12) came from the follow-up the same day. Where any of these disagree with the BRD, the later decision governs.

| # | Area | BRD position | Decision |
|---|---|---|---|
| C1 | Onboarding category | Category selectable | Defaults to SME. No manual selection. |
| C2 | Identification field | "Identifiers" step | Renamed **Domain**. AD2 name auto-populated; Domain ID generated from the entity name. |
| C3 | Partner ID | Implied on form | Removed from the form. Mapped in the backend. |
| C4 | Constitution | Partnership, Proprietorship, Private Limited, Public Limited | Adds **HUF** and **Individual**. |
| C5 | IEC | Not specified | Mandatory for all regular transacting customers. GST is not offered as an alternative on this form. |
| C6 | Outward document list | One checklist for all purposes | Checklist is **driven by purpose code**. A single shared list is a defect. |
| C7 | Outward fields | Principal Debit Account, Fee Account, Transport Document Number, Transfer Reference | All four removed. Replaced by one optional free-text **Reference Number**. |
| C8 | FX | Illustrative quote, no booking | Live rate with a **Book Rate** action, locked 48 hours, no bank approval step. Negotiated deals are captured by entering an **FX Deal Reference**. Applies to outward and inward. |
| C9 | Disposal instruction | Full disposal option list incl. trade finance | Reduced to two decisions: the outstanding export bill to knock off, and the bank account to credit. Trade-finance disposal (LC, collections) is out of scope. |
| C10 | Bill lodgement | Part of the transaction flow | A module in its own right, with export and import lodgement as separate entries in the customer menu. |
| C11 | Remittance classification | Purpose code only, outward only | **Remittance type** is captured alongside the purpose code, on outward *and* inward, including on the disposal instruction. Type narrows the purpose codes on offer and can add documents of its own. |
| C12 | AD2 transacting | SME initiates; AD2 reviews | AD2 can **transact on behalf of an SME**, picked from the SME Directory. |
| C13 | Partial disposal | Instruction consumed the whole receipt | The SME chooses the **amount to dispose** on each instruction; the balance stays on the receipt for later instructions. Each instruction gets its own FIRC. |
| C14 | Disposal option | Bills only (C9) | Two options: **knock off against export bills**, or **credit as advance** and knock off later. Any part of an instruction not applied to bills is tracked as a **FIRC pending knock-off**. |
| C15 | Inward purpose | None collected | The SME declares a purpose on each disposal. The workbook names **TRADE**; the Administrator can add more. |
| C16 | EEFC | INR credit only | Proceeds may be credited to an **EEFC account in the receipt currency**, with no conversion and no rate. |
| C17 | UFI | Manual EDPMS/IDPMS knock-off | Every confirmed or reversed bill match, and every FIRC, is reported to IDPMS/EDPMS through RBI's Unified Portal (**UFI**) — simulated, with a report reference on the record. |
| C18 | LC | Out of scope (C9) | **LC settlement** added as an outward remittance type, with the LC number and LC copy. |
| C19 | Compliance | Screening only | Every outward request and disposal is **scored** on configurable rules; High needs a written reason from maker and checker. FEMA and sanctions **declarations** are required on submission. |
| C20 | Sales assist | Maker transacts on behalf | An **AD2 Sales** role raises requests for its customers; a maker verifies and a checker authorises. In an assisted journey the margin may be set within a configurable **band** below the approved margin. |
| C21 | Workspaces | One AD2 menu for every role | Each role gets its **own sidebar and dashboard**; the sidebar collapses to an icon rail. |
| C22 | Test data | Seed only | A **test data lab** creates businesses, bills, receipts and parked requests on demand, so any journey can be repeated. |
| C23 | Customer pricing | Margin shown in pricing | The **customer never sees AD2's margin** or the reference rate — not in the rate box, the summary, details, the profile, reports or activity, and not in the data its session receives. It sees its own rate, the foreign currency amount and the INR. |
| C24 | FX deal reference | SME may enter a deal reference (C8) | **Only AD2** (branch, maker, operations) applies a deal reference negotiated with the treasury desk. The customer books the live rate. |
| C25 | Rate booking | Rate booked independently of the amount | The rate is **booked for an amount**: the card shows the FX amount, the rate and the INR, and changing the amount releases the booking. |
| C26 | Bill allocation | Table of bills below the rate | Bills come **first**, picked from a **dropdown** that shows each bill's amount and what is free (and which request holds the rest); the remittance amount follows the bills; the rate is booked for that amount. |
| C27 | Purpose search | Select list with a filter | Purpose codes are found by **typing** a code or words (“freight”, “consultancy”), like a search box. Execution date defaults to today. |
| C28 | Submission | Submit, then the detail page | Every submission has a **review step** and ends on a **confirmation screen** with the reference, where it is and what happens next. |
| C29 | Roles | One checker for customers and money | The **branch maker is common** to onboarding and transactions; checking is split — **AD2 Compliance** approves customers, the **AD2 Checker or AD2 Operations** approves money. Operations can authorise, accept bills and confirm knock-offs as well as release, but never authorise and release the same request. Menus name each role's work and open filtered lists. |
| C30 | Queries | Answered by the SME only | AD2 (maker, checker or operations) may **answer a query for the customer** with the documents the customer sent in; it goes back to the maker as if the SME had answered. |
| C31 | Inward intimation | AD2 records every receipt | The SME may **report a buyer's payment** (New inward remittance); Operations confirms it against the nostro credit or declines it with a reason. Disposals carry an **RBI inward purpose code** (P0102 by default, P0103 for an advance). |
| C32 | Onboarding pricing | At least one charge required | **Charges are optional.** The maker can select all currencies and apply one margin across the board, then adjust per currency. |
| C33 | Reports | Outstanding shows the balance | Outstanding bills show the **bill amount** beside the outstanding; aging lists every open bill, receipt and FIRC; FIRCs **download** from the report; realised bills show the **UFI portal** knock-off. |
| C34 | Testing | Sign in and out as each role | A **master test user** (TEST / MASTER) opens the platform as any customer or AD2 user and follows an item through every stage; see §14B. |

Two further decisions carry into the build:

- **Remitter bank account** is selected from an account master held in the customer profile, not typed per transaction. Accounts carry a verification state (PennyDrop).
- **Maker-checker** is provisioned throughout. AutoChecker approval is enabled now; manual checker can be switched on per queue later.

---

## 3. Roles

| Role | Portal | Scope |
|---|---|---|
| SME Applicant | SME | Onboarding, document upload, query response, application status. No transaction access until approved. |
| SME User | SME | Outward requests, inward disposal instructions, bill lodgement, knock-off proposals, reports — for its own SME only, within approved permissions. |
| AD2 Sales | AD2 | Branch RM. Captures offline applications and **transacts on behalf** of its customers. Cannot verify, authorise or release anything. |
| AD2 Maker | AD2 | Branch maker. Creates offline applications, reviews and prices applications, **verifies** outward requests and disposal instructions, transacts on behalf, answers queries for the customer. |
| AD2 Checker | AD2 | Trade checker. **Authorises** verified outward requests and disposals, accepts bills, confirms knock-offs. Does not approve customers. |
| AD2 Compliance | AD2 | Onboarding checker. **Approves**, returns or rejects applications and raises clarifications. No transaction authority. |
| AD2 Operations | AD2 | Records and confirms incoming credits, **authorises** (as a checker would), accepts bills, confirms and reverses knock-offs, **releases** authorised payments, **processes** disposals and issues FIRCs — never authorising and releasing the same request. |
| AD2 (assisted) | SME portal | Any AD2 maker or operations user may act inside an approved SME's portal on its behalf. Covered in §7A. |
| AD2 Administrator | AD2 | Users (add, deactivate, change role, reset password), purpose codes, document policy, compliance rules, settings, audit log. No transaction authority. |
| Master Tester | Test | Demo and test use only. Sees the whole platform and opens it as any user; holds no authority of its own. Not assignable. See §14B. |
| AD2 Treasury Dealer | Treasury (TMP) | Rate desk, the position book, bank cover and allocation, FX deals for trade customers, liquidity, limits, bulk bookings, amendments. No trade authority. See §7B. |
| AD2 Treasury Checker | Treasury (TMP) | Approves card rates, settlements, held deals and control changes — never its own entry. |
| AD2 Treasury Viewer | Treasury (TMP) | The whole book, read-only. |
| AD2 Branch Inputter | Treasury (TMP) — branch | Quotes and books FX at the counter, links FX Plus bills, works cut-off and reminders — for its branch only. |
| Agent Partner | Treasury (TMP) — agent | Quotes and books for its servicing branch; requests cancellations through it. |
| AD2 Regional Bulk / AD2 Finance | Treasury (TMP) — operations | Bulk currency requests for a region / card settlement reconciliation. |

An SME user may submit without a second SME approver. SME-side maker-checker is a later addition.

### 3.1 Capabilities and segregation

Each role holds a set of named capabilities, and the interface is built from them: an action a role cannot perform is not rendered. The API enforces the same capabilities on every action, so calling it directly does not get round them. A capability can also be **withheld by design** — marked *segregated* — meaning the role is deliberately kept from it so that whoever prepares work is not whoever approves it.

| Role | Holds | Withheld by design |
|---|---|---|
| SME Applicant | Submit an application | — |
| SME User | Create outward requests, dispose inward receipts, lodge bills, propose allocations, maintain its own masters, view reports | Approving its own requests; confirming its own allocations |
| AD2 Maker | Capture offline applications, review and price them, raise queries, verify requests, transact on behalf of an SME, answer queries for it, propose allocations | Approving applications or outward requests; confirming allocations |
| AD2 Checker | Authorise or reject outward requests and disposals, accept bills, confirm allocations, answer queries for the SME | Approving customers; creating or verifying the work it approves |
| AD2 Compliance | Approve, return or reject applications; raise clarifications | All transaction authority |
| AD2 Operations | Record and confirm receipts, query, authorise, release, accept bills, confirm and reverse allocations, transact on behalf | Approving onboarding applications; verifying; releasing what it authorised |
| AD2 Administrator | Masters, document checklists, purpose-code mapping, users, roles, settings | All transaction authority |

The Administrator is deliberately outside the transaction path: whoever configures the controls should not also be able to transact through them.

**AutoChecker.** While AutoChecker is enabled, a maker's review commits without a second approver, and the approve action is labelled as such. Switching it off in Settings routes those approvals to a checker. This is the mechanism behind the call's decision to provision maker-checker but run with AutoChecker for now.

The full action-by-role matrix is maintained in Administration → Roles and permissions.

---

## 4. Navigation

**Public:** Sign In (Domain ID, Login ID, Password), Register SME, Application Status. The sign-in page lists the shared demo accounts grouped as AD2 staff, businesses and applications in progress.

Each role has its own workspace. The sidebar is grouped around that role's work, collapses to an icon rail (remembered per browser), and a role cannot open another role's screens by URL. **Switch user** in the top bar opens a searchable list of demo users.

| Role | Sidebar |
|---|---|
| SME User | Home: Dashboard · Transact: Outward remittance (Import), Inward & disposal (Export) · Bills: Export bills, Import bills, Knock-off · Records: Reports, Integrations · Settings: Accounts & beneficiaries, Test data |
| SME Applicant | Application |
| AD2 Sales | Home: Dashboard · Customers: My customers, Onboard a customer · Track: Outward, Inward & disposal, Bills · Insight: Reports · Tools: Test data lab |
| AD2 Maker | Home: Dashboard, My work queue · Onboarding: Applications to price, Onboard a customer, Directory · Verify: Verify payments, Verify disposals · Transactions: Outward, Inward & disposal, Bills, Reconciliation · Insight · Tools |
| AD2 Checker | Home: Dashboard, My work queue · Authorise: Authorise payments, Authorise disposals, Accept bills, Confirm knock-offs · Records: Outward, Inward & disposal, Bills, Directory · Insight · Tools |
| AD2 Compliance | Home: Dashboard, My work queue · Onboarding: Applications to approve, SME applications, Directory · Oversight: Outward, Inward & disposal, Bills · Insight · Tools |
| AD2 Operations | Home: Dashboard, My work queue · Settle: Receipts to confirm, Release payments, Credit & issue FIRC · Authorise: Authorise payments, Authorise disposals, Accept bills, Confirm knock-offs · Records: Outward, Inward & disposal, Bills, Reconciliation, Directory · Insight · Tools |
| AD2 Administrator | Home: Dashboard · Configuration: Purpose codes, Document policy, Compliance rules, Currencies & checklists, Platform settings · Access: Users, Roles & permissions · Oversight: Audit log, Directory, Outward, Inward & disposal, Bills, Reports · Tools |

---

## 5. SME onboarding

Digital onboarding is initiated by the SME. Offline onboarding is entered by AD2 on the SME's behalf. Both write the same application record and store the source channel and creator identity.

Seven steps, with draft preservation between steps and validation before submission.

1. **Business details** — legal name, trading name, constitution (Proprietorship, Partnership, Private Limited, Public Limited, HUF, Individual), incorporation date, registration number, country, registered address.
2. **Domain** — AD2 name (auto-populated, read-only), Domain ID (generated from the entity name, editable before submission), category (SME, fixed).
3. **Identifiers** — PAN, GSTIN, **IEC (mandatory)**, and any further identifiers on the configured checklist.
4. **Contact details** — contact name, designation, email, mobile.
5. **Business profile** — industry, business description, expected annual volume, requested currencies, requested service (Import, Export, Both).
6. **Bank accounts** — account holder, bank name, account number, IFSC, branch, currency, account type. Each account carries a verification state; PennyDrop verification is offered per account. This list becomes the account master used by transactions.
7. **Documents** — per the configured checklist, with issue and expiry dates where relevant.
8. **Review and submit** — summary, declarations, confirmation.

Duplicate business identifiers raise a warning at submission.

**Status flow:** Draft → Submitted → Under Review → Clarification Required → Resubmitted → Approved or Rejected.

IEC is mandatory because regular transacting exporters must hold one. One-off exporters transacting on GST alone are not onboarded through this journey.

---

## 6. SME approval and pricing

AD2 review shows the application summary, business and bank details, a document viewer, query history, service permissions, pricing configuration and approval actions. Approval runs Maker → **Compliance**.

Mandatory before approval:

- Transaction permission — Import, Export or Both
- Enabled currencies (multi-select)
- Currency-wise FX margin and margin basis (paise or basis points)
- FX charges, if any — name, fixed or percentage basis, value, currency, application basis (optional, per C32)
- Effective date and internal remarks

The maker can select all currencies at once and apply one margin across the board before adjusting any currency. A zero margin must be entered explicitly rather than left blank. Rejection and clarification require a reason. Configuration changes retain an audit history.

**Currency visibility.** Only enabled currencies are selectable by the SME. A transaction initiated by an AD2 maker may use any currency the platform supports.

**Margin derivation.** Non-USD margins derive from the USD margin using the multiplier held in the currency master, unless overridden per currency.

**Permission mapping.** Import enables import bills and outward requests. Export enables export bills and inward disposal instructions. Both enables all four.

---

## 7. Outward remittance

Screens: request list, create request, request detail.

List columns: request ID, beneficiary, currency, amount, request date, status, pending with, action.

### Create request

**Beneficiary** — selected from the SME's **beneficiary master**, not retyped per transaction. The picker lists saved payees with their bank and account currency; **Add new beneficiary** captures one inline and, unless the save is unticked, adds it to the master and selects it. A genuine one-off payee can be used without ever entering the master.

The request **snapshots** the beneficiary details it was sent with, so later edits to or removal of a master record never rewrite a past payment. Where a beneficiary's account currency differs from the remittance currency, the screen warns but does not block — the payee may still be able to receive it.

The master is per SME and is maintained on Profile → Beneficiary master. It records who added each payee and when it was last used. An AD2 user in the assisted journey sees and adds to that SME's master, and additions are stamped as made on the SME's behalf.

**Remittance** — **product** (AIR, DIR, OTT or LC), **purpose of remittance**, the **LC number** for an LC settlement, currency (enabled currencies only), amount, requested execution date, **remitter account** (a verified INR account from the account master), and an optional free-text **Reference Number**.

**Product and purpose code** come from the business team's *Purpose / Doc Policy* workbook, which replaces the provisional mapping in earlier drafts. Only the codes AD2 is approved to handle are offered: 111 unique codes (the workbook's two duplicated OTT rows, S0801 and S0802, are merged, and descriptions are tidied — "slews" → "news", "lostel" → "hostel", spacing). Selecting a product narrows the purpose codes; OTT's 110 codes are searchable. A code may sit under more than one product (S0101 appears under AIR, DIR and OTT).

| Product | Purpose codes | Bills |
|---|---|---|
| AIR — Advance Import Remittance | S0101, S0104, S0109, S1505 | None at payment. The Bill of Entry is due within 90 days; the payment is knocked off against the import bill once lodged |
| DIR — Direct Import Remittance | S0101, S0102, S0104, S0109, S0501, S1505 | Settles an accepted import bill — at least one allocation is required |
| OTT — Miscellaneous Remittance | 110 services and current-account codes (S0001–S1701) | Optional |
| LC — Letter of Credit Settlement | S0101, S0102, S0104, S0109, S1505 | Settles an accepted import bill, like DIR. Added on review (C18) |

Principal Debit Account, Fee Account, Transport Document Number and Transfer Reference are not collected.

**Documents** — resolved from the product, per the workbook's Document Policy sheet. Changing the product replaces the checklist.

| Product | Document | Rule |
|---|---|---|
| AIR | Proforma Invoice | Required |
| DIR | Transport Document, Commercial Invoice, Bill of Entry | Required |
| OTT | Invoice | Required |
| OTT | Form 145 (formerly Form 15CA) | Required |
| OTT | Transport Document | Required when the purpose code is an import of goods (S0101, S0102, S0103, S0104, S0109, S1505, S0501); optional otherwise |
| OTT | Form 146 (formerly Form 15CB, CA certificate) | Required above ₹5,00,000 INR equivalent; optional below |
| LC | Letter of Credit copy, Commercial Invoice, Transport Document | Required |
| LC | Bill of Entry | Optional |

FORM_145 and FORM146 in the workbook are the Income-tax Act 2025 successors to Form 15CA and 15CB. The Administrator can change any rule (required, optional, goods-only, above threshold) and stop any purpose code being offered.

**Rate** — the customer's live rate is displayed with the foreign currency amount and its INR equivalent. **Book Rate** locks it for 48 hours *for that amount* and notifies treasury; no bank approval step. Where the rate has been negotiated with the treasury desk, **AD2** applies the **FX Deal Reference** (C24). A request cannot be submitted without either a booked rate or a deal reference. The customer never sees the margin or the reference rate (C23).

**Bill allocation** — linked import bills, allocation per bill, unallocated amount. Allocations may not exceed the remittance value or the available bill balance.

**Pricing** — reference rate, margin, customer rate, charges, estimated debit amount, quote timestamp. In the assisted journey AD2 may set the margin between the approved margin less the configured band (default 5 paise) and the approved margin plus 100 paise; the override is recorded in the audit trail.

**Declarations** — the SME accepts the FEMA and sanctions declarations before submitting; the time is recorded on the request.

**Compliance score** — computed on submission from the rules in Administration → Compliance rules: large amount (USD equivalent above a threshold), high-risk jurisdiction, watchlist name match, new beneficiary, first transaction, capital-account purpose code, Document AI mismatch, bank outside the beneficiary country, rate by offline deal. Score 60+ is High, 25–59 Medium, below 25 Low. AD2 sees the score and the rules that fired on the request; at High the maker and the checker must each record a reason. The SME never sees the score, the reasons or the rule list.

**Approval chain.** Every outward request passes three AD2 stages, each by a different person:

1. **AD2 Maker verifies** — documents against the policy, sanctions screening, purpose code, beneficiary details. The maker may raise a query.
2. **AD2 Checker authorises** — may also query or reject. The checker cannot be the maker who verified.
3. **AD2 Operations releases** — debits the INR account (refused if funds are short), generates the UTR and the SWIFT MT103, settles the linked bills and issues the payment advice. Operations cannot be the maker or checker on the same request.

Whoever raised a request (including an AD2 user in the assisted journey) cannot verify, authorise or release it.

**Status flow:** Draft → Submitted → Verified → Authorised → Completed. Clarification Required returns the request to the SME; the response sends it back to the maker to verify again. Rejected releases any bill reservation.

---

## 7A. Assisted journey — AD2 transacting for an SME

AD2 works inside an approved SME's portal on its behalf. There are no separate screens: the SME portal is reused with the acting context swapped, so anything the SME can do, AD2 can do for them.

**Entry is from inside the function, never from a dashboard.** The journey starts where the work is:

| Where | Action | Lands on |
|---|---|---|
| AD2 → Outward Requests | **New request for an SME** | That SME's outward request form |
| AD2 → Inward Remittances | **Disposal for an SME** | That SME's inward remittance list |
| AD2 → Inward Remittances, any receipt with a balance | **Dispose on behalf** | That receipt's disposal instruction, in one click |
| AD2 → SME Directory | **Transact on behalf** | A choice of outward, inward, bill lodgement, or the whole portal |

The SME picker lists only approved SMEs whose service permission allows the direction — Import or Both for outward, Export or Both for inward — alongside their enabled currencies and how much open work each has.

**While acting.** A banner names the SME and the acting user on every screen, with direct links to Outward and Inward. Navigation becomes the SME menu, and every action the SME's own user has is available: create, submit, respond to a query, dispose, lodge and allocate. An assisted session is not a read-only view.

**What changes.** An AD2 maker may transact in **any supported currency**, not only the SME's enabled list, per §6. Records created while acting are stamped `source = AD2 Assisted` with the AD2 user named, and the audit entry names both parties.

**What does not change.** Service permissions, allocation limits, document requirements and the rate gate all still apply. Assisting is not a route past a control.

**Exit.** Leaving returns to the directory. Navigating to any AD2 route drops the acting context automatically, so it cannot be left on by accident.

## 7B. Treasury Management Portal and the trade ⇄ treasury connection

The treasury portal (`/treasury/`) is a second front end on the same platform: one engine, one API, one store and one
sign-in. It implements the TMP design (Remit4Me TMP: screens B-01…B-10, T-01…T-27, OPS-01…03, ADM-01…05, SYS-01/02,
design rules, dialogs and workflow) on live data, and adds **T-28 Trade desk** where the trade portal meets the book.

**Where the two portals connect**

| From | To | What happens |
|---|---|---|
| Trade: rate booked (§7, §8) | Treasury | A position opens at once in the one book, at the customer's home branch (by GSTIN state), product *Outward remittance* or *Inward remittance*, channel *Trade portal* or *Assisted*. |
| Trade: request submitted | Treasury | The position is attached; its rate is frozen until settlement. |
| Trade: UTR / FIRC | Treasury | The position's transaction link completes; the correspondent Nostro and head-office INR move. An inward credit recorded or confirmed moves the Nostro. |
| Trade: rejected, released, expired | Treasury | The position is cancelled and any cover returns to the pool. |
| Treasury: rate desk | Trade | The published **base rate** is the trade reference rate. With no published card rate for the product line, the trade portal cannot book that currency (and says so). |
| Treasury: customer limits | Trade | A booking over the customer's treasury limit is made but **held**; it cannot be submitted until a treasury checker releases it. |
| Treasury: FX deal | Trade | A dealer issues an FX deal reference — or a branch quotes a trade customer and the quote becomes the deal — which AD2 applies to one request (C24). |

**Positions.** Two tracks, never merged: the *transaction link* (UTR or FIRC for trade; FX Plus bills, possibly in
parts, for a branch deal) and *cover* (bank cover or an internal cross). Branch deals not concluded by the product's
cut-off (16:00 IST for remittance and cards, 15:30 for cash, later at airports) are cancelled for the residual, and
cover above the live amount returns to the pool — unless the branch keeps the deal past cut-off with a reason. Trade
bookings keep their 48-hour lock instead.

**Maker-checker.** One approvals inbox: card rates, forward and credit-line settlements, held deals, Nostro
replacements, bulk booking detail, amendments, limit changes, and every admin control change (users, cut-offs, spreads,
exposure limits, organisation). Before and after for each item; a rejection needs a reason; a checker never approves
their own entry; a rejected item is amended and resubmitted as a new version.

**Rules carried from the design.** Currencies are never totalled together; INR is grouped in lakh and crore and foreign
currency internationally; suggestions never execute themselves; stale figures stay visible but leave the fresh
subtotal; read-only roles see no action controls; every data table exports.

---

## 8. Inward remittance and disposal

AD2 Operations records the inward receipt. The SME views it and disposes of it — in one instruction or several.

**Receipt fields** — remittance reference, value date, remitter name, remitter country, currency, amount, amount still to dispose, remarks, status, FIRCs issued.

**Reported by the SME** (C31) — *New inward remittance* lets the SME dispose of a confirmed receipt or report a buyer's payment (remitter, amount, value date, SWIFT or UTR reference, the MT103 copy). Operations confirms it against the nostro credit — adjusting the amount to what was actually credited — or declines it with a reason. Only a confirmed receipt can be disposed of.

**Disposal instruction**

1. **Amount to dispose now** — up to what is left on the receipt (defaults to all of it). The balance stays for a later instruction.
2. **Purpose of remittance** — an RBI inward purpose code, found by typing (P0102 for proceeds of goods shipped, P0103 for an advance; the Administrator can add more).
3. **How to apply it** — *Knock off against export bills* (apply the amount to accepted export bills of the same currency; any part not applied is credited too and tracked as pending knock-off), or *Credit as advance* (no bills yet; knock off later).
4. **Account to credit** — a verified INR account, converted at a booked rate or FX deal, or a verified **EEFC account in the receipt currency**, credited as it is with no rate.
5. **Documents** — the TRADE policy: Disposal Instruction Letter always; Commercial Export Invoice and Shipping Bill when bills are knocked off, optional for an advance.
6. **Declarations** — FEMA and sanctions, as for outward. The instruction is scored for compliance on submission.

**Approval chain.** AD2 Maker verifies (documents, remitter screening, bill match, credit account), AD2 Checker authorises, AD2 Operations processes — credits the account, knocks off the bills, issues the FIRC and reports it to EDPMS through UFI. The FIRC shows the amount applied to bills and any amount **pending knock-off**.

**Status flow:** receipt Awaiting Instruction → Partially Disposed → Instruction Submitted → Processed; instruction Submitted → Verified → Authorised → Processed. Clarification Required returns it to the SME; Rejected returns the amount to the receipt.

Documentary collections and other trade-finance disposal options are not in scope.

---

## 9. Bill lodgement

A module in its own right, with export and import lodgement as separate menu entries. Service permissions control which are available.

**Capture channels**

| Channel | Behaviour |
|---|---|
| Form fill | Enter bill details, upload invoice and bill document. |
| File upload | Download the CSV template, upload, preview rows, validate, confirm. Failed rows are preserved and downloadable. |
| SFTP | Connection summary, received files, processing status, errors. |
| SAP API | Integration status, synchronisation jobs, accepted and rejected counts, retry. Bills sync automatically as they are raised. |

**Document AI.** Uploaded invoices are parsed and the extracted fields prefill the form. Every extracted field is shown with its confidence and is editable; the customer confirms before the bill is created.

**Bill fields** — type (Import/Export), invoice number, invoice date, counterparty name and country, currency, invoice amount, due date, purchase or sales order reference, shipment reference, supporting documents, source channel, external reference.

**Register columns** — bill ID, type, invoice number, counterparty, currency, original amount, adjusted amount, outstanding amount, due date, source, review status, settlement status.

**Statuses** — Review: Draft, Submitted, Under Review, Query Raised, Accepted, Rejected. Settlement: Unsettled, Partially Settled, Settled. The two are independent.

Duplicates are flagged on agreed business keys. Repeated integration messages must not create duplicate bills.

**Maker-checker** is provisioned on lodgement. AutoChecker approval is enabled; manual checker can be switched on per queue.

The outstanding bill amount is what drives knock-off against inward remittance.

---

## 10. Bill knock-off and reconciliation

One screen. Filters: Import/Export and currency.

Two panels — outstanding bills and eligible remittances — with allocations and remaining balances below.

- **Import**: a completed outward payment not yet matched (typically an AIR advance) against the import bill lodged after the Bill of Entry.
- **Export**: a **FIRC pending knock-off** (an advance disposal, or the unapplied part of a disposal) against the export bill lodged after shipment. Receipts are always disposed first, so money is credited before it is matched.

Matching is same-currency. One bill may be settled by several remittances and one remittance may settle several bills, including partial settlement. **Suggest Matches** proposes allocations on currency and counterparty. Proposals hold the amounts until an AD2 checker confirms or rejects them.

Every confirmation is reported to **IDPMS** (import) or **EDPMS** (export) through UFI and carries the report reference; payments and disposals report their bill matches the same way when they settle. Reversal, by Operations, requires a reason, is reported as a reversal, and returns the amount to the payment or to the FIRC's pending knock-off.

---

## 11. Reports and pendency

| Report | Contents |
|---|---|
| Onboarding Pendency | Applications awaiting review, documents or SME clarification |
| Outward Remittance Pendency | Requests awaiting review, clarification or processing |
| Inward Disposal Pendency | Receipts awaiting instruction, instructions awaiting processing |
| Bill Lodgement Pendency | Bills awaiting documents, review or response |
| Outstanding Bills | Open import and export bills with due dates, balances and aging |
| Reconciliation Pendency | Unmatched remittances, partially settled bills |
| Aging | 0–7, 8–15, 16–30, over 30 days |
| Charges | Applied margins and charges by SME, transaction and currency |
| FIRC Pending for Knock-off | Realised inward remittances with no bill applied |
| Bills Lodged and Realised | Lodged bills with settlement outcome |
| Bills Not Lodged and Realised | Realised receipts with no corresponding lodged bill |

Filters: date range, SME (AD2 only), Import/Export, currency, status, pending with, aging bucket, source. Columns: reference, SME, type, currency, amount, pending reason, pending with, pending since, days pending, due date, next action.

Exports reflect active filters. SMEs see only their own records. Totals are kept separate by currency.

---

## 12. Interface requirements

Responsive across desktop, tablet and mobile, with left navigation, top bar, breadcrumbs and consistent page titles.

Tables support search, sorting, filters, pagination and status badges. Forms use labels, required indicators, inline validation and helpful messages. Confirmation dialogs cover approval, rejection and reversal. Loading, empty, error and access-denied states are demonstrable.

Record detail pages carry documents, comments and an activity timeline. AD2 internal comments are hidden from SMEs.

Keyboard navigation and accessible labels throughout. Dates are formatted consistently and currency codes appear beside amounts.

**Visual system.** The prototype adopts the tokens of the live Remit4Me operations platform: primary `#098e90`, secondary `#152133`, table header `#738196`, border `#E5E7EB`, Poppins for interface type, pill buttons, 48px form controls.

---

## 13. Data model

| Entity | Key fields |
|---|---|
| SME | ID, business details, constitution, IEC, onboarding source, approval status |
| SME Configuration | permissions, currencies, margins, charges, effective date |
| Bank Account | SME, holder, bank, account number, IFSC, currency, verification state |
| Beneficiary | SME, name, country, address, bank, bank country, account/IBAN, SWIFT, account currency, relationship, added by, last used |
| User | ID, SME or AD2 association, role |
| Bill | ID, SME, type, currency, original/adjusted/outstanding amount, due date, source, review status, settlement status |
| Remittance | ID, SME, direction, currency, amount, purpose code, rate lock or deal reference, status |
| Disposal Instruction | ID, inward reference, amount, credit account, linked bills, status |
| Allocation | bill reference, remittance reference, allocated amount, approval status |
| Document | owner record, type, filename, review status, extraction confidence |
| Query | record reference, question, response, owner, status |
| Integration Job | source, timestamp, received, accepted, rejected, errors |
| Audit Event | actor, action, record reference, timestamp |

Outstanding balances derive from confirmed transactions and approved allocations. Stable external references detect duplicate integration inputs.

---

## 14. Acceptance criteria

| # | Criterion |
|---|---|
| AC01 | Digital and offline applications save and submit, with source recorded |
| AC02 | AD2 approval requires currencies, permissions, margins and charges; the SME portal reflects them |
| AC03 | An SME can submit an outward request and track its status |
| AC04 | Purpose code selection changes the document checklist; Business Travel does not request a Bill of Entry |
| AC05 | Book Rate locks a rate for 48 hours; an FX Deal Reference is accepted as the alternative; submission is blocked without one of the two |
| AC06 | Remitter and credit accounts are selected from the account master, and PennyDrop verification is demonstrable |
| AC06a | Beneficiaries are selected from a per-SME master or added inline; a one-off payee can be used without saving; the request snapshots what it sent, and a currency mismatch warns without blocking |
| AC07 | Partial and full disposal instructions submit without exceeding the available inward amount |
| AC08 | Bills lodge manually, by CSV upload, and through simulated SFTP and SAP jobs, without creating duplicates |
| AC09 | Document AI prefills bill fields from an uploaded invoice and the values remain editable |
| AC10 | Bills and remittances allocate partially or fully without exceeding balances; AD2 approves and the audit history is visible |
| AC11 | Reports reflect workflow changes and selected filters |
| AC12 | Every primary button produces a visible result |
| AC13 | Role restrictions and SME data isolation hold across navigation, detail views and reports |
| AC14 | Empty, error and validation states are demonstrable |
| AC15 | Remittance type is captured on outward requests and disposal instructions, narrows the purpose codes on offer, and clears a purpose that the pair no longer allows |
| AC16 | The document checklist reflects the purpose code and the remittance type together, without listing a duplicate document |
| AC17 | AD2 can transact on behalf of an approved SME; the record and the audit trail name both parties, and the SME's controls still apply |
| AC18 | The assisted journey covers outward and inward alike, is entered from within the relevant function, and lands on that function's screen rather than a dashboard |
| AC19 | While acting, an AD2 user has the full set of SME actions — create, submit, respond and dispose — not a read-only view |
| AC20 | The beneficiary master is available identically on the SME side and in the assisted journey, scoped to the SME being acted for, with assisted additions attributed to the AD2 user |
| AC21 | Every role's capabilities are defined explicitly, and an action a role cannot perform is absent from the interface rather than shown and refused |
| AC22 | Maker and checker are segregated: a maker cannot approve what it prepared, a checker cannot prepare what it approves, and the interface says which actions are withheld and why |
| AC23 | The Administrator holds no transaction authority, and the roles and permissions matrix is viewable in Administration |
| AC24 | No margin, reference rate or deal-reference entry is visible to, or sent to, an SME user |
| AC25 | Rate booking shows the FX amount and INR; bills are picked from a dropdown with their amounts before the rate is booked |
| AC26 | Every submission has a review step and a confirmation screen |
| AC27 | Compliance approves customers; the trade checker cannot; Operations can authorise and release but not both on one request |
| AC28 | AD2 can answer a query for the customer with documents; an SME can report an inward remittance that Operations confirms |
| AC29 | A browser never shows an older state than it has seen; Reset demo data takes effect for everyone at once |
| AC30 | One master test sign-in can run any journey end to end; each step is recorded against the user it was taken as, and four-eyes still holds |

---

## 14A. Test data lab

Seeded data is used up as journeys are run. The lab — *Test data lab* for AD2 users, *Test data* for an SME — makes more on demand:

- **Create a test business** from six profiles — approved with verified INR and EEFC accounts, suppliers (including one watchlist test payee that scores High), accepted import and export bills, a bill awaiting the checker and receipts ready to dispose; or as an application for onboarding review.
- **Add bills & receipts** to a business.
- **Park requests** at each stage (DIR submitted, LC verified, AIR authorised, a disposal submitted) by running the real commands as lab users, so every control still applies.

The six test businesses are also created whenever the demo is reset. The Administrator can switch the lab off in Platform settings.

## 14B. Master test user

Testing a journey across roles once meant signing in and out at every stage. The master test user (**TEST / MASTER**, demo passcode) replaces that:

- **Test console.** Lists every open item (applications, payments, disposals, reported receipts, bills and knock-offs), its next step and who can take it. It also has journeys to start and every user to open.
- **Open as.** One click opens the platform as that user, with no password. This works for businesses that registered with their own password too.
- **Next-step bar.** While testing, a bar on every page follows the item in front of you and offers **Do it as …** for the next person. It never offers someone who has already handled the item.
- **Controls stay intact.** The master holds no authority of its own. The server issues the chosen user's own session, so every action is recorded against that user and the maker-checker rules still apply. Each switch is written to the audit log, and a business never sees it.
- **Switch.** The Administrator turns it off with the test tools in Platform settings.

---

## 15. Decisions pending

| Item | Owner | Blocking |
|---|---|---|
| ~~Full purpose code to document mapping workbook~~ | Business team | **Resolved** — the Purpose / Doc Policy workbook is loaded (§7, §8) |
| FX quotation direction, rounding and final pricing formula | Treasury | Live rate display and booked-rate arithmetic — the demo prices trade at the published base ± the customer's margin, gated by the card rate |
| IBR source, FX Plus transport (SFTP or API), legacy currency booking module | Treasury / Technology | Shown as proposed or unresolved on the treasury portal's integrations |
| Credit-line funding rule (v0.1–v0.3) | Treasury | Previewed on T-11; applied only through a checker |
| ~~Disposal option list beyond bill knock-off and account credit~~ | Operations | **Resolved** — knock-off or advance, INR or EEFC (§8) |
| Compliance rule weights, thresholds and the real screening provider | Compliance | Scoring in §7 and §8 |
| UFI API access for AD2 (EDPMS/IDPMS knock-off) — expected from RBI, not yet confirmed | Regulatory | §10 reporting goes live |
| Transaction limits per SME and per currency | Risk | Validation on outward and disposal — the demo applies each customer's treasury limit (held for a checker when exceeded) |
| Whether unlinked outward requests are permitted | Operations | §7 allocation rules |
| SFTP and SAP integration contracts | Technology | §9 channel behaviour |
| Document retention periods and processing service levels | Compliance | Non-functional |
| Per-queue manual checker activation | Operations | §9 maker-checker |
