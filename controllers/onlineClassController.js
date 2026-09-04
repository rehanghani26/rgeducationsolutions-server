import mongoose from 'mongoose';
import OnlineClass from '../models/OnlineClass.js';
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

const ONLINE_CLASS_SEED = [
  {
    id: 'oc-1',
    _id: 'oc-1',
    title: 'Mathematics Problem Solving Clinic',
    subject: 'Mathematics',
    agenda: 'Linear equations, word problems, and doubt clearing.',
    className: 'Class 10',
    sectionName: 'Section A',
    teacherName: 'Severus Snape',
    scheduledDate: '2026-09-05',
    startTime: '10:00',
    endTime: '10:45',
    platform: 'Google Meet',
    meetingLink: 'https://meet.google.com/school-class-10a-maths',
    meetingId: 'school-class-10a-maths',
    passcode: 'class10',
    status: 'scheduled',
    capacity: 60,
    resources: [{ title: 'Pre-class worksheet', url: 'https://school.local/resources/math-worksheet', type: 'document' }],
    attendance: [],
  },
  {
    id: 'oc-2',
    _id: 'oc-2',
    title: 'Science Lab Safety Briefing',
    subject: 'Science',
    agenda: 'Virtual lab safety rules and experiment preparation.',
    className: 'Class 11',
    sectionName: 'All Sections',
    teacherName: 'Filius Flitwick',
    scheduledDate: '2026-09-06',
    startTime: '12:00',
    endTime: '12:40',
    platform: 'Zoom',
    meetingLink: 'https://zoom.us/j/school-class-11-science',
    meetingId: 'school-class-11-science',
    passcode: 'science11',
    status: 'scheduled',
    capacity: 90,
    resources: [],
    attendance: [],
  },
];

const seedFallbackOnlineClasses = () => {
  const current = FallbackDb.find('onlineClasses') || [];
  if (current.length) return current;
  ONLINE_CLASS_SEED.forEach((item) => FallbackDb.create('onlineClasses', item));
  return FallbackDb.find('onlineClasses') || [];
};

const dateOnly = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const sortRecords = (items, sort = '-scheduledDate') => {
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
  const { search = '', status = '', className = '', sectionName = '', date = '' } = query;
  let filtered = [...items];

  if (search) {
    const term = normalizeText(search);
    filtered = filtered.filter((item) =>
      ['title', 'subject', 'teacherName', 'className', 'sectionName', 'platform']
        .some((field) => normalizeText(item[field]).includes(term))
    );
  }

  if (status) filtered = filtered.filter((item) => normalizeText(item.status) === normalizeText(status));
  if (className) filtered = filtered.filter((item) => normalizeText(item.className) === normalizeText(className));
  if (sectionName) filtered = filtered.filter((item) => normalizeText(item.sectionName) === normalizeText(sectionName));
  if (date) filtered = filtered.filter((item) => dateOnly(item.scheduledDate) === dateOnly(date));

  return filtered;
};

const buildOnlineClassStats = (items) => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    total: items.length,
    today: items.filter((item) => dateOnly(item.scheduledDate) === today).length,
    live: items.filter((item) => normalizeText(item.status) === 'live').length,
    upcoming: items.filter((item) => ['scheduled', 'live'].includes(normalizeText(item.status))).length,
    completed: items.filter((item) => normalizeText(item.status) === 'completed').length,
    attendanceMarked: items.reduce((sum, item) => sum + (item.attendance?.length || 0), 0),
  };
};

