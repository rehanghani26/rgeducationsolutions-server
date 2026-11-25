import mongoose from 'mongoose';
import { academicError, academicGrade, getAcademicScope } from '../utils/academicScope.js';
import {
  canonicalSectionDescriptor,
  classKey,
  gradeByValue,
  sectionByValue,
  sectionMatches,
} from '../utils/academicClass.js';
import { findScopedEnrollment, scopedStudentRoster } from '../services/studentEnrollmentService.js';
import { readRolloverSettings } from '../services/academicSessionService.js';
import { getSchool, readProcurement } from '../services/procurementStore.js';
import { schoolClock, sessionDay, validSessionDay } from '../utils/academicDates.js';
import { checkFallback } from '../config/db.js';
import Attendance from '../models/Attendance.js';
import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import Class from '../models/Class.js';
import ClassRoom from '../models/ClassRoom.js';
import { FallbackDb } from '../services/dbFallback.js';
import { parsePagination, paginateResult } from '../utils/paginateQuery.js';
import { logActivity } from '../utils/activityLogger.js';
import { escapeRegex, isValidObjectId } from '../utils/commonUtil.js';
import { MONTH_NAMES } from '../constants/index.js';
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError,
} from '../utils/responseUtil.js';

const VALID_STATUS_MAP = new Map([
  ['present', 'present'],
  ['absent', 'absent'],
  ['late', 'late'],
  ['half day', 'half day'],
  ['half-day', 'half day'],
  ['halfday', 'half day'],
  ['half_day', 'half day'],
  ['leave', 'leave'],
  ['on leave', 'leave'],
  ['on_leave', 'leave'],
]);

const STATUS_DISPLAY = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  'half day': 'Half Day',
  leave: 'Leave',
};

const idStr = (val) => String(val?._id || val?.id || val || '').trim();

export async function resolveSchoolClock(req) {
  try {
    const { timeZone } = await readRolloverSettings(req);
    return { timeZone, todayDay: schoolClock(new Date(), timeZone).day };
  } catch {
    const timeZone = 'Asia/Kolkata';
    return { timeZone, todayDay: schoolClock(new Date(), timeZone).day };
  }
}

export function parseCalendarInput(value, timeZone) {
  if (value == null || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      if (!validSessionDay(trimmed)) return null;
      return {
        dayKey: trimmed,
        startOfDay: new Date(`${trimmed}T00:00:00.000Z`),
        endOfDay: new Date(`${trimmed}T23:59:59.999Z`),
      };
    }
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return null;
  const dayKey = schoolClock(parsed, timeZone).day;
  return {
    dayKey,
    startOfDay: new Date(`${dayKey}T00:00:00.000Z`),
    endOfDay: new Date(`${dayKey}T23:59:59.999Z`),
  };
}

export function recordDayKey(record, timeZone) {
  if (record?.attendanceDateKey && validSessionDay(record.attendanceDateKey)) {
    return record.attendanceDateKey;
  }
  const raw = record?.attendanceDate || record?.date;
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return schoolClock(d, timeZone).day;
}

export function buildDayWindowFilter(dayKey) {
  const baseMs = new Date(`${dayKey}T00:00:00.000Z`).getTime();
  const startWindow = new Date(baseMs - 24 * 60 * 60 * 1000);
  const endWindow = new Date(baseMs + 48 * 60 * 60 * 1000 - 1);
  return {
    $or: [
      { attendanceDateKey: dayKey },
      { date: { $gte: startWindow, $lte: endWindow } },
      { attendanceDate: { $gte: startWindow, $lte: endWindow } },
    ],
  };
}

