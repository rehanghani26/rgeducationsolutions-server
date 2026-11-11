/**
 * @file payrollController.js
 * @description Enterprise Payroll Controller: Staff Directory, Attendance Proration, Salary Structure Setup,
 * Budget Safeguards, and Single/Batch Salary Disbursements.
 */

import mongoose from 'mongoose';

// Models
import User from '../models/User.js';
import PayrollRecord from '../models/PayrollRecord.js';
import PayrollDisbursement from '../models/PayrollDisbursement.js';
import BudgetAllocation from '../models/BudgetAllocation.js';
import AcademicSession from '../models/AcademicSession.js';
import Expense from '../models/Expense.js';
import Attendance from '../models/Attendance.js';
import Leave from '../models/Leave.js';

// Utilities
import { isValidObjectId, escapeRegex } from '../utils/commonUtil.js';
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendForbidden,
  sendError,
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

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * Converts a month name into a 1-based index (e.g., "January" -> 1).
 *
 * @param {string} monthName - Month name string.
 * @returns {number} 1-based month index.
 */
export const getMonthNumber = (monthName) => {
  const idx = MONTH_NAMES.indexOf(String(monthName).toLowerCase().trim());
  return idx > -1 ? idx + 1 : new Date().getMonth() + 1;
};

/**
 * Parses and resolves month string and year number.
 *
 * @param {string} [monthStr] - e.g. "November 2026" or "November"
 * @param {number|string} [yearVal] - e.g. 2026
 * @returns {{ month: string, monthName: string, monthNumber: number, year: number }}
 */
export const parseMonthYear = (monthStr, yearVal) => {
  const now = new Date();
  const year = yearVal ? Number(yearVal) : now.getFullYear();
  let month = monthStr;
  if (!month) {
    month = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(now);
  }
  const monthName = String(month).split(' ')[0];
  const monthNumber = getMonthNumber(monthName);
  return { month, monthName, monthNumber, year };
};

/**
 * Resolves the target academic session by ID or falls back to active session.
 *
 * @param {string} [sessionId]
 * @returns {Promise<import('../models/AcademicSession.js').default | null>}
 */
export const resolveTargetSession = async (sessionId) => {
  if (sessionId && isValidObjectId(sessionId)) {
    const sess = await AcademicSession.findById(sessionId);
    if (sess) return sess;
  }
  return (
    (await AcademicSession.findOne({ isCurrent: true })) ||
    (await AcademicSession.findOne().sort({ startDate: -1 }))
  );
};

