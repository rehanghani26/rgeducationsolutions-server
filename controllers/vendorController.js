import Vendor from '../models/Vendor.js';
import { getSchool, readProcurement, writeProcurement } from '../services/procurementStore.js';
import { applyVendorPayment } from '../services/purchaseService.js';
import { logActivity } from '../utils/activityLogger.js';
import { escapeRegex } from '../utils/commonUtil.js';
import { sendCreated, sendSuccess } from '../utils/responseUtil.js';
import {
  cleanText,
  generatedCode,
  numeric,
  optionalCode,
  procurementError,
  recordId,
  roundMoney,
  sendProcurementError,
  stockStatus,
} from '../utils/procurementValues.js';

const profileFields = [
  'name', 'contactPerson', 'phone', 'altPhone', 'address', 'city', 'state', 'pincode',
  'gstin', 'pan', 'notes', 'email', 'billingEmail', 'website',
];
const bankFields = ['accountHolderName', 'bankName', 'accountNumber', 'ifscCode', 'branchName', 'upiId'];
const searchFields = ['name', 'vendorCode', 'contactPerson', 'phone', 'email', 'billingEmail', 'city', 'gstin'];

function vendorProfile(input, existing = {}) {
  const values = {};
  for (const field of profileFields) {
    if (Object.hasOwn(input, field)) values[field] = cleanText(input[field]);
  }
  if (!(values.name ?? existing.name)) {
    throw procurementError('Enter the vendor name.');
  }

  for (const field of ['email', 'billingEmail']) {
    if (!values[field]) continue;
    values[field] = values[field].toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values[field])) throw procurementError('Enter a valid ' + (field === 'email' ? 'contact email.' : 'billing email.'));
  }
  for (const field of ['gstin', 'pan']) {
    if (values[field]) values[field] = values[field].toUpperCase();
  }
  if (values.website) {
    const address = /^https?:\/\//i.test(values.website) ? values.website : 'https://' + values.website;
    if (!URL.canParse(address)) throw procurementError('Enter a valid vendor website.');
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) {
      throw procurementError('Enter a valid vendor website.');
    }
    values.website = url.href;
  }
  if (Object.hasOwn(input, 'bankDetails')) {
    values.bankDetails = { ...existing.bankDetails };
    for (const field of bankFields) {
      if (Object.hasOwn(input.bankDetails || {}, field)) values.bankDetails[field] = cleanText(input.bankDetails[field]);
    }
    if (values.bankDetails.ifscCode) values.bankDetails.ifscCode = values.bankDetails.ifscCode.toUpperCase();
  }
  for (const [field, fallback] of Object.entries({ category: 'General', status: 'active', paymentTerms: 'Net 30' })) {
    if (Object.hasOwn(input, field) || !existing[field]) {
      const value = cleanText(input[field]) || fallback;
      if (!Vendor.schema.path(field).enumValues.includes(value)) throw procurementError('Select a valid vendor ' + field + '.');
      values[field] = value;
    }
  }
  if (Object.hasOwn(input, 'rating')) values.rating = numeric(input.rating, 'Rating', { min: 1, max: 5, fallback: 5 });
  if (Object.hasOwn(input, 'leadTimeDays')) {
    const days = numeric(input.leadTimeDays, 'Lead time', { max: 365, fallback: null, round: (n) => n });
    if (days != null && !Number.isInteger(days)) throw procurementError('Enter the lead time in whole days.');
    values.leadTimeDays = days;
  }
  if (Object.hasOwn(input, 'vendorCode') || !existing.vendorCode) {
    values.vendorCode = optionalCode(input.vendorCode) || existing.vendorCode || generatedCode('VND');
  }
  return values;
}

function publicVendor(vendor, showBankDetails = false) {
  const { bankDetails, payments, ...profile } = vendor;
  return showBankDetails ? { ...profile, bankDetails, payments: payments || [] } : profile;
}

function vendorAudit(req, vendor, action, details) {
  return logActivity({
    schoolId: getSchool(req), userId: req.user?._id || req.user?.id,
    action, module: 'vendors', recordId: recordId(vendor), details,
    ipAddress: req.ip, userAgent: req.headers?.['user-agent'],
  });
}

async function requireVendor(store, id) {
  const vendor = await store.get('vendors', id);
  if (!vendor) throw procurementError('Vendor not found.', 404);
  return vendor;
}

async function checkDuplicates(store, values, existing) {
  const lookups = [];
  if (values.vendorCode) lookups.push(['vendorCode', values.vendorCode, 'Vendor code']);
  if (values.name) lookups.push(['name', new RegExp('^' + escapeRegex(values.name) + '$', 'i'), 'Vendor name']);
  for (const [field, value, label] of lookups) {
    const duplicate = await store.one('vendors', { [field]: value });
    if (duplicate && String(recordId(duplicate)) !== String(recordId(existing))) {
      throw procurementError(label + ' already exists.', 409);
    }
  }
}

