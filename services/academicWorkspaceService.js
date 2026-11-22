import { randomUUID } from 'node:crypto';
import { academicError } from '../utils/academicScope.js';
import { cleanText } from '../utils/procurementValues.js';
import {
  academicsScope, canManageAcademics, checkRevision, idOf, isFaculty,
  linkedStudents, requireAcademicAccess, roleOf, teacherForAccount, writeAcademics,
} from './academicsAccess.js';
import { publishedSyllabus, requireTitle } from './classSyllabusService.js';
import { orderedGrades } from './academicSessionService.js';
import { readProcurement } from './procurementStore.js';

const teacherName = (teacher) => teacher?.name || [teacher?.firstName, teacher?.lastName].filter(Boolean).join(' ');
const versioned = (row) => Boolean(row.classRoomId && row.subjectId);
const roomSummary = ({ _id, id, classId, className, sectionId, sectionName, classTeacherId, classTeacherName, timetableId, studentCount, status }) => ({
  id: idOf(_id || id), classId, className, sectionId, sectionName, classTeacherId: idOf(classTeacherId),
  classTeacherName, timetableId: idOf(timetableId), studentCount: studentCount || 0, status,
});

export async function readAcademicWorkspace(req) {
  const manage = canManageAcademics(req);
  requireAcademicAccess(manage || isFaculty(req));
  const scope = academicsScope({ allowLegacy: true });
  const store = readProcurement(req);
  if (scope.legacy) {
    requireAcademicAccess(manage);
    const [syllabus, courses] = await Promise.all([
      store.find('syllabus', { sessionId: null }), store.find('curriculums', { sessionId: null }),
    ]);
    return {
      legacy: true, readOnly: true,
      legacySyllabus: syllabus.map((item) => ({
        id: idOf(item), className: item.className, academicYear: item.academicYear, subjectCount: item.subjects?.length || 0,
      })),
      legacyCourses: courses.map((item) => ({
        id: idOf(item), className: item.className, sectionName: item.sectionName, name: item.name, code: item.code,
      })),
    };
  }
  const teacher = isFaculty(req) ? await teacherForAccount(store, req) : null;
  const teacherId = idOf(teacher);
  const match = { sessionId: scope.sessionId };
  const [rooms, courses, plans, subjects, teachers, classMaster] = await Promise.all([
    store.find('classRooms', match), store.find('curriculums', match), store.find('syllabus', match),
    manage ? store.find('subjects') : [],
    manage ? store.find('teachers') : [],
    manage ? orderedGrades(store) : [],
  ]);
  const activeCourses = courses.filter(versioned);
  const visibleRoomIds = new Set(teacherId
    ? activeCourses.filter((course) => idOf(course.teacherId) === teacherId).map((course) => idOf(course.classRoomId))
    : []);
  const visibleRooms = rooms.filter((room) => manage || (teacherId && (
    idOf(room.classTeacherId) === teacherId || visibleRoomIds.has(idOf(room))
  )));
  return {
    manage, readOnly: scope.readOnly, teacherId, sessionName: scope.session.sessionName,
    classMaster: classMaster.map(({ id, name, code, sortOrder, virtual }) => ({ id, name, code, sortOrder, virtual })),
    rooms: visibleRooms.map((room) => ({
      ...roomSummary(room),
      ...(manage && { openRequests: activeCourses.filter((course) =>
        idOf(course.classRoomId) === idOf(room) && course.changeRequest?.note && !course.changeRequest.resolvedAt).length }),
    })),
    classes: manage ? scope.grades.map(({ id, name, code }) => {
      const plan = plans.find((row) => idOf(row.classId) === id);
      return {
        id, name, code, status: plan?.status || (plan ? 'legacy' : 'unplanned'),
        version: plan?.published?.version || 0, subjectCount: plan?.published?.subjects?.length || 0,
      };
    }) : [],
    subjects: subjects.map((row) => ({ id: idOf(row), name: row.name, code: row.code, type: row.type })),
    teachers: teachers.filter((row) => row.status !== 'inactive').map((row) => ({
      id: idOf(row), name: teacherName(row), employeeId: row.employeeId,
    })),
    legacyCourses: manage ? courses.filter((row) => !versioned(row)).map((row) => ({
      id: idOf(row), className: row.className, sectionName: row.sectionName, name: row.name, code: row.code,
    })) : [],
  };
}

