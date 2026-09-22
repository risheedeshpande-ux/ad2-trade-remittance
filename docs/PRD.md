# AD2 Trade Remittance Platform — Product Requirements

Version 1.0 · 22 September 2026
Source: AD2 Trade Remittance BRD v1.0, requirements call of 22 September 2026, and the live Remit4Me operations platform (uat1.remit4me.com).

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

Two further decisions carry into the build:

- **Remitter bank account** is selected from an account master held in the customer profile, not typed per transaction. Accounts carry a verification state (PennyDrop).
- **Maker-checker** is provisioned throughout. AutoChecker approval is enabled now; manual checker can be switched on per queue later.

---

## 3. Roles

| Role | Portal | Scope |
|---|---|---|
| SME Applicant | SME | Onboarding, document upload, query response, application status. No transaction access until approved. |
| SME User | SME | Outward requests, inward disposal instructions, bill lodgement, knock-off proposals, reports — for its own SME only, within approved permissions. |
| AD2 Maker | AD2 | Creates offline applications, reviews business details and documents, prepares approvals and pricing. |
| AD2 Checker | AD2 | Approves or rejects SMEs and allocations, raises queries, commits pricing configuration. |
| AD2 Operations | AD2 | Reviews remittances, disposal instructions, bills and reconciliations; manages queries and pendency. |
| AD2 (assisted) | SME portal | Any AD2 maker or operations user may act inside an approved SME's portal on its behalf. Covered in §7A. |
| AD2 Administrator | AD2 | Users, roles, currencies, charge categories, document checklists, purpose-code to document mapping. |

An SME user may submit without a second SME approver. SME-side maker-checker is a later addition.

### 3.1 Capabilities and segregation

Each role holds a set of named capabilities, and the interface is built from them: an action a role cannot perform is not rendered, rather than shown and refused. A capability can also be **withheld by design** — marked *segregated* — meaning the role is deliberately kept from it so that whoever prepares work is not whoever approves it.

| Role | Holds | Withheld by design |
|---|---|---|
| SME Applicant | Submit an application | — |
| SME User | Create outward requests, dispose inward receipts, lodge bills, propose allocations, maintain its own masters, view reports | Approving its own requests; confirming its own allocations |
| AD2 Maker | Capture offline applications, review and price them, raise queries, transact on behalf of an SME, propose allocations | Approving applications or outward requests; confirming allocations |
| AD2 Checker | Approve or reject applications and outward requests, accept bills, confirm allocations | Creating or reviewing the work it approves |
| AD2 Operations | Progress remittances and disposal instructions, query, approve, complete, accept bills, confirm and reverse allocations, transact on behalf | Approving onboarding applications |
| AD2 Administrator | Masters, document checklists, purpose-code mapping, users, roles, settings | All transaction authority |

The Administrator is deliberately outside the transaction path: whoever configures the controls should not also be able to transact through them.

**AutoChecker.** While AutoChecker is enabled, a maker's review commits without a second approver, and the approve action is labelled as such. Switching it off in Settings routes those approvals to a checker. This is the mechanism behind the call's decision to provision maker-checker but run with AutoChecker for now.

The full action-by-role matrix is maintained in Administration → Roles and permissions.

---

## 4. Navigation

**Public:** Sign In (Domain ID, Login ID, Password), Register SME, Application Status.

**SME menu**
- Dashboard
- Outward Remittance
- Inward Remittance
- Bill Lodgement → Export Bill Lodgement, Import Bill Lodgement
- Bill Knock-off
- Reports
- Integrations
- Profile

**AD2 menu**
- Dashboard
- SME Applications
- SME Directory
- Outward Requests
- Inward Remittances
- Bills
- Reconciliation
- Reports
- Administration

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

AD2 review shows the application summary, business and bank details, a document viewer, query history, service permissions, pricing configuration and approval actions. Approval runs Maker → Checker.

Mandatory before approval:

- Transaction permission — Import, Export or Both
- Enabled currencies (multi-select)
- Currency-wise FX margin and margin basis (paise or basis points)
- FX charge name, fixed or percentage basis, charge value, charge currency, application basis, effective date
- Internal remarks

Zero margin and zero charge must be entered explicitly rather than left blank. Rejection and clarification require a reason. Configuration changes retain an audit history.

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

**Remittance** — currency (enabled currencies only), amount, **remittance type**, **purpose of remittance**, requested execution date, **remitter account** (selected from the account master), and an optional free-text **Reference Number**.

**Remittance type** is the settlement method, held separately from the RBI purpose code. Selecting a type narrows the purpose codes on offer and may add documents of its own; changing it clears a purpose that is no longer valid for the pair.

| Outward type | Purpose codes | Documents it adds |
|---|---|---|
| Advance payment | S0101, S0104 | Advance payment undertaking |
| Payment against documents (collection) | S0102, S0104 | Collection schedule / bank covering letter |
| Open account / direct payment | S0102, S0190 | — |
| Merchanting / intermediary trade | S0104 | Merchanting trade declaration |
| Services, fees and other current account | S0301, S0501, S0601 | — |

