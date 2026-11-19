import { dateOnly } from './commonUtil.js';

export const isLegacyStudent = (value) => value === true || value === 'true';

export const isStudentLegacyValue = (value) => [true, false, 'true', 'false'].includes(value);

export function currentAcademicYear(now = new Date()) {
  const start = now.getFullYear() - Number(now.getMonth() < 3);
  return `${start}-${String(start + 1).slice(-2)}`;
}

const rosterColumns = [
  ['Name', 'name'],
  ['Admission Number', 'admissionNumber'],
  ['Roll Number', 'rollNumber'],
  ['Class', 'classId'],
  ['Section', 'sectionId'],
  ['Parent', 'parentName'],
  ['Phone', 'contactNumber'],
  ['Status', 'status'],
  ['Admission Date', 'admissionDate', dateOnly],
  ['Admission Type', 'admissionType'],
  ['Enrollment Status', 'enrollmentStatus'],
  ['House', 'houseName'],
  ['Category', 'studentCategory'],
  ['Student Type', 'studentType'],
  ['Mother Name', 'motherName'],
  ['Mother Phone', 'motherContact'],
  ['Created', 'createdAt'],
  ['Legacy Student', 'isLegacyStudent', isLegacyStudent],
  ['Joining Date', 'joiningDate', dateOnly],
  ['Father Name', 'fatherName'],
];

export const studentRosterFields = rosterColumns.map(([, key]) => key).join(' ');

function spreadsheetCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export function studentRosterCsv(students) {
  const header = rosterColumns.map(([label]) => label).join(',');
  const rows = students.map((student) => rosterColumns
    .map(([, key, format]) => spreadsheetCell(format ? format(student[key]) : student[key]))
    .join(','));
  return '\uFEFF' + [header, ...rows].join('\r\n');
}
