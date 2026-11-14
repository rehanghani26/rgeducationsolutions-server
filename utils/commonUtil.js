// 1. Node.js built-in modules
import crypto from 'crypto';

// 2. External packages
import mongoose from 'mongoose';

/**
 * @file commonUtil.js
 * @description Centralized common helpers and validation routines.
 */

/**
 * Trims and lowercases an email address.
 *
 * @param {string} [email=''] - Email address.
 * @returns {string} Normalized email.
 */
export const normalizeEmail = (email = '') => String(email || '').trim().toLowerCase();

/**
 * Validates whether a string matches a standard email format.
 *
 * @param {string} email - Email to check.
 * @returns {boolean} True if email is valid.
 */
export const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

/**
 * Validates a standard contact/phone number (10 to 15 digits).
 *
 * @param {string} phone - Phone string.
 * @returns {boolean} True if phone is valid.
 */
export const isValidPhone = (phone) => {
  if (!phone) return false;
  const digits = String(phone).replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15;
};

/**
 * Constructs a full name from an object containing `name`, `firstName`, and `lastName`.
 *
 * @param {Record<string, any>} [data={}] - Object with name fields.
 * @returns {string} Formatted full name.
 */
export const formatFullName = (data = {}) => {
  if (!data) return '';
  if (data.name && String(data.name).trim()) return String(data.name).trim();
  const first = data.firstName || '';
  const last = data.lastName || '';
  return `${first} ${last}`.trim();
};

/**
 * Generates a collision-resistant temporary password with prefix and random entropy.
 *
 * @param {string} [prefix='Pass@'] - Password prefix.
 * @returns {string} Generated temporary password.
 */
export const generateSecurePassword = (prefix = 'Pass@') => {
  const randomChars = crypto.randomBytes(4).toString('hex');
  const randomNum = Math.floor(100 + Math.random() * 900);
  return `${prefix}${randomChars}${randomNum}`;
};

/**
 * Formats a date into YYYY-MM-DD string representation safely.
 *
 * @param {Date|string|number} value - Date input.
 * @returns {string} YYYY-MM-DD formatted date or empty string.
 */
export const dateOnly = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

/**
 * Checks whether an input is a valid date.
 *
 * @param {any} value - Value to test.
 * @returns {boolean}
 */
export const isValidDate = (value) => {
  if (!value) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
};

/**
 * Escapes regex special characters to prevent ReDoS and regex injection.
 *
 * @param {string} [str=''] - Search term.
 * @returns {string} Escaped search string.
 */
export const escapeRegex = (str = '') => {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Checks whether a given string or value is a valid MongoDB ObjectId.
 *
 * @param {any} value - Target value.
 * @returns {boolean}
 */
export const isValidObjectId = (value) => {
  return Boolean(value && mongoose.Types.ObjectId.isValid(String(value)));
};

/**
 * Safely parses a JSON string, returning a fallback value upon error.
 *
 * @param {string} jsonString - String to parse.
 * @param {any} [fallback=null] - Fallback value if parse fails.
 * @returns {any} Parsed value or fallback.
 */
export const safeParseJson = (jsonString, fallback = null) => {
  try {
    return JSON.parse(jsonString);
  } catch {
    return fallback;
  }
};

/**
 * Normalizes an array of attachments ensuring titles and URLs are populated.
 *
 * @param {Array<Record<string, any>>} [attachments=[]] - Attachments array.
 * @returns {Array<{title: string, url: string, type: string}>} Cleaned attachments.
 */
export const cleanAttachments = (attachments = []) => {
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((item) => item?.title || item?.url)
    .map((item) => ({
      title: item.title || item.url || 'Attachment',
      url: item.url || '',
      type: item.type || 'link',
    }));
};

/**
 * Formats a number into Indian Rupee Currency string.
 *
 * @param {number|string} [val=0] - Numeric amount.
 * @param {string} [currency='₹'] - Currency symbol.
 * @returns {string} Formatted currency.
 */
export const formatCurrency = (val = 0, currency = '₹') => {
  const n = Number(val);
  if (Number.isNaN(n)) return `${currency}0`;
  return `${currency}${n.toLocaleString('en-IN')}`;
};

/**
 * Formats a date into a localized string representation.
 *
 * @param {Date|string|number} date - Date to format.
 * @param {Intl.DateTimeFormatOptions} [options] - Format options.
 * @param {string} [fallback='—'] - Fallback string.
 * @returns {string}
 */
export const formatDate = (
  date,
  options = { day: 'numeric', month: 'short', year: 'numeric' },
  fallback = '—'
) => {
  if (!date) return fallback;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return String(date || fallback);
  return d.toLocaleDateString('en-IN', options);
};

/**
 * Formats date and time into a readable timestamp.
 *
 * @param {Date|string|number} date
 * @param {string} [fallback='—']
 * @returns {string}
 */
export const formatDateTime = (date, fallback = '—') => {
  if (!date) return fallback;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return String(date || fallback);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

/**
 * Month names list for server-side lookup.
 */
export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Converts a month name into a 1-based index (e.g., "January" -> 1).
 *
 * @param {string} monthName - Month name string.
 * @returns {number} 1-based month index (1-12).
 */
export const getMonthNumber = (monthName) => {
  if (!monthName) return new Date().getMonth() + 1;
  const target = String(monthName).toLowerCase().trim();
  const idx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === target);
  return idx > -1 ? idx + 1 : new Date().getMonth() + 1;
};

/**
 * Converts a month number (1-12 or 0-11) into a month name.
 *
 * @param {number|string} monthNum - Month number.
 * @param {boolean} [isZeroBased=false] - Whether monthNum is 0-indexed.
 * @returns {string} Month name.
 */
export const getMonthName = (monthNum, isZeroBased = false) => {
  const num = Number(monthNum);
  if (Number.isNaN(num)) return '';
  const idx = isZeroBased ? num : num - 1;
  return MONTH_NAMES[idx] || '';
};

/**
 * Parses and resolves month string and year number.
 *
 * @param {string} [monthStr] - e.g. "November 2026" or "November"
 * @param {number|string} [yearVal] - e.g. 2026
 * @returns {{ month: string, monthName: string, monthNumber: number, year: number }}
 */
export const parseMonthYear = (monthStr, yearVal) => {
  const now = new Date();
  const year = yearVal ? Number(yearVal) : now.getFullYear();
  let month = monthStr;
  if (!month) {
    month = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(now);
  }
  const monthName = String(month).split(' ')[0];
  const monthNumber = getMonthNumber(monthName);
  return { month, monthName, monthNumber, year };
};


