import { checkFallback } from '../config/db.js';
import Setting from '../models/Setting.js';
import { classKey, gradeByValue, standardGrade, standardGrades } from '../utils/academicClass.js';
import { addSessionDays, defaultSessionEnd, sessionDay, shiftedSessionEnd, validSessionDay } from '../utils/academicDates.js';
import { procurementError, recordId as rawRecordId, recordIds } from '../utils/procurementValues.js';
import { FallbackDb } from './dbFallback.js';
import { getSchool, readProcurement, writeProcurement } from './procurementStore.js';

const recordId = (record) => String(rawRecordId(record) || '');

export const curriculumCollections = ['academicSessions', 'classes', 'schoolCurricula'];
export const defaultRolloverSettings = {
  timeZone: 'Asia/Kolkata', prepareTime: '00:00', cutoffTime: '00:00', autoPromote: false,
};

export async function orderedGrades(store) {
  return classMasterGrades(await store.find('classes'));
}

export function classMasterGrades(classes = []) {
  const master = classes
    .filter((grade) => !['passout', 'pass out', 'graduated', 'cls-passout'].some((value) =>
      classKey(grade.name) === value || classKey(grade.code) === value
    ))
    .map((grade) => {
      const standard = standardGrade(grade.code) || standardGrade(grade.name);
      return {
        id: recordId(grade),
        name: grade.name,
        code: grade.code,
        sortOrder: grade.sortOrder ?? standard?.sortOrder ?? null,
        aliases: standard ? [standard.code, standard.name, standard.code.replace(/^cls-(?=\d)/, '')] : [],
      };
    });
  const missing = standardGrades
    .filter((grade) => !gradeByValue(master, grade.code))
    .map((grade) => ({ ...grade, id: grade.code, virtual: true }));
  return [...master, ...missing].sort((a, b) =>
    (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) || String(a.id).localeCompare(String(b.id))
  );
}

export async function curriculumGrades(store, curriculum) {
  if (!curriculum?.classIds?.length) return [];
  const master = await orderedGrades(store);
  return curriculum.classIds.map((id) => gradeByValue(master, id)).filter(Boolean);
}

export async function saveClassOrder(req) {
  const order = Number(req.body?.sortOrder);
  if (req.body?.sortOrder === '' || req.body?.sortOrder == null || !Number.isInteger(order) || order < 0) {
    throw procurementError('Enter a non-negative whole number for class order.');
  }
  return writeProcurement(req, ['classes'], async (store) => {
    await store.lockAcademicSettings();
    const grade = await store.get('classes', req.params.id);
    if (!grade) throw procurementError('Class Master entry not found.', 404);
    const catalog = await orderedGrades(store);
    if (catalog.some((item) => item.id !== recordId(grade) && item.sortOrder === order)) {
      throw procurementError('This position is already used by another class.', 409);
    }
    return store.update('classes', recordId(grade), { sortOrder: order });
  });
}

export async function activeAcademicSession(store) {
  return store.one('academicSessions', { isCurrent: true });
}

function curriculumRange(classIds) {
  return { startClassId: classIds[0], endClassId: classIds.at(-1), classIds };
}

export async function schoolCurriculum(store, { persist = false } = {}) {
  const saved = await store.one('schoolCurricula', {});
  if (saved) return curriculumRange(saved.classIds);

  // An existing current curriculum is already in use. Without one, inherit
  // the previous configuration only when every confirmed range agrees.
  const configured = (await store.find('academicSessions'))
    .filter((session) => session.setupConfirmedAt && session.classIds?.length);
  const current = configured.find((session) => session.isCurrent);
  const first = configured[0];
  const shared = first && configured.every((session) => String(session.classIds) === String(first.classIds));
  const source = current || (shared ? first : null);
  if (!source) return null;
  const range = curriculumRange(source.classIds.map(String));
  if (persist) await store.create('schoolCurricula', range);
  return range;
}

export async function schoolClassOptions(store) {
  const classRange = await schoolCurriculum(store);
  const classes = await curriculumGrades(store, classRange);
  return { classRange, classes };
}

