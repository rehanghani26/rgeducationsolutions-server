// 3. Configuration
import { checkFallback } from '../config/db.js';

// 4. Models
import Result from '../models/Result.js';
import Exam from '../models/Exam.js';
import Student from '../models/Student.js';

// 6. Services
import { FallbackDb } from '../services/dbFallback.js';

// 7. Utilities
import { parsePagination, paginateResult, paginateArray } from '../utils/paginateQuery.js';
import { logActivity } from '../utils/activityLogger.js';
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendForbidden,
  sendError
} from '../utils/responseUtil.js';

/**
 * Calculates grade and grade points for an individual subject score.
 *
 * @param {number} obtained - Marks obtained.
 * @param {number} maxMarks - Total marks for the subject.
 * @returns {{ grade: string, gradePoint: number }} Calculated grade object.
 */
const subjectGrade = (obtained, maxMarks) => {
  const pct = maxMarks > 0 ? (obtained / maxMarks) * 100 : 0;
  if (pct >= 91) return { grade: 'A+', gradePoint: 10.0 };
  if (pct >= 81) return { grade: 'A', gradePoint: 9.0 };
  if (pct >= 71) return { grade: 'B+', gradePoint: 8.0 };
  if (pct >= 61) return { grade: 'B', gradePoint: 7.0 };
  if (pct >= 51) return { grade: 'C+', gradePoint: 6.0 };
  if (pct >= 41) return { grade: 'C', gradePoint: 5.0 };
  if (pct >= 33) return { grade: 'D', gradePoint: 4.0 };
  return { grade: 'F', gradePoint: 0.0 };
};

/**
 * Computes aggregated scores, GPA, percentage, and passing status across all subject marks.
 *
 * @param {Array<Object>} marks - Subject mark records.
 * @returns {Object} Computed aggregate metrics.
 */
const computeResultTotals = (marks) => {
  let totalObtained = 0;
  let totalMaxMarks = 0;
  const failedSubjects = [];

  const enrichedMarks = marks.map((m) => {
    const { grade, gradePoint } = subjectGrade(m.obtained, m.maxMarks);
    const isPassed = m.obtained >= (m.passMarks || Math.floor(m.maxMarks * 0.33));
    if (!isPassed) failedSubjects.push(m.subjectName);
    totalObtained += m.obtained;
    totalMaxMarks += m.maxMarks;
    return { ...m, bookName: m.bookName || '', grade, gradePoint, isPassed };
  });

  const percentage = totalMaxMarks > 0 ? parseFloat(((totalObtained / totalMaxMarks) * 100).toFixed(2)) : 0;
  const { grade, gpa } = Result.calcGrade ? Result.calcGrade(percentage) : { grade: percentage >= 33 ? 'D' : 'F', gpa: 0 };
  const isPassed = failedSubjects.length === 0;

  return { enrichedMarks, totalObtained, totalMaxMarks, percentage, grade, gpa, isPassed, failedSubjects };
};

/**
 * Recomputes student rank order within a classroom for an examination.
 *
 * @param {string} examId - Examination ID.
 * @param {string} classId - Classroom or class code ID.
 * @returns {Promise<void>}
 */
const recomputeRanks = async (examId, classId) => {
  try {
    const results = await Result.find({ examId, classId }).sort({ percentage: -1 });
    const updates = results.map((r, i) =>
      Result.updateOne({ _id: r._id }, { $set: { rank: i + 1 } })
    );
    await Promise.all(updates);
  } catch (err) {
    console.error('recomputeRanks error:', err);
  }
};

