// 1. Node.js built-in modules
import fs from 'fs';
import path from 'path';

// 2. External packages
import mongoose from 'mongoose';

// 3. Configuration
import { checkFallback } from '../config/db.js';
import {
  uploadToS3,
  generateS3Key,
  getPresignedUrl,
  resolveFileUrl,
  isS3Key,
} from '../config/s3.js';

// 4. Models
import AcademicSession from '../models/AcademicSession.js';
import ClassRoom from '../models/ClassRoom.js';
import Otp from '../models/Otp.js';
import Parent from '../models/Parent.js';
import Student from '../models/Student.js';
import StudentSessionHistory from '../models/StudentSessionHistory.js';
import User from '../models/User.js';

// 6. Services
import { FallbackDb } from '../services/dbFallback.js';
import { sendStudentOtpEmail } from '../services/emailService.js';

// 7. Utilities
import { logActivity, getRecordActivity } from '../utils/activityLogger.js';
import { normalizeEmail, formatFullName, generateSecurePassword } from '../utils/commonUtil.js';
import { currentAcademicYear, isLegacyStudent, isStudentLegacyValue, studentRosterCsv, studentRosterFields } from '../utils/studentUtil.js';
import { parsePagination, paginateResult, paginateArray } from '../utils/paginateQuery.js';
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError,
} from '../utils/responseUtil.js';

/**
 * Standardize admission number format.
 *
 * @param {string} admissionNumber - Raw admission number string.
 * @returns {string} Trimmed uppercase admission number.
 */
const normalizeAdmissionNumber = (admissionNumber = '') => admissionNumber.trim().toUpperCase();

/**
 * Generate temporary random credentials for new students.
 *
 * @returns {string} Formatted secure temporary password.
 */
const generateRandomPassword = () =>
  `Std@${Math.random().toString(36).slice(2, 8)}${Math.floor(100 + Math.random() * 900)}`;

/**
 * Generate temporary random credentials for newly provisioned parents.
 *
 * @returns {string} Formatted secure temporary parent password.
 */
const generateParentPassword = () =>
  `Par@${Math.random().toString(36).slice(2, 8)}${Math.floor(100 + Math.random() * 900)}`;

/**
 * Generate globally unique admission number: STD-YYYY-XXXX.
 * Checks both MongoDB and FallbackDb.
 *
 * @returns {Promise<string>} Next unique sequential admission number.
 */
const getNextAdmissionNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `STD-${year}-`;
  const pattern = new RegExp(`^STD-${year}-\\d{4}$`);

  let lastNum = 0;

  if (checkFallback()) {
    const nums = FallbackDb.find('students')
      .map((s) => s.admissionNumber)
      .filter((id) => pattern.test(id || ''))
      .map((id) => Number(id.replace(prefix, '')))
      .filter((n) => !isNaN(n));
    lastNum = nums.length ? Math.max(...nums) : 0;
  } else {
    const last = await Student.findOne({ admissionNumber: pattern })
      .sort({ admissionNumber: -1 })
      .select('admissionNumber');
    if (last?.admissionNumber) {
      lastNum = Number(last.admissionNumber.replace(prefix, '')) || 0;
    }
  }

  return `${prefix}${String(lastNum + 1).padStart(4, '0')}`;
};

/**
 * Get the next sequential roll number for a given classId + sectionId.
 * Roll numbers restart from 1 per section per academic year.
 *
 * @param {string} classId - Class identifier.
 * @param {string} sectionId - Section identifier.
 * @param {string} academicYear - Academic year for the enrollment.
 * @returns {Promise<number>} Next available roll number.
 */
const getNextRollNumber = async (classId, sectionId, academicYear) => {
  if (!classId || !sectionId) {
    return Math.floor(1000 + Math.random() * 9000);
  }

  if (checkFallback()) {
    const existing = FallbackDb.find('students').filter(
      (s) =>
        String(s.classId) === String(classId) &&
        String(s.sectionId) === String(sectionId) &&
        (!s.academicYear || s.academicYear === academicYear) &&
        s.rollNumber != null
    );
    const maxRoll = existing.length
      ? Math.max(...existing.map((s) => Number(s.rollNumber) || 0))
      : 0;
    return maxRoll + 1;
  }

  const last = await Student.findOne({
    classId: String(classId),
    sectionId: String(sectionId),
    academicYear,
    rollNumber: { $ne: null },
  })
    .sort({ rollNumber: -1 })
    .select('rollNumber');

  return (Number(last?.rollNumber) || 0) + 1;
};

const BACKEND_CLASS_OPTIONS = [
  { id: 'cls-nur', name: 'Nursery' },
  { id: 'cls-lkg', name: 'LKG' },
  { id: 'cls-ukg', name: 'UKG' },
  { id: 'cls-1', name: 'Class 1' },
  { id: 'cls-2', name: 'Class 2' },
  { id: 'cls-3', name: 'Class 3' },
  { id: 'cls-4', name: 'Class 4' },
  { id: 'cls-5', name: 'Class 5' },
  { id: 'cls-6', name: 'Class 6' },
  { id: 'cls-7', name: 'Class 7' },
  { id: 'cls-8', name: 'Class 8' },
  { id: 'cls-9', name: 'Class 9' },
  { id: 'cls-10', name: 'Class 10' },
  { id: 'cls-11', name: 'Class 11' },
  { id: 'cls-12', name: 'Class 12' },
];

const BACKEND_SECTION_OPTIONS = [
  { id: 'sec-a', name: 'Section A' },
  { id: 'sec-b', name: 'Section B' },
  { id: 'sec-c', name: 'Section C' },
  { id: 'sec-d', name: 'Section D' },
  { id: 'sec-e', name: 'Section E' },
  { id: 'sec-f', name: 'Section F' },
  { id: 'sec-g', name: 'Section G' },
];

/**
 * Resolve canonical class definition from freeform string or object.
 *
 * @param {string|Object} val - Raw class query parameter or body field.
 * @returns {Object|null} Matching class definition.
 */
const resolveClass = (val) => {
  if (!val) return null;
  let target = typeof val === 'object' ? val.name || val.id || '' : val;
  if (!target || target === 'N/A' || target === 'null' || target === 'undefined') return null;
  const str = String(target).trim().toLowerCase();

  let found = BACKEND_CLASS_OPTIONS.find(
    (c) => c.id.toLowerCase() === str || c.name.toLowerCase() === str
  );
  if (found) return found;

  const norm = str.replace(/^(cls-|class\s*|grade\s*)/i, '').trim();
  found = BACKEND_CLASS_OPTIONS.find((c) => {
    const cIdNum = c.id.replace('cls-', '');
    const cNameNum = c.name.toLowerCase().replace('class ', '');
    return (
      cIdNum === norm ||
      cNameNum === norm ||
      c.id.toLowerCase() === norm ||
      c.name.toLowerCase() === norm
    );
  });

  return found || null;
};

/**
 * Resolve canonical section definition from freeform string or object.
 *
 * @param {string|Object} val - Raw section input.
 * @returns {Object|null} Matching section definition.
 */
const resolveSection = (val) => {
  if (!val) return null;
  let target = typeof val === 'object' ? val.name || val.id || '' : val;
  if (!target || target === 'N/A' || target === 'null' || target === 'undefined') return null;
  const str = String(target).trim().toLowerCase();

  let found = BACKEND_SECTION_OPTIONS.find(
    (s) => s.id.toLowerCase() === str || s.name.toLowerCase() === str
  );
  if (found) return found;

  const norm = str.replace(/^(sec-|section\s*)/i, '').trim();
  found = BACKEND_SECTION_OPTIONS.find((s) => {
    const sIdCode = s.id.replace('sec-', '');
    const sNameCode = s.name.toLowerCase().replace('section ', '');
    return (
      sIdCode === norm ||
      sNameCode === norm ||
      s.id.toLowerCase() === norm ||
      s.name.toLowerCase() === norm
    );
  });

  return found || null;
};

/**
 * Construct and normalize student registration payload with auto-generated identifiers.
 *
 * @param {Object} data - Raw request payload.
 * @returns {Promise<Object>} Normalized student model payload.
 */
