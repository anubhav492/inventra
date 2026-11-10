const { randomUUID } = require('node:crypto');
const argon2 = require('argon2');
const pool = require('../config/db');
const { validateAuth } = require('../utils/authValidation');
const { sessionOperation } = require('../middleware/authSession');

const HASH_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 };
// A real hash with matching work factors reduces account-existence timing differences.
let dummyHash;
function getDummyHash() {
  if (!dummyHash) dummyHash = argon2.hash(randomUUID(), HASH_OPTIONS).catch(error => { dummyHash = undefined; throw error; });
  return dummyHash;
}

async function signIn(req, user) {
  await sessionOperation(req, 'regenerate');
  req.session.userId = user.id;
  req.session.authenticatedAt = Date.now();
  await sessionOperation(req, 'save');
}

async function register(req, res) {
  const { name, email, password } = validateAuth(req.body, true);
  const passwordHash = await argon2.hash(password, HASH_OPTIONS);
  let result;
  try {
    result = await pool.query(
      'INSERT INTO public.users (id, name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, email',
      [randomUUID(), name, email, passwordHash]
    );
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ success: false, message: 'An account with this email already exists' });
    throw error;
  }
  const { id, name: savedName, email: savedEmail } = result.rows[0];
  const user = { id, name: savedName, email: savedEmail };
  await signIn(req, user);
  return res.status(201).json({ success: true, data: user });
}

async function login(req, res) {
  const { email, password } = validateAuth(req.body);
  const result = await pool.query('SELECT id, name, email, password_hash FROM public.users WHERE lower(email) = lower($1)', [email]);
  const row = result.rows[0];
  const fallback = await getDummyHash();
  let valid = false;
  try { valid = await argon2.verify(row?.password_hash || fallback, password); }
  catch { await argon2.verify(fallback, password); /* Invalid/legacy hash: generic failure. */ }
  if (!row || !row.password_hash || !valid) return res.status(401).json({ success: false, message: 'Invalid email or password' });
  const user = { id: row.id, name: row.name, email: row.email };
  await signIn(req, user);
  return res.json({ success: true, data: user });
}

function me(req, res) { return res.json({ success: true, data: req.user }); }

async function logout(req, res) {
  await sessionOperation(req, 'destroy');
  req.clearAuthCookie();
  return res.json({ success: true, message: 'Logged out' });
}

module.exports = { register, login, me, logout, signIn };