/**
 * Retrieves paginated examination results with multi-attribute filtering.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getResults = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { examId, classId, studentId, status } = req.query;

    if (checkFallback()) {
      const list = FallbackDb.find('results') || [];
      const result = paginateArray(list, { page, limit });
      return sendSuccess(res, undefined, { results: result.data, pagination: result.pagination });
    }

    const filter = {};
    if (examId) filter.examId = examId;
    if (classId) filter.classId = classId;
    if (studentId) filter.studentId = studentId;
    if (status) filter.status = status;

    const [results, total] = await Promise.all([
      Result.find(filter).sort({ rank: 1, percentage: -1 }).skip(skip).limit(limit),
      Result.countDocuments(filter),
    ]);

    return sendSuccess(res, undefined, { results, ...paginateResult(results, total, { page, limit }) });
  } catch (err) {
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Retrieves historical exam results for a specific student.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getStudentResults = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { status } = req.query;

    if (checkFallback()) {
      return sendSuccess(res, undefined, { results: [] });
    }

    const filter = { studentId };
    if (req.user?.role === 'student') filter.status = 'published';
    else if (status) filter.status = status;

    const results = await Result.find(filter)
      .sort({ createdAt: -1 })
      .populate('examId', 'name term session date');

    return sendSuccess(res, undefined, { results });
  } catch (err) {
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Retrieves a student's result for a specific examination.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getStudentExamResult = async (req, res) => {
  try {
    const { examId, studentId } = req.params;

    if (checkFallback()) {
      return sendSuccess(res, undefined, { result: null });
    }

    const result = await Result.findOne({ examId, studentId })
      .populate('examId', 'name term session date subjectSchedule');

    if (!result) return sendNotFound(res, 'Result not found');
    if (req.user?.role === 'student' && result.status !== 'published') {
      return sendForbidden(res, 'Result not published yet');
    }

    return sendSuccess(res, undefined, { result });
  } catch (err) {
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Retrieves class result sheet and student completion status for an examination.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getClassResults = async (req, res) => {
  try {
    const { examId, classId } = req.params;
    const { status, section } = req.query;

    let targetClassStr = classId ? String(classId).trim() : '';
    let targetSecStr = section && section !== 'all' && section !== 'All' ? String(section).trim() : null;

    if (targetClassStr && targetClassStr.includes('-')) {
      const parts = targetClassStr.split(/\s*[-–—|]\s*/);
      if (parts.length >= 2) {
        targetClassStr = parts[0].trim();
        if (!targetSecStr) {
          targetSecStr = parts[1].trim();
        }
      }
    }

    if (checkFallback()) {
      const allResults = FallbackDb.find('results') || [];
      const exam = FallbackDb.findById('exams', examId) || null;
      let results = allResults.filter((r) => String(r.examId) === String(examId));
      if (targetClassStr) {
        results = results.filter((r) =>
          String(r.classId) === String(classId) ||
          String(r.classId) === String(targetClassStr) ||
          String(r.className) === String(classId) ||
          String(r.className) === String(targetClassStr) ||
          String(r.class) === String(targetClassStr)
        );
      }
      if (targetSecStr) {
        results = results.filter((r) => String(r.section || '').toLowerCase() === String(targetSecStr).toLowerCase());
      }
      if (status) {
        results = results.filter((r) => r.status === status);
      }

      const allFallbackStudents = FallbackDb.find('students') || [];
      const filteredStudents = allFallbackStudents.filter((s) => {
        const matchesClass = !targetClassStr ||
          String(s.classId) === String(classId) ||
          String(s.classId) === String(targetClassStr) ||
          String(s.class) === String(targetClassStr) ||
          String(s.className) === String(targetClassStr) ||
          String(s.className || '').toLowerCase().startsWith(targetClassStr.toLowerCase());
        const matchesSection = !targetSecStr || String(s.section || '').toLowerCase() === String(targetSecStr).toLowerCase();
        return matchesClass && matchesSection;
      }).map((s) => ({
        _id: s.id || s._id,
        name: s.name || `${s.firstName || ''} ${s.lastName || ''}`.trim() || 'Student',
        rollNumber: s.rollNumber,
        admissionNumber: s.admissionNumber || s.id,
        email: s.email || '',
        section: s.section || 'Section A',
      }));

      const existingIds = results.map((r) => String(r.studentId));
      const studentsWithoutResult = filteredStudents.filter((s) => !existingIds.includes(String(s._id)));

      return sendSuccess(res, undefined, {
        results,
        exam,
        allStudents: filteredStudents,
        studentsWithoutResult,
      });
    }

    const filter = { examId };
    if (targetClassStr) {
      filter.$or = [
        { classId },
        { className: classId },
        { classId: targetClassStr },
        { className: targetClassStr },
        { class: targetClassStr },
      ];
    }
    if (targetSecStr) {
      const secVal = targetSecStr.replace(/section\s*/i, '').trim();
      filter.section = new RegExp(`^${secVal}$|^${targetSecStr}$`, 'i');
    }
    if (status) filter.status = status;

    const [results, exam] = await Promise.all([
      Result.find(filter).sort({ rank: 1, percentage: -1 }),
      Exam.findById(examId),
    ]);

    const studentFilter = {
      status: { $in: ['active', 'Active', undefined] },
    };
    if (targetClassStr) {
      studentFilter.$or = [
        { classId },
        { className: classId },
        { classId: targetClassStr },
        { className: targetClassStr },
        { class: targetClassStr },
        { className: new RegExp(`^${targetClassStr}$`, 'i') },
        { className: new RegExp(`^${targetClassStr}\\b`, 'i') },
        { class: new RegExp(`^${targetClassStr}\\b`, 'i') },
      ];
    }
    if (targetSecStr) {
      const secVal = targetSecStr.replace(/section\s*/i, '').trim();
      studentFilter.section = new RegExp(`^${secVal}$|^${targetSecStr}$`, 'i');
    }

    const allStudents = await Student.find(studentFilter)
      .select('name firstName lastName admissionNumber rollNumber email section class className classId avatar')
      .sort({ rollNumber: 1, name: 1 });

    const existingStudentIds = results.map((r) => r.studentId?.toString());
    const studentsWithoutResult = allStudents.filter(
      (s) => !existingStudentIds.includes(s._id.toString())
    );

    return sendSuccess(res, undefined, { results, exam, allStudents, studentsWithoutResult });
  } catch (err) {
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Retrieves aggregate analytical performance metrics for an exam.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getExamStats = async (req, res) => {
  try {
    const { examId } = req.params;
    const { classId } = req.query;

    if (checkFallback()) {
      return sendSuccess(res, undefined, { stats: {} });
    }

    const filter = { examId, status: 'published' };
    if (classId) filter.classId = classId;

    const results = await Result.find(filter);
    if (!results.length) return sendSuccess(res, undefined, { stats: { total: 0 } });

    const total = results.length;
    const passed = results.filter((r) => r.isPassed).length;
    const failed = total - passed;
    const avgPercentage = parseFloat((results.reduce((s, r) => s + r.percentage, 0) / total).toFixed(2));
    const toppers = results.sort((a, b) => b.percentage - a.percentage).slice(0, 5).map((r) => ({
      studentName: r.studentName,
      admissionNumber: r.admissionNumber,
      percentage: r.percentage,
      grade: r.grade,
      rank: r.rank,
    }));

    const gradeDistribution = results.reduce((acc, r) => {
      acc[r.grade] = (acc[r.grade] || 0) + 1;
      return acc;
    }, {});

    return sendSuccess(res, undefined, {
      stats: { total, passed, failed, passPercentage: parseFloat(((passed / total) * 100).toFixed(1)), avgPercentage, toppers, gradeDistribution },
    });
  } catch (err) {
    return sendError(res, 'Server error', 500, err);
  }
};

/**
 * Bulk upserts student marks and triggers rank recomputation.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const bulkUpsertResults = async (req, res) => {
  try {
    const { examId, classId, className, section, resultsData } = req.body;

    if (!examId || !classId || !resultsData?.length) {
      return sendBadRequest(res, 'examId, classId, and resultsData are required');
    }

    if (checkFallback()) {
      return sendSuccess(res, 'Results saved (fallback mode)', { saved: resultsData.length });
    }

    const exam = await Exam.findById(examId);
    if (!exam) return sendNotFound(res, 'Exam not found');

    const savedResults = [];

    for (const entry of resultsData) {
      const { enrichedMarks, totalObtained, totalMaxMarks, percentage, grade, gpa, isPassed, failedSubjects } = computeResultTotals(entry.marks || []);

      const resultData = {
        examId,
        examName: exam.name,
        examTerm: exam.term,
        examSession: exam.session,
        studentId: entry.studentId,
        studentName: entry.studentName,
        studentEmail: entry.studentEmail || entry.email || '',
        admissionNumber: entry.admissionNumber,
        rollNumber: entry.rollNumber,
        classId,
        className: className || entry.className,
        section: section || entry.section,
        marks: enrichedMarks,
        totalObtained,
        totalMaxMarks,
        percentage,
        grade,
        gpa,
        isPassed,
        failedSubjects,
        remarks: entry.remarks || '',
        status: 'draft',
        uploadedBy: req.user?._id || req.user?.id,
      };

      const saved = await Result.findOneAndUpdate(
        { examId, studentId: entry.studentId },
        { $set: resultData },
        { upsert: true, new: true }
      );
      savedResults.push(saved);
    }

    await recomputeRanks(examId, classId);

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CREATE',
      module: 'results',
      recordId: examId,
      details: `Uploaded results for ${savedResults.length} students — ${exam.name}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendCreated(res, `Results saved for ${savedResults.length} students (draft)`, {
      saved: savedResults.length,
    });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Publishes draft examination results making them visible to students and parents.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const publishResults = async (req, res) => {
  try {
    const { examId, classId } = req.params;
    const { section } = req.query;

    if (checkFallback()) {
      const allResults = FallbackDb.find('results') || [];
      allResults.forEach((r) => {
        if (String(r.examId) === String(examId) && (String(r.classId) === String(classId) || String(r.className) === String(classId))) {
          if (!section || section === 'all' || String(r.section).toLowerCase() === String(section).toLowerCase()) {
            r.status = 'published';
            r.publishedAt = new Date().toISOString();
          }
        }
      });
      return sendSuccess(res, 'Results published successfully');
    }

    const filter = {
      examId,
      $or: [{ classId }, { className: classId }],
      status: 'draft',
    };
    if (section && section !== 'all' && section !== 'All') {
      const secVal = section.replace(/section\s*/i, '').trim();
      filter.section = new RegExp(`^${secVal}$|^${section}$`, 'i');
    }

    const updated = await Result.updateMany(
      filter,
      {
        $set: {
          status: 'published',
          publishedAt: new Date(),
          publishedBy: req.user?._id || req.user?.id,
        },
      }
    );

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'UPDATE',
      module: 'results',
      recordId: examId,
      details: `Published results for class ${classId} — ${updated.modifiedCount} students`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, `Published ${updated.modifiedCount} results`, { published: updated.modifiedCount });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Updates an individual student's examination result record.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const updateResult = async (req, res) => {
  try {
    const { id } = req.params;

    if (checkFallback()) {
      return sendSuccess(res, 'Result updated (fallback)');
    }

    const existing = await Result.findById(id);
    if (!existing) return sendNotFound(res, 'Result not found');

    const marks = req.body.marks || existing.marks;
    const { enrichedMarks, totalObtained, totalMaxMarks, percentage, grade, gpa, isPassed, failedSubjects } = computeResultTotals(marks);

    const result = await Result.findByIdAndUpdate(
      id,
      {
        $set: {
          marks: enrichedMarks,
          totalObtained, totalMaxMarks, percentage, grade, gpa, isPassed, failedSubjects,
          remarks: req.body.remarks ?? existing.remarks,
        },
      },
      { new: true }
    );

    await recomputeRanks(existing.examId, existing.classId);

    return sendSuccess(res, 'Result updated', { result });
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};

/**
 * Deletes an individual student's examination result record.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const deleteResult = async (req, res) => {
  try {
    const { id } = req.params;

    if (checkFallback()) {
      return sendSuccess(res, 'Result deleted (fallback)');
    }

    const result = await Result.findByIdAndDelete(id);
    if (!result) return sendNotFound(res, 'Result not found');

    return sendSuccess(res, 'Result deleted');
  } catch (err) {
    return sendError(res, err.message || 'Server error', 500, err);
  }
};
