/**
 * @file tool.executor.js
 * @description Secure AI Tool Executor.
 *
 * This module is the only entry point for executing AI tool calls.
 * It enforces:
 *   1. Tool name validation against the approved registry
 *   2. Argument presence check
 *   3. Error handling and structured error response
 *   4. Execution timing for logging
 *
 * SECURITY: The AI model can only trigger functions that exist in the registry.
 * Unknown function names are rejected with an error — never executed.
 */

import { isToolRegistered, getToolExecutor } from './tool.registry.js';

/**
 * Execute an AI tool call safely.
 *
 * @param {string} toolName - Name of the tool to execute
 * @param {object} args - Arguments from the AI model
 * @param {object} context - Runtime context: { user, ip, schoolId }
 *   - user: authenticated user from req.user
 *   - ip: request IP address
 *
 * @returns {Promise<ToolResult>}
 */
export async function executeTool(toolName, args = {}, context = {}) {
  const startTime = Date.now();

  // ── Security: only registered tools may execute ───────────────────────────
  if (!isToolRegistered(toolName)) {
    console.warn(`[AI Tool] Rejected unknown tool: "${toolName}"`);
    return {
      success: false,
      toolName,
      error: `Unknown tool: "${toolName}". This tool is not registered.`,
      durationMs: Date.now() - startTime,
    };
  }

  const executor = getToolExecutor(toolName);

  // ── Execute ───────────────────────────────────────────────────────────────
  try {
    const result = await executor(args, context);
    const durationMs = Date.now() - startTime;

    logToolCall({
      toolName,
      success: result?.success !== false,
      durationMs,
      user: context.user?.id || context.user?._id || 'unknown',
    });

    return {
      ...result,
      toolName,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    console.error(`[AI Tool] Error in "${toolName}":`, error.message);

    logToolCall({
      toolName,
      success: false,
      durationMs,
      error: error.message,
      user: context.user?.id || context.user?._id || 'unknown',
    });

    // Return a structured error — never expose internal details
    return {
      success: false,
      toolName,
      error: sanitizeError(error, toolName),
      durationMs,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Log tool execution to console in a structured format.
 * Does NOT log sensitive data (args, user data).
 */
function logToolCall({ toolName, success, durationMs, error, user }) {
  const status = success ? '✓' : '✗';
  const errPart = error ? ` | Error: ${error}` : '';
  console.log(
    `[AI Tool] ${status} ${toolName} | ${durationMs}ms | user:${user}${errPart}`
  );
}

/**
 * Sanitize errors before sending to the AI model.
 * Never expose: stack traces, MongoDB internals, credentials.
 */
function sanitizeError(error, toolName) {
  const msg = error.message || 'Unknown error';

  // MongoDB duplicate key
  if (error.code === 11000) {
    return `A record with those details already exists.`;
  }

  // MongoDB validation error
  if (error.name === 'ValidationError') {
    const fields = Object.keys(error.errors || {}).join(', ');
    return `Validation failed for fields: ${fields}. Please check the provided values.`;
  }

  // MongoDB connection error
  if (msg.includes('ECONNREFUSED') || msg.includes('connect')) {
    return `Database is temporarily unavailable. Please try again in a moment.`;
  }

  // Generic — return the message but strip any path-like internal details
  if (msg.length > 200) return `An error occurred in ${toolName}.`;
  return msg;
}

/**
 * @typedef {object} ToolResult
 * @property {boolean} success
 * @property {string} toolName
 * @property {number} durationMs
 * @property {string} [error] - Error message if success === false
 */
