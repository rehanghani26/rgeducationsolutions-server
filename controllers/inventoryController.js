import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStockItems, moveStock, removeStockItem, updateStockItem } from '../services/inventoryStockService.js';
import { getSchool, readProcurement } from '../services/procurementStore.js';
import { postPurchase } from '../services/purchaseService.js';
import { getRecordActivity, logActivity } from '../utils/activityLogger.js';
import {
  activeSession,
  budgetAmounts,
  inventoryUnitCost,
  inventoryValue,
  legacyBundle,
  procurementError,
  recordId,
  recordIds,
  roundMoney,
  roundQuantity,
  sendProcurementError,
  sessionBudget,
  sessionById,
  stockStatus,
} from '../utils/procurementValues.js';
import { sendBadRequest, sendCreated, sendError, sendSuccess } from '../utils/responseUtil.js';

const INVENTORY_UPLOAD_DIR = fileURLToPath(new URL('../uploads/inventory/', import.meta.url));

const inventoryFields = ['name', 'sku', 'category', 'location', 'brand', 'barcode', 'storageBin'];
const statuses = ['in-stock', 'low-stock', 'out-of-stock', 'discontinued'];
const byDate = (field) => (a, b) => new Date(b[field]) - new Date(a[field]);

async function requireItem(store, id) {
  const item = await store.get('inventory', id);
  if (!item) throw procurementError('Item not found.', 404);
  return item;
}

function vendorSummary(vendor) {
  if (!vendor) return undefined;
  const { name, contactPerson, phone, email, category, vendorCode, status } = vendor;
  return { _id: recordId(vendor), name, contactPerson, phone, email, category, vendorCode, status };
}

async function inventoryView(store, items) {
  const vendors = await store.byIds('vendors', items.map((item) => item.vendorId).filter(Boolean));
  const byId = new Map(vendors.flatMap((vendor) => [
    [String(recordId(vendor)), vendorSummary(vendor)],
    ...(vendor.id ? [[String(vendor.id), vendorSummary(vendor)]] : []),
  ]));
  return items.map((item) => {
    const vendor = byId.get(String(item.vendorId));
    return {
      ...item,
      vendorId: vendor || item.vendorId,
      status: stockStatus(item),
      unitCost: roundMoney(inventoryUnitCost(item)),
      stockValue: inventoryValue(item),
      legacyBundle: legacyBundle(item),
    };
  });
}

function inventoryFilter(status) {
  if (status === 'discontinued') return { status };
  if (!statuses.includes(status)) return {};
  const filter = { status: { $ne: 'discontinued' } };
  if (status === 'out-of-stock') return { ...filter, quantity: { $lte: 0 } };
  const minimum = { $ifNull: ['$minStockLevel', 5] };
  if (status === 'low-stock') return { ...filter, quantity: { $gt: 0 }, $expr: { $lte: ['$quantity', minimum] } };
  return { ...filter, quantity: { $gt: 0 }, $expr: { $gt: ['$quantity', minimum] } };
}

function inventoryAudit(req, item, action, details, metadata) {
  return logActivity({
    schoolId: getSchool(req),
    userId: req.user?._id || req.user?.id,
    action,
    module: 'inventory',
    recordId: recordId(item),
    details,
    ipAddress: req.ip,
    userAgent: req.headers?.['user-agent'],
    metadata,
  });
}

