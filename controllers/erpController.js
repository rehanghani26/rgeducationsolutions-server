// 3. Configuration
import { checkFallback } from '../config/db.js';
import { uploadToS3, generateS3Key, getPresignedUrl, resolveFileUrl } from '../config/s3.js';

// 4. Models
import Book from '../models/Book.js';
import Class from '../models/Class.js';
import ClassRoom from '../models/ClassRoom.js';
import Curriculum from '../models/Curriculum.js';
import Leave from '../models/Leave.js';
import Library from '../models/Library.js';
import Notice from '../models/Notice.js';
import Notification from '../models/Notification.js';
import Parent from '../models/Parent.js';
import Section from '../models/Section.js';
import Setting from '../models/Setting.js';
import Student from '../models/Student.js';
import Subject from '../models/Subject.js';
import Teacher from '../models/Teacher.js';
import Transport from '../models/Transport.js';
import User from '../models/User.js';

// 6. Services
import { FallbackDb } from '../services/dbFallback.js';

// 7. Utilities
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendForbidden,
  sendError
} from '../utils/responseUtil.js';

/**
 * Upload an image buffer to S3 under the company-profile folder.
 * Returns an S3-result-shaped object.
 *
 * @param {Buffer} fileBuffer - Image file buffer.
 * @param {'logo'|'banner'} type - Image type descriptor.
 * @param {string} originalName - Original uploaded filename.
 * @param {string} mimeType - File MIME type.
 * @returns {Promise<Object>} S3 asset metadata descriptor.
 */
const uploadBufferToS3 = async (fileBuffer, type, originalName, mimeType) => {
  const folder = `school-erp/company-profile/${type}`;
  const key = generateS3Key(folder, originalName);
  await uploadToS3({ buffer: fileBuffer, key, contentType: mimeType });
  return {
    key,
    secure_url: key,
    public_id: key,
    asset_id: '',
    original_filename: originalName.replace(/\.[^.]+$/, '')
  };
};

/**
 * Retrieve all registered academic classes.
 *
 * @route GET /api/erp/classes
 */
