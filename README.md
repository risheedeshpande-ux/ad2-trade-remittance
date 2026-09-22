# AD2 Trade Remittance — prototype packet

An interactive frontend prototype of the AD2 trade remittance platform: SME onboarding, outward
remittance, inward remittance with disposal instructions, import and export bill lodgement, and
knock-off of bills against remittances — plus the AD2 operations portal that onboards, prices and
approves it all.

**Every record is fictional.** Authentication, FX rates, payments, SFTP, SAP and document AI are
simulated. Nothing here touches a real system, and no real credentials or documents should be
entered into it.

## What's in the packet

| | |
|---|---|
| `index.html` | Packet landing page — start here |
| `app.html` | The working prototype (both portals, role switcher) |
| `screens.html` | Screen index — all 34 screens with live previews and direct links |
| `map.html` | Screen map — architecture, journeys, status machines, data model |
| `docs/` | The source BRD, the PRD built from it, and prototype notes |
| `styles.css`, `data.js`, `app.js` | Design system, seed data, application |

## Running it locally

No build step and no dependencies. Serve the folder:

```bash
python3 -m http.server 8130
```

Then open <http://localhost:8130>. Opening `index.html` from the filesystem also works, though the
live previews on the screen index need the server.

## Signing in

Any password is accepted — the field is simulated. Click a demo account on the sign-in card to fill
the Domain ID and Login ID, or use the **Demo role** switcher in the top bar.

| Domain ID | Login ID | Role |
|---|---|---|
| MERIDIANTEX | SMEUSER | SME User — Import and Export |
| ARCADIACOMP | SMEUSER | SME User — Import only |
| NILGIRISPICE | SMEUSER | SME User — Export only |
| HKTRADING | APPLICANT | SME Applicant — still in clarification |
| AD2 | MAKER | AD2 Maker |
| AD2 | CHECKER | AD2 Checker |
| AD2 | OPS | AD2 Operations |
| AD2 | ADMIN | AD2 Administrator |

Screens can also be opened directly with `app.html?as=DOMAIN:LOGIN#/route`, optionally with
`&acting=SME-1001` to start the assisted journey. That is how the screen index links work.

State lives in the browser's `localStorage`, so it persists per visitor and is never sent anywhere.
**Reset demo data** in the yellow banner restores the seed.

## Worth demonstrating

**Purpose code and remittance type drive the document checklist.** Outward → New request. The
remittance type narrows the purpose codes; together they resolve the checklist. Business Travel asks
for passport, visa and Form A2 — not a Bill of Entry. That was the defect raised on the requirements
call.

**Rate booking.** Book Rate locks the customer rate for 48 hours and notifies treasury, with no bank
approval step. An FX Deal Reference is the alternative for a rate negotiated by phone. Submission is
blocked until one of the two exists.

**Disposal in two decisions.** Inward → Dispose. The export bill to knock off and the account to
credit, plus purpose and remittance type pre-filled from the receipt. Partial disposal leaves the
balance available.

**Bill lodgement four ways.** Form, CSV upload with row validation and preserved failures, SFTP, and
SAP API — with document AI prefilling from an uploaded invoice at per-field confidence, and a retry
that cannot create a duplicate bill.

**Assisted journey.** AD2 → SME Directory → Transact on behalf. An AD2 user works inside that SME's
portal; records are stamped as assisted and the audit names both parties, while the SME's own
permission, allocation and document controls still apply.

**Approval flows through.** Approve an application with permissions, currencies, margins and charges,
then switch to that SME — the pricing is live on its screens. Non-USD margins derive from the USD
margin via the currency master multiplier.

## Design

Tokens were read off the live Remit4Me operations platform rather than sampled from a deck, so this
reads as part of the same product: primary `#098e90`, secondary `#152133`, table header `#738196`,
border `#E5E7EB`, Poppins over Roboto, pill buttons, a 58px teal app bar and a white navigation rail
with coloured section chips.

## Scope

This is a prototype for review, not a system. A production build still needs the full purpose-code to
document mapping workbook, the FX quotation direction and pricing formula, transaction limits, the
SFTP and SAP integration contracts, document retention periods, and backend enforcement of
authentication, authorisation and validation. The open items are listed in section 15 of the PRD.

The purpose-code mapping shipped here covers six outward and four inward codes and is provisional —
it stands in for the business team's workbook.
