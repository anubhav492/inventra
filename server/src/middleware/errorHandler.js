const { isDatabaseUnavailable } = require('../utils/databaseErrors');

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  console.error('API error:', { code: err.code || err.type || err.name, method: req.method });
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Request body must contain valid JSON' });
  }
  const productsRequest = /^\/api\/products(?:[/?]|$)/i.test(req.originalUrl || req.url || '');
  if (['40P01', '40001'].includes(err.code)) {
    return res.status(409).json({ success: false, message: 'Request conflicted with another operation. Please retry.' });
  }

  if (err.code === "23505") {
    return res.status(409).json({
      success: false,
      message: productsRequest ? "A product with this SKU already exists" : 'Request conflicts with an existing record',
    });
  }

  if (err.code === "23503") {
    return res.status(400).json({
      success: false,
      message: productsRequest ? "Invalid product or user reference" : 'Invalid related record',
    });
  }

  if (isDatabaseUnavailable(err)) {
    return res.status(503).json({
      success: false,
      message: "Database temporarily unavailable",
    });
  }

  if (['23514', '22003', '22P02'].includes(err.code)) {
    return res.status(400).json({ success: false, message: productsRequest ? 'Product values do not meet database constraints' : 'Request values do not meet database constraints' });
  }
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status <= 599 ? err.status : 500;
  const message =
    status >= 400 && status < 500 && err.message
      ? err.message
      : "Internal server error";

  return res.status(status).json({ success: false, message });
}

module.exports = errorHandler;
