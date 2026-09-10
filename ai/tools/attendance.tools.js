/**
 * @file attendance.tools.js
 * @description AI Tool definitions and executors for the Attendance module.
 */

import Attendance from '../../models/Attendance.js';
import Student from '../../models/Student.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';
import mongoose from 'mongoose';

export const attendanceToolDefinitions = [
  {
    name: 'getAttendanceByDate',
    description:
      'Get attendance records for a specific date. Use for "attendance yesterday", "who was absent today?", "attendance on 2026-09-08".',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Date in YYYY-MM-DD format. Resolve relative dates (today, yesterday) before calling.',
        },
        classId: {
          type: 'string',
          description: 'Optional class ID to filter attendance for a specific class.',
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'getStudentAttendance',
    description:
      'Get attendance history for a specific student. Use when user asks about one student\'s attendance record.',
    parameters: {
      type: 'object',
      properties: {
        studentId: {
          type: 'string',
          description: 'Student MongoDB ID.',
        },
        studentName: {
          type: 'string',
          description: 'Student name (used to look up ID if studentId is not available).',
        },
      },
    },
  },
  {
    name: 'getAttendanceStats',
    description:
      'Get aggregated attendance statistics for a month. Returns present/absent/late counts and percentage.',
    parameters: {
      type: 'object',
      properties: {
        month: {
          type: 'number',
          description: 'Month number (1-12). Defaults to current month.',
        },
        year: {
          type: 'number',
          description: 'Year (e.g. 2026). Defaults to current year.',
        },
        classId: {
          type: 'string',
          description: 'Optional class ID filter.',
        },
      },
    },
  },
  {
    name: 'getLowAttendanceStudents',
    description:
      'Find students with attendance below a threshold percentage. Use for "students with attendance below 75%".',
    parameters: {
      type: 'object',
      properties: {
        threshold: {
          type: 'number',
          description: 'Minimum attendance percentage (e.g., 75 means below 75%). Default: 75.',
        },
        class: {
          type: 'string',
          description: 'Optional class name filter.',
        },
      },
    },
  },
];

