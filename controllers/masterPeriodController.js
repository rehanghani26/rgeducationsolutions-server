import {
  defaultMasterPeriod, listMasterPeriods, removeMasterPeriod, saveMasterPeriod, setDefaultMasterPeriod, writePeriodRecords,
} from '../services/masterPeriodService.js';
import { readProcurement } from '../services/procurementStore.js';
import { classKey, gradeByValue, sectionNamesById } from '../utils/academicClass.js';
import { academicFields, academicGrade, getAcademicScope } from '../utils/academicScope.js';
import { procurementError, recordId, recordIds, sendProcurementError } from '../utils/procurementValues.js';
import { sendCreated, sendSuccess } from '../utils/responseUtil.js';

const handle = (action) => async (req, res) => {
  try {
    return await action(req, res);
  } catch (error) {
    return sendProcurementError(res, error);
  }
};

const sendData = (res, data) => sendSuccess(res, undefined, data, 200, data);

export const getMasterPeriods = handle(async (req, res) =>
  sendData(res, { schedules: await listMasterPeriods(req, req.query.type) })
);

export const getMasterPeriodById = handle(async (req, res) => {
  const schedule = (await listMasterPeriods(req)).find((item) => recordIds(item).includes(req.params.id));
  if (!schedule) throw procurementError('Schedule not found.', 404);
  return sendData(res, { schedule });
});

export const createMasterPeriod = handle(async (req, res) => {
  const schedule = await saveMasterPeriod(req);
  return sendCreated(res, 'Schedule created.', { schedule }, { schedule });
});

export const updateMasterPeriod = handle(async (req, res) =>
  sendData(res, { schedule: await saveMasterPeriod(req, { id: req.params.id }) })
);

export const setDefaultMasterSchedule = handle(async (req, res) =>
  sendData(res, { schedule: await setDefaultMasterPeriod(req) })
);

export const deleteMasterPeriod = handle(async (req, res) => {
  await removeMasterPeriod(req);
  return sendSuccess(res, 'Schedule deleted successfully');
});

const matchesType = (timetable, type) => (timetable.scheduleType || 'regular') === type;
const normalizeClassKey = (key) => classKey(key).replace(/\s+[-\u2013\u2014]\s+/g, ' - ');

function timetableTarget(row, grades) {
  const [classFromKey, sectionFromKey] = classKey(row.classSectionKey).split(/\s+[-\u2013\u2014]\s+|_(?=sec-)/, 2);
  const grade = gradeByValue(grades, row.classId) || gradeByValue(grades, row.className) || gradeByValue(grades, classFromKey);
  const sectionName = Object.hasOwn(sectionNamesById, row.sectionId) ? sectionNamesById[row.sectionId]
    : row.sectionName || sectionFromKey || row.sectionId;
  return {
    classId: String(grade?.id || row.classId || ''),
    className: classKey(grade?.name || row.className || classFromKey),
    section: classKey(sectionName).replace(/^(section\s+|sec-)/, ''),
  };
}

function sameTimetableSection(record, target, grades) {
  if (normalizeClassKey(record.classSectionKey) === normalizeClassKey(target.classSectionKey)) return true;
  const existing = timetableTarget(record, grades);
  const desired = timetableTarget(target, grades);
  const sameClass = (existing.classId && existing.classId === desired.classId) ||
    (existing.className && existing.className === desired.className);
  return sameClass && desired.section && existing.section === desired.section;
}

export const getClassTimetable = handle(async (req, res) => {
  const { classSection, classId, className, scheduleType = 'regular' } = req.query;
  const target = className || classSection;
  const exactSection = Boolean(classSection && /\s[-\u2013\u2014]\s/.test(classSection));
  const timetables = (await readProcurement(req).find('classTimetables', {
    sessionId: getAcademicScope()?.sessionId || null,
  })).filter((item) => matchesType(item, scheduleType));

  if (!target && !classId) return sendData(res, { timetables });
  const timetable = timetables.find((item) => item.classSectionKey === target ||
    (!exactSection && (item.className === target || (classId && String(item.classId) === String(classId)))));
  return sendData(res, { timetable: timetable || null, timetables });
});

