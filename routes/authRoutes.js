// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";

// 8. Controllers
import {
  getMe,
  getSetupStatus,
  login,
  logout,
  refresh,
  sendSetupOtp,
  signup,
  verifySetupOtp,
} from "../controllers/authController.js";

const router = express.Router();

/**
 * @route   GET /api/v1/auth/setup-status
 * @desc    Check whether system needs initial super admin setup
 * @access  Public
 */
router.get("/setup-status", getSetupStatus);
router.get("/has-users", getSetupStatus);

/**
 * @route   POST /api/v1/auth/send-otp
 * @desc    Send OTP to verify super admin email on setup
 * @access  Public
 */
router.post("/send-otp", sendSetupOtp);

/**
 * @route   POST /api/v1/auth/verify-otp
 * @desc    Verify OTP and activate initial super admin
 * @access  Public
 */
router.post("/verify-otp", verifySetupOtp);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Authenticate user and get access token
 * @access  Public
 */
router.post("/login", login);

/**
 * @route   POST /api/v1/auth/signup
 * @desc    Super Admin institution setup registration
 * @access  Public
 */
router.post("/signup", signup);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Invalidate refresh token and clear cookie
 * @access  Public
 */
router.post("/logout", logout);

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Rotate access and refresh tokens
 * @access  Public
 */
router.post("/refresh", refresh);

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get currently authenticated user profile
 * @access  Private
 */
router.get("/me", protect, getMe);

export default router;
