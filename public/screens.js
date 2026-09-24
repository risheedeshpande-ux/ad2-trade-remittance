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
   note:'An applicant before approval: progress through maker and checker, and a response form for AD2’s query.' },
 { g:'SME portal', id:'SME-03', name:'Outward remittance list', route:'#/sme/outward', as:'MERIDIANTEX:SMEUSER',
   note:'Stage tabs — Submitted, Verified, Authorised, Completed — with the product and purpose code on each row.' },
 { g:'SME portal', id:'SME-04', name:'New outward request', route:'#/sme/outward/new', as:'MERIDIANTEX:SMEUSER',
   note:'Pick AIR, DIR or OTT; the 111 workbook purpose codes narrow by product; the document policy follows. DIR settles a lodged import bill.' },
 { g:'SME portal', id:'SME-05', name:'Outward detail — with the checker', route:'#/sme/outward/OR-5103', as:'MERIDIANTEX:SMEUSER',
   note:'The approval chain: who submitted, who verified, and who it is with now.' },
 { g:'SME portal', id:'SME-06', name:'Outward detail — query from AD2', route:'#/sme/outward/OR-5104', as:'MERIDIANTEX:SMEUSER', state:true,
   note:'Answer the query and replace documents inline. The request goes back to the maker to verify again.' },
 { g:'SME portal', id:'SME-07', name:'Inward receipts', route:'#/sme/inward', as:'NILGIRISPICE:SMEUSER',
   note:'Export proceeds recorded by AD2 Operations, with the balance still to dispose, and the instructions raised.' },
 { g:'SME portal', id:'SME-08', name:'Disposal instruction', route:'#/sme/inward/IR-3305/dispose', as:'NILGIRISPICE:SMEUSER',
   note:'Apply the receipt to export bills, choose the credit account, book the rate, upload the TRADE documents.' },
 { g:'SME portal', id:'SME-09', name:'Disposal detail — processed', route:'#/sme/disposals/DI-9000', as:'NILGIRISPICE:SMEUSER', state:true,
   note:'Credited, knocked off and the FIRC issued — with the FIRC and credit advice to print.' },
 { g:'SME portal', id:'SME-10', name:'Import bills', route:'#/sme/bills/import', as:'ARCADIACOMP:SMEUSER',
   note:'Register, new bill with document AI, CSV upload, SFTP and SAP. A bill queried by AD2 can be answered here.' },
 { g:'SME portal', id:'SME-11', name:'Bill knock-off', route:'#/sme/knockoff', as:'ARCADIACOMP:SMEUSER',
   note:'Apply a completed advance (AIR) payment to the import bill that followed; a checker confirms.' },
 { g:'SME portal', id:'SME-12', name:'Reports', route:'#/sme/reports', as:'MERIDIANTEX:SMEUSER',
   note:'Pendency, outstanding, FIRCs, advance payments awaiting a Bill of Entry — from live data, with CSV export.' },
 { g:'SME portal', id:'SME-13', name:'Profile and masters', route:'#/sme/profile', as:'MERIDIANTEX:SMEUSER',
   note:'Accounts with balances and PennyDrop, the beneficiary master, and the pricing AD2 approved.' },

 { g:'AD2 portal', id:'AD2-01', name:'Dashboard — operations', route:'#/ad2/dashboard', as:'AD2:OPS',
   note:'What is waiting on this role, the outward book by stage, and recent activity.' },
 { g:'AD2 portal', id:'AD2-02', name:'Work queue — checker', route:'#/ad2/queue', as:'AD2:CHECKER',
   note:'Everything waiting on the signed-in role, oldest first: approvals, authorisations, bills to accept, knock-offs to confirm.' },
 { g:'AD2 portal', id:'AD2-03', name:'Application — maker prepares', route:'#/ad2/applications/SME-1006', as:'AD2:MAKER',
   note:'Permission, currencies and margins, charges, effective date — then send to the checker.' },
 { g:'AD2 portal', id:'AD2-04', name:'Application — checker approves', route:'#/ad2/applications/SME-1005', as:'AD2:CHECKER', state:true,
   note:'Read-only pricing prepared by the maker, with Approve, Return to maker, Clarify and Reject.' },
 { g:'AD2 portal', id:'AD2-05', name:'Outward — maker verifies', route:'#/ad2/outward/OR-5106', as:'AD2:MAKER',
   note:'Documents, sanctions screening, purpose code and beneficiary checks before it goes to the checker.' },
 { g:'AD2 portal', id:'AD2-06', name:'Outward — checker authorises', route:'#/ad2/outward/OR-5103', as:'AD2:CHECKER', state:true,
   note:'A different person from the maker authorises; operations then releases it.' },
 { g:'AD2 portal', id:'AD2-07', name:'Outward — operations releases', route:'#/ad2/outward/OR-5102', as:'AD2:OPS', state:true,
   note:'Release debits the INR account, creates the UTR and the SWIFT MT103, and settles the linked bill.' },
 { g:'AD2 portal', id:'AD2-08', name:'Outward — completed', route:'#/ad2/outward/OR-5101', as:'AD2:OPS', state:true,
   note:'Payment advice and MT103, printable to PDF.' },
 { g:'AD2 portal', id:'AD2-09', name:'Inward and disposal', route:'#/ad2/inward', as:'AD2:OPS',
   note:'Record incoming SWIFT credits for exporters; disposal instructions move maker → checker → operations.' },
 { g:'AD2 portal', id:'AD2-10', name:'Disposal — maker verifies', route:'#/ad2/disposals/DI-9003', as:'AD2:MAKER',
   note:'Documents, bill match and credit account, then to the checker.' },
 { g:'AD2 portal', id:'AD2-11', name:'Bills to accept', route:'#/ad2/bills/import', as:'AD2:CHECKER',
   note:'With AutoChecker off, every lodged bill is accepted or queried by a checker before it can be paid or disposed against.' },
 { g:'AD2 portal', id:'AD2-12', name:'Reconciliation ledger', route:'#/ad2/reconciliation', as:'AD2:CHECKER',
   note:'Every application of a remittance to a bill. Proposed knock-offs wait for a checker; operations can reverse.' },
 { g:'AD2 portal', id:'AD2-13', name:'SME directory', route:'#/ad2/directory', as:'AD2:MAKER',
   note:'Approved SMEs with live pricing. Transact on behalf starts an assisted journey.' },

 { g:'Administration', id:'ADM-01', name:'Purpose codes', route:'#/ad2/admin', as:'AD2:ADMIN',
   note:'The workbook’s 111 purpose codes by product. The Administrator can stop a code being offered.' },
 { g:'Administration', id:'ADM-02', name:'Roles and permissions', route:'#/ad2/admin', as:'AD2:ADMIN', state:true,
   note:'What each role is for, what is withheld by design, and the action-by-role matrix the API enforces.' },

 { g:'Assisted journey', id:'AST-01', name:'Assisted outward request', route:'#/sme/outward/new', as:'AD2:MAKER', acting:'SME-1001',
   note:'AD2 raises a request for an SME. It is stamped as assisted, and a different maker must verify it.' },
 { g:'Assisted journey', id:'AST-02', name:'Assisted disposal', route:'#/sme/inward/IR-3303/dispose', as:'AD2:OPS', acting:'SME-1001',
   note:'Operations disposes a receipt on the SME’s behalf; the audit names both parties.' },
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
