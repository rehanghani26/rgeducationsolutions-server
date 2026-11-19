import { checkFallback } from '../config/db.js';
import Setting from '../models/Setting.js';
import { classKey, gradeByValue, standardGrade, standardGrades } from '../utils/academicClass.js';
import { defaultSessionEnd, sessionDay, validSessionDay } from '../utils/academicDates.js';
import { procurementError, recordId as rawRecordId } from '../utils/procurementValues.js';
import { FallbackDb } from './dbFallback.js';
import { getSchool, readProcurement, writeProcurement } from './procurementStore.js';

const recordId = (record) => String(rawRecordId(record) || '');

export const sessionCollections = ['academicSessions', 'classes'];
export const defaultRolloverSettings = {
  timeZone: 'Asia/Kolkata', prepareTime: '00:00', cutoffTime: '00:00', autoPromote: false,
};

export const isConfiguredSession = (session) => Boolean(session?.setupConfirmedAt && session.classIds?.length);

export async function orderedGrades(store) {
  const master = (await store.find('classes'))
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

export async function sessionGrades(store, session) {
  if (!session?.classIds?.length) return [];
  const master = await orderedGrades(store);
  return session.classIds.map((id) => gradeByValue(master, id)).filter(Boolean);
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
  return { startClassId: classIds[0], endClassId: classIds.at(-1), classIds };
}

export async function validateSessionWindow(store, fields, id) {
  const sessions = await store.find('academicSessions');
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

export async function saveSessionConfiguration(req, { id, confirm = false } = {}) {
  return writeProcurement(req, [...sessionCollections, 'budgetAllocations', 'studentSessionHistories'], async (store) => {
    await store.lockAcademicSettings();
    const active = await activeAcademicSession(store);
    const current = id ? await store.get('academicSessions', id) : confirm ? active : null;
    if (id && !current) throw procurementError('Academic session not found.', 404);
    if (current?.status === 'completed' && !current.isCurrent) {
      throw procurementError('Completed academic sessions are read-only.', 409);
    }
    if (confirm && active && recordId(active) !== recordId(current)) {
      throw procurementError('The active session changed. Reload the setup form.', 409);
    }
    const body = req.body || {};
    const sessionName = String(body.sessionName ?? current?.sessionName ?? '').trim();
    const startDate = sessionDay(body.startDate ?? current?.startDate);
    if (!sessionName || !validSessionDay(startDate)) throw procurementError('Enter a session name and valid start date.');
    const endDate = sessionDay(body.endDate ?? current?.endDate ?? defaultSessionEnd(startDate));
    if (!validSessionDay(endDate) || endDate <= startDate) {
      throw procurementError('The end date must be after the start date.');
    }
    const currentId = recordId(current);
    const makeActive = confirm || Boolean(current?.isCurrent) || body.isCurrent === true;
    if (makeActive && active && recordId(active) !== currentId) {
      throw procurementError('Use the whole-school upgrade to switch from the active session.', 409);
    }
    const fields = {
      sessionName, startDate, endDate,
      notes: String(body.notes ?? body.description ?? current?.notes ?? '').trim(),
      isCurrent: makeActive,
      status: makeActive ? 'active' : 'upcoming',
    };
    await validateSessionWindow(store, fields, currentId);
    const changesRange = (body.startClassId && String(body.startClassId) !== String(current?.startClassId))
      || (body.endClassId && String(body.endClassId) !== String(current?.endClassId));
    if (confirm || changesRange) {
      Object.assign(fields, await materializeRange(
        store, body.startClassId || current?.startClassId, body.endClassId || current?.endClassId
      ), { setupConfirmedAt: current?.setupConfirmedAt || new Date() });
      if (current?.isCurrent) {
        const enrollments = await store.find('studentSessionHistories', { sessionId: currentId, status: 'active' });
        const grades = await sessionGrades(store, fields);
        if (enrollments.some((enrollment) => !gradeByValue(grades, enrollment.classId || enrollment.className))) {
          throw procurementError('The range excludes an active enrollment. Review student placements first.', 409);
        }
      }
    } else if (!current && active?.classIds?.length) {
      Object.assign(fields, {
        classIds: active.classIds,
        startClassId: active.startClassId,
        endClassId: active.endClassId,
        setupConfirmedAt: active.setupConfirmedAt,
      });
    }
    if (!current) return store.create('academicSessions', { ...fields, createdBy: req.user?.name });
    const updated = await store.update('academicSessions', currentId, fields);
    if (current.sessionName !== sessionName) {
      const budgets = await store.find('budgetAllocations', { sessionId: currentId });
      for (const budget of budgets) await store.update('budgetAllocations', recordId(budget), { sessionName });
    }
    return updated;
  });
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
