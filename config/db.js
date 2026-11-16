// 1. Node.js built-in modules
import dns from "node:dns";

// 2. External packages
import mongoose from "mongoose";
import tenantPlugin from "../utils/tenantPlugin.js";

// Apply global multi-tenant schema plugin across all school collections
mongoose.plugin(tenantPlugin);

/**
 * @file db.js
 * @description MongoDB connection management with resilient reconnects and offline FallbackDb fallback.
 */

// Fix for Node.js / Windows DNS SRV lookup failures with MongoDB Atlas clusters
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (_e) {
  // Ignore if custom DNS servers cannot be set
}

let isConnected = false;
let fallbackActive = false;
let lastDbError = null;
let lastAttemptTime = null;
let isConnecting = false;
let reconnectTimer = null;

// Attach persistent event listeners to Mongoose connection
mongoose.connection.on("connected", () => {
  isConnected = true;
  fallbackActive = false;
  lastDbError = null;
  console.log("✨ MongoDB connection established successfully.");
});

mongoose.connection.on("error", (err) => {
  lastDbError = err.message;
  console.error("❌ MongoDB connection error:", err.message);
});

mongoose.connection.on("disconnected", () => {
  if (isConnected) {
    console.warn("⚠️ MongoDB disconnected. Activating fallback engine.");
  }
  isConnected = false;
  fallbackActive = true;
  scheduleReconnect();
});

const scheduleReconnect = () => {
  if (reconnectTimer || isConnected || isConnecting) return;
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    if (!isConnected) {
      console.log("🔄 Background retry: Connecting to MongoDB...");
      await connectDB();
    }
  }, 10000); // Retry every 10 seconds in the background
};

/**
 * Connects to MongoDB Atlas or local MongoDB instance with resilient timeout configs.
 *
 * @returns {Promise<void>}
 */
