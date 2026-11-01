// 2. External packages
import mongoose from 'mongoose';

// 3. Configuration
import { checkFallback } from '../config/db.js';

// 4. Models
import MasterPeriod from '../models/MasterPeriod.js';
import ClassTimetable from '../models/ClassTimetable.js';

// 6. Services
import { FallbackDb } from '../services/dbFallback.js';

// 7. Utilities
import { isValidObjectId } from '../utils/commonUtil.js';
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError
} from '../utils/responseUtil.js';

/**
 * Computes difference in minutes between two HH:MM time strings.
 *
 * @param {string} start - Start time (HH:MM).
 * @param {string} end - End time (HH:MM).
 * @returns {number} Duration in minutes.
 */
const calcMinutes = (start, end) => {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
};

/**
 * Sanitizes periods array before persistence, ensuring sequential order and duration calculation.
 *
 * @param {Array<Object>} [periods=[]] - Period definitions.
 * @returns {Array<Object>} Sanitized periods.
 */
const sanitizePeriods = (periods = []) => {
  return periods.map((p, idx) => {
    const item = { ...p };
    if (item._id && !isValidObjectId(item._id)) {
      delete item._id;
    }
    return {
      ...item,
      order: idx + 1,
      durationMinutes: calcMinutes(item.startTime, item.endTime),
    };
  });
};

/** Default Saturday half-day slots template */
const DEFAULT_SATURDAY_PERIODS = [
  { order: 1, type: 'prayer', customLabel: 'Morning Prayer & Assembly', startTime: '08:00', endTime: '08:20', durationMinutes: 20 },
  { order: 2, type: 'class', customLabel: 'Period 1', startTime: '08:20', endTime: '09:05', durationMinutes: 45 },
  { order: 3, type: 'class', customLabel: 'Period 2', startTime: '09:05', endTime: '09:50', durationMinutes: 45 },
  { order: 4, type: 'recess', customLabel: 'Fruit Recess', startTime: '09:50', endTime: '10:15', durationMinutes: 25 },
  { order: 5, type: 'class', customLabel: 'Period 3', startTime: '10:15', endTime: '11:00', durationMinutes: 45 },
  { order: 6, type: 'class', customLabel: 'Period 4', startTime: '11:00', endTime: '11:45', durationMinutes: 45 },
  { order: 7, type: 'leave', customLabel: 'School Dispersal', startTime: '11:45', endTime: '12:00', durationMinutes: 15 },
];

/**
 * Sanitizes day-specific schedules ensuring every active day is mapped and populated.
 *
 * @param {Object} [daySchedules={}] - Input day schedules map.
 * @param {string} [defaultStart='07:00'] - Default start time.
 * @param {string} [defaultEnd='14:00'] - Default end time.
 * @param {Array<string>} [operatingDays] - Active operating days.
 * @param {Array<Object>} [defaultPeriods=[]] - Standard period templates.
 * @returns {Object} Sanitized day schedules map.
 */
const sanitizeDaySchedules = (
  daySchedules = {},
  defaultStart = '07:00',
  defaultEnd = '14:00',
  operatingDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
  defaultPeriods = []
) => {
  const result = {};
  const inputMap = daySchedules && typeof daySchedules === 'object' ? daySchedules : {};
  const activeDays = operatingDays && operatingDays.length > 0
    ? operatingDays
    : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  activeDays.forEach((dayKey) => {
    const isSat = dayKey.toLowerCase() === 'saturday';
    const ds = inputMap[dayKey];

    if (ds && Array.isArray(ds.periods) && ds.periods.length > 0) {
      result[dayKey] = {
        day: dayKey,
        dayLabel: ds.dayLabel || (dayKey.charAt(0).toUpperCase() + dayKey.slice(1)),
        enabled: ds.enabled !== undefined ? Boolean(ds.enabled) : true,
        isHalfDay: ds.isHalfDay !== undefined ? Boolean(ds.isHalfDay) : isSat,
        name: ds.name || (isSat ? 'Saturday Half Day' : `${dayKey.charAt(0).toUpperCase() + dayKey.slice(1)} Schedule`),
        schoolStartTime: ds.schoolStartTime || (isSat ? '08:00' : defaultStart),
        schoolEndTime: ds.schoolEndTime || (isSat ? '12:00' : defaultEnd),
        periods: sanitizePeriods(ds.periods),
      };
    } else {
      result[dayKey] = {
        day: dayKey,
        dayLabel: dayKey.charAt(0).toUpperCase() + dayKey.slice(1),
        enabled: true,
        isHalfDay: isSat,
        name: isSat ? 'Saturday Half Day' : `${dayKey.charAt(0).toUpperCase() + dayKey.slice(1)} Schedule`,
        schoolStartTime: isSat ? '08:00' : defaultStart,
        schoolEndTime: isSat ? '12:00' : defaultEnd,
        periods: isSat ? DEFAULT_SATURDAY_PERIODS : sanitizePeriods(defaultPeriods),
      };
    }
  });

  Object.keys(inputMap).forEach((k) => {
    if (!result[k] && inputMap[k]) {
      const ex = inputMap[k];
      result[k] = {
        day: k,
        dayLabel: ex.dayLabel || (k.charAt(0).toUpperCase() + k.slice(1)),
        enabled: ex.enabled !== undefined ? Boolean(ex.enabled) : true,
        isHalfDay: Boolean(ex.isHalfDay),
        name: ex.name || `${k.charAt(0).toUpperCase() + k.slice(1)} Schedule`,
        schoolStartTime: ex.schoolStartTime || defaultStart,
        schoolEndTime: ex.schoolEndTime || defaultEnd,
        periods: sanitizePeriods(ex.periods || []),
      };
    }
  });

  return result;
};

