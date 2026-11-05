'use strict';
const { db } = require('../lib/db');

const page = (res, status, message) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>File link</title>' +
    '<body style="font-family:system-ui,sans-serif;max-width:30rem;margin:15vh auto;padding:0 1.5rem;color:#14213D"><h2 style="margin:0 0 .5rem">' + message + '</h2>' +
    '<p style="color:#5B6B82">Ask the sender for a new link if you still need this file.</p></body>');
};

// GET /p/<code>  ->  302 to a short-lived signed URL of the stored proposal PDF
module.exports = async (req, res) => {
  try {
    const code = String((req.query || {}).code || '').replace(/[^A-Za-z0-9]/g, '');
    if (!code) return page(res, 404, 'This link is not valid');
    const link = await db.hitShortLink(code);
    if (!link || link.kind !== 'pdf') return page(res, 404, 'This link is not valid');
    const signed = await db.storage().from(link.storage_bucket).createSignedUrl(link.storage_path, 300);
    if (signed.error || !signed.data || !signed.data.signedUrl) return page(res, 404, 'This file is not available');
    res.statusCode = 302;
    res.setHeader('Location', signed.data.signedUrl);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  } catch (e) {
    console.error('[short-link]', e.message);
    page(res, 500, 'Something went wrong');
  }
};
