import mongoose from 'mongoose';
import Homework from '../models/Homework.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';
import { parsePagination, buildSearchFilter, paginateResult } from '../utils/paginateQuery.js';
import { logActivity, getRecordActivity } from '../utils/activityLogger.js';
import {
  buildScopedMongoFilter,
  filterRecordsForUser,
  getRecordId,
  getRole,
  getStudentProfileForUser,
  getTeacherProfileForUser,
  getUserId,
  isAdminRole,
  isTeacherRole,
} from '../utils/learningScope.js';

// ─── Seed Data ────────────────────────────────────────────────────────────────
const HOMEWORK_SEED = [
  {
    id: 'hw-1',
    _id: 'hw-1',
    title: 'Linear Equations Practice Set',
    subject: 'Mathematics',
    instructions: 'Complete problems 1–25 from Chapter 4. Show all working steps. Diagrams must be drawn neatly with a ruler.',
    className: 'Class 10',
    sectionName: 'Section A',
    teacherName: 'Severus Snape',
    issueDate: '2026-09-03',
    dueDate: '2026-09-07',
    totalMarks: 25,
    priority: 'high',
    status: 'published',
    attachments: [{ title: 'Chapter 4 Reference Sheet', url: 'https://school.local/resources/ch4-ref.pdf', type: 'document' }],
    submissions: [],
  },
  {
    id: 'hw-2',
    _id: 'hw-2',
    title: 'Photosynthesis Lab Report',
    subject: 'Science',
    instructions: 'Write a full lab report (min. 600 words) on the photosynthesis experiment conducted on Sep 2nd. Include hypothesis, observations, results, and conclusion.',
    className: 'Class 10',
    sectionName: 'Section A',
    teacherName: 'Filius Flitwick',
    issueDate: '2026-09-02',
    dueDate: '2026-09-10',
    totalMarks: 20,
    priority: 'normal',
    status: 'published',
    attachments: [],
    submissions: [],
  },
  {
    id: 'hw-3',
    _id: 'hw-3',
    title: 'History Essay: Industrial Revolution',
    subject: 'History',
    instructions: 'Write a 500-word analytical essay on the social impact of the Industrial Revolution. Use at least 3 cited sources.',
    className: 'Class 11',
    sectionName: 'All Sections',
    teacherName: 'Filius Flitwick',
    issueDate: '2026-09-01',
    dueDate: '2026-09-06',
    totalMarks: 30,
    priority: 'high',
    status: 'published',
    attachments: [],
    submissions: [],
  },
];

