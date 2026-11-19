import mongoose from 'mongoose';
import { checkFallback } from '../config/db.js';
import AcademicSession from '../models/AcademicSession.js';
import BudgetAllocation from '../models/BudgetAllocation.js';
import Inventory from '../models/Inventory.js';
import InventoryIssuance from '../models/InventoryIssuance.js';
import InventoryPurchase from '../models/InventoryPurchase.js';
import InventoryTransaction from '../models/InventoryTransaction.js';
import Vendor from '../models/Vendor.js';
import { buildSearchFilter, paginateResult, parsePagination } from '../utils/paginateQuery.js';
import { procurementError, recordId, recordIds } from '../utils/procurementValues.js';
import { FallbackDb } from './dbFallback.js';

const models = {
  academicSessions: AcademicSession,
  budgetAllocations: BudgetAllocation,
  inventory: Inventory,
  inventoryIssuances: InventoryIssuance,
  inventoryPurchases: InventoryPurchase,
  inventoryTransactions: InventoryTransaction,
  vendors: Vendor,
};

const LEGACY_SCHOOL = 'IQRA_P01001';
const referencedCollections = { itemId: 'inventory', vendorId: 'vendors', sessionId: 'academicSessions' };

export const getSchool = (req) =>
  String(req.schoolId || req.user?.schoolId || LEGACY_SCHOOL).toUpperCase();

function matchesSchool(record, school) {
  return String(record.schoolId || LEGACY_SCHOOL).toUpperCase() === school;
}

function referenceIds(db, school, collection, id) {
  const key = String(id);
  const record = db.find(collection).find((value) => matchesSchool(value, school) && recordIds(value).includes(key));
  return record ? recordIds(record) : [key];
}

function matchingRecords(db, school, collection, match) {
  const entries = Object.entries(match).map(([key, value]) => [key, value,
    referencedCollections[key] && value != null ? referenceIds(db, school, referencedCollections[key], value) : null,
  ]);
  return db.find(collection).filter((record) => {
    if (!matchesSchool(record, school)) return false;
    return entries.every(([key, value, ids]) => {
      const field = key === '_id' ? recordId(record) : record[key];
      if (value instanceof RegExp) return value.test(String(field ?? ''));
      if (value == null) return field == null;
      if (ids) return ids.includes(String(field));
      return String(field) === String(value);
    });
  });
}

function compareRecords(field, direction) {
  return (a, b) => {
    const left = a[field];
    const right = b[field];
    if (typeof left === 'number' && typeof right === 'number') return direction * (left - right);
    return direction * String(left ?? '').localeCompare(String(right ?? ''));
  };
}

