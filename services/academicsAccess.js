import { academicError, getAcademicScope } from '../utils/academicScope.js';
import { cleanText, recordId } from '../utils/procurementValues.js';
import { writeProcurement } from './procurementStore.js';

const managers = new Set(['super-admin', 'superadmin', 'school-admin', 'admin', 'principal', 'director']);
const faculty = new Set(['teacher', 'head-teacher', 'hod', 'coordinator']);

export const idOf = (value) => String(value?.toHexString?.() || recordId(value) || value || '');
export const roleOf = (req) => cleanText(req.user?.role).toLowerCase().replaceAll('_', '-');
export const canManageAcademics = (req) => managers.has(roleOf(req));
export const isFaculty = (req) => faculty.has(roleOf(req));

export function academicsScope({ allowLegacy = false } = {}) {
  const scope = getAcademicScope();
  if (!scope || (scope.legacy && !allowLegacy)) {
    throw academicError('Choose a configured academic session.', 409);
  }
  return scope;
}

export function requireAcademicAccess(allowed) {
  if (!allowed) throw academicError('You do not have access to this academic record.', 403);
}

export function checkRevision(record, revision) {
  if (!Number.isInteger(revision) || revision !== (record?.revision ?? 0)) {
    throw academicError('This record changed since you opened it. Reload to get the latest version.', 409);
  }
}

export function writeAcademics(req, scope, collections, work) {
  if (scope.readOnly) throw academicError('This academic session is read-only.', 409);
  return writeProcurement(req, [...new Set(['academicSessions', ...collections])], async (store) => {
    await store.lockAcademicSettings();
    const session = await store.get('academicSessions', scope.sessionId);
    if (!session?.isCurrent) throw academicError('This academic session is read-only.', 409);
    return work(store);
  });
}

export async function teacherForAccount(store, req) {
  const userId = idOf(req.user?.userId || req.user);
  if (!userId) return null;
  const profile = req.user?.profileId ? await store.get('teachers', req.user.profileId) : null;
  const teacher = profile && (!profile.user || idOf(profile.user) === userId)
    ? profile : await store.one('teachers', { user: userId });
  return teacher?.status !== 'inactive' ? teacher : null;
}

export async function linkedStudents(store, req) {
  const userId = idOf(req.user?.userId || req.user);
  if (!userId) return [];
  if (roleOf(req) === 'student') {
    const student = await store.get('students', req.user?.profileId || userId);
    return student ? [student] : [];
  }
  if (roleOf(req) === 'parent') {
    const parent = await store.one('parents', { user: userId });
    return parent && parent.status !== 'inactive' ? store.byIds('students', parent.children || []) : [];
  }
  return [];
}
