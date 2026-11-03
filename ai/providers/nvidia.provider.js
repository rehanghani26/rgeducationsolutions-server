// 2. External packages
import OpenAI from "openai";

// 8. Base Provider
import { AIProvider } from "./base.provider.js";

// ════════════════════════════════════════════════════════════════════════════════
// 1. ALL AVAILABLE NVIDIA MODELS (Constants)
// ════════════════════════════════════════════════════════════════════════════════
export const MODEL_NVIDIA_3_5    = "nvidia/nemotron-3.5-lightning-30b-a3b";        // NVIDIA Nemotron 3.5 (High Performance + Thinking)
export const MODEL_NVIDIA_3      = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"; // NVIDIA Nemotron 3 (Nano Reasoning)
export const MODEL_LLAMA_3_3_70B = "meta/llama-3.3-70b-instruct";                 // Meta Llama 3.3 70B (Full Tool Calling)
export const MODEL_LLAMA_3_1_70B = "meta/llama-3.1-70b-instruct";                 // Meta Llama 3.1 70B (Full Tool Calling)
export const MODEL_NEMOTRON_70B  = "nvidia/llama-3.1-nemotron-70b-instruct";       // NVIDIA Nemotron 70B
export const MODEL_LLAMA_3_1_8B  = "meta/llama-3.1-8b-instruct";                  // Meta Llama 3.1 8B (Fast / Lightweight)

// ════════════════════════════════════════════════════════════════════════════════
// 2. ACTIVE MODEL SELECTOR
// 👉 Change ONLY this one variable to switch models everywhere automatically!
// ════════════════════════════════════════════════════════════════════════════════
export const SELECTED_MODEL = MODEL_NVIDIA_3_5;
// export const SELECTED_MODEL = MODEL_NVIDIA_3;
// export const SELECTED_MODEL = MODEL_LLAMA_3_3_70B;
// export const SELECTED_MODEL = MODEL_LLAMA_3_1_70B;
// export const SELECTED_MODEL = MODEL_NEMOTRON_70B;
// export const SELECTED_MODEL = MODEL_LLAMA_3_1_8B;

export const DEFAULT_MODEL = SELECTED_MODEL;
export const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";

// ════════════════════════════════════════════════════════════════════════════════
// 3. ADAPTIVE MODEL PROFILES & HYPERPARAMETERS
// When you change SELECTED_MODEL, all parameters adapt automatically!
// ════════════════════════════════════════════════════════════════════════════════
export const MODEL_PROFILES = {
  [MODEL_NVIDIA_3_5]: {
    id: MODEL_NVIDIA_3_5,
    displayName: "NVIDIA Nemotron 3.5 Lightning (30B)",
    isReasoning: true,
    supportsTools: false,
    temperature: 1,
    top_p: 0.95,
    max_tokens: 16384,
    reasoning_budget: 16384,
    chat_template_kwargs: { enable_thinking: true },
  },
  [MODEL_NVIDIA_3]: {
    id: MODEL_NVIDIA_3,
    displayName: "NVIDIA Nemotron 3 Nano Omni (30B)",
    isReasoning: true,
    supportsTools: false,
    temperature: 0.6,
    top_p: 0.95,
    max_tokens: 16384,
    reasoning_budget: 16384,
    chat_template_kwargs: { enable_thinking: true },
  },
  [MODEL_LLAMA_3_3_70B]: {
    id: MODEL_LLAMA_3_3_70B,
    displayName: "Meta Llama 3.3 70B Instruct",
    isReasoning: false,
    supportsTools: true,
    temperature: 0.5,
    top_p: 1,
    max_tokens: 4096,
  },
  [MODEL_LLAMA_3_1_70B]: {
    id: MODEL_LLAMA_3_1_70B,
    displayName: "Meta Llama 3.1 70B Instruct",
    isReasoning: false,
    supportsTools: true,
    temperature: 0.5,
    top_p: 1,
    max_tokens: 4096,
  },
  [MODEL_NEMOTRON_70B]: {
    id: MODEL_NEMOTRON_70B,
    displayName: "NVIDIA Llama 3.1 Nemotron 70B",
    isReasoning: false,
    supportsTools: true,
    temperature: 0.5,
    top_p: 1,
    max_tokens: 4096,
  },
  [MODEL_LLAMA_3_1_8B]: {
    id: MODEL_LLAMA_3_1_8B,
    displayName: "Meta Llama 3.1 8B Instruct",
    isReasoning: false,
    supportsTools: true,
    temperature: 0.5,
    top_p: 1,
    max_tokens: 2048,
  },
};

