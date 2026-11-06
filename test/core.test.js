'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { maskAadhaar, maskPan } = require('../lib/mask');
const { toDDMMYYYY, nowIST, ageOn, parseDDMMYYYY, formatIST } = require('../lib/dates');
const { normalize } = require('../lib/flows');
const { computeQuote, quoteToColumns } = require('../lib/premium');
const { signToken, verifyToken } = require('../lib/auth');
const { randomCode } = require('../lib/storage');
const { insuredPrefill } = require('../lib/prefill');
const { samples } = require('../scripts/sample-data');

test('Aadhaar keeps only the last 4 digits (first 8 hidden)', () => {
  assert.equal(maskAadhaar('652134215432'), 'XXXXXXXX5432');
  assert.equal(maskAadhaar('6521 3421 5432'), 'XXXXXXXX5432');
  assert.equal(maskAadhaar(''), null);
  assert.equal(maskAadhaar('XXXXXXXX5432'), 'XXXXXXXX5432', 'an already masked value is kept, not re-masked');
  assert.equal(maskAadhaar('xxxxxxxx5432'), 'XXXXXXXX5432');
});

test('PAN keeps first 2 and last 1 character', () => {
  assert.equal(maskPan('ANOPC2357P'), 'ANXXXXXXXP');
  assert.equal(maskPan('anopc2357p'), 'ANXXXXXXXP');
  assert.equal(maskPan(null), null);
});

test('dates become DD-MM-YYYY', () => {
  assert.equal(toDDMMYYYY('1989-05-22'), '22-05-1989');
  assert.equal(toDDMMYYYY('22/05/1989'), '22-05-1989');
  assert.equal(toDDMMYYYY('22-5-1989'), '22-05-1989');
  assert.equal(toDDMMYYYY('2026-11-05T10:00:00Z'), '05-11-2026');
  assert.equal(toDDMMYYYY('garbage'), null);
  assert.equal(parseDDMMYYYY('31-02-2026'), null);
});

test('time zone is India: 2026-11-05 20:00 UTC is 06-11-2026 01-30 IST, format hh-mm', () => {
  const n = nowIST(new Date('2026-11-05T20:00:00Z'));
  assert.equal(n.date, '06-11-2026');
  assert.equal(n.time, '01-30');
  assert.equal(formatIST('2026-11-05T20:00:00Z'), '06-11-2026 01-30');
});

test('age is calculated in completed years on the IST date', () => {
  const ref = new Date('2026-11-05T06:00:00Z');
  assert.equal(ageOn('22-05-1989', ref), 37);
  assert.equal(ageOn('05-11-1990', ref), 36);   // birthday today
  assert.equal(ageOn('06-11-1990', ref), 35);   // birthday tomorrow
});

test('normalize masks identifiers, converts dates and fills "No" for every disease', () => {
  const a = normalize('personal', { full_name: ' A ', dob: '1989-05-22', pan: 'ANOPC2357P', aadhaar: '652134215432', mobile: '9560458200', contact_consent: 'true', junk: 'x' });
  assert.deepEqual(a.patch, { full_name: 'A', dob: '22-05-1989', pan: 'ANXXXXXXXP', aadhaar: 'XXXXXXXX5432', mobile: '9560458200', contact_consent: true });
  const m = normalize('medical', { any_condition: 'No' });
  assert.equal(m.patch.p1_diabetes, 'No'); assert.equal(m.patch.p1_asthma, 'No');
  const i = normalize('insured', { persons: '1', p1_dob: '1989-05-22', p1_sum_insured: 'Rs 5,00,000', p2_name: 'ignored' });
  assert.equal(i.patch.p2_name, null);
  assert.equal(normalize('insured', { persons: '3' }).errors.length, 1);
});

test('premium: documented example is internally consistent', () => {
  const q = computeQuote(samples[0], new Date('2026-11-05T06:00:00Z'));
  assert.equal(q.ready, true);
  const t = q.totals;
  assert.equal(Math.round((t.net + t.gst) * 100) / 100, t.annual);
  assert.equal(Math.round(t.net * 0.18 * 100) / 100, t.gst);
  assert.equal(q.options.annual, t.annual);
  assert.ok(q.options.monthly * 12 > t.annual, 'monthly instalments carry a loading');
  assert.ok(q.options.half_yearly * 2 > t.annual);
  // person 1 loadings: BMI 25.88 (+5%), hypertension (+15%), alcohol (+5%)
  const labels = q.persons[0].loadings.map((l) => l.label);
  assert.ok(labels.some((l) => l.startsWith('BMI')));
  assert.ok(labels.includes('Condition: Hypertension'));
  assert.ok(labels.includes('Habit: Alcohol'));
  assert.ok(q.persons[1].family_discount > 0, '2nd person gets the family discount');
  assert.ok(q.addons.find((a) => a.code === 'maternity').amount > 0, 'female aged 35 is eligible');
});

