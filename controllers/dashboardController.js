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
import Result from '../models/Result.js';
import Library from '../models/Library.js';

import mongoose from 'mongoose';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';

export const getStats = async (req, res) => {
  try {
    let stats = {};
    const { role, id, profileId } = req.user;

    if (checkFallback()) {
      if (role === 'student') {
        const student = FallbackDb.findOne('students', { user: id }) || FallbackDb.findById('students', profileId);
        if (!student) {
          return res.status(404).json({ success: false, message: 'Student profile not found' });
        }
        const classDetails = FallbackDb.findById('classes', student.classId);
        const sectionDetails = FallbackDb.findById('sections', student.sectionId);
        let classTeacherName = '—';
        if (sectionDetails?.classTeacher) {
          const ct = FallbackDb.findById('teachers', sectionDetails.classTeacher);
          if (ct) classTeacherName = ct.name;
        }

        // Attendance rate
        const allAttendance = FallbackDb.find('attendance') || [];
        const classAttendance = allAttendance.filter(a => a.classId === student.classId);
        let presentCount = 0;
        let absentCount = 0;
        classAttendance.forEach(att => {
          const record = att.records.find(r => r.memberId === student.id);
          if (record) {
            if (record.status === 'present') presentCount++;
            else if (record.status === 'absent') absentCount++;
          }
        });
        const totalDays = presentCount + absentCount;
        const attendanceRate = totalDays > 0 ? Math.round((presentCount / totalDays) * 100) : 95;

        // Fee
        const fee = FallbackDb.findOne('fees', { studentId: student.id }) || { amountPaid: 0, amountPending: 5000, status: 'unpaid' };
        const upcomingExams = (FallbackDb.find('exams') || []).filter(e => e.status === 'upcoming');
        const libraryIssues = FallbackDb.find('library') || [];
        const booksIssued = libraryIssues.filter(l => l.studentId === student.id && !l.returnDate).length;

        stats = {
          role: 'student',
          studentName: student.name,
          rollNumber: student.rollNumber,
          admissionNumber: student.admissionNumber,
          className: classDetails?.name || '—',
          sectionName: sectionDetails?.name || '—',
          classTeacher: classTeacherName,
          attendanceRate: `${attendanceRate}%`,
          daysPresent: presentCount || 18,
          daysAbsent: absentCount || 1,
          totalFees: fee.amountPaid + fee.amountPending,
          paidFees: fee.amountPaid,
          pendingFees: fee.amountPending,
          feeStatus: fee.status,
          upcomingExamsCount: upcomingExams.length,
          booksIssued,
          activeCourses: (FallbackDb.find('subjects') || []).length
        };
      } else if (['teacher', 'head-teacher', 'hod', 'coordinator'].includes(role)) {
        const teacher = FallbackDb.findOne('teachers', { user: id }) || FallbackDb.findById('teachers', profileId);
        if (!teacher) {
          return res.status(404).json({ success: false, message: 'Teacher profile not found' });
        }
        const classesCount = (teacher.classesAssigned || []).length;
        const subjectsCount = (teacher.subjectsAssigned || []).length;

        const leaves = teacher.leaves || [];
        const pendingLeaves = leaves.filter(l => l.status === 'pending').length;
        const approvedLeaves = leaves.filter(l => l.status === 'approved').length;

        const section = FallbackDb.findOne('sections', { classTeacher: teacher.id });
        const classTeacherOf = section ? `${FallbackDb.findById('classes', section.classId)?.name || ''} - ${section.name}` : 'No';

        stats = {
          role: 'teacher',
          teacherName: teacher.name,
          employeeId: teacher.employeeId,
          designation: teacher.designation,
          department: teacher.department,
          salary: teacher.salary,
          attendanceRate: `${teacher.attendanceRate || 100}%`,
          classesCount,
          subjectsCount,
          pendingLeaves,
          approvedLeaves,
          classTeacherOf,
          upcomingExams: (FallbackDb.find('exams') || []).filter(e => e.status === 'upcoming').length,
          notificationsCount: FallbackDb.find('notifications').length
        };
      } else {
        // Fallback Database Global Admin stats
        const students = FallbackDb.find('students');
        const teachers = FallbackDb.find('teachers');
        const classes = FallbackDb.find('classes');
        const fees = FallbackDb.find('fees');
        const expenses = FallbackDb.find('expenses');
        const inventory = FallbackDb.find('inventory');
        const subjects = FallbackDb.find('subjects');
        const exams = FallbackDb.find('exams');
        const attendance = FallbackDb.find('attendance');

        const totalStudents = students.length;
        const totalTeachers = teachers.length;
        const totalClasses = classes.length;
        const totalStaff = totalTeachers + 5;

        const today = new Date().toISOString().split('T')[0];
        const todayLog = attendance.find(a => a.date === today) || attendance[0];
        let todayAttendanceRate = 92;
        if (todayLog && todayLog.records.length > 0) {
          const presentCount = todayLog.records.filter(r => r.status === 'present').length;
          todayAttendanceRate = Math.round((presentCount / todayLog.records.length) * 100);
        }

        const feeCollectionToday = fees.reduce((acc, f) => acc + (f.amountPaid > 0 ? f.amountPaid * 0.05 : 0), 2500);
        const pendingFees = fees.reduce((acc, f) => acc + f.amountPending, 0);
        const schoolExpenses = expenses.reduce((acc, e) => acc + e.amount, 0);
        const inventoryValue = inventory.reduce((acc, item) => acc + (item.quantity * item.price), 0);
        const activeCourses = subjects.length;
        const upcomingExams = exams.filter(e => e.status === 'upcoming').length;

        stats = {
          role: 'admin',
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
      }
    } else {
      // MongoDB stats
      if (role === 'student') {
        let student = await Student.findOne({ user: id }).populate('classId').populate('sectionId');
        if (!student && profileId) {
          student = await Student.findById(profileId).populate('classId').populate('sectionId');
        }
        if (!student) {
          return res.status(404).json({ success: false, message: 'Student profile not found' });
        }

        let classTeacherName = '—';
        if (student.sectionId && student.sectionId.classTeacher) {
          const ct = await Teacher.findById(student.sectionId.classTeacher);
          if (ct) classTeacherName = ct.name;
        }

        const attendanceLogs = await Attendance.find({ classId: student.classId });
        let presentCount = 0;
        let absentCount = 0;
        attendanceLogs.forEach(log => {
          const record = log.records.find(r => r.memberId.toString() === student._id.toString());
          if (record) {
            if (record.status === 'present') presentCount++;
            else if (record.status === 'absent') absentCount++;
          }
        });
        const totalDays = presentCount + absentCount;
        const attendanceRate = totalDays > 0 ? Math.round((presentCount / totalDays) * 100) : 95;

        const fee = await Fee.findOne({ studentId: student._id }) || { amountPaid: 0, amountPending: 5000, status: 'unpaid' };
        const upcomingExamsCount = await Exam.countDocuments({ status: 'upcoming' });
        
        let booksIssued = 0;
        try {
          booksIssued = await Library.countDocuments({ studentId: student._id, returnDate: null });
        } catch (e) {
          console.warn('Library count documents failed', e);
        }
        
        const activeCourses = await Subject.countDocuments();

        stats = {
          role: 'student',
          studentName: student.name,
          rollNumber: student.rollNumber,
          admissionNumber: student.admissionNumber,
          className: student.classId?.name || '—',
          sectionName: student.sectionId?.name || '—',
          classTeacher: classTeacherName,
          attendanceRate: `${attendanceRate}%`,
          daysPresent: presentCount || 24,
          daysAbsent: absentCount || 1,
          totalFees: fee.amountPaid + fee.amountPending,
          paidFees: fee.amountPaid,
          pendingFees: fee.amountPending,
          feeStatus: fee.status,
          upcomingExamsCount,
          booksIssued,
          activeCourses
        };
      } else if (['teacher', 'head-teacher', 'hod', 'coordinator'].includes(role)) {
        let teacher = await Teacher.findOne({ user: id });
        if (!teacher && profileId) {
          teacher = await Teacher.findById(profileId);
        }
        if (!teacher) {
          return res.status(404).json({ success: false, message: 'Teacher profile not found' });
        }

        const classesCount = (teacher.classesAssigned || []).length;
        const subjectsCount = (teacher.subjectsAssigned || []).length;

        const leaves = teacher.leaves || [];
        const pendingLeaves = leaves.filter(l => l.status === 'pending').length;
        const approvedLeaves = leaves.filter(l => l.status === 'approved').length;

        let classTeacherOf = 'No';
        try {
          const SectionModel = mongoose.model('Section');
          const section = await SectionModel.findOne({ classTeacher: teacher._id }).populate('classId');
          if (section) {
            classTeacherOf = `${section.classId?.name || ''} - ${section.name}`;
          }
        } catch (e) {
          console.warn('Section model check failed', e);
        }

        const upcomingExams = await Exam.countDocuments({ status: 'upcoming' });
        const notificationsCount = await Notification.countDocuments();

        stats = {
          role: 'teacher',
          teacherName: teacher.name,
          employeeId: teacher.employeeId,
          designation: teacher.designation,
          department: teacher.department,
          salary: teacher.salary,
          attendanceRate: `${teacher.attendanceRate || 100}%`,
          classesCount,
          subjectsCount,
          pendingLeaves,
          approvedLeaves,
          classTeacherOf,
          upcomingExams,
          notificationsCount
        };
      } else {
        // Global Admin stats
        const totalStudents = await Student.countDocuments();
        const totalTeachers = await Teacher.countDocuments();
        const totalClasses = await Class.countDocuments();
        const totalStaff = totalTeachers + 5;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayLog = await Attendance.findOne({ date: { $gte: today } });
        let todayAttendanceRate = 95;
        if (todayLog && todayLog.records.length > 0) {
          const presentCount = todayLog.records.filter(r => r.status === 'present').length;
          todayAttendanceRate = Math.round((presentCount / todayLog.records.length) * 100);
        }

        const allFees = await Fee.find();
        const pendingFees = allFees.reduce((acc, f) => acc + f.amountPending, 0);
        const allExpenses = await Expense.find();
        const schoolExpenses = allExpenses.reduce((acc, e) => acc + e.amount, 0);

        const allInventory = await Inventory.find();
        const inventoryValue = allInventory.reduce((acc, item) => acc + (item.quantity * item.price), 0);

        const activeCourses = await Subject.countDocuments();
        const upcomingExams = await Exam.countDocuments({ status: 'upcoming' });
        const notificationsCount = await Notification.countDocuments();

        stats = {
          role: 'admin',
          totalStudents,
          totalTeachers,
          totalClasses,
          totalStaff,
          todayAttendance: `${todayAttendanceRate}%`,
          feeCollectionToday: 4800,
          pendingFees,
          schoolExpenses,
          inventoryValue,
          activeCourses,
          upcomingExams,
          notificationsCount
        };
      }
    }

    return res.json({ success: true, stats });
  } catch (error) {
    console.error('Error fetching dashboard stats:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getCharts = async (req, res) => {
  try {
    const { role, id, profileId } = req.user;

    if (role === 'student') {
      let recentGrades = [];
      let timetable = [
        { day: 'Mon', period1: 'Potions (Prof. Snape)', period2: 'Charms (Prof. Flitwick)', period3: 'DADA (Prof. Lupin)' },
        { day: 'Tue', period1: 'DADA (Prof. Lupin)', period2: 'Potions (Prof. Snape)', period3: 'History of Magic' },
        { day: 'Wed', period1: 'Charms (Prof. Flitwick)', period2: 'Astronomy', period3: 'Potions (Prof. Snape)' },
        { day: 'Thu', period1: 'Potions (Prof. Snape)', period2: 'Herbology', period3: 'DADA (Prof. Lupin)' },
        { day: 'Fri', period1: 'DADA (Prof. Lupin)', period2: 'Charms (Prof. Flitwick)', period3: 'Transfiguration' }
      ];
      let upcomingExamsList = [];

      if (checkFallback()) {
        const student = FallbackDb.findOne('students', { user: id }) || FallbackDb.findById('students', profileId);
        if (student) {
          const results = FallbackDb.find('results') || [];
          const studentResults = results.filter(r => r.studentId === student.id);
          studentResults.forEach(r => {
            r.marks.forEach(m => {
              const sub = FallbackDb.findById('subjects', m.subjectId);
              recentGrades.push({
                name: sub ? sub.name : 'Subject',
                obtained: m.obtained,
                total: m.total
              });
            });
          });
          upcomingExamsList = FallbackDb.find('exams') || [];
        }
      } else {
        let student = await Student.findOne({ user: id });
        if (!student && profileId) student = await Student.findById(profileId);
        if (student) {
          try {
            const results = await Result.find({ studentId: student._id }).populate('marks.subjectId');
            results.forEach(r => {
              r.marks.forEach(m => {
                recentGrades.push({
                  name: m.subjectId?.name || 'Subject',
                  obtained: m.obtained,
                  total: m.total
                });
              });
            });
          } catch (e) {
            console.error('Grades mongo load failed', e);
          }
          upcomingExamsList = await Exam.find().limit(5);
        }
      }

      if (recentGrades.length === 0) {
        recentGrades = [
          { name: 'Potions', obtained: 85, total: 100 },
          { name: 'DADA', obtained: 92, total: 100 },
          { name: 'Charms', obtained: 78, total: 100 }
        ];
      }

      const attendanceWeekly = [
        { name: 'Mon', rate: 100 },
        { name: 'Tue', rate: 100 },
        { name: 'Wed', rate: 100 },
        { name: 'Thu', rate: 100 },
        { name: 'Fri', rate: 100 }
      ];

      return res.json({
        success: true,
        data: {
          recentGrades,
          timetable,
          upcomingExams: upcomingExamsList,
          attendanceWeekly
        }
      });

    } else if (['teacher', 'head-teacher', 'hod', 'coordinator'].includes(role)) {
      let approvedCount = 0;
      let pendingCount = 0;
      let rejectedCount = 0;
      let leavesList = [];
      let timetable = [
        { day: 'Mon', period1: 'Class 10 (Potions)', period2: 'Class 11 (Potions)', period3: 'Free Period' },
        { day: 'Tue', period1: 'Free Period', period2: 'Class 10 (Potions)', period3: 'Class 11 (Potions)' },
        { day: 'Wed', period1: 'Class 10 (Potions)', period2: 'Free Period', period3: 'Class 11 (Potions)' },
        { day: 'Thu', period1: 'Class 11 (Potions)', period2: 'Class 10 (Potions)', period3: 'Free Period' },
        { day: 'Fri', period1: 'Free Period', period2: 'Class 11 (Potions)', period3: 'Class 10 (Potions)' }
      ];

      if (checkFallback()) {
        const teacher = FallbackDb.findOne('teachers', { user: id }) || FallbackDb.findById('teachers', profileId);
        if (teacher) {
          leavesList = teacher.leaves || [];
          pendingCount = leavesList.filter(l => l.status === 'pending').length;
          approvedCount = leavesList.filter(l => l.status === 'approved').length;
          rejectedCount = leavesList.filter(l => l.status === 'rejected').length;
        }
      } else {
        let teacher = await Teacher.findOne({ user: id });
        if (!teacher && profileId) teacher = await Teacher.findById(profileId);
        if (teacher) {
          leavesList = teacher.leaves || [];
          pendingCount = leavesList.filter(l => l.status === 'pending').length;
          approvedCount = leavesList.filter(l => l.status === 'approved').length;
          rejectedCount = leavesList.filter(l => l.status === 'rejected').length;
        }
      }

      const leaveStatus = [
        { name: 'Approved', value: approvedCount },
        { name: 'Pending', value: pendingCount },
        { name: 'Rejected', value: rejectedCount }
      ].filter(x => x.value > 0);

      if (leaveStatus.length === 0) {
        leaveStatus.push({ name: 'No Leaves Requested', value: 1 });
      }

      const classAttendance = [
        { name: 'Mon', rate: 94 },
        { name: 'Tue', rate: 96 },
        { name: 'Wed', rate: 95 },
        { name: 'Thu', rate: 93 },
        { name: 'Fri', rate: 91 }
      ];

      return res.json({
        success: true,
        data: {
          leaveStatus,
          timetable,
          classAttendance,
          leavesList
        }
      });
    }

    // Default Admin Charts
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
