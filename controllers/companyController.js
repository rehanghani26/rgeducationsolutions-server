// 3. Configuration
import { checkFallback } from "../config/db.js";
import {
  generateS3Key,
  getPresignedUrl,
  resolveFileUrl,
  uploadToS3,
} from "../config/s3.js";

// 4. Models
import Setting from "../models/Setting.js";

// 6. Services
import { FallbackDb } from "../services/dbFallback.js";

// 7. Utilities
import {
  sendBadRequest,
  sendCreated,
  sendError,
  sendSuccess,
} from "../utils/responseUtil.js";

/**
 * @file companyController.js
 * @description Company profile controller.
 *
 * Upload flow: multer memoryStorage → uploadToS3 → S3 key stored in MongoDB.
 * Read  flow : S3 key in MongoDB → getPresignedUrl → presigned URL returned to client.
 */

// ─── Validation ───────────────────────────────────────────────────────────────

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Persist the company / school logo key or URL to MongoDB / FallbackDb.
 *
 * @param {string} logoValue - S3 key (new uploads) or empty string (removal)
 */
const saveCompanyLogo = async (logoValue) => {
  const updateData = {
    companyLogo: logoValue || "",
    schoolLogo: logoValue || "",
    schoolLogoPublicId: logoValue || "",
  };

  if (checkFallback()) {
    return FallbackDb.updateSettings(updateData);
  }

  return Setting.findOneAndUpdate({}, updateData, { new: true, upsert: true });
};

const getCompanySettings = async () => {
  if (checkFallback()) {
    return FallbackDb.getSettings();
  }

  let settings = await Setting.findOne();
  if (!settings) {
    settings = await Setting.create({});
  }
  return settings;
};

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * Retrieves the institution's branding and company profile.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getCompanyProfile = async (req, res) => {
  try {
    const settings = await getCompanySettings();
    const rawLogo = settings?.companyLogo || settings?.schoolLogo || "";
    const name = settings?.schoolName || "RG EduCore";
    const motto = settings?.schoolMotto || "School ERP";

    const logo = await resolveFileUrl(rawLogo, 3600);

    return sendSuccess(res, undefined, null, 200, {
      company: {
        companyLogo: logo,
        schoolLogo: logo,
        companyName: name,
        schoolName: name,
        schoolMotto: motto,
      },
    });
  } catch (err) {
    console.error("getCompanyProfile error:", err.message);
    return sendError(res, "Failed to load company profile", 500);
  }
};

/**
 * Uploads institution company logo to S3 or fallback storage.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const uploadCompanyLogo = async (req, res) => {
  try {
    if (!req.file) {
      return sendBadRequest(res, "Please upload a logo image");
    }

    if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
      return sendBadRequest(
        res,
        "Only JPG, PNG, SVG, and WEBP images are allowed"
      );
    }

    if (!process.env.AWS_S3_BUCKET_NAME) {
      return sendError(res, "AWS S3 is not configured on the server", 500);
    }

    const s3Key = generateS3Key("company/logos", req.file.originalname);
    await uploadToS3({
      buffer: req.file.buffer,
      key: s3Key,
      contentType: req.file.mimetype,
    });

    await saveCompanyLogo(s3Key);

    const presignedUrl = await getPresignedUrl(s3Key, 3600);

    return sendCreated(res, "Company logo uploaded successfully", null, {
      companyLogo: presignedUrl,
    });
  } catch (err) {
    console.error("Company logo upload failed:", err.message);
    return sendError(res, "Failed to upload company logo", 500);
  }
};

/**
 * Removes company logo configuration.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const deleteCompanyLogo = async (req, res) => {
  try {
    await saveCompanyLogo("");

    return sendSuccess(res, "Company logo removed successfully", null, 200, {
      companyLogo: "",
    });
  } catch (err) {
    console.error("deleteCompanyLogo error:", err.message);
    return sendError(res, "Failed to remove company logo", 500);
  }
};
