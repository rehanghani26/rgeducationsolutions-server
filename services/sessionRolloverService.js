import { createHash } from 'node:crypto';
import { checkFallback } from '../config/db.js';
import AcademicSession from '../models/AcademicSession.js';
import School from '../models/School.js';
import { gradeByValue } from '../utils/academicClass.js';
import { addSessionDays, defaultSessionEnd, schoolClock, sessionDay } from '../utils/academicDates.js';
import { procurementError, recordId as rawRecordId } from '../utils/procurementValues.js';
import tenantContext from '../utils/tenantContext.js';
import {
  isConfiguredSession, readRolloverSettings, sessionCollections, sessionGrades, validateSessionWindow,
} from './academicSessionService.js';
import { readProcurement, writeProcurement } from './procurementStore.js';
import { FallbackDb } from './dbFallback.js';

const rolloverCollections = [...sessionCollections, 'sessionRollovers', 'studentSessionHistories', 'students', 'classRooms'];
const recordId = (record) => String(rawRecordId(record) || '');
const placementsKey = (classId, sectionId) => String(classId) + '/' + String(sectionId);
const same = (a, b) => String(a ?? '') === String(b ?? '');
const mongoUnavailable = () => checkFallback() && Boolean(process.env.MONGODB_URI?.trim());

async function updateExecution(store, sourceSessionId, fields) {
  const run = await store.one('sessionRollovers', { sourceSessionId });
  if (run?.status === 'completed') return run;
  return run
    ? store.update('sessionRollovers', recordId(run), fields)
    : store.create('sessionRollovers', { sourceSessionId, ...fields });
}

async function findSuccessor(store, source) {
  const sourceId = recordId(source);
  const nextDay = addSessionDays(sessionDay(source.endDate), 1);
  const sessions = await store.find('academicSessions');
  const linked = sessions.find((candidate) => same(candidate.previousSessionId, sourceId));
  if (linked) {
    if (linked.status !== 'upcoming' || sessionDay(linked.startDate) < nextDay) {
      throw procurementError('The linked successor must be upcoming and start after the closing session.', 409);
    }
    return linked;
  }
  return sessions.find((candidate) =>
    candidate.status === 'upcoming' && !candidate.previousSessionId && sessionDay(candidate.startDate) === nextDay
  );
}

async function prepareSuccessor(store, source, settings, now) {
  const sourceId = recordId(source);
  const existing = await findSuccessor(store, source);
  const clock = schoolClock(now, settings.timeZone);
  const finalDay = sessionDay(source.endDate);
  const due = clock.day > finalDay || (clock.day === finalDay && clock.time >= settings.prepareTime);
  if (existing) {
    if (!due || same(existing.previousSessionId, sourceId)) return existing;
    return store.update('academicSessions', recordId(existing), { previousSessionId: sourceId });
  }
  if (!due) return null;
  const startDate = addSessionDays(finalDay, 1);
  const endDate = defaultSessionEnd(startDate);
  const startYear = Number(startDate.slice(0, 4));
  const fields = {
    sessionName: String(startYear) + '-' + (startYear + 1),
    startDate,
    endDate,
    status: 'upcoming',
    isCurrent: false,
    previousSessionId: sourceId,
    startClassId: source.startClassId,
    endClassId: source.endClassId,
    classIds: source.classIds,
    setupConfirmedAt: now,
    createdBy: 'Academic rollover',
  };
  await validateSessionWindow(store, fields);
  return store.create('academicSessions', fields);
}

