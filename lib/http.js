'use strict';
const cfg = require('./config');
const { verifyToken, safeEqual } = require('./auth');

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function body(req) {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { throw new HttpError(400, 'Body is not valid JSON'); } }
  return b && typeof b === 'object' ? b : {};
}

function requireFlowKey(req) {
  const expected = cfg.flowApiKey();
  if (!expected) throw new HttpError(500, 'FLOW_API_KEY is not configured on the server');
  const given = req.headers['x-api-key'] || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!safeEqual(given, expected)) throw new HttpError(401, 'Invalid or missing x-api-key');
}

function requireUser(req) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = verifyToken(token);
  if (!user) throw new HttpError(401, 'Please sign in again');
  return user;
}

// Wraps a handler: method check, auth, JSON errors.
function route({ methods = ['POST'], auth = 'none' }, fn) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        throw new HttpError(405, `Use ${methods.join(' or ')}`);
      }
      if (auth === 'flow') requireFlowKey(req);
      const user = auth === 'user' ? requireUser(req) : null;
      const out = await fn(req, res, { user });
      if (out !== undefined && !res.writableEnded) send(res, out.__status || 200, out.__body || out);
    } catch (e) {
      if (res.writableEnded) return;
      const status = e.status || 500;
      if (status >= 500) console.error('[api-error]', e && e.stack ? e.stack : e);
      send(res, status, { ok: false, error: e.message || 'Server error', ...(e.extra || {}) });
    }
  };
}

module.exports = { HttpError, send, body, route };
