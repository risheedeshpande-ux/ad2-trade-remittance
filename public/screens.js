/* Screen index. Previews run the app in local mode on the seeded demo data;
   "Open" signs in to the live demo as the listed account. */
const SCREENS = [
 { g:'Public', id:'SYS-01', name:'Sign in', route:'#/login',
   note:'Domain ID, Login ID and password. Demo accounts use the demo passcode; registered businesses use their own password.' },
 { g:'Public', id:'SYS-02', name:'Register a business', route:'#/register',
   note:'Eight-step digital onboarding with its own sign-in. “Fill with a sample business” completes it with valid data for a live demo.' },
 { g:'Public', id:'SYS-03', name:'Track an application', route:'#/status',
   note:'Look up by Application ID and Domain ID — no applicant can see anyone else’s application.' },

 { g:'SME portal', id:'SME-01', name:'Dashboard', route:'#/sme/dashboard', as:'MERIDIANTEX:SMEUSER',
   note:'What is in flight with AD2, what is waiting on the SME, account balances and outstanding bills.' },
 { g:'SME portal', id:'SME-02', name:'Applicant home', route:'#/sme/dashboard', as:'HKTRADING:APPLICANT', state:true,
   note:'An applicant before approval: where it is now (maker, then Compliance), and a response form for AD2’s query.' },
 { g:'SME portal', id:'SME-03', name:'Outward remittance list', route:'#/sme/outward', as:'MERIDIANTEX:SMEUSER',
   note:'Stage tabs — Submitted, Verified, Authorised, Completed — with the product and purpose code on each row.' },
 { g:'SME portal', id:'SME-04', name:'New outward request', route:'#/sme/outward/new', as:'MERIDIANTEX:SMEUSER',
   note:'Pick the product, search the purpose code by typing a word, choose the bill from a dropdown — the amount follows — then book the rate for that amount. Review, confirm, and a confirmation screen with the reference.' },
 { g:'SME portal', id:'SME-05', name:'Outward detail — with the checker', route:'#/sme/outward/OR-5103', as:'MERIDIANTEX:SMEUSER',
   note:'The approval chain: who submitted, who verified, and who it is with now.' },
 { g:'SME portal', id:'SME-06', name:'Outward detail — query from AD2', route:'#/sme/outward/OR-5104', as:'MERIDIANTEX:SMEUSER', state:true,
   note:'Answer the query and replace documents inline. The request goes back to the maker to verify again.' },
 { g:'SME portal', id:'SME-07', name:'Inward receipts', route:'#/sme/inward', as:'NILGIRISPICE:SMEUSER',
   note:'Export proceeds, and “New inward remittance”: dispose of a confirmed receipt or report a buyer’s payment for Operations to confirm.' },
 { g:'SME portal', id:'SME-08', name:'Disposal instruction', route:'#/sme/inward/IR-3305/dispose', as:'NILGIRISPICE:SMEUSER',
   note:'RBI inward purpose code (P0102, P0103…), the export bills from a dropdown, the credit account, and the rate booked for the amount converted.' },
 { g:'SME portal', id:'SME-09', name:'Disposal detail — processed', route:'#/sme/disposals/DI-9000', as:'NILGIRISPICE:SMEUSER', state:true,
   note:'Credited, knocked off and the FIRC issued — with the FIRC and credit advice to print.' },
 { g:'SME portal', id:'SME-10', name:'Import bills', route:'#/sme/bills/import', as:'ARCADIACOMP:SMEUSER',
   note:'Register, new bill with document AI, CSV upload, SFTP and SAP. A bill queried by AD2 can be answered here.' },
 { g:'SME portal', id:'SME-11', name:'Bill knock-off', route:'#/sme/knockoff', as:'ARCADIACOMP:SMEUSER',
   note:'Apply a completed advance (AIR) payment to the import bill that followed. The panes shrink as allocations are added; a checker or operations confirms and the UFI portal is updated.' },
 { g:'SME portal', id:'SME-12', name:'Reports', route:'#/sme/reports', as:'MERIDIANTEX:SMEUSER',
   note:'Pendency, outstanding, FIRCs, advance payments awaiting a Bill of Entry — from live data, with CSV export.' },
 { g:'SME portal', id:'SME-13', name:'Profile and masters', route:'#/sme/profile', as:'MERIDIANTEX:SMEUSER',
   note:'Accounts with balances and PennyDrop, the beneficiary master, and the customer’s own rates — never AD2’s margin.' },
 { g:'SME portal', id:'SME-15', name:'Confirmation after submitting', route:'#/sme/done/outward/OR-5103', as:'MERIDIANTEX:SMEUSER',
   note:'Every submission ends here: the reference, where it is now and what happens next.' },
 { g:'SME portal', id:'SME-14', name:'Disposal — advance, FIRC pending knock-off', route:'#/sme/disposals/DI-9004', as:'MERIDIANTEX:SMEUSER', state:true,
   note:'Credited as an advance before shipment. The FIRC stays pending knock-off until it is matched to an export bill.' },

 { g:'AD2 portal', id:'AD2-01', name:'Dashboard — operations', route:'#/ad2/dashboard', as:'AD2:OPS',
   note:'What is waiting on this role, the outward book by stage, and recent activity.' },
 { g:'AD2 portal', id:'AD2-02', name:'Work queue — checker', route:'#/ad2/queue', as:'AD2:CHECKER',
   note:'Everything waiting on the signed-in role, oldest first: approvals, authorisations, bills to accept, knock-offs to confirm.' },
 { g:'AD2 portal', id:'AD2-03', name:'Application — maker prepares', route:'#/ad2/applications/SME-1006', as:'AD2:MAKER',
   note:'Permission, currencies (select all), one margin across the board, optional charges, effective date — then send to Compliance.' },
 { g:'AD2 portal', id:'AD2-04', name:'Application — Compliance approves', route:'#/ad2/applications/SME-1005', as:'AD2:COMPLIANCE', state:true,
   note:'Read-only pricing prepared by the maker, with Approve, Return to maker, Clarify and Reject.' },
 { g:'AD2 portal', id:'AD2-05', name:'Outward — maker verifies', route:'#/ad2/outward/OR-5106', as:'AD2:MAKER',
   note:'Documents, sanctions screening, purpose code and beneficiary checks before it goes to a checker or operations to authorise.' },
 { g:'AD2 portal', id:'AD2-06', name:'Outward — checker authorises', route:'#/ad2/outward/OR-5103', as:'AD2:CHECKER', state:true,
   note:'A different person from the maker authorises; operations then releases it.' },
 { g:'AD2 portal', id:'AD2-07', name:'Outward — operations releases', route:'#/ad2/outward/OR-5102', as:'AD2:OPS', state:true,
   note:'Release debits the INR account, creates the UTR and the SWIFT MT103, and settles the linked bill.' },
 { g:'AD2 portal', id:'AD2-08', name:'Outward — completed', route:'#/ad2/outward/OR-5101', as:'AD2:OPS', state:true,
   note:'Payment advice and MT103, printable to PDF.' },
 { g:'AD2 portal', id:'AD2-09', name:'Inward and disposal', route:'#/ad2/inward', as:'AD2:OPS',
   note:'Record incoming SWIFT credits, confirm the payments SMEs report, and move disposal instructions maker → checker / operations → operations.' },
 { g:'AD2 portal', id:'AD2-10', name:'Disposal — maker verifies', route:'#/ad2/disposals/DI-9003', as:'AD2:MAKER',
   note:'Documents, bill match and credit account, then to the checker.' },
 { g:'AD2 portal', id:'AD2-11', name:'Bills to accept', route:'#/ad2/bills/import', as:'AD2:CHECKER',
   note:'With AutoChecker off, every lodged bill is accepted or queried by a checker before it can be paid or disposed against.' },
 { g:'AD2 portal', id:'AD2-12', name:'Reconciliation ledger', route:'#/ad2/reconciliation', as:'AD2:CHECKER',
   note:'Every application of a remittance to a bill. Proposed knock-offs wait for a checker; operations can reverse.' },
 { g:'AD2 portal', id:'AD2-13', name:'SME directory', route:'#/ad2/directory', as:'AD2:MAKER',
   note:'Approved SMEs with live pricing. Transact on behalf starts an assisted journey.' },

 { g:'AD2 portal', id:'AD2-16', name:'Dashboard — Compliance', route:'#/ad2/dashboard', as:'AD2:COMPLIANCE',
   note:'The onboarding checker: applications to approve, with the maker, and waiting on applicants.' },
 { g:'AD2 portal', id:'AD2-17', name:'Inward — payment reported by an SME', route:'#/ad2/inward/IR-3310', as:'AD2:OPS', state:true,
   note:'Operations matches the reported payment to the nostro credit and confirms it (or says why not).' },
 { g:'AD2 portal', id:'AD2-14', name:'Dashboard — sales', route:'#/ad2/dashboard', as:'AD2:SALES',
   note:'Sales sees its customers, not a queue: capture an offline application or transact on a customer’s behalf.' },
 { g:'AD2 portal', id:'AD2-15', name:'Test data lab', route:'#/ad2/lab', as:'AD2:MAKER',
   note:'Create fresh test businesses, top up bills and receipts, and park requests at each stage so any journey can be run again.' },

 { g:'Treasury portal', id:'SYS-01', name:'Sign in — treasury personas', route:'#/SYS-01', portal:'tmp',
   note:'The treasury portal’s own sign-in, on the same platform and session as the trade portal. Each persona sees only what its role and branch scope allow.' },
 { g:'Treasury portal', id:'T-01', name:'Treasury overview', route:'#/T-01', as:'AD2:DEALER', portal:'tmp',
   note:'Trade portal bookings and branch deals flow in as positions; the book by currency (never totalled across currencies), the next actions and the latest trade events.' },
 { g:'Treasury portal', id:'T-24', name:'Rate desk', route:'#/T-24', as:'AD2:DEALER', portal:'tmp',
   note:'Base rates (the trade reference) and card rates per product line. Nothing publishes until a checker approves; no published card rate, no quote and no trade booking.' },
 { g:'Treasury portal', id:'T-02', name:'Position by currency and product', route:'#/T-02', as:'AD2:DEALER', portal:'tmp',
   note:'One book for trade bookings, FX deals and branch deals, with the transaction link and the bank cover as separate tracks, and rule-based suggestions that never execute themselves.' },
 { g:'Treasury portal', id:'T-28', name:'Trade desk', route:'#/T-28', as:'AD2:DEALER', portal:'tmp',
   note:'Where the trade portal meets treasury: every trade booking with its request, UTR or FIRC, and the FX deal references treasury issues for AD2 to apply.' },
 { g:'Treasury portal', id:'T-04', name:'Bank cover deal entry', route:'#/T-04', as:'AD2:DEALER', portal:'tmp',
   note:'Spot or forward cover with a bank counterparty, live when saved. Spot moves the settlement account and the Nostro at once.' },
 { g:'Treasury portal', id:'T-05', name:'Allocate bank cover', route:'#/T-05', as:'AD2:DEALER', portal:'tmp',
   note:'A cover deal — or a customer purchase, for an internal cross — against the positions it offsets. The reconciliation strip recomputes as rows are ticked.' },
 { g:'Treasury portal', id:'T-06', name:'Exceptions and missing references', route:'#/T-06', as:'AD2:DEALER', portal:'tmp',
   note:'Positions without a bill, bills without a position, currency mismatches and unallocated cover — separate, owned and aged.' },
 { g:'Treasury portal', id:'T-08', name:'Bank account balances', route:'#/T-08', as:'AD2:DEALER', portal:'tmp',
   note:'Balances from the bank aggregator with freshness; a stale feed stays visible but leaves the fresh subtotal. Trade settlements move these.' },
 { g:'Treasury portal', id:'T-09', name:'Nostro balances and upload', route:'#/T-09', as:'AD2:DEALER', portal:'tmp',
   note:'Correspondent Nostro moved by trade payments and receipts; issuer statements uploaded by hand, a duplicate replaced only through a checker.' },
 { g:'Treasury portal', id:'T-11', name:'Credit lines and funding', route:'#/T-11', as:'AD2:DEALER', portal:'tmp',
   note:'Bank lines behind card funding and forward cover, with a funding-rule preview that applies only when a checker approves it.' },
 { g:'Treasury portal', id:'T-12', name:'Forward covers by value date', route:'#/T-12', as:'AD2:DEALER', portal:'tmp',
   note:'Pending, due, overdue and settled forwards; a settlement goes to a checker with before and after.' },
 { g:'Treasury portal', id:'T-21', name:'Approvals worklist', route:'#/T-21', as:'AD2:TCHECKER', portal:'tmp',
   note:'Every entry that moves money or changes a control: before and after, a mandatory rejection reason, and never the checker’s own entry.' },
 { g:'Treasury portal', id:'T-25', name:'Customer credit limits', route:'#/T-25', as:'AD2:DEALER', portal:'tmp',
   note:'Trade customers and branch corporates against their limits. A booking over the limit is held for a checker, in either portal.' },
 { g:'Treasury portal', id:'T-01V', name:'Treasury overview — read-only', route:'#/T-01V', as:'AD2:TVIEW', portal:'tmp',
   note:'The viewer role: the same book, with the actions absent rather than disabled.' },
 { g:'Treasury portal', id:'B-01', name:'Branch overview', route:'#/B-01', as:'AD2:BRANCH', portal:'tmp',
   note:'A branch’s day: positions, what is waiting on a bill, what reaches cut-off soon and escalated reminders.' },
 { g:'Treasury portal', id:'B-02', name:'Take an FX rate', route:'#/B-02', as:'AD2:BRANCH', portal:'tmp',
   note:'One screen: enter the deal, read the rate, book it. A trade portal customer’s quote becomes an FX deal reference.' },
 { g:'Treasury portal', id:'B-05', name:'Transaction knock-off', route:'#/B-05', as:'AD2:BRANCH', portal:'tmp',
   note:'FX Plus bills against the position they pay for; a bill with the position reference links itself on punch.' },
 { g:'Treasury portal', id:'B-06', name:'Cut-off and cancellation queue', route:'#/B-06', as:'AD2:BRANCH', portal:'tmp',
   note:'At cut-off open residuals are cancelled and cover returns to the pool — keep a deal past cut-off with a reason, or cancel it now.' },
 { g:'Treasury portal', id:'B-02a', name:'Take an FX rate — agent view', route:'#/B-02a', as:'SUNDARFX:AGENT', portal:'tmp',
   note:'An agent quotes for its servicing branch with its spread on top; cancellation is requested through the branch.' },
 { g:'Treasury portal', id:'OPS-01', name:'Bulk currency bookings', route:'#/OPS-01', as:'AD2:RBULK', portal:'tmp',
   note:'Regional bulk teams request currency for a branch; treasury books it and a checker confirms before stock moves.' },
 { g:'Treasury portal', id:'OPS-02', name:'Settlement reconciliation', route:'#/OPS-02', as:'AD2:FINANCE', portal:'tmp',
   note:'Finance maps issuer settlements to the INR-funded card sales they pay for.' },
 { g:'Treasury portal', id:'ADM-T1', name:'Treasury users and organisation', route:'#/ADM-05', as:'AD2:ADMIN', portal:'tmp',
   note:'Regions, clusters, branches and airports; a user’s scope is a node and everything under it, changed only through a checker.' },

 { g:'Administration', id:'ADM-00', name:'Dashboard — administrator', route:'#/ad2/dashboard', as:'AD2:ADMIN',
   note:'Controls in force, platform activity and recent configuration changes. The Administrator holds no transaction authority.' },
 { g:'Administration', id:'ADM-01', name:'Purpose codes', route:'#/ad2/admin/purpose', as:'AD2:ADMIN',
   note:'The workbook’s 111 purpose codes by product, LC added on review, and the inward (disposal) purposes.' },
 { g:'Administration', id:'ADM-02', name:'Document policy', route:'#/ad2/admin/docs', as:'AD2:ADMIN',
   note:'Documents per product and when each is required — always, for goods, above a threshold, or when knocking off bills.' },
 { g:'Administration', id:'ADM-03', name:'Compliance rules', route:'#/ad2/admin/compliance', as:'AD2:ADMIN',
   note:'Rules, weights and thresholds that score every outward request and disposal. High needs a reason from maker and checker.' },
 { g:'Administration', id:'ADM-04', name:'Users', route:'#/ad2/admin/users', as:'AD2:ADMIN',
   note:'Add, deactivate and re-role users. Changes apply on the user’s next action.' },
 { g:'Administration', id:'ADM-05', name:'Roles and permissions', route:'#/ad2/admin/roles', as:'AD2:ADMIN', state:true,
   note:'What each role is for, what is withheld by design, and the action-by-role matrix the API enforces.' },
 { g:'Administration', id:'ADM-06', name:'Audit log', route:'#/ad2/admin/audit', as:'AD2:ADMIN',
   note:'Every action on the platform, filterable and exportable.' },

 { g:'Assisted journey', id:'AST-01', name:'Assisted outward request', route:'#/sme/outward/new', as:'AD2:MAKER', acting:'SME-1001',
   note:'AD2 raises a request for an SME. It is stamped as assisted, and a different maker must verify it.' },
 { g:'Assisted journey', id:'AST-02', name:'Assisted disposal', route:'#/sme/inward/IR-3303/dispose', as:'AD2:OPS', acting:'SME-1001',
   note:'Operations disposes a receipt on the SME’s behalf; the audit names both parties.' },

 { g:'Testing', id:'TST-01', name:'Test console (master test user)', route:'#/test', as:'TEST:MASTER',
   note:'One sign-in for testing: every open item with its next step and who can take it, journeys to start, and every user to open. A bar then follows the item through each stage — “Do it as …” becomes the next person, never one who already handled it.' },
];

