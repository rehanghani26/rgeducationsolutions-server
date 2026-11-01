// 2. External packages
import mongoose from 'mongoose';

// 3. Configuration
import { checkFallback } from '../config/db.js';

// 4. Models
import User from '../models/User.js';
import PayrollRecord from '../models/PayrollRecord.js';
import PayrollDisbursement from '../models/PayrollDisbursement.js';
import BudgetAllocation from '../models/BudgetAllocation.js';
import AcademicSession from '../models/AcademicSession.js';
import Expense from '../models/Expense.js';
import Attendance from '../models/Attendance.js';
import Leave from '../models/Leave.js';

// 6. Services
import { FallbackDb } from '../services/dbFallback.js';

// 7. Utilities
import { isValidObjectId, escapeRegex } from '../utils/commonUtil.js';
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendForbidden,
  sendError
} from '../utils/responseUtil.js';

/**
 * Roles that are strictly excluded from staff payroll processing.
 */
export const EXCLUDED_PAYROLL_ROLES = [
  'super-admin',
  'school-admin',
  'admin',
  'director',
  'student',
  'parent',
];

/**
 * Converts a month name into a 1-based index (e.g., "January" -> 1).
 *
 * @param {string} monthName - Month name string.
 * @returns {number} 1-based month index.
 */
const getMonthNumber = (monthName) => {
  const months = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  const idx = months.indexOf(String(monthName).toLowerCase().trim());
  return idx > -1 ? idx + 1 : new Date().getMonth() + 1;
};

/**
 * Resolves real-time attendance and approved leave metrics for a staff member in a specific month.
 *
 * @param {Object} params - Query and compensation parameters.
 * @param {string} params.userId - Staff user ID.
 * @param {string} [params.employeeId] - Staff employee code.
 * @param {string} [params.teacherId] - Linked teacher ID.
 * @param {Date|string} [params.joiningDate] - Date employee joined.
 * @param {number} params.year - Target year.
 * @param {number} params.monthNumber - 1-based target month.
 * @param {number} [params.basicPay=0] - Basic pay amount.
 * @param {number} [params.da=0] - Dearness allowance amount.
 * @param {number} [params.grossPay=0] - Total gross pay.
 * @returns {Promise<Object>} Calculated monthly attendance metrics and Loss of Pay (LOP) figures.
 */
