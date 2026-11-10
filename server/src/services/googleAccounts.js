const { randomUUID } = require('node:crypto');
const transaction = require('../utils/transaction');

function conflict() { return Object.assign(new Error('Account conflict'), { accountConflict: true }); }

function validateGoogleIdentity(claims) {
  if (!claims || typeof claims.sub !== 'string' || !claims.sub.length || claims.sub.length > 255
    || claims.email_verified !== true || typeof claims.email !== 'string'
    || claims.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) {
    throw new Error('Invalid Google identity');
  }
  return { subject: claims.sub, email: claims.email.toLowerCase(),
    name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim().slice(0, 150) : 'Google user' };
}

async function findOrCreateGoogleUser(claims) {
  let stage = 'identity_claims';
  try {
    const identity = validateGoogleIdentity(claims);
    stage = 'account_transaction';
    return await transaction(async client => {
      // Serialize simultaneous first logins for this subject across all instances.
      stage = 'identity_lock';
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`google:${identity.subject}`]);
      stage = 'identity_lookup';
      const existing = await client.query(`SELECT u.id, u.name, u.email FROM public.account_identities a
        JOIN public.users u ON u.id = a.user_id WHERE a.provider = $1 AND a.subject = $2`, ['google', identity.subject]);
      if (existing.rowCount) { stage = 'transaction_commit'; return existing.rows[0]; }
      stage = 'email_lookup';
      const emailOwner = await client.query('SELECT id FROM public.users WHERE lower(email) = lower($1)', [identity.email]);
      // Email ownership is not proof of ownership of an existing Inventra account.
      if (emailOwner.rowCount) throw conflict();
      stage = 'user_insert';
      const created = await client.query(`INSERT INTO public.users (id, name, email, password_hash)
        VALUES ($1, $2, $3, NULL) RETURNING id, name, email`, [randomUUID(), identity.name, identity.email]);
      const user = created.rows[0];
      stage = 'identity_insert';
      await client.query('INSERT INTO public.account_identities (provider, subject, user_id) VALUES ($1, $2, $3)', ['google', identity.subject, user.id]);
      stage = 'transaction_commit';
      return user;
    });
  } catch (error) {
    // Covers races with email/password registration and different Google subjects.
    if (error.code === '23505') {
      const accountConflict = conflict();
      accountConflict.googleAccountStage = stage;
      throw accountConflict;
    }
    error.googleAccountStage = stage;
    throw error;
  }
}

module.exports = { findOrCreateGoogleUser, validateGoogleIdentity };