Letter-of-credit settlement is deliberately absent: the call put trade-finance instruments out of scope for this journey. Add a type to the master when that changes.

Principal Debit Account, Fee Account, Transport Document Number and Transfer Reference are not collected.

**Documents** — the checklist is resolved from the selected purpose code **plus anything the remittance type adds**. Changing either replaces the checklist. This is the correction to the current behaviour, where every purpose code presents the same list and, for example, Business Travel asks for a Bill of Entry.

Provisional mapping, pending the full purpose-code workbook:

| Purpose code | Documents required |
|---|---|
| S0101 Advance payment against imports | Proforma invoice, purchase order, Form A1, advance-payment undertaking |
| S0102 Payment towards imports — settlement of invoice | Commercial invoice, Bill of Entry, transport document, Form A1 |
| S0104 Intermediary trade | Sale and purchase contracts, invoice, Form A1 |
| S0301 Business travel | Passport copy, visa, travel itinerary, employer declaration, Form A2 |
| S0501 Professional and consultancy fees | Service agreement, invoice, Form 15CA/15CB, Form A2 |
| S0601 Freight and logistics | Freight invoice, transport document, Form A2 |

**Rate** — a live reference rate is displayed with a countdown. **Book Rate** locks the customer rate for 48 hours and notifies treasury; no bank approval step. Where the rate has been negotiated offline, the customer enters the **FX Deal Reference** instead. A request cannot be submitted without either a booked rate or a deal reference.

**Bill allocation** — linked import bills, allocation per bill, unallocated amount. Allocations may not exceed the remittance value or the available bill balance.

**Pricing** — reference rate, margin, customer rate, charges, estimated debit amount, quote timestamp.

**Status flow:** Draft → Submitted → Under Review → Clarification Required → Processing → Completed or Rejected.

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

## 8. Inward remittance and disposal

AD2 records the inward receipt. The SME views it and disposes of it.

**Receipt fields** — remittance reference, receipt or value date, remitter name, remitter country, currency, amount, available amount for disposal, remarks, processing status.

**Disposal instruction** — two decisions:

1. Select the outstanding **export bill** to knock off, and the amount applied per bill.
2. Select the **bank account to credit**, from the account master.

Alongside those two decisions the instruction captures the **remittance type** and **purpose of remittance** for the receipt. Both pre-fill from the classification AD2 recorded on the receipt and can be corrected, because a receipt is often classified before the underlying trade is known. The instruction is the authoritative classification and writes back to the receipt on submission.

| Inward type | Purpose codes | Documents it adds |
|---|---|---|
| Advance receipt against export order | P0101 | Advance receipt declaration |
| Realisation against documents (collection) | P0102, P0103 | Collection advice |
| Open account receipt | P0102 | — |
| Merchanting / intermediary trade receipt | P0108 | Merchanting trade declaration |
| Services, fees and other current account | P0802 | — |

Supporting fields: amount to dispose, conversion currency where applicable, remarks, supporting documents per the resolved checklist. Partial disposal is supported and the remaining balance is shown. Amounts already disposed cannot be re-allocated.

Rate handling matches outward: **Book Rate** for a 48-hour lock, or enter an **FX Deal Reference** for a negotiated deal.

**Status flow:** Awaiting Instruction → Instruction Submitted → Under Review → Clarification Required → Processed or Rejected.

On processing, AD1 issues the FIRC, which is delivered to the customer and attached to the remittance record.

Trade-finance disposal options (LC, documentary collections) are not in scope.

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

One screen. Filters: Import/Export, currency, counterparty, date range, outstanding status.

Three panels: outstanding bills on the left, eligible remittances on the right, allocations and remaining balances at the bottom.

Import bills match outward remittances. Export bills match inward remittances. Matching is same-currency. One bill may be settled by several remittances and one remittance may settle several bills, including partial settlement.

**Suggest Matches** proposes allocations on currency, counterparty, reference and amount. Proposed allocations are visually distinct from confirmed ones and require user confirmation before submission. AD2 approval confirms them.

An allocation cannot exceed either available balance. Before and after balances are shown. Reversal requires a reason and writes an audit event.

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

---

## 15. Decisions pending

| Item | Owner | Blocking |
|---|---|---|
| Full purpose code to document mapping workbook | Business team | Replaces the provisional mapping in §7 |
| FX quotation direction, rounding and final pricing formula | Treasury | Live rate display and booked-rate arithmetic |
| Disposal option list beyond bill knock-off and account credit | Operations | §8 scope |
| Transaction limits per SME and per currency | Risk | Validation on outward and disposal |
| Whether unlinked outward requests are permitted | Operations | §7 allocation rules |
| SFTP and SAP integration contracts | Technology | §9 channel behaviour |
| Document retention periods and processing service levels | Compliance | Non-functional |
| Per-queue manual checker activation | Operations | §9 maker-checker |