export const connectDB = async () => {
  if (isConnecting || isConnected) return;

  const mongoURI = (process.env.MONGODB_URI || "").trim().replace(/^["']|["']$/g, "");
  lastAttemptTime = new Date().toISOString();

  if (!mongoURI) {
    isConnected = false;
    fallbackActive = true;
    lastDbError = "MONGODB_URI is empty or undefined in server/.env";
    console.warn(`⚠️ ${lastDbError}. Using local fallback engine.`);
    return;
  }

  isConnecting = true;

  try {
    mongoose.set("strictQuery", true);

    // Timeout of 10 seconds allows Atlas SRV query + TLS handshake without failing prematurely
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });

    isConnected = true;
    fallbackActive = false;
    lastDbError = null;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    console.log("✨ MongoDB Connected successfully.");

    // Clean up legacy single-field indexes on User collection that conflict with multi-tenant compound indexes
    try {
      const usersCollection = mongoose.connection.collection("users");
      const indexes = await usersCollection.indexes();

      const empIndex = indexes.find(
        (idx) => idx.name === "employeeId_1" || (idx.key && idx.key.employeeId && !idx.key.schoolId)
      );
      if (empIndex) {
        console.log(`🔄 Dropping legacy single-field index ${empIndex.name}...`);
        await usersCollection.dropIndex(empIndex.name);
      }

      const admIndex = indexes.find(
        (idx) =>
          idx.name === "admissionNumber_1" ||
          (idx.key && idx.key.admissionNumber && !idx.key.schoolId)
      );
      if (admIndex) {
        console.log(`🔄 Dropping legacy single-field index ${admIndex.name}...`);
        await usersCollection.dropIndex(admIndex.name);
      }

      // Drop non-partial compound indexes that fail on null employeeId/admissionNumber
      const legacyEmpCompound = indexes.find(
        (idx) => idx.name === "schoolId_1_employeeId_1" && !idx.partialFilterExpression
      );
      if (legacyEmpCompound) {
        console.log(`🔄 Dropping non-partial compound index ${legacyEmpCompound.name}...`);
        await usersCollection.dropIndex(legacyEmpCompound.name);
      }

      const legacyAdmCompound = indexes.find(
        (idx) => idx.name === "schoolId_1_admissionNumber_1" && !idx.partialFilterExpression
      );
      if (legacyAdmCompound) {
        console.log(`🔄 Dropping non-partial compound index ${legacyAdmCompound.name}...`);
        await usersCollection.dropIndex(legacyAdmCompound.name);
      }

      // Remove null and empty string fields so sparse indexes ignore them
      await usersCollection.updateMany(
        { $or: [{ employeeId: null }, { employeeId: "" }] },
        { $unset: { employeeId: "" } }
      );
      await usersCollection.updateMany(
        { $or: [{ admissionNumber: null }, { admissionNumber: "" }] },
        { $unset: { admissionNumber: "" } }
      );
      await usersCollection.updateMany(
        { role: "student", accountExpiryDate: { $exists: true, $ne: null } },
        { $unset: { accountExpiryDate: "" } }
      );

      console.log("✅ Users collection multi-tenant indexes verified.");
    } catch (idxErr) {
      console.warn("Index migration note:", idxErr.message);
    }

    // Fix legacy unique index on attendances collection (date_1_classId_1)
    try {
      const attendancesCollection =
        mongoose.connection.collection("attendances");
      const attIndexes = await attendancesCollection.indexes();
      const legacyAttIndex = attIndexes.find(
        (idx) =>
          idx.name === "date_1_classId_1" ||
          (idx.key && idx.key.date && idx.key.classId && !idx.key.sectionId)
      );
      if (legacyAttIndex && legacyAttIndex.unique) {
        console.log(
          `🔄 Dropping legacy unique index ${legacyAttIndex.name} on attendances...`
        );
        await attendancesCollection.dropIndex(legacyAttIndex.name);
        console.log(
          "✅ Dropped legacy unique index date_1_classId_1 on attendances."
        );
      }
    } catch (_attIdxErr) {
      // Ignore if index doesn't exist
    }
  } catch (error) {
    isConnected = false;
    fallbackActive = true;
    lastDbError = error.message;

    console.warn(
      "⚠️ MongoDB connection failed. Falling back to local in-memory JSON data storage."
    );
    console.warn(`Error detail: ${error.message}`);

    if (
      error.message.includes("Server selection timed out") ||
      error.name === "MongooseServerSelectionError"
    ) {
      console.warn(
        "💡 Tip: Check MongoDB Atlas Network Access (IP Access List). Ensure '0.0.0.0/0' (Allow Access From Anywhere) is added."
      );
    } else if (
      error.message.includes("bad auth") ||
      error.message.includes("Authentication failed")
    ) {
      console.warn(
        "💡 Tip: MongoDB Atlas authentication failed. Check your username and password in MONGODB_URI."
      );
    } else if (error.message.includes("querySrv")) {
      console.warn(
        "💡 Tip: DNS SRV resolution issue. Check your internet connection or DNS provider."
      );
    }

    scheduleReconnect();
  } finally {
    isConnecting = false;
  }
};

/**
 * Gets the current connection status of MongoDB and FallbackDb.
 *
 * @returns {{ isConnected: boolean, isFallback: boolean, lastError: string|null, lastAttempt: string|null }}
 */
export const getDbState = () => {
  return {
    isConnected,
    isFallback: fallbackActive,
    lastError: lastDbError,
    lastAttempt: lastAttemptTime,
  };
};

/**
 * Checks whether the application is currently running in Fallback mode.
 *
 * @returns {boolean} True if fallback is active.
 */
export const checkFallback = () => {
  return fallbackActive || !isConnected;
};

/**
 * Manually attempts to reconnect to the database.
 *
 * @returns {Promise<Object>} Updated DB state.
 */
export const reconnectDB = async () => {
  isConnected = false;
  fallbackActive = true;
  await connectDB();
  return getDbState();
};
