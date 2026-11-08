// server/controllers/vendorController.js
import Vendor from '../models/Vendor.js';
import Inventory from '../models/Inventory.js';
import InventoryPurchase from '../models/InventoryPurchase.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';
import { parsePagination, buildSearchFilter, paginateResult } from '../utils/paginateQuery.js';
import { logActivity } from '../utils/activityLogger.js';
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError,
} from '../utils/responseUtil.js';

/**
 * Retrieves paginated vendor suppliers with search & filtering.
 */
export const getVendors = async (req, res) => {
  try {
    const { page, limit, skip, sort, search, status } = parsePagination(req.query);
    const category = req.query.category || '';
    const searchFields = ['name', 'vendorCode', 'contactPerson', 'email', 'phone', 'category'];

    if (checkFallback()) {
      let list = FallbackDb.find('vendors') || [];
      if (search) {
        const term = search.toLowerCase();
        list = list.filter((v) =>
          searchFields.some((f) => String(v[f] || '').toLowerCase().includes(term))
        );
      }
      if (category && category !== 'All') list = list.filter((v) => v.category === category);
      if (status && status !== 'All') list = list.filter((v) => v.status === status);

      const total = list.length;
      const data = list.slice(skip, skip + limit);
      return sendSuccess(res, undefined, {
        vendors: data,
        ...paginateResult(data, total, { page, limit }),
      });
    }

    const filter = { ...buildSearchFilter(search, searchFields) };
    if (category && category !== 'All') filter.category = category;
    if (status && status !== 'All') filter.status = status;

    const sortObj = {};
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith('-') ? -1 : 1;

    const [vendors, total] = await Promise.all([
      Vendor.find(filter).sort(sortObj).skip(skip).limit(limit),
      Vendor.countDocuments(filter),
    ]);

    return sendSuccess(res, undefined, {
      vendors,
      ...paginateResult(vendors, total, { page, limit }),
    });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves a single vendor by ID with complete ledger metrics, supplied products & spend analytics.
 */
export const getVendorById = async (req, res) => {
  try {
    const { id } = req.params;
    let vendor = null;
    let bills = [];
    let suppliedProducts = [];

    if (checkFallback()) {
      vendor = FallbackDb.findById('vendors', id);
      const allPurchases = FallbackDb.find('inventoryPurchases') || [];
      bills = allPurchases.filter((p) => String(p.vendorId) === String(id));
      const allItems = FallbackDb.find('inventory') || [];
      suppliedProducts = allItems.filter(
        (it) => String(it.vendorId) === String(id) || String(it.primaryVendorId) === String(id)
      );
    } else {
      vendor = await Vendor.findById(id);
      if (vendor) {
        const [bList, pList] = await Promise.all([
          InventoryPurchase.find({ vendorId: id }).sort({ billDate: -1 }),
          Inventory.find({ $or: [{ vendorId: id }, { primaryVendorId: id }] }).sort({ name: 1 }),
        ]);
        bills = bList;
        suppliedProducts = pList;
      }
    }

    if (!vendor) return sendNotFound(res, 'Vendor not found');

    // Calculate dynamic analytics
    const totalBilled = vendor.totalBilled || bills.reduce((s, b) => s + (b.grandTotal || 0), 0);
    const totalPaid = vendor.totalPaid || bills.reduce((s, b) => s + (b.amountPaid || 0), 0);
    const outstandingBalance = Math.max(0, totalBilled - totalPaid);
    const averageOrderValue = bills.length > 0 ? Math.round(totalBilled / bills.length) : 0;

    // Monthly Spend breakdown for charts
    const monthlySpend = {};
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    bills.forEach((bill) => {
      const d = new Date(bill.billDate);
      const mKey = `${months[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`;
      monthlySpend[mKey] = (monthlySpend[mKey] || 0) + (bill.grandTotal || 0);
    });
    const spendTrend = Object.entries(monthlySpend).map(([month, amount]) => ({ month, amount }));

    // Category breakdown
    const categorySpend = {};
    bills.forEach((bill) => {
      bill.items?.forEach((it) => {
        const cat = it.category || vendor.category || 'General';
        categorySpend[cat] = (categorySpend[cat] || 0) + (it.totalCost || 0);
      });
    });
    const categoryBreakdown = Object.entries(categorySpend).map(([category, amount]) => ({ category, amount }));

    return sendSuccess(res, undefined, {
      vendor,
      bills,
      suppliedProducts,
      kpis: {
        totalBilled,
        totalPaid,
        outstandingBalance,
        totalBillsCount: bills.length,
        suppliedProductsCount: suppliedProducts.length,
        averageOrderValue,
      },
      spendTrend,
      categoryBreakdown,
    });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Registers a new vendor supplier.
 */
export const createVendor = async (req, res) => {
  try {
    const data = req.body;
    if (!data.name || !String(data.name).trim()) {
      return sendBadRequest(res, 'Company / Vendor name is required.');
    }

    let newVendor = null;

    if (checkFallback()) {
      const existing = FallbackDb.find('vendors') || [];
      const code = data.vendorCode || `VND-${String(existing.length + 1).padStart(3, '0')}`;
      newVendor = FallbackDb.create('vendors', {
        ...data,
        name: String(data.name).trim(),
        category: data.category || 'General',
        vendorCode: code,
        phone: data.phone || '',
        email: data.email || '',
        contactPerson: data.contactPerson || '',
        totalBilled: Number(data.totalBilled) || 0,
        totalPaid: Number(data.totalPaid) || 0,
        outstandingBalance: (Number(data.totalBilled) || 0) - (Number(data.totalPaid) || 0),
        rating: Number(data.rating) || 5,
        status: data.status || 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      const count = await Vendor.countDocuments();
      if (!data.vendorCode) {
        data.vendorCode = `VND-${String(count + 1).padStart(3, '0')}`;
      }
      data.category = data.category || 'General';
      const vendor = new Vendor(data);
      newVendor = await vendor.save();
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CREATE',
      module: 'vendors',
      recordId: newVendor.id || newVendor._id,
      details: `Registered vendor ${newVendor.name} (${newVendor.vendorCode})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendCreated(res, 'Vendor registered successfully', { vendor: newVendor });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Updates vendor details, coordinates, and bank information.
 */
export const updateVendor = async (req, res) => {
  try {
    const { id } = req.params;
    const data = { ...req.body };
    delete data.id;
    delete data._id;

    let updatedVendor = null;

    if (checkFallback()) {
      const existing = FallbackDb.findById('vendors', id);
      if (!existing) return sendNotFound(res, 'Vendor not found');

      const totalBilled = data.totalBilled !== undefined ? Number(data.totalBilled) : existing.totalBilled;
      const totalPaid = data.totalPaid !== undefined ? Number(data.totalPaid) : existing.totalPaid;
      data.outstandingBalance = totalBilled - totalPaid;

      updatedVendor = FallbackDb.update('vendors', id, {
        ...data,
        updatedAt: new Date().toISOString(),
      });
    } else {
      updatedVendor = await Vendor.findByIdAndUpdate(id, data, { new: true });
    }

    if (!updatedVendor) return sendNotFound(res, 'Vendor not found');

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'UPDATE',
      module: 'vendors',
      recordId: id,
      details: `Updated vendor details for ${updatedVendor.name}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, 'Vendor updated successfully', { vendor: updatedVendor });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Deactivates or removes a vendor.
 */
export const deleteVendor = async (req, res) => {
  try {
    const { id } = req.params;

    if (checkFallback()) {
      const allPurchases = FallbackDb.find('inventoryPurchases') || [];
      const hasPurchases = allPurchases.some((p) => String(p.vendorId) === String(id));
      if (hasPurchases) {
        // Soft deactivate
        const updated = FallbackDb.update('vendors', id, { status: 'inactive' });
        return sendSuccess(res, 'Vendor has historical purchase records, deactivated status instead.', { vendor: updated });
      }
      FallbackDb.delete('vendors', id);
    } else {
      const hasPurchases = await InventoryPurchase.exists({ vendorId: id });
      if (hasPurchases) {
        const updated = await Vendor.findByIdAndUpdate(id, { status: 'inactive' }, { new: true });
        return sendSuccess(res, 'Vendor has historical purchase records, deactivated status instead.', { vendor: updated });
      }
      await Vendor.findByIdAndDelete(id);
    }

    return sendSuccess(res, 'Vendor removed successfully');
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves all purchase invoices/bills associated with this vendor.
 */
export const getVendorBills = async (req, res) => {
  try {
    const { id } = req.params;
    let bills = [];

    if (checkFallback()) {
      const allPurchases = FallbackDb.find('inventoryPurchases') || [];
      bills = allPurchases.filter((p) => String(p.vendorId) === String(id));
    } else {
      bills = await InventoryPurchase.find({ vendorId: id }).sort({ billDate: -1 });
    }

    return sendSuccess(res, undefined, { count: bills.length, bills });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Records a payment against a vendor bill / general vendor balance.
 */
export const recordVendorPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, paymentType, transactionReference, notes, billId } = req.body;
    const payAmount = Number(amount);

    if (isNaN(payAmount) || payAmount <= 0) {
      return sendBadRequest(res, 'Please provide a valid payment amount greater than zero.');
    }

    let vendor = null;

    if (checkFallback()) {
      vendor = FallbackDb.findById('vendors', id);
      if (!vendor) return sendNotFound(res, 'Vendor not found');

      const newTotalPaid = (vendor.totalPaid || 0) + payAmount;
      const newOutstanding = Math.max(0, (vendor.totalBilled || 0) - newTotalPaid);

      vendor = FallbackDb.update('vendors', id, {
        totalPaid: newTotalPaid,
        outstandingBalance: newOutstanding,
        updatedAt: new Date().toISOString(),
      });

      if (billId) {
        const bill = FallbackDb.findById('inventoryPurchases', billId);
        if (bill) {
          const billPaid = (bill.amountPaid || 0) + payAmount;
          const billDue = Math.max(0, (bill.grandTotal || 0) - billPaid);
          const billStatus = billDue === 0 ? 'Paid' : 'Partial';
          FallbackDb.update('inventoryPurchases', billId, {
            amountPaid: billPaid,
            balanceDue: billDue,
            paymentStatus: billStatus,
            transactionReference: transactionReference || bill.transactionReference,
          });
        }
      }
    } else {
      vendor = await Vendor.findById(id);
      if (!vendor) return sendNotFound(res, 'Vendor not found');

      vendor.totalPaid = (vendor.totalPaid || 0) + payAmount;
      vendor.outstandingBalance = Math.max(0, (vendor.totalBilled || 0) - vendor.totalPaid);
      await vendor.save();

      if (billId) {
        const bill = await InventoryPurchase.findById(billId);
        if (bill) {
          bill.amountPaid = (bill.amountPaid || 0) + payAmount;
          bill.balanceDue = Math.max(0, (bill.grandTotal || 0) - bill.amountPaid);
          bill.paymentStatus = bill.balanceDue === 0 ? 'Paid' : 'Partial';
          if (transactionReference) bill.transactionReference = transactionReference;
          await bill.save();
        }
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'UPDATE',
      module: 'vendors',
      recordId: id,
      details: `Recorded payment of ₹${payAmount} to vendor ${vendor.name} via ${paymentType || 'Bank Transfer'}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { amount: payAmount, paymentType, transactionReference, billId },
    });

    return sendSuccess(res, `Payment of ₹${payAmount} recorded successfully.`, { vendor });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

