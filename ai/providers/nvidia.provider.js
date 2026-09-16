/**
 * @file nvidia.provider.js
 * @description NVIDIA AI provider — OpenAI-compatible interface for NVIDIA NIM APIs.
 *
 * Env vars:
 *   NVIDIA_API_KEY   - required (e.g. 'nvapi-...')
 *   NVIDIA_BASE_URL  - optional, defaults to 'https://integrate.api.nvidia.com/v1'
 *   NVIDIA_MODEL     - optional, defaults to 'nvidia/nemotron-3-super-120b-a12b'
 */

import { AIProvider } from './base.provider.js';

const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
const DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export class NvidiaProvider extends AIProvider {
  constructor() {
    super('NVIDIA');

    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      throw new Error('NVIDIA_API_KEY is not set in environment variables.');
    }

    this.apiKey = apiKey;
    this.baseURL = (process.env.NVIDIA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = process.env.NVIDIA_MODEL || DEFAULT_MODEL;
    this.client = null;
    this._initClient();
  }

  async _initClient() {
    try {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.baseURL,
      });
    } catch {
      // openai package not installed or failed to load; native fetch will be used seamlessly
      this.client = null;
    }
  }

  /**
   * Send messages with tool-calling or completion support via NVIDIA NIM API.
   */
  async generateWithTools(messages, tools = [], options = {}) {
    const model = options.model || this.model;

    // Convert internal tool definitions to OpenAI/NVIDIA function format
    const nvidiaTools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: normalizeSchema(tool.parameters),
      },
    }));

    const requestParams = {
      model,
      messages: sanitizeMessages(messages),
      temperature: options.temperature ?? 0.5,
      max_tokens: options.maxTokens ?? 1024,
      top_p: options.topP ?? 1,
    };

    if (nvidiaTools.length > 0) {
      requestParams.tools = nvidiaTools;
      requestParams.tool_choice = 'auto';
    }

    let completionData;

    try {
      completionData = await this._callApi(requestParams);
    } catch (err) {
      // If the selected model does not support tools/function calling, retry without tools
      const errLower = (err.message || '').toLowerCase();
      if (
        requestParams.tools &&
        (errLower.includes('tool') ||
          errLower.includes('function') ||
          errLower.includes('not supported') ||
          errLower.includes('unknown parameter') ||
          errLower.includes('400'))
      ) {
        console.warn(
          `[NVIDIA Provider] Model "${model}" failed with tools parameter. Retrying without tools...`
        );
        delete requestParams.tools;
        delete requestParams.tool_choice;
        requestParams.messages = sanitizeMessagesWithoutTools(messages);
        completionData = await this._callApi(requestParams);
      } else {
        throw err;
      }
    }

    const choice = completionData.choices?.[0];
    if (!choice) {
      throw new Error('NVIDIA AI returned no choices in response.');
    }

    const message = choice.message;

    // Model requested tool calls
    if (message?.tool_calls?.length > 0) {
      return {
        type: 'tool_calls',
        toolCalls: message.tool_calls.map((tc) => ({
          id: tc.id || `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: tc.function?.name,
          arguments: safeParseJson(tc.function?.arguments),
        })),
        rawMessage: message,
        usage: completionData.usage,
      };
    }

    // Plain text response
    return {
      type: 'text',
      text: message?.content || '',
      usage: completionData.usage,
    };
  }

  async _callApi(params) {
    if (!this.client) {
      await this._initClient();
    }

    if (this.client) {
      return await this.client.chat.completions.create(params);
    }

    // Fallback using global fetch (built into modern Node.js)
    const url = `${this.baseURL}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errorText = await res.text();
      let errorJson;
      try {
        errorJson = JSON.parse(errorText);
      } catch {}
      const errMsg = errorJson?.error?.message || errorText || `HTTP ${res.status} ${res.statusText}`;
      throw new Error(`NVIDIA API Error (${res.status}): ${errMsg}`);
    }

    return await res.json();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

  delete result.format;

  return result;
}

function safeParseJson(str) {
  if (!str) return {};
  if (typeof str === 'object') return str;
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

function sanitizeMessages(messages) {
  return messages.map((m) => {
    const msg = { role: m.role };
    if (m.content !== undefined) msg.content = m.content;
    if (m.tool_calls) msg.tool_calls = m.tool_calls;
    if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
    if (m.name) msg.name = m.name;
    return msg;
  });
}

function sanitizeMessagesWithoutTools(messages) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'user',
        content: `[Tool Result for ${m.name || 'tool'}]: ${m.content}`,
      };
    }
    if (m.role === 'assistant' && !m.content && m.tool_calls) {
      return {
        role: 'assistant',
        content: `[Action: calling ${m.tool_calls.map((t) => t.function?.name).join(', ')}]`,
      };
    }
    return {
      role: m.role === 'model' ? 'assistant' : m.role,
      content: m.content || '',
    };
  });
}
