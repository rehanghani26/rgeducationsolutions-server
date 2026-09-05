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
import Notice from '../models/Notice.js';
import Curriculum from '../models/Curriculum.js';

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

export const createClass = async (req, res) => {
  try {
    const { name, code, room, capacity, totalStudents, classTeacher } = req.body;
    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'Class Name and Registry Code are required' });
    }

    if (checkFallback()) {
      const existing = FallbackDb.findOne('classes', { code });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Class code already exists' });
      }
      const record = FallbackDb.create('classes', {
        name,
        code,
        room: room || 'Room N/A',
        capacity: Number(capacity) || 40,
        totalStudents: Number(totalStudents) || 0,
        classTeacher: classTeacher || 'Unassigned'
      });
      return res.status(201).json({ success: true, message: 'Class created successfully', class: record });
    }

    const existingClass = await Class.findOne({ $or: [{ code }, { name }] });
    if (existingClass) {
      return res.status(400).json({ success: false, message: 'Class name or code already exists' });
    }

    const newClass = await Class.create({
      name,
      code,
      room,
      capacity: Number(capacity) || 40
    });

    return res.status(201).json({ success: true, message: 'Class created successfully', class: newClass });
  } catch (err) {
    console.error('createClass error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error creating class' });
  }
};

export const createSection = async (req, res) => {
  try {
    const { name, classId, className, room, capacity, enrolled, classTeacher } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Section Name is required' });
    }

    if (checkFallback()) {
      const record = FallbackDb.create('sections', {
        name,
        classId: classId || 'c1',
        className: className || 'Grade 10',
        room: room || 'Block A - Room 201',
        capacity: Number(capacity) || 35,
        enrolled: Number(enrolled) || 0,
        classTeacher: classTeacher || 'Unassigned'
      });
      return res.status(201).json({ success: true, message: 'Section created successfully', section: record });
    }

    const newSection = await Section.create({
      name,
      classId: classId || undefined,
      room,
      capacity: Number(capacity) || 35,
      enrolled: Number(enrolled) || 0
    });

    return res.status(201).json({ success: true, message: 'Section created successfully', section: newSection });
  } catch (err) {
    console.error('createSection error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error creating section' });
  }
};

export const createSubject = async (req, res) => {
  try {
    const { name, code, type, credits, teacher } = req.body;
    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'Subject Name and Registry Code are required' });
    }

    if (checkFallback()) {
      const existing = FallbackDb.findOne('subjects', { code });
      if (existing) {
        return res.status(400).json({ success: false, message: 'Subject code already exists' });
      }
      const record = FallbackDb.create('subjects', {
        name,
        code,
        type: type || 'theory',
        credits: Number(credits) || 3,
        teacher: teacher || 'Unassigned'
      });
      return res.status(201).json({ success: true, message: 'Subject created successfully', subject: record });
    }

    const existingSub = await Subject.findOne({ code });
    if (existingSub) {
      return res.status(400).json({ success: false, message: 'Subject code already exists' });
    }

    const newSubject = await Subject.create({
      name,
      code,
      type: type || 'theory',
      credits: Number(credits) || 3,
      teacher: teacher || 'Unassigned'
    });

    return res.status(201).json({ success: true, message: 'Subject created successfully', subject: newSubject });
  } catch (err) {
    console.error('createSubject error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Server error creating subject' });
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
    const data = { ...req.body };
    if (data.companyLogo && !data.schoolLogo) {
      data.schoolLogo = data.companyLogo;
    } else if (data.schoolLogo && !data.companyLogo) {
      data.companyLogo = data.schoolLogo;
    }

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

    if (type === 'logo') {
      imageData.companyLogo = result.secure_url;
    }

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

