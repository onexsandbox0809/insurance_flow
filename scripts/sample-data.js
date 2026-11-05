'use strict';
// Shared sample proposals used by the seed generator, the sample PDF and the tests.
const { computeQuote, quoteToColumns } = require('../lib/premium');

const base = {
  status: 'completed', premium_option: 'Annual',
  flows_completed: ['personal', 'nominee', 'insured', 'medical', 'covers', 'documents'],
};

const samples = [
  {
    ...base, proposal_no: 'HP-261101-00001', wa_id: '919217090193', entry_date: '01-11-2026', entry_time: '10-42',
    full_name: 'Aditya Kumar', dob: '22-05-1989', gender: 'Male', marital_status: 'Married', occupation: 'Service',
    pan: 'ANXXXXXXXP', aadhaar: 'XXXXXXXX5432', e_insurance_no: null, pin: '122101', city: 'Gurgaon', state: 'Haryana',
    village: 'Gurgaon', address: 'G 1901, BPTP Park Prime Society', servicing_office: 'DO 30 Gurugram (223000)',
    tel_std: null, tel_home: null, mobile: '9560458200', email: 'aditya.kumar@example.com', ckyc_no: null, contact_consent: true,
    nominee_name: 'Ankita', nominee_relation: 'Spouse', nominee_address: 'G 1901, BPTP Park Prime Society', nominee_contact: '9810011223',
    persons: 2,
    p1_gender: 'Male', p1_relation: 'Self', p1_name: 'Aditya Kumar', p1_dob: '22-05-1989', p1_aadhaar: 'XXXXXXXX5432', p1_sum_insured: 'Rs 10,00,000',
    p1_height: 1.78, p1_weight: 82, p1_blood_group: 'B+', p1_marital_status: 'Married', p1_dependent: 'Yes', p1_employment: 'Salaried', p1_occupation: 'Service',
    p2_gender: 'Female', p2_relation: 'Spouse', p2_name: 'Ankita Kumar', p2_dob: '14-09-1991', p2_aadhaar: 'XXXXXXXX9981', p2_sum_insured: 'Rs 10,00,000',
    p2_height: 1.62, p2_weight: 58, p2_blood_group: 'O+', p2_marital_status: 'Married', p2_dependent: 'Yes', p2_employment: 'Homemaker', p2_occupation: 'Housewife',
    any_condition: 'Yes', p1_diabetes: 'No', p1_hypertension: 'Yes', p1_haemolytic_anaemia: 'No', p1_epilepsy: 'No', p1_renal_stones: 'No', p1_asthma: 'No',
    p1_tobacco: 'No', p1_alcohol: 'Yes', p1_cigarettes: 'No', habit_quantity: 'Alcohol: 2 drinks per week',
    covers: ['restoration', 'maternity', 'daily_cash'], p1_restoration: 'Yes', p1_maternity: 'Yes', p1_daily_cash: 'Yes', p1_daily_cash_amt: 'Rs 1000/Day',
  },
  {
    ...base, proposal_no: 'HP-261102-00002', wa_id: '919876543210', entry_date: '02-11-2026', entry_time: '15-08',
    full_name: 'Meera Nair', dob: '03-02-1996', gender: 'Female', marital_status: 'Single', occupation: 'Software Professional',
    pan: 'BKXXXXXXXQ', aadhaar: 'XXXXXXXX1207', pin: '560034', city: 'Bengaluru', state: 'Karnataka', village: 'Koramangala',
    address: '14, 5th Cross, Koramangala', servicing_office: 'DO 11 Bengaluru (541100)', mobile: '9876543210', email: 'meera.nair@example.com', contact_consent: true,
    nominee_name: 'Raghavan Nair', nominee_relation: 'Father', nominee_address: 'Thrissur, Kerala', nominee_contact: '9447012345',
    persons: 1,
    p1_gender: 'Female', p1_relation: 'Self', p1_name: 'Meera Nair', p1_dob: '03-02-1996', p1_aadhaar: 'XXXXXXXX1207', p1_sum_insured: 'Rs 5,00,000',
    p1_height: 1.65, p1_weight: 55, p1_blood_group: 'A+', p1_marital_status: 'Single', p1_dependent: 'No', p1_employment: 'Salaried', p1_occupation: 'Software Professional',
    any_condition: 'No', p1_diabetes: 'No', p1_hypertension: 'No', p1_haemolytic_anaemia: 'No', p1_epilepsy: 'No', p1_renal_stones: 'No', p1_asthma: 'No',
    p1_tobacco: 'No', p1_alcohol: 'No', p1_cigarettes: 'No',
    covers: ['restoration'], p1_restoration: 'Yes', p1_maternity: 'No', p1_daily_cash: 'No',
  },
  {
    ...base, status: 'quoted', flows_completed: ['personal', 'nominee', 'insured', 'medical', 'covers'],
    proposal_no: 'HP-261103-00003', wa_id: '919811122233', entry_date: '03-11-2026', entry_time: '09-15',
    full_name: 'Harpreet Singh', dob: '11-12-1971', gender: 'Male', marital_status: 'Married', occupation: 'Businessman - Medium Scale',
    pan: 'CPXXXXXXXR', aadhaar: 'XXXXXXXX7765', pin: '141001', city: 'Ludhiana', state: 'Punjab', village: 'Model Town',
    address: 'SCO 22, Model Town Market', servicing_office: 'DO 02 Ludhiana (112200)', mobile: '9811122233', email: 'harpreet@example.com', contact_consent: true,
    nominee_name: 'Gurleen Kaur', nominee_relation: 'Spouse', nominee_address: 'SCO 22, Model Town Market', nominee_contact: '9811122244',
    persons: 2,
    p1_gender: 'Male', p1_relation: 'Self', p1_name: 'Harpreet Singh', p1_dob: '11-12-1971', p1_aadhaar: 'XXXXXXXX7765', p1_sum_insured: 'Rs 7,50,000',
    p1_height: 1.74, p1_weight: 96, p1_blood_group: 'AB+', p1_marital_status: 'Married', p1_dependent: 'Yes', p1_employment: 'Business', p1_occupation: 'Businessman - Medium Scale',
    p2_gender: 'Female', p2_relation: 'Spouse', p2_name: 'Gurleen Kaur', p2_dob: '02-07-1975', p2_aadhaar: 'XXXXXXXX3340', p2_sum_insured: 'Rs 7,50,000',
    p2_height: 1.58, p2_weight: 64, p2_blood_group: 'B+', p2_marital_status: 'Married', p2_dependent: 'Yes', p2_employment: 'Homemaker', p2_occupation: 'Housewife',
    any_condition: 'Yes', p1_diabetes: 'Yes', p1_hypertension: 'Yes', p1_haemolytic_anaemia: 'No', p1_epilepsy: 'No', p1_renal_stones: 'No', p1_asthma: 'No',
    p1_tobacco: 'No', p1_alcohol: 'Yes', p1_cigarettes: 'Yes', habit_quantity: 'Cigarettes: 5 per day',
    covers: ['restoration', 'daily_cash'], p1_restoration: 'Yes', p1_maternity: 'No', p1_daily_cash: 'Yes', p1_daily_cash_amt: 'Rs 1500/Day',
  },
  {
    status: 'draft', premium_option: 'Annual', flows_completed: ['personal', 'nominee'],
    proposal_no: 'HP-261105-00004', wa_id: '919999900001', entry_date: '05-11-2026', entry_time: '08-30',
    full_name: 'Sunita Verma', dob: '18-08-1984', gender: 'Female', marital_status: 'Married', occupation: 'Housewife',
    pan: 'DQXXXXXXXK', aadhaar: 'XXXXXXXX4410', pin: '226010', city: 'Lucknow', state: 'Uttar Pradesh', village: 'Gomti Nagar',
    address: 'B-45, Vibhuti Khand', servicing_office: 'DO 05 Lucknow (332000)', mobile: '9999900001', email: 'sunita.verma@example.com', contact_consent: true,
    nominee_name: 'Rakesh Verma', nominee_relation: 'Spouse', nominee_address: 'B-45, Vibhuti Khand', nominee_contact: '9999900002',
  },
];

// Fill in premium columns exactly as the live API does.
samples.forEach((s) => Object.assign(s, quoteToColumns(computeQuote(s, new Date('2026-11-05T06:00:00Z')))));

module.exports = { samples };
