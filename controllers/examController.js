// 3. Configuration
import { checkFallback } from '../config/db.js';

// 4. Models
import Exam from '../models/Exam.js';

// 6. Services
import { FallbackDb } from '../services/dbFallback.js';

// 7. Utilities
import { parsePagination, buildSearchFilter, paginateResult, paginateArray } from '../utils/paginateQuery.js';
import { logActivity, getRecordActivity } from '../utils/activityLogger.js';
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError
} from '../utils/responseUtil.js';

/**
 * Retrieves paginated exams with term and name search filters.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getExams = async (req, res) => {
  try {
    const { page, limit, skip, sort, search, status } = parsePagination(req.query);
    const searchFields = ['name', 'term'];

    if (checkFallback()) {
      const list = FallbackDb.find('exams') || [];
      const result = paginateArray(list, { page, limit, search, status, searchFields });
      return sendSuccess(res, undefined, { exams: result.data, ...result });
    }

    const filter = { ...buildSearchFilter(search, searchFields) };
    if (status) filter.status = status;

    const sortObj = {};
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith('-') ? -1 : 1;

    const [exams, total] = await Promise.all([
      Exam.find(filter).sort(sortObj).skip(skip).limit(limit),
      Exam.countDocuments(filter),
    ]);

    return sendSuccess(res, undefined, { exams, ...paginateResult(exams, total, { page, limit }) });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Retrieves a single examination record by ID.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getExamById = async (req, res) => {
  try {
    const { id } = req.params;
    const exam = checkFallback()
      ? FallbackDb.findById('exams', id)
      : await Exam.findById(id);

    if (!exam) return sendNotFound(res, 'Exam not found');
    return sendSuccess(res, undefined, { exam });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Retrieves activity logs for an examination.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getExamActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await getRecordActivity('exams', id);
    return sendSuccess(res, undefined, { logs, loginHistory: [] });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Creates a new examination schedule.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const createExam = async (req, res) => {
  try {
    const {
      name, term, date, endDate, status, session,
      classIds, classNames, subjectSchedule, subjects, classes,
      totalMarks, passMarks, duration, venue, supervisor, description,
    } = req.body;

    if (!name || !term || !date) {
      return sendBadRequest(res, 'Name, term, and date are required');
    }

    const examData = {
      name, term, date, status: status || 'upcoming',
      endDate, session, classIds, classNames,
      subjectSchedule, subjects, classes,
      totalMarks, passMarks, duration, venue, supervisor, description,
      createdBy: req.user?._id || req.user?.id,
    };

    let exam;
    if (checkFallback()) {
      exam = FallbackDb.create('exams', examData);
    } else {
      exam = await Exam.create(examData);
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CREATE',
      module: 'exams',
      recordId: exam.id || exam._id,
      details: `Created exam ${name}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendCreated(res, 'Exam created', { exam });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Updates an examination schedule.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const updateExam = async (req, res) => {
  try {
    const { id } = req.params;
    let exam;

    if (checkFallback()) {
      exam = FallbackDb.update('exams', id, req.body);
    } else {
      exam = await Exam.findByIdAndUpdate(id, req.body, { new: true });
    }

    if (!exam) return sendNotFound(res, 'Exam not found');

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'UPDATE',
      module: 'exams',
      recordId: id,
      details: `Updated exam ${exam.name}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, 'Exam updated', { exam });
  } catch (error) {
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Deletes an examination schedule.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const deleteExam = async (req, res) => {
  try {
    const { id } = req.params;
    let success = false;
    let examName = '';

    if (checkFallback()) {
      const exam = FallbackDb.findById('exams', id);
      if (exam) {
        examName = exam.name;
        success = FallbackDb.delete('exams', id);
      }
    } else {
      const exam = await Exam.findById(id);
      if (exam) {
        examName = exam.name;
        await Exam.findByIdAndDelete(id);
        success = true;
      }
    }

    if (!success) return sendNotFound(res, 'Exam not found');

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'DELETE',
      module: 'exams',
      recordId: id,
      details: `Deleted exam ${examName}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, 'Exam deleted');
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};
