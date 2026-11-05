'use strict';

const Module = require('module');
const path = require('path');
const { makeFake } = require('./fake-supabase');

// Route Supabase client creation to the in-memory fake.
let current;
const origLoad = Module._load;

Module._load = function (request, ...rest) {
  if (request === '@supabase/supabase-js') {
    return { createClient: () => current.client };
  }

  return origLoad.call(this, request, ...rest);
};

function setup() {
  current = makeFake();

  Object.assign(process.env, {
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key',
    FLOW_API_KEY: 'flow-secret',
    JWT_SECRET: 'jwt-secret-for-tests',
    ONEX_BASE_URL: 'https://api.onexaura.com',
    ONEX_API_KEY: 'onex-key',
    APP_BASE_URL: 'https://app.test',
    COMPANY_NAME: 'Test Insurer',
  });

  // Clear cached API and library modules for a fresh fake database.
  const projectRoot = path.resolve(__dirname, '..') + path.sep;

  for (const key of Object.keys(require.cache)) {
    if (
      key.startsWith(projectRoot) &&
      (
        key.includes(`${path.sep}lib${path.sep}`) ||
        key.includes(`${path.sep}api${path.sep}`)
      )
    ) {
      delete require.cache[key];
    }
  }

  return current;
}

// Calls a Vercel-style handler with a fake request/response.
async function call(
  handler,
  { method = 'POST', headers = {}, body, query = {} } = {}
) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ])
  );

  const req = {
    method,
    headers: lower,
    body,
    query,
  };

  let status = 200;
  const out = {};
  const hdrs = {};

  const res = {
    writableEnded: false,

    set statusCode(value) {
      status = value;
    },

    get statusCode() {
      return status;
    },

    setHeader(key, value) {
      hdrs[key.toLowerCase()] = value;
    },

    end(txt) {
      this.writableEnded = true;
      out.text = txt;
    },
  };

  await handler(req, res);

  let json;

  try {
    json = JSON.parse(out.text);
  } catch {
    // Response is not JSON.
  }

  return {
    status,
    headers: hdrs,
    text: out.text,
    json,
  };
}

// 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

module.exports = {
  setup,
  call,
  PNG,
};