const { timingSafeEqual } = require('node:crypto');
const pool = require('../config/db');
const { createGoogleOidc } = require('../services/googleOidc');
const { findOrCreateGoogleUser } = require('../services/googleAccounts');
const { sessionOperation } = require('../middleware/authSession');
const { signIn } = require('./authController');

const ATTEMPT_MAX_AGE = 10 * 60 * 1000;
// Only fixed diagnostic labels/codes may reach logs. Never serialize an error,
// its message/cause, claims, request headers/query, session data or provider URLs.
const SAFE_CODES = new Set([
  '42501', '42P01', '42703', '23502', '23503', '23505', '23514', '42883', '42804', '22P02',
  '40001', '40P01', '57014', '53300', '57P01', '08006',
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EACCES',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
  'OAUTH_RESPONSE_BODY_ERROR', 'OAUTH_AUTHORIZATION_RESPONSE_ERROR', 'OAUTH_INVALID_RESPONSE',
  'OAUTH_JWT_TIMESTAMP_CHECK_FAILED', 'OAUTH_JWT_CLAIM_COMPARISON_FAILED', 'OAUTH_KEY_SELECTION_FAILED',
  'OAUTH_PARSE_ERROR', 'OAUTH_RESPONSE_IS_NOT_JSON', 'OAUTH_RESPONSE_IS_NOT_CONFORM',
  'OAUTH_JSON_ATTRIBUTE_COMPARISON_FAILED', 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
  'ERR_JWT_CLAIM_VALIDATION_FAILED', 'ERR_JWT_EXPIRED', 'ERR_INVALID_ARG_TYPE', 'ERR_INVALID_ARG_VALUE',
  'OAUTH_TIMEOUT', 'OAUTH_ABORT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT', 'CERT_HAS_EXPIRED',
]);
const SAFE_REASONS = new Set(['incompatible_cookie_policy', 'duplicate_parameters', 'missing_attempt',
  'invalid_attempt', 'expired_attempt', 'state_mismatch', 'attempt_already_consumed', 'provider_denied', 'invalid_code']);
const SAFE_ACCOUNT_STAGES = new Set(['identity_claims', 'account_transaction', 'identity_lock', 'identity_lookup',
  'email_lookup', 'user_insert', 'identity_insert', 'transaction_commit']);
function diagnosticError(reason) { return Object.assign(new Error('Google sign-in validation failed'), { googleReason: reason }); }
function safeDiagnostic(error, stage) {
  const details = { stage, reason: error?.accountConflict ? 'account_conflict' : SAFE_REASONS.has(error?.googleReason) ? error.googleReason : 'operation_failed' };
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    if (!details.code && SAFE_CODES.has(current.code)) details.code = current.code;
    if (['nonce', 'iss', 'aud', 'azp', 'exp', 'iat'].includes(current.claim)) details.claim = current.claim;
  }
  if (SAFE_ACCOUNT_STAGES.has(error?.googleAccountStage)) details.accountStage = error.googleAccountStage;
  if (['regenerate', 'save', 'destroy'].includes(error?.sessionOperation)) details.sessionOperation = error.sessionOperation;
  // OAuth error responses can contain arbitrary text; only standard labels pass.
  if (['invalid_client', 'invalid_grant', 'access_denied', 'temporarily_unavailable', 'server_error'].includes(error?.error)) details.providerError = error.error;
  return details;
}
function sameState(actual, expected) {
  return typeof actual === 'string' && typeof expected === 'string' && actual.length <= 128
    && Buffer.byteLength(actual) === Buffer.byteLength(expected)
    && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function createGoogleController({ sessionContext, provider = createGoogleOidc() }) {
  function fail(req, res, error, stage) {
    // Never log the provider error object, message, URL, code, tokens or secrets.
    const diagnostic = safeDiagnostic(error, stage);
    if (diagnostic.reason === 'missing_attempt') {
      const cookieName = sessionContext.getConfig().cookieName;
      diagnostic.requestCookiePresent = (req.headers.cookie || '').split(';').some(part => part.trim().startsWith(`${cookieName}=`));
    }
    console.error('Google sign-in failed', diagnostic);
    // Avoid autosaving an old copy of the OAuth attempt after an atomic claim.
    req.session = null;
    const destination = new URL('/', sessionContext.getConfig().clientUrl);
    destination.searchParams.set('auth_error', error?.accountConflict ? 'account_conflict' : 'google_sign_in_failed');
    return res.redirect(303, destination.href);
  }
  return {
    async begin(req, res) {
      let stage = 'authorization_start';
      try {
        // Strict cookies would not accompany Google's cross-site callback.
        if (sessionContext.getConfig().cookie.sameSite === 'strict') throw diagnosticError('incompatible_cookie_policy');
        const { url, attempt } = await provider.begin();
        req.session.googleOAuth = attempt;
        stage = 'authorization_session_save';
        await sessionOperation(req, 'save');
        return res.redirect(302, url);
      } catch (error) { return fail(req, res, error, stage); }
    },
    async callback(req, res) {
      res.set('Referrer-Policy', 'no-referrer');
      let stage = 'callback_configuration';
      try {
        const attempt = req.session.googleOAuth;
        // Reconstruct using the configured callback, never untrusted Host/proxy headers.
        const callback = new URL(provider.getSettings().callbackUrl);
        callback.search = new URL(req.originalUrl, 'http://unused.invalid').search;
        stage = 'callback_validation';
        for (const key of ['state', 'code', 'error']) {
          if (callback.searchParams.getAll(key).length > 1) throw diagnosticError('duplicate_parameters');
        }
        if (!attempt) throw diagnosticError('missing_attempt');
        if (!Number.isSafeInteger(attempt.createdAt) || attempt.createdAt > Date.now()
          || typeof attempt.nonce !== 'string' || typeof attempt.verifier !== 'string') throw diagnosticError('invalid_attempt');
        if (Date.now() - attempt.createdAt >= ATTEMPT_MAX_AGE) throw diagnosticError('expired_attempt');
        if (!sameState(callback.searchParams.get('state'), attempt.state)) throw diagnosticError('state_mismatch');
        // Atomically consume the session-bound attempt before exchanging a code.
        // This prevents concurrent/replayed callbacks on different server instances.
        stage = 'session_state_consume';
        const consumed = await pool.query(`UPDATE public.session SET sess = (sess::jsonb - 'googleOAuth')::json
          WHERE sid = $1 AND expire > NOW() AND sess::jsonb->'googleOAuth'->>'state' = $2 RETURNING sid`, [req.sessionID, attempt.state]);
        if (consumed.rowCount !== 1) throw diagnosticError('attempt_already_consumed');
        delete req.session.googleOAuth;
        const code = callback.searchParams.get('code');
        stage = 'authorization_response';
        if (callback.searchParams.has('error')) throw diagnosticError('provider_denied');
        if (!code || code.length > 4096) throw diagnosticError('invalid_code');
        stage = 'token_validation';
        const claims = await provider.authenticate(callback, attempt);
        stage = 'account_resolution';
        const user = await findOrCreateGoogleUser(claims);
        stage = 'session_creation';
        await signIn(req, { id: user.id });
        return res.redirect(303, new URL('/', sessionContext.getConfig().clientUrl).href);
      } catch (error) { return fail(req, res, error, stage); }
    },
  };
}

module.exports = { createGoogleController, ATTEMPT_MAX_AGE };
