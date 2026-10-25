import mongoose from "mongoose";
import dns from "node:dns";

// Fix for Node.js / Windows DNS SRV lookup failures with MongoDB Atlas clusters
try {
  dns.setServers(["8.8.8.8", "1.1.1.1"]);
} catch (e) {
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

    // Fix legacy non-sparse indexes on User collection to prevent duplicate null key errors
    try {
      const usersCollection = mongoose.connection.collection("users");
      const indexes = await usersCollection.indexes();

      const empIndex = indexes.find(
        (idx) => idx.name === "employeeId_1" || (idx.key && idx.key.employeeId)
      );
      if (empIndex && !empIndex.sparse) {
        console.log(`🔄 Dropping legacy non-sparse index ${empIndex.name}...`);
        await usersCollection.dropIndex(empIndex.name);
      }

      const admIndex = indexes.find(
        (idx) =>
          idx.name === "admissionNumber_1" ||
          (idx.key && idx.key.admissionNumber)
      );
      if (admIndex && !admIndex.sparse) {
        console.log(`🔄 Dropping legacy non-sparse index ${admIndex.name}...`);
        await usersCollection.dropIndex(admIndex.name);
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

      // Ensure sparse unique indexes
      await usersCollection.createIndex(
        { employeeId: 1 },
        { unique: true, sparse: true, background: true }
      );
      await usersCollection.createIndex(
        { admissionNumber: 1 },
        { unique: true, sparse: true, background: true }
      );
      console.log("✅ Users collection sparse indexes ensured.");
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
    } catch (attIdxErr) {
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

    if (error.message.includes("Server selection timed out") || error.name === "MongooseServerSelectionError") {
      console.warn("💡 Tip: Check MongoDB Atlas Network Access (IP Access List). Ensure '0.0.0.0/0' (Allow Access From Anywhere) is added.");
    } else if (error.message.includes("bad auth") || error.message.includes("Authentication failed")) {
      console.warn("💡 Tip: MongoDB Atlas authentication failed. Check your username and password in MONGODB_URI.");
    } else if (error.message.includes("querySrv")) {
      console.warn("💡 Tip: DNS SRV resolution issue. Check your internet connection or DNS provider.");
    }

    scheduleReconnect();
  } finally {
    isConnecting = false;
  }
};

export const getDbState = () => {
  return {
    isConnected,
    isFallback: fallbackActive,
    lastError: lastDbError,
    lastAttempt: lastAttemptTime,
  };
};

export const checkFallback = () => {
  return fallbackActive || !isConnected;
};

export const reconnectDB = async () => {
  isConnected = false;
  fallbackActive = true;
  await connectDB();
  return getDbState();
};
