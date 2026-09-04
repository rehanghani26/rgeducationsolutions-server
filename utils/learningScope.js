import mongoose from 'mongoose';
import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import Parent from '../models/Parent.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';

export const ADMIN_ROLES = ['super-admin', 'superadmin', 'school-admin', 'admin', 'principal'];
export const TEACHING_ROLES = ['teacher', 'head-teacher', 'hod', 'coordinator'];

export const getRole = (req) => String(req.user?.role || '').toLowerCase();
export const isAdminRole = (role) => ADMIN_ROLES.includes(String(role || '').toLowerCase());
export const isTeacherRole = (role) => TEACHING_ROLES.includes(String(role || '').toLowerCase());
export const isStudentRole = (role) => String(role || '').toLowerCase() === 'student';
export const isParentRole = (role) => String(role || '').toLowerCase() === 'parent';

export const getUserId = (req) => req.user?._id || req.user?.id || null;
export const getRecordId = (item) => item?._id || item?.id || null;

const isValidObjectId = (value) => value && mongoose.Types.ObjectId.isValid(String(value));

const normalize = (value) => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') {
    return normalize(value.name || value._id || value.id || '');
  }
  return String(value).trim().toLowerCase();
};

const compact = (values) => values.filter((value) => value !== undefined && value !== null && String(value).trim() !== '');

const same = (left, right) => {
  if (left === undefined || left === null || right === undefined || right === null) return false;
  return String(left) === String(right);
};

const matchesAny = (leftValues, rightValues) => {
  const left = compact(leftValues).map(normalize);
  const right = compact(rightValues).map(normalize);
  return left.some((item) => item && right.includes(item));
};

export const isAllSections = (value) => {
  const normalized = normalize(value);
  return !normalized || ['all', 'all sections', 'all section', 'any', 'any section'].includes(normalized);
};

const enrichFallbackStudent = (student) => {
  if (!student) return null;
  const classRecord = student.classId ? FallbackDb.findById('classes', student.classId) : null;
  const sectionRecord = student.sectionId ? FallbackDb.findById('sections', student.sectionId) : null;
  return {
    ...student,
    className: student.className || student.class || classRecord?.name || student.classId,
    sectionName: student.sectionName || student.section || sectionRecord?.name || student.sectionId,
  };
};

export const getStudentProfileForUser = async (req) => {
  const userId = getUserId(req);
  const profileId = req.user?.profileId;

  if (checkFallback()) {
    const student =
      FallbackDb.findById('students', profileId) ||
      FallbackDb.findOne('students', { user: userId }) ||
      FallbackDb.findOne('students', { admissionNumber: req.user?.admissionNumber });
    return enrichFallbackStudent(student);
  }

  let student = null;
  if (isValidObjectId(profileId)) {
    student = await Student.findById(profileId);
  }
  if (!student && isValidObjectId(userId)) {
    student = await Student.findOne({ user: userId });
  }
  if (!student && req.user?.admissionNumber) {
    student = await Student.findOne({ admissionNumber: req.user.admissionNumber });
  }
  return student;
};

export const getTeacherProfileForUser = async (req) => {
  const userId = getUserId(req);
  const profileId = req.user?.profileId;

  if (checkFallback()) {
    return (
      FallbackDb.findById('teachers', profileId) ||
      FallbackDb.findOne('teachers', { user: userId }) ||
      FallbackDb.findOne('teachers', { employeeId: req.user?.employeeId })
    );
  }

  let teacher = null;
  if (isValidObjectId(profileId)) {
    teacher = await Teacher.findById(profileId);
  }
  if (!teacher && isValidObjectId(userId)) {
    teacher = await Teacher.findOne({ user: userId });
  }
  if (!teacher && req.user?.employeeId) {
    teacher = await Teacher.findOne({ employeeId: req.user.employeeId });
  }
  return teacher;
};

export const getParentChildrenForUser = async (req) => {
  const userId = getUserId(req);
  const profileId = req.user?.profileId;

  if (checkFallback()) {
    const parent =
      FallbackDb.findById('parents', profileId) ||
      FallbackDb.findOne('parents', { user: userId }) ||
      FallbackDb.findOne('parents', { email: req.user?.email });
    return (parent?.children || [])
      .map((childId) => enrichFallbackStudent(FallbackDb.findById('students', childId)))
      .filter(Boolean);
  }

  let parent = null;
  if (isValidObjectId(profileId)) {
    parent = await Parent.findById(profileId).populate('children');
  }
  if (!parent && isValidObjectId(userId)) {
    parent = await Parent.findOne({ user: userId }).populate('children');
  }
  return parent?.children || [];
};

export const matchesLearnerScope = (record, student) => {
  if (!record || !student) return false;

  const classMatches = matchesAny(
    [record.className, record.class, record.classId],
    [student.className, student.class, student.classId, student.classDetails?.name]
  );

  const recordSectionValues = [record.sectionName, record.section, record.sectionId];
  const sectionMatches =
    recordSectionValues.some(isAllSections) ||
    matchesAny(recordSectionValues, [student.sectionName, student.section, student.sectionId, student.sectionDetails?.name]);

  return classMatches && sectionMatches;
};

