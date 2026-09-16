/**
 * @file ai.routes.js
 * @description Express router for AI endpoints.
 *
 * All routes are protected by the existing JWT auth middleware.
 * The AI never bypasses authentication.
 */

import express from 'express';
import { chatController, healthController } from './ai.controller.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/v1/ai/health
 * @description AI health check & active provider status. Requires valid JWT.
 */
router.get('/health', protect, healthController);

/**
 * POST /api/v1/ai/chat
 * @description Main AI chat endpoint. Requires valid JWT.
 * @body { message: string, conversationHistory?: array }
 */
router.post('/chat', protect, chatController);

export default router;
