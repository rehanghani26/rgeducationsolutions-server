// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  createUser,
  deleteUser,
  getRoles,
  getUserById,
  getUsers,
  resetUserPassword,
  toggleUserStatus,
  updateUser,
} from "../controllers/userController.js";

const router = express.Router();

/**
 * All user management routes require authentication and Admin privileges
 */
router.use(protect);
router.use(authorize("super-admin", "school-admin", "admin"));

/**
 * @route   GET /api/v1/users/roles
 * @desc    Fetch all available staff/company roles with counts
 * @access  Private (Admin)
 */
router.get("/roles", getRoles);

/**
 * @route   GET /api/v1/users
 * @desc    Get paginated staff users with filters
 * @access  Private (Admin)
 */
router.get("/", getUsers);

/**
 * @route   POST /api/v1/users
 * @desc    Create a new staff user
 * @access  Private (Admin)
 */
router.post("/", createUser);

/**
 * @route   GET /api/v1/users/:id
 * @desc    Get user details by ID
 * @access  Private (Admin)
 */
router.get("/:id", getUserById);

/**
 * @route   PUT /api/v1/users/:id
 * @desc    Update user details
 * @access  Private (Admin)
 */
router.put("/:id", updateUser);

/**
 * @route   DELETE /api/v1/users/:id
 * @desc    Delete user
 * @access  Private (Admin)
 */
router.delete("/:id", deleteUser);

/**
 * @route   PATCH /api/v1/users/:id/status
 * @desc    Toggle user active/deactivated status
 * @access  Private (Admin)
 */
router.patch("/:id/status", toggleUserStatus);

/**
 * @route   PATCH /api/v1/users/:id/reset-password
 * @desc    Reset user password
 * @access  Private (Admin)
 */
router.patch("/:id/reset-password", resetUserPassword);

export default router;
