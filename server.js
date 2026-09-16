import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import helmet from "helmet";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { connectDB, getDbState } from "./config/db.js";

// Routers
import authRoutes from "./routes/authRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import teacherRoutes from "./routes/teacherRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";
import financeRoutes from "./routes/financeRoutes.js";
import erpRoutes from "./routes/erpRoutes.js";
import companyRoutes from "./routes/companyRoutes.js";
import auditLogRoutes from "./routes/auditLogRoutes.js";
import examRoutes from "./routes/examRoutes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import periodRoutes from "./routes/periodRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import onlineClassRoutes from "./routes/onlineClassRoutes.js";
import homeworkRoutes from "./routes/homeworkRoutes.js";
import portalRoutes from "./routes/portalRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import aiRoutes from "./ai/ai.routes.js";
import { auditMiddleware } from "./middleware/auditLog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup environment configs
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 5000;

// Apply middlewears
app.use(
  helmet({
    contentSecurityPolicy: false, // Allow easy integration in development
  })
);
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());
app.use(morgan("dev"));

// Serve uploads folder as static
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Connect database
connectDB();

// Audit logging for authenticated API requests
app.use("/api/v1", auditMiddleware);

// Register Api Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/students", studentRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/v1/teachers", teacherRoutes);
app.use("/api/v1/inventory", inventoryRoutes);
app.use("/api/v1/finance", financeRoutes);
app.use("/api/v1/erp", erpRoutes);
app.use("/api/v1/company", companyRoutes);
app.use("/api/v1/audit-logs", auditLogRoutes);
app.use("/api/v1/exams", examRoutes);
app.use("/api/v1/attendance", attendanceRoutes);
app.use("/api/v1/periods", periodRoutes);
app.use("/api/v1/sessions", sessionRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/company", companyRoutes);
app.use("/api/v1/online-classes", onlineClassRoutes);
app.use("/api/v1/homework", homeworkRoutes);
app.use("/api/v1/portal", portalRoutes);
app.use("/api/v1/users", userRoutes);
app.use("/api/users", userRoutes);
app.use("/api/v1/ai", aiRoutes);

// Health check endpoint
app.get("/api/health", (req, res) => {
  const dbStatus = getDbState();
  return res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    database: dbStatus.isConnected
      ? "MongoDB Connected"
      : "Fallback Engine (Active JSON File)",
    dbDetail: dbStatus,
  });
});

// Error handling handler
app.use((err, req, res, next) => {
  console.error("Unhandled Server Error:", err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal Server Error",
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

// Start listening
app.listen(PORT, () => {
  console.log(
    `🚀 RGES Server running on port ${PORT} in ${process.env.NODE_ENV || "development"} mode`
  );
});