/**
 * Enriches a schedule document with completed day-wise breakdown.
 *
 * @param {Object} schedule - Schedule document.
 * @returns {Object} Enriched schedule.
 */
const enrichScheduleWithDayWise = (schedule) => {
  if (!schedule) return schedule;
  const doc = schedule.toObject ? schedule.toObject() : { ...schedule };
  const days = doc.days && doc.days.length > 0
    ? doc.days
    : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

  const defaultStart = doc.schoolStartTime || '07:00';
  const defaultEnd = doc.schoolEndTime || '14:00';
  const defaultPeriods = sanitizePeriods(doc.periods || []);

  doc.daySchedules = sanitizeDaySchedules(
    doc.daySchedules,
    defaultStart,
    defaultEnd,
    days,
    defaultPeriods
  );

  return doc;
};

/**
 * Retrieves all master period schedules.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getMasterPeriods = async (req, res) => {
  try {
    const { type } = req.query;
    let list = [];
    const filter = type ? { scheduleType: type } : {};

    if (checkFallback()) {
      list = (FallbackDb.find('masterPeriods') || []).filter(
        (r) => !type || r.scheduleType === type
      );
    } else {
      list = await MasterPeriod.find(filter).sort({ createdAt: -1 });
    }

    const enrichedList = list.map((item) => enrichScheduleWithDayWise(item));
    return sendSuccess(res, undefined, { schedules: enrichedList });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Retrieves a single master period schedule by ID.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getMasterPeriodById = async (req, res) => {
  try {
    const { id } = req.params;
    let schedule = null;

    if (checkFallback()) {
      schedule = (FallbackDb.find('masterPeriods') || []).find(
        (r) => String(r._id) === String(id) || String(r.id) === String(id)
      );
    } else {
      if (isValidObjectId(id)) {
        schedule = await MasterPeriod.findById(id);
      }
    }

    if (!schedule) {
      return sendNotFound(res, 'Schedule not found');
    }
    return sendSuccess(res, undefined, { schedule: enrichScheduleWithDayWise(schedule) });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Creates or upserts a master period schedule template.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const createMasterPeriod = async (req, res) => {
  try {
    const {
      scheduleType,
      name,
      schoolStartTime,
      schoolEndTime,
      days,
      periods = [],
      daySchedules = {},
      isConfigured = true,
    } = req.body;

    if (!scheduleType || !schoolStartTime || !schoolEndTime) {
      return sendBadRequest(res, 'scheduleType, schoolStartTime, and schoolEndTime are required');
    }

    const activeDays = days && days.length > 0
      ? days
      : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const enrichedPeriods = sanitizePeriods(periods);
    const enrichedDaySchedules = sanitizeDaySchedules(
      daySchedules,
      schoolStartTime,
      schoolEndTime,
      activeDays,
      enrichedPeriods
    );

    let schedule;
    if (checkFallback()) {
      schedule = {
        _id: `mp-${Date.now()}`,
        scheduleType,
        name: name || `${scheduleType} Schedule`,
        schoolStartTime,
        schoolEndTime,
        days: activeDays,
        periods: enrichedPeriods,
        daySchedules: enrichedDaySchedules,
        isConfigured: Boolean(isConfigured),
        isActive: true,
        createdBy: req.user?.name || 'admin',
        createdAt: new Date().toISOString(),
      };
      FallbackDb.insert('masterPeriods', schedule);
    } else {
      schedule = await MasterPeriod.findOneAndUpdate(
        { scheduleType },
        {
          scheduleType,
          name: name || `${scheduleType} Schedule`,
          schoolStartTime,
          schoolEndTime,
          days: activeDays,
          periods: enrichedPeriods,
          daySchedules: enrichedDaySchedules,
          isConfigured: Boolean(isConfigured),
          createdBy: req.user?.name || 'admin',
        },
        { new: true, upsert: true }
      );
    }

    return sendCreated(res, undefined, { schedule: enrichScheduleWithDayWise(schedule) });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Updates a master period schedule template.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const updateMasterPeriod = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      scheduleType,
      schoolStartTime,
      schoolEndTime,
      name,
      days,
      periods = [],
      daySchedules = {},
      isConfigured = true,
      isActive,
    } = req.body;

    const activeDays = days && days.length > 0
      ? days
      : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const enrichedPeriods = sanitizePeriods(periods);
    const enrichedDaySchedules = sanitizeDaySchedules(
      daySchedules,
      schoolStartTime,
      schoolEndTime,
      activeDays,
      enrichedPeriods
    );

    let schedule;
    if (checkFallback()) {
      const all = FallbackDb.find('masterPeriods') || [];
      const idx = all.findIndex(
        (r) => String(r._id) === String(id) || String(r.id) === String(id)
      );
      if (idx === -1) {
        schedule = {
          _id: `mp-${Date.now()}`,
          scheduleType: scheduleType || 'regular',
          name: name || 'Schedule',
          schoolStartTime,
          schoolEndTime,
          days: activeDays,
          periods: enrichedPeriods,
          daySchedules: enrichedDaySchedules,
          isConfigured: Boolean(isConfigured),
          isActive: true,
          createdBy: req.user?.name || 'admin',
          createdAt: new Date().toISOString(),
        };
        FallbackDb.insert('masterPeriods', schedule);
      } else {
        all[idx] = {
          ...all[idx],
          name: name || all[idx].name,
          schoolStartTime: schoolStartTime || all[idx].schoolStartTime,
          schoolEndTime: schoolEndTime || all[idx].schoolEndTime,
          days: activeDays,
          periods: enrichedPeriods,
          daySchedules: enrichedDaySchedules,
          isConfigured: isConfigured !== undefined ? Boolean(isConfigured) : all[idx].isConfigured,
          isActive: isActive !== undefined ? isActive : all[idx].isActive,
          updatedAt: new Date().toISOString(),
        };
        FallbackDb.updateAll('masterPeriods', all);
        schedule = all[idx];
      }
    } else {
      const updateData = {
        ...(name && { name }),
        ...(schoolStartTime && { schoolStartTime }),
        ...(schoolEndTime && { schoolEndTime }),
        days: activeDays,
        periods: enrichedPeriods,
        daySchedules: enrichedDaySchedules,
        isConfigured: isConfigured !== undefined ? Boolean(isConfigured) : true,
        ...(isActive !== undefined && { isActive }),
      };

      if (isValidObjectId(id)) {
        schedule = await MasterPeriod.findByIdAndUpdate(id, updateData, { new: true });
      }

      if (!schedule && scheduleType) {
        schedule = await MasterPeriod.findOneAndUpdate(
          { scheduleType },
          {
            scheduleType,
            name: name || `${scheduleType} Schedule`,
            ...updateData,
          },
          { new: true, upsert: true }
        );
      }
    }

    return sendSuccess(res, undefined, { schedule: enrichScheduleWithDayWise(schedule) });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Deletes a master period schedule template.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const deleteMasterPeriod = async (req, res) => {
  try {
    const { id } = req.params;

    if (checkFallback()) {
      const all = (FallbackDb.find('masterPeriods') || []).filter(
        (r) => String(r._id) !== String(id) && String(r.id) !== String(id)
      );
      FallbackDb.updateAll('masterPeriods', all);
    } else {
      if (isValidObjectId(id)) {
        const deleted = await MasterPeriod.findByIdAndDelete(id);
        if (!deleted) {
          return sendNotFound(res, 'Schedule not found');
        }
      } else {
        return sendNotFound(res, 'Schedule not found');
      }
    }

    return sendSuccess(res, 'Schedule deleted successfully');
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Retrieves class timetable by class key or all timetables.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getClassTimetable = async (req, res) => {
  try {
    const { classSection, classId, className, scheduleType = 'regular' } = req.query;
    const targetClass = className || classSection;

    if (checkFallback()) {
      const all = FallbackDb.find('classTimetables') || [];
      if (targetClass || classId) {
        const found = all.find(
          (t) =>
            (t.classSectionKey === targetClass ||
              t.className === targetClass ||
              (classId && t.classId === classId)) &&
            (t.scheduleType || 'regular') === scheduleType
        );
        return sendSuccess(res, undefined, { timetable: found || null, timetables: all });
      }
      return sendSuccess(res, undefined, { timetables: all });
    }

    if (targetClass || classId) {
      const filter = {
        $or: [
          { classSectionKey: targetClass },
          { className: targetClass },
          ...(classId ? [{ classId }] : []),
        ],
        scheduleType,
      };
      const timetable = await ClassTimetable.findOne(filter);
      const all = await ClassTimetable.find({ scheduleType });
      return sendSuccess(res, undefined, { timetable, timetables: all });
    }

    const timetables = await ClassTimetable.find({ scheduleType });
    return sendSuccess(res, undefined, { timetables });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Saves or updates period allocations for a class timetable.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const saveClassTimetable = async (req, res) => {
  try {
    const {
      classSectionKey,
      classId = '',
      sectionId = '',
      className,
      sectionName = '',
      scheduleType = 'regular',
      allocations = [],
    } = req.body;

    const targetClassName = className || classSectionKey || classId;

    if (!targetClassName) {
      return sendBadRequest(res, 'className or classId is required');
    }

    const resolvedKey = classSectionKey || targetClassName;

    let timetable;
    if (checkFallback()) {
      const all = FallbackDb.find('classTimetables') || [];
      const idx = all.findIndex(
        (t) =>
          (t.classSectionKey === resolvedKey ||
            t.className === targetClassName ||
            (classId && t.classId === classId)) &&
          (t.scheduleType || 'regular') === scheduleType
      );

      const record = {
        _id: idx !== -1 ? all[idx]._id : `ct-${Date.now()}`,
        classSectionKey: resolvedKey,
        classId: classId || (idx !== -1 ? all[idx].classId : ''),
        sectionId: sectionId || '',
        className: targetClassName,
        sectionName: sectionName || '',
        scheduleType,
        allocations,
        updatedAt: new Date().toISOString(),
        createdAt: idx !== -1 ? all[idx].createdAt : new Date().toISOString(),
      };

      if (idx !== -1) {
        all[idx] = record;
      } else {
        all.push(record);
      }
      FallbackDb.updateAll('classTimetables', all);
      timetable = record;
    } else {
      timetable = await ClassTimetable.findOneAndUpdate(
        {
          $or: [
            { classSectionKey: resolvedKey },
            { className: targetClassName },
            ...(classId ? [{ classId }] : []),
          ],
          scheduleType,
        },
        {
          classSectionKey: resolvedKey,
          ...(classId && { classId }),
          sectionId,
          className: targetClassName,
          sectionName,
          scheduleType,
          allocations,
          createdBy: req.user?.name || 'admin',
        },
        { new: true, upsert: true }
      );
    }

    return sendSuccess(res, undefined, { timetable });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Deletes a class timetable allocation.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const deleteClassTimetable = async (req, res) => {
  try {
    const { id } = req.params;

    if (checkFallback()) {
      const all = (FallbackDb.find('classTimetables') || []).filter(
        (r) =>
          String(r._id) !== String(id) &&
          String(r.id) !== String(id) &&
          String(r.classSectionKey) !== String(id) &&
          String(r.className) !== String(id) &&
          String(r.classId) !== String(id)
      );
      FallbackDb.updateAll('classTimetables', all);
    } else {
      if (isValidObjectId(id)) {
        await ClassTimetable.findByIdAndDelete(id);
      } else {
        await ClassTimetable.deleteMany({
          $or: [
            { classSectionKey: id },
            { className: id },
            { classId: id },
          ],
        });
      }
    }

    return sendSuccess(res, 'Class timetable deleted successfully');
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};
