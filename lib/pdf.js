'use strict';
const { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFArray } = require('pdf-lib');
const cfg = require('./config');
const { ageOn, formatIST, nowIST } = require('./dates');
const { bmiOf, sumInsuredValue } = require('./premium');

const W = 595.28, H = 841.89, M = 36, CW = W - M * 2;
const C = {
  navy: rgb(0.043, 0.176, 0.337), blue: rgb(0.063, 0.38, 0.65), teal: rgb(0.059, 0.463, 0.431),
  ink: rgb(0.1, 0.13, 0.19), muted: rgb(0.4, 0.45, 0.53), line: rgb(0.85, 0.88, 0.92),
  panel: rgb(0.953, 0.965, 0.98), zebra: rgb(0.975, 0.98, 0.99), white: rgb(1, 1, 1),
  gold: rgb(0.95, 0.76, 0.1), mint: rgb(0.9, 0.96, 0.94), red: rgb(0.7, 0.15, 0.15),
};

// Standard PDF fonts only encode Latin-1. The rupee sign and typographic punctuation are converted to plain text first,
// and anything else becomes '?', so a name in Hindi can never crash PDF creation.
const ASCII_FIX = { '\u20B9': 'Rs ', '\u2013': '-', '\u2014': '-', '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"', '\u2026': '...', '\u2022': '-' };
const safe = (v) => String(v === null || v === undefined || v === '' ? '-' : v)
  .replace(/[\r\n]+/g, ' ')
  .replace(/[\u20B9\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u2022]/g, (c) => ASCII_FIX[c])
  .replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '?');

const inr = (n) => (n === null || n === undefined || n === '' ? '-' :
  'Rs. ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const inr0 = (n) => (n === null || n === undefined || n === '' ? '-' :
  'Rs. ' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 }));
const COVER_LABELS = { restoration: 'Restoration of Sum Insured', maternity: 'Maternity and New Born Baby Cover', daily_cash: 'Daily Cash Allowance on Hospitalisation' };
const yn = (v) => (v === true ? 'Yes' : v === false ? 'No' : v || '-');

