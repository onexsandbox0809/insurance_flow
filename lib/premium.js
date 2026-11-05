'use strict';
/*
 * Health insurance quote engine.
 *
 * IMPORTANT: every rate in this file is an ILLUSTRATIVE placeholder so the system works end to end.
 * Replace the tables below with your insurer's filed tariff before you quote real customers.
 *
 * Method (per insured person):
 *   base      = age-band rate (for Rs 5 lakh)  x  sum-insured factor
 *   loadings  = BMI + occupation (+ medical conditions + habits for person 1, who answered flow 5)
 *   subtotal  = base + loadings
 *   2nd person gets a family discount on the subtotal
 * Policy level:
 *   + add-ons (restoration, maternity, daily cash)
 *   - digital (WhatsApp) discount
 *   = net premium, then GST 18%  =>  annual premium
 *   instalment options carry a small loading
 */
const { ageOn, addDaysIST } = require('./dates');

const GST_RATE = 0.18;
const FAMILY_DISCOUNT = 0.10;     // on the 2nd insured person
const DIGITAL_DISCOUNT = 0.05;    // on (all person subtotals + add-ons)
const QUOTE_VALID_DAYS = 15;

// Annual base premium at Rs 5,00,000 by age band (inclusive).
const AGE_BANDS = [
  { from: 0,  to: 17,  rate: 3200 },
  { from: 18, to: 25,  rate: 4600 },
  { from: 26, to: 35,  rate: 5600 },
  { from: 36, to: 45,  rate: 7600 },
  { from: 46, to: 55,  rate: 11800 },
  { from: 56, to: 60,  rate: 16200 },
  { from: 61, to: 65,  rate: 20800 },
  { from: 66, to: 70,  rate: 27400 },
  { from: 71, to: 120, rate: 34500 },
];

// Premium does not grow linearly with cover.
const SUM_INSURED_FACTOR = { 300000: 0.78, 400000: 0.90, 500000: 1.0, 750000: 1.30, 1000000: 1.55 };

const MATERNITY_FLAT = { 300000: 1800, 400000: 2200, 500000: 2600, 750000: 3400, 1000000: 4200 };
const RESTORATION_PCT = 0.03;      // of (base + loadings), per insured person
const DAILY_CASH_FACTOR = 1.4;     // annual premium = per-day amount x 1.4, per insured person

const CONDITION_LOADING = {
  p1_diabetes: ['Diabetes Mellitus', 0.25],
  p1_hypertension: ['Hypertension', 0.15],
  p1_haemolytic_anaemia: ['Haemolytic Anaemia', 0.20],
  p1_epilepsy: ['Epilepsy', 0.25],
  p1_renal_stones: ['Renal Stones', 0.10],
  p1_asthma: ['Asthma', 0.10],
};
const HABIT_LOADING = {
  p1_tobacco: ['Chewable tobacco / gutkha / pan masala', 0.10],
  p1_alcohol: ['Alcohol', 0.05],
  p1_cigarettes: ['Cigarettes', 0.10],
};
const MEDICAL_LIFESTYLE_CAP = 0.75; // conditions + habits can never load more than this

const OCCUPATION_LOADING = {
  'Farming': 0.08, 'Labourer': 0.10, 'Others': 0.05,
  'Businessman - Large Scale': 0.03, 'Businessman - Medium Scale': 0.03, 'Businessman - Small Scale': 0.03,
  'Salesperson': 0.03, 'Shop owner': 0.03, 'Supervisor': 0.03,
};

const INSTALMENTS = [
  { key: 'annual',      label: 'Annual',       loading: 0,    divisor: 1 },
  { key: 'half_yearly', label: 'Half-yearly',  loading: 0.02, divisor: 2 },
  { key: 'quarterly',   label: 'Quarterly',    loading: 0.04, divisor: 4 },
  { key: 'monthly',     label: 'Monthly',      loading: 0.06, divisor: 12 },
];

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const yes = (v) => String(v || '').toLowerCase() === 'yes';

