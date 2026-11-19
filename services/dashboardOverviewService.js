import mongoose from 'mongoose';
import { checkFallback } from '../config/db.js';
import AcademicSession from '../models/AcademicSession.js';
import Attendance from '../models/Attendance.js';
import Class from '../models/Class.js';
import ClassRoom from '../models/ClassRoom.js';
import ClassTimetable from '../models/ClassTimetable.js';
import Exam from '../models/Exam.js';
import Fee from '../models/Fee.js';
import Homework from '../models/Homework.js';
import Library from '../models/Library.js';
import Notice from '../models/Notice.js';
import Result from '../models/Result.js';
import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import {
  campusOverview, campusStudentMetrics, dashboardDay, dayStart, matchesStudentPlacement, recentMonths,
  recordId, rowIds, shiftDay, studentOverview,
} from '../utils/dashboardMetrics.js';
import { FallbackDb } from './dbFallback.js';

const attendanceFields = 'date attendanceDate attendanceTakenDate createdAt updatedAt type students attendance records';
const studentFields = 'name firstName lastName user admissionNumber rollNumber className classId class sectionName sectionId section sessionId academicYear currentClassRoomId';
const examFields = 'name title term date status classIds classNames classes subjectSchedule.examDate';

function schoolRecords(schoolId) {
  return (collection) => FallbackDb.find(collection).filter((item) =>
    item.schoolId ? String(item.schoolId).toUpperCase() === schoolId : schoolId === 'IQRA_P01001'
  );
}

function dateRange(from, through) {
  return { $gte: dayStart(from), $lt: dayStart(shiftDay(through, 1)) };
}

function classValues(student) {
  const code = recordId(student.classId);
  const name = student.className || student.class;
  const numeric = String(name || code).match(/^(?:(?:class|grade|cls)[-\s]*)?(\d{1,2})$/i)?.[1];
  const aliases = numeric ? [numeric, 'Class ' + numeric, 'cls-' + numeric] : [];
  return [...new Set([student.classId, code, name, ...aliases].filter(Boolean))];
}

function attendanceQuery(schoolId, from, today) {
  const range = dateRange(from, today);
  return {
    schoolId,
    type: { $ne: 'teacher' },
    $or: [{ attendanceDate: range }, { date: range }],
  };
}

function futureExams(schoolId, today) {
  const range = { $gte: dayStart(today) };
  return Exam.find({
    schoolId,
    status: { $ne: 'completed' },
    $or: [{ date: range }, { 'subjectSchedule.examDate': range }],
  }).select(examFields).lean();
}

function noticesQuery(schoolId, roles) {
  return Notice.find({
    schoolId, active: { $ne: false },
    $or: [{ targetRoles: { $size: 0 } }, { targetRoles: { $exists: false } }, { targetRoles: { $in: ['all', ...roles] } }],
  }).select('title content category createdAt pinned').sort({ pinned: -1, createdAt: -1 }).limit(5).lean();
}

const visibleNotice = (notice, roles) => notice.active !== false
  && (!notice.targetRoles?.length || notice.targetRoles.some((role) => role === 'all' || roles.includes(role)));

async function findStudent(user, schoolId, records) {
  const ids = [...new Set([user.profileId, user._id, user.id, user.userId].filter(Boolean).map(String))];
  if (records) {
    return records('students').find((student) => rowIds(student).some((id) => ids.includes(id))
      || ids.includes(recordId(student.user)));
  }
  const matching = ids.filter((id) => mongoose.isValidObjectId(id));
  if (!matching.length) return null;
  return Student.findOne({
    schoolId,
    $or: [{ _id: { $in: matching } }, { user: { $in: matching } }],
  }).select(studentFields).lean();
}

