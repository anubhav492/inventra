const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function readAuthConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const secret = env.SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw Object.assign(new Error('SESSION_SECRET must contain at least 32 bytes of random secret material'), { configuration: true });
  }
  const clientUrl = env.CLIENT_URL || (production ? '' : 'http://localhost:5173');
  let url;
  try { url = new URL(clientUrl); } catch { throw Object.assign(new Error('CLIENT_URL must be an explicit HTTP(S) origin'), { configuration: true }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== clientUrl || (production && url.protocol !== 'https:')) {
    throw Object.assign(new Error('CLIENT_URL must be an exact origin without a trailing slash; production requires HTTPS'), { configuration: true });
  }
  const sameSite = env.SESSION_SAME_SITE || 'lax';
  if (!['lax', 'strict', 'none'].includes(sameSite) || (sameSite === 'none' && !production)) {
    throw Object.assign(new Error('SESSION_SAME_SITE must be lax, strict, or none (none requires production HTTPS)'), { configuration: true });
  }
  // Explicit proxy IPs/subnets only. Never blindly trust arbitrary forwarded headers.
  const trustProxy = env.TRUST_PROXY ? env.TRUST_PROXY.split(',').map(value => value.trim()).filter(Boolean) : false;
  if (trustProxy && trustProxy.some(value => ['true', 'false'].includes(value) || /^\d+$/.test(value))) {
    throw Object.assign(new Error('TRUST_PROXY must contain trusted proxy IP addresses or subnets, not booleans or hop counts'), { configuration: true });
  }
  return {
    secret, clientUrl, trustProxy, maxAge: SESSION_MAX_AGE,
    cookieName: production ? '__Host-inventra.sid' : 'inventra.sid',
    cookie: { httpOnly: true, secure: production, sameSite, path: '/', maxAge: SESSION_MAX_AGE },
  };
}

module.exports = { readAuthConfig, SESSION_MAX_AGE };
