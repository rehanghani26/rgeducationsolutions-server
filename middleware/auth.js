import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import User from "../models/User.js";
import { checkFallback, getDbState } from "../config/db.js";
import { FallbackDb } from "../services/dbFallback.js";

const getJwtSecret = () => process.env.JWT_SECRET || "super_secret_jwt_access_key_ChangeMe";
const getJwtRefreshSecret = () => process.env.JWT_REFRESH_SECRET || "super_secret_jwt_refresh_key_ChangeMe";

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
    return res
      .status(401)
      .json({ success: false, message: "Not authorized, token missing" });
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
      return res.status(403).json({
        success: false,
        message:
          "Your account has been deactivated by the administrator. Access denied.",
      });
    }

    req.user = user || {
      id: decoded.id,
      role: decoded.role,
      name: decoded.name || "User",
      permissions: decoded.permissions || [],
    };
    next();
  } catch (error) {
    console.error("JWT Verification Error:", error.message);
    return res.status(401).json({
      success: false,
      message: "Not authorized, token invalid or expired",
    });
  }
};
