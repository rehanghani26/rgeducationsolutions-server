import { readAcademicWorkspace, readClassroomAcademics, readPersonalAcademics } from '../../services/academicWorkspaceService.js';
import { academicsScope, roleOf } from '../../services/academicsAccess.js';
import { readProcurement } from '../../services/procurementStore.js';
import { sessionBudget } from '../../utils/procurementValues.js';
import { listMasterPeriods } from '../../services/masterPeriodService.js';
import { getActiveRoleConfig } from '../../middleware/rbac.js';
import { buildSetupStatus } from '../../controllers/setupController.js';
import Setting from '../../models/Setting.js';
import { checkFallback } from '../../config/db.js';
import { FallbackDb } from '../../services/dbFallback.js';

const definition = (name, description, properties = {}) => ({ name, description, parameters: { type: 'object', properties } });
export const workspaceDefinitions = [
  definition('getAcademicWorkspace', 'Current classes, sections, subjects and curriculum. For faculty returns their assigned classrooms. Pass a returned roomId for course chapters, books and timetable.', { roomId: { type: 'string' } }),
  definition('getMyAcademicPlan', 'Published subjects, syllabus, courses, books, timetable and results for the signed-in student or linked child.', { studentId: { type: 'string' } }),
  definition('getCurrentBudgetAllocation', 'Read the current academic session budget allocation and spending by category.'),
  definition('getRoleAccess', 'Read effective role permissions and view scope. School administrators can look up an institutional role.', { role: { type: 'string' } }),
  definition('getSchoolSetupOverview', 'Current school profile, calendar, bell schedule, grading rules and classroom timetable configuration status.'),
];
const managers = new Set(['super-admin', 'superadmin', 'school-admin', 'admin', 'principal', 'director']);
const faculty = new Set(['teacher', 'head-teacher', 'hod', 'coordinator']);
const attendanceWriters = new Set([...managers, 'teacher', 'head-teacher']);
const attendanceReaders = new Set([...managers, ...faculty, 'tg', 'counselor', 'councellor']);

export function permitsTool(name, user) {
  const role = roleOf({ user });
  if (!role) return false;
  if (name === 'getMyAcademicPlan') return ['student', 'parent'].includes(role);
  if (name === 'getMyAttendanceSummary' || name === 'getRoleAccess' || name === 'validateQueryRelevance') return true;
  if (name === 'markAttendance' || name === 'updateAttendanceRecord') return attendanceWriters.has(role);
  if (['getAttendanceStatus', 'getAttendanceByDate', 'getAttendanceStats', 'getLowAttendanceStudents'].includes(name)) {
    return attendanceReaders.has(role);
  }
  if (managers.has(role)) return true;
  if (faculty.has(role)) {
    // Faculty can access student tools, attendance, exams, results, homework, timetable, leaves, etc.
    const managerOnlyTools = new Set([
      'getCurrentBudgetAllocation',
      'getSchoolSetupOverview',
      'runSetupStep1_SchoolProfile',
      'runSetupStep2_AcademicSession',
      'runSetupStep3_MasterPeriods',
      'runSetupStep4_AcademicRules',
      'runSetupStep5_FinancePolicies',
      'deleteStudent',
      'deleteTeacher',
      'deleteAcademicSession',
    ]);
    return !managerOnlyTools.has(name);
  }
  if (name === 'getCurrentBudgetAllocation') return ['accountant', 'principal'].includes(role);
  if (name === 'getAcademicWorkspace') return ['teacher', 'head-teacher', 'hod', 'coordinator', 'principal', 'director'].includes(role);
  if (name === 'getSchoolSetupOverview') return managers.has(role);

  // Student and parent portal permissions
  if (['student', 'parent'].includes(role)) {
    const studentPermittedTools = new Set([
      'getStudents',
      'getStudentById',
      'getStudentIdCard',
      'getStudentComprehensiveReport',
      'getStudentLeaves',
      'applyStudentLeave',
      'getStudentAttendance',
      'getStudentAttendanceRecord',
      'getMyAttendanceSummary',
      'getStudentFee',
      'getStudentFeeLedger',
      'getStudentMarksheet',
      'getStudentAcademicReport',
      'getStudentTimetableSchedule',
      'getStudentHomework',
      'getStudentDocuments',
      'getStudentTransport',
      'getStudentLibrary',
      'getStudentMedicalProfile',
      'getStudentAnalytics',
      'getMyAcademicPlan',
      'getRoleAccess',
    ]);
    return studentPermittedTools.has(name);
  }

  // Allow general read tools by default
  return /^(get|list|find|search|export|view)/i.test(name);
}
export const workspaceExecutors = {
  async getAcademicWorkspace({ roomId }, context) {
    const req = { ...context, query: {} };
    const data = roomId ? await readClassroomAcademics(req, roomId) : await readAcademicWorkspace(req);
    return { success: true, ...data };
  },
  async getMyAcademicPlan({ studentId }, context) {
    return { success: true, ...await readPersonalAcademics({ ...context, query: { studentId } }) };
  },
  async getCurrentBudgetAllocation(_, context) {
    const scope = academicsScope();
    const budget = await sessionBudget(readProcurement(context), scope.session);
    const allocations = budget ? [
      ['Staff salaries', budget.salaryBudget, budget.salarySpent],
      ['School requirements', budget.schoolRequirementsBudget, budget.schoolRequirementsSpent],
      ['Operational buffer', budget.operationalBufferBudget, budget.operationalBufferSpent],
    ].map(([category, allocated, spent]) => ({ category, allocated: allocated ?? 0, spent: spent ?? 0 })) : [];
    return { success: true, session: scope.session.sessionName, totalBudget: budget?.totalBudget ?? null, allocations };
  },
  async getRoleAccess({ role }, context) {
    const own = roleOf(context);
    const target = administrators.has(own) && role ? role : own;
    const { modules, actions, viewScope } = await getActiveRoleConfig(context.schoolId || context.user.schoolId, target);
    return { success: true, role: target, modules, actions, viewScope };
  },
  async getSchoolSetupOverview(_, context) {
    const settings = checkFallback() ? FallbackDb.getSettings() : await Setting.findOne().lean();
    const { steps } = await buildSetupStatus(context, settings || {}, { recordCompletion: false });
    const scope = context.academicSessionId;
    const rooms = scope ? await readProcurement(context).find('classRooms', { sessionId: scope, status: 'active' }) : [];
    const linked = rooms.filter((room) => room.timetableId).length;
    const schedules = scope ? await listMasterPeriods(context) : [];
    return { success: true, steps, timetable: { linked, classrooms: rooms.length },
      schedules: schedules.map(({ name, type, days, periods, daySchedules, isDefault }) => ({ name, type, days, periods, daySchedules, isDefault })),
      passingPercentage: settings?.defaultPassingPercentage ?? null };
  },
};
