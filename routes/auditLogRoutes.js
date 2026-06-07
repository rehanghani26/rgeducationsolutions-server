import express from 'express';
import { getLogs, getLoginHistory, getRecordActivity } from '../controllers/auditLogController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

router.get('/', protect, authorize('super-admin', 'school-admin', 'principal'), getLogs);
router.get('/login/:userId', protect, authorize('super-admin', 'school-admin', 'principal'), getLoginHistory);
router.get('/:module/:recordId', protect, getRecordActivity);

export default router;
