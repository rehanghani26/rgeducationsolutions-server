/**
 * @file inventory.tools.js
 * @description AI Tool definitions and executors for the Inventory module.
 */

import Inventory from '../../models/Inventory.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';
import { logActivity } from '../../utils/activityLogger.js';

export const inventoryToolDefinitions = [
  {
    name: 'getInventory',
    description:
      'List inventory items. Use for "show inventory", "what items do we have?", "low stock items".',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search by item name or SKU.' },
        category: {
          type: 'string',
          description:
            'Filter by category: "Books", "Computers", "Lab Equipment", "Furniture", "Sports Items", "Stationery", "Uniforms", "Electronics".',
        },
        lowStockOnly: {
          type: 'boolean',
          description: 'If true, show only items below minimum stock level.',
        },
        limit: { type: 'number', description: 'Max records (default 20).' },
      },
    },
  },
  {
    name: 'createInventoryItem',
    description:
      'Add a new item to inventory. Name, category, quantity, and price are required.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Item name (required).' },
        category: {
          type: 'string',
          description:
            'Category (required): "Books", "Computers", "Lab Equipment", "Furniture", "Sports Items", "Stationery", "Uniforms", "Electronics".',
        },
        quantity: { type: 'number', description: 'Initial quantity (required).' },
        price: { type: 'number', description: 'Price per unit (required).' },
        unit: { type: 'string', description: 'Unit of measurement e.g. "pcs", "kg", "sets". Default: "pcs".' },
        minStockLevel: { type: 'number', description: 'Minimum stock threshold. Default: 5.' },
      },
      required: ['name', 'category', 'quantity', 'price'],
    },
  },
];

const VALID_CATEGORIES = ['Books', 'Computers', 'Lab Equipment', 'Furniture', 'Sports Items', 'Stationery', 'Uniforms', 'Electronics'];

export const inventoryToolExecutors = {
  async getInventory(args, context) {
    const limit = Math.min(args.limit || 20, 50);

    if (checkFallback()) {
      let list = FallbackDb.find('inventory') || [];
      if (args.search) {
        const term = args.search.toLowerCase();
        list = list.filter(
          (i) =>
            (i.name || '').toLowerCase().includes(term) ||
            (i.sku || '').toLowerCase().includes(term)
        );
      }
      if (args.category) {
        list = list.filter((i) => (i.category || '') === args.category);
      }
      if (args.lowStockOnly) {
        list = list.filter((i) => (i.quantity || 0) <= (i.minStockLevel || 5));
      }
      return {
        success: true,
        count: list.length,
        items: list.slice(0, limit).map(formatItem),
      };
    }

    const filter = {};
    if (args.search) {
      const regex = new RegExp(args.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: regex }, { sku: regex }];
    }
    if (args.category) filter.category = args.category;
    if (args.lowStockOnly) filter.$expr = { $lte: ['$quantity', '$minStockLevel'] };

    const [items, total] = await Promise.all([
      Inventory.find(filter).sort({ quantity: 1 }).limit(limit),
      Inventory.countDocuments(filter),
    ]);

    return {
      success: true,
      count: items.length,
      total,
      items: items.map(formatItem),
    };
  },

  async createInventoryItem(args, context) {
    if (!args.name) return { success: false, error: 'Item name is required.' };
    if (!args.category) return { success: false, error: 'Category is required.' };
    if (args.quantity == null) return { success: false, error: 'Quantity is required.' };
    if (args.price == null) return { success: false, error: 'Price is required.' };

    if (!VALID_CATEGORIES.includes(args.category)) {
      return {
        success: false,
        error: `Invalid category "${args.category}". Valid options: ${VALID_CATEGORIES.join(', ')}.`,
      };
    }

    // Auto-generate SKU: INV-YYYYMMDD-XXXX
    const datePart = new Date().toISOString().replace(/-/g, '').slice(0, 8);
    const sku = `INV-${datePart}-${String(Math.floor(1000 + Math.random() * 9000))}`;

    const payload = {
      name: args.name.trim(),
      sku,
      category: args.category,
      quantity: args.quantity,
      price: args.price,
      unit: args.unit || 'pcs',
      minStockLevel: args.minStockLevel || 5,
    };

    let item;
    if (checkFallback()) {
      item = FallbackDb.create('inventory', payload);
    } else {
      item = await Inventory.create(payload);
    }

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'CREATE',
      module: 'inventory',
      recordId: item._id || item.id,
      details: `AI added inventory item: ${args.name}`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: `Inventory item "${args.name}" (SKU: ${sku}) added successfully.`,
      item: formatItem(item),
    };
  },
};

function formatItem(i) {
  return {
    id: i._id || i.id,
    name: i.name,
    sku: i.sku || '-',
    category: i.category || '-',
    quantity: i.quantity ?? 0,
    unit: i.unit || 'pcs',
    price: i.price != null ? `₹${i.price}` : '-',
    minStockLevel: i.minStockLevel ?? 5,
    isLowStock: (i.quantity ?? 0) <= (i.minStockLevel ?? 5),
  };
}
