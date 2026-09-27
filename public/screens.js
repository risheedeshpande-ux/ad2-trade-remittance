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

 { g:'Treasury', id:'TR-01', name:'Treasury desk', route:'#/ad2/treasury', as:'AD2:DEALER',
   note:'Every customer booking lands here as a position the moment it is made. Net open position per currency, with rule-based next steps: allocate cover, cross opposite bookings, or buy/sell the rest from a bank.' },
 { g:'Treasury', id:'TR-02', name:'Rate desk', route:'#/ad2/treasury/rates', as:'AD2:DEALER',
   note:'Published reference rates against the (simulated) market. A revision goes to a treasury checker; bookings already made keep their rate.' },
 { g:'Treasury', id:'TR-03', name:'Positions', route:'#/ad2/treasury/positions', as:'AD2:DEALER',
   note:'One row per booking or deal, with settlement and cover as separate columns, and the 48-hour lock counting down until the request is submitted.' },
 { g:'Treasury', id:'TR-04', name:'Position detail', route:'#/ad2/treasury/positions/POS-0103', as:'AD2:DEALER', state:true,
   note:'The booking, its lock, the request it settled through, the cover behind it, its P&L and every event trade sent about it.' },
 { g:'Treasury', id:'TR-05', name:'Cover deals', route:'#/ad2/treasury/cover', as:'AD2:DEALER',
   note:'Currency bought from or sold to banks. Entered by a dealer, approved by a treasury checker, then allocated.' },
 { g:'Treasury', id:'TR-06', name:'Allocate cover', route:'#/ad2/treasury/allocate?src=COV-0001', as:'AD2:DEALER',
   note:'One cover deal (or an opposite booking, for an internal cross) against the positions it offsets. Totals and over-allocation recompute as rows are ticked.' },
 { g:'Treasury', id:'TR-07', name:'Exceptions', route:'#/ad2/treasury/exceptions', as:'AD2:DEALER',
   note:'Uncovered after cut-off, unallocated cover, aged positions, expired locks and rates off the market — separate, each with its owner.' },
 { g:'Treasury', id:'TR-08', name:'FX deal references', route:'#/ad2/treasury/deals', as:'AD2:DEALER',
   note:'Rates negotiated with the desk. Issuing one puts the position on the book at once; the branch applies it to one request.' },
 { g:'Treasury', id:'TR-09', name:'P&L', route:'#/ad2/treasury/pnl', as:'AD2:DEALER',
   note:'Sales margin and dealing result (realised and unrealised) in rupees, by currency, customer and day.' },
 { g:'Treasury', id:'TR-10', name:'Integration log', route:'#/ad2/treasury/events', as:'AD2:DEALER',
   note:'The four events trade sends treasury — opened, attached, linked, cancelled — the contract a separate treasury system would subscribe to.' },
 { g:'Treasury', id:'TR-11', name:'Approvals — treasury checker', route:'#/ad2/treasury/approvals', as:'AD2:TCHECKER',
   note:'Rate revisions with a before/after comparison and cover deals to approve. The checker cannot approve their own entry.' },

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

const url = s => 'app.html' + (s.as ? '?as=' + encodeURIComponent(s.as) + (s.acting ? '&acting=' + encodeURIComponent(s.acting) : '') : '') + s.route;

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
