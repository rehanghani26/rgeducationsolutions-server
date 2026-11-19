import { isLegacyStudent } from './studentUtil.js';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});
const DAY_MS = 86400000;
const attendanceStatuses = {
  present: 'present', late: 'late', absent: 'absent',
  halfday: 'halfDay', leave: 'leave', onleave: 'leave', approvedleave: 'leave',
};

export function dashboardDay(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(dayFormat.formatToParts(date).map(({ type, value: part }) => [type, part]));
  return [parts.year, parts.month, parts.day].join('-');
}

export const shiftDay = (key, offset) => new Date(Date.parse(key) + offset * DAY_MS).toISOString().slice(0, 10);
export const dayStart = (key) => new Date(key + 'T00:00:00+05:30');

export function recentMonths(today) {
  const [year, month] = today.split('-').map(Number);
  return Array.from({ length: 6 }, (_, index) =>
    new Date(Date.UTC(year, month - 6 + index, 1)).toISOString().slice(0, 7)
  );
}

export const recordId = (value) => String(value?._id || value?.id || value || '');
export const rowIds = (row) => [...new Set([row?._id, row?.id].filter(Boolean).map(String))];
const placementKey = (value, prefix) => recordId(value).trim().toLowerCase()
  .replace(prefix, '').replace(/[^a-z0-9]/g, '');

export function matchesStudentPlacement(record, student, { allSections = true } = {}) {
  const classPrefix = /^(class|grade|cls)[\s-]*/i;
  const sectionPrefix = /^(section|sec)[\s-]*/i;
  const classKeys = [student.classId, student.class, student.className]
    .map((value) => placementKey(value, classPrefix)).filter(Boolean);
  const inClass = [record.classId, record.class, record.className]
    .some((value) => classKeys.includes(placementKey(value, classPrefix)));
  if (!inClass) return false;
  const sectionValues = [record.sectionId, record.section, record.sectionName]
    .map((value) => placementKey(value, sectionPrefix)).filter(Boolean);
  if (allSections && (!sectionValues.length || sectionValues.every((value) => ['all', 'allsections', 'any', 'anysection'].includes(value)))) return true;
  return [student.sectionId, student.section, student.sectionName]
    .some((value) => sectionValues.includes(placementKey(value, sectionPrefix)));
}

const attendanceEntries = (log) => [log.students, log.attendance, log.records].flatMap((group) => Array.isArray(group) ? group : []);
const memberKeys = (item) => [item.studentId, item.memberId, item.id, item._id].filter(Boolean).map(recordId);
const statusKey = (status) => attendanceStatuses[String(status || '').toLowerCase().replace(/[^a-z]/g, '')];

export function attendanceDays(logs, { from, through, students, studentIds } = {}) {
  const recorded = new Map();
  const canonical = new Map();
  for (const student of students || []) {
    const ids = rowIds(student);
    for (const id of ids) canonical.set(id, ids[0]);
  }
  for (const log of logs) {
    if (log.type && log.type !== 'student') continue;
    const date = dashboardDay(log.attendanceDate || log.date);
    if (!date || (from && date < from) || (through && date > through)) continue;
    const submitted = new Date(log.attendanceTakenDate || log.updatedAt || log.createdAt || log.date).getTime() || 0;
    for (const item of attendanceEntries(log)) {
      const status = statusKey(item.status);
      if (!status) continue;
      const ids = memberKeys(item);
      const member = studentIds ? ids.find((id) => studentIds.includes(id))
        : students ? ids.map((id) => canonical.get(id)).find(Boolean) : ids[0];
      if (!member) continue;
      const key = date + ':' + (studentIds ? studentIds[0] : member);
      const existing = recorded.get(key);
      if (!existing || submitted > existing.submitted) {
        recorded.set(key, {
          date, status, submitted, remarks: item.remarks || '',
          checkIn: item.checkIn || '', checkOut: item.checkOut || '',
        });
      }
    }
  }
  return [...recorded.values()].sort((left, right) => right.date.localeCompare(left.date));
}

export function attendanceCounts(days) {
  const summary = { present: 0, absent: 0, late: 0, halfDay: 0, leave: 0 };
  for (const day of days) summary[day.status]++;
  const total = days.length;
  const eligible = total - summary.leave;
  return {
    ...summary, total,
    rate: eligible ? Math.round((summary.present + summary.late + summary.halfDay / 2) / eligible * 1000) / 10 : null,
  };
}

