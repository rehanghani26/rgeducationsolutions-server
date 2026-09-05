import Setting from "../models/Setting.js";
import { configureCloudinary } from "../config/cloudinary.js";
import { checkFallback } from "../config/db.js";
import { FallbackDb } from "../services/dbFallback.js";

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

const uploadBufferToCloudinary = (file) => {
  const cloudinary = configureCloudinary();

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "company/logos",
        resource_type: "image",
        use_filename: true,
        unique_filename: true,
        overwrite: false,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    stream.end(file.buffer);
  });
};

const saveCompanyLogo = async (companyLogo) => {
  const updateData = {
    companyLogo: companyLogo || "",
    schoolLogo: companyLogo || "",
  };

  if (checkFallback()) {
    return FallbackDb.updateSettings(updateData);
  }

  return Setting.findOneAndUpdate(
    {},
    updateData,
    { new: true, upsert: true }
  );
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

export const getCompanyProfile = async (req, res) => {
  try {
    const settings = await getCompanySettings();
    const logo = settings?.companyLogo || settings?.schoolLogo || "";
    const name = settings?.schoolName || "RG EduCore";
    const motto = settings?.schoolMotto || "School ERP";

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
    return res
      .status(500)
      .json({ success: false, message: "Failed to load company profile" });
  }
};

export const uploadCompanyLogo = async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Please upload a logo image" });
    }

    if (!allowedMimeTypes.has(req.file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: "Only JPG, PNG, SVG, and WEBP images are allowed",
      });
    }

    const result = await uploadBufferToCloudinary(req.file);
    const settings = await saveCompanyLogo(result.secure_url);

    return res.status(201).json({
      success: true,
      message: "Company logo uploaded successfully",
      companyLogo: settings.companyLogo,
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
    const settings = await saveCompanyLogo("");

    return res.json({
      success: true,
      message: "Company logo removed successfully",
      companyLogo: settings.companyLogo,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: "Failed to remove company logo" });
  }
};
