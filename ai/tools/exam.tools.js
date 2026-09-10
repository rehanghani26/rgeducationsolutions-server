/**
 * @file exam.tools.js
 * @description AI Tool definitions and executors for the Exams module.
 */

import Exam from '../../models/Exam.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';
import { logActivity } from '../../utils/activityLogger.js';

export const examToolDefinitions = [
  {
    name: 'getExams',
    description:
      'List, search, or filter exams. Use for "show upcoming exams", "list all exams", "exams in September".',
    parameters: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by status: "upcoming", "ongoing", "completed".',
        },
        search: {
          type: 'string',
          description: 'Search by exam name or term.',
        },
        limit: { type: 'number', description: 'Max records (default 15).' },
      },
    },
  },
  {
    name: 'createExam',
    description:
      'Create a new exam. Name, term, and date are required.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exam name e.g. "Mid-Term Exam 2026" (required).' },
        term: { type: 'string', description: 'Academic term e.g. "Term 1", "Annual" (required).' },
        date: { type: 'string', description: 'Exam date in YYYY-MM-DD format (required).' },
        status: {
          type: 'string',
          description: '"upcoming" | "ongoing" | "completed". Default: "upcoming".',
        },
      },
      required: ['name', 'term', 'date'],
    },
  },
];

export const examToolExecutors = {
  async getExams(args, context) {
    const limit = Math.min(args.limit || 15, 50);

    if (checkFallback()) {
      let list = FallbackDb.find('exams') || [];
      if (args.status) list = list.filter((e) => e.status === args.status);
      if (args.search) {
        const term = args.search.toLowerCase();
        list = list.filter((e) =>
          (e.name || '').toLowerCase().includes(term) || (e.term || '').toLowerCase().includes(term)
        );
      }
      return {
        success: true,
        count: list.length,
        exams: list.slice(0, limit).map(formatExam),
      };
    }

    const filter = {};
    if (args.status) filter.status = args.status;
    if (args.search) {
      const regex = new RegExp(args.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ name: regex }, { term: regex }];
    }

    const [exams, total] = await Promise.all([
      Exam.find(filter).sort({ date: 1 }).limit(limit),
      Exam.countDocuments(filter),
    ]);

    return {
      success: true,
      count: exams.length,
      total,
      exams: exams.map(formatExam),
    };
  },

  async createExam(args, context) {
    if (!args.name) return { success: false, error: 'Exam name is required.' };
    if (!args.term) return { success: false, error: 'Exam term is required.' };
    if (!args.date) return { success: false, error: 'Exam date is required.' };

    const dateObj = new Date(args.date);
    if (isNaN(dateObj.getTime())) {
      return { success: false, error: `Invalid date: "${args.date}". Use YYYY-MM-DD.` };
    }

    const payload = {
      name: args.name.trim(),
      term: args.term.trim(),
      date: dateObj,
      status: args.status || 'upcoming',
    };

    let exam;
    if (checkFallback()) {
      exam = FallbackDb.create('exams', payload);
    } else {
      exam = await Exam.create(payload);
    }

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'CREATE',
      module: 'exams',
      recordId: exam._id || exam.id,
      details: `AI created exam: ${args.name}`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: `Exam "${args.name}" created successfully.`,
      exam: formatExam(exam),
    };
  },
};

function formatExam(e) {
  return {
    id: e._id || e.id,
    name: e.name,
    term: e.term,
    date: e.date ? new Date(e.date).toISOString().split('T')[0] : '-',
    status: e.status || 'upcoming',
  };
}
