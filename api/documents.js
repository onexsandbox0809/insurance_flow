'use strict';
const { route, body } = require('../lib/http');
const { getDocumentLinks } = require('../lib/service');

// GET or POST /api/documents?proposal_no=HP-261106-00006      (header: x-api-key)
//          or /api/documents?phone_number=919217090193        (newest proposal of that number)
// Optional: generate_pdf=1  builds the proposal PDF first (needs a ready quote)
//           valid_hours=24  lifetime of the long Supabase URLs (default 168, maximum 720)
// Returns, for the proposal PDF and every uploaded document, the short link and the long Supabase URL.
module.exports = route({ methods: ['GET', 'POST'], auth: 'flow' }, (req) => {
  const input = { ...(req.method === 'POST' ? body(req) : {}), ...(req.query || {}) };
  return getDocumentLinks(input);
});
