/**
 * @file online-class.tools.js
 * @description AI Tool definitions and executors for the Online Classes module.
 */

import OnlineClass from '../../models/OnlineClass.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';
import { logActivity } from '../../utils/activityLogger.js';

export const onlineClassToolDefinitions = [
  {
    name: 'getOnlineClasses',
    description: 'List online/virtual classes. Filter by status or class.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', description: '"scheduled", "live", "completed", "cancelled".' },
        class: { type: 'string', description: 'Filter by class name.' },
        limit: { type: 'number', description: 'Max records (default 10).' },
      },
    },
  },
  {
    name: 'createOnlineClass',
    description:
      'Create a new online class session. Class, subject, scheduledDate, startTime, and endTime are required.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Class session title (required).' },
        class: { type: 'string', description: 'Target class name (required).' },
        section: { type: 'string', description: 'Section (optional).' },
        subject: { type: 'string', description: 'Subject name (required).' },
        scheduledDate: { type: 'string', description: 'Date of class in YYYY-MM-DD format (required).' },
        startTime: { type: 'string', description: 'Start time e.g. "10:00 AM" or "10:00" (required).' },
        endTime: { type: 'string', description: 'End time e.g. "11:00 AM" or "11:00" (required).' },
        meetingLink: { type: 'string', description: 'Video call link (optional).' },
      },
      required: ['class', 'subject', 'scheduledDate', 'startTime', 'endTime'],
    },
  },
];

export const onlineClassToolExecutors = {
  async getOnlineClasses(args, context) {
    const limit = Math.min(args.limit || 10, 30);

    if (checkFallback()) {
      let list = FallbackDb.find('onlineclasses') || [];
      if (args.status) list = list.filter((o) => o.status === args.status);
      if (args.class) {
        list = list.filter((o) =>
          (o.className || o.class || '').toLowerCase().includes(args.class.toLowerCase())
        );
      }
      return {
        success: true,
        count: list.length,
        onlineClasses: list.slice(0, limit).map(formatOnlineClass),
      };
    }

    const filter = {};
    if (args.status) filter.status = args.status;
    if (args.class) filter.className = new RegExp(args.class, 'i');

    const [classes, total] = await Promise.all([
      OnlineClass.find(filter).sort({ scheduledDate: 1 }).limit(limit),
      OnlineClass.countDocuments(filter),
    ]);

    return {
      success: true,
      count: classes.length,
      total,
      onlineClasses: classes.map(formatOnlineClass),
    };
  },

  async createOnlineClass(args, context) {
    if (!args.class) return { success: false, error: 'Class is required.' };
    if (!args.subject) return { success: false, error: 'Subject is required.' };
    if (!args.scheduledDate) return { success: false, error: 'Scheduled date is required.' };
    if (!args.startTime) return { success: false, error: 'Start time is required.' };
    if (!args.endTime) return { success: false, error: 'End time is required.' };

    const scheduledDate = new Date(args.scheduledDate);
    if (isNaN(scheduledDate.getTime())) {
      return { success: false, error: `Invalid date: "${args.scheduledDate}". Use YYYY-MM-DD.` };
    }

    const payload = {
      title: args.title || `${args.subject} — ${args.class}`,
      className: args.class,
      sectionName: args.section || 'All Sections',
      subject: args.subject,
      scheduledDate,
      startTime: args.startTime,
      endTime: args.endTime,
      meetingLink: args.meetingLink || '',
      teacherName: context.user?.name || 'AI Assistant',
      status: 'scheduled',
    };

    let oc;
    if (checkFallback()) {
      oc = FallbackDb.create('onlineclasses', payload);
    } else {
      oc = await OnlineClass.create(payload);
    }

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'CREATE',
      module: 'online-classes',
      recordId: oc._id || oc.id,
      details: `AI created online class: ${payload.title}`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: `Online class "${payload.title}" scheduled for ${args.scheduledDate} at ${args.startTime}.`,
      onlineClass: formatOnlineClass(oc),
    };
  },
};

function formatOnlineClass(o) {
  return {
    id: o._id || o.id,
    title: o.title,
    class: o.className || '-',
    section: o.sectionName || 'All Sections',
    subject: o.subject || '-',
    scheduledDate: o.scheduledDate ? new Date(o.scheduledDate).toISOString().split('T')[0] : '-',
    startTime: o.startTime || '-',
    endTime: o.endTime || '-',
    status: o.status || 'scheduled',
    meetingLink: o.meetingLink || '-',
  };
}
