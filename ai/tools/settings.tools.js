/**
 * @file settings.tools.js
 * @description AI Tool definitions and executors for School Settings & Class Syllabus (Books, Subjects, Curriculum).
 */

import Setting from '../../models/Setting.js';
import ClassSyllabus from '../../models/ClassSyllabus.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';
import { logActivity } from '../../utils/activityLogger.js';
import { getDefaultCurriculumForClass } from '../../controllers/syllabusController.js';

const normalizeClassId = (raw) => {
  if (!raw) return '';
  const str = String(raw).trim().toLowerCase();
  if (str.includes('nur')) return 'cls-nur';
  if (str.includes('lkg')) return 'cls-lkg';
  if (str.includes('ukg')) return 'cls-ukg';
  if (str.includes('passout')) return 'cls-passout';
  const num = str.match(/\d+/);
  if (num) return `cls-${num[0]}`;
  return str.replace(/\s+/g, '-');
};

export const settingsToolDefinitions = [
  {
    name: 'getSchoolSettings',
    description:
      'View school configuration and profile settings: school name, contact email, phone, address, academic year, and institution details.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'updateSchoolSettings',
    description:
      'Update school configuration details such as school name, contact email, phone number, address, or academic year.',
    parameters: {
      type: 'object',
      properties: {
        schoolName: { type: 'string', description: 'Official institution name.' },
        contactEmail: { type: 'string', description: 'Primary contact email.' },
        schoolPhone: { type: 'string', description: 'Contact phone number.' },
        addressLine1: { type: 'string', description: 'Primary school address.' },
        academicYear: { type: 'string', description: 'Current academic year e.g. "2026-2027".' },
        websiteUrl: { type: 'string', description: 'School official website URL.' },
      },
    },
  },
  {
    name: 'getClassSyllabus',
    description:
      'Get prescribed subjects, textbooks, authors, full marks, and pass marks for a specific class (e.g. "Class 1", "Class 10").',
    parameters: {
      type: 'object',
      properties: {
        className: {
          type: 'string',
          description: 'Class name or level e.g. "Class 1", "Class 10", "Nursery", "Class 12".',
        },
      },
      required: ['className'],
    },
  },
  {
    name: 'updateClassSyllabus',
    description:
      'Configure or update prescribed subjects and books for a class syllabus, including textbook name, max marks, and pass marks.',
    parameters: {
      type: 'object',
      properties: {
        className: { type: 'string', description: 'Target class name e.g. "Class 1", "Class 10" (required).' },
        subjects: {
          type: 'array',
          description: 'List of subjects and their prescribed textbooks.',
          items: {
            type: 'object',
            properties: {
              subjectName: { type: 'string', description: 'Subject name e.g. "English", "Mathematics" (required).' },
              bookName: { type: 'string', description: 'Prescribed book name e.g. "Our English", "Math Magic".' },
              author: { type: 'string', description: 'Book author or publisher.' },
              maxMarks: { type: 'number', description: 'Maximum marks (default 100).' },
              passMarks: { type: 'number', description: 'Passing marks (default 35).' },
            },
            required: ['subjectName'],
          },
        },
      },
      required: ['className', 'subjects'],
    },
  },
  {
    name: 'resetClassSyllabus',
    description:
      'Reset a class syllabus to the standard national curriculum default (NCERT/State board standard books and marks).',
    parameters: {
      type: 'object',
      properties: {
        className: { type: 'string', description: 'Target class to reset e.g. "Class 1", "Class 10".' },
      },
      required: ['className'],
    },
  },
];

