const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createSessionContext } = require('../middleware/authSession');
const authOrigin = require('../middleware/authOrigin');
const requireAuth = require('../middleware/requireAuth');
const controller = require('../controllers/authController');
const { createGoogleController } = require('../controllers/googleController');

function createAuthRouter({ config, store, sessionContext = createSessionContext({ config, store }), googleProvider } = {}) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Limit before store access and expensive password hashing. Per-process, per-IP.
  const limiter = limit => rateLimit({
    windowMs: 15 * 60 * 1000, limit, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { success: false, message: 'Too many authentication requests. Please try again later.' },
  });
  router.use(limiter(120));
  router.use((req, res, next) => authOrigin(sessionContext.getConfig().clientUrl)(req, res, next));
  router.use(['/register', '/login'], limiter(10));
  router.use('/google', limiter(20));
  router.use('/google', (req, res, next) => { res.set('Referrer-Policy', 'no-referrer'); next(); });
  router.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ success: false, message: 'Content-Type must be application/json' });
    }
    next();
  });
  router.use(sessionContext.middleware);
  const google = createGoogleController({ sessionContext, provider: googleProvider });
  router.get('/google', google.begin);
  router.get('/google/callback', google.callback);
  router.post('/register', controller.register);
  router.post('/login', controller.login);
  router.get('/me', requireAuth, controller.me);
  router.post('/logout', controller.logout);
  return router;
}

module.exports = { createAuthRouter };
