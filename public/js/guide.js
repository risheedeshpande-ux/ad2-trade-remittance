/* ==========================================================================
   Demo guide and notifications
   The guide walks one partner from registration to a settled payment and a
   disposed export receipt. Each step checks the live data to see whether it
   is done, and "Do this step" signs in as the right role and opens the
   right screen.
   ========================================================================== */

const GUIDE_KEY = 'ad2-guide';
let GUIDE_OPEN = !!sessGet('ad2-guide-open');

function guideTarget() {
  const g = localGet(GUIDE_KEY);
  if (g && g.smeId && DB.smes.some(s => s.id === g.smeId)) return DB.smes.find(s => s.id === g.smeId);
  if (!DB.smes.length) return null;
  /* otherwise the newest business registered after the seed */
  const seeded = new Set(SEED.smes.map(s => s.id));
  const fresh = DB.smes.filter(s => !seeded.has(s.id));
  if (fresh.length) return fresh[fresh.length - 1];
  return null;
}
function setGuideTarget(smeId, domainId, loginId) { localSet(GUIDE_KEY, { smeId, domainId, loginId }); }

function guideSteps() {
  const s = guideTarget();
  const sid = s && s.id;
  const login = s && (DB.logins.find(l => l.smeId === sid) || localGet(GUIDE_KEY));
  const smeAcct = login ? [login.domainId, login.loginId] : null;
  const pm = s && s.config ? perm(s) : { importSide: s && s.service !== 'Export', exportSide: s && s.service !== 'Import' };
  const bills = sid ? DB.bills.filter(b => b.smeId === sid) : [];
  const imp = bills.find(b => b.type === 'Import'), exp = bills.find(b => b.type === 'Export');
  const out = sid ? DB.outward.filter(o => o.smeId === sid && o.status !== 'Draft').sort((a, b) => new Date(b.requestDate) - new Date(a.requestDate)) : [];
  const o = out.find(x => x.status !== 'Rejected') || out[0];
  const inw = sid ? DB.inward.filter(i => i.smeId === sid) : [];
  const i = inw[0];
  const dis = sid ? DB.disposals.filter(d => d.smeId === sid && d.status !== 'Rejected') : [];
  const d = dis[0];
  const st = x => x && x.status;
  const at = (x, list) => !!x && list.includes(st(x));
  const MAKER = ['AD2','MAKER'], CHECKER = ['AD2','CHECKER'], OPS = ['AD2','OPS'];

  return [
    { part:'Onboard the partner' },
    { who:'Public', title:'Register a new business', hint:'Use “Fill with a sample business”, set a password, submit.',
      done: !!s, acct:'public', dest:'#/register' },
    { who:'AD2 Maker', title:'Review and price the application', hint:'Set permission, currencies, margins and a charge, then send to the checker.',
      done: s && ['Pending Approval','Approved'].includes(s.status), acct:MAKER, dest: sid && '#/ad2/applications/' + sid },
    { who:'AD2 Checker', title:'Approve the application', hint:'Four eyes: the checker approves what the maker prepared.',
      done: s && s.status === 'Approved', acct:CHECKER, dest: sid && '#/ad2/applications/' + sid },

    { part:'Outward payment (import)', skip: s && !pm.importSide },
    { who:'SME', title:'Add a beneficiary', hint:'Profile → Add beneficiary (the overseas supplier).',
      done: sid && DB.beneficiaries.some(b => b.smeId === sid), acct:smeAcct, dest:'#/sme/profile', skip: s && !pm.importSide },
    { who:'SME', title:'Lodge the import bill', hint:'Import Bill Lodgement → New bill → “Upload invoice and extract”.',
      done: !!imp, acct:smeAcct, dest:'#/sme/bills/import', tab:'form', skip: s && !pm.importSide },
    { who:'AD2 Checker', title:'Accept the import bill', hint:'Bills → To accept → Accept.',
      done: imp && imp.review === 'Accepted', acct:CHECKER, dest:'#/ad2/bills/import', skip: s && !pm.importSide },
    { who:'SME', title:'Raise a DIR payment against the bill', hint:'Choose DIR, purpose S0102, book the rate, allocate the bill, upload the three documents.',
      done: !!o, acct:smeAcct, dest:'#/sme/outward/new', skip: s && !pm.importSide },
    { who:'AD2 Maker', title:'Verify the payment', hint:'Tick the document, sanctions, purpose and beneficiary checks.',
      done: at(o, ['Verified','Authorised','Completed']), acct:MAKER, dest: o && '#/ad2/outward/' + o.id, skip: s && !pm.importSide },
    { who:'AD2 Checker', title:'Authorise the payment', hint:'A different person from the maker.',
      done: at(o, ['Authorised','Completed']), acct:CHECKER, dest: o && '#/ad2/outward/' + o.id, skip: s && !pm.importSide },
    { who:'AD2 Operations', title:'Release the payment', hint:'Debits the INR account, generates the UTR and the SWIFT MT103.',
      done: at(o, ['Completed']), acct:OPS, dest: o && '#/ad2/outward/' + o.id, skip: s && !pm.importSide },

    { part:'Inward receipt (export)', skip: s && !pm.exportSide },
    { who:'SME', title:'Lodge the export bill', hint:'Export Bill Lodgement → New bill.',
      done: !!exp, acct:smeAcct, dest:'#/sme/bills/export', tab:'form', skip: s && !pm.exportSide },
    { who:'AD2 Checker', title:'Accept the export bill', hint:'Bills → Export → Accept.',
      done: exp && exp.review === 'Accepted', acct:CHECKER, dest:'#/ad2/bills/export', skip: s && !pm.exportSide },
    { who:'AD2 Operations', title:'Record the incoming SWIFT credit', hint:'Inward & Disposal → Record incoming remittance → “Fill from an outstanding export bill”.',
      done: !!i, acct:OPS, dest:'#/ad2/inward', open:'in-record', skip: s && !pm.exportSide },
    { who:'SME', title:'Submit the disposal instruction', hint:'Apply the receipt to the export bill, book the rate, upload the TRADE documents.',
      done: !!d, acct:smeAcct, dest: i ? '#/sme/inward/' + i.id + '/dispose' : '#/sme/inward', skip: s && !pm.exportSide },
    { who:'AD2 Maker', title:'Verify the disposal', hint:'Documents, bill match and credit account.',
      done: at(d, ['Verified','Authorised','Processed']), acct:MAKER, dest: d && '#/ad2/disposals/' + d.id, skip: s && !pm.exportSide },
    { who:'AD2 Checker', title:'Authorise the disposal', hint:'',
      done: at(d, ['Authorised','Processed']), acct:CHECKER, dest: d && '#/ad2/disposals/' + d.id, skip: s && !pm.exportSide },
    { who:'AD2 Operations', title:'Credit the account and issue the FIRC', hint:'Knocks off the export bill and credits INR.',
      done: at(d, ['Processed']), acct:OPS, dest: d && '#/ad2/disposals/' + d.id, skip: s && !pm.exportSide },
  ];
}