const buildMongoQueryFilter = async (req, query) => {
  const scopedFilter = await buildScopedMongoFilter(req, {
    teacherField: 'teacher',
    teacherUserField: 'teacherUser',
  });
  const filters = [];
  if (Object.keys(scopedFilter).length) filters.push(scopedFilter);

  const search = (query.search || '').trim();
  if (search) filters.push(buildSearchFilter(search, ['title', 'subject', 'teacherName', 'className', 'sectionName', 'platform']));
  if (query.status) filters.push({ status: query.status });
  if (query.className) filters.push({ className: query.className });
  if (query.sectionName) filters.push({ sectionName: query.sectionName });
  if (query.date) {
    const start = new Date(query.date);
    const end = new Date(query.date);
    end.setDate(end.getDate() + 1);
    filters.push({ scheduledDate: { $gte: start, $lt: end } });
  }

  return {
    scopedFilter,
    filter: filters.length ? { $and: filters } : {},
  };
};

const cleanResources = (resources = []) => (
  Array.isArray(resources)
    ? resources
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
    const set = (key, value) => {
      if (value !== undefined) payload[key] = value;
    };

    set('title', data.title);
    set('subject', data.subject);
    set('agenda', data.agenda ?? data.description);
    if (data.className !== undefined || data.class !== undefined) set('className', data.className || data.class);
    if (data.sectionName !== undefined || data.section !== undefined) set('sectionName', data.sectionName || data.section || 'All Sections');
    set('classId', data.classId);
    set('sectionId', data.sectionId);
    set('teacher', data.teacher);
    set('teacherUser', data.teacherUser);
    set('teacherName', data.teacherName);
    set('scheduledDate', data.scheduledDate ?? data.date);
    set('startTime', data.startTime);
    set('endTime', data.endTime);
    set('timezone', data.timezone);
    set('platform', data.platform);
    set('meetingLink', data.meetingLink);
    set('meetingId', data.meetingId);
    set('passcode', data.passcode);
    if (data.capacity !== undefined) set('capacity', Number(data.capacity) || 60);
    set('status', data.status);
    if (data.resources !== undefined) set('resources', cleanResources(data.resources));
    payload.updatedBy = userId;
    return payload;
  }

  return {
    title: data.title,
    subject: data.subject,
    agenda: data.agenda || data.description || '',
    classId: data.classId || null,
    className: data.className || data.class || '',
    sectionId: data.sectionId || null,
    sectionName: data.sectionName || data.section || 'All Sections',
    teacher: data.teacher || getRecordId(teacher) || null,
    teacherUser: data.teacherUser || (isTeacherRole(role) ? userId : null),
    teacherName: data.teacherName || teacher?.name || req.user?.name || 'Faculty',
    scheduledDate: data.scheduledDate || data.date,
    startTime: data.startTime,
    endTime: data.endTime,
    timezone: data.timezone || 'Asia/Kolkata',
    platform: data.platform || 'Google Meet',
    meetingLink: data.meetingLink,
    meetingId: data.meetingId || '',
    passcode: data.passcode || '',
    capacity: Number(data.capacity) || 60,
    status: data.status || 'scheduled',
    resources: cleanResources(data.resources),
    updatedBy: userId,
  };
};

const validatePayload = (payload) => {
  const required = ['title', 'subject', 'className', 'scheduledDate', 'startTime', 'endTime', 'meetingLink'];
  const missing = required.filter((field) => !payload[field]);
  return missing.length ? `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required` : '';
};

const requireVisibleRecord = async (req, record) => {
  const role = getRole(req);
  if (!record) return false;
  if (isAdminRole(role)) return true;
  const visible = await filterRecordsForUser(req, [record]);
  return visible.length > 0;
};

