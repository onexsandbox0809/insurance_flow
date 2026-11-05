'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const FLOWS = [['personal', 'Personal'], ['nominee', 'Nominee'], ['insured', 'Insured'], ['medical', 'Health'], ['covers', 'Covers'], ['documents', 'Documents']];
  const STATUS = { draft: 'In progress', quoted: 'Quoted', completed: 'Complete' };
  const COVER = { restoration: 'Restoration of Sum Insured', maternity: 'Maternity and New Born Baby Cover', daily_cash: 'Daily Cash Allowance on Hospitalisation' };
  const DOC_LABEL = { id_proof: 'ID proof', address_proof: 'Proof of residence', age_proof: 'Proof of age', previous_policy_docs: 'Previous policy copies', prepolicy_reports: 'Medical / check-up report', pan_doc: 'PAN or Form 60/61' };
  const FLOW_NAME = { personal: 'Personal information', nominee: 'Nominee', insured: 'Insured persons', medical: 'Medical and habits', covers: 'Optional covers', documents: 'Documents' };

  const state = { token: sessionStorage.getItem('pd_token'), user: sessionStorage.getItem('pd_user'), status: '', search: '', page: 1, rows: [], total: 0, current: null, data: null, tab: 'summary' };

  // ---------- helpers ----------
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nil = '<span class="nil">&mdash;</span>';
  const val = (v) => (v === null || v === undefined || v === '' ? nil : esc(v));
  const yn = (v) => (v === true ? 'Yes' : v === false ? 'No' : v);
  const inr = (n) => (n === null || n === undefined || n === '' ? '' : '\u20B9' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const inr0 = (n) => (n === null || n === undefined || n === '' ? '' : '\u20B9' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 }));
  const compact = (n) => { n = Number(n || 0); if (n >= 1e7) return `\u20B9${(n / 1e7).toFixed(2)} Cr`; if (n >= 1e5) return `\u20B9${(n / 1e5).toFixed(2)} L`; return inr0(n); };
  const field = (label, v, wide) => `<div class="f${wide ? ' wide' : ''}"><dt>${esc(label)}</dt><dd>${val(v)}</dd></div>`;
  const panel = (title, body) => `<section class="panel"><h3>${esc(title)}</h3>${body}</section>`;
  const fields = (arr) => `<dl class="fields">${arr.map(([l, v, w]) => field(l, v, w)).join('')}</dl>`;
  const origin = location.origin;
  const shortOf = (d) => (d.short_code ? `${origin}/d/${d.short_code}` : d.short_url || '');
  const pdfLink = (p) => (p.proposal_pdf_url ? `${origin}/p/${p.proposal_pdf_url.split('/').pop()}` : '');

  function toast(msg, bad) {
    const t = $('toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' err' : ''); t.hidden = false;
    clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3200);
  }

  async function api(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}), ...(opts.headers || {}) } });
    let json = {}; try { json = await res.json(); } catch { /* empty body */ }
    if (res.status === 401 && state.token) { signOut(); throw new Error('Your session ended. Please sign in again.'); }
    if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  }

  // ---------- sign in / out ----------
  function showLogin() { $('app').hidden = true; $('login').hidden = false; $('login_id').focus(); }
  function showApp() { $('login').hidden = true; $('app').hidden = false; $('who').textContent = state.user || ''; loadList(true); }
  function signOut() { sessionStorage.clear(); state.token = null; state.current = null; showLogin(); }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('login-error'); err.hidden = true;
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try {
      const out = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ login_id: $('login_id').value, password: $('password').value }) });
      state.token = out.token; state.user = out.user.name;
      sessionStorage.setItem('pd_token', out.token); sessionStorage.setItem('pd_user', out.user.name);
      $('password').value = '';
      showApp();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    btn.disabled = false;
  });
  $('signout').addEventListener('click', signOut);

  // ---------- list ----------
  const rail = (done, labels) => {
    const set = new Set(done || []);
    return `<div class="rail" aria-hidden="true">${FLOWS.map(([k, l]) => `<i class="${set.has(k) ? 'on' : ''}" title="${esc(l)}"></i>`).join('')}</div>` +
      (labels ? `<div class="rail-labels">${FLOWS.map(([k, l]) => `<span class="${set.has(k) ? 'on' : ''}">${esc(l)}</span>`).join('')}</div>` : '');
  };

  function renderStats(s) {
    if (!s) return;
    const item = (l, v) => `<div><dt>${esc(l)}</dt><dd>${esc(v)}</dd></div>`;
    $('stats').innerHTML = item('Proposals', s.total) + item('Quoted', s.quoted) + item('Complete', s.completed) + item('Today', s.today) + item('Premium quoted', compact(s.premium_total));
  }

  function renderRows() {
    const ul = $('rows');
    if (!state.rows.length) { ul.innerHTML = `<li class="list-empty">${state.search || state.status ? 'No proposal matches. Clear the search or filter.' : 'No proposals yet. They appear here as soon as a customer submits the first flow.'}</li>`; }
    else {
      ul.innerHTML = state.rows.map((r) => `
        <li><button class="row" data-no="${esc(r.proposal_no)}" aria-current="${state.current === r.proposal_no}">
          <div class="row-top"><span class="row-name">${esc(r.full_name || 'New customer')}</span>
            ${r.premium_annual ? `<span class="row-premium">${inr0(r.premium_annual)}</span>` : '<span class="row-premium none">No quote yet</span>'}</div>
          <div class="row-mid"><span class="mono">${esc(r.proposal_no)}</span><span>${esc(r.entry_date)} ${esc(r.entry_time)}</span></div>
          ${rail(r.flows_completed)}
        </button></li>`).join('');
    }
    $('count').textContent = state.total ? `Showing ${state.rows.length} of ${state.total}` : '';
    $('more').hidden = state.rows.length >= state.total;
  }

  async function loadList(reset) {
    if (reset) { state.page = 1; state.rows = []; }
    const q = new URLSearchParams({ page: state.page, limit: 25 });
    if (state.search) q.set('search', state.search);
    if (state.status) q.set('status', state.status);
    try {
      const out = await api(`/api/dashboard/list?${q}`);
      state.rows = reset ? out.rows : state.rows.concat(out.rows);
      state.total = out.total;
      renderStats(out.stats); renderRows();
    } catch (e) { toast(e.message, true); }
  }

  $('rows').addEventListener('click', (e) => { const b = e.target.closest('.row'); if (b) openProposal(b.dataset.no); });
  $('more').addEventListener('click', () => { state.page += 1; loadList(false); });
  $('chips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip'); if (!c) return;
    document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
    state.status = c.dataset.status; loadList(true);
  });
  let timer; $('search').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { state.search = e.target.value.trim(); loadList(true); }, 300); });

  // ---------- detail ----------
  async function openProposal(no) {
    state.current = no; renderRows();
    $('layout').classList.add('show-detail');
    $('detail').innerHTML = '<div class="empty"><p>Loading proposal&hellip;</p></div>';
    try { state.data = await api(`/api/dashboard/proposal?proposal_no=${encodeURIComponent(no)}`); renderDetail(); }
    catch (e) { $('detail').innerHTML = `<div class="empty"><h2>Could not open the proposal</h2><p>${esc(e.message)}</p></div>`; }
  }

  function tabsFor(d) {
    return [['summary', 'Summary'], ['proposer', 'Proposer'], ['nominee', 'Nominee'], ['insured', 'Insured'], ['health', 'Health'], ['covers', 'Covers'], ['documents', 'Documents', d.documents.length], ['activity', 'Activity', d.submissions.length]];
  }

  function renderDetail() {
    const d = state.data, p = d.proposal;
    const pdf = pdfLink(p);
    $('detail').innerHTML = `<div class="view">
      <button class="btn quiet back" id="back" type="button">&larr; All customers</button>
      <div class="d-head">
        <div>
          <h2 class="d-title">${esc(p.full_name || 'New customer')}</h2>
          <div class="d-sub"><span class="mono">${esc(p.proposal_no)}</span><span class="pill ${esc(p.status)}">${esc(STATUS[p.status] || p.status)}</span><span>WhatsApp ${esc(p.wa_id)}</span><span>Entered ${esc(p.entry_date)} ${esc(p.entry_time)} IST</span></div>
        </div>
        <div class="d-actions">
          ${pdf ? `<a class="btn primary" href="${esc(pdf)}" target="_blank" rel="noopener">Open proposal PDF</a>` : ''}
          <button class="btn" id="regen" type="button" ${p.quote_status === 'quoted' ? '' : 'disabled title="A quote is needed first"'}>${pdf ? 'Regenerate PDF' : 'Generate proposal PDF'}</button>
        </div>
      </div>
      <div class="d-rail">${rail(p.flows_completed, true)}</div>
      <div class="tabs" role="tablist">${tabsFor(d).map(([k, l, n]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${esc(l)}${n !== undefined ? `<span class="n">${n}</span>` : ''}</button>`).join('')}</div>
      <div id="tab-body">${renderTab()}</div>
    </div>`;
    $('back').addEventListener('click', () => $('layout').classList.remove('show-detail'));
    $('regen').addEventListener('click', regenerate);
    $('detail').querySelector('.tabs').addEventListener('click', (e) => {
      const t = e.target.closest('.tab'); if (!t) return;
      state.tab = t.dataset.tab;
      $('detail').querySelectorAll('.tab').forEach((x) => x.setAttribute('aria-selected', x === t));
      $('tab-body').innerHTML = renderTab(); bindTab();
    });
    bindTab();
  }

  async function regenerate() {
    const b = $('regen'); b.disabled = true; b.textContent = 'Generating\u2026';
    try {
      await api('/api/dashboard/regenerate-pdf', { method: 'POST', body: JSON.stringify({ proposal_no: state.current }) });
      toast('Proposal PDF is ready'); await openProposal(state.current); loadList(true);
    } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = 'Regenerate PDF'; }
  }

  function bindTab() {
    $('tab-body').querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied'); } catch { toast('Copy is not available here', true); }
    }));
  }

  function renderTab() {
    const { proposal: p, documents, submissions } = state.data;
    switch (state.tab) {
      case 'summary': return summary(p);
      case 'proposer': return panel('Identity', fields([['Name', p.full_name], ['Date of birth', p.dob], ['Gender', p.gender], ['Marital status', p.marital_status], ['Occupation', p.occupation], ['PAN (masked)', p.pan], ['Aadhaar (masked)', p.aadhaar], ['E-insurance account', p.e_insurance_no], ['CKYC number', p.ckyc_no], ['Consent to be contacted', yn(p.contact_consent)]])) +
        panel('Address and contact', fields([['Address', p.address, true], ['Village', p.village], ['City', p.city], ['State', p.state], ['PIN code', p.pin], ['Servicing office', p.servicing_office], ['Mobile', p.mobile], ['Tel. with STD', p.tel_std], ['Home tel.', p.tel_home], ['E-mail', p.email]]));
      case 'nominee': return panel('Nominee', fields([['Name', p.nominee_name], ['Relationship', p.nominee_relation], ['Contact number', p.nominee_contact], ['Address', p.nominee_address, true]]));
      case 'insured': return insured(p);
      case 'health': return health(p);
      case 'covers': return panel('Optional covers', fields([['Covers selected', (p.covers || []).map((c) => COVER[c] || c).join(', '), true], ['Restoration of sum insured', p.p1_restoration], ['Maternity and new-born baby cover', p.p1_maternity], ['Daily cash allowance', p.p1_daily_cash], ['Daily cash amount', p.p1_daily_cash_amt]]));
      case 'documents': return docs(p, documents);
      case 'activity': return activity(p, submissions);
      default: return '';
    }
  }

  function summary(p) {
    const q = p.premium_breakdown && p.premium_breakdown.ready ? p.premium_breakdown : null;
    const top = q ? `<div class="quote">
        <div class="quote-main"><small>Annual premium including GST</small><div class="quote-amt">${inr(p.premium_annual)}</div>
          <div class="quote-meta">Sum insured ${inr0(p.total_sum_insured)} &middot; ${esc(p.persons)} insured &middot; valid till <span style="white-space:nowrap">${esc(p.quote_valid_till)}</span></div>
          <div class="quote-meta" style="color:var(--muted)">Selected option: ${esc(p.premium_option)}</div></div>
        <div class="quote-opts">
          <div class="opt"><span>Half-yearly</span><b>${inr(p.premium_half_yearly)}</b></div>
          <div class="opt"><span>Quarterly</span><b>${inr(p.premium_quarterly)}</b></div>
          <div class="opt"><span>Monthly</span><b>${inr(p.premium_monthly)}</b></div></div></div>`
      : `<div class="quote none"><b style="color:var(--ink)">No quote yet.</b> The premium appears once the insured person flow has a date of birth and sum insured for every person.</div>`;
    let breakdown = '';
    if (q) {
      const t = q.totals;
      const rows = [['Base premium', inr(t.base)], ['Loadings', inr(t.loading)], ['Family discount (2nd person)', `<span class="neg">- ${inr(t.family_discount)}</span>`],
        ...q.addons.map((a) => [`Add-on: ${esc(a.label)}${a.not_applicable ? ' (not applicable)' : ''}`, inr(a.amount)]),
        ['Digital (WhatsApp) discount', `<span class="neg">- ${inr(t.digital_discount)}</span>`], ['Net premium', inr(t.net)], [`GST ${Math.round(t.gst_rate * 100)}%`, inr(t.gst)]];
      breakdown = panel('Premium breakdown',
        `<div class="scroll"><table class="t"><thead><tr><th>Insured</th><th class="r">Age</th><th class="r">Sum insured</th><th class="r">Base</th><th class="r">Loadings</th><th class="r">Family disc.</th><th class="r">Subtotal</th></tr></thead><tbody>` +
        q.persons.map((l) => `<tr><td>${esc(l.person)}. ${esc(l.name)}${l.loadings.filter((x) => !x.note).length ? `<div style="color:var(--muted);font-size:12px">${l.loadings.filter((x) => !x.note).map((x) => `${esc(x.label)} +${Math.round(x.pct * 1000) / 10}%`).join(' &middot; ')}</div>` : ''}</td><td class="r">${l.age}</td><td class="r">${inr0(l.sum_insured)}</td><td class="r">${inr(l.base)}</td><td class="r">${inr(l.loading_total)}</td><td class="r">${inr(l.family_discount)}</td><td class="r">${inr(l.subtotal)}</td></tr>`).join('') +
        `</tbody></table></div><div class="scroll" style="margin-top:14px"><table class="t"><tbody>${rows.map(([l, v]) => `<tr><td>${l}</td><td class="r">${v}</td></tr>`).join('')}<tr class="total"><td>Total annual premium</td><td class="r">${inr(t.annual)}</td></tr></tbody></table></div>`);
    }
    return top + breakdown + panel('Proposal', fields([['Proposal number', p.proposal_no], ['Status', STATUS[p.status] || p.status], ['Entry date', p.entry_date], ['Entry time (hh-mm)', p.entry_time], ['Last updated', `${p.updated_date || ''} ${p.updated_time || ''}`.trim()], ['Proposal PDF generated', p.proposal_pdf_generated_at]]));
  }

  function insured(p) {
    const n = Number(p.persons) === 2 ? 2 : 1;
    const rows = [['Relation to proposer', 'relation'], ['Name', 'name'], ['Gender', 'gender'], ['Date of birth', 'dob'], ['Aadhaar (masked)', 'aadhaar'], ['Sum insured', 'sum_insured'], ['Height (m)', 'height'], ['Weight (kg)', 'weight'], ['Blood group', 'blood_group'], ['Marital status', 'marital_status'], ['Dependent', 'dependent'], ['Employment', 'employment'], ['Occupation', 'occupation']];
    if (!p.persons) return panel('Insured persons', '<p class="nil">The insured person flow has not been submitted yet.</p>');
    return panel(`Insured persons (${n})`, `<div class="scroll"><table class="t"><thead><tr><th>Detail</th><th>Person 1</th>${n === 2 ? '<th>Person 2</th>' : ''}</tr></thead><tbody>${rows.map(([l, k]) => `<tr><td style="color:var(--muted)">${esc(l)}</td><td>${val(p['p1_' + k])}</td>${n === 2 ? `<td>${val(p['p2_' + k])}</td>` : ''}</tr>`).join('')}</tbody></table></div>`);
  }

  function health(p) {
    const tag = (v) => (v === 'Yes' ? '<span class="tag warn">Yes</span>' : v === 'No' ? '<span class="tag">No</span>' : nil);
    const c = [['Diabetes Mellitus', 'p1_diabetes'], ['Hypertension', 'p1_hypertension'], ['Haemolytic Anaemia', 'p1_haemolytic_anaemia'], ['Epilepsy', 'p1_epilepsy'], ['Renal Stones', 'p1_renal_stones'], ['Asthma', 'p1_asthma']];
    const h = [['Chewable tobacco / gutkha / pan masala', 'p1_tobacco'], ['Alcohol', 'p1_alcohol'], ['Cigarettes', 'p1_cigarettes']];
    return panel('Medical history (insured person 1)', fields([['Ever suffered from any listed condition?', p.any_condition, true]]) + `<div class="scroll" style="margin-top:12px"><table class="t"><tbody>${c.map(([l, k]) => `<tr><td>${esc(l)}</td><td class="r">${tag(p[k])}</td></tr>`).join('')}</tbody></table></div>`) +
      panel('Habits', `<div class="scroll"><table class="t"><tbody>${h.map(([l, k]) => `<tr><td>${esc(l)}</td><td class="r">${tag(p[k])}</td></tr>`).join('')}</tbody></table></div>` + fields([['Quantity per week', p.habit_quantity, true]]));
  }

  function docs(p, list) {
    if (!list.length) return panel('Documents', '<p class="nil">No documents received yet. They arrive with flow 7.</p>');
    const st = (d) => (d.status === 'stored' ? '<span class="tag ok">Stored</span>' : d.status === 'failed' ? `<span class="tag bad" title="${esc(d.error || '')}">Failed</span>` : d.status === 'sample' ? '<span class="tag warn">Sample</span>' : `<span class="tag">${esc(d.status)}</span>`);
    const ver = (d) => (d.sha256_match === true ? '<span class="tag ok">Matches</span>' : d.sha256_match === false ? '<span class="tag bad">Differs</span>' : nil);
    return panel(`Documents (${list.length})`, `<div class="scroll"><table class="t"><thead><tr><th>Document</th><th>WhatsApp media id</th><th>SHA-256 (as received)</th><th>File check</th><th>Media URL</th><th>Status</th></tr></thead><tbody>` +
      list.map((d) => { const u = shortOf(d); return `<tr>
        <td><b>${esc(d.doc_label || DOC_LABEL[d.doc_type] || d.doc_type)}</b>${d.file_index > 1 ? ` <span class="tag">#${d.file_index}</span>` : ''}<div style="color:var(--muted);font-size:12px">${val(d.file_name)}${d.size_bytes ? ` &middot; ${(d.size_bytes / 1024).toFixed(0)} KB` : ''}</div></td>
        <td class="mono">${val(d.whatsapp_media_id)}</td>
        <td><span class="hash">${val(d.sha256)}</span></td>
        <td>${ver(d)}</td>
        <td>${u ? `<a class="link mono" href="${esc(u)}" target="_blank" rel="noopener">${esc(u.replace(/^https?:\/\//, ''))}</a><button class="copy" type="button" data-copy="${esc(u)}">Copy</button>` : nil}${d.error ? `<div class="form-error" style="margin-top:6px">${esc(d.error)}</div>` : ''}</td>
        <td>${st(d)}</td></tr>`; }).join('') + '</tbody></table></div>');
  }

  function activity(p, subs) {
    const stamps = FLOWS.map(([k]) => [k, p[`flow_${k}_at`]]).filter(([, v]) => v);
    const summary = (s) => {
      const pl = s.payload || {};
      if (s.flow_key === 'documents') return (pl.documents || []).map((x) => `${DOC_LABEL[x.doc_type] || x.doc_type}: ${x.status}`).join(', ');
      const keys = Object.keys(pl); return `${keys.length} field${keys.length === 1 ? '' : 's'} saved`;
    };
    return panel('Flow submissions', subs.length ? `<ul class="timeline">${subs.map((s) => `<li><time>${esc(s.created_date)} ${esc(s.created_time)}</time><div class="what"><b>${esc(FLOW_NAME[s.flow_key] || s.flow_key)}</b><div>${esc(summary(s))}</div></div></li>`).join('')}</ul>` : '<p class="nil">Nothing submitted yet.</p>') +
      panel('Completed at', stamps.length ? fields(stamps.map(([k, v]) => [FLOW_NAME[k], v])) : '<p class="nil">No flow completed yet.</p>');
  }

  // ---------- start ----------
  if (state.token) showApp(); else showLogin();
})();
