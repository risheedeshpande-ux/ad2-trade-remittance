/* ==========================================================================
   Treasury Management Portal — operations (OPS-01…03) and administration
   (ADM-01…05). Regional bulk teams request currency; finance reconciles card
   settlements; the administrator runs users, masters, the organisation and
   integrations — every control change through a checker.
   ========================================================================== */
'use strict';

/* ---------- OPS-01 bulk currency bookings (regional bulk) ------------------------------ */
screen({ id: 'OPS-01', title: 'Bulk currency bookings',
  sub: () => `${esc(myScopeName())} &nbsp;·&nbsp; request currency for a branch; treasury books it with a bank and a checker confirms before stock moves`,
  acts: () => can('tmp.bulk.request') ? btn('Raise a booking request', 'ob-raise') : '',
  render(q) {
    const all = (DB.bulkRequests || []).slice().sort((a, b) => String(b.raisedAt).localeCompare(String(a.raisedAt)));
    const grp = r => r.status === 'Needs detail' ? 'Open' : r.status === 'With Treasury' || r.status === 'Awaiting checker' ? 'With treasury' : r.status === 'Booked' ? 'Booked' : 'Rejected';
    const tabs = ['Open', 'With treasury', 'Booked', 'Rejected'];
    const tab = tabs.includes(q.tab) ? q.tab : 'With treasury';
    const inv = V.inventory(DB, NOW());
    return `${all.some(r => r.status === 'Needs detail') ? banner('warn', 'Treasury needs more detail', `<br>${all.filter(r => r.status === 'Needs detail').map(r => `${esc(r.id)}: ${esc(r.query || '')}`).join('<br>')}`) : ''}
    ${statusTabs('tab', tabs.map(t => [t, all.filter(r => grp(r) === t).length]), tab)}
    ${table('ops01', bulkCols(false), all.filter(r => grp(r) === tab), { name: 'Bulk booking requests', noun: 'request' })}
    ${table('ops01-inv', [{ h: 'Location', v: r => esc(node(r.locationId)), csv: r => node(r.locationId) }, { h: 'Currency', k: 'currency' }, { h: 'Stock', num: true, v: r => num(r.qty, r.currency) },
      { h: 'Aged', num: true, v: r => num(r.aged, r.currency) }, { h: 'Freshness', v: r => fresh(freshOf(r.asOf), r.asOf), csv: r => r.asOf }], inv, { title: 'Stock in your region', name: 'Regional stock', noun: 'holding' })}`;
  } });
act('ob-raise', () => {
  const sc = myBranch();
  const brs = V.branches(DB).filter(b => !sc || V.descendants(DB, sc).has(b.id));
  cmdDlg({ title: 'Raise a bulk booking request', ok: 'Send to treasury', body: `<div class=fgrid>${field('Branch', `<select id=or-br>${options(brs.map(b => [b.id, b.name]))}</select>`, { req: true })}
    ${field('Currency', `<select id=or-cur>${options(CURS(), 'USD')}</select>`)}${field('Amount', `<input type=text id=or-amt data-required inputmode=decimal>`, { req: true })}
    ${field('Required by', `<input type=date id=or-date value="${todayIST()}" min="${todayIST()}">`)}</div>${field('Purpose', `<input type=text id=or-purpose value="Currency inventory">`)}` },
  'bulk.request', () => ({ branchId: $('#or-br').value, currency: $('#or-cur').value, amount: Number($('#or-amt').value.replace(/,/g, '')), requiredDate: $('#or-date').value, purpose: $('#or-purpose').value }));
});
act('bk-update', el => { const r = (DB.bulkRequests || []).find(x => x.id === el.dataset.id); cmdDlg({ title: `Respond on ${esc(r.id)}`, ok: 'Send back to treasury', body: `<p class=small>Treasury asked: <b>${esc(r.query || '')}</b></p>
  <div class=fgrid>${field('Amount', `<input type=text id=bu-amt value="${r.amount}">`)}${field('Required by', `<input type=date id=bu-date value="${esc(r.requiredDate)}">`)}</div>${reasonBody('', 'Your answer')}` },
  'bulk.update', () => ({ id: r.id, amount: Number($('#bu-amt').value.replace(/,/g, '')), requiredDate: $('#bu-date').value, note: $('#dlg-reason').value })); });

