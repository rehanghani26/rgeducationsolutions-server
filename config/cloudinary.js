// 2. External packages
import { v2 as cloudinary } from "cloudinary";

/**
 * @file cloudinary.js
 * @description Cloudinary client configuration for legacy file reference compatibility.
 */

/**
 * Initializes and returns Cloudinary client configuration.
 *
 * @returns {typeof cloudinary}
 */
export const configureCloudinary = () => {
  if (!process.env.CLOUDINARY_URL) {
    throw new Error("CLOUDINARY_URL is not configured");
  }

  cloudinary.config(true);
  cloudinary.config({ secure: true });
  return cloudinary;
};

export default cloudinary;