async function materializeRange(store, startClassId, endClassId) {
  const grades = (await orderedGrades(store)).filter((grade) => grade.sortOrder !== null);
  const start = gradeByValue(grades, startClassId);
  const end = gradeByValue(grades, endClassId);
  const startIndex = grades.indexOf(start);
  const endIndex = grades.indexOf(end);
  if (startIndex < 0 || endIndex < startIndex) {
    throw procurementError('Select a starting class and an ending class in curriculum order.');
  }
  const range = grades.slice(startIndex, endIndex + 1);
  if (new Set(range.map((grade) => grade.sortOrder)).size !== range.length) {
    throw procurementError('Assign distinct class order values to the grades in this range.');
  }
  const classIds = [];
  for (const grade of range) {
    if (grade.virtual) {
      const created = await store.create('classes', {
        name: grade.name, code: grade.code, sortOrder: grade.sortOrder,
      });
      classIds.push(recordId(created));
    } else {
      classIds.push(grade.id);
    }
  }
  return curriculumRange(classIds);
}

export async function initializeSchoolCurriculum(store, { startClassId, endClassId } = {}) {
  const current = await schoolCurriculum(store, { persist: true });
  if (current) {
    const classes = await curriculumGrades(store, current);
    const first = gradeByValue(classes, startClassId);
    const last = gradeByValue(classes, endClassId);
    if (first && last && first === classes[0] && last === classes.at(-1) && classes.length === current.classIds.length) {
      return current;
    }
    throw procurementError('The school class range is already configured.', 409);
  }

  const range = await materializeRange(store, startClassId, endClassId);
  const openSessions = (await store.find('academicSessions')).filter((session) => session.isCurrent || session.status === 'upcoming');
  if (openSessions.length) {
    const openIds = new Set(openSessions.map(recordId));
    const grades = await curriculumGrades(store, range);
    const enrollments = await store.find('studentSessionHistories', { status: 'active' });
    if (enrollments.some((row) => openIds.has(String(row.sessionId)) && !gradeByValue(grades, row.classId || row.className))) {
      throw procurementError('The range excludes an active enrollment. Review student placements first.', 409);
    }
  }
  await store.create('schoolCurricula', range);
  return range;
}

export function saveSchoolCurriculum(req, { allowFallback = !process.env.MONGODB_URI?.trim() } = {}) {
  return writeProcurement(req, [...curriculumCollections, 'studentSessionHistories'], async (store) => {
    await store.lockAcademicSettings();
    await initializeSchoolCurriculum(store, req.body || {});
    return schoolClassOptions(store);
  }, { allowFallback });
}

export function sessionsInDateOrder(sessions) {
  return [...sessions].sort((left, right) =>
    sessionDay(left.startDate).localeCompare(sessionDay(right.startDate))
    || recordId(left).localeCompare(recordId(right))
  );
}

export function isUpcomingSession(session) {
  return !session.isCurrent && (!session.status || session.status === 'upcoming');
}

export function scheduledSuccessor(sessions, source) {
  const ordered = sessionsInDateOrder(sessions);
  const sourceId = recordId(source);
  const index = ordered.findIndex((candidate) => recordId(candidate) === sourceId);
  const next = ordered[index + 1] || null;
  const linked = ordered.find((candidate) => String(candidate.previousSessionId || '') === sourceId);
  if (index < 0 || (linked && recordId(linked) !== recordId(next)) ||
      (next && (!isUpcomingSession(next) || (next.previousSessionId && String(next.previousSessionId) !== sourceId)))) {
    throw procurementError('Review the order of the upcoming academic sessions.', 409);
  }
  return next;
}

export function defaultSessionName(startDate, sessions) {
  const year = Number(startDate.slice(0, 4));
  const base = year + '-' + (year + 1);
  const names = new Set(sessions.map((session) => classKey(session.sessionName)));
  let name = base;
  for (let number = 2; names.has(classKey(name)); number += 1) name = base + ' (' + number + ')';
  return name;
}

export function validateSessionWindow(sessions, fields, id) {
  for (const session of sessions) {
    if (recordId(session) === id) continue;
    if (classKey(session.sessionName) === classKey(fields.sessionName)) {
      throw procurementError('An academic session with this name already exists.', 409);
    }
    if (fields.startDate <= sessionDay(session.endDate) && fields.endDate >= sessionDay(session.startDate)) {
      throw procurementError('The date range overlaps session ' + session.sessionName + '.', 409);
    }
  }
}

