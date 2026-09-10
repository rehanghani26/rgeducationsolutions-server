/**
 * @file base.provider.js
 * @description Abstract base class for AI providers.
 *
 * All provider implementations (Groq, Gemini) must extend this class
 * and implement the generateWithTools() method.
 *
 * This ensures the rest of the application (ai.service.js) never
 * needs to know which provider is in use.
 */

export class AIProvider {
  /**
   * @param {string} name - Human-readable provider name (e.g. 'Groq', 'Gemini')
   */
  constructor(name) {
    this.name = name;
  }

  /**
   * Send messages to the AI with tool/function-calling support.
   *
   * @param {Array<{role: string, content: string}>} messages
   *   Conversation history including system prompt as first message.
   *   roles: 'system' | 'user' | 'assistant'
   *
   * @param {Array<object>} tools
   *   Tool definitions in the provider-specific format (normalized by each provider).
   *
   * @param {object} [options]
   * @param {string} [options.model] - Override model name
   * @param {number} [options.maxTokens] - Max output tokens
   * @param {number} [options.temperature] - Sampling temperature
   *
   * @returns {Promise<AIResponse>}
   */
  async generateWithTools(messages, tools, options = {}) {
    throw new Error(`${this.name}.generateWithTools() is not implemented`);
  }
}

/**
 * @typedef {object} AIResponse
 * @property {'text'|'tool_call'|'tool_calls'} type - Response type
 * @property {string} [text] - Final text content (when type === 'text')
 * @property {AIToolCall[]} [toolCalls] - Tool calls requested by model
 * @property {object} [usage] - Token usage stats
 */

/**
 * @typedef {object} AIToolCall
 * @property {string} id - Unique call ID
 * @property {string} name - Tool function name
 * @property {object} arguments - Parsed JSON arguments
 */