async function saveTimetables(req, sectionIds) {
  const {
    classSectionKey, classId = '', sectionId = '', className, sectionName = '',
    scheduleType = 'regular', masterPeriodId, allocations = [], timetableId, createOnly,
  } = req.body || {};
  const target = className || classSectionKey || classId;
  if (!timetableId && !target) throw procurementError('className or classId is required.');
  if (sectionIds && timetableId) throw procurementError('Edit saved timetables individually.');
  if (sectionIds && !['regular', 'exam'].includes(scheduleType)) throw procurementError('Choose a regular or exam schedule.');
  if (!Array.isArray(allocations)) throw procurementError('Provide a list of period allocations.');
  const scope = getAcademicScope();
  const grade = sectionIds && scope ? academicGrade(scope, classId || target) : null;
  const gradeName = grade?.name || className || target;
  const destinations = sectionIds ? sectionIds.map((id) => ({
    classId: grade?.id || classId, className: gradeName, sectionId: id, sectionName: sectionNamesById[id],
    classSectionKey: gradeName + ' - ' + sectionNamesById[id],
  })) : [{
    classSectionKey: classSectionKey || target, classId, className: target, sectionId, sectionName,
  }];
  const create = Boolean(sectionIds) || createOnly === true;

  return writePeriodRecords(req, ['classTimetables', 'masterPeriods'], async (store, session) => {
    const entries = (await store.find('classTimetables', session)).filter((item) => matchesType(item, scheduleType));
    const matches = destinations.map((destination) => {
      const existing = timetableId
        ? entries.find((item) => recordIds(item).includes(String(timetableId)))
        : entries.find((item) => item.classSectionKey === destination.classSectionKey ||
          (destination.classId && destination.sectionId && String(item.classId) === String(destination.classId) && item.sectionId === destination.sectionId) ||
          (create && sameTimetableSection(item, destination, scope?.grades || [])));
      if (timetableId && !existing) throw procurementError('This timetable is no longer available.', 404);
      if (create && existing) {
        throw procurementError(destination.classSectionKey + ' already has a timetable. Use Edit in the saved list.', 409);
      }
      return { destination, existing };
    });

    const existing = matches[0].existing;
    let linkedId = String(masterPeriodId ?? existing?.masterPeriodId ?? '');
    if ((linkedId && linkedId !== existing?.masterPeriodId) || !existing) {
      const schedules = await store.find('masterPeriods', session);
      if (linkedId && !schedules.some((item) => recordIds(item).includes(linkedId) && matchesType(item, scheduleType))) {
        throw procurementError('The selected master schedule is unavailable in this academic session.', 409);
      }
      if (!linkedId) linkedId = String(recordId(defaultMasterPeriod(schedules, scheduleType)) || '');
    }

    const timetables = [];
    for (const { destination, existing: saved } of matches) {
      const fields = { masterPeriodId: linkedId, allocations };
      if (!timetableId) Object.assign(fields, {
        ...destination, classId: destination.classId || saved?.classId || '', scheduleType,
      });
      if (scope) Object.assign(fields, academicFields(scope, 'classTimetables', fields, { creating: !saved }));
      const timetable = saved ? await store.update('classTimetables', recordId(saved), fields)
        : await store.create('classTimetables', { ...fields, ...session, createdBy: req.user?.name || 'admin' });
      timetables.push(timetable);
    }
    return timetables;
  });
}

export const saveClassTimetable = handle(async (req, res) => {
  const [timetable] = await saveTimetables(req);
  return sendData(res, { timetable });
});

export const createSectionTimetables = handle(async (req, res) => {
  const { sectionIds } = req.body || {};
  if (!Array.isArray(sectionIds) || sectionIds.length === 0 ||
      sectionIds.some((id) => typeof id !== 'string' || !Object.hasOwn(sectionNamesById, id))) {
    throw procurementError('Choose one or more available sections.');
  }
  if (new Set(sectionIds).size !== sectionIds.length) throw procurementError('Choose each section once.');
  const timetables = await saveTimetables(req, sectionIds);
  return sendCreated(res, 'Section timetables created.', { timetables }, { timetables });
});

export const deleteClassTimetable = handle(async (req, res) => {
  const { id } = req.params;
  await writePeriodRecords(req, ['classTimetables'], async (store, session) => {
    const entries = await store.find('classTimetables', session);
    const exact = entries.find((entry) => recordIds(entry).includes(id));
    if (exact) return store.remove('classTimetables', recordId(exact));
    if (req.query.byId === 'true') throw procurementError('This timetable is no longer available.', 404);
    for (const entry of entries) {
      if ([entry.classSectionKey, entry.className, String(entry.classId)].includes(id)) {
        await store.remove('classTimetables', recordId(entry));
      }
    }
  });
  return sendSuccess(res, 'Class timetable deleted successfully');
});
