import express from 'express';
import { protect } from '../middleware/auth.js';
import { sendSuccess } from '../utils/responseUtil.js';
import { sendProcurementError } from '../utils/procurementValues.js';
import {
  changeSyllabusStatus, copyPublishedSyllabus, readPublishedSyllabuses, readSyllabusDraft, saveSyllabusDraft,
} from '../services/classSyllabusService.js';
import {
  readAcademicWorkspace, readClassroomAcademics, readPersonalAcademics, updateClassroomSubject,
} from '../services/academicWorkspaceService.js';

const router = express.Router();
const handle = (work) => async (req, res) => {
  try {
    return sendSuccess(res, undefined, await work(req));
  } catch (error) {
    return sendProcurementError(res, error);
  }
};

router.use(protect);
router.get('/workspace', handle(readAcademicWorkspace));
router.get('/mine', handle(readPersonalAcademics));
router.get('/classrooms/:roomId', handle((req) => readClassroomAcademics(req, req.params.roomId)));
router.put('/classrooms/:roomId/subjects/:subjectId/assignment', handle((req) =>
  updateClassroomSubject(req, req.params.roomId, req.params.subjectId, 'assignment')));
router.put('/classrooms/:roomId/subjects/:subjectId/delivery', handle((req) =>
  updateClassroomSubject(req, req.params.roomId, req.params.subjectId, 'delivery')));
router.post('/classrooms/:roomId/subjects/:subjectId/request', handle((req) =>
  updateClassroomSubject(req, req.params.roomId, req.params.subjectId, 'request')));
router.post('/classrooms/:roomId/subjects/:subjectId/resolve', handle((req) =>
  updateClassroomSubject(req, req.params.roomId, req.params.subjectId, 'resolve')));
router.get('/', handle((req) => readPublishedSyllabuses(req)));
router.get('/:classId/draft', handle((req) => readSyllabusDraft(req, req.params.classId)));
router.get('/:classId/copy', handle((req) => copyPublishedSyllabus(req, req.params.classId)));
router.put('/:classId', handle((req) => saveSyllabusDraft(req, req.params.classId)));
router.post('/:classId/status', handle((req) => changeSyllabusStatus(req, req.params.classId)));
router.get('/:classId', handle((req) => readPublishedSyllabuses(req, req.params.classId)));

export default router;