export function normalizeAttendanceStatus(rawStatus) {
  const key = String(rawStatus ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return VALID_STATUS_MAP.get(key) || null;
}

export function formatStatusLabel(rawStatus) {
  const normalized = normalizeAttendanceStatus(rawStatus);
  if (normalized) return STATUS_DISPLAY[normalized];
  const raw = String(rawStatus || 'Present').trim();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : 'Present';
}

function computeAttendanceSummary(formattedStudents = []) {
  let present = 0;
  let absent = 0;
  let late = 0;
  let halfDay = 0;
  let leave = 0;
  for (const s of formattedStudents) {
    const st = normalizeAttendanceStatus(s.status);
    if (st === 'present') present += 1;
    else if (st === 'absent') absent += 1;
    else if (st === 'late') late += 1;
    else if (st === 'half day') halfDay += 1;
    else if (st === 'leave') leave += 1;
  }
  return {
    total: formattedStudents.length,
    present,
    absent,
    late,
    halfDay,
    leave,
  };
}

export function extractRecordCounts(record) {
  const list = record.students || record.records || record.attendance || [];
  if (
    record.present != null &&
    record.absent != null &&
    record.late != null &&
    (record.leave != null || record.halfDay != null)
  ) {
    return {
      total: record.total ?? list.length,
      present: Number(record.present) || 0,
      absent: Number(record.absent) || 0,
      late: Number(record.late) || 0,
      halfDay: Number(record.halfDay) || 0,
      leave: Number(record.leave ?? record.leaveCount) || 0,
    };
  }
  const computed = computeAttendanceSummary(list);
  return {
    total: record.total ?? computed.total,
    present: record.present != null ? Number(record.present) : computed.present,
    absent: record.absent != null ? Number(record.absent) : computed.absent,
    late: record.late != null ? Number(record.late) : computed.late,
    halfDay: record.halfDay != null ? Number(record.halfDay) : computed.halfDay,
    leave:
      record.leave != null
        ? Number(record.leave)
        : record.leaveCount != null
          ? Number(record.leaveCount)
          : computed.leave,
  };
}

function isSameClassRecord(record, { scope, classId, className }) {
  if (scope?.grades?.length) {
    const recGrade = gradeByValue(
      scope.grades,
      record.classId || record.className || record.classSection
    );
    if (recGrade && classId) return recGrade.id === String(classId);
  }
  if (classId && record.classId && String(record.classId) === String(classId)) return true;
  if (className && record.className && classKey(record.className) === classKey(className))
    return true;
  if (className && record.classSection) {
    const firstPart = String(record.classSection).split(/\s+[–—-]\s+/)[0];
    if (classKey(firstPart) === classKey(className)) return true;
  }
  return false;
}

function isSameDepartmentRecord(record, department) {
  const reqDept = classKey(department || 'All Departments');
  const recDept = classKey(record.sectionName || record.department || 'All Departments');
  return reqDept === 'all departments' || recDept === 'all departments' || reqDept === recDept;
}

/**
 * Parses query parameters into a normalized start/end date range.
 */
export function parseDateRange({ date, startDate, endDate, month, year }) {
  if (date) {
    const trimmed = String(date).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && validSessionDay(trimmed)) {
      const start = new Date(`${trimmed}T00:00:00.000Z`);
      const end = new Date(`${trimmed}T23:59:59.999Z`);
      return { start, end, dayKey: trimmed };
    }
    const d = new Date(date);
    if (!isNaN(d.getTime())) {
      const start = new Date(d);
      start.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
  }

  if (startDate || endDate) {
    const startKey =
      startDate && /^\d{4}-\d{2}-\d{2}$/.test(String(startDate).trim())
        ? String(startDate).trim()
        : null;
    const endKey =
      endDate && /^\d{4}-\d{2}-\d{2}$/.test(String(endDate).trim()) ? String(endDate).trim() : null;
    const start = startKey
      ? new Date(`${startKey}T00:00:00.000Z`)
      : startDate
        ? new Date(startDate)
        : new Date(0);
    if (!startKey) start.setHours(0, 0, 0, 0);
    const end = endKey
      ? new Date(`${endKey}T23:59:59.999Z`)
      : endDate
        ? new Date(endDate)
        : new Date();
    if (!endKey) end.setHours(23, 59, 59, 999);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      return { start, end, startKey, endKey };
    }
  }

  if (month && month !== 'all' && month !== 'undefined') {
    let targetMonth = null;
    let targetYear = year && year !== 'all' && year !== 'undefined' ? parseInt(year, 10) : null;

    if (typeof month === 'string') {
      const trimmed = month.trim();
      const parts = trimmed.split(/[\s-]+/);
      if (parts.length >= 2) {
        if (/^\d{4}$/.test(parts[1])) {
          targetYear = parseInt(parts[1], 10);
          const parsed = new Date(Date.parse(`${parts[0]} 1, ${targetYear}`));
          if (!isNaN(parsed.getTime())) targetMonth = parsed.getMonth();
        } else if (/^\d{4}$/.test(parts[0])) {
          targetYear = parseInt(parts[0], 10);
          const mNum = parseInt(parts[1], 10);
          if (!isNaN(mNum)) targetMonth = mNum - 1;
        }
      } else {
        const mNum = parseInt(trimmed, 10);
        if (!isNaN(mNum) && mNum >= 1 && mNum <= 12) {
          targetMonth = mNum - 1;
        } else {
          const parsed = new Date(Date.parse(`${trimmed} 1, 2000`));
          if (!isNaN(parsed.getTime())) targetMonth = parsed.getMonth();
        }
      }
    } else if (typeof month === 'number') {
      targetMonth = month - 1;
    }

    if (targetMonth !== null) {
      if (!targetYear || isNaN(targetYear)) {
        targetYear = new Date().getFullYear();
      }
      const start = new Date(Date.UTC(targetYear, targetMonth, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(targetYear, targetMonth + 1, 0, 23, 59, 59, 999));
      const mm = String(targetMonth + 1).padStart(2, '0');
      const lastDay = String(
        new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
      ).padStart(2, '0');
      return {
        start,
        end,
        startKey: `${targetYear}-${mm}-01`,
        endKey: `${targetYear}-${mm}-${lastDay}`,
      };
    }
  }

  if (year && year !== 'all' && year !== 'undefined') {
    const targetYear = parseInt(year, 10);
    if (!isNaN(targetYear)) {
      const start = new Date(Date.UTC(targetYear, 0, 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(targetYear, 11, 31, 23, 59, 59, 999));
      return {
        start,
        end,
        startKey: `${targetYear}-01-01`,
        endKey: `${targetYear}-12-31`,
      };
    }
  }

  return null;
}

function buildMongoFilter(query, scope = getAcademicScope()) {
  const {
    classId,
    className,
    class: classParam,
    sectionId,
    sectionName,
    section: sectionParam,
    date,
    startDate,
    endDate,
    month,
    year,
    type,
    search,
  } = query;

  const filter = {};
  const dateRange = parseDateRange({ date, startDate, endDate, month, year });

  if (dateRange) {
    if (dateRange.dayKey) {
      filter.$or = buildDayWindowFilter(dateRange.dayKey).$or;
    } else if (dateRange.startKey || dateRange.endKey) {
      const startWin = new Date(dateRange.start.getTime() - 24 * 60 * 60 * 1000);
      const endWin = new Date(dateRange.end.getTime() + 24 * 60 * 60 * 1000);
      const keyCond = {};
      if (dateRange.startKey) keyCond.$gte = dateRange.startKey;
      if (dateRange.endKey) keyCond.$lte = dateRange.endKey;
      filter.$or = [
        { attendanceDateKey: keyCond },
        { date: { $gte: startWin, $lte: endWin } },
        { attendanceDate: { $gte: startWin, $lte: endWin } },
      ];
    } else {
      filter.$or = [
        { date: { $gte: dateRange.start, $lte: dateRange.end } },
        { attendanceDate: { $gte: dateRange.start, $lte: dateRange.end } },
      ];
    }
  }

  if (type && type !== 'all') {
    filter.type = new RegExp(`^${escapeRegex(type)}$`, 'i');
  }

  const cls = classParam || className || classId;
  if (cls && cls !== 'all') {
    const matchedGrade = scope?.grades?.length ? gradeByValue(scope.grades, cls) : null;
    const classOr = [
      { className: new RegExp(`^${escapeRegex(cls)}$`, 'i') },
      { classSection: new RegExp(`^${escapeRegex(cls)}(?:\\s|$|-)`, 'i') },
      { classId: cls },
    ];
    if (matchedGrade) {
      classOr.push(
        { classId: matchedGrade.id },
        { className: new RegExp(`^${escapeRegex(matchedGrade.name)}$`, 'i') }
      );
      if (matchedGrade.code) classOr.push({ classId: matchedGrade.code });
    }
    filter.$and = filter.$and || [];
    filter.$and.push({ $or: classOr });
  }

  const sec = sectionParam || sectionName || sectionId;
  if (sec && sec !== 'all') {
    const resolvedSec = sectionByValue(sec);
    const secOr = [
      { sectionName: new RegExp(`^${escapeRegex(sec)}$`, 'i') },
      { classSection: new RegExp(`-\\s*${escapeRegex(sec)}$`, 'i') },
      { sectionId: sec },
    ];
    if (resolvedSec) {
      secOr.push(
        { sectionId: resolvedSec.id },
        { sectionName: new RegExp(`^${escapeRegex(resolvedSec.name)}$`, 'i') },
        { classSection: new RegExp(`-\\s*${escapeRegex(resolvedSec.name)}$`, 'i') }
      );
    }
    filter.$and = filter.$and || [];
    filter.$and.push({ $or: secOr });
  }

  if (search && search.trim()) {
    const sRegex = new RegExp(escapeRegex(search.trim()), 'i');
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { className: sRegex },
        { sectionName: sRegex },
        { classSection: sRegex },
        { 'takenBy.name': sRegex },
      ],
    });
  }

  return filter;
}

function filterFallbackList(list, query, timeZone = 'Asia/Kolkata', scope = getAcademicScope()) {
  const {
    classId,
    className,
    class: classParam,
    sectionId,
    sectionName,
    section: sectionParam,
    date,
    startDate,
    endDate,
    month,
    year,
    type,
    search,
  } = query;

  const dateRange = parseDateRange({ date, startDate, endDate, month, year });
  const cls = (classParam || className || classId || '').trim();
  const sec = (sectionParam || sectionName || sectionId || '').trim();
  const matchedGrade =
    cls && cls !== 'all' && scope?.grades?.length ? gradeByValue(scope.grades, cls) : null;

  return list.filter((a) => {
    if (type && type !== 'all' && (a.type || 'student').toLowerCase() !== type.toLowerCase()) {
      return false;
    }

    if (dateRange) {
      const aDayKey = recordDayKey(a, timeZone);
      if (dateRange.dayKey) {
        if (aDayKey !== dateRange.dayKey) return false;
      } else if (dateRange.startKey || dateRange.endKey) {
        if (!aDayKey) return false;
        if (dateRange.startKey && aDayKey < dateRange.startKey) return false;
        if (dateRange.endKey && aDayKey > dateRange.endKey) return false;
      } else {
        const d = new Date(a.attendanceDate || a.date);
        if (isNaN(d.getTime()) || d < dateRange.start || d > dateRange.end) return false;
      }
    }

    if (cls && cls !== 'all') {
      if (matchedGrade) {
        if (
          !isSameClassRecord(a, { scope, classId: matchedGrade.id, className: matchedGrade.name })
        ) {
          return false;
        }
      } else {
        const aCls = (
          a.className ||
          (a.classSection ? a.classSection.split(' - ')[0] : '') ||
          String(a.classId || '')
        ).toLowerCase();
        if (aCls !== cls.toLowerCase() && !aCls.includes(cls.toLowerCase())) {
          return false;
        }
      }
    }

    if (sec && sec !== 'all') {
      const resolvedSec = sectionByValue(sec);
      if (resolvedSec && (a.type || 'student') !== 'teacher') {
        if (!sectionMatches(resolvedSec, a)) return false;
      } else {
        const aSec = (
          a.sectionName ||
          (a.classSection && a.classSection.includes(' - ')
            ? a.classSection.split(' - ')[1]
            : '') ||
          String(a.sectionId || '')
        ).toLowerCase();
        if (aSec !== sec.toLowerCase()) return false;
      }
    }

    if (search && search.trim()) {
      const s = search.trim().toLowerCase();
      const combined =
        `${a.className || ''} ${a.sectionName || ''} ${a.classSection || ''} ${a.takenBy?.name || ''}`.toLowerCase();
      if (!combined.includes(s)) return false;
    }

    return true;
  });
}

