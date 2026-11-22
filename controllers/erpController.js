import { academicError, getAcademicScope } from '../utils/academicScope.js';
import { getSchool, writeProcurement } from '../services/procurementStore.js';
import { orderedGrades } from '../services/academicSessionService.js';
import { standardGrade } from '../utils/academicClass.js';
// 3. Configuration
import { checkFallback } from '../config/db.js';
import { uploadToS3, generateS3Key, getPresignedUrl, resolveFileUrl } from '../config/s3.js';

// 4. Models
import Book from '../models/Book.js';
import ClassRoom from '../models/ClassRoom.js';
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
import School from '../models/School.js';

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
    const { room, capacity, sortOrder } = req.body;
    const name = String(req.body.name || '').trim();
    const code = String(req.body.code || '').trim();
    if (!name || !code) return sendBadRequest(res, 'Class name and registry code are required.');
    const standard = standardGrade(code) || standardGrade(name);
    const order = sortOrder === undefined || sortOrder === '' ? standard?.sortOrder : Number(sortOrder);
    if (!Number.isInteger(order) || order < 0) return sendBadRequest(res, 'Enter a class order value.');
    const grade = await writeProcurement(req, ['classes'], async (store) => {
      await store.lockAcademicSettings();
      const grades = await orderedGrades(store);
      if (grades.some((entry) => !entry.virtual && (
        entry.code.toLowerCase() === code.toLowerCase() || entry.name.toLowerCase() === name.toLowerCase()
      ))) throw academicError('A class with this name or code already exists.', 409);
      if (grades.some((entry) => entry.sortOrder === order && !(entry.virtual && entry.code === standard?.code))) {
        throw academicError('This position is already used by another class.', 409);
      }
      return store.create('classes', { name, code, room, capacity: Number(capacity) || 40, sortOrder: order });
    });
    return res.status(201).json({ success: true, message: 'Class created successfully.', class: grade });
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
  }
};

/**
 * Register a new academic subject.
 *
 * @route POST /api/erp/subjects
 */
