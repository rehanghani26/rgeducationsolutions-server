// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  createAttendance,
  getAttendanceById,
  getAttendanceRecords,
  getAttendanceStats,
  getMyAttendance,
  getStudentAttendance,
} from "../controllers/attendanceController.js";

const router = express.Router();

/**
 * @route   GET /api/v1/attendance/my-attendance
 * @desc    Get logged in user's attendance records
 * @access  Private
 */
router.get("/my-attendance", protect, getMyAttendance);

/**
 * @route   GET /api/v1/attendance/student
 * @desc    Get student's own attendance
 * @access  Private
 */
router.get("/student", protect, getStudentAttendance);

/**
 * @route   GET /api/v1/attendance/student/:studentId
 * @desc    Get attendance for a specific student
 * @access  Private
 */
router.get("/student/:studentId", protect, getStudentAttendance);

/**
 * @route   GET /api/v1/attendance/stats
 * @desc    Get institution-wide attendance statistics
 * @access  Private
 */
router.get("/stats", protect, getAttendanceStats);

/**
 * @route   GET /api/v1/attendance
 * @desc    Get attendance logs
 * @access  Private
 */
router.get("/", protect, getAttendanceRecords);

/**
 * @route   GET /api/v1/attendance/:id
 * @desc    Get single attendance record by ID
 * @access  Private
 */
router.get("/:id", protect, getAttendanceById);

/**
 * @route   POST /api/v1/attendance
 * @desc    Submit or update daily attendance roster
 * @access  Private (Admin / Teacher)
 */
router.post(
  "/",
  protect,
  authorize(
    "super-admin",
    "school-admin",
    "principal",
    "teacher",
    "head-teacher"
  ),
  createAttendance
);

export default router;