export const getClasses = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('classes');
    } else {
      list = await ClassRoom.find().sort({ className: 1, sectionName: 1 });
    }
    return res.json({ success: true, classes: list });
  } catch (err) {
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Retrieve all registered academic sections.
 *
 * @route GET /api/erp/sections
 */
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
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Retrieve all academic subjects.
 *
 * @route GET /api/erp/subjects
 */
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
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Create a new academic class record.
 *
 * @route POST /api/erp/classes
 */
export const createClass = async (req, res) => {
  try {
    const { name, code, room, capacity, totalStudents, classTeacher } = req.body;
    if (!name || !code) {
      return sendBadRequest(res, 'Class Name and Registry Code are required');
    }

    if (checkFallback()) {
      const existing = FallbackDb.findOne('classes', { code });
      if (existing) {
        return sendBadRequest(res, 'Class code already exists');
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
      return sendBadRequest(res, 'Class name or code already exists');
    }

    const newClass = await Class.create({
      name,
      code,
      room,
      capacity: Number(capacity) || 40
    });

    return res.status(201).json({ success: true, message: 'Class created successfully', class: newClass });
  } catch (err) {
    return sendError(res, err.message || 'Server error creating class', 500, err);
  }
};

/**
 * Create a new section for a class.
 *
 * @route POST /api/erp/sections
 */
export const createSection = async (req, res) => {
  try {
    const { name, classId, className, room, capacity, enrolled, classTeacher } = req.body;
    if (!name) {
      return sendBadRequest(res, 'Section Name is required');
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
    return sendError(res, err.message || 'Server error creating section', 500, err);
  }
};

/**
 * Register a new academic subject.
 *
 * @route POST /api/erp/subjects
 */
export const createSubject = async (req, res) => {
  try {
    const { name, code, type, credits, teacher } = req.body;
    if (!name || !code) {
      return sendBadRequest(res, 'Subject Name and Registry Code are required');
    }

    if (checkFallback()) {
      const existing = FallbackDb.findOne('subjects', { code });
      if (existing) {
        return sendBadRequest(res, 'Subject code already exists');
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
      return sendBadRequest(res, 'Subject code already exists');
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
    return sendError(res, err.message || 'Server error creating subject', 500, err);
  }
};

/**
 * Retrieve all library inventory books.
 *
 * @route GET /api/erp/books
 */
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
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Add a new book to the library catalog.
 *
 * @route POST /api/erp/books
 */
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
    return sendError(res, err.message, 500, err);
  }
};

/**
 * Retrieve issued library books log.
 *
 * @route GET /api/erp/library/issues
 */
export const getLibraryIssues = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('library');
      list = list.map((item) => {
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
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Issue a book to a student.
 *
 * @route POST /api/erp/library/issue
 */
export const issueBook = async (req, res) => {
  try {
    const { bookId, studentId, dueDate } = req.body;
    let issueRecord = null;

    if (checkFallback()) {
      const book = FallbackDb.findById('books', bookId);
      if (!book || book.totalQty <= book.issuedQty) {
        return sendBadRequest(res, 'Book is currently unavailable');
      }

      FallbackDb.update('books', bookId, { issuedQty: book.issuedQty + 1 });
      
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
        return sendBadRequest(res, 'Book is unavailable');
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
    return sendError(res, err.message, 500, err);
  }
};

/**
 * Retrieve transport route details.
 *
 * @route GET /api/erp/transport
 */
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
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Retrieve system alert notifications.
 *
 * @route GET /api/erp/notifications
 */
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
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Fetch ERP global application settings with optional category filtering and S3 presigned URLs.
 *
 * @route GET /api/erp/settings
 */
export const getSettings = async (req, res) => {
  try {
    const { category, includePortal, includeTemplates } = req.query;

    let config = null;
    if (checkFallback()) {
      config = FallbackDb.getSettings();
    } else {
      let query = Setting.findOne();
      if (includePortal !== 'true' && includeTemplates !== 'true') {
        query = query.select('-portalSettings -defaultDocumentTemplates');
      } else if (includePortal !== 'true') {
        query = query.select('-portalSettings');
      } else if (includeTemplates !== 'true') {
        query = query.select('-defaultDocumentTemplates');
      }

      config = await query;
      if (!config) {
        config = new Setting({});
        await config.save();
      }
    }

    const settings = config?.toObject ? config.toObject() : { ...(config || {}) };

    if (includePortal !== 'true') {
      delete settings.portalSettings;
    }
    if (includeTemplates !== 'true') {
      delete settings.defaultDocumentTemplates;
    }

    const logoKey = settings.schoolLogoPublicId || settings.schoolLogo || settings.companyLogo || '';
    const bannerKey = settings.schoolBannerPublicId || settings.schoolBanner || '';

    const [resolvedLogo, resolvedBanner] = await Promise.all([
      resolveFileUrl(logoKey, 3600),
      resolveFileUrl(bannerKey, 3600)
    ]);

    if (resolvedLogo) {
      settings.schoolLogo = resolvedLogo;
      settings.companyLogo = resolvedLogo;
    }
    if (resolvedBanner) {
      settings.schoolBanner = resolvedBanner;
    }

    if (category) {
      const categoryFilters = {
        profile: [
          'schoolName', 'schoolCode', 'registrationNumber', 'affiliationNumber', 'schoolType',
          'establishedYear', 'academicYear', 'contactEmail', 'schoolPhone', 'alternatePhone',
          'websiteUrl', 'addressLine1', 'addressLine2', 'city', 'state', 'country', 'postalCode',
          'companyLogo', 'schoolLogo', 'schoolBanner', 'schoolMotto', 'principalName', 'currencySymbol'
        ],
        academic: ['defaultPassingPercentage', 'gradePointScale', 'enableGradeDistribution', 'academicYear'],
        students: ['autoGenerateAdmissionNumber', 'admissionNumberPrefix', 'defaultStudentPassword', 'maxStudentsPerSection'],
        teachers: ['autoGenerateTeacherID', 'teacherIDPrefix', 'maxTeachersPerClass'],
        finance: ['currencySymbol', 'enableInstallmentPayment', 'lateFeesPercentage', 'enableAutoReminder', 'reminderDaysBefore'],
        inventory: ['enableInventoryTracking', 'lowStockAlert', 'lowStockThreshold', 'enableBarcode'],
        security: ['enableDataEncryption', 'enableAuditLog', 'enableTwoFactor', 'sessionTimeout', 'passwordExpiry'],
        notifications: ['enableEmailAlerts', 'enableSmsAlerts', 'enablePushNotifications'],
        hr: ['enableTimesheet', 'timesheetFrequency', 'overtimeMultiplier', 'attendanceRequirement', 'enableLeavePolicy', 'annualLeaveDays', 'sickLeaveDays', 'enablePerformanceReview', 'reviewFrequency'],
        backup: ['autoBackupEnabled', 'backupFrequency']
      };

      const allowedFields = categoryFilters[category.toLowerCase()];
      if (allowedFields) {
        const filtered = { _id: settings._id };
        allowedFields.forEach((key) => {
          if (settings[key] !== undefined) filtered[key] = settings[key];
        });
        return res.json({ success: true, category, settings: filtered });
      }
    }

    return res.json({ success: true, settings });
  } catch (err) {
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Update global application settings.
 *
 * @route PUT /api/erp/settings
 */
export const updateSettings = async (req, res) => {
  try {
    const data = { ...req.body };

    delete data._id;
    delete data.__v;
    delete data.createdAt;
    delete data.updatedAt;

    if (!data.portalSettings) {
      delete data.portalSettings;
    }
    if (!data.defaultDocumentTemplates) {
      delete data.defaultDocumentTemplates;
    }

    if (data.companyLogo && !data.schoolLogo) {
      data.schoolLogo = data.companyLogo;
    } else if (data.schoolLogo && !data.companyLogo) {
      data.companyLogo = data.schoolLogo;
    }

    let config = null;
    if (checkFallback()) {
      config = FallbackDb.updateSettings(data);
    } else {
      config = await Setting.findOneAndUpdate(
        {},
        { $set: data },
        { new: true, upsert: true }
      ).select('-portalSettings -defaultDocumentTemplates');
    }

    const settings = config?.toObject ? config.toObject() : { ...(config || {}) };
    delete settings.portalSettings;
    delete settings.defaultDocumentTemplates;

    return res.json({ success: true, message: 'Configuration settings updated', settings });
  } catch (err) {
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Upload school logo or banner image to AWS S3 and update settings.
 *
 * @route POST /api/erp/upload-profile-image
 */
export const uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return sendBadRequest(res, 'Please upload an image file');
    }

    if (!req.file.mimetype.startsWith('image/')) {
      return sendBadRequest(res, 'Please upload a valid image file');
    }

    const type = req.body.type === 'banner' ? 'banner' : 'logo';

    if (!process.env.AWS_S3_BUCKET_NAME) {
      return sendError(res, 'AWS S3 is not configured on the server', 500);
    }

    const result = await uploadBufferToS3(
      req.file.buffer,
      type,
      req.file.originalname,
      req.file.mimetype
    );

    const fieldPrefix = type === 'banner' ? 'schoolBanner' : 'schoolLogo';

    const imageData = {
      [`${fieldPrefix}`]: result.key,
      [`${fieldPrefix}PublicId`]: result.key,
      [`${fieldPrefix}AssetId`]: '',
      [`${fieldPrefix}Name`]: result.original_filename || req.file.originalname
    };
    if (type === 'logo') {
      imageData.companyLogo = result.key;
    }

    let settings = null;
    if (checkFallback()) {
      settings = FallbackDb.updateSettings(imageData);
    } else {
      settings = await Setting.findOneAndUpdate({}, imageData, { new: true, upsert: true });
    }

    const presignedUrl = await getPresignedUrl(result.key, 3600);

    return res.status(201).json({
      success: true,
      message: 'Image uploaded successfully',
      image: {
        type,
        url: presignedUrl,
        publicId: result.key,
        assetId: '',
        name: result.original_filename || req.file.originalname
      },
      settings
    });
  } catch (err) {
    return sendError(res, 'Failed to upload image', 500, err);
  }
};

/**
 * Seed initial sample dummy teachers, students, parents, and classes.
 *
 * @route POST /api/erp/seed-dummies
 */
export const seedDummies = async (req, res) => {
  try {
    const defaultPassword = '123456';

    if (checkFallback()) {
      let class10 = FallbackDb.findOne('classes', { name: 'Class 10' });
      if (!class10) {
        class10 = FallbackDb.create('classes', { name: 'Class 10', code: 'C10', room: 'Room 301' });
      }
      let class11 = FallbackDb.findOne('classes', { name: 'Class 11' });
      if (!class11) {
        class11 = FallbackDb.create('classes', { name: 'Class 11', code: 'C11', room: 'Room 402' });
      }

      let secA = FallbackDb.findOne('sections', { name: 'Section A', classId: class10.id });
      if (!secA) {
        secA = FallbackDb.create('sections', { name: 'Section A', classId: class10.id });
      }
      let secB = FallbackDb.findOne('sections', { name: 'Section B', classId: class11.id });
      if (!secB) {
        secB = FallbackDb.create('sections', { name: 'Section B', classId: class11.id });
      }

      for (let i = 1; i <= 25; i++) {
        const email = `teacher${i}@fake.com`;
        const username = `teacher_dummy${i}`;
        const employeeId = `EMP-DUM-${String(i).padStart(4, '0')}`;

        let userRecord = FallbackDb.findOne('users', { email });
        if (!userRecord) {
          userRecord = FallbackDb.create('users', {
            username,
            email,
            password: defaultPassword,
            role: 'teacher',
            name: `Teacher Dummy ${i}`,
            isActive: true
          });
          const teacherRecord = FallbackDb.create('teachers', {
            user: userRecord.id,
            name: `Teacher Dummy ${i}`,
            firstName: 'Teacher',
            lastName: `Dummy ${i}`,
            employeeId,
            phone: `99988887${String(i).padStart(2, '0')}`,
            email,
            designation: 'Dummy Teacher',
            salary: 30000 + i * 500,
            status: 'active',
            classesAssigned: [class10.id],
            sectionsAssigned: [secA.id],
            subjectsAssigned: ['Practical']
          });
          FallbackDb.update('users', userRecord.id, { profileId: teacherRecord.id });
        }
      }

      for (let i = 1; i <= 25; i++) {
        const email = `student${i}@fake.com`;
        const username = `student_dummy${i}`;
        const admissionNumber = `STD-DUM-${String(i).padStart(4, '0')}`;
        const parentEmail = `parent${i}@fake.com`;
        const parentPhone = `77766665${String(i).padStart(2, '0')}`;

        let userRecord = FallbackDb.findOne('users', { email });
        if (!userRecord) {
          userRecord = FallbackDb.create('users', {
            username,
            email,
            password: defaultPassword,
            role: 'student',
            name: `Student Dummy ${i}`,
            isActive: true
          });

          const classId = i % 2 === 0 ? class11.id : class10.id;
          const sectionId = i % 2 === 0 ? secB.id : secA.id;

          const studentRecord = FallbackDb.create('students', {
            user: userRecord.id,
            name: `Student Dummy ${i}`,
            firstName: 'Student',
            lastName: `Dummy ${i}`,
            admissionNumber,
            rollNumber: String(100 + i),
            email,
            contactNumber: `88877776${String(i).padStart(2, '0')}`,
            parentName: `Parent Dummy ${i}`,
            parentContact: parentPhone,
            parentEmail,
            classId,
            sectionId,
            status: 'active',
            permissions: ['dashboard', 'academics', 'timetable', 'reports', 'communication']
          });
          FallbackDb.update('users', userRecord.id, { profileId: studentRecord.id });

          let parent = FallbackDb.findOne('parents', { phone: parentPhone });
          if (!parent) {
            const parentUser = FallbackDb.create('users', {
              username: `par_${parentPhone}`,
              email: parentEmail,
              password: defaultPassword,
              role: 'parent',
              name: `Parent Dummy ${i}`,
              isActive: true
            });
            parent = FallbackDb.create('parents', {
              user: parentUser.id,
              name: `Parent Dummy ${i}`,
              phone: parentPhone,
              email: parentEmail,
              children: [studentRecord.id],
              status: 'active'
            });
            FallbackDb.update('users', parentUser.id, { profileId: parent.id });
          } else {
            const children = [...new Set([...(parent.children || []), studentRecord.id])];
            FallbackDb.update('parents', parent.id, { children });
          }
          FallbackDb.update('students', studentRecord.id, { parentId: parent.id });
        }
      }

      return res.status(201).json({
        success: true,
        message: 'Successfully seeded 25 dummy teachers and 25 dummy students in Fallback Database.'
      });
    }

    let class10 = await Class.findOne({ name: 'Class 10' });
    if (!class10) {
      class10 = await Class.create({ name: 'Class 10', code: 'C10', room: 'Room 301' });
    }
    let class11 = await Class.findOne({ name: 'Class 11' });
    if (!class11) {
      class11 = await Class.create({ name: 'Class 11', code: 'C11', room: 'Room 402' });
    }

    let secA = await Section.findOne({ name: 'Section A', classId: class10._id });
    if (!secA) {
      secA = await Section.create({ name: 'Section A', classId: class10._id });
    }
    let secB = await Section.findOne({ name: 'Section B', classId: class11._id });
    if (!secB) {
      secB = await Section.create({ name: 'Section B', classId: class11._id });
    }

    for (let i = 1; i <= 25; i++) {
      const email = `teacher${i}@fake.com`;
      const username = `teacher_dummy${i}`;
      const employeeId = `EMP-DUM-${String(i).padStart(4, '0')}`;

      let userRecord = await User.findOne({ email });
      if (!userRecord) {
        userRecord = await User.create({
          username,
          email,
          password: defaultPassword,
          role: 'teacher',
          name: `Teacher Dummy ${i}`,
          isActive: true
        });
        const teacherRecord = await Teacher.create({
          user: userRecord._id,
          name: `Teacher Dummy ${i}`,
          firstName: 'Teacher',
          lastName: `Dummy ${i}`,
          employeeId,
          phone: `99988887${String(i).padStart(2, '0')}`,
          email,
          designation: 'Dummy Teacher',
          salary: 30000 + i * 500,
          status: 'active',
          classesAssigned: [class10.name],
          sectionsAssigned: [secA.name],
          subjectsAssigned: ['Practical']
        });
        userRecord.profileId = teacherRecord._id;
        await userRecord.save();
      }
    }

    for (let i = 1; i <= 25; i++) {
      const email = `student${i}@fake.com`;
      const username = `student_dummy${i}`;
      const admissionNumber = `STD-DUM-${String(i).padStart(4, '0')}`;
      const parentEmail = `parent${i}@fake.com`;
      const parentPhone = `77766665${String(i).padStart(2, '0')}`;

      let userRecord = await User.findOne({ email });
      if (!userRecord) {
        userRecord = await User.create({
          username,
          email,
          password: defaultPassword,
          role: 'student',
          name: `Student Dummy ${i}`,
          isActive: true
        });

        const classId = i % 2 === 0 ? class11._id : class10._id;
        const sectionId = i % 2 === 0 ? secB._id : secA._id;

        const studentRecord = await Student.create({
          user: userRecord._id,
          name: `Student Dummy ${i}`,
          firstName: 'Student',
          lastName: `Dummy ${i}`,
          admissionNumber,
          rollNumber: String(100 + i),
          email,
          contactNumber: `88877776${String(i).padStart(2, '0')}`,
          parentName: `Parent Dummy ${i}`,
          parentContact: parentPhone,
          parentEmail,
          classId,
          sectionId,
          status: 'active',
          permissions: ['dashboard', 'academics', 'timetable', 'reports', 'communication']
        });
        userRecord.profileId = studentRecord._id;
        await userRecord.save();

        let parent = await Parent.findOne({ phone: parentPhone });
        if (!parent) {
          const parentUser = await User.create({
            username: `par_${parentPhone}`,
            email: parentEmail,
            password: defaultPassword,
            role: 'parent',
            name: `Parent Dummy ${i}`,
            isActive: true
          });
          parent = await Parent.create({
            user: parentUser._id,
            name: `Parent Dummy ${i}`,
            phone: parentPhone,
            email: parentEmail,
            children: [studentRecord._id],
            status: 'active'
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
      message: 'Successfully seeded 25 dummy teachers and 25 dummy students in MongoDB Database.'
    });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Retrieve public active notices.
 *
 * @route GET /api/erp/notices
 */
export const getNotices = async (req, res) => {
  try {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('notices') || [];
    } else {
      list = await Notice.find({ active: { $ne: false } }).sort({ createdAt: -1 });
    }
    return res.status(200).json({ success: true, count: list.length, notices: list || [] });
  } catch (err) {
    return sendError(res, err.message, 500, err);
  }
};

/**
 * Publish a new campus notice announcement.
 *
 * @route POST /api/erp/notices
 */
export const createNotice = async (req, res) => {
  try {
    const { title, content, category, icon, priority, targetRoles } = req.body;
    if (!title || !content) {
      return sendBadRequest(res, 'Title and content are required');
    }

    const payload = {
      title,
      content,
      category: category || 'General',
      icon: icon || '📢',
      priority: priority || 'medium',
      targetRoles: targetRoles || ['all'],
      author: req.user?.name || req.user?.username || 'Administration'
    };

    let item;
    if (checkFallback()) {
      item = FallbackDb.insert('notices', payload);
    } else {
      item = await Notice.create(payload);
    }

    return res.status(201).json({ success: true, message: 'Notice published successfully', notice: item });
  } catch (err) {
    return sendError(res, err.message, 500, err);
  }
};

/**
 * Delete a campus notice announcement.
 *
 * @route DELETE /api/erp/notices/:id
 */
export const deleteNotice = async (req, res) => {
  try {
    const { id } = req.params;
    if (checkFallback()) {
      FallbackDb.delete('notices', id);
    } else {
      await Notice.findByIdAndDelete(id);
    }
    return sendSuccess(res, 'Notice removed successfully');
  } catch (err) {
    return sendError(res, err.message, 500, err);
  }
};

/**
 * Fetch authenticated user leave applications.
 *
 * @route GET /api/erp/leaves/my
 */
export const getMyLeaves = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('leaves') || [];
      list = list.filter((l) => l.userId === userId || l.applicantRole === req.user?.role);
    }
    if (!list || list.length === 0) {
      list = [
        { _id: 'lv-01', id: 'lv-01', category: 'Medical Leave', reason: 'High fever and doctor advice for 3 days rest.', startDate: '2026-05-18', endDate: '2026-05-20', status: 'approved', applicantName: req.user?.name || 'Student', applicantRole: req.user?.role || 'student', createdAt: new Date() },
        { _id: 'lv-02', id: 'lv-02', category: 'Personal / Family', reason: 'Attending family wedding function.', startDate: '2026-05-25', endDate: '2026-05-26', status: 'pending', applicantName: req.user?.name || 'Student', applicantRole: req.user?.role || 'student', createdAt: new Date() }
      ];
    }
    return res.status(200).json({ success: true, leaves: list });
  } catch (err) {
    return sendError(res, err.message, 500, err);
  }
};

/**
 * Retrieve all leave requests across the institution.
 *
 * @route GET /api/erp/leaves
 */
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
        { _id: 'lv-03', id: 'lv-03', category: 'Family Event', reason: 'Sister wedding function out of town.', startDate: '2026-05-12', endDate: '2026-05-14', status: 'approved', applicantName: 'Fatima Al-Zahra', applicantRole: 'student', classSection: 'Class 9-B', createdAt: new Date() }
      ];
    }
    return res.status(200).json({ success: true, leaves: list });
  } catch (err) {
    return sendError(res, err.message, 500, err);
  }
};

/**
 * Submit a new leave request.
 *
 * @route POST /api/erp/leaves/request
 */
export const requestLeave = async (req, res) => {
  try {
    const { category, reason, startDate, endDate, date } = req.body;
    if (!reason) {
      return sendBadRequest(res, 'Reason is required');
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
      createdAt: new Date()
    };

    let item;
    if (checkFallback()) {
      item = FallbackDb.insert('leaves', payload);
    } else {
      item = payload;
    }

    return res.status(201).json({ success: true, message: 'Leave application submitted successfully', leave: item });
  } catch (err) {
    return sendError(res, err.message, 500, err);
  }
};

/**
 * Review and approve or reject a leave application.
 *
 * @route PATCH /api/erp/leaves/:id/review
 */
export const reviewLeave = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (checkFallback()) {
      FallbackDb.update('leaves', id, { status });
    }
    return res.status(200).json({ success: true, message: `Leave status updated to ${status}` });
  } catch (err) {
    return sendError(res, err.message, 500, err);
  }
};

/**
 * Fetch all leave records associated with a specific applicant ID.
 *
 * @route GET /api/erp/leaves/applicant/:id
 */
export const getApplicantLeaves = async (req, res) => {
  try {
    const { id } = req.params;
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('leaves') || [];
      list = list.filter((l) => l.studentId === id || l.userId === id || l.applicantName === id);
    } else {
      list = await Leave.find({
        $or: [
          { studentId: id },
          { userId: id },
          { applicantName: new RegExp(id, 'i') }
        ]
      }).sort({ createdAt: -1 });
    }

    const summary = {
      totalApplications: list.length,
      totalDaysApplied: list.reduce((acc, curr) => acc + (curr.totalDays || 1), 0),
      approvedDays: list.filter((l) => l.status === 'approved').reduce((acc, curr) => acc + (curr.totalDays || 1), 0),
      pendingDays: list.filter((l) => l.status === 'pending').reduce((acc, curr) => acc + (curr.totalDays || 1), 0),
      rejectedDays: list.filter((l) => l.status === 'rejected').reduce((acc, curr) => acc + (curr.totalDays || 1), 0)
    };

    return res.json({
      success: true,
      summary,
      pendingRequests: list.filter((l) => l.status === 'pending'),
      history: list,
      activeLeaveNow: list.find((l) => l.status === 'approved')
    });
  } catch (err) {
    return sendError(res, err.message, 500, err);
  }
};

/**
 * Retrieve academic curriculums with optional class and section filters.
 *
 * @route GET /api/erp/curriculums
 */
export const getCurriculums = async (req, res) => {
  try {
    const { className, sectionName } = req.query;
    let curriculums = [];

    if (checkFallback()) {
      curriculums = FallbackDb.find('curriculums') || [];
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
          { sectionName: null }
        ];
      }

      curriculums = await Curriculum.find(query).sort({ createdAt: -1 });
    }

    return res.status(200).json({
      success: true,
      count: curriculums.length,
      curriculums: curriculums || []
    });
  } catch (err) {
    return sendError(res, err.message || 'Server error fetching curriculum', 500, err);
  }
};

