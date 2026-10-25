import mongoose from 'mongoose';
import LeaveRequest from '../models/LeaveRequest.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';
import {
  calculateLeaveDays,
  generateLeaveCode,
  resolveApplicantIdentity,
  checkOverlappingLeave,
  syncLeaveWithAttendance,
  reverseAttendanceSync,
} from '../services/leaveService.js';
import { logActivity } from '../utils/activityLogger.js';
import { parsePagination, paginateResult } from '../utils/paginateQuery.js';

/**
 * GET /api/v1/leaves/applicant/:id
 * Universal Dynamic Endpoint: Returns full leave history, pending requests,
 * approval timeline, and stats for any student, teacher, or user ID.
 */
export const getApplicantLeaveProfile = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: 'Applicant identifier is required.' });
    }

    // Resolve applicant profile
    let applicant = await resolveApplicantIdentity(id, req.user);
    if (!applicant) {
      applicant = {
        applicantId: id,
        applicantModel: 'Student',
        applicantName: `Applicant (${id})`,
        applicantRole: 'student',
        admissionNumber: id,
      };
    }

    // Role-based Access Control Check:
    // Students can only view their own profile; Teachers can view their own and their classroom students; Admins can view any.
    const userRole = String(req.user?.role || '').toLowerCase();
    const isLeadership = ['super-admin', 'school-admin', 'principal', 'director'].includes(userRole);
    const isFaculty = ['teacher', 'head-teacher', 'hod', 'coordinator'].includes(userRole);

    if (!isLeadership) {
      const isSelf =
        String(applicant.user) === String(req.user?._id || req.user?.id) ||
        String(applicant.applicantId) === String(req.user?.profileId || req.user?.id);

      if (!isSelf && !isFaculty) {
        return res.status(403).json({
          success: false,
          message: 'You are not authorized to view this applicant’s leave records.',
        });
      }
    }

    let records = [];

    if (checkFallback()) {
      const all = FallbackDb.find('leaveRequests') || [];
      records = all.filter(
        (l) =>
          String(l.applicantId) === String(applicant.applicantId) ||
          String(l.applicantId) === String(id) ||
          (applicant.admissionNumber && String(l.admissionNumber) === String(applicant.admissionNumber)) ||
          (applicant.employeeId && String(l.employeeId) === String(applicant.employeeId)) ||
          (applicant.user && String(l.user) === String(applicant.user))
      );
    } else {
      const orConditions = [{ applicantId: applicant.applicantId }];
      if (mongoose.Types.ObjectId.isValid(id)) {
        orConditions.push({ applicantId: id });
      }
      if (applicant.admissionNumber) orConditions.push({ admissionNumber: applicant.admissionNumber });
      if (applicant.employeeId) orConditions.push({ employeeId: applicant.employeeId });
      if (applicant.user) orConditions.push({ user: applicant.user });

      records = await LeaveRequest.find({ $or: orConditions }).sort({ startDate: -1, createdAt: -1 });
    }

    // Calculate dynamic stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let totalDaysApplied = 0;
    let approvedDays = 0;
    let pendingDays = 0;
    let rejectedDays = 0;
    let approvedCount = 0;
    let pendingCount = 0;
    let rejectedCount = 0;
    let activeLeaveNow = null;
    const categoryBreakdown = {};

    const pendingRequests = [];
    const history = [];

    records.forEach((rec) => {
      const days = Number(rec.totalDays) || 1;
      totalDaysApplied += days;

      categoryBreakdown[rec.category] = (categoryBreakdown[rec.category] || 0) + days;

      if (rec.status === 'pending') {
        pendingDays += days;
        pendingCount += 1;
        pendingRequests.push(rec);
      } else if (rec.status === 'approved') {
        approvedDays += days;
        approvedCount += 1;
        history.push(rec);

        // Check if currently on leave today
        const s = new Date(rec.startDate);
        s.setHours(0, 0, 0, 0);
        const e = new Date(rec.endDate);
        e.setHours(23, 59, 59, 999);
        if (today >= s && today <= e) {
          activeLeaveNow = rec;
        }
      } else {
        if (rec.status === 'rejected') {
          rejectedDays += days;
          rejectedCount += 1;
        }
        history.push(rec);
      }
    });

    const resultPayload = {
      success: true,
      applicant,
      summary: {
        totalApplications: records.length,
        totalDaysApplied,
        approvedDays,
        pendingDays,
        rejectedDays,
        approvedCount,
        pendingCount,
        rejectedCount,
        categoryBreakdown,
      },
      activeLeave: activeLeaveNow,
      activeLeaveNow,
      pendingRequests,
      history,
      requests: records,
      records,
    };
    resultPayload.data = { ...resultPayload };

    return res.json(resultPayload);
  } catch (error) {
    console.error('getApplicantLeaveProfile error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

/**
 * GET /api/v1/leaves/my
 * Returns leave requests for current logged in user
 */
export const getMyLeaves = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const profileId = req.user?.profileId;

    let records = [];

    if (checkFallback()) {
      const all = FallbackDb.find('leaveRequests') || [];
      records = all.filter(
        (l) => String(l.user) === String(userId) || (profileId && String(l.applicantId) === String(profileId))
      );
    } else {
      const orConditions = [{ user: userId }];
      if (profileId) orConditions.push({ applicantId: profileId });

      records = await LeaveRequest.find({ $or: orConditions }).sort({ startDate: -1, createdAt: -1 });
    }

    return res.json({ success: true, leaves: records });
  } catch (error) {
    console.error('getMyLeaves error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/v1/leaves/all
 * Central directory for administrators and faculty to view leave applications
 */
export const getAllLeaves = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { role, status, classRoomId, className, search, date } = req.query;

    if (checkFallback()) {
      let list = FallbackDb.find('leaveRequests') || [];

      if (role && role !== 'all') {
        list = list.filter((l) => l.applicantRole === role);
      }
      if (status && status !== 'all') {
        list = list.filter((l) => l.status === status);
      }
      if (classRoomId) {
        list = list.filter((l) => String(l.classRoomId) === String(classRoomId));
      }
      if (className) {
        list = list.filter((l) => l.className === className);
      }
      if (date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        list = list.filter((l) => {
          const s = new Date(l.startDate);
          s.setHours(0, 0, 0, 0);
          const e = new Date(l.endDate);
          e.setHours(23, 59, 59, 999);
          return d >= s && d <= e;
        });
      }
      if (search) {
        const q = search.toLowerCase();
        list = list.filter(
          (l) =>
            l.applicantName?.toLowerCase().includes(q) ||
            l.leaveCode?.toLowerCase().includes(q) ||
            l.admissionNumber?.toLowerCase().includes(q) ||
            l.employeeId?.toLowerCase().includes(q) ||
            l.reason?.toLowerCase().includes(q)
        );
      }

      list.sort((a, b) => new Date(b.createdAt || b.startDate) - new Date(a.createdAt || a.startDate));
      const total = list.length;
      const data = list.slice(skip, skip + limit);

      return res.json({
        success: true,
        leaves: data,
        ...paginateResult(data, total, { page, limit }),
      });
    }

    const filter = {};
    if (role && role !== 'all') filter.applicantRole = role;
    if (status && status !== 'all') filter.status = status;
    if (classRoomId && mongoose.Types.ObjectId.isValid(classRoomId)) filter.classRoomId = classRoomId;
    if (className) filter.className = className;

    if (date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      filter.startDate = { $lte: new Date(new Date(date).setHours(23, 59, 59, 999)) };
      filter.endDate = { $gte: d };
    }

    if (search) {
      filter.$or = [
        { applicantName: { $regex: search, $options: 'i' } },
        { leaveCode: { $regex: search, $options: 'i' } },
        { admissionNumber: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { reason: { $regex: search, $options: 'i' } },
      ];
    }

    const [leaves, total] = await Promise.all([
      LeaveRequest.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      LeaveRequest.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      leaves,
      ...paginateResult(leaves, total, { page, limit }),
    });
  } catch (error) {
    console.error('getAllLeaves error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * POST /api/v1/leaves/request
 * Submits a new leave request (self or on-behalf)
 */
export const requestLeave = async (req, res) => {
  try {
    const {
      applicantId,
      category = 'Medical Leave',
      startDate,
      endDate,
      isHalfDay = false,
      halfDaySession = 'none',
      reason,
      documents = [],
    } = req.body;

    if (!startDate || !endDate || !reason) {
      return res.status(400).json({
        success: false,
        message: 'Start date, end date, and reason are required.',
      });
    }

    // Target applicant resolution:
    // If applicantId provided in body (e.g. Admin or ClassTeacher applying on behalf of student/teacher)
    // otherwise default to authenticated user
    const targetIdentifier = applicantId || req.user?.profileId || req.user?._id || req.user?.id;
    const applicant = await resolveApplicantIdentity(targetIdentifier, req.user);

    if (!applicant) {
      return res.status(404).json({ success: false, message: 'Target applicant identity could not be resolved.' });
    }

    // Calculate dates & check institutional working days
    const calc = calculateLeaveDays(startDate, endDate, Boolean(isHalfDay));
    if (!calc.valid) {
      return res.status(400).json({ success: false, message: calc.error });
    }

    // Check for overlapping existing pending or approved requests
    const overlap = await checkOverlappingLeave(applicant.applicantId, startDate, endDate);
    if (overlap) {
      return res.status(400).json({
        success: false,
        message: `An active or pending leave request (${overlap.leaveCode || 'Leave'}) already covers part or all of these dates (${new Date(overlap.startDate).toLocaleDateString()} to ${new Date(overlap.endDate).toLocaleDateString()}).`,
      });
    }

    const leaveCode = await generateLeaveCode();

    const payload = {
      leaveCode,
      applicantId: applicant.applicantId,
      applicantModel: applicant.applicantModel,
      applicantName: applicant.applicantName,
      applicantRole: applicant.applicantRole,
      user: applicant.user || null,
      admissionNumber: applicant.admissionNumber || '',
      rollNumber: applicant.rollNumber || '',
      employeeId: applicant.employeeId || '',
      classRoomId: applicant.classRoomId || null,
      className: applicant.className || '',
      sectionName: applicant.sectionName || '',
      classSection: applicant.classSection || '',
      sessionId: applicant.sessionId || null,
      category,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      totalDays: calc.totalDays,
      isHalfDay: Boolean(isHalfDay),
      halfDaySession: isHalfDay ? halfDaySession : 'none',
      reason: String(reason).trim(),
      documents: Array.isArray(documents) ? documents : [],
      status: 'pending',
      appliedBy: {
        userId: req.user?._id || req.user?.id || 'SYSTEM',
        name: req.user?.name || req.user?.username || 'User',
        role: req.user?.role || 'user',
        appliedAt: new Date(),
      },
    };

    let record = null;
    if (checkFallback()) {
      record = FallbackDb.create('leaveRequests', payload);
    } else {
      record = await LeaveRequest.create(payload);
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CREATE',
      module: 'leaves',
      recordId: record._id || record.id,
      details: `Submitted leave request ${leaveCode} for ${applicant.applicantName} (${calc.totalDays} day(s))`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Leave application submitted successfully.',
      leave: record,
    });
  } catch (error) {
    console.error('requestLeave error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

/**
 * PATCH /api/v1/leaves/:id/review
 * Approves or rejects a leave application and syncs attendance
 */
export const reviewLeave = async (req, res) => {
  try {
    const id = req.params.id || req.params.leaveId;
    const { status, reviewRemarks = '' } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be approved or rejected.' });
    }

    let leave = null;

    if (checkFallback()) {
      leave = FallbackDb.findById('leaveRequests', id);
      if (!leave) {
        return res.status(404).json({ success: false, message: 'Leave request not found.' });
      }
      if (leave.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: `Cannot review. Leave is already marked as ${leave.status}.`,
        });
      }

      leave.status = status;
      leave.reviewRemarks = String(reviewRemarks).trim();
      leave.reviewedBy = {
        userId: req.user?._id || req.user?.id || 'ADMIN',
        name: req.user?.name || 'Administrator',
        role: req.user?.role || 'admin',
        reviewedAt: new Date().toISOString(),
      };

      if (status === 'approved') {
        const syncResult = await syncLeaveWithAttendance(leave, req.user);
        leave.attendanceSync = {
          isSynced: syncResult.success,
          syncedDates: syncResult.syncedDates,
          syncedAttendanceIds: syncResult.syncedAttendanceIds,
          syncedAt: new Date().toISOString(),
        };
      }

      FallbackDb.update('leaveRequests', leave.id || leave._id, leave);
    } else {
      leave = await LeaveRequest.findById(id);
      if (!leave) {
        return res.status(404).json({ success: false, message: 'Leave request not found.' });
      }
      if (leave.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: `Cannot review. Leave is already marked as ${leave.status}.`,
        });
      }

      leave.status = status;
      leave.reviewRemarks = String(reviewRemarks).trim();
      leave.reviewedBy = {
        userId: req.user?._id || req.user?.id || 'ADMIN',
        name: req.user?.name || 'Administrator',
        role: req.user?.role || 'admin',
        reviewedAt: new Date(),
      };

      if (status === 'approved') {
        const syncResult = await syncLeaveWithAttendance(leave, req.user);
        leave.attendanceSync = {
          isSynced: syncResult.success,
          syncedDates: syncResult.syncedDates,
          syncedAttendanceIds: syncResult.syncedAttendanceIds,
          syncedAt: new Date(),
        };
      }

      await leave.save();
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: status === 'approved' ? 'APPROVE' : 'REJECT',
      module: 'leaves',
      recordId: leave._id || leave.id,
      details: `Leave ${leave.leaveCode} marked as ${status} by ${req.user?.name || 'Admin'}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      success: true,
      message: `Leave application ${status} successfully.${status === 'approved' ? ' Attendance synchronized.' : ''}`,
      leave,
    });
  } catch (error) {
    console.error('reviewLeave error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

/**
 * DELETE /api/v1/leaves/:id
 * Cancels a pending (or eligible) leave application
 */
export const cancelLeave = async (req, res) => {
  try {
    const { id } = req.params;
    let leave = null;

    if (checkFallback()) {
      leave = FallbackDb.findById('leaveRequests', id);
      if (!leave) {
        return res.status(404).json({ success: false, message: 'Leave request not found.' });
      }
      if (leave.status === 'cancelled') {
        return res.status(400).json({ success: false, message: 'Leave is already cancelled.' });
      }

      // Reverse attendance if it was approved
      if (leave.status === 'approved') {
        await reverseAttendanceSync(leave);
      }

      leave.status = 'cancelled';
      FallbackDb.update('leaveRequests', leave.id || leave._id, leave);
    } else {
      leave = await LeaveRequest.findById(id);
      if (!leave) {
        return res.status(404).json({ success: false, message: 'Leave request not found.' });
      }
      if (leave.status === 'cancelled') {
        return res.status(400).json({ success: false, message: 'Leave is already cancelled.' });
      }

      if (leave.status === 'approved') {
        await reverseAttendanceSync(leave);
      }

      leave.status = 'cancelled';
      await leave.save();
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CANCEL',
      module: 'leaves',
      recordId: leave._id || leave.id,
      details: `Leave application ${leave.leaveCode} cancelled.`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      success: true,
      message: 'Leave application cancelled successfully.',
      leave,
    });
  } catch (error) {
    console.error('cancelLeave error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * GET /api/v1/leaves/active-on-date
 * Returns approved leaves on a specific date for classroom roster pre-marking
 */
export const getActiveLeavesOnDate = async (req, res) => {
  try {
    const { date, className, sectionName, classRoomId, type = 'student' } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, message: 'Date parameter is required.' });
    }

    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const dEnd = new Date(date);
    dEnd.setHours(23, 59, 59, 999);

    let activeLeaves = [];

    if (checkFallback()) {
      const all = FallbackDb.find('leaveRequests') || [];
      activeLeaves = all.filter((l) => {
        if (l.status !== 'approved') return false;
        const s = new Date(l.startDate);
        s.setHours(0, 0, 0, 0);
        const e = new Date(l.endDate);
        e.setHours(23, 59, 59, 999);

        if (d < s || d > e) return false;

        if (type === 'student') {
          if (l.applicantModel !== 'Student') return false;
          if (classRoomId && String(l.classRoomId) !== String(classRoomId)) return false;
          if (className && l.className !== className) return false;
          if (sectionName && l.sectionName !== sectionName) return false;
        } else {
          if (l.applicantModel === 'Student') return false;
        }

        return true;
      });
    } else {
      const filter = {
        status: 'approved',
        startDate: { $lte: dEnd },
        endDate: { $gte: d },
      };

      if (type === 'student') {
        filter.applicantModel = 'Student';
        if (classRoomId && mongoose.Types.ObjectId.isValid(classRoomId)) filter.classRoomId = classRoomId;
        if (className) filter.className = className;
        if (sectionName) filter.sectionName = sectionName;
      } else {
        filter.applicantModel = { $in: ['Teacher', 'User'] };
      }

      activeLeaves = await LeaveRequest.find(filter);
    }

    return res.json({
      success: true,
      date,
      count: activeLeaves.length,
      leaves: activeLeaves.map((l) => ({
        leaveId: l._id || l.id,
        leaveCode: l.leaveCode,
        applicantId: l.applicantId,
        applicantName: l.applicantName,
        rollNumber: l.rollNumber,
        admissionNumber: l.admissionNumber,
        employeeId: l.employeeId,
        category: l.category,
        isHalfDay: l.isHalfDay,
        halfDaySession: l.halfDaySession,
        reason: l.reason,
      })),
    });
  } catch (error) {
    console.error('getActiveLeavesOnDate error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
