# AD2 Trade Remittance — Product Demo Video Plan

**Platform:** https://ad2-trade-remittance.vercel.app/
**Target Video Length:** 8–12 minutes (can be split into chapters)
**Style:** Professional product demo with live walkthrough + narration

---

## 🎯 Video Objective
Showcase the end-to-end trade remittance journey — from SME onboarding through payment execution to treasury cover and FIRC issuance — highlighting the **dual-portal architecture**, **role-based maker-checker controls**, and **real-time treasury integration**.

---

## 📋 Pre-Recording Setup

### Browser & Window Setup
- **Two browser windows** side-by-side (or two monitors):
  - Window A: SME Portal (`app.html`) — signed in as **SMEUSER** (Meridian Textiles)
  - Window B: Treasury Portal (`treasury/index.html`) — signed in as **DEALER**
- **Screen resolution:** 1920×1080 minimum
- **Recording tool:** OBS, Loom, ScreenFlow, or similar (1080p/30fps minimum)
- **Audio:** USB mic, pop filter, quiet room

### Demo Data Preparation
1. Open demo → click **"Reset demo data"** in yellow bar (passcode: `demo`)
2. Click **"Demo guide"** in yellow bar — keep open for reference
3. Open **"Test data lab"** from sidebar → note the 10+ pre-built journeys

### Personas Quick Reference
| Portal | Role | Login ID | Use Case |
|--------|------|----------|----------|
| SME | SME User | `SMEUSER` | Meridian Textiles (Import/Export) |
| SME | Sales | `SALES` | Branch RM onboarding |
| SME | Maker | `MAKER` | Verify/price requests |
| SME | Checker | `CHECKER` | Authorise payments |
| SME | Compliance | `COMPLIANCE` | Approve onboarding |
| SME | Operations | `OPS` | Release payments, issue FIRC |
| Treasury | Dealer | `DEALER` | Rate desk, cover positions |
| Treasury | Branch | `BRANCH` | Quote/book at branch counter |

---

## 🎬 Video Structure & Script

### **Chapter 1: Platform Overview (0:00–1:30)**
**Visual:** Landing page (`index.html`) → scroll through sections
**Narration:**
> "AD2 Trade Remittance is a unified platform for SME trade finance and treasury operations. Two portals — one shared data layer. The SME portal handles onboarding, import/export payments, and compliance. The Treasury portal manages FX positions, cover deals, and liquidity. Every rate booked in trade is instantly a treasury position. Let's walk the full journey."

**Shots:**
- Landing page hero + "Live demo" / "Treasury portal" cards
- Quick scroll: "How it works" → "All screens" → "Documents"
- Click "Open the demo" → show yellow bar (Demo guide, Test data lab, Reset)

---

### **Chapter 2: SME Onboarding & Role-Based Access (1:30–3:00)**
**Visual:** SME Portal → Demo guide Step 1–3
**Flow:**
1. **Applicant view** (`APPLICANT` / `HKTRADING`) — start registration
   - Show form: IEC, PAN, business details, purpose codes
   - Submit → lands in "Compliance queue"
2. **Compliance view** (`COMPLIANCE`) — review application
   - Show document policy, risk flags, sanctions check (simulated)
   - **Approve** → application moves to Maker for pricing
3. **Maker view** (`MAKER`) — price the customer
   - Set card rates, limits, purpose code mappings
   - **Submit** → customer becomes active SME User

**Key Highlight:** "Four-eyes enforced at API level — try to authorise as the same maker who verified; the button disappears and the API refuses."

---

### **Chapter 3: Outward Remittance — Import Payment (3:00–5:30)**
**Visual:** SME Portal as `SMEUSER` (Meridian Textiles) → **Outward → New request**
**Flow:**
1. **Create DIR Payment**
   - Select **DIR** (Direct Import Remittance)
   - Pick bill from dropdown → amount auto-fills
   - **Book rate** → card shows FCY, rate, INR equivalent
   - Under **OTT**, type "consultancy" → purpose code search
   - Large amount → **Form 146** auto-required (document policy)
2. **Submit** → enters **Maker queue**
3. **Switch to Maker** (`MAKER`) → **Verify**
   - Check sanctions (simulated), PennyDrop (simulated), bill reservation
   - **Verify** → moves to Checker
4. **Switch to Checker** (`CHECKER`) → **Authorise**
   - See audit trail, maker's comments
   - **Authorise** → moves to Operations
5. **Switch to Operations** (`OPS`) → **Release**
   - Show **account balance check**, **UTR generation**, **SWIFT MT103 preview**
   - Printable **payment advice**
   - Bill status → **Settled**

**Treasury Crossover (Key Moment):**
- **Open Treasury portal** (`DEALER`) in Window B
- Show **Position Book** → the booking appears at **Mumbai Fort** branch
- **Cover the position** → execute cover deal
- **Back to SME Portal** → Release payment → **Position concludes with UTR**, USD Nostro falls

**Narration:** "Watch the position move from trade booking → treasury cover → payment release → Nostro impact — all in real time on shared data."

---

### **Chapter 4: Inward Remittance — Export Receipt & FIRC (5:30–7:30)**
**Visual:** SME Portal as `SMEUSER` → **Inward → New inward remittance**
**Flow:**
1. **Report buyer's payment** (export proceeds)
   - Enter FCY amount, purpose code (RBI)
   - Submit → **Operations confirms credit** (simulated MT950)
2. **Operations** (`OPS`) → **Confirm credit** → **Dispose against export bill**
   - Select bill, apply purpose code
   - **Knock-off** logic (partial/advance/EEFC)
