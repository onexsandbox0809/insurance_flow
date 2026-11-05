'use strict';
const cfg = require('./config');
const crypto = require('crypto');

/*
 * OneXAura media helpers. Two calls, always in this order, one document at a time:
 *   API 1  GET {ONEX_BASE_URL}/oapi/wa/media?mediaId=..&phoneNumber=..           -> temporary media URL
 *   API 2  GET {ONEX_BASE_URL}/oapi/wa/download-media?mediaUrl=..&phoneNumber=.. -> the file
 *
 * The exact JSON shape of these responses was not available, so both parsers are tolerant.
 * If your responses differ, adjust ONLY findUrl() and extractFile() below.
 */
const headers = () => ({ apiKey: cfg.onexKey() || '' });

function findUrl(node, depth = 0) {
  if (!node || depth > 5) return null;
  if (typeof node === 'string') return /^https?:\/\//i.test(node) ? node : null;
  if (Array.isArray(node)) { for (const x of node) { const f = findUrl(x, depth + 1); if (f) return f; } return null; }
  if (typeof node === 'object') {
    const preferred = ['url', 'mediaUrl', 'media_url', 'downloadUrl', 'fileUrl', 'link'];
    for (const k of preferred) if (typeof node[k] === 'string' && /^https?:\/\//i.test(node[k])) return node[k];
    for (const v of Object.values(node)) { const f = findUrl(v, depth + 1); if (f) return f; }
  }
  return null;
}

async function readJsonOrText(resp) {
  const text = await resp.text();
  try { return JSON.parse(text); } catch { return text; }
}

// API 1
async function getMediaUrl(mediaId, phone) {
  const u = `${cfg.onexBase()}/oapi/wa/media?mediaId=${encodeURIComponent(mediaId)}&phoneNumber=${encodeURIComponent(phone)}`;
  const resp = await fetch(u, { headers: headers() });
  const payload = await readJsonOrText(resp);
  if (!resp.ok) throw new Error(`media lookup failed (${resp.status})`);
  const url = findUrl(payload);
  if (!url) throw new Error('media lookup returned no URL');
  return url;
}

// Pulls file bytes out of whatever API 2 returns: raw bytes, JSON with base64, or JSON with a file URL.
async function extractFile(resp, fallbackMime) {
  const ct = (resp.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('json') && !ct.startsWith('text/')) {
    const buf = Buffer.from(await resp.arrayBuffer());
    return { bytes: buf, mime: ct.split(';')[0] || fallbackMime };
  }
  const data = await readJsonOrText(resp);
  if (data && typeof data === 'object') {
    const b64 = ['base64', 'file', 'content', 'data', 'fileData'].map((k) => data[k] || (data.data && data.data[k])).find((v) => typeof v === 'string' && v.length > 100);
    if (b64) return { bytes: Buffer.from(b64.replace(/^data:[^,]+,/, ''), 'base64'), mime: data.mime_type || data.mimeType || fallbackMime };
    const link = findUrl(data);
    if (link) {
      let r = await fetch(link);
      if (!r.ok) r = await fetch(link, { headers: headers() });
      if (!r.ok) throw new Error(`saved file could not be fetched (${r.status})`);
      return { bytes: Buffer.from(await r.arrayBuffer()), mime: (r.headers.get('content-type') || fallbackMime || '').split(';')[0] };
    }
  }
  throw new Error('download-media returned neither a file nor a file link');
}

// API 2
async function downloadMedia(mediaUrl, phone, fallbackMime) {
  const u = `${cfg.onexBase()}/oapi/wa/download-media?mediaUrl=${encodeURIComponent(mediaUrl)}&phoneNumber=${encodeURIComponent(phone)}`;
  const resp = await fetch(u, { headers: headers() });
  if (!resp.ok) throw new Error(`media download failed (${resp.status})`);
  const file = await extractFile(resp, fallbackMime);
  if (!file.bytes || !file.bytes.length) throw new Error('downloaded file is empty');
  return file;
}

const sha256b64 = (bytes) => crypto.createHash('sha256').update(bytes).digest('base64');

module.exports = { getMediaUrl, downloadMedia, sha256b64, findUrl };