async function buildPlan(store, source, target) {
  const catalog = await sessionGrades(store, source);
  const targetCatalog = await sessionGrades(store, target);
  if (catalog.length !== source.classIds.length || targetCatalog.length !== target.classIds.length) {
    throw procurementError('A saved curriculum class is missing from the Class Master.', 409);
  }
  const enrollments = await store.find('studentSessionHistories', { sessionId: recordId(source), status: 'active' });
  const targetEnrollments = await store.find('studentSessionHistories', { sessionId: recordId(target) });
  const students = await store.find('students', { status: 'active' });
  const activeById = new Map(students.map((student) => [recordId(student), student]));
  const existingById = new Map(targetEnrollments.map((enrollment) => [String(enrollment.studentId), enrollment]));
  const sourceIds = new Set(enrollments.map((enrollment) => String(enrollment.studentId)));
  const issues = students.filter((student) => !sourceIds.has(recordId(student)) &&
    (same(student.sessionId, recordId(source)) || (!student.sessionId && student.academicYear === source.sessionName))
  ).map((student) => ({ studentId: recordId(student), name: student.name, reason: 'Missing enrollment in the closing session' }));
  const entries = [];
  for (const enrollment of enrollments) {
    const student = activeById.get(String(enrollment.studentId));
    if (!student) continue;
    const grade = gradeByValue(catalog, enrollment.classId);
    const next = grade && catalog[catalog.indexOf(grade) + 1];
    const destination = next && gradeByValue(targetCatalog, next.id);
    const existing = existingById.get(recordId(student));
    let reason = '';
    if (!grade || !enrollment.sectionId) reason = 'Closing class or section is missing from the configured curriculum';
    else if (next && !destination) reason = 'The destination class is outside the incoming curriculum';
    else if (existing && (!destination || !same(existing.classId, destination.id) ||
      !same(existing.sectionId, enrollment.sectionId) || existing.status !== 'active')) {
      reason = 'An incompatible enrollment already exists in the incoming session';
    }
    if (reason) issues.push({ studentId: recordId(student), name: student.name, reason });
    else entries.push({ student, enrollment, grade, destination, existing });
  }
  entries.sort((a, b) => recordId(a.student).localeCompare(recordId(b.student)));
  const rows = entries.map(({ student, enrollment, grade, destination }) => ({
    studentId: recordId(student),
    name: student.name,
    fromClassId: grade.id,
    fromClass: grade.name,
    sectionId: enrollment.sectionId,
    toClassId: destination?.id || null,
    toClass: destination?.name || 'Passout',
    action: destination ? 'promoted' : 'passout',
  }));
  const version = createHash('sha256').update(JSON.stringify([
    recordId(target), sessionDay(source.endDate), sessionDay(target.startDate), rows,
  ])).digest('hex');
  return { entries, rows, issues, version, enrollments, targetEnrollments };
}

