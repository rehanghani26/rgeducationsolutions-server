// server/controllers/inventoryController.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkFallback } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INVENTORY_UPLOAD_DIR = path.join(__dirname, '../uploads/inventory');

// Models
import Inventory from '../models/Inventory.js';
import Vendor from '../models/Vendor.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import InventoryPurchase from '../models/InventoryPurchase.js';
import InventoryIssuance from '../models/InventoryIssuance.js';
import BudgetAllocation from '../models/BudgetAllocation.js';
import AcademicSession from '../models/AcademicSession.js';

// Services
import { FallbackDb } from '../services/dbFallback.js';

// Utilities
import { parsePagination, buildSearchFilter, paginateResult } from '../utils/paginateQuery.js';
import { logActivity, getRecordActivity } from '../utils/activityLogger.js';
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError,
} from '../utils/responseUtil.js';

/**
 * Enriches fallback inventory item with vendor profile details.
 */
const enrichItem = (item) => {
  if (checkFallback()) {
    const vend = FallbackDb.findById('vendors', item.vendorId);
    return { ...item, vendor: vend, vendorDetails: vend, vendorId: vend };
  }
  return item;
};

/**
 * Retrieves paginated inventory stock with category and low-stock filtering.
 */
export const getInventory = async (req, res) => {
  try {
    const { page, limit, skip, sort, search, status } = parsePagination(req.query);
    const category = req.query.category || '';
    const searchFields = ['name', 'sku', 'category', 'location'];

    if (checkFallback()) {
      let list = (FallbackDb.find('inventory') || []).map(enrichItem);
      if (search) {
        const term = search.toLowerCase();
        list = list.filter((item) =>
          searchFields.some((f) => String(item[f] || '').toLowerCase().includes(term))
        );
      }
      if (category && category !== 'All') list = list.filter((item) => item.category === category);
      if (status === 'low-stock') list = list.filter((item) => item.quantity <= item.minStockLevel && item.quantity > 0);
      else if (status === 'out-of-stock') list = list.filter((item) => item.quantity <= 0);
      else if (status === 'in-stock') list = list.filter((item) => item.quantity > item.minStockLevel);

      const total = list.length;
      const data = list.slice(skip, skip + limit);
      return sendSuccess(res, undefined, { inventory: data, ...paginateResult(data, total, { page, limit }) });
    }

    const filter = { ...buildSearchFilter(search, searchFields) };
    if (category && category !== 'All') filter.category = category;
    if (status === 'low-stock') {
      filter.quantity = { $gt: 0 };
      filter.$expr = { $lte: ['$quantity', '$minStockLevel'] };
    } else if (status === 'out-of-stock') {
      filter.quantity = { $lte: 0 };
    } else if (status === 'in-stock') {
      filter.$expr = { $gt: ['$quantity', '$minStockLevel'] };
    }

    const sortObj = {};
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith('-') ? -1 : 1;

    const [inventory, total] = await Promise.all([
      Inventory.find(filter).populate('vendorId').sort(sortObj).skip(skip).limit(limit),
      Inventory.countDocuments(filter),
    ]);

    return sendSuccess(res, undefined, { inventory, ...paginateResult(inventory, total, { page, limit }) });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves a single inventory item by ID with procurement history, class issuances & movement audit.
 */
export const getInventoryById = async (req, res) => {
  try {
    const { id } = req.params;
    let item = null;
    let transactions = [];
    let purchases = [];
    let issuances = [];

    if (checkFallback()) {
      item = FallbackDb.findById('inventory', id);
      if (item) {
        item = enrichItem(item);
        const allTx = FallbackDb.find('inventoryTransactions') || [];
        transactions = allTx.filter((t) => String(t.itemId) === String(id));
        const allP = FallbackDb.find('inventoryPurchases') || [];
        purchases = allP.filter((p) => (p.items || []).some((it) => String(it.itemId) === String(id)));
        const allI = FallbackDb.find('inventoryIssuances') || [];
        issuances = allI.filter((iss) => (iss.items || []).some((it) => String(it.itemId) === String(id)));
      }
    } else {
      item = await Inventory.findById(id).populate('vendorId');
      if (item) {
        transactions = await InventoryTransaction.find({ itemId: id }).sort({ timestamp: -1 }).limit(50);

        try {
          purchases = await InventoryPurchase.find({ 'items.itemId': id }).populate('vendorId').sort({ billDate: -1 });
        } catch (_) {
          purchases = [];
        }

        try {
          issuances = await InventoryIssuance.find({ 'items.itemId': id }).sort({ issuanceDate: -1 });
        } catch (_) {
          issuances = [];
        }
      }
    }

    if (!item) return sendNotFound(res, 'Item not found');

    // Dynamic metrics
    const totalProcuredQty = purchases.reduce((sum, p) => {
      const line = p.items?.find((it) => String(it.itemId) === String(id));
      return sum + (line ? Number(line.quantity) || 0 : 0);
    }, 0);

    const totalIssuedQty = issuances.reduce((sum, iss) => {
      const line = iss.items?.find((it) => String(it.itemId) === String(id));
      return sum + (line ? Number(line.quantity) || 0 : 0);
    }, 0);

    const currentValuation = (item.quantity || 0) * (item.unitCost || item.price || 0);

    // Monthly consumption analysis
    const monthlyUsage = {};
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    issuances.forEach((iss) => {
      const line = iss.items?.find((it) => String(it.itemId) === String(id));
      if (line) {
        const d = new Date(iss.issuanceDate);
        const mKey = `${months[d.getMonth()]} ${d.getFullYear().toString().slice(-2)}`;
        monthlyUsage[mKey] = (monthlyUsage[mKey] || 0) + (Number(line.quantity) || 0);
      }
    });
    const consumptionTrend = Object.entries(monthlyUsage).map(([month, quantity]) => ({ month, quantity }));

    return sendSuccess(res, undefined, {
      item,
      transactions,
      purchases,
      issuances,
      kpis: {
        currentStock: item.quantity,
        unit: item.unit,
        minStockLevel: item.minStockLevel,
        unitCost: item.unitCost,
        price: item.price,
        currentValuation,
        totalProcuredQty,
        totalIssuedQty,
      },
      consumptionTrend,
    });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Normalizes incoming inventory product fields including GST, delivery dates, and attachments.
 */
const buildInventoryPayload = (data, sku) => {
  const quantity = Number(data.quantity) || 0;
  const unitCost = Number(data.unitCost) || Number(data.price) || 0;
  const price = Number(data.price) || unitCost;
  const gstRate = Math.max(0, Number(data.gstRate) || 0);
  const baseSubtotal = quantity * unitCost;
  const gstAmount = data.gstAmount !== undefined ? Number(data.gstAmount) || 0 : (baseSubtotal * gstRate) / 100;
  const shippingCharges = Math.max(0, Number(data.shippingCharges) || 0);
  const otherCharges = Math.max(0, Number(data.otherCharges) || 0);
  const totalCostWithTax =
    data.totalCostWithTax !== undefined
      ? Number(data.totalCostWithTax) || 0
      : baseSubtotal + gstAmount + shippingCharges + otherCharges;
  const minStockLevel = Number(data.minStockLevel) || 5;
  const items = Array.isArray(data.items) && data.items.length > 0 ? data.items : [];

  return {
    ...data,
    sku,
    imageUrl: data.imageUrl || (items[0]?.imageUrl || ''),
    quantity,
    totalQuantity: data.totalQuantity !== undefined ? Number(data.totalQuantity) : quantity,
    unit: data.unit || 'pcs',
    minStockLevel,
    maxStockLevel: Number(data.maxStockLevel) || 1000,
    reorderQuantity: Number(data.reorderQuantity) || 20,
    price,
    unitCost,
    gstRate,
    gstAmount,
    shippingCharges,
    otherCharges,
    totalCostWithTax,
    grandTotal: data.grandTotal !== undefined ? Number(data.grandTotal) : totalCostWithTax,
    subtotal: data.subtotal !== undefined ? Number(data.subtotal) : baseSubtotal,
    totalGst: data.totalGst !== undefined ? Number(data.totalGst) : gstAmount,
    items,
    itemCount: items.length || 1,
    expectedDeliveryDate: data.expectedDeliveryDate || null,
    actualPurchaseDate: data.actualPurchaseDate || null,
    invoiceAttachment: data.invoiceAttachment || undefined,
    additionalAttachments: Array.isArray(data.additionalAttachments) ? data.additionalAttachments : [],
    status: quantity <= 0 ? 'out-of-stock' : quantity <= minStockLevel ? 'low-stock' : 'in-stock',
  };
};

/**
 * Creates a new inventory stock record.
 */
export const createInventoryItem = async (req, res) => {
  try {
    const data = req.body;
    if (!data.name || !data.category) {
      return sendBadRequest(res, 'Product name and category are required.');
    }

    let newRecord = null;
    const sku = data.sku
      ? data.sku.toUpperCase()
      : `SKU-${Date.now().toString(36).toUpperCase()}`;
    const payload = buildInventoryPayload(data, sku);

    if (checkFallback()) {
      const existing = FallbackDb.find('inventory') || [];
      if (existing.some((x) => x.sku === sku)) {
        return sendBadRequest(res, `SKU ${sku} already exists.`);
      }

      newRecord = FallbackDb.create('inventory', {
        ...payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      const item = new Inventory(payload);
      newRecord = await item.save();
    }

    // Log transaction if initial quantity > 0
    if (newRecord.quantity > 0) {
      const txData = {
        transactionNumber: `TXN-INIT-${sku}`,
        timestamp: new Date(),
        type: 'STOCK_ADJUST_ADD',
        itemId: newRecord.id || newRecord._id,
        itemName: newRecord.name,
        sku: newRecord.sku,
        quantity: newRecord.quantity,
        unit: newRecord.unit,
        unitPrice: newRecord.unitCost,
        totalValue: newRecord.quantity * newRecord.unitCost,
        partyName: 'Initial Inventory Entry',
        balanceAfter: newRecord.quantity,
        performedByName: req.user?.name || 'Admin',
        reason: 'Initial Product Setup',
      };

      if (checkFallback()) {
        FallbackDb.create('inventoryTransactions', txData);
      } else {
        await InventoryTransaction.create(txData);
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CREATE',
      module: 'inventory',
      recordId: newRecord.id || newRecord._id,
      details: `Created inventory item ${newRecord.name} (${newRecord.sku})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendCreated(res, 'Inventory item created successfully', { item: newRecord });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Uploads invoice PDF and additional inventory attachments (PDF, PSD, Excel, images, docs).
 */
export const uploadInventoryAttachments = async (req, res) => {
  try {
    const uploadedFiles = req.files && req.files.length > 0 ? req.files : req.file ? [req.file] : [];
    if (uploadedFiles.length === 0) {
      return sendBadRequest(res, 'No file(s) provided for upload.');
    }

    if (!fs.existsSync(INVENTORY_UPLOAD_DIR)) {
      fs.mkdirSync(INVENTORY_UPLOAD_DIR, { recursive: true });
    }

    const files = uploadedFiles.map((file) => {
      const ext = path.extname(file.originalname || '');
      const safeBase = path
        .basename(file.originalname || 'file', ext)
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 40);
      const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e6)}-${safeBase}${ext}`;
      const destPath = path.join(INVENTORY_UPLOAD_DIR, uniqueName);
      fs.writeFileSync(destPath, file.buffer);

      return {
        filename: uniqueName,
        originalName: file.originalname,
        url: `/uploads/inventory/${uniqueName}`,
        mimeType: file.mimetype,
        size: file.size,
      };
    });

    return sendCreated(res, 'Attachment(s) uploaded successfully', { files });
  } catch (error) {
    return sendError(res, error.message || 'Failed to upload attachment(s)', 500, error);
  }
};

/**
 * Creates multiple inventory products in one batch with shared procurement metadata,
 * GST calculations, shipping/other charges, delivery dates, and attachments.
 */
export const createBulkInventoryItems = async (req, res) => {
  try {
    const {
      items = [],
      vendorId = '',
      expectedDeliveryDate = null,
      actualPurchaseDate = null,
      shippingCharges = 0,
      otherCharges = 0,
      invoiceAttachment = null,
      additionalAttachments = [],
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return sendBadRequest(res, 'At least one product is required.');
    }

    const formattedItems = items.map((raw, idx) => {
      const qty = Math.max(0, Number(raw.quantity) || 0);
      const unitCost = Math.max(0, Number(raw.unitCost) || 0);
      const price = Math.max(0, Number(raw.price) || unitCost);
      const gstRate = Math.max(0, Number(raw.gstRate) || 0);
      const base = qty * unitCost;
      const gstAmount = raw.gstAmount !== undefined ? Number(raw.gstAmount) || 0 : (base * gstRate) / 100;
      const itemSku = raw.sku
        ? String(raw.sku).trim().toUpperCase()
        : `SKU-${Date.now().toString(36).toUpperCase()}-${idx + 1}`;

      return {
        catalogId: raw.catalogId || '',
        name: String(raw.name || '').trim(),
        sku: itemSku,
        description: (raw.description || '').trim(),
        imageUrl: raw.imageUrl || '',
        category: raw.category || 'General',
        subcategory: (raw.subcategory || '').trim(),
        quantity: qty,
        unit: raw.unit || 'pcs',
        unitCost,
        price,
        gstRate,
        gstAmount,
        totalCostWithTax: base + gstAmount,
        minStockLevel: Number(raw.minStockLevel) || 5,
        maxStockLevel: Number(raw.maxStockLevel) || 500,
        reorderQuantity: Number(raw.reorderQuantity) || 20,
        location: raw.location || 'Main Store',
      };
    });

    for (let idx = 0; idx < formattedItems.length; idx += 1) {
      if (!formattedItems[idx].name || !formattedItems[idx].category) {
        return sendBadRequest(res, `Row ${idx + 1}: Product name and category are required.`);
      }
    }

    const totalUnits = formattedItems.reduce((s, it) => s + it.quantity, 0);
    const subtotal = formattedItems.reduce((s, it) => s + (it.quantity * it.unitCost), 0);
    const totalGst = formattedItems.reduce((s, it) => s + it.gstAmount, 0);
    const numShipping = Math.max(0, Number(shippingCharges) || 0);
    const numOther = Math.max(0, Number(otherCharges) || 0);
    const grandTotal = subtotal + totalGst + numShipping + numOther;

    // Generate unique order/inventory SKU
    let primarySku = formattedItems[0].sku;
    if (formattedItems.length > 1) {
      primarySku = `ORD-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    } else {
      if (checkFallback()) {
        const existing = FallbackDb.find('inventory') || [];
        if (existing.some((x) => x.sku === primarySku)) {
          primarySku = `${primarySku}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
        }
      } else {
        const exists = await Inventory.findOne({ sku: primarySku }).select('_id').lean();
        if (exists) {
          primarySku = `${primarySku}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
        }
      }
    }

    const primaryName = formattedItems.length === 1
      ? formattedItems[0].name
      : formattedItems.length === 2
      ? `${formattedItems[0].name} & ${formattedItems[1].name}`
      : `${formattedItems[0].name} (+${formattedItems.length - 1} items)`;

    const minStock = Math.min(...formattedItems.map((i) => i.minStockLevel || 5));
    const maxStock = Math.max(...formattedItems.map((i) => i.maxStockLevel || 500));

    const payload = {
      name: primaryName,
      sku: primarySku,
      description: formattedItems.length === 1
        ? formattedItems[0].description
        : `Inventory intake of ${formattedItems.length} products: ${formattedItems.map((i) => i.name).join(', ')}`,
      imageUrl: formattedItems[0].imageUrl || '',
      category: formattedItems[0].category || 'General',
      subcategory: formattedItems[0].subcategory || (formattedItems.length > 1 ? 'Multi-Product Order' : ''),
      quantity: totalUnits,
      totalQuantity: totalUnits,
      unit: formattedItems.every((i) => i.unit === formattedItems[0].unit) ? formattedItems[0].unit : 'items',
      unitCost: subtotal,
      price: subtotal,
      gstRate: formattedItems[0].gstRate || 0,
      gstAmount: totalGst,
      totalGst,
      subtotal,
      shippingCharges: numShipping,
      otherCharges: numOther,
      totalCostWithTax: grandTotal,
      grandTotal,
      expectedDeliveryDate: expectedDeliveryDate || null,
      actualPurchaseDate: actualPurchaseDate || null,
      invoiceAttachment: invoiceAttachment || undefined,
      additionalAttachments: Array.isArray(additionalAttachments) ? additionalAttachments : [],
      location: formattedItems[0].location || 'Main Store',
      vendorId: vendorId || undefined,
      itemCount: formattedItems.length,
      items: formattedItems,
      minStockLevel: minStock,
      maxStockLevel: maxStock,
      reorderQuantity: formattedItems[0].reorderQuantity || 20,
      status: totalUnits <= 0 ? 'out-of-stock' : totalUnits <= minStock ? 'low-stock' : 'in-stock',
    };

    let newRecord = null;
    if (checkFallback()) {
      newRecord = FallbackDb.create('inventory', {
        ...payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    } else {
      const doc = new Inventory(payload);
      newRecord = await doc.save();
    }

    if (newRecord.quantity > 0) {
      const txData = {
        transactionNumber: `TXN-ORD-${newRecord.sku}`,
        timestamp: new Date(),
        type: 'STOCK_ADJUST_ADD',
        itemId: newRecord.id || newRecord._id,
        itemName: newRecord.name,
        sku: newRecord.sku,
        quantity: newRecord.quantity,
        unit: newRecord.unit,
        unitPrice: newRecord.unitCost,
        totalValue: newRecord.totalCostWithTax,
        partyName: 'Inventory Order Intake',
        balanceAfter: newRecord.quantity,
        performedByName: req.user?.name || 'Admin',
        reason: `Intake of ${formattedItems.length} product(s)`,
      };

      if (checkFallback()) {
        FallbackDb.create('inventoryTransactions', txData);
      } else {
        await InventoryTransaction.create(txData);
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CREATE',
      module: 'inventory',
      recordId: newRecord.id || newRecord._id,
      details: `Added inventory order ${newRecord.name} (${newRecord.sku}) containing ${formattedItems.length} product(s)`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendCreated(
      res,
      `Inventory product record created successfully (${formattedItems.length} item${formattedItems.length === 1 ? '' : 's'})`,
      { item: newRecord, items: [newRecord], count: 1 }
    );
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Updates details of an inventory item.
 */
export const updateInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    const data = { ...req.body };
    delete data.id;
    delete data._id;

    let updatedItem = null;
    if (checkFallback()) {
      updatedItem = FallbackDb.update('inventory', id, {
        ...data,
        updatedAt: new Date().toISOString(),
      });
      if (updatedItem) updatedItem = enrichItem(updatedItem);
    } else {
      updatedItem = await Inventory.findByIdAndUpdate(id, data, { new: true }).populate('vendorId');
    }

    if (!updatedItem) return sendNotFound(res, 'Item not found');

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'UPDATE',
      module: 'inventory',
      recordId: id,
      details: `Updated inventory item ${updatedItem.name}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, 'Item updated successfully', { item: updatedItem });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Deletes an inventory item.
 */
export const deleteInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    if (checkFallback()) {
      FallbackDb.delete('inventory', id);
    } else {
      await Inventory.findByIdAndDelete(id);
    }
    return sendSuccess(res, 'Inventory item deleted successfully');
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Adjusts quantity of stock in or out with audit transaction logging.
 */
export const adjustStock = async (req, res) => {
  try {
    const { id, type, quantity, reason } = req.body;
    const qtyChange = Number(quantity);

    if (!id || !type || isNaN(qtyChange) || qtyChange <= 0) {
      return sendBadRequest(res, 'Please provide valid item ID, type (in/out) and positive quantity.');
    }

    let updatedItem = null;
    let previousQty = 0;

    if (checkFallback()) {
      const item = FallbackDb.findById('inventory', id);
      if (!item) return sendNotFound(res, 'Item not found');

      previousQty = item.quantity;
      const newQty = type === 'in' ? item.quantity + qtyChange : Math.max(0, item.quantity - qtyChange);
      const status = newQty <= 0 ? 'out-of-stock' : newQty <= item.minStockLevel ? 'low-stock' : 'in-stock';

      updatedItem = FallbackDb.update('inventory', id, {
        quantity: newQty,
        status,
        updatedAt: new Date().toISOString(),
      });

      // Log transaction
      FallbackDb.create('inventoryTransactions', {
        transactionNumber: `TXN-ADJ-${Date.now().toString(36).toUpperCase()}`,
        timestamp: new Date().toISOString(),
        type: type === 'in' ? 'STOCK_ADJUST_ADD' : 'STOCK_ADJUST_REMOVE',
        itemId: id,
        itemName: item.name,
        sku: item.sku,
        quantity: type === 'in' ? qtyChange : -qtyChange,
        unit: item.unit,
        unitPrice: item.unitCost,
        totalValue: qtyChange * item.unitCost,
        partyName: 'Physical Stock Adjustment',
        balanceAfter: newQty,
        performedByName: req.user?.name || 'Admin',
        reason: reason || 'Manual Stock Level Calibration',
      });
    } else {
      const item = await Inventory.findById(id);
      if (!item) return sendNotFound(res, 'Item not found');

      previousQty = item.quantity;
      item.quantity = type === 'in' ? item.quantity + qtyChange : Math.max(0, item.quantity - qtyChange);
      updatedItem = await item.save();

      // Log transaction
      await InventoryTransaction.create({
        transactionNumber: `TXN-ADJ-${Date.now().toString(36).toUpperCase()}`,
        timestamp: new Date(),
        type: type === 'in' ? 'STOCK_ADJUST_ADD' : 'STOCK_ADJUST_REMOVE',
        itemId: item._id,
        itemName: item.name,
        sku: item.sku,
        quantity: type === 'in' ? qtyChange : -qtyChange,
        unit: item.unit,
        unitPrice: item.unitCost,
        totalValue: qtyChange * item.unitCost,
        partyName: 'Physical Stock Adjustment',
        balanceAfter: item.quantity,
        performedBy: req.user?._id || req.user?.id,
        performedByName: req.user?.name || 'Admin',
        reason: reason || 'Manual Stock Level Calibration',
      });
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'UPDATE',
      module: 'inventory',
      recordId: id,
      details: `Stock ${type === 'in' ? 'added' : 'removed'}: ${qtyChange} units of ${updatedItem.name} (${previousQty} -> ${updatedItem.quantity})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { type, quantity: qtyChange, newQuantity: updatedItem.quantity, reason },
    });

    return sendSuccess(res, 'Stock level adjusted successfully', { item: updatedItem });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves KPI metrics, inventory valuation, and live Session Budget Health.
 */
export const getInventorySummary = async (req, res) => {
  try {
    let items = [];
    let budgetHealth = {
      sessionId: null,
      sessionName: 'Current Session',
      schoolRequirementsBudget: 500000,
      schoolRequirementsSpent: 0,
      remainingBudget: 500000,
      percentUsed: 0,
      status: 'healthy',
    };

    if (checkFallback()) {
      items = FallbackDb.find('inventory') || [];
      const budgets = FallbackDb.find('budgetAllocations') || [];
      const currentBudget = budgets.find((b) => b.status === 'active') || budgets[0];

      if (currentBudget) {
        const allocated = currentBudget.schoolRequirementsBudget || 500000;
        const spent = currentBudget.schoolRequirementsSpent || 0;
        const remaining = Math.max(0, allocated - spent);
        const percent = allocated > 0 ? Math.min(100, Math.round((spent / allocated) * 100)) : 0;
        budgetHealth = {
          sessionId: currentBudget.sessionId,
          sessionName: currentBudget.sessionName,
          schoolRequirementsBudget: allocated,
          schoolRequirementsSpent: spent,
          remainingBudget: remaining,
          percentUsed: percent,
          status: percent > 90 ? 'critical' : percent > 75 ? 'warning' : 'healthy',
        };
      }
    } else {
      items = await Inventory.find();

      // Find current active session and budget
      const currentSession = await AcademicSession.findOne({ isCurrent: true });
      if (currentSession) {
        const budget = await BudgetAllocation.findOne({ sessionId: currentSession._id });
        if (budget) {
          const allocated = budget.schoolRequirementsBudget || 0;
          const spent = budget.schoolRequirementsSpent || 0;
          const remaining = Math.max(0, allocated - spent);
          const percent = allocated > 0 ? Math.min(100, Math.round((spent / allocated) * 100)) : 0;
          budgetHealth = {
            sessionId: currentSession._id,
            sessionName: currentSession.sessionName,
            schoolRequirementsBudget: allocated,
            schoolRequirementsSpent: spent,
            remainingBudget: remaining,
            percentUsed: percent,
            status: percent > 90 ? 'critical' : percent > 75 ? 'warning' : 'healthy',
          };
        }
      }
    }

    const totalItems = items.length;
    const totalStockCount = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
    const totalStockValue = items.reduce(
      (sum, item) => sum + (item.quantity || 0) * (item.unitCost || item.price || 0),
      0
    );
    const lowStockCount = items.filter(
      (item) => item.quantity <= item.minStockLevel && item.quantity > 0
    ).length;
    const outOfStockCount = items.filter((item) => item.quantity <= 0).length;

    return sendSuccess(res, undefined, {
      totalItems,
      totalStockCount,
      totalStockValue,
      lowStockCount,
      outOfStockCount,
      budgetHealth,
    });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Creates Inward Vendor Bill & Purchase Order (Seller Flow)
 * DEEPLY INTEGRATED WITH BUDGET OVERRUN SAFEGUARD!
 */
export const createPurchase = async (req, res) => {
  try {
    const {
      vendorId,
      billNumber,
      poNumber,
      billDate,
      items,
      subtotal,
      taxAmount,
      discountAmount,
      grandTotal,
      paymentType,
      amountPaid,
      transactionReference,
      notes,
    } = req.body;

    if (!vendorId || !items || !Array.isArray(items) || items.length === 0) {
      return sendBadRequest(res, 'Vendor and at least one purchase line item are required.');
    }

    const totalBill = Number(grandTotal) || items.reduce((s, it) => s + (Number(it.totalCost) || 0), 0);
    const paid = Number(amountPaid) || totalBill;
    const autoBillNo = billNumber || `BILL-${Date.now().toString(36).toUpperCase()}`;

    // ─── BUDGET OVERRUN VALIDATION ──────────────────────────────────────────
    let activeBudgetAllocation = null;
    let budgetSpent = 0;
    let budgetCap = 0;

    if (checkFallback()) {
      const budgets = FallbackDb.find('budgetAllocations') || [];
      activeBudgetAllocation = budgets.find((b) => b.status === 'active') || budgets[0];
      if (activeBudgetAllocation) {
        budgetCap = activeBudgetAllocation.schoolRequirementsBudget || 0;
        budgetSpent = activeBudgetAllocation.schoolRequirementsSpent || 0;
      }
    } else {
      const currentSession = await AcademicSession.findOne({ isCurrent: true });
      if (currentSession) {
        activeBudgetAllocation = await BudgetAllocation.findOne({ sessionId: currentSession._id });
        if (activeBudgetAllocation) {
          budgetCap = activeBudgetAllocation.schoolRequirementsBudget || 0;
          budgetSpent = activeBudgetAllocation.schoolRequirementsSpent || 0;
        }
      }
    }

    if (activeBudgetAllocation && budgetCap > 0) {
      const remainingBudget = budgetCap - budgetSpent;
      if (totalBill > remainingBudget) {
        const deficit = totalBill - remainingBudget;
        return res.status(400).json({
          success: false,
          overrun: true,
          message: `Budget Overrun Guard: Purchase amount (₹${totalBill.toLocaleString('en-IN')}) exceeds available School Requirements Budget (₹${remainingBudget.toLocaleString('en-IN')}) by ₹${deficit.toLocaleString('en-IN')}. Please request a Revised Budget grant in Settings before completing this purchase.`,
          data: {
            grandTotal: totalBill,
            remainingBudget,
            deficit,
            schoolRequirementsBudget: budgetCap,
            schoolRequirementsSpent: budgetSpent,
          },
        });
      }
    }

    // ─── SAVE INWARD PURCHASE BILL ──────────────────────────────────────────
    let purchaseRecord = null;
    const budgetDeduction = activeBudgetAllocation
      ? {
          budgetAllocationId: activeBudgetAllocation.id || activeBudgetAllocation._id,
          category: 'schoolRequirements',
          amount: totalBill,
          previousSpent: budgetSpent,
          newSpent: budgetSpent + totalBill,
        }
      : null;

    if (checkFallback()) {
      purchaseRecord = FallbackDb.create('inventoryPurchases', {
        billNumber: autoBillNo,
        poNumber: poNumber || '',
        vendorId,
        billDate: billDate || new Date().toISOString(),
        items,
        subtotal: Number(subtotal) || totalBill,
        taxAmount: Number(taxAmount) || 0,
        discountAmount: Number(discountAmount) || 0,
        grandTotal: totalBill,
        paymentType: paymentType || 'Bank Transfer',
        paymentStatus: paid >= totalBill ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid',
        amountPaid: paid,
        balanceDue: Math.max(0, totalBill - paid),
        transactionReference: transactionReference || '',
        budgetDeducted: budgetDeduction,
        receivedByName: req.user?.name || 'Admin',
        notes: notes || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Increment inventory stock & log transaction for each line item
      for (const lineItem of items) {
        const target = FallbackDb.findById('inventory', lineItem.itemId);
        if (target) {
          const newQty = target.quantity + Number(lineItem.quantity);
          FallbackDb.update('inventory', lineItem.itemId, {
            quantity: newQty,
            unitCost: Number(lineItem.unitCost) || target.unitCost,
            status: newQty > target.minStockLevel ? 'in-stock' : 'low-stock',
          });

          FallbackDb.create('inventoryTransactions', {
            transactionNumber: `TXN-IN-${Date.now().toString(36).toUpperCase()}-${lineItem.sku}`,
            timestamp: new Date().toISOString(),
            type: 'STOCK_IN_PURCHASE',
            itemId: lineItem.itemId,
            itemName: lineItem.name,
            sku: lineItem.sku,
            quantity: Number(lineItem.quantity),
            unit: lineItem.unit || target.unit,
            unitPrice: Number(lineItem.unitCost),
            totalValue: Number(lineItem.totalCost),
            referenceId: purchaseRecord.id,
            referenceDocNumber: autoBillNo,
            partyName: lineItem.vendorName || 'Vendor Supply',
            balanceAfter: newQty,
            performedByName: req.user?.name || 'Admin',
            reason: `Vendor Bill ${autoBillNo}`,
          });
        }
      }

      // Update Vendor ledger totals
      const vend = FallbackDb.findById('vendors', vendorId);
      if (vend) {
        const newBilled = (vend.totalBilled || 0) + totalBill;
        const newPaid = (vend.totalPaid || 0) + paid;
        FallbackDb.update('vendors', vendorId, {
          totalBilled: newBilled,
          totalPaid: newPaid,
          outstandingBalance: newBilled - newPaid,
        });
      }

      // Deduct from Budget Allocation
      if (activeBudgetAllocation) {
        FallbackDb.update('budgetAllocations', activeBudgetAllocation.id || activeBudgetAllocation._id, {
          schoolRequirementsSpent: budgetSpent + totalBill,
        });
      }
    } else {
      const p = new InventoryPurchase({
        billNumber: autoBillNo,
        poNumber: poNumber || '',
        vendorId,
        billDate: billDate || new Date(),
        items,
        subtotal: Number(subtotal) || totalBill,
        taxAmount: Number(taxAmount) || 0,
        discountAmount: Number(discountAmount) || 0,
        grandTotal: totalBill,
        paymentType: paymentType || 'Bank Transfer',
        paymentStatus: paid >= totalBill ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid',
        amountPaid: paid,
        balanceDue: Math.max(0, totalBill - paid),
        transactionReference: transactionReference || '',
        budgetDeducted: budgetDeduction,
        receivedBy: req.user?._id || req.user?.id,
        receivedByName: req.user?.name || 'Admin',
        notes: notes || '',
      });
      purchaseRecord = await p.save();

      // Increment inventory stock & log transaction
      for (const lineItem of items) {
        const item = await Inventory.findById(lineItem.itemId);
        if (item) {
          item.quantity += Number(lineItem.quantity);
          if (lineItem.unitCost) item.unitCost = Number(lineItem.unitCost);
          await item.save();

          await InventoryTransaction.create({
            transactionNumber: `TXN-IN-${Date.now().toString(36).toUpperCase()}-${item.sku}`,
            timestamp: new Date(),
            type: 'STOCK_IN_PURCHASE',
            itemId: item._id,
            itemName: item.name,
            sku: item.sku,
            quantity: Number(lineItem.quantity),
            unit: item.unit,
            unitPrice: Number(lineItem.unitCost),
            totalValue: Number(lineItem.totalCost),
            referenceId: purchaseRecord._id,
            referenceDocNumber: autoBillNo,
            partyName: lineItem.vendorName || 'Vendor Supply',
            balanceAfter: item.quantity,
            performedBy: req.user?._id || req.user?.id,
            performedByName: req.user?.name || 'Admin',
            reason: `Vendor Bill ${autoBillNo}`,
          });
        }
      }

      // Update Vendor ledger
      const vendor = await Vendor.findById(vendorId);
      if (vendor) {
        vendor.totalBilled = (vendor.totalBilled || 0) + totalBill;
        vendor.totalPaid = (vendor.totalPaid || 0) + paid;
        vendor.outstandingBalance = vendor.totalBilled - vendor.totalPaid;
        await vendor.save();
      }

      // Deduct from Budget Allocation
      if (activeBudgetAllocation) {
        activeBudgetAllocation.schoolRequirementsSpent = (activeBudgetAllocation.schoolRequirementsSpent || 0) + totalBill;
        await activeBudgetAllocation.save();
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CREATE',
      module: 'inventory',
      recordId: purchaseRecord.id || purchaseRecord._id,
      details: `Recorded purchase bill ${autoBillNo} for ₹${totalBill} (deducted from School Requirements Budget)`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { billNumber: autoBillNo, grandTotal: totalBill, vendorId, paymentType },
    });

    return sendCreated(res, 'Purchase bill recorded and stock successfully updated.', {
      purchase: purchaseRecord,
    });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves paginated inward purchase bills.
 */
export const getPurchases = async (req, res) => {
  try {
    const { page, limit, skip, sort, search, status } = parsePagination(req.query);
    const vendorId = req.query.vendorId;

    if (checkFallback()) {
      let list = FallbackDb.find('inventoryPurchases') || [];
      if (vendorId) list = list.filter((p) => String(p.vendorId) === String(vendorId));
      if (status && status !== 'All') list = list.filter((p) => p.paymentStatus === status);
      if (search) {
        const term = search.toLowerCase();
        list = list.filter(
          (p) =>
            String(p.billNumber || '').toLowerCase().includes(term) ||
            String(p.poNumber || '').toLowerCase().includes(term)
        );
      }
      const total = list.length;
      const data = list.slice(skip, skip + limit);
      return sendSuccess(res, undefined, { purchases: data, ...paginateResult(data, total, { page, limit }) });
    }

    const filter = {};
    if (vendorId) filter.vendorId = vendorId;
    if (status && status !== 'All') filter.paymentStatus = status;
    if (search) {
      filter.$or = [
        { billNumber: { $regex: search, $options: 'i' } },
        { poNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const sortObj = {};
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith('-') ? -1 : 1;

    const [purchases, total] = await Promise.all([
      InventoryPurchase.find(filter).populate('vendorId').sort(sortObj).skip(skip).limit(limit),
      InventoryPurchase.countDocuments(filter),
    ]);

    return sendSuccess(res, undefined, { purchases, ...paginateResult(purchases, total, { page, limit }) });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Creates Outward Stock Requisition & Class-Wise Issuance (Buyer Flow)
 * Checks live stock balance before distribution!
 */
export const createIssuance = async (req, res) => {
  try {
    const {
      recipientType,
      classId,
      className,
      studentId,
      studentName,
      studentRollNo,
      teacherId,
      teacherName,
      department,
      issuanceDate,
      items,
      billingType,
      purpose,
      acknowledgedBy,
      notes,
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return sendBadRequest(res, 'At least one item must be selected for issuance.');
    }

    // ─── STOCK AVAILABILITY CHECK ───────────────────────────────────────────
    for (const line of items) {
      let currentItem = null;
      if (checkFallback()) {
        currentItem = FallbackDb.findById('inventory', line.itemId);
      } else {
        currentItem = await Inventory.findById(line.itemId);
      }

      if (!currentItem) {
        return sendBadRequest(res, `Item "${line.name}" not found in inventory.`);
      }

      const reqQty = Number(line.quantity) || 0;
      if (reqQty <= 0) {
        return sendBadRequest(res, `Requested quantity for "${currentItem.name}" must be greater than zero.`);
      }

      if (currentItem.quantity < reqQty) {
        return sendBadRequest(
          res,
          `Insufficient stock for "${currentItem.name}". Requested: ${reqQty} ${currentItem.unit}, Available: ${currentItem.quantity} ${currentItem.unit}.`
        );
      }
    }

    const autoIssuanceNo = `ISS-${Date.now().toString(36).toUpperCase()}`;
    const totalAmount = items.reduce((s, it) => s + (Number(it.totalAmount) || (Number(it.quantity) * Number(it.unitPrice || 0))), 0);

    let recipientParty = className || studentName || teacherName || department || 'Class Requisition';

    let issuanceRecord = null;

    if (checkFallback()) {
      issuanceRecord = FallbackDb.create('inventoryIssuances', {
        issuanceNumber: autoIssuanceNo,
        recipientType: recipientType || 'class',
        classId: classId || null,
        className: className || '',
        studentId: studentId || null,
        studentName: studentName || '',
        studentRollNo: studentRollNo || '',
        teacherId: teacherId || null,
        teacherName: teacherName || '',
        department: department || '',
        issuedByName: req.user?.name || 'Store In-Charge',
        issuanceDate: issuanceDate || new Date().toISOString(),
        items,
        totalAmount,
        billingType: billingType || 'complimentary',
        purpose: purpose || '',
        status: 'issued',
        acknowledgedBy: acknowledgedBy || recipientParty,
        notes: notes || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Decrement stock & log transaction
      for (const line of items) {
        const target = FallbackDb.findById('inventory', line.itemId);
        if (target) {
          const newQty = Math.max(0, target.quantity - Number(line.quantity));
          FallbackDb.update('inventory', line.itemId, {
            quantity: newQty,
            status: newQty <= 0 ? 'out-of-stock' : newQty <= target.minStockLevel ? 'low-stock' : 'in-stock',
          });

          FallbackDb.create('inventoryTransactions', {
            transactionNumber: `TXN-OUT-${Date.now().toString(36).toUpperCase()}-${line.sku}`,
            timestamp: new Date().toISOString(),
            type:
              recipientType === 'student'
                ? 'STOCK_OUT_STUDENT'
                : recipientType === 'teacher'
                ? 'STOCK_OUT_TEACHER'
                : 'STOCK_OUT_CLASS',
            itemId: line.itemId,
            itemName: line.name,
            sku: line.sku,
            quantity: -Number(line.quantity),
            unit: line.unit || target.unit,
            unitPrice: Number(line.unitPrice) || target.price,
            totalValue: Number(line.quantity) * (Number(line.unitPrice) || target.price),
            referenceId: issuanceRecord.id,
            referenceDocNumber: autoIssuanceNo,
            partyName: recipientParty,
            balanceAfter: newQty,
            performedByName: req.user?.name || 'Admin',
            reason: purpose || `Class-Wise Distribution to ${recipientParty}`,
          });
        }
      }
    } else {
      const iss = new InventoryIssuance({
        issuanceNumber: autoIssuanceNo,
        recipientType: recipientType || 'class',
        classId: classId || null,
        className: className || '',
        studentId: studentId || null,
        studentName: studentName || '',
        studentRollNo: studentRollNo || '',
        teacherId: teacherId || null,
        teacherName: teacherName || '',
        department: department || '',
        issuedBy: req.user?._id || req.user?.id,
        issuedByName: req.user?.name || 'Store In-Charge',
        issuanceDate: issuanceDate || new Date(),
        items,
        totalAmount,
        billingType: billingType || 'complimentary',
        purpose: purpose || '',
        status: 'issued',
        acknowledgedBy: acknowledgedBy || recipientParty,
        notes: notes || '',
      });
      issuanceRecord = await iss.save();

      // Decrement stock & log transaction
      for (const line of items) {
        const item = await Inventory.findById(line.itemId);
        if (item) {
          item.quantity = Math.max(0, item.quantity - Number(line.quantity));
          await item.save();

          await InventoryTransaction.create({
            transactionNumber: `TXN-OUT-${Date.now().toString(36).toUpperCase()}-${item.sku}`,
            timestamp: new Date(),
            type:
              recipientType === 'student'
                ? 'STOCK_OUT_STUDENT'
                : recipientType === 'teacher'
                ? 'STOCK_OUT_TEACHER'
                : 'STOCK_OUT_CLASS',
            itemId: item._id,
            itemName: item.name,
            sku: item.sku,
            quantity: -Number(line.quantity),
            unit: item.unit,
            unitPrice: Number(line.unitPrice) || item.price,
            totalValue: Number(line.quantity) * (Number(line.unitPrice) || item.price),
            referenceId: issuanceRecord._id,
            referenceDocNumber: autoIssuanceNo,
            partyName: recipientParty,
            balanceAfter: item.quantity,
            performedBy: req.user?._id || req.user?.id,
            performedByName: req.user?.name || 'Admin',
            reason: purpose || `Class-Wise Distribution to ${recipientParty}`,
          });
        }
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CREATE',
      module: 'inventory',
      recordId: issuanceRecord.id || issuanceRecord._id,
      details: `Issued inventory voucher ${autoIssuanceNo} to ${recipientParty} (${billingType})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { issuanceNumber: autoIssuanceNo, recipientParty, billingType, totalAmount },
    });

    return sendCreated(res, 'Materials issued successfully and stock balance updated.', {
      issuance: issuanceRecord,
    });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves paginated outward material issuances.
 */
export const getIssuances = async (req, res) => {
  try {
    const { page, limit, skip, sort, search, status } = parsePagination(req.query);
    const recipientType = req.query.recipientType;
    const classId = req.query.classId;

    if (checkFallback()) {
      let list = FallbackDb.find('inventoryIssuances') || [];
      if (recipientType && recipientType !== 'All') list = list.filter((i) => i.recipientType === recipientType);
      if (classId) list = list.filter((i) => String(i.classId) === String(classId));
      if (status && status !== 'All') list = list.filter((i) => i.status === status);
      if (search) {
        const term = search.toLowerCase();
        list = list.filter(
          (i) =>
            String(i.issuanceNumber || '').toLowerCase().includes(term) ||
            String(i.className || '').toLowerCase().includes(term) ||
            String(i.studentName || '').toLowerCase().includes(term) ||
            String(i.teacherName || '').toLowerCase().includes(term) ||
            String(i.purpose || '').toLowerCase().includes(term)
        );
      }
      const total = list.length;
      const data = list.slice(skip, skip + limit);
      return sendSuccess(res, undefined, { issuances: data, ...paginateResult(data, total, { page, limit }) });
    }

    const filter = {};
    if (recipientType && recipientType !== 'All') filter.recipientType = recipientType;
    if (classId) filter.classId = classId;
    if (status && status !== 'All') filter.status = status;
    if (search) {
      filter.$or = [
        { issuanceNumber: { $regex: search, $options: 'i' } },
        { className: { $regex: search, $options: 'i' } },
        { studentName: { $regex: search, $options: 'i' } },
        { teacherName: { $regex: search, $options: 'i' } },
        { purpose: { $regex: search, $options: 'i' } },
      ];
    }

    const sortObj = {};
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith('-') ? -1 : 1;

    const [issuances, total] = await Promise.all([
      InventoryIssuance.find(filter).sort(sortObj).skip(skip).limit(limit),
      InventoryIssuance.countDocuments(filter),
    ]);

    return sendSuccess(res, undefined, { issuances, ...paginateResult(issuances, total, { page, limit }) });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves the complete chronological audit ledger of stock movements.
 */
export const getTransactions = async (req, res) => {
  try {
    const { page, limit, skip, sort, search, status } = parsePagination(req.query);
    const type = req.query.type;

    if (checkFallback()) {
      let list = FallbackDb.find('inventoryTransactions') || [];
      if (type && type !== 'All') list = list.filter((t) => t.type === type);
      if (search) {
        const term = search.toLowerCase();
        list = list.filter(
          (t) =>
            String(t.itemName || '').toLowerCase().includes(term) ||
            String(t.sku || '').toLowerCase().includes(term) ||
            String(t.partyName || '').toLowerCase().includes(term) ||
            String(t.referenceDocNumber || '').toLowerCase().includes(term)
        );
      }
      list.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      const total = list.length;
      const data = list.slice(skip, skip + limit);
      return sendSuccess(res, undefined, { transactions: data, ...paginateResult(data, total, { page, limit }) });
    }

    const filter = {};
    if (type && type !== 'All') filter.type = type;
    if (search) {
      filter.$or = [
        { itemName: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { partyName: { $regex: search, $options: 'i' } },
        { referenceDocNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const [transactions, total] = await Promise.all([
      InventoryTransaction.find(filter).sort({ timestamp: -1 }).skip(skip).limit(limit),
      InventoryTransaction.countDocuments(filter),
    ]);

    return sendSuccess(res, undefined, { transactions, ...paginateResult(transactions, total, { page, limit }) });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves items running below minimum stock threshold.
 */
export const getAlerts = async (req, res) => {
  try {
    let alertItems = [];
    if (checkFallback()) {
      const all = (FallbackDb.find('inventory') || []).map(enrichItem);
      alertItems = all.filter((item) => item.quantity <= item.minStockLevel);
    } else {
      alertItems = await Inventory.find({
        $expr: { $lte: ['$quantity', '$minStockLevel'] },
      }).populate('vendorId');
    }

    return sendSuccess(res, undefined, { count: alertItems.length, alerts: alertItems });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves audit activity logs for an inventory item.
 */
export const getInventoryActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await getRecordActivity('inventory', id);
    return sendSuccess(res, undefined, { logs, loginHistory: [] });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Backward compatibility: getVendors
 */
export const getVendors = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('vendors') || [];
    } else {
      list = await Vendor.find().sort({ name: 1 });
    }
    return sendSuccess(res, undefined, { count: list.length, vendors: list });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Backward compatibility: createVendor
 */
export const createVendor = async (req, res) => {
  try {
    const data = req.body;
    if (!data.name || !String(data.name).trim()) {
      return sendBadRequest(res, 'Company / Vendor name is required.');
    }
    let newRecord = null;
    if (checkFallback()) {
      const existing = FallbackDb.find('vendors') || [];
      const code = data.vendorCode || `VND-${String(existing.length + 1).padStart(3, '0')}`;
      newRecord = FallbackDb.create('vendors', {
        ...data,
        name: String(data.name).trim(),
        category: data.category || 'General',
        vendorCode: code,
        phone: data.phone || '',
        email: data.email || '',
      });
    } else {
      data.category = data.category || 'General';
      const vendor = new Vendor(data);
      newRecord = await vendor.save();
    }
    return sendCreated(res, 'Vendor added successfully', { vendor: newRecord });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};