export function homeworkSummary(assignments, ids, today) {
  const from = shiftDay(today, -29);
  const through = shiftDay(today, 6);
  let dueSoon = 0;
  let overdue = 0;
  let completed = 0;
  let due = 0;
  const review = [];
  const subjects = new Map();
  for (const item of assignments) {
    const date = dashboardDay(item.dueDate);
    if (!date || date < from || date > through) continue;
    const submitted = (item.submissions || []).some((submission) =>
      [submission.student, submission.studentId].map(recordId).some((id) => ids.includes(id))
    );
    if (date <= today) {
      due++;
      if (submitted) completed++;
      const name = String(item.subject || '').trim() || 'Unspecified subject';
      const key = name.toLowerCase();
      const group = subjects.get(key) || { name, submitted: 0, missing: 0 };
      group[submitted ? 'submitted' : 'missing']++;
      subjects.set(key, group);
    }
    if (submitted) continue;
    if (date < today || (item.status === 'closed' && date === today)) overdue++;
    else if (item.status === 'published') dueSoon++;
    if (item.status === 'published') review.push({
      id: recordId(item), title: item.title, subject: item.subject, date, overdue: date < today,
    });
  }
  review.sort((left, right) => left.date.localeCompare(right.date));
  return {
    dueSoon, overdue, completed, due,
    completion: due ? Math.round(completed / due * 100) : null,
    upcoming: review.slice(0, 5),
    bySubject: [...subjects.values()].sort((left, right) =>
      (right.submitted + right.missing) - (left.submitted + left.missing) || left.name.localeCompare(right.name)
    ),
  };
}

export function resultSummary(results) {
  const published = (item) => item.publishedAt || item.updatedAt || item.createdAt;
  const publishedResults = results.filter((item) => item.status === 'published')
    .sort((left, right) => (Date.parse(published(right)) || 0) - (Date.parse(published(left)) || 0));
  const graded = publishedResults.map((item) => {
    const subjects = (item.marks || []).flatMap((mark) => {
      const total = Number(mark.maxMarks ?? mark.total ?? 0);
      const obtained = Number(mark.obtained);
      if (!(total > 0) || mark.obtained == null || mark.obtained === '' || !(obtained >= 0)) return [];
      const label = String(mark.subjectName || mark.subjectId?.name || mark.subjectCode || '').trim();
      return [{
        name: label || 'Subject', key: label.toLowerCase(), obtained, total,
        percent: Math.round(obtained / total * 1000) / 10,
      }];
    });
    const total = Number(item.totalMaxMarks) || subjects.reduce((sum, subject) => sum + subject.total, 0);
    const obtained = Number(item.totalMaxMarks) > 0 ? Number(item.totalObtained) : subjects.reduce((sum, subject) => sum + subject.obtained, 0);
    const stored = item.percentage == null ? NaN : Number(item.percentage);
    const score = total > 0 ? Math.round(obtained / total * 1000) / 10 : stored;
    return {
      id: recordId(item), name: item.examName || item.examId?.name || item.examTerm || 'Published result',
      date: dashboardDay(published(item)),
      score: Number.isFinite(score) ? score : null, subjects,
    };
    });
  const recent = graded.slice(0, 6).reverse();
  const subjects = new Map();
  for (const exam of recent) {
    for (const subject of exam.subjects) {
      if (subject.key) subjects.set(subject.key, subject.name);
    }
  }
  return {
    latest: graded[0] || null,
    history: recent.map(({ subjects: _subjects, ...record }) => record),
    bySubject: [...subjects].map(([key, name]) => ({
      key, name,
      scores: recent.map((exam) => ({
        name: exam.name, date: exam.date, score: exam.subjects.find((subject) => subject.key === key)?.percent ?? null,
      })),
    })).sort((left, right) => left.name.localeCompare(right.name)),
  };
}

function monthlyPayments(fees, months, today) {
  const groups = new Map(months.map((month) => [month, { month, amount: 0, payments: 0 }]));
  for (const fee of fees) {
    for (const payment of fee.transactions || []) {
      const date = dashboardDay(payment.date);
      const group = groups.get(date.slice(0, 7));
      const amount = Number(payment.amount);
      if (!group || date > today || payment.amount == null || payment.amount === '' || !Number.isFinite(amount)) continue;
      group.amount += amount;
      group.payments++;
    }
  }
  return [...groups.values()];
}