async function readRoom(store, scope, roomId) {
  const room = await store.get('classRooms', roomId);
  if (!room || idOf(room.sessionId) !== scope.sessionId) {
    throw academicError('Classroom not found in the selected session.', 404);
  }
  return room;
}

async function classroomTimetable(store, scope, room) {
  if (!room) return [];
  const linked = await store.get('classTimetables', room.timetableId);
  const matches = (timetable) => timetable && idOf(timetable.sessionId) === scope.sessionId &&
    timetable.scheduleType !== 'exam' && (idOf(timetable.classRoomId) === idOf(room) ||
      (!timetable.classRoomId && timetable.classId === room.classId && timetable.sectionId === room.sectionId));
  if (matches(linked)) return linked.allocations || [];
  const match = { sessionId: scope.sessionId, classId: room.classId, sectionId: room.sectionId };
  const timetables = (await store.find('classTimetables', match)).filter(matches);
  const exact = timetables.find((row) => idOf(row.classRoomId) === idOf(room));
  return (exact || (timetables.length === 1 ? timetables[0] : null))?.allocations || [];
}

function courseSummary(subject, course, teacher, { editable = false, privateDetails = false } = {}) {
  const chapters = subject.chapters || [];
  const chapterIds = new Set(chapters.map(({ id }) => id));
  const chapterProgress = (course?.chapterProgress || []).filter((row) => chapterIds.has(row.chapterId));
  return {
    ...subject,
    teacherId: idOf(course?.teacherId),
    teacherName: teacherName(teacher),
    revision: course?.revision || 0,
    editable, chapterProgress,
    completed: chapterProgress.filter((row) => row.status === 'completed').length,
    ...(privateDetails && course?.changeRequest?.note ? { changeRequest: course.changeRequest } : {}),
    resources: (course?.resources || []).filter((row) =>
      (privateDetails || row.shared) && (!row.chapterId || chapterIds.has(row.chapterId))),
  };
}

export async function readClassroomAcademics(req, roomId) {
  const manage = canManageAcademics(req);
  requireAcademicAccess(manage || isFaculty(req));
  const scope = academicsScope();
  const store = readProcurement(req);
  const room = await readRoom(store, scope, roomId);
  const [teacher, courses, plan, teachers, timetable] = await Promise.all([
    isFaculty(req) ? teacherForAccount(store, req) : null,
    store.find('curriculums', { sessionId: scope.sessionId, classRoomId: roomId }),
    store.one('syllabus', { sessionId: scope.sessionId, classId: room.classId }),
    store.find('teachers'), classroomTimetable(store, scope, room),
  ]);
  const teacherId = idOf(teacher);
  const overview = manage || (teacherId && teacherId === idOf(room.classTeacherId));
  const ownCourses = courses.filter((entry) => teacherId && idOf(entry.teacherId) === teacherId);
  requireAcademicAccess(overview || ownCourses.length > 0);
  const teachersById = new Map(teachers.map((row) => [idOf(row), row]));
  const syllabus = publishedSyllabus(plan);
  const subjects = (syllabus?.subjects || []).flatMap((subject) => {
    const course = courses.find((entry) => entry.subjectId === subject.subjectId);
    const owns = Boolean(teacherId && idOf(course?.teacherId) === teacherId);
    if (!overview && !owns) return [];
    return [courseSummary(subject, course, teachersById.get(idOf(course?.teacherId)), {
      editable: !scope.readOnly && room.status !== 'archived' && (manage || owns),
      privateDetails: manage || owns,
    })];
  });
  return {
    room: roomSummary(room), syllabusVersion: syllabus?.version || 0, subjects, timetable,
    canAssign: manage && !scope.readOnly && room.status !== 'archived',
  };
}