function sumInsuredValue(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^\d]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function bmiOf(heightM, weightKg) {
  const h = Number(heightM), w = Number(weightKg);
  if (!(h > 0.5 && h < 2.6) || !(w > 2 && w < 400)) return null;
  return r2(w / (h * h));
}

function bmiLoading(bmi) {
  if (bmi === null) return 0;
  if (bmi < 16) return 0.10;
  if (bmi < 18.5) return 0.03;
  if (bmi < 25) return 0;
  if (bmi < 30) return 0.05;
  if (bmi < 35) return 0.15;
  return 0.30;
}

function bandRate(age) {
  const b = AGE_BANDS.find((x) => age >= x.from && age <= x.to);
  return b ? b.rate : null;
}

function personsOf(row) {
  const count = Number(row.persons) === 2 ? 2 : 1;
  const out = [];
  for (let i = 1; i <= count; i++) {
    const p = (k) => row[`p${i}_${k}`];
    out.push({
      index: i,
      name: p('name') || `Person ${i}`,
      gender: p('gender'),
      marital: p('marital_status'),
      dob: p('dob'),
      occupation: p('occupation'),
      sumInsured: sumInsuredValue(p('sum_insured')),
      height: p('height'),
      weight: p('weight'),
    });
  }
  return out;
}

function missingFields(row, persons) {
  const missing = [];
  persons.forEach((p) => {
    if (!p.dob || ageOn(p.dob) === null) missing.push(`p${p.index}_dob`);
    if (!p.sumInsured) missing.push(`p${p.index}_sum_insured`);
    if (p.sumInsured && !SUM_INSURED_FACTOR[p.sumInsured]) missing.push(`p${p.index}_sum_insured (unsupported value)`);
  });
  return missing;
}