export const getOnlineClasses = async (req, res) => {
  try {
    const { page, limit, skip, sort } = parsePagination(req.query);

    if (checkFallback()) {
      const scoped = await filterRecordsForUser(req, seedFallbackOnlineClasses());
      const filtered = applyFallbackFilters(scoped, req.query);
      const ordered = sortRecords(filtered, sort);
      const data = ordered.slice((page - 1) * limit, page * limit);
      return res.json({
        success: true,
        onlineClasses: data,
        stats: buildOnlineClassStats(filtered),
        ...paginateResult(data, filtered.length, { page, limit }),
      });
    }

    const { filter, scopedFilter } = await buildMongoQueryFilter(req, req.query);
    const sortObj = {};
    const sortField = sort.startsWith('-') ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith('-') ? -1 : 1;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const [onlineClasses, total, statsCounts] = await Promise.all([
      OnlineClass.find(filter).sort(sortObj).skip(skip).limit(limit),
      OnlineClass.countDocuments(filter),
      Promise.all([
        OnlineClass.countDocuments(scopedFilter),
        OnlineClass.countDocuments({ ...scopedFilter, scheduledDate: { $gte: todayStart, $lt: todayEnd } }),
        OnlineClass.countDocuments({ ...scopedFilter, status: 'live' }),
        OnlineClass.countDocuments({ ...scopedFilter, status: { $in: ['scheduled', 'live'] } }),
        OnlineClass.countDocuments({ ...scopedFilter, status: 'completed' }),
      ]),
    ]);

    return res.json({
      success: true,
      onlineClasses,
      stats: {
        total: statsCounts[0],
        today: statsCounts[1],
        live: statsCounts[2],
        upcoming: statsCounts[3],
        completed: statsCounts[4],
      },
      ...paginateResult(onlineClasses, total, { page, limit }),
    });
  } catch (error) {
    console.error('getOnlineClasses error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getOnlineClassById = async (req, res) => {
  try {
    const { id } = req.params;
    let onlineClass = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      onlineClass = FallbackDb.findById('onlineClasses', id);
      if (!(await requireVisibleRecord(req, onlineClass))) {
        return res.status(404).json({ success: false, message: 'Online class not found' });
      }
    } else {
      const scoped = await buildScopedMongoFilter(req, { teacherField: 'teacher', teacherUserField: 'teacherUser' });
      onlineClass = await OnlineClass.findOne(Object.keys(scoped).length ? { $and: [{ _id: id }, scoped] } : { _id: id });
    }

    if (!onlineClass) return res.status(404).json({ success: false, message: 'Online class not found' });
    return res.json({ success: true, onlineClass });
  } catch (error) {
    console.error('getOnlineClassById error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const getOnlineClassActivity = async (req, res) => {
  try {
    const logs = await getRecordActivity('online-classes', req.params.id);
    return res.json({ success: true, logs });
  } catch (error) {
    console.error('getOnlineClassActivity error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const createOnlineClass = async (req, res) => {
  try {
    const payload = await buildPayload(req, req.body);
    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ success: false, message: validationError });
    }

    payload.createdBy = getUserId(req);

    const onlineClass = checkFallback()
      ? FallbackDb.create('onlineClasses', payload)
      : await OnlineClass.create(payload);

    await logActivity({
      userId: getUserId(req),
      action: 'CREATE',
      module: 'online-classes',
      recordId: getRecordId(onlineClass),
      details: `Scheduled online class ${payload.title}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({ success: true, message: 'Online class scheduled', onlineClass });
  } catch (error) {
    console.error('createOnlineClass error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

export const updateOnlineClass = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = await buildPayload(req, req.body, { partial: true });
    Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key]);

    let current = null;
    let onlineClass = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      current = FallbackDb.findById('onlineClasses', id);
      if (!(await requireVisibleRecord(req, current))) {
        return res.status(404).json({ success: false, message: 'Online class not found' });
      }
      onlineClass = FallbackDb.update('onlineClasses', id, payload);
    } else {
      const scoped = await buildScopedMongoFilter(req, { teacherField: 'teacher', teacherUserField: 'teacherUser' });
      current = await OnlineClass.findOne(Object.keys(scoped).length ? { $and: [{ _id: id }, scoped] } : { _id: id });
      if (!current) return res.status(404).json({ success: false, message: 'Online class not found' });
      onlineClass = await OnlineClass.findByIdAndUpdate(id, payload, { new: true, runValidators: true });
    }

    await logActivity({
      userId: getUserId(req),
      action: 'UPDATE',
      module: 'online-classes',
      recordId: id,
      details: `Updated online class ${onlineClass?.title || id}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ success: true, message: 'Online class updated', onlineClass });
  } catch (error) {
    console.error('updateOnlineClass error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

export const deleteOnlineClass = async (req, res) => {
  try {
    const { id } = req.params;
    let deleted = false;
    let title = id;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      const record = FallbackDb.findById('onlineClasses', id);
      title = record?.title || id;
      deleted = FallbackDb.delete('onlineClasses', id);
    } else {
      const record = await OnlineClass.findById(id);
      title = record?.title || id;
      if (record) {
        await OnlineClass.findByIdAndDelete(id);
        deleted = true;
      }
    }

    if (!deleted) return res.status(404).json({ success: false, message: 'Online class not found' });

    await logActivity({
      userId: getUserId(req),
      action: 'DELETE',
      module: 'online-classes',
      recordId: id,
      details: `Deleted online class ${title}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ success: true, message: 'Online class deleted' });
  } catch (error) {
    console.error('deleteOnlineClass error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const joinOnlineClass = async (req, res) => {
  try {
    const { id } = req.params;
    const student = await getStudentProfileForUser(req);
    if (!student) return res.status(404).json({ success: false, message: 'Student profile not found' });

    let onlineClass = null;
    const submissionIdentity = {
      student: mongoose.Types.ObjectId.isValid(String(getRecordId(student))) ? getRecordId(student) : undefined,
      studentId: String(getRecordId(student)),
      studentName: student.name || req.user?.name,
      admissionNumber: student.admissionNumber,
      joinedAt: new Date(),
      status: 'attended',
    };

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      onlineClass = FallbackDb.findById('onlineClasses', id);
      if (!(await requireVisibleRecord(req, onlineClass))) {
        return res.status(404).json({ success: false, message: 'Online class not found' });
      }
      const attendance = [...(onlineClass.attendance || [])];
      const existingIndex = attendance.findIndex((item) =>
        String(item.studentId || item.student || item.admissionNumber) === String(submissionIdentity.studentId) ||
        (submissionIdentity.admissionNumber && item.admissionNumber === submissionIdentity.admissionNumber)
      );
      if (existingIndex >= 0) {
        attendance[existingIndex] = { ...attendance[existingIndex], ...submissionIdentity };
      } else {
        attendance.push({
          id: Math.random().toString(36).slice(2, 9),
          _id: Math.random().toString(36).slice(2, 9),
          ...submissionIdentity,
        });
      }
      onlineClass = FallbackDb.update('onlineClasses', id, { attendance });
    } else {
      const scoped = await buildScopedMongoFilter(req, { teacherField: 'teacher', teacherUserField: 'teacherUser' });
      onlineClass = await OnlineClass.findOne(Object.keys(scoped).length ? { $and: [{ _id: id }, scoped] } : { _id: id });
      if (!onlineClass) return res.status(404).json({ success: false, message: 'Online class not found' });

      const existing = onlineClass.attendance.find((item) =>
        String(item.studentId || item.student || item.admissionNumber) === String(submissionIdentity.studentId) ||
        (submissionIdentity.admissionNumber && item.admissionNumber === submissionIdentity.admissionNumber)
      );
      if (existing) {
        existing.joinedAt = new Date();
        existing.status = 'attended';
      } else {
        onlineClass.attendance.push(submissionIdentity);
      }
      await onlineClass.save();
    }

    await logActivity({
      userId: getUserId(req),
      action: 'JOIN',
      module: 'online-classes',
      recordId: id,
      details: `${student.name || req.user?.name} joined ${onlineClass.title}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      success: true,
      message: 'Attendance marked',
      onlineClass,
      meetingLink: onlineClass.meetingLink,
    });
  } catch (error) {
    console.error('joinOnlineClass error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};