function normalizeDelivery(body, subject) {
  if (!Array.isArray(body.chapterProgress) || !Array.isArray(body.resources) || body.resources.length > 100) {
    throw academicError('Check the chapter progress and resources.');
  }
  const chapters = new Set((subject.chapters || []).map(({ id }) => id));
  const updated = new Set();
  const chapterProgress = body.chapterProgress.map((row) => {
    if (!chapters.has(row?.chapterId) || updated.has(row.chapterId)
      || !['upcoming', 'in-progress', 'completed'].includes(row.status)) {
      throw academicError('Choose a published chapter and a valid status.');
    }
    updated.add(row.chapterId);
    const plannedDate = cleanText(row.plannedDate);
    if (plannedDate && (!/^\d{4}-\d{2}-\d{2}$/.test(plannedDate)
      || !Number.isFinite(Date.parse(plannedDate))
      || new Date(plannedDate).toISOString().slice(0, 10) !== plannedDate)) {
      throw academicError('Enter a valid planned date.');
    }
    return { chapterId: row.chapterId, status: row.status, plannedDate };
  });
  const resourceIds = new Set();
  const resources = body.resources.map((row) => {
    const url = cleanText(row?.url);
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw academicError('Enter a valid resource link.');
    }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || url.length > 2048) {
      throw academicError('Resource links must use HTTP or HTTPS.');
    }
    const chapterId = cleanText(row.chapterId);
    if (chapterId && !chapters.has(chapterId)) throw academicError('Choose a published chapter for the resource.');
    const id = cleanText(row.id) || randomUUID();
    if (!/^[a-z0-9-]{1,64}$/i.test(id) || resourceIds.has(id)) throw academicError('Each resource needs a unique reference.');
    resourceIds.add(id);
    return { id, title: requireTitle(row.title, 'Resource title'), url, chapterId, shared: row.shared === true };
  });
  return { chapterProgress, resources };
}

export async function updateClassroomSubject(req, roomId, subjectId, action) {
  const manage = canManageAcademics(req);
  requireAcademicAccess(manage || (['delivery', 'request'].includes(action) && isFaculty(req)));
  const scope = academicsScope();
  const { revision } = req.body;
  return writeAcademics(req, scope, ['classRooms', 'syllabus', 'curriculums', 'teachers'], async (store) => {
    const room = await readRoom(store, scope, roomId);
    if (room.status === 'archived') throw academicError('This classroom is archived.', 409);
    const course = await store.one('curriculums', { sessionId: scope.sessionId, classRoomId: roomId, subjectId });
    const teacher = isFaculty(req) ? await teacherForAccount(store, req) : null;
    requireAcademicAccess(manage || (teacher && idOf(course?.teacherId) === idOf(teacher)));
    checkRevision(course, revision);
    const plan = await store.one('syllabus', { sessionId: scope.sessionId, classId: room.classId });
    const subject = plan?.published?.subjects?.find((row) => row.subjectId === subjectId);
    if (!subject || plan.published.version !== req.body.syllabusVersion) {
      throw academicError('The published syllabus changed. Reload this classroom and try again.', 409);
    }
    let changes;
    if (action === 'assignment') {
      const teacherId = cleanText(req.body.teacherId);
      const assignee = teacherId ? await store.get('teachers', teacherId) : null;
      if (teacherId && (!assignee || assignee.status === 'inactive')) throw academicError('Choose an active teacher from this school.');
      changes = { teacherId };
    } else if (action === 'request') {
      if (course?.changeRequest?.note && !course.changeRequest.resolvedAt) {
        throw academicError('A change request is already open for this subject.', 409);
      }
      changes = { changeRequest: { note: requireTitle(req.body.note, 'Requested change', 800),
        requestedBy: idOf(teacher || req.user), requestedAt: new Date() } };
    } else if (action === 'resolve') {
      if (!course?.changeRequest?.note) throw academicError('No change request is open.', 409);
      changes = { changeRequest: { ...course.changeRequest, resolvedAt: new Date() } };
    } else {
      changes = normalizeDelivery(req.body, subject);
    }
    const data = { ...changes, revision: revision + 1 };
    if (course) return store.update('curriculums', idOf(course), data);
    return store.create('curriculums', {
      ...data, sessionId: scope.sessionId, classId: room.classId, className: room.className,
      sectionName: room.sectionName, classRoomId: roomId, subjectId,
    });
  });
}