function currentLoans(loans, today) {
  const due = { later: 0, today: 0, overdue: 0, undated: 0 };
  let borrowed = 0;
  for (const loan of loans) {
    if (loan.returnDate) continue;
    borrowed++;
    const date = dashboardDay(loan.dueDate);
    if (!date) due.undated++;
    else if (date < today) due.overdue++;
    else if (date === today) due.today++;
    else due.later++;
  }
  return { borrowed, overdue: due.overdue, due };
}

export function upcomingExams(exams, today, student) {
  return exams.flatMap((exam) => {
    if (exam.status === 'completed') return [];
    const placement = [...(exam.classIds || []), ...(exam.classNames || []), ...(exam.classes || [])].filter(Boolean);
    if (student && placement.length && !placement.some((entry) => matchesStudentPlacement({ classId: entry }, student))) return [];
    const scheduled = (exam.subjectSchedule || []).map((entry) => dashboardDay(entry.examDate))
      .filter((date) => date && date >= today).sort();
    const start = dashboardDay(exam.date);
    const when = scheduled[0] || (start >= today ? start : '');
    if (!when) return [];
    return [{ id: recordId(exam), title: exam.name || exam.title, date: when, term: exam.term || '', status: exam.status }];
  }).sort((left, right) => left.date.localeCompare(right.date));
}

export function todaySchedule(timetables, student, today) {
  const day = new Date(today + 'T00:00:00Z').getUTCDay();
  const weekday = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][day];
  const roomId = recordId(student.currentClassRoomId);
  const sessionId = recordId(student.sessionId);
  const current = timetables.filter((table) => {
    if (table.scheduleType === 'exam') return false;
    if (table.sessionId && sessionId && recordId(table.sessionId) !== sessionId) return false;
    if (table.classRoomId && roomId) return recordId(table.classRoomId) === roomId;
    return matchesStudentPlacement(table, student, { allSections: false });
  }).sort((left, right) => {
    const rank = (table) => Number(Boolean(roomId && recordId(table.classRoomId) === roomId)) * 2
      + Number(Boolean(sessionId && recordId(table.sessionId) === sessionId));
    return rank(right) - rank(left) || String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
  })[0];
  return (current?.allocations || []).filter((slot) => String(slot.day).toLowerCase() === weekday)
    .sort((left, right) => Number(left.periodOrder) - Number(right.periodOrder))
    .map((slot) => ({
      period: slot.periodOrder, subject: slot.subject || slot.customLabel || (slot.periodType !== 'class' ? slot.periodType : ''),
      starts: slot.startTime, ends: slot.endTime, teacher: slot.teacherName, room: slot.roomNo,
    })).filter((slot) => slot.subject);
}

export function studentOverview({ student, attendance, homework, results, fees, loans, exams, timetable }, today) {
  const ids = rowIds(student);
  const months = recentMonths(today);
  const days = attendanceDays(attendance, { through: today, studentIds: ids });
  const month = months.at(-1);
  const monthly = (key) => attendanceCounts(days.filter(({ date }) => date.startsWith(key)));
  const latest = resultSummary(results);
  const upcoming = upcomingExams(exams, today, student);
  return {
    date: today,
    student: {
      name: student.name || [student.firstName, student.lastName].filter(Boolean).join(' '),
      className: student.className || student.class || String(student.classId || ''),
      sectionName: student.sectionName || student.section || String(student.sectionId || ''),
      admissionNumber: student.admissionNumber, rollNumber: student.rollNumber, session: student.academicYear,
    },
    attendance: {
      ...monthly(month), history: months.map((key) => ({ month: key, ...monthly(key) })), records: days.map(({ submitted, ...day }) => day),
    },
    homework: homeworkSummary(homework, ids, today),
    results: latest,
    fees: fees.length ? {
      paid: fees.reduce((sum, fee) => sum + (Number(fee.amountPaid) || 0), 0),
      due: fees.reduce((sum, fee) => sum + (Number(fee.amountPending) || 0), 0),
      dueDate: fees.filter((fee) => Number(fee.amountPending) > 0)
        .map((fee) => dashboardDay(fee.dueDate)).filter(Boolean).sort()[0] || '',
      history: monthlyPayments(fees, months, today),
    } : null,
    library: currentLoans(loans, today),
    exams: { count: upcoming.length, upcoming: upcoming.slice(0, 4) },
    schedule: todaySchedule(timetable, student, today),
  };
}

