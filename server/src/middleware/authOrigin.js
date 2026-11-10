function authOrigin(clientUrl) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    // Fail closed even when Origin is missing (including native API clients).
    // This also prevents login CSRF before there is an authenticated session.
    if (req.get('Origin') !== clientUrl) {
      return res.status(403).json({ success: false, message: 'Request origin is not allowed' });
    }
    next();
  };
}

module.exports = authOrigin;
