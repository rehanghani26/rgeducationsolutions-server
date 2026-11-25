/**
 * @file ai.service.js
 * @description Core AI Service — the agentic loop.
 */

import { getProvider, getFallbackProvider } from './providers/index.js';
import { getAllToolDefinitions } from './tool.registry.js';
import { executeTool } from './tool.executor.js';
import { parseTextToolCalls } from './tool.parser.js';
import { validateSchoolQuery } from './tools/validate.tool.js';
import { buildSystemPrompt, getCurrentDate } from './system.prompt.js';
import AcademicSession from '../models/AcademicSession.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';

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
  schoolId,
  academicSessionId,
  ip,
}) {
  if (!userMessage?.trim()) {
    throw new Error("User message cannot be empty.");
  }

  // ── Guardrail: Validate School ERP Domain Relevance ───────────────────────
  const validation = validateSchoolQuery(userMessage);
  if (!validation.isValid) {
    return {
      reply: validation.response,
      toolCalls: [],
      usage: null,
    };
  }

  let activeSession = null;
  try {
    if (checkFallback()) {
      const all = FallbackDb.find('academicSessions') || [];
      activeSession = all.find((s) => s.isCurrent) || all[0] || null;
    } else {
      activeSession = await AcademicSession.findOne({ isCurrent: true }).lean();
      if (!activeSession) {
        activeSession = await AcademicSession.findOne().sort({ startDate: -1 }).lean();
      }
    }
  } catch (err) {
    // Non-fatal fallback
  }

  const currentDate = getCurrentDate();
  const systemPrompt = buildSystemPrompt(user, currentDate, activeSession);
  const toolDefinitions = getAllToolDefinitions(user);
  const context = { user, schoolId: schoolId || user?.schoolId, academicSessionId, ip };

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
    // If provider returned text, check if the text contains explicit tool calls (for reasoning/text-only models)
    if (response.type === "text" && response.text) {
      const parsedCalls = parseTextToolCalls(response.text);
      if (parsedCalls.length > 0) {
        response = {
          type: "tool_calls",
          toolCalls: parsedCalls,
          rawMessage: response.rawMessage,
          usage: response.usage,
        };
      }
    }

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
          args: tc.arguments,
          data: result,
        });
        return { call: tc, result };
      })
    );

    // Append tool results to the conversation so the model can continue
    // Append tool call turn (assistant)
    messages.push({
      role: "assistant",
      content: response.rawMessage?.content || null,
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

  // If the model ended on tool calls due to max iterations, request a final summary
  if (response.type !== "text") {
    try {
      messages.push({
        role: "user",
        content: "Please summarize the actions taken and the final status based on the tool results above.",
      });
      const summaryResp = await callProviderWithFallback(messages, []);
      if (summaryResp.type === "text" && summaryResp.text) {
        response = summaryResp;
      }
    } catch (_) {}
  }

  // Ensure replyText is human-readable and not a raw dangling tool call JSON string
  let replyText = "";
  if (response.type === "text" && response.text) {
    let danglingCalls = parseTextToolCalls(response.text);

    // Safety net: check if the text is a raw unparsed tool call JSON
    if (
      danglingCalls.length === 0 &&
      /^\s*\{[\s\S]*"(?:tool|action|name|function)"\s*:[\s\S]*\}\s*$/i.test(response.text.trim())
    ) {
      try {
        const parsed = JSON.parse(response.text.trim());
        const candidate = parsed.tool || parsed.name || parsed.action || parsed.function;
        if (candidate) {
          danglingCalls = [
            {
              id: `fallback_${Date.now()}`,
              name: candidate,
              arguments: parsed.arguments || parsed.parameters || parsed.args || {},
            },
          ];
        }
      } catch (_) {}
    }

    if (danglingCalls.length > 0) {
      // Execute any dangling calls if not executed yet in the agentic loop
      for (const dc of danglingCalls) {
        const result = await executeTool(dc.name, dc.arguments, context);
        toolCallLog.push({
          tool: dc.name,
          status: result.success !== false ? "success" : "error",
          durationMs: result.durationMs,
          args: dc.arguments,
          data: result,
        });
      }

      // Synthesize a clean human-readable reply based on the tool executed
      const firstCall = toolCallLog[0];
      const tool = firstCall?.tool || "";
      if (tool === "getStudents") {
        const studentCount =
          firstCall.data?.total ||
          firstCall.data?.count ||
          (Array.isArray(firstCall.data?.students) ? firstCall.data.students.length : 0);
        replyText = `There are currently **${studentCount} students** enrolled in our school across all classes and sections.`;
      } else if (tool === "getAttendanceByDate") {
        const s = firstCall.data?.summary || {};
        replyText = `Attendance for **${firstCall.data?.date || firstCall.args?.date || "today"}**: **${s.attendanceRate || "0%"}** attendance rate (${s.present ?? 0} present, ${s.absent ?? 0} absent, ${s.late ?? 0} late, ${s.leave ?? 0} leave out of ${s.totalStudents ?? 0} total).`;
      } else if (tool === "getAttendanceStatus") {
        const s = firstCall.data?.summary || {};
        replyText = `Daily attendance status for **${firstCall.data?.date || "today"}**: **${s.markedCount ?? 0}** of **${s.totalConfigured ?? 0}** marked (${s.pendingCount ?? 0} pending, ${s.completionPercentage ?? 0}% complete).`;
      } else if (tool === "markAttendance" || tool === "updateAttendanceRecord") {
        replyText = firstCall.data?.message || firstCall.data?.error || "Attendance request processed.";
      } else if (tool === "getFeeSummary") {
        const f = firstCall.data?.summary || {};
        replyText = `Fee summary: Total collections **₹${f.totalCollected || "0"}** with pending dues of **₹${f.totalPending || "0"}**.`;
      } else {
        replyText = `Successfully retrieved data for **${tool}**.`;
      }
    } else {
      replyText = response.text;
    }
  } else if (toolCallLog.length > 0) {
    const firstCall = toolCallLog[0];
    const tool = firstCall?.tool || "";
    if (tool === "getStudents") {
      const studentCount =
        firstCall.data?.total ||
        firstCall.data?.count ||
        (Array.isArray(firstCall.data?.students) ? firstCall.data.students.length : 0);
      replyText = `There are currently **${studentCount} students** enrolled in our school across all classes and sections.`;
    } else if (tool === "getAttendanceByDate") {
      const s = firstCall.data?.summary || {};
      replyText = `Attendance for **${firstCall.data?.date || firstCall.args?.date || "today"}**: **${s.attendanceRate || "0%"}** attendance rate (${s.present ?? 0} present, ${s.absent ?? 0} absent, ${s.late ?? 0} late, ${s.leave ?? 0} leave out of ${s.totalStudents ?? 0} total).`;
    } else if (tool === "getAttendanceStatus") {
      const s = firstCall.data?.summary || {};
      replyText = `Daily attendance status for **${firstCall.data?.date || "today"}**: **${s.markedCount ?? 0}** of **${s.totalConfigured ?? 0}** marked (${s.pendingCount ?? 0} pending).`;
    } else {
      replyText = firstCall.data?.message || firstCall.data?.error || `Completed ${toolCallLog.length} operation(s) successfully.`;
    }
  } else {
    replyText = "I was unable to complete your request. Please try again.";
  }

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
    if (fallback) {
      console.warn(`[AI] Attempting failover to ${fallback.name}...`);
      try {
        return await fallback.generateWithTools(messages, tools);
      } catch (fallbackError) {
        console.error(
          `[AI] Fallback provider (${fallback.name}) also failed:`,
          fallbackError.message
        );
      }
    }

    // Ultimate safety net: If neither primary nor fallback was Groq, try Groq directly
    if (provider.name !== "Groq" && fallback?.name !== "Groq" && process.env.GROQ_API_KEY) {
      try {
        console.warn(`[AI] Attempting safety net failover to Groq...`);
        const { GroqProvider } = await import("./providers/groq.provider.js");
        const groq = new GroqProvider();
        return await groq.generateWithTools(messages, tools);
      } catch (groqError) {
        console.error(`[AI] Safety net Groq also failed:`, groqError.message);
      }
    }

    throw new Error(
      `AI service temporarily unavailable (${provider.name}: ${primaryError.message})`
    );
  }
}

/**
 * @typedef {object} AiServiceResult
 * @property {string} reply - Final text response from the AI
 * @property {Array<{tool: string, status: string, durationMs: number}>} toolCalls
 * @property {object|null} usage - Token usage stats
 */