/* ---------- OPS-02 settlement reconciliation (finance) -------------------------------------- */
screen({ id: 'OPS-02', title: 'Settlement reconciliation',
  sub: () => `Map issuer settlements to the card sales they pay for &nbsp;·&nbsp; only INR-funded sales of the same issuer and currency &nbsp;·&nbsp; an adjustment goes to a checker`,
  render(q) {
    const sts = (DB.cardSettlements || []).map(s => ({ ...s, r: V.reconOf(DB, s), left: round2(s.amount - (s.mappings || []).reduce((t, m) => t + m.amount, 0)) }));
    const s = sts.find(x => x.id === q.st) || sts.find(x => x.left > 0.005) || sts[0];
    let body = '';
    if (s) {
      const inv = (DB.cardActivity || []).filter(x => x.kind === 'Sale' && x.funding !== 'EEFC' && V.issuerOf(DB, x.prefix) === s.issuer && x.currency === s.currency && x.amount - (x.mapped || 0) > 0.005)
        .sort((a, b) => String(a.at).localeCompare(String(b.at)));
      let left = s.left;
      body = `<div class=recon id=rc-recon data-avail="${s.left}" data-cur="${esc(s.currency)}"><div><span>${esc(s.id)} unmapped</span><b>${fcy(s.left, s.currency)}</b></div>
        <div><span>Selected</span><b id=rc-sel>${fcy(0, s.currency)}</b></div><div class=left><span>Left unmapped</span><b id=rc-left>${fcy(s.left, s.currency)}</b></div><span class=sp></span>
        <div><span>Residual (INR)</span><b>${inr(s.r.residualInr)}</b></div></div>
        <div class="banner bad" id=rc-over hidden><span>&#9888;</span><div><b>More than the settlement</b>Reduce an amount.</div></div>
        ${table('ops02-inv', [{ h: '', w: '32px', v: x => `<input type=checkbox data-rc="${esc(x.id)}" data-change="rc-recalc" aria-label="Select ${esc(x.id)}">`, csv: false },
          { h: 'Invoice', v: x => esc(x.id), cls: 'ref' }, { h: 'Prefix', v: x => esc(x.prefix) }, { h: 'Sale', num: true, v: x => num(x.amount, x.currency) }, { h: 'Mapped', num: true, v: x => num(x.mapped || 0, x.currency) },
          { h: 'Pending', num: true, v: x => num(x.amount - (x.mapped || 0), x.currency) }, { h: 'Sold', v: x => istDT(x.at), csv: x => x.at },
          { h: 'Map amount', num: true, csv: false, v: x => { const a = Math.min(round2(x.amount - (x.mapped || 0)), Math.max(0, left)); left -= a; return `<input type=text data-rcamt="${esc(x.id)}" data-input="rc-recalc" value="${a > 0 ? a : ''}">`; } }],
          inv, { title: `${esc(s.issuer)} ${esc(s.currency)} sales awaiting settlement`, name: 'Invoices to map', noun: 'invoice', empty: 'No INR-funded sales of this issuer and currency are pending.' })}
        <div class=bar>${can('tmp.finance') ? btn('Confirm mapping', 'rc-map', { id: s.id }) + btn('Apply adjustment', 'rc-adjust', { id: s.id }, 'sec') : ''}</div>`;
    }
    return `${table('ops02', [{ h: 'Settlement', v: x => `<a href="#/OPS-02?st=${esc(x.id)}">${esc(x.id)}</a>`, csv: x => x.id }, { h: 'Issuer', v: x => esc(x.issuer) }, { h: 'Amount', num: true, v: x => fcy(x.amount, x.currency) },
      { h: 'Mapped', num: true, v: x => num(x.r.mapped, x.currency) }, { h: 'Unmapped', num: true, v: x => num(x.left, x.currency) }, { h: 'Residual (INR)', num: true, v: x => inrN(x.r.residualInr) },
      { h: 'Received', v: x => istDT(x.receivedAt), csv: x => x.receivedAt }, { h: 'Status', v: x => st(x.left <= 0.005 ? 'Complete' : x.r.mapped > 0 ? 'Partial' : 'Open') }],
      sts, { title: 'Issuer settlements', name: 'Issuer settlements', noun: 'settlement', row: x => s && x.id === s.id ? ' class=sel' : '' })}${body}`;
  },
  after() { if ($('#rc-recon')) ACTS['rc-recalc'](); } });
