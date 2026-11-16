import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import School from "../models/School.js";
import tenantContext from "../utils/tenantContext.js";
import { sendForbidden, sendNotFound } from "../utils/responseUtil.js";

// In-memory cache for active tenant records
const activeSchoolsCache = new Map();
let cacheExpiry = 0;

/**
 * Invalidate or refresh the cached schools registry
 */
export const invalidateSchoolsCache = () => {
  activeSchoolsCache.clear();
  cacheExpiry = 0;
};

/**
 * Middleware that extracts schoolId from JWT, headers, or query parameters,
 * verifies the institution in the master registry, and attaches tenant context.
 */
export const tenantMiddleware = async (req, res, next) => {
  const urlPath = req.originalUrl || req.url || req.path || "";

  // 1. Skip tenant verification for global admin, public health, auth, and static routes
  const isBypassRoute =
    urlPath.includes("/admin") ||
    urlPath.includes("/common") ||
    urlPath.includes("/health") ||
    urlPath.includes("/reconnect-db") ||
    urlPath.includes("/auth/") ||
    urlPath.startsWith("/uploads");

  // 2. Extract tenant identifier
  let tenantId =
    req.user?.schoolId ||
    req.headers["x-school-id"] ||
    req.headers["x-collection-name"] ||
    req.headers["x-tenant-id"] ||
    req.query?.schoolId ||
    req.query?.collectionName ||
    "";

  // If no header, inspect Authorization Bearer token if present
  if (!tenantId && req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    try {
      const rawToken = req.headers.authorization.split(" ")[1];
      const decoded = jwt.decode(rawToken);
      if (decoded?.schoolId || decoded?.collectionName) {
        tenantId = decoded.schoolId || decoded.collectionName;
      }
    } catch (_e) {
      // ignore
    }
  }

  if (!tenantId) {
    if (isBypassRoute) {
      return next();
    }
    // Continue: auth.protect will enforce login / tenant identity
    return next();
  }

  const cleanId = String(tenantId).trim();

  // 3. Verify tenant against cached School records
  if (Date.now() > cacheExpiry || activeSchoolsCache.size === 0) {
    try {
      const schools = await School.find().lean();
      activeSchoolsCache.clear();
      for (const s of schools) {
        const idKey = String(s.schoolId || s._id).toUpperCase();
        activeSchoolsCache.set(idKey, s);
        if (s.schoolCode) activeSchoolsCache.set(s.schoolCode.toUpperCase(), s);
        if (s.collectionName) activeSchoolsCache.set(s.collectionName.toLowerCase(), s);
      }
      cacheExpiry = Date.now() + 5 * 60 * 1000; // 5 minute TTL
    } catch (_err) {
      // In case DB is temporarily offline or in fallback mode
    }
  }

  let school =
    activeSchoolsCache.get(cleanId.toUpperCase()) ||
    activeSchoolsCache.get(cleanId.toLowerCase());

  // If not in cache, do immediate DB lookup
  if (!school) {
    try {
      school = await School.findOne({
        $or: [
          { _id: cleanId },
          { schoolId: cleanId.toUpperCase() },
          { schoolCode: cleanId.toUpperCase() },
          { collectionName: cleanId.toLowerCase() },
        ],
      }).lean();

      if (school) {
        const idKey = String(school.schoolId || school._id).toUpperCase();
        activeSchoolsCache.set(idKey, school);
      }
    } catch (_err) {
      // ignore
    }
  }

  if (school) {
    // If school is suspended, reject with explicit status: "suspended"
    if (school.status === "suspended" || school.status === "SUSPENDED") {
      return res.status(403).json({
        success: false,
        status: "suspended",
        schoolStatus: "suspended",
        schoolId: school.schoolId || school._id,
        schoolName: school.schoolName,
        message: `Access to '${school.schoolName}' has been suspended. Please contact RGES Support.`,
      });
    }

    const resolvedSchoolId = school.schoolId || school._id;

    req.tenant = {
      schoolId: resolvedSchoolId,
      _id: resolvedSchoolId,
      schoolName: school.schoolName,
      schoolCode: school.schoolCode,
      status: school.status,
    };
    req.schoolId = resolvedSchoolId;

    // Standard Mongoose model resolver (backward compatibility for req.getModel)
    req.getModel = (modelName) => mongoose.model(modelName);

    // Dynamic model proxy: req.models.Student -> mongoose.model('Student')
    req.models = new Proxy(
      {},
      {
        get(_target, prop) {
          if (typeof prop === "string") {
            try {
              return mongoose.model(prop);
            } catch {
              return undefined;
            }
          }
          return undefined;
        },
      }
    );

    // Run within tenantContext AsyncLocalStorage
    return tenantContext.run({ schoolId: resolvedSchoolId, user: req.user }, () => {
      next();
    });
  }

  req.getModel = (modelName) => mongoose.model(modelName);
  next();
};

export default tenantMiddleware;
