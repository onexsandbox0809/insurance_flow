'use strict';
const { db } = require('./db');
const { FLOWS, DATA_FLOWS, ALL_FLOWS, normalize } = require('./flows');
const { computeQuote, quoteToColumns } = require('./premium');
const { nowIST } = require('./dates');
const { buildProposalPdf } = require('./pdf');
const { storeWithShortLink, upload, createShortLink, extFor, signedUrl } = require('./storage');
const cfg = require('./config');
const media = require('./media');
const { HttpError } = require('./http');

const DOC_ORDER = ['id_proof', 'address_proof', 'age_proof', 'previous_policy_docs', 'prepolicy_reports', 'pan_doc'];
const DOC_COLUMN = {
  id_proof: 'id_proof_url', address_proof: 'address_proof_url', age_proof: 'age_proof_url',
  previous_policy_docs: 'previous_policy_url', prepolicy_reports: 'medical_report_url', pan_doc: 'pan_doc_url',
};
const DOC_LABEL = {
  id_proof: 'ID proof', address_proof: 'Proof of residence', age_proof: 'Proof of age',
  previous_policy_docs: 'Previous policy copies', prepolicy_reports: 'Medical / check-up report', pan_doc: 'PAN or Form 60/61',
};

const stamp = () => { const n = nowIST(); return `${n.date} ${n.time}`; };

function phoneOf(body) {
  const raw = body.phone_number || body.phoneNumber || body.wa_id || body.waId || '';
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 10) d = `91${d}`;
  if (d.length < 11) throw new HttpError(400, 'phone_number is required (e.g. 919217090193)');
  return d;
}

// 'quoted' needs all five data flows AND a premium that could really be calculated.
function statusFor(done, quoteReady) {
  if (quoteReady && DATA_FLOWS.every((f) => done.includes(f))) return done.includes('documents') ? 'completed' : 'quoted';
  return 'draft';
}

const pdfPath = (proposalNo) => `${proposalNo}/proposal-${proposalNo}.pdf`;
// short link (stored) + long Supabase link (made on demand, expires)
async function pdfLinks(row) {
  if (!row || !row.proposal_pdf_url) return { proposal_pdf_url: null, proposal_pdf_signed_url: null };
  return { proposal_pdf_url: row.proposal_pdf_url, proposal_pdf_signed_url: await signedUrl(pdfPath(row.proposal_no)), signed_url_valid_hours: cfg.signedUrlHours() };
}

// personal -> continue the open draft if it has not done "personal" yet, otherwise start a new proposal.
// documents -> the newest proposal of this phone, even a completed one (a retry must not open a new proposal).
// every other flow -> continue the newest open proposal of this phone (create one if none exists).
async function resolveProposal(flowKey, phone, proposalNo) {
  if (proposalNo) {
    const row = await db.getProposal(proposalNo);
    if (!row) throw new HttpError(404, `proposal_no ${proposalNo} not found`);
    return row;
  }
  const open = await db.latestOpen(phone);
  if (flowKey === 'personal') {
    if (open && !(open.flows_completed || []).includes('personal')) return open;
    return db.createProposal(phone);
  }
  if (flowKey === 'documents') return open || (await db.latestAny(phone)) || db.createProposal(phone);   // retries and late uploads stay on the same proposal
  return open || db.createProposal(phone);
}

function quoteSummary(row) {
  const q = row.premium_breakdown;
  if (!q || !q.ready) return { ready: false, status: row.quote_status || 'not_ready' };
  return {
    ready: true, annual: row.premium_annual, half_yearly: row.premium_half_yearly, quarterly: row.premium_quarterly,
    monthly: row.premium_monthly, net: row.premium_net, gst: row.premium_gst, total_sum_insured: row.total_sum_insured,
    valid_till: row.quote_valid_till,
  };
}

// (Re)builds the proposal PDF, stores it and keeps ONE stable short link per proposal.
async function ensurePdf(proposalNo) {
  const proposal = await db.getProposal(proposalNo);
  const documents = await db.listDocuments(proposalNo);
  const bytes = await buildProposalPdf({ proposal, documents });
  const path = pdfPath(proposalNo);
  const fileName = `proposal-${proposalNo}.pdf`;
  let url = proposal.proposal_pdf_url;
  if (url) {
    await upload(path, bytes, 'application/pdf');
  } else {
    const link = await storeWithShortLink({ kind: 'pdf', proposalNo, path, bytes, mime: 'application/pdf', fileName });
    url = link.url;
  }
  const n = nowIST();
  return db.updateProposal(proposalNo, { proposal_pdf_url: url, proposal_pdf_generated_at: `${n.date} ${n.time}` });
}

