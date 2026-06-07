import Fee from '../models/Fee.js';
import Expense from '../models/Expense.js';
import Student from '../models/Student.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';
import { parsePagination, buildSearchFilter, paginateResult, paginateArray } from '../utils/paginateQuery.js';
import { logActivity, getRecordActivity } from '../utils/activityLogger.js';

const enrichFee = (fee) => {
  if (checkFallback()) {
    const stud = FallbackDb.findById('students', fee.studentId);
    return { ...fee, student: stud, studentDetails: stud };
  }
  return fee;
};

export const getFees = async (req, res) => {
  try {
    const { page, limit, skip, sort, search, status } = parsePagination(req.query);

    if (checkFallback()) {
      let list = FallbackDb.find('fees').map(enrichFee);
      if (search) {
        const term = search.toLowerCase();
        list = list.filter((f) =>
          [f.student?.name, f.studentId, f.status].filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(term))
        );
      }
      if (status) list = list.filter((f) => f.status === status);
      const total = list.length;
      const data = list.slice(skip, skip + limit);
      return res.json({ success: true, fees: data, ...paginateResult(data, total, { page, limit }) });
    }

    const filter = {};
    if (status) filter.status = status;

    const sortObj = {};
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith('-') ? -1 : 1;

    let fees = await Fee.find(filter)
      .populate('studentId', 'name admissionNumber rollNumber classId sectionId contactNumber')
      .sort(sortObj)
      .skip(skip)
      .limit(limit);

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const allFees = await Fee.find(filter).populate('studentId', 'name admissionNumber');
      const matched = allFees.filter((f) =>
        regex.test(f.studentId?.name || '') ||
        regex.test(String(f.studentId?._id || '')) ||
        regex.test(f.status || '')
      );
      const total = matched.length;
      fees = matched.slice(skip, skip + limit);
      return res.json({ success: true, fees, ...paginateResult(fees, total, { page, limit }) });
    }

    const total = await Fee.countDocuments(filter);
    return res.json({ success: true, fees, ...paginateResult(fees, total, { page, limit }) });
  } catch (error) {
    console.error('getFees error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getFeeById = async (req, res) => {
  try {
    const { id } = req.params;
    let fee = null;

    if (checkFallback()) {
      fee = FallbackDb.findById('fees', id);
      if (fee) fee = enrichFee(fee);
    } else {
      fee = await Fee.findById(id).populate('studentId');
    }

    if (!fee) return res.status(404).json({ success: false, message: 'Fee record not found' });
    return res.json({ success: true, fee });
  } catch (error) {
    console.error('getFeeById error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getFeeActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await getRecordActivity('finance', id);
    return res.json({ success: true, logs, loginHistory: [] });
  } catch (error) {
    console.error('getFeeActivity error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateFee = async (req, res) => {
  try {
    const { id } = req.params;
    const { amountPending, dueDate, status } = req.body;
    const update = {};
    if (amountPending !== undefined) update.amountPending = Number(amountPending);
    if (dueDate) update.dueDate = dueDate;
    if (status) update.status = status;

    let fee = null;
    if (checkFallback()) {
      fee = FallbackDb.update('fees', id, update);
      if (fee) fee = enrichFee(fee);
    } else {
      fee = await Fee.findByIdAndUpdate(id, update, { new: true }).populate('studentId');
    }

    if (!fee) return res.status(404).json({ success: false, message: 'Fee record not found' });

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'UPDATE',
      module: 'finance',
      recordId: id,
      details: `Updated fee record for ${fee.studentId?.name || fee.student?.name || 'student'}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ success: true, message: 'Fee record updated', fee });
  } catch (error) {
    console.error('updateFee error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

export const collectFee = async (req, res) => {
  try {
    const { studentId, feeId, amount, method, reference } = req.body;
    const paidAmount = Number(amount);

    if (isNaN(paidAmount) || paidAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Please provide a valid payment amount' });
    }

    if (!studentId && !feeId) {
      return res.status(400).json({ success: false, message: 'Student ID or Fee ID is required' });
    }

    let feeRecord = null;

    if (checkFallback()) {
      feeRecord = feeId
        ? FallbackDb.findById('fees', feeId)
        : FallbackDb.findOne('fees', { studentId });

      if (!feeRecord) {
        feeRecord = FallbackDb.create('fees', {
          studentId,
          amountPaid: 0,
          amountPending: 20000,
          status: 'unpaid',
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          transactions: [],
        });
      }

      const newPaid = feeRecord.amountPaid + paidAmount;
      const newPending = Math.max(0, feeRecord.amountPending - paidAmount);
      const newStatus = newPending === 0 ? 'paid' : 'partial';

      const tx = {
        date: new Date().toISOString(),
        amount: paidAmount,
        method: method || 'Online',
        reference: reference || `REF-${Math.random().toString(36).substring(3, 9).toUpperCase()}`,
      };

      feeRecord = FallbackDb.update('fees', feeRecord.id, {
        amountPaid: newPaid,
        amountPending: newPending,
        status: newStatus,
        transactions: [...(feeRecord.transactions || []), tx],
      });
      feeRecord = enrichFee(feeRecord);
    } else {
      feeRecord = feeId
        ? await Fee.findById(feeId)
        : await Fee.findOne({ studentId });

      if (!feeRecord) {
        const studentObj = await Student.findById(studentId);
        if (!studentObj) return res.status(404).json({ success: false, message: 'Student record not found' });

        feeRecord = new Fee({
          studentId,
          amountPaid: 0,
          amountPending: 20000,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
      }

      feeRecord.amountPaid += paidAmount;
      feeRecord.amountPending = Math.max(0, feeRecord.amountPending - paidAmount);
      feeRecord.status = feeRecord.amountPending === 0 ? 'paid' : 'partial';

      feeRecord.transactions.push({
        amount: paidAmount,
        method: method || 'Online',
        reference: reference || `REF-${Math.random().toString(36).substring(3, 9).toUpperCase()}`,
      });

      await feeRecord.save();
      feeRecord = await Fee.findById(feeRecord._id).populate('studentId');
    }

    const recordId = feeRecord.id || feeRecord._id;
    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CREATE',
      module: 'finance',
      recordId,
      details: `Collected ₹${paidAmount} fee payment`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { amount: paidAmount, method: method || 'Online', reference },
    });

    return res.json({ success: true, message: 'Payment recorded successfully', fee: feeRecord });
  } catch (error) {
    console.error('collectFee error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getExpenses = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);

    if (checkFallback()) {
      const list = FallbackDb.find('expenses') || [];
      list.sort((a, b) => new Date(b.date) - new Date(a.date));
      const total = list.length;
      const data = list.slice(skip, skip + limit);
      return res.json({ success: true, expenses: data, ...paginateResult(data, total, { page, limit }) });
    }

    const [expenses, total] = await Promise.all([
      Expense.find().sort({ date: -1 }).skip(skip).limit(limit),
      Expense.countDocuments(),
    ]);

    return res.json({ success: true, expenses, ...paginateResult(expenses, total, { page, limit }) });
  } catch (error) {
    console.error('getExpenses error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createExpense = async (req, res) => {
  try {
    const data = req.body;
    let newRecord = null;

    if (checkFallback()) {
      newRecord = FallbackDb.create('expenses', {
        title: data.title,
        amount: Number(data.amount) || 0,
        category: data.category,
        date: data.date || new Date().toISOString(),
        refInvoice: data.refInvoice || '',
      });
    } else {
      const expense = new Expense(data);
      newRecord = await expense.save();
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CREATE',
      module: 'finance',
      recordId: newRecord.id || newRecord._id,
      details: `Logged expense: ${data.title} (₹${data.amount})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({ success: true, message: 'Expense logged successfully', expense: newRecord });
  } catch (error) {
    console.error('createExpense error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const exportFees = async (req, res) => {
  try {
    let fees = [];
    if (checkFallback()) {
      fees = FallbackDb.find('fees').map(enrichFee);
    } else {
      fees = await Fee.find().populate('studentId', 'name admissionNumber');
    }

    const headers = ['Student', 'Admission No.', 'Paid', 'Pending', 'Status', 'Due Date'];
    const rows = fees.map((f) => [
      f.studentId?.name || f.student?.name,
      f.studentId?.admissionNumber || f.student?.admissionNumber,
      f.amountPaid, f.amountPending, f.status, f.dueDate,
    ].map((v) => `"${String(v || '').replace(/"/g, '""')}"`).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=fees.csv');
    return res.send(csv);
  } catch (error) {
    console.error('exportFees error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