const url = s => (s.portal === 'tmp' ? 'treasury/index.html' : 'app.html') + (s.as ? '?as=' + encodeURIComponent(s.as) + (s.acting ? '&acting=' + encodeURIComponent(s.acting) : '') : '') + s.route;

const out = document.getElementById('out');
const outlist = document.getElementById('outlist');

function build() {
  const groups = [...new Set(SCREENS.map(s => s.g))];
  out.innerHTML = groups.map(g => `
    <div class="grp"><h2>${g}</h2><span>${SCREENS.filter(s => s.g === g).length} screens</span></div>
    <div class="tiles">${SCREENS.filter(s => s.g === g).map(card).join('')}</div>`).join('');

  outlist.innerHTML = groups.map(g => `
    <div class="grp"><h2>${g}</h2><span>${SCREENS.filter(s => s.g === g).length} screens</span></div>
    <div class="card"><div class="card-body tight"><div class="tablewrap"><table class="dt">
      <thead><tr><th style="width:90px">ID</th><th>Screen</th><th>Route</th><th>Opens as</th><th style="width:80px"></th></tr></thead>
      <tbody>${SCREENS.filter(s => s.g === g).map(s => `
        <tr data-k="${key(s)}">
          <td><span class="sid">${s.id}</span></td>
          <td><a href="${url(s)}">${s.name}</a>${s.state ? ' <span class="badge b-grey">state</span>' : ''}
            <small style="display:block;color:var(--muted);font-size:var(--fs-xs);margin-top:2px">${s.note}</small></td>
          <td><span class="rt">${s.route}</span></td>
          <td style="font-size:var(--fs-xs);color:var(--muted)">${s.as || 'no session'}${s.acting ? '<br>acting for ' + s.acting : ''}</td>
          <td><a class="btn btn-ghost btn-sm" href="${url(s)}">Open</a></td>
        </tr>`).join('')}</tbody>
    </table></div></div></div>`).join('');
  filter();
}