function guideHTML() {
  if (!GUIDE_OPEN || !DB) return '';
  const steps = guideSteps();
  const s = guideTarget();
  const doable = steps.filter(x => !x.part && !x.skip);
  const next = doable.find(x => !x.done);
  const doneN = doable.filter(x => x.done).length;
  const limited = S && isSME() && s && s.id !== S.smeId;
  let n = 0;
  return `<aside class="guide" aria-label="Demo guide">
    <div class="guide-head"><div><b>Demo guide</b><small>${s ? esc(s.tradingName || s.legalName) + ' · ' + esc(s.id) : 'Start by registering a business'}</small></div>
      <button type="button" data-act="guide-close" aria-label="Close guide">&times;</button></div>
    <div class="guide-prog"><span style="width:${Math.round(doneN / doable.length * 100)}%"></span></div>
    <p class="guide-note">${doneN} of ${doable.length} steps done. Each step signs in as the right person — watch the approval move from role to role.</p>
    ${limited ? `<p class="guide-note warn">Signed in as another business, so some steps cannot be checked from here.</p>` : ''}
    <ol class="guide-steps">${steps.map((x, idx) => {
      if (x.part) return x.skip ? '' : `<li class="part">${esc(x.part)}</li>`;
      if (x.skip) return '';
      n++;
      const isNext = x === next;
      return `<li class="${x.done ? 'done' : ''} ${isNext ? 'next' : ''}">
        <span class="gn">${x.done ? '✓' : n}</span>
        <div><b>${esc(x.title)}</b><small>${esc(x.who)}${x.hint ? ' — ' + esc(x.hint) : ''}</small>
          ${isNext && x.dest ? `<button class="btn btn-primary btn-sm" type="button" data-act="guide-go" data-i="${idx}">Do this step</button>` : ''}
          ${!isNext && !x.done && x.dest && x.acct ? `<button class="btn btn-link" type="button" data-act="guide-go" data-i="${idx}">Go</button>` : ''}</div></li>`;
    }).join('')}</ol>
    ${!next ? `<div class="note note-ok" style="margin:12px"><span><b>Journey complete.</b> Payment released with a UTR, export proceeds credited and the FIRC issued.
      Open Reports or Reconciliation to see it all line up.</span></div>` : ''}
    <div class="guide-foot">
      <button class="btn btn-plain btn-sm" type="button" data-act="guide-restart">Start over with a new business</button>
    </div>
  </aside>`;
}

async function guideGo(i) {
  const step = guideSteps()[i];
  if (!step) return;
  if (step.acct === 'public') {                 /* public step: register */
    setSession(null); resetDrafts(); DRAFT = newDraft();
    location.hash = step.dest; render(); return;
  }
  if (!step.acct) { toast('Register the business first.', 'err'); return; }
  const [d, l] = step.acct;
  if (step.tab) billTab = step.tab;
  const here = S && S.domainId === d && S.loginId === l;
  if (!here) { const ok = await switchTo(d, l, { dest: step.dest }); if (!ok) return; }
  else { location.hash = step.dest; render(); }
  if (step.open === 'in-record') setTimeout(recordInwardModal, 60);
}

/* ---------- notifications ---------------------------------------------------- */
function openNotifications() {
  const list = myNotifications();
  const seen = localGet(seenKey()) || '';
  modal({ title:'Notifications', wide:true, body: list.length ? `<div class="notes">${list.slice(0, 40).map(n => `
      <a class="notif ${n.at > seen ? 'new' : ''}" href="${esc(n.link || '#')}" data-act="notif-open">
        <span>${esc(n.text)}</span><small>${dmyt(n.at)}</small></a>`).join('')}</div>`
    : empty('Nothing yet', 'Updates about your applications and transactions appear here.') });
  localSet(seenKey(), nowISO());
  updateChrome();
}
