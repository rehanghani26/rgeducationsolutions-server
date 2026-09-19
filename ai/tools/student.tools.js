/**
 * @file student.tools.js
 * @description AI Tool definitions and executors for the Students module.
 *
 * These tools wrap the existing studentController logic via the same
 * service layer used by the REST API.
 */

import Student from '../../models/Student.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';
import { parsePagination, buildSearchFilter } from '../../utils/paginateQuery.js';
import { logActivity } from '../../utils/activityLogger.js';
import mongoose from 'mongoose';

// ─── Tool Definitions (schema for the AI model) ──────────────────────────────

export const studentToolDefinitions = [
  {
    name: 'getStudents',
    description:
      'List, search, or count students. Use for queries like "show all students", "find students in class 5", "how many students are there?", "search for Rahul".',
    parameters: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Search by name, roll number, or admission number.',
        },
        class: {
          type: 'string',
          description: 'Filter by class name (e.g., "Class 5", "10th", "5").',
        },
        section: {
          type: 'string',
          description: 'Filter by section (e.g., "A", "B").',
        },
        status: {
          type: 'string',
          description: 'Filter by status: "active", "inactive", "graduated".',
        },
        limit: {
          type: 'number',
          description: 'Max records to return (default 15, max 50).',
        },
        countOnly: {
          type: 'boolean',
          description: 'If true, returns only the total count (faster, cheaper). Use for "how many students" queries.',
        },
      },
    },
  },
  {
    name: 'getStudentById',
    description:
      'Get full profile details for a specific student by their database ID.',
    parameters: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Student MongoDB ID.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'createStudent',
    description:
      'Enroll a new student in the school. Requires name, class. Ask user for missing required fields before calling.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name of the student (required).' },
        class: { type: 'string', description: 'Class name e.g. "Class 5", "10th" (required).' },
        section: { type: 'string', description: 'Section e.g. "A", "B" (optional, default A).' },
        gender: { type: 'string', description: '"Male", "Female", or "Other".' },
        dob: { type: 'string', description: 'Date of birth in YYYY-MM-DD format.' },
        contactNumber: { type: 'string', description: "Student or parent contact number." },
        parentName: { type: 'string', description: "Parent or guardian name." },
        email: { type: 'string', description: "Student email address." },
        address: { type: 'string', description: "Residential address." },
        bloodGroup: { type: 'string', description: "Blood group e.g. A+, O-, B+." },
      },
      required: ['name', 'class'],
    },
  },
  {
    name: 'updateStudent',
    description:
      'Update an existing student\'s information. First search for the student, get their ID, then call this.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Student MongoDB ID (required).' },
        name: { type: 'string', description: 'New full name.' },
        class: { type: 'string', description: 'New class.' },
        section: { type: 'string', description: 'New section.' },
        contactNumber: { type: 'string', description: 'New contact number.' },
        parentName: { type: 'string', description: 'New parent name.' },
        email: { type: 'string', description: 'New email.' },
        address: { type: 'string', description: 'New address.' },
        status: { type: 'string', description: '"active" or "inactive".' },
      },
      required: ['id'],
    },
  },
  {
    name: 'deleteStudent',
    description:
      'Permanently delete a student record. IMPORTANT: Always confirm with the user before calling this.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Student MongoDB ID.' },
      },
      required: ['id'],
    },
  },
];

// ─── Tool Executors ───────────────────────────────────────────────────────────