const buildStudentPayload = async (data) => {
  const admissionNumber = await getNextAdmissionNumber();

  const matchedClass = resolveClass(data.class || data.classId || data.className);
  const matchedSection = resolveSection(data.section || data.sectionId || data.sectionName);

  const resolvedClassId = matchedClass ? matchedClass.id : data.classId || null;
  const resolvedSectionId = matchedSection ? matchedSection.id : data.sectionId || null;

  const academicYear = data.academicYear || data.sessionName || data.session || currentAcademicYear();
  const rollNumber = await getNextRollNumber(resolvedClassId, resolvedSectionId, academicYear);

  const name = formatFullName(data) || `Student ${admissionNumber}`;
  const email = normalizeEmail(
    data.email || `${admissionNumber.toLowerCase().replace(/-/g, '.')}@school.local`
  );

  const sessionId = data.sessionId || null;

  return {
    ...data,
    firstName: data.firstName || name.split(' ')[0] || 'Student',
    lastName: data.lastName || name.split(' ').slice(1).join(' ') || '',
    name,
    email,
    admissionNumber,
    rollNumber,
    academicYear,
    sessionId,
    gender: data.gender || 'Male',
    dob: data.dob || data.dateOfBirth || undefined,
    bloodGroup: data.bloodGroup || undefined,
    classId: resolvedClassId,
    sectionId: resolvedSectionId,
    class: matchedClass ? matchedClass.name : data.class || null,
    section: matchedSection ? matchedSection.name : data.section || null,
    className: matchedClass ? matchedClass.name : data.className || null,
    sectionName: matchedSection ? matchedSection.name : data.sectionName || null,
    contactNumber: data.contactNumber || data.phone || data.parentContact || '',
    alternatePhone: data.alternatePhone || '',
    address: data.address || '',
    parentName: data.parentName || `Guardian of ${name}`,
    parentContact: data.parentContact || data.contactNumber || '',
    parentEmail: data.parentEmail || '',
    aadhaarNumber: data.aadhaarNumber ? String(data.aadhaarNumber).trim() : '',
    photo: data.photo || data.imagesRef?.img || data.studentImg || '',
    aadhaarDocument:
      data.aadhaarDocument || data.AdharRef?.pdf || data.aadhaarPdf || data.adharPdf || '',
    imagesRef: {
      id:
        data.imagesRef?.id ||
        data.photoId ||
        (data.photo || data.imagesRef?.img ? `img_${Date.now()}` : ''),
      img: data.photo || data.imagesRef?.img || data.studentImg || '',
    },
    AdharRef: {
      id:
        data.AdharRef?.id ||
        data.aadhaarRef?.id ||
        (data.aadhaarDocument || data.AdharRef?.pdf ? `doc_${Date.now()}` : ''),
      pdf: data.aadhaarDocument || data.AdharRef?.pdf || data.aadhaarPdf || data.adharPdf || '',
    },
    joiningDate: data.joiningDate || data.admissionDate || new Date(),
    admissionDate: data.admissionDate || data.joiningDate || new Date(),
    isLegacyStudent: isLegacyStudent(data.isLegacyStudent),
    admissionType: data.admissionType || 'New Admission',
    previousSchoolName: data.previousSchoolName?.trim() || '',
    previousClass: data.previousClass?.trim() || '',
    previousBoard: data.previousBoard?.trim() || '',
    transferCertificateNumber: data.transferCertificateNumber?.trim()?.toUpperCase() || '',
    transferCertificateDate: data.transferCertificateDate || null,
    enrollmentStatus: data.enrollmentStatus || 'Enrolled',

    houseName: data.houseName?.trim() || '',
    studentCategory: data.studentCategory?.trim() || 'General',
    nationality: data.nationality?.trim() || 'Indian',
    motherTongue: data.motherTongue?.trim() || 'Hindi',
    mediumOfInstruction: data.mediumOfInstruction?.trim() || 'English',
    studentType: data.studentType?.trim() || 'Day Scholar',
    specialEducationNeeds: data.specialEducationNeeds?.trim() || 'None',
    careerInterest: data.careerInterest?.trim() || '',

    fatherName: typeof data.fatherName === 'string' ? data.fatherName.trim() : '',
    fatherOccupation: data.fatherOccupation?.trim() || '',
    fatherOrganization: data.fatherOrganization?.trim() || '',
    motherName: data.motherName?.trim() || '',
    motherContact: data.motherContact?.trim() || '',
    motherOccupation: data.motherOccupation?.trim() || '',
    guardianRelation: data.guardianRelation?.trim() || '',
    guardianAddress: data.guardianAddress?.trim() || '',

    status: data.status || 'active',
    role: 'student',
    forcePasswordChange: Boolean(data.forcePasswordChange),
    twoFactorEnabled: Boolean(data.twoFactorEnabled),
    loginRestriction: data.loginRestriction || 'none',
    documents: data.documents || [],
    academicHistory: data.academicHistory || [],
    isEmailVerified: Boolean(data.isEmailVerified),
  };
};

/**
 * Link or provision parent account during student onboarding.
 *
 * @param {Object} payload - Student onboarding payload.
 * @param {string} studentId - Student identifier.
 * @param {string} studentPassword - Student password for reference.
 * @returns {Promise<Object>} Linked parent ID and account metadata.
 */
const createOrLinkParent = async (payload, studentId, studentPassword) => {
  const parentEmail = normalizeEmail(
    payload.parentEmail || `${payload.parentContact}@parent.school.local`
  );
  let parentAccount = null;

  if (checkFallback()) {
    let parent =
      FallbackDb.findOne('parents', { phone: payload.parentContact }) ||
      (payload.parentEmail ? FallbackDb.findOne('parents', { email: parentEmail }) : null);

    if (!parent) {
      parent = FallbackDb.create('parents', {
        name: payload.parentName,
        phone: payload.parentContact,
        email: parentEmail,
        children: [studentId],
        status: 'active',
      });
    } else {
      const children = [...new Set([...(parent.children || []), studentId])];
      FallbackDb.update('parents', parent.id, { children });
    }
    FallbackDb.update('students', studentId, { parentId: parent.id });
    return { parentId: parent.id, parentAccount: null };
  }

  let parent = await Parent.findOne({
    $or: [
      { phone: payload.parentContact },
      ...(payload.parentEmail ? [{ email: parentEmail }] : []),
    ],
  });

  if (!parent) {
    parent = await Parent.create({
      name: payload.parentName,
      phone: payload.parentContact,
      email: parentEmail,
      children: [studentId],
      status: 'active',
    });
  } else {
    if (!parent.children.includes(studentId)) {
      parent.children.push(studentId);
      await parent.save();
    }
  }

  await Student.findByIdAndUpdate(studentId, { parentId: parent._id });
  return { parentId: parent._id, parentAccount: null };
};

/**
 * Enrich student record with canonical class, section, and parent details.
 *
 * @param {Object} stud - Raw database student record.
 * @returns {Object|null} Enriched student plain object.
 */
const enrichStudent = (stud) => {
  if (!stud) return null;
  const s = stud.toObject ? stud.toObject() : stud;

  const matchedClass = resolveClass(s.class || s.classId || s.className);
  const matchedSection = resolveSection(s.section || s.sectionId || s.sectionName);

  const className = matchedClass
    ? matchedClass.name
    : s.class && s.class !== 'null' && s.class !== 'undefined'
      ? s.class
      : s.className || 'N/A';
  const sectionName = matchedSection
    ? matchedSection.name
    : s.section && s.section !== 'null' && s.section !== 'undefined'
      ? s.section
      : s.sectionName || 'N/A';

  const classId = s.classId || (matchedClass ? matchedClass.id : null);
  const sectionId = s.sectionId || (matchedSection ? matchedSection.id : null);

  return {
    ...s,
    isLegacyStudent: isLegacyStudent(s.isLegacyStudent),
    class: className,
    section: sectionName,
    className,
    sectionName,
    classId,
    sectionId,
    classDetails: { id: classId, name: className },
    sectionDetails: { id: sectionId, name: sectionName },
    user: s.user || {
      _id: s._id || s.id,
      username: (s.admissionNumber || '').toLowerCase(),
      email: s.email,
      role: 'student',
      permissions: [],
      isActive: s.status !== 'inactive',
    },
    parentDetails: s.parentId
      ? typeof s.parentId === 'object'
        ? s.parentId
        : FallbackDb.findById('parents', s.parentId)
      : null,
  };
};

/**
 * Resolve S3 keys stored in a student record to fresh presigned URLs.
 *
 * @param {Object} student - Plain student object.
 * @returns {Promise<Object>} Student object with resolved URLs.
 */
const resolveStudentFileUrls = async (student) => {
  if (!student) return student;

  const photoKey = student.imagesRef?.id;
  const aadhaarKey = student.AdharRef?.id;
  const photoSource = typeof photoKey === 'string' && photoKey.startsWith('school-erp/students/photos/')
    ? photoKey : student.photo || student.imagesRef?.img;
  const aadhaarSource = typeof aadhaarKey === 'string' && aadhaarKey.startsWith('school-erp/students/aadhaar/')
    ? aadhaarKey : student.aadhaarDocument || student.AdharRef?.pdf;
  const [photoUrl, aadhaarUrl] = await Promise.all([
    resolveFileUrl(photoSource),
    resolveFileUrl(aadhaarSource),
  ]);

  return {
    ...student,
    photo: photoUrl,
    aadhaarDocument: aadhaarUrl,
    imagesRef: {
      id: student.imagesRef?.id || '',
      img: photoUrl,
    },
    AdharRef: {
      id: student.AdharRef?.id || '',
      pdf: aadhaarUrl,
    },
  };
};

/**
 * Fetch paginated students with search, status, class, and section filters.
 *
 * @route GET /api/students
 */
