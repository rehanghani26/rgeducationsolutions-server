import Class from '../models/Class.js';
import { v2 as cloudinary } from 'cloudinary';
import Section from '../models/Section.js';
import Subject from '../models/Subject.js';
import Book from '../models/Book.js';
import Library from '../models/Library.js';
import Transport from '../models/Transport.js';
import Notification from '../models/Notification.js';
import Setting from '../models/Setting.js';
import User from '../models/User.js';
import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import Parent from '../models/Parent.js';

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

export const seedDummies = async (req, res) => {
  try {
    const defaultPassword = "123456";

    if (checkFallback()) {
      // 1. Fallback Database Path
      let class10 = FallbackDb.findOne("classes", { name: "Class 10" });
      if (!class10) {
        class10 = FallbackDb.create("classes", { name: "Class 10", code: "C10", room: "Room 301" });
      }
      let class11 = FallbackDb.findOne("classes", { name: "Class 11" });
      if (!class11) {
        class11 = FallbackDb.create("classes", { name: "Class 11", code: "C11", room: "Room 402" });
      }

      let secA = FallbackDb.findOne("sections", { name: "Section A", classId: class10.id });
      if (!secA) {
        secA = FallbackDb.create("sections", { name: "Section A", classId: class10.id });
      }
      let secB = FallbackDb.findOne("sections", { name: "Section B", classId: class11.id });
      if (!secB) {
        secB = FallbackDb.create("sections", { name: "Section B", classId: class11.id });
      }

      // Seed 25 teachers
      for (let i = 1; i <= 25; i++) {
        const email = `teacher${i}@fake.com`;
        const username = `teacher_dummy${i}`;
        const employeeId = `EMP-DUM-${String(i).padStart(4, "0")}`;

        let userRecord = FallbackDb.findOne("users", { email });
        if (!userRecord) {
          userRecord = FallbackDb.create("users", {
            username,
            email,
            password: defaultPassword,
            role: "teacher",
            name: `Teacher Dummy ${i}`,
            isActive: true,
          });
          const teacherRecord = FallbackDb.create("teachers", {
            user: userRecord.id,
            name: `Teacher Dummy ${i}`,
            firstName: "Teacher",
            lastName: `Dummy ${i}`,
            employeeId,
            phone: `99988887${String(i).padStart(2, "0")}`,
            email,
            designation: "Dummy Teacher",
            salary: 30000 + i * 500,
            status: "active",
            classesAssigned: [class10.id],
            sectionsAssigned: [secA.id],
            subjectsAssigned: ["Practical"],
          });
          FallbackDb.update("users", userRecord.id, { profileId: teacherRecord.id });
        }
      }

      // Seed 25 students
      for (let i = 1; i <= 25; i++) {
        const email = `student${i}@fake.com`;
        const username = `student_dummy${i}`;
        const admissionNumber = `STD-DUM-${String(i).padStart(4, "0")}`;
        const parentEmail = `parent${i}@fake.com`;
        const parentPhone = `77766665${String(i).padStart(2, "0")}`;

        let userRecord = FallbackDb.findOne("users", { email });
        if (!userRecord) {
          userRecord = FallbackDb.create("users", {
            username,
            email,
            password: defaultPassword,
            role: "student",
            name: `Student Dummy ${i}`,
            isActive: true,
          });

          const classId = i % 2 === 0 ? class11.id : class10.id;
          const sectionId = i % 2 === 0 ? secB.id : secA.id;

          const studentRecord = FallbackDb.create("students", {
            user: userRecord.id,
            name: `Student Dummy ${i}`,
            firstName: "Student",
            lastName: `Dummy ${i}`,
            admissionNumber,
            rollNumber: String(100 + i),
            email,
            contactNumber: `88877776${String(i).padStart(2, "0")}`,
            parentName: `Parent Dummy ${i}`,
            parentContact: parentPhone,
            parentEmail,
            classId,
            sectionId,
            status: "active",
            permissions: ["dashboard", "academics", "timetable", "reports", "communication"],
          });
          FallbackDb.update("users", userRecord.id, { profileId: studentRecord.id });

          let parent = FallbackDb.findOne("parents", { phone: parentPhone });
          if (!parent) {
            const parentUser = FallbackDb.create("users", {
              username: `par_${parentPhone}`,
              email: parentEmail,
              password: defaultPassword,
              role: "parent",
              name: `Parent Dummy ${i}`,
              isActive: true,
            });
            parent = FallbackDb.create("parents", {
              user: parentUser.id,
              name: `Parent Dummy ${i}`,
              phone: parentPhone,
              email: parentEmail,
              children: [studentRecord.id],
              status: "active",
            });
            FallbackDb.update("users", parentUser.id, { profileId: parent.id });
          } else {
            const children = [...new Set([...(parent.children || []), studentRecord.id])];
            FallbackDb.update("parents", parent.id, { children });
          }
          FallbackDb.update("students", studentRecord.id, { parentId: parent.id });
        }
      }

      return res.status(201).json({
        success: true,
        message: "Successfully seeded 25 dummy teachers and 25 dummy students in Fallback Database.",
      });
    }

    // 2. MongoDB Path
    let class10 = await Class.findOne({ name: "Class 10" });
    if (!class10) {
      class10 = await Class.create({ name: "Class 10", code: "C10", room: "Room 301" });
    }
    let class11 = await Class.findOne({ name: "Class 11" });
    if (!class11) {
      class11 = await Class.create({ name: "Class 11", code: "C11", room: "Room 402" });
    }

    let secA = await Section.findOne({ name: "Section A", classId: class10._id });
    if (!secA) {
      secA = await Section.create({ name: "Section A", classId: class10._id });
    }
    let secB = await Section.findOne({ name: "Section B", classId: class11._id });
    if (!secB) {
      secB = await Section.create({ name: "Section B", classId: class11._id });
    }

    // Seed 25 teachers
    for (let i = 1; i <= 25; i++) {
      const email = `teacher${i}@fake.com`;
      const username = `teacher_dummy${i}`;
      const employeeId = `EMP-DUM-${String(i).padStart(4, "0")}`;

      let userRecord = await User.findOne({ email });
      if (!userRecord) {
        userRecord = await User.create({
          username,
          email,
          password: defaultPassword,
          role: "teacher",
          name: `Teacher Dummy ${i}`,
          isActive: true,
        });
        const teacherRecord = await Teacher.create({
          user: userRecord._id,
          name: `Teacher Dummy ${i}`,
          firstName: "Teacher",
          lastName: `Dummy ${i}`,
          employeeId,
          phone: `99988887${String(i).padStart(2, "0")}`,
          email,
          designation: "Dummy Teacher",
          salary: 30000 + i * 500,
          status: "active",
          classesAssigned: [class10.name],
          sectionsAssigned: [secA.name],
          subjectsAssigned: ["Practical"],
        });
        userRecord.profileId = teacherRecord._id;
        await userRecord.save();
      }
    }

    // Seed 25 students
    for (let i = 1; i <= 25; i++) {
      const email = `student${i}@fake.com`;
      const username = `student_dummy${i}`;
      const admissionNumber = `STD-DUM-${String(i).padStart(4, "0")}`;
      const parentEmail = `parent${i}@fake.com`;
      const parentPhone = `77766665${String(i).padStart(2, "0")}`;

      let userRecord = await User.findOne({ email });
      if (!userRecord) {
        userRecord = await User.create({
          username,
          email,
          password: defaultPassword,
          role: "student",
          name: `Student Dummy ${i}`,
          isActive: true,
        });

        const classId = i % 2 === 0 ? class11._id : class10._id;
        const sectionId = i % 2 === 0 ? secB._id : secA._id;

        const studentRecord = await Student.create({
          user: userRecord._id,
          name: `Student Dummy ${i}`,
          firstName: "Student",
          lastName: `Dummy ${i}`,
          admissionNumber,
          rollNumber: String(100 + i),
          email,
          contactNumber: `88877776${String(i).padStart(2, "0")}`,
          parentName: `Parent Dummy ${i}`,
          parentContact: parentPhone,
          parentEmail,
          classId,
          sectionId,
          status: "active",
          permissions: ["dashboard", "academics", "timetable", "reports", "communication"],
        });
        userRecord.profileId = studentRecord._id;
        await userRecord.save();

        let parent = await Parent.findOne({ phone: parentPhone });
        if (!parent) {
          const parentUser = await User.create({
            username: `par_${parentPhone}`,
            email: parentEmail,
            password: defaultPassword,
            role: "parent",
            name: `Parent Dummy ${i}`,
            isActive: true,
          });
          parent = await Parent.create({
            user: parentUser._id,
            name: `Parent Dummy ${i}`,
            phone: parentPhone,
            email: parentEmail,
            children: [studentRecord._id],
            status: "active",
          });
          parentUser.profileId = parent._id;
          await parentUser.save();
        } else {
          if (!parent.children.includes(studentRecord._id)) {
            parent.children.push(studentRecord._id);
            await parent.save();
          }
        }
        studentRecord.parentId = parent._id;
        await studentRecord.save();
      }
    }

    return res.status(201).json({
      success: true,
      message: "Successfully seeded 25 dummy teachers and 25 dummy students in MongoDB Database.",
    });
  } catch (err) {
    console.error("seedDummies error:", err);
    return res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};
