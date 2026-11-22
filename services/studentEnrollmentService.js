import Student from '../models/Student.js';
import { checkFallback } from '../config/db.js';
import { academicError, academicGrade, getAcademicScope } from '../utils/academicScope.js';
import { recordId as rawRecordId } from '../utils/procurementValues.js';
import { getSchool, readProcurement, writeProcurement } from './procurementStore.js';
import { FallbackDb } from './dbFallback.js';
import { curriculumCollections, schoolClassOptions } from './academicSessionService.js';

const idOf = (record) => String(rawRecordId(record) || '');
const enrollmentCollections = [...curriculumCollections, 'students', 'studentSessionHistories', 'classRooms'];

export function studentPlacement(scope, fields) {
  const grade = academicGrade(scope, fields.classId || fields.className || fields.class);
  if (!fields.sectionId) throw academicError('Choose the student’s section.');
  return {
    classId: grade.id, className: grade.name, class: grade.name,
    section: fields.sectionName || fields.section || fields.sectionId,
    sectionName: fields.sectionName || fields.section || fields.sectionId,
    sectionId: String(fields.sectionId),
    sessionId: scope.sessionId, academicYear: scope.session.sessionName,
  };
}

async function confirmActiveSession(store, scope) {
  await store.lockAcademicSettings();
  const session = await store.get('academicSessions', scope.sessionId);
  if (!session?.isCurrent) throw academicError('The active academic session changed. Reload the page.', 409);
  const { classRange, classes } = await schoolClassOptions(store);
  if (!classRange || classes.length !== classRange.classIds.length
    || classes.map((grade) => grade.id).join(',') !== scope.grades.map((grade) => grade.id).join(',')) {
    throw academicError('The curriculum changed. Reload the page.', 409);
  }
}

async function savePlacement(store, scope, student, placement, actor, existing) {
  const studentId = idOf(student);
  const { sessionId, classId, className, sectionId, sectionName } = placement;
  const sessionName = scope.session.sessionName;
  let room = await store.one('classRooms', { sessionId, classId, sectionId });
  if (!room) {
    room = await store.create('classRooms', { sessionId, sessionName, classId, className, sectionId, sectionName, createdBy: actor });
  }
  const classRoomId = idOf(room);
  if (existing?.classRoomId && String(existing.classRoomId) !== classRoomId) {
    const previous = await store.get('classRooms', existing.classRoomId);
    if (previous) {
      const roster = (previous.students || []).filter((member) => String(member) !== studentId);
      await store.update('classRooms', idOf(previous), { students: roster, studentCount: roster.length });
    }
  }
  const students = [...new Set([...(room.students || []).map(String), studentId])];
  await store.update('classRooms', classRoomId, { students, studentCount: students.length });
  const unchanged = existing && String(existing.classId) === classId && String(existing.sectionId) === sectionId;
  let rollNumber = unchanged ? existing.rollNumber : null;
  if (!rollNumber) {
    const classmates = await store.find('students', { sessionId, classId, sectionId });
    rollNumber = Math.max(0, ...classmates.filter((member) => idOf(member) !== studentId).map((member) => Number(member.rollNumber) || 0)) + 1;
  }
  const snapshot = {
    studentId, studentName: student.name, admissionNumber: student.admissionNumber,
    sessionId, sessionName, classId, className, sectionId, sectionName, classRoomId, rollNumber,
  };
  if (existing) {
    await store.update('studentSessionHistories', idOf(existing), snapshot);
  } else {
    await store.create('studentSessionHistories', {
      ...snapshot, enrolledAt: new Date(), enrolledBy: actor, action: 'enrolled', status: 'active',
    });
  }
  return { currentClassRoomId: classRoomId, rollNumber };
}

export async function createEnrolledStudent(req, data) {
  const scope = getAcademicScope();
  if (!scope || !scope.grades.length) {
    return checkFallback() ? FallbackDb.create('students', { ...data, schoolId: getSchool(req) })
      : Student.create({ ...data, schoolId: getSchool(req) });
  }
  if (scope.readOnly) throw academicError('This academic session is read-only.', 409);
  const placement = studentPlacement(scope, data);
  return writeProcurement(req, enrollmentCollections, async (store) => {
    await confirmActiveSession(store, scope);
    if (await store.one('students', { admissionNumber: data.admissionNumber })) {
      throw academicError('The admission number was just assigned to another student. Retry this row.', 409);
    }
    if (data.email && await store.one('students', { email: data.email })) {
      throw academicError('This student email is already registered.', 409);
    }
    const student = await store.create('students', { ...data, ...placement, rollNumber: null });
    const enrollment = await savePlacement(store, scope, student, placement, req.user?.name || 'Administrator');
    return store.update('students', idOf(student), enrollment);
  });
}

export async function updateEnrolledStudent(req, id, changes) {
  const scope = getAcademicScope();
  if (!scope || !scope.grades.length) return null;
  if (scope.readOnly) throw academicError('This academic session is read-only.', 409);
  return writeProcurement(req, enrollmentCollections, async (store) => {
    await confirmActiveSession(store, scope);
    const student = await store.get('students', id);
    if (!student) throw academicError('Student not found.', 404);
    const current = await store.one('studentSessionHistories', { studentId: idOf(student), sessionId: scope.sessionId });
    if (!current || current.status !== 'active') {
      throw academicError('This student has no active enrollment in the selected session.', 409);
    }
    const placement = studentPlacement(scope, {
      classId: changes.classId || changes.className || changes.class || current.classId,
      sectionId: changes.sectionId || current.sectionId,
      sectionName: changes.sectionName || changes.section || current.sectionName,
    });
    const enrollment = await savePlacement(store, scope, { ...student, ...changes }, placement, req.user?.name || 'Administrator', current);
    return store.update('students', idOf(student), { ...changes, ...placement, ...enrollment });
  });
}

export async function scopedStudentRoster(req, { personal = true } = {}) {
  const scope = getAcademicScope();
  if (!scope) return null;
  const store = readProcurement(req);
  const enrollments = scope.legacy ? [] : await store.find('studentSessionHistories', { sessionId: scope.sessionId });
  const byStudent = new Map(enrollments.map((record) => [String(record.studentId), record]));
  let students = checkFallback()
    ? (await store.find('students')).filter((student) => scope.legacy ? !student.sessionId : byStudent.has(idOf(student)))
    : await Student.find({
      schoolId: scope.schoolId,
      ...(scope.legacy ? { sessionId: null } : { _id: { $in: [...byStudent.keys()] } }),
    }).select('-password -tempPassword -otp').lean();
  if (personal && req.user?.role === 'student') {
    const id = String(req.user.profileId || req.user._id || req.user.id);
    students = students.filter((student) => idOf(student) === id || String(student.user || '') === id);
  }
  return students.map((student) => {
    const { password, tempPassword, ...profile } = student;
    const enrollment = byStudent.get(idOf(student));
    if (!enrollment) return profile;
    const { classId, className, sectionId, sectionName, rollNumber, sessionId, sessionName, promotionStatus } = enrollment;
    return {
      ...profile, classId, className, class: className, sectionId, sectionName, section: sectionName,
      rollNumber, sessionId, academicYear: sessionName, currentClassRoomId: enrollment.classRoomId,
      status: promotionStatus === 'passout' ? 'Passout' : scope.readOnly ? 'active' : profile.status,
    };
  });
}

export async function findScopedEnrollment(req, studentId) {
  const scope = getAcademicScope();
  if (!scope || scope.legacy) return null;
  return readProcurement(req).one('studentSessionHistories', { studentId: String(studentId), sessionId: scope.sessionId });
}
