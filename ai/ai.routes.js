// 2. External packages
import express from "express";

// 5. Middleware
import { protect } from "../middleware/auth.js";

// 8. Other internal modules (Controllers)
import { chatController, healthController } from "./ai.controller.js";

/**
 * @file ai.routes.js
 * @description Express router for AI endpoints. Protected by JWT auth middleware.
 */

const router = express.Router();

/**
 * GET /api/v1/ai/health
 * @desc AI health check & active provider status.
 */
router.get("/health", protect, healthController);

/**
 * POST /api/v1/ai/chat
 * @desc Main AI chat endpoint with function calling.
 */
router.post("/chat", protect, chatController);

export default router;
