import { gradeByValue } from './academicClass.js';
import tenantContext from './tenantContext.js';

// Collections with records that belong to one academic session.
export const academicCollections = {
  attendance: 'attendance',
  exams: 'exam',
  results: 'class',
  homework: 'class',
  onlineClasses: 'class',
  syllabus: 'class',
  curriculums: 'class',
  classTimetables: 'class',
  classRooms: 'class',
  masterPeriods: 'school',
  fees: 'optionalClass',
  expenses: 'school',
  inventoryTransactions: 'school',
  inventoryIssuances: 'optionalClass',
  leaveRequests: 'optionalClass',
  leaves: 'optionalClass',
  issuedCertificates: 'optionalClass',
  library: 'optionalClass',
  transportAssignments: 'optionalClass',
  hostelOccupancies: 'optionalClass',
  notices: 'optionalClass',
  notifications: 'optionalClass',
};

export function getAcademicScope() {
  return tenantContext.getStore()?.academicScope || null;
}

export function academicError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function academicGrade(scope, value) {
  const grade = gradeByValue(scope.grades, value) ||
    gradeByValue(scope.grades, String(value || '').split(/_sec-|\s+[–—-]\s+/)[0]);
  if (!grade) throw academicError('Choose a class in the selected academic session.');
  return grade;
}

export function academicFields(scope, collection, input, { creating = false } = {}) {
  if (scope.readOnly) throw academicError('This academic session is read-only.', 409);
  if (input.sessionId && String(input.sessionId) !== scope.sessionId) {
    throw academicError('The record belongs to a different academic session.', 409);
  }
  const kind = academicCollections[collection];
  const fields = creating ? { sessionId: scope.sessionId } : {};
  if (collection === 'syllabus' && (creating || 'academicYear' in input)) {
    fields.academicYear = scope.session.sessionName;
  }
  if (kind === 'exam') {
    const ids = input.classTargets?.length ? input.classTargets.map((target) => target.classId)
      : input.classIds?.length ? input.classIds : input.classNames?.length ? input.classNames : input.classes;
    if (ids?.length) {
      const grades = [...new Map(ids.map((value) => {
        const grade = academicGrade(scope, value);
        return [grade.id, grade];
      })).values()];
      fields.classIds = grades.map((grade) => grade.id);
      fields.classNames = grades.map((grade) => grade.name);
      if (input.classTargets?.length) {
        fields.classTargets = input.classTargets.map((target) => {
          const grade = academicGrade(scope, target.classId);
          return { classId: grade.id, className: grade.name, sectionId: target.sectionId, sectionName: target.sectionName };
        });
      }
    } else if (creating || ids) throw academicError('Select at least one exam class.');
    if (creating) fields.session = scope.session.sessionName;
    return fields;
  }

  if (kind === 'school' || (kind === 'attendance' && input.type === 'teacher')) return fields;
  const value = input.classId || input.className || input.class || input.classSectionKey || input.classSection;
  const schoolWide = value && /^(all|all classes|all staff|general|teacher|teachers)$/i.test(String(value));
  if (value && !schoolWide) {
    const grade = academicGrade(scope, value);
    fields.classId = grade.id;
    if ('className' in input && !input.classSectionKey) fields.className = grade.name;
  } else if (creating && (kind === 'class' || kind === 'attendance')) {
    throw academicError('A class is required for this academic record.');
  }
  return fields;
}
