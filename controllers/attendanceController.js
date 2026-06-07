import Attendance from '../models/Attendance.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';
import { parsePagination, paginateResult, paginateArray } from '../utils/paginateQuery.js';
import { logActivity } from '../utils/activityLogger.js';

export const getAttendanceRecords = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { classId, date, type } = req.query;

    if (checkFallback()) {
      let list = FallbackDb.find('attendance') || [];
      if (classId) list = list.filter((a) => a.classId === classId);
      if (date) list = list.filter((a) => new Date(a.date).toDateString() === new Date(date).toDateString());
      if (type) list = list.filter((a) => a.type === type);
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      const total = list.length;
      const data = list.slice(skip, skip + limit);
      return res.json({ success: true, records: data, ...paginateResult(data, total, { page, limit }) });
    }

    const filter = {};
    if (classId) filter.classId = classId;
    if (date) {
      const d = new Date(date);
      filter.date = { $gte: new Date(d.setHours(0, 0, 0, 0)), $lt: new Date(d.setHours(23, 59, 59, 999)) };
    }
    if (type) filter.type = type;

    const [records, total] = await Promise.all([
      Attendance.find(filter).populate('classId', 'name code').sort({ date: -1 }).skip(skip).limit(limit),
      Attendance.countDocuments(filter),
    ]);

    return res.json({ success: true, records, ...paginateResult(records, total, { page, limit }) });
  } catch (error) {
    console.error('getAttendanceRecords error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getAttendanceById = async (req, res) => {
  try {
    const { id } = req.params;
    const record = checkFallback()
      ? FallbackDb.findById('attendance', id)
      : await Attendance.findById(id).populate('classId', 'name code');

    if (!record) return res.status(404).json({ success: false, message: 'Attendance record not found' });
    return res.json({ success: true, record });
  } catch (error) {
    console.error('getAttendanceById error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createAttendance = async (req, res) => {
  try {
    const { date, classId, records, type } = req.body;
    if (!date || !records?.length) {
      return res.status(400).json({ success: false, message: 'Date and attendance records are required' });
    }

    let record;
    if (checkFallback()) {
      record = FallbackDb.create('attendance', { date, classId, records, type: type || 'student' });
    } else {
      record = await Attendance.create({ date, classId, records, type: type || 'student' });
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CREATE',
      module: 'attendance',
      recordId: record.id || record._id,
      details: `Marked attendance for ${records.length} members`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({ success: true, message: 'Attendance recorded', record });
  } catch (error) {
    console.error('createAttendance error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

export const getAttendanceStats = async (req, res) => {
  try {
    const { classId, month, year } = req.query;
    const targetMonth = parseInt(month, 10) || new Date().getMonth() + 1;
    const targetYear = parseInt(year, 10) || new Date().getFullYear();

    let records = checkFallback() ? FallbackDb.find('attendance') || [] : await Attendance.find(classId ? { classId } : {});

    records = records.filter((r) => {
      const d = new Date(r.date);
      return d.getMonth() + 1 === targetMonth && d.getFullYear() === targetYear;
    });

    let present = 0;
    let absent = 0;
    let late = 0;
    records.forEach((r) => {
      (r.records || []).forEach((rec) => {
        if (rec.status === 'present') present++;
        else if (rec.status === 'absent') absent++;
        else if (rec.status === 'late') late++;
      });
    });

    const total = present + absent + late;
    const percentage = total ? Math.round((present / total) * 100) : 0;

    return res.json({
      success: true,
      stats: { present, absent, late, total, percentage, recordsCount: records.length },
    });
  } catch (error) {
    console.error('getAttendanceStats error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
