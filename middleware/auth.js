// 2. External packages
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

// 3. Configuration
import { checkFallback } from "../config/db.js";

// 4. Models
import User from "../models/User.js";

// 6. Services
import { FallbackDb } from "../services/dbFallback.js";

// 7. Utilities
import { sendForbidden, sendUnauthorized } from "../utils/responseUtil.js";

/**
 * @file auth.js
 * @description Authentication middleware for JWT verification and token generation.
 */

const getJwtSecret = () => process.env.JWT_SECRET || "super_secret_jwt_access_key_ChangeMe";
const getJwtRefreshSecret = () => process.env.JWT_REFRESH_SECRET || "super_secret_jwt_refresh_key_ChangeMe";

/**
 * Generates access and refresh JWT tokens for a verified user.
 *
 * @param {Object} user - User document or fallback record.
 * @returns {{ accessToken: string, refreshToken: string }} Token pair.
 */
export const generateTokens = (user) => {
  const payload = {
    id: user.id || user._id,
    role: user.role,
    permissions: user.permissions || [],
  };

  const accessToken = jwt.sign(payload, getJwtSecret(), { expiresIn: "7d" });
  const refreshToken = jwt.sign(payload, getJwtRefreshSecret(), {
    expiresIn: "7d",
  });

  return { accessToken, refreshToken };
};

/**
 * Middleware that protects routes by verifying Bearer JWT tokens in Authorization headers or cookies.
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

    let user = null;
    if (checkFallback()) {
      user = FallbackDb.findById("users", decoded.id);
    } else {
      if (decoded.id && mongoose.Types.ObjectId.isValid(decoded.id)) {
        user = await User.findById(decoded.id).select("-password");
      }
      if (!user && decoded.id) {
        user = await User.findOne({ username: decoded.id }).select("-password");
      }
      if (!user && decoded.id) {
        user = FallbackDb.findById("users", decoded.id);
      }
    }

    if (user && user.isActive === false) {
      return sendForbidden(
        res,
        "Your account has been deactivated by the administrator. Access denied."
      );
    }

    req.user = user || {
      id: decoded.id,
      _id: decoded.id,
      role: decoded.role,
      name: decoded.name || "User",
      permissions: decoded.permissions || [],
    };
    next();
  } catch (error) {
    console.error("JWT Verification Error:", error.message);
    return sendUnauthorized(res, "Not authorized, token invalid or expired");
  }
};