const key = s => (s.id + ' ' + s.name + ' ' + s.route + ' ' + s.g + ' ' + (s.as || '')).toLowerCase();

function card(s) {
  return `<div class="tile" data-k="${key(s)}">
    <div class="shot">
      <div class="ph">Preview off</div>
      <iframe data-src="${url(s)}" title="${s.name} preview" loading="lazy" tabindex="-1" aria-hidden="true"></iframe>
      <a class="veil" href="${url(s)}" aria-label="Open ${s.name}"></a>
    </div>
    <div class="meta">
      <div class="top"><span class="sid">${s.id}</span>${s.state ? '<span class="badge b-grey">state</span>' : ''}</div>
      <h3>${s.name}</h3>
      <p>${s.note}</p>
      <span class="rt">${s.route}</span>
      <div class="foot">
        <a class="btn btn-primary btn-sm" href="${url(s)}">Open screen</a>
        <span style="font-size:var(--fs-xs);color:var(--muted)">${s.as || 'no session'}</span>
      </div>
    </div>
  </div>`;
}

function setPreviews(on) {
  document.querySelectorAll('.shot iframe').forEach(f => {
    if (on) { if (!f.src) f.src = f.dataset.src; f.style.display = ''; }
    else { f.style.display = 'none'; }
  });
}

function filter() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  let n = 0;
  document.querySelectorAll('[data-k]').forEach(el => {
    const hit = !q || el.dataset.k.includes(q);
    el.classList.toggle('hidden', !hit);
    if (hit && el.classList.contains('tile')) n++;
  });
  document.getElementById('count').textContent =
    (q ? n : SCREENS.length) + ' of ' + SCREENS.length + ' screens';
}

document.getElementById('q').addEventListener('input', filter);
document.getElementById('previews').addEventListener('change', e => setPreviews(e.target.checked));
document.getElementById('v-grid').addEventListener('click', () => {
  document.body.classList.remove('list');
  document.getElementById('v-grid').setAttribute('aria-pressed', 'true');
  document.getElementById('v-list').setAttribute('aria-pressed', 'false');
});
document.getElementById('v-list').addEventListener('click', () => {
  document.body.classList.add('list');
  document.getElementById('v-list').setAttribute('aria-pressed', 'true');
  document.getElementById('v-grid').setAttribute('aria-pressed', 'false');
});

build();
setPreviews(true);
