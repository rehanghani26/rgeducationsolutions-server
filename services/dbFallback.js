// 1. Node.js built-in modules
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * @file dbFallback.js
 * @description Local persistent in-memory JSON database engine for resilient offline fallback operation.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "uploads", "fallback_db.json");

// Clean initial empty database structure
const initialDb = {
  users: [],
  students: [],
  teachers: [],
  classes: [],
  sections: [],
  subjects: [],
  attendance: [],
  fees: [],
  expenses: [],
  inventory: [],
  vendors: [],
  inventoryPurchases: [],
  inventoryIssuances: [],
  inventoryTransactions: [],
  exams: [],
  notices: [],
  notifications: [],
  library: [],
  otps: [],
  results: [],
  passwordRequests: [],
  settings: {},
  // Academic scheduling collections
  academicSessions: [],
  masterPeriods: [],
  classTimetables: [],
  // Budget & Payroll collections
  budgetAllocations: [],
  payrollRecords: [],
  payrollDisbursements: [],
};

let db = { ...initialDb };

// Ensure upload directory exists
const uploadDir = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * Loads persisted fallback database state from JSON disk storage.
 */
const loadData = () => {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      db = JSON.parse(raw);
      if (!db.users) db.users = [];
      if (!db.students) db.students = [];
      if (!db.teachers) db.teachers = [];
      if (!db.classes) db.classes = [];
      if (!db.sections) db.sections = [];
      if (!db.subjects) db.subjects = [];
      if (!db.attendance) db.attendance = [];
      if (!db.fees) db.fees = [];
      if (!db.expenses) db.expenses = [];
      if (!db.inventory) db.inventory = [];
      if (!db.vendors) db.vendors = [];
      if (!db.inventoryPurchases) db.inventoryPurchases = [];
      if (!db.inventoryIssuances) db.inventoryIssuances = [];
      if (!db.inventoryTransactions) db.inventoryTransactions = [];
      if (!db.exams) db.exams = [];
      if (!db.notices) db.notices = [];
      if (!db.notifications) db.notifications = [];
      if (!db.library) db.library = [];
      if (!db.otps) db.otps = [];
      if (!db.results) db.results = [];
      if (!db.passwordRequests) db.passwordRequests = [];
      if (!db.settings) db.settings = {};
      if (!db.academicSessions) db.academicSessions = [];
      if (!db.masterPeriods) db.masterPeriods = [];
      if (!db.classTimetables) db.classTimetables = [];
      if (!db.budgetAllocations) db.budgetAllocations = [];
      if (!db.payrollRecords) db.payrollRecords = [];
      if (!db.payrollDisbursements) db.payrollDisbursements = [];

      saveData();
    } else {
      saveData();
    }
  } catch (err) {
    console.error("Failed to load fallback db file, using in-memory.", err);
  }
};

/**
 * Persists fallback database state to disk.
 */
const saveData = () => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write to fallback db file.", err);
  }
};

loadData();

/**
 * Generic synchronous CRUD operations for fallback collections.
 */
export const FallbackDb = {
  find: (collection) => {
    return db[collection] || [];
  },

  findAll: (collection) => {
    return db[collection] || [];
  },

  findById: (collection, id) => {
    const coll = db[collection] || [];
    return coll.find((item) => item.id === id || item._id === id);
  },

  findOne: (collection, queryObj) => {
    const coll = db[collection] || [];
    return coll.find((item) => {
      return Object.entries(queryObj).every(([key, val]) => item[key] === val);
    });
  },

  create: (collection, data) => {
    if (!db[collection]) db[collection] = [];
    const newRecord = {
      id: data.id || Math.random().toString(36).substring(2, 9),
      _id: data._id || Math.random().toString(36).substring(2, 9),
      createdAt: new Date().toISOString(),
      ...data,
    };
    db[collection].push(newRecord);
    saveData();
    return newRecord;
  },

  insert: (collection, data) => {
    return FallbackDb.create(collection, data);
  },

  insertMany: (collection, items = []) => {
    if (!Array.isArray(items)) return [];
    return items.map((item) => FallbackDb.create(collection, item));
  },

  update: (collection, id, data) => {
    if (!db[collection]) return null;
    const index = db[collection].findIndex(
      (item) => item.id === id || item._id === id
    );
    if (index === -1) return null;

    db[collection][index] = {
      ...db[collection][index],
      ...data,
      updatedAt: new Date().toISOString(),
    };
    saveData();
    return db[collection][index];
  },

  delete: (collection, id) => {
    if (!db[collection]) return false;
    const initialLen = db[collection].length;
    db[collection] = db[collection].filter(
      (item) => item.id !== id && item._id !== id
    );
    const success = db[collection].length < initialLen;
    if (success) {
      saveData();
    }
    return success;
  },

  getSettings: () => {
    return db.settings;
  },

  updateSettings: (newSettings) => {
    db.settings = { ...db.settings, ...newSettings };
    saveData();
    return db.settings;
  },

  updateAll: (collection, newArray) => {
    db[collection] = Array.isArray(newArray) ? newArray : [];
    saveData();
  },
};