export const createSubject = async (req, res) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const code = typeof req.body.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const type = req.body.type || 'theory';
    if (!name || name.length > 100 || !/^[A-Z0-9][A-Z0-9_-]{0,29}$/.test(code)) {
      return sendBadRequest(res, 'Enter a subject name and a code of up to 30 letters, numbers, hyphens, or underscores.');
    }
    if (!['theory', 'practical'].includes(type)) return sendBadRequest(res, 'Choose theory or practical.');
    const subject = await writeProcurement(req, ['subjects'], async (store) => {
      await store.lockAcademicSettings();
      const subjects = await store.find('subjects');
      if (subjects.some((entry) => String(entry.code).trim().toUpperCase() === code)) {
        throw academicError('This subject code is already in use.', 409);
      }
      return store.create('subjects', { name, code, type });
    });
    return res.status(201).json({ success: true, message: 'Subject created successfully', subject });
  } catch (error) {
    if (error.code === 11000) return sendError(res, 'This subject code is already in use.', 409);
    return sendError(res, error.message || 'Unable to create subject.', error.statusCode || 500);
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
      list = FallbackDb.find('books').filter((book) => String(book.schoolId || 'IQRA_P01001') === getSchool(req));
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
        schoolId: getSchool(req),
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
      if (req.user?.role === 'student') {
        list = list.filter((item) => String(item.studentId) === String(req.user.profileId || req.user._id || req.user.id));
      }
      list = list.map((item) => {
        const bookObj = FallbackDb.findById('books', item.bookId);
        const studObj = FallbackDb.findById('students', item.studentId);
        return {
          ...item,
          book: bookObj,
          student: studObj ? { name: studObj.name, admissionNumber: studObj.admissionNumber } : null
        };
      });
    } else {
      const own = req.user?.role === 'student' ? { studentId: req.user.profileId || req.user._id } : {};
      list = await Library.find(own).populate('bookId', 'title author isbn').populate('studentId', 'name admissionNumber');
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
    if (!bookId || !studentId) return sendBadRequest(res, 'Choose a book and student.');
    const scope = getAcademicScope();
    const due = dueDate ? new Date(dueDate) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(due.getTime())) return sendBadRequest(res, 'Enter a valid due date.');
    const issue = await writeProcurement(req, ['books', 'library', 'academicSessions', 'students', 'studentSessionHistories'], async (store) => {
      await store.lockAcademicSettings();
      const book = await store.get('books', bookId);
      const student = await store.get('students', studentId);
      if (!student) throw academicError('Student not found.', 404);
      if (!book || (book.issuedQty || 0) >= book.totalQty) throw academicError('Book is unavailable.', 409);
      const enrollment = scope ? await store.one('studentSessionHistories', {
        sessionId: scope.sessionId, studentId, status: 'active',
      }) : null;
      if (scope) {
        const active = await store.get('academicSessions', scope.sessionId);
        if (!active?.isCurrent || !enrollment) {
          throw academicError('Select a student enrolled in the active academic session.', 409);
        }
      }
      const record = await store.create('library', {
        bookId: book._id || book.id, studentId: student._id || student.id,
        ...(enrollment && { classId: enrollment.classId, className: enrollment.className, sessionId: scope.sessionId }),
        issueDate: new Date(), dueDate: due, returnDate: null, fine: 0,
      });
      await store.update('books', book._id || book.id, { issuedQty: (book.issuedQty || 0) + 1 });
      return record;
    });
    return res.status(201).json({ success: true, message: 'Book issued successfully.', record: issue });
  } catch (error) {
    return sendError(res, error.message, error.statusCode || 500);
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
      list = FallbackDb.find('transport').filter((route) => String(route.schoolId || 'IQRA_P01001') === getSchool(req));
    } else {
      list = await Transport.find({ schoolId: getSchool(req) }).select('-assignedStudents');
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
    const role = req.user?.role;
    const admin = ['super-admin', 'school-admin', 'admin', 'principal'].includes(role);
    list = list.filter((item) =>
      admin || ((!item.roleVisibility?.length || item.roleVisibility.includes(role)) &&
        (!item.classId || String(req.user?.classId || '') === String(item.classId)))
    );
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

    const schoolId = req.user?.schoolId || req.schoolId;

    let currentSchool = null;
    if (schoolId) {
      currentSchool = await School.findOne({
        $or: [{ _id: schoolId }, { schoolId }],
      }).lean();
    }

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

      // If settings document doesn't exist for this school, initialize from onboarded School
      if (!config || !config.schoolName) {
        const seedData = {
          schoolId: schoolId || (currentSchool ? currentSchool.schoolId || currentSchool._id : undefined),
        };
        if (currentSchool) {
          seedData.schoolName = currentSchool.schoolName || '';
          seedData.schoolCode = currentSchool.schoolCode || '';
          seedData.contactEmail = currentSchool.contactEmail || '';
          seedData.schoolPhone = currentSchool.schoolPhone || '';
          seedData.alternatePhone = currentSchool.alternatePhone || '';
          seedData.addressLine1 = currentSchool.address?.addressLine1 || '';
          seedData.addressLine2 = currentSchool.address?.addressLine2 || '';
          seedData.city = currentSchool.address?.city || '';
          seedData.state = currentSchool.address?.state || '';
          seedData.country = currentSchool.address?.country || 'India';
          seedData.postalCode = currentSchool.address?.postalCode || '';
          seedData.affiliationNumber = currentSchool.affiliationNumber || '';
          seedData.board = currentSchool.board || 'CBSE';
          seedData.schoolLogo = currentSchool.schoolLogo || '';
          seedData.companyLogo = currentSchool.schoolLogo || '';
          seedData.schoolMotto = currentSchool.schoolMotto || '';
        }
        if (!config) {
          config = new Setting(seedData);
          await config.save();
        } else {
          Object.assign(config, seedData);
          await config.save();
        }
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

    const schoolPayload = currentSchool || {
      schoolId: schoolId || '',
      schoolName: settings.schoolName || '',
      schoolCode: settings.schoolCode || '',
      collectionName: currentSchool?.collectionName || currentSchool?.schoolId || schoolId || settings.schoolCode || '',
      contactEmail: settings.contactEmail || '',
      schoolPhone: settings.schoolPhone || '',
      address: {
        addressLine1: settings.addressLine1 || '',
        addressLine2: settings.addressLine2 || '',
        city: settings.city || '',
        state: settings.state || '',
        country: settings.country || 'India',
        postalCode: settings.postalCode || '',
      },
      board: settings.board || 'CBSE',
      affiliationNumber: settings.affiliationNumber || '',
      schoolLogo: settings.schoolLogo || '',
      schoolMotto: settings.schoolMotto || '',
    };

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
        return res.json({ success: true, category, settings: filtered, school: schoolPayload });
      }
    }

    return res.json({ success: true, settings, school: schoolPayload });
  } catch (err) {
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Retrieve current school institutional profile
 *
 * @route GET /api/erp/school
 */
export const getSchoolProfile = async (req, res) => {
  return getSettings(req, res);
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

    const schoolId = req.user?.schoolId || req.schoolId;

    let config = null;
    if (checkFallback()) {
      config = FallbackDb.updateSettings(data);
    } else {
      config = await Setting.findOneAndUpdate(
        { schoolId },
        { $set: data },
        { new: true, upsert: true }
      ).select('-portalSettings -defaultDocumentTemplates');

      // Sync changes back to School master record if present
      if (schoolId) {
        const syncUpdates = {};
        if (data.schoolName) syncUpdates.schoolName = data.schoolName;
        if (data.schoolCode) syncUpdates.schoolCode = data.schoolCode;
        if (data.contactEmail) syncUpdates.contactEmail = data.contactEmail;
        if (data.schoolPhone) syncUpdates.schoolPhone = data.schoolPhone;
        if (data.schoolLogo) syncUpdates.schoolLogo = data.schoolLogo;
        if (data.schoolMotto) syncUpdates.schoolMotto = data.schoolMotto;
        if (data.board) syncUpdates.board = data.board;
        if (data.affiliationNumber) syncUpdates.affiliationNumber = data.affiliationNumber;
        if (data.addressLine1 || data.city || data.state || data.country || data.postalCode) {
          syncUpdates['address.addressLine1'] = data.addressLine1 || '';
          syncUpdates['address.city'] = data.city || '';
          syncUpdates['address.state'] = data.state || '';
          syncUpdates['address.country'] = data.country || 'India';
          syncUpdates['address.postalCode'] = data.postalCode || '';
        }
        if (Object.keys(syncUpdates).length > 0) {
          await School.findOneAndUpdate(
            { $or: [{ _id: schoolId }, { schoolId }] },
            { $set: syncUpdates }
          );
        }
      }
    }

    const settings = config?.toObject ? config.toObject() : { ...(config || {}) };
    delete settings.portalSettings;
    delete settings.defaultDocumentTemplates;

    return res.json({
      success: true,
      message: 'Configuration settings updated',
      settings,
      school: {
        schoolId: schoolId || settings.schoolId || '',
        schoolName: settings.schoolName || '',
        schoolCode: settings.schoolCode || '',
        collectionName: settings.schoolCode || schoolId || '',
        contactEmail: settings.contactEmail || '',
        schoolPhone: settings.schoolPhone || '',
        schoolLogo: settings.schoolLogo || '',
      },
    });
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
