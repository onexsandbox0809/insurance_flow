'use strict';
const { route, body } = require('../lib/http');
const { getQuote } = require('../lib/service');

// GET or POST /api/quote?proposal_no=HP-261105-00004   or   ?phone_number=919217090193   (header: x-api-key)
// Add detail=1 to include the full premium breakdown.
module.exports = route({ methods: ['GET', 'POST'], auth: 'flow' }, (req) => {
  const input = { ...(req.method === 'POST' ? body(req) : {}), ...(req.query || {}) };
  return getQuote(input);
});
