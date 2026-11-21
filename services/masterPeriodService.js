import mongoose from 'mongoose';
import { getAcademicScope } from '../utils/academicScope.js';
import { procurementError, recordId, recordIds } from '../utils/procurementValues.js';
import { readProcurement, writeProcurement } from './procurementStore.js';

const types = ['regular', 'exam'];
const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const validDays = new Set([...weekdays, 'sunday']);
const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const idOf = (item) => String(recordId(item) || '');
const typeOf = (schedule) => schedule.scheduleType || 'regular';
const schoolSession = () => ({ sessionId: getAcademicScope()?.sessionId || null });
const active = (schedule) => schedule.isActive !== false && schedule.isConfigured !== false;
const capitalize = (value) => value[0].toUpperCase() + value.slice(1);

function minutes(time) {
  if (!clock.test(time)) return NaN;
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

function normalizePeriods(periods) {
  if (!Array.isArray(periods)) return [];
  return periods.filter((period) => period && typeof period === 'object').map((period, index) => ({
    ...(mongoose.isObjectIdOrHexString(period._id) && { _id: period._id }),
    order: index + 1,
    type: period.type === 'teaching' ? 'class' : period.type || (period.isBreak ? 'recess' : 'class'),
    customLabel: period.customLabel || period.name || period.label || '',
    startTime: period.startTime,
    endTime: period.endTime,
    durationMinutes: Math.max(0, minutes(period.endTime) - minutes(period.startTime)) || 0,
    subjectName: period.subjectName || '',
    teacherName: period.teacherName || '',
    roomNo: period.roomNo || '',
  }));
}

const legacySaturday = normalizePeriods([
  { type: 'prayer', customLabel: 'Morning Prayer & Assembly', startTime: '08:00', endTime: '08:20' },
  { type: 'class', customLabel: 'Period 1', startTime: '08:20', endTime: '09:05' },
  { type: 'class', customLabel: 'Period 2', startTime: '09:05', endTime: '09:50' },
  { type: 'recess', customLabel: 'Fruit Recess', startTime: '09:50', endTime: '10:15' },
  { type: 'class', customLabel: 'Period 3', startTime: '10:15', endTime: '11:00' },
  { type: 'class', customLabel: 'Period 4', startTime: '11:00', endTime: '11:45' },
  { type: 'leave', customLabel: 'School Dispersal', startTime: '11:45', endTime: '12:00' },
]);

function daySchedulesFor({ days, periods, schoolStartTime, schoolEndTime, daySchedules }) {
  const keys = new Set([...days, ...Object.keys(daySchedules || {}).filter((key) => validDays.has(key))]);
  return Object.fromEntries([...keys].map((day) => {
    const saved = daySchedules?.[day];
    const saturday = !saved && day === 'saturday';
    return [day, {
      day,
      dayLabel: saved?.dayLabel || capitalize(day),
      name: saved?.name || (saturday ? 'Saturday Half Day' : capitalize(day) + ' Schedule'),
      enabled: days.includes(day) && saved?.enabled !== false,
      isHalfDay: saved?.isHalfDay ?? saturday,
      schoolStartTime: saved?.schoolStartTime || (saturday ? '08:00' : schoolStartTime),
      schoolEndTime: saved?.schoolEndTime || (saturday ? '12:00' : schoolEndTime),
      periods: Array.isArray(saved?.periods) ? normalizePeriods(saved.periods) : saturday ? legacySaturday : periods,
    }];
  }));
}

function normalizeSchedule(record) {
  const savedDays = record.days || record.workingDays;
  const days = Array.isArray(savedDays) ? savedDays.map((day) => String(day).toLowerCase()).filter((day) => validDays.has(day)) : [];
  const schedule = {
    ...record,
    scheduleType: typeOf(record),
    name: record.name || record.scheduleName || 'Master Schedule',
    schoolStartTime: record.schoolStartTime || record.startTime || '07:00',
    schoolEndTime: record.schoolEndTime || record.endTime || '14:00',
    days: days.length ? days : weekdays,
    periods: normalizePeriods(record.periods),
  };
  return { ...schedule, daySchedules: daySchedulesFor(schedule) };
}

function newestFirst(schedules) {
  return [...schedules].sort((left, right) =>
    new Date(right.createdAt || 0) - new Date(left.createdAt || 0) || idOf(right).localeCompare(idOf(left)));
}

export function defaultMasterPeriod(schedules, type) {
  const eligible = newestFirst(schedules).filter((item) => typeOf(item) === type && active(item));
  return eligible.find((item) => item.isDefault) || eligible[0] || null;
}

export async function listMasterPeriods(req, type) {
  const schedules = newestFirst(await readProcurement(req).find('masterPeriods', schoolSession()));
  const defaults = new Set(types.map((value) => idOf(defaultMasterPeriod(schedules, value))));
  return schedules.filter((item) => !type || typeOf(item) === type)
    .map((item) => ({ ...normalizeSchedule(item), isDefault: defaults.has(idOf(item)) }))
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
}

function validateWindow(day, label) {
  if (!clock.test(day.schoolStartTime) || !clock.test(day.schoolEndTime) || day.schoolEndTime <= day.schoolStartTime) {
    throw procurementError(label + ' needs a start time and a later end time.');
  }
  if (!day.periods.length) throw procurementError('Add at least one period for ' + label + '.');
  let previousEnd = day.schoolStartTime;
  for (const period of day.periods) {
    if (!clock.test(period.startTime) || !clock.test(period.endTime) || period.endTime <= period.startTime) {
      throw procurementError(label + ' period ' + period.order + ' needs a start time and a later end time.');
    }
    if (period.startTime < previousEnd || period.endTime > day.schoolEndTime) {
      throw procurementError(label + ' periods must be in order, with no overlaps, within school hours.');
    }
    previousEnd = period.endTime;
  }
}

function scheduleFields(body, existing) {
  const before = existing && normalizeSchedule(existing);
  const scheduleType = before?.scheduleType || body.scheduleType || 'regular';
  if (!types.includes(scheduleType)) throw procurementError('Choose either a regular or exam schedule.');
  const requestedDays = body.days ?? before?.days ?? weekdays;
  if (!Array.isArray(requestedDays) || !requestedDays.length || requestedDays.some((day) => !validDays.has(day))) {
    throw procurementError('Choose one or more working days.');
  }
  const days = [...new Set(requestedDays)];
  const name = String(body.name ?? before?.name ?? capitalize(scheduleType) + ' Schedule').trim();
  if (!name) throw procurementError('Enter a schedule name.');
  const fields = {
    scheduleType, name, days,
    schoolStartTime: body.schoolStartTime ?? before?.schoolStartTime,
    schoolEndTime: body.schoolEndTime ?? before?.schoolEndTime,
    periods: normalizePeriods(body.periods ?? before?.periods),
    daySchedules: body.daySchedules ?? (body.periods || body.schoolStartTime || body.schoolEndTime ? undefined : before?.daySchedules),
    isConfigured: body.isConfigured ?? before?.isConfigured ?? true,
    isActive: body.isActive ?? before?.isActive ?? true,
  };
  fields.daySchedules = daySchedulesFor(fields);
  for (const day of days) {
    const daySchedule = fields.daySchedules[day];
    if (daySchedule.enabled === false) throw procurementError(capitalize(day) + ' is listed as a working day and marked closed.');
    validateWindow(daySchedule, capitalize(day));
  }
  const primary = fields.daySchedules[days[0]];
  return {
    ...fields,
    schoolStartTime: primary.schoolStartTime,
    schoolEndTime: primary.schoolEndTime,
    periods: primary.periods,
  };
}

function findSchedule(schedules, id) {
  const schedule = schedules.find((item) => recordIds(item).includes(String(id)));
  if (!schedule) throw procurementError('Schedule not found.', 404);
  return schedule;
}

export function writePeriodRecords(req, collections, apply) {
  return writeProcurement(req, [...collections, 'academicSessions'], async (store) => {
    await store.lockAcademicSettings();
    const scope = getAcademicScope();
    if (scope && (scope.readOnly || !(await store.get('academicSessions', scope.sessionId))?.isCurrent)) {
      throw procurementError('Select the active academic session to change master schedules.', 409);
    }
    return apply(store, schoolSession());
  });
}

function writeSchedules(req, apply, related = []) {
  return writePeriodRecords(req, ['masterPeriods', ...related], async (store, scope) =>
    apply(store, await store.find('masterPeriods', scope)));
}

async function saveDefault(store, schedules, choice) {
  for (const schedule of schedules) {
    const isDefault = idOf(schedule) === idOf(choice);
    if (Boolean(schedule.isDefault) !== isDefault) {
      await store.update('masterPeriods', idOf(schedule), { isDefault });
    }
  }
}

export function saveMasterPeriod(req, { id } = {}) {
  return writeSchedules(req, async (store, schedules) => {
    const existing = id ? findSchedule(schedules, id) : null;
    const fields = scheduleFields(req.body || {}, existing);
    const group = schedules.filter((item) => typeOf(item) === fields.scheduleType);
    const oldDefault = defaultMasterPeriod(group, fields.scheduleType);
    if (req.body?.isDefault === true && !active(fields)) throw procurementError('An inactive schedule cannot be the default.');
    const schedule = existing
      ? await store.update('masterPeriods', idOf(existing), fields)
      : await store.create('masterPeriods', { ...fields, ...schoolSession(), createdBy: req.user?.name || 'admin' });
    const updatedGroup = [...group.filter((item) => idOf(item) !== idOf(schedule)), schedule];
    const choice = req.body?.isDefault === true ? schedule
      : updatedGroup.find((item) => idOf(item) === idOf(oldDefault) && active(item)) || defaultMasterPeriod(updatedGroup, fields.scheduleType);
    await saveDefault(store, updatedGroup, choice);
    return { ...normalizeSchedule(schedule), isDefault: idOf(schedule) === idOf(choice) };
  });
}

export function setDefaultMasterPeriod(req) {
  return writeSchedules(req, async (store, schedules) => {
    const selected = findSchedule(schedules, req.params.id);
    if (!active(selected)) throw procurementError('An inactive schedule cannot be the default.');
    await saveDefault(store, schedules.filter((item) => typeOf(item) === typeOf(selected)), selected);
    return { ...normalizeSchedule(selected), isDefault: true };
  });
}

export function removeMasterPeriod(req) {
  return writeSchedules(req, async (store, schedules) => {
    const selected = findSchedule(schedules, req.params.id);
    const masterPeriodId = idOf(selected);
    if (await store.one('classTimetables', { masterPeriodId }) || await store.one('classRooms', { masterPeriodId })) {
      throw procurementError('This schedule is linked to a class timetable.', 409);
    }
    const remaining = schedules.filter((item) => typeOf(item) === typeOf(selected) && idOf(item) !== masterPeriodId);
    await store.remove('masterPeriods', masterPeriodId);
    await saveDefault(store, remaining, defaultMasterPeriod(remaining, typeOf(selected)));
  }, ['classTimetables', 'classRooms']);
}