export async function getVendors(req, res) {
  try {
    const store = readProcurement(req);
    const { status, category } = req.query;
    const match = {};
    if (typeof status === 'string' && status !== 'All' && status) match.status = status;
    if (typeof category === 'string' && category !== 'All' && category) match.category = category;
    const page = await store.page('vendors', req.query, { match, searchFields, sortFields: ['createdAt', 'name', 'vendorCode'] });
    const vendors = page.data.map((vendor) => publicVendor(vendor));
    let summary;
    if (req.query.summary === 'true') {
      const all = await store.find('vendors');
      summary = {
        total: all.length,
        active: all.filter((vendor) => vendor.status === 'active').length,
        billed: roundMoney(all.reduce((sum, vendor) => sum + Number(vendor.totalBilled || 0), 0)),
        outstanding: roundMoney(all.reduce((sum, vendor) => sum + Number(vendor.outstandingBalance || 0), 0)),
      };
    }
    return sendSuccess(res, undefined, { ...page, data: vendors, vendors, summary });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function getVendorById(req, res) {
  try {
    const store = readProcurement(req);
    const vendor = await requireVendor(store, req.params.id);
    const vendorId = recordId(vendor);
    const [unsortedBills, preferred] = await Promise.all([
      store.find('inventoryPurchases', { vendorId }),
      store.find('inventory', { vendorId }),
    ]);
    const bills = unsortedBills.sort((a, b) => new Date(b.billDate) - new Date(a.billDate));
    const suppliedItems = new Map(preferred.map((item) => [String(recordId(item)), item]));
    const billedItems = new Set(bills.flatMap((bill) => (bill.items || []).map((item) => String(item.itemId))));
    const otherItems = await store.byIds('inventory', [...billedItems].filter((id) => !suppliedItems.has(id)));
    otherItems.forEach((item) => suppliedItems.set(String(recordId(item)), item));

    const monthlySpend = new Map();
    const categorySpend = new Map();
    const monthFormat = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    for (const bill of [...bills].reverse()) {
      const date = new Date(bill.billDate);
      if (Number.isFinite(date.getTime())) {
        const month = monthFormat.format(date);
        monthlySpend.set(month, (monthlySpend.get(month) || 0) + Number(bill.grandTotal || 0));
      }
      for (const item of bill.items || []) {
        const category = item.category || vendor.category || 'General';
        categorySpend.set(category, (categorySpend.get(category) || 0) + Number(item.totalCost || 0));
      }
    }

    const totalBilled = Number(vendor.totalBilled || 0);
    const totalPaid = Number(vendor.totalPaid || 0);
    const billTotal = roundMoney(bills.reduce((sum, bill) => sum + Number(bill.grandTotal || 0), 0));
    const role = String(req.user?.role || '').toLowerCase().replace(/_/g, '-');
    const financialAccess = ['admin', 'school-admin', 'super-admin', 'superadmin', 'accountant', 'principal'].includes(role);
    const suppliedProducts = [...suppliedItems.values()].map((item) => ({ ...item, status: stockStatus(item) }));
    return sendSuccess(res, undefined, {
      vendor: publicVendor(vendor, financialAccess),
      bills,
      suppliedProducts,
      kpis: {
        totalBilled,
        totalPaid,
        outstandingBalance: roundMoney(totalBilled - totalPaid),
        totalBillsCount: bills.length,
        suppliedProductsCount: suppliedProducts.length,
        averageOrderValue: bills.length ? roundMoney(billTotal / bills.length) : 0,
      },
      spendTrend: Array.from(monthlySpend, ([month, amount]) => ({ month, amount: roundMoney(amount) })),
      categoryBreakdown: Array.from(categorySpend, ([category, amount]) => ({ category, amount: roundMoney(amount) })),
    });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function createVendor(req, res) {
  try {
    const values = vendorProfile(req.body || {});
    const vendor = await writeProcurement(req, ['vendors'], async (store) => {
      await checkDuplicates(store, values);
      return store.create('vendors', { ...values, totalBilled: 0, totalPaid: 0, outstandingBalance: 0 });
    }, { atomic: false });
    await vendorAudit(req, vendor, 'CREATE', 'Registered vendor ' + vendor.vendorCode);
    return sendCreated(res, 'Vendor registered.', { vendor });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function updateVendor(req, res) {
  try {
    const vendor = await writeProcurement(req, ['vendors'], async (store) => {
      const existing = await requireVendor(store, req.params.id);
      const values = vendorProfile(req.body || {}, existing);
      await checkDuplicates(store, values, existing);
      return store.update('vendors', recordId(existing), values);
    }, { atomic: false });
    await vendorAudit(req, vendor, 'UPDATE', 'Updated vendor ' + vendor.vendorCode);
    return sendSuccess(res, 'Vendor saved.', { vendor });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function deleteVendor(req, res) {
  try {
    const vendor = await writeProcurement(req, ['vendors'], async (store) => {
      const existing = await requireVendor(store, req.params.id);
      return store.update('vendors', recordId(existing), { status: 'inactive' });
    }, { atomic: false });
    await vendorAudit(req, vendor, 'UPDATE', 'Deactivated vendor ' + vendor.vendorCode);
    return sendSuccess(res, 'Vendor deactivated.', { archived: true, vendor: publicVendor(vendor) });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function getVendorBills(req, res) {
  try {
    const store = readProcurement(req);
    const vendor = await requireVendor(store, req.params.id);
    const { data: bills, pagination } = await store.page('inventoryPurchases', { ...req.query, sort: '-billDate' }, {
      match: { vendorId: recordId(vendor) },
      searchFields: ['billNumber', 'supplierBillNumber', 'poNumber'],
      sortFields: ['billDate'],
    });
    return sendSuccess(res, undefined, { bills, pagination });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function recordVendorPayment(req, res) {
  try {
    const result = await applyVendorPayment(req);
    if (!result.alreadyRecorded) await vendorAudit(req, result.vendor, 'UPDATE', 'Recorded a payment for ' + result.vendor.vendorCode);
    return sendSuccess(res, 'Payment recorded.', result);
  } catch (error) {
    return sendProcurementError(res, error);
  }
}
