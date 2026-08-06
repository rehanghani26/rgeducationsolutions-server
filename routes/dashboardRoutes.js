import express from 'express';
import { getStats, getCharts, getStudentsAnalytics } from '../controllers/dashboardController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/stats', protect, getStats);
router.get('/charts', protect, getCharts);
router.get('/students-analytics', protect, getStudentsAnalytics);

export default router;
