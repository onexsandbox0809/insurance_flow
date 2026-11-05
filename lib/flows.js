'use strict';
const { toDDMMYYYY } = require('./dates');
const { maskAadhaar, maskPan } = require('./mask');

/*
 * One definition per WhatsApp flow. Column names are identical to the flow variable names,
 * so a flow payload maps straight onto the `proposals` table.
 *
 * kinds: text | date | aadhaar | pan | bool | num | int | array | yesno
 */
const OCCUPATIONS_NOTE = 'free text, validated by the flow dropdown';

const person = (p) => ({
  [`${p}_gender`]: 'text', [`${p}_relation`]: 'text', [`${p}_name`]: 'text', [`${p}_dob`]: 'date',
  [`${p}_aadhaar`]: 'aadhaar', [`${p}_sum_insured`]: 'text', [`${p}_height`]: 'num', [`${p}_weight`]: 'num',
  [`${p}_blood_group`]: 'text', [`${p}_marital_status`]: 'text', [`${p}_dependent`]: 'yesno',
  [`${p}_employment`]: 'text', [`${p}_occupation`]: 'text',
});

const FLOWS = {
  personal: {
    number: 1, label: 'Personal information', column: 'flow_personal_at',
    fields: {
      full_name: 'text', dob: 'date', gender: 'text', marital_status: 'text', occupation: 'text',
      pan: 'pan', aadhaar: 'aadhaar', e_insurance_no: 'text',
      pin: 'text', city: 'text', state: 'text', village: 'text', address: 'text', servicing_office: 'text',
      tel_std: 'text', tel_home: 'text', mobile: 'text', email: 'text', ckyc_no: 'text', contact_consent: 'bool',
    },
    required: ['full_name', 'dob', 'mobile'],
  },
  nominee: {
    number: 2, label: 'Nominee', column: 'flow_nominee_at',
    fields: { nominee_name: 'text', nominee_relation: 'text', nominee_address: 'text', nominee_contact: 'text' },
    required: ['nominee_name'],
  },
  insured: {
    number: 3, label: 'Insured persons', column: 'flow_insured_at',
    fields: { persons: 'int', ...person('p1'), ...person('p2') },
    required: ['persons', 'p1_dob', 'p1_sum_insured'],
  },
  medical: {
    number: 5, label: 'Medical and habits', column: 'flow_medical_at',
    fields: {
      any_condition: 'yesno', p1_diabetes: 'yesno', p1_hypertension: 'yesno', p1_haemolytic_anaemia: 'yesno',
      p1_epilepsy: 'yesno', p1_renal_stones: 'yesno', p1_asthma: 'yesno',
      p1_tobacco: 'yesno', p1_alcohol: 'yesno', p1_cigarettes: 'yesno', habit_quantity: 'text',
    },
    required: ['any_condition'],
  },
  covers: {
    number: 6, label: 'Optional covers', column: 'flow_covers_at',
    fields: { covers: 'array', p1_restoration: 'yesno', p1_maternity: 'yesno', p1_daily_cash: 'yesno', p1_daily_cash_amt: 'text' },
    required: [],
  },
  documents: { number: 7, label: 'Documents', column: 'flow_documents_at', fields: {}, required: [] },
};

const DATA_FLOWS = ['personal', 'nominee', 'insured', 'medical', 'covers'];   // flows that feed the quote/PDF
const ALL_FLOWS = [...DATA_FLOWS, 'documents'];

const DISEASE_COLS = ['p1_diabetes', 'p1_hypertension', 'p1_haemolytic_anaemia', 'p1_epilepsy', 'p1_renal_stones', 'p1_asthma'];

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function clean(kind, v) {
  if (blank(v)) return null;
  switch (kind) {
    case 'text': return String(v).trim();
    case 'date': return toDDMMYYYY(v);
    case 'aadhaar': return maskAadhaar(v);
    case 'pan': return maskPan(v);
    case 'bool': return v === true || /^(true|yes|1|y)$/i.test(String(v));
    case 'num': { const n = Number(v); return Number.isFinite(n) ? n : null; }
    case 'int': { const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
    case 'array':
      if (Array.isArray(v)) return v.map(String);
      return String(v).split(',').map((x) => x.trim()).filter(Boolean);
    case 'yesno': { const s = String(v).trim().toLowerCase(); return s === 'yes' ? 'Yes' : s === 'no' ? 'No' : null; }
    default: return null;
  }
}

// Turns a raw flow payload into a patch for the proposals table.
// Sensitive ids are masked here, so the raw value never reaches the database or the audit log.
function normalize(flowKey, raw) {
  const def = FLOWS[flowKey];
  const src = raw && typeof raw.data === 'object' && raw.data ? { ...raw.data } : { ...raw };
  const patch = {};
  const errors = [];
  for (const [col, kind] of Object.entries(def.fields)) {
    if (!(col in src)) continue;
    const v = clean(kind, src[col]);
    if (kind === 'date' && !blank(src[col]) && v === null) errors.push(`${col}: unrecognised date`);
    patch[col] = v;
  }
  // Business rules applied server-side
  if (flowKey === 'insured') {
    if (patch.persons === 1) Object.keys(person('p2')).forEach((c) => { patch[c] = null; });
    if (patch.persons !== undefined && patch.persons !== 1 && patch.persons !== 2) errors.push('persons must be 1 or 2');
  }
  if (flowKey === 'medical') {
    if (patch.any_condition === 'No') DISEASE_COLS.forEach((c) => { patch[c] = 'No'; });          // "No" fills No against every disease
    else if (patch.any_condition === 'Yes') DISEASE_COLS.forEach((c) => { if (!patch[c]) patch[c] = 'No'; });
    ['p1_tobacco', 'p1_alcohol', 'p1_cigarettes'].forEach((c) => { if (c in src && !patch[c]) patch[c] = 'No'; });
  }
  const missing = def.required.filter((c) => blank(patch[c]) && blank(src[c]));
  return { patch, errors, missing };
}

module.exports = { FLOWS, DATA_FLOWS, ALL_FLOWS, normalize, DISEASE_COLS, OCCUPATIONS_NOTE };
