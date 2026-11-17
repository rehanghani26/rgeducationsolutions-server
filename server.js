// 1. Node.js built-in modules
import path from "path";
import { fileURLToPath } from "url";

// 2. External packages
import cookieParser from "cookie-parser";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

// 3. Configuration
import { connectDB, getDbState, reconnectDB } from "./config/db.js";

// 5. Middleware
import { auditMiddleware } from "./middleware/auditLog.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { tenantMiddleware } from "./middleware/tenant.js";
import tenantContext from "./utils/tenantContext.js";

// 8. Other internal modules (Routes)
import adminRoutes from "./routes/adminRoutes.js";
import aiRoutes from "./ai/ai.routes.js";
import attendanceRoutes from "./routes/attendanceRoutes.js";
import auditLogRoutes from "./routes/auditLogRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import budgetRoutes from "./routes/budgetRoutes.js";
import classRoutes from "./routes/classRoutes.js";
import companyRoutes from "./routes/companyRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import documentRoutes from "./routes/documentRoutes.js";
import erpRoutes from "./routes/erpRoutes.js";
import examRoutes from "./routes/examRoutes.js";
import financeRoutes from "./routes/financeRoutes.js";
import homeworkRoutes from "./routes/homeworkRoutes.js";
import inventoryRoutes from "./routes/inventoryRoutes.js";
import leaveRoutes from "./routes/leaveRoutes.js";
import onlineClassRoutes from "./routes/onlineClassRoutes.js";
import payrollRoutes from "./routes/payrollRoutes.js";
import periodRoutes from "./routes/periodRoutes.js";
import portalRoutes from "./routes/portalRoutes.js";
import profileRoutes from "./routes/profileRoutes.js";
import resultRoutes from "./routes/resultRoutes.js";
import roleAccessRoutes from "./routes/roleAccessRoutes.js";
import sessionRoutes from "./routes/sessionRoutes.js";
import setupRoutes from "./routes/setupRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import syllabusRoutes from "./routes/syllabusRoutes.js";
import teacherRoutes from "./routes/teacherRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import vendorRoutes from "./routes/vendorRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Setup environment configurations
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 5000;

// Apply global middlewares
app.use(
  helmet({
    contentSecurityPolicy: false, // Allow easy integration in development
    crossOriginResourcePolicy: false,
    crossOriginEmbedderPolicy: false,
    frameguard: false, // Allow iframe embedding for PDF viewers and preview widgets
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

// Serve uploads folder as static with inline display support for PDFs and images
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"), {
    setHeaders: (res, filePath) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      if (filePath.toLowerCase().endsWith(".pdf")) {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "inline");
      }
    },
  })
);

// Connect database
connectDB();

// Automatic cleanup of corrupted student records from failed raw binary xlsx imports
setTimeout(async () => {
  try {
    const { cleanCorruptedStudents } = await import("./controllers/studentController.js");
    const count = await cleanCorruptedStudents();
    if (count > 0) {
      console.log(`🧹 [Auto-Cleanup] Successfully purged ${count} corrupted student records.`);
    }
  } catch (err) {
    console.error("Auto-cleanup error:", err.message);
  }
}, 3000);

// Global response middleware: ensures schoolId is automatically attached to all API JSON responses
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const activeSchoolId =
        tenantContext.getSchoolId() ||
        req.user?.schoolId ||
        req.schoolId ||
        req.tenant?.schoolId ||
        req.headers["x-school-id"] ||
        body.schoolId ||
        null;

      if (activeSchoolId) {
        if (body.schoolId === undefined) {
          body.schoolId = activeSchoolId;
        }
        if (
          body.stats &&
          typeof body.stats === "object" &&
          !Array.isArray(body.stats) &&
          body.stats.schoolId === undefined
        ) {
          body.stats.schoolId = activeSchoolId;
        }
        if (
          body.data &&
          typeof body.data === "object" &&
          !Array.isArray(body.data) &&
          body.data.schoolId === undefined
        ) {
          body.data.schoolId = activeSchoolId;
        }
      }
    }
    return originalJson(body);
  };
  next();
});

// Audit logging for authenticated API requests
app.use("/api/v1", auditMiddleware);

// Super Admin API routes (bypass tenant requirements)
app.use("/api/v1/admin", adminRoutes);

// Multi-tenant resolution middleware for School ERP routes
app.use(["/api/v1", "/api"], tenantMiddleware);

// Register API Routes
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/students", studentRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/v1/teachers", teacherRoutes);
app.use("/api/v1/inventory", inventoryRoutes);
app.use(["/api/v1/vendors", "/api/v1/inventory/vendors"], vendorRoutes);
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
app.use("/api/v1/profile", profileRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/v1/ai", aiRoutes);
app.use("/api/v1/results", resultRoutes);
app.use("/api/v1/syllabus", syllabusRoutes);
app.use("/api/v1/documents", documentRoutes);
app.use("/api/v1/setup", setupRoutes);
app.use(["/api/v1/role-access", "/api/role-access"], roleAccessRoutes);

app.use("/api/v1/classes", classRoutes); // ClassRoom module
app.use(["/api/v1/leaves", "/api/leaves"], leaveRoutes); // Universal Leave Management module

// Forward notices endpoints to ERP notice board routes
app.use(["/api/v1/notices", "/api/notices"], (req, res, next) => {
  req.url = `/notices${req.url === "/" ? "" : req.url}`;
  return erpRoutes(req, res, next);
});

app.use("/api/v1/budget", budgetRoutes);
app.use("/api/budget", budgetRoutes);
app.use("/api/v1/payroll", payrollRoutes);
app.use("/api/payroll", payrollRoutes);

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

// Database reconnect endpoint
app.all("/api/reconnect-db", async (req, res) => {
  const dbStatus = await reconnectDB();
  return res.json({
    success: dbStatus.isConnected,
    message: dbStatus.isConnected
      ? "MongoDB connected successfully"
      : `Connection failed: ${dbStatus.lastError || "Unknown error"}`,
    dbStatus,
  });
});

// Centralized error handling middleware
app.use(errorHandler);

// Start server listening
app.listen(PORT, () => {
  console.log(
    `🚀 RGES Server running on port ${PORT} in ${process.env.NODE_ENV || "development"} mode`
  );
});