// Use the school's academic settings lock when creating a successor.
export async function ensureUpcomingSession(store, source, sessions) {
  const schedule = sessions ?? await store.find('academicSessions');
  const next = scheduledSuccessor(schedule, source);
  if (next) return next;
  const startDate = addSessionDays(sessionDay(source.endDate), 1);
  const endDate = defaultSessionEnd(startDate);
  if (!validSessionDay(startDate) || !validSessionDay(endDate)) {
    throw procurementError('Set a valid end date for the current session to schedule its successor.', 409);
  }
  const fields = {
    sessionName: defaultSessionName(startDate, schedule),
    startDate,
    endDate,
    status: 'upcoming',
    isCurrent: false,
    previousSessionId: recordId(source),
    createdBy: 'Academic schedule',
  };
  validateSessionWindow(schedule, fields);
  return store.create('academicSessions', fields);
}

export async function ensureSchoolUpcomingSession(req) {
  const sessions = await readProcurement(req).find('academicSessions');
  const source = sessions.find((session) => session.isCurrent);
  if (!source) return null;
  const next = scheduledSuccessor(sessions, source);
  if (next) return next;

  return writeProcurement(req, ['academicSessions'], async (store) => {
    await store.lockAcademicSettings();
    const schedule = await store.find('academicSessions');
    const current = schedule.find((session) => session.isCurrent);
    return current ? ensureUpcomingSession(store, current, schedule) : null;
  }, { allowFallback: !process.env.MONGODB_URI?.trim() });
}

export function followingSessionDates(following, priorEndDate) {
  const changes = [];
  let endDate = priorEndDate;
  for (const session of following) {
    const startDate = addSessionDays(endDate, 1);
    const existingStart = sessionDay(session.startDate);
    endDate = sessionDay(session.endDate);
    if (existingStart === startDate) continue;
    if (!isUpcomingSession(session)) {
      throw procurementError('The date change would move ' + session.sessionName + ', which is already active or completed.', 409);
    }
    endDate = shiftedSessionEnd(session, startDate);
    if (!validSessionDay(startDate) || !validSessionDay(endDate) || endDate <= startDate) {
      throw procurementError('Check the dates for ' + session.sessionName + ' before changing the schedule.', 409);
    }
    changes.push({ id: recordId(session), startDate, endDate });
  }
  return changes;
}

export async function updateFollowingSessionDates(store, changes) {
  const shiftedSessions = [];
  for (const { id, startDate, endDate } of changes) {
    shiftedSessions.push(await store.update('academicSessions', id, { startDate, endDate }));
  }
  return shiftedSessions;
}

export function saveSessionConfiguration(req, { id, allowFallback } = {}) {
  return writeProcurement(req, [...curriculumCollections, 'budgetAllocations'], (store) =>
    configureSession(store, req.body || {}, { id, createdBy: req.user?.name }), { allowFallback });
}

