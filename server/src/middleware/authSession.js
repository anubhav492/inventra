const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const pool = require('../config/db');
const { readAuthConfig } = require('../config/auth');

function sessionUnavailable(error) {
  // Do not expose store SQL, connection details or session identifiers.
  console.error('Session operation failed:', { code: error.code || error.name });
  return Object.assign(new Error('Authentication temporarily unavailable'), { status: 503 });
}

function createAuthSession(config, store) {
  const middleware = session({
    name: config.cookieName,
    secret: config.secret,
    store: store || new PgStore({
      pool, schemaName: 'public', tableName: 'session', createTableIfMissing: false,
      disableTouch: true, ttl: config.maxAge / 1000,
      errorLog: error => console.error('Session store error:', { code: error.code || error.name }),
    }),
    resave: false, saveUninitialized: false, rolling: false,
    cookie: config.cookie,
  });
  return (req, res, next) => middleware(req, res, error => next(error ? sessionUnavailable(error) : undefined));
}

function clearSessionCookie(res, config) {
  const { maxAge, ...options } = config.cookie;
  res.clearCookie(config.cookieName, options);
}

// One context per app shares the same cookie policy and store across auth and
// business routers. Construction performs no database work.
function createSessionContext({ config, store } = {}) {
  let middleware;
  function getConfig() { return config || (config = readAuthConfig()); }
  return {
    getConfig,
    middleware(req, res, next) {
      const settings = getConfig();
      if (!middleware) {
        if (settings.trustProxy) req.app.set('trust proxy', settings.trustProxy);
        middleware = createAuthSession(settings, store);
      }
      res.set('Cache-Control', 'no-store');
      if (settings.cookie.secure && !req.secure) {
        return res.status(400).json({ success: false, message: 'HTTPS is required for authentication' });
      }
      req.clearAuthCookie = () => clearSessionCookie(res, settings);
      return middleware(req, res, next);
    },
  };
}

async function sessionOperation(req, operation) {
  try {
    await new Promise((resolve, reject) => req.session[operation](error => error ? reject(error) : resolve()));
  } catch (error) {
    // Prevent express-session from automatically retrying a failed save on response.
    req.session = null;
    const unavailable = sessionUnavailable(error);
    unavailable.sessionOperation = operation;
    throw unavailable;
  }
}

module.exports = { createAuthSession, createSessionContext, clearSessionCookie, sessionOperation };
