import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import Class from '../models/Class.js';
import Attendance from '../models/Attendance.js';
import Fee from '../models/Fee.js';
import Expense from '../models/Expense.js';
import Inventory from '../models/Inventory.js';
import Subject from '../models/Subject.js';
import Exam from '../models/Exam.js';
import Notification from '../models/Notification.js';

import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';

export const getStats = async (req, res) => {
  try {
    let stats = {};

    if (checkFallback()) {
      // Fetch from Fallback DB
      const students = FallbackDb.find('students');
      const teachers = FallbackDb.find('teachers');
      const classes = FallbackDb.find('classes');
      const fees = FallbackDb.find('fees');
      const expenses = FallbackDb.find('expenses');
      const inventory = FallbackDb.find('inventory');
      const subjects = FallbackDb.find('subjects');
      const exams = FallbackDb.find('exams');
      const attendance = FallbackDb.find('attendance');

      // Aggregate indicators
      const totalStudents = students.length;
      const totalTeachers = teachers.length;
      const totalClasses = classes.length;
      const totalStaff = totalTeachers + 5; // Simulating office staff

      // Today's attendance percentage
      const today = new Date().toISOString().split('T')[0];
      const todayLog = attendance.find(a => a.date === today) || attendance[0];
      let todayAttendanceRate = 92; // default mock fallback
      if (todayLog && todayLog.records.length > 0) {
        const presentCount = todayLog.records.filter(r => r.status === 'present').length;
        todayAttendanceRate = Math.round((presentCount / todayLog.records.length) * 100);
      }

      // Financials
      const feeCollectionToday = fees.reduce((acc, f) => acc + (f.amountPaid > 0 ? f.amountPaid * 0.05 : 0), 2500); // simulation
      const pendingFees = fees.reduce((acc, f) => acc + f.amountPending, 0);
      const schoolExpenses = expenses.reduce((acc, e) => acc + e.amount, 0);

      // Inventory
      const inventoryValue = inventory.reduce((acc, item) => acc + (item.quantity * item.price), 0);
      const activeCourses = subjects.length;
      const upcomingExams = exams.filter(e => e.status === 'upcoming').length;

      stats = {
        totalStudents,
        totalTeachers,
        totalClasses,
        totalStaff,
        todayAttendance: `${todayAttendanceRate}%`,
        feeCollectionToday: Math.round(feeCollectionToday),
        pendingFees,
        schoolExpenses,
        inventoryValue,
        activeCourses,
        upcomingExams,
        notificationsCount: FallbackDb.find('notifications').length
      };
    } else {
      // Fetch from real MongoDB using Mongoose
      const totalStudents = await Student.countDocuments();
      const totalTeachers = await Teacher.countDocuments();
      const totalClasses = await Class.countDocuments();
      const totalStaff = totalTeachers + 5;

      // Attendance
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayLog = await Attendance.findOne({ date: { $gte: today } });
      let todayAttendanceRate = 95;
      if (todayLog && todayLog.records.length > 0) {
        const presentCount = todayLog.records.filter(r => r.status === 'present').length;
        todayAttendanceRate = Math.round((presentCount / todayLog.records.length) * 100);
      }

      // Financials
      const allFees = await Fee.find();
      const pendingFees = allFees.reduce((acc, f) => acc + f.amountPending, 0);
      const allExpenses = await Expense.find();
      const schoolExpenses = allExpenses.reduce((acc, e) => acc + e.amount, 0);

      // Inventory
      const allInventory = await Inventory.find();
      const inventoryValue = allInventory.reduce((acc, item) => acc + (item.quantity * item.price), 0);

      const activeCourses = await Subject.countDocuments();
      const upcomingExams = await Exam.countDocuments({ status: 'upcoming' });
      const notificationsCount = await Notification.countDocuments();

      stats = {
        totalStudents,
        totalTeachers,
        totalClasses,
        totalStaff,
        todayAttendance: `${todayAttendanceRate}%`,
        feeCollectionToday: 4800, // mock today aggregate
        pendingFees,
        schoolExpenses,
        inventoryValue,
        activeCourses,
        upcomingExams,
        notificationsCount
      };
    }

    return res.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getCharts = async (req, res) => {
  try {
    // Generate analytics dataset
    const studentGrowth = [
      { name: 'Jan', students: 120 },
      { name: 'Feb', students: 135 },
      { name: 'Mar', students: 150 },
      { name: 'Apr', students: 180 },
      { name: 'May', students: 210 },
      { name: 'Jun', students: 245 }
    ];

    const feeCollection = [
      { name: 'Jan', collected: 45000, target: 50000 },
      { name: 'Feb', collected: 52000, target: 50000 },
      { name: 'Mar', collected: 49000, target: 50000 },
      { name: 'Apr', collected: 68000, target: 60000 },
      { name: 'May', collected: 72000, target: 70000 },
      { name: 'Jun', collected: 85000, target: 80000 }
    ];

    const attendanceRate = [
      { name: 'Mon', rate: 94 },
      { name: 'Tue', rate: 96 },
      { name: 'Wed', rate: 95 },
      { name: 'Thu', rate: 93 },
      { name: 'Fri', rate: 91 }
    ];

    const expenseCategory = [
      { name: 'Salaries', value: 620000 },
      { name: 'Utilities', value: 24000 },
      { name: 'Maintenance', value: 12000 },
      { name: 'Supplies', value: 9500 },
      { name: 'Transport', value: 45000 }
    ];

    const inventoryCategory = [
      { name: 'Books', value: 20250 },
      { name: 'Computers', value: 90000 },
      { name: 'Lab Equip', value: 9000 },
      { name: 'Furniture', value: 96000 },
      { name: 'Sports', value: 1950 }
    ];

    return res.json({
      success: true,
      data: {
        studentGrowth,
        feeCollection,
        attendanceRate,
        expenseCategory,
        inventoryCategory
      }
    });
  } catch (error) {
    console.error('Error fetching dashboard charts:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