export const getStudents = async (req, res) => {
  try {
    const { page, limit, skip, sort, search, status } = parsePagination(req.query);
    const searchFields = [
      'name',
      'admissionNumber',
      'rollNumber',
      'email',
      'parentName',
      'contactNumber',
    ];

    const queryClassRaw = req.query.className || req.query.class || req.query.classId;
    const querySectionRaw = req.query.sectionName || req.query.section || req.query.sectionId;

    let parsedClassStr = queryClassRaw ? String(queryClassRaw).trim() : null;
    let parsedSectionStr = querySectionRaw ? String(querySectionRaw).trim() : null;

    if (parsedClassStr && parsedClassStr.includes('-')) {
      const parts = parsedClassStr.split(/\s*[-–—|]\s*/);
      if (parts.length >= 2) {
        const potentialClass = parts[0].trim();
        const potentialSec = parts[1].trim();
        if (resolveClass(potentialClass)) {
          parsedClassStr = potentialClass;
          if (!parsedSectionStr || parsedSectionStr === 'All' || parsedSectionStr === 'all') {
            if (/^(sec-|section\s*)/i.test(potentialSec) || /^[a-g]$/i.test(potentialSec)) {
              parsedSectionStr = potentialSec;
            }
          }
        }
      }
    }

    const targetClass = resolveClass(parsedClassStr);
    const targetSection =
      parsedSectionStr && parsedSectionStr.toLowerCase() !== 'all'
        ? resolveSection(parsedSectionStr)
        : null;

    if (checkFallback()) {
      let list = FallbackDb.find('students').map(enrichStudent);

      const userRole = (req.user?.role || '').toLowerCase();
      if (userRole === 'student') {
        const studentId = String(req.user.profileId || req.user._id || req.user.id || '');
        const adm = String(req.user.admissionNumber || '').toLowerCase();
        list = list.filter(
          (s) =>
            String(s.id || s._id) === studentId ||
            String(s.user) === String(req.user._id) ||
            (adm && String(s.admissionNumber || '').toLowerCase() === adm)
        );
      } else if (userRole === 'parent') {
        const parentId = String(req.user.profileId || req.user._id || req.user.id || '');
        const parent =
          FallbackDb.findById('parents', parentId) ||
          FallbackDb.findOne('parents', { user: req.user._id });
        const childIds = (parent?.children || []).map(String);
        list = list.filter((s) => childIds.includes(String(s.id || s._id)));
      }

      if (targetClass) {
        list = list.filter((s) => {
          const matched = resolveClass(s.class || s.classId || s.className);
          return matched && matched.id === targetClass.id;
        });
      }

      if (targetSection) {
        list = list.filter((s) => {
          const matched = resolveSection(s.section || s.sectionId || s.sectionName);
          return matched && matched.id === targetSection.id;
        });
      }

      const result = paginateArray(list, {
        page,
        limit,
        search,
        status,
        searchFields,
      });

      const resolved = await Promise.all(result.data.map(resolveStudentFileUrls));
      return res.json({ success: true, students: resolved, ...result, data: resolved });
    }

    // MongoDB Mode
    const conditions = [];
    const userRole = (req.user?.role || '').toLowerCase();

    if (userRole === 'student') {
      const orClauses = [{ _id: req.user._id }];
      if (req.user.profileId && mongoose.Types.ObjectId.isValid(req.user.profileId)) {
        orClauses.push({ _id: req.user.profileId });
      }
      if (req.user.admissionNumber) {
        orClauses.push({ admissionNumber: req.user.admissionNumber });
      }
      if (req.user.email) {
        orClauses.push({ email: req.user.email });
      }
      if (req.user.user) {
        orClauses.push({ user: req.user.user });
      }
      conditions.push({ $or: orClauses });
    } else if (userRole === 'parent') {
      let childIds = [];
      try {
        const parent = await Parent.findOne({
          $or: [
            ...(req.user.profileId && mongoose.Types.ObjectId.isValid(req.user.profileId)
              ? [{ _id: req.user.profileId }]
              : []),
            { user: req.user._id },
          ],
        });
        if (parent?.children?.length) {
          childIds = parent.children;
        }
      } catch (e) {
        // Ignored fallback
      }
      conditions.push({ _id: { $in: childIds } });
    }

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const orClauses = [
        { name: regex },
        { firstName: regex },
        { lastName: regex },
        { admissionNumber: regex },
        { email: regex },
        { parentName: regex },
        { contactNumber: regex },
      ];
      const numVal = Number(search);
      if (!isNaN(numVal) && search.trim() !== '') {
        orClauses.push({ rollNumber: numVal });
      }
      conditions.push({ $or: orClauses });
    }

    if (status) {
      conditions.push({ status });
    }

    if (targetClass) {
      const classRegex = new RegExp(`^${targetClass.name}$`, 'i');
      const classPrefixRegex = new RegExp(`^${targetClass.name}\\b`, 'i');
      conditions.push({
        $or: [
          { classId: targetClass.id },
          { className: classRegex },
          { class: classRegex },
          { class: classPrefixRegex },
          { className: classPrefixRegex },
          { classId: targetClass.name },
        ],
      });
    }

    if (targetSection) {
      const secRegex = new RegExp(`^${targetSection.name}$`, 'i');
      const secCode = targetSection.id.replace('sec-', '');
      const secCodeRegex = new RegExp(`^${secCode}$`, 'i');
      conditions.push({
        $or: [
          { sectionId: targetSection.id },
          { sectionName: secRegex },
          { section: secRegex },
          { section: secCodeRegex },
          { sectionId: targetSection.name },
        ],
      });
    }

    const filter =
      conditions.length > 1 ? { $and: conditions } : conditions.length === 1 ? conditions[0] : {};

    const sortObj = {};
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith('-') ? -1 : 1;

    const [students, total] = await Promise.all([
      Student.find(filter)
        .populate('classId', 'name code')
        .populate('sectionId', 'name')
        .populate('user', 'username email role permissions isActive lastLogin')
        .populate('parentId', 'name phone email')
        .sort(sortObj)
        .skip(skip)
        .limit(limit),
      Student.countDocuments(filter),
    ]);

    const resolvedStudents = await Promise.all(
      students.map(enrichStudent).map(resolveStudentFileUrls)
    );

    return res.json({
      success: true,
      students: resolvedStudents,
      data: resolvedStudents,
      ...paginateResult(resolvedStudents, total, { page, limit }),
    });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Retrieve detailed student information by ID or admission number.
 *
 * @route GET /api/students/:id
 */
export const getStudentById = async (req, res) => {
  try {
    const { id } = req.params;
    let student = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      student =
        FallbackDb.findById('students', id) ||
        FallbackDb.findOne('students', { admissionNumber: id });
      if (student) student = enrichStudent(student);
      if (student && !student.userDetails) {
        student.userDetails = {
          _id: student._id || student.id,
          username: (student.admissionNumber || '').toLowerCase(),
          email: student.email,
          role: 'student',
          isActive: student.status !== 'inactive',
          lastLogin: student.lastLogin,
          loginHistory: student.loginHistory || [],
        };
      }
      if (student?.user) {
        student.userDetails = FallbackDb.findById('users', student.user);
      }
    } else {
      student = await Student.findById(id)
        .populate('classId')
        .populate('sectionId')
        .populate(
          'user',
          'username email role permissions isActive lastLogin loginHistory forcePasswordChange'
        )
        .populate('parentId');
      if (student) student = enrichStudent(student);
      if (student && !student.userDetails) {
        student.userDetails = {
          _id: student._id || student.id,
          username: (student.admissionNumber || '').toLowerCase(),
          email: student.email,
          role: 'student',
          isActive: student.status !== 'inactive',
          lastLogin: student.lastLogin,
          loginHistory: student.loginHistory || [],
        };
      }
    }

    if (!student) {
      return sendNotFound(res, 'Student not found');
    }

    student = await resolveStudentFileUrls(student);
    return res.json({ success: true, student });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Retrieve audit log activity and login history for a student.
 *
 * @route GET /api/students/:id/activity
 */
export const getStudentActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await getRecordActivity('students', id);
    let loginHistory = [];

    const student =
      checkFallback() || !mongoose.Types.ObjectId.isValid(id)
        ? FallbackDb.findById('students', id) ||
          FallbackDb.findOne('students', { admissionNumber: id })
        : await Student.findById(id).populate('user', 'loginHistory lastLogin');

    if (student) {
      loginHistory = student.loginHistory || [];
      if (!loginHistory.length && student.user) {
        const user = checkFallback() ? FallbackDb.findById('users', student.user) : student.user;
        loginHistory = user?.loginHistory || [];
      }
    }

    return res.json({ success: true, logs, loginHistory });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Dispatch 6-digit email OTP for student verification.
 *
 * @route POST /api/students/send-email-otp
 */
export const sendStudentEmailOtp = async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email || !email.trim()) {
      return sendBadRequest(res, 'Email address is required');
    }

    const normalizedEmail = normalizeEmail(email);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedEmail)) {
      return sendBadRequest(res, 'Please provide a valid email address');
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    if (!checkFallback()) {
      await Otp.deleteMany({ email: normalizedEmail });
      await Otp.create({
        email: normalizedEmail,
        name: (name || 'Student').trim(),
        otp,
        purpose: 'student-email-verification',
      });
    } else {
      FallbackDb.create('otps', {
        email: normalizedEmail,
        name: (name || 'Student').trim(),
        otp,
        purpose: 'student-email-verification',
        createdAt: new Date(),
      });
    }

    await sendStudentOtpEmail({
      to: normalizedEmail,
      name: (name || 'Student').trim(),
      otp,
    });

    return res.json({
      success: true,
      message: `A 6-digit verification code was sent to ${normalizedEmail}`,
      email: normalizedEmail,
    });
  } catch (error) {
    return sendError(res, error.message || 'Failed to send verification code', 500, error);
  }
};