export function campusOverview({ students, teachers, classes, attendance, fees, exams, notices }, today) {
  const months = recentMonths(today);
  const days = attendanceDays(attendance, { from: shiftDay(today, -6), through: today, students });
  const admissions = Object.fromEntries(months.map((month) => [month, 0]));
  for (const student of students) {
    const date = dashboardDay(student.admissionDate || student.joiningDate || student.createdAt);
    const month = date.slice(0, 7);
    if (Object.hasOwn(admissions, month) && date <= today) admissions[month]++;
  }
  const feeTrend = monthlyPayments(fees, months, today);
  return {
    date: today,
    students: students.length,
    teachers,
    classes,
    feesCollected: feeTrend.at(-1).amount,
    feeTrend,
    admissionTrend: months.map((month) => ({ month, count: admissions[month] })),
    attendance: Array.from({ length: 7 }, (_, index) => {
      const date = shiftDay(today, index - 6);
      return { date, ...attendanceCounts(days.filter((row) => row.date === date)) };
    }),
    exams: upcomingExams(exams, today).slice(0, 5),
    notices: notices.map((notice) => ({
      id: recordId(notice), title: notice.title, date: dashboardDay(notice.createdAt), type: notice.category,
    })).sort((left, right) => right.date.localeCompare(left.date)).slice(0, 5),
  };
}

export function campusStudentMetrics(students, attendance, today) {
  let active = 0;
  let inactive = 0;
  let completed = 0;
  let legacy = 0;
  let unassigned = 0;
  const sections = new Map();
  const classes = new Map();
  const admitted = [];
  const admissionMix = new Map(recentMonths(today).map((month) => [month, { month, legacy: 0, standard: 0 }]));
  const dailyAdmissions = new Map(Array.from({ length: 14 }, (_, index) => {
    const date = shiftDay(today, index - 13);
    return [date, { date, count: 0 }];
  }));

  for (const student of students) {
    const status = String(student.status || '').toLowerCase().replace(/\s+/g, '');
    if (status === 'active') active++;
    if (status === 'inactive') inactive++;
    if (['passout', 'graduated'].includes(status)) completed++;
    const isLegacy = isLegacyStudent(student.isLegacyStudent);
    if (isLegacy) legacy++;
    const className = student.className || student.class || String(student.classId || '');
    const sectionName = student.sectionName || student.section || String(student.sectionId || '');
    const cls = placementKey(className, /^(class|grade|cls)[\s-]*/i);
    const sec = placementKey(sectionName, /^(section|sec)[\s-]*/i);
    if (cls && !['na', 'null', 'undefined', 'unassigned'].includes(cls)) {
      const entry = classes.get(cls) || { name: /^\d+$/.test(cls) ? 'Class ' + cls : className, count: 0 };
      entry.count++;
      classes.set(cls, entry);
      if (sec && !['na', 'null', 'undefined', 'all', 'allsections', 'unassigned'].includes(sec)) {
        const sectionKey = cls + ':' + sec;
        const label = /^[a-z\d]+$/.test(sec) && sec.length <= 2 ? 'Section ' + sec.toUpperCase() : sectionName;
        const section = sections.get(sectionKey) || { name: entry.name + ' · ' + label, count: 0 };
        section.count++;
        sections.set(sectionKey, section);
      }
    } else {
      unassigned++;
    }
    const date = dashboardDay(student.admissionDate || student.joiningDate || student.createdAt);
    if (date && date <= today) {
      const monthly = admissionMix.get(date.slice(0, 7));
      if (monthly) monthly[isLegacy ? 'legacy' : 'standard']++;
      const daily = dailyAdmissions.get(date);
      if (daily) daily.count++;
      admitted.push({
        id: recordId(student), title: student.name || [student.firstName, student.lastName].filter(Boolean).join(' '),
        date, detail: [className, sectionName].filter(Boolean).join(' · '),
      });
    }
  }
  const from = shiftDay(today, -29);
  const marks = attendance.reduce((sum, day) => sum + day.total - day.leave, 0);
  const effective = attendance.reduce((sum, day) => sum + day.present + day.late + day.halfDay / 2, 0);
  return {
    active, inactive, completed, legacy, unassigned, sections: sections.size,
    admissions: admitted.filter((student) => student.date >= from).length,
    attendanceRate: marks ? Math.round(effective / marks * 1000) / 10 : null,
    absences: attendance.reduce((sum, day) => sum + day.absent, 0),
    classDistribution: [...classes.values()].sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true })),
    sectionDistribution: [...sections.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
    admissionMix: [...admissionMix.values()],
    dailyAdmissions: [...dailyAdmissions.values()],
    recent: admitted.sort((left, right) => right.date.localeCompare(left.date)).slice(0, 5),
  };
}
