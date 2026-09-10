/**
 * @file fee.tools.js
 * @description AI Tool definitions and executors for the Fees/Finance module.
 */

import Fee from '../../models/Fee.js';
import Student from '../../models/Student.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';
import { logActivity } from '../../utils/activityLogger.js';
import mongoose from 'mongoose';

export const feeToolDefinitions = [
  {
    name: 'getFeeSummary',
    description:
      'Get overall fee collection summary: total collected, total pending, paid vs unpaid count. Use for "fee overview", "fee summary", "how much fee is pending?".',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by fee status: "paid", "partial", "unpaid".',
        },
        class: {
          type: 'string',
          description: 'Filter by class name.',
        },
      },
    },
  },
  {
    name: 'getStudentFee',
    description:
      'Get fee details for a specific student. Use when user asks about one student\'s fee status.',
    parameters: {
      type: 'object',
      properties: {
        studentId: { type: 'string', description: 'Student MongoDB ID.' },
        studentName: { type: 'string', description: 'Student name (to look up ID).' },
      },
    },
  },
  {
    name: 'getPendingFees',
    description:
      'List students with pending or partial fee payments. Use for "who has pending fees?", "unpaid fees list".',
    parameters: {
      type: 'object',
      properties: {
        class: { type: 'string', description: 'Filter by class name.' },
        limit: { type: 'number', description: 'Max records (default 20).' },
      },
    },
  },
  {
    name: 'collectFee',
    description:
      'Record a fee payment for a student. ONLY call after user confirmation. Requires studentId and amount.',
    parameters: {
      type: 'object',
      properties: {
        studentId: { type: 'string', description: 'Student MongoDB ID (required).' },
        amount: { type: 'number', description: 'Payment amount (required).' },
        method: {
          type: 'string',
          description: 'Payment method: "Cash", "Cheque", "Online", "Bank Transfer". Default: "Cash".',
        },
        reference: { type: 'string', description: 'Transaction reference number.' },
      },
      required: ['studentId', 'amount'],
    },
  },
];