/**
 * Verify 6-digit student email OTP and persist verification status if studentId provided.
 *
 * @route POST /api/students/verify-email-otp
 */
export const verifyStudentEmailOtp = async (req, res) => {
  try {
    const { email, otp, studentId } = req.body;
    if (!email || !otp) {
      return sendBadRequest(res, 'Email address and 6-digit verification code are required');
    }

    const normalizedEmail = normalizeEmail(email);
    const enteredOtp = String(otp).trim();

    if (!checkFallback()) {
      const otpRecord = await Otp.findOne({
        email: normalizedEmail,
        otp: enteredOtp,
      }).sort({ createdAt: -1 });

      if (!otpRecord) {
        return sendBadRequest(
          res,
          'Invalid or expired verification code. Please request a new code.'
        );
      }

      await Otp.deleteMany({ email: normalizedEmail });
    } else {
      const allOtps = FallbackDb.find('otps') || [];
      const idx = allOtps.findIndex(
        (o) => o.email === normalizedEmail && String(o.otp).trim() === enteredOtp
      );
      if (idx === -1) {
        return sendBadRequest(
          res,
          'Invalid or expired verification code. Please request a new code.'
        );
      }
      FallbackDb.delete('otps', allOtps[idx].id);
    }

    if (studentId) {
      if (checkFallback() || !mongoose.Types.ObjectId.isValid(studentId)) {
        const updated = FallbackDb.update('students', studentId, { isEmailVerified: true });
        if (updated?.user) {
          FallbackDb.update('users', updated.user, { isEmailVerified: true });
        }
      } else {
        const student = await Student.findByIdAndUpdate(
          studentId,
          { isEmailVerified: true },
          { new: true }
        );
        if (student?.user) {
          await User.findByIdAndUpdate(student.user, { isEmailVerified: true });
        }
      }
    }

    return res.json({
      success: true,
      isEmailVerified: true,
      message: 'Student email verified successfully!',
    });
  } catch (error) {
    return sendError(res, error.message || 'Failed to verify email code', 500, error);
  }
};

/**
 * Create and register a single student record and linked parent/user accounts.
 *
 * @route POST /api/students
 */
export const createStudent = async (req, res) => {
  try {
    if (req.body.isLegacyStudent !== undefined && !isStudentLegacyValue(req.body.isLegacyStudent)) {
      return sendBadRequest(res, 'Legacy student must be true or false');
    }
    const payload = await buildStudentPayload(req.body);
    let password = req.body.password;
    if (!password || password.length < 6) {
      password = generateRandomPassword();
    }

    if (!payload.name) payload.name = `Student ${payload.admissionNumber}`;
    if (!payload.contactNumber) payload.contactNumber = '';
    if (!payload.parentName) payload.parentName = `Guardian of ${payload.name}`;
    if (!payload.parentContact) payload.parentContact = payload.contactNumber;

    if (!payload.aadhaarNumber || !payload.aadhaarNumber.trim()) {
      return sendBadRequest(res, 'Aadhaar number is mandatory for student registration');
    }
    if (!payload.photo || !payload.photo.trim()) {
      return sendBadRequest(
        res,
        'Student photo (1MB or less) is mandatory for student registration'
      );
    }
    if (!payload.aadhaarDocument || !payload.aadhaarDocument.trim()) {
      return sendBadRequest(
        res,
        'Aadhaar PDF document (1MB or less) is mandatory for student registration'
      );
    }

    if (req.body.confirmPassword !== undefined && password !== req.body.confirmPassword) {
      return sendBadRequest(res, 'Password and confirm password do not match');
    }

    if (checkFallback()) {
      const duplicateStudent =
        FallbackDb.findOne('students', {
          admissionNumber: payload.admissionNumber,
        }) || FallbackDb.findOne('students', { email: payload.email });
      if (duplicateStudent) {
        return res.status(409).json({
          success: false,
          message: 'Student admission number or email already exists',
        });
      }

      const existingUser =
        FallbackDb.findOne('users', { email: payload.email }) ||
        FallbackDb.findOne('users', { admissionNumber: payload.admissionNumber });
      if (existingUser) {
        const linkedStudent = FallbackDb.findOne('students', {
          user: existingUser.id || existingUser._id,
        });
        if (linkedStudent || existingUser.role !== 'student') {
          return res.status(409).json({
            success: false,
            message: 'Student admission number or email already exists',
          });
        }
        FallbackDb.delete('users', existingUser.id || existingUser._id);
      }

      const parentEmail = normalizeEmail(
        payload.parentEmail || `${payload.parentContact}@parent.school.local`
      );
      let parent =
        FallbackDb.findOne('parents', { phone: payload.parentContact }) ||
        (payload.parentEmail ? FallbackDb.findOne('parents', { email: parentEmail }) : null);

      if (!parent) {
        const existingParentUser =
          FallbackDb.findOne('users', { email: parentEmail }) ||
          FallbackDb.findOne('users', {
            username: `par_${payload.parentContact}`,
          });
        if (existingParentUser) {
          return res.status(409).json({
            success: false,
            message: `Parent email (${parentEmail}) or contact username is already registered to another user account.`,
          });
        }
      }

      const studentRecord = FallbackDb.create('students', {
        ...payload,
        password,
        tempPassword: password,
        role: 'student',
      });

      await createOrLinkParent(payload, studentRecord.id, password);

      await logActivity({
        userId: req.user?._id || req.user?.id,
        action: 'CREATE',
        module: 'students',
        recordId: studentRecord.id,
        details: `Created student ${payload.name}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.status(201).json({
        success: true,
        message: 'Student and login credentials processed successfully',
        student: enrichStudent(studentRecord),
        accountCreated: {
          admissionNumber: payload.admissionNumber,
          email: payload.email,
          temporaryPassword: password,
        },
      });
    }

    const existingStudent = await Student.findOne({
      admissionNumber: payload.admissionNumber,
    });
    if (existingStudent) {
      return res.status(409).json({
        success: false,
        message: `Admission number ${payload.admissionNumber} is already in use.`,
      });
    }

    const emailConflict = await Student.findOne({ email: payload.email });
    if (emailConflict) {
      return res.status(409).json({
        success: false,
        message: `Email ${payload.email} is already registered to another student.`,
      });
    }

    // Students are stored exclusively in Student collection
    const studentRecord = await Student.create({
      ...payload,
      password,
      tempPassword: password,
      role: 'student',
      schoolId: req.schoolId || req.user?.schoolId || payload.schoolId || 'IQRA_P01001',
    });

    try {
      await createOrLinkParent(payload, studentRecord._id, password);
    } catch (_pErr) {
      console.warn('createOrLinkParent non-blocking warning:', _pErr.message);
    }

    await logActivity({
      userId: req.user?._id,
      action: 'CREATE',
      module: 'students',
      recordId: studentRecord._id,
      details: `Created student ${payload.name}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Student and login credentials processed successfully',
      student: studentRecord,
      accountCreated: {
        admissionNumber: payload.admissionNumber,
        email: payload.email,
        temporaryPassword: password,
      },
    });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Update student profile information and synchronized user credentials.
 *
 * @route PUT /api/students/:id
 */
export const updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.body.isLegacyStudent !== undefined && !isStudentLegacyValue(req.body.isLegacyStudent)) {
      return sendBadRequest(res, 'Legacy student must be true or false');
    }
    const updateData = { ...req.body };
    if (updateData.isLegacyStudent !== undefined) {
      updateData.isLegacyStudent = isLegacyStudent(updateData.isLegacyStudent);
    }
    delete updateData.password;
    delete updateData.confirmPassword;
    if (updateData.email) updateData.email = normalizeEmail(updateData.email);
    if (updateData.admissionNumber) {
      updateData.admissionNumber = normalizeAdmissionNumber(updateData.admissionNumber);
    }

    const matchedClass = resolveClass(
      updateData.class || updateData.classId || updateData.className
    );
    const matchedSection = resolveSection(
      updateData.section || updateData.sectionId || updateData.sectionName
    );

    if (matchedClass) {
      updateData.class = matchedClass.name;
      updateData.className = matchedClass.name;
      updateData.classId = updateData.classId || matchedClass.id;
    }
    if (matchedSection) {
      updateData.section = matchedSection.name;
      updateData.sectionName = matchedSection.name;
      updateData.sectionId = updateData.sectionId || matchedSection.id;
    }

    if (updateData.firstName || updateData.lastName) {
      updateData.name = `${updateData.firstName || ''} ${updateData.lastName || ''}`.trim();
    }

    if (updateData.imagesRef || updateData.photo) {
      const pUrl = updateData.imagesRef?.img || updateData.photo || '';
      const pId =
        updateData.imagesRef?.id || updateData.photoId || (pUrl ? `img_${Date.now()}` : '');
      updateData.photo = pUrl;
      updateData.imagesRef = { id: pId, img: pUrl };
    }
    if (updateData.AdharRef || updateData.aadhaarDocument) {
      const aUrl = updateData.AdharRef?.pdf || updateData.aadhaarDocument || '';
      const aId =
        updateData.AdharRef?.id || updateData.aadhaarDocId || (aUrl ? `doc_${Date.now()}` : '');
      updateData.aadhaarDocument = aUrl;
      updateData.AdharRef = { id: aId, pdf: aUrl };
    }

    if (updateData.isEmailVerified !== undefined) {
      updateData.isEmailVerified = Boolean(updateData.isEmailVerified);
    }
    if (updateData.admissionDate && updateData.joiningDate === undefined) {
      updateData.joiningDate = updateData.admissionDate;
    } else if (updateData.joiningDate && updateData.admissionDate === undefined) {
      updateData.admissionDate = updateData.joiningDate;
    }
    if (updateData.transferCertificateNumber) {
      updateData.transferCertificateNumber = String(updateData.transferCertificateNumber).trim().toUpperCase();
    }
    delete updateData.permissions;

    let updatedRecord = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      updatedRecord =
        FallbackDb.update('students', id, updateData) ||
        FallbackDb.findOne('students', { admissionNumber: id });
      if (updatedRecord?.user) {
        FallbackDb.update('users', updatedRecord.user, {
          username: updatedRecord.admissionNumber.toLowerCase(),
          admissionNumber: updatedRecord.admissionNumber,
          email: updatedRecord.email,
          name: updatedRecord.name,
          isActive: updatedRecord.status === 'active',
          isEmailVerified: Boolean(updatedRecord.isEmailVerified),
        });
      }
    } else {
      updatedRecord = await Student.findByIdAndUpdate(id, updateData, {
        new: true,
      });
      if (updatedRecord?.user) {
        await User.findByIdAndUpdate(updatedRecord.user, {
          username: updatedRecord.admissionNumber.toLowerCase(),
          admissionNumber: updatedRecord.admissionNumber,
          email: updatedRecord.email,
          name: updatedRecord.name,
          isActive: updatedRecord.status === 'active',
          forcePasswordChange: updatedRecord.forcePasswordChange,
          accountExpiryDate: updatedRecord.accountExpiryDate,
          loginRestriction: updatedRecord.loginRestriction,
          twoFactorEnabled: updatedRecord.twoFactorEnabled,
          isEmailVerified: Boolean(updatedRecord.isEmailVerified),
        });
      }
    }

    if (!updatedRecord) {
      return sendNotFound(res, 'Student not found');
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'UPDATE',
      module: 'students',
      recordId: id,
      details: `Updated student ${updatedRecord.name}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      success: true,
      message: 'Student updated successfully',
      student: enrichStudent(updatedRecord),
    });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Deactivate student status.
 *
 * @route PATCH /api/students/:id/deactivate
 */
export const deactivateStudent = async (req, res) => {
  req.body.status = 'inactive';
  return updateStudent(req, res);
};

/**
 * Reset student account password.
 *
 * @route POST /api/students/:id/reset-password
 */
export const resetStudentPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const password = req.body.generateRandomPassword
      ? generateRandomPassword()
      : req.body.password || req.body.newPassword;
    if (!password || password.length < 6) {
      return sendBadRequest(res, 'Password must be at least 6 characters');
    }

    const student =
      checkFallback() || !mongoose.Types.ObjectId.isValid(id)
        ? FallbackDb.findById('students', id) ||
          FallbackDb.findOne('students', { admissionNumber: id })
        : await Student.findById(id);
    if (!student) {
      return sendNotFound(res, 'Student not found');
    }

    if (checkFallback()) {
      FallbackDb.update('students', student.id || student._id, {
        password,
        tempPassword: password,
        forcePasswordChange: Boolean(req.body.forcePasswordChange),
        failedLoginAttempts: 0,
        lockUntil: null,
      });
    } else {
      student.password = password;
      student.tempPassword = password;
      student.forcePasswordChange = Boolean(req.body.forcePasswordChange);
      student.failedLoginAttempts = 0;
      student.lockUntil = null;
      await student.save();
    }

    return res.json({
      success: true,
      message: 'Student password reset successfully',
      account: {
        admissionNumber: student.admissionNumber,
        email: student.email,
        temporaryPassword: password,
      },
    });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Permanently delete student and linked user records.
 *
 * @route DELETE /api/students/:id
 */
export const deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;
    let success = false;
    let studentName = '';

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      const student =
        FallbackDb.findById('students', id) ||
        FallbackDb.findOne('students', { admissionNumber: id });
      if (student) {
        studentName = student.name;
        if (student.user) FallbackDb.delete('users', student.user);
        success = FallbackDb.delete('students', student.id || id);
      }
    } else {
      const student = await Student.findById(id);
      if (student) {
        studentName = student.name;
        await User.deleteMany({
          $or: [
            ...(student.user && mongoose.Types.ObjectId.isValid(student.user) ? [{ _id: student.user }] : []),
            ...(student.email ? [{ email: student.email }] : []),
            ...(student.admissionNumber ? [{ admissionNumber: student.admissionNumber }] : []),
            { profileId: id },
          ],
        }).catch(() => null);
        await Student.findByIdAndDelete(id);
        success = true;
      }
    }

    if (!success) {
      return sendNotFound(res, 'Student not found');
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'DELETE',
      module: 'students',
      recordId: id,
      details: `Deleted student ${studentName}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      success: true,
      message: 'Student and linked user account deleted successfully',
    });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Bulk delete multiple students.
 *
 * @route POST /api/students/bulk-delete
 */
