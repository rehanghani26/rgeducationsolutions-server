import mongoose from 'mongoose';
import MasterPeriod from '../models/MasterPeriod.js';
import ClassTimetable from '../models/ClassTimetable.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';

// ─── Helper: compute duration ─────────────────────────────────────────────────
const calcMinutes = (start, end) => {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
};

// ─── Helper: sanitize periods before database write ───────────────────────────
const sanitizePeriods = (periods = []) => {
  return periods.map((p, idx) => {
    const item = { ...p };
    // Remove _id if it's not a valid 24-character hex ObjectId
    if (item._id && !mongoose.Types.ObjectId.isValid(item._id)) {
      delete item._id;
    }
    return {
      ...item,
      order: idx + 1,
      durationMinutes: calcMinutes(item.startTime, item.endTime),
    };
  });
};

// ─── GET all master periods (both types) ──────────────────────────────────────
export const getMasterPeriods = async (req, res) => {
  try {
    const { type } = req.query; // ?type=regular | ?type=exam
    let list = [];
    const filter = type ? { scheduleType: type } : {};

    if (checkFallback()) {
      list = (FallbackDb.find('masterPeriods') || []).filter(
        (r) => !type || r.scheduleType === type
      );
    } else {
      list = await MasterPeriod.find(filter).sort({ createdAt: -1 });
    }
    return res.json({ success: true, schedules: list });
  } catch (err) {
    console.error('getMasterPeriods error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// ─── GET single master period by id ───────────────────────────────────────────
export const getMasterPeriodById = async (req, res) => {
  try {
    const { id } = req.params;
    let schedule = null;

    if (checkFallback()) {
      schedule = (FallbackDb.find('masterPeriods') || []).find(
        (r) => String(r._id) === String(id) || String(r.id) === String(id)
      );
    } else {
      if (mongoose.Types.ObjectId.isValid(id)) {
        schedule = await MasterPeriod.findById(id);
      }
    }

    if (!schedule) {
      return res.status(404).json({ success: false, message: 'Schedule not found' });
    }
    return res.json({ success: true, schedule });
  } catch (err) {
    console.error('getMasterPeriodById error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// ─── CREATE master period schedule ────────────────────────────────────────────
export const createMasterPeriod = async (req, res) => {
  try {
    const { scheduleType, name, schoolStartTime, schoolEndTime, days, periods = [] } = req.body;

    if (!scheduleType || !schoolStartTime || !schoolEndTime) {
      return res.status(400).json({
        success: false,
        message: 'scheduleType, schoolStartTime, and schoolEndTime are required',
      });
    }

    const enrichedPeriods = sanitizePeriods(periods);

    let schedule;
    if (checkFallback()) {
      schedule = {
        _id: `mp-${Date.now()}`,
        scheduleType,
        name: name || `${scheduleType} Schedule`,
        schoolStartTime,
        schoolEndTime,
        days: days || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
        periods: enrichedPeriods,
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
          ...(days && { days }),
          periods: enrichedPeriods,
          createdBy: req.user?.name || 'admin',
        },
        { new: true, upsert: true }
      );
    }

    return res.status(201).json({ success: true, schedule });
  } catch (err) {
    console.error('createMasterPeriod error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// ─── UPDATE master period (replace periods) ────────────────────────────────────
export const updateMasterPeriod = async (req, res) => {
  try {
    const { id } = req.params;
    const { scheduleType, schoolStartTime, schoolEndTime, name, days, periods = [], isActive } = req.body;

    const enrichedPeriods = sanitizePeriods(periods);

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
          days: days || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
          periods: enrichedPeriods,
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
          days: days || all[idx].days,
          periods: enrichedPeriods,
          isActive: isActive !== undefined ? isActive : all[idx].isActive,
          updatedAt: new Date().toISOString(),
        };
        FallbackDb.updateAll('masterPeriods', all);
        schedule = all[idx];
      }
    } else {
      if (mongoose.Types.ObjectId.isValid(id)) {
        schedule = await MasterPeriod.findByIdAndUpdate(
          id,
          {
            ...(name && { name }),
            ...(schoolStartTime && { schoolStartTime }),
            ...(schoolEndTime && { schoolEndTime }),
            ...(days && { days }),
            periods: enrichedPeriods,
            ...(isActive !== undefined && { isActive }),
          },
          { new: true }
        );
      }

      if (!schedule && scheduleType) {
        schedule = await MasterPeriod.findOneAndUpdate(
          { scheduleType },
          {
            scheduleType,
            name: name || `${scheduleType} Schedule`,
            schoolStartTime,
            schoolEndTime,
            ...(days && { days }),
            periods: enrichedPeriods,
            ...(isActive !== undefined && { isActive }),
          },
          { new: true, upsert: true }
        );
      }
    }

    return res.json({ success: true, schedule });
  } catch (err) {
    console.error('updateMasterPeriod error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// ─── DELETE master period ──────────────────────────────────────────────────────
export const deleteMasterPeriod = async (req, res) => {
  try {
    const { id } = req.params;

    if (checkFallback()) {
      const all = (FallbackDb.find('masterPeriods') || []).filter(
        (r) => String(r._id) !== String(id) && String(r.id) !== String(id)
      );
      FallbackDb.updateAll('masterPeriods', all);
    } else {
      if (mongoose.Types.ObjectId.isValid(id)) {
        const deleted = await MasterPeriod.findByIdAndDelete(id);
        if (!deleted) {
          return res.status(404).json({ success: false, message: 'Schedule not found' });
        }
      } else {
        return res.status(404).json({ success: false, message: 'Schedule not found' });
      }
    }

    return res.json({ success: true, message: 'Schedule deleted successfully' });
  } catch (err) {
    console.error('deleteMasterPeriod error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// ─── GET class timetable by class or list all ────────────────────────────────────
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
        return res.json({ success: true, timetable: found || null, timetables: all });
      }
      return res.json({ success: true, timetables: all });
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
      return res.json({ success: true, timetable, timetables: all });
    }

    const timetables = await ClassTimetable.find({ scheduleType });
    return res.json({ success: true, timetables });
  } catch (err) {
    console.error('getClassTimetable error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// ─── SAVE / UPDATE class timetable allocations ─────────────────────────────────
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
      return res.status(400).json({
        success: false,
        message: 'className or classId is required',
      });
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

    return res.status(200).json({ success: true, timetable });
  } catch (err) {
    console.error('saveClassTimetable error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// ─── DELETE class timetable ───────────────────────────────────────────────────
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
      if (mongoose.Types.ObjectId.isValid(id)) {
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

    return res.json({ success: true, message: 'Class timetable deleted successfully' });
  } catch (err) {
    console.error('deleteClassTimetable error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};


