'use strict';
const { route, body } = require('../../lib/http');
const { applyFlow } = require('../../lib/service');

// POST /api/flows/insured   (header: x-api-key)
module.exports = route({ methods: ['POST'], auth: 'flow' }, (req) => applyFlow('insured', body(req)));
