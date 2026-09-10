/**
 * @file timetable.tools.js
 * @description AI Tool definitions and executors for the Timetable module.
 */

import ClassTimetable from '../../models/ClassTimetable.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';

export const timetableToolDefinitions = [
  {
    name: 'getClassTimetable',
    description:
      'Get the timetable for a specific class. Use for "class 5 timetable", "show schedule for 10-A".',
    parameters: {
      type: 'object',
      properties: {
        class: { type: 'string', description: 'Class name (required).' },
        section: { type: 'string', description: 'Section name (optional).' },
        day: { type: 'string', description: 'Day of week e.g. "Monday". Leave empty for full week.' },
      },
      required: ['class'],
    },
  },
  {
    name: 'getTodayTimetable',
    description: 'Get today\'s timetable for a class.',
    parameters: {
      type: 'object',
      properties: {
        class: { type: 'string', description: 'Class name (required).' },
        section: { type: 'string', description: 'Section name (optional).' },
      },
      required: ['class'],
    },
  },
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const timetableToolExecutors = {
  async getClassTimetable(args, context) {
    if (!args.class) return { success: false, error: 'Class name is required.' };

    if (checkFallback()) {
      const list = FallbackDb.find('classtimetables') || [];
      const tt = list.find((t) =>
        (t.className || t.class || '').toLowerCase().includes(args.class.toLowerCase())
      );
      if (!tt) {
        return {
          success: false,
          error: `No timetable found for ${args.class}. It may not have been set up yet.`,
        };
      }
      return { success: true, class: args.class, timetable: tt.schedule || tt };
    }

    const filter = {
      $or: [
        { className: new RegExp(args.class.replace(/class\s*/i, '').trim(), 'i') },
        { 'classId.name': new RegExp(args.class, 'i') },
      ],
    };
    if (args.section) filter.section = new RegExp(args.section, 'i');

    const tt = await ClassTimetable.findOne(filter).populate('classId', 'name');

    if (!tt) {
      return {
        success: false,
        error: `No timetable found for ${args.class}. It may not have been configured yet.`,
      };
    }

    let schedule = tt.schedule || tt.periods || [];
    if (args.day) {
      schedule = schedule.filter((p) =>
        (p.day || '').toLowerCase() === args.day.toLowerCase()
      );
    }

    return {
      success: true,
      class: tt.className || args.class,
      section: tt.section || args.section || 'All',
      timetable: schedule.map((p) => ({
        day: p.day,
        period: p.period || p.periodNumber || '-',
        time: p.time || `${p.startTime || ''} - ${p.endTime || ''}`,
        subject: p.subject || p.subjectName || '-',
        teacher: p.teacher || p.teacherName || '-',
      })),
    };
  },

  async getTodayTimetable(args, context) {
    const todayName = DAYS[new Date().getDay()];
    return timetableToolExecutors.getClassTimetable({ ...args, day: todayName }, context);
  },
};