function extractAvailableFilters(records = [], scope = null, timeZone = 'Asia/Kolkata') {
  const monthMap = new Map();
  const classSet = new Set();
  const sectionSet = new Set();

  if (scope?.grades?.length) {
    scope.grades.forEach((g) => classSet.add(g.name));
  }

  records.forEach((r) => {
    const dk = recordDayKey(r, timeZone);
    if (dk) {
      const [y, m] = dk.split('-').map(Number);
      if (y && m >= 1 && m <= 12) {
        const key = `${MONTH_NAMES[m - 1]} ${y}`;
        const time = Date.UTC(y, m - 1, 1);
        if (!monthMap.has(key)) monthMap.set(key, time);
      }
    }
    const cName = r.className || (r.classSection ? r.classSection.split(' - ')[0] : '');
    if (cName && cName !== 'Teaching Staff') classSet.add(cName.trim());

    const sName =
      r.sectionName ||
      (r.classSection && r.classSection.includes(' - ') ? r.classSection.split(' - ')[1] : '');
    if (sName) sectionSet.add(sName.trim());
  });

  const sortedMonths = Array.from(monthMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);

  return {
    months: sortedMonths,
    classes: Array.from(classSet),
    sections: Array.from(sectionSet).sort(),
  };
}

async function findDuplicateAttendance(
  req,
  { dayKey, timeZone, type, classId, className, sectionId, sectionName, scope, excludeId = null }
) {
  let candidates = [];
  if (checkFallback()) {
    candidates = (FallbackDb.find('attendance') || []).filter(
      (a) => recordDayKey(a, timeZone) === dayKey && (a.type || 'student').toLowerCase() === type
    );
  } else {
    candidates = await Attendance.find({
      ...buildDayWindowFilter(dayKey),
      type,
    }).lean();
    candidates = candidates.filter((a) => recordDayKey(a, timeZone) === dayKey);
  }

  return (
    candidates.find((rec) => {
      if (excludeId && idStr(rec) === String(excludeId)) return false;
      if (type === 'teacher') {
        return isSameDepartmentRecord(rec, sectionName);
      }
      if (!isSameClassRecord(rec, { scope, classId, className })) return false;
      return sectionMatches(sectionId || sectionName, rec);
    }) || null
  );
}