act('rc-recalc', () => {
  const box = $('#rc-recon'); if (!box) return;
  const avail = Number(box.dataset.avail), cur = box.dataset.cur;
  let sel = 0;
  $$('[data-rc]').forEach(cb => { const i = $(`[data-rcamt="${cb.dataset.rc}"]`); if (cb.checked) sel += Number(String(i && i.value || 0).replace(/,/g, '')) || 0; cb.closest('tr').classList.toggle('sel', cb.checked); });
  sel = round2(sel);
  $('#rc-sel').textContent = fcy(sel, cur); $('#rc-left').textContent = fcy(Math.max(0, avail - sel), cur);
  $('#rc-over').hidden = sel <= avail + 0.005;
  const b = $('[data-act="rc-map"]'); if (b) b.disabled = !(sel > 0) || sel > avail + 0.005;
});
act('rc-map', el => {
  const rows = $$('[data-rc]').filter(c => c.checked).map(c => ({ invoiceId: c.dataset.rc, amount: Number(String(($(`[data-rcamt="${c.dataset.rc}"]`) || {}).value || 0).replace(/,/g, '')) }));
  if (!rows.length) { toast('Tick at least one invoice.', 'warn'); return; }
  run('card.map', { id: el.dataset.id, rows });
});
act('rc-adjust', el => cmdDlg({ title: `Adjustment on ${esc(el.dataset.id)}`, ok: 'Send to checker', body: `${field('Adjustment (INR)', `<input type=text id=ra-amt data-required inputmode=decimal>`, { req: true })}${reasonBody('', 'Adjustment reason', 'e.g. issuer fee, rounding')}` },
  'recon.adjust', () => ({ id: el.dataset.id, amount: Number($('#ra-amt').value.replace(/,/g, '')), reason: $('#dlg-reason').value })));

/* ---------- OPS-03 reports ------------------------------------------------------------------ */
screen({ id: 'OPS-03', title: 'Reports',
  sub: () => `${esc(myScopeName())} &nbsp;·&nbsp; exports for your work`,
  render() {
    const fin = can('tmp.finance');
    if (fin) return `${pendingMis(false)}${table('ops03-map', [{ h: 'Settlement', k: 'id' }, { h: 'Issuer', k: 'issuer' }, { h: 'CCY', k: 'currency' }, { h: 'Amount', num: true, v: s => num(s.amount, s.currency) },
      { h: 'Mappings', v: s => (s.mappings || []).map(m => `${m.invoiceId} ${num(m.amount, s.currency)}`).join('; ') || '—', cls: 'wrap' }], DB.cardSettlements || [], { title: 'Settlement mappings', name: 'Settlement mappings', noun: 'settlement' })}`;
    return table('ops03', bulkCols(false).filter(c => c.h), DB.bulkRequests || [], { title: 'Bulk booking register', name: 'Bulk booking register', noun: 'request' });
  } });