export const resolveStaffMonthlyAttendanceAndLeaves = async ({
  userId,
  employeeId,
  teacherId,
  joiningDate,
  year,
  monthNumber,
  basicPay = 0,
  da = 0,
  grossPay = 0,
}) => {
  const totalDaysInMonth = new Date(year, monthNumber, 0).getDate();

  // Calculate default working days (excluding Sundays)
  let standardWorkingDays = 0;
  for (let d = 1; d <= totalDaysInMonth; d++) {
    const dayDate = new Date(year, monthNumber - 1, d);
    if (dayDate.getDay() !== 0) standardWorkingDays++;
  }
  if (standardWorkingDays <= 0) standardWorkingDays = 26;

  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;
  let pendingLeavesCount = 0;

  let presentDays = 0;
  let absentDays = 0;
  let halfDays = 0;
  let lateDays = 0;
  let unworkedPreJoiningDays = 0;
  let hasExplicitAttendance = false;

  const monthStart = new Date(year, monthNumber - 1, 1, 0, 0, 0, 0);
  const monthEnd = new Date(year, monthNumber, 0, 23, 59, 59, 999);

  if (checkFallback()) {
    // 1. Check Leaves in fallback
    const allLeaves = FallbackDb.find('leaves') || [];
    allLeaves.forEach((lv) => {
      const match =
        String(lv.userId) === String(userId) ||
        (teacherId && String(lv.teacherId) === String(teacherId));
      if (!match) return;

      const lvStart = new Date(lv.startDate);
      const lvEnd = new Date(lv.endDate);
      if (lvStart <= monthEnd && lvEnd >= monthStart) {
        if (lv.status === 'approved') {
          const cat = (lv.category || '').toLowerCase();
          const isUnpaid = cat.includes('unpaid') || cat.includes('loss') || cat.includes('lop');
          const days = Number(lv.totalDays) || 1;
          if (isUnpaid) {
            unpaidLeaveDays += days;
          } else {
            paidLeaveDays += days;
          }
        } else if (lv.status === 'pending') {
          pendingLeavesCount++;
        }
      }
    });

    // 2. Check Attendance in fallback
    const allAtt = FallbackDb.find('attendance') || [];
    allAtt.forEach((att) => {
      const attDate = new Date(att.attendanceDate || att.date);
      if (attDate >= monthStart && attDate <= monthEnd) {
        const records = att.students || att.attendance || att.records || [];
        const item = records.find(
          (r) =>
            String(r.studentId) === String(userId) ||
            String(r.memberId) === String(userId) ||
            (employeeId && String(r.employeeId) === String(employeeId)) ||
            (employeeId && String(r.rollNo) === String(employeeId))
        );

        if (item) {
          hasExplicitAttendance = true;
          const st = (item.status || '').toLowerCase();
          if (st === 'present') presentDays++;
          else if (st === 'absent') absentDays++;
          else if (st.includes('half')) halfDays++;
          else if (st === 'late') {
            presentDays++;
            lateDays++;
          }
        }
      }
    });
  } else {
    // 1. MongoDB Leaves (Safely handle String vs ObjectId to prevent BSON CastError)
    try {
      const orConditions = [];
      if (userId) {
        orConditions.push({ userId: String(userId) });
        if (isValidObjectId(userId)) {
          orConditions.push({ userId: new mongoose.Types.ObjectId(String(userId)) });
        }
      }
      if (teacherId) {
        orConditions.push({ userId: String(teacherId) });
        if (isValidObjectId(teacherId)) {
          orConditions.push({ teacherId: new mongoose.Types.ObjectId(String(teacherId)) });
        }
      }
      if (employeeId) {
        orConditions.push({ userId: String(employeeId) });
      }

      if (orConditions.length > 0) {
        const leaveQuery = {
          $or: orConditions,
          $and: [
            { startDate: { $lte: monthEnd.toISOString().split('T')[0] } },
            { endDate: { $gte: monthStart.toISOString().split('T')[0] } },
          ],
        };

        const leaves = await Leave.find(leaveQuery);
        leaves.forEach((lv) => {
          if (lv.status === 'approved') {
            const cat = (lv.category || '').toLowerCase();
            const isUnpaid = cat.includes('unpaid') || cat.includes('loss') || cat.includes('lop');
            const days = Number(lv.totalDays) || 1;
            if (isUnpaid) {
              unpaidLeaveDays += days;
            } else {
              paidLeaveDays += days;
            }
          } else if (lv.status === 'pending') {
            pendingLeavesCount++;
          }
        });
      }
    } catch (leaveErr) {
      console.warn('Leave query note for user', userId, leaveErr.message);
    }

    // 2. MongoDB Attendance
    try {
      const memberOr = [{ type: 'teacher' }];
      if (userId) {
        memberOr.push({ 'records.memberId': String(userId) });
        memberOr.push({ 'students.studentId': String(userId) });
      }
      if (employeeId) {
        memberOr.push({ 'records.employeeId': String(employeeId) });
      }

      const attRecords = await Attendance.find({
        $and: [
          {
            $or: [
              { date: { $gte: monthStart, $lte: monthEnd } },
              { attendanceDate: { $gte: monthStart, $lte: monthEnd } },
            ],
          },
          {
            $or: memberOr,
          },
        ],
      });

      if (attRecords.length > 0) {
        hasExplicitAttendance = true;
        attRecords.forEach((att) => {
          const list = att.records || att.students || att.attendance || [];
          const item = list.find(
            (r) =>
              String(r.memberId) === String(userId) ||
              String(r.studentId) === String(userId) ||
              (employeeId && String(r.employeeId) === String(employeeId))
          );
          if (item) {
            const st = (item.status || '').toLowerCase();
            if (st === 'present') presentDays++;
            else if (st === 'absent') absentDays++;
            else if (st.includes('half')) halfDays++;
            else if (st === 'late') {
              presentDays++;
              lateDays++;
            }
          }
        });
      }
    } catch (attErr) {
      console.warn('Attendance query note for user', userId, attErr.message);
    }
  }

  // If no explicit daily punch records exist, default to normal working days minus approved leaves
  if (!hasExplicitAttendance) {
    presentDays = Math.max(0, standardWorkingDays - paidLeaveDays - unpaidLeaveDays);
    absentDays = 0;
  }

  // Effective Loss of Pay (LOP) Days
  let lopDays = Math.max(0, unpaidLeaveDays + absentDays + (0.5 * halfDays));

  // If the employee fulfilled the full working days via presence or approved paid leaves, LOP is 0
  if (presentDays + paidLeaveDays >= standardWorkingDays && unpaidLeaveDays === 0 && absentDays === 0) {
    lopDays = 0;
  }

  // Per-day salary calculation (Basic + DA) / totalDaysInMonth
  const baseSalaryForPerDay = Number(basicPay || 0) + Number(da || 0);
  const perDayRate = totalDaysInMonth > 0 ? Math.round(baseSalaryForPerDay / totalDaysInMonth) : 0;

  // LOP monetary deduction
  const lopDeduction = Math.round(lopDays * perDayRate);

  return {
    totalDaysInMonth,
    standardWorkingDays,
    presentDays,
    paidLeaveDays,
    unpaidLeaveDays,
    absentDays,
    halfDays,
    lateDays,
    lopDays,
    perDayRate,
    lopDeduction,
    pendingLeavesCount,
    hasExplicitAttendance,
    isProratedJoining: unworkedPreJoiningDays > 0,
    unworkedPreJoiningDays,
  };
};