const seedFallbackHomework = () => {
  const current = FallbackDb.find('homework') || [];
  if (current.length) return current;
  HOMEWORK_SEED.forEach((item) => FallbackDb.create('homework', item));
  return FallbackDb.find('homework') || [];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const dateOnly = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const sortRecords = (items, sort = '-dueDate') => {
  const desc = sort.startsWith('-');
  const field = desc ? sort.slice(1) : sort;
  return [...items].sort((a, b) => {
    const left = a[field] || '';
    const right = b[field] || '';
    const result = new Date(left).getTime() - new Date(right).getTime();
    if (!Number.isNaN(result)) return desc ? -result : result;
    return desc
      ? String(right).localeCompare(String(left))
      : String(left).localeCompare(String(right));
  });
};

const applyFallbackFilters = (items, query) => {
  const { search = '', status = '', priority = '', className = '', sectionName = '' } = query;
  let filtered = [...items];

  if (search) {
    const term = normalizeText(search);
    filtered = filtered.filter((item) =>
      ['title', 'subject', 'teacherName', 'className', 'sectionName', 'instructions']
        .some((field) => normalizeText(item[field]).includes(term))
    );
  }
  if (status) filtered = filtered.filter((item) => normalizeText(item.status) === normalizeText(status));
  if (priority) filtered = filtered.filter((item) => normalizeText(item.priority) === normalizeText(priority));
  if (className) filtered = filtered.filter((item) => normalizeText(item.className) === normalizeText(className));
  if (sectionName) filtered = filtered.filter((item) => normalizeText(item.sectionName) === normalizeText(sectionName));
  return filtered;
};

const buildHomeworkStats = (items) => {
  const now = new Date();
  const soon = new Date(now);
  soon.setDate(soon.getDate() + 3);
  return {
    total: items.length,
    assigned: items.filter((item) => ['published', 'closed'].includes(normalizeText(item.status))).length,
    dueSoon: items.filter((item) => {
      const due = new Date(item.dueDate);
      return due >= now && due <= soon;
    }).length,
    submitted: items.reduce((sum, item) => sum + (item.submissions?.length || 0), 0),
    graded: items.reduce((sum, item) =>
      sum + (item.submissions?.filter((s) => ['graded', 'returned'].includes(normalizeText(s.status))).length || 0), 0),
    pendingReview: items.reduce((sum, item) =>
      sum + (item.submissions?.filter((s) => ['submitted', 'late'].includes(normalizeText(s.status))).length || 0), 0),
  };
};

const buildMongoQueryFilter = async (req, query) => {
  const scopedFilter = await buildScopedMongoFilter(req, {
    teacherField: 'assignedBy',
    teacherUserField: 'assignedByUser',
    hideDraftForLearners: true,
  });
  const filters = [];
  if (Object.keys(scopedFilter).length) filters.push(scopedFilter);

  const search = (query.search || '').trim();
  if (search) filters.push(buildSearchFilter(search, ['title', 'subject', 'teacherName', 'className', 'sectionName']));
  if (query.status) filters.push({ status: query.status });
  if (query.priority) filters.push({ priority: query.priority });
  if (query.className) filters.push({ className: query.className });
  if (query.sectionName) filters.push({ sectionName: query.sectionName });

  return {
    scopedFilter,
    filter: filters.length ? { $and: filters } : {},
  };
};

const cleanAttachments = (attachments = []) => (
  Array.isArray(attachments)
    ? attachments
        .filter((item) => item?.title || item?.url)
        .map((item) => ({
          title: item.title || item.url,
          url: item.url || '',
          type: item.type || 'link',
        }))
    : []
);

const buildPayload = async (req, data, { partial = false } = {}) => {
  const role = getRole(req);
  const teacher = isTeacherRole(role) ? await getTeacherProfileForUser(req) : null;
  const userId = getUserId(req);

  if (partial) {
    const payload = {};
    const set = (key, value) => { if (value !== undefined) payload[key] = value; };

    set('title', data.title);
    set('subject', data.subject);
    set('instructions', data.instructions);
    if (data.className !== undefined || data.class !== undefined) set('className', data.className || data.class);
    if (data.sectionName !== undefined || data.section !== undefined) set('sectionName', data.sectionName || data.section || 'All Sections');
    set('classId', data.classId);
    set('sectionId', data.sectionId);
    set('assignedBy', data.assignedBy);
    set('assignedByUser', data.assignedByUser);
    set('teacherName', data.teacherName);
    set('dueDate', data.dueDate);
    set('issueDate', data.issueDate);
    if (data.totalMarks !== undefined) set('totalMarks', Number(data.totalMarks) || 10);
    set('priority', data.priority);
    set('status', data.status);
    if (data.attachments !== undefined) set('attachments', cleanAttachments(data.attachments));
    payload.updatedBy = userId;
    return payload;
  }

  return {
    title: data.title,
    subject: data.subject,
    instructions: data.instructions || '',
    classId: data.classId || null,
    className: data.className || data.class || '',
    sectionId: data.sectionId || null,
    sectionName: data.sectionName || data.section || 'All Sections',
    assignedBy: data.assignedBy || getRecordId(teacher) || null,
    assignedByUser: data.assignedByUser || (isTeacherRole(role) ? userId : null),
    teacherName: data.teacherName || teacher?.name || req.user?.name || 'Faculty',
    dueDate: data.dueDate,
    issueDate: data.issueDate || new Date().toISOString().slice(0, 10),
    totalMarks: Number(data.totalMarks) || 10,
    priority: data.priority || 'normal',
    status: data.status || 'published',
    attachments: cleanAttachments(data.attachments),
    updatedBy: userId,
  };
};

const validatePayload = (payload) => {
  const required = ['title', 'subject', 'instructions', 'className', 'dueDate'];
  const missing = required.filter((field) => !payload[field]);
  return missing.length ? `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required` : '';
};

const requireVisibleRecord = async (req, record) => {
  const role = getRole(req);
  if (!record) return false;
  if (isAdminRole(role)) return true;
  const visible = await filterRecordsForUser(req, [record], { hideDraftForLearners: true });
  return visible.length > 0;
};

// ─── Controllers ─────────────────────────────────────────────────────────────

export const getHomework = async (req, res) => {
  try {
    const { page, limit, skip, sort } = parsePagination(req.query);

    if (checkFallback()) {
      const scoped = await filterRecordsForUser(req, seedFallbackHomework(), { hideDraftForLearners: true });
      const filtered = applyFallbackFilters(scoped, req.query);
      const ordered = sortRecords(filtered, sort);
      const data = ordered.slice((page - 1) * limit, page * limit);
      return res.json({
        success: true,
        homework: data,
        stats: buildHomeworkStats(filtered),
        ...paginateResult(data, filtered.length, { page, limit }),
      });
    }

    const { filter, scopedFilter } = await buildMongoQueryFilter(req, req.query);
    const sortObj = {};
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith('-') ? -1 : 1;

    const now = new Date();
    const soonEnd = new Date(now);
    soonEnd.setDate(soonEnd.getDate() + 3);

    const [homework, total, statsCounts] = await Promise.all([
      Homework.find(filter).sort(sortObj).skip(skip).limit(limit),
      Homework.countDocuments(filter),
      Promise.all([
        Homework.countDocuments({ ...scopedFilter, status: { $in: ['published', 'closed'] } }),
        Homework.countDocuments({ ...scopedFilter, dueDate: { $gte: now, $lte: soonEnd } }),
      ]),
    ]);

    const allForStats = await Homework.find(scopedFilter);
    const stats = {
      total: statsCounts[0],
      dueSoon: statsCounts[1],
      submitted: allForStats.reduce((sum, h) => sum + (h.submissions?.length || 0), 0),
      graded: allForStats.reduce((sum, h) =>
        sum + (h.submissions?.filter((s) => ['graded', 'returned'].includes(s.status)).length || 0), 0),
      pendingReview: allForStats.reduce((sum, h) =>
        sum + (h.submissions?.filter((s) => ['submitted', 'late'].includes(s.status)).length || 0), 0),
    };

    return res.json({
      success: true,
      homework,
      stats,
      ...paginateResult(homework, total, { page, limit }),
    });
  } catch (error) {
    console.error('getHomework error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getHomeworkById = async (req, res) => {
  try {
    const { id } = req.params;
    let homework = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      homework = FallbackDb.findById('homework', id);
      if (!(await requireVisibleRecord(req, homework))) {
        return res.status(404).json({ success: false, message: 'Homework not found' });
      }
    } else {
      const scoped = await buildScopedMongoFilter(req, {
        teacherField: 'assignedBy',
        teacherUserField: 'assignedByUser',
        hideDraftForLearners: true,
      });
      homework = await Homework.findOne(Object.keys(scoped).length ? { $and: [{ _id: id }, scoped] } : { _id: id });
    }

    if (!homework) return res.status(404).json({ success: false, message: 'Homework not found' });
    return res.json({ success: true, homework });
  } catch (error) {
    console.error('getHomeworkById error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getHomeworkActivity = async (req, res) => {
  try {
    const logs = await getRecordActivity('homework', req.params.id);
    return res.json({ success: true, logs });
  } catch (error) {
    console.error('getHomeworkActivity error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createHomework = async (req, res) => {
  try {
    const payload = await buildPayload(req, req.body);
    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    payload.createdBy = getUserId(req);

    const homework = checkFallback()
      ? FallbackDb.create('homework', payload)
      : await Homework.create(payload);

    await logActivity({
      userId: getUserId(req),
      action: 'CREATE',
      module: 'homework',
      recordId: getRecordId(homework),
      details: `Created homework assignment "${payload.title}"`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({ success: true, message: 'Homework created', homework });
  } catch (error) {
    console.error('createHomework error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

export const updateHomework = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = await buildPayload(req, req.body, { partial: true });
    Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

    let current = null;
    let homework = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      current = FallbackDb.findById('homework', id);
      if (!(await requireVisibleRecord(req, current))) {
        return res.status(404).json({ success: false, message: 'Homework not found' });
      }
      homework = FallbackDb.update('homework', id, payload);
    } else {
      const scoped = await buildScopedMongoFilter(req, {
        teacherField: 'assignedBy',
        teacherUserField: 'assignedByUser',
      });
      current = await Homework.findOne(Object.keys(scoped).length ? { $and: [{ _id: id }, scoped] } : { _id: id });
      if (!current) return res.status(404).json({ success: false, message: 'Homework not found' });
      homework = await Homework.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
    }

    await logActivity({
      userId: getUserId(req),
      action: 'UPDATE',
      module: 'homework',
      recordId: id,
      details: `Updated homework "${homework?.title || id}"`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ success: true, message: 'Homework updated', homework });
  } catch (error) {
    console.error('updateHomework error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

export const deleteHomework = async (req, res) => {
  try {
    const { id } = req.params;
    let deleted = false;
    let title = id;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      const record = FallbackDb.findById('homework', id);
      title = record?.title || id;
      deleted = FallbackDb.delete('homework', id);
    } else {
      const record = await Homework.findById(id);
      title = record?.title || id;
      if (record) {
        await Homework.findByIdAndDelete(id);
        deleted = true;
      }
    }

    if (!deleted) return res.status(404).json({ success: false, message: 'Homework not found' });

    await logActivity({
      userId: getUserId(req),
      action: 'DELETE',
      module: 'homework',
      recordId: id,
      details: `Deleted homework "${title}"`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ success: true, message: 'Homework deleted' });
  } catch (error) {
    console.error('deleteHomework error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const submitHomework = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await getStudentProfileForUser(req);
    if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });

    const { content = '', attachments = [] } = req.body;

    const submissionData = {
      student: mongoose.Types.ObjectId.isValid(String(getRecordId(student))) ? getRecordId(student) : undefined,
      studentId: String(getRecordId(student)),
      studentName: student.name || req.user?.name,
      admissionNumber: student.admissionNumber,
      content,
      attachments: cleanAttachments(attachments),
      submittedAt: new Date(),
      status: 'submitted',
    };

    let homework = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      homework = FallbackDb.findById('homework', id);
      if (!(await requireVisibleRecord(req, homework))) {
        return res.status(404).json({ success: false, message: 'Homework not found' });
      }
      const submissions = [...(homework.submissions || [])];
      const existingIdx = submissions.findIndex((s) =>
        String(s.studentId || s.student) === String(submissionData.studentId) ||
        (submissionData.admissionNumber && s.admissionNumber === submissionData.admissionNumber)
      );
      const newSub = { id: Math.random().toString(36).slice(2, 9), _id: Math.random().toString(36).slice(2, 9), ...submissionData };
      if (existingIdx >= 0) {
        submissions[existingIdx] = { ...submissions[existingIdx], ...submissionData };
      } else {
        submissions.push(newSub);
      }
      homework = FallbackDb.update('homework', id, { submissions });
    } else {
      const scoped = await buildScopedMongoFilter(req, {
        teacherField: 'assignedBy',
        teacherUserField: 'assignedByUser',
        hideDraftForLearners: true,
      });
      homework = await Homework.findOne(Object.keys(scoped).length ? { $and: [{ _id: id }, scoped] } : { _id: id });
      if (!homework) return res.status(404).json({ success: false, message: 'Homework not found' });

      const existing = homework.submissions.find((s) =>
        String(s.studentId || s.student) === String(submissionData.studentId) ||
        (submissionData.admissionNumber && s.admissionNumber === submissionData.admissionNumber)
      );
      if (existing) {
        existing.content = content;
        existing.attachments = cleanAttachments(attachments);
        existing.submittedAt = new Date();
        existing.status = 'submitted';
      } else {
        homework.submissions.push(submissionData);
      }
      await homework.save();
    }

    await logActivity({
      userId: getUserId(req),
      action: 'SUBMIT',
      module: 'homework',
      recordId: id,
      details: `${student.name || req.user?.name} submitted homework`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ success: true, message: 'Homework submitted successfully', homework });
  } catch (error) {
    console.error('submitHomework error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

export const gradeSubmission = async (req, res) => {
  try {
    const { id, submId } = req.params;
    const { marks, feedback, status = 'graded' } = req.body;
    const graderId = getUserId(req);
    const graderName = req.user?.name || 'Teacher';

    let homework = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      homework = FallbackDb.findById('homework', id);
      if (!homework) return res.status(404).json({ success: false, message: 'Homework not found' });
      const submissions = [...(homework.submissions || [])];
      const subIdx = submissions.findIndex((s) => s.id === submId || s._id === submId);
      if (subIdx < 0) return res.status(404).json({ success: false, message: 'Submission not found' });
      submissions[subIdx] = {
        ...submissions[subIdx],
        marks: marks !== undefined ? Number(marks) : submissions[subIdx].marks,
        feedback: feedback || submissions[subIdx].feedback,
        status,
        gradedAt: new Date().toISOString(),
        gradedBy: graderName,
      };
      homework = FallbackDb.update('homework', id, { submissions });
    } else {
      homework = await Homework.findById(id);
      if (!homework) return res.status(404).json({ success: false, message: 'Homework not found' });
      const sub = homework.submissions.id(submId);
      if (!sub) return res.status(404).json({ success: false, message: 'Submission not found' });
      if (marks !== undefined) sub.marks = Number(marks);
      if (feedback) sub.feedback = feedback;
      sub.status = status;
      sub.gradedAt = new Date();
      sub.gradedBy = graderName;
      await homework.save();
    }

    await logActivity({
      userId: graderId,
      action: 'GRADE',
      module: 'homework',
      recordId: id,
      details: `Graded submission ${submId} — marks: ${marks}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ success: true, message: 'Submission graded', homework });
  } catch (error) {
    console.error('gradeSubmission error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};
