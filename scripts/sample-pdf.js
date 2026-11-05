'use strict';
// node scripts/sample-pdf.js  ->  out/sample-proposal.pdf
const fs = require('fs');
const path = require('path');
const { buildProposalPdf } = require('../lib/pdf');
const { samples } = require('./sample-data');

(async () => {
  const p = samples[0];
  const docs = [
    { doc_type: 'id_proof', file_name: 'IMG_6440.PNG', short_url: 'https://your-app.vercel.app/d/k7Qm2XaB', status: 'stored' },
    { doc_type: 'address_proof', file_name: 'IMG_6440.PNG', short_url: 'https://your-app.vercel.app/d/Zt9PdR4w', status: 'stored' },
    { doc_type: 'age_proof', file_name: 'IMG_6440.PNG', short_url: 'https://your-app.vercel.app/d/H3nLq8Vc', status: 'stored' },
    { doc_type: 'prepolicy_reports', file_name: 'blood_report.pdf', short_url: 'https://your-app.vercel.app/d/Wm5Ys2Kd', status: 'stored' },
  ];
  const bytes = await buildProposalPdf({ proposal: p, documents: docs });
  const out = path.join(__dirname, '..', 'out');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'sample-proposal.pdf'), bytes);
  console.log('wrote out/sample-proposal.pdf', bytes.length, 'bytes');
})();