/**
 * Resolves monthly attendance metrics, leaves, and LOP deductions for a staff member.
 *
 * @param {object} params
 * @returns {Promise<object>}
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

  // Standard working days (excluding Sundays)
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

  // 1. Fetch approved and pending leaves for this user in date range
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
    console.warn('Leave query notice:', leaveErr.message);
  }

  // 2. Fetch explicit Attendance records
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
            { attendanceDate: { $gte: monthStart, $lte: monthEnd } },
            { date: { $gte: monthStart, $lte: monthEnd } },
          ],
        },
        { $or: memberOr },
      ],
    });

    attRecords.forEach((att) => {
      const records = att.records || att.students || att.attendance || [];
      const item = records.find(
        (r) =>
          (userId && String(r.memberId) === String(userId)) ||
          (userId && String(r.studentId) === String(userId)) ||
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
    });
  } catch (attErr) {
    console.warn('Attendance query notice:', attErr.message);
  }

  // 3. Prorate for staff who joined mid-month
  let isProratedJoining = false;
  if (joiningDate) {
    const jDate = new Date(joiningDate);
    if (!isNaN(jDate.getTime())) {
      if (jDate > monthStart && jDate <= monthEnd) {
        isProratedJoining = true;
        const joiningDay = jDate.getDate();
        for (let d = 1; d < joiningDay; d++) {
          const preDate = new Date(year, monthNumber - 1, d);
          if (preDate.getDay() !== 0) unworkedPreJoiningDays++;
        }
      } else if (jDate > monthEnd) {
        // Staff has not joined yet in this billing cycle
        unworkedPreJoiningDays = standardWorkingDays;
        isProratedJoining = true;
      }
    }
  }

  // Fallback if no explicit daily attendance logged: full attendance minus unworked pre-joining days
  if (!hasExplicitAttendance) {
    presentDays = Math.max(0, standardWorkingDays - unworkedPreJoiningDays - unpaidLeaveDays);
  }

  // 4. LOP & Deduction calculations
  const calculatedAbsentDays = Math.max(
    0,
    standardWorkingDays - presentDays - paidLeaveDays - unpaidLeaveDays - unworkedPreJoiningDays
  );
  if (!hasExplicitAttendance) {
    absentDays = calculatedAbsentDays;
  }

  const effectiveEffectiveSalary = Number(grossPay || 0) > 0 ? Number(grossPay) : Number(basicPay) + Number(da);
  const perDayRate = totalDaysInMonth > 0 ? Math.round(effectiveEffectiveSalary / totalDaysInMonth) : 0;

  const lopDays = unpaidLeaveDays + absentDays + Math.floor(halfDays * 0.5) + unworkedPreJoiningDays;
  const lopDeduction = lopDays * perDayRate;

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
    isProratedJoining,
    unworkedPreJoiningDays,
  };
};

/**
 * Retrieves the staff directory for monthly payroll processing with attendance and payment status.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getPayrollStaff = async (req, res) => {
  try {
    const { month, year, search, role } = req.query;
    const { month: currentMonth, monthNumber, year: currentYear } = parseMonthYear(month, year);

    const query = {
      role: { $nin: EXCLUDED_PAYROLL_ROLES },
      isActive: { $ne: false },
    };

    if (role && role.trim()) {
      query.role = role.trim();
    }

    if (search && search.trim()) {
      const reg = new RegExp(escapeRegex(search.trim()), 'i');
      query.$or = [{ name: reg }, { email: reg }, { employeeId: reg }];
    }

    const staffUsers = await User.find(query).sort({ name: 1 });
    const userIds = staffUsers.map((u) => u._id);

    // Parallel fetch salary records and disbursements for this cycle
    const [records, disbursements] = await Promise.all([
      PayrollRecord.find({ userId: { $in: userIds } }),
      PayrollDisbursement.find({
        userId: { $in: userIds },
        month: currentMonth,
        year: currentYear,
      }),
    ]);

    const recordMap = new Map();
    records.forEach((r) => recordMap.set(String(r.userId), r));

    const disbMap = new Map();
    disbursements.forEach((d) => disbMap.set(String(d.userId), d));

    let totalPayrollCost = 0;
    let disbursedCount = 0;
    let pendingCount = 0;

    const staffList = await Promise.all(
      staffUsers.map(async (u) => {
        const uId = String(u._id);
        const structure = recordMap.get(uId);
        const isConfigured = Boolean(
          structure &&
          (Number(structure.basicPay || 0) > 0 || Number(structure.netPay || 0) > 0)
        );

        let salaryStructure = null;
        if (structure) {
          const gross =
            Number(structure.basicPay || 0) +
            Number(structure.hra || 0) +
            Number(structure.da || 0) +
            Number(structure.specialAllowance || 0);
          const statutory =
            Number(structure.pfDeduction || 0) +
            Number(structure.taxDeduction || 0) +
            Number(structure.otherDeductions || 0);

          salaryStructure = {
            ...structure.toObject(),
            grossPay: gross,
            statutoryDeductions: statutory,
            adjustedNetPay: Math.max(0, gross - statutory),
            isConfigured,
          };
        } else {
          const basic = Number(u.salary || 0);
          salaryStructure = {
            basicPay: basic,
            hra: 0,
            da: 0,
            specialAllowance: 0,
            pfDeduction: 0,
            taxDeduction: 0,
            otherDeductions: 0,
            netPay: basic,
            paymentMode: 'Bank Transfer',
            grossPay: basic,
            statutoryDeductions: 0,
            adjustedNetPay: basic,
            isConfigured,
          };
        }

        const attMetrics = await resolveStaffMonthlyAttendanceAndLeaves({
          userId: u._id,
          employeeId: u.employeeId,
          teacherId: u.profileId,
          joiningDate: u.joiningDate,
          year: currentYear,
          monthNumber,
          basicPay: salaryStructure.basicPay,
          da: salaryStructure.da,
          grossPay: salaryStructure.grossPay,
        });

        salaryStructure.adjustedNetPay = Math.max(
          0,
          salaryStructure.adjustedNetPay - attMetrics.lopDeduction
        );

        const disb = disbMap.get(uId);
        const paymentStatus = disb ? 'Paid' : 'Pending';

        if (paymentStatus === 'Paid') {
          disbursedCount++;
        } else {
          pendingCount++;
          totalPayrollCost += salaryStructure.adjustedNetPay;
        }

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
          isSalaryConfigured: isConfigured,
          salaryStructure,
          attendanceMetrics: attMetrics,
          paymentStatus,
          disbursementDetails: disb || null,
        };
      })
    );

    const payload = {
      count: staffList.length,
      staff: staffList,
      summary: {
        totalStaff: staffList.length,
        disbursedCount,
        pendingCount,
        estimatedTotalPendingAmount: totalPayrollCost,
      },
    };

    return sendSuccess(res, 'Success', payload, 200, payload);
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Assigns or updates the salary structure for a staff member.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
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

    if (!userId || !isValidObjectId(userId)) {
      return sendBadRequest(res, 'Valid User ID is required');
    }

    const user = await User.findById(userId);
    if (!user) {
      return sendNotFound(res, 'Staff member not found');
    }

    const grossPay =
      Number(basicPay) + Number(hra) + Number(da) + Number(specialAllowance);
    const totalDeductions =
      Number(pfDeduction) + Number(taxDeduction) + Number(otherDeductions);
    const netPay = Math.max(0, grossPay - totalDeductions);

    const record = await PayrollRecord.findOneAndUpdate(
      { userId },
      {
        userId,
        employeeId: user.employeeId || `EMP-${String(userId).slice(-4)}`,
        staffName: user.name,
        role: user.role,
        designation: user.designation || user.role,
        department: user.department || 'Academics',
        basicPay: Number(basicPay),
        hra: Number(hra),
        da: Number(da),
        specialAllowance: Number(specialAllowance),
        pfDeduction: Number(pfDeduction),
        taxDeduction: Number(taxDeduction),
        otherDeductions: Number(otherDeductions),
        netPay,
        paymentMode,
        bankName,
        accountNumber,
        ifscCode,
        status: 'active',
      },
      { upsert: true, new: true, runValidators: true }
    );

    const payload = { salaryStructure: record };
    return sendSuccess(res, 'Salary structure assigned successfully', payload, 200, payload);
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves session budget and payroll health metrics for the active session and billing cycle.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getPayrollSummary = async (req, res) => {
  try {
    const { sessionId, month, year } = req.query;
    const { month: currentMonth, year: currentYear } = parseMonthYear(month, year);

    const targetSession = await resolveTargetSession(sessionId);
    const targetSessionId = targetSession ? String(targetSession._id) : null;

    const budget =
      targetSessionId && isValidObjectId(targetSessionId)
        ? await BudgetAllocation.findOne({ sessionId: targetSessionId })
        : null;

    const monthDisbursements = await PayrollDisbursement.find({
      month: currentMonth,
      year: currentYear,
    });

    const monthlyTotal = monthDisbursements.reduce(
      (acc, curr) => acc + (Number(curr.netPay) || 0),
      0
    );

    const salaryBudget = budget ? Number(budget.salaryBudget || 0) : 0;
    const salarySpent = budget ? Number(budget.salarySpent || 0) : 0;
    const salaryRemaining = Math.max(0, salaryBudget - salarySpent);

    const summaryPayload = {
      summary: {
        sessionId: targetSessionId,
        sessionName: budget ? budget.sessionName : (targetSession ? targetSession.sessionName : 'Active Session'),
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
    };

    return sendSuccess(res, undefined, summaryPayload, 200, summaryPayload);
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Disburses salary for an individual employee with live attendance prorating and budget validation.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
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
      bonus = 0,
      extraAllowance = 0,
      customDeduction = 0,
      deduction = 0,
    } = req.body;

    const bonusAmount = Math.max(0, Number(bonus || extraAllowance || 0));
    const extraDeductionAmount = Math.max(0, Number(customDeduction || deduction || 0));

    if (!userId || !isValidObjectId(userId)) {
      return sendBadRequest(res, 'Valid User ID is required');
    }

    const { month: currentMonth, monthNumber: monthNum, year: currentYear } = parseMonthYear(month, year);

    const user = await User.findById(userId);
    if (!user) {
      return sendNotFound(res, 'Staff member not found');
    }

    // Check duplicate disbursement
    const existing = await PayrollDisbursement.findOne({
      userId,
      month: currentMonth,
      year: currentYear,
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `Salary for ${user.name} has already been disbursed for ${currentMonth} ${currentYear}`,
        disbursement: existing,
      });
    }

    let record = await PayrollRecord.findOne({ userId });
    if (!record) {
      const basic = Number(user.salary || 0);
      record = {
        basicPay: basic,
        hra: 0,
        da: 0,
        specialAllowance: 0,
        pfDeduction: 0,
        taxDeduction: 0,
        otherDeductions: 0,
        paymentMode: paymentMethod,
      };
    }

    const gross =
      Number(record.basicPay || 0) +
      Number(record.hra || 0) +
      Number(record.da || 0) +
      Number(record.specialAllowance || 0) +
      bonusAmount;

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
    const finalLopDeduction = finalLopDays * attMetrics.perDayRate;
    const totalDeductions = statutoryDeductions + finalLopDeduction + extraDeductionAmount;
    const netPay = Math.max(0, gross - totalDeductions);

    // Validate and update Master Budget Allocation
    const targetSession = await resolveTargetSession(sessionId);
    const targetSessionId = targetSession ? String(targetSession._id) : null;

    if (targetSessionId && isValidObjectId(targetSessionId)) {
      const budget = await BudgetAllocation.findOne({ sessionId: targetSessionId });
      if (budget) {
        const remaining = Number(budget.salaryBudget || 0) - Number(budget.salarySpent || 0);
        if (netPay > remaining) {
          return res.status(400).json({
            success: false,
            isOverBudget: true,
            message: `Disbursement amount (₹${netPay.toLocaleString()}) exceeds the remaining Salary Budget (₹${remaining.toLocaleString()}) by ₹${(netPay - remaining).toLocaleString()}. Please allocate a Revised Budget in Settings.`,
            requiredAmount: netPay,
            remainingBudget: remaining,
            deficit: netPay - remaining,
          });
        }

        budget.salarySpent = (Number(budget.salarySpent) || 0) + netPay;
        await budget.save();
      }
    }

    // Save Payroll Disbursement Record
    const disbursement = new PayrollDisbursement({
      userId,
      employeeId: user.employeeId || `EMP-${String(userId).slice(-4)}`,
      staffName: user.name,
      role: user.role,
      designation: user.designation || user.role,
      department: user.department || 'Academics',
      sessionId: targetSessionId,
      sessionName: targetSession ? targetSession.sessionName : '',
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
      basicPay: record.basicPay,
      hra: record.hra,
      da: record.da,
      specialAllowance: record.specialAllowance,
      grossPay: gross,
      statutoryDeductions,
      perDayRate: attMetrics.perDayRate,
      lopDays: finalLopDays,
      lopDeduction: finalLopDeduction,
      bonus: bonusAmount,
      customDeduction: extraDeductionAmount,
      totalDeductions,
      netPay,
      paymentMethod,
      paymentStatus: 'Paid',
      disbursedBy: req.user?._id,
      transactionReference:
        transactionReference || `TXN-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      remarks,
    });

    await disbursement.save();

    // Create corresponding Expense Voucher
    try {
      const exp = new Expense({
        title: `Staff Salary: ${user.name} (${currentMonth} ${currentYear})`,
        amount: netPay,
        category: 'Payroll',
        date: new Date(),
        refInvoice: disbursement.transactionReference,
      });
      await exp.save();
    } catch (expErr) {
      console.warn('Expense voucher log note:', expErr.message);
    }

    const payload = { disbursement };
    return sendCreated(
      res,
      `Salary disbursed successfully to ${user.name} for ${currentMonth} ${currentYear}`,
      payload,
      payload
    );
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Disburses batch salaries with per-staff custom additions/deductions and budget safeguards.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const disburseBatch = async (req, res) => {
  try {
    const {
      userIds = [],
      staffItems = [],
      sessionId,
      month,
      year,
      paymentMethod = 'Bank Transfer',
      remarks = '',
    } = req.body;

    const { month: currentMonth, year: currentYear } = parseMonthYear(month, year);
    const targetSession = await resolveTargetSession(sessionId);
    const targetSessionId = targetSession ? String(targetSession._id) : null;

    let successfulCount = 0;
    const failedList = [];
    let totalDisbursedAmount = 0;

    const itemsToProcess =
      Array.isArray(staffItems) && staffItems.length > 0
        ? staffItems
        : userIds.map((id) => (typeof id === 'object' ? id : { userId: id }));

    for (const item of itemsToProcess) {
      const uId = item.userId || item._id;
      if (!uId) continue;

      try {
        const fakeReq = {
          body: {
            userId: uId,
            sessionId: item.sessionId || targetSessionId,
            month: item.month || currentMonth,
            year: item.year ? Number(item.year) : currentYear,
            paymentMethod: item.paymentMethod || paymentMethod,
            transactionReference:
              item.transactionReference ||
              `BATCH-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            remarks: item.remarks || remarks,
            bonus: Number(item.bonus || item.extra || 0),
            customDeduction: Number(item.customDeduction || item.deduction || 0),
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
            reason: resultData?.message || 'Disbursement failed',
            isOverBudget: resultData?.isOverBudget || false,
          });
        }
      } catch (err) {
        failedList.push({ userId: uId, reason: err.message });
      }
    }

    const payload = {
      processed: itemsToProcess.length,
      successfulCount,
      failedCount: failedList.length,
      totalDisbursedAmount,
      failedList,
    };

    return sendSuccess(
      res,
      `Batch processed: ${successfulCount} staff paid successfully. ${failedList.length} failed or skipped.`,
      payload,
      200,
      payload
    );
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves historical payroll disbursements with multi-filter support.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
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

    const disbursements = await PayrollDisbursement.find(filter)
      .populate('disbursedBy', 'name role')
      .sort({ disbursedAt: -1 });

    const payload = { count: disbursements.length, disbursements };
    return sendSuccess(res, undefined, payload, 200, payload);
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves comprehensive payroll profile, metrics, salary chain, and attendance breakdown for an employee.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getStaffPayrollDetails = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return sendBadRequest(res, 'Staff ID is required');
    }

    const user = isValidObjectId(id) ? await User.findById(id) : await User.findOne({ employeeId: id });
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
    let record = await PayrollRecord.findOne({ userId: user._id });
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
    const allDisbursements = await PayrollDisbursement.find({ userId: user._id })
      .populate('disbursedBy', 'name role')
      .sort({ year: 1, monthNumber: 1, disbursedAt: 1 });

    // 3. Lifetime Spend Metrics
    const totalLifetimePaid = allDisbursements.reduce(
      (sum, d) => sum + (Number(d.netPay) || 0),
      0
    );
    const totalDisbursementsCount = allDisbursements.length;
    const averageMonthlyPay =
      totalDisbursementsCount > 0 ? Math.round(totalLifetimePaid / totalDisbursementsCount) : 0;

    // 4. Salary Chain
    const salaryChain = allDisbursements.map((d, index) => ({
      ...(d.toObject ? d.toObject() : d),
      stepNumber: index + 1,
      formattedDisbursedDate: d.disbursedAt
        ? new Date(d.disbursedAt).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : `${d.month} ${d.year}`,
    }));

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

    // 6. Chronological Month-wise Status Ledger (From joining date to current cycle)
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
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

    const gross =
      Number(record.basicPay || 0) +
      Number(record.hra || 0) +
      Number(record.da || 0) +
      Number(record.specialAllowance || 0);

    let targetEndYear = curYear;
    let targetEndMonthIdx = curMonthIndex;
    allDisbursements.forEach((d) => {
      const dYear = Number(d.year);
      const dMNum = d.monthNumber || getMonthNumber(String(d.month || '').split(' ')[0]);
      const dMonthIdx = dMNum - 1;
      if (dYear > targetEndYear || (dYear === targetEndYear && dMonthIdx > targetEndMonthIdx)) {
        targetEndYear = dYear;
        targetEndMonthIdx = dMonthIdx;
      }
    });

    const monthWiseLedger = [];
    let y = startYear;
    let m = startMonthIdx;
    let stepCount = 0;

    while (y < targetEndYear || (y === targetEndYear && m <= targetEndMonthIdx)) {
      stepCount++;
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
        stepNumber: stepCount,
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

    // 7. Staff Leaves History
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
    const staffLeaves = await Leave.find({ $or: orConditions }).sort({ createdAt: -1 });

    const payload = {
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
        firstDisbursementDate:
          salaryChain.length > 0 ? salaryChain[0].formattedDisbursedDate : null,
        latestDisbursementDate:
          salaryChain.length > 0
            ? salaryChain[salaryChain.length - 1].formattedDisbursedDate
            : null,
      },
      salaryChain,
      sessionSummaries,
      monthWiseLedger,
      staffLeaves,
    };

    return sendSuccess(res, undefined, payload, 200, payload);
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};
