const router = require('express').Router();
const controller = require('../controllers/orderController');
router.get('/', controller.getOrders);
router.post('/', controller.createOrder);
router.get('/:id', controller.getOrder);
router.patch('/:id/complete', controller.completeOrder);
router.patch('/:id/cancel', controller.cancelOrder);
module.exports = router;
