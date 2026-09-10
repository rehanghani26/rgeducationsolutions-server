/**
 * @file groq.provider.js
 * @description Groq AI provider — uses the official groq-sdk.
 *
 * Env vars:
 *   GROQ_API_KEY  - required  (get from https://console.groq.com/keys)
 *   GROQ_MODEL    - optional, defaults to 'llama-3.3-70b-versatile'
 */

import Groq from 'groq-sdk';
import { AIProvider } from './base.provider.js';

const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

export class GroqProvider extends AIProvider {
  constructor() {
    super('Groq');

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is not set in environment variables.');
    }

    this.client = new Groq({ apiKey });
    this.model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  }

  /**
   * Send messages with tool-calling support via groq-sdk.
   * The SDK uses the same OpenAI-compatible format for tools and messages.
   */
  async generateWithTools(messages, tools = [], options = {}) {
    const model = options.model || this.model;

    // Convert internal tool definitions to Groq (OpenAI) format
    const groqTools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: normalizeSchema(tool.parameters),
      },
    }));

    const requestParams = {
      model,
      messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 4096,
    };

    if (groqTools.length > 0) {
      requestParams.tools = groqTools;
      requestParams.tool_choice = 'auto';
    }

    const completion = await this.client.chat.completions.create(requestParams);

    const choice = completion.choices?.[0];
    if (!choice) {
      throw new Error('Groq returned no choices in response.');
    }

    const message = choice.message;

    // Model wants to call tools
    if (message.tool_calls?.length > 0) {
      return {
        type: 'tool_calls',
        toolCalls: message.tool_calls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: safeParseJson(tc.function.arguments),
        })),
        rawMessage: message,
        usage: completion.usage,
      };
    }

    // Plain text response
    return {
      type: 'text',
      text: message.content || '',
      usage: completion.usage,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Normalize tool parameter schema to standard JSON Schema (lowercase types).
 * Handles any Gemini-style uppercase types that may come from tool definitions.
 */
function normalizeSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }

  const result = { ...schema };

  if (typeof result.type === 'string') {
    result.type = result.type.toLowerCase();
  } else {
    result.type = 'object';
  }

  if (result.properties && typeof result.properties === 'object') {
    const normalized = {};
    for (const [key, val] of Object.entries(result.properties)) {
      normalized[key] = normalizeSchema(val);
    }
    result.properties = normalized;
  } else if (result.type === 'object') {
    result.properties = {};
  }

  if (result.items) {
    result.items = normalizeSchema(result.items);
  }

  // Remove Gemini-specific fields not valid in JSON Schema
  delete result.format;

  return result;
}

function safeParseJson(str) {
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}