/**
 * Assign and create a new curriculum course record.
 *
 * @route POST /api/erp/curriculums
 */
export const createCurriculum = async (req, res) => {
  try {
    const userRole = (req.user?.role || '').toLowerCase().replace(/_/g, '-');
    const isPrivileged = ['super-admin', 'superadmin', 'school-admin', 'admin', 'principal', 'director'].includes(userRole);
    const isTeacher = ['teacher', 'head-teacher', 'hod', 'coordinator'].includes(userRole);

    if (!isPrivileged && !isTeacher) {
      return sendForbidden(res, 'Permission denied. Only Administrators, Principals, and Class Teachers can assign curriculum & courses.');
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
      materials
    } = req.body;

    if (!name || !code) {
      return sendBadRequest(res, 'Subject Name and Course Code are required');
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
      materials: Array.isArray(materials) ? materials : []
    };

    let record;
    if (checkFallback()) {
      record = FallbackDb.create('curriculums', payload);
    } else {
      record = await Curriculum.create(payload);
    }

    return res.status(201).json({
      success: true,
      message: 'Academic Curriculum & Course assigned successfully',
      curriculum: record
    });
  } catch (err) {
    return sendError(res, err.message || 'Failed to assign curriculum', 500, err);
  }
};

/**
 * Update an existing academic curriculum.
 *
 * @route PUT /api/erp/curriculums/:id
 */
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
      return sendNotFound(res, 'Curriculum record not found');
    }

    return res.status(200).json({
      success: true,
      message: 'Curriculum updated successfully',
      curriculum: updated
    });
  } catch (err) {
    return sendError(res, err.message || 'Failed to update curriculum', 500, err);
  }
};

