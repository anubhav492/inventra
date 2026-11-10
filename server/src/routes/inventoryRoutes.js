const router = require('express').Router();
const controller = require('../controllers/inventoryController');
router.get('/', controller.getInventory);
router.get('/alerts', controller.getAlerts);
router.get('/movements', controller.getMovements);
router.post('/:productId/restock', controller.restock);
router.post('/:productId/adjust', controller.adjust);
module.exports = router;
