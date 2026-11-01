// 7. Utilities
import { sendError } from '../utils/responseUtil.js';

/**
 * @file errorHandler.js
 * @description Centralized Express error-handling middleware.
 */

/**
 * Async handler wrapper to catch and forward errors to centralized error middleware.
 *
 * @param {Function} fn - Async controller function (req, res, next).
 * @returns {import('express').RequestHandler}
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Centralized error handler middleware for Express.
 *
 * @param {Error} err - Error instance.
 * @param {import('express').Request} req - Express request.
 * @param {import('express').Response} res - Express response.
 * @param {import('express').NextFunction} next - Express next function.
 */
export const errorHandler = (err, req, res, next) => {
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    console.error('Unhandled Server Error:', err);
  } else {
    console.error(`[Error] ${req.method} ${req.originalUrl || req.url}: ${err.message}`);
  }

  // Handle Mongoose CastError (invalid ObjectId)
  if (err.name === 'CastError') {
    return sendError(res, `Resource not found with id of ${err.value}`, 400);
  }

  // Handle Mongoose Duplicate Key Error (E11000)
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return sendError(res, `Duplicate value entered for ${field}. Please use another value.`, 409);
  }

  // Handle Mongoose Validation Error
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors || {}).map((val) => val.message);
    return sendError(res, 'Validation failed', 400, errors);
  }

  // Handle JWT Errors
  if (err.name === 'JsonWebTokenError') {
    return sendError(res, 'Invalid token. Please log in again.', 401);
  }
  if (err.name === 'TokenExpiredError') {
    return sendError(res, 'Your token has expired. Please log in again.', 401);
  }

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';

  const payload = {
    success: false,
    message,
    ...(isDev && err.stack ? { stack: err.stack } : {}),
  };

  return res.status(statusCode).json(payload);
};

