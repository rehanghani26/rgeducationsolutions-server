/**
 * @file notice.tools.js
 * @description AI Tool definitions and executors for Notices/Announcements.
 */

import Notice from '../../models/Notice.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';
import { logActivity } from '../../utils/activityLogger.js';

export const noticeToolDefinitions = [
  {
    name: 'getNotices',
    description:
      'List announcements and notices. Use for "show announcements", "recent notices".',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search by title or content.' },
        limit: { type: 'number', description: 'Max records (default 10).' },
      },
    },
  },
  {
    name: 'createNotice',
    description:
      'Create a new notice or announcement. Title and content are required.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Notice title (required).' },
        content: { type: 'string', description: 'Notice content/message (required).' },
        category: {
          type: 'string',
          description: 'Category: "General", "Academic", "Event", "Holiday", "Exam", "Fee". Default: "General".',
        },
        priority: {
          type: 'string',
          description: '"low", "medium", "high". Default: "medium".',
        },
      },
      required: ['title', 'content'],
    },
  },
];

export const noticeToolExecutors = {
  async getNotices(args, context) {
    const limit = Math.min(args.limit || 10, 30);

    if (checkFallback()) {
      let list = FallbackDb.find('notices') || [];
      if (args.search) {
        const term = args.search.toLowerCase();
        list = list.filter((n) =>
          (n.title || '').toLowerCase().includes(term) ||
          (n.content || '').toLowerCase().includes(term)
        );
      }
      return {
        success: true,
        count: list.length,
        notices: list.slice(0, limit).map(formatNotice),
      };
    }

    const filter = {};
    if (args.search) {
      const regex = new RegExp(args.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: regex }, { content: regex }];
    }

    const [notices, total] = await Promise.all([
      Notice.find(filter).sort({ createdAt: -1 }).limit(limit),
      Notice.countDocuments(filter),
    ]);

    return {
      success: true,
      count: notices.length,
      total,
      notices: notices.map(formatNotice),
    };
  },

  async createNotice(args, context) {
    if (!args.title) return { success: false, error: 'Notice title is required.' };
    if (!args.content) return { success: false, error: 'Notice content is required.' };

    const payload = {
      title: args.title.trim(),
      content: args.content.trim(),
      category: args.category || 'General',
      priority: args.priority || 'medium',
      author: context.user?.name || context.user?.username || 'AI Assistant',
    };

    let notice;
    if (checkFallback()) {
      notice = FallbackDb.create('notices', payload);
    } else {
      notice = await Notice.create(payload);
    }

    await logActivity({
      userId: context.user?._id || context.user?.id,
      action: 'CREATE',
      module: 'notices',
      recordId: notice._id || notice.id,
      details: `AI created notice: ${args.title}`,
      ipAddress: context.ip || 'AI',
    });

    return {
      success: true,
      message: `Notice "${args.title}" published successfully.`,
      notice: formatNotice(notice),
    };
  },
};

function formatNotice(n) {
  return {
    id: n._id || n.id,
    title: n.title,
    content: n.content?.slice(0, 200) + (n.content?.length > 200 ? '...' : ''),
    category: n.category || 'General',
    priority: n.priority || 'medium',
    author: n.author || 'Administration',
    createdAt: n.createdAt ? new Date(n.createdAt).toISOString().split('T')[0] : '-',
  };
}