function computeQuote(row, now = new Date()) {
  const persons = personsOf(row);
  const missing = row.persons ? missingFields(row, persons) : ['persons', 'p1_dob', 'p1_sum_insured'];
  if (missing.length) return { ready: false, missing };

  const lines = [];
  persons.forEach((p) => {
    const age = ageOn(p.dob, now);
    const rate = bandRate(age);
    const factor = SUM_INSURED_FACTOR[p.sumInsured];
    const base = r2(rate * factor);

    const loadings = [];
    const bmi = bmiOf(p.height, p.weight);
    const bmiPct = bmiLoading(bmi);
    if (bmiPct) loadings.push({ label: `BMI ${bmi}`, pct: bmiPct });
    const occPct = OCCUPATION_LOADING[p.occupation] || 0;
    if (occPct) loadings.push({ label: `Occupation: ${p.occupation}`, pct: occPct });

    if (p.index === 1) {
      const ml = [];
      Object.entries(CONDITION_LOADING).forEach(([col, [label, pct]]) => { if (yes(row[col])) ml.push({ label: `Condition: ${label}`, pct }); });
      Object.entries(HABIT_LOADING).forEach(([col, [label, pct]]) => { if (yes(row[col])) ml.push({ label: `Habit: ${label}`, pct }); });
      let total = ml.reduce((s, x) => s + x.pct, 0);
      if (total > MEDICAL_LIFESTYLE_CAP) {
        const k = MEDICAL_LIFESTYLE_CAP / total;
        ml.forEach((x) => { x.pct = r2(x.pct * k); });
        ml.push({ label: `Capped at ${MEDICAL_LIFESTYLE_CAP * 100}% for conditions and habits`, pct: 0, note: true });
      }
      loadings.push(...ml);
    }

    loadings.forEach((l) => { l.amount = r2(base * l.pct); });
    const loadingTotal = r2(loadings.reduce((s, l) => s + l.amount, 0));
    let subtotal = r2(base + loadingTotal);
    let familyDiscount = 0;
    if (p.index === 2) { familyDiscount = r2(subtotal * FAMILY_DISCOUNT); subtotal = r2(subtotal - familyDiscount); }

    lines.push({
      person: p.index, name: p.name, age, gender: p.gender, sum_insured: p.sumInsured,
      age_band_rate: rate, sum_insured_factor: factor, base, bmi, loadings, loading_total: loadingTotal,
      family_discount: familyDiscount, subtotal,
    });
  });

  // ---- add-ons (policy level, from flow 6) ----
  const addons = [];
  const coverList = Array.isArray(row.covers) ? row.covers : [];
  if (yes(row.p1_restoration)) {
    const amt = r2(lines.reduce((s, l) => s + (l.base + l.loading_total) * RESTORATION_PCT, 0));
    addons.push({ code: 'restoration', label: 'Restoration of sum insured', amount: amt });
  }
  if (yes(row.p1_maternity)) {
    const eligible = lines.find((l) => String(l.gender).toLowerCase() === 'female' && l.age >= 21 && l.age <= 45);
    if (eligible) {
      addons.push({ code: 'maternity', label: `Maternity and new-born baby cover (${eligible.name})`, amount: MATERNITY_FLAT[eligible.sum_insured] });
    } else {
      addons.push({ code: 'maternity', label: 'Maternity cover selected but no female insured aged 21 to 45', amount: 0, not_applicable: true });
    }
  }
  if (yes(row.p1_daily_cash)) {
    const perDay = sumInsuredValue(row.p1_daily_cash_amt) || 1000;
    const amt = r2(perDay * DAILY_CASH_FACTOR * lines.length);
    addons.push({ code: 'daily_cash', label: `Daily cash allowance Rs ${perDay}/day x ${lines.length} insured`, amount: amt });
  }
  // The covers checklist is informational: premium follows the per-person Yes/No answers above.
  const addonTotal = r2(addons.reduce((s, a) => s + a.amount, 0));

  const subtotalAll = r2(lines.reduce((s, l) => s + l.subtotal, 0));
  const beforeDiscount = r2(subtotalAll + addonTotal);
  const digitalDiscount = r2(beforeDiscount * DIGITAL_DISCOUNT);
  const net = r2(beforeDiscount - digitalDiscount);
  const gst = r2(net * GST_RATE);
  const annual = r2(net + gst);

  const options = {};
  INSTALMENTS.forEach((o) => { options[o.key] = r2((annual * (1 + o.loading)) / o.divisor); });

  const baseTotal = r2(lines.reduce((s, l) => s + l.base, 0));
  const loadingTotal = r2(lines.reduce((s, l) => s + l.loading_total, 0));
  const familyDiscountTotal = r2(lines.reduce((s, l) => s + l.family_discount, 0));

  return {
    ready: true,
    currency: 'INR',
    total_sum_insured: lines.reduce((s, l) => s + l.sum_insured, 0),
    totals: {
      base: baseTotal, loading: loadingTotal, family_discount: familyDiscountTotal, addons: addonTotal,
      digital_discount: digitalDiscount, net, gst, gst_rate: GST_RATE, annual,
    },
    options,
    persons: lines,
    addons,
    covers_selected: coverList,
    valid_till: addDaysIST(QUOTE_VALID_DAYS, now),
    notes: ['Illustrative rating tables. Replace with the insurer tariff before production use.'],
  };
}

// Maps the quote to the flat premium_* columns of the proposals table.
function quoteToColumns(q) {
  if (!q.ready) return { quote_status: 'not_ready' };
  return {
    quote_status: 'quoted',
    total_sum_insured: q.total_sum_insured,
    premium_base: q.totals.base,
    premium_loading: q.totals.loading,
    premium_discount: r2(q.totals.family_discount + q.totals.digital_discount),
    premium_addons: q.totals.addons,
    premium_net: q.totals.net,
    premium_gst: q.totals.gst,
    premium_annual: q.options.annual,
    premium_half_yearly: q.options.half_yearly,
    premium_quarterly: q.options.quarterly,
    premium_monthly: q.options.monthly,
    quote_valid_till: q.valid_till,
    premium_breakdown: q,
  };
}

module.exports = { computeQuote, quoteToColumns, sumInsuredValue, bmiOf, GST_RATE, INSTALMENTS, SUM_INSURED_FACTOR };
