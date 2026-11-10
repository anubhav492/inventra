const express = require("express");
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  archiveProduct,
  restoreProduct,
} = require("../controllers/productController");

const router = express.Router();
const { badRequest } = require('../utils/productValidation');

router.use((req, res, next) => {
  if (Object.hasOwn(req.query, 'user_id') || (req.body && Object.hasOwn(req.body, 'user_id'))) {
    return next(Object.assign(new Error('user_id must not be supplied by the client'), { status: 400 }));
  }
  if (/\/(archive|restore)\/?$/.test(req.path) && req.body !== undefined) {
    try {
      if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object' || Object.keys(req.body).length) badRequest('Archive and restore do not accept request body fields');
    } catch (error) { return next(error); }
  }
  next();
});

router.get("/", getProducts);
router.post("/", createProduct);
router.patch("/:id/archive", archiveProduct);
router.patch("/:id/restore", restoreProduct);
router.patch("/:id", updateProduct);
router.get("/:id", getProduct);

module.exports = router;
