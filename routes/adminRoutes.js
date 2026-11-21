import express from "express";
import {
  adminLogin,
  onboardSchool,
  checkSlugAvailability,
  getOnboardingClasses,
  getSchools,
  getSchoolById,
  setSchoolClasses,
  updateSchool,
  updateSchoolSession,
  toggleSchoolStatus,
  getCommonProducts,
  createCommonProduct,
  getCommonCategories,
  createCommonCategory,
} from "../controllers/adminController.js";
import { requirePlatformAdmin } from "../middleware/platformAdmin.js";

const router = express.Router();

// Admin Authentication
router.post("/login", adminLogin);
router.use(requirePlatformAdmin);

// School Onboarding & Management
router.post("/schools", onboardSchool);
router.get("/schools", getSchools);
router.get("/schools/check-slug", checkSlugAvailability);
router.get("/schools/class-master", getOnboardingClasses);
router.get("/schools/:id", getSchoolById);
router.put("/schools/:id/class-range", setSchoolClasses);
router.put("/schools/:id/session", updateSchoolSession);
router.put("/schools/:id", updateSchool);
router.patch("/schools/:id/status", toggleSchoolStatus);

// Common Catalog
router.get("/products", getCommonProducts);
router.post("/products", createCommonProduct);
router.get("/categories", getCommonCategories);
router.post("/categories", createCommonCategory);

export default router;
