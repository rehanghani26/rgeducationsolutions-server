/**
 * @file tool.parser.js
 * @description Extracts structured tool calls from raw LLM text responses.
 *
 * Handles models (such as reasoning models or text-only completions) that emit
 * tool calls as JSON in their textual output instead of OpenAI structured tool_calls.
 *
 * Supported formats:
 *   1. Plain JSON: {"tool": "getStudents", "arguments": {}}
 *   2. OpenAI style: {"name": "getStudents", "arguments": {}}
 *   3. Wrapped in tool_calls: {"tool_calls": [{"name": "getStudents", "arguments": {}}]}
 *   4. Markdown code blocks: ```json\n{"tool": "getStudents", "arguments": {}}\n```
 *   5. JSON arrays: [{"tool": "getStudents", "arguments": {}}]
 */

import { isToolRegistered, resolveToolName } from './tool.registry.js';

/**
 * Parses text and returns an array of valid tool calls, or an empty array if none found.
 *
 * @param {string} text - Raw model text
 * @returns {Array<{id: string, name: string, arguments: object}>}
 */
export function parseTextToolCalls(text) {
  if (!text || typeof text !== 'string') return [];

  const foundCalls = [];
  const seenKeys = new Set();

  const tryAdd = (obj) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;

    // Check { tool_calls: [...] }
    if (Array.isArray(obj.tool_calls) && obj.tool_calls.length > 0) {
      let added = false;
      for (const tc of obj.tool_calls) {
        const candidateName = tc.function?.name || tc.name;
        if (candidateName && isToolRegistered(candidateName)) {
          let args = tc.function?.arguments || tc.arguments || {};
          if (typeof args === 'string') {
            try { args = JSON.parse(args); } catch {}
          }
          const name = resolveToolName(candidateName);
          const key = `${name}:${JSON.stringify(args)}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            foundCalls.push({
              id: tc.id || `text_call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              name,
              arguments: typeof args === 'object' && args !== null ? args : {},
            });
            added = true;
          }
        }
      }
      return added;
    }

    // Check { tool: "...", arguments: ... } or { name: "...", arguments: ... } or { action: "...", parameters: ... }
    const candidateName = obj.tool || obj.name || obj.action || obj.function;
    if (typeof candidateName === 'string' && isToolRegistered(candidateName)) {
      const name = resolveToolName(candidateName);
      let args = obj.arguments ?? obj.parameters ?? obj.args ?? {};
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch {}
      }
      const key = `${name}:${JSON.stringify(args)}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        foundCalls.push({
          id: `text_call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name,
          arguments: typeof args === 'object' && args !== null ? args : {},
        });
        return true;
      }
    }

    return false;
  };

  const trimmed = text.trim();

  // 1. Check if the entire text is valid JSON (object or array)
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        for (const item of parsed) tryAdd(item);
      } else {
        tryAdd(parsed);
      }
      if (foundCalls.length > 0) return foundCalls;
    } catch {}
  }

  // 2. Extract JSON from markdown fenced code blocks (```json ... ``` or ``` ... ```)
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let cbMatch;
  while ((cbMatch = codeBlockRegex.exec(text)) !== null) {
    const rawBlock = cbMatch[1].trim();
    if (rawBlock.startsWith('{') || rawBlock.startsWith('[')) {
      try {
        const parsed = JSON.parse(rawBlock);
        if (Array.isArray(parsed)) {
          for (const item of parsed) tryAdd(item);
        } else {
          tryAdd(parsed);
        }
      } catch {}
    }
  }
  if (foundCalls.length > 0) return foundCalls;

  // 3. Scan for standalone or embedded JSON objects using balanced brace extraction
  const jsonObjectRegex = /\{(?:[^{}]|(?:\{[^{}]*\}))*\}/g;
  let objMatch;
  while ((objMatch = jsonObjectRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      tryAdd(parsed);
    } catch {}
  }

  return foundCalls;
}