export async function configureSession(store, body, { id, createdBy, initial = false } = {}) {
  if (['startClassId', 'endClassId', 'classIds', 'classRange', 'setupConfirmedAt'].some((key) => Object.hasOwn(body, key))) {
    throw procurementError('Set the class range once in School Classes.', 409);
  }
  await store.lockAcademicSettings();
  const sessions = sessionsInDateOrder(await store.find('academicSessions'));
  const active = sessions.find((session) => session.isCurrent);
  const index = id ? sessions.findIndex((session) => recordIds(session).includes(String(id))) : sessions.length;
  const current = sessions[index];
  if (id && !current) throw procurementError('Academic session not found.', 404);
  const legacyPrevious = current && !current.status && active
    && sessionDay(current.endDate) < sessionDay(active.startDate);
  if (current && !current.isCurrent && (!isUpcomingSession(current) || legacyPrevious)) {
    throw procurementError('Completed academic sessions are read-only.', 409);
  }
  if (initial && sessions.length) {
    throw procurementError('This school already has academic sessions.', 409);
  }
  const previous = index > 0 ? sessions[index - 1] : null;
  const submittedStart = sessionDay(body.startDate);
  const originalStart = sessionDay(current?.startDate);
  const startDate = previous ? addSessionDays(sessionDay(previous.endDate), 1) : submittedStart || originalStart;
  if (!validSessionDay(startDate) || (body.startDate != null && !validSessionDay(submittedStart))) {
    throw procurementError('Enter a valid start date.');
  }
  if (previous && submittedStart && submittedStart !== startDate && submittedStart !== originalStart) {
    throw procurementError('The start date must be ' + startDate + ', the day after ' + previous.sessionName + ' ends. Refresh the session dates and try again.', 409);
  }
  const sessionName = String(body.sessionName ?? current?.sessionName ?? defaultSessionName(startDate, sessions)).trim();
  if (!sessionName) throw procurementError('Enter a session name.');
  const endDate = body.endDate == null
    ? (current ? shiftedSessionEnd(current, startDate) : defaultSessionEnd(startDate))
    : sessionDay(body.endDate);
  if (!validSessionDay(endDate) || endDate <= startDate) {
    throw procurementError('The end date must be after the start date.');
  }
  const currentId = recordId(current);
  const makeActive = initial || Boolean(current?.isCurrent) || body.isCurrent === true;
  if (makeActive && active && recordId(active) !== currentId) {
    throw procurementError('Use the whole-school upgrade to switch from the active session.', 409);
  }
  const fields = {
    sessionName, startDate, endDate,
    notes: String(body.notes ?? body.description ?? current?.notes ?? '').trim(),
    isCurrent: makeActive,
    status: makeActive ? 'active' : 'upcoming',
  };
  const changes = followingSessionDates(sessions.slice(index + 1), endDate);
  const proposed = new Map(changes.map((change) => [change.id, change]));
  validateSessionWindow(sessions.map((session) => ({ ...session, ...proposed.get(recordId(session)) })), fields, currentId);
  const curriculum = await schoolCurriculum(store, { persist: true });
  if (!curriculum && (!current || (makeActive && !current.isCurrent))) {
    throw procurementError('Set the school class range before creating or activating a session.', 409);
  }
  const session = current
    ? await store.update('academicSessions', currentId, fields)
    : await store.create('academicSessions', { ...fields, createdBy });
  if (current && current.sessionName !== sessionName) {
    const budgets = await store.find('budgetAllocations', { sessionId: currentId });
    for (const budget of budgets) await store.update('budgetAllocations', recordId(budget), { sessionName });
  }
  const shiftedSessions = await updateFollowingSessionDates(store, changes);
  const upcomingSession = makeActive ? await ensureUpcomingSession(store, session) : null;
  return { session, shiftedSessions, upcomingSession };
}

export async function readRolloverSettings(req) {
  const schoolId = getSchool(req);
  const saved = checkFallback()
    ? FallbackDb.find('academicRolloverSettings').find((record) => record.schoolId === schoolId)
    : (await Setting.findOne({ schoolId }).select('academicRollover').lean())?.academicRollover;
  const { timeZone, prepareTime, cutoffTime, autoPromote } = { ...defaultRolloverSettings, ...saved };
  return { timeZone, prepareTime, cutoffTime, autoPromote };
}

export async function writeRolloverSettings(req) {
  const { timeZone, prepareTime, cutoffTime, autoPromote } = req.body || {};
  try {
    if (typeof timeZone !== 'string' || !timeZone.trim()) throw new Error();
    new Intl.DateTimeFormat('en', { timeZone }).format();
  } catch {
    throw procurementError('Enter a valid school timezone, such as Asia/Kolkata.');
  }
  const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!clock.test(prepareTime) || !clock.test(cutoffTime) || typeof autoPromote !== 'boolean') {
    throw procurementError('Enter valid preparation and rollover times and choose an approval mode.');
  }
  const settings = { timeZone, prepareTime, cutoffTime, autoPromote };
  const schoolId = getSchool(req);
  if (checkFallback()) {
    await FallbackDb.transaction(['academicRolloverSettings'], (draft) => {
      draft.academicRolloverSettings = draft.academicRolloverSettings.filter((record) => record.schoolId !== schoolId);
      draft.academicRolloverSettings.push({ schoolId, ...settings });
    });
  } else {
    await Setting.updateOne({ schoolId }, { $set: { academicRollover: settings }, $inc: { academicVersion: 1 } }, { upsert: true });
  }
  return settings;
}
