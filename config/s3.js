/**
 * @file config/s3.js
 * @description AWS S3 client configuration and helpers for private-bucket uploads.
 *
 * All S3 objects live in a PRIVATE bucket.
 * - Uploads  : PutObjectCommand (server-side, uses IAM credentials)
 * - Downloads : presigned GetObjectCommand URL (time-limited, no public access)
 *
 * Backward-compatibility: Cloudinary URLs (res.cloudinary.com) and local /uploads/
 * paths stored in existing MongoDB records are passed through unchanged.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomBytes } from 'crypto';
import path from 'path';

// ─── Validation ───────────────────────────────────────────────────────────────

const validateEnv = () => {
  const required = ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET_NAME'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`AWS S3 configuration missing: ${missing.join(', ')}`);
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
 * An S3 key never starts with "http" (full URL) or "/" (local path).
 * Examples:
 *   "school-erp/students/photos/1234-abc.jpg" → true
 *   "https://res.cloudinary.com/…"            → false
 *   "/uploads/students/abc.jpg"               → false
 */
export const isS3Key = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  !value.startsWith('http') &&
  !value.startsWith('/');

/**
 * Returns true when the value is a Cloudinary URL (legacy records).
 */
export const isCloudinaryUrl = (value) =>
  typeof value === 'string' && value.includes('res.cloudinary.com');

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Generate a unique, collision-resistant S3 object key.
 *
 * @param {string} folder       e.g. 'school-erp/students/photos'
 * @param {string} originalName original file name (used for extension only)
 * @returns {string}            e.g. 'school-erp/students/photos/1753600000000-a1b2c3d4.jpg'
 */
export const generateS3Key = (folder, originalName = '') => {
  const ext = path.extname(originalName).toLowerCase() || '';
  const uniqueHex = randomBytes(8).toString('hex');
  return `${folder}/${Date.now()}-${uniqueHex}${ext}`;
};

/**
 * Upload a Buffer to the private S3 bucket.
 *
 * @param {object}  opts
 * @param {Buffer}  opts.buffer           File data
 * @param {string}  opts.key              S3 object key (use generateS3Key)
 * @param {string}  opts.contentType      MIME type e.g. 'image/jpeg'
 * @param {string}  [opts.contentDisposition]  e.g. 'inline' for browser-viewable PDFs
 * @returns {Promise<string>}             The uploaded S3 key
 */
export const uploadToS3 = async ({ buffer, key, contentType, contentDisposition }) => {
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
 * NOTE: getSignedUrl() is a pure local HMAC operation — it does NOT make
 * any network request to AWS.  Generating many presigned URLs is essentially free.
 *
 * @param {string} key        S3 object key
 * @param {number} [expiresIn=3600]  URL lifetime in seconds (max 604800 for IAM users)
 * @returns {Promise<string>} Time-limited presigned URL
 */
export const getPresignedUrl = async (key, expiresIn = 3600) => {
  if (!key) throw new Error('S3 key is required to generate a presigned URL');
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
  });
  return getSignedUrl(client, command, { expiresIn });
};

/**
 * Resolve any stored file reference to a viewable URL.
 *
 * Handles three cases transparently:
 *  - S3 key         → fresh presigned URL   (new uploads)
 *  - Cloudinary URL → returned as-is         (legacy records)
 *  - Local /uploads/ path → returned as-is   (fallback-mode records)
 *  - Empty / falsy  → empty string
 *
 * @param {string} value      Value stored in MongoDB
 * @param {number} [expiresIn=3600]
 * @returns {Promise<string>}
 */
export const resolveFileUrl = async (value, expiresIn = 3600) => {
  if (!value) return '';
  if (isS3Key(value)) return getPresignedUrl(value, expiresIn);
  return value; // Cloudinary URL, /uploads/ path — pass through unchanged
};
