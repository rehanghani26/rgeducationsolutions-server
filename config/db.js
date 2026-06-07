import mongoose from 'mongoose';

let isConnected = false;
let fallbackActive = false;

export const connectDB = async () => {
  const mongoURI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/school_erp';
  
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 3000 // Timeout fast so we can trigger the fallback database
    });
    isConnected = true;
    fallbackActive = false;
    console.log('✨ MongoDB Connected successfully.');
  } catch (error) {
    isConnected = false;
    fallbackActive = true;
    console.warn('⚠️ MongoDB connection failed. Falling back to local in-memory JSON data storage.');
    console.warn(`Error detail: ${error.message}`);
  }
};

export const getDbState = () => {
  return {
    isConnected,
    isFallback: fallbackActive
  };
};

export const checkFallback = () => {
  return fallbackActive || !isConnected;
};