/* ---------- ADM-01 users ------------------------------------------------------------------------ */
const TMP_ROLE_IDS = () => (DB.roles || []).filter(r => r.portal === 'TMP').map(r => r.id);
screen({ id: 'ADM-01', title: 'User management',
  sub: () => `Treasury Management Portal users &nbsp;·&nbsp; a new user, a role change or a scope change goes to a checker; enabling or disabling is immediate and audited`,
  acts: () => can('tmp.admin') ? btn('Add user', 'au-add') : '',
  render(q) {
    const users = (DB.logins || []).filter(l => TMP_ROLE_IDS().includes(l.role));
    const pend = pendingApprovals().filter(a => ['New user', 'User change'].includes(a.type));
    const tabs = ['Active', 'Pending approval', 'Disabled'];
    const tab = tabs.includes(q.tab) ? q.tab : 'Active';
    const cnt = { Active: users.filter(u => u.active !== false).length, 'Pending approval': pend.length, Disabled: users.filter(u => u.active === false).length };
    return `${statusTabs('tab', tabs.map(t => [t, cnt[t]]), tab)}
    ${tab === 'Pending approval' ? table('adm01-p', [{ h: 'Item', v: a => golink(esc(a.id), 'T-21', { id: a.id, tab: 'Pending' }), csv: a => a.id }, { h: 'Change', v: a => esc(a.type) }, { h: 'What', v: a => esc(a.title) },
        { h: 'Detail', v: a => (a.diff || []).map(d => `${esc(d.field)}: ${esc(d.before)} → <b>${esc(d.after)}</b>`).join('<br>'), cls: 'wrap' }, { h: 'Maker', v: a => esc(a.maker) }, { h: 'Waiting', v: a => ago(a.submittedAt), csv: a => a.submittedAt }], pend, { name: 'Pending user changes', noun: 'change' })
      : table('adm01', [{ h: 'User', v: u => `<b>${esc(u.name)}</b><span class=sm>${esc(u.domainId)} / ${esc(u.loginId)}</span>`, csv: u => `${u.domainId}/${u.loginId} ${u.name}` }, { h: 'Role', v: u => esc(u.role) },
        { h: 'Branch scope', v: u => esc(u.branchScope ? V.nodeName(DB, u.branchScope) : 'All branches') + (u.agentName ? `<span class=sm>${esc(u.agentName)}</span>` : '') },
        { h: 'Status', v: u => st(u.active === false ? 'Disabled' : 'Active') },
        { h: '', cls: 'acts', csv: false, v: u => can('tmp.admin') ? [u.domainId === 'AD2' ? lnk('Change role or scope', 'au-change', { d: u.domainId, l: u.loginId }) : '', lnk(u.active === false ? 'Enable' : 'Disable', 'au-toggle', { d: u.domainId, l: u.loginId, on: u.active === false ? 1 : 0 }, u.active === false ? '' : 'danger')].filter(Boolean).join(' · ') : '' }],
        users.filter(u => tab === 'Active' ? u.active !== false : u.active === false), { name: 'TMP users', noun: 'user' })}`;
  } });
const scopeOptions = () => [['', 'All branches'], ...(DB.org || []).map(n => [n.id, `${n.type === 'Region' ? '' : n.type === 'Cluster' ? '— ' : '—— '}${n.name} (${n.type})`])];
act('au-add', () => cmdDlg({ title: 'Add a treasury portal user', ok: 'Send to checker', body: `<div class=fgrid>${field('Name', `<input type=text id=au-name data-required>`, { req: true })}${field('Login ID (AD2 domain)', `<input type=text id=au-login data-required placeholder="e.g. BRANCH9">`, { req: true })}
  ${field('Role', `<select id=au-role>${options(TMP_ROLE_IDS().filter(r => r !== 'Agent Partner'))}</select>`)}${field('Branch scope', `<select id=au-scope>${options(scopeOptions())}</select>`, { hint: 'A branch user needs a branch; a regional user a region.' })}</div>` },
  'tmpuser.add', () => ({ name: $('#au-name').value, loginId: $('#au-login').value, role: $('#au-role').value, branchScope: $('#au-scope').value || undefined })));