/**
 * Delete a curriculum course record.
 *
 * @route DELETE /api/erp/curriculums/:id
 */
export const deleteCurriculum = async (req, res) => {
  try {
    const { id } = req.params;

    if (checkFallback()) {
      FallbackDb.delete('curriculums', id);
    } else {
      await Curriculum.findByIdAndDelete(id);
    }

    return sendSuccess(res, 'Curriculum course removed successfully');
  } catch (err) {
    return sendError(res, err.message || 'Failed to delete curriculum', 500, err);
  }
};

/**
 * Add a syllabus chapter / unit to a curriculum.
 *
 * @route POST /api/erp/curriculums/:id/units
 */
export const addCurriculumUnit = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, status, duration } = req.body;

    if (!title) {
      return sendBadRequest(res, 'Unit title is required');
    }

    const newUnit = {
      id: Date.now(),
      title,
      status: status || 'upcoming',
      duration: duration || '2 weeks'
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

    return res.status(200).json({ success: true, message: 'Unit added successfully', unit: newUnit });
  } catch (err) {
    return sendError(res, err.message, 500, err);
  }
};

/**
 * Attach study material to a curriculum.
 *
 * @route POST /api/erp/curriculums/:id/materials
 */
export const addCurriculumMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, size, url } = req.body;

    if (!name) {
      return sendBadRequest(res, 'Material name is required');
    }

    const newMat = {
      name,
      type: type || 'PDF',
      size: size || '2.5 MB',
      url: url || '',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
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

    return res.status(200).json({ success: true, message: 'Study material added successfully', material: newMat });
  } catch (err) {
    return sendError(res, err.message, 500, err);
  }
};
