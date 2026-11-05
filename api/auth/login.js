'use strict';
const { route, body, HttpError } = require('../../lib/http');
const { db } = require('../../lib/db');
const { signToken } = require('../../lib/auth');

// POST /api/auth/login  { "login_id": "admin", "password": "..." }
module.exports = route({ methods: ['POST'] }, async (req) => {
  const { login_id: login, password } = body(req);
  if (!login || !password) throw new HttpError(400, 'Enter your login id and password');
  const user = await db.verifyUser(String(login).trim(), String(password));
  if (!user) throw new HttpError(401, 'Login id or password is not correct');
  const name = user.out_display_name || user.display_name || user.out_login_id;
  const id = user.out_login_id || user.login_id;
  return { ok: true, token: signToken({ sub: id, name }), user: { login_id: id, name } };
});
