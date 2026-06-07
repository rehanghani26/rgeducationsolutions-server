import Class from '../models/Class.js';
import { v2 as cloudinary } from 'cloudinary';
import Section from '../models/Section.js';
import Subject from '../models/Subject.js';
import Book from '../models/Book.js';
import Library from '../models/Library.js';
import Transport from '../models/Transport.js';
import Notification from '../models/Notification.js';
import Setting from '../models/Setting.js';

import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';

const uploadBufferToCloudinary = (fileBuffer, type) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `school-erp/company-profile/${type}`,
        resource_type: 'image',
        use_filename: true,
        unique_filename: true,
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result);
      }
    );

    stream.end(fileBuffer);
  });
};

// Academic helpers
export const getClasses = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('classes');
    } else {
      list = await Class.find();
    }
    return res.json({ success: true, classes: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getSections = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('sections');
    } else {
      list = await Section.find().populate('classId');
    }
    return res.json({ success: true, sections: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getSubjects = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('subjects');
    } else {
      list = await Subject.find();
    }
    return res.json({ success: true, subjects: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Library helpers
export const getBooks = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('books');
    } else {
      list = await Book.find();
    }
    return res.json({ success: true, books: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createBook = async (req, res) => {
  try {
    const data = req.body;
    let record = null;
    if (checkFallback()) {
      record = FallbackDb.create('books', {
        title: data.title,
        isbn: data.isbn,
        author: data.author,
        category: data.category,
        totalQty: Number(data.totalQty) || 1,
        issuedQty: 0
      });
    } else {
      const book = new Book(data);
      record = await book.save();
    }
    return res.status(201).json({ success: true, book: record });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

export const getLibraryIssues = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('library');
      list = list.map(item => {
        const bookObj = FallbackDb.findById('books', item.bookId);
        const studObj = FallbackDb.findById('students', item.studentId);
        return {
          ...item,
          book: bookObj,
          student: studObj
        };
      });
    } else {
      list = await Library.find().populate('bookId').populate('studentId');
    }
    return res.json({ success: true, issues: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const issueBook = async (req, res) => {
  try {
    const { bookId, studentId, dueDate } = req.body;
    let issueRecord = null;

    if (checkFallback()) {
      const book = FallbackDb.findById('books', bookId);
      if (!book || book.totalQty <= book.issuedQty) {
        return res.status(400).json({ success: false, message: 'Book is currently unavailable' });
      }

      // Update issue quantity
      FallbackDb.update('books', bookId, { issuedQty: book.issuedQty + 1 });
      
      // Log issue record
      issueRecord = FallbackDb.create('library', {
        bookId,
        studentId,
        issueDate: new Date().toISOString(),
        dueDate: dueDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        returnDate: null,
        fine: 0
      });
    } else {
      const book = await Book.findById(bookId);
      if (!book || book.totalQty <= book.issuedQty) {
        return res.status(400).json({ success: false, message: 'Book is unavailable' });
      }

      book.issuedQty += 1;
      await book.save();

      const libRecord = new Library({
        bookId,
        studentId,
        dueDate: dueDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
      });
      issueRecord = await libRecord.save();
    }

    return res.status(201).json({ success: true, message: 'Book issued successfully', record: issueRecord });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Transport Route lists
export const getTransport = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('transport');
    } else {
      list = await Transport.find();
    }
    return res.json({ success: true, transport: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// System alerts / notifications
export const getNotifications = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('notifications');
    } else {
      list = await Notification.find().sort({ date: -1 });
    }
    return res.json({ success: true, notifications: list });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Global App Settings
export const getSettings = async (req, res) => {
  try {
    let config = null;
    if (checkFallback()) {
      config = FallbackDb.getSettings();
    } else {
      config = await Setting.findOne();
      if (!config) {
        config = new Setting({});
        await config.save();
      }
    }
    return res.json({ success: true, settings: config });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const updateSettings = async (req, res) => {
  try {
    const data = req.body;
    let config = null;
    if (checkFallback()) {
      config = FallbackDb.updateSettings(data);
    } else {
      config = await Setting.findOneAndUpdate({}, data, { new: true, upsert: true });
    }
    return res.json({ success: true, message: 'Configuration settings updated', settings: config });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload an image file' });
    }

    const type = req.body.type === 'banner' ? 'banner' : 'logo';

    if (!process.env.CLOUDINARY_URL) {
      return res.status(500).json({
        success: false,
        message: 'Cloudinary is not configured on the server'
      });
    }

    cloudinary.config(true);
    cloudinary.config({ secure: true });

    const result = await uploadBufferToCloudinary(req.file.buffer, type);
    const originalName = req.file.originalname;
    const fieldPrefix = type === 'banner' ? 'schoolBanner' : 'schoolLogo';
    const imageData = {
      [`${fieldPrefix}`]: result.secure_url,
      [`${fieldPrefix}PublicId`]: result.public_id,
      [`${fieldPrefix}AssetId`]: result.asset_id,
      [`${fieldPrefix}Name`]: result.original_filename || originalName,
    };

    let settings = null;
    if (checkFallback()) {
      settings = FallbackDb.updateSettings(imageData);
    } else {
      settings = await Setting.findOneAndUpdate({}, imageData, { new: true, upsert: true });
    }

    return res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      image: {
        type,
        url: result.secure_url,
        publicId: result.public_id,
        assetId: result.asset_id,
        name: result.original_filename || originalName,
      },
      settings
    });
  } catch (err) {
    console.error('Profile image upload failed:', err.message);
    return res.status(500).json({ success: false, message: 'Failed to upload image' });
  }
};
