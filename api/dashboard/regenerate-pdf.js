'use strict';
const { route, body, HttpError } = require('../../lib/http');
const { db } = require('../../lib/db');
const { ensurePdf } = require('../../lib/service');

// POST /api/dashboard/regenerate-pdf  { "proposal_no": "HP-261101-00001" }   (Authorization: Bearer <token>)
module.exports = route({ methods: ['POST'], auth: 'user' }, async (req) => {
  const { proposal_no: no } = body(req);
  if (!no) throw new HttpError(400, 'proposal_no is required');
  const p = await db.getProposal(no);
  if (!p) throw new HttpError(404, 'Proposal not found');
  const saved = await ensurePdf(no);
  return { ok: true, proposal_no: no, proposal_pdf_url: saved.proposal_pdf_url, generated_at: saved.proposal_pdf_generated_at };
});
