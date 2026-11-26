import { checkFallback } from '../config/db.js';
import Attendance from '../models/Attendance.js';
import Fee from '../models/Fee.js';
import Result from '../models/Result.js';
import Transport from '../models/Transport.js';
import TransportAssignment from '../models/TransportAssignment.js';
import { FallbackDb } from '../services/dbFallback.js';
import { findScopedEnrollment, scopedStudentRoster } from '../services/studentEnrollmentService.js';
import { getSchool } from '../services/procurementStore.js';
import { academicError, getAcademicScope } from '../utils/academicScope.js';
import { sendCreated, sendError, sendSuccess } from '../utils/responseUtil.js';

const handle = (run) => async (req, res) => {
  try {
    return await run(req, res);
  } catch (error) {
    if (error.code === 11000) return sendError(res, 'This student or placement is already assigned for the session.', 409);
    return sendError(res, error.message, error.statusCode || 500);
  }
};
const clean = (value) => typeof value === 'string' ? value.trim() : '';
const rows = (req, model, collection, filter = {}) => checkFallback()
  ? FallbackDb.find(collection).filter((row) =>
    String(row.schoolId || 'IQRA_P01001') === getSchool(req) &&
    Object.entries(filter).every(([key, value]) => String(row[key]) === String(value)))
  : model.find({ schoolId: getSchool(req), ...filter }).lean();

async function assignmentStudent(req) {
  const scope = getAcademicScope();
  if (!scope?.sessionId || scope.readOnly) throw academicError('Select a configured active session.', 409);
  const enrollment = await findScopedEnrollment(req, req.body.studentId);
  if (!enrollment || enrollment.status !== 'active') throw academicError('Select a student enrolled in this session.');
  return {
    sessionId: scope.sessionId, schoolId: scope.schoolId, studentId: enrollment.studentId,
    studentName: enrollment.studentName, classId: enrollment.classId, className: enrollment.className,
  };
}

const ownStudent = (req) => req.user?.role === 'student'
  ? { studentId: req.user.profileId || req.user._id || req.user.id } : {};

export const getTransportAssignments = handle(async (req, res) =>
  sendSuccess(res, undefined, { assignments: await rows(req, TransportAssignment, 'transportAssignments', ownStudent(req)) })
);

export const createTransportRoute = handle(async (req, res) => {
  const routeName = clean(req.body.routeName);
  const busNumber = clean(req.body.busNumber);
  const driverName = clean(req.body.driverName);
  const driverContact = clean(req.body.driverContact);
  const fare = Number(req.body.fare);
  if (!routeName || !busNumber || !driverName || !driverContact || !Number.isFinite(fare) || fare < 0) {
    throw academicError('Enter a route name, bus number, driver details, and valid fare.');
  }
  const record = { schoolId: getSchool(req), routeName, busNumber, driverName, driverContact, fare };
  if (checkFallback()) {
    const routes = await rows(req, Transport, 'transport');
    if (routes.some((route) => route.routeName === routeName || route.busNumber === busNumber)) {
      throw academicError('This route or bus number already exists.', 409);
    }
  }
  const route = checkFallback() ? FallbackDb.create('transport', record) : await Transport.create(record);
  return sendCreated(res, 'Transport route saved.', { route });
});

export const createTransportAssignment = handle(async (req, res) => {
  const student = await assignmentStudent(req);
  const routes = await rows(req, Transport, 'transport');
  const route = routes.find((item) => String(item._id || item.id) === String(req.body.routeId));
  if (!route) throw academicError('Choose a transport route in this school.');
  const record = {
    ...student, routeId: route._id || route.id, routeName: route.routeName,
    pickupStop: clean(req.body.pickupStop),
  };
  if (checkFallback() && FallbackDb.findOne('transportAssignments', { studentId: student.studentId })) {
    throw academicError('The student already has a route assignment in this session.', 409);
  }
  const assignment = checkFallback() ? FallbackDb.create('transportAssignments', record) : await TransportAssignment.create(record);
  return sendCreated(res, 'Transport assignment saved.', { assignment });
});

export const getAcademicReports = handle(async (req, res) => {
  const scope = getAcademicScope();
  if (!scope) return sendSuccess(res, undefined, { classes: [], summary: null });
  const [roster, attendance, fees, results] = await Promise.all([
    scopedStudentRoster(req),
    rows(req, Attendance, 'attendance'),
    rows(req, Fee, 'fees'),
    rows(req, Result, 'results', { status: 'published' }),
  ]);
  const byClass = new Map(scope.grades.map((grade) => [grade.id, {
    classId: grade.id, className: grade.name, students: 0, passout: 0,
    present: 0, attendanceTotal: 0, amountPaid: 0, graded: 0, passed: 0,
  }]));
  const count = (row, field, value) => {
    const group = byClass.get(String(row.classId));
    if (group) group[field] += Number(value) || 0;
  };
  for (const student of roster || []) {
    count(student, 'students', 1);
    count(student, 'passout', student.status === 'Passout' ? 1 : 0);
  }
  for (const row of attendance.filter((item) => item.type !== 'teacher')) {
    count(row, 'present', row.present);
    count(row, 'attendanceTotal', row.total);
  }
  for (const fee of fees) count(fee, 'amountPaid', fee.amountPaid);
  for (const result of results) {
    count(result, 'graded', 1);
    count(result, 'passed', result.isPassed ? 1 : 0);
  }
  return sendSuccess(res, undefined, {
    classes: [...byClass.values()],
    summary: {
      students: roster?.length || 0,
      amountPaid: fees.reduce((sum, fee) => sum + (Number(fee.amountPaid) || 0), 0),
      results: results.length,
    },
  });
});
