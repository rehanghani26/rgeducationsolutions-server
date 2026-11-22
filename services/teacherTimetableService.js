import { classKey, gradeByValue, sectionNamesById, standardGrade } from '../utils/academicClass.js';
import { getAcademicScope } from '../utils/academicScope.js';
import { recordId, recordIds } from '../utils/procurementValues.js';
import { listClassTimetables } from './masterPeriodService.js';
import { readProcurement } from './procurementStore.js';

const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const dayOrder = new Map(weekdays.map((day, index) => [day, index]));
const text = (value) => String(value ?? '').trim();
const nameKey = (teacher) => classKey(teacher.name || [teacher.firstName, teacher.lastName].filter(Boolean).join(' '));
const orderOf = (slot) => {
  const value = Number(slot.periodOrder);
  return Number.isInteger(value) && value > 0 ? value : 0;
};

function classroomNames(timetable, grades) {
  const [classFromKey, sectionFromKey] = text(timetable.classSectionKey).split(/\s+[-\u2013\u2014]\s+|_(?=sec-)/i, 2);
  const gradeName = text((sectionFromKey ? classFromKey : timetable.className || classFromKey) || timetable.classId);
  const grade = gradeByValue(grades, timetable.classId) || gradeByValue(grades, gradeName) || standardGrade(gradeName);
  const section = text(timetable.sectionName || sectionFromKey || timetable.sectionId);
  const sectionCode = classKey(section).replace(/^(section\s+|sec-)/, '');
  const sectionFromId = Object.hasOwn(sectionNamesById, timetable.sectionId) ? sectionNamesById[timetable.sectionId] : '';
  return {
    className: grade?.name || gradeName,
    sectionName: sectionFromId || sectionNamesById['sec-' + sectionCode] || section,
  };
}

function periodsByDay(allocations) {
  const grouped = new Map();
  for (const slot of allocations || []) {
    if (!slot) continue;
    const key = classKey(slot.day);
    const day = weekdays.find((value) => value === key || value.slice(0, 3) === key) || key;
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day).push(slot);
  }
  return grouped;
}

async function teacherNamesForLegacySlots(req, teachers, timetables) {
  const requested = new Set(teachers.map(nameKey).filter(Boolean));
  const names = new Map();
  const hasNameOnly = timetables.some((timetable) => (timetable.allocations || []).some((slot) =>
    !text(slot?.teacherId) && requested.has(classKey(slot?.teacherName))));
  if (!hasNameOnly) return names;

  // Resolve name-only records across the whole school, including teachers outside the requested page.
  for (const teacher of await readProcurement(req).find('teachers')) {
    const name = nameKey(teacher);
    if (requested.has(name)) names.set(name, names.has(name) ? null : String(recordId(teacher)));
  }
  return names;
}

export async function readTeacherPeriods(req, teachers) {
  const periods = new Map(teachers.map((teacher) => [String(recordId(teacher)), []]));
  if (!teachers.length) return periods;

  const timetables = await listClassTimetables(req);
  const grades = getAcademicScope()?.grades || [];
  const teachersById = new Map(teachers.flatMap((teacher) =>
    recordIds(teacher).map((id) => [classKey(id), String(recordId(teacher))])));
  for (const teacher of teachers) {
    const accountId = teacher.user?.toHexString?.() || recordId(teacher.user) || teacher.user;
    for (const key of [teacher.employeeId, accountId].map(classKey).filter(Boolean)) {
      if (!teachersById.has(key)) teachersById.set(key, String(recordId(teacher)));
    }
  }
  const teachersByName = await teacherNamesForLegacySlots(req, teachers, timetables);

  for (const timetable of timetables) {
    const classroom = classroomNames(timetable, grades);
    for (const [day, slots] of periodsByDay(timetable.allocations)) {
      slots.sort((left, right) => orderOf(left) - orderOf(right) || text(left.startTime).localeCompare(text(right.startTime)));
      const completeDay = slots.every((slot, index) => orderOf(slot) === index + 1);
      let teachingNumber = 0;
      for (const [index, slot] of slots.entries()) {
        const order = orderOf(slot) || index + 1;
        const teaching = !slot.periodType || ['class', 'teaching'].includes(slot.periodType);
        if (teaching) teachingNumber += 1;
        const teacherId = classKey(slot.teacherId);
        const teacher = teacherId ? teachersById.get(teacherId) : teachersByName.get(classKey(slot.teacherName));
        if (!periods.has(teacher)) continue;
        periods.get(teacher).push({
          id: [recordId(timetable), recordId(slot) || day + '-' + index].join('-'),
          day,
          periodOrder: order,
          periodLabel: teaching ? 'Period ' + (completeDay ? teachingNumber : order) : text(slot.customLabel) || 'Slot ' + order,
          startTime: text(slot.startTime),
          endTime: text(slot.endTime),
          subject: text(slot.subject),
          roomNo: text(slot.roomNo),
          ...classroom,
        });
      }
    }
  }

  for (const rows of periods.values()) {
    rows.sort((left, right) =>
      (dayOrder.get(left.day) ?? weekdays.length) - (dayOrder.get(right.day) ?? weekdays.length)
      || left.day.localeCompare(right.day)
      || (left.startTime || '99:99').localeCompare(right.startTime || '99:99')
      || left.periodOrder - right.periodOrder
      || left.className.localeCompare(right.className)
      || left.sectionName.localeCompare(right.sectionName));
  }
  return periods;
}

export function summarizeTeacherPeriods(periods = []) {
  const names = (key) => {
    const unique = new Map();
    for (const period of periods) {
      const value = period[key];
      if (value && !unique.has(classKey(value))) unique.set(classKey(value), value);
    }
    return [...unique.values()];
  };
  return {
    subjectsAssigned: names('subject'),
    classesAssigned: names('className'),
    sectionsAssigned: names('sectionName'),
  };
}