async function buildProposalPdf({ proposal: p, documents = [] }) {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  pdf.setTitle(`Proposal ${p.proposal_no}`);
  pdf.setAuthor(cfg.company());
  pdf.setSubject('Health insurance proposal and premium quote');

  let page, y, pageNo = 0;
  const company = cfg.company();
  const issued = `${formatIST(new Date())} IST`;

  const w = (t, size, f = reg) => f.widthOfTextAtSize(safe(t), size);
  const text = (t, x, yy, { size = 9, font = reg, color = C.ink } = {}) => page.drawText(safe(t), { x, y: yy, size, font, color });
  const rect = (x, yy, ww, hh, color) => page.drawRectangle({ x, y: yy, width: ww, height: hh, color });
  const hline = (yy, x1 = M, x2 = W - M, color = C.line, th = 0.7) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: th, color });

  function wrap(t, size, maxW, f = reg) {
    const words = safe(t).split(' ');
    const lines = []; let cur = '';
    for (const word of words) {
      const trial = cur ? `${cur} ${word}` : word;
      if (f.widthOfTextAtSize(trial, size) <= maxW) cur = trial;
      else {
        if (cur) lines.push(cur);
        let rest = word;
        while (f.widthOfTextAtSize(rest, size) > maxW) {            // break very long tokens
          let i = rest.length; while (i > 1 && f.widthOfTextAtSize(rest.slice(0, i), size) > maxW) i--;
          lines.push(rest.slice(0, i)); rest = rest.slice(i);
        }
        cur = rest;
      }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : ['-'];
  }

  function link(x, yy, ww, hh, url) {
    const ctx = pdf.context;
    const ref = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, yy, x + ww, yy + hh], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) } }));
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (annots) annots.push(ref); else page.node.set(PDFName.of('Annots'), ctx.obj([ref]));
  }

  function newPage(first = false) {
    page = pdf.addPage([W, H]); pageNo += 1;
    if (first) {
      rect(0, H - 92, W, 92, C.navy);
      rect(0, H - 96, W, 4, C.gold);
      text(company, M, H - 40, { size: 18, font: bold, color: C.white });
      text('Health insurance proposal and premium quote', M, H - 58, { size: 10, color: rgb(0.8, 0.88, 0.97) });
      text('Proposal no.', W - M - 170, H - 36, { size: 8, color: rgb(0.8, 0.88, 0.97) });
      text(p.proposal_no, W - M - 170, H - 52, { size: 14, font: bold, color: C.white });
      text(`Issued ${issued}`, W - M - 170, H - 68, { size: 8, color: rgb(0.8, 0.88, 0.97) });
      y = H - 96 - 16;
    } else {
      rect(0, H - 30, W, 30, C.navy);
      text(company, M, H - 20, { size: 9, font: bold, color: C.white });
      text(`Proposal ${p.proposal_no}`, W - M - w(`Proposal ${p.proposal_no}`, 9, bold), H - 20, { size: 9, font: bold, color: C.white });
      y = H - 30 - 20;
    }
  }
  const need = (h) => { if (y - h < 54) newPage(); };

  function section(title) {
    need(60);
    y -= 6;
    rect(M, y - 15, 4, 15, C.blue);
    text(title, M + 11, y - 11, { size: 11.5, font: bold, color: C.navy });
    y -= 22; hline(y + 4); y -= 8;
  }

  // label above value, N columns; items may span several columns, rows are packed greedily
  function grid(items, cols = 3) {
    const colW = CW / cols;
    const rows = []; let cur = [], used = 0;
    items.forEach((it) => {
      const span = Math.min(it[2] || 1, cols);
      if (used + span > cols) { rows.push(cur); cur = []; used = 0; }
      cur.push([it[0], it[1], span]); used += span;
    });
    if (cur.length) rows.push(cur);
    rows.forEach((row) => {
      const heights = row.map(([, v, span]) => wrap(v, 9.5, colW * span - 12, reg).length);
      const rowH = 13 + Math.max(...heights) * 12 + 3;
      need(rowH);
      let x = M;
      row.forEach(([label, value, span]) => {
        text(label, x, y - 9, { size: 7.5, color: C.muted });
        wrap(value, 9.5, colW * span - 12).forEach((ln, li) => text(ln, x, y - 22 - li * 12, { size: 9.5 }));
        x += colW * span;
      });
      y -= rowH;
    });
  }

  function table(headers, rows, widths, { align = [] } = {}) {
    const total = widths.reduce((a, b) => a + b, 0);
    const cw = widths.map((x) => (x / total) * CW);
    const cell = (t, i, size, f) => {
      const lines = wrap(t, size, cw[i] - 10, f);
      return lines;
    };
    need(40);
    rect(M, y - 18, CW, 18, C.navy);
    let x = M;
    headers.forEach((h, i) => {
      const tx = align[i] === 'right' ? x + cw[i] - 5 - w(h, 8, bold) : x + 5;
      text(h, tx, y - 12.5, { size: 8, font: bold, color: C.white }); x += cw[i];
    });
    y -= 18;
    rows.forEach((r, ri) => {
      const lines = r.map((t, i) => cell(t, i, 8.6, reg));
      const h = Math.max(...lines.map((l) => l.length)) * 11 + 5;
      need(h);
      if (ri % 2 === 0) rect(M, y - h, CW, h, C.zebra);
      let cx = M;
      lines.forEach((ls, i) => {
        ls.forEach((ln, li) => {
          const tx = align[i] === 'right' ? cx + cw[i] - 5 - w(ln, 8.6) : cx + 5;
          text(ln, tx, y - 10 - li * 11, { size: 8.6, color: C.ink });
        });
        cx += cw[i];
      });
      y -= h;
    });
    hline(y); y -= 6;
  }

  // ================= PAGE 1 =================
  newPage(true);

  // ---- premium card ----
  const q = p.premium_breakdown && p.premium_breakdown.ready ? p.premium_breakdown : null;
  const cardH = 92;
  need(cardH + 10);
  rect(M, y - cardH, CW, cardH, C.mint);
  rect(M, y - cardH, 5, cardH, C.teal);
  text('Annual premium (including GST)', M + 18, y - 20, { size: 9, color: C.muted });
  text(q ? inr(p.premium_annual) : 'Quote pending', M + 18, y - 48, { size: 25, font: bold, color: C.teal });
  text(q ? `Total sum insured ${inr0(p.total_sum_insured)}   |   ${p.persons} insured   |   Valid till ${p.quote_valid_till || '-'}` : 'Complete the personal, insured person and cover flows to see the premium.', M + 18, y - 68, { size: 8.5, color: C.ink });
  text(`Selected payment option: ${p.premium_option || 'Annual'}`, M + 18, y - 82, { size: 8, color: C.muted });
  const ox = M + CW - 215;
  [['Half-yearly', p.premium_half_yearly], ['Quarterly', p.premium_quarterly], ['Monthly', p.premium_monthly]].forEach(([lbl, val], i) => {
    const yy = y - 26 - i * 22;
    text(lbl, ox, yy, { size: 8.5, color: C.muted });
    const s = q ? inr(val) : '-';
    text(s, M + CW - 14 - w(s, 10.5, bold), yy - 1, { size: 10.5, font: bold, color: C.ink });
    hline(yy - 7, ox, M + CW - 14, rgb(0.8, 0.9, 0.87), 0.5);
  });
  y -= cardH + 8;

  grid([
    ['Proposal status', (p.status || 'draft').toUpperCase()],
    ['Entry date (IST)', p.entry_date],
    ['Entry time (IST, hh-mm)', p.entry_time],
    ['WhatsApp number', p.wa_id],
    ['Last updated', `${p.updated_date || '-'} ${p.updated_time || ''}`.trim()],
    ['Flows completed', (p.flows_completed || []).join(', ') || '-'],
  ], 3);

  // ---- 1 proposer ----
  section('1. Proposer details');
  grid([
    ['Name', p.full_name], ['Date of birth', p.dob], ['Age', ageOn(p.dob) === null ? '-' : `${ageOn(p.dob)} years`],
    ['Gender', p.gender], ['Marital status', p.marital_status], ['Occupation', p.occupation],
    ['PAN (masked)', p.pan], ['Aadhaar (masked)', p.aadhaar], ['E-insurance account', p.e_insurance_no],
    ['CKYC number', p.ckyc_no], ['Consent to be contacted', yn(p.contact_consent)],
  ], 3);

  // ---- 2 address ----
  section('2. Address and contact');
  grid([
    ['Address', p.address, 3],
    ['Village', p.village], ['City', p.city], ['State', p.state],
    ['PIN code', p.pin], ['Servicing office', p.servicing_office, 2],
    ['Mobile', p.mobile], ['Tel. (with STD)', p.tel_std], ['Home tel.', p.tel_home],
    ['E-mail', p.email, 3],
  ], 3);

  // ---- 3 nominee ----
  section('3. Nominee');
  grid([
    ['Nominee name', p.nominee_name], ['Relationship', p.nominee_relation], ['Contact number', p.nominee_contact],
    ['Nominee address', p.nominee_address, 3],
  ], 3);

  // ---- 4 insured persons ----
  section('4. Insured persons');
  const count = Number(p.persons) === 2 ? 2 : 1;
  const per = (i, k) => p[`p${i}_${k}`];
  const rowsOf = (label, fn) => [label, ...Array.from({ length: count }, (_, i) => safe(fn(i + 1)))];
  table(['Detail', 'Insured person 1', ...(count === 2 ? ['Insured person 2'] : [])], [
    rowsOf('Relation to proposer', (i) => per(i, 'relation')),
    rowsOf('Name', (i) => per(i, 'name')),
    rowsOf('Gender', (i) => per(i, 'gender')),
    rowsOf('Date of birth', (i) => per(i, 'dob')),
    rowsOf('Age', (i) => (ageOn(per(i, 'dob')) === null ? '-' : `${ageOn(per(i, 'dob'))} years`)),
    rowsOf('Aadhaar (masked)', (i) => per(i, 'aadhaar')),
    rowsOf('Sum insured', (i) => { const v = sumInsuredValue(per(i, 'sum_insured')); return v ? inr0(v) : per(i, 'sum_insured'); }),
    rowsOf('Height (m)', (i) => per(i, 'height')),
    rowsOf('Weight (kg)', (i) => per(i, 'weight')),
    rowsOf('BMI', (i) => { const b = bmiOf(per(i, 'height'), per(i, 'weight')); return b === null ? '-' : b; }),
    rowsOf('Blood group', (i) => per(i, 'blood_group')),
    rowsOf('Marital status', (i) => per(i, 'marital_status')),
    rowsOf('Dependent', (i) => per(i, 'dependent')),
    rowsOf('Employment', (i) => per(i, 'employment')),
    rowsOf('Occupation', (i) => per(i, 'occupation')),
  ], count === 2 ? [2.2, 3, 3] : [2.2, 6]);

  // ---- 5 medical ----
  section('5. Medical history and habits (insured person 1)');
  grid([['Ever suffered from any listed condition?', yn(p.any_condition), 3]], 3);
  table(['Condition', 'Answer', 'Habit', 'Answer'], [
    ['Diabetes Mellitus', yn(p.p1_diabetes), 'Chewable tobacco / gutkha / pan masala', yn(p.p1_tobacco)],
    ['Hypertension', yn(p.p1_hypertension), 'Alcohol', yn(p.p1_alcohol)],
    ['Haemolytic Anaemia', yn(p.p1_haemolytic_anaemia), 'Cigarettes', yn(p.p1_cigarettes)],
    ['Epilepsy', yn(p.p1_epilepsy), 'Quantity per week', p.habit_quantity],
    ['Renal Stones', yn(p.p1_renal_stones), '', ''],
    ['Asthma', yn(p.p1_asthma), '', ''],
  ], [3, 1.3, 3.6, 1.6]);

  // ---- 6 covers ----
  section('6. Optional covers');
  grid([
    ['Covers selected', (p.covers || []).map((c) => COVER_LABELS[c] || c).join(', ') || '-', 3],
    ['Restoration of sum insured', yn(p.p1_restoration)], ['Maternity and new-born baby cover', yn(p.p1_maternity)],
    ['Daily cash allowance', yn(p.p1_daily_cash)], ['Daily cash amount', p.p1_daily_cash_amt],
  ], 3);

  // ---- 7 premium ----
  section('7. Premium computation');
  if (q) {
    table(['Insured', 'Age', 'Sum insured', 'Base', 'Loadings', 'Family disc.', 'Subtotal'],
      q.persons.map((l) => [`${l.person}. ${l.name}`, String(l.age), inr0(l.sum_insured), inr(l.base), inr(l.loading_total), inr(l.family_discount), inr(l.subtotal)]),
      [3, 0.9, 1.8, 1.7, 1.7, 1.7, 1.8], { align: ['', 'right', 'right', 'right', 'right', 'right', 'right'] });

    const loadRows = [];
    q.persons.forEach((l) => l.loadings.filter((x) => !x.note).forEach((x) => loadRows.push([`Person ${l.person}: ${x.label}`, `${Math.round(x.pct * 1000) / 10}%`, inr(x.amount)])));
    if (loadRows.length) table(['Loading applied', 'Rate', 'Amount'], loadRows, [6, 1.2, 2], { align: ['', 'right', 'right'] });

    const sumRows = [
      ['Base premium', inr(q.totals.base)],
      ['Loadings (BMI, occupation, medical history, habits)', inr(q.totals.loading)],
      ['Family discount (2nd insured person)', `- ${inr(q.totals.family_discount)}`],
      ...q.addons.map((a) => [`Add-on: ${a.label}${a.not_applicable ? ' (not applicable)' : ''}`, inr(a.amount)]),
      ['Digital (WhatsApp) discount', `- ${inr(q.totals.digital_discount)}`],
      ['Net premium', inr(q.totals.net)],
      [`GST @ ${Math.round(q.totals.gst_rate * 100)}%`, inr(q.totals.gst)],
      ['Total annual premium', inr(q.totals.annual)],
    ];
    table(['Premium summary', 'Amount'], sumRows, [7, 2.4], { align: ['', 'right'] });
    table(['Payment option', 'Instalment amount'], [
      ['Annual (1 payment)', inr(p.premium_annual)], ['Half-yearly (2 payments, 2% loading)', inr(p.premium_half_yearly)],
      ['Quarterly (4 payments, 4% loading)', inr(p.premium_quarterly)], ['Monthly (12 payments, 6% loading)', inr(p.premium_monthly)],
    ], [7, 2.4], { align: ['', 'right'] });
  } else {
    grid([['Premium', 'Not available yet. Insured person details (date of birth and sum insured) are required.', 3]], 3);
  }

  // ---- 8 documents ----
  section('8. Documents received via WhatsApp');
  if (documents.length) {
    const labels = { id_proof: 'ID proof', address_proof: 'Proof of residence', age_proof: 'Proof of age', previous_policy_docs: 'Previous policy', prepolicy_reports: 'Medical / check-up report', pan_doc: 'PAN or Form 60/61' };
    need(30);
    rect(M, y - 18, CW, 18, C.navy);
    [['Document', 0], ['File name', 130], ['Short link', 290]].forEach(([h, dx]) => text(h, M + 5 + dx, y - 12.5, { size: 8, font: bold, color: C.white }));
    y -= 18;
    documents.forEach((d, i) => {
      need(20);
      if (i % 2 === 0) rect(M, y - 18, CW, 18, C.zebra);
      text(labels[d.doc_type] || d.doc_type, M + 5, y - 12, { size: 8.6 });
      text(safe(d.file_name).slice(0, 34), M + 135, y - 12, { size: 8.6 });
      const u = d.short_url || (d.status === 'failed' ? 'upload failed' : '-');
      text(u, M + 295, y - 12, { size: 8.6, color: d.short_url ? C.blue : C.red });
      if (d.short_url) link(M + 295, y - 15, w(u, 8.6), 12, d.short_url);
      y -= 18;
    });
    hline(y); y -= 6;
  } else {
    grid([['Documents', 'No documents received yet.', 3]], 3);
  }

  // ---- declaration ----
  section('9. Declaration and important notes');
  [
    'The proposer declares that the information given in this proposal is true and complete and that he or she is authorised to propose for all persons listed. This information is the basis of the policy.',
    'Cover starts only after the proposal is accepted and the full premium is received. Submission of this proposal or payment of premium does not oblige the insurer to issue a policy.',
    'Aadhaar and PAN are stored in masked form only. This quote is indicative and valid until the date shown above.',
  ].forEach((t) => {
    const ls = wrap(t, 8.6, CW - 6);
    need(ls.length * 11 + 6);
    ls.forEach((ln, i) => text(ln, M + 3, y - 10 - i * 11, { size: 8.6, color: C.ink }));
    y -= ls.length * 11 + 6;
  });
  need(46);
  y -= 4;
  hline(y - 24, M, M + 200, C.muted, 0.6); text('Proposer signature / digital acceptance', M, y - 36, { size: 8, color: C.muted });
  hline(y - 24, W - M - 140, W - M, C.muted, 0.6); text(`Date: ${nowIST().date}`, W - M - 140, y - 36, { size: 8, color: C.muted });

  // ---- footers (need total page count) ----
  const pages = pdf.getPages();
  pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: 38 }, end: { x: W - M, y: 38 }, thickness: 0.6, color: C.line });
    pg.drawText(safe(`${company}  |  Proposal ${p.proposal_no}  |  Generated ${issued}`), { x: M, y: 25, size: 7.5, font: reg, color: C.muted });
    const label = `Page ${i + 1} of ${pages.length}`;
    pg.drawText(label, { x: W - M - reg.widthOfTextAtSize(label, 7.5), y: 25, size: 7.5, font: reg, color: C.muted });
  });

  return Buffer.from(await pdf.save());
}

module.exports = { buildProposalPdf };
