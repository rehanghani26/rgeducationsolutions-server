import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { sendError } from './responseUtil.js';

export const recordId = (record) => record?._id || record?.id;
export const recordIds = (record) => [record?._id, record?.id].filter(Boolean).map(String);

export function actor(req) {
  const userId = req.user?._id || req.user?.id;
  return {
    id: mongoose.isObjectIdOrHexString(userId) ? userId : undefined,
    name: req.user?.name || 'Administrator',
  };
}

export function procurementError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function sendProcurementError(res, error) {
  if (error.statusCode) return sendError(res, error.message, error.statusCode);
  if (error.code === 11000) return sendError(res, 'This code or reference already exists.', 409);
  if (error.name === 'ValidationError' || error.name === 'CastError') {
    return sendError(res, 'Check the fields and try again.', 400);
  }
  console.error('Procurement operation failed:', error);
  return sendError(res, 'The operation could not be completed. Please try again.');
}

export const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Cheque', 'UPI'];
export const CREDIT_METHOD = 'Credit / On Account';

export const BUDGET_BUCKETS = {
  salary: 'salaryBudget',
  schoolRequirements: 'schoolRequirementsBudget',
  operationalBuffer: 'operationalBufferBudget',
  total: 'totalBudget',
};

export const cleanText = (value) => typeof value === 'string' ? value.trim() : '';
export const optionalCode = (value) => cleanText(value).toUpperCase();
export const generatedCode = (prefix) => prefix + '-' + randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase();
export const requestHash = (values) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
export const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
export const roundQuantity = (value) => Math.round(value * 1000) / 1000;

export function numeric(value, label, { fallback = 0, max = 1e12, min = 0, round = roundMoney } = {}) {
  if (value == null || (typeof value === 'string' && !value.trim())) return fallback;
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < min || number > max) {
    throw procurementError(label + ' must be a number between ' + min + ' and ' + max + '.');
  }
  return round(number);
}

export function dateValue(value, label, fallback = null) {
  if (value == null || value === '') return fallback;
  const date = typeof value === 'string' ? new Date(value) : new Date(NaN);
  if (!Number.isFinite(date.getTime()) ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) && date.toISOString().slice(0, 10) !== value)) {
    throw procurementError(label + ' must be a valid date.');
  }
  return date.toISOString();
}

export function stockStatus(item) {
  if (item.status === 'discontinued') return 'discontinued';
  if (Number(item.quantity) <= 0) return 'out-of-stock';
  return Number(item.quantity) <= Number(item.minStockLevel ?? 5) ? 'low-stock' : 'in-stock';
}

export function legacyBundle(item) {
  return (item.items?.length || 0) > 1;
}

export function inventoryUnitCost(item) {
  if (!item.unitCostVerified && item.items?.length && item.unitCost === item.subtotal) {
    const originalQuantity = item.items.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    return originalQuantity ? Number(item.subtotal || 0) / originalQuantity : 0;
  }
  return Number(item.unitCostVerified ? item.unitCost : item.unitCost || item.price || 0);
}

export const inventoryValue = (item) => roundMoney(inventoryUnitCost(item) * Number(item.quantity || 0));

export function paymentBalance(grandTotal, amountPaid) {
  const balanceDue = roundMoney(grandTotal - amountPaid);
  let paymentStatus = 'Unpaid';
  if (balanceDue <= 0) paymentStatus = 'Paid';
  else if (amountPaid > 0) paymentStatus = 'Partial';
  return { amountPaid, balanceDue, paymentStatus };
}

export function budgetAmounts(budget) {
  const allocated = Number(budget.schoolRequirementsBudget || 0);
  const spent = Number(budget.schoolRequirementsSpent || 0);
  const remaining = roundMoney(allocated - spent);
  const percentUsed = allocated > 0 ? Math.round((spent / allocated) * 100) : (spent > 0 ? 100 : 0);
  let status = 'healthy';
  if (remaining < 0 || percentUsed >= 90) status = 'critical';
  else if (percentUsed >= 75) status = 'warning';
  return { schoolRequirementsBudget: allocated, schoolRequirementsSpent: spent, remainingBudget: remaining, percentUsed, status };
}

export async function sessionById(store, id) {
  const session = await store.get('academicSessions', id);
  if (!session) throw procurementError('Academic session not found.', 404);
  return session;
}

export async function activeSession(store) {
  return await store.one('academicSessions', { isCurrent: true })
    || store.one('academicSessions', { status: 'active' });
}

export const sessionBudget = (store, session) =>
  session ? store.one('budgetAllocations', { sessionId: recordId(session) }) : null;

export function billDueDate(billDate, terms) {
  const days = { 'Net 15': 15, 'Net 30': 30, 'Net 60': 60 }[terms] || 0;
  const date = new Date(billDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

export const displayBillNumber = (bill) => bill.supplierBillNumber || bill.billNumber;