3. **Issue FIRC** (Foreign Inward Remittance Certificate)
   - Auto-generated with UTR, purpose code, RBI format
   - Printable/PDF

**Treasury View:** Switch to Treasury portal → position updates, liquidity reflects inflow

---

### **Chapter 5: Treasury Portal Deep Dive (7:30–9:30)**
**Visual:** Treasury Portal (`treasury/index.html`) as `DEALER`
**Sections to Show:**
| Tab | What to Demo |
|-----|--------------|
| **Rate Desk** | Card rates, publish/unpublish → trade portal instantly respects |
| **Position Book** | Net open positions by currency/branch, aging |
| **Cover Deals** | Execute cover, see allocation to trade bookings |
| **Branch Counters** | `BRANCH` role: quote customer, book FX deal → reference flows to trade |
| **Cut-off & Liquidity** | Cut-off times, Nostro balances, liquidity gaps |
| **Maker-Checker Inbox** | Held deals, control changes — never approve own |

**Key Demo:** Unpublish a card rate → switch to SME portal → try booking that currency → **blocked**. Republish → works.

---

### **Chapter 6: Administration & Controls (9:30–10:30)**
**Visual:** SME Portal as `ADMIN` (`ADMIN` login)
**Show:**
- **Purpose Code Master** — enable/disable, make Form 146 mandatory
- **Document Policy** — set required/optional per purpose code
- **Settings** — limits, branches, user management
- **Treasury Admin** — users, masters, organisation structure

**Narration:** "Change a policy, next request reflects it instantly — no redeploy."

---

### **Chapter 7: Advanced Journeys & Test Lab (10:30–11:30)**
**Visual:** Sidebar → **Test data lab**
**Show:**
- "Create fresh business" → instant seeded journey
- List of **10 pre-built scenarios**:
  - Partial disposal, Advance disposal, EEFC credit
  - FIRC knock-off, LC settlement
  - High-risk payment (enhanced due diligence)
  - Assisted journey (Sales acts on behalf)
  - Queries & returns (Maker ↔ SME loop)

**Two-Browser Demo:** Open two windows as different roles → act in one, queue updates in other within seconds.

---

### **Chapter 8: Architecture & Production Readiness (11:30–12:00)**
**Visual:** `map.html` (How it works) + `docs/`
**Talking Points:**
- **Enforced in demo:** Auth, roles, four-eyes, purpose/document policy, rates, balances, bill reservation, audit trail
- **Simulated:** FX feed (IBR), SWIFT/MT950, FX Plus, bank aggregator, PennyDrop, sanctions, SFTP, SAP, document AI
- **Before production:** Treasury quotation formula, risk limits, SFTP/SAP contracts, document storage, relational DB

**Closing Shot:** Landing page → "Built for SME trade finance. Ready for treasury. One platform."

---

## 🎥 Recording Tips

### Pacing
- **2–3 seconds** per click/action for viewer comprehension
- **Pause 1 second** after each state change (queue updates, role switches)
- Use **mouse highlight/zoom** (OBS filter or post-production)

### Audio
- Record narration **separately** from screen capture for cleaner audio
- Script each chapter → read naturally, not robotic
- ~150 words/minute = ~1800 words for 12 min

### Visual Polish
- **Zoom** on key UI elements (rate card, UTR, FIRC, position book)
- **Annotate** in post: "Maker verifies → Checker authorises → Operations releases"
- **Split screen** for Treasury↔Trade crossover moments

### Branding
- Intro/outro slate: "AD2 Trade Remittance — Product Demo"
- Lower-third labels for each role switch: "Role: MAKER (Branch Maker)"
- Subtle watermark or corner logo

---

## 📤 Post-Production Checklist

- [ ] Trim dead air, speed up repetitive navigation (2x speed with narration overlay)
- [ ] Add chapter markers/timestamps in description
- [ ] Caption key terms: UTR, FIRC, DIR, OTT, Nostro, MT103, MT950
- [ ] Background music: subtle, corporate, duck under narration
- [ ] Export: 1080p H.264, 15–20 Mbps
- [ ] Thumbnail: Split screen SME + Treasury portals, "End-to-End Trade Remittance"

---

## 🔗 Alternative: Chapter-Based Short Videos

If 12 minutes is too long, split into **5 shorts (2–3 min each)**:
1. **Platform Overview & Onboarding** (Ch 1–2)
2. **Import Payment Flow + Treasury Cover** (Ch 3)
3. **Export Receipt & FIRC** (Ch 4)
4. **Treasury Portal Deep Dive** (Ch 5)
5. **Admin, Test Lab & Architecture** (Ch 6–8)

---

## 🎤 Sample Opening Narration (First 30 Seconds)

> "What if your trade finance portal and treasury workstation weren't separate systems — but two views of the same data? AD2 Trade Remittance does exactly that. An SME books an import payment at a branch rate. Instantly, that booking hits the treasury position book. The dealer covers it. Operations releases the payment. The Nostro moves. The FIRC issues. All with maker-checker controls enforced at the API level. Today we'll walk the full journey — live, on shared data, with simulated banking integrations."

---

## 📝 Notes for the User

1. **Passcode for demo:** `demo` (unless deployment overrides)
2. **Demo guide** in yellow bar = 20-step guided tour — use as your rehearsal script
3. **Test data lab** = infinite fresh scenarios — never run out of demo data
4. **Two-browser trick** = killer demo for real-time queue updates
5. **Reset demo data** = clean slate for retakes

---

*Generated for AD2 Trade Remittance demo at https://ad2-trade-remittance.vercel.app/*