async function applyFlow(flowKey, body) {
  const def = FLOWS[flowKey];
  const phone = phoneOf(body);
  const { patch, errors, missing } = normalize(flowKey, body);
  if (errors.length) throw new HttpError(422, 'Invalid data', { details: errors });
  if (missing.length) throw new HttpError(422, `Missing required field(s): ${missing.join(', ')}`, { missing });

  const row = await resolveProposal(flowKey, phone, body.proposal_no);

  // In the WhatsApp flow the proposer's Aadhaar is shown greyed out and is therefore not submitted (an empty value arrives).
  // Keep the masked value saved in flow 1 instead of blanking it. A value that IS submitted is always accepted as sent.
  if (flowKey === 'insured' && !patch.p1_aadhaar && /^X{8}\d{4}$/.test(row.aadhaar || '')) {
    const relation = patch.p1_relation !== undefined ? patch.p1_relation : row.p1_relation;
    if (!relation || relation === 'Self') patch.p1_aadhaar = row.aadhaar;
  }

  const done = Array.from(new Set([...(row.flows_completed || []), flowKey]));
  const merged = { ...row, ...patch };
  const quote = computeQuote(merged);

  const update = {
    ...patch,
    ...quoteToColumns(quote),
    flows_completed: done,
    status: statusFor(done, quote.ready),
    [def.column]: stamp(),
  };
  let saved = await db.updateProposal(row.proposal_no, update);

  await db.addSubmission({ proposal_no: row.proposal_no, flow_key: flowKey, payload: patch });

  // Everything for the quote is in -> build/refresh the proposal PDF.
  let pdfError = null;
  if (DATA_FLOWS.every((f) => done.includes(f)) && quote.ready) {
    try { saved = await ensurePdf(row.proposal_no); } catch (e) { pdfError = e.message; console.error('[pdf]', e.message); }
  }

  return {
    ok: true,
    flow: flowKey,
    flow_label: def.label,
    proposal_no: saved.proposal_no,
    status: saved.status,
    flows_completed: saved.flows_completed,
    flows_pending: ALL_FLOWS.filter((f) => !saved.flows_completed.includes(f)),
    quote: quoteSummary(saved),
    quote_missing: quote.ready ? [] : quote.missing,
    ...(await pdfLinks(saved)),
    ...(pdfError ? { pdf_warning: `PDF could not be generated: ${pdfError}` } : {}),
  };
}

function pick(body) {
  return body && typeof body.data === 'object' && body.data ? { ...body, ...body.data } : body;
}