export async function readPersonalAcademics(req) {
  requireAcademicAccess(['student', 'parent'].includes(roleOf(req)));
  const scope = academicsScope();
  const store = readProcurement(req);
  const linked = await linkedStudents(store, req);
  const students = linked.map((student) => ({ id: idOf(student), name: student.name }));
  const requestedId = req.query.studentId;
  const student = requestedId ? students.find(({ id }) => id === requestedId) : students[0];
  if (requestedId) requireAcademicAccess(Boolean(student));
  const response = { students, student, sessionName: scope.session.sessionName };
  if (!student) return response;
  const match = { sessionId: scope.sessionId, studentId: student.id };
  const enrollment = await store.one('studentSessionHistories', match);
  if (!enrollment) return response;
  const grade = scope.grades.find(({ id }) => id === idOf(enrollment.classId));
  const room = enrollment.classRoomId ? await store.get('classRooms', enrollment.classRoomId) : null;
  const classroom = room && idOf(room.sessionId) === scope.sessionId && room.classId === enrollment.classId
    && room.sectionId === enrollment.sectionId ? room : null;
  const [plan, courses, timetable, results] = await Promise.all([
    grade ? store.one('syllabus', { sessionId: scope.sessionId, classId: grade.id }) : null,
    classroom ? store.find('curriculums', { sessionId: scope.sessionId, classRoomId: idOf(classroom) }) : [],
    classroomTimetable(store, scope, classroom),
    store.find('results', { ...match, status: 'published' }),
  ]);
  const syllabus = publishedSyllabus(plan);
  const teachers = await store.byIds('teachers', [...new Set(courses.map((row) => idOf(row.teacherId)).filter(Boolean))]);
  const bookIds = (syllabus?.subjects || []).flatMap((subject) => (subject.books || []).map((book) => book.catalogBookId).filter(Boolean));
  const catalog = await store.byIds('books', [...new Set(bookIds)]);
  const subjects = (syllabus?.subjects || []).map((subject) => {
    const course = courses.find((row) => row.subjectId === subject.subjectId);
    const summary = courseSummary(subject, course, teachers.find((row) => idOf(row) === idOf(course?.teacherId)));
    delete summary.revision;
    delete summary.teacherId;
    return {
      ...summary, chapterProgress: summary.chapterProgress.map(({ chapterId, status }) => ({ chapterId, status })),
      books: (summary.books || []).map((book) => {
        const entry = catalog.find((row) => idOf(row) === book.catalogBookId);
        return { ...book, availableCopies: entry ? Math.max(0, (entry.totalQty || 0) - (entry.issuedQty || 0)) : null };
      }),
    };
  });
  return {
    ...response, enrollment: {
      className: enrollment.className, sectionName: enrollment.sectionName, rollNumber: enrollment.rollNumber,
      classTeacherName: classroom?.classTeacherName || enrollment.classTeacherName,
    },
    syllabusVersion: syllabus?.version || 0, subjects, timetable,
    results: results.map(({ examName, examTerm, marks, totalObtained, totalMaxMarks, grade: resultGrade, publishedAt }) => ({
      examName, examTerm, marks, totalObtained, totalMaxMarks, grade: resultGrade, publishedAt,
    })).sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)),
  };
}
