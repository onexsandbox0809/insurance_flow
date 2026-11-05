'use strict';
/*
 * Local preview WITHOUT Supabase:  node scripts/demo-server.js   ->  http://localhost:3000
 * Runs the real API handlers on an in-memory database seeded with the sample proposals.
 * Login: admin / Admin@123.   (Uses the test fake, so nothing is persisted.)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { setup } = require('../test/helpers');

const fake = setup();
process.env.APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
const { samples } = require('./sample-data');

fake.tables.app_users.push({ login_id: 'admin', password: 'Admin@123', display_name: 'Administrator', is_active: true });
let id = 0;
samples.forEach((p) => {
  fake.tables.proposals.push({ id: ++id, created_at: new Date().toISOString(), updated_date: p.entry_date, updated_time: p.entry_time, quote_status: 'quoted', ...p });
});
const SHA = 'RT0sVmBRkhe9ICxxhcGy5w1lLNiwRRrTOB2nBdRYw5E=';
[['HP-261101-00001', 'id_proof', 'ID proof', '1677109460632511', 'k7Qm2XaB', true], ['HP-261101-00001', 'address_proof', 'Proof of residence', '1644889404099111', 'Zt9PdR4w', true],
 ['HP-261101-00001', 'age_proof', 'Proof of age', '4039060513069724', 'H3nLq8Vc', false], ['HP-261101-00001', 'prepolicy_reports', 'Medical / check-up report', '1764971561471812', 'Wm5Ys2Kd', true],
 ['HP-261102-00002', 'id_proof', 'ID proof', '2210445590113001', 'Pq4Rt7Yu', true]].forEach(([no, t, l, mid, code, match], i) => {
  fake.tables.proposal_documents.push({ id: i + 1, proposal_no: no, doc_type: t, doc_label: l, file_index: 1, whatsapp_media_id: mid, sha256: SHA, sha256_match: match, file_name: 'IMG_6440.PNG', size_bytes: 184320, short_code: code, short_url: `http://localhost:3000/d/${code}`, status: 'stored', created_date: '01-11-2026', created_time: '10-45' });
  fake.tables.short_links.push({ code, kind: 'doc', proposal_no: no, storage_bucket: 'proposal-docs', storage_path: `${no}/${t}.png`, hits: 0 });
});
samples.forEach((p) => p.flows_completed.forEach((f, i) => fake.tables.flow_submissions.push({ id: id + i + 100, proposal_no: p.proposal_no, flow_key: f, payload: { example: true }, created_date: p.entry_date, created_time: p.entry_time })));

const routes = {
  '/api/auth/login': 'auth/login', '/api/dashboard/list': 'dashboard/list', '/api/dashboard/proposal': 'dashboard/proposal',
  '/api/dashboard/regenerate-pdf': 'dashboard/regenerate-pdf', '/api/d': 'd', '/api/p': 'p',
  ...Object.fromEntries(['personal', 'nominee', 'insured', 'medical', 'covers', 'documents'].map((f) => [`/api/flows/${f}`, 'flows/[flow]'])),
};
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = url.pathname;
  const short = p.match(/^\/([dp])\/([A-Za-z0-9]+)$/);
  if (short) { url.searchParams.set('code', short[2]); p = `/api/${short[1]}`; }
  if (routes[p]) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    req.body = raw ? JSON.parse(raw) : undefined; req.query = Object.fromEntries(url.searchParams);
    const flowMatch = p.match(/^\/api\/flows\/([^/]+)$/);
    if (flowMatch) req.query.flow = flowMatch[1];
    res.status = (s) => { res.statusCode = s; return res; };
    return require(`../api/${routes[p]}`)(req, res);
  }
  const file = path.join(__dirname, '..', 'public', p === '/' ? 'index.html' : p);
  if (!file.startsWith(path.join(__dirname, '..', 'public')) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
}).listen(process.env.PORT || 3000, () => console.log('demo on http://localhost:' + (process.env.PORT || 3000)));
