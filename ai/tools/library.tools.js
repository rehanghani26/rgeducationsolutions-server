/**
 * @file library.tools.js
 * @description AI Tool definitions and executors for the Library module (read-only).
 */

import Book from '../../models/Book.js';
import Library from '../../models/Library.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';

export const libraryToolDefinitions = [
  {
    name: 'getLibraryBooks',
    description: 'List books in the library. Search by title or author.',
    parameters: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Search by book title or author.' },
        limit: { type: 'number', description: 'Max records (default 15).' },
      },
    },
  },
  {
    name: 'getLibraryIssues',
    description: 'List issued books. Show currently issued or overdue books.',
    parameters: {
      type: 'object',
      properties: {
        overdueOnly: { type: 'boolean', description: 'If true, show only overdue (past return date).' },
        limit: { type: 'number', description: 'Max records (default 15).' },
      },
    },
  },
];

export const libraryToolExecutors = {
  async getLibraryBooks(args, context) {
    const limit = Math.min(args.limit || 15, 50);

    if (checkFallback()) {
      let list = FallbackDb.find('books') || [];
      if (args.search) {
        const term = args.search.toLowerCase();
        list = list.filter((b) =>
          (b.title || '').toLowerCase().includes(term) ||
          (b.author || '').toLowerCase().includes(term)
        );
      }
      return {
        success: true,
        count: list.length,
        books: list.slice(0, limit).map(formatBook),
      };
    }

    const filter = {};
    if (args.search) {
      const regex = new RegExp(args.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: regex }, { author: regex }];
    }

    const [books, total] = await Promise.all([
      Book.find(filter).limit(limit).sort({ title: 1 }),
      Book.countDocuments(filter),
    ]);

    return {
      success: true,
      count: books.length,
      total,
      books: books.map(formatBook),
    };
  },

  async getLibraryIssues(args, context) {
    const limit = Math.min(args.limit || 15, 50);
    const today = new Date();

    if (checkFallback()) {
      let list = (FallbackDb.find('library') || []).filter((l) => !l.returnDate);
      if (args.overdueOnly) {
        list = list.filter((l) => l.dueDate && new Date(l.dueDate) < today);
      }
      return {
        success: true,
        count: list.length,
        issues: list.slice(0, limit).map(formatIssue),
      };
    }

    const filter = { returnDate: null };
    if (args.overdueOnly) {
      filter.dueDate = { $lt: today };
    }

    const [issues, total] = await Promise.all([
      Library.find(filter).populate('bookId', 'title').limit(limit).sort({ dueDate: 1 }),
      Library.countDocuments(filter),
    ]);

    return {
      success: true,
      count: issues.length,
      total,
      issues: issues.map(formatIssue),
    };
  },
};

function formatBook(b) {
  return {
    id: b._id || b.id,
    title: b.title,
    author: b.author || '-',
    isbn: b.isbn || '-',
    quantity: b.quantity ?? '-',
  };
}

function formatIssue(l) {
  return {
    id: l._id || l.id,
    bookTitle: l.bookId?.title || l.bookTitle || '-',
    studentId: l.studentId || '-',
    issueDate: l.issueDate ? new Date(l.issueDate).toISOString().split('T')[0] : '-',
    dueDate: l.dueDate ? new Date(l.dueDate).toISOString().split('T')[0] : '-',
    isOverdue: l.dueDate ? new Date(l.dueDate) < new Date() : false,
  };
}
