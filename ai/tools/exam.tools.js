/**
 * @file exam.tools.js
 * @description AI Tool definitions and executors for the Exams module.
 */

import Exam from '../../models/Exam.js';
import ClassSyllabus from '../../models/ClassSyllabus.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';
import { logActivity } from '../../utils/activityLogger.js';

export const examToolDefinitions = [
  {
    name: 'getExams',
    description:
      'List, search, or filter exams. Use for queries like "show upcoming exams", "list all exams", "find mid-term exam".',
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
    name: 'getExamDetails',
    description:
      'Get full details of a specific exam by ID or name, including its subject schedule, textbooks, classes, and dates.',
    parameters: {
      type: 'object',
      properties: {
        examId: { type: 'string', description: 'Exam ID or exact name.' },
      },
      required: ['examId'],
    },
  },
  {
    name: 'createExam',
    description:
      'Create a new examination schedule. Name, term, and date are required. Can optionally include target class and subjects.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Exam name e.g. "Mid-Term Examination 2026-27" (required).' },
        term: { type: 'string', description: 'Academic term e.g. "Term 1", "Mid Term", "Annual" (required).' },
        date: { type: 'string', description: 'Exam start date in YYYY-MM-DD format (required).' },
        class: { type: 'string', description: 'Target class e.g. "Class 10" or "Class 12 - Section A".' },
        session: { type: 'string', description: 'Academic session e.g. "2026-2027".' },
        status: {
          type: 'string',
          description: '"upcoming" | "ongoing" | "completed". Default: "upcoming".',
        },
      },
      required: ['name', 'term', 'date'],
    },
  },
  {
    name: 'scheduleExamSubject',
    description:
      'Add or update a subject paper in an exam schedule, including book/textbook name, date, timings, max marks, and pass marks.',
    parameters: {
      type: 'object',
      properties: {
        examId: { type: 'string', description: 'The exam ID or name.' },
        subjectName: { type: 'string', description: 'Subject name e.g. "English", "Mathematics" (required).' },
        bookName: { type: 'string', description: 'Textbook prescribed e.g. "Our English", "Math Magic".' },
        date: { type: 'string', description: 'Exam date for this subject (YYYY-MM-DD).' },
        startTime: { type: 'string', description: 'Start time e.g. "09:00 AM".' },
        endTime: { type: 'string', description: 'End time e.g. "12:00 PM".' },
        maxMarks: { type: 'number', description: 'Full marks (default 100).' },
        passMarks: { type: 'number', description: 'Passing marks (default 35).' },
      },
      required: ['examId', 'subjectName'],
    },
  },
  {
    name: 'updateExamStatus',
    description:
      'Update the status of an exam to "upcoming", "ongoing", or "completed".',
    parameters: {
      type: 'object',
      properties: {
        examId: { type: 'string', description: 'The exam ID or name.' },
        status: {
          type: 'string',
          description: '"upcoming" | "ongoing" | "completed".',
        },
      },
      required: ['examId', 'status'],
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

  async getExamDetails(args, context) {
    const { examId } = args;
    let exam = null;

    if (checkFallback()) {
      exam = FallbackDb.findById('exams', examId) ||
        (FallbackDb.find('exams') || []).find((e) =>
          e.name?.toLowerCase() === examId.toLowerCase() || e._id === examId
        );
    } else {
      exam = await Exam.findById(examId).catch(() => null);
      if (!exam) {
        exam = await Exam.findOne({ name: new RegExp(`^${examId}$`, 'i') });
      }
    }

    if (!exam) {
      return { success: false, error: `Exam "${examId}" not found.` };
    }

    return {
      success: true,
      exam: {
        id: exam._id || exam.id,
        name: exam.name,
        term: exam.term,
        date: exam.date ? new Date(exam.date).toISOString().split('T')[0] : '-',
        status: exam.status || 'upcoming',
        classes: exam.classes || [],
        session: exam.session || '2026-2027',
        subjectSchedule: (exam.subjectSchedule || []).map((s) => ({
          subjectName: s.subjectName,
          bookName: s.bookName || 'Standard Textbook',
          date: s.date ? new Date(s.date).toISOString().split('T')[0] : '-',
          startTime: s.startTime || '09:00 AM',
          endTime: s.endTime || '12:00 PM',
          maxMarks: s.maxMarks || 100,
          passMarks: s.passMarks || 35,
        })),
      },
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
      classes: args.class ? [args.class.trim()] : [],
      session: args.session || `${new Date().getFullYear()}-${new Date().getFullYear() + 1}`,
      status: args.status || 'upcoming',
      subjectSchedule: [],
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
      message: `Exam "${args.name}" scheduled successfully.`,
      exam: formatExam(exam),
    };
  },

  async scheduleExamSubject(args, context) {
    const { examId, subjectName, bookName, date, startTime, endTime, maxMarks, passMarks } = args;

    let exam = null;
    if (checkFallback()) {
      exam = FallbackDb.findById('exams', examId) ||
        (FallbackDb.find('exams') || []).find((e) => e.name?.toLowerCase() === examId.toLowerCase());
      if (!exam) return { success: false, error: `Exam "${examId}" not found.` };

      const schedule = exam.subjectSchedule || [];
      const existingIdx = schedule.findIndex(
        (s) => s.subjectName?.toLowerCase() === subjectName.toLowerCase()
      );

      const paperObj = {
        subjectName,
        bookName: bookName || '',
        date: date ? new Date(date) : new Date(),
        startTime: startTime || '09:00 AM',
        endTime: endTime || '12:00 PM',
        maxMarks: Number(maxMarks) || 100,
        passMarks: Number(passMarks) || 35,
      };

      if (existingIdx >= 0) schedule[existingIdx] = paperObj;
      else schedule.push(paperObj);

      FallbackDb.update('exams', exam.id || exam._id, { subjectSchedule: schedule });
    } else {
      exam = await Exam.findById(examId).catch(() => null);
      if (!exam) exam = await Exam.findOne({ name: new RegExp(`^${examId}$`, 'i') });
      if (!exam) return { success: false, error: `Exam "${examId}" not found.` };

      const schedule = exam.subjectSchedule || [];
      const existingIdx = schedule.findIndex(
        (s) => s.subjectName?.toLowerCase() === subjectName.toLowerCase()
      );

      const paperObj = {
        subjectName,
        bookName: bookName || '',
        date: date ? new Date(date) : new Date(),
        startTime: startTime || '09:00 AM',
        endTime: endTime || '12:00 PM',
        maxMarks: Number(maxMarks) || 100,
        passMarks: Number(passMarks) || 35,
      };

      if (existingIdx >= 0) schedule[existingIdx] = paperObj;
      else schedule.push(paperObj);

      exam.subjectSchedule = schedule;
      await exam.save();
    }

    return {
      success: true,
      message: `Paper for "${subjectName}" (${bookName || 'Standard'}) added to exam schedule successfully.`,
      subject: { subjectName, bookName, maxMarks: maxMarks || 100, passMarks: passMarks || 35 },
    };
  },

  async updateExamStatus(args, context) {
    const { examId, status } = args;
    const allowed = ['upcoming', 'ongoing', 'completed'];
    if (!allowed.includes(status)) {
      return { success: false, error: `Invalid status "${status}". Allowed: ${allowed.join(', ')}.` };
    }

    let exam = null;
    if (checkFallback()) {
      exam = FallbackDb.findById('exams', examId) ||
        (FallbackDb.find('exams') || []).find((e) => e.name?.toLowerCase() === examId.toLowerCase());
      if (!exam) return { success: false, error: `Exam "${examId}" not found.` };
      FallbackDb.update('exams', exam.id || exam._id, { status });
    } else {
      exam = await Exam.findById(examId).catch(() => null);
      if (!exam) exam = await Exam.findOne({ name: new RegExp(`^${examId}$`, 'i') });
      if (!exam) return { success: false, error: `Exam "${examId}" not found.` };
      exam.status = status;
      await exam.save();
    }

    return {
      success: true,
      message: `Exam status updated to "${status}".`,
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
    classes: e.classes || [],
    subjectCount: e.subjectSchedule?.length || (e.subjects?.length || 0),
  };
}