export const settingsToolExecutors = {
  async getSchoolSettings(args, context) {
    if (checkFallback()) {
      const config = FallbackDb.getSettings() || {};
      return {
        success: true,
        settings: {
          schoolName: config.schoolName || 'RGES School & College ERP',
          contactEmail: config.contactEmail || 'admin@school.com',
          schoolPhone: config.schoolPhone || '+91 94314 26252',
          address: config.addressLine1 || 'Main Campus',
          academicYear: config.academicYear || '2026-2027',
          schoolType: config.schoolType || 'secondary',
          websiteUrl: config.websiteUrl || '',
        },
      };
    }

    let config = await Setting.findOne();
    if (!config) {
      config = await Setting.create({});
    }

    return {
      success: true,
      settings: {
        schoolName: config.schoolName || 'RGES School & College ERP',
        contactEmail: config.contactEmail || 'admin@school.com',
        schoolPhone: config.schoolPhone || '',
        address: config.addressLine1 || '',
        academicYear: config.academicYear || '2026-2027',
        schoolType: config.schoolType || 'secondary',
        websiteUrl: config.websiteUrl || '',
      },
    };
  },

  async updateSchoolSettings(args, context) {
    const updateData = {};
    if (args.schoolName) updateData.schoolName = args.schoolName.trim();
    if (args.contactEmail) updateData.contactEmail = args.contactEmail.trim();
    if (args.schoolPhone) updateData.schoolPhone = args.schoolPhone.trim();
    if (args.addressLine1) updateData.addressLine1 = args.addressLine1.trim();
    if (args.academicYear) updateData.academicYear = args.academicYear.trim();
    if (args.websiteUrl) updateData.websiteUrl = args.websiteUrl.trim();

    if (Object.keys(updateData).length === 0) {
      return { success: false, error: 'No update parameters provided.' };
    }

    let updated = null;
    if (checkFallback()) {
      updated = FallbackDb.updateSettings(updateData);
    } else {
      updated = await Setting.findOneAndUpdate({}, updateData, { new: true, upsert: true });
    }

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'UPDATE',
      module: 'settings',
      details: `AI updated school settings: ${Object.keys(updateData).join(', ')}`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: 'School settings updated successfully.',
      updatedFields: updateData,
    };
  },

  async getClassSyllabus(args, context) {
    const { className } = args;
    const normalized = normalizeClassId(className);

    if (checkFallback()) {
      const list = FallbackDb.find('syllabus') || [];
      const found = list.find(
        (s) =>
          normalizeClassId(s.classId) === normalized ||
          String(s.className || '').toLowerCase() === String(className).toLowerCase()
      );

      if (found) {
        return {
          success: true,
          isDefault: false,
          className: found.className,
          academicYear: found.academicYear,
          subjectCount: (found.subjects || []).length,
          subjects: (found.subjects || []).map((s) => ({
            subjectName: s.subjectName,
            bookName: s.bookName || 'Prescribed Text',
            author: s.author || '',
            publisher: s.publisher || '',
            maxMarks: s.maxMarks || 100,
            passMarks: s.passMarks || 35,
          })),
        };
      }

      const def = getDefaultCurriculumForClass(className);
      return {
        success: true,
        isDefault: true,
        className: def.className,
        academicYear: def.academicYear,
        subjectCount: def.subjects.length,
        subjects: def.subjects,
        note: 'Loaded default standard curriculum. Can be customized using updateClassSyllabus.',
      };
    }

    let syllabus = await ClassSyllabus.findOne({
      $or: [
        { classId: className },
        { classId: normalized },
        { className: new RegExp(`^${className}$`, 'i') },
      ],
    });

    if (!syllabus) {
      const def = getDefaultCurriculumForClass(className);
      return {
        success: true,
        isDefault: true,
        className: def.className,
        academicYear: def.academicYear,
        subjectCount: def.subjects.length,
        subjects: def.subjects,
        note: 'Loaded standard default curriculum.',
      };
    }

    return {
      success: true,
      isDefault: false,
      className: syllabus.className,
      academicYear: syllabus.academicYear,
      subjectCount: (syllabus.subjects || []).length,
      subjects: (syllabus.subjects || []).map((s) => ({
        subjectName: s.subjectName,
        bookName: s.bookName || 'Prescribed Text',
        author: s.author || '',
        publisher: s.publisher || '',
        maxMarks: s.maxMarks || 100,
        passMarks: s.passMarks || 35,
      })),
    };
  },

  async updateClassSyllabus(args, context) {
    const { className, subjects = [] } = args;
    const normalized = normalizeClassId(className);

    const formattedSubjects = subjects.map((s) => ({
      subjectName: s.subjectName,
      bookName: s.bookName || '',
      author: s.author || '',
      publisher: s.publisher || '',
      maxMarks: Number(s.maxMarks) || 100,
      passMarks: Number(s.passMarks) || 35,
    }));

    const yr = new Date().getFullYear();
    const payload = {
      classId: normalized,
      className: className.trim(),
      academicYear: `${yr}-${yr + 1}`,
      description: `Official Curriculum & Books for ${className}`,
      subjects: formattedSubjects,
    };

    if (checkFallback()) {
      const list = FallbackDb.find('syllabus') || [];
      const existing = list.find(
        (s) =>
          normalizeClassId(s.classId) === normalized ||
          String(s.className || '').toLowerCase() === String(className).toLowerCase()
      );

      if (existing) {
        FallbackDb.update('syllabus', existing.id || existing._id, payload);
      } else {
        FallbackDb.create('syllabus', payload);
      }
    } else {
      await ClassSyllabus.findOneAndUpdate(
        { $or: [{ classId: normalized }, { className: new RegExp(`^${className}$`, 'i') }] },
        payload,
        { upsert: true, new: true }
      );
    }

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'UPDATE',
      module: 'syllabus',
      details: `AI updated curriculum and books for ${className} with ${formattedSubjects.length} subjects`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: `Prescribed syllabus & books for "${className}" saved with ${formattedSubjects.length} subjects.`,
      subjects: formattedSubjects,
    };
  },

  async resetClassSyllabus(args, context) {
    const { className } = args;
    const defaultTemplate = getDefaultCurriculumForClass(className);
    const normalized = normalizeClassId(className);

    if (checkFallback()) {
      const list = FallbackDb.find('syllabus') || [];
      const existing = list.find(
        (s) =>
          normalizeClassId(s.classId) === normalized ||
          String(s.className || '').toLowerCase() === String(className).toLowerCase()
      );

      if (existing) {
        FallbackDb.update('syllabus', existing.id || existing._id, {
          subjects: defaultTemplate.subjects,
        });
      } else {
        FallbackDb.create('syllabus', defaultTemplate);
      }
    } else {
      await ClassSyllabus.findOneAndUpdate(
        { $or: [{ classId: normalized }, { className: new RegExp(`^${className}$`, 'i') }] },
        {
          classId: normalized,
          className: defaultTemplate.className,
          academicYear: defaultTemplate.academicYear,
          subjects: defaultTemplate.subjects,
        },
        { upsert: true, new: true }
      );
    }

    return {
      success: true,
      message: `Syllabus for "${defaultTemplate.className}" has been reset to standard curriculum defaults.`,
      subjectsCount: defaultTemplate.subjects.length,
      subjects: defaultTemplate.subjects,
    };
  },
};
