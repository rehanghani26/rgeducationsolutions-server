import express from "express";
import {
  adminLogin,
  onboardSchool,
  checkSlugAvailability,
  getSchools,
  getSchoolById,
  updateSchool,
  toggleSchoolStatus,
  getCommonProducts,
  createCommonProduct,
  getCommonCategories,
  createCommonCategory,
} from "../controllers/adminController.js";

const router = express.Router();

// Admin Authentication
router.post("/login", adminLogin);

// School Onboarding & Management
router.post("/schools", onboardSchool);
router.get("/schools", getSchools);
router.get("/schools/check-slug", checkSlugAvailability);
router.get("/schools/:id", getSchoolById);
router.put("/schools/:id", updateSchool);
router.patch("/schools/:id/status", toggleSchoolStatus);

// Common Catalog
router.get("/products", getCommonProducts);
router.post("/products", createCommonProduct);
router.get("/categories", getCommonCategories);
router.post("/categories", createCommonCategory);

export default router;
