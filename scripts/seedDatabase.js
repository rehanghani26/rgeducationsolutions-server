import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Setup environment configs
dotenv.config();

// Import User model
import User from "../models/User.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mongoURI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb://localhost:27017/school_erp";

const seedDatabase = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(mongoURI);
    console.log("✨ Connected to MongoDB");

    // Clear existing users
    await User.deleteMany({});
    console.log("🗑️  Cleared existing users");

    // Define default users
    const defaultUsers = [
      {
        username: "superadmin",
        email: "admin@school.com",
        password: "admin", // Will be hashed by pre-save hook
        role: "super-admin",
        name: "Albus Dumbledore",
        profileId: "staff1",
        isActive: true,
      },
      {
        username: "principal",
        email: "principal@school.com",
        password: "admin",
        role: "principal",
        name: "Minerva McGonagall",
        profileId: "staff2",
        isActive: true,
      },
      {
        username: "teacher",
        email: "teacher@school.com",
        password: "admin",
        role: "teacher",
        name: "Severus Snape",
        profileId: "t1",
        isActive: true,
      },
      {
        username: "accountant",
        email: "accountant@school.com",
        password: "admin",
        role: "accountant",
        name: "Lucius Malfoy",
        profileId: "staff3",
        isActive: true,
      },
      {
        username: "librarian",
        email: "librarian@school.com",
        password: "admin",
        role: "librarian",
        name: "Irma Pince",
        profileId: "staff4",
        isActive: true,
      },
      {
        username: "student",
        email: "student@school.com",
        password: "admin",
        role: "student",
        name: "Harry Potter",
        profileId: "s1",
        isActive: true,
      },
      {
        username: "parent",
        email: "parent@school.com",
        password: "admin",
        role: "parent",
        name: "James Potter",
        profileId: "p1",
        isActive: true,
      },
    ];

    // Create users (use create() instead of insertMany() to trigger password hashing pre-save hook)
    const createdUsers = [];
    for (const userData of defaultUsers) {
      const user = await User.create(userData);
      createdUsers.push(user);
    }
    console.log(`✅ Seeded ${createdUsers.length} users successfully!`);

    // Display created users
    console.log("\n📋 Created Users:");
    createdUsers.forEach((user) => {
      console.log(`  - ${user.username} (${user.role}) - Password: admin`);
    });

    mongoose.connection.close();
    console.log("\n✨ Database seeding completed!");
  } catch (error) {
    console.error("❌ Seeding error:", error);
    process.exit(1);
  }
};

seedDatabase();