async function validateAndFormatMembers(
  req,
  { rawList, type, scope, classId, resolvedSection, sectionName }
) {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw academicError('Attendance member list is required.');
  }

  const seenMemberIds = new Set();
  const formatted = [];

  for (let i = 0; i < rawList.length; i += 1) {
    const item = rawList[i];
    if (!item || typeof item !== 'object') {
      throw academicError(`Invalid attendance entry at row ${i + 1}.`);
    }
    const memberId = String(
      item.studentId || item.memberId || item.teacherId || item.id || item._id || ''
    ).trim();
    if (!memberId) {
      throw academicError(`Missing student or staff identifier at row ${i + 1}.`);
    }
    if (seenMemberIds.has(memberId)) {
      throw academicError('Duplicate member entries found in the attendance list.');
    }
    seenMemberIds.add(memberId);

    const status = normalizeAttendanceStatus(item.status ?? 'present');
    if (!status) {
      throw academicError(
        `Invalid attendance status "${item.status}" for ${item.name || memberId}.`
      );
    }

    const remarks = String(item.remarks || '')
      .trim()
      .slice(0, 500);
    formatted.push({
      studentId: memberId,
      name: String(item.name || '').trim(),
      rollNo: item.rollNo ?? item.roll ?? '',
      status,
      remarks,
    });
  }

  if (type === 'teacher') {
    const schoolId = getSchool(req);
    let teachers = [];
    if (checkFallback()) {
      teachers = await readProcurement(req).find('teachers');
    } else {
      const validIds = formatted.map((m) => m.studentId).filter((id) => isValidObjectId(id));
      if (validIds.length !== formatted.length) {
        throw academicError('The attendance list contains an invalid staff identifier.');
      }
      teachers = await Teacher.find({ _id: { $in: validIds }, schoolId }).lean();
    }
    const teacherMap = new Map(teachers.map((t) => [idStr(t), t]));
    const deptKey = classKey(sectionName || 'All Departments');
    for (const member of formatted) {
      const teacher = teacherMap.get(member.studentId);
      if (!teacher || teacher.status === 'inactive') {
        throw academicError('The attendance list contains an invalid or inactive staff member.');
      }
      if (
        deptKey &&
        deptKey !== 'all departments' &&
        teacher.department &&
        classKey(teacher.department) !== deptKey
      ) {
        throw academicError(
          `${teacher.name || member.name || 'A staff member'} belongs to ${teacher.department}, not ${sectionName}.`
        );
      }
      if (!member.name) {
        member.name = teacher.name || `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim();
      }
      if (member.rollNo === '' && teacher.employeeId) {
        member.rollNo = teacher.employeeId;
      }
    }
    return formatted;
  }

  if (scope) {
    for (const member of formatted) {
      const enrollment = await findScopedEnrollment(req, member.studentId);
      const enrollmentGrade = enrollment
        ? gradeByValue(scope.grades, enrollment.classId || enrollment.className)
        : null;
      const sameClass = Boolean(
        enrollment &&
        enrollment.status !== 'completed' &&
        enrollment.promotionStatus !== 'passout' &&
        (String(enrollment.classId) === String(classId) || enrollmentGrade?.id === classId)
      );
      if (!sameClass || !sectionMatches(resolvedSection || sectionName, enrollment)) {
        throw academicError(
          'The attendance list contains a student outside the selected class or section.'
        );
      }
      if (!member.name && enrollment.studentName) member.name = enrollment.studentName;
      if ((member.rollNo === '' || member.rollNo == null) && enrollment.rollNumber != null) {
        member.rollNo = enrollment.rollNumber;
      }
    }
    return formatted;
  }

  // Unconfigured legacy school (no active academic scope)
  const schoolId = getSchool(req);
  let students = [];
  if (checkFallback()) {
    students = await readProcurement(req).find('students');
  } else {
    const validIds = formatted.map((m) => m.studentId).filter((id) => isValidObjectId(id));
    if (validIds.length !== formatted.length) {
      throw academicError('The attendance list contains an invalid student identifier.');
    }
    students = await Student.find({ _id: { $in: validIds }, schoolId }).lean();
  }
  const studentMap = new Map(students.map((s) => [idStr(s), s]));
  for (const member of formatted) {
    const student = studentMap.get(member.studentId);
    if (!student || student.status === 'inactive' || student.status === 'Passout') {
      throw academicError('The attendance list contains an inactive or unknown student.');
    }
    if (!member.name) member.name = student.name || '';
  }

  return formatted;
}

async function prepareAttendanceRequest(req, body, { excludeId = null } = {}) {
  let { classId, className, sectionId, sectionName, classSection } = body || {};
  const { date, attendanceDate, attendanceTakenDate, takenBy, students, records, attendance } =
    body || {};
  const type = String(body?.type || 'student')
    .trim()
    .toLowerCase();

  if (!['student', 'teacher'].includes(type)) {
    throw academicError('Attendance type must be student or teacher.');
  }

  if (typeof classId === 'string' && /^CLASS_ID$/i.test(classId.trim())) classId = undefined;
  if (typeof sectionId === 'string' && /^SECTION_ID$/i.test(sectionId.trim()))
    sectionId = undefined;

  const rawList = students || attendance || records || [];
  if (!Array.isArray(rawList) || !rawList.length) {
    throw academicError('Attendance member list is required.');
  }

  const { timeZone, todayDay } = await resolveSchoolClock(req);
  const rawDateInput = date || attendanceDate || todayDay;
  const parsedDate = parseCalendarInput(rawDateInput, timeZone);
  if (!parsedDate) {
    throw academicError('A valid attendance date is required.');
  }
  const { dayKey, startOfDay } = parsedDate;

  if (dayKey > todayDay) {
    throw academicError('Attendance cannot be marked for a future date.');
  }

  const scope = getAcademicScope();
  if (scope) {
    if (scope.readOnly) {
      throw academicError('This academic session is read-only.', 409);
    }
    if (
      dayKey < sessionDay(scope.session.startDate) ||
      dayKey > sessionDay(scope.session.endDate)
    ) {
      throw academicError('The attendance date is outside the selected session.');
    }
  }

  let resolvedSection = null;
  if (type === 'teacher') {
    classId = undefined;
    sectionId = undefined;
    className = 'Teaching Staff';
    sectionName =
      String(sectionName || body?.department || 'All Departments').trim() || 'All Departments';
    classSection = `Staff - ${sectionName}`;
  } else {
    if (scope) {
      const grade = academicGrade(scope, classId || className || classSection);
      classId = grade.id;
      className = grade.name;
    } else {
      className = String(className || classId || '').trim();
      if (!className) {
        throw academicError('Please select a class for student attendance.');
      }
      classId = classId ? String(classId).trim() : undefined;
    }

    const secDesc = canonicalSectionDescriptor(sectionId, sectionName, classSection);
    resolvedSection = secDesc.resolved;
    sectionId = secDesc.sectionId;
    sectionName = secDesc.sectionName;
    if (!sectionId && !sectionName) {
      throw academicError('Please select a section for student attendance.');
    }
    classSection = className && sectionName ? `${className} - ${sectionName}` : classSection;
  }

  const formattedStudents = await validateAndFormatMembers(req, {
    rawList,
    type,
    scope,
    classId,
    resolvedSection,
    sectionName,
  });

  const duplicate = await findDuplicateAttendance(req, {
    dayKey,
    timeZone,
    type,
    classId,
    className,
    sectionId,
    sectionName,
    scope,
    excludeId,
  });
  if (duplicate) {
    const dupLabel =
      type === 'teacher'
        ? `Teacher & staff attendance for ${sectionName} on ${dayKey}`
        : `Attendance for ${className} - ${sectionName || sectionId} on ${dayKey}`;
    throw academicError(
      `${dupLabel} has already been recorded. You cannot take attendance for the same ${type === 'teacher' ? 'department' : 'class and section'} twice in a day.`,
      409
    );
  }

  const takenAt =
    attendanceTakenDate && !isNaN(new Date(attendanceTakenDate).getTime())
      ? new Date(attendanceTakenDate)
      : new Date();
  const counts = computeAttendanceSummary(formattedStudents);
  const memberModel = type === 'teacher' ? 'Teacher' : 'Student';
  const takenByObj =
    typeof takenBy === 'object' && takenBy !== null
      ? {
          userId: String(takenBy.userId || req.user?._id || req.user?.id || ''),
          name: String(
            takenBy.name || req.user?.name || req.user?.username || 'Administrator'
          ).trim(),
        }
      : {
          userId: String(req.user?._id || req.user?.id || ''),
          name: String(takenBy || req.user?.name || req.user?.username || 'Administrator').trim(),
        };

  return {
    dayKey,
    startOfDay,
    takenAt,
    formattedStudents,
    attendancePayload: {
      date: startOfDay,
      attendanceDate: startOfDay,
      attendanceDateKey: dayKey,
      attendanceTakenDate: takenAt,
      type,
      classId: classId || undefined,
      sectionId: sectionId || undefined,
      className,
      sectionName,
      classSection,
      takenBy: takenByObj,
      total: counts.total,
      present: counts.present,
      absent: counts.absent,
      late: counts.late,
      halfDay: counts.halfDay,
      leave: counts.leave,
      students: formattedStudents,
      records: formattedStudents.map((s) => ({
        ...s,
        memberId: s.studentId,
        memberModel,
      })),
      attendance: formattedStudents,
    },
  };
}

async function buildDynamicClassSections(req, scope) {
  const byKey = new Map();
  const addEntry = ({ classId, className, sectionId, sectionName, count = 0 }) => {
    const grade = scope?.grades?.length ? gradeByValue(scope.grades, classId || className) : null;
    const cId = grade ? grade.id : String(classId || className || '').trim();
    const cName = grade ? grade.name : String(className || classId || '').trim();
    const sec = sectionByValue(sectionId || sectionName);
    const sId = sec ? sec.id : String(sectionId || sectionName || '').trim();
    const sName = sec ? sec.name : String(sectionName || sectionId || '').trim();
    if (!cId || !cName || !sId || !sName) return;
    const key = `${cId}::${sId}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.studentCount += count;
    } else {
      byKey.set(key, {
        key,
        classId: cId,
        className: cName,
        sectionId: sId,
        sectionName: sName,
        classSection: `${cName} - ${sName}`,
        studentCount: count,
      });
    }
  };

  if (scope) {
    const store = readProcurement(req);
    const [rooms, enrollments] = await Promise.all([
      store.find('classRooms', { sessionId: scope.sessionId, status: 'active' }),
      store.find('studentSessionHistories', { sessionId: scope.sessionId }),
    ]);
    rooms.forEach((room) =>
      addEntry({
        classId: room.classId,
        className: room.className,
        sectionId: room.sectionId,
        sectionName: room.sectionName,
        count: 0,
      })
    );
    enrollments.forEach((row) => {
      if (row.status === 'completed' || row.promotionStatus === 'passout') return;
      addEntry({
        classId: row.classId,
        className: row.className,
        sectionId: row.sectionId,
        sectionName: row.sectionName,
        count: 1,
      });
    });
  } else {
    const schoolId = getSchool(req);
    const [rooms, students] = checkFallback()
      ? [
          FallbackDb.find('classRooms') || [],
          (FallbackDb.find('students') || []).filter(
            (s) => String(s.schoolId || 'IQRA_P01001').toUpperCase() === schoolId
          ),
        ]
      : await Promise.all([
          ClassRoom.find({ status: 'active' }).lean(),
          Student.find({ status: { $nin: ['inactive', 'Passout'] } })
            .select('classId className class sectionId sectionName section')
            .lean(),
        ]);
    rooms.forEach((room) =>
      addEntry({
        classId: room.classId,
        className: room.className,
        sectionId: room.sectionId,
        sectionName: room.sectionName,
        count: 0,
      })
    );
    students.forEach((s) =>
      addEntry({
        classId: s.classId,
        className: s.className || s.class,
        sectionId: s.sectionId,
        sectionName: s.sectionName || s.section,
        count: 1,
      })
    );
  }

  const gradeOrder = new Map((scope?.grades || []).map((g, idx) => [g.id, idx]));
  return Array.from(byKey.values()).sort((a, b) => {
    const ga = gradeOrder.has(a.classId) ? gradeOrder.get(a.classId) : Number.MAX_SAFE_INTEGER;
    const gb = gradeOrder.has(b.classId) ? gradeOrder.get(b.classId) : Number.MAX_SAFE_INTEGER;
    if (ga !== gb) return ga - gb;
    return a.className.localeCompare(b.className) || a.sectionName.localeCompare(b.sectionName);
  });
}

