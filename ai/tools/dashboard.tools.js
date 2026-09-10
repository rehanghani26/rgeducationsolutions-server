/**
 * @file dashboard.tools.js
 * @description AI Tool for dashboard/summary statistics.
 */

import Student from '../../models/Student.js';
import Teacher from '../../models/Teacher.js';
import Class from '../../models/Class.js';
import Fee from '../../models/Fee.js';
import Attendance from '../../models/Attendance.js';
import Exam from '../../models/Exam.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';

export const dashboardToolDefinitions = [
  {
    name: 'getDashboardStats',
    description:
      'Get high-level school statistics: total students, teachers, classes, fee summary, attendance rate. Use for "school overview", "executive summary", "dashboard stats", "how many students/teachers?".',
    parameters: { type: 'object', properties: {} },
  },
];

export const dashboardToolExecutors = {
  async getDashboardStats(args, context) {
    if (checkFallback()) {
      const students = FallbackDb.find('students') || [];
      const teachers = FallbackDb.find('teachers') || [];
      const classes = FallbackDb.find('classes') || [];
      const fees = FallbackDb.find('fees') || [];
      const exams = FallbackDb.find('exams') || [];

      const activeStudents = students.filter((s) => s.status === 'active').length;
      const activeTeachers = teachers.filter((t) => t.status === 'active').length;
      const totalPending = fees.reduce((s, f) => s + (f.amountPending || 0), 0);
      const upcomingExams = exams.filter((e) => e.status === 'upcoming').length;

      return {
        success: true,
        stats: {
          totalStudents: students.length,
          activeStudents,
          totalTeachers: teachers.length,
          activeTeachers,
          totalClasses: classes.length,
          totalPendingFees: `₹${Number(totalPending).toLocaleString('en-IN')}`,
          upcomingExams,
        },
      };
    }

    // MongoDB: run all counts in parallel for performance
    const [
      totalStudents,
      activeStudents,
      totalTeachers,
      activeTeachers,
      totalClasses,
      feeAgg,
      upcomingExams,
      todayAttendance,
    ] = await Promise.all([
      Student.countDocuments({}),
      Student.countDocuments({ status: 'active' }),
      Teacher.countDocuments({}),
      Teacher.countDocuments({ status: 'active' }),
      Class.countDocuments({}),
      Fee.aggregate([
        {
          $group: {
            _id: null,
            totalPaid: { $sum: '$amountPaid' },
            totalPending: { $sum: '$amountPending' },
            unpaidCount: { $sum: { $cond: [{ $eq: ['$status', 'unpaid'] }, 1, 0] } },
            partialCount: { $sum: { $cond: [{ $eq: ['$status', 'partial'] }, 1, 0] } },
          },
        },
      ]),
      Exam.countDocuments({ status: 'upcoming' }),
      Attendance.findOne({
        date: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lt: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      }),
    ]);

    const feeData = feeAgg[0] || {};

    return {
      success: true,
      stats: {
        totalStudents,
        activeStudents,
        totalTeachers,
        activeTeachers,
        totalClasses,
        totalCollected: `₹${Number(feeData.totalPaid || 0).toLocaleString('en-IN')}`,
        totalPendingFees: `₹${Number(feeData.totalPending || 0).toLocaleString('en-IN')}`,
        studentsWithUnpaidFees: (feeData.unpaidCount || 0) + (feeData.partialCount || 0),
        upcomingExams,
        attendanceMarkedToday: !!todayAttendance,
      },
    };
  },
};
