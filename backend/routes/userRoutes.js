const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticateToken, isAdminOrManager } = require('../middleware/authMiddleware'); // 

// ========== ROUTE VERIFY (admin + manager) ==========
router.get('/verify', authenticateToken, isAdminOrManager, userController.verifyUser);

// ========== ROUTES ADMIN + MANAGER ==========
router.use(authenticateToken);
router.use(isAdminOrManager); //  bdel isAdmin

router.get('/', userController.getAllUsers);
router.get('/stats', userController.getUserStats);
router.put('/bloquer/:id', userController.bloquerUser);
router.put('/debloquer/:id', userController.debloquerUser);
router.post('/update-statuses', userController.updateAllStatuses);
router.post('/', userController.addUser);
router.delete('/:id', userController.deleteUser);

module.exports = router;