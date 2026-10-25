import mongoose from 'mongoose';
import LeaveRequest from '../models/LeaveRequest.js';
import Attendance from '../models/Attendance.js';
import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import User from '../models/User.js';
import ClassRoom from '../models/ClassRoom.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from './dbFallback.js';

/**
 * Validates start and end dates and calculates actual working/academic days.
 * Standard institution rule: Excludes Sundays (0).
 * Half-day leave equals 0.5 days on a single calendar day.
 */
export const calculateLeaveDays = (startDateInput, endDateInput, isHalfDay = false, weeklyOffDays = [0]) => {
  const start = new Date(startDateInput);
  const end = new Date(endDateInput);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return { valid: false, error: 'Start date and End date must be valid dates.' };
  }

  // Normalize to local midnight
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (start > end) {
    return { valid: false, error: 'Start date cannot be after end date.' };
  }

  if (isHalfDay) {
    if (start.getTime() !== end.getTime()) {
      return { valid: false, error: 'Half-day leave must start and end on the same calendar day.' };
    }
    const dayOfWeek = start.getDay();
    if (weeklyOffDays.includes(dayOfWeek)) {
      return { valid: false, error: 'Selected date is a weekly institutional off day.' };
    }
    return {
      valid: true,
      totalDays: 0.5,
      workingDates: [start],
    };
  }

  // Multi-day calculation excluding weekly off days (Sundays by default)
  const workingDates = [];
  const current = new Date(start);

  while (current <= end) {
    const dayOfWeek = current.getDay();
    if (!weeklyOffDays.includes(dayOfWeek)) {
      workingDates.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }

  if (workingDates.length === 0) {
    return {
      valid: false,
      error: 'Selected leave range consists entirely of weekly off days or non-working days.',
    };
  }

  return {
    valid: true,
    totalDays: workingDates.length,
    workingDates,
  };
};

/**
 * Generates an enterprise human-readable leave code: LV-YYYY-XXXX
 */
export const generateLeaveCode = async () => {
  const year = new Date().getFullYear();
  let count = 0;

  if (checkFallback()) {
    const list = FallbackDb.find('leaveRequests') || [];
    count = list.length + 1;
  } else {
    try {
      count = (await LeaveRequest.countDocuments()) + 1;
    } catch {
      count = Math.floor(Math.random() * 9000) + 1000;
    }
  }

  const seq = String(count).padStart(4, '0');
  return `LV-${year}-${seq}`;
};

/**
 * Resolves an applicant's complete profile safely from any identifier
 * (Student ID, Admission No, Teacher ID, Employee ID, User ID, or Username).
 */
