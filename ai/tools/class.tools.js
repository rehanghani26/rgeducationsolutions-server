/**
 * @file class.tools.js
 * @description AI Tool definitions and executors for Classes, Sections, and Subjects.
 */

import Class from '../../models/Class.js';
import Section from '../../models/Section.js';
import Subject from '../../models/Subject.js';
import Student from '../../models/Student.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';

export const classToolDefinitions = [
  {
    name: 'getClasses',
    description: 'List all classes/grades configured in the school. Use for "show classes", "list all grades".',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'getSections',
    description: 'List all sections. Optionally filter by class.',
    parameters: {
      type: 'object',
      properties: {
        classId: { type: 'string', description: 'Filter sections by class ID.' },
        className: { type: 'string', description: 'Filter sections by class name.' },
      },
    },
  },
  {
    name: 'getSubjects',
    description: 'List all subjects offered in the school.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'getClassStudents',
    description:
      'Get students in a specific class and/or section. Use for "who are the students in class 5?" or "show class 10-A students".',
    parameters: {
      type: 'object',
      properties: {
        class: { type: 'string', description: 'Class name (required).' },
        section: { type: 'string', description: 'Section name (optional).' },
        countOnly: { type: 'boolean', description: 'Return only count if true.' },
      },
      required: ['class'],
    },
  },
];

export const classToolExecutors = {
  async getClasses(args, context) {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('classes') || [];
    } else {
      list = await Class.find().sort({ name: 1 });
    }

    return {
      success: true,
      count: list.length,
      classes: list.map((c) => ({
        id: c._id || c.id,
        name: c.name,
        code: c.code || '-',
        capacity: c.capacity || '-',
      })),
    };
  },

  async getSections(args, context) {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('sections') || [];
      if (args.className) {
        list = list.filter((s) =>
          (s.className || '').toLowerCase().includes(args.className.toLowerCase())
        );
      }
    } else {
      const filter = {};
      if (args.classId) filter.classId = args.classId;
      list = await Section.find(filter).populate('classId', 'name');
      if (args.className) {
        list = list.filter((s) =>
          (s.classId?.name || '').toLowerCase().includes(args.className.toLowerCase())
        );
      }
    }

    return {
      success: true,
      count: list.length,
      sections: list.map((s) => ({
        id: s._id || s.id,
        name: s.name,
        className: s.classId?.name || s.className || '-',
        capacity: s.capacity || '-',
      })),
    };
  },

  async getSubjects(args, context) {
    let list = [];
    if (checkFallback()) {
      list = FallbackDb.find('subjects') || [];
    } else {
      list = await Subject.find().sort({ name: 1 });
    }

    return {
      success: true,
      count: list.length,
      subjects: list.map((s) => ({
        id: s._id || s.id,
        name: s.name,
        code: s.code || '-',
      })),
    };
  },

  async getClassStudents(args, context) {
    if (!args.class) return { success: false, error: 'Class name is required.' };

    const classRegex = new RegExp(args.class.replace(/class\s*/i, '').trim(), 'i');
    const filter = { $or: [{ class: classRegex }, { className: classRegex }] };

    if (args.section) {
      filter.section = new RegExp(args.section, 'i');
    }

    if (args.countOnly) {
      const count = checkFallback()
        ? (FallbackDb.find('students') || []).filter((s) => {
            const match = classRegex.test(s.class || s.className || '');
            const secMatch = !args.section || new RegExp(args.section, 'i').test(s.section || '');
            return match && secMatch;
          }).length
        : await Student.countDocuments(filter);

      return { success: true, class: args.class, section: args.section, count };
    }

    let students = [];
    if (checkFallback()) {
      students = (FallbackDb.find('students') || []).filter((s) => {
        const match = classRegex.test(s.class || s.className || '');
        const secMatch = !args.section || new RegExp(args.section, 'i').test(s.section || '');
        return match && secMatch;
      });
    } else {
      students = await Student.find(filter)
        .select('name admissionNumber rollNumber class section status')
        .limit(50)
        .sort({ rollNumber: 1 });
    }

    return {
      success: true,
      class: args.class,
      section: args.section || 'All sections',
      count: students.length,
      students: students.map((s) => ({
        id: s._id || s.id,
        name: s.name,
        rollNumber: s.rollNumber || '-',
        admissionNumber: s.admissionNumber,
        section: s.section || '-',
        status: s.status || 'active',
      })),
    };
  },
};