const teacherClassScopeMatch = (record, teacher) => {
  if (!record || !teacher) return false;
  const assignedClasses = teacher.classesAssigned || teacher.assignedClasses || [];
  const assignedSections = teacher.sectionsAssigned || teacher.assignedSections || [];
  if (!assignedClasses.length) return false;

  const classMatches = matchesAny([record.className, record.class, record.classId], assignedClasses);
  const sectionMatches =
    !assignedSections.length ||
    [record.sectionName, record.section, record.sectionId].some(isAllSections) ||
    matchesAny([record.sectionName, record.section, record.sectionId], assignedSections);

  return classMatches && sectionMatches;
};

export const filterRecordsForUser = async (req, records, { hideDraftForLearners = false } = {}) => {
  const role = getRole(req);
  const userId = getUserId(req);

  if (isAdminRole(role)) return records;

  if (isTeacherRole(role)) {
    const teacher = await getTeacherProfileForUser(req);
    const teacherId = getRecordId(teacher);
    return records.filter((record) => (
      same(record.createdBy, userId) ||
      same(record.teacherUser, userId) ||
      same(record.assignedByUser, userId) ||
      same(record.teacher, teacherId) ||
      same(record.assignedBy, teacherId) ||
      normalize(record.teacherName) === normalize(req.user?.name) ||
      teacherClassScopeMatch(record, teacher)
    ));
  }

  if (isStudentRole(role)) {
    const student = await getStudentProfileForUser(req);
    return records.filter((record) => {
      if (hideDraftForLearners && normalize(record.status) === 'draft') return false;
      return matchesLearnerScope(record, student);
    });
  }

  if (isParentRole(role)) {
    const children = await getParentChildrenForUser(req);
    return records.filter((record) => {
      if (hideDraftForLearners && normalize(record.status) === 'draft') return false;
      return children.some((child) => matchesLearnerScope(record, child));
    });
  }

  return [];
};

const classSectionMongoFilterForStudent = (student) => {
  if (!student) return { _id: null };
  const classValues = compact([student.className, student.class, student.classId]);
  const sectionValues = compact([student.sectionName, student.section, student.sectionId]);

  if (!classValues.length) return { _id: null };

  return {
    $and: [
      {
        $or: [
          { className: { $in: classValues } },
          { classId: { $in: classValues } },
        ],
      },
      {
        $or: [
          { sectionName: { $in: sectionValues } },
          { sectionId: { $in: sectionValues } },
          { sectionName: { $in: ['All Sections', 'All', ''] } },
          { sectionName: { $exists: false } },
          { sectionId: null },
          { sectionId: { $exists: false } },
        ],
      },
    ],
  };
};

export const buildScopedMongoFilter = async (
  req,
  {
    teacherField = 'teacher',
    teacherUserField = 'teacherUser',
    hideDraftForLearners = false,
  } = {}
) => {
  const role = getRole(req);
  const userId = getUserId(req);

  if (isAdminRole(role)) return {};

  if (isTeacherRole(role)) {
    const teacher = await getTeacherProfileForUser(req);
    const teacherId = getRecordId(teacher);
    const or = [
      { createdBy: userId },
      { [teacherUserField]: userId },
      { teacherName: req.user?.name },
    ];

    if (teacherId) or.push({ [teacherField]: teacherId });

    const assignedClasses = teacher?.classesAssigned || teacher?.assignedClasses || [];
    const assignedSections = teacher?.sectionsAssigned || teacher?.assignedSections || [];
    if (assignedClasses.length) {
      const classClause = {
        $or: [
          { className: { $in: assignedClasses } },
          { classId: { $in: assignedClasses } },
        ],
      };
      if (assignedSections.length) {
        or.push({
          $and: [
            classClause,
            {
              $or: [
                { sectionName: { $in: assignedSections } },
                { sectionId: { $in: assignedSections } },
                { sectionName: { $in: ['All Sections', 'All', ''] } },
                { sectionName: { $exists: false } },
                { sectionId: null },
              ],
            },
          ],
        });
      } else {
        or.push(classClause);
      }
    }

    return { $or: or.filter(Boolean) };
  }

  if (isStudentRole(role)) {
    const scoped = classSectionMongoFilterForStudent(await getStudentProfileForUser(req));
    if (!hideDraftForLearners) return scoped;
    return { $and: [scoped, { status: { $ne: 'draft' } }] };
  }

  if (isParentRole(role)) {
    const children = await getParentChildrenForUser(req);
    if (!children.length) return { _id: null };
    const scoped = { $or: children.map(classSectionMongoFilterForStudent) };
    if (!hideDraftForLearners) return scoped;
    return { $and: [scoped, { status: { $ne: 'draft' } }] };
  }

  return { _id: null };
};
