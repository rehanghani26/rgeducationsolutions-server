import Inventory from '../models/Inventory.js';
import { getSchool, writeProcurement } from './procurementStore.js';
import {
  actor,
  cleanText,
  dateValue,
  generatedCode,
  inventoryUnitCost,
  legacyBundle,
  numeric,
  optionalCode,
  procurementError,
  recordId,
  requestHash,
  roundMoney,
  roundQuantity,
  stockStatus,
} from '../utils/procurementValues.js';

const stockCollections = ['inventory', 'inventoryTransactions', 'vendors'];
const stockFields = ['quantity', 'minStockLevel', 'maxStockLevel', 'reorderQuantity'];
const stockDefaults = { quantity: 0, minStockLevel: 5, maxStockLevel: 1000, reorderQuantity: 20 };
const stockLabels = {
  quantity: 'Stock quantity', minStockLevel: 'Minimum stock', maxStockLevel: 'Maximum stock', reorderQuantity: 'Reorder quantity',
};

function attachment(file) {
  if (!file || typeof file !== 'object' || !file.url) return null;
  return {
    filename: cleanText(file.filename),
    originalName: cleanText(file.originalName),
    url: cleanText(file.url),
    mimeType: cleanText(file.mimeType),
    size: numeric(file.size, 'Attachment size'),
  };
}

export function catalogFields(input, existing) {
  const result = {};
  for (const field of ['name', 'description', 'subcategory', 'imageUrl', 'brand', 'barcode', 'storageBin', 'location', 'unit']) {
    if (Object.hasOwn(input, field)) result[field] = cleanText(input[field]);
  }
  if (!(result.name ?? existing?.name)) throw procurementError('Enter an item name.');
  if (!existing && input.catalogId != null) {
    const catalogId = cleanText(input.catalogId).toLowerCase();
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(catalogId)) throw procurementError('Select a valid catalog product.');
    result.catalogId = catalogId;
  }
  if (!existing || Object.hasOwn(input, 'sku')) result.sku = optionalCode(input.sku) || existing?.sku || generatedCode('SKU');
  if (!existing || Object.hasOwn(input, 'category')) {
    const category = cleanText(input.category) || 'General';
    if (category !== existing?.category && !Inventory.schema.path('category').enumValues.includes(category)) {
      throw procurementError('Select a valid item category.');
    }
    result.category = category;
  }
  if (!existing || Object.hasOwn(input, 'location')) result.location ||= 'Main Store';
  if (!existing || Object.hasOwn(input, 'unit')) result.unit ||= 'pcs';

  for (const field of stockFields) {
    if (!existing || Object.hasOwn(input, field)) {
      result[field] = numeric(input[field], stockLabels[field], {
        fallback: existing?.[field] ?? stockDefaults[field],
        round: roundQuantity,
      });
    }
  }
  if ((result.maxStockLevel ?? existing?.maxStockLevel ?? 1000) < (result.minStockLevel ?? existing?.minStockLevel ?? 5) &&
      (!existing || Object.hasOwn(input, 'maxStockLevel') || Object.hasOwn(input, 'minStockLevel'))) {
    throw procurementError('Maximum stock must be at least the minimum stock.');
  }

  if (!existing || Object.hasOwn(input, 'unitCost') || Object.hasOwn(input, 'price')) {
    const unitCost = numeric(input.unitCost ?? input.price, 'Unit cost', {
      fallback: existing ? inventoryUnitCost(existing) : 0,
    });
    result.unitCost = unitCost;
    result.price = unitCost;
    result.unitCostVerified = true;
  }
  if (!existing || Object.hasOwn(input, 'gstRate')) result.gstRate = numeric(input.gstRate, 'GST rate', { max: 100 });
  for (const [field, label] of [['expectedDeliveryDate', 'Expected delivery'], ['actualPurchaseDate', 'Purchase date']]) {
    if (Object.hasOwn(input, field)) result[field] = dateValue(input[field], label);
  }
  if (Object.hasOwn(input, 'invoiceAttachment')) result.invoiceAttachment = attachment(input.invoiceAttachment);
  if (Object.hasOwn(input, 'additionalAttachments')) {
    result.additionalAttachments = (Array.isArray(input.additionalAttachments) ? input.additionalAttachments : [])
      .slice(0, 10).map(attachment).filter(Boolean);
  }
  if (Object.hasOwn(input, 'vendorId')) result.vendorId = input.vendorId || null;

  const current = { ...existing, ...result };
  if (input.status === 'discontinued' || input.discontinued === true) current.status = 'discontinued';
  else if (input.discontinued === false || input.status === 'in-stock') current.status = undefined;
  result.status = stockStatus(current);
  if (!existing || Object.hasOwn(result, 'quantity')) result.totalQuantity = result.quantity;
  return result;
}

