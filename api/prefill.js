'use strict';
const { route, body, HttpError } = require('../lib/http');
const { db } = require('../lib/db');
const { phoneOf } = require('../lib/service');
const { insuredPrefill } = require('../lib/prefill');
const { FLOWS } = require('../lib/flows');

// GET or POST /api/prefill                                                  (header: x-api-key)
//
// 1) Saved data of a step, by customer phone number:
//      /api/prefill?phone_number=919876543210&step=personal       (step = personal | nominee | insured | medical | covers | all)
//    Returns what the customer already submitted for that step (Aadhaar and PAN are masked).
//
// 2) Values to prefill flow 3 (insured persons) when you send that flow message:
//      /api/prefill?phone_number=919876543210
//    Returns data and a ready flow_action_payload.
//
// The newest proposal of that number is used; send proposal_no to pick a specific one.
module.exports = route({ methods: ['GET', 'POST'], auth: 'flow' }, async (req) => {
  const input = { ...(req.method === 'POST' ? body(req) : {}), ...(req.query || {}) };
  const step = String(input.step || '').toLowerCase();
  if (step && step !== 'all' && !FLOWS[step]) throw new HttpError(400, 'step must be personal, nominee, insured, medical, covers or all');
  if (step === 'documents') throw new HttpError(400, 'Documents are returned by /api/documents');

  const flow = String(input.flow || 'insured').toLowerCase();
  if (!step && flow !== 'insured') throw new HttpError(400, 'Only flow=insured has prefill. Use step=personal to read saved step data.');

  const row = input.proposal_no ? await db.getProposal(String(input.proposal_no)) : null;
  let found = row;
  if (!found) {
    const phone = phoneOf(input);
    found = (await db.latestOpen(phone)) || (await db.latestAny(phone));
  }

  if (step) {
    const keys = step === 'all'
      ? Object.keys(FLOWS).filter((k) => k !== 'documents').flatMap((k) => Object.keys(FLOWS[k].fields))
      : Object.keys(FLOWS[step].fields);
    const data = Object.fromEntries(keys.map((k) => [k, found && found[k] !== undefined ? found[k] : null]));
    const completed = found ? found.flows_completed || [] : [];
    return {
      ok: true,
      found: Boolean(found),
      step,
      proposal_no: found ? found.proposal_no : null,
      status: found ? found.status : null,
      step_completed: step === 'all' ? null : completed.includes(step),
      flows_completed: completed,
      submitted_at: found && step !== 'all' ? found[FLOWS[step].column] || null : null,
      data,
    };
  }

  const data = insuredPrefill(found);
  return {
    ok: true,
    found: Boolean(found),
    proposal_no: found ? found.proposal_no : null,
    data,
    flow_action_payload: { screen: 'INSURED_COUNT', data },   // ready to paste into the Flow message
  };
});