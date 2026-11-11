'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { setup, call, PNG } = require('./helpers');

const KEY = { 'x-api-key': 'flow-secret' };
const PHONE = '919217090193';

function flowCall(name, options = {}) {
  return call(require('../api/flows/[flow]'), {
    ...options,
    query: { ...(options.query || {}), flow: name },
  });
}

function mockOnex({ failIds = [] } = {}) {
  const log = [];
  const resp = (status, body, type) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? type : null) },
    text: async () => (Buffer.isBuffer(body) ? body.toString('binary') : String(body)),
    arrayBuffer: async () => (Buffer.isBuffer(body) ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) : new TextEncoder().encode(String(body)).buffer),
  });
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    const apiKey = opts.headers && opts.headers.apiKey;
    if (u.pathname === '/oapi/wa/media') {
      const id = u.searchParams.get('mediaId');
      log.push(['media', id, u.searchParams.get('phoneNumber'), apiKey]);
      if (failIds.includes(id)) return resp(500, 'boom', 'text/plain');
      return resp(200, JSON.stringify({ status: 'success', data: { id, url: `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${id}`, mime_type: 'image/png' } }), 'application/json');
    }
    if (u.pathname === '/oapi/wa/download-media') {
      log.push(['download', u.searchParams.get('mediaUrl'), u.searchParams.get('phoneNumber'), apiKey]);
      return resp(200, PNG, 'image/png');
    }
    throw new Error('unexpected fetch ' + url);
  };
  return log;
}

async function runFlows(h, phone = PHONE) {
  const post = (name, body) => flowCall(name, { headers: KEY, body: { phone_number: phone, ...body } });
  const r = {};
  r.personal = await post('personal', { full_name: 'Aditya Kumar', dob: '1989-05-22', gender: 'Male', marital_status: 'Married', occupation: 'Service', pan: 'ANOPC2357P', aadhaar: '652134215432', pin: '122101', city: 'Gurgaon', state: 'Haryana', village: 'Gurgaon', address: 'G 1901, BPTP', servicing_office: 'DO 30', mobile: '9560458200', email: 'a@example.com', contact_consent: true });
  r.nominee = await post('nominee', { nominee_name: 'Ankita', nominee_relation: 'Spouse', nominee_address: 'G 1901', nominee_contact: '9810011223' });
  r.insured = await post('insured', { persons: '2', p1_gender: 'Male', p1_relation: 'Self', p1_name: 'Aditya Kumar', p1_dob: '1989-05-22', p1_aadhaar: '652134215432', p1_sum_insured: 'Rs 10,00,000', p1_height: 1.78, p1_weight: 82, p1_marital_status: 'Married', p1_dependent: 'Yes', p1_employment: 'Salaried', p1_occupation: 'Service', p2_gender: 'Female', p2_relation: 'Spouse', p2_name: 'Ankita Kumar', p2_dob: '1991-09-14', p2_aadhaar: '998877669981', p2_sum_insured: 'Rs 10,00,000', p2_height: 1.62, p2_weight: 58, p2_marital_status: 'Married', p2_dependent: 'Yes', p2_employment: 'Homemaker', p2_occupation: 'Housewife' });
  r.medical = await post('medical', { any_condition: 'No', p1_tobacco: 'No', p1_alcohol: 'Yes', p1_cigarettes: 'No' });
  r.covers = await post('covers', { covers: ['restoration', 'maternity', 'daily_cash'], p1_restoration: 'Yes', p1_maternity: 'Yes', p1_daily_cash: 'Yes', p1_daily_cash_amt: 'Rs 1000/Day' });
  return r;
}

const flow7Body = () => {
  const f = (id, sha) => [{ sha256: sha || 'RT0sVmBRkhe9ICxxhcGy5w1lLNiwRRrTOB2nBdRYw5E=', mime_type: 'image/png', file_name: 'IMG_6440.PNG', id }];
  return {
    phone_number: PHONE, flow_token: 'unused',
    previous_policy_docs: f(1139348605719625), id_proof: f(1677109460632511, crypto.createHash('sha256').update(PNG).digest('base64')),
    age_proof: f(4039060513069724), pan_doc: f(1436271838041376), address_proof: f(1644889404099111), prepolicy_reports: f(1764971561471812),
  };
};

