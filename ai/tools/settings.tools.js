/**
 * @file settings.tools.js
 * @description AI Tool definitions and executors for School Settings & Class Syllabus (Books, Subjects, Curriculum).
 */

import Setting from '../../models/Setting.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';
import { logActivity } from '../../utils/activityLogger.js';
import { readPublishedSyllabuses } from '../../services/classSyllabusService.js';

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

  async getClassSyllabus({ className }, context) {
    const { syllabus } = await readPublishedSyllabuses({ user: context.user }, className);
    return { success: true, syllabus, ...(!syllabus && { message: 'No published syllabus for this class.' }) };
  },
};