export const resolveApplicantIdentity = async (identifier, reqUser = null) => {
  if (!identifier) return null;
  const idStr = String(identifier).trim();
  const isMongoId = mongoose.Types.ObjectId.isValid(idStr);

  if (checkFallback()) {
    // 1. Check Student
    let student =
      FallbackDb.findById('students', idStr) ||
      FallbackDb.findOne('students', { admissionNumber: idStr }) ||
      FallbackDb.findOne('students', { rollNumber: idStr });

    if (student) {
      return {
        applicantId: student.id || student._id,
        applicantModel: 'Student',
        applicantName: student.name || `${student.firstName || ''} ${student.lastName || ''}`.trim(),
        applicantRole: 'student',
        user: student.user || null,
        admissionNumber: student.admissionNumber || '',
        rollNumber: student.rollNumber || '',
        className: student.className || student.class || '',
        sectionName: student.sectionName || student.section || '',
        classSection:
          student.className && student.sectionName
            ? `${student.className} - ${student.sectionName}`
            : student.classSection || '',
        classRoomId: student.currentClassRoomId || null,
        sessionId: student.sessionId || null,
      };
    }

    // 2. Check Teacher
    let teacher =
      FallbackDb.findById('teachers', idStr) ||
      FallbackDb.findOne('teachers', { employeeId: idStr.toUpperCase() }) ||
      FallbackDb.findOne('teachers', { email: idStr.toLowerCase() });

    if (teacher) {
      return {
        applicantId: teacher.id || teacher._id,
        applicantModel: 'Teacher',
        applicantName: teacher.name || `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim(),
        applicantRole: teacher.role || 'teacher',
        user: teacher.user || null,
        employeeId: teacher.employeeId || '',
        className: '',
        sectionName: '',
        classSection: teacher.currentClassRoomName || '',
        classRoomId: teacher.currentClassRoomId || null,
        sessionId: null,
      };
    }

    // 3. Check User
    let user =
      FallbackDb.findById('users', idStr) ||
      FallbackDb.findOne('users', { username: idStr.toLowerCase() }) ||
      FallbackDb.findOne('users', { email: idStr.toLowerCase() });

    if (user) {
      if (user.profileId) {
        // Recurse to resolve the profile
        const prof = await resolveApplicantIdentity(user.profileId, reqUser);
        if (prof) return { ...prof, user: user.id || user._id };
      }
      return {
        applicantId: user.id || user._id,
        applicantModel: 'User',
        applicantName: user.name || user.username,
        applicantRole: user.role || 'staff',
        user: user.id || user._id,
        employeeId: user.employeeId || '',
        admissionNumber: user.admissionNumber || '',
        rollNumber: '',
        className: '',
        sectionName: '',
        classSection: '',
        classRoomId: null,
        sessionId: null,
      };
    }

    return null;
  }

  // ── MongoDB Production Resolution ──
  // 1. Check Student by ObjectId or admissionNumber
  let student = null;
  if (isMongoId) {
    student = await Student.findById(idStr);
  }
  if (!student) {
    student = await Student.findOne({ admissionNumber: idStr.toUpperCase() });
  }

  if (student) {
    return {
      applicantId: student._id,
      applicantModel: 'Student',
      applicantName: student.name || `${student.firstName || ''} ${student.lastName || ''}`.trim(),
      applicantRole: 'student',
      user: student.user || null,
      admissionNumber: student.admissionNumber || '',
      rollNumber: student.rollNumber || '',
      className: student.className || student.class || '',
      sectionName: student.sectionName || student.section || '',
      classSection:
        student.className && student.sectionName
          ? `${student.className} - ${student.sectionName}`
          : student.classSection || '',
      classRoomId: student.currentClassRoomId || null,
      sessionId: student.sessionId || null,
    };
  }

  // 2. Check Teacher by ObjectId or employeeId
  let teacher = null;
  if (isMongoId) {
    teacher = await Teacher.findById(idStr);
  }
  if (!teacher) {
    teacher = await Teacher.findOne({ employeeId: idStr.toUpperCase() });
  }

  if (teacher) {
    return {
      applicantId: teacher._id,
      applicantModel: 'Teacher',
      applicantName: teacher.name || `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim(),
      applicantRole: teacher.role || 'teacher',
      user: teacher.user || null,
      employeeId: teacher.employeeId || '',
      className: '',
      sectionName: '',
      classSection: teacher.currentClassRoomName || '',
      classRoomId: teacher.currentClassRoomId || null,
      sessionId: null,
    };
  }

  // 3. Check User
  let user = null;
  if (isMongoId) {
    user = await User.findById(idStr);
  }
  if (!user) {
    user = await User.findOne({ username: idStr.toLowerCase() });
  }

  if (user) {
    if (user.profileId) {
      const prof = await resolveApplicantIdentity(user.profileId, reqUser);
      if (prof) return { ...prof, user: user._id };
    }
    return {
      applicantId: user._id,
      applicantModel: 'User',
      applicantName: user.name || user.username,
      applicantRole: user.role || 'staff',
      user: user._id,
      employeeId: user.employeeId || '',
      admissionNumber: user.admissionNumber || '',
      rollNumber: '',
      className: '',
      sectionName: '',
      classSection: '',
      classRoomId: null,
      sessionId: null,
    };
  }

  return null;
};

/**
 * Checks for conflicting approved or pending leave requests for the same applicant.
 */
export const checkOverlappingLeave = async (applicantId, startDate, endDate, excludeLeaveId = null) => {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  if (checkFallback()) {
    const list = FallbackDb.find('leaveRequests') || [];
    const conflict = list.find((l) => {
      if (excludeLeaveId && (l.id === excludeLeaveId || l._id === excludeLeaveId)) return false;
      if (String(l.applicantId) !== String(applicantId)) return false;
      if (l.status !== 'approved' && l.status !== 'pending') return false;

      const lStart = new Date(l.startDate);
      lStart.setHours(0, 0, 0, 0);
      const lEnd = new Date(l.endDate);
      lEnd.setHours(23, 59, 59, 999);

      return start <= lEnd && end >= lStart;
    });
    return conflict || null;
  }

  const query = {
    applicantId,
    status: { $in: ['approved', 'pending'] },
    startDate: { $lte: end },
    endDate: { $gte: start },
  };

  if (excludeLeaveId && mongoose.Types.ObjectId.isValid(excludeLeaveId)) {
    query._id = { $ne: excludeLeaveId };
  }

  return await LeaveRequest.findOne(query);
};

/**
 * Idempotently synchronizes an approved leave with the Attendance system.
 * Updates matching attendance records on working dates to status "leave".
 */
export const syncLeaveWithAttendance = async (leaveRequest, reviewerUser) => {
  if (!leaveRequest || leaveRequest.status !== 'approved') return { success: false };

  const start = new Date(leaveRequest.startDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(leaveRequest.endDate);
  end.setHours(23, 59, 59, 999);

  const syncedDates = [];
  const syncedAttendanceIds = [];

  const current = new Date(start);
  while (current <= end) {
    if (current.getDay() !== 0) {
      syncedDates.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }

  const statusToMark = leaveRequest.isHalfDay ? 'half day' : 'leave';
  const remarksToMark = `Approved Leave: ${leaveRequest.category} (${leaveRequest.leaveCode})`;

  if (checkFallback()) {
    const attendanceRecords = FallbackDb.find('attendance') || [];

    for (const d of syncedDates) {
      const dStart = new Date(d);
      dStart.setHours(0, 0, 0, 0);
      const dEnd = new Date(d);
      dEnd.setHours(23, 59, 59, 999);

      const matchingRecords = attendanceRecords.filter((att) => {
        const attDate = new Date(att.date || att.attendanceDate);
        if (attDate < dStart || attDate > dEnd) return false;
        if (leaveRequest.applicantModel === 'Student') {
          return (
            att.type === 'student' &&
            (!leaveRequest.className || att.className === leaveRequest.className)
          );
        } else {
          return att.type === 'teacher';
        }
      });

      for (const att of matchingRecords) {
        let changed = false;
        const studentsList = att.students || att.records || att.attendance || [];

        studentsList.forEach((st) => {
          if (
            String(st.studentId) === String(leaveRequest.applicantId) ||
            String(st.id) === String(leaveRequest.applicantId) ||
            String(st._id) === String(leaveRequest.applicantId) ||
            (leaveRequest.rollNumber && String(st.rollNo) === String(leaveRequest.rollNumber))
          ) {
            st.status = statusToMark;
            st.remarks = remarksToMark;
            changed = true;
          }
        });

        if (changed) {
          const present = studentsList.filter((s) => s.status === 'present').length;
          const absent = studentsList.filter((s) => s.status === 'absent').length;
          const late = studentsList.filter((s) => s.status === 'late').length;

          FallbackDb.update('attendance', att.id || att._id, {
            students: studentsList,
            records: studentsList,
            attendance: studentsList,
            present,
            absent,
            late,
          });

          syncedAttendanceIds.push(att.id || att._id);
        }
      }
    }

    return {
      success: true,
      syncedDates,
      syncedAttendanceIds,
    };
  }

  // ── MongoDB Attendance Sync ──
  for (const d of syncedDates) {
    const dStart = new Date(d);
    dStart.setHours(0, 0, 0, 0);
    const dEnd = new Date(d);
    dEnd.setHours(23, 59, 59, 999);

    const matchQuery = {
      $or: [
        { date: { $gte: dStart, $lte: dEnd } },
        { attendanceDate: { $gte: dStart, $lte: dEnd } },
      ],
      type: leaveRequest.applicantModel === 'Student' ? 'student' : 'teacher',
    };

    if (leaveRequest.applicantModel === 'Student') {
      if (leaveRequest.className) matchQuery.className = leaveRequest.className;
    }

    const matchingRecords = await Attendance.find(matchQuery);

    for (const att of matchingRecords) {
      let changed = false;
      const list = att.students || att.records || att.attendance || [];

      list.forEach((st) => {
        if (
          String(st.studentId) === String(leaveRequest.applicantId) ||
          String(st.id) === String(leaveRequest.applicantId) ||
          String(st._id) === String(leaveRequest.applicantId) ||
          (leaveRequest.rollNumber && String(st.rollNo) === String(leaveRequest.rollNumber))
        ) {
          st.status = statusToMark;
          st.remarks = remarksToMark;
          changed = true;
        }
      });

      if (changed) {
        att.students = list;
        att.records = list;
        att.attendance = list;
        att.present = list.filter((s) => s.status === 'present').length;
        att.absent = list.filter((s) => s.status === 'absent').length;
        att.late = list.filter((s) => s.status === 'late').length;
        await att.save();
        syncedAttendanceIds.push(att._id);
      }
    }
  }

  return {
    success: true,
    syncedDates,
    syncedAttendanceIds,
  };
};

/**
 * Reverses attendance status when an approved leave is cancelled.
 */
export const reverseAttendanceSync = async (leaveRequest) => {
  if (!leaveRequest || !leaveRequest.attendanceSync?.syncedAttendanceIds?.length) return;

  const ids = leaveRequest.attendanceSync.syncedAttendanceIds;

  if (checkFallback()) {
    ids.forEach((id) => {
      const att = FallbackDb.findById('attendance', id);
      if (att) {
        const list = att.students || att.records || [];
        list.forEach((st) => {
          if (String(st.studentId) === String(leaveRequest.applicantId)) {
            st.status = 'absent';
            st.remarks = 'Leave cancelled/reverted';
          }
        });
        FallbackDb.update('attendance', id, { students: list, records: list });
      }
    });
    return;
  }

  for (const id of ids) {
    const att = await Attendance.findById(id);
    if (att) {
      const list = att.students || att.records || [];
      list.forEach((st) => {
        if (String(st.studentId) === String(leaveRequest.applicantId)) {
          st.status = 'absent';
          st.remarks = 'Leave cancelled/reverted';
        }
      });
      att.students = list;
      att.records = list;
      await att.save();
    }
  }
};
