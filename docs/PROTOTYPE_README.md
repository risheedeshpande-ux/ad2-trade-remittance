# AD2 Trade Remittance — frontend prototype

Interactive prototype of the AD2 trade remittance platform: SME onboarding, outward remittance,
inward disposal, bill lodgement and knock-off, plus the AD2 operations portal that approves them.

All data is fictional. Authentication, FX rates, payments, SFTP, SAP and document AI are simulated.

## Run it

```bash
cd ~/Desktop/r4m/ad2-trade && python3 -m http.server 8123
```

Then open <http://localhost:8123>. Opening `index.html` directly from the filesystem also works.

## Signing in

Any password is accepted. Click a demo account on the sign-in card to fill the Domain ID and Login ID,
or use the **Demo role** switcher in the top bar to move between roles without signing out.

| Domain ID | Login ID | Role |
|---|---|---|
| MERIDIANTEX | SMEUSER | SME User — Meridian Textiles (Import + Export) |
| ARCADIACOMP | SMEUSER | SME User — Arcadia Components (Import only) |
| NILGIRISPICE | SMEUSER | SME User — Nilgiri Spice (Export only) |
| HKTRADING | APPLICANT | SME Applicant — application in clarification |
| AD2 | MAKER | AD2 Maker |
| AD2 | CHECKER | AD2 Checker |
| AD2 | OPS | AD2 Operations |
| AD2 | ADMIN | AD2 Administrator |

State persists in `localStorage`. **Reset demo data** in the yellow banner restores the seed.

## Worth demonstrating

**Remittance type and purpose code together drive the document checklist.** Outward Remittance → New
request. Pick a **remittance type** first — it narrows the purpose codes on offer. Then switch the
purpose between *S0301 Business travel* and *S0102 Payment towards imports*: the checklist swaps, so
travel asks for passport, visa and Form A2 while import settlement asks for the Bill of Entry. That is
the defect raised on the requirements call. Choosing *Payment against documents* also adds a
collection schedule on top of the purpose code's own list, and switching type clears a purpose that
the pair no longer allows.

Disposal instructions carry the same pair, pre-filled from the receipt AD2 recorded.

**Rate booking.** On the same screen, **Book rate** locks the customer rate for 48 hours and notifies
treasury, with no bank approval step. **Enter FX deal reference** is the alternative for a rate
negotiated by phone. Submission is blocked until one of the two exists.

**Account master.** Remitter and credit accounts are selected from the SME's saved accounts, not typed
per transaction. Profile → Bank account master has PennyDrop verification.

**Disposal in two decisions.** Inward Remittance → Dispose. Pick the export bill to knock off and the
account to credit. Partial disposal leaves the balance available.

**Bill lodgement.** Export or Import Bill Lodgement → New bill → *Upload invoice and extract* prefills
the form from document AI with per-field confidence, all editable. File upload validates rows and
preserves failures. SFTP and SAP tabs show jobs, rejects and retry that does not duplicate.

**Assisted journey.** Sign in as AD2 Maker → SME Directory → **Transact on behalf**. You land inside
that SME's portal with a banner naming them; anything you submit is stamped `AD2 Assisted` with your
name, and the audit line names both parties. Note that AD2 gets every supported currency, not just the
SME's enabled three. Exiting, or navigating to any AD2 route, drops the context.

**Approval reflects in the SME portal.** As AD2 Maker, open SME Applications → an application under
review, set permission, currencies, margins and charges, then approve. Switch to that SME and the
enabled currencies and pricing are live in Profile and on the transaction screens.

**Margin derivation.** In the approval screen, enter a USD margin and leave others blank — the
placeholder shows the value derived from the currency master multiplier.

## Files

| File | Contents |
|---|---|
| `map.html` | **Screen map** — architecture, journey diagrams, the full screen index and every status machine. Linked from the banner in the app, or open it directly |
| `index.html` | Shell and script loading |
| `styles.css` | Design system, tokens taken from the live Remit4Me operations app |
| `data.js` | Fictional seed data, currency master, purpose-code to document mapping |
| `app.js` | Router, screens, workflow and validation |
| `PRD.md` / `AD2_Trade_PRD.docx` | Product requirements reconciling the BRD with the requirements call |

## Design

Tokens are taken from the live operations platform so this reads as one product: primary `#098e90`,
secondary `#152133`, table header `#738196`, border `#E5E7EB`, Poppins type, pill buttons, 58px teal
app bar, white navigation rail with coloured section chips.

## Scope

The prototype covers the BRD and the requirements-call decisions. A production build still needs the
full purpose-code workbook, the FX pricing formula, transaction limits, the SFTP and SAP contracts,
and backend enforcement of authentication, authorisation and validation.