/**
 * Retrieves paginated attendance logs with dynamic filter extraction.
 */
export const getAttendanceRecords = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const scope = getAcademicScope();
    const { timeZone } = await resolveSchoolClock(req);

    if (checkFallback()) {
      const list = FallbackDb.find('attendance') || [];
      const filtered = filterFallbackList(list, req.query, timeZone, scope);
      filtered.sort(
        (a, b) =>
          new Date(b.attendanceDate || b.date) - new Date(a.attendanceDate || a.date) ||
          new Date(b.attendanceTakenDate || b.createdAt || 0) -
            new Date(a.attendanceTakenDate || a.createdAt || 0)
      );
      const total = filtered.length;
      const data = filtered.slice(skip, skip + limit);
      const availableFilters = extractAvailableFilters(list, scope, timeZone);

      return sendSuccess(res, undefined, {
        records: data,
        availableFilters,
        ...paginateResult(data, total, { page, limit }),
      });
    }

    const filter = buildMongoFilter(req.query, scope);
    const dateRange = parseDateRange(req.query);
    const hasExactDayWindow = Boolean(
      dateRange?.dayKey || dateRange?.startKey || dateRange?.endKey
    );

    let records = [];
    let total = 0;
    let allForFilters = [];

    if (hasExactDayWindow) {
      const [allMatching, filtersPool] = await Promise.all([
        Attendance.find(filter)
          .populate('classId', 'name code')
          .sort({ attendanceDate: -1, date: -1, attendanceTakenDate: -1, createdAt: -1 })
          .lean(),
        Attendance.find(
          req.query.type && req.query.type !== 'all'
            ? { type: new RegExp(`^${escapeRegex(req.query.type)}$`, 'i') }
            : {}
        )
          .select('attendanceDateKey attendanceDate date className sectionName classSection')
          .limit(500)
          .lean(),
      ]);
      const dayFiltered = allMatching.filter((r) => {
        const dk = recordDayKey(r, timeZone);
        if (dateRange.dayKey) return dk === dateRange.dayKey;
        if (dateRange.startKey && (!dk || dk < dateRange.startKey)) return false;
        if (dateRange.endKey && (!dk || dk > dateRange.endKey)) return false;
        return true;
      });
      total = dayFiltered.length;
      records = dayFiltered.slice(skip, skip + limit).map((r) => ({
        ...r,
        attendanceDateKey: r.attendanceDateKey || recordDayKey(r, timeZone),
      }));
      allForFilters = filtersPool;
    } else {
      const [rawRecords, rawTotal, filtersPool] = await Promise.all([
        Attendance.find(filter)
          .populate('classId', 'name code')
          .sort({ attendanceDate: -1, date: -1, attendanceTakenDate: -1, createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Attendance.countDocuments(filter),
        Attendance.find(
          req.query.type && req.query.type !== 'all'
            ? { type: new RegExp(`^${escapeRegex(req.query.type)}$`, 'i') }
            : {}
        )
          .select('attendanceDateKey attendanceDate date className sectionName classSection')
          .limit(500)
          .lean(),
      ]);
      records = rawRecords.map((r) => ({
        ...r,
        attendanceDateKey: r.attendanceDateKey || recordDayKey(r, timeZone),
      }));
      total = rawTotal;
      allForFilters = filtersPool;
    }

    const availableFilters = extractAvailableFilters(allForFilters, scope, timeZone);

    return sendSuccess(res, undefined, {
      records,
      availableFilters,
      ...paginateResult(records, total, { page, limit }),
    });
  } catch (error) {
    console.error('getAttendanceRecords error:', error);
    return sendSuccess(res, undefined, {
      records: [],
      availableFilters: { months: [], classes: [], sections: [] },
      page: 1,
      limit: 20,
      total: 0,
      pages: 1,
    });
  }
};

/**
 * Checks daily attendance availability & returns dynamic class-section/department overview.
 *
 * @route GET /api/v1/attendance/status
 */
export const getAttendanceStatusOverview = async (req, res) => {
  try {
    const scope = getAcademicScope();
    const { timeZone, todayDay } = await resolveSchoolClock(req);
    const type =
      String(req.query.type || 'student')
        .trim()
        .toLowerCase() === 'teacher'
        ? 'teacher'
        : 'student';
    const parsed = parseCalendarInput(req.query.date || todayDay, timeZone);
    if (!parsed) {
      return sendBadRequest(res, 'A valid date is required.');
    }
    const { dayKey } = parsed;
    const isFuture = dayKey > todayDay;
    const isSunday = new Date(`${dayKey}T00:00:00.000Z`).getUTCDay() === 0;
    const outsideSession = Boolean(
      scope &&
      (dayKey < sessionDay(scope.session.startDate) || dayKey > sessionDay(scope.session.endDate))
    );

    let dayRecords = [];
    if (checkFallback()) {
      dayRecords = (FallbackDb.find('attendance') || []).filter(
        (a) => recordDayKey(a, timeZone) === dayKey && (a.type || 'student').toLowerCase() === type
      );
    } else {
      dayRecords = (await Attendance.find({ ...buildDayWindowFilter(dayKey), type }).lean()).filter(
        (a) => recordDayKey(a, timeZone) === dayKey
      );
    }

    let classSections = [];
    let departments = [];
    let existingRecord = null;

    if (type === 'student') {
      const configured = await buildDynamicClassSections(req, scope);
      classSections = configured.map((item) => {
        const matched = dayRecords.find(
          (rec) =>
            isSameClassRecord(rec, { scope, classId: item.classId, className: item.className }) &&
            sectionMatches(item.sectionId, rec)
        );
        const counts = matched ? extractRecordCounts(matched) : null;
        return {
          ...item,
          taken: Boolean(matched),
          attendanceId: matched ? idStr(matched) : null,
          takenBy: matched?.takenBy?.name || null,
          attendanceTakenDate: matched?.attendanceTakenDate || matched?.createdAt || null,
          ...(counts || {
            present: 0,
            absent: 0,
            late: 0,
            halfDay: 0,
            leave: 0,
            total: item.studentCount,
          }),
        };
      });

      const reqClass = req.query.classId || req.query.className || req.query.class;
      const reqSec = req.query.sectionId || req.query.sectionName || req.query.section;
      if (reqClass && reqSec && reqClass !== 'all' && reqSec !== 'all') {
        const grade = scope?.grades?.length ? gradeByValue(scope.grades, reqClass) : null;
        const cId = grade ? grade.id : reqClass;
        const cName = grade ? grade.name : reqClass;
        const secDesc = canonicalSectionDescriptor(reqSec, reqSec);
        existingRecord =
          dayRecords.find(
            (rec) =>
              isSameClassRecord(rec, { scope, classId: cId, className: cName }) &&
              sectionMatches(secDesc.resolved || reqSec, rec)
          ) || null;
      }
    } else {
      const schoolId = getSchool(req);
      const teachers = checkFallback()
        ? (await readProcurement(req).find('teachers')).filter((t) => t.status !== 'inactive')
        : await Teacher.find({ schoolId, status: { $ne: 'inactive' } })
            .select('name department')
            .lean();

      const deptCounts = new Map();
      teachers.forEach((t) => {
        const dept = String(t.department || 'General').trim() || 'General';
        deptCounts.set(dept, (deptCounts.get(dept) || 0) + 1);
      });

      const allDeptMatched = dayRecords.find(
        (rec) => classKey(rec.sectionName || 'All Departments') === 'all departments'
      );
      departments = [
        {
          department: 'All Departments',
          staffCount: teachers.length,
          taken: dayRecords.length > 0,
          attendanceId: allDeptMatched
            ? idStr(allDeptMatched)
            : dayRecords[0]
              ? idStr(dayRecords[0])
              : null,
        },
        ...Array.from(deptCounts.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([dept, staffCount]) => {
            const matched = dayRecords.find((rec) => isSameDepartmentRecord(rec, dept));
            return {
              department: dept,
              staffCount,
              taken: Boolean(matched),
              attendanceId: matched ? idStr(matched) : null,
            };
          }),
      ];

      const reqDept = req.query.department || req.query.sectionName || req.query.section;
      if (reqDept) {
        existingRecord = dayRecords.find((rec) => isSameDepartmentRecord(rec, reqDept)) || null;
      }
    }

    return sendSuccess(res, undefined, {
      date: dayKey,
      today: todayDay,
      type,
      isFuture,
      isSunday,
      outsideSession,
      sessionName: scope?.session?.sessionName || null,
      sessionStartDate: scope?.session?.startDate ? sessionDay(scope.session.startDate) : null,
      sessionEndDate: scope?.session?.endDate ? sessionDay(scope.session.endDate) : null,
      readOnly: Boolean(scope?.readOnly),
      classSections,
      departments,
      exists: Boolean(existingRecord),
      existingRecord,
    });
  } catch (error) {
    console.error('getAttendanceStatusOverview error:', error);
    return sendError(res, error.message || 'Server error', error.statusCode || 500, error);
  }
};