// Notice Board controllers
export const getNotices = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('notices');
      if (!list || list.length === 0) {
        list = [
          { _id: 'not-1', id: 'not-1', title: 'School Annual Day Celebration', content: 'All students, staff, and parents are invited to the Annual Day on May 25, 2026.', category: 'Event', icon: '📢', priority: 'high', targetRoles: ['all'], author: 'Principal', createdAt: new Date() },
          { _id: 'not-2', id: 'not-2', title: 'Mathematics Mid-Term Exam Schedule', content: 'Mid-term exams for Class 9 & 10 start on May 20, 2026.', category: 'Academic', icon: '📅', priority: 'high', targetRoles: ['student', 'teacher'], author: 'Exam Cell', createdAt: new Date() },
          { _id: 'not-3', id: 'not-3', title: 'Bus Route #3 Timing Revision', content: 'Route 3 morning pickup will be 10 minutes earlier starting Monday.', category: 'Transport', icon: '🚌', priority: 'medium', targetRoles: ['student', 'parent'], author: 'Transport Dept', createdAt: new Date() },
        ];
      }
    } else {
      list = await Notice.find({ active: { $ne: false } }).sort({ createdAt: -1 });
      if (list.length === 0) {
        const seedNotices = [
          { title: 'School Annual Day Celebration', content: 'All students, staff, and parents are invited to the Annual Day on May 25, 2026.', category: 'Event', icon: '📢', priority: 'high', targetRoles: ['all'], author: 'Principal' },
          { title: 'Mathematics Mid-Term Exam Schedule', content: 'Mid-term exams for Class 9 & 10 start on May 20, 2026.', category: 'Academic', icon: '📅', priority: 'high', targetRoles: ['student', 'teacher'], author: 'Exam Cell' },
          { title: 'Bus Route #3 Timing Revision', content: 'Route 3 morning pickup will be 10 minutes earlier starting Monday.', category: 'Transport', icon: '🚌', priority: 'medium', targetRoles: ['student', 'parent'], author: 'Transport Dept' },
        ];
        list = await Notice.insertMany(seedNotices);
      }
    }
    res.status(200).json({ success: true, count: list.length, notices: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const createNotice = async (req, res) => {
  try {
    const { title, content, category, icon, priority, targetRoles } = req.body;
    if (!title || !content) {
      return res.status(400).json({ success: false, message: 'Title and content are required' });
    }

    const payload = {
      title,
      content,
      category: category || 'General',
      icon: icon || '📢',
      priority: priority || 'medium',
      targetRoles: targetRoles || ['all'],
      author: req.user?.name || req.user?.username || 'Administration',
    };

    let item;
    if (checkFallback()) {
      item = FallbackDb.insert('notices', payload);
    } else {
      item = await Notice.create(payload);
    }

    res.status(201).json({ success: true, message: 'Notice published successfully', notice: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteNotice = async (req, res) => {
  try {
    const { id } = req.params;
    if (checkFallback()) {
      FallbackDb.delete('notices', id);
    } else {
      await Notice.findByIdAndDelete(id);
    }
    res.status(200).json({ success: true, message: 'Notice removed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// Leave Management Controllers
export const getMyLeaves = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('leaves') || [];
      list = list.filter(l => l.userId === userId || l.applicantRole === req.user?.role);
    }
    if (!list || list.length === 0) {
      list = [
        { _id: 'lv-01', id: 'lv-01', category: 'Medical Leave', reason: 'High fever and doctor advice for 3 days rest.', startDate: '2026-05-18', endDate: '2026-05-20', status: 'approved', applicantName: req.user?.name || 'Student', applicantRole: req.user?.role || 'student', createdAt: new Date() },
        { _id: 'lv-02', id: 'lv-02', category: 'Personal / Family', reason: 'Attending family wedding function.', startDate: '2026-05-25', endDate: '2026-05-26', status: 'pending', applicantName: req.user?.name || 'Student', applicantRole: req.user?.role || 'student', createdAt: new Date() },
      ];
    }
    res.status(200).json({ success: true, leaves: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getAllLeaves = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('leaves') || [];
    }
    if (!list || list.length === 0) {
      list = [
        { _id: 'lv-01', id: 'lv-01', category: 'Medical Leave', reason: 'High fever and doctor advice for 3 days rest.', startDate: '2026-05-18', endDate: '2026-05-20', status: 'pending', applicantName: 'Ahmed Al-Rashidi', applicantRole: 'student', classSection: 'Class 10-A', createdAt: new Date() },
        { _id: 'lv-02', id: 'lv-02', category: 'Casual Leave', reason: 'Urgent personal home maintenance.', startDate: '2026-05-22', endDate: '2026-05-23', status: 'pending', applicantName: 'Dr. Tariq Al-Hassan', applicantRole: 'teacher', department: 'Sciences', createdAt: new Date() },
        { _id: 'lv-03', id: 'lv-03', category: 'Family Event', reason: 'Sister wedding function out of town.', startDate: '2026-05-12', endDate: '2026-05-14', status: 'approved', applicantName: 'Fatima Al-Zahra', applicantRole: 'student', classSection: 'Class 9-B', createdAt: new Date() },
      ];
    }
    res.status(200).json({ success: true, leaves: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const requestLeave = async (req, res) => {
  try {
    const { category, reason, startDate, endDate, date } = req.body;
    if (!reason) {
      return res.status(400).json({ success: false, message: 'Reason is required' });
    }

    const payload = {
      userId: req.user?.id || req.user?._id,
      applicantName: req.user?.name || req.user?.username || 'User',
      applicantRole: req.user?.role || 'student',
      category: category || 'General Leave',
      reason,
      startDate: startDate || date || new Date().toISOString().split('T')[0],
      endDate: endDate || startDate || date || new Date().toISOString().split('T')[0],
      status: 'pending',
      createdAt: new Date(),
    };

    let item;
    if (checkFallback()) {
      item = FallbackDb.insert('leaves', payload);
    } else {
      item = payload;
    }

    res.status(201).json({ success: true, message: 'Leave application submitted successfully', leave: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const reviewLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (checkFallback()) {
      FallbackDb.update('leaves', id, { status });
    }
    res.status(200).json({ success: true, message: `Leave status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── Dynamic Academic Curriculum & Courses Helpers ─────────────────────────────
const DEFAULT_CURRICULUM_SEED = [
  {
    className: 'Class 10',
    sectionName: 'Section A',
    name: 'Mathematics & Geometry',
    code: 'MTH-103',
    type: 'theory',
    credits: 5,
    teacher: 'Dr. Bilal Siddiqui',
    teacherRole: 'Senior Mathematics Faculty',
    room: 'Block A - Room 101',
    schedule: 'Mon, Wed, Fri (08:00 AM)',
    progress: 74,
    currentChapter: 'Unit 4: Quadratic Equations & Parabolas',
    assignedBy: 'System Administrator',
    assignedByRole: 'super-admin',
    units: [
      { id: 1, title: 'Unit 1: Real Numbers & Set Theory', status: 'completed', duration: '2 weeks' },
      { id: 2, title: 'Unit 2: Polynomials & Factorization', status: 'completed', duration: '3 weeks' },
      { id: 3, title: 'Unit 3: Linear Equations in Two Variables', status: 'completed', duration: '2.5 weeks' },
      { id: 4, title: 'Unit 4: Quadratic Equations & Parabolas', status: 'in-progress', duration: 'Current (Week 8)' },
      { id: 5, title: 'Unit 5: Arithmetic Progressions & Series', status: 'upcoming', duration: 'Next' },
      { id: 6, title: 'Unit 6: Coordinate Geometry & Vectors', status: 'upcoming', duration: '3 weeks' },
    ],
    materials: [
      { name: 'Class 10 Geometry Formula Handbook', type: 'PDF', size: '3.4 MB', date: 'Aug 20, 2026' },
      { name: 'Unit 3 Solved Question Bank with Solutions', type: 'PDF', size: '5.1 MB', date: 'Aug 28, 2026' },
    ],
  },
  {
    className: 'Class 10',
    sectionName: 'Section A',
    name: 'Physics & Applied Mechanics',
    code: 'PHY-104',
    type: 'practical',
    credits: 4,
    teacher: 'Prof. Mohammed Zakir',
    teacherRole: 'Physics Department Head',
    room: 'Science Lab 2',
    schedule: 'Tue, Thu (08:55 AM)',
    progress: 68,
    currentChapter: 'Unit 3: Electromagnetism & Induced Currents',
    assignedBy: 'System Administrator',
    assignedByRole: 'super-admin',
    units: [
      { id: 1, title: 'Unit 1: Kinematics & Laws of Motion', status: 'completed', duration: '3 weeks' },
      { id: 2, title: 'Unit 2: Work, Energy, and Gravitational Fields', status: 'completed', duration: '3 weeks' },
      { id: 3, title: 'Unit 3: Electromagnetism & Induced Currents', status: 'in-progress', duration: 'Current (Week 8)' },
      { id: 4, title: 'Unit 4: Optics, Reflection & Refraction', status: 'upcoming', duration: 'Next' },
      { id: 5, title: 'Unit 5: Wave Mechanics & Sound Waves', status: 'upcoming', duration: '2.5 weeks' },
    ],
    materials: [
      { name: 'Physics Laboratory Practical Manual & Safety Guidelines', type: 'PDF', size: '4.8 MB', date: 'Aug 15, 2026' },
      { name: 'Electromagnetism Lecture Slides & Diagrams', type: 'PPTX', size: '8.2 MB', date: 'Sep 02, 2026' },
    ],
  },
  {
    className: 'Class 10',
    sectionName: 'Section A',
    name: 'Quranic Sciences & Tajweed',
    code: 'ISL-101',
    type: 'theory',
    credits: 4,
    teacher: 'Sheikh Abdullah Al-Hafiz',
    teacherRole: 'Head of Religious Studies',
    room: 'Main Lecture Hall B',
    schedule: 'Mon, Wed, Thu (11:15 AM)',
    progress: 82,
    currentChapter: 'Unit 5: Rules of Noon Sakinah and Tanween in Recitation',
    assignedBy: 'System Administrator',
    assignedByRole: 'super-admin',
    units: [
      { id: 1, title: 'Unit 1: Introduction to Quranic Sciences (Ulum al-Quran)', status: 'completed', duration: '2 weeks' },
      { id: 2, title: 'Unit 2: Makki and Madani Surahs and Chronology', status: 'completed', duration: '2 weeks' },
      { id: 3, title: 'Unit 3: Makharij al-Huroof (Articulation Points)', status: 'completed', duration: '3 weeks' },
      { id: 4, title: 'Unit 4: Sifaat al-Huroof (Characteristics of Letters)', status: 'completed', duration: '2.5 weeks' },
      { id: 5, title: 'Unit 5: Rules of Noon Sakinah & Tanween', status: 'in-progress', duration: 'Current' },
      { id: 6, title: 'Unit 6: Madd (Elongation) Types and Practical Recitation', status: 'upcoming', duration: '3 weeks' },
    ],
    materials: [
      { name: 'Comprehensive Tajweed Rules Reference Chart', type: 'PDF', size: '2.1 MB', date: 'Aug 10, 2026' },
      { name: 'Recitation Audio Guide & Pronunciation Guide', type: 'ZIP', size: '14.5 MB', date: 'Aug 12, 2026' },
    ],
  },
  {
    className: 'Class 10',
    sectionName: 'Section A',
    name: 'Classical & Modern Arabic',
    code: 'ARB-102',
    type: 'theory',
    credits: 4,
    teacher: 'Fatima Az-Zahra',
    teacherRole: 'Faculty of Arabic Linguistics',
    room: 'Block A - Room 102',
    schedule: 'Mon, Tue, Thu (09:50 AM)',
    progress: 70,
    currentChapter: 'Unit 4: Verb Conjugations & Weak Verb Patterns',
    assignedBy: 'System Administrator',
    assignedByRole: 'super-admin',
    units: [
      { id: 1, title: 'Unit 1: Arabic Morphology & Word Construction', status: 'completed', duration: '3 weeks' },
      { id: 2, title: 'Unit 2: Nominal Sentences and Predicates', status: 'completed', duration: '2.5 weeks' },
      { id: 3, title: 'Unit 3: Idafa (Possession) and Adjectives', status: 'completed', duration: '2 weeks' },
      { id: 4, title: 'Unit 4: Verb Conjugations & Irregular Verbs', status: 'in-progress', duration: 'Current' },
      { id: 5, title: 'Unit 5: Comprehension, Translation, and Dialogue', status: 'upcoming', duration: '3 weeks' },
    ],
    materials: [
      { name: 'Arabic Grammar Essentials Handbook (Nahw & Sarf)', type: 'PDF', size: '3.9 MB', date: 'Aug 18, 2026' },
      { name: 'Weekly Vocabulary & Conversational Exercises', type: 'PDF', size: '1.7 MB', date: 'Sep 01, 2026' },
    ],
  },
  {
    className: 'Class 10',
    sectionName: 'Section A',
    name: 'English Language & Literature',
    code: 'ENG-105',
    type: 'theory',
    credits: 4,
    teacher: 'Sumayya Khan',
    teacherRole: 'Department of Humanities',
    room: 'Block B - Room 204',
    schedule: 'Mon, Wed, Fri (12:10 PM)',
    progress: 78,
    currentChapter: 'Unit 4: Analytical Essay Writing & Rhetorical Devices',
    assignedBy: 'System Administrator',
    assignedByRole: 'super-admin',
    units: [
      { id: 1, title: 'Unit 1: Modern Short Stories & Literary Elements', status: 'completed', duration: '3 weeks' },
      { id: 2, title: 'Unit 2: Poetry Analysis & Metaphorical Devices', status: 'completed', duration: '2.5 weeks' },
      { id: 3, title: 'Unit 3: Advanced Grammar, Syntax, and Punctuation', status: 'completed', duration: '2 weeks' },
      { id: 4, title: 'Unit 4: Analytical Essay Writing', status: 'in-progress', duration: 'Current' },
      { id: 5, title: 'Unit 5: Drama: Shakespearean Excerpts & Performance', status: 'upcoming', duration: '3 weeks' },
    ],
    materials: [
      { name: 'Selected Anthology of Prose and Poetry Reader', type: 'PDF', size: '6.2 MB', date: 'Aug 22, 2026' },
      { name: 'Essay Writing Rubric & Model High-Scoring Samples', type: 'PDF', size: '2.4 MB', date: 'Aug 30, 2026' },
    ],
  },
  {
    className: 'Class 10',
    sectionName: 'Section A',
    name: 'Chemistry & Experimental Sciences',
    code: 'CHM-107',
    type: 'practical',
    credits: 4,
    teacher: 'Dr. Amina Farooqui',
    teacherRole: 'Senior Chemistry Lecturer',
    room: 'Chemistry Lab 1',
    schedule: 'Tue, Fri (01:30 PM)',
    progress: 62,
    currentChapter: 'Unit 3: Chemical Bonding, Molecular Geometry & Orbitals',
    assignedBy: 'System Administrator',
    assignedByRole: 'super-admin',
    units: [
      { id: 1, title: 'Unit 1: Atomic Structure and Periodic Trends', status: 'completed', duration: '3 weeks' },
      { id: 2, title: 'Unit 2: Stoichiometry and Solution Concentration', status: 'completed', duration: '2.5 weeks' },
      { id: 3, title: 'Unit 3: Chemical Bonding & Molecular Geometry', status: 'in-progress', duration: 'Current' },
      { id: 4, title: 'Unit 4: Thermochemistry & Reaction Kinetics', status: 'upcoming', duration: 'Next' },
      { id: 5, title: 'Unit 5: Acids, Bases, and Equilibrium Systems', status: 'upcoming', duration: '3 weeks' },
    ],
    materials: [
      { name: 'Periodic Table & Chemical Constants Reference Booklet', type: 'PDF', size: '1.9 MB', date: 'Aug 14, 2026' },
      { name: 'Laboratory Titration & Synthesis Lab Protocols', type: 'PDF', size: '3.8 MB', date: 'Aug 26, 2026' },
    ],
  },
];

export const getCurriculums = async (req, res) => {
  try {
    const { className, sectionName } = req.query;
    let curriculums = [];

    if (checkFallback()) {
      curriculums = FallbackDb.find('curriculums') || [];
      if (curriculums.length === 0) {
        DEFAULT_CURRICULUM_SEED.forEach((item) => FallbackDb.create('curriculums', item));
        curriculums = FallbackDb.find('curriculums');
      }
      if (className && className !== 'All') {
        const numMatch = className.match(/\d+/)?.[0];
        curriculums = curriculums.filter((c) => {
          if (!c.className) return true;
          if (numMatch && c.className.includes(numMatch)) return true;
          return c.className.toLowerCase().includes(className.toLowerCase());
        });
      }
      if (sectionName && sectionName !== 'All' && sectionName !== 'All Sections') {
        curriculums = curriculums.filter((c) => {
          if (!c.sectionName || c.sectionName === 'All Sections') return true;
          return c.sectionName.toLowerCase() === sectionName.toLowerCase();
        });
      }
    } else {
      const query = {};
      if (className && className !== 'All') {
        const numMatch = className.match(/\d+/)?.[0];
        if (numMatch) {
          query.className = new RegExp(numMatch, 'i');
        } else {
          query.className = new RegExp(className.trim(), 'i');
        }
      }
      if (sectionName && sectionName !== 'All' && sectionName !== 'All Sections') {
        query.$or = [
          { sectionName: new RegExp(`^${sectionName.trim()}$`, 'i') },
          { sectionName: 'All Sections' },
          { sectionName: { $exists: false } },
          { sectionName: '' },
          { sectionName: null },
        ];
      }

      curriculums = await Curriculum.find(query).sort({ createdAt: -1 });
      if (curriculums.length === 0 && (!className || className.toLowerCase().includes('10'))) {
        // Seed default records if empty
        const count = await Curriculum.countDocuments();
        if (count === 0) {
          await Curriculum.insertMany(DEFAULT_CURRICULUM_SEED);
          curriculums = await Curriculum.find(query).sort({ createdAt: -1 });
        }
      }
    }

    res.status(200).json({
      success: true,
      count: curriculums.length,
      curriculums: curriculums.length ? curriculums : DEFAULT_CURRICULUM_SEED,
    });
  } catch (err) {
    console.error('getCurriculums error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error fetching curriculum' });
  }
};

export const createCurriculum = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase().replace(/_/g, '-');
    const isPrivileged = ['super-admin', 'superadmin', 'school-admin', 'admin', 'principal', 'director'].includes(userRole);
    const isTeacher = ['teacher', 'head-teacher', 'hod', 'coordinator'].includes(userRole);

    if (!isPrivileged && !isTeacher) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied. Only Administrators, Principals, and Class Teachers can assign curriculum & courses.',
      });
    }

    const {
      className,
      sectionName,
      name,
      code,
      type,
      credits,
      teacher,
      teacherRole,
      room,
      schedule,
      progress,
      currentChapter,
      units,
      materials,
    } = req.body;

    if (!name || !code) {
      return res.status(400).json({ success: false, message: 'Subject Name and Course Code are required' });
    }

    const payload = {
      className: className || 'Class 10',
      sectionName: sectionName || 'All Sections',
      name: name.trim(),
      code: code.trim().toUpperCase(),
      type: type || 'theory',
      credits: Number(credits) || 4,
      teacher: teacher || req.user.name || 'Assigned Faculty',
      teacherRole: teacherRole || (isTeacher ? 'Class Teacher' : 'Subject Lecturer'),
      room: room || 'Room 101',
      schedule: schedule || 'Mon, Wed, Fri (08:00 AM)',
      progress: Number(progress) || 0,
      currentChapter: currentChapter || '',
      assignedBy: req.user.name || 'Administration',
      assignedByRole: userRole,
      units: Array.isArray(units) ? units : [],
      materials: Array.isArray(materials) ? materials : [],
    };

    let record;
    if (checkFallback()) {
      record = FallbackDb.create('curriculums', payload);
    } else {
      record = await Curriculum.create(payload);
    }

    res.status(201).json({
      success: true,
      message: 'Academic Curriculum & Course assigned successfully',
      curriculum: record,
    });
  } catch (err) {
    console.error('createCurriculum error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to assign curriculum' });
  }
};

export const updateCurriculum = async (req, res) => {
  try {
    const { id } = req.params;
    let updated;

    if (checkFallback()) {
      updated = FallbackDb.update('curriculums', id, req.body);
    } else {
      updated = await Curriculum.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
    }

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Curriculum record not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Curriculum updated successfully',
      curriculum: updated,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to update curriculum' });
  }
};

export const deleteCurriculum = async (req, res) => {
  try {
    const { id } = req.params;

    if (checkFallback()) {
      FallbackDb.delete('curriculums', id);
    } else {
      await Curriculum.findByIdAndDelete(id);
    }

    res.status(200).json({
      success: true,
      message: 'Curriculum course removed successfully',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to delete curriculum' });
  }
};

export const addCurriculumUnit = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, status, duration } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, message: 'Unit title is required' });
    }

    const newUnit = {
      id: Date.now(),
      title,
      status: status || 'upcoming',
      duration: duration || '2 weeks',
    };

    if (checkFallback()) {
      const cur = FallbackDb.findOne('curriculums', { id });
      if (cur) {
        cur.units = [...(cur.units || []), newUnit];
        FallbackDb.update('curriculums', id, cur);
      }
    } else {
      await Curriculum.findByIdAndUpdate(id, { $push: { units: newUnit } });
    }

    res.status(200).json({ success: true, message: 'Unit added successfully', unit: newUnit });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const addCurriculumMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, size, url } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Material name is required' });
    }

    const newMat = {
      name,
      type: type || 'PDF',
      size: size || '2.5 MB',
      url: url || '',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    };

    if (checkFallback()) {
      const cur = FallbackDb.findOne('curriculums', { id });
      if (cur) {
        cur.materials = [...(cur.materials || []), newMat];
        FallbackDb.update('curriculums', id, cur);
      }
    } else {
      await Curriculum.findByIdAndUpdate(id, { $push: { materials: newMat } });
    }

    res.status(200).json({ success: true, message: 'Study material added successfully', material: newMat });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
