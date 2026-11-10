const pool = require('../config/db');
const { UUID_PATTERN } = require('../utils/productValidation');
const { SESSION_MAX_AGE } = require('../config/auth');
const { sessionOperation } = require('./authSession');

// Mount after createAuthSession; mount authOrigin before any unsafe cookie-auth routes.
async function requireAuth(req, res, next) {
  try {
    const { userId, authenticatedAt } = req.session || {};
    if (!UUID_PATTERN.test(userId || '') || !Number.isSafeInteger(authenticatedAt)
      || authenticatedAt > Date.now() || Date.now() - authenticatedAt >= SESSION_MAX_AGE) {
      // Anonymous requests have a fresh, unsaved session: do not write a random
      // DELETE to PostgreSQL just to reject them.
      if (req.session && (userId !== undefined || authenticatedAt !== undefined)) await sessionOperation(req, 'destroy');
      else req.session = null;
      req.clearAuthCookie?.();
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const result = await pool.query('SELECT id, name, email FROM public.users WHERE id = $1', [userId]);
    if (!result.rowCount) {
      await sessionOperation(req, 'destroy');
      req.clearAuthCookie?.();
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    const { id, name, email } = result.rows[0];
    req.user = { id, name, email };
    next();
  } catch (error) { next(error); }
}

module.exports = requireAuth;
