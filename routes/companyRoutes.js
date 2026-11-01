// 2. External packages
import express from "express";
import multer from "multer";

// 5. Middleware
import { protect } from "../middleware/auth.js";
import { authorize } from "../middleware/rbac.js";

// 7. Utilities
import { sendBadRequest } from "../utils/responseUtil.js";

// 8. Controllers
import {
  deleteCompanyLogo,
  getCompanyProfile,
  uploadCompanyLogo,
} from "../controllers/companyController.js";

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/svg+xml",
      "image/webp",
    ];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, SVG, and WEBP images are allowed"));
    }

    cb(null, true);
  },
});

const handleLogoUpload = (req, res, next) => {
  upload.single("logo")(req, res, (err) => {
    if (!err) return next();

    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "File size must be less than 5MB"
        : err.message;

    return sendBadRequest(res, message);
  });
};

router.get("/profile", getCompanyProfile);
router.post(
  "/upload-logo",
  protect,
  authorize("super-admin", "school-admin"),
  handleLogoUpload,
  uploadCompanyLogo
);
router.delete(
  "/logo",
  protect,
  authorize("super-admin", "school-admin"),
  deleteCompanyLogo
);

export default router;
