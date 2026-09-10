/**
 * @file teacher.tools.js
 * @description AI Tool definitions and executors for the Teachers module.
 */

import Teacher from '../../models/Teacher.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';
import { logActivity } from '../../utils/activityLogger.js';
import mongoose from 'mongoose';

export const teacherToolDefinitions = [
  {
    name: 'getTeachers',
    description:
      'List, search, or count teachers and staff. Use for "show all teachers", "find math teachers", "how many teachers are there?"',
    parameters: {
      type: 'object',
      properties: {
        search: {
          type: 'string',
          description: 'Search by name, email, or subject.',
        },
        department: {
          type: 'string',
          description: 'Filter by department.',
        },
        designation: {
          type: 'string',
          description: 'Filter by designation e.g. "Teacher", "Head Teacher", "HOD".',
        },
        countOnly: {
          type: 'boolean',
          description: 'If true, return only total count.',
        },
        limit: {
          type: 'number',
          description: 'Max records (default 15, max 50).',
        },
      },
    },
  },
  {
    name: 'getTeacherById',
    description: 'Get full profile of a specific teacher by ID.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Teacher MongoDB ID.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'createTeacher',
    description:
      'Create a new teacher record. Name and email are required. Ask user for missing required fields.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name (required).' },
        email: { type: 'string', description: 'Email address (required).' },
        phone: { type: 'string', description: 'Phone number.' },
        department: { type: 'string', description: 'Department e.g. "Science", "Mathematics".' },
        designation: { type: 'string', description: 'Role: "Teacher", "Head Teacher", "HOD", "Coordinator".' },
        subjects: {
          type: 'array',
          items: { type: 'string' },
          description: 'Subjects taught.',
        },
        qualification: { type: 'string', description: 'Educational qualification.' },
        experience: { type: 'number', description: 'Years of experience.' },
      },
      required: ['name', 'email'],
    },
  },
  {
    name: 'updateTeacher',
    description: 'Update an existing teacher\'s information.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Teacher MongoDB ID (required).' },
        name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        department: { type: 'string' },
        designation: { type: 'string' },
        qualification: { type: 'string' },
      },
      required: ['id'],
    },
  },
];

export const teacherToolExecutors = {
  async getTeachers(args, context) {
    const limit = Math.min(args.limit || 15, 50);

    if (checkFallback()) {
      let list = FallbackDb.find('teachers') || [];
      if (args.search) {
        const term = args.search.toLowerCase();
        list = list.filter((t) =>
          ['name', 'email', 'department', 'designation'].some((f) =>
            String(t[f] || '').toLowerCase().includes(term)
          )
        );
      }
      if (args.department) {
        list = list.filter((t) =>
          String(t.department || '').toLowerCase().includes(args.department.toLowerCase())
        );
      }
      if (args.designation) {
        list = list.filter((t) =>
          String(t.designation || '').toLowerCase().includes(args.designation.toLowerCase())
        );
      }
      if (args.countOnly) return { success: true, count: list.length };
      return {
        success: true,
        count: list.length,
        total: list.length,
        teachers: list.slice(0, limit).map(formatTeacher),
      };
    }

    const filter = {};
    if (args.search) {
      const regex = new RegExp(args.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: regex }, { email: regex }, { department: regex }];
    }
    if (args.department) filter.department = new RegExp(args.department, 'i');
    if (args.designation) filter.designation = new RegExp(args.designation, 'i');

    if (args.countOnly) {
      const count = await Teacher.countDocuments(filter);
      return { success: true, count };
    }

    const [teachers, total] = await Promise.all([
      Teacher.find(filter)
        .select('name email phone department designation subjects status qualification')
        .limit(limit)
        .sort({ createdAt: -1 }),
      Teacher.countDocuments(filter),
    ]);

    return {
      success: true,
      count: teachers.length,
      total,
      hasMore: total > limit,
      teachers: teachers.map(formatTeacher),
    };
  },

  async getTeacherById(args, context) {
    if (!args.id) return { success: false, error: 'Teacher ID is required.' };

    let teacher;
    if (checkFallback()) {
      teacher = FallbackDb.findById('teachers', args.id);
    } else {
      if (!mongoose.Types.ObjectId.isValid(args.id)) {
        return { success: false, error: 'Invalid teacher ID format.' };
      }
      teacher = await Teacher.findById(args.id).select('-__v');
    }

    if (!teacher) return { success: false, error: 'Teacher not found.' };
    return { success: true, teacher: formatTeacherDetail(teacher) };
  },

  async createTeacher(args, context) {
    if (!args.name) return { success: false, error: 'Teacher name is required.' };
    if (!args.email) return { success: false, error: 'Teacher email is required.' };

    const payload = {
      name: args.name.trim(),
      email: args.email.trim().toLowerCase(),
      phone: args.phone || '',
      department: args.department || 'General',
      designation: args.designation || 'Teacher',
      subjects: args.subjects || [],
      qualification: args.qualification || '',
      experience: args.experience || 0,
      status: 'active',
      role: 'teacher',
    };

    let teacher;
    if (checkFallback()) {
      teacher = FallbackDb.create('teachers', payload);
    } else {
      teacher = await Teacher.create(payload);
    }

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'CREATE',
      module: 'teachers',
      recordId: teacher._id || teacher.id,
      details: `AI created teacher: ${args.name}`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: `Teacher "${args.name}" created successfully.`,
      teacher: formatTeacherDetail(teacher),
    };
  },

  async updateTeacher(args, context) {
    if (!args.id) return { success: false, error: 'Teacher ID is required.' };

    const updates = {};
    const allowed = ['name', 'email', 'phone', 'department', 'designation', 'qualification', 'status'];
    for (const field of allowed) {
      if (args[field] !== undefined) updates[field] = args[field];
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, error: 'No fields provided to update.' };
    }

    let teacher;
    if (checkFallback()) {
      teacher = FallbackDb.update('teachers', args.id, updates);
    } else {
      teacher = await Teacher.findByIdAndUpdate(args.id, updates, { new: true });
    }

    if (!teacher) return { success: false, error: 'Teacher not found.' };

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'UPDATE',
      module: 'teachers',
      recordId: args.id,
      details: `AI updated teacher fields: ${Object.keys(updates).join(', ')}`,
      ipAddress: context.ip || 'AI',
    });

    return { success: true, message: 'Teacher updated.', teacher: formatTeacherDetail(teacher) };
  },
};

function formatTeacher(t) {
  return {
    id: t._id || t.id,
    name: t.name,
    email: t.email || '-',
    department: t.department || '-',
    designation: t.designation || 'Teacher',
    status: t.status || 'active',
  };
}

function formatTeacherDetail(t) {
  return {
    id: t._id || t.id,
    name: t.name,
    email: t.email || '-',
    phone: t.phone || '-',
    department: t.department || '-',
    designation: t.designation || 'Teacher',
    subjects: t.subjects || [],
    qualification: t.qualification || '-',
    experience: t.experience != null ? `${t.experience} years` : '-',
    status: t.status || 'active',
  };
}
