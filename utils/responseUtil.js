/**
 * @file responseUtil.js
 * @description Standardized API response utilities for consistent HTTP JSON responses.
 */

/**
 * Sends a standardized JSON success response.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {string} [message='Success'] - Human-readable success message.
 * @param {any} [data=null] - Primary data payload.
 * @param {number} [statusCode=200] - HTTP status code.
 * @param {Record<string, any>} [extra={}] - Additional response properties (pagination, meta, stats, etc.).
 * @returns {import('express').Response}
 */
export const sendSuccess = (res, message = 'Success', data = null, statusCode = 200, extra = {}) => {
  const response = {
    success: true,
    ...(message ? { message } : {}),
    ...(data !== null && data !== undefined ? { data } : {}),
    ...extra,
  };
  return res.status(statusCode).json(response);
};

/**
 * Sends a standardized 201 Created JSON response.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {string} [message='Resource created successfully'] - Success message.
 * @param {any} [data=null] - Created resource data.
 * @param {Record<string, any>} [extra={}] - Additional response properties.
 * @returns {import('express').Response}
 */
export const sendCreated = (res, message = 'Resource created successfully', data = null, extra = {}) => {
  return sendSuccess(res, message, data, 201, extra);
};

/**
 * Sends a standardized JSON error response.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {string|Error} [message='Internal Server Error'] - Error message or Error instance.
 * @param {number} [statusCode=500] - HTTP status code.
 * @param {any} [errors=null] - Detailed validation or field error messages.
 * @returns {import('express').Response}
 */
export const sendError = (res, message = 'Internal Server Error', statusCode = 500, errors = null) => {
  const errorMessage = typeof message === 'string' ? message : message?.message || 'Internal Server Error';
  const response = {
    success: false,
    message: errorMessage,
    ...(errors ? { errors } : {}),
  };
  return res.status(statusCode).json(response);
};

/**
 * Sends a 400 Bad Request error response.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {string} [message='Bad Request'] - Error message.
 * @param {any} [errors=null] - Optional validation errors.
 * @returns {import('express').Response}
 */
export const sendBadRequest = (res, message = 'Bad Request', errors = null) => {
  return sendError(res, message, 400, errors);
};

/**
 * Sends a 401 Unauthorized error response.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {string} [message='Unauthorized access'] - Error message.
 * @returns {import('express').Response}
 */
export const sendUnauthorized = (res, message = 'Unauthorized access') => {
  return sendError(res, message, 401);
};

/**
 * Sends a 403 Forbidden error response.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {string} [message='Access forbidden'] - Error message.
 * @returns {import('express').Response}
 */
export const sendForbidden = (res, message = 'Access forbidden') => {
  return sendError(res, message, 403);
};

/**
 * Sends a 404 Not Found error response.
 *
 * @param {import('express').Response} res - Express response object.
 * @param {string} [message='Resource not found'] - Error message.
 * @returns {import('express').Response}
 */
export const sendNotFound = (res, message = 'Resource not found') => {
  return sendError(res, message, 404);
};