export async function findCatalogItem(store, fields) {
  if (!fields.catalogId) return null;
  const linked = await store.one('inventory', { catalogId: fields.catalogId });
  if (linked) return linked;
  const matches = (await store.find('inventory', { name: fields.name, category: fields.category, unit: fields.unit }))
    .filter((item) => !item.catalogId && !legacyBundle(item));
  if (matches.length > 1) {
    throw procurementError('More than one stock item matches ' + fields.name + '. Select its existing SKU.', 409);
  }
  return matches[0] || null;
}

export async function recordMovement(store, item, req, details) {
  const performedBy = actor(req);
  const unitPrice = details.unitPrice ?? inventoryUnitCost(item);
  return store.create('inventoryTransactions', {
    transactionNumber: generatedCode('TXN'),
    timestamp: new Date().toISOString(),
    itemId: recordId(item),
    itemName: item.name,
    sku: item.sku,
    unit: item.unit,
    balanceAfter: item.quantity,
    performedBy: performedBy.id,
    performedByName: performedBy.name,
    ...details,
    unitPrice,
    totalValue: roundMoney(Math.abs(details.quantity) * unitPrice),
  });
}

async function verifyProfile(store, fields, item) {
  if (fields.sku && fields.sku !== item?.sku && await store.one('inventory', { sku: fields.sku })) {
    throw procurementError('SKU ' + fields.sku + ' already exists.', 409);
  }
  if (fields.vendorId && String(fields.vendorId) !== String(item?.vendorId)) {
    const vendor = await store.get('vendors', fields.vendorId);
    if (!vendor) throw procurementError('Preferred vendor not found.', 404);
    if (vendor.status && vendor.status !== 'active') throw procurementError('Select an active preferred vendor.');
    fields.vendorId = recordId(vendor);
  }
}

export async function createStockItems(req, inputs) {
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100) {
    throw procurementError('Enter between 1 and 100 catalog items.');
  }
  const records = inputs.map((input) => catalogFields(input || {}));
  if (new Set(records.map((record) => record.sku)).size !== records.length) {
    throw procurementError('Each item in the batch must have its own SKU.');
  }

  return writeProcurement(req, stockCollections, async (store) => {
    const items = [];
    for (const fields of records) {
      if (await findCatalogItem(store, fields)) {
        throw procurementError(fields.name + ' is already in Stocks. Use Adjust stock to correct its quantity.', 409);
      }
      await verifyProfile(store, fields);
      const item = await store.create('inventory', fields);
      if (item.quantity > 0) {
        await recordMovement(store, item, req, {
          type: 'STOCK_OPENING',
          quantity: item.quantity,
          partyName: fields.vendorId ? (await store.get('vendors', fields.vendorId))?.name : undefined,
          reason: 'Opening stock',
        });
      }
      items.push(item);
    }
    return items;
  }, { atomic: records.length > 1 || records[0].quantity > 0 });
}

