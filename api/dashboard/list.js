'use strict';
const { route } = require('../../lib/http');
const { db } = require('../../lib/db');

// GET /api/dashboard/list?search=&status=&page=1&limit=25      (Authorization: Bearer <token>)
module.exports = route({ methods: ['GET'], auth: 'user' }, async (req) => {
  const q = req.query || {};
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 25, 1), 100);
  const page = Math.max(parseInt(q.page, 10) || 1, 1);
  const from = (page - 1) * limit;
  const [list, stats] = await Promise.all([
    db.listProposals({ search: q.search, status: q.status, from, to: from + limit - 1 }),
    db.stats(),
  ]);
  return { ok: true, page, limit, total: list.total, rows: list.rows, stats };
});
