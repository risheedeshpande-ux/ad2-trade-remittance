/* ==========================================================================
   Public screens: sign-in, SME registration, application tracker
   ========================================================================== */

function viewLogin() {
  const btn = (a, own) => `<button type="button" data-act="fill-login" data-domain="${esc(a.domainId)}" data-login="${esc(a.loginId)}"${own ? ' data-own="1"' : ''}>
      <b>${esc(a.name || a.loginId)}</b> — ${esc(a.role)}${a.tradingName ? ' · ' + esc(a.tradingName) : ''}
      <small>${esc(a.domainId)} / ${esc(a.loginId)}</small></button>`;
  const demo = DB.logins.filter(a => a.demo && a.active !== false);
  const staff = demo.filter(a => a.domainId === 'AD2').sort((a, b) => (DB.roles.find(r => r.id === a.role)?.order || 0) - (DB.roles.find(r => r.id === b.role)?.order || 0));
  const users = demo.filter(a => a.role === 'SME User'), applicants = demo.filter(a => a.role === 'SME Applicant');
  const masters = demo.filter(a => a.role === MASTER_ROLE);
  const registered = DB.logins.filter(a => !a.demo);
  const group = (title, list, open, own) => list.length ? `<details ${open ? 'open' : ''}><summary>${esc(title)} (${list.length})</summary>${list.map(a => btn(a, own)).join('')}</details>` : '';
  const passHint = API.mode === 'local'
    ? 'Offline demo — any value is accepted.'
    : API.passcodeRequired ? 'Demo accounts use the passcode for this deployment. Registered businesses use their own password.'
                           : 'Demo accounts use the passcode <b>demo</b>. Registered businesses use their own password.';

  return `${simBanner()}<div class="login-wrap">
    <div class="login-art">
      <h2>Trade remittance for small and mid-sized exporters and importers</h2>
      <p>Onboard once, then transact: outward payments, inward disposal, bill lodgement and knock-off in a single portal.</p>
      <div class="feats">
        <div><span>1</span>Digital onboarding, priced by the AD2 maker and approved by AD2 Compliance</div>
        <div><span>2</span>AIR, DIR and OTT payments with the documents each purpose code needs</div>
        <div><span>3</span>Every transaction verified, authorised and released by three different people</div>
        <div><span>4</span>Export proceeds disposed against lodged bills, with the FIRC issued on credit</div>
      </div>
    </div>
    <div class="login-panel">
      <div class="logo">Remit<b>4</b>Me</div>
      <div class="sub">AD2 Trade Remittance</div>
      <h1>Sign In</h1>
      <form class="f fields" data-act="do-login" autocomplete="on">
        <div class="f"><label for="li-domain">Domain ID<span class="req">*</span></label>
          <input id="li-domain" name="domain" type="text" placeholder="Domain ID" autocomplete="organization" required>
          <div class="err">Enter a Domain ID.</div></div>
        <div class="f"><label for="li-user">Login ID<span class="req">*</span></label>
          <input id="li-user" name="login" type="text" placeholder="Login ID" autocomplete="username" required>
          <div class="err">Enter a Login ID.</div></div>
        <div class="f"><label for="li-pass">Password<span class="req">*</span></label>
          <input id="li-pass" name="pass" type="password" placeholder="Password" autocomplete="current-password" required>
          <div class="hint">${passHint}</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary" type="submit">Sign in</button>
          <button class="btn btn-plain" type="button" data-act="go" data-href="#/register">Register your business</button>
          <button class="btn btn-link" type="button" data-act="go" data-href="#/status">Track an application</button>
        </div>
      </form>
      <div class="demo-note"><b>Demo accounts — click to fill</b>
        ${masters.length ? `<div class="mt-login">${masters.map(a => `<button type="button" data-act="fill-login" data-domain="${esc(a.domainId)}" data-login="${esc(a.loginId)}">
            <b>Master test user</b> — every role, one sign-in<small>${esc(a.domainId)} / ${esc(a.loginId)}</small></button>`).join('')}
          <span>One sign-in to test everything: opens any customer or AD2 user in one click and walks each item to the person who takes the next step.</span></div>` : ''}
        ${group('AD2 staff', staff, true)}
        ${group('Businesses', users, true)}
        ${group('Applications in progress', applicants, false)}
        ${group('Registered through the portal', registered, false, true)}
      </div>
    </div>
  </div>`;
}