test('premium: risk moves it the right way', () => {
  const ref = new Date('2026-11-05T06:00:00Z');
  const base = { persons: 1, p1_dob: '01-01-1990', p1_sum_insured: 'Rs 5,00,000', p1_height: 1.7, p1_weight: 65, p1_occupation: 'Service' };
  const clean = computeQuote(base, ref).totals.annual;
  assert.ok(computeQuote({ ...base, p1_dob: '01-01-1960' }, ref).totals.annual > clean, 'older costs more');
  assert.ok(computeQuote({ ...base, p1_sum_insured: 'Rs 10,00,000' }, ref).totals.annual > clean, 'higher cover costs more');
  assert.ok(computeQuote({ ...base, p1_diabetes: 'Yes' }, ref).totals.annual > clean, 'condition loads');
  assert.ok(computeQuote({ ...base, p1_tobacco: 'Yes', p1_cigarettes: 'Yes' }, ref).totals.annual > clean, 'habits load');
  assert.ok(computeQuote({ ...base, p1_weight: 110 }, ref).totals.annual > clean, 'high BMI loads');
  assert.ok(computeQuote({ ...base, p1_restoration: 'Yes' }, ref).totals.annual > clean, 'add-on adds');
  // everything at once is capped, never above +75% for conditions/habits
  const all = computeQuote({ ...base, p1_diabetes: 'Yes', p1_hypertension: 'Yes', p1_epilepsy: 'Yes', p1_haemolytic_anaemia: 'Yes', p1_tobacco: 'Yes', p1_cigarettes: 'Yes', p1_alcohol: 'Yes' }, ref);
  const medPct = all.persons[0].loadings.filter((l) => /^(Condition|Habit)/.test(l.label)).reduce((s, l) => s + l.pct, 0);
  assert.ok(medPct <= 0.7501);
});

test('premium: not ready without date of birth / sum insured, ready after', () => {
  assert.equal(computeQuote({ persons: 1 }).ready, false);
  const q = computeQuote({ persons: 2, p1_dob: '01-01-1990', p1_sum_insured: 'Rs 5,00,000' });
  assert.equal(q.ready, false);
  assert.ok(q.missing.includes('p2_dob'));
  assert.equal(quoteToColumns(q).quote_status, 'not_ready');
});

test('maternity is not charged when nobody is eligible', () => {
  const q = computeQuote({ persons: 1, p1_dob: '01-01-1990', p1_gender: 'Male', p1_sum_insured: 'Rs 5,00,000', p1_maternity: 'Yes' });
  const m = q.addons.find((a) => a.code === 'maternity');
  assert.equal(m.amount, 0); assert.ok(m.not_applicable);
});

test('JWT: valid, tampered and expired tokens', () => {
  process.env.JWT_SECRET = 's3cret';
  const tok = signToken({ sub: 'admin' });
  assert.equal(verifyToken(tok).sub, 'admin');
  assert.equal(verifyToken(tok.slice(0, -2) + 'xx'), null);
  process.env.JWT_TTL_HOURS = '-1';
  assert.equal(verifyToken(signToken({ sub: 'x' })), null);
  process.env.JWT_TTL_HOURS = '8';
});

test('short codes are 8 characters, URL safe and differ', () => {
  const codes = new Set(Array.from({ length: 500 }, () => randomCode(8)));
  assert.equal(codes.size, 500);
  codes.forEach((c) => assert.match(c, /^[0-9A-Za-z]{8}$/));
});

