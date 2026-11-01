// 1. Node.js built-in modules
import { randomBytes } from "crypto";
import path from "path";

// 2. External packages
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * @file s3.js
 * @description AWS S3 client configuration and helpers for private-bucket uploads and presigned URL access.
 *
 * All S3 objects live in a PRIVATE bucket.
 * - Uploads   : PutObjectCommand (server-side, IAM credentials)
 * - Downloads : presigned GetObjectCommand URL (time-limited, no public access)
 *
 * Backward-compatibility: Cloudinary URLs and local /uploads/ paths stored in existing
 * records are passed through unchanged.
 */

// ─── Validation ───────────────────────────────────────────────────────────────

const validateEnv = () => {
  const required = [
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_S3_BUCKET_NAME",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`AWS S3 configuration missing: ${missing.join(", ")}`);
  }
};

// ─── S3 Client (lazy-initialised so the server still boots without AWS vars) ──

let _s3Client = null;
const getS3Client = () => {
  if (!_s3Client) {
    validateEnv();
    _s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return _s3Client;
};

// ─── Type Helpers ─────────────────────────────────────────────────────────────

/**
 * Returns true when the value looks like an S3 object key.
 *
 * @param {any} value
 * @returns {boolean}
 */
export const isS3Key = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.startsWith("http") &&
  !value.startsWith("/");

/**
 * Returns true when the value is a Cloudinary URL (legacy records).
 *
 * @param {any} value
 * @returns {boolean}
 */
export const isCloudinaryUrl = (value) =>
  typeof value === "string" && value.includes("res.cloudinary.com");

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Generate a unique, collision-resistant S3 object key.
 *
 * @param {string} folder - Destination key prefix (e.g. 'school-erp/students/photos')
 * @param {string} [originalName=''] - Original file name for extension preservation
 * @returns {string} Unique key
 */
export const generateS3Key = (folder, originalName = "") => {
  const ext = path.extname(originalName).toLowerCase() || "";
  const uniqueHex = randomBytes(8).toString("hex");
  return `${folder}/${Date.now()}-${uniqueHex}${ext}`;
};

/**
 * Upload a Buffer to the private S3 bucket.
 *
 * @param {Object} opts
 * @param {Buffer} opts.buffer - File data buffer
 * @param {string} opts.key - Destination S3 key
 * @param {string} opts.contentType - MIME type
 * @param {string} [opts.contentDisposition] - Content disposition header
 * @returns {Promise<string>} Uploaded S3 key
 */
export const uploadToS3 = async ({
  buffer,
  key,
  contentType,
  contentDisposition,
}) => {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ...(contentDisposition ? { ContentDisposition: contentDisposition } : {}),
  });
  await client.send(command);
  return key;
};

/**
 * Generate a presigned GET URL for a private S3 object.
 *
 * @param {string} key - S3 object key
 * @param {number} [expiresIn=3600] - Presigned URL validity in seconds
 * @returns {Promise<string>} Presigned URL
 */
export const getPresignedUrl = async (key, expiresIn = 3600) => {
  if (!key) throw new Error("S3 key is required to generate a presigned URL");
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn });
};

/**
 * Resolve any stored file reference to a viewable URL.
 * Handles S3 keys, Cloudinary URLs, and local uploads transparently.
 *
 * @param {string} value - Stored URL or S3 key
 * @param {number} [expiresIn=3600] - Validity seconds
 * @returns {Promise<string>}
 */
export const resolveFileUrl = async (value, expiresIn = 3600) => {
  if (!value) return "";
  if (isS3Key(value)) return getPresignedUrl(value, expiresIn);
  return value; // Cloudinary URL, /uploads/ path — pass through unchanged
};