export async function loadStudentOverview(user, schoolId, now = new Date()) {
  const fallback = checkFallback();
  const records = fallback ? schoolRecords(schoolId) : null;
  const student = await findStudent(user, schoolId, records);
  if (!student) return null;

  const today = dashboardDay(now);
  const homeworkStart = shiftDay(today, -29);
  const homeworkEnd = shiftDay(today, 6);
  const learnerId = recordId(student);
  let attendance, homework, results, fees, loans, exams, timetable, notices;
  if (records) {
    const ids = rowIds(student);
    const belongsToStudent = (item) => ids.includes(recordId(item.studentId));
    attendance = records('attendance');
    homework = records('homework').filter((item) => ['published', 'closed'].includes(item.status));
    results = records('results').filter(belongsToStudent);
    fees = records('fees').filter(belongsToStudent);
    loans = records('library').filter(belongsToStudent);
    exams = records('exams');
    timetable = records('classTimetables');
    notices = records('notices').filter((item) => visibleNotice(item, ['student']));
  } else {
    const values = classValues(student);
    const placement = [{ classId: { $in: values } }, { className: { $in: values } }];
    const objectId = new mongoose.Types.ObjectId(learnerId);
    const matchingAttendance = ['students.studentId', 'attendance.studentId', 'records.studentId', 'records.memberId', 'students._id', 'students.id', 'students.memberId']
      .map((field) => ({ [field]: { $in: [learnerId, objectId] } }));
    [attendance, homework, results, fees, loans, exams, timetable, notices] = await Promise.all([
      Attendance.find({
        schoolId, type: { $ne: 'teacher' }, $or: matchingAttendance,
      }).setOptions({ strictQuery: false }).select(attendanceFields).lean(),
      Homework.find({
        schoolId,
        status: { $in: ['published', 'closed'] },
        dueDate: dateRange(homeworkStart, homeworkEnd),
        $or: placement,
      }).select('title subject dueDate status classId className sectionId sectionName submissions.student submissions.studentId').lean(),
      Result.find({ schoolId, studentId: learnerId, status: 'published' })
        .select('examName examTerm publishedAt createdAt updatedAt status marks totalObtained totalMaxMarks percentage')
        .sort({ publishedAt: -1, createdAt: -1 }).limit(6).lean(),
      Fee.find({ schoolId, studentId: learnerId }).select('amountPaid amountPending dueDate transactions.date transactions.amount').lean(),
      Library.find({ schoolId, studentId: learnerId, returnDate: null }).select('dueDate').lean(),
      futureExams(schoolId, today),
      ClassTimetable.find({
        schoolId,
        scheduleType: { $ne: 'exam' },
        $or: [...placement, ...(student.currentClassRoomId ? [{ classRoomId: student.currentClassRoomId }] : [])],
      }).select('allocations classId className sectionId sectionName classRoomId sessionId scheduleType updatedAt').lean(),
      noticesQuery(schoolId, ['student']),
    ]);
  }

  const overview = studentOverview({
    student, attendance, homework: homework.filter((item) => matchesStudentPlacement(item, student)),
    results, fees, loans, exams, timetable,
  }, today);
  return {
    ...overview,
    notices: notices.map((item) => ({
      id: recordId(item), title: item.title, date: dashboardDay(item.createdAt), message: item.content, pinned: item.pinned,
    })).sort((left, right) => Number(Boolean(right.pinned)) - Number(Boolean(left.pinned)) || right.date.localeCompare(left.date)).slice(0, 5),
  };
}

export async function loadCampusOverview(schoolId, role, { now = new Date(), studentDetails = false } = {}) {
  const today = dashboardDay(now);
  const rows = checkFallback() ? schoolRecords(schoolId) : null;
  const roles = [role, ...(role === 'admin' ? ['school-admin'] : [])];
  let students, teachers, classes, attendance, fees, exams, notices;
  if (rows) {
    students = rows('students');
    teachers = rows('teachers').length;
    const rooms = rows('classRooms');
    const active = rows('academicSessions').find((session) => session.isCurrent);
    const selected = active ? rooms.filter((room) => rowIds(active).includes(recordId(room.sessionId))) : rooms;
    classes = selected.length || rows('classes').length;
    attendance = rows('attendance');
    fees = rows('fees');
    exams = rows('exams');
    notices = rows('notices').filter((item) => visibleNotice(item, roles));
  } else {
    const active = await AcademicSession.findOne({ schoolId, isCurrent: true }).select('_id').lean();
    [students, teachers, classes, attendance, fees, exams, notices] = await Promise.all([
      Student.find({ schoolId }).select('admissionDate joiningDate createdAt' + (studentDetails
        ? ' name firstName lastName className class classId sectionName section sectionId status isLegacyStudent'
        : '')).lean(),
      Teacher.countDocuments({ schoolId }),
      ClassRoom.countDocuments({ schoolId, ...(active && { sessionId: active._id }) }),
      Attendance.find(attendanceQuery(schoolId, shiftDay(today, -6), today))
        .select(attendanceFields).lean(),
      Fee.find({ schoolId, 'transactions.date': dateRange(recentMonths(today)[0] + '-01', today) })
        .select('transactions.date transactions.amount').lean(),
      futureExams(schoolId, today),
      noticesQuery(schoolId, roles),
    ]);
    if (classes === 0 && !active) classes = await Class.countDocuments({ schoolId });
  }
  const overview = campusOverview({ students, teachers, classes, attendance, fees, exams, notices }, today);
  return studentDetails
    ? { ...overview, studentMetrics: campusStudentMetrics(students, overview.attendance, today) }
    : overview;
}
