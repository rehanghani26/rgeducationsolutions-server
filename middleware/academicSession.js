import { academicError } from '../utils/academicScope.js';
import { activeAcademicSession, schoolClassOptions } from '../services/academicSessionService.js';
import { getSchool, readProcurement } from '../services/procurementStore.js';

const modulePaths = /^\/(?:attendance|students|classes|exams|results|homework|online-classes|syllabus|periods|leaves|notices|finance|inventory|budget|payroll|dashboard|reports|ai|documents\/certificates|erp\/(?:classes|curriculum|library|transport|hostel|reports|notifications|notices|leaves|my|all|applicant|request|review))(?:\/|$)/;
const teacherReads = /^\/teachers(?:\/[^/]+|\/export\/csv)?\/?$/;
const adminRoles = new Set(['super-admin', 'superadmin', 'school-admin', 'admin', 'principal']);

export async function resolveAcademicScope(req) {
  const path = (req.originalUrl || req.url || '').split('?')[0].replace(/^\/api(?:\/v1)?(?=\/)/, '');
  const teacherRead = ['GET', 'HEAD'].includes(req.method) && teacherReads.test(path);
  if (!modulePaths.test(path) && !teacherRead) return null;
  const explicit = /^\/classes\/session\/([^/]+)$/.exec(path)?.[1] || req.query?.sessionId;
  if (explicit !== undefined && typeof explicit !== 'string') throw academicError('Choose a valid academic session.');
  const schoolId = getSchool(req);
  if (explicit === 'legacy') {
    if (!adminRoles.has(String(req.user?.role || '').toLowerCase().replaceAll('_', '-'))) {
      throw academicError('Only school administrators can view unassigned records.', 403);
    }
    return { schoolId, legacy: true, readOnly: true, sessionId: '', grades: [] };
  }
  const store = readProcurement(req);
  const session = explicit ? await store.get('academicSessions', explicit) : await activeAcademicSession(store);
  if (!session && explicit) throw academicError('Academic session not found.', 404);
  if (!session) return null;
  const { classRange, classes: grades } = await schoolClassOptions(store);
  if (!classRange && !explicit && path !== '/syllabus/workspace') return null;
  const sessionId = String(session._id || session.id);
  req.academicSession = session;
  req.academicSessionId = sessionId;
  const readOnly = !session.isCurrent;
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && path !== '/ai/chat';
  if (readOnly && mutation) {
    throw academicError('Select the active academic session to make changes.', 409);
  }
  if (mutation && classRange && grades.length !== classRange.classIds.length) {
    throw academicError('A class in the school range is missing from Class Master.', 409);
  }
  if (!readOnly && req.body?.sessionId && String(req.body.sessionId) !== sessionId) {
    throw academicError('The request belongs to a different academic session.', 409);
  }
  return { schoolId, sessionId, session, grades, readOnly };
}