/**
 * Retrieves a single attendance roster by ID.
 */
export const getAttendanceById = async (req, res) => {
  try {
    const { id } = req.params;
    let record = null;
    if (checkFallback()) {
      record = FallbackDb.findById('attendance', id);
    } else {
      if (isValidObjectId(id)) {
        record = await Attendance.findById(id).populate('classId', 'name code');
      }
      if (!record) {
        record = FallbackDb.findById('attendance', id);
      }
    }

    if (!record) return sendNotFound(res, 'Attendance record not found');
    return sendSuccess(res, undefined, { record });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Submits daily attendance roster for a classroom or staff department.
 * Strictly prevents recording the same class+section (or department) twice on the same date.
 */
export const createAttendance = async (req, res) => {
  try {
    const { dayKey, startOfDay, takenAt, formattedStudents, attendancePayload } =
      await prepareAttendanceRequest(req, req.body);

    const record = checkFallback()
      ? FallbackDb.create('attendance', attendancePayload)
      : await Attendance.create(attendancePayload);

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'CREATE',
      module: 'attendance',
      recordId: record.id || record._id,
      details: `Recorded ${attendancePayload.type} attendance for ${attendancePayload.classSection || attendancePayload.className} (${formattedStudents.length} members, Date: ${dayKey}, Taken On: ${takenAt.toISOString()})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendCreated(res, 'Attendance recorded successfully', { record });
  } catch (error) {
    console.error('createAttendance error:', error);
    if (error.statusCode) return sendError(res, error.message, error.statusCode);
    if (error.code === 11000) {
      return sendError(
        res,
        'Attendance for this class and section on the selected date has already been recorded.',
        409
      );
    }
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Updates an existing attendance record by ID with full enrollment & conflict validation.
 *
 * @route PUT /api/v1/attendance/:id
 */
export const updateAttendance = async (req, res) => {
  try {
    const { id } = req.params;
    let existingRecord = null;

    if (checkFallback()) {
      existingRecord = FallbackDb.findById('attendance', id);
    } else if (isValidObjectId(id)) {
      existingRecord = await Attendance.findById(id);
    }

    if (!existingRecord) {
      return sendNotFound(res, 'Attendance record not found');
    }

    const existingType = (existingRecord.type || 'student').toLowerCase();
    const mergedBody = {
      ...req.body,
      type: existingType,
      date:
        req.body?.date ||
        req.body?.attendanceDate ||
        existingRecord.attendanceDateKey ||
        existingRecord.attendanceDate ||
        existingRecord.date,
      classId: req.body?.classId ?? existingRecord.classId,
      className: req.body?.className ?? existingRecord.className,
      sectionId: req.body?.sectionId ?? existingRecord.sectionId,
      sectionName: req.body?.sectionName ?? existingRecord.sectionName,
      classSection: req.body?.classSection ?? existingRecord.classSection,
    };

    const { dayKey, takenAt, formattedStudents, attendancePayload } =
      await prepareAttendanceRequest(req, mergedBody, { excludeId: idStr(existingRecord) });

    let record;
    if (checkFallback()) {
      record = FallbackDb.update('attendance', idStr(existingRecord), attendancePayload);
    } else {
      Object.assign(existingRecord, attendancePayload);
      record = await existingRecord.save();
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: 'UPDATE',
      module: 'attendance',
      recordId: idStr(record),
      details: `Updated ${attendancePayload.type} attendance for ${attendancePayload.classSection || attendancePayload.className} (${formattedStudents.length} members, Date: ${dayKey}, Updated On: ${takenAt.toISOString()})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, 'Attendance updated successfully', { record });
  } catch (error) {
    console.error('updateAttendance error:', error);
    if (error.statusCode) return sendError(res, error.message, error.statusCode);
    return sendError(res, error.message || 'Server error', 500, error);
  }
};

/**
 * Retrieves dynamic aggregate attendance statistics for institution or specific class/section.
 */
export const getAttendanceStats = async (req, res) => {
  try {
    const scope = getAcademicScope();
    const { timeZone, todayDay } = await resolveSchoolClock(req);
    const isTeacher = String(req.query.type || '').toLowerCase() === 'teacher';
    const cls = req.query.class || req.query.className || req.query.classId;
    const sec = req.query.section || req.query.sectionName || req.query.sectionId;

    let totalMembersCount = 0;
    let totalClassesCount = 0;

    if (isTeacher) {
      const schoolId = getSchool(req);
      let teachers = checkFallback()
        ? await readProcurement(req).find('teachers')
        : await Teacher.find({ schoolId, status: { $ne: 'inactive' } })
            .select('department status')
            .lean();
      teachers = teachers.filter((t) => t.status !== 'inactive');
      if (sec && sec !== 'all' && classKey(sec) !== 'all departments') {
        teachers = teachers.filter((t) => classKey(t.department) === classKey(sec));
      }
      totalMembersCount = teachers.length;
      const distinctDepts = new Set(teachers.map((t) => String(t.department || 'General').trim()));
      totalClassesCount = distinctDepts.size;
    } else {
      const roster = scope ? await scopedStudentRoster(req, { personal: false }) : null;
      if (roster) {
        const grade = cls && cls !== 'all' ? gradeByValue(scope.grades, cls) : null;
        const resolvedSec = sec && sec !== 'all' ? sectionByValue(sec) : null;
        const activeRoster = roster.filter((s) => {
          if (s.status === 'inactive' || s.status === 'Passout') return false;
          if (cls && cls !== 'all') {
            if (grade) {
              if (String(s.classId) !== grade.id && classKey(s.className) !== classKey(grade.name))
                return false;
            } else if (classKey(s.className || s.class) !== classKey(cls)) {
              return false;
            }
          }
          if (resolvedSec && !sectionMatches(resolvedSec, s)) return false;
          return true;
        });
        totalMembersCount = activeRoster.length;
      } else if (checkFallback()) {
        const schoolId = getSchool(req);
        let stList = (FallbackDb.find('students') || []).filter(
          (s) =>
            String(s.schoolId || 'IQRA_P01001').toUpperCase() === schoolId &&
            s.status !== 'inactive' &&
            s.status !== 'Passout'
        );
        if (cls && cls !== 'all') {
          stList = stList.filter((s) => classKey(s.className || s.class) === classKey(cls));
        }
        if (sec && sec !== 'all') {
          stList = stList.filter((s) => sectionMatches(sec, s));
        }
        totalMembersCount = stList.length;
      } else {
        const stFilter = { status: { $nin: ['inactive', 'Passout'] } };
        if (cls && cls !== 'all') {
          stFilter.$or = [
            { class: new RegExp(`^${escapeRegex(cls)}$`, 'i') },
            { className: new RegExp(`^${escapeRegex(cls)}$`, 'i') },
            { classId: cls },
          ];
        }
        if (sec && sec !== 'all') {
          const resolvedSec = sectionByValue(sec);
          stFilter.$and = stFilter.$and || [];
          stFilter.$and.push({
            $or: [
              { section: new RegExp(`^${escapeRegex(sec)}$`, 'i') },
              { sectionName: new RegExp(`^${escapeRegex(sec)}$`, 'i') },
              ...(resolvedSec
                ? [{ sectionId: resolvedSec.id }, { sectionName: resolvedSec.name }]
                : []),
            ],
          });
        }
        totalMembersCount = await Student.countDocuments(stFilter);
      }

      const hasClassFilter = Boolean(cls && cls !== 'all');
      const hasSectionFilter = Boolean(sec && sec !== 'all');
      const configuredSections = await buildDynamicClassSections(req, scope);
      const clsGrade = hasClassFilter && scope?.grades ? gradeByValue(scope.grades, cls) : null;
      const matchingSections = configuredSections.filter((cs) => {
        if (hasClassFilter) {
          const matchesCls = clsGrade
            ? String(cs.classId) === clsGrade.id ||
              classKey(cs.className) === classKey(clsGrade.name)
            : classKey(cs.className) === classKey(cls) || String(cs.classId) === String(cls);
          if (!matchesCls) return false;
        }
        if (hasSectionFilter && !sectionMatches(sec, cs)) return false;
        return true;
      });
      totalClassesCount =
        hasClassFilter || hasSectionFilter
          ? matchingSections.length
          : configuredSections.length ||
            scope?.grades?.length ||
            (checkFallback()
              ? (FallbackDb.find('classes') || []).length
              : await Class.countDocuments({}));
    }

    let records = [];
    let todayRecords = [];
    if (checkFallback()) {
      const list = FallbackDb.find('attendance') || [];
      records = filterFallbackList(list, req.query, timeZone, scope);
      todayRecords = filterFallbackList(
        list,
        {
          type: req.query.type,
          class: req.query.class,
          section: req.query.section,
          date: todayDay,
        },
        timeZone,
        scope
      );
    } else {
      const [filteredRecs, todayRecs] = await Promise.all([
        Attendance.find(buildMongoFilter(req.query, scope)).lean(),
        Attendance.find(
          buildMongoFilter(
            {
              type: req.query.type,
              class: req.query.class,
              section: req.query.section,
              date: todayDay,
            },
            scope
          )
        ).lean(),
      ]);
      const statsDateRange = parseDateRange(req.query);
      records = statsDateRange
        ? filteredRecs.filter((r) => {
            const dk = recordDayKey(r, timeZone);
            if (statsDateRange.dayKey) return dk === statsDateRange.dayKey;
            if (statsDateRange.startKey && (!dk || dk < statsDateRange.startKey)) return false;
            if (statsDateRange.endKey && (!dk || dk > statsDateRange.endKey)) return false;
            return true;
          })
        : filteredRecs;
      todayRecords = todayRecs.filter((r) => recordDayKey(r, timeZone) === todayDay);
    }

    let todayPresent = 0;
    let todayAbsent = 0;
    let todayLate = 0;
    let todayHalfDay = 0;
    let todayLeave = 0;
    const todayMarkedClasses = new Set();

    todayRecords.forEach((r) => {
      const c = extractRecordCounts(r);
      todayPresent += c.present;
      todayAbsent += c.absent;
      todayLate += c.late;
      todayHalfDay += c.halfDay;
      todayLeave += c.leave;
      const cKey = isTeacher
        ? classKey(r.sectionName || 'All Departments')
        : `${r.classId || r.className}::${r.sectionId || r.sectionName}`;
      if (cKey) todayMarkedClasses.add(cKey);
    });

    let present = 0;
    let absent = 0;
    let late = 0;
    let halfDay = 0;
    let leave = 0;
    let totalMembersInRecords = 0;

    records.forEach((r) => {
      const c = extractRecordCounts(r);
      present += c.present;
      absent += c.absent;
      late += c.late;
      halfDay += c.halfDay;
      leave += c.leave;
      totalMembersInRecords += c.total || c.present + c.absent + c.late + c.halfDay + c.leave;
    });

    const notTakenClasses = Math.max(0, totalClassesCount - todayMarkedClasses.size);
    const effectivePresent = present + halfDay * 0.5;
    const divisor = totalMembersInRecords || present + absent + late + halfDay + leave;
    const percentage =
      divisor > 0 ? Math.min(100, Math.round((effectivePresent / divisor) * 100)) : 0;

    return sendSuccess(res, undefined, {
      stats: {
        totalStudents: totalMembersCount,
        totalClasses: totalClassesCount,
        todayMarkedClasses: todayMarkedClasses.size,
        todayPresent,
        todayAbsent,
        todayLate,
        todayHalfDay,
        todayLeave,
        notTaken:
          totalClassesCount === 0
            ? '0 Configured'
            : notTakenClasses > 0
              ? `${notTakenClasses} Pending`
              : 'All Marked',
        notTakenClasses,
        overallAttendance: `${percentage}%`,
        present,
        absent,
        late,
        halfDay,
        leave,
        total: totalMembersInRecords || totalMembersCount,
        percentage,
        recordsCount: records.length,
      },
    });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Retrieves attendance logs and compliance statistics for a specific student.
 */
export const getStudentAttendance = async (req, res) => {
  try {
    const studentId = req.params.studentId || req.query.studentId;
    if (!studentId) {
      return sendBadRequest(res, 'Student ID is required');
    }

    const { timeZone } = await resolveSchoolClock(req);
    const { date, startDate, endDate, year, month, status } = req.query;
    const dateRange = parseDateRange({ date, startDate, endDate, month, year });

    let attList = [];
    if (checkFallback()) {
      attList = FallbackDb.find('attendance') || [];
    } else {
      const queryFilter = {
        $or: [
          { 'students.studentId': studentId },
          { 'records.memberId': isValidObjectId(studentId) ? studentId : null },
          { 'records.studentId': studentId },
          { 'attendance.studentId': studentId },
          { 'students._id': isValidObjectId(studentId) ? studentId : null },
        ],
      };

      if (dateRange) {
        if (dateRange.dayKey) {
          queryFilter.$and = [buildDayWindowFilter(dateRange.dayKey)];
        } else {
          queryFilter.$and = [
            {
              $or: [
                { date: { $gte: dateRange.start, $lte: dateRange.end } },
                { attendanceDate: { $gte: dateRange.start, $lte: dateRange.end } },
              ],
            },
          ];
        }
      }

      attList = await Attendance.find(queryFilter)
        .sort({ attendanceDate: -1, date: -1, attendanceTakenDate: -1 })
        .lean();
    }

    const logs = [];
    attList.forEach((att) => {
      const dk = recordDayKey(att, timeZone);
      if (dateRange) {
        if (dateRange.dayKey && dk !== dateRange.dayKey) return;
        if (dateRange.startKey && dk < dateRange.startKey) return;
        if (dateRange.endKey && dk > dateRange.endKey) return;
        if (!dateRange.dayKey && !dateRange.startKey && !dateRange.endKey) {
          const d = new Date(att.attendanceDate || att.date);
          if (d < dateRange.start || d > dateRange.end) return;
        }
      }

      const studentList = att.students || att.attendance || att.records || [];
      const item = studentList.find(
        (r) =>
          String(r.studentId) === String(studentId) ||
          String(r.memberId) === String(studentId) ||
          String(r.id) === String(studentId) ||
          String(r._id) === String(studentId)
      );
      if (!item) return;

      const rawStatus =
        normalizeAttendanceStatus(item.status || 'present') ||
        String(item.status || 'present').toLowerCase();
      if (status && status !== 'all' && rawStatus !== status.toLowerCase()) {
        return;
      }

      const formattedStatus = formatStatusLabel(rawStatus);
      const dayDate = dk
        ? new Date(`${dk}T00:00:00.000Z`)
        : new Date(att.attendanceDate || att.date);
      const attDateStr = dk || dayDate.toISOString().split('T')[0];
      const dayName = dayDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
      const takenDate = att.attendanceTakenDate || att.createdAt || att.date;
      const takenDayKey =
        takenDate && !isNaN(new Date(takenDate).getTime())
          ? schoolClock(new Date(takenDate), timeZone).day
          : attDateStr;

      logs.push({
        id: idStr(att),
        date: attDateStr,
        dayName,
        attendanceDate: att.attendanceDate || att.date,
        attendanceTakenDate: takenDate,
        isPastDate: Boolean(attDateStr && takenDayKey && attDateStr !== takenDayKey),
        status: formattedStatus,
        remarks: item.remarks || '—',
        className: att.className || '—',
        sectionName: att.sectionName || '—',
        classSection:
          att.classSection ||
          (att.className && att.sectionName
            ? `${att.className} - ${att.sectionName}`
            : att.className || '—'),
        markedBy: att.takenBy?.name || 'Administration',
      });
    });

    logs.sort((a, b) => b.date.localeCompare(a.date));

    const presentCount = logs.filter((l) => l.status === 'Present').length;
    const absentCount = logs.filter((l) => l.status === 'Absent').length;
    const lateCount = logs.filter((l) => l.status === 'Late').length;
    const halfDayCount = logs.filter((l) => l.status === 'Half Day').length;
    const leaveCount = logs.filter((l) => l.status === 'Leave').length;

    const totalDays = logs.length;
    const denominator = Math.max(1, totalDays - leaveCount);
    const effectivePresent = presentCount + halfDayCount * 0.5;
    const percentage = totalDays
      ? `${Math.min(100, Math.round((effectivePresent / denominator) * 100))}%`
      : '0%';

    return sendSuccess(res, undefined, {
      studentId,
      filter: {
        date: date || null,
        startDate: startDate || null,
        endDate: endDate || null,
        year: year || null,
        month: month || null,
        status: status || 'all',
      },
      summary: {
        totalDays,
        presentCount,
        absentCount,
        lateCount,
        halfDayCount,
        leaveCount,
        percentage,
      },
      logs,
    });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Retrieves attendance logs and compliance metrics for the currently logged in user.
 */
export const getMyAttendance = async (req, res) => {
  try {
    const role = String(req.user?.role || 'student').toLowerCase();
    const { timeZone } = await resolveSchoolClock(req);
    const candidateIds = new Set(
      [req.user?.profileId, req.user?._id, req.user?.id, req.user?.studentId]
        .filter(Boolean)
        .map(String)
    );

    if (role !== 'student' && !req.user?.profileId) {
      if (checkFallback()) {
        const teachers = await readProcurement(req).find('teachers');
        const matched = teachers.find(
          (t) =>
            (req.user?._id && String(t.user) === String(req.user._id)) ||
            (req.user?.employeeId && t.employeeId === req.user.employeeId) ||
            (req.user?.email && t.email === req.user.email)
        );
        if (matched) candidateIds.add(idStr(matched));
      } else {
        const teacherProfile = await Teacher.findOne({
          schoolId: getSchool(req),
          $or: [
            ...(isValidObjectId(req.user?._id) ? [{ user: req.user._id }] : []),
            ...(req.user?.employeeId ? [{ employeeId: req.user.employeeId }] : []),
            ...(req.user?.email ? [{ email: req.user.email }] : []),
          ],
        })
          .select('_id')
          .lean();
        if (teacherProfile?._id) candidateIds.add(String(teacherProfile._id));
      }
    }

    const idList = [...candidateIds];
    let rawRecords = [];
    if (checkFallback()) {
      rawRecords = FallbackDb.find('attendance') || [];
    } else if (idList.length) {
      const objectIds = idList.filter((id) => isValidObjectId(id));
      rawRecords = await Attendance.find({
        $or: [
          { 'students.studentId': { $in: idList } },
          { 'records.studentId': { $in: idList } },
          { 'attendance.studentId': { $in: idList } },
          ...(objectIds.length
            ? [{ 'records.memberId': { $in: objectIds } }, { 'students._id': { $in: objectIds } }]
            : []),
        ],
      })
        .sort({ attendanceDate: -1, date: -1, attendanceTakenDate: -1 })
        .lean();
    }

    const logs = [];
    rawRecords.forEach((att) => {
      const studentList = att.students || att.attendance || att.records || [];
      const item = studentList.find((r) =>
        [r.studentId, r.memberId, r.id, r._id]
          .filter(Boolean)
          .some((val) => candidateIds.has(String(val)))
      );
      if (!item) return;

      const dk = recordDayKey(att, timeZone);
      const dayDate = dk
        ? new Date(`${dk}T00:00:00.000Z`)
        : new Date(att.attendanceDate || att.date || Date.now());
      const dateStr = dk || dayDate.toISOString().split('T')[0];
      const dayName = dayDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
      const statusFormatted = formatStatusLabel(item.status || 'present');
      const takenAt = att.attendanceTakenDate || att.createdAt;
      const recordedTime =
        item.checkIn ||
        (takenAt && !isNaN(new Date(takenAt).getTime())
          ? new Date(takenAt).toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              timeZone,
            })
          : '—');

      logs.push({
        id: idStr(att) || `att-${logs.length + 1}`,
        date: dateStr,
        attendanceDate: att.attendanceDate || att.date,
        attendanceTakenDate: takenAt,
        dayName,
        status: statusFormatted,
        checkIn: recordedTime,
        checkOut: item.checkOut || '—',
        remarks: item.remarks || '—',
        className: att.classSection || att.className || '—',
        markedBy: att.takenBy?.name || 'Administration',
      });
    });

    logs.sort((a, b) => b.date.localeCompare(a.date));

    const presentCount = logs.filter((l) => l.status === 'Present').length;
    const absentCount = logs.filter((l) => l.status === 'Absent').length;
    const halfDayCount = logs.filter((l) => l.status === 'Half Day').length;
    const lateCount = logs.filter((l) => l.status === 'Late').length;
    const leaveCount = logs.filter((l) => l.status === 'Leave').length;
    const totalDays = logs.length;
    const effectiveDays = presentCount + halfDayCount * 0.5;
    const denominator = Math.max(1, totalDays - leaveCount);
    const percentage = totalDays
      ? `${Math.min(100, Math.round((effectiveDays / denominator) * 100))}%`
      : 'N/A';

    return sendSuccess(res, undefined, {
      userRole: role,
      summary: {
        totalDays,
        presentCount,
        absentCount,
        halfDayCount,
        lateCount,
        leaveCount,
        percentage,
      },
      logs,
    });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};
