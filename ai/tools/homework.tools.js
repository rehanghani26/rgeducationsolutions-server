/**
 * @file homework.tools.js
 * @description AI Tool definitions and executors for the Homework module.
 */

import Homework from '../../models/Homework.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';
import { logActivity } from '../../utils/activityLogger.js';

export const homeworkToolDefinitions = [
  {
    name: 'getHomework',
    description:
      'List homework assignments. Filter by class, subject, or status.',
    parameters: {
      type: 'object',
      properties: {
        class: { type: 'string', description: 'Filter by class name.' },
        subject: { type: 'string', description: 'Filter by subject name.' },
        status: { type: 'string', description: '"pending", "submitted", "graded".' },
        limit: { type: 'number', description: 'Max records (default 15).' },
      },
    },
  },
  {
    name: 'createHomework',
    description:
      'Create a homework assignment. Title, class, and dueDate are required.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Homework title (required).' },
        class: { type: 'string', description: 'Target class (required).' },
        section: { type: 'string', description: 'Target section (optional).' },
        subject: { type: 'string', description: 'Subject name.' },
        description: { type: 'string', description: 'Homework description or instructions.' },
        dueDate: { type: 'string', description: 'Due date in YYYY-MM-DD format (required).' },
      },
      required: ['title', 'class', 'dueDate'],
    },
  },
];

export const homeworkToolExecutors = {
  async getHomework(args, context) {
    const limit = Math.min(args.limit || 15, 50);

    if (checkFallback()) {
      let list = FallbackDb.find('homework') || [];
      if (args.class) {
        list = list.filter((h) =>
          (h.class || h.className || '').toLowerCase().includes(args.class.toLowerCase())
        );
      }
      if (args.subject) {
        list = list.filter((h) =>
          (h.subject || h.subjectName || '').toLowerCase().includes(args.subject.toLowerCase())
        );
      }
      if (args.status) list = list.filter((h) => h.status === args.status);

      return {
        success: true,
        count: list.length,
        homework: list.slice(0, limit).map(formatHomework),
      };
    }

    const filter = {};
    if (args.class) filter.$or = [
      { class: new RegExp(args.class, 'i') },
      { className: new RegExp(args.class, 'i') },
    ];
    if (args.subject) filter.subject = new RegExp(args.subject, 'i');
    if (args.status) filter.status = args.status;

    const [homework, total] = await Promise.all([
      Homework.find(filter).sort({ dueDate: 1 }).limit(limit),
      Homework.countDocuments(filter),
    ]);

    return {
      success: true,
      count: homework.length,
      total,
      homework: homework.map(formatHomework),
    };
  },

  async createHomework(args, context) {
    if (!args.title) return { success: false, error: 'Homework title is required.' };
    if (!args.class) return { success: false, error: 'Target class is required.' };
    if (!args.dueDate) return { success: false, error: 'Due date is required.' };

    const dueDate = new Date(args.dueDate);
    if (isNaN(dueDate.getTime())) {
      return { success: false, error: `Invalid due date: "${args.dueDate}". Use YYYY-MM-DD.` };
    }

    const payload = {
      title: args.title.trim(),
      className: args.class,
      sectionName: args.section || 'All Sections',
      subject: args.subject || 'General',
      instructions: args.description || args.title.trim(),
      teacherName: context.user?.name || 'AI Assistant',
      dueDate,
      status: 'pending',
    };

    let hw;
    if (checkFallback()) {
      hw = FallbackDb.create('homework', payload);
    } else {
      hw = await Homework.create(payload);
    }

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'CREATE',
      module: 'homework',
      recordId: hw._id || hw.id,
      details: `AI created homework: ${args.title}`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: `Homework "${args.title}" created for ${args.class}.`,
      homework: formatHomework(hw),
    };
  },
};

function formatHomework(h) {
  return {
    id: h._id || h.id,
    title: h.title,
    class: h.className || h.class || '-',
    section: h.sectionName || h.section || 'All Sections',
    subject: h.subject || '-',
    dueDate: h.dueDate ? new Date(h.dueDate).toISOString().split('T')[0] : '-',
    status: h.status || 'pending',
    instructions: h.instructions || h.description || '',
  };
}
