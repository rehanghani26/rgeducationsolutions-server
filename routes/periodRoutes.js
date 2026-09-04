import express from 'express';
import {
  getMasterPeriods,
  getMasterPeriodById,
  createMasterPeriod,
  updateMasterPeriod,
  deleteMasterPeriod,
  getClassTimetable,
  saveClassTimetable,
  deleteClassTimetable,
} from '../controllers/masterPeriodController.js';
import { protect } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

const router = express.Router();

const adminOnly = authorize('super-admin', 'school-admin', 'principal');

// Timetable endpoints (Must be before /:id)
router.get('/timetable', protect, getClassTimetable);
router.post('/timetable', protect, adminOnly, saveClassTimetable);
router.delete('/timetable/:id', protect, adminOnly, deleteClassTimetable);

// GET /api/periods          – list all schedules  (optionally ?type=regular|exam)
// GET /api/periods/:id      – get single schedule
// POST /api/periods         – create new schedule
// PUT /api/periods/:id      – update / replace periods
// DELETE /api/periods/:id   – delete schedule

router.get('/',      protect, getMasterPeriods);
router.get('/:id',   protect, getMasterPeriodById);
router.post('/',     protect, adminOnly, createMasterPeriod);
router.put('/:id',   protect, adminOnly, updateMasterPeriod);
router.delete('/:id',protect, adminOnly, deleteMasterPeriod);

export default router;