async function commitPlan(store, source, target, plan, now, actor) {
  const sourceSessionId = recordId(source);
  const targetSessionId = recordId(target);
  const rooms = new Map((await store.find('classRooms', { sessionId: targetSessionId })).map((room) =>
    [placementsKey(room.classId, room.sectionId), room]
  ));
  const rollNumbers = new Map();
  for (const enrollment of plan.targetEnrollments) {
    const key = placementsKey(enrollment.classId, enrollment.sectionId);
    rollNumbers.set(key, Math.max(rollNumbers.get(key) || 0, enrollment.rollNumber || 0));
  }

  const processed = new Set();
  let passoutCount = 0;
  let promotedCount = 0;
  for (const { student, enrollment, grade, destination, existing } of plan.entries) {
    const studentId = recordId(student);
    const action = destination ? 'promoted' : 'passout';
    const history = {
      fromClass: grade.name,
      toClass: destination?.name || 'Passout',
      fromSection: enrollment.sectionName,
      toSection: destination ? enrollment.sectionName : '',
      action: destination ? 'promote' : 'passout',
      sessionId: destination ? targetSessionId : sourceSessionId,
      sessionName: destination ? target.sessionName : source.sessionName,
      promotedAt: now,
      promotedBy: actor,
    };
    const completed = { status: 'completed', promotionStatus: action, completedAt: now, completedBy: actor };
    await store.update('studentSessionHistories', recordId(enrollment), completed);
    processed.add(recordId(enrollment));
    if (!destination) {
      await store.update('students', studentId, {
        status: 'Passout',
        classId: grade.id, class: grade.name, className: grade.name, sessionId: sourceSessionId,
        academicYear: source.sessionName, currentClassRoomId: null,
        passout: { classId: grade.id, sessionId: sourceSessionId, date: now },
        promotionHistory: [...(student.promotionHistory || []), history],
      });
      passoutCount += 1;
      continue;
    }

    const key = placementsKey(destination.id, enrollment.sectionId);
    const placement = {
      sessionId: targetSessionId, sessionName: target.sessionName,
      classId: destination.id, className: destination.name,
      sectionId: enrollment.sectionId, sectionName: enrollment.sectionName || enrollment.sectionId,
    };
    let room = rooms.get(key);
    if (!room) {
      room = await store.create('classRooms', { ...placement, createdBy: actor, students: [] });
      rooms.set(key, room);
    }
    const classRoomId = recordId(room);
    const rollNumber = existing?.rollNumber || (rollNumbers.get(key) || 0) + 1;
    rollNumbers.set(key, Math.max(rollNumbers.get(key) || 0, rollNumber));
    const roster = new Set((room.students || []).map(String));
    roster.add(studentId);
    room.students = [...roster];
    const enrollmentFields = {
      ...placement, classRoomId, rollNumber,
      studentId, studentName: student.name, admissionNumber: student.admissionNumber,
      action: 'promoted', status: 'active', enrolledAt: now, enrolledBy: actor,
    };
    if (existing) {
      await store.update('studentSessionHistories', recordId(existing), { classRoomId, rollNumber });
    } else {
      await store.create('studentSessionHistories', enrollmentFields);
    }
    await store.update('students', studentId, {
      ...placement,
      class: destination.name, section: placement.sectionName,
      currentClassRoomId: classRoomId, academicYear: target.sessionName, rollNumber,
      promotionHistory: [...(student.promotionHistory || []), { ...history, classRoomId }],
    });
    promotedCount += 1;
  }
  for (const enrollment of plan.enrollments) {
    if (!processed.has(recordId(enrollment))) {
      await store.update('studentSessionHistories', recordId(enrollment), {
        status: 'completed', completedAt: now, completedBy: actor,
      });
    }
  }
  for (const room of rooms.values()) {
    await store.update('classRooms', recordId(room), { students: room.students || [], studentCount: room.students?.length || 0 });
  }
  const sourceRooms = await store.find('classRooms', { sessionId: sourceSessionId, status: 'active' });
  for (const room of sourceRooms) await store.update('classRooms', recordId(room), { status: 'completed' });
  await store.update('academicSessions', sourceSessionId, { status: 'completed', isCurrent: false });
  await store.update('academicSessions', targetSessionId, { status: 'active', isCurrent: true });
  return updateExecution(store, sourceSessionId, {
    targetSessionId, status: 'completed', completedAt: now, promotedCount, passoutCount, error: '',
  });
}

export async function previewRollover(req, sourceId, now = new Date()) {
  const store = readProcurement(req);
  const source = await store.get('academicSessions', sourceId);
  if (!source) throw procurementError('Academic session not found.', 404);
  const execution = await store.one('sessionRollovers', { sourceSessionId: sourceId });
  if (!source.isCurrent) return { source, execution, rows: [], issues: [] };
  const settings = await readRolloverSettings(req);
  const target = await findSuccessor(store, source);
  if (!target || !isConfiguredSession(source) || !isConfiguredSession(target)) {
    return {
      source, target, execution, settings, rows: [], issues: [],
      message: 'An upcoming session with a confirmed curriculum is required for preview.',
    };
  }
  const { rows, issues, version } = await buildPlan(store, source, target);
  const clock = schoolClock(now, settings.timeZone);
  const due = clock.day > sessionDay(target.startDate) ||
    (clock.day === sessionDay(target.startDate) && clock.time >= settings.cutoffTime);
  return { source, target, execution, settings, rows, issues, version, due };
}