export const studentToolExecutors = {
  async getStudents(args, context) {
    const limit = Math.min(args.limit || 15, 50);
    const searchFields = ['name', 'admissionNumber', 'rollNumber'];

    if (checkFallback()) {
      let list = FallbackDb.find('students') || [];
      if (args.search) {
        const term = args.search.toLowerCase();
        list = list.filter((s) =>
          searchFields.some((f) => String(s[f] || '').toLowerCase().includes(term))
        );
      }
      if (args.class) {
        const cls = args.class.toLowerCase().replace(/class\s*/i, '').trim();
        list = list.filter((s) =>
          String(s.class || s.className || '').toLowerCase().replace(/class\s*/i, '').trim() === cls
        );
      }
      if (args.section) {
        list = list.filter((s) =>
          String(s.section || s.sectionName || '').toLowerCase() === args.section.toLowerCase()
        );
      }
      if (args.status) {
        list = list.filter((s) => s.status === args.status);
      }
      const total = list.length;
      if (args.countOnly) return { success: true, count: total };
      return {
        success: true,
        count: list.length,
        total,
        students: list.slice(0, limit).map(formatStudent),
      };
    }

    // MongoDB path
    const conditions = [];

    if (args.search) {
      const regex = new RegExp(args.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const orClauses = [
        { name: regex },
        { admissionNumber: regex },
        { email: regex },
      ];
      const numVal = Number(args.search);
      if (!isNaN(numVal) && args.search.trim() !== '') {
        orClauses.push({ rollNumber: numVal });
      }
      conditions.push({ $or: orClauses });
    }

    if (args.class) {
      const cls = args.class.replace(/class\s*/i, '').trim();
      const classRegex = new RegExp(cls, 'i');
      conditions.push({
        $or: [
          { class: classRegex },
          { className: classRegex },
          { classId: classRegex },
        ],
      });
    }

    if (args.section) {
      const sec = args.section.replace(/section\s*/i, '').trim();
      const secRegex = new RegExp(`^${sec}$|^section\\s*${sec}$`, 'i');
      conditions.push({
        $or: [
          { section: secRegex },
          { sectionName: secRegex },
          { sectionId: secRegex },
        ],
      });
    }

    if (args.status) {
      conditions.push({ status: args.status });
    }

    const filter = conditions.length > 1
      ? { $and: conditions }
      : conditions.length === 1
      ? conditions[0]
      : {};

    if (args.countOnly) {
      const count = await Student.countDocuments(filter);
      return { success: true, count };
    }

    const [students, total] = await Promise.all([
      Student.find(filter)
        .select('name admissionNumber rollNumber class section status contactNumber email')
        .limit(limit)
        .sort({ createdAt: -1 }),
      Student.countDocuments(filter),
    ]);

    return {
      success: true,
      count: students.length,
      total,
      hasMore: total > limit,
      students: students.map(formatStudent),
    };
  },

  async getStudentById(args, context) {
    if (!args.id) return { success: false, error: 'Student ID is required.' };

    let student;
    if (checkFallback()) {
      student = FallbackDb.findById('students', args.id);
    } else {
      if (!mongoose.Types.ObjectId.isValid(args.id)) {
        return { success: false, error: 'Invalid student ID format.' };
      }
      student = await Student.findById(args.id).select(
        '-__v -promotionHistory -documents'
      );
    }

    if (!student) return { success: false, error: 'Student not found.' };
    return { success: true, student: formatStudentDetail(student) };
  },

  async createStudent(args, context) {
    if (!args.name) return { success: false, error: 'Student name is required.' };
    if (!args.class) return { success: false, error: 'Class is required.' };

    const year = new Date().getFullYear();
    const month = new Date().getMonth();
    const academicYear = month >= 3
      ? `${year}-${String(year + 1).slice(-2)}`
      : `${year - 1}-${String(year).slice(-2)}`;

    // Generate unique admission number
    const prefix = `STD-${year}-`;
    const pattern = new RegExp(`^STD-${year}-\\d{4}$`);
    let lastNum = 0;

    if (!checkFallback()) {
      const last = await Student.findOne({ admissionNumber: pattern })
        .sort({ admissionNumber: -1 })
        .select('admissionNumber');
      if (last?.admissionNumber) {
        lastNum = Number(last.admissionNumber.replace(prefix, '')) || 0;
      }
    } else {
      const existing = FallbackDb.find('students')
        .map((s) => s.admissionNumber)
        .filter((id) => pattern.test(id || ''))
        .map((id) => Number(id.replace(prefix, '')))
        .filter((n) => !isNaN(n));
      lastNum = existing.length ? Math.max(...existing) : 0;
    }

    const admissionNumber = `${prefix}${String(lastNum + 1).padStart(4, '0')}`;

    const payload = {
      name: args.name.trim(),
      class: args.class,
      className: args.class,
      section: args.section || 'A',
      sectionName: args.section || 'A',
      gender: capitalize(args.gender) || 'Male',
      dob: args.dob ? new Date(args.dob) : undefined,
      contactNumber: args.contactNumber || '',
      parentName: args.parentName || '',
      email: args.email || '',
      address: args.address || '',
      bloodGroup: args.bloodGroup || '',
      admissionNumber,
      academicYear,
      status: 'active',
      role: 'student',
    };

    let student;
    if (checkFallback()) {
      student = FallbackDb.create('students', payload);
    } else {
      student = await Student.create(payload);
    }

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'CREATE',
      module: 'students',
      recordId: student._id || student.id,
      details: `AI created student: ${args.name}`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: `Student "${args.name}" enrolled successfully.`,
      student: formatStudentDetail(student),
    };
  },

  async updateStudent(args, context) {
    if (!args.id) return { success: false, error: 'Student ID is required.' };

    const updates = {};
    const allowed = ['name', 'class', 'section', 'contactNumber', 'parentName', 'email', 'address', 'status', 'gender', 'bloodGroup'];
    for (const field of allowed) {
      if (args[field] !== undefined) updates[field] = args[field];
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'No fields provided to update.' };
    }

    let student;
    if (checkFallback()) {
      student = FallbackDb.update('students', args.id, updates);
    } else {
      if (!mongoose.Types.ObjectId.isValid(args.id)) {
        return { success: false, error: 'Invalid student ID.' };
      }
      student = await Student.findByIdAndUpdate(args.id, updates, { new: true });
    }

    if (!student) return { success: false, error: 'Student not found.' };

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'UPDATE',
      module: 'students',
      recordId: args.id,
      details: `AI updated student fields: ${Object.keys(updates).join(', ')}`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: `Student updated successfully.`,
      student: formatStudentDetail(student),
    };
  },

  async deleteStudent(args, context) {
    if (!args.id) return { success: false, error: 'Student ID is required.' };

    let student;
    if (checkFallback()) {
      student = FallbackDb.findById('students', args.id);
      if (student) FallbackDb.delete('students', args.id);
    } else {
      if (!mongoose.Types.ObjectId.isValid(args.id)) {
        return { success: false, error: 'Invalid student ID.' };
      }
      student = await Student.findByIdAndDelete(args.id);
    }

    if (!student) return { success: false, error: 'Student not found.' };

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'DELETE',
      module: 'students',
      recordId: args.id,
      details: `AI deleted student: ${student.name}`,
      ipAddress: context.ip || 'AI',
    });

    return { success: true, message: `Student "${student.name}" has been deleted.` };
  },
};

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatStudent(s) {
  return {
    id: s._id || s.id,
    name: s.name,
    admissionNumber: s.admissionNumber,
    rollNumber: s.rollNumber || '-',
    class: s.class || s.className || '-',
    section: s.section || s.sectionName || '-',
    status: s.status || 'active',
    contactNumber: s.contactNumber || '-',
  };
}

function formatStudentDetail(s) {
  return {
    id: s._id || s.id,
    name: s.name,
    admissionNumber: s.admissionNumber,
    rollNumber: s.rollNumber || '-',
    class: s.class || s.className || '-',
    section: s.section || s.sectionName || '-',
    gender: s.gender || '-',
    dob: s.dob ? new Date(s.dob).toISOString().split('T')[0] : '-',
    contactNumber: s.contactNumber || '-',
    email: s.email || '-',
    parentName: s.parentName || '-',
    parentContact: s.parentContact || '-',
    address: s.address || '-',
    bloodGroup: s.bloodGroup || '-',
    status: s.status || 'active',
    academicYear: s.academicYear || '-',
  };
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}