/* ---------- registration (8 steps + review) ------------------------------- */
function newDraft() {
  return {
    legalName:'', tradingName:'', constitution:'', incorporationDate:'', regNumber:'',
    country:'India', address:'', domainId:'', ad2Name:'AD2 Trade Services', category:'SME',
    pan:'', gstin:'', iec:'', contactName:'', designation:'', email:'', mobile:'',
    industry:'', description:'', importVolume:'', exportVolume:'', countries:[], requestedCurrencies:[], service:'',
    signatories:[], banks:[], docs:{}, loginId:'ADMIN', password:'', password2:'',
    offline: isAD2(), step:0,
  };
}
const ONBOARD_STEPS = ['Business details','Domain and sign-in','Identifiers','Contact','Business profile','Bank accounts','Documents','Review'];
const slugDomain = name => (name || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);

/* The application in progress is kept in this browser (without passwords)
   so a reload or a closed tab does not lose it. */
const obKey = () => 'ad2-ob-draft-' + (isAD2() ? 'offline' : 'digital');
function saveObDraft() {
  if (!DRAFT || EMBEDDED) return;
  const { password, password2, restored, ...keep } = DRAFT;
  localSet(obKey(), { ...keep, savedAt: nowISO() });
}
function restoreObDraft() {
  const d = localGet(obKey());
  if (!d || !d.legalName && !d.pan && !(d.banks || []).length) return null;
  return { ...newDraft(), ...d, password:'', password2:'', offline: isAD2(), restored: d.savedAt };
}
function clearObDraft() { try { localStorage.removeItem(obKey()); } catch (e) {} }

function viewRegister() {
  if (!DRAFT) DRAFT = restoreObDraft() || newDraft();
  saveObDraft();
  const d = DRAFT, step = d.step;
  const steps = ONBOARD_STEPS.map((s, i) => `
    <button type="button" data-act="ob-step" data-i="${i}"
      ${i === step ? 'aria-current="step"' : ''} class="${i < step ? 'done' : ''}">
      <span class="n">${i < step ? '✓' : i + 1}</span>${esc(s)}</button>`).join('');
  const bodies = [obBusiness, obDomain, obIdent, obContact, obProfile, obBanks, obDocs, obReview];
  return `${publicTop(!d.offline)}
    ${d.offline ? '' : simBanner()}
    <div class="page" style="max-width:1000px;margin:0 auto">
      <div class="page-head"><div>
        <h1>${d.offline ? 'Offline application' : 'Register your business'}</h1>
        <p>${d.offline ? 'Captured by AD2 on the business’s behalf. The channel is recorded as Offline.'
                       : 'Digital onboarding. An AD2 maker reviews and prices your application, and AD2 Compliance approves it.'}</p></div>
        <div class="acts">
          <button class="btn btn-ghost btn-sm" type="button" data-act="ob-sample">Fill with a sample business</button>
          ${d.offline ? `<button class="btn btn-plain btn-sm" type="button" data-act="go" data-href="#/ad2/applications">Cancel</button>` : ''}
        </div></div>
      ${d.restored ? `<div class="note note-info" style="margin-bottom:16px"><span>We restored the application you were filling in (saved ${dmyt(d.restored)}).
        <button class="btn btn-link" type="button" data-act="ob-restart">Start again</button></span></div>` : ''}
      <div class="card">
        <div class="stepper">${steps}</div>
        <div class="card-body">${bodies[step](d)}</div>
        <div class="formfoot">
          <button class="btn btn-plain" type="button" data-act="ob-back" ${step === 0 ? 'disabled' : ''}>Back</button>
          <div class="spacer"></div>
          ${step < 7
            ? `<button class="btn btn-primary" type="button" data-act="ob-next">Next</button>`
            : `<button class="btn btn-primary" type="button" data-act="ob-submit">Submit application</button>`}
        </div>
      </div>
    </div>`;
}