/**
 * Returns the full profile & settings for any model name.
 *
 * @param {string} [modelName]
 * @returns {object} Model profile with optimal parameters
 */
export function getModelProfile(modelName = SELECTED_MODEL) {
  if (MODEL_PROFILES[modelName]) {
    return MODEL_PROFILES[modelName];
  }

  const isReasoning =
    modelName.includes("3.5") ||
    modelName.includes("reasoning") ||
    modelName.includes("lightning");

  return {
    id: modelName,
    displayName: modelName,
    isReasoning,
    supportsTools: !isReasoning,
    temperature: isReasoning ? 1 : 0.7,
    top_p: isReasoning ? 0.95 : 1,
    max_tokens: isReasoning ? 16384 : 4096,
    reasoning_budget: isReasoning ? 16384 : undefined,
    chat_template_kwargs: isReasoning ? { enable_thinking: true } : undefined,
  };
}

// Fallback candidates if active model returns 404
const RELIABLE_NVIDIA_MODELS = [
  MODEL_NVIDIA_3_5,
  MODEL_NVIDIA_3,
  MODEL_LLAMA_3_3_70B,
  MODEL_LLAMA_3_1_70B,
  MODEL_NEMOTRON_70B,
  MODEL_LLAMA_3_1_8B,
];

// ════════════════════════════════════════════════════════════════════════════════
// 4. NVIDIA AI PROVIDER CLASS
// ════════════════════════════════════════════════════════════════════════════════
export class NvidiaProvider extends AIProvider {
  constructor() {
    super("NVIDIA");

    const apiKey =
      process.env.NVIDIA_API_KEY ||
      "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";
    if (!apiKey) {
      throw new Error("NVIDIA_API_KEY is not set in environment variables.");
    }

    this.apiKey = apiKey;
    this.baseURL = (process.env.NVIDIA_BASE_URL || DEFAULT_BASE_URL).replace(
      /\/+$/,
      ""
    );
    this.model = process.env.NVIDIA_MODEL || SELECTED_MODEL;

    // Direct OpenAI SDK client initialized with NVIDIA endpoints
    this.client = new OpenAI({
      apiKey: this.apiKey,
      baseURL: this.baseURL,
    });
  }

