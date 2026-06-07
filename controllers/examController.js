import Exam from '../models/Exam.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';
import { parsePagination, buildSearchFilter, paginateResult, paginateArray } from '../utils/paginateQuery.js';
import { logActivity, getRecordActivity } from '../utils/activityLogger.js';

export const getExams = async (req, res) => {
  try {
    const { page, limit, skip, sort, search, status } = parsePagination(req.query);
    const searchFields = ['name', 'term'];

    if (checkFallback()) {
      const list = FallbackDb.find('exams') || [];
      const result = paginateArray(list, { page, limit, search, status, searchFields });
      return res.json({ success: true, exams: result.data, ...result });
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

    return res.json({ success: true, exams, ...paginateResult(exams, total, { page, limit }) });
  } catch (error) {
    console.error('getExams error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getExamById = async (req, res) => {
  try {
    const { id } = req.params;
    const exam = checkFallback()
      ? FallbackDb.findById('exams', id)
      : await Exam.findById(id);

    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });
    return res.json({ success: true, exam });
  } catch (error) {
    console.error('getExamById error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getExamActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await getRecordActivity('exams', id);
    return res.json({ success: true, logs, loginHistory: [] });
  } catch (error) {
    console.error('getExamActivity error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createExam = async (req, res) => {
  try {
    const { name, term, date, status } = req.body;
    if (!name || !term || !date) {
      return res.status(400).json({ success: false, message: 'Name, term, and date are required' });
    }

    let exam;
    if (checkFallback()) {
      exam = FallbackDb.create('exams', { name, term, date, status: status || 'upcoming' });
    } else {
      exam = await Exam.create({ name, term, date, status: status || 'upcoming' });
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

    return res.status(201).json({ success: true, message: 'Exam created', exam });
  } catch (error) {
    console.error('createExam error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

export const updateExam = async (req, res) => {
  try {
    const { id } = req.params;
    let exam;

    if (checkFallback()) {
      exam = FallbackDb.update('exams', id, req.body);
    } else {
      exam = await Exam.findByIdAndUpdate(id, req.body, { new: true });
    }

    if (!exam) return res.status(404).json({ success: false, message: 'Exam not found' });

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'UPDATE',
      module: 'exams',
      recordId: id,
      details: `Updated exam ${exam.name}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ success: true, message: 'Exam updated', exam });
  } catch (error) {
    console.error('updateExam error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

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

    if (!success) return res.status(404).json({ success: false, message: 'Exam not found' });

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'DELETE',
      module: 'exams',
      recordId: id,
      details: `Deleted exam ${examName}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ success: true, message: 'Exam deleted' });
  } catch (error) {
    console.error('deleteExam error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};