export async function runRollover(req, sourceId, { planVersion, scheduled = false, now = new Date() } = {}) {
  if (mongoUnavailable()) throw procurementError('The school database is unavailable. The rollover is pending.', 503);
  const settings = await readRolloverSettings(req);
  let eligibleToAttempt = false;
  try {
    // Preparing the upcoming session and recording approval are durable even if promotion fails.
    const prepared = await writeProcurement(req, rolloverCollections, async (store) => {
      await store.lockAcademicSettings();
      const source = await store.get('academicSessions', sourceId);
      if (!source) throw procurementError('Academic session not found.', 404);
      const execution = await store.one('sessionRollovers', { sourceSessionId: sourceId });
      if (execution?.status === 'completed') return { execution };
      if (!source.isCurrent || !isConfiguredSession(source)) {
        throw procurementError('Choose an active session with a confirmed curriculum.', 409);
      }
      const target = await prepareSuccessor(store, source, settings, now);
      if (!target || !isConfiguredSession(target)) return { target, execution };
      if (!scheduled) {
        const preview = await buildPlan(store, source, target);
        if (preview.issues.length) throw procurementError('Resolve the enrollment issues in the preview first.', 409);
        if (planVersion !== preview.version) throw procurementError('The enrollments changed. Refresh and confirm the preview.', 409);
        await updateExecution(store, sourceId, {
          targetSessionId: recordId(target), approvedAt: now,
          approvedBy: req.user?.name || 'Administrator', planVersion, status: 'pending', error: '',
        });
      }
      const clock = schoolClock(now, settings.timeZone);
      return {
        target,
        due: clock.day > sessionDay(target.startDate) ||
          (clock.day === sessionDay(target.startDate) && clock.time >= settings.cutoffTime),
      };
    });
    if (!prepared?.due) return prepared?.execution || {
      status: 'pending', targetSessionId: recordId(prepared?.target),
    };

    return await writeProcurement(req, rolloverCollections, async (store) => {
      await store.lockAcademicSettings();
      const execution = await store.one('sessionRollovers', { sourceSessionId: sourceId });
      if (execution?.status === 'completed') return execution;
      if (!settings.autoPromote && !execution?.approvedAt) return execution || { status: 'pending' };
      const source = await store.get('academicSessions', sourceId);
      if (!source?.isCurrent) throw procurementError('The closing session is no longer active.', 409);
      const target = await findSuccessor(store, source);
      if (!target || !same(recordId(target), recordId(prepared.target))) {
        throw procurementError('The session configuration changed. Refresh the rollover preview.', 409);
      }
      eligibleToAttempt = true;
      const plan = await buildPlan(store, source, target);
      if (plan.issues.length || (!settings.autoPromote && plan.version !== execution.planVersion)) {
        throw procurementError('Enrollment issues or changes require a new rollover preview.', 409);
      }
      await updateExecution(store, sourceId, { startedAt: now, targetSessionId: recordId(target) });
      return commitPlan(store, source, target, plan, now, execution?.approvedBy || 'Academic rollover');
    });
  } catch (error) {
    if (eligibleToAttempt || scheduled) {
      await writeProcurement(req, rolloverCollections, async (store) => {
        await store.lockAcademicSettings();
        return updateExecution(store, sourceId, { status: 'failed', error: error.message });
      }).catch(() => {});
    }
    throw error;
  }
}

export function startAcademicRolloverJob() {
  let running = false;
  const tick = async () => {
    if (running || mongoUnavailable()) return;
    running = true;
    try {
      const fallback = checkFallback();
      const active = fallback
        ? FallbackDb.find('academicSessions').filter((session) => session.isCurrent && isConfiguredSession(session))
        : await AcademicSession.find({ isCurrent: true, setupConfirmedAt: { $exists: true } }).lean();
      const now = new Date();
      for (const session of active) {
        const schoolId = session.schoolId || 'IQRA_P01001';
        await tenantContext.run({ schoolId }, async () => {
          if (!fallback && !await School.exists({ schoolId, status: { $in: ['active', 'ACTIVE'] } })) return;
          const req = { schoolId };
          const settings = await readRolloverSettings(req);
          const clock = schoolClock(now, settings.timeZone);
          const end = sessionDay(session.endDate);
          if (clock.day < end || (clock.day === end && clock.time < settings.prepareTime)) return;
          await runRollover(req, recordId(session), { scheduled: true, now });
        }).catch((error) => console.error('Academic rollover for school ' + schoolId + ':', error.message));
      }
    } catch (error) {
      console.error('Academic rollover job:', error.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 60_000);
  timer.unref();
  void tick();
}