export const attendanceToolExecutors = {
  async getAttendanceByDate(args, context) {
    if (!args.date) return { success: false, error: 'Date is required.' };

    const dateObj = new Date(args.date);
    if (isNaN(dateObj.getTime())) {
      return { success: false, error: `Invalid date format: "${args.date}". Use YYYY-MM-DD.` };
    }

    let records = [];
    if (checkFallback()) {
      let all = FallbackDb.find('attendance') || [];
      if (args.classId) all = all.filter((a) => a.classId === args.classId);
      records = all.filter((a) => {
        const d = new Date(a.date);
        return d.toDateString() === dateObj.toDateString();
      });
    } else {
      const filter = {
        date: {
          $gte: new Date(dateObj.setHours(0, 0, 0, 0)),
          $lt: new Date(dateObj.setHours(23, 59, 59, 999)),
        },
      };
      if (args.classId && mongoose.Types.ObjectId.isValid(args.classId)) {
        filter.classId = args.classId;
      }
      records = await Attendance.find(filter).populate('classId', 'name');
    }

    if (records.length === 0) {
      return {
        success: true,
        date: args.date,
        message: `No attendance records found for ${args.date}.`,
        records: [],
      };
    }

    // Aggregate across all records for this date
    let totalPresent = 0, totalAbsent = 0, totalLate = 0, totalStudents = 0;
    const absentStudents = [];

    for (const rec of records) {
      const studentList = rec.students || rec.attendance || rec.records || [];
      totalPresent += rec.present || studentList.filter((s) => s.status === 'present').length;
      totalAbsent += rec.absent || studentList.filter((s) => s.status === 'absent').length;
      totalLate += rec.late || studentList.filter((s) => s.status === 'late').length;
      totalStudents += rec.total || studentList.length;

      studentList
        .filter((s) => s.status === 'absent')
        .forEach((s) => absentStudents.push({ name: s.name, className: rec.className || rec.classSection }));
    }

    return {
      success: true,
      date: args.date,
      summary: {
        totalStudents,
        present: totalPresent,
        absent: totalAbsent,
        late: totalLate,
        attendanceRate: totalStudents
          ? `${Math.round((totalPresent / totalStudents) * 100)}%`
          : '0%',
      },
      absentStudents: absentStudents.slice(0, 20),
      recordCount: records.length,
    };
  },

  async getStudentAttendance(args, context) {
    let studentId = args.studentId;

    // Look up by name if no ID provided
    if (!studentId && args.studentName) {
      if (checkFallback()) {
        const s = FallbackDb.findOne('students', null)
          ? (FallbackDb.find('students') || []).find(
              (s) => s.name?.toLowerCase().includes(args.studentName.toLowerCase())
            )
          : null;
        if (s) studentId = s.id || s._id;
      } else {
        const s = await Student.findOne({
          name: new RegExp(args.studentName, 'i'),
        }).select('_id name');
        if (s) studentId = s._id.toString();
      }

      if (!studentId) {
        return { success: false, error: `No student found with name "${args.studentName}".` };
      }
    }

    if (!studentId) {
      return { success: false, error: 'Either studentId or studentName is required.' };
    }

    let logs = [];
    if (checkFallback()) {
      const all = FallbackDb.find('attendance') || [];
      all.forEach((att) => {
        const studentList = att.students || att.attendance || att.records || [];
        const item = studentList.find(
          (r) => String(r.studentId || r.memberId || r.id) === String(studentId)
        );
        if (item) {
          logs.push({
            date: att.date ? new Date(att.date).toISOString().split('T')[0] : '-',
            status: item.status,
            class: att.className || att.classSection || '-',
          });
        }
      });
    } else {
      const filter = {
        $or: [
          { 'students.studentId': studentId },
          { 'records.memberId': mongoose.Types.ObjectId.isValid(studentId) ? studentId : null },
        ],
      };
      const records = await Attendance.find(filter).sort({ date: -1 }).limit(60);
      records.forEach((att) => {
        const studentList = att.students || att.attendance || att.records || [];
        const item = studentList.find((r) => String(r.studentId || r.memberId) === String(studentId));
        if (item) {
          logs.push({
            date: att.date ? new Date(att.date).toISOString().split('T')[0] : '-',
            status: item.status,
            class: att.className || att.classSection || '-',
          });
        }
      });
    }

    const totalDays = logs.length;
    const presentCount = logs.filter((l) => l.status === 'present').length;
    const absentCount = logs.filter((l) => l.status === 'absent').length;
    const lateCount = logs.filter((l) => l.status === 'late').length;
    const percentage = totalDays ? Math.round((presentCount / totalDays) * 100) : 100;

    return {
      success: true,
      studentId,
      summary: { totalDays, presentCount, absentCount, lateCount, percentage: `${percentage}%` },
      recentLogs: logs.slice(0, 30),
    };
  },

  async getAttendanceStats(args, context) {
    const targetMonth = args.month || new Date().getMonth() + 1;
    const targetYear = args.year || new Date().getFullYear();

    let records = checkFallback()
      ? FallbackDb.find('attendance') || []
      : await Attendance.find(args.classId ? { classId: args.classId } : {});

    records = records.filter((r) => {
      const d = new Date(r.date);
      return d.getMonth() + 1 === targetMonth && d.getFullYear() === targetYear;
    });

    let present = 0, absent = 0, late = 0;
    records.forEach((r) => {
      (r.records || r.students || r.attendance || []).forEach((rec) => {
        if (rec.status === 'present') present++;
        else if (rec.status === 'absent') absent++;
        else if (rec.status === 'late') late++;
      });
    });

    const total = present + absent + late;
    const monthName = new Date(targetYear, targetMonth - 1, 1)
      .toLocaleString('en', { month: 'long' });

    return {
      success: true,
      period: `${monthName} ${targetYear}`,
      stats: {
        present, absent, late, total,
        attendanceRate: total ? `${Math.round((present / total) * 100)}%` : 'N/A',
        recordsCount: records.length,
      },
    };
  },

  async getLowAttendanceStudents(args, context) {
    const threshold = args.threshold || 75;

    // This requires computing per-student attendance from records
    let allAttendance = checkFallback()
      ? FallbackDb.find('attendance') || []
      : await Attendance.find({});

    const studentStats = {};

    for (const att of allAttendance) {
      const studentList = att.students || att.attendance || att.records || [];
      for (const s of studentList) {
        const sid = String(s.studentId || s.memberId || s.id || '');
        if (!sid) continue;
        if (!studentStats[sid]) {
          studentStats[sid] = { name: s.name || 'Unknown', present: 0, total: 0 };
        }
        studentStats[sid].total++;
        if (s.status === 'present') studentStats[sid].present++;
      }
    }

    const lowAttendance = Object.entries(studentStats)
      .map(([id, st]) => ({
        studentId: id,
        name: st.name,
        percentage: st.total ? Math.round((st.present / st.total) * 100) : 0,
        daysPresent: st.present,
        totalDays: st.total,
      }))
      .filter((s) => s.percentage < threshold)
      .sort((a, b) => a.percentage - b.percentage);

    return {
      success: true,
      threshold: `${threshold}%`,
      count: lowAttendance.length,
      students: lowAttendance.slice(0, 25),
    };
  },
};