act('au-change', el => { const u = (DB.logins || []).find(x => x.domainId === el.dataset.d && x.loginId === el.dataset.l); cmdDlg({ title: `Change ${esc(u.name)}`, ok: 'Send to checker', body: `<div class=fgrid>${field('Role', `<select id=ac-role>${options(TMP_ROLE_IDS(), u.role)}</select>`)}${field('Branch scope', `<select id=ac-scope>${options(scopeOptions(), u.branchScope || '')}</select>`)}</div>` },
  'tmpuser.update', () => ({ domainId: u.domainId, loginId: u.loginId, role: $('#ac-role').value, branchScope: $('#ac-scope').value })); });
act('au-toggle', el => run('tmpuser.update', { domainId: el.dataset.d, loginId: el.dataset.l, active: el.dataset.on === '1' }));

/* ---------- ADM-02 roles and permissions ---------------------------------------------------- */
screen({ id: 'ADM-02', title: 'Roles and permissions',
  sub: () => `What each treasury portal role may do &nbsp;·&nbsp; makers and checkers are separate roles; a viewer holds no action`,
  render() {
    const roles = (DB.roles || []).filter(r => r.portal === 'TMP' || r.id === 'AD2 Administrator');
    const caps = (DB.capabilities || []).filter(c => /^tmp\.|^treasury\./.test(c.id));
    return `<div class=tbl><div class=cap><span>${plural(roles.length, 'role')} × ${plural(caps.length, 'permission')}</span></div><table class=dt><thead><tr><th>Permission</th>${roles.map(r => `<th class=num style="white-space:normal;min-width:80px">${esc(r.id.replace(/^AD2 /, ''))}</th>`).join('')}</tr></thead>
      <tbody>${caps.map(c => `<tr><td class=wrap>${esc(c.label)}<span class=sm>${esc(c.id)} · ${esc(c.group)}</span></td>${roles.map(r => `<td class=num>${r.can.includes(c.id) ? '<span class=v-ok>&#10003;</span>' : '<span class=dim>—</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    ${roles.map(r => `<div class=panel><h2>${esc(r.id)}${r.readOnly ? ' · read-only' : ''}</h2><div class=pad><p class=small style="margin:0">${esc(r.summary || '')}</p>${r.note ? `<p class="small muted">${esc(r.note)}</p>` : ''}</div></div>`).join('')}`;
  } });

/* ---------- ADM-03 masters and configuration --------------------------------------------------- */
screen({ id: 'ADM-03', title: 'Masters and configuration',
  sub: () => `Product lines, cut-offs, spreads, exposure limits and counterparties &nbsp;·&nbsp; every change is versioned and approved by a checker`,
  acts: () => can('tmp.admin') ? btn('Add product line', 'rd-product', null, 'sec') : '',
  render() {
    const prods = DB.tmpProducts || [];
    const s = DB.settings || {};
    return `${table('adm03-p', [{ h: 'Product line', v: p => `<b>${esc(p.name)}</b><span class=sm>${esc(p.code)}${p.trade ? ' · ' + esc(p.trade) : ''}</span>`, csv: p => p.name }, { h: 'Sides', v: p => p.sides.map(side).join(' / ') },
      { h: 'Cut-off (IST)', v: p => p.cutoff ? esc(p.cutoff) + (p.autoCancel ? '<span class=sm>auto-cancel residual</span>' : '') : '<span class=dim>Not applicable</span>' },
      { h: 'Quote validity', num: true, v: p => `${p.quoteMinutes} min` }, { h: 'Card spread', num: true, v: p => `${p.spreadPct}%` }, { h: 'Customer spread', num: true, v: p => `${p.markupPct}%` },
      { h: 'Transfer spread', num: true, v: p => `${p.transferPct}%` }, { h: 'Transaction tagging', v: p => st(p.tagging === 'Excluded' ? 'Excluded' : 'Required') },
      { h: '', cls: 'acts', csv: false, v: p => can('tmp.admin') ? [p.cutoff ? lnk('Change cut-off', 'm-cutoff', { p: p.code }) : '', lnk('New margin version', 'm-margin', { p: p.code })].filter(Boolean).join(' · ') : '' }],
      prods, { title: 'Product lines', name: 'Product lines', noun: 'product' })}
    ${table('adm03-c', [{ h: 'Currency', v: c => `<b>${esc(c.code)}</b><span class=sm>${esc(c.name || '')}</span>`, csv: c => c.code }, { h: 'Base rate', num: true, v: c => rate(c.refRate) },
      { h: 'Intraday exposure limit', num: true, v: c => c.exposureLimit ? fcy(c.exposureLimit, c.code) : '<span class=dim>Not set</span>' }, { h: 'Correspondent', v: c => esc((DB.correspondents || {})[c.code] || '—') },
      { h: '', cls: 'acts', csv: false, v: c => can('tmp.admin') ? lnk('Set exposure limit', 'm-limit', { c: c.code }) : '' }], DB.currencies || [], { title: 'Currencies', name: 'Currencies', noun: 'currency' })}
    ${table('adm03-cp', [{ h: 'Counterparty', v: c => `<b>${esc(c.name)}</b>` , csv: c => c.name }, { h: 'Deal types', v: c => esc((c.dealTypes || []).join(', ')) }, { h: 'Credit line', v: c => esc(c.creditLine || '—') },
      { h: 'Settles to', v: c => esc(c.settlementAccount || '—') }, { h: 'Status', v: c => st(c.status) }, { h: '', cls: 'acts', csv: false, v: c => can('tmp.admin') ? lnk('Edit', 'm-cp', { n: c.name }) : '' }],
      DB.counterparties || [], { title: 'Bank counterparties', name: 'Counterparties', noun: 'bank', cap: `<span>${plural((DB.counterparties || []).length, 'bank')}</span><span class=sp></span>${can('tmp.admin') ? btn('Add bank', 'm-cp', null, 'sec') : ''}` })}
    <div class=cols>${table('adm03-cards', [{ h: 'Card prefix', v: c => esc(c.prefix) }, { h: 'Issuer', v: c => esc(c.issuer) }], DB.cardPrefixes || [], { title: 'Card prefix → issuer', name: 'Card prefixes', noun: 'prefix' })}
      ${panel('Thresholds', `<div class=pad>${kv([['Stepped review above', inr(s.steppedThresholdInr || 4000000)], ['Reminder after', `${s.reminderAfterMin || 30} min without a bill`], ['Escalate after', `${s.escalateAfterMin || 120} min`],
        ['Approval SLA', `${s.approvalSlaMin || 120} min`], ['Rate band (proposals)', `${s.rateBand ?? 2}% of the IBR`], ['Trade rate lock', '48 hours'], ['Open trade bookings per customer', String(s.maxOpenBookings ?? 5)]])}</div>`)}</div>`;
  } });
act('m-cutoff', el => { const p = (DB.tmpProducts || []).find(x => x.code === el.dataset.p); cmdDlg({ title: `${esc(p.name)} cut-off`, ok: 'Send to checker', body: `<div class=fgrid>${field('Current', readRO((p.cutoff || '—') + ' IST'))}${field('New cut-off (HH:MM IST)', `<input type=text id=mc-time data-required value="${esc(p.cutoff || '')}">`, { req: true })}
  ${field('Effective from', `<input type=date id=mc-eff value="${todayIST()}" min="${todayIST()}">`)}</div>${reasonBody('', 'Reason')}` }, 'master.cutoff', () => ({ product: p.code, time: $('#mc-time').value, effectiveFrom: $('#mc-eff').value, reason: $('#dlg-reason').value })); });
act('m-margin', el => { const p = (DB.tmpProducts || []).find(x => x.code === el.dataset.p); cmdDlg({ title: `${esc(p.name)} — new margin version`, ok: 'Send to checker', body: `<div class=fgrid>${field('Customer spread over IBR (%)', `<input type=text id=mm-m value="${p.markupPct}">`)}${field('Internal transfer spread (%)', `<input type=text id=mm-t value="${p.transferPct}">`)}</div>` },
  'master.marginVersion', () => ({ product: p.code, markupPct: Number($('#mm-m').value), transferPct: Number($('#mm-t').value) })); });
act('m-limit', el => cmdDlg({ title: `${esc(el.dataset.c)} intraday exposure limit`, ok: 'Send to checker', body: field('Limit (FCY)', `<input type=text id=ml-v data-required inputmode=decimal>`, { req: true }) }, 'master.currencyLimit', () => ({ currency: el.dataset.c, limit: Number($('#ml-v').value.replace(/,/g, '')) })));
act('m-cp', el => { const c = (DB.counterparties || []).find(x => x.name === el.dataset.n) || { name: '', dealTypes: ['Spot'], status: 'Active' }; cmdDlg({ title: c.name ? `Edit ${esc(c.name)}` : 'Add a bank counterparty', ok: 'Save', body: `<div class=fgrid>${field('Bank', c.name ? readRO(c.name) + `<input type=hidden id=mp-n value="${esc(c.name)}">` : `<input type=text id=mp-n data-required>`, { req: !c.name })}
  ${field('Status', `<select id=mp-s>${options(['Active', 'Suspended'], c.status)}</select>`)}</div>${field('Deal types', ['Spot', 'Forward', 'Swap'].map(t => `<label class=check style="display:inline-flex;margin-right:12px"><input type=checkbox data-mp="${t}"${(c.dealTypes || []).includes(t) ? ' checked' : ''}> ${t}</label>`).join(''))}` },
  'master.counterparty', () => ({ name: $('#mp-n').value, status: $('#mp-s').value, dealTypes: $$('[data-mp]').filter(x => x.checked).map(x => x.dataset.mp) })); });

/* ---------- ADM-04 integrations -------------------------------------------------------------- */
screen({ id: 'ADM-04', title: 'Integration settings',
  sub: () => `Transports, schedules and credential rotation &nbsp;·&nbsp; the trade portal is on the same platform, so trade events need no integration`,
  render() {
    const rows = V.integrations(DB, NOW());
    return table('adm04', [{ h: 'Integration', v: i => `<b>${esc(i.name)}</b><span class=sm>${esc(i.data)}</span>`, csv: i => i.name }, { h: 'Transport', v: i => esc(i.transport) + `<span class=sm>${esc(i.mode)}</span>` },
      { h: 'Schedule', v: i => esc(i.schedule) }, { h: 'Credentials rotated', v: i => i.credsRotatedAt ? `${istDay(i.credsRotatedAt)}<span class=sm>${ago(i.credsRotatedAt)}</span>` : '<span class=dim>—</span>', csv: i => i.credsRotatedAt || '' },
      { h: 'Health', v: i => st(i.status) + ' ' + fresh(i.freshness, i.lastSuccess), csv: i => i.status },
      { h: '', cls: 'acts', csv: false, v: i => can('tmp.admin') && i.id !== 'TRADE' ? [lnk('Configure', 'ai-conf', { id: i.id }), i.credsRotatedAt ? lnk('Rotate credentials', 'ai-rotate', { id: i.id }) : '', i.status !== 'Not selected' ? lnk('Test pull', 'int-pull', { id: i.id }) : ''].filter(Boolean).join(' · ') : '' }],
      rows, { name: 'Integrations', noun: 'integration' });
  } });
act('ai-conf', el => { const i = (DB.integrations || []).find(x => x.id === el.dataset.id); cmdDlg({ title: `Configure ${esc(i.name)}`, ok: 'Save', body: `<div class=fgrid>${field('Transport', `<input type=text id=ai-t value="${esc(i.transport)}">`)}${field('Schedule', `<input type=text id=ai-s value="${esc(i.schedule)}">`)}</div>` },
  'integration.configure', () => ({ id: i.id, transport: $('#ai-t').value, schedule: $('#ai-s').value })); });
act('ai-rotate', el => run('integration.configure', { id: el.dataset.id, rotate: true }));

/* ---------- ADM-05 organisation hierarchy ------------------------------------------------------- */
screen({ id: 'ADM-05', title: 'Organisation hierarchy',
  sub: () => `Regions, clusters, branches and airports &nbsp;·&nbsp; a user’s scope is a node and everything under it &nbsp;·&nbsp; moving a node re-scopes its users, so it goes to a checker`,
  acts: () => can('tmp.admin') ? btn('Add node', 'ao-edit', null) : '',
  render() {
    const org = DB.org || [];
    const users = id => (DB.logins || []).filter(l => l.branchScope && V.descendants(DB, id).has(l.branchScope)).length;
    const rows = [];
    const walk = (parent, depth) => org.filter(n => (n.parent || null) === parent).forEach(n => { rows.push({ n, depth }); walk(n.id, depth + 1); });
    walk(null, 0);
    return table('adm05', [{ h: 'Node', v: r => `<span style="padding-left:${r.depth * 18}px">${r.depth ? '└ ' : ''}<b>${esc(r.n.name)}</b></span><span class=sm style="padding-left:${r.depth * 18}px">${esc(r.n.id)}</span>`, csv: r => r.n.name },
      { h: 'Type', v: r => esc(r.n.type) }, { h: 'GST states served', v: r => esc((r.n.states || []).join(', ') || '—') }, { h: 'Cut-off', v: r => esc(r.n.cutoff ? r.n.cutoff + ' IST (override)' : r.n.type === 'Branch' || r.n.type === 'Airport' ? 'Product default' : '—') },
      { h: 'Users in scope', num: true, v: r => users(r.n.id) }, { h: 'Positions', num: true, v: r => (DB.positions || []).filter(p => p.branchId && V.descendants(DB, r.n.id).has(p.branchId)).length },
      { h: '', cls: 'acts', csv: false, v: r => can('tmp.admin') ? lnk('Edit or move', 'ao-edit', { id: r.n.id }) : '' }], rows, { name: 'Organisation', noun: 'node' });
  } });
act('ao-edit', el => { const n = (DB.org || []).find(x => x.id === el.dataset.id); const org = DB.org || [];
  cmdDlg({ title: n ? `Edit ${esc(n.name)}` : 'Add a node', ok: 'Send to checker', body: `<div class=fgrid>${n ? field('Code', readRO(n.id)) : field('Code', `<input type=text id=ao-id data-required placeholder="BR-NEW">`, { req: true })}
    ${field('Name', `<input type=text id=ao-name data-required value="${esc(n ? n.name : '')}">`, { req: true })}${field('Type', `<select id=ao-type>${options(['Region', 'Cluster', 'Branch', 'Airport'], n ? n.type : 'Branch')}</select>`)}
    ${field('Parent', `<select id=ao-parent><option value="">— none (region) —</option>${options(org.filter(x => ['Region', 'Cluster'].includes(x.type) && (!n || x.id !== n.id)).map(x => [x.id, `${x.name} (${x.type})`]), n ? n.parent || '' : '')}</select>`)}
    ${field('Cut-off override (HH:MM IST)', `<input type=text id=ao-cut value="${esc(n && n.cutoff || '')}" placeholder="e.g. 21:00 for an airport">`)}</div>` },
  'org.update', () => ({ id: n ? n.id : undefined, newId: n ? undefined : $('#ao-id').value, name: $('#ao-name').value, type: $('#ao-type').value, parent: $('#ao-parent').value, cutoff: $('#ao-cut').value || undefined })); });
