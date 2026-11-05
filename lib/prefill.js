'use strict';
const { toDDMMYYYY } = require('./dates');

/*
 * Prefill for flow 3 (insured persons), built from what the customer already gave in flows 1 and 2.
 * Returned as the `data` object of the Flow's first screen; the flow forwards it to the person screen,
 * where each field uses  init-value = ${data.<name>}.
 *
 * Aadhaar is prefilled in MASKED form only (XXXXXXXX5432): the full number is never stored. The flow field accepts the masked
 * value, and the server keeps it unchanged when it comes back.
 */
const GENDERS = ['Male', 'Female', 'Transgender'];
const MARITAL = ['Single', 'Married', 'Divorced', 'Widowed'];
const OCCUPATIONS = ['Advocate / Lawyer', 'Businessman - Large Scale', 'Businessman - Medium Scale', 'Businessman - Small Scale', 'Chartered Accountants', 'Clerical', 'Executive - Middle Level', 'Executive - Senior Level', 'Executive - Junior Level', 'Farming', 'Housewife', 'Labourer', 'Not working', 'Others', 'Retired', 'Salesperson', 'Self employed Professional', 'Service', 'Shop owner', 'Software Professional', 'Student', 'Supervisor'];

const KEYS = ['p1_name', 'p1_dob', 'p1_gender', 'p1_relation', 'p1_marital_status', 'p1_occupation', 'p1_aadhaar', 'p2_name', 'p2_relation'];

const oneOf = (v, list) => (list.includes(v) ? v : '');
// DatePicker init-value must be YYYY-MM-DD; the database keeps DD-MM-YYYY.
const toIso = (ddmmyyyy) => {
  const d = toDDMMYYYY(ddmmyyyy);
  if (!d) return '';
  const [dd, mm, yy] = d.split('-');
  return `${yy}-${mm}-${dd}`;
};

// Every key is always present (empty string when unknown) so the Flow never reads a missing value.
function insuredPrefill(row) {
  const out = Object.fromEntries(KEYS.map((k) => [k, '']));
  if (!row) return out;
  out.p1_name = row.full_name || '';
  out.p1_dob = toIso(row.dob);
  out.p1_gender = oneOf(row.gender, GENDERS);
  out.p1_relation = row.full_name ? 'Self' : '';
  out.p1_marital_status = oneOf(row.marital_status, MARITAL);
  out.p1_occupation = oneOf(row.occupation, OCCUPATIONS);
  out.p1_aadhaar = /^X{8}\d{4}$/.test(row.aadhaar || '') ? row.aadhaar : '';
  if (row.nominee_relation === 'Spouse' && row.nominee_name) {   // a spouse nominee is the likely second insured person
    out.p2_name = row.nominee_name;
    out.p2_relation = 'Spouse';
  }
  return out;
}

module.exports = { insuredPrefill, KEYS };
