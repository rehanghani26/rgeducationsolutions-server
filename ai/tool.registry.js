/**
 * @file tool.registry.js
 * @description Central AI Tool Registry.
 *
 * This file is the single place to register all AI tools.
 * Adding a new tool requires:
 *   1. Create server/ai/tools/yourmodule.tools.js
 *   2. Import its definitions and executors here
 *   3. Spread them into the registry
 *
 * The rest of the system (tool.executor.js, ai.service.js) never
 * needs to change when new tools are added.
 */

import { studentToolDefinitions, studentToolExecutors } from './tools/student.tools.js';
import { attendanceToolDefinitions, attendanceToolExecutors } from './tools/attendance.tools.js';
import { teacherToolDefinitions, teacherToolExecutors } from './tools/teacher.tools.js';
import { feeToolDefinitions, feeToolExecutors } from './tools/fee.tools.js';
import { examToolDefinitions, examToolExecutors } from './tools/exam.tools.js';
import { resultToolDefinitions, resultToolExecutors } from './tools/result.tools.js';
import { settingsToolDefinitions, settingsToolExecutors } from './tools/settings.tools.js';
import { homeworkToolDefinitions, homeworkToolExecutors } from './tools/homework.tools.js';
import { noticeToolDefinitions, noticeToolExecutors } from './tools/notice.tools.js';
import { classToolDefinitions, classToolExecutors } from './tools/class.tools.js';
import { inventoryToolDefinitions, inventoryToolExecutors } from './tools/inventory.tools.js';
import { libraryToolDefinitions, libraryToolExecutors } from './tools/library.tools.js';
import { transportToolDefinitions, transportToolExecutors } from './tools/transport.tools.js';
import { timetableToolDefinitions, timetableToolExecutors } from './tools/timetable.tools.js';
import { dashboardToolDefinitions, dashboardToolExecutors } from './tools/dashboard.tools.js';
import { onlineClassToolDefinitions, onlineClassToolExecutors } from './tools/online-class.tools.js';

// ─── Combined Definitions (schema for the AI model) ──────────────────────────

/**
 * All tool definitions — passed to the AI provider on each request.
 * The AI selects tools from this list based on user intent.
 * @type {Array<{name: string, description: string, parameters: object}>}
 */
export const ALL_TOOL_DEFINITIONS = [
  ...studentToolDefinitions,
  ...attendanceToolDefinitions,
  ...teacherToolDefinitions,
  ...feeToolDefinitions,
  ...examToolDefinitions,
  ...resultToolDefinitions,
  ...settingsToolDefinitions,
  ...homeworkToolDefinitions,
  ...noticeToolDefinitions,
  ...classToolDefinitions,
  ...inventoryToolDefinitions,
  ...libraryToolDefinitions,
  ...transportToolDefinitions,
  ...timetableToolDefinitions,
  ...dashboardToolDefinitions,
  ...onlineClassToolDefinitions,
];

// ─── Combined Executors (implementation functions) ────────────────────────────

/**
 * All tool executor functions — keyed by tool name.
 * @type {Record<string, Function>}
 */
const ALL_EXECUTORS = {
  ...studentToolExecutors,
  ...attendanceToolExecutors,
  ...teacherToolExecutors,
  ...feeToolExecutors,
  ...examToolExecutors,
  ...resultToolExecutors,
  ...settingsToolExecutors,
  ...homeworkToolExecutors,
  ...noticeToolExecutors,
  ...classToolExecutors,
  ...inventoryToolExecutors,
  ...libraryToolExecutors,
  ...transportToolExecutors,
  ...timetableToolExecutors,
  ...dashboardToolExecutors,
  ...onlineClassToolExecutors,
};

// Build a Set of approved tool names for O(1) lookup
const APPROVED_TOOLS = new Set(Object.keys(ALL_EXECUTORS));

// ─── Registry API ─────────────────────────────────────────────────────────────

/**
 * Check if a tool name is registered and safe to execute.
 * @param {string} toolName
 * @returns {boolean}
 */
export function isToolRegistered(toolName) {
  return APPROVED_TOOLS.has(toolName);
}

/**
 * Get the executor function for a registered tool.
 * Returns null if the tool is not registered.
 * @param {string} toolName
 * @returns {Function|null}
 */
export function getToolExecutor(toolName) {
  return ALL_EXECUTORS[toolName] || null;
}

/**
 * Get all registered tool names (for logging/debugging).
 * @returns {string[]}
 */
export function getRegisteredToolNames() {
  return [...APPROVED_TOOLS];
}

/**
 * Get all tool definitions for the AI provider.
 * @returns {Array}
 */
export function getAllToolDefinitions() {
  return ALL_TOOL_DEFINITIONS;
}
