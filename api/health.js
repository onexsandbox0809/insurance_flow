'use strict';
module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const need = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'FLOW_API_KEY', 'JWT_SECRET', 'ONEX_API_KEY', 'APP_BASE_URL'];
  const missing = need.filter((k) => !process.env[k]);
  res.statusCode = missing.length ? 503 : 200;
  res.end(JSON.stringify({ ok: !missing.length, missing_env: missing, time: new Date().toISOString() }));
};
