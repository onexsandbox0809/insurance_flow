'use strict';
// Every value is read lazily so tests (and Vercel) can set process.env at any time.
const env = () => process.env;

module.exports = {
  supabaseUrl: () => env().SUPABASE_URL,
  serviceKey: () => env().SUPABASE_SERVICE_ROLE_KEY,
  bucket: () => env().STORAGE_BUCKET || 'proposal-docs',
  flowApiKey: () => env().FLOW_API_KEY,
  jwtSecret: () => env().JWT_SECRET,
  jwtTtlHours: () => Number(env().JWT_TTL_HOURS || 8),
  onexBase: () => (env().ONEX_BASE_URL || 'https://api.onexaura.com').replace(/\/$/, ''),
  onexKey: () => env().ONEX_API_KEY,
  company: () => env().COMPANY_NAME || 'UIIC Health Insurance',
  baseUrl: () => {
    const e = env();
    if (e.APP_BASE_URL) return e.APP_BASE_URL.replace(/\/$/, '');
    if (e.VERCEL_PROJECT_PRODUCTION_URL) return `https://${e.VERCEL_PROJECT_PRODUCTION_URL}`;
    if (e.VERCEL_URL) return `https://${e.VERCEL_URL}`;
    return 'http://localhost:3000';
  },
};
