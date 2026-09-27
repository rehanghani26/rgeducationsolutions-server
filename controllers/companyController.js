/**
 * @file controllers/companyController.js
 * @description Company profile controller.
 *
 * Upload flow: multer memoryStorage → uploadToS3 → S3 key stored in MongoDB.
 * Read  flow : S3 key in MongoDB → getPresignedUrl → presigned URL returned to client.
 *
 * Backward-compatibility: Cloudinary URLs already in MongoDB are passed through
 * unchanged by resolveFileUrl. No Cloudinary data is modified or deleted.
 */

import Setting from "../models/Setting.js";
import { checkFallback } from "../config/db.js";
import { FallbackDb } from "../services/dbFallback.js";
import {
  uploadToS3,
  generateS3Key,
  getPresignedUrl,
  resolveFileUrl,
} from "../config/s3.js";

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
 * Also keeps schoolLogoPublicId in sync so getSettings can regenerate presigned URLs.
 *
 * @param {string} logoValue  S3 key (new uploads) or empty string (removal)
 */
const saveCompanyLogo = async (logoValue) => {
  const updateData = {
    companyLogo: logoValue || "",
    schoolLogo: logoValue || "",
    // Keep PublicId in sync so erpController.getSettings can regenerate presigned URLs
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

export const getCompanyProfile = async (req, res) => {
  try {
    const settings = await getCompanySettings();
    const rawLogo = settings?.companyLogo || settings?.schoolLogo || "";
    const name = settings?.schoolName || "RG EduCore";
    const motto = settings?.schoolMotto || "School ERP";

    // Resolve S3 key → fresh 1-hour presigned URL.
    // Cloudinary URLs and empty strings are returned unchanged.
    const logo = await resolveFileUrl(rawLogo, 3600);

    return res.json({
      success: true,
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
    return res
      .status(500)
      .json({ success: false, message: "Failed to load company profile" });
  }
};

export const uploadCompanyLogo = async (req, res) => {
  try {
    // ── Guard: file present ────────────────────────────────────────────────
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Please upload a logo image" });
    }

    // ── Guard: MIME type ───────────────────────────────────────────────────
    if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: "Only JPG, PNG, SVG, and WEBP images are allowed",
      });
    }

    // ── Guard: AWS configured ──────────────────────────────────────────────
    if (!process.env.AWS_S3_BUCKET_NAME) {
      return res.status(500).json({
        success: false,
        message: "AWS S3 is not configured on the server",
      });
    }

    // ── Upload to S3 ───────────────────────────────────────────────────────
    const s3Key = generateS3Key("company/logos", req.file.originalname);
    await uploadToS3({
      buffer: req.file.buffer,
      key: s3Key,
      contentType: req.file.mimetype,
    });

    // ── Persist S3 key to MongoDB ──────────────────────────────────────────
    await saveCompanyLogo(s3Key);

    // ── Generate presigned URL for immediate display in the UI ─────────────
    const presignedUrl = await getPresignedUrl(s3Key, 3600);

    return res.status(201).json({
      success: true,
      message: "Company logo uploaded successfully",
      companyLogo: presignedUrl,   // time-limited URL for client display
    });
  } catch (err) {
    console.error("Company logo upload failed:", err.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to upload company logo" });
  }
};

export const deleteCompanyLogo = async (req, res) => {
  try {
    // Clears the stored key/URL; the S3 object is intentionally NOT deleted
    // (preserves audit history; manual cleanup can be done from AWS console).
    const settings = await saveCompanyLogo("");

    return res.json({
      success: true,
      message: "Company logo removed successfully",
      companyLogo: "",
    });
  } catch (err) {
    console.error("deleteCompanyLogo error:", err.message);
    return res
      .status(500)
      .json({ success: false, message: "Failed to remove company logo" });
  }
};
