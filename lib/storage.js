'use strict';
const crypto = require('crypto');
const cfg = require('./config');
const { db } = require('./db');

const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; // no 0/O/I/l look-alikes in the letters

function randomCode(len = 8) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function extFor(mime, fileName) {
  const fromName = String(fileName || '').match(/\.([A-Za-z0-9]{2,5})$/);
  if (fromName) return fromName[1].toLowerCase();
  const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'application/pdf': 'pdf', 'image/webp': 'webp' };
  return map[String(mime).toLowerCase()] || 'bin';
}

async function upload(path, bytes, mime) {
  const up = await db.storage().from(cfg.bucket()).upload(path, bytes, { contentType: mime || 'application/octet-stream', upsert: true });
  if (up.error) { const e = new Error(`storage upload failed: ${up.error.message}`); e.status = 502; throw e; }
}

// kind 'doc' -> {APP_BASE_URL}/d/<code>, kind 'pdf' -> {APP_BASE_URL}/p/<code>
async function createShortLink({ kind, proposalNo, path, mime, fileName }) {
  const bucket = cfg.bucket();
  let code;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = randomCode(8);
    try {
      await db.addShortLink({ code, kind, proposal_no: proposalNo, storage_bucket: bucket, storage_path: path, mime_type: mime, file_name: fileName });
      break;
    } catch (e) {
      if (attempt === 4 || !/duplicate|unique/i.test(e.message)) throw e;
    }
  }
  return { code, url: `${cfg.baseUrl()}/${kind === 'pdf' ? 'p' : 'd'}/${code}` };
}

// Uploads bytes to the private bucket and returns a short public link that redirects to a signed URL.
async function storeWithShortLink({ kind, proposalNo, path, bytes, mime, fileName }) {
  await upload(path, bytes, mime);
  const link = await createShortLink({ kind, proposalNo, path, mime, fileName });
  return { ...link, path };
}

// The long, direct Supabase URL (a signed URL, because the bucket is private). Expires after SIGNED_URL_TTL_HOURS.
async function signedUrl(path) {
  if (!path) return null;
  const r = await db.storage().from(cfg.bucket()).createSignedUrl(path, Math.round(cfg.signedUrlHours() * 3600));
  return r.error || !r.data ? null : r.data.signedUrl;
}

module.exports = { signedUrl, storeWithShortLink, upload, createShortLink, randomCode, extFor };