function operations(req, fallback, session = null) {
  const school = getSchool(req);
  const idFilter = (id) => ({ _id: mongoose.isObjectIdOrHexString(id) ? id : null });
  const scoped = (match) => ({ ...match, schoolId: school });
  const queryFor = (collection, match) => models[collection].find(scoped(match)).session(session);

  return {
    async find(collection, match = {}) {
      if (fallback) return matchingRecords(fallback, school, collection, match);
      return queryFor(collection, match).lean();
    },
    async one(collection, match) {
      if (fallback) return matchingRecords(fallback, school, collection, match)[0] || null;
      return models[collection].findOne(scoped(match)).session(session).lean();
    },
    async get(collection, id) {
      if (fallback) {
        return matchingRecords(fallback, school, collection, {}).find(
          (record) => String(recordId(record)) === String(id) || record.id === id
        ) || null;
      }
      return models[collection].findOne(scoped(idFilter(id))).session(session).lean();
    },
    async byIds(collection, ids) {
      const keys = new Set(ids.map(String));
      if (fallback) {
        return matchingRecords(fallback, school, collection, {}).filter((record) =>
          keys.has(String(recordId(record))) || keys.has(String(record.id))
        );
      }
      return queryFor(collection, { _id: { $in: [...keys].filter((id) => mongoose.isObjectIdOrHexString(id)) } }).lean();
    },
    async containingItem(collection, itemId) {
      if (fallback) {
        const ids = referenceIds(fallback, school, 'inventory', itemId);
        return matchingRecords(fallback, school, collection, {}).filter((record) =>
          (record.items || []).some((line) => ids.includes(String(line.itemId)))
        );
      }
      return queryFor(collection, { 'items.itemId': itemId }).lean();
    },
    async page(collection, query, { match = {}, searchFields = [], sortFields = [], extraFilter = {}, predicate } = {}) {
      const pagination = parsePagination({
        ...query,
        search: typeof query.search === 'string' ? query.search : '',
        sort: typeof query.sort === 'string' ? query.sort : undefined,
      });
      const { limit, skip, search, sort } = pagination;
      const sortField = sort.replace(/^-/, '');
      const field = sortFields.includes(sortField) ? sortField : sortFields[0] || 'createdAt';
      const direction = sort.startsWith('-') ? -1 : 1;
      if (fallback) {
        const list = matchingRecords(fallback, school, collection, match)
          .filter((record) => (!predicate || predicate(record)) && (
            !search || !searchFields.length || searchFields.some((key) =>
              String(record[key] ?? '').toLowerCase().includes(search.toLowerCase())
            )
          ));
        list.sort(compareRecords(field, direction));
        return paginateResult(list.slice(skip, skip + limit), list.length, pagination);
      }

      const filter = { ...match, ...extraFilter, ...buildSearchFilter(search, searchFields) };
      const [data, total] = await Promise.all([
        queryFor(collection, filter).sort({ [field]: direction, _id: direction }).skip(skip).limit(limit).lean(),
        models[collection].countDocuments(scoped(filter)),
      ]);
      return paginateResult(data, total, pagination);
    },
    async create(collection, data) {
      const document = { ...data, schoolId: school };
      if (fallback) return fallback.create(collection, document);
      const [created] = await models[collection].create([document], { session });
      return created.toObject();
    },
    async update(collection, id, data) {
      const changes = { ...data, schoolId: school };
      if (fallback) return fallback.update(collection, id, changes);
      return models[collection].findOneAndUpdate(scoped(idFilter(id)), changes, {
        new: true,
        runValidators: true,
        session,
      }).lean();
    },
    async remove(collection, id) {
      if (fallback) return fallback.delete(collection, id);
      return models[collection].deleteOne(scoped(idFilter(id))).session(session);
    },
    async lockBudget(sessionId) {
      if (!fallback) {
        await AcademicSession.updateOne(scoped(idFilter(sessionId)), {
          $inc: { budgetVersion: 1 },
        }, { session, timestamps: false });
      }
    },
  };
}

export function readProcurement(req) {
  return operations(req, checkFallback() ? FallbackDb : null);
}

export async function writeProcurement(req, collections, work, { atomic = true } = {}) {
  try {
    if (checkFallback()) {
      return await FallbackDb.transaction(collections, (draft) => {
        const draftDb = {
          find: (collection) => draft[collection] || [],
          create(collection, data) {
            const id = new mongoose.Types.ObjectId().toString();
            const now = new Date().toISOString();
            const record = { _id: id, id, createdAt: now, updatedAt: now, ...data };
            draft[collection].push(record);
            return record;
          },
          update(collection, id, data) {
            const index = draft[collection].findIndex((record) => String(recordId(record)) === String(id));
            if (index < 0) return null;
            const record = { ...draft[collection][index], ...data, updatedAt: new Date().toISOString() };
            draft[collection][index] = record;
            return record;
          },
          delete(collection, id) {
            draft[collection] = draft[collection].filter((record) => String(recordId(record)) !== String(id));
          },
        };
        return work(operations(req, draftDb));
      });
    }
    if (!atomic) return await work(operations(req, null));
    return await mongoose.connection.transaction((session) => work(operations(req, null, session)));
  } catch (error) {
    if (error.code === 20 && /transaction/i.test(error.message)) {
      throw procurementError('This operation requires MongoDB transactions. Connect to a replica set to continue.', 503);
    }
    throw error;
  }
}