export const bulkDeleteStudents = async (req, res) => {
  try {
    const { ids = [] } = req.body;
    if (!ids.length) {
      return sendBadRequest(res, 'No student IDs provided');
    }

    let deleted = 0;
    for (const id of ids) {
      if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
        const student =
          FallbackDb.findById('students', id) ||
          FallbackDb.findOne('students', { admissionNumber: id });
        if (student) {
          if (student.user) FallbackDb.delete('users', student.user);
          if (FallbackDb.delete('students', student.id || id)) deleted++;
        }
      } else {
        const student = await Student.findById(id);
        if (student) {
          if (student.user && mongoose.Types.ObjectId.isValid(student.user)) {
            await User.findByIdAndDelete(student.user);
          }
          await Student.findByIdAndDelete(id);
          deleted++;
        }
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'BULK',
      module: 'students',
      details: `Bulk deleted ${deleted} students`,
      ipAddress: req.ip,
      metadata: { ids },
    });

    return res.json({
      success: true,
      message: `${deleted} students deleted`,
      deleted,
    });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Promote selected students to a target class.
 *
 * @route POST /api/students/bulk-promote
 */
export const bulkPromoteStudents = async (req, res) => {
  try {
    const { ids = [], classId, sectionId } = req.body;
    if (!ids.length || !classId) {
      return sendBadRequest(res, 'Student IDs and target class are required');
    }

    let promoted = 0;
    const update = { classId, ...(sectionId ? { sectionId } : {}) };

    for (const id of ids) {
      if (checkFallback()) {
        if (FallbackDb.update('students', id, update)) promoted++;
      } else {
        const result = await Student.findByIdAndUpdate(id, update);
        if (result) promoted++;
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'BULK',
      module: 'students',
      details: `Promoted ${promoted} students to class ${classId}`,
      ipAddress: req.ip,
      metadata: { ids, classId, sectionId },
    });

    return res.json({
      success: true,
      message: `${promoted} students promoted`,
      promoted,
    });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Export student roster to CSV format.
 *
 * @route GET /api/students/export
 */
export const exportStudents = async (req, res) => {
  try {
    const students = checkFallback()
      ? FallbackDb.find('students')
      : await Student.find().select(studentRosterFields).lean();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=students.csv');
    return res.send(studentRosterCsv(students));
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Retrieve credentials for display/print by administrator.
 *
 * @route GET /api/students/:id/credentials
 */
export const getStudentCredentials = async (req, res) => {
  try {
    const { id } = req.params;
    let student = null;
    let userRecord = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      student =
        FallbackDb.findById('students', id) ||
        FallbackDb.findOne('students', { admissionNumber: id });
      if (student?.user) {
        userRecord = FallbackDb.findById('users', student.user);
      }
    } else {
      student = await Student.findById(id);
      if (student?.user) {
        userRecord = await User.findById(student.user);
      }
    }

    const username = userRecord?.username || student?.admissionNumber || id;
    const email =
      userRecord?.email || student?.email || `${String(username).toLowerCase()}@school.local`;

    let password =
      student?.tempPassword ||
      userRecord?.tempPassword ||
      (student?.password && !student.password.startsWith('$2') ? student.password : '') ||
      '';

    if (password.startsWith('$2a$') || password.startsWith('$2b$')) {
      password = student?.tempPassword || userRecord?.tempPassword || '';
    }

    return res.json({
      success: true,
      credentials: {
        username,
        email,
        password,
        name: student?.name || username,
        admissionNumber: student?.admissionNumber || username,
      },
    });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Bulk import multiple student records from structured array.
 *
 * @route POST /api/students/bulk-import
 */
export const bulkImportStudents = async (req, res) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0) {
      return sendBadRequest(res, 'No student data provided for import');
    }

    let successCount = 0;
    const errors = [];

    const useFallback = checkFallback();
    // Use the same active-session fallback as the registration page.
    let activeSession = null;
    try {
      if (useFallback) {
        const sessions = FallbackDb.find('academicSessions');
        activeSession = sessions.find((session) => session.isCurrent) || sessions[0];
      } else {
        activeSession = await AcademicSession.findOne({ isCurrent: true }).lean()
          || await AcademicSession.findOne().sort({ startDate: -1 }).lean();
      }
    } catch (_e) {
      // Non-blocking
    }

    const activeSessionId = activeSession?._id || activeSession?.id;
    for (let i = 0; i < students.length; i++) {
      const raw = students[i];
      try {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new Error('Invalid student row.');
        }
        const first = String(raw.firstName || raw.name || '').trim();
        const last = String(raw.lastName || '').trim();
        const invalidName = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/u;
        if (!/[\p{L}\p{N}]/u.test(first) || invalidName.test(first) || invalidName.test(last)) {
          throw new Error('Enter a valid student name.');
        }
        const trailers = ['firstname', 'first name', 'total', 'subtotal', 'classid', 'sectionid', 'students', 'summary', 'count'];
        const lowerFirst = first.toLowerCase();
        if (trailers.includes(lowerFirst) || (!last && lowerFirst.startsWith('cls-'))) {
          throw new Error('Remove the repeated header or summary row.');
        }
        if (raw.isLegacyStudent !== undefined && !isStudentLegacyValue(raw.isLegacyStudent)) {
          throw new Error('Legacy student must be true or false.');
        }

        const payload = await buildStudentPayload({
          ...raw,
          academicYear: raw.academicYear || activeSession?.sessionName,
          sessionId: raw.sessionId || activeSessionId,
        });
        const conflictingEmail = useFallback
          ? FallbackDb.findOne('students', { email: payload.email }) || FallbackDb.findOne('users', { email: payload.email })
          : await Student.exists({ email: payload.email }) || await User.exists({ email: payload.email });
        if (conflictingEmail) {
          throw new Error('This student email is already registered.');
        }
        const password = typeof raw.password === 'string' && raw.password.length >= 6
          ? raw.password
          : generateSecurePassword('Std@');
        if (useFallback) {
          const createdStudent = FallbackDb.create('students', {
            ...payload,
            password,
            tempPassword: password,
            role: 'student',
          });
          try {
            if (payload.parentContact) await createOrLinkParent(payload, createdStudent.id, password);
          } catch (_pErr) {
            // Non-blocking
          }
        } else {
          const studentRecord = await Student.create({
            ...payload,
            password,
            tempPassword: password,
            role: 'student',
            schoolId: req.schoolId || req.user?.schoolId || payload.schoolId || 'IQRA_P01001',
          });

          try {
            if (payload.parentContact) await createOrLinkParent(payload, studentRecord._id, password);
          } catch (_pErr) {
            // Non-blocking parent account linking
          }

          // Track session enrollment history if active session exists
          if (activeSessionId && String(payload.sessionId) === String(activeSessionId)) {
            try {
              await StudentSessionHistory.findOneAndUpdate(
                { studentId: studentRecord._id, sessionId: activeSession._id },
                {
                  studentId: studentRecord._id,
                  studentName: studentRecord.name,
                  admissionNumber: studentRecord.admissionNumber,
                  sessionId: activeSession._id,
                  sessionName: activeSession.sessionName,
                  classId: studentRecord.classId || '',
                  className: studentRecord.className || studentRecord.class || '',
                  sectionId: studentRecord.sectionId || '',
                  sectionName: studentRecord.sectionName || studentRecord.section || '',
                  rollNumber: studentRecord.rollNumber,
                  action: 'enrolled',
                  status: 'active',
                  enrolledAt: new Date(),
                  enrolledBy: req.user?.name || 'admin',
                },
                { upsert: true, new: true }
              );
            } catch (_shErr) {
              // Non-blocking
            }
          }
        }
        successCount++;
      } catch (err) {
        errors.push({
          index: i,
          name: raw?.firstName || raw?.name || `Row ${i + 1}`,
          error: err.code === 11000 ? 'A student with these details already exists. Check the directory before retrying.' : err.message,
        });
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'BULK',
      module: 'students',
      details: `Bulk imported ${successCount} students`,
      ipAddress: req.ip,
      metadata: { total: students.length, successCount, errorCount: errors.length },
    });

    return res.json({
      success: true,
      count: successCount,
      total: students.length,
      errors,
      message: `Successfully imported ${successCount} out of ${students.length} students.${errors.length ? ` (${errors.length} failed)` : ''}`,
    });
  } catch (error) {
    return sendError(res, 'Bulk import failed', 500, error);
  }
};

/**
 * Remove corrupted students and their linked user accounts
 * (e.g. records created with null bytes / binary characters during raw xlsx import)
 *
 * @route POST /api/students/clean-corrupted
 */
export const cleanCorruptedStudents = async (req = {}, res = null) => {
  try {
    let deletedCount = 0;

    // Check FallbackDb first
    const fallbackStudents = FallbackDb.find('students') || [];
    const corruptedFallback = fallbackStudents.filter(
      (s) =>
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/.test(s.firstName || '') ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/.test(s.name || '') ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/.test(s.parentName || '') ||
        (s.className === 'N/A' && s.class === 'N/A' && !s.classId && s.rollNumber > 1000)
    );
    corruptedFallback.forEach((s) => {
      FallbackDb.delete('students', s.id || s._id);
      if (s.user) FallbackDb.delete('users', s.user);
      deletedCount++;
    });

    // Check MongoDB
    if (!checkFallback()) {
      const isCorruptedStr = (str) => {
        if (!str || typeof str !== 'string') return false;
        return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/.test(str);
      };

      // Query students and inspect in JavaScript to avoid any database regex engine incompatibilities
      const candidates = await Student.find({})
        .select('_id user firstName name parentName className class classId rollNumber admissionNumber')
        .lean();

      const corruptedStudents = candidates.filter(
        (s) =>
          isCorruptedStr(s.firstName) ||
          isCorruptedStr(s.name) ||
          isCorruptedStr(s.parentName) ||
          (s.className === 'N/A' && s.class === 'N/A' && !s.classId && s.rollNumber > 1000)
      );

      if (corruptedStudents.length > 0) {
        const studentIds = corruptedStudents.map((s) => s._id);
        const userIds = corruptedStudents.map((s) => s.user).filter(Boolean);
        const admissionNumbers = corruptedStudents.map((s) => s.admissionNumber).filter(Boolean);

        await User.deleteMany({
          $or: [
            { _id: { $in: userIds } },
            { profileId: { $in: studentIds } },
            { admissionNumber: { $in: admissionNumbers } },
            { username: { $in: admissionNumbers.map((a) => a.toLowerCase()) } },
          ],
        });

        await StudentSessionHistory.deleteMany({
          $or: [
            { studentId: { $in: studentIds } },
            { admissionNumber: { $in: admissionNumbers } },
          ],
        });

        const delRes = await Student.deleteMany({ _id: { $in: studentIds } });
        deletedCount += delRes.deletedCount || studentIds.length;
      }

      // Remove all legacy student and parent records from User collection
      await User.deleteMany({ role: { $in: ['student', 'parent'] } });

      // Backfill password on any students currently in Student collection without a password
      const studentsMissingPassword = await Student.find({
        $or: [
          { password: { $exists: false } },
          { password: null },
          { password: '' },
        ],
      });
      for (const st of studentsMissingPassword) {
        const fallbackPw = st.tempPassword || generateRandomPassword();
        st.password = fallbackPw;
        st.tempPassword = fallbackPw;
        await st.save();
      }

      // Also clean any orphaned User records that have binary characters in name/username
      const candidateUsers = await User.find({}).lean();
      const corruptedUserIds = candidateUsers
        .filter((u) => isCorruptedStr(u.name) || isCorruptedStr(u.username))
        .map((u) => u._id);

      if (corruptedUserIds.length > 0) {
        await User.deleteMany({ _id: { $in: corruptedUserIds } });
      }
    }

    if (res) {
      return res.json({
        success: true,
        deletedCount,
        message: `Successfully cleaned up ${deletedCount} corrupted student records.`,
      });
    }
    return deletedCount;
  } catch (error) {
    if (res) return sendError(res, error.message || 'Failed to clean corrupted records', 500, error);
    console.error('cleanCorruptedStudents error:', error);
    return 0;
  }
};

// ─── PROMOTE / DEMOTE STUDENTS (Bulk Whole School, Class-wise, or Individual) ───

const CLASS_ORDER = [
  'Nursery',
  'LKG',
  'UKG',
  'Class 1',
  'Class 2',
  'Class 3',
  'Class 4',
  'Class 5',
  'Class 6',
  'Class 7',
  'Class 8',
  'Class 9',
  'Class 10',
  'Class 11',
  'Class 12',
];

/**
 * Determine the next class in the academic progression sequence.
 *
 * @param {string} currentClass - Current class name.
 * @returns {string} Target promoted class name or 'Passout'.
 */
const getNextClass = (currentClass) => {
  if (!currentClass) return 'Class 1';
  const normalized = String(currentClass).split(' - ')[0].trim();
  const idx = CLASS_ORDER.findIndex((c) => c.toLowerCase() === normalized.toLowerCase());
  if (idx === -1) return 'Class 1';
  if (idx === CLASS_ORDER.length - 1) return 'Passout';
  return CLASS_ORDER[idx + 1];
};

/**
 * Determine the previous class in the academic progression sequence.
 *
 * @param {string} currentClass - Current class name.
 * @param {string} status - Current student status.
 * @returns {string} Target demoted class name.
 */
const getPrevClass = (currentClass, status) => {
  if (status === 'Passout' || currentClass === 'Passout') return 'Class 12';
  if (!currentClass) return 'Nursery';
  const normalized = String(currentClass).split(' - ')[0].trim();
  const idx = CLASS_ORDER.findIndex((c) => c.toLowerCase() === normalized.toLowerCase());
  if (idx <= 0) return CLASS_ORDER[0];
  return CLASS_ORDER[idx - 1];
};

/**
 * Promote or demote students across institution, class, or individual selection.
 *
 * @route POST /api/students/promote
 */
export const promoteStudents = async (req, res) => {
  try {
    const {
      mode = 'whole_school',
      action = 'promote',
      sourceClass = '',
      studentIds = [],
      targetSession = '',
    } = req.body;

    const isPromote = action === 'promote';
    let updatedCount = 0;
    const updateLogs = [];

    if (checkFallback()) {
      let allStudents = FallbackDb.find('students') || [];

      allStudents = allStudents.map((s) => {
        let shouldUpdate = false;
        if (mode === 'whole_school') {
          shouldUpdate = true;
        } else if (mode === 'class_wise') {
          const sClass = String(s.className || s.class || '')
            .split(' - ')[0]
            .trim();
          shouldUpdate =
            sClass.toLowerCase() === String(sourceClass).split(' - ')[0].trim().toLowerCase();
        } else if (mode === 'individual') {
          shouldUpdate = studentIds.includes(String(s.id)) || studentIds.includes(String(s._id));
        }

        if (shouldUpdate) {
          const currentCls = s.className || s.class || 'Class 1';
          const newCls = isPromote ? getNextClass(currentCls) : getPrevClass(currentCls, s.status);
          const isPassout = newCls === 'Passout';

          updatedCount++;
          updateLogs.push({ studentId: s.id || s._id, name: s.name, from: currentCls, to: newCls });

          return {
            ...s,
            className: newCls,
            class: newCls,
            status: isPassout
              ? 'Passout'
              : isPromote && s.status === 'Passout'
                ? 'Passout'
                : 'active',
            academicYear: targetSession || s.academicYear,
            promotionHistory: [
              ...(s.promotionHistory || []),
              {
                fromClass: currentCls,
                toClass: newCls,
                action: isPassout ? 'passout' : action,
                sessionName: targetSession,
                promotedAt: new Date().toISOString(),
                promotedBy: req.user?.name || 'admin',
              },
            ],
          };
        }
        return s;
      });

      FallbackDb.updateAll('students', allStudents);

      await logActivity({
        userId: req.user?._id || req.user?.id,
        action: isPromote ? 'PROMOTE' : 'DEMOTE',
        module: 'students',
        details: `${isPromote ? 'Promoted' : 'Demoted'} ${updatedCount} students (${mode})`,
        ipAddress: req.ip,
      });

      return res.json({
        success: true,
        updatedCount,
        message: `Successfully ${isPromote ? 'promoted' : 'demoted'} ${updatedCount} student(s)!`,
        logs: updateLogs,
      });
    }

    // MongoDB Mode
    const activeSession = await AcademicSession.findOne({ isCurrent: true }).lean();

    let query = {};
    if (mode === 'class_wise') {
      const clsName = String(sourceClass).split(' - ')[0].trim();
      query = {
        $or: [
          { className: { $regex: new RegExp(`^${clsName}`, 'i') } },
          { class: { $regex: new RegExp(`^${clsName}`, 'i') } },
        ],
      };
    } else if (mode === 'individual') {
      query = { _id: { $in: studentIds } };
    }

    const students = await Student.find(query);

    for (const student of students) {
      const currentCls = student.className || student.class || 'Class 1';
      const newCls = isPromote
        ? getNextClass(currentCls)
        : getPrevClass(currentCls, student.status);
      const isPassout = newCls === 'Passout';

      student.className = newCls;
      student.class = newCls;
      student.status = isPassout
        ? 'Passout'
        : isPromote && student.status === 'Passout'
          ? 'Passout'
          : 'active';
      if (targetSession) student.academicYear = targetSession;

      student.promotionHistory = student.promotionHistory || [];
      student.promotionHistory.push({
        fromClass: currentCls,
        toClass: newCls,
        action: isPassout ? 'passout' : action,
        sessionName: targetSession || activeSession?.sessionName || '',
        sessionId: activeSession?._id || null,
        promotedAt: new Date(),
        promotedBy: req.user?.name || 'admin',
      });

      await student.save();

      if (activeSession) {
        await StudentSessionHistory.findOneAndUpdate(
          { studentId: student._id, status: 'active' },
          {
            status: 'completed',
            completedAt: new Date(),
            completedBy: req.user?.name || 'admin',
            action: isPassout ? 'passout' : action,
          }
        );

        if (!isPassout) {
          await StudentSessionHistory.findOneAndUpdate(
            { studentId: student._id, sessionId: activeSession._id },
            {
              studentId: student._id,
              studentName: student.name,
              admissionNumber: student.admissionNumber,
              sessionId: activeSession._id,
              sessionName: activeSession.sessionName,
              classId: student.classId || '',
              className: newCls,
              sectionId: student.sectionId || '',
              sectionName: student.sectionName || student.section || '',
              rollNumber: student.rollNumber,
              action: 'promoted',
              status: 'active',
              enrolledAt: new Date(),
              enrolledBy: req.user?.name || 'admin',
            },
            { upsert: true, new: true }
          );
        }
      }

      updatedCount++;
      updateLogs.push({ studentId: student._id, name: student.name, from: currentCls, to: newCls });
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: isPromote ? 'PROMOTE' : 'DEMOTE',
      module: 'students',
      details: `${isPromote ? 'Promoted' : 'Demoted'} ${updatedCount} students (${mode})`,
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      updatedCount,
      message: `Successfully ${isPromote ? 'promoted' : 'demoted'} ${updatedCount} student(s)!`,
      logs: updateLogs,
    });
  } catch (error) {
    return sendError(res, error.message || 'Promotion operation failed', 500, error);
  }
};

/**
 * Rollback student promotions enacted within the configured hour window.
 *
 * @route POST /api/students/rollback-promotion
 */
export const rollbackPromotion = async (req, res) => {
  try {
    const { maxHours = 24 } = req.body;
    const cutoffTime = new Date(Date.now() - maxHours * 60 * 60 * 1000);
    let revertedCount = 0;
    const revertLogs = [];

    if (checkFallback()) {
      let allStudents = FallbackDb.find('students') || [];

      allStudents = allStudents.map((s) => {
        const history = s.promotionHistory || [];
        if (!history.length) return s;

        const lastEntry = history[history.length - 1];
        const entryTime = new Date(lastEntry.promotedAt);

        if (entryTime >= cutoffTime && lastEntry.action !== 'rolled_back') {
          revertedCount++;
          const prevClass = lastEntry.fromClass || 'Class 1';

          revertLogs.push({
            studentId: s.id || s._id,
            name: s.name,
            from: s.className || s.class,
            revertedTo: prevClass,
          });

          return {
            ...s,
            className: prevClass,
            class: prevClass,
            status: 'active',
            promotionHistory: [
              ...history.slice(0, -1),
              {
                ...lastEntry,
                action: 'rolled_back',
                rolledBackAt: new Date().toISOString(),
                rolledBackBy: req.user?.name || 'admin',
              },
            ],
          };
        }
        return s;
      });

      if (revertedCount > 0) {
        FallbackDb.updateAll('students', allStudents);
      }

      await logActivity({
        userId: req.user?._id || req.user?.id,
        action: 'ROLLBACK_PROMOTION',
        module: 'students',
        details: `Rolled back promotion for ${revertedCount} students within ${maxHours}h window`,
        ipAddress: req.ip,
      });

      return res.json({
        success: true,
        revertedCount,
        message:
          revertedCount > 0
            ? `Successfully rolled back promotion for ${revertedCount} student(s) to previous state!`
            : `No student promotions found within the last ${maxHours} hours to rollback.`,
        logs: revertLogs,
      });
    }

    // MongoDB Mode
    const students = await Student.find({
      'promotionHistory.promotedAt': { $gte: cutoffTime },
    });

    for (const student of students) {
      const history = student.promotionHistory || [];
      if (!history.length) continue;

      const lastEntry = history[history.length - 1];
      const entryTime = new Date(lastEntry.promotedAt);

      if (entryTime >= cutoffTime && lastEntry.action !== 'rolled_back') {
        revertedCount++;
        const prevClass = lastEntry.fromClass || 'Class 1';

        student.className = prevClass;
        student.class = prevClass;
        student.status = 'active';

        lastEntry.action = 'rolled_back';
        lastEntry.rolledBackAt = new Date();
        lastEntry.rolledBackBy = req.user?.name || 'admin';

        await student.save();
        revertLogs.push({
          studentId: student._id,
          name: student.name,
          from: student.className,
          revertedTo: prevClass,
        });
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'ROLLBACK_PROMOTION',
      module: 'students',
      details: `Rolled back promotion for ${revertedCount} students within ${maxHours}h window`,
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      revertedCount,
      message:
        revertedCount > 0
          ? `Successfully rolled back promotion for ${revertedCount} student(s) to previous state!`
          : `No student promotions found within the last ${maxHours} hours to rollback.`,
      logs: revertLogs,
    });
  } catch (error) {
    return sendError(res, error.message || 'Rollback operation failed', 500, error);
  }
};

/**
 * Check if recent promotions are eligible for rollback.
 *
 * @route GET /api/students/promotion-status
 */
export const getPromotionStatus = async (req, res) => {
  try {
    const maxHours = 24;
    const cutoffMs = Date.now() - maxHours * 60 * 60 * 1000;
    const cutoffTime = new Date(cutoffMs);
    let activePromotionsCount = 0;

    if (checkFallback()) {
      const allStudents = FallbackDb.find('students') || [];
      allStudents.forEach((s) => {
        const history = s.promotionHistory || [];
        history.forEach((entry) => {
          const rawDate = entry.promotedAt || entry.createdAt;
          const entryMs = rawDate ? new Date(rawDate).getTime() : 0;
          if (
            !isNaN(entryMs) &&
            entryMs >= cutoffMs &&
            entry.action !== 'rolled_back' &&
            entry.action !== 'demote'
          ) {
            activePromotionsCount++;
          }
        });
      });

      return res.json({
        success: true,
        canRollback: activePromotionsCount > 0,
        activePromotionsCount,
      });
    }

    const activePromotionsCountMongo = await Student.countDocuments({
      promotionHistory: {
        $elemMatch: {
          promotedAt: { $gte: cutoffTime },
          action: { $nin: ['rolled_back', 'demote'] },
        },
      },
    });

    return res.json({
      success: true,
      canRollback: activePromotionsCountMongo > 0,
      activePromotionsCount: activePromotionsCountMongo,
    });
  } catch (error) {
    return sendError(res, 'Failed to get promotion status', 500, error);
  }
};

/**
 * Upload student photo or Aadhaar document to AWS S3 (with local fallback).
 *
 * @route POST /api/students/upload-file
 */
export const uploadStudentFile = async (req, res) => {
  try {
    if (!req.file) {
      return sendBadRequest(res, 'No file uploaded');
    }

    if (req.file.size > 1024 * 1024) {
      return sendBadRequest(res, 'File size must not exceed 1MB');
    }

    const isPdf =
      req.file.mimetype === 'application/pdf' ||
      (req.file.originalname && req.file.originalname.toLowerCase().endsWith('.pdf'));

    const uploadType = req.body.type || (isPdf ? 'aadhaar' : 'photo');
    const folder =
      uploadType === 'photo' ? 'school-erp/students/photos' : 'school-erp/students/aadhaar';

    try {
      if (!process.env.AWS_S3_BUCKET_NAME) {
        throw new Error('AWS_S3_BUCKET_NAME is not configured');
      }

      const s3Key = generateS3Key(
        folder,
        req.file.originalname || (isPdf ? `aadhaar-${Date.now()}.pdf` : `photo-${Date.now()}.jpg`)
      );

      await uploadToS3({
        buffer: req.file.buffer,
        key: s3Key,
        contentType: isPdf ? 'application/pdf' : req.file.mimetype,
        contentDisposition: isPdf ? 'inline' : undefined,
      });

      const presignedUrl = await getPresignedUrl(s3Key, 3600);

      const ref =
        uploadType === 'photo'
          ? { id: s3Key, img: presignedUrl }
          : { id: s3Key, pdf: presignedUrl };

      return res.json({
        success: true,
        message: `${uploadType === 'photo' ? 'Photo' : 'Aadhaar document'} uploaded successfully`,
        url: presignedUrl,
        id: s3Key,
        publicId: s3Key,
        format: isPdf ? 'pdf' : req.file.originalname?.split('.').pop() || 'jpg',
        bytes: req.file.size,
        originalName: req.file.originalname,
        type: uploadType,
        imagesRef: uploadType === 'photo' ? ref : undefined,
        AdharRef: uploadType !== 'photo' ? ref : undefined,
        ref,
      });
    } catch (s3Err) {
      const uploadsDir = path.join(process.cwd(), 'uploads', 'students');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const ext = path.extname(req.file.originalname) || (isPdf ? '.pdf' : '.jpg');
      const safeFilename = `${uploadType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${ext}`;
      const destPath = path.join(uploadsDir, safeFilename);

      fs.writeFileSync(destPath, req.file.buffer);
      const fileUrl = `/uploads/students/${safeFilename}`;
      const fileId = safeFilename;
      const ref =
        uploadType === 'photo' ? { id: fileId, img: fileUrl } : { id: fileId, pdf: fileUrl };

      return res.json({
        success: true,
        message: `${uploadType === 'photo' ? 'Photo' : 'Aadhaar document'} saved locally`,
        url: fileUrl,
        id: fileId,
        publicId: fileId,
        originalName: req.file.originalname,
        type: uploadType,
        imagesRef: uploadType === 'photo' ? ref : undefined,
        AdharRef: uploadType !== 'photo' ? ref : undefined,
        ref,
      });
    }
  } catch (error) {
    return sendError(res, error.message || 'Failed to upload student file', 500, error);
  }
};

/**
 * Retrieve uploaded student document or photo by ID.
 *
 * @route GET /api/students/files/:fileId
 */
export const getStudentFileById = async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId) {
      return sendBadRequest(res, 'File ID is required');
    }

    let fileUrl = null;
    let fileType = 'image';

    if (checkFallback()) {
      const allStudents = FallbackDb.find('students') || [];
      const studentWithPhoto = allStudents.find(
        (s) => s.imagesRef?.id === fileId || s.photoId === fileId
      );
      if (studentWithPhoto) {
        fileUrl = studentWithPhoto.imagesRef?.img || studentWithPhoto.photo;
        fileType = 'image';
      } else {
        const studentWithDoc = allStudents.find(
          (s) => s.AdharRef?.id === fileId || s.aadhaarRef?.id === fileId
        );
        if (studentWithDoc) {
          fileUrl = studentWithDoc.AdharRef?.pdf || studentWithDoc.aadhaarDocument;
          fileType = 'pdf';
        }
      }
    } else {
      const studentWithPhoto = await Student.findOne({
        $or: [{ 'imagesRef.id': fileId }, { photo: new RegExp(fileId, 'i') }],
      });
      if (studentWithPhoto) {
        fileUrl = studentWithPhoto.imagesRef?.img || studentWithPhoto.photo;
        fileType = 'image';
      } else {
        const studentWithDoc = await Student.findOne({
          $or: [{ 'AdharRef.id': fileId }, { aadhaarDocument: new RegExp(fileId, 'i') }],
        });
        if (studentWithDoc) {
          fileUrl = studentWithDoc.AdharRef?.pdf || studentWithDoc.aadhaarDocument;
          fileType = 'pdf';
        }
      }
    }

    if (!fileUrl && fileId.includes('/')) {
      try {
        if (isS3Key(fileId)) {
          fileUrl = await getPresignedUrl(fileId, 3600);
          fileType =
            fileId.toLowerCase().includes('aadhaar') ||
            fileId.toLowerCase().includes('adhar') ||
            fileId.toLowerCase().endsWith('.pdf')
              ? 'pdf'
              : 'image';
        }
      } catch (err) {
        // Presigned generation skipped
      }
    }

    if (fileUrl && isS3Key(fileUrl)) {
      try {
        fileUrl = await getPresignedUrl(fileUrl, 3600);
      } catch (err) {
        // Presigned fallback
      }
    }

    if (!fileUrl) {
      return sendNotFound(res, `File not found for ID: ${fileId}`);
    }

    if (req.query.redirect === 'true' || req.headers.accept?.includes('image/')) {
      return res.redirect(fileUrl);
    }

    return res.json({
      success: true,
      id: fileId,
      url: fileUrl,
      type: fileType,
      imagesRef: fileType === 'image' ? { id: fileId, img: fileUrl } : undefined,
      AdharRef: fileType === 'pdf' ? { id: fileId, pdf: fileUrl } : undefined,
    });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

// Background one-time purge of legacy student and parent records from User collection
setTimeout(async () => {
  try {
    if (!checkFallback() && mongoose.connection.readyState === 1) {
      await User.deleteMany({ role: { $in: ['student', 'parent'] } });
    }
  } catch (_e) {
    // Non-blocking cleanup
  }
}, 3000);