export async function getInventory(req, res) {
  try {
    const store = readProcurement(req);
    const { status, category, available } = req.query;
    const match = typeof category === 'string' && category && category !== 'All' ? { category } : {};
    const availableOnly = available === 'true';
    const page = await store.page('inventory', req.query, {
      match,
      searchFields: inventoryFields,
      extraFilter: availableOnly ? { status: { $ne: 'discontinued' }, 'items.1': { $exists: false } } : inventoryFilter(status),
      predicate: availableOnly
        ? (item) => stockStatus(item) !== 'discontinued' && !legacyBundle(item)
        : (item) => !statuses.includes(status) || stockStatus(item) === status,
      sortFields: ['createdAt', 'name', 'sku', 'quantity'],
    });
    const inventory = await inventoryView(store, page.data);
    return sendSuccess(res, undefined, { ...page, data: inventory, inventory });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function getInventoryById(req, res) {
  try {
    const store = readProcurement(req);
    const stock = await requireItem(store, req.params.id);
    const itemId = recordId(stock);
    const itemIds = recordIds(stock);
    const [items, movements, bills, distributions] = await Promise.all([
      inventoryView(store, [stock]),
      store.page('inventoryTransactions', { limit: 50, sort: '-timestamp' }, {
        match: { itemId }, sortFields: ['timestamp'],
      }),
      store.containingItem('inventoryPurchases', itemId),
      store.containingItem('inventoryIssuances', itemId),
    ]);
    const [item] = items;
    const purchases = bills.sort(byDate('billDate'));
    const issuances = distributions.sort(byDate('issuanceDate'));
    const lineQuantity = (entry) => (entry.items || []).reduce((sum, line) =>
      itemIds.includes(String(line.itemId)) ? sum + Number(line.quantity || 0) : sum, 0);
    const monthlyUsage = new Map();
    const monthFormat = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });
    for (const issuance of [...issuances].reverse()) {
      const date = new Date(issuance.issuanceDate);
      if (!Number.isFinite(date.getTime())) continue;
      const month = monthFormat.format(date);
      monthlyUsage.set(month, roundQuantity((monthlyUsage.get(month) || 0) + lineQuantity(issuance)));
    }
    return sendSuccess(res, undefined, {
      item,
      transactions: movements.data,
      purchases,
      issuances,
      kpis: {
        currentStock: item.quantity,
        unit: item.unit,
        minStockLevel: item.minStockLevel,
        unitCost: item.unitCost,
        price: item.price,
        currentValuation: item.stockValue,
        totalProcuredQty: roundQuantity(purchases.reduce((sum, bill) => sum + lineQuantity(bill), 0)),
        totalIssuedQty: roundQuantity(issuances.reduce((sum, issuance) => sum + lineQuantity(issuance), 0)),
      },
      consumptionTrend: Array.from(monthlyUsage, ([month, quantity]) => ({ month, quantity })),
    });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function createInventoryItem(req, res) {
  try {
    const [item] = await createStockItems(req, [req.body]);
    await inventoryAudit(req, item, 'CREATE', 'Created item ' + item.sku);
    return sendCreated(res, 'Inventory item created.', { item });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function createBulkInventoryItems(req, res) {
  try {
    const { items, vendorId, invoiceAttachment, additionalAttachments, expectedDeliveryDate, actualPurchaseDate } = req.body || {};
    if (!Array.isArray(items)) throw procurementError('Enter the items to add to the catalog.');
    const created = await createStockItems(req, items.map((item) => ({
      vendorId, invoiceAttachment, additionalAttachments, expectedDeliveryDate, actualPurchaseDate, ...item,
    })));
    await inventoryAudit(req, created[0], 'CREATE', 'Added ' + created.length + ' catalog item(s)', {
      items: created.map((item) => ({ id: recordId(item), sku: item.sku })),
    });
    return sendCreated(res, created.length + ' catalog item(s) created.', { item: created[0], items: created, count: created.length });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function updateInventoryItem(req, res) {
  try {
    const item = await updateStockItem(req);
    await inventoryAudit(req, item, 'UPDATE', 'Updated item ' + item.sku);
    return sendSuccess(res, 'Inventory item saved.', { item });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function deleteInventoryItem(req, res) {
  try {
    const result = await removeStockItem(req);
    await inventoryAudit(req, { _id: req.params.id }, result.discontinued ? 'UPDATE' : 'DELETE', result.discontinued ? 'Discontinued item' : 'Removed item');
    return sendSuccess(res, result.discontinued ? 'Item discontinued. Stock history is available.' : 'Item removed.', result);
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function adjustStock(req, res) {
  try {
    const result = await moveStock(req);
    if (!result.alreadyRecorded) {
      await inventoryAudit(req, result.item, 'UPDATE', 'Adjusted stock for ' + result.item.sku, {
        previousQty: result.previousQty, newQty: result.newQty,
      });
    }
    return sendSuccess(res, 'Stock adjusted.', result);
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function getInventorySummary(req, res) {
  try {
    const store = readProcurement(req);
    const session = req.query.sessionId ? await sessionById(store, req.query.sessionId) : await activeSession(store);
    const [items, budget] = await Promise.all([store.find('inventory'), sessionBudget(store, session)]);
    const budgetHealth = budget
      ? { sessionId: recordId(session), sessionName: session.sessionName, allocationStatus: budget.status, ...budgetAmounts(budget) }
      : null;
    return sendSuccess(res, undefined, {
      totalItems: items.length,
      totalStockCount: roundQuantity(items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)),
      totalStockValue: roundMoney(items.reduce((sum, item) => sum + inventoryValue(item), 0)),
      lowStockCount: items.filter((item) => stockStatus(item) === 'low-stock').length,
      outOfStockCount: items.filter((item) => stockStatus(item) === 'out-of-stock').length,
      discontinuedCount: items.filter((item) => item.status === 'discontinued').length,
      session: session ? { _id: recordId(session), sessionName: session.sessionName } : null,
      budgetHealth,
    });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function createPurchase(req, res) {
  try {
    const purchase = await postPurchase(req);
    return sendCreated(res, 'Purchase recorded and stock updated.', { purchase });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function getPurchases(req, res) {
  try {
    const store = readProcurement(req);
    const { vendorId, sessionId, status } = req.query;
    const match = {};
    if (typeof vendorId === 'string' && vendorId) {
      const vendor = await store.get('vendors', vendorId);
      if (!vendor) throw procurementError('Vendor not found.', 404);
      match.vendorId = recordId(vendor);
    }
    if (typeof sessionId === 'string' && sessionId) match.sessionId = recordId(await sessionById(store, sessionId));
    if (['Paid', 'Partial', 'Unpaid'].includes(status)) match.paymentStatus = status;
    const page = await store.page('inventoryPurchases', { ...req.query, sort: req.query.sort || '-billDate' }, {
      match,
      sortFields: ['billDate', 'receivedDate', 'dueDate', 'grandTotal'],
      searchFields: ['billNumber', 'supplierBillNumber', 'poNumber', 'vendorName', 'sessionName'],
    });
    const missingVendorNames = page.data.filter((bill) => !bill.vendorName).map((bill) => bill.vendorId);
    const vendors = await store.byIds('vendors', missingVendorNames);
    const names = new Map(vendors.map((vendor) => [String(recordId(vendor)), vendor.name]));
    const purchases = page.data.map((bill) => ({ ...bill, vendorName: bill.vendorName || names.get(String(bill.vendorId)) }));
    return sendSuccess(res, undefined, { ...page, data: purchases, purchases });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function getTransactions(req, res) {
  try {
    const type = req.query.type;
    const match = typeof type === 'string' && type && type !== 'All' ? { type } : {};
    const page = await readProcurement(req).page('inventoryTransactions', { ...req.query, sort: '-timestamp' }, {
      match,
      sortFields: ['timestamp'],
      searchFields: ['itemName', 'sku', 'partyName', 'referenceDocNumber', 'reason', 'transactionNumber'],
    });
    return sendSuccess(res, undefined, { ...page, transactions: page.data });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function getAlerts(req, res) {
  try {
    const store = readProcurement(req);
    const items = await store.find('inventory');
    const alerts = await inventoryView(store, items.filter((item) => ['low-stock', 'out-of-stock'].includes(stockStatus(item))));
    return sendSuccess(res, undefined, { count: alerts.length, alerts });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

export async function getInventoryActivity(req, res) {
  try {
    const item = await requireItem(readProcurement(req), req.params.id);
    const logs = await getRecordActivity('inventory', recordId(item));
    return sendSuccess(res, undefined, { logs, loginHistory: [] });
  } catch (error) {
    return sendProcurementError(res, error);
  }
}

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
