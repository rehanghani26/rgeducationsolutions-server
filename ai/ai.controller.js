/**
 * @file ai.controller.js
 * @description Express controller for the AI Chat API.
 *
 * POST /api/v1/ai/chat
 *
 * Request body:
 *   {
 *     "message": "How many students are absent today?",
 *     "conversationHistory": [   // optional, last N messages
 *       { "role": "user", "content": "..." },
 *       { "role": "assistant", "content": "..." }
 *     ]
 *   }
 *
 * Response:
 *   {
 *     "success": true,
 *     "reply": "Yesterday, 12 students were absent...",
 *     "toolCalls": [{ "tool": "getAttendanceByDate", "status": "success", "durationMs": 134 }]
 *   }
 */

import { processAiChat } from './ai.service.js';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_LENGTH = 40;

/**
 * POST /api/v1/ai/chat
 */
export async function chatController(req, res) {
  try {
    const { message, conversationHistory } = req.body;

    // ── Input validation ──────────────────────────────────────────────────────
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: 'The "message" field is required and must be a non-empty string.',
      });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Message is too long. Maximum is ${MAX_MESSAGE_LENGTH} characters.`,
      });
    }

    // Validate and cap conversation history
    let history = [];
    if (Array.isArray(conversationHistory)) {
      history = conversationHistory
        .slice(-MAX_HISTORY_LENGTH)
        .filter(
          (m) =>
            m &&
            typeof m === 'object' &&
            typeof m.content === 'string' &&
            ['user', 'assistant', 'model'].includes(m.role)
        )
        .map((m) => ({
          role: m.role,
          content: m.content.slice(0, 2000), // cap individual message length
        }));
    }

    // ── Call AI Service ───────────────────────────────────────────────────────
    const result = await processAiChat({
      userMessage: message.trim(),
      conversationHistory: history,
      user: req.user,
      ip: req.ip,
    });

    // ── Respond ───────────────────────────────────────────────────────────────
    return res.json({
      success: true,
      reply: result.reply,
      toolCalls: result.toolCalls,
    });
  } catch (error) {
    console.error('[AI Controller] ── FULL ERROR ──────────────────────────────');
    console.error('[AI Controller] Message:', error.message);
    console.error('[AI Controller] Status:', error.status);
    console.error('[AI Controller] Stack:', error.stack);
    console.error('[AI Controller] ────────────────────────────────────────────');

    // ── Provider-specific friendly errors ─────────────────────────────────────
    let statusCode = 500;
    // In development, expose the real error; in production keep it generic
    const isDev = process.env.NODE_ENV !== 'production';
    let userMessage = isDev
      ? `AI Error: ${error.message}`
      : 'The AI assistant is temporarily unavailable. Please try again.';

    const msg = error.message || '';

    if (
      msg.includes('API Key') ||
      msg.includes('api_key') ||
      msg.includes('API_KEY_INVALID') ||
      msg.includes('PERMISSION_DENIED') ||
      msg.includes('Invalid API key') ||
      msg.includes('401')
    ) {
      statusCode = 503;
      userMessage = 'AI provider API key is invalid or expired. Please update the API key in the server .env file.';
    } else if (msg.includes('rate limit') || msg.toLowerCase().includes('quota') || msg.includes('429')) {
      statusCode = 429;
      userMessage = 'AI rate limit reached. Please wait a moment and try again.';
    } else if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET')) {
      statusCode = 504;
      userMessage = 'The AI request timed out. Please try again.';
    } else if (msg.includes('unavailable') || msg.includes('503')) {
      statusCode = 503;
      userMessage = msg.length < 300 ? msg : 'AI service is temporarily unavailable.';
    } else if (msg.includes('is not set')) {
      statusCode = 503;
      userMessage = `AI configuration error: ${msg}`;
    }

    return res.status(statusCode).json({
      success: false,
      reply: userMessage,
      message: userMessage,
      toolCalls: [],
    });
  }
}
