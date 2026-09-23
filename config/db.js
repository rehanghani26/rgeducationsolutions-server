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

    // Fix legacy non-sparse indexes on User collection to prevent duplicate null key errors
    try {
      const usersCollection = mongoose.connection.collection('users');
      const indexes = await usersCollection.indexes();
      
      const empIndex = indexes.find(
        (idx) => idx.name === 'employeeId_1' || (idx.key && idx.key.employeeId)
      );
      if (empIndex && !empIndex.sparse) {
        console.log(`🔄 Dropping legacy non-sparse index ${empIndex.name}...`);
        await usersCollection.dropIndex(empIndex.name);
      }

      const admIndex = indexes.find(
        (idx) => idx.name === 'admissionNumber_1' || (idx.key && idx.key.admissionNumber)
      );
      if (admIndex && !admIndex.sparse) {
        console.log(`🔄 Dropping legacy non-sparse index ${admIndex.name}...`);
        await usersCollection.dropIndex(admIndex.name);
      }

      // Remove null and empty string fields so sparse indexes ignore them
      await usersCollection.updateMany(
        { $or: [{ employeeId: null }, { employeeId: '' }] },
        { $unset: { employeeId: '' } }
      );
      await usersCollection.updateMany(
        { $or: [{ admissionNumber: null }, { admissionNumber: '' }] },
        { $unset: { admissionNumber: '' } }
      );

      // Ensure sparse unique indexes
      await usersCollection.createIndex({ employeeId: 1 }, { unique: true, sparse: true, background: true });
      await usersCollection.createIndex({ admissionNumber: 1 }, { unique: true, sparse: true, background: true });
      console.log('✅ Users collection sparse indexes ensured.');
    } catch (idxErr) {
      console.warn('Index migration note:', idxErr.message);
    }

    // Fix legacy unique index on attendances collection (date_1_classId_1)
    // This allows taking past date attendance and updating existing attendance records without E11000 errors
    try {
      const attendancesCollection = mongoose.connection.collection('attendances');
      const attIndexes = await attendancesCollection.indexes();
      const legacyAttIndex = attIndexes.find(
        (idx) => idx.name === 'date_1_classId_1' || (idx.key && idx.key.date && idx.key.classId && !idx.key.sectionId)
      );
      if (legacyAttIndex && legacyAttIndex.unique) {
        console.log(`🔄 Dropping legacy unique index ${legacyAttIndex.name} on attendances...`);
        await attendancesCollection.dropIndex(legacyAttIndex.name);
        console.log('✅ Dropped legacy unique index date_1_classId_1 on attendances.');
      }
    } catch (attIdxErr) {
      // Ignore if index doesn't exist
    }
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
