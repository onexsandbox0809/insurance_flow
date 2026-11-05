'use strict';
const { route, body } = require('../../lib/http');
const { processDocuments } = require('../../lib/service');

// POST /api/flows/documents   (header: x-api-key)
// Body = the flow 7 response (media ids). Each id is resolved and stored one by one.
module.exports = route({ methods: ['POST'], auth: 'flow' }, (req) => processDocuments(body(req)));
