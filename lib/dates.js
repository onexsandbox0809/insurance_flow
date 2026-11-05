'use strict';
// All business dates/times are Indian Standard Time.
//   date  -> DD-MM-YYYY
//   time  -> HH-mm (24 hour clock)
const TZ = 'Asia/Kolkata';
const pad = (n) => String(n).padStart(2, '0');

function parts(date) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const o = {};
  for (const p of fmt.formatToParts(date)) o[p.type] = p.value;
  return o;
}

function nowIST(date = new Date()) {
  const p = parts(date);
  return { date: `${p.day}-${p.month}-${p.year}`, time: `${p.hour}-${p.minute}`, iso: date.toISOString() };
}

function formatIST(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const n = nowIST(d);
  return `${n.date} ${n.time}`;
}

// Accepts YYYY-MM-DD (WhatsApp DatePicker), DD-MM-YYYY, DD/MM/YYYY, ISO timestamps, epoch milliseconds.
function toDDMMYYYY(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d{12,13}$/.test(String(v))) {
    const d = new Date(Number(v));
    return Number.isNaN(d.getTime()) ? null : nowIST(d).date;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${pad(m[1])}-${pad(m[2])}-${m[3]}`;
  return null;
}

function parseDDMMYYYY(s) {
  const m = String(s || '').match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  if (d.getUTCFullYear() !== +m[3] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[1]) return null;
  return d;
}

// Age in completed years on a given IST date (defaults to today in IST).
function ageOn(dob, ref = new Date()) {
  const b = parseDDMMYYYY(dob);
  if (!b) return null;
  const t = parseDDMMYYYY(nowIST(ref).date);
  let age = t.getUTCFullYear() - b.getUTCFullYear();
  const beforeBirthday = t.getUTCMonth() < b.getUTCMonth() ||
    (t.getUTCMonth() === b.getUTCMonth() && t.getUTCDate() < b.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age < 0 ? null : age;
}

function addDaysIST(days, ref = new Date()) {
  return nowIST(new Date(ref.getTime() + days * 86400000)).date;
}

module.exports = { TZ, nowIST, formatIST, toDDMMYYYY, parseDDMMYYYY, ageOn, addDaysIST };
