/**
 * @file gemini.provider.js
 * @description Google Gemini AI provider implementation.
 *
 * Uses the official @google/generative-ai SDK with function-calling support.
 * Normalizes responses to the same internal format as GroqProvider.
 *
 * Env vars:
 *   GEMINI_API_KEY  - required
 *   GEMINI_MODEL    - optional, defaults to 'gemini-1.5-flash'
 */

import { AIProvider } from './base.provider.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const DEFAULT_MODEL = 'gemini-2.0-flash';

/**
 * Pick the correct API version for a given Gemini model.
 * Experimental/preview models use v1beta; everything else uses v1.
 */
function getApiVersion(modelName) {
  const expPatterns = ['exp', 'preview', 'thinking', 'latest'];
  return expPatterns.some((p) => modelName.includes(p)) ? 'v1beta' : 'v1';
}

function buildGeminiUrl(modelName, apiKey) {
  const version = getApiVersion(modelName);
  return `${GEMINI_BASE}/${version}/models/${modelName}:generateContent?key=${apiKey}`;
}

export class GeminiProvider extends AIProvider {
  constructor() {
    super('Gemini');

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not set in environment variables.');
    }

    this.apiKey = apiKey;
    this.modelName = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  }

  /**
   * Send messages with tool-calling support using native fetch.
   * Gemini uses functionDeclarations and contents payload format.
   */
  async generateWithTools(messages, tools = [], options = {}) {
    const modelName = options.model || this.modelName;

    // Convert internal tools to Gemini's functionDeclarations
    const functionDeclarations = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: normalizeGeminiSchema(tool.parameters),
    }));

    const { systemInstruction, geminiHistory, lastUserMessage } =
      convertMessagesToGemini(messages);

    const contents = [...geminiHistory];
    if (lastUserMessage) {
      contents.push({
        role: 'user',
        parts: [{ text: lastUserMessage }],
      });
    }

    const requestBody = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.3,
        maxOutputTokens: options.maxTokens ?? 4096,
      },
    };

    if (systemInstruction) {
      requestBody.systemInstruction = {
        parts: [{ text: systemInstruction }],
      };
    }

    if (functionDeclarations.length > 0) {
      requestBody.tools = [{ functionDeclarations }];
    }

    const url = buildGeminiUrl(modelName, this.apiKey);
    let res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok && (res.status === 404 || res.status === 400)) {
      const fallbackGeminiModels = [
        'gemini-2.0-flash',
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-1.0-pro',
      ];
      for (const fallbackModel of fallbackGeminiModels) {
        if (fallbackModel === modelName) continue;
        try {
          const fallbackUrl = buildGeminiUrl(fallbackModel, this.apiKey);
          const fallbackRes = await fetch(fallbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });
          if (fallbackRes.ok) {
            res = fallbackRes;
            break;
          }
        } catch {}
      }
    }

    if (!res.ok) {
      const errText = await res.text();
      let parsed;
      try { parsed = JSON.parse(errText); } catch {}
      const errMsg = parsed?.error?.message || errText || res.statusText;
      const error = new Error(`Gemini API Error (${res.status}): ${errMsg}`);
      error.status = res.status;
      throw error;
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // Check for function calls
    const functionCalls = [];
    let textResult = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.functionCall) {
        functionCalls.push({
          id: `gemini-call-${i}-${part.functionCall.name}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
        });
      }
      if (part.text) {
        textResult += part.text;
      }
    }

    if (functionCalls.length > 0) {
      return {
        type: 'tool_calls',
        toolCalls: functionCalls,
        usage: data.usageMetadata || null,
      };
    }

    // Plain text
    return {
      type: 'text',
      text: textResult || '',
      usage: data.usageMetadata || null,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert our internal message array to Gemini's chat format.
 * - system messages      → systemInstruction (separate config field)
 * - user/assistant text  → history with text parts
 * - assistant tool_calls → history with functionCall parts (Gemini format)
 * - tool results         → history with functionResponse parts
 * - last user message    → extracted separately for the current turn
 */
function convertMessagesToGemini(messages) {
  let systemInstruction = '';
  const geminiHistory = [];
  let lastUserMessage = '';

  const nonSystem = messages.filter((m) => {
    if (m.role === 'system') {
      systemInstruction = m.content;
      return false;
    }
    return true;
  });

  // All messages except the last user message go into history
  const historyMessages = nonSystem.slice(0, -1);
  const lastMsg = nonSystem[nonSystem.length - 1];

  for (const msg of historyMessages) {
    // ── Assistant message with tool calls (function calls) ──────────────────
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      geminiHistory.push({
        role: 'model',
        parts: msg.tool_calls.map((tc) => ({
          functionCall: {
            name: tc.function.name,
            args: safeParseArgs(tc.function.arguments),
          },
        })),
      });
      continue;
    }

    // ── Tool result message ─────────────────────────────────────────────────
    if (msg.role === 'tool') {
      let responseData;
      try {
        responseData = typeof msg.content === 'string' ? JSON.parse(msg.content) : msg.content;
      } catch {
        responseData = { result: msg.content || '' };
      }
      geminiHistory.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: msg.name || 'unknown_tool',
            response: responseData,
          },
        }],
      });
      continue;
    }

    // ── Regular user / assistant text message ───────────────────────────────
    geminiHistory.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content || '' }],
    });
  }

  lastUserMessage = lastMsg?.content || '';

  return { systemInstruction, geminiHistory, lastUserMessage };
}

function safeParseArgs(args) {
  if (typeof args === 'object' && args !== null) return args;
  try { return JSON.parse(args); } catch { return {}; }
}

/**
 * Normalize a tool parameter schema to Gemini's format.
 * Gemini expects uppercase type strings: STRING, NUMBER, OBJECT, ARRAY, BOOLEAN.
 */
function normalizeGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return { type: 'OBJECT', properties: {} };
  }

  const result = { ...schema };

  // Uppercase type (Gemini requirement)
  if (typeof result.type === 'string') {
    result.type = result.type.toUpperCase();
  } else {
    result.type = 'OBJECT';
  }

  // Recursively normalize properties
  if (result.properties && typeof result.properties === 'object') {
    const normalized = {};
    for (const [key, val] of Object.entries(result.properties)) {
      normalized[key] = normalizeGeminiSchema(val);
    }
    result.properties = normalized;
  } else if (result.type === 'OBJECT') {
    result.properties = {};
  }

  if (result.items) {
    result.items = normalizeGeminiSchema(result.items);
  }

  return result;
}
