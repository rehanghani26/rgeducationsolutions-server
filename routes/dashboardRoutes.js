import express from 'express';
import { getStats, getCharts } from '../controllers/dashboardController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/stats', protect, getStats);
router.get('/charts', protect, getCharts);

export default router;
