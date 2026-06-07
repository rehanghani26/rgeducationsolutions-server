import Inventory from '../models/Inventory.js';
import Vendor from '../models/Vendor.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';
import { parsePagination, buildSearchFilter, paginateResult } from '../utils/paginateQuery.js';
import { logActivity, getRecordActivity } from '../utils/activityLogger.js';

const enrichItem = (item) => {
  if (checkFallback()) {
    const vend = FallbackDb.findById('vendors', item.vendorId);
    return { ...item, vendor: vend, vendorDetails: vend };
  }
  return item;
};

export const getInventory = async (req, res) => {
  try {
    const { page, limit, skip, sort, search, status } = parsePagination(req.query);
    const category = req.query.category || '';
    const searchFields = ['name', 'sku', 'category'];

    if (checkFallback()) {
      let list = FallbackDb.find('inventory').map(enrichItem);
      if (search) {
        const term = search.toLowerCase();
        list = list.filter((item) =>
          searchFields.some((f) => String(item[f] || '').toLowerCase().includes(term))
        );
      }
      if (category) list = list.filter((item) => item.category === category);
      if (status === 'low-stock') list = list.filter((item) => item.quantity <= item.minStockLevel);
      const total = list.length;
      const data = list.slice(skip, skip + limit);
      return res.json({ success: true, inventory: data, ...paginateResult(data, total, { page, limit }) });
    }

    const filter = { ...buildSearchFilter(search, searchFields) };
    if (category) filter.category = category;
    if (status === 'low-stock') {
      filter.$expr = { $lte: ['$quantity', '$minStockLevel'] };
    }

    const sortObj = {};
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith('-') ? -1 : 1;

    const [inventory, total] = await Promise.all([
      Inventory.find(filter).populate('vendorId').sort(sortObj).skip(skip).limit(limit),
      Inventory.countDocuments(filter),
    ]);

    return res.json({ success: true, inventory, ...paginateResult(inventory, total, { page, limit }) });
  } catch (error) {
    console.error('getInventory error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getInventoryById = async (req, res) => {
  try {
    const { id } = req.params;
    let item = null;

    if (checkFallback()) {
      item = FallbackDb.findById('inventory', id);
      if (item) item = enrichItem(item);
    } else {
      item = await Inventory.findById(id).populate('vendorId');
    }

    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    return res.json({ success: true, item });
  } catch (error) {
    console.error('getInventoryById error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getInventoryActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await getRecordActivity('inventory', id);
    return res.json({ success: true, logs, loginHistory: [] });
  } catch (error) {
    console.error('getInventoryActivity error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateInventoryItem = async (req, res) => {
  try {
    const { id } = req.params;
    const data = { ...req.body };
    delete data.id;
    delete data._id;

    let updatedItem = null;
    if (checkFallback()) {
      updatedItem = FallbackDb.update('inventory', id, data);
      if (updatedItem) updatedItem = enrichItem(updatedItem);
    } else {
      updatedItem = await Inventory.findByIdAndUpdate(id, data, { new: true }).populate('vendorId');
    }

    if (!updatedItem) return res.status(404).json({ success: false, message: 'Item not found' });

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'UPDATE',
      module: 'inventory',
      recordId: id,
      details: `Updated inventory item ${updatedItem.name}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ success: true, message: 'Item updated successfully', item: updatedItem });
  } catch (error) {
    console.error('updateInventoryItem error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

export const createInventoryItem = async (req, res) => {
  try {
    const data = req.body;
    let newRecord = null;

    if (checkFallback()) {
      newRecord = FallbackDb.create('inventory', {
        name: data.name,
        sku: data.sku,
        category: data.category,
        quantity: Number(data.quantity) || 0,
        unit: data.unit || 'pcs',
        minStockLevel: Number(data.minStockLevel) || 5,
        price: Number(data.price) || 0,
        vendorId: data.vendorId
      });
    } else {
      const item = new Inventory(data);
      newRecord = await item.save();
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CREATE',
      module: 'inventory',
      recordId: newRecord.id || newRecord._id,
      details: `Created inventory item ${data.name}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({ success: true, message: 'Inventory item created successfully', item: newRecord });
  } catch (error) {
    console.error('createInventoryItem error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const adjustStock = async (req, res) => {
  try {
    const { id, type, quantity } = req.body; // type: 'in' or 'out'
    const qtyChange = Number(quantity);

    if (!id || !type || isNaN(qtyChange)) {
      return res.status(400).json({ success: false, message: 'Please provide valid item ID, type (in/out) and quantity.' });
    }

    let updatedItem = null;

    if (checkFallback()) {
      const item = FallbackDb.findById('inventory', id);
      if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

      const newQty = type === 'in' ? item.quantity + qtyChange : Math.max(0, item.quantity - qtyChange);
      updatedItem = FallbackDb.update('inventory', id, { quantity: newQty });
    } else {
      const item = await Inventory.findById(id);
      if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

      item.quantity = type === 'in' ? item.quantity + qtyChange : Math.max(0, item.quantity - qtyChange);
      updatedItem = await item.save();
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'UPDATE',
      module: 'inventory',
      recordId: id,
      details: `Stock ${type === 'in' ? 'added' : 'removed'}: ${qtyChange} units of ${updatedItem.name}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      metadata: { type, quantity: qtyChange, newQuantity: updatedItem.quantity },
    });

    return res.json({ success: true, message: 'Stock level adjusted successfully', item: updatedItem });
  } catch (error) {
    console.error('adjustStock error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getAlerts = async (req, res) => {
  try {
    let alertItems = [];
    if (checkFallback()) {
      const all = FallbackDb.find('inventory');
      alertItems = all.filter(item => item.quantity <= item.minStockLevel);
    } else {
      alertItems = await Inventory.find({
        $expr: { $lte: ['$quantity', '$minStockLevel'] }
      }).populate('vendorId');
    }

    return res.json({ success: true, count: alertItems.length, alerts: alertItems });
  } catch (error) {
    console.error('getAlerts error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getVendors = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('vendors');
    } else {
      list = await Vendor.find();
    }
    return res.json({ success: true, count: list.length, vendors: list });
  } catch (error) {
    console.error('getVendors error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createVendor = async (req, res) => {
  try {
    const data = req.body;
    let newRecord = null;

    if (checkFallback()) {
      newRecord = FallbackDb.create('vendors', {
        name: data.name,
        contactPerson: data.contactPerson,
        phone: data.phone,
        email: data.email,
        address: data.address
      });
    } else {
      const vendor = new Vendor(data);
      newRecord = await vendor.save();
    }

    return res.status(201).json({ success: true, message: 'Vendor added successfully', vendor: newRecord });
  } catch (error) {
    console.error('createVendor error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
