const router = require('express').Router();
const controller = require('../controllers/dashboardController');
router.get('/summary', controller.getSummary);
router.get('/recent-orders', controller.getRecentOrders);
router.get('/low-stock', controller.getLowStock);
router.get('/revenue', controller.getRevenue);
module.exports = router;
