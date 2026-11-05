'use strict';
// Minimal in-memory stand-in for @supabase/supabase-js, only for tests (supports exactly what lib/db.js uses).
const { nowIST } = require('../lib/dates');

function makeFake() {
  const t = { proposals: [], proposal_documents: [], short_links: [], flow_submissions: [], app_users: [] };
  const ids = { proposals: 0, proposal_documents: 0, flow_submissions: 0 };
  let seq = 0;
  const files = new Map();
  const calls = [];

  const nextNo = () => { seq += 1; const n = nowIST(); const [d, m, y] = n.date.split('-'); return `HP-${y.slice(2)}${m}${d}-${String(seq).padStart(5, '0')}`; };

  function withDefaults(table, row) {
    const n = nowIST(); const r = { ...row };
    if (table !== 'app_users' && table !== 'short_links') ids[table] += 1;
    if (table !== 'short_links' && table !== 'app_users') r.id = ids[table];
    if (table === 'proposals') {
      Object.assign(r, { proposal_no: r.proposal_no || nextNo(), status: 'draft', flows_completed: [], quote_status: 'not_ready', premium_option: 'Annual',
        entry_date: n.date, entry_time: n.time, created_at: new Date().toISOString(), updated_date: n.date, updated_time: n.time }, row);
    }
    if (table === 'short_links') Object.assign(r, { hits: 0, created_date: n.date, created_time: n.time });
    if (table === 'proposal_documents' || table === 'flow_submissions') { r.created_date = r.created_date || n.date; r.created_time = r.created_time || n.time; r.created_at = new Date().toISOString(); }
    return r;
  }

  const matchOr = (row, expr) => expr.split(',').some((part) => {
    const m = part.match(/^([a-z_]+)\.ilike\.%(.*)%$/);
    return m && String(row[m[1]] || '').toLowerCase().includes(m[2].toLowerCase());
  });

  class Q {
    constructor(table) { this.table = table; this.filters = []; this.op = 'select'; this.opts = {}; }
    select(_cols, opts) { if (this.op === 'select' || !this.op) this.op = 'select'; this.opts = opts || {}; this.returning = true; return this; }
    insert(obj) { this.op = 'insert'; this.payload = obj; return this; }
    update(obj) { this.op = 'update'; this.payload = obj; return this; }
    upsert(obj, o) { this.op = 'upsert'; this.payload = obj; this.conflict = (o && o.onConflict) || 'id'; return this; }
    eq(c, v) { this.filters.push((r) => String(r[c]) === String(v)); return this; }
    in(c, vs) { this.filters.push((r) => vs.includes(r[c])); return this; }
    or(expr) { this.filters.push((r) => matchOr(r, expr)); return this; }
    order(c, o) { this.ord = [c, !(o && o.ascending === false)]; return this; }
    limit(n) { this.lim = n; return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    maybeSingle() { this.single_ = 'maybe'; return this; }
    single() { this.single_ = 'one'; return this; }
    then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
    run() {
      const rows = t[this.table];
      const fail = (message) => ({ data: null, error: { message } });
      if (this.op === 'insert') {
        const row = withDefaults(this.table, this.payload);
        if (this.table === 'short_links' && rows.some((r) => r.code === row.code)) return fail('duplicate key value violates unique constraint');
        rows.push(row);
        return this.finish([row]);
      }
      if (this.op === 'upsert') {
        const keys = this.conflict.split(',');
        let row = rows.find((r) => keys.every((k) => String(r[k]) === String(this.payload[k])));
        if (row) Object.assign(row, this.payload); else { row = withDefaults(this.table, this.payload); rows.push(row); }
        return this.finish([row]);
      }
      let sel = rows.filter((r) => this.filters.every((f) => f(r)));
      if (this.op === 'update') {
        sel.forEach((r) => { Object.assign(r, this.payload); if (this.table === 'proposals') { const n = nowIST(); r.updated_at = new Date().toISOString(); r.updated_date = n.date; r.updated_time = n.time; } });
        return this.finish(sel);
      }
      const total = sel.length;
      if (this.ord) { const [c, asc] = this.ord; sel = [...sel].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
      if (this.rng) sel = sel.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim) sel = sel.slice(0, this.lim);
      const out = this.finish(sel);
      if (this.opts.count) out.count = total;
      return out;
    }
    finish(sel) {
      const copy = sel.map((r) => JSON.parse(JSON.stringify(r)));
      if (this.single_ === 'one') return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { message: 'expected one row' } };
      if (this.single_ === 'maybe') return { data: copy[0] || null, error: null };
      return { data: copy, error: null };
    }
  }

  const rpcs = {
    hit_short_link: ({ p_code }) => { const r = t.short_links.find((x) => x.code === p_code); if (r) r.hits += 1; return r ? [JSON.parse(JSON.stringify(r))] : []; },
    verify_app_user: ({ p_login, p_password }) => t.app_users.filter((u) => u.login_id === p_login && u.password === p_password && u.is_active !== false).map((u) => ({ out_login_id: u.login_id, out_display_name: u.display_name })),
    dashboard_stats: () => ({ total: t.proposals.length, draft: t.proposals.filter((p) => p.status === 'draft').length, quoted: t.proposals.filter((p) => p.status === 'quoted').length, completed: t.proposals.filter((p) => p.status === 'completed').length, today: 0, premium_total: t.proposals.reduce((s, p) => s + (p.premium_annual || 0), 0), premium_avg: 0, documents: t.proposal_documents.length }),
  };

  const client = {
    from: (table) => new Q(table),
    rpc: async (name, args) => ({ data: rpcs[name](args || {}), error: null }),
    storage: {
      from: (bucket) => ({
        upload: async (path, bytes, opts) => { calls.push(['upload', path]); files.set(`${bucket}/${path}`, { bytes, opts }); return { data: { path }, error: null }; },
        createSignedUrl: async (path) => (files.has(`${bucket}/${path}`) ? { data: { signedUrl: `https://fake.storage/${bucket}/${path}?token=abc` }, error: null } : { data: null, error: { message: 'Object not found' } }),
      }),
    },
  };
  return { client, tables: t, files, calls };
}

module.exports = { makeFake };