export async function updateStockItem(req) {
  const input = req.body || {};
  return writeProcurement(req, stockCollections, async (store) => {
    const existing = await store.get('inventory', req.params.id);
    if (!existing) throw procurementError('Item not found.', 404);
    const fields = catalogFields(input, existing);
    await verifyProfile(store, fields, existing);
    const item = await store.update('inventory', recordId(existing), fields);
    const difference = roundQuantity(Number(item.quantity) - Number(existing.quantity));
    if (difference) {
      await recordMovement(store, item, req, {
        type: difference > 0 ? 'STOCK_ADJUST_ADD' : 'STOCK_ADJUST_REMOVE',
        quantity: difference,
        reason: cleanText(input.reason) || 'Stock corrected from item editor',
      });
    }
    return item;
  });
}

export async function removeStockItem(req) {
  return writeProcurement(req, ['inventory', 'inventoryTransactions', 'inventoryPurchases', 'inventoryIssuances'], async (store) => {
    const item = await store.get('inventory', req.params.id);
    if (!item) throw procurementError('Item not found.', 404);
    const id = recordId(item);
    const hasHistory = item.quantity > 0 || await store.one('inventoryTransactions', { itemId: id }) ||
      (await store.containingItem('inventoryPurchases', id)).length ||
      (await store.containingItem('inventoryIssuances', id)).length;
    if (hasHistory) {
      await store.update('inventory', id, { status: 'discontinued' });
      return { discontinued: true };
    }
    await store.remove('inventory', id);
    return { discontinued: false };
  });
}

export async function moveStock(req) {
  const input = req.body || {};
  const directions = { in: 'in', out: 'out', STOCK_ADJUST_ADD: 'in', STOCK_ADJUST_REMOVE: 'out', STOCK_ADJUST_SUB: 'out' };
  if (!Object.hasOwn(directions, input.type)) throw procurementError('Select whether to add or remove stock.');
  const direction = directions[input.type];
  const amount = numeric(input.quantity, 'Adjustment quantity', { min: 0.001, round: roundQuantity });
  if (!amount) throw procurementError('Enter an adjustment quantity.');
  const change = direction === 'in' ? amount : -amount;
  const reasons = [cleanText(input.reason), cleanText(input.notes)].filter(Boolean);
  const reason = reasons.join(' · ') || 'Manual stock adjustment';
  const requestId = cleanText(input.requestId);
  return writeProcurement(req, stockCollections, async (store) => {
    const item = await store.get('inventory', input.itemId);
    if (!item) throw procurementError('Item not found.', 404);
    const itemId = recordId(item);
    const transactionNumber = requestId ? 'TXN-ADJ-' + requestHash([getSchool(req), String(itemId), requestId]).slice(0, 24) : null;
    if (transactionNumber) {
      const prior = await store.one('inventoryTransactions', { transactionNumber });
      if (prior) {
        if (prior.quantity !== change || prior.reason !== reason) {
          throw procurementError('This adjustment was already recorded. Refresh stock before entering another adjustment.', 409);
        }
        return { item, previousQty: roundQuantity(prior.balanceAfter - change), newQty: prior.balanceAfter, transaction: prior, alreadyRecorded: true };
      }
    }
    const previousQty = Number(item.quantity);
    const quantity = roundQuantity(previousQty + change);
    if (quantity < 0) {
      throw procurementError('Only ' + previousQty + ' ' + item.unit + ' available to remove.', 409);
    }
    if (direction === 'in' && item.status === 'discontinued') {
      throw procurementError('Reactivate this item before adding stock.', 409);
    }
    const updatedItem = await store.update('inventory', itemId, {
      quantity,
      ...(!item.items?.length ? { totalQuantity: quantity } : {}),
      status: stockStatus({ ...item, quantity }),
    });
    const transaction = await recordMovement(store, updatedItem, req, {
      ...(transactionNumber ? { transactionNumber } : {}),
      type: direction === 'in' ? 'STOCK_ADJUST_ADD' : 'STOCK_ADJUST_REMOVE',
      quantity: change,
      reason,
    });
    return { item: updatedItem, previousQty, newQty: quantity, transaction };
  });
}
