'use strict';
const cfg = require('./config');

let client;
function sb() {
  if (client) return client;
  const { createClient } = require('@supabase/supabase-js');
  const url = cfg.supabaseUrl();
  const key = cfg.serviceKey();
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

function must({ data, error }, what) {
  if (error) { const e = new Error(`${what}: ${error.message}`); e.status = 500; throw e; }
  return data;
}

const db = {
  async createProposal(phone) {
    return must(await sb().from('proposals').insert({ wa_id: phone }).select().single(), 'create proposal');
  },
  async getProposal(proposalNo) {
    return must(await sb().from('proposals').select('*').eq('proposal_no', proposalNo).maybeSingle(), 'get proposal');
  },
  // Newest proposal of this phone that is still open (draft or quoted).
  async latestOpen(phone) {
    const rows = must(await sb().from('proposals').select('*').eq('wa_id', phone)
      .in('status', ['draft', 'quoted']).order('created_at', { ascending: false }).limit(1), 'find open proposal');
    return rows[0] || null;
  },
  // Newest proposal of this phone whatever its status (used when documents arrive after completion).
  async latestAny(phone) {
    const rows = must(await sb().from('proposals').select('*').eq('wa_id', phone)
      .order('created_at', { ascending: false }).limit(1), 'find proposal');
    return rows[0] || null;
  },
  async updateProposal(proposalNo, patch) {
    return must(await sb().from('proposals').update(patch).eq('proposal_no', proposalNo).select().single(), 'update proposal');
  },
  async addSubmission(row) {
    must(await sb().from('flow_submissions').insert(row), 'log submission');
  },
  async listDocuments(proposalNo) {
    return must(await sb().from('proposal_documents').select('*').eq('proposal_no', proposalNo)
      .order('id', { ascending: true }), 'list documents');
  },
  async findDocument(proposalNo, mediaId) {
    return must(await sb().from('proposal_documents').select('*').eq('proposal_no', proposalNo)
      .eq('whatsapp_media_id', String(mediaId)).maybeSingle(), 'find document');
  },
  async saveDocument(row) {
    return must(await sb().from('proposal_documents').upsert(row, { onConflict: 'proposal_no,whatsapp_media_id' }).select().single(), 'save document');
  },
  async addShortLink(row) {
    must(await sb().from('short_links').insert(row), 'create short link');
  },
  async hitShortLink(code) {
    const data = must(await sb().rpc('hit_short_link', { p_code: code }), 'resolve short link');
    return Array.isArray(data) ? data[0] || null : data || null;
  },
  async listSubmissions(proposalNo) {
    return must(await sb().from('flow_submissions').select('*').eq('proposal_no', proposalNo)
      .order('id', { ascending: true }), 'list submissions');
  },
  async verifyUser(login, password) {
    const data = must(await sb().rpc('verify_app_user', { p_login: login, p_password: password }), 'verify user');
    return Array.isArray(data) ? data[0] || null : data || null;
  },
  async stats() {
    return must(await sb().rpc('dashboard_stats'), 'dashboard stats');
  },
  async listProposals({ search, status, from, to }) {
    let q = sb().from('proposals').select(
      'proposal_no,full_name,mobile,wa_id,status,persons,total_sum_insured,premium_annual,premium_option,flows_completed,entry_date,entry_time,city,proposal_pdf_url,created_at',
      { count: 'exact' });
    if (status) q = q.eq('status', status);
    if (search) {
      const s = String(search).replace(/[%,()*]/g, ' ').trim();
      if (s) q = q.or(`proposal_no.ilike.%${s}%,full_name.ilike.%${s}%,mobile.ilike.%${s}%,wa_id.ilike.%${s}%,email.ilike.%${s}%`);
    }
    const res = await q.order('created_at', { ascending: false }).range(from, to);
    if (res.error) { const e = new Error(`list proposals: ${res.error.message}`); e.status = 500; throw e; }
    return { rows: res.data, total: res.count };
  },
  storage() { return sb().storage; },
};

module.exports = { db, sb };
