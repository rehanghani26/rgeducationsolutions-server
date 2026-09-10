/**
 * @file ai.service.js
 * @description Core AI Service — the agentic loop.
 */

import { getProvider, getFallbackProvider } from './providers/index.js';
import { getAllToolDefinitions } from './tool.registry.js';
import { executeTool } from './tool.executor.js';
import { buildSystemPrompt, getCurrentDate } from './system.prompt.js';

const MAX_TOOL_ITERATIONS = 6;
const MAX_HISTORY_MESSAGES = 20; // Limit history sent to model to control token cost

/**
 * Main AI chat function.
 *
 * @param {object} params
 * @param {string} params.userMessage - The user's latest message
 * @param {Array<{role:string,content:string}>} params.conversationHistory - Previous messages (user + assistant)
 * @param {object} params.user - Authenticated user (req.user)
 * @param {string} params.ip - Request IP address
 *
 * @returns {Promise<AiServiceResult>}
 */
export async function processAiChat({
  userMessage,
  conversationHistory = [],
  user,
  ip,
}) {
  if (!userMessage?.trim()) {
    throw new Error("User message cannot be empty.");
  }

  const currentDate = getCurrentDate();
  const systemPrompt = buildSystemPrompt(user, currentDate);
  const toolDefinitions = getAllToolDefinitions();
  const context = { user, ip };

  // Build messages array for the model
  // Limit history to last N messages to control cost
  const recentHistory = conversationHistory.slice(-MAX_HISTORY_MESSAGES);

  const messages = [
    { role: "system", content: systemPrompt },
    ...recentHistory.map((m) => ({
      role: m.role === "model" || m.role === "assistant" ? "assistant" : "user",
      content: m.content || "",
    })),
    { role: "user", content: userMessage },
  ];

  const toolCallLog = [];

  // Run the agentic loop
  let response = await callProviderWithFallback(messages, toolDefinitions);

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    if (response.type !== "tool_calls" || !response.toolCalls?.length) {
      break; // Model returned text — done
    }

    // Execute all tool calls from this model response
    const toolResults = await Promise.all(
      response.toolCalls.map(async (tc) => {
        const result = await executeTool(tc.name, tc.arguments, context);
        toolCallLog.push({
          tool: tc.name,
          status: result.success ? "success" : "error",
          durationMs: result.durationMs,
        });
        return { call: tc, result };
      })
    );

    // Append tool results to the conversation so the model can continue
    // Append tool call turn (assistant)
    messages.push({
      role: "assistant",
      content: null,
      tool_calls: response.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      })),
    });

    // Append tool results (one message per tool)
    for (const { call, result } of toolResults) {
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: JSON.stringify(result),
      });
    }

    // Re-query the model with the tool results
    response = await callProviderWithFallback(messages, toolDefinitions);
  }

  // At this point response.type should be 'text'
  const replyText =
    response.type === "text"
      ? response.text
      : "I was unable to complete your request. Please try again.";

  return {
    reply: replyText,
    toolCalls: toolCallLog,
    usage: response.usage || null,
  };
}

// ─── Provider call with failover ─────────────────────────────────────────────

/**
 * Call the primary provider. If it fails and a fallback is configured,
 * try the fallback (only for safe calls — before any write tools execute).
 */
async function callProviderWithFallback(messages, tools) {
  const provider = getProvider();

  try {
    return await provider.generateWithTools(messages, tools);
  } catch (primaryError) {
    console.error(
      `[AI] Primary provider (${provider.name}) failed:`,
      primaryError.message
    );

    const fallback = getFallbackProvider();
    if (!fallback) throw primaryError;

    console.warn(`[AI] Attempting failover to ${fallback.name}...`);
    try {
      return await fallback.generateWithTools(messages, tools);
    } catch (fallbackError) {
      console.error(
        `[AI] Fallback provider (${fallback.name}) also failed:`,
        fallbackError.message
      );
      throw new Error(
        `AI service unavailable. Primary (${provider.name}): ${primaryError.message}. Fallback (${fallback.name}): ${fallbackError.message}`
      );
    }
  }
}

/**
 * @typedef {object} AiServiceResult
 * @property {string} reply - Final text response from the AI
 * @property {Array<{tool: string, status: string, durationMs: number}>} toolCalls
 * @property {object|null} usage - Token usage stats
 */
