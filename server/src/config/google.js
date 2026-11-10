function readGoogleConfig(env = process.env) {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_CALLBACK_URL: callbackUrl } = env;
  function invalid() { throw Object.assign(new Error('Google sign-in is not configured'), { status: 503 }); }
  if (![clientId, clientSecret, callbackUrl].every(value => typeof value === 'string' && value.trim())) invalid();
  let url;
  try { url = new URL(callbackUrl); } catch { invalid(); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/api/auth/google/callback'
    || (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) invalid();
  return { clientId, clientSecret, callbackUrl: url.href };
}

module.exports = { readGoogleConfig };
