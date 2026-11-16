import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { checkFallback } from "../config/db.js";
import User from "../models/User.js";
import { FallbackDb } from "../services/dbFallback.js";
import tenantContext from "../utils/tenantContext.js";
import { sendForbidden, sendUnauthorized } from "../utils/responseUtil.js";

/**
 * @file auth.js
 * @description Centralized multi-tenant authentication middleware.
 * Generates and verifies JWT tokens embedding { userId, schoolId, role }.
 * Attaches authenticated tenant context to req and tenantContext AsyncLocalStorage.
 */

const getJwtSecret = () =>
  process.env.JWT_SECRET || "super_secret_jwt_access_key_ChangeMe";
const getJwtRefreshSecret = () =>
  process.env.JWT_REFRESH_SECRET ||
  "super_secret_jwt_refresh_key_ChangeMe";

/**
 * Generates access and refresh JWT tokens containing userId, schoolId, and role.
 *
 * @param {Object} user - User document or fallback record.
 * @param {Object} [school=null] - School tenant metadata.
 * @returns {{ accessToken: string, refreshToken: string }} Token pair.
 */
export const generateTokens = (user, school = null) => {
  const schoolId =
    user.schoolId ||
    school?.schoolId ||
    school?._id ||
    user._schoolId ||
    undefined;

  const userId = String(user.id || user._id);

  const payload = {
    userId,
    id: userId,
    schoolId,
    role: user.role,
    name: user.name || "User",
  };

  const accessToken = jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
  const refreshToken = jwt.sign(payload, getJwtRefreshSecret(), {
    expiresIn: "7d",
  });

  return { accessToken, refreshToken };
};

/**
 * Middleware that protects routes by verifying Bearer JWT tokens.
 * Validates user, extracts userId, schoolId, and role, and wraps downstream handlers
 * within tenantContext AsyncLocalStorage for automatic query scoping.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next middleware callback.
 */
export const protect = async (req, res, next) => {
  let token = null;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  } else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return sendUnauthorized(res, "Not authorized, token missing");
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    const userId = decoded.userId || decoded.id;

    let user = null;
    if (checkFallback()) {
      user = FallbackDb.findById("users", userId);
    } else {
      if (userId && mongoose.Types.ObjectId.isValid(userId)) {
        user = await User.findById(userId)
          .setOptions({ skipTenantFilter: true })
          .select("-password");
      }
      if (!user && decoded.username) {
        user = await User.findOne({ username: decoded.username })
          .setOptions({ skipTenantFilter: true })
          .select("-password");
      }
    }

    if (user && user.isActive === false) {
      return sendForbidden(
        res,
        "Your account has been deactivated by the administrator. Access denied."
      );
    }

    const schoolId = user?.schoolId || decoded.schoolId;

    req.user = user || {
      id: userId,
      _id: userId,
      userId,
      schoolId,
      role: decoded.role,
      name: decoded.name || "User",
    };

    req.schoolId = schoolId;
    if (req.user) {
      req.user.schoolId = schoolId;
      req.user.userId = userId;
    }

    // Attach schoolId header for downstream compatibility
    if (schoolId) {
      req.headers["x-school-id"] = schoolId;
    }

    // Wrap downstream execution inside tenantContext AsyncLocalStorage
    tenantContext.run(
      {
        schoolId,
        user: req.user,
        skipTenantFilter: decoded.role === "platform-super-admin",
      },
      () => {
        next();
      }
    );
  } catch (error) {
    console.error("JWT Verification Error:", error.message);
    return sendUnauthorized(res, "Not authorized, token invalid or expired");
  }
};