test('flow API rejects calls without the api key', async () => {
  setup();
  const r = await flowCall('personal', { body: { phone_number: PHONE, full_name: 'x' } });
  assert.equal(r.status, 401);
  const g = await flowCall('personal', { method: 'GET', headers: KEY });
  assert.equal(g.status, 405);
});

test('validation: phone, required fields, bad persons', async () => {
  setup();
  const h = (req, res) => require('../api/flows/[flow]')({ ...req, query: { ...(req.query || {}), flow: 'personal' } }, res);
  assert.equal((await call(h, { headers: KEY, body: { full_name: 'x' } })).status, 400);
  const miss = await call(h, { headers: KEY, body: { phone_number: PHONE, full_name: 'x' } });
  assert.equal(miss.status, 422); assert.deepEqual(miss.json.missing, ['dob', 'mobile']);
  const bad = await flowCall('insured', { headers: KEY, body: { phone_number: PHONE, persons: '3', p1_dob: '1990-01-01', p1_sum_insured: 'Rs 5,00,000' } });
  assert.equal(bad.status, 422);
});

test('end to end: six flows -> quote -> PDF -> documents -> dashboard', async (t) => {
  const fake = setup();
  const log = mockOnex();
  const r = await runFlows();

  await t.test('proposal number, masking and Indian formats', () => {
    const no = r.personal.json.proposal_no;
    assert.match(no, /^HP-\d{6}-\d{5}$/);
    assert.deepEqual([r.nominee, r.insured, r.medical, r.covers].map((x) => x.json.proposal_no), Array(4).fill(no));
    const row = fake.tables.proposals[0];
    assert.equal(fake.tables.proposals.length, 1);
    assert.equal(row.aadhaar, 'XXXXXXXX5432');
    assert.equal(row.pan, 'ANXXXXXXXP');
    assert.equal(row.p2_aadhaar, 'XXXXXXXX9981');
    assert.equal(row.dob, '22-05-1989');
    assert.match(row.entry_date, /^\d{2}-\d{2}-\d{4}$/);
    assert.match(row.entry_time, /^\d{2}-\d{2}$/);
    assert.match(row.flow_personal_at, /^\d{2}-\d{2}-\d{4} \d{2}-\d{2}$/);
    const everything = JSON.stringify(fake.tables);
    ['652134215432', 'ANOPC2357P', '998877669981'].forEach((raw) => assert.ok(!everything.includes(raw), `raw value ${raw} leaked into the database`));
  });

  await t.test('"No" answer fills No against every disease', () => {
    const row = fake.tables.proposals[0];
    ['p1_diabetes', 'p1_hypertension', 'p1_haemolytic_anaemia', 'p1_epilepsy', 'p1_renal_stones', 'p1_asthma'].forEach((c) => assert.equal(row[c], 'No'));
  });

  await t.test('quote appears once the data flows are in, with premium options stored', () => {
    assert.equal(r.insured.json.quote.ready, true);
    assert.equal(r.covers.json.status, 'quoted');
    const row = fake.tables.proposals[0];
    assert.equal(row.quote_status, 'quoted');
    assert.ok(row.premium_annual > 0 && row.premium_half_yearly > 0 && row.premium_quarterly > 0 && row.premium_monthly > 0);
    assert.equal(row.premium_option, 'Annual');
    assert.equal(row.premium_breakdown.ready, true);
    assert.deepEqual(r.covers.json.flows_pending, ['documents']);
  });

  await t.test('GET /api/quote returns the premium by proposal number or by phone', async () => {
    const q = require('../api/quote');
    const noKey = await call(q, { method: 'GET', query: { phone_number: PHONE } });
    assert.equal(noKey.status, 401);
    const byNo = await call(q, { method: 'GET', headers: KEY, query: { proposal_no: r.personal.json.proposal_no } });
    assert.equal(byNo.status, 200);
    assert.equal(byNo.json.quote.annual, fake.tables.proposals[0].premium_annual);
    assert.equal(byNo.json.breakdown, undefined);
    const byPhone = await call(q, { method: 'GET', headers: KEY, query: { phone_number: PHONE, detail: '1' } });
    assert.equal(byPhone.json.proposal_no, r.personal.json.proposal_no);
    assert.equal(byPhone.json.breakdown.ready, true);
    assert.equal((await call(q, { method: 'GET', headers: KEY, query: { proposal_no: 'HP-NOPE' } })).status, 404);
    assert.equal((await call(q, { method: 'POST', headers: KEY, body: { phone_number: '919000000000' } })).status, 404);
  });

  await t.test('GET /api/prefill returns flow 1 data (masked Aadhaar) for the phone, ready for flow_action_payload', async () => {
    const pf = require('../api/prefill');
    assert.equal((await call(pf, { method: 'GET', query: { phone_number: PHONE } })).status, 401);
    const ok = await call(pf, { method: 'GET', headers: KEY, query: { phone_number: PHONE } });
    assert.equal(ok.status, 200); assert.equal(ok.json.found, true);
    assert.equal(ok.json.data.p1_name, 'Aditya Kumar');
    assert.equal(ok.json.data.p1_dob, '1989-05-22');
    assert.equal(ok.json.data.p1_relation, 'Self');
    assert.equal(ok.json.data.p1_aadhaar, 'XXXXXXXX5432');
    assert.equal(ok.json.data.p1_aadhaar_editable, false);
    assert.equal(ok.json.data.p2_name, 'Ankita');
    assert.deepEqual(ok.json.flow_action_payload, { screen: 'INSURED_COUNT', data: ok.json.data });
    assert.ok(!/\d{12}/.test(JSON.stringify(ok.json)), 'never a full Aadhaar number');
    const unknown = await call(pf, { method: 'GET', headers: KEY, query: { phone_number: '919000011111' } });
    assert.equal(unknown.json.found, false); assert.equal(Object.keys(unknown.json.data).length, 10); assert.equal(unknown.json.data.p1_aadhaar_editable, true);
    assert.equal((await call(pf, { method: 'GET', headers: KEY, query: { phone_number: PHONE, flow: 'covers' } })).status, 400);
  });

  await t.test('proposal PDF is stored and shared as a short URL', () => {
    const url = r.covers.json.proposal_pdf_url;
    assert.match(url, /^https:\/\/app\.test\/p\/[A-Za-z0-9]{8}$/);
    const pdf = [...fake.files.entries()].find(([k]) => k.endsWith('.pdf'));
    assert.ok(pdf, 'pdf uploaded');
    assert.equal(pdf[1].bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal(fake.tables.proposals[0].proposal_pdf_url, url);
    assert.equal(r.nominee.json.proposal_pdf_url, null, 'no PDF before the quote data is complete');
  });

  const no = r.personal.json.proposal_no;
  const docs = await flowCall('documents', { headers: KEY, body: flow7Body() });

  await t.test('documents: API 1 then API 2 for each file, strictly one after the other', () => {
    assert.equal(docs.status, 200, docs.text);
    assert.equal(docs.json.stored, 6); assert.equal(docs.json.failed, 0);
    const kinds = log.map((l) => l[0]);
    assert.deepEqual(kinds, Array(6).fill(['media', 'download']).flat());
    log.forEach((l) => { assert.equal(l[2], PHONE); assert.equal(l[3], 'onex-key'); });
    assert.deepEqual(log.filter((l) => l[0] === 'media').map((l) => l[1]),
      ['1677109460632511', '1644889404099111', '4039060513069724', '1139348605719625', '1764971561471812', '1436271838041376']);
    assert.match(log[1][1], /^https:\/\/lookaside\.fbsbx\.com\/whatsapp_business\/attachments\/\?mid=1677109460632511$/);
  });

  await t.test('documents are stored per proposal with short URLs, media id and sha256', () => {
    const rows = fake.tables.proposal_documents;
    assert.equal(rows.length, 6);
    rows.forEach((d) => {
      assert.equal(d.proposal_no, no);
      assert.match(d.short_url, /^https:\/\/app\.test\/d\/[A-Za-z0-9]{8}$/);
      assert.ok(d.short_url.length < 40);
      assert.ok(d.storage_path.startsWith(`${no}/`));
      assert.equal(d.status, 'stored');
      assert.ok(fake.files.has(`proposal-docs/${d.storage_path}`));
    });
    const idProof = rows.find((d) => d.doc_type === 'id_proof');
    assert.equal(idProof.whatsapp_media_id, '1677109460632511');
    assert.equal(idProof.sha256_match, true, 'matching sha256 is verified');
    assert.equal(rows.find((d) => d.doc_type === 'age_proof').sha256_match, false, 'different sha256 is flagged');
    const row = fake.tables.proposals[0];
    ['id_proof_url', 'address_proof_url', 'age_proof_url', 'previous_policy_url', 'medical_report_url', 'pan_doc_url'].forEach((c) => assert.match(row[c], /^https:\/\/app\.test\/d\//));
    assert.equal(row.status, 'completed');
    assert.ok(row.flows_completed.includes('documents'));
    assert.equal(docs.json.proposal_pdf_url, r.covers.json.proposal_pdf_url, 'same PDF link, regenerated with documents');
  });

  await t.test('re-sending the same media ids does not download again', async () => {
    log.length = 0;
    const again = await flowCall('documents', { headers: KEY, body: flow7Body() });
    assert.equal(again.json.stored, 6); assert.equal(log.length, 0);
    assert.equal(fake.tables.proposal_documents.length, 6);
  });

  await t.test('short link redirects to a signed URL and counts the visit', async () => {
    const code = fake.tables.proposal_documents[0].short_code;
    const hit = await call(require('../api/d'), { method: 'GET', query: { code } });
    assert.equal(hit.status, 302);
    assert.match(hit.headers.location, /^https:\/\/fake\.storage\/proposal-docs\//);
    assert.equal(fake.tables.short_links.find((l) => l.code === code).hits, 1);
    assert.equal((await call(require('../api/d'), { method: 'GET', query: { code: 'nope1234' } })).status, 404);
    const pdfCode = fake.tables.proposals[0].proposal_pdf_url.split('/').pop();
    assert.equal((await call(require('../api/p'), { method: 'GET', query: { code: pdfCode } })).status, 302);
    assert.equal((await call(require('../api/p'), { method: 'GET', query: { code } })).status, 404, 'a document code is not a pdf code');
  });

  await t.test('dashboard: login, list, detail, regenerate PDF', async () => {
    fake.tables.app_users.push({ login_id: 'admin', password: 'Admin@123', display_name: 'Administrator', is_active: true });
    const login = require('../api/auth/login');
    assert.equal((await call(login, { body: { login_id: 'admin', password: 'wrong' } })).status, 401);
    assert.equal((await call(login, { body: {} })).status, 400);
    const ok = await call(login, { body: { login_id: 'admin', password: 'Admin@123' } });
    assert.equal(ok.status, 200);
    const auth = { authorization: `Bearer ${ok.json.token}` };

    assert.equal((await call(require('../api/dashboard/list'), { method: 'GET' })).status, 401);
    const list = await call(require('../api/dashboard/list'), { method: 'GET', headers: auth, query: { search: 'aditya' } });
    assert.equal(list.status, 200); assert.equal(list.json.total, 1); assert.equal(list.json.rows[0].proposal_no, no);
    assert.equal(list.json.stats.total, 1);
    assert.equal((await call(require('../api/dashboard/list'), { method: 'GET', headers: auth, query: { search: 'nobody' } })).json.total, 0);

    const det = await call(require('../api/dashboard/proposal'), { method: 'GET', headers: auth, query: { proposal_no: no } });
    assert.equal(det.json.documents.length, 6);
    assert.equal(det.json.submissions.length, 7, '5 data flows + documents sent twice');
    assert.equal((await call(require('../api/dashboard/proposal'), { method: 'GET', headers: auth, query: { proposal_no: 'HP-X' } })).status, 404);

    const regen = await call(require('../api/dashboard/regenerate-pdf'), { headers: auth, body: { proposal_no: no } });
    assert.equal(regen.status, 200); assert.equal(regen.json.proposal_pdf_url, fake.tables.proposals[0].proposal_pdf_url);
  });

  await t.test('a finished proposal is closed: the next personal flow opens a new one', async () => {
    const next = await flowCall('personal', { headers: KEY, body: { phone_number: PHONE, full_name: 'Aditya Kumar', dob: '1989-05-22', mobile: '9560458200' } });
    assert.notEqual(next.json.proposal_no, no);
    assert.equal(fake.tables.proposals.length, 2);
  });
});

test('documents: one failing media id does not stop the others, and is reported', async () => {
  const fake = setup();
  mockOnex({ failIds: ['4039060513069724'] });
  await runFlows();
  const res = await flowCall('documents', { headers: KEY, body: flow7Body() });
  assert.equal(res.json.ok, false);
  assert.equal(res.json.stored, 5); assert.equal(res.json.failed, 1);
  const bad = res.json.documents.find((d) => d.status === 'failed');
  assert.equal(bad.doc_type, 'age_proof'); assert.match(bad.error, /media lookup failed/);
  const row = fake.tables.proposals[0];
  assert.ok(!row.flows_completed.includes('documents'));
  assert.equal(row.status, 'quoted');
  assert.ok(!row.age_proof_url, 'the failed document has no link');
  assert.ok(row.id_proof_url, 'the others do');
});

test('10 digit mobile numbers get the 91 prefix', async () => {
  const fake = setup();
  await flowCall('personal', { headers: KEY, body: { phone_number: '9217090193', full_name: 'X', dob: '1990-01-01', mobile: '9217090193' } });
  assert.equal(fake.tables.proposals[0].wa_id, '919217090193');
});

test('greyed-out Aadhaar is not submitted: the flow 1 value is kept for the proposer only; submitted values are accepted as sent', async () => {
  const fake = setup();
  mockOnex();
  await runFlows();
  const again = (extra) => flowCall('insured', { headers: KEY, body: { phone_number: PHONE, persons: '1', p1_dob: '1989-05-22', p1_sum_insured: 'Rs 5,00,000', ...extra } });
  await again({ p1_relation: 'Self', p1_aadhaar: '' });
  assert.equal(fake.tables.proposals[0].p1_aadhaar, 'XXXXXXXX5432', 'empty (greyed out) keeps the flow 1 value');
  await again({ p1_relation: 'Self' });
  assert.equal(fake.tables.proposals[0].p1_aadhaar, 'XXXXXXXX5432', 'missing keeps the flow 1 value');
  await again({ p1_relation: 'Self', p1_aadhaar: '999988887777' });
  assert.equal(fake.tables.proposals[0].p1_aadhaar, 'XXXXXXXX7777', 'a submitted number is accepted (and masked); no server-side lock');
  await again({ p1_relation: 'Spouse', p1_aadhaar: '' });
  assert.ok(!fake.tables.proposals[0].p1_aadhaar, 'not the proposer: the proposer Aadhaar is not copied');
});

test('re-submitting with a sum insured above 15 lakh clears the old premium instead of showing it', async () => {
  const fake = setup();
  mockOnex();
  await runFlows();
  assert.ok(fake.tables.proposals[0].premium_annual > 0);
  const bad = await flowCall('insured', { headers: KEY, body: { phone_number: PHONE, persons: '1', p1_dob: '1989-05-22', p1_sum_insured: 'Rs 20,00,000' } });
  assert.equal(bad.json.quote.ready, false, 'no stale premium in the response');
  assert.match(bad.json.quote_missing[0], /outside the supported range/);
  assert.equal(bad.json.status, 'draft', 'not "quoted" while the premium cannot be calculated');
  assert.equal(fake.tables.proposals[0].premium_annual, null);
  assert.equal(fake.tables.proposals[0].quote_status, 'not_ready');
  const good = await flowCall('insured', { headers: KEY, body: { phone_number: PHONE, persons: '1', p1_dob: '1989-05-22', p1_sum_insured: '10 lakh' } });
  assert.equal(good.json.quote.ready, true);
  assert.ok(good.json.quote.annual > 0);
  assert.deepEqual(good.json.quote_missing, []);
});

test('long Supabase URLs are returned next to the short ones', async () => {
  const fake = setup();
  mockOnex();
  const r = await runFlows();
  const covers = r.covers.json;
  assert.match(covers.proposal_pdf_url, /^https:\/\/app\.test\/p\/[A-Za-z0-9]{8}$/);
  assert.match(covers.proposal_pdf_signed_url, /^https:\/\/fake\.storage\/proposal-docs\/HP-.*proposal-HP-.*\.pdf\?token=/);
  assert.equal(covers.signed_url_valid_hours, 168);
  const docs = await flowCall('documents', { headers: KEY, body: flow7Body() });
  docs.json.documents.forEach((d) => {
    assert.match(d.media_url, /^https:\/\/app\.test\/d\//);
    assert.match(d.media_signed_url, /^https:\/\/fake\.storage\/proposal-docs\//);
  });
  assert.match(docs.json.proposal_pdf_signed_url, /^https:\/\/fake\.storage\//);
  const q = await call(require('../api/quote'), { method: 'GET', headers: KEY, query: { phone_number: PHONE } });
  assert.match(q.json.proposal_pdf_signed_url, /^https:\/\/fake\.storage\//);
  assert.ok(fake.files.size >= 7);
});

test('rupee-sign amounts work end to end and the PDF prints them as Rs, not ?', async () => {
  const fake = setup();
  mockOnex();
  await flowCall('personal', { headers: KEY, body: { phone_number: PHONE, full_name: 'Asha Rao', dob: '1990-01-01', mobile: '9810011223' } });
  await flowCall('nominee', { headers: KEY, body: { phone_number: PHONE, nominee_name: 'Ravi' } });
  const ins = await flowCall('insured', { headers: KEY, body: { phone_number: PHONE, persons: '1', p1_dob: '1990-01-01', p1_sum_insured: '\u20B915,00,000', p1_name: 'Asha Rao' } });
  assert.equal(ins.json.quote.ready, true);
  assert.equal(ins.json.quote.total_sum_insured, 1500000);
  await flowCall('medical', { headers: KEY, body: { phone_number: PHONE, any_condition: 'No' } });
  const cov = await flowCall('covers', { headers: KEY, body: { phone_number: PHONE, covers: ['daily_cash'], p1_daily_cash: 'Yes', p1_daily_cash_amt: '\u20B91,000/Day' } });
  assert.equal(cov.json.status, 'quoted');
  const pdf = [...fake.files.entries()].find(([k]) => k.endsWith('.pdf'))[1].bytes;
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('GET /api/documents returns short and long links for the PDF and every uploaded file, and can build the PDF', async () => {
  const fake = setup();
  mockOnex();
  const docsApi = require('../api/documents');
  assert.equal((await call(docsApi, { method: 'GET', query: { phone_number: PHONE } })).status, 401);
  assert.equal((await call(docsApi, { method: 'GET', headers: KEY, query: { phone_number: '919000011111' } })).status, 404);

  // quote not ready yet -> asking for a PDF is a clear 409
  await flowCall('personal', { headers: KEY, body: { phone_number: PHONE, full_name: 'Asha Rao', dob: '1990-01-01', mobile: '9810011223' } });
  const early = await call(docsApi, { method: 'GET', headers: KEY, query: { phone_number: PHONE, generate_pdf: '1' } });
  assert.equal(early.status, 409);
  const none = await call(docsApi, { method: 'GET', headers: KEY, query: { phone_number: PHONE } });
  assert.equal(none.json.proposal_pdf_url, null); assert.deepEqual(none.json.documents, []);

  // finish everything, upload documents
  await flowCall('nominee', { headers: KEY, body: { phone_number: PHONE, nominee_name: 'Ravi' } });
  await flowCall('insured', { headers: KEY, body: { phone_number: PHONE, persons: '1', p1_dob: '1990-01-01', p1_sum_insured: '\u20B96,00,000' } });
  await flowCall('medical', { headers: KEY, body: { phone_number: PHONE, any_condition: 'No' } });
  await flowCall('covers', { headers: KEY, body: { phone_number: PHONE, covers: [] } });
  const sent = await flowCall('documents', { headers: KEY, body: flow7Body() });
  assert.equal(sent.json.stored, 6);

  const r = await call(docsApi, { method: 'GET', headers: KEY, query: { phone_number: PHONE, valid_hours: '24' } });
  assert.equal(r.status, 200);
  assert.match(r.json.proposal_pdf_url, /^https:\/\/app\.test\/p\//);
  assert.match(r.json.proposal_pdf_signed_url, /^https:\/\/fake\.storage\//);
  assert.equal(r.json.signed_url_valid_hours, 24);
  assert.equal(r.json.documents.length, 6);
  r.json.documents.forEach((d) => {
    assert.match(d.media_url, /^https:\/\/app\.test\/d\/[A-Za-z0-9]{8}$/);
    assert.match(d.media_signed_url, /^https:\/\/fake\.storage\/proposal-docs\//);
    assert.ok(d.whatsapp_media_id && d.sha256 && d.file_name);
  });
  assert.equal((await call(docsApi, { method: 'GET', headers: KEY, query: { proposal_no: r.json.proposal_no, valid_hours: '99999' } })).json.signed_url_valid_hours, 720, 'capped at 30 days');

  const regen = await call(docsApi, { method: 'POST', headers: KEY, body: { proposal_no: r.json.proposal_no, generate_pdf: true } });
  assert.equal(regen.status, 200); assert.equal(regen.json.proposal_pdf_url, r.json.proposal_pdf_url, 'same short link after regenerating');
  assert.ok(fake.files.size >= 7);
});

test('a media failure says what the media API answered', async () => {
  setup();
  mockOnex({ failIds: ['4039060513069724'] });
  await runFlows();
  const res = await flowCall('documents', { headers: KEY, body: flow7Body() });
  const bad = res.json.documents.find((d) => d.status === 'failed');
  assert.match(bad.error, /media lookup failed \(500\): boom/);
});

// ---- phone_number is the WABA (business) number; the customer is identified separately ----
const WABA = '919217090193';
const CUSTOMER = '919876543210';
const customerFlow1 = () => flowCall('personal', { headers: KEY, body: { phone_number: CUSTOMER, full_name: 'Asha Rao', dob: '1990-01-01', mobile: '9876543210' } });
const oneDoc = (extra = {}) => ({ phone_number: WABA, id_proof: [{ sha256: 'x', mime_type: 'image/png', file_name: 'IMG_6952.PNG', id: 1211145944964840 }], ...extra });

test('documents: phone_number is the WABA number, the customer comes from flow_token (their number)', async () => {
  const fake = setup(); const log = mockOnex();
  const p = await customerFlow1();
  const res = await flowCall('documents', { headers: KEY, body: oneDoc({ flow_token: CUSTOMER }) });
  assert.equal(res.json.proposal_no, p.json.proposal_no, 'attached to the customer proposal');
  assert.equal(fake.tables.proposals.length, 1, 'no extra proposal under the WABA number');
  assert.equal(res.json.customer_phone, CUSTOMER);
  assert.equal(res.json.waba_phone_used, WABA);
  log.forEach((l) => assert.equal(l[2], WABA, 'the media APIs are asked with the WABA number'));
  assert.equal(fake.tables.proposal_documents[0].proposal_no, p.json.proposal_no);
});

test('documents: customer_phone, wa_id and proposal_no in flow_token all work', async () => {
  const fake = setup(); mockOnex();
  const p = await customerFlow1();
  const a = await flowCall('documents', { headers: KEY, body: oneDoc({ customer_phone: CUSTOMER }) });
  assert.equal(a.json.proposal_no, p.json.proposal_no);
  const b = await flowCall('documents', { headers: KEY, body: oneDoc({ wa_id: CUSTOMER }) });
  assert.equal(b.json.proposal_no, p.json.proposal_no);
  const c = await flowCall('documents', { headers: KEY, body: oneDoc({ flow_token: p.json.proposal_no }) });
  assert.equal(c.json.proposal_no, p.json.proposal_no);
  assert.equal(c.json.waba_phone_used, WABA);
  assert.equal(fake.tables.proposals.length, 1);
});

test('flows 1 to 6: customer_phone / flow_token identify the customer while phone_number stays the WABA number', async () => {
  const fake = setup(); mockOnex();
  const a = await flowCall('personal', { headers: KEY, body: { phone_number: WABA, customer_phone: CUSTOMER, full_name: 'Asha Rao', dob: '1990-01-01', mobile: '9876543210' } });
  assert.equal(fake.tables.proposals[0].wa_id, CUSTOMER);
  const n = await flowCall('nominee', { headers: KEY, body: { phone_number: WABA, flow_token: CUSTOMER, nominee_name: 'Ravi' } });
  assert.equal(n.json.proposal_no, a.json.proposal_no);
  const m = await flowCall('medical', { headers: KEY, body: { phone_number: WABA, flow_token: a.json.proposal_no, any_condition: 'No' } });
  assert.equal(m.json.proposal_no, a.json.proposal_no);
  assert.equal(fake.tables.proposals.length, 1);
});

test('with WABA_PHONE_NUMBER set: the WABA number is never taken as a customer, and always used for the media APIs', async () => {
  const fake = setup(); const log = mockOnex();
  process.env.WABA_PHONE_NUMBER = WABA;
  try {
    const refused = await flowCall('documents', { headers: KEY, body: oneDoc({ flow_token: 'unused' }) });
    assert.equal(refused.status, 400);
    assert.match(refused.json.error, /WABA \(business\) number/);
    assert.equal(fake.tables.proposals.length, 0, 'nothing created under the WABA number');
    const refusedFlow = await flowCall('personal', { headers: KEY, body: { phone_number: WABA, full_name: 'x', dob: '1990-01-01', mobile: '9876543210' } });
    assert.equal(refusedFlow.status, 400);

    const p = await customerFlow1();
    const ok = await flowCall('documents', { headers: KEY, body: { ...oneDoc({ flow_token: CUSTOMER }), phone_number: CUSTOMER } });
    assert.equal(ok.json.proposal_no, p.json.proposal_no);
    assert.equal(ok.json.waba_phone_used, WABA, 'media calls use WABA_PHONE_NUMBER even if phone_number held something else');
    log.forEach((l) => assert.equal(l[2], WABA));
  } finally { delete process.env.WABA_PHONE_NUMBER; }
});

test('old behaviour still works: a request with only phone_number is treated as the customer', async () => {
  const fake = setup(); mockOnex();
  const p = await flowCall('personal', { headers: KEY, body: { phone_number: CUSTOMER, full_name: 'Asha', dob: '1990-01-01', mobile: '9876543210' } });
  assert.equal(fake.tables.proposals[0].wa_id, CUSTOMER);
  const d = await flowCall('documents', { headers: KEY, body: { phone_number: CUSTOMER, id_proof: [{ id: '5', mime_type: 'image/png' }] } });
  assert.equal(d.json.proposal_no, p.json.proposal_no);
  assert.equal(d.json.waba_phone_used, CUSTOMER);
});

test('GET /api/prefill?step=... returns the saved data of a step by customer phone number', async () => {
  const fake = setup();
  mockOnex();
  const r = await runFlows();
  const pf = require('../api/prefill');
  const get = (query) => call(pf, { method: 'GET', headers: KEY, query });

  const first = await get({ phone_number: PHONE, step: 'personal' });
  assert.equal(first.status, 200);
  assert.equal(first.json.found, true); assert.equal(first.json.step, 'personal');
  assert.equal(first.json.proposal_no, r.personal.json.proposal_no);
  assert.equal(first.json.step_completed, true);
  assert.match(first.json.submitted_at, /^\d{2}-\d{2}-\d{4} \d{2}-\d{2}$/);
  assert.equal(first.json.data.full_name, 'Aditya Kumar');
  assert.equal(first.json.data.dob, '22-05-1989', 'dates come back as DD-MM-YYYY');
  assert.equal(first.json.data.pan, 'ANXXXXXXXP');
  assert.equal(first.json.data.aadhaar, 'XXXXXXXX5432');
  assert.equal(first.json.data.mobile, '9560458200');
  assert.ok(!JSON.stringify(first.json).includes('652134215432') && !JSON.stringify(first.json).includes('ANOPC2357P'), 'never a raw identifier');
  assert.equal(Object.keys(first.json.data).length, 20, 'every flow 1 field is present');

  const nominee = await get({ phone_number: PHONE, step: 'nominee' });
  assert.equal(nominee.json.data.nominee_name, 'Ankita');
  const all = await get({ phone_number: PHONE, step: 'all' });
  assert.equal(all.json.data.full_name, 'Aditya Kumar'); assert.equal(all.json.data.nominee_name, 'Ankita'); assert.equal(all.json.data.persons, 2);
  assert.equal(all.json.step_completed, null);

  const unknown = await get({ phone_number: '919000011111', step: 'personal' });
  assert.equal(unknown.json.found, false); assert.equal(unknown.json.data.full_name, null); assert.equal(unknown.json.step_completed, false);
  assert.equal((await get({ phone_number: PHONE, step: 'nonsense' })).status, 400);
  assert.equal((await get({ phone_number: PHONE, step: 'documents' })).status, 400);
  assert.equal((await get({ proposal_no: r.personal.json.proposal_no, step: 'personal' })).json.data.full_name, 'Aditya Kumar', 'proposal_no works without a phone number');

  // the original behaviour is untouched
  const prefill = await get({ phone_number: PHONE });
  assert.equal(prefill.json.flow_action_payload.screen, 'INSURED_COUNT');
  assert.equal(prefill.json.data.p1_name, 'Aditya Kumar');
});