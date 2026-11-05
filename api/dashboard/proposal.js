'use strict';
const { route, HttpError } = require('../../lib/http');
const { db } = require('../../lib/db');

// GET /api/dashboard/proposal?proposal_no=HP-261101-00001      (Authorization: Bearer <token>)
module.exports = route({ methods: ['GET'], auth: 'user' }, async (req) => {
  const no = (req.query || {}).proposal_no;
  if (!no) throw new HttpError(400, 'proposal_no is required');
  const proposal = await db.getProposal(no);
  if (!proposal) throw new HttpError(404, 'Proposal not found');
  const [documents, submissions] = await Promise.all([db.listDocuments(no), db.listSubmissions(no)]);
  return { ok: true, proposal, documents, submissions };
});
