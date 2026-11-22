/**
 * @file timetable.tools.js
 * @description AI Tool definitions and executors for the Timetable module.
 */

import { listClassTimetables } from '../../services/masterPeriodService.js';
import { DAY_NAMES } from '../../constants/index.js';

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

const DAYS = DAY_NAMES;

export const timetableToolExecutors = {
  async getClassTimetable(args, context) {
    if (!args.class) return { success: false, error: 'Class name is required.' };

    const norm = (value) => String(value || '').trim().toLowerCase();
    const grade = (value) => norm(value).replace(/^class\s+/, '');
    const section = (value) => norm(value).replace(/^(section\s+|sec-)/, '');
    const matches = (await listClassTimetables(context)).filter((row) =>
      grade(row.className) === grade(args.class) && (!args.section || section(row.sectionName) === section(args.section)));
    if (!matches.length) return { success: false, error: 'No matching class timetable.' };
    let schedule = matches.flatMap((row) => (row.allocations || row.schedule || row.periods || []).map((p) => ({ ...p, section: row.sectionName })));
    if (args.day) {
      schedule = schedule.filter((p) =>
        (p.day || '').toLowerCase() === args.day.toLowerCase()
      );
    }

    return {
      success: true,
      class: matches[0].className,
      section: args.section || 'All',
      timetable: schedule.map((p) => ({
        day: p.day, section: p.section,
        period: p.periodOrder || p.period || p.periodNumber || '-',
        time: p.time || `${p.startTime || ''} - ${p.endTime || ''}`,
        subject: p.subject || p.subjectName || p.customLabel || p.periodType || '-',
        teacher: p.teacher || p.teacherName || '-',
      })),
    };
  },

  async getTodayTimetable(args, context) {
    const todayName = DAYS[new Date().getDay()];
    return timetableToolExecutors.getClassTimetable({ ...args, day: todayName }, context);
  },
};
