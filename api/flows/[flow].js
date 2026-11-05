'use strict';

const { route, body, HttpError } = require('../../lib/http');
const { applyFlow, processDocuments } = require('../../lib/service');

const ALLOWED_FLOWS = new Set([
  'personal',
  'nominee',
  'insured',
  'medical',
  'covers',
  'documents',
]);

// Keeps the public URLs unchanged:
// POST /api/flows/personal, /nominee, /insured, /medical, /covers, /documents
// Vercel supplies the dynamic segment as req.query.flow.
module.exports = route(
  { methods: ['POST'], auth: 'flow' },
  async (req) => {
    const flow = String((req.query && req.query.flow) || '').toLowerCase();

    if (!ALLOWED_FLOWS.has(flow)) {
      throw new HttpError(404, 'Unknown flow endpoint');
    }

    const payload = body(req);
    if (flow === 'documents') return processDocuments(payload);
    return applyFlow(flow, payload);
  }
);