  async _initClient() {
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.baseURL,
      });
    }
  }

  /**
   * Send messages with tool-calling or completion support via NVIDIA NIM API.
   */
  async generateWithTools(messages, tools = [], options = {}) {
    const targetModel = options.model || this.model;
    const profile = getModelProfile(targetModel);

    // If model does not support tools (e.g. reasoning models), ignore tools safely
    const effectiveTools = profile.supportsTools ? tools : [];

    const nvidiaTools = effectiveTools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: normalizeSchema(tool.parameters),
      },
    }));

    const requestParams = {
      model: targetModel,
      messages: sanitizeMessages(messages),
      temperature: options.temperature ?? profile.temperature,
      max_tokens: options.maxTokens ?? profile.max_tokens,
      top_p: options.topP ?? profile.top_p,
    };

    // Attach thinking/reasoning parameters if the model supports it
    if (profile.isReasoning) {
      requestParams.reasoning_budget =
        options.reasoningBudget ?? profile.reasoning_budget ?? 16384;
      requestParams.chat_template_kwargs =
        options.chat_template_kwargs ??
        profile.chat_template_kwargs ?? { enable_thinking: true };
    }

    if (nvidiaTools.length > 0) {
      requestParams.tools = nvidiaTools;
      requestParams.tool_choice = "auto";
    }

    let completionData;

    try {
      completionData = await this._callApi(requestParams);
    } catch (err) {
      const errLower = (err.message || "").toLowerCase();

      // If the model returns 404, try other candidate models in the list
      if (
        err.status === 404 ||
        errLower.includes("404") ||
        errLower.includes("not found")
      ) {
        console.warn(
          `[NVIDIA Provider] Model "${requestParams.model}" returned 404. Retrying with fallback models...`
        );
        const candidates = RELIABLE_NVIDIA_MODELS.filter(
          (m) => m !== requestParams.model
        );
        for (const candidate of candidates) {
          try {
            console.warn(`[NVIDIA Provider] Retrying with "${candidate}"...`);
            requestParams.model = candidate;
            const candProfile = getModelProfile(candidate);
            if (!candProfile.supportsTools) {
              delete requestParams.tools;
              delete requestParams.tool_choice;
            }
            completionData = await this._callApi(requestParams);
            this.model = candidate;
            break;
          } catch {
            // try next
          }
        }
      }

      // If model failed because of tools parameter, retry without tools
      if (!completionData && requestParams.tools) {
        if (
          errLower.includes("tool") ||
          errLower.includes("function") ||
          errLower.includes("not supported") ||
          errLower.includes("unknown parameter") ||
          errLower.includes("400")
        ) {
          console.warn(
            `[NVIDIA Provider] Model "${targetModel}" failed with tools. Retrying in text-only mode...`
          );
          delete requestParams.tools;
          delete requestParams.tool_choice;
          requestParams.messages = sanitizeMessagesWithoutTools(messages);
          completionData = await this._callApi(requestParams);
        }
      }

      if (!completionData) {
        throw err;
      }
    }

    const choice = completionData.choices?.[0];
    if (!choice) {
      throw new Error("NVIDIA AI returned no choices in response.");
    }

    const message = choice.message;

    // Model requested tool calls
    if (message?.tool_calls?.length > 0) {
      return {
        type: "tool_calls",
        toolCalls: message.tool_calls.map((tc) => ({
          id:
            tc.id ||
            `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: tc.function?.name,
          arguments: safeParseJson(tc.function?.arguments),
        })),
        rawMessage: message,
        usage: completionData.usage,
      };
    }

    // Plain text response with reasoning support
    return {
      type: "text",
      text: message?.content || "",
      reasoning: message?.reasoning_content || "",
      usage: completionData.usage,
    };
  }

  /**
   * Stream completion chunks with real-time reasoning_content output.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @param {object} [options]
   * @param {function({reasoning: string, content: string, chunk: object}): void} [onChunk]
   * @returns {Promise<{text: string, reasoning: string}>}
   */
  async streamCompletion(messages, options = {}, onChunk = null) {
    const targetModel = options.model || this.model;
    const profile = getModelProfile(targetModel);

    const requestParams = {
      model: targetModel,
      messages: sanitizeMessages(messages),
      temperature: options.temperature ?? profile.temperature,
      top_p: options.topP ?? profile.top_p,
      max_tokens: options.maxTokens ?? profile.max_tokens,
      stream: true,
    };

    if (profile.isReasoning) {
      requestParams.reasoning_budget =
        options.reasoningBudget ?? profile.reasoning_budget ?? 16384;
      requestParams.chat_template_kwargs =
        options.chat_template_kwargs ??
        profile.chat_template_kwargs ?? { enable_thinking: true };
    }

    const stream = await this.client.chat.completions.create(requestParams);
    let fullContent = "";
    let fullReasoning = "";

    for await (const chunk of stream) {
      const reasoning = chunk.choices[0]?.delta?.reasoning_content || "";
      const content = chunk.choices[0]?.delta?.content || "";

      if (reasoning) {
        fullReasoning += reasoning;
      }
      if (content) {
        fullContent += content;
      }

      if (onChunk) {
        onChunk({ reasoning, content, chunk });
      }
    }

    return { text: fullContent, reasoning: fullReasoning };
  }

  async _callApi(params) {
    if (this.client) {
      return await this.client.chat.completions.create(params);
    }

    const url = `${this.baseURL}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
      const errMsg =
        errorJson?.error?.message ||
        errorText ||
        `HTTP ${res.status} ${res.statusText}`;
      throw new Error(`NVIDIA API Error (${res.status}): ${errMsg}`);
    }

    return await res.json();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeSchema(schema) {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }

  const result = { ...schema };

  if (typeof result.type === "string") {
    result.type = result.type.toLowerCase();
  } else {
    result.type = "object";
  }

  if (result.properties && typeof result.properties === "object") {
    const normalized = {};
    for (const [key, val] of Object.entries(result.properties)) {
      normalized[key] = normalizeSchema(val);
    }
    result.properties = normalized;
  } else if (result.type === "object") {
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
  if (typeof str === "object") return str;
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
    if (m.role === "tool") {
      return {
        role: "user",
        content: `[Tool Result for ${m.name || "tool"}]: ${m.content}`,
      };
    }
    if (m.role === "assistant" && !m.content && m.tool_calls) {
      return {
        role: "assistant",
        content: `[Action: calling ${m.tool_calls.map((t) => t.function?.name).join(", ")}]`,
      };
    }
    return {
      role: m.role === "model" ? "assistant" : m.role,
      content: m.content || "",
    };
  });
}
