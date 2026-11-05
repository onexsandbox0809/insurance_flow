'use strict';
// Sensitive identifiers are masked BEFORE anything is written to the database or logs.

// Aadhaar: hide the first 8 digits, keep the last 4  ->  XXXXXXXX1234
function maskAadhaar(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = String(value).replace(/\D/g, '');
  if (!d) return null;
  if (d.length <= 4) return 'X'.repeat(d.length);
  return 'X'.repeat(d.length - 4) + d.slice(-4);
}

// PAN: keep the first 2 characters and the last 1, hide everything else  ->  ABXXXXXXXF
function maskPan(value) {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).replace(/\s/g, '').toUpperCase();
  if (!s) return null;
  if (s.length <= 3) return 'X'.repeat(s.length);
  return s.slice(0, 2) + 'X'.repeat(s.length - 3) + s.slice(-1);
}

module.exports = { maskAadhaar, maskPan };