test('prefill for flow 3 comes from flows 1 and 2, only ever masks Aadhaar, and always has every key', () => {
  const p = insuredPrefill({ full_name: 'Aditya Kumar', dob: '22-05-1989', gender: 'Male', marital_status: 'Married', occupation: 'Service', aadhaar: 'XXXXXXXX5432', nominee_name: 'Ankita', nominee_relation: 'Spouse' });
  assert.deepEqual(p, { p1_name: 'Aditya Kumar', p1_dob: '1989-05-22', p1_gender: 'Male', p1_relation: 'Self', p1_marital_status: 'Married', p1_occupation: 'Service', p1_aadhaar: 'XXXXXXXX5432', p1_aadhaar_editable: false, p2_name: 'Ankita', p2_relation: 'Spouse' });
  assert.ok(!/\d{12}/.test(JSON.stringify(p)), 'only the masked Aadhaar is ever prefilled');
  const none = insuredPrefill(null);
  assert.equal(Object.keys(none).length, 10);
  assert.equal(none.p1_aadhaar_editable, true, 'nothing on file: the field stays editable');
  assert.ok(Object.entries(none).filter(([k]) => k !== 'p1_aadhaar_editable').every(([, v]) => v === ''));
  const odd = insuredPrefill({ full_name: 'X', gender: 'Other', marital_status: 'Complicated', occupation: 'Astronaut', aadhaar: '123456789012', nominee_relation: 'Father', nominee_name: 'Y' });
  assert.equal(odd.p1_gender, ''); assert.equal(odd.p1_marital_status, ''); assert.equal(odd.p1_occupation, '');
  assert.equal(odd.p1_aadhaar, '', 'an unmasked value is never passed on'); assert.equal(odd.p1_aadhaar_editable, true); assert.equal(odd.p2_name, '', 'only a spouse nominee is prefilled as person 2');
});

test('submitting the prefilled masked Aadhaar keeps it; typing a new number masks the new one', () => {
  const base = { persons: '1', p1_dob: '1989-05-22', p1_sum_insured: 'Rs 5,00,000' };
  assert.equal(normalize('insured', { ...base, p1_aadhaar: 'XXXXXXXX5432' }).patch.p1_aadhaar, 'XXXXXXXX5432');
  assert.equal(normalize('insured', { ...base, p1_aadhaar: '111122223333' }).patch.p1_aadhaar, 'XXXXXXXX3333');
});

test('sum insured text: rupee sign, Rs, plain, lakh and crore forms are all understood', () => {
  const { sumInsuredValue } = require('../lib/premium');
  assert.equal(sumInsuredValue('Rs 10,00,000'), 1000000);
  assert.equal(sumInsuredValue('\u20B93,00,000'), 300000, 'with the rupee sign');
  assert.equal(sumInsuredValue('3,00,000'), 300000, 'without any prefix');
  assert.equal(sumInsuredValue('Rs. 15,00,000/-'), 1500000);
  assert.equal(sumInsuredValue('10 lakh'), 1000000);
  assert.equal(sumInsuredValue('7.5L'), 750000);
  assert.equal(sumInsuredValue('1 crore'), 10000000);
  assert.equal(sumInsuredValue('5,00,000'), 500000);
});

test('a sum insured above 15 lakh is reported with the value received, and the premium columns are cleared', () => {
  const q = computeQuote({ persons: 1, p1_dob: '01-01-1990', p1_sum_insured: 'Rs 20,00,000' });
  assert.equal(q.ready, false);
  assert.match(q.missing[0], /value "Rs 20,00,000" is outside the supported range/);
  const cols = quoteToColumns(q);
  assert.equal(cols.quote_status, 'not_ready');
  assert.equal(cols.premium_annual, null);
  assert.equal(cols.premium_breakdown, null);
});

test('every amount from Rs 1 lakh to Rs 15 lakh is priced, in both formats, and the price only ever goes up with the cover', () => {
  const ref = new Date('2026-11-05T06:00:00Z');
  const base = { persons: 1, p1_dob: '01-01-1990', p1_height: 1.7, p1_weight: 65, p1_occupation: 'Service' };
  const price = (si) => { const q = computeQuote({ ...base, p1_sum_insured: si }, ref); assert.equal(q.ready, true, String(si)); return q.totals.annual; };
  assert.equal(price('\u20B93,00,000'), price('3,00,000'));
  assert.equal(price('3,00,000'), price('Rs 3,00,000'));
  const amounts = [100000, 200000, 300000, 400000, 500000, 600000, 750000, 800000, 1000000, 1200000, 1250000, 1500000];
  const prices = amounts.map(price);
  prices.forEach((p, i) => { if (i) assert.ok(p > prices[i - 1], `${amounts[i]} must cost more than ${amounts[i - 1]}`); });
  assert.equal(computeQuote({ ...base, p1_sum_insured: '15,00,001' }, ref).ready, false);
  assert.equal(computeQuote({ ...base, p1_sum_insured: '99,999' }, ref).ready, false);
});

test('a date of birth that is impossible (future or older than 120 years) stops the quote', () => {
  const ref = new Date('2026-11-05T06:00:00Z');
  const row = { persons: 1, p1_sum_insured: '5,00,000' };
  assert.equal(computeQuote({ ...row, p1_dob: '01-01-2030' }, ref).ready, false);
  assert.equal(computeQuote({ ...row, p1_dob: '01-01-1890' }, ref).ready, false);
  assert.equal(computeQuote({ ...row, p1_dob: '01-01-1990' }, ref).ready, true);
});
