'use strict';
const { route, body, HttpError } = require('../lib/http');
const { db } = require('../lib/db');
const { phoneOf } = require('../lib/service');
const { insuredPrefill } = require('../lib/prefill');

// GET or POST /api/prefill?phone_number=919217090193&flow=insured       (header: x-api-key)
// Returns the data to put into flow_action_payload.data when you send the flow 3 message, so the customer
// does not retype what they already gave in flow 1 and 2.
module.exports = route({ methods: ['GET', 'POST'], auth: 'flow' }, async (req) => {
  const input = { ...(req.method === 'POST' ? body(req) : {}), ...(req.query || {}) };
  const flow = String(input.flow || 'insured').toLowerCase();
  if (flow !== 'insured') throw new HttpError(400, 'Only flow=insured has prefill');
  const phone = phoneOf(input);
  const row = input.proposal_no ? await db.getProposal(String(input.proposal_no)) : ((await db.latestOpen(phone)) || (await db.latestAny(phone)));
  const data = insuredPrefill(row);
  return {
    ok: true,
    found: Boolean(row),
    proposal_no: row ? row.proposal_no : null,
    data,
    // ready to paste into the Flow message action parameters
    flow_action_payload: { screen: 'INSURED_COUNT', data },
  };
});