const fld = (id, label, val, opts = {}) => `
  <div class="f" data-fld="${id}">
    <label for="ob-${id}">${esc(label)}${opts.required ? '<span class="req">*</span>' : ''}</label>
    ${opts.type === 'textarea'
      ? `<textarea id="ob-${id}" data-k="${id}">${esc(val)}</textarea>`
      : opts.options
        ? `<select id="ob-${id}" data-k="${id}"><option value="">Select…</option>${
            opts.options.map(o => `<option ${val === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
        : `<input id="ob-${id}" data-k="${id}" type="${opts.type || 'text'}" value="${esc(val)}"
             ${opts.readonly ? 'readonly disabled' : ''} placeholder="${esc(opts.ph || '')}" ${opts.auto ? `autocomplete="${opts.auto}"` : ''}>`}
    ${opts.hint ? `<div class="hint">${esc(opts.hint)}</div>` : ''}
    <div class="err">${esc(opts.err || 'This field is required.')}</div>
  </div>`;

function obBusiness(d) {
  return `<div class="fields g2 grid">
    ${fld('legalName','Legal name',d.legalName,{required:true})}
    ${fld('tradingName','Trading name',d.tradingName,{})}
    ${fld('constitution','Constitution',d.constitution,{required:true,options:DB.constitutions,
      hint:'HUF and Individual are available for sole consultants and family entities.'})}
    ${fld('incorporationDate','Incorporation / registration date',d.incorporationDate,{required:true,type:'date'})}
    ${fld('regNumber','Registration number (CIN / LLPIN / other)',d.regNumber,{required:true})}
    ${fld('country','Country',d.country,{required:true})}
    <div class="span2">${fld('address','Registered address',d.address,{required:true,type:'textarea'})}</div>
  </div>`;
}
function obDomain(d) {
  return `<div class="note note-info" style="margin-bottom:16px"><span>
      Your Domain ID identifies your business when you sign in. It is generated from your legal name and you may change it.
      ${d.offline ? 'The business signs in with the demo passcode until it is issued its own credentials.' : 'Choose the Login ID and password you will use to sign in.'}</span></div>
    <div class="fields g2 grid">
      ${fld('ad2Name','AD2 name',d.ad2Name,{readonly:true})}
      ${fld('category','Category',d.category,{readonly:true})}
      ${fld('domainId','Domain ID',d.domainId || slugDomain(d.legalName),{required:true,
        hint:'3–12 capital letters or digits.', err:'Enter a Domain ID of 3–12 letters or digits.'})}
      ${fld('loginId','Login ID',d.loginId,{required:true, hint:'3–20 capital letters or digits.'})}
      ${d.offline || API.mode === 'local' ? '' : `
        ${fld('password','Password',d.password,{required:true,type:'password',auto:'new-password',
          hint:'At least 8 characters with a letter and a digit.'})}
        ${fld('password2','Confirm password',d.password2,{required:true,type:'password',auto:'new-password'})}`}
    </div>`;
}
function obIdent(d) {
  return `<div class="fields g2 grid">
    ${fld('pan','PAN',d.pan,{required:true, ph:'AAAAA9999A'})}
    ${fld('gstin','GSTIN',d.gstin,{required:true, ph:'27AAAAA9999A1Z5'})}
    ${fld('iec','Importer Exporter Code (IEC)',d.iec,{required:true, ph:'10 characters',
      hint:'Mandatory. Regular transacting exporters and importers must hold an IEC.',
      err:'IEC is mandatory for all regular transacting customers.'})}
  </div>`;
}
function obContact(d) {
  return `<div class="fields g2 grid">
    ${fld('contactName','Contact name',d.contactName,{required:true})}
    ${fld('designation','Designation',d.designation,{required:true})}
    ${fld('email','Email',d.email,{required:true,type:'email'})}
    ${fld('mobile','Mobile number',d.mobile,{required:true,type:'tel'})}
  </div>
  <h3 style="font-size:var(--fs-md);margin:24px 0 10px">Authorised signatories<span class="req">*</span></h3>
  <div class="card" style="box-shadow:none"><div class="tablewrap"><table class="dt">
    <thead><tr><th>Name</th><th>Designation</th><th>Email</th><th>Mobile</th><th>Signs</th><th>Limit (USD)</th><th></th></tr></thead>
    <tbody>${d.signatories.length ? d.signatories.map((g, i) => `<tr>
      ${['name','designation','email','mobile'].map(f => `<td><input class="alloc-in" data-sig="${i}" data-f="${f}" value="${esc(g[f] || '')}" aria-label="Signatory ${i + 1} ${f}"></td>`).join('')}
      <td><select data-sig="${i}" data-f="authority" aria-label="Signatory ${i + 1} signing authority">${['Singly','Jointly'].map(o => `<option ${g.authority === o ? 'selected' : ''}>${o}</option>`).join('')}</select></td>
      <td><input class="alloc-in" type="number" min="0" data-sig="${i}" data-f="limit" value="${esc(g.limit ?? '')}" placeholder="No limit" aria-label="Signatory ${i + 1} limit"></td>
      <td><button class="btn btn-link" type="button" data-act="ob-sig-del" data-i="${i}">Remove</button></td></tr>`).join('')
    : `<tr><td colspan="7"><div class="empty"><h3>No signatories added</h3><p>Add at least one person authorised to sign remittance instructions.</p></div></td></tr>`}</tbody>
  </table></div></div>
  <button class="btn btn-ghost" style="margin-top:14px" type="button" data-act="ob-sig-add">Add signatory</button>`;
}
function obProfile(d) {
  const curs = DB.currencies.map(c => `
    <label><input type="checkbox" data-k="requestedCurrencies" value="${c.code}"
      ${d.requestedCurrencies.includes(c.code) ? 'checked' : ''}> ${c.code}</label>`).join('');
  const svc = ['Import','Export','Both'].map(s => `
    <label><input type="radio" name="svc" data-k="service" value="${s}" ${d.service === s ? 'checked' : ''}> ${s}</label>`).join('');
  return `<div class="fields grid g2">
      ${fld('industry','Industry',d.industry,{required:true})}
      ${fld('importVolume','Expected annual import volume',d.importVolume,{ph:'e.g. USD 1,500,000',hint:'Required for Import or Both.'})}
      ${fld('exportVolume','Expected annual export volume',d.exportVolume,{ph:'e.g. USD 1,000,000',hint:'Required for Export or Both.'})}
      ${fld('countries','Countries traded with',d.countries.join(', '),{required:true,ph:'e.g. Germany, Japan, United States',hint:'Separate countries with commas.'})}
      <div class="span2">${fld('description','Business description',d.description,{required:true,type:'textarea'})}</div>
    </div>
    <div style="margin-top:20px">
      <label style="font-size:var(--fs-sm);font-weight:500;color:var(--ink-soft)">Requested currencies<span class="req">*</span></label>
      <div class="pillset" style="margin-top:6px" data-fld="requestedCurrencies">${curs}</div>
    </div>
    <div style="margin-top:20px">
      <label style="font-size:var(--fs-sm);font-weight:500;color:var(--ink-soft)">Requested service<span class="req">*</span></label>
      <div class="pillset" style="margin-top:6px" data-fld="service">${svc}</div>
      <p class="hint" style="margin-top:8px;font-size:var(--fs-xs);color:var(--muted)">Import opens outward payments and import bills. Export opens inward disposal and export bills.</p>
    </div>`;
}
function obBanks(d) {
  const rows = d.banks.length ? d.banks.map((b, i) => `
    <tr><td><b>${esc(b.bank)}</b><br><span style="color:var(--muted);font-size:var(--fs-sm)">${esc(b.branch || '')}</span></td>
      <td>${esc(b.accountNumber)}</td><td>${esc(b.ifsc)}</td><td>${esc(b.currency)} · ${esc(b.type)}</td>
      <td>${b.verified ? '<span class="badge b-green">Verified</span>' : `<button class="btn btn-ghost btn-sm" type="button" data-act="ob-penny" data-i="${i}">Verify (PennyDrop)</button>`}</td>
      <td><button class="btn btn-link" type="button" data-act="ob-bank-del" data-i="${i}">Remove</button></td></tr>`).join('')
    : `<tr><td colspan="6"><div class="empty"><h3>No accounts added</h3>
        <p>Add at least one INR account. It becomes your account master for debits and credits.</p></div></td></tr>`;
  return `<div class="note note-info" style="margin-bottom:16px"><span>
      Accounts added here form your account master. Payments debit, and export proceeds credit, a verified INR account from this list.</span></div>
    <div class="card" style="box-shadow:none"><div class="tablewrap"><table class="dt">
      <thead><tr><th>Bank</th><th>Account number</th><th>IFSC</th><th>Currency / type</th><th>Verification</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>
    <button class="btn btn-ghost" style="margin-top:14px" type="button" data-act="ob-bank-add">Add bank account</button>`;
}
function obDocs(d) {
  return docRows(DB.onboardDocs.map(x => ({ ...x, note: x.required ? 'Required' : 'Optional' })), d.docs, 'ob') +
    `<p style="color:var(--muted);font-size:var(--fs-sm);margin-top:14px">
      Only the file name and size are recorded in this demo — file contents never leave your device.</p>`;
}
function obReview(d) {
  const row = (k, v) => `<div><div class="k">${esc(k)}</div><div class="v">${esc(v || '—')}</div></div>`;
  const missing = onboardMissing(d);
  return `
    ${missing.length ? `<div class="note note-err" style="margin-bottom:16px">
      <span>Complete before submitting: ${esc(missing.join('; '))}</span></div>`
      : `<div class="note note-ok" style="margin-bottom:16px"><span>All required fields and documents are complete.</span></div>`}
    <h3 style="font-size:var(--fs-md);margin-bottom:10px">Business</h3>
    <div class="kv">${row('Legal name',d.legalName)}${row('Trading name',d.tradingName)}
      ${row('Constitution',d.constitution)}${row('Registration number',d.regNumber)}
      ${row('Domain ID',d.domainId)}${row('Login ID',d.loginId)}</div>
    <h3 style="font-size:var(--fs-md);margin:22px 0 10px">Identifiers</h3>
    <div class="kv">${row('PAN',d.pan)}${row('GSTIN',d.gstin)}${row('IEC',d.iec)}</div>
    <h3 style="font-size:var(--fs-md);margin:22px 0 10px">Profile</h3>
    <div class="kv">${row('Industry',d.industry)}${row('Requested service',d.service)}
      ${row('Expected import volume',d.importVolume)}${row('Expected export volume',d.exportVolume)}
      ${row('Requested currencies',d.requestedCurrencies.join(', '))}${row('Countries traded with',d.countries.join(', '))}</div>
    <h3 style="font-size:var(--fs-md);margin:22px 0 10px">Authorised signatories</h3>
    <div class="kv">${d.signatories.length ? d.signatories.map(g =>
      row(g.name, `${g.designation} · signs ${String(g.authority).toLowerCase()}${g.limit ? ' up to USD ' + money(+g.limit) : ''}`)).join('') : row('Signatories','None added')}</div>
    <h3 style="font-size:var(--fs-md);margin:22px 0 10px">Bank accounts</h3>
    <div class="kv">${d.banks.length ? d.banks.map(b =>
      row(b.bank, `${b.accountNumber} · ${b.currency}${b.verified ? ' · verified' : ' · unverified'}`)).join('') : row('Accounts','None added')}</div>
    <div class="checks" style="margin-top:24px">
      <label class="chk"><input type="checkbox" id="declare">
        <span>I confirm the information and documents provided are accurate and complete.
        <small>Required before submission.</small></span></label>
    </div>`;
}
function onboardMissing(d) {
  const m = [];
  if (!d.legalName) m.push('legal name');
  if (!d.constitution) m.push('constitution');
  if (!d.incorporationDate) m.push('incorporation date');
  if (!d.regNumber) m.push('registration number');
  if (!d.address) m.push('registered address');
  if (!/^[A-Z0-9]{3,12}$/.test(d.domainId || '')) m.push('Domain ID (3–12 letters or digits)');
  if (!/^[A-Z0-9]{3,20}$/.test(String(d.loginId || '').toUpperCase())) m.push('Login ID');
  if (!d.offline && API.mode === 'server') {
    if ((d.password || '').length < 8) m.push('password of at least 8 characters');
    else if (d.password !== d.password2) m.push('matching password confirmation');
  }
  if (!d.pan) m.push('PAN');
  if (!d.gstin) m.push('GSTIN');
  if (!d.iec) m.push('IEC (mandatory)');
  if (!d.contactName || !d.email || !d.mobile || !d.designation) m.push('contact details');
  if (!d.industry || !d.description) m.push('business profile');
  if (d.service !== 'Export' && !d.importVolume) m.push('expected annual import volume');
  if (d.service !== 'Import' && !d.exportVolume) m.push('expected annual export volume');
  if (!d.countries.length) m.push('countries traded with');
  if (!d.signatories.length) m.push('at least one authorised signatory');
  else if (d.signatories.some(g => !g.name || !g.designation || !g.email || !g.mobile)) m.push('signatory name, designation, email and mobile');
  if (!d.requestedCurrencies.length) m.push('at least one requested currency');
  if (!d.service) m.push('requested service');
  if (!d.banks.length) m.push('at least one bank account');
  const docs = DB.onboardDocs.filter(x => x.required && !d.docs[x.id]).map(x => x.name);
  if (docs.length) m.push('documents: ' + docs.join(', '));
  return m;
}

/* A realistic, valid sample so a live demo does not stall on typing. */
function sampleBusiness() {
  const n = Math.floor(100 + Math.random() * 899);
  const dom = 'DECCAN' + n;
  const file = id => ({ filename: `${id}-${dom.toLowerCase()}.pdf`, size: (140 + n % 300) + ' KB', type:'application/pdf', at: nowISO() });
  return {
    legalName:`Deccan Precision Tools ${n} Private Limited`, tradingName:`Deccan Precision ${n}`, constitution:'Private Limited',
    incorporationDate:'2017-03-14', regNumber:`U29220KA2017PTC10${n}`, country:'India',
    address:`Plot ${n}, Peenya Industrial Area, Bengaluru 560058`, domainId: dom,
    pan:`AAECD${1000 + n}K`.slice(0, 10), gstin:`29AAECD${1000 + n}K1Z${n % 10}`, iec:`07170${10000 + n}`.slice(0, 10),
    contactName:'Anand Kulkarni', designation:'Director — Finance', email:`anand@deccan${n}.example`, mobile:'+91 98450 ' + String(10000 + n * 7).slice(0, 5),
    industry:'Machine tools', description:'Imports CNC tooling and inserts from Germany and Japan; exports precision fixtures to the EU and US.',
    importVolume:'USD 1,500,000', exportVolume:'USD 1,000,000', countries:['Germany','Japan','United States'],
    requestedCurrencies:['USD','EUR'], service:'Both',
    signatories:[{ name:'Anand Kulkarni', designation:'Director — Finance', email:`anand@deccan${n}.example`, mobile:'+91 98450 ' + String(10000 + n * 7).slice(0, 5), authority:'Singly', limit:'' },
                 { name:'Priya Rao', designation:'Finance Controller', email:`priya@deccan${n}.example`, mobile:'+91 98860 ' + String(20000 + n).slice(0, 5), authority:'Jointly', limit:'250000' }],
    banks:[{ bank:'HDFC Bank', branch:'Peenya, Bengaluru', accountNumber:`502000${String(40000000 + n * 1111).slice(0, 8)}`, ifsc:'HDFC0000432', currency:'INR', type:'Current', verified:true }],
    docs:{ coi:file('coi'), pan:file('pan'), gst:file('gst'), iec:file('iec'), addr:file('address') },
  };
}

/* ---------- application tracker (public) ---------------------------------- */
let STATUS_Q = { app:'', domain:'', result:null, error:'' };
function viewStatus() {
  const r = STATUS_Q.result;
  return `${publicTop(true)}
    ${simBanner()}
    <div class="page" style="max-width:760px;margin:0 auto">
      <div class="page-head"><div><h1>Track an application</h1>
        <p>Enter the Application ID from your confirmation and your Domain ID.</p></div></div>
      <div class="card"><div class="card-body">
        <form data-act="status-lookup" class="grid g2 fields" style="align-items:end">
          <div class="f"><label for="st-app">Application ID</label><input id="st-app" type="text" placeholder="SME-1007" value="${esc(STATUS_Q.app)}"></div>
          <div class="f"><label for="st-dom">Domain ID</label><input id="st-dom" type="text" placeholder="YOURDOMAIN" value="${esc(STATUS_Q.domain)}"></div>
          <div class="span2"><button class="btn btn-primary" type="submit">Check status</button></div>
        </form>
        ${STATUS_Q.error ? `<div class="note note-err" style="margin-top:18px"><span>${esc(STATUS_Q.error)}</span></div>` : ''}
        ${r ? `<div class="kv" style="margin-top:22px">
            <div><div class="k">Application</div><div class="v">${esc(r.id)}</div></div>
            <div><div class="k">Business</div><div class="v">${esc(r.legalName)}</div></div>
            <div><div class="k">Channel</div><div class="v">${esc(r.source)}</div></div>
            <div><div class="k">Submitted</div><div class="v">${dmy(r.submittedAt)}</div></div>
            <div><div class="k">Status</div><div class="v">${badge(r.status)}</div></div>
            <div><div class="k">With</div><div class="v">${esc(r.pendingWith)}</div></div>
          </div>
          ${r.query ? `<div class="note note-warn" style="margin-top:16px"><span><b>AD2 needs:</b> ${esc(r.query)}<br>
            Sign in with your Domain ID to respond.</span></div>` : ''}
          ${r.status === 'Approved' ? `<div class="note note-ok" style="margin-top:16px"><span>Approved — sign in to start transacting.</span></div>` : ''}` : ''}
      </div></div>
    </div>`;
}