export const feeToolExecutors = {
  async getFeeSummary(args, context) {
    if (checkFallback()) {
      let fees = FallbackDb.find('fees') || [];
      if (args.status) fees = fees.filter((f) => f.status === args.status);

      const totalPaid = fees.reduce((s, f) => s + (f.amountPaid || 0), 0);
      const totalPending = fees.reduce((s, f) => s + (f.amountPending || 0), 0);
      const paidCount = fees.filter((f) => f.status === 'paid').length;
      const unpaidCount = fees.filter((f) => f.status === 'unpaid').length;
      const partialCount = fees.filter((f) => f.status === 'partial').length;

      return {
        success: true,
        summary: {
          totalStudents: fees.length,
          totalCollected: formatCurrency(totalPaid),
          totalPending: formatCurrency(totalPending),
          paidCount, unpaidCount, partialCount,
        },
      };
    }

    const filter = {};
    if (args.status) filter.status = args.status;

    const [fees, totals] = await Promise.all([
      Fee.countDocuments(filter),
      Fee.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalPaid: { $sum: '$amountPaid' },
            totalPending: { $sum: '$amountPending' },
            paidCount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
            unpaidCount: { $sum: { $cond: [{ $eq: ['$status', 'unpaid'] }, 1, 0] } },
            partialCount: { $sum: { $cond: [{ $eq: ['$status', 'partial'] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const agg = totals[0] || {};
    return {
      success: true,
      summary: {
        totalStudents: fees,
        totalCollected: formatCurrency(agg.totalPaid || 0),
        totalPending: formatCurrency(agg.totalPending || 0),
        paidCount: agg.paidCount || 0,
        unpaidCount: agg.unpaidCount || 0,
        partialCount: agg.partialCount || 0,
      },
    };
  },

  async getStudentFee(args, context) {
    let studentId = args.studentId;

    // Look up by name if needed
    if (!studentId && args.studentName) {
      const s = checkFallback()
        ? (FallbackDb.find('students') || []).find(
            (s) => s.name?.toLowerCase().includes(args.studentName.toLowerCase())
          )
        : await Student.findOne({ name: new RegExp(args.studentName, 'i') }).select('_id name');
      if (!s) return { success: false, error: `No student found with name "${args.studentName}".` };
      studentId = (s._id || s.id).toString();
    }

    if (!studentId) return { success: false, error: 'studentId or studentName is required.' };

    let fee;
    if (checkFallback()) {
      fee = FallbackDb.findOne('fees', { studentId });
    } else {
      if (!mongoose.Types.ObjectId.isValid(studentId)) {
        return { success: false, error: 'Invalid student ID.' };
      }
      fee = await Fee.findOne({ studentId }).populate('studentId', 'name admissionNumber class');
    }

    if (!fee) {
      return { success: false, error: 'No fee record found for this student.' };
    }

    return {
      success: true,
      fee: {
        studentId,
        studentName: fee.studentId?.name || fee.studentName || '-',
        admissionNumber: fee.studentId?.admissionNumber || '-',
        class: fee.studentId?.class || '-',
        amountPaid: formatCurrency(fee.amountPaid || 0),
        amountPending: formatCurrency(fee.amountPending || 0),
        status: fee.status,
        dueDate: fee.dueDate ? new Date(fee.dueDate).toISOString().split('T')[0] : '-',
        transactionCount: (fee.transactions || []).length,
        lastPayment: fee.transactions?.length
          ? new Date(fee.transactions[fee.transactions.length - 1].date).toISOString().split('T')[0]
          : 'None',
      },
    };
  },

  async getPendingFees(args, context) {
    const limit = Math.min(args.limit || 20, 50);

    if (checkFallback()) {
      let fees = (FallbackDb.find('fees') || []).filter(
        (f) => f.status === 'unpaid' || f.status === 'partial'
      );
      return {
        success: true,
        count: fees.length,
        fees: fees.slice(0, limit).map((f) => ({
          studentId: f.studentId,
          status: f.status,
          amountPending: formatCurrency(f.amountPending || 0),
          dueDate: f.dueDate ? new Date(f.dueDate).toISOString().split('T')[0] : '-',
        })),
      };
    }

    const filter = { status: { $in: ['unpaid', 'partial'] } };
    const [fees, total] = await Promise.all([
      Fee.find(filter)
        .populate('studentId', 'name admissionNumber class section')
        .sort({ amountPending: -1 })
        .limit(limit),
      Fee.countDocuments(filter),
    ]);

    return {
      success: true,
      count: fees.length,
      total,
      fees: fees.map((f) => ({
        studentId: (f.studentId?._id || f.studentId)?.toString(),
        studentName: f.studentId?.name || '-',
        admissionNumber: f.studentId?.admissionNumber || '-',
        class: f.studentId?.class || '-',
        section: f.studentId?.section || '-',
        status: f.status,
        amountPaid: formatCurrency(f.amountPaid || 0),
        amountPending: formatCurrency(f.amountPending || 0),
        dueDate: f.dueDate ? new Date(f.dueDate).toISOString().split('T')[0] : '-',
      })),
    };
  },

  async collectFee(args, context) {
    if (!args.studentId) return { success: false, error: 'Student ID is required.' };
    if (!args.amount || args.amount <= 0) return { success: false, error: 'Valid payment amount is required.' };

    const method = args.method || 'Cash';
    const validMethods = ['Cash', 'Cheque', 'Online', 'Bank Transfer'];
    if (!validMethods.includes(method)) {
      return { success: false, error: `Invalid payment method. Use: ${validMethods.join(', ')}.` };
    }

    let fee;
    if (checkFallback()) {
      fee = FallbackDb.findOne('fees', { studentId: args.studentId });
      if (!fee) return { success: false, error: 'No fee record found for this student.' };

      const newPaid = (fee.amountPaid || 0) + args.amount;
      const newPending = Math.max(0, (fee.amountPending || 0) - args.amount);
      const newStatus = newPending === 0 ? 'paid' : 'partial';

      FallbackDb.update('fees', fee.id || fee._id, {
        amountPaid: newPaid,
        amountPending: newPending,
        status: newStatus,
        transactions: [
          ...(fee.transactions || []),
          { date: new Date(), amount: args.amount, method, reference: args.reference || '' },
        ],
      });

      fee = FallbackDb.findOne('fees', { studentId: args.studentId });
    } else {
      if (!mongoose.Types.ObjectId.isValid(args.studentId)) {
        return { success: false, error: 'Invalid student ID.' };
      }
      fee = await Fee.findOne({ studentId: args.studentId });
      if (!fee) return { success: false, error: 'No fee record found for this student.' };

      const newPaid = (fee.amountPaid || 0) + args.amount;
      const newPending = Math.max(0, (fee.amountPending || 0) - args.amount);

      fee.amountPaid = newPaid;
      fee.amountPending = newPending;
      fee.status = newPending === 0 ? 'paid' : 'partial';
      fee.transactions.push({
        date: new Date(),
        amount: args.amount,
        method,
        reference: args.reference || '',
      });

      await fee.save();
    }

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'UPDATE',
      module: 'fees',
      recordId: fee._id || fee.id,
      details: `AI recorded fee payment of ${formatCurrency(args.amount)} via ${method}`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: `Payment of ${formatCurrency(args.amount)} recorded successfully.`,
      fee: {
        amountPaid: formatCurrency(fee.amountPaid || 0),
        amountPending: formatCurrency(fee.amountPending || 0),
        status: fee.status,
        method,
      },
    };
  },
};

function formatCurrency(amount) {
  return `₹${Number(amount).toLocaleString('en-IN')}`;
}
