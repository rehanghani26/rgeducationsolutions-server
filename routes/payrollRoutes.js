// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 8. Controllers
import {
  assignSalaryStructure,
  disburseBatch,
  disburseSalary,
  getDisbursements,
  getPayrollStaff,
  getPayrollSummary,
  getStaffPayrollDetails,
} from "../controllers/payrollController.js";

const router = express.Router();

router.use(protect);

const ALL_STAFF_ROLES = [
  "super-admin",
  "school-admin",
  "admin",
  "principal",
  "director",
  "accountant",
  "teacher",
  "head-teacher",
  "hod",
  "coordinator",
  "librarian",
  "peon",
  "staff",
  "support",
];

const MANAGEMENT_ROLES = [
  "super-admin",
  "school-admin",
  "admin",
  "principal",
  "director",
  "accountant",
];

// Staff Directory (excluding Admin) & Summary
router.get("/staff", authorize(...ALL_STAFF_ROLES), getPayrollStaff);

// Individual Staff Comprehensive Details
router.get(
  "/staff/:id/details",
  authorize(...ALL_STAFF_ROLES),
  getStaffPayrollDetails
);

router.get("/summary", authorize(...ALL_STAFF_ROLES), getPayrollSummary);

router.get(
  "/disbursements",
  authorize(...ALL_STAFF_ROLES),
  getDisbursements
);

// Assign Salary Structure (Management and Accountant only)
router.post(
  "/salary-structure",
  authorize(...MANAGEMENT_ROLES),
  assignSalaryStructure
);

// Disburse Single Salary
router.post("/disburse", authorize(...MANAGEMENT_ROLES), disburseSalary);

// Batch Disburse Salaries
router.post(
  "/disburse-batch",
  authorize(...MANAGEMENT_ROLES),
  disburseBatch
);

export default router;
  "/salary-structure",
  authorize(...MANAGEMENT_ROLES),
  assignSalaryStructure
);

// Disburse Single Salary
router.post("/disburse", authorize(...MANAGEMENT_ROLES), disburseSalary);

// Batch Disburse Salaries
router.post(
  "/disburse-batch",
  authorize(...MANAGEMENT_ROLES),
  disburseBatch
);

export default router;