/**
 * Retrieves all staff members eligible for payroll with live Attendance & Leave analysis.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getPayrollStaff = async (req, res) => {
  try {
    const { search = '', role = '', department = '', month = '', year = '' } = req.query;

    const currentYear = year ? Number(year) : new Date().getFullYear();
    const currentMonth = month || new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date());
    const monthNum = getMonthNumber(currentMonth.split(' ')[0]);

    const reqUserRole = (req.user?.role || '').toLowerCase().replace(/_/g, '-');
    const isManagementOrAccountant = [
      'super-admin',
      'school-admin',
      'admin',
      'principal',
      'director',
      'accountant',
    ].includes(reqUserRole);

    if (checkFallback()) {
      let users = FallbackDb.find('users') || [];
      users = users.filter((u) => {
        const r = (u.role || '').toLowerCase().replace(/_/g, '-');
        return !EXCLUDED_PAYROLL_ROLES.includes(r);
      });

      if (!isManagementOrAccountant && req.user?._id) {
        users = users.filter((u) => String(u._id) === String(req.user._id));
      }

      if (search) {
        const s = search.toLowerCase();
        users = users.filter(
          (u) =>
            (u.name && u.name.toLowerCase().includes(s)) ||
            (u.employeeId && u.employeeId.toLowerCase().includes(s)) ||
            (u.email && u.email.toLowerCase().includes(s))
        );
      }
      if (role) {
        users = users.filter((u) => (u.role || '').toLowerCase() === role.toLowerCase());
      }
      if (department) {
        users = users.filter((u) => (u.department || '').toLowerCase() === department.toLowerCase());
      }

      const records = FallbackDb.find('payrollRecords') || [];
      const disbursements = FallbackDb.find('payrollDisbursements') || [];

      const staffList = await Promise.all(
        users.map(async (u) => {
          const uId = String(u._id);
          const record = records.find((r) => String(r.userId) === uId) || {
            basicPay: Number(u.salary || 0),
            hra: 0,
            da: 0,
            specialAllowance: 0,
            pfDeduction: 0,
            taxDeduction: 0,
            otherDeductions: 0,
            netPay: Number(u.salary || 0),
            paymentMode: 'Bank Transfer',
          };

          const disb = disbursements.find(
            (d) => String(d.userId) === uId && d.month === currentMonth && Number(d.year) === currentYear
          );

          const gross =
            Number(record.basicPay || 0) +
            Number(record.hra || 0) +
            Number(record.da || 0) +
            Number(record.specialAllowance || 0);

          const statutoryDeductions =
            Number(record.pfDeduction || 0) +
            Number(record.taxDeduction || 0) +
            Number(record.otherDeductions || 0);

          let attMetrics = {
            totalDaysInMonth: 31,
            standardWorkingDays: 26,
            presentDays: 26,
            paidLeaveDays: 0,
            unpaidLeaveDays: 0,
            absentDays: 0,
            halfDays: 0,
            lateDays: 0,
            lopDays: 0,
            perDayRate: 0,
            lopDeduction: 0,
            pendingLeavesCount: 0,
            hasExplicitAttendance: false,
          };
          try {
            attMetrics = await resolveStaffMonthlyAttendanceAndLeaves({
              userId: u._id,
              employeeId: u.employeeId,
              teacherId: u.profileId,
              joiningDate: u.joiningDate,
              year: currentYear,
              monthNumber: monthNum,
              basicPay: record.basicPay,
              da: record.da,
              grossPay: gross,
            });
          } catch (attErr) {
            console.warn('Attendance resolve note for staff (fallback):', u.name, attErr.message);
          }

          const totalDeductions = statutoryDeductions + attMetrics.lopDeduction;
          const adjustedNetPay = Math.max(0, gross - totalDeductions);

          return {
            _id: u._id,
            employeeId: u.employeeId || `EMP-${String(u._id).slice(-4)}`,
            name: u.name,
            email: u.email,
            role: u.role,
            designation: u.designation || u.role,
            department: u.department || 'Academics',
            avatar: u.avatar || u.photo || '',
            joiningDate: u.joiningDate,
            salaryStructure: {
              ...record,
              grossPay: gross,
              statutoryDeductions,
              adjustedNetPay,
            },
            attendanceMetrics: attMetrics,
            paymentStatus: disb ? disb.paymentStatus : 'Pending',
            disbursementDetails: disb || null,
          };
        })
      );

      return sendSuccess(res, undefined, { count: staffList.length, staff: staffList });
    }

    // MongoDB query
    const userFilter = {
      role: { $nin: EXCLUDED_PAYROLL_ROLES },
    };

    if (!isManagementOrAccountant && req.user?._id) {
      userFilter._id = req.user._id;
    }

    if (role) userFilter.role = role;
    if (department) userFilter.department = department;
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      userFilter.$or = [{ name: regex }, { employeeId: regex }, { email: regex }];
    }

    const users = await User.find(userFilter)
      .select('name email employeeId role designation department avatar photo joiningDate salary profileId')
      .sort({ name: 1 });

    const userIds = users.map((u) => u._id);
    const records = await PayrollRecord.find({ userId: { $in: userIds } });
    const disbursements = await PayrollDisbursement.find({
      userId: { $in: userIds },
      month: currentMonth,
      year: currentYear,
    });

    const recordMap = new Map();
    records.forEach((r) => recordMap.set(String(r.userId), r));

    const disbMap = new Map();
    disbursements.forEach((d) => disbMap.set(String(d.userId), d));

    const staffList = await Promise.all(
      users.map(async (u) => {
        const uId = String(u._id);
        const record = recordMap.get(uId) || {
          basicPay: Number(u.salary || 0),
          hra: 0,
          da: 0,
          specialAllowance: 0,
          pfDeduction: 0,
          taxDeduction: 0,
          otherDeductions: 0,
          netPay: Number(u.salary || 0),
          paymentMode: 'Bank Transfer',
        };

        const disb = disbMap.get(uId);

        const gross =
          Number(record.basicPay || 0) +
          Number(record.hra || 0) +
          Number(record.da || 0) +
          Number(record.specialAllowance || 0);

        const statutoryDeductions =
          Number(record.pfDeduction || 0) +
          Number(record.taxDeduction || 0) +
          Number(record.otherDeductions || 0);

        let attMetrics = {
          totalDaysInMonth: 31,
          standardWorkingDays: 26,
          presentDays: 26,
          paidLeaveDays: 0,
          unpaidLeaveDays: 0,
          absentDays: 0,
          halfDays: 0,
          lateDays: 0,
          lopDays: 0,
          perDayRate: 0,
          lopDeduction: 0,
          pendingLeavesCount: 0,
          hasExplicitAttendance: false,
        };
        try {
          attMetrics = await resolveStaffMonthlyAttendanceAndLeaves({
            userId: u._id,
            employeeId: u.employeeId,
            teacherId: u.profileId,
            joiningDate: u.joiningDate,
            year: currentYear,
            monthNumber: monthNum,
            basicPay: record.basicPay,
            da: record.da,
            grossPay: gross,
          });
        } catch (attErr) {
          console.warn('Attendance resolve note for staff (mongo):', u.name, attErr.message);
        }

        const totalDeductions = statutoryDeductions + attMetrics.lopDeduction;
        const adjustedNetPay = Math.max(0, gross - totalDeductions);

        return {
          _id: u._id,
          employeeId: u.employeeId || `EMP-${String(u._id).slice(-4)}`,
          name: u.name,
          email: u.email,
          role: u.role,
          designation: u.designation || u.role,
          department: u.department || 'Academics',
          avatar: u.avatar || u.photo || '',
          joiningDate: u.joiningDate,
          salaryStructure: {
            ...(record.toObject ? record.toObject() : record),
            grossPay: gross,
            statutoryDeductions,
            adjustedNetPay,
          },
          attendanceMetrics: attMetrics,
          paymentStatus: disb ? disb.paymentStatus : 'Pending',
          disbursementDetails: disb || null,
        };
      })
    );

    return sendSuccess(res, undefined, { count: staffList.length, staff: staffList });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Assigns or updates a staff member's salary compensation structure.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const assignSalaryStructure = async (req, res) => {
  try {
    const {
      userId,
      basicPay = 0,
      hra = 0,
      da = 0,
      specialAllowance = 0,
      pfDeduction = 0,
      taxDeduction = 0,
      otherDeductions = 0,
      paymentMode = 'Bank Transfer',
      bankName = '',
      accountNumber = '',
      ifscCode = '',
    } = req.body;

    if (!userId) {
      return sendBadRequest(res, 'User ID is required');
    }

    const nBasic = Number(basicPay) || 0;
    const nHra = Number(hra) || 0;
    const nDa = Number(da) || 0;
    const nSpecial = Number(specialAllowance) || 0;
    const nPf = Number(pfDeduction) || 0;
    const nTax = Number(taxDeduction) || 0;
    const nOther = Number(otherDeductions) || 0;
    const net = Math.max(0, nBasic + nHra + nDa + nSpecial - (nPf + nTax + nOther));

    if (checkFallback()) {
      const users = FallbackDb.find('users') || [];
      const user = users.find((u) => String(u._id) === String(userId));
      if (!user) return sendNotFound(res, 'User not found');

      const records = FallbackDb.find('payrollRecords') || [];
      const existingIndex = records.findIndex((r) => String(r.userId) === String(userId));

      const updatedRecord = {
        _id: existingIndex > -1 ? records[existingIndex]._id : `pr-${Date.now()}`,
        userId,
        employeeId: user.employeeId || `EMP-${String(userId).slice(-4)}`,
        staffName: user.name,
        role: user.role,
        designation: user.designation || user.role,
        department: user.department || 'Academics',
        basicPay: nBasic,
        hra: nHra,
        da: nDa,
        specialAllowance: nSpecial,
        pfDeduction: nPf,
        taxDeduction: nTax,
        otherDeductions: nOther,
        netPay: net,
        paymentMode,
        bankName,
        accountNumber,
        ifscCode,
        status: 'active',
        updatedAt: new Date().toISOString(),
      };

      if (existingIndex > -1) {
        records[existingIndex] = updatedRecord;
      } else {
        records.push(updatedRecord);
      }

      user.salary = net;
      return sendSuccess(res, 'Salary structure updated', { salaryStructure: updatedRecord });
    }

    const user = isValidObjectId(userId)
      ? await User.findById(userId)
      : await User.findOne({ _id: userId });
    if (!user) return sendNotFound(res, 'User not found');

    let record = await PayrollRecord.findOne({ userId });
    if (!record) {
      record = new PayrollRecord({
        userId,
        employeeId: user.employeeId || `EMP-${String(userId).slice(-4)}`,
        staffName: user.name,
        role: user.role,
        designation: user.designation || user.role,
        department: user.department || 'Academics',
      });
    }

    record.basicPay = nBasic;
    record.hra = nHra;
    record.da = nDa;
    record.specialAllowance = nSpecial;
    record.pfDeduction = nPf;
    record.taxDeduction = nTax;
    record.otherDeductions = nOther;
    record.netPay = net;
    record.paymentMode = paymentMode;
    record.bankName = bankName;
    record.accountNumber = accountNumber;
    record.ifscCode = ifscCode;

    await record.save();

    user.salary = net;
    await user.save();

    return sendSuccess(res, 'Salary structure saved successfully', { salaryStructure: record });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves payroll budget and disbursement summary for an academic session.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getPayrollSummary = async (req, res) => {
  try {
    const { sessionId, month, year } = req.query;

    const currentYear = year ? Number(year) : new Date().getFullYear();
    const currentMonth = month || new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date());

    let targetSessionId = sessionId;

    if (checkFallback()) {
      if (!targetSessionId) {
        const sessions = FallbackDb.find('academicSessions') || [];
        const active = sessions.find((s) => s.isCurrent) || sessions[0];
        targetSessionId = active ? String(active._id) : null;
      }

      const budgets = FallbackDb.find('budgetAllocations') || [];
      const budget = budgets.find((b) => String(b.sessionId) === String(targetSessionId));

      const disbursements = FallbackDb.find('payrollDisbursements') || [];
      const monthDisbs = disbursements.filter((d) => d.month === currentMonth && Number(d.year) === currentYear);
      const monthlyTotal = monthDisbs.reduce((acc, curr) => acc + (Number(curr.netPay) || 0), 0);

      const salaryBudget = budget ? Number(budget.salaryBudget || 0) : 0;
      const salarySpent = budget ? Number(budget.salarySpent || 0) : 0;
      const salaryRemaining = Math.max(0, salaryBudget - salarySpent);

      return sendSuccess(res, undefined, {
        summary: {
          sessionId: targetSessionId,
          sessionName: budget ? budget.sessionName : 'Current Session',
          month: currentMonth,
          year: currentYear,
          salaryBudget,
          salarySpent,
          salaryRemaining,
          monthlyDisbursedTotal: monthlyTotal,
          disbursedCount: monthDisbs.length,
          budgetStatus: budget ? budget.status : 'no-budget',
          isBudgetExceeded: salarySpent > salaryBudget,
          deficit: Math.max(0, salarySpent - salaryBudget),
        },
      });
    }

    if (!targetSessionId) {
      const activeSession = (await AcademicSession.findOne({ isCurrent: true })) || (await AcademicSession.findOne().sort({ startDate: -1 }));
      targetSessionId = activeSession ? String(activeSession._id) : null;
    }

    const budget = (targetSessionId && isValidObjectId(targetSessionId))
      ? await BudgetAllocation.findOne({ sessionId: targetSessionId })
      : null;

    const monthDisbursements = await PayrollDisbursement.find({
      month: currentMonth,
      year: currentYear,
    });

    const monthlyTotal = monthDisbursements.reduce((acc, curr) => acc + (Number(curr.netPay) || 0), 0);

    const salaryBudget = budget ? budget.salaryBudget : 0;
    const salarySpent = budget ? budget.salarySpent : 0;
    const salaryRemaining = Math.max(0, salaryBudget - salarySpent);

    return sendSuccess(res, undefined, {
      summary: {
        sessionId: targetSessionId,
        sessionName: budget ? budget.sessionName : 'Current Session',
        month: currentMonth,
        year: currentYear,
        salaryBudget,
        salarySpent,
        salaryRemaining,
        monthlyDisbursedTotal: monthlyTotal,
        disbursedCount: monthDisbursements.length,
        budgetStatus: budget ? budget.status : 'no-budget',
        isBudgetExceeded: salarySpent > salaryBudget,
        deficit: Math.max(0, salarySpent - salaryBudget),
      },
    });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Disburses salary to an individual staff member with attendance/LOP deductions and budget verification.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const disburseSalary = async (req, res) => {
  try {
    const {
      userId,
      sessionId,
      month,
      year,
      paymentMethod = 'Bank Transfer',
      transactionReference = '',
      remarks = '',
      customLopDays = null,
      customPresentDays = null,
    } = req.body;

    if (!userId) {
      return sendBadRequest(res, 'User ID is required');
    }

    const currentYear = year ? Number(year) : new Date().getFullYear();
    const currentMonth = month || new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date());
    const monthNum = getMonthNumber(currentMonth.split(' ')[0]);

    let targetSessionId = sessionId;

    if (checkFallback()) {
      if (!targetSessionId) {
        const sessions = FallbackDb.find('academicSessions') || [];
        const active = sessions.find((s) => s.isCurrent) || sessions[0];
        targetSessionId = active ? String(active._id) : 'default-sess';
      }

      // Check if already paid
      const disbursements = FallbackDb.find('payrollDisbursements') || [];
      const alreadyPaid = disbursements.find(
        (d) => String(d.userId) === String(userId) && d.month === currentMonth && Number(d.year) === currentYear
      );
      if (alreadyPaid) {
        return sendBadRequest(res, `Salary has already been disbursed for ${currentMonth}`);
      }

      const users = FallbackDb.find('users') || [];
      const user = users.find((u) => String(u._id) === String(userId));
      if (!user) return sendNotFound(res, 'Employee not found');

      const records = FallbackDb.find('payrollRecords') || [];
      const record = records.find((r) => String(r.userId) === String(userId)) || {
        basicPay: Number(user.salary || 0),
        hra: 0,
        da: 0,
        specialAllowance: 0,
        pfDeduction: 0,
        taxDeduction: 0,
        otherDeductions: 0,
      };

      const gross =
        Number(record.basicPay || 0) +
        Number(record.hra || 0) +
        Number(record.da || 0) +
        Number(record.specialAllowance || 0);

      const statutoryDeductions =
        Number(record.pfDeduction || 0) +
        Number(record.taxDeduction || 0) +
        Number(record.otherDeductions || 0);

      const attMetrics = await resolveStaffMonthlyAttendanceAndLeaves({
        userId: user._id,
        employeeId: user.employeeId,
        teacherId: user.profileId,
        joiningDate: user.joiningDate,
        year: currentYear,
        monthNumber: monthNum,
        basicPay: record.basicPay,
        da: record.da,
        grossPay: gross,
      });

      const finalLopDays = customLopDays !== null ? Number(customLopDays) : attMetrics.lopDays;
      const finalLopDeduction = Math.round(finalLopDays * attMetrics.perDayRate);
      const totalDeductions = statutoryDeductions + finalLopDeduction;
      const netPay = Math.max(0, gross - totalDeductions);

      // Check Budget
      const budgets = FallbackDb.find('budgetAllocations') || [];
      const budget = budgets.find((b) => String(b.sessionId) === String(targetSessionId));

      if (budget) {
        const salaryBudget = Number(budget.salaryBudget || 0);
        const salarySpent = Number(budget.salarySpent || 0);
        const remaining = salaryBudget - salarySpent;

        if (netPay > remaining) {
          return res.status(400).json({
            success: false,
            isOverBudget: true,
            message: `Disbursement amount (₹${netPay.toLocaleString()}) exceeds the remaining Salary Budget (₹${remaining.toLocaleString()}) by ₹${(netPay - remaining).toLocaleString()}. Please allocate a Revised Budget in Settings.`,
            requiredAmount: netPay,
            remainingBudget: remaining,
            deficit: netPay - remaining,
            sessionId: targetSessionId,
            sessionName: budget.sessionName,
          });
        }

        budget.salarySpent = salarySpent + netPay;
      }

      const newDisbursement = {
        _id: `disb-${Date.now()}`,
        userId,
        employeeId: user.employeeId || `EMP-${String(userId).slice(-4)}`,
        staffName: user.name,
        role: user.role,
        designation: user.designation || user.role,
        department: user.department || 'Academics',
        sessionId: targetSessionId,
        sessionName: budget ? budget.sessionName : 'Active Session',
        month: currentMonth,
        monthNumber: monthNum,
        year: currentYear,
        totalDaysInMonth: attMetrics.totalDaysInMonth,
        workingDays: attMetrics.standardWorkingDays,
        presentDays: customPresentDays !== null ? Number(customPresentDays) : attMetrics.presentDays,
        paidLeaveDays: attMetrics.paidLeaveDays,
        unpaidLeaveDays: attMetrics.unpaidLeaveDays,
        absentDays: attMetrics.absentDays,
        halfDays: attMetrics.halfDays,
        lateDays: attMetrics.lateDays,
        lopDays: finalLopDays,
        perDayRate: attMetrics.perDayRate,
        lopDeduction: finalLopDeduction,
        basicPay: Number(record.basicPay || 0),
        hra: Number(record.hra || 0),
        da: Number(record.da || 0),
        specialAllowance: Number(record.specialAllowance || 0),
        allowances: (Number(record.hra || 0) + Number(record.da || 0) + Number(record.specialAllowance || 0)),
        grossPay: gross,
        pfDeduction: Number(record.pfDeduction || 0),
        taxDeduction: Number(record.taxDeduction || 0),
        otherDeductions: Number(record.otherDeductions || 0),
        statutoryDeductions,
        deductions: totalDeductions,
        netPay,
        paymentMethod,
        transactionReference: transactionReference || `TXN-${Date.now()}`,
        paymentStatus: 'Paid',
        disbursedAt: new Date().toISOString(),
        disbursedBy: req.user?._id,
        remarks,
      };

      disbursements.push(newDisbursement);

      // Log Expense
      const expenses = FallbackDb.find('expenses') || [];
      expenses.push({
        _id: `exp-${Date.now()}`,
        title: `Staff Salary: ${user.name} (${currentMonth})`,
        amount: netPay,
        category: 'Payroll',
        date: new Date().toISOString(),
        refInvoice: newDisbursement.transactionReference,
      });

      return sendCreated(
        res,
        `Salary of ₹${netPay.toLocaleString()} disbursed successfully to ${user.name}`,
        { disbursement: newDisbursement }
      );
    }

    // MongoDB
    if (!targetSessionId) {
      const activeSession = (await AcademicSession.findOne({ isCurrent: true })) || (await AcademicSession.findOne().sort({ startDate: -1 }));
      targetSessionId = activeSession ? String(activeSession._id) : null;
    }

    const existingDisb = await PayrollDisbursement.findOne({
      userId: isValidObjectId(userId) ? new mongoose.Types.ObjectId(String(userId)) : userId,
      month: currentMonth,
      year: currentYear,
    });

    if (existingDisb) {
      return sendBadRequest(res, `Salary already disbursed for ${currentMonth}`);
    }

    const user = isValidObjectId(userId)
      ? await User.findById(userId)
      : await User.findOne({ _id: userId });
    if (!user) return sendNotFound(res, 'Employee not found');

    const record = (await PayrollRecord.findOne({ userId })) || {
      basicPay: Number(user.salary || 0),
      hra: 0,
      da: 0,
      specialAllowance: 0,
      pfDeduction: 0,
      taxDeduction: 0,
      otherDeductions: 0,
    };

    const gross =
      Number(record.basicPay || 0) +
      Number(record.hra || 0) +
      Number(record.da || 0) +
      Number(record.specialAllowance || 0);

    const statutoryDeductions =
      Number(record.pfDeduction || 0) +
      Number(record.taxDeduction || 0) +
      Number(record.otherDeductions || 0);

    const attMetrics = await resolveStaffMonthlyAttendanceAndLeaves({
      userId: user._id,
      employeeId: user.employeeId,
      teacherId: user.profileId,
      joiningDate: user.joiningDate,
      year: currentYear,
      monthNumber: monthNum,
      basicPay: record.basicPay,
      da: record.da,
      grossPay: gross,
    });

    const finalLopDays = customLopDays !== null ? Number(customLopDays) : attMetrics.lopDays;
    const finalLopDeduction = Math.round(finalLopDays * attMetrics.perDayRate);
    const totalDeductions = statutoryDeductions + finalLopDeduction;
    const netPay = Math.max(0, gross - totalDeductions);

    // Validate against BudgetAllocation
    if (targetSessionId && isValidObjectId(targetSessionId)) {
      const budget = await BudgetAllocation.findOne({ sessionId: targetSessionId });
      if (budget) {
        const remaining = budget.salaryBudget - budget.salarySpent;
        if (netPay > remaining) {
          return res.status(400).json({
            success: false,
            isOverBudget: true,
            message: `Disbursement amount (₹${netPay.toLocaleString()}) exceeds the remaining Salary Budget (₹${remaining.toLocaleString()}) by ₹${(netPay - remaining).toLocaleString()}. Please allocate a Revised Budget in Settings.`,
            requiredAmount: netPay,
            remainingBudget: remaining,
            deficit: netPay - remaining,
            sessionId: targetSessionId,
            sessionName: budget.sessionName,
          });
        }

        budget.salarySpent += netPay;
        await budget.save();
      }
    }

    const sessionObj = (targetSessionId && isValidObjectId(targetSessionId))
      ? await AcademicSession.findById(targetSessionId)
      : null;

    const disbursement = new PayrollDisbursement({
      userId,
      employeeId: user.employeeId || `EMP-${String(userId).slice(-4)}`,
      staffName: user.name,
      role: user.role,
      designation: user.designation || user.role,
      department: user.department || 'Academics',
      sessionId: targetSessionId,
      sessionName: sessionObj ? sessionObj.sessionName : '',
      month: currentMonth,
      monthNumber: monthNum,
      year: currentYear,
      totalDaysInMonth: attMetrics.totalDaysInMonth,
      workingDays: attMetrics.standardWorkingDays,
      presentDays: customPresentDays !== null ? Number(customPresentDays) : attMetrics.presentDays,
      paidLeaveDays: attMetrics.paidLeaveDays,
      unpaidLeaveDays: attMetrics.unpaidLeaveDays,
      absentDays: attMetrics.absentDays,
      halfDays: attMetrics.halfDays,
      lateDays: attMetrics.lateDays,
      lopDays: finalLopDays,
      perDayRate: attMetrics.perDayRate,
      lopDeduction: finalLopDeduction,
      basicPay: Number(record.basicPay || 0),
      hra: Number(record.hra || 0),
      da: Number(record.da || 0),
      specialAllowance: Number(record.specialAllowance || 0),
      allowances: (Number(record.hra || 0) + Number(record.da || 0) + Number(record.specialAllowance || 0)),
      grossPay: gross,
      pfDeduction: Number(record.pfDeduction || 0),
      taxDeduction: Number(record.taxDeduction || 0),
      otherDeductions: Number(record.otherDeductions || 0),
      statutoryDeductions,
      deductions: totalDeductions,
      netPay,
      paymentMethod,
      transactionReference: transactionReference || `TXN-${Date.now()}`,
      paymentStatus: 'Paid',
      disbursedAt: new Date(),
      disbursedBy: req.user?._id,
      remarks,
    });

    await disbursement.save();

    try {
      await Expense.create({
        title: `Staff Salary: ${user.name} (${currentMonth})`,
        amount: netPay,
        category: 'Payroll',
        date: new Date(),
        refInvoice: disbursement.transactionReference,
      });
    } catch (e) {
      console.warn('Expense record creation note:', e.message);
    }

    return sendCreated(
      res,
      `Salary of ₹${netPay.toLocaleString()} disbursed successfully to ${user.name} (LOP deduction: ₹${finalLopDeduction.toLocaleString()})`,
      { disbursement }
    );
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Batch processes salary disbursements across multiple staff members.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const disburseBatch = async (req, res) => {
  try {
    const { userIds = [], sessionId, month, year, paymentMethod = 'Bank Transfer' } = req.body;

    const currentYear = year ? Number(year) : new Date().getFullYear();
    const currentMonth = month || new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date());

    let targetSessionId = sessionId;
    if (!targetSessionId) {
      if (checkFallback()) {
        const sessions = FallbackDb.find('academicSessions') || [];
        const active = sessions.find((s) => s.isCurrent) || sessions[0];
        targetSessionId = active ? String(active._id) : null;
      } else {
        const activeSession = (await AcademicSession.findOne({ isCurrent: true })) || (await AcademicSession.findOne().sort({ startDate: -1 }));
        targetSessionId = activeSession ? String(activeSession._id) : null;
      }
    }

    let successfulCount = 0;
    const failedList = [];
    let totalDisbursedAmount = 0;

    for (const uId of userIds) {
      try {
        const fakeReq = {
          body: {
            userId: uId,
            sessionId: targetSessionId,
            month: currentMonth,
            year: currentYear,
            paymentMethod,
            transactionReference: `BATCH-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          },
          user: req.user,
        };

        let resultData = null;
        let statusCode = 200;
        const fakeRes = {
          status: (code) => {
            statusCode = code;
            return fakeRes;
          },
          json: (data) => {
            resultData = data;
            return fakeRes;
          },
        };

        await disburseSalary(fakeReq, fakeRes);

        if (statusCode >= 200 && statusCode < 300 && resultData?.success) {
          successfulCount++;
          totalDisbursedAmount += resultData.disbursement?.netPay || 0;
        } else {
          failedList.push({
            userId: uId,
            reason: resultData?.message || 'Failed',
            isOverBudget: resultData?.isOverBudget || false,
          });
        }
      } catch (err) {
        failedList.push({ userId: uId, reason: err.message });
      }
    }

    return sendSuccess(
      res,
      `Batch processed: ${successfulCount} staff paid successfully. ${failedList.length} failed or skipped.`,
      {
        processed: userIds.length,
        successfulCount,
        failedCount: failedList.length,
        totalDisbursedAmount,
        failedList,
      }
    );
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves historical payroll disbursements with multi-filter support.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getDisbursements = async (req, res) => {
  try {
    const { userId, month, year, sessionId } = req.query;

    const reqUserRole = (req.user?.role || '').toLowerCase().replace(/_/g, '-');
    const isManagementOrAccountant = [
      'super-admin',
      'school-admin',
      'admin',
      'principal',
      'director',
      'accountant',
    ].includes(reqUserRole);

    const targetUserId = !isManagementOrAccountant && req.user?._id ? String(req.user._id) : userId;

    const filter = {};
    if (targetUserId && isValidObjectId(targetUserId)) filter.userId = targetUserId;
    if (month) filter.month = month;
    if (year) filter.year = Number(year);
    if (sessionId && isValidObjectId(sessionId)) filter.sessionId = sessionId;

    if (checkFallback()) {
      let list = FallbackDb.find('payrollDisbursements') || [];
      if (targetUserId) list = list.filter((d) => String(d.userId) === String(targetUserId));
      if (month) list = list.filter((d) => d.month === month);
      if (year) list = list.filter((d) => Number(d.year) === Number(year));
      return sendSuccess(res, undefined, { count: list.length, disbursements: list });
    }

    const disbursements = await PayrollDisbursement.find(filter)
      .populate('disbursedBy', 'name role')
      .sort({ disbursedAt: -1 });

    return sendSuccess(res, undefined, { count: disbursements.length, disbursements });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves comprehensive payroll profile, metrics, salary chain, and attendance breakdown for an employee.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getStaffPayrollDetails = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return sendBadRequest(res, 'Staff ID is required');
    }

    let user = null;
    if (checkFallback()) {
      const users = FallbackDb.find('users') || [];
      user = users.find((u) => String(u._id) === String(id) || u.employeeId === id);
    } else {
      user = isValidObjectId(id)
        ? await User.findById(id)
        : await User.findOne({ employeeId: id });
    }

    if (!user) {
      return sendNotFound(res, 'Staff member not found');
    }

    const reqUserRole = (req.user?.role || '').toLowerCase().replace(/_/g, '-');
    const isManagementOrAccountant = [
      'super-admin',
      'school-admin',
      'admin',
      'principal',
      'director',
      'accountant',
    ].includes(reqUserRole);

    if (!isManagementOrAccountant && req.user?._id) {
      if (String(req.user._id) !== String(user._id)) {
        return sendForbidden(res, 'You are only authorized to view your own payroll details');
      }
    }

    const uId = String(user._id);

    // 1. Fetch Salary Structure
    let record = null;
    if (checkFallback()) {
      const records = FallbackDb.find('payrollRecords') || [];
      record = records.find((r) => String(r.userId) === uId);
    } else {
      record = await PayrollRecord.findOne({ userId: user._id });
    }

    if (!record) {
      record = {
        basicPay: Number(user.salary || 0),
        hra: 0,
        da: 0,
        specialAllowance: 0,
        pfDeduction: 0,
        taxDeduction: 0,
        otherDeductions: 0,
        netPay: Number(user.salary || 0),
        paymentMode: 'Bank Transfer',
        bankName: '',
        accountNumber: '',
        ifscCode: '',
        status: 'active',
      };
    }

    // 2. Fetch all disbursements for this person
    let allDisbursements = [];
    if (checkFallback()) {
      const disbs = FallbackDb.find('payrollDisbursements') || [];
      allDisbursements = disbs.filter((d) => String(d.userId) === uId);
    } else {
      allDisbursements = await PayrollDisbursement.find({ userId: user._id })
        .populate('disbursedBy', 'name role')
        .sort({ year: 1, monthNumber: 1, disbursedAt: 1 });
    }

    // 3. Lifetime Spend Metrics
    const totalLifetimePaid = allDisbursements.reduce(
      (sum, d) => sum + (Number(d.netPay) || 0),
      0
    );
    const totalDisbursementsCount = allDisbursements.length;
    const averageMonthlyPay =
      totalDisbursementsCount > 0 ? Math.round(totalLifetimePaid / totalDisbursementsCount) : 0;

    // 4. Salary Chain
    const salaryChain = allDisbursements.map((d, index) => {
      const item = d.toObject ? d.toObject() : { ...d };
      return {
        ...item,
        stepNumber: index + 1,
        formattedDisbursedDate: d.disbursedAt
          ? new Date(d.disbursedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
          : `${d.month} ${d.year}`,
      };
    });

    // 5. Session-wise Spend Aggregates
    const sessionMap = new Map();
    allDisbursements.forEach((d) => {
      const sKey = String(d.sessionId || 'Default');
      const sName = d.sessionName || 'Academic Session';
      if (!sessionMap.has(sKey)) {
        sessionMap.set(sKey, {
          sessionId: sKey,
          sessionName: sName,
          totalPaid: 0,
          disbursementsCount: 0,
          months: [],
        });
      }
      const entry = sessionMap.get(sKey);
      entry.totalPaid += Number(d.netPay) || 0;
      entry.disbursementsCount += 1;
      entry.months.push({
        month: d.month,
        year: d.year,
        netPay: d.netPay,
        paymentMethod: d.paymentMethod,
        transactionReference: d.transactionReference,
        disbursedAt: d.disbursedAt,
      });
    });

    const sessionSummaries = Array.from(sessionMap.values());

    // 6. Month-wise Status Ledger
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const now = new Date();
    const curYear = now.getFullYear();
    const curMonthIndex = now.getMonth();

    let startYear = curYear;
    let startMonthIdx = 0;

    if (user.joiningDate) {
      const jDate = new Date(user.joiningDate);
      if (!isNaN(jDate.getTime())) {
        startYear = jDate.getFullYear();
        startMonthIdx = jDate.getMonth();
        if (curYear - startYear > 2) {
          startYear = curYear - 2;
          startMonthIdx = 0;
        }
      }
    }

    const monthWiseLedger = [];
    const gross =
      Number(record.basicPay || 0) +
      Number(record.hra || 0) +
      Number(record.da || 0) +
      Number(record.specialAllowance || 0);

    let y = startYear;
    let m = startMonthIdx;

    while (y < curYear || (y === curYear && m <= curMonthIndex)) {
      const mName = monthNames[m];
      const fullMStr = `${mName} ${y}`;
      const foundDisb = allDisbursements.find(
        (d) => d.month === fullMStr && Number(d.year) === y
      );

      const attMetrics = await resolveStaffMonthlyAttendanceAndLeaves({
        userId: user._id,
        employeeId: user.employeeId,
        teacherId: user.profileId,
        joiningDate: user.joiningDate,
        year: y,
        monthNumber: m + 1,
        basicPay: record.basicPay,
        da: record.da,
        grossPay: gross,
      });

      monthWiseLedger.push({
        monthName: mName,
        year: y,
        monthKey: fullMStr,
        monthNumber: m + 1,
        isPaid: Boolean(foundDisb),
        status: foundDisb ? 'PAID' : 'NOT PAID',
        disbursement: foundDisb || null,
        expectedNet: Math.max(
          0,
          gross -
            (Number(record.pfDeduction || 0) +
              Number(record.taxDeduction || 0) +
              Number(record.otherDeductions || 0)) -
            attMetrics.lopDeduction
        ),
        attendance: attMetrics,
      });

      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }

    monthWiseLedger.reverse();

    // 7. Leaves History
    let staffLeaves = [];
    if (checkFallback()) {
      const allLeaves = FallbackDb.find('leaves') || [];
      staffLeaves = allLeaves.filter(
        (l) =>
          String(l.userId) === uId ||
          (user.profileId && String(l.teacherId) === String(user.profileId))
      );
    } else {
      const orConditions = [{ userId: String(uId) }];
      if (isValidObjectId(uId)) {
        orConditions.push({ userId: new mongoose.Types.ObjectId(uId) });
      }
      if (user.profileId) {
        orConditions.push({ userId: String(user.profileId) });
        if (isValidObjectId(user.profileId)) {
          orConditions.push({ teacherId: new mongoose.Types.ObjectId(String(user.profileId)) });
        }
      }
      staffLeaves = await Leave.find({ $or: orConditions }).sort({ createdAt: -1 });
    }

    return sendSuccess(res, undefined, {
      staff: {
        _id: user._id,
        name: user.name,
        employeeId: user.employeeId || `EMP-${String(user._id).slice(-4)}`,
        email: user.email,
        phone: user.phone || '—',
        role: user.role,
        designation: user.designation || user.role,
        department: user.department || 'Academics',
        avatar: user.avatar || user.photo || '',
        joiningDate: user.joiningDate,
        qualification: user.qualification || '—',
        gender: user.gender || '—',
        address: user.address || '—',
        isActive: user.isActive !== false,
      },
      salaryStructure: record.toObject ? record.toObject() : record,
      lifetimeMetrics: {
        totalLifetimePaid,
        totalDisbursementsCount,
        averageMonthlyPay,
        firstDisbursementDate: salaryChain.length > 0 ? salaryChain[0].formattedDisbursedDate : null,
        latestDisbursementDate:
          salaryChain.length > 0 ? salaryChain[salaryChain.length - 1].formattedDisbursedDate : null,
      },
      salaryChain,
      sessionSummaries,
      monthWiseLedger,
      staffLeaves,
    });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};