// Flow 7: for every media id -> API 1 (get URL) -> API 2 (download) -> store in Supabase -> short link. Strictly one at a time.
async function processDocuments(rawBody) {
  const body = pick(rawBody);
  const phone = phoneOf(body);
  const row = await resolveProposal('documents', phone, body.proposal_no);
  const proposalNo = row.proposal_no;

  const results = [];
  for (const docType of DOC_ORDER) {
    const files = Array.isArray(body[docType]) ? body[docType] : [];
    let index = 0;
    for (const f of files) {
      index += 1;
      const mediaId = String(f.id || f.media_id || '');
      if (!mediaId) continue;
      const base = {
        proposal_no: proposalNo, doc_type: docType, doc_label: DOC_LABEL[docType], file_index: index,
        whatsapp_media_id: mediaId, sha256: f.sha256 || null, mime_type: f.mime_type || null, file_name: f.file_name || null,
      };
      try {
        const existing = await db.findDocument(proposalNo, mediaId);
        if (existing && existing.status === 'stored' && existing.short_url) { results.push(existing); continue; }

        const sourceUrl = await media.getMediaUrl(mediaId, phone);                          // API 1
        const file = await media.downloadMedia(sourceUrl, phone, f.mime_type);              // API 2
        const mime = file.mime || f.mime_type || 'application/octet-stream';
        const path = `${proposalNo}/${docType}-${index}-${mediaId}.${extFor(mime, f.file_name)}`;
        const computed = media.sha256b64(file.bytes);
        const link = await storeWithShortLink({ kind: 'doc', proposalNo, path, bytes: file.bytes, mime, fileName: f.file_name });
        const n = nowIST();
        results.push(await db.saveDocument({
          ...base, mime_type: mime, size_bytes: file.bytes.length, source_media_url: sourceUrl,
          sha256_computed: computed, sha256_match: base.sha256 ? base.sha256 === computed : null,
          storage_path: path, short_code: link.code, short_url: link.url, status: 'stored', error: null,
          created_date: n.date, created_time: n.time,
        }));
      } catch (e) {
        console.error('[documents]', docType, mediaId, e.message);
        const n = nowIST();
        results.push(await db.saveDocument({ ...base, status: 'failed', error: e.message, created_date: n.date, created_time: n.time }));
      }
    }
  }

  const stored = results.filter((r) => r.status === 'stored');
  const failed = results.filter((r) => r.status === 'failed');

  const columns = {};
  DOC_ORDER.forEach((t) => {
    const urls = stored.filter((r) => r.doc_type === t).map((r) => r.short_url);
    if (urls.length) columns[DOC_COLUMN[t]] = urls.join(', ');
  });
  const done = Array.from(new Set([...(row.flows_completed || []), ...(failed.length || !results.length ? [] : ['documents'])]));
  let saved = await db.updateProposal(proposalNo, {
    ...columns, flows_completed: done, status: statusFor(done, row.quote_status === 'quoted'),
    ...(done.includes('documents') ? { flow_documents_at: stamp() } : {}),
  });
  await db.addSubmission({
    proposal_no: proposalNo, flow_key: 'documents',
    payload: { documents: results.map((r) => ({ doc_type: r.doc_type, whatsapp_media_id: r.whatsapp_media_id, status: r.status, error: r.error || undefined })) },
  });

  let pdfError = null;
  if (saved.quote_status === 'quoted' && DATA_FLOWS.every((f) => done.includes(f))) {
    try { saved = await ensurePdf(proposalNo); } catch (e) { pdfError = e.message; }
  }

  return {
    ok: failed.length === 0 && results.length > 0,
    flow: 'documents',
    proposal_no: proposalNo,
    status: saved.status,
    flows_completed: saved.flows_completed,
    stored: stored.length,
    failed: failed.length,
    documents: await Promise.all(results.map(async (r) => ({
      doc_type: r.doc_type, file_name: r.file_name, whatsapp_media_id: r.whatsapp_media_id, sha256: r.sha256,
      sha256_match: r.sha256_match, media_url: r.short_url || null,
      media_signed_url: r.status === 'stored' ? await signedUrl(r.storage_path) : null,
      status: r.status, error: r.error || undefined,
    }))),
    ...(await pdfLinks(saved)),
    ...(pdfError ? { pdf_warning: `PDF could not be generated: ${pdfError}` } : {}),
    ...(!results.length ? { message: 'No media ids found in the payload' } : {}),
  };
}

// Read-only: the current premium of a proposal, found by proposal_no or by phone (newest proposal).
async function getQuote(input) {
  let row;
  if (input.proposal_no) row = await db.getProposal(String(input.proposal_no));
  else row = await db.latestAny(phoneOf(input));
  if (!row) throw new HttpError(404, 'No proposal found');
  const detail = ['1', 'true', 'yes'].includes(String(input.detail || '').toLowerCase());
  return {
    ok: true,
    proposal_no: row.proposal_no,
    status: row.status,
    premium_option: row.premium_option,
    quote: quoteSummary(row),
    ...(row.premium_breakdown && row.premium_breakdown.ready ? {} : { quote_missing: (row.premium_breakdown && row.premium_breakdown.missing) || ['persons', 'p1_dob', 'p1_sum_insured'] }),
    ...(await pdfLinks(row)),
    ...(detail ? { breakdown: row.premium_breakdown || null } : {}),
  };
}

module.exports = { applyFlow, processDocuments, getQuote, ensurePdf, phoneOf, DOC_ORDER, DOC_LABEL, DOC_COLUMN };
