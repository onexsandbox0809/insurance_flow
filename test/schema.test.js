'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { FLOWS } = require('../lib/flows');
const { computeQuote, quoteToColumns } = require('../lib/premium');
const { DOC_COLUMN } = require('../lib/service');
const { samples } = require('../scripts/sample-data');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
const seed = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'seed.sql'), 'utf8');

function tableColumns(name) {
  const m = sql.match(new RegExp(`create table if not exists ${name} \\(([\\s\\S]*?)\\n\\);`));
  assert.ok(m, `table ${name} not found in schema.sql`);
  return m[1].split('\n').map((l) => l.replace(/--.*$/, '').trim())
    .filter((l) => /^[a-z_0-9]+\s+[a-z]/.test(l) && !/^(unique|constraint|primary)/.test(l))
    .map((l) => l.split(/\s+/)[0]);
}

test('every flow field, premium column and service column exists in the proposals table', () => {
  const cols = new Set(tableColumns('proposals'));
  const need = new Set();
  Object.values(FLOWS).forEach((f) => { Object.keys(f.fields).forEach((c) => need.add(c)); need.add(f.column); });
  Object.keys(quoteToColumns(computeQuote(samples[0]))).forEach((c) => need.add(c));
  Object.values(DOC_COLUMN).forEach((c) => need.add(c));
  ['proposal_no', 'wa_id', 'status', 'flows_completed', 'proposal_pdf_url', 'proposal_pdf_generated_at', 'premium_option', 'entry_date', 'entry_time'].forEach((c) => need.add(c));
  const missing = [...need].filter((c) => !cols.has(c));
  assert.deepEqual(missing, []);
});

test('column names are unique', () => {
  const cols = tableColumns('proposals');
  assert.equal(new Set(cols).size, cols.length);
  assert.ok(cols.length > 100, `got ${cols.length}`);
});

test('every column written by the seed exists', () => {
  const cols = new Set(tableColumns('proposals'));
  const m = [...seed.matchAll(/insert into proposals \(([^)]*)\)/g)];
  assert.equal(m.length, samples.length);
  m.forEach((x) => x[1].split(',').map((c) => c.trim()).forEach((c) => assert.ok(cols.has(c), `seed column ${c} missing from schema`)));
});

test('other tables referenced by the code exist', () => {
  ['proposal_documents', 'short_links', 'flow_submissions', 'app_users'].forEach((t) => assert.ok(tableColumns(t).length > 3, t));
  ['verify_app_user', 'hit_short_link', 'dashboard_stats', 'next_proposal_no'].forEach((f) => assert.match(sql, new RegExp(`function ${f}\\(`)));
  assert.match(sql, /storage\.buckets/);
});
