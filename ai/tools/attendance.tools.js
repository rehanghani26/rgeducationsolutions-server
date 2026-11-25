import Attendance from "../../models/Attendance.js";
import Student from "../../models/Student.js";
import Teacher from "../../models/Teacher.js";
import { checkFallback } from "../../config/db.js";
import { FallbackDb } from "../../services/dbFallback.js";
import { scopedStudentRoster } from "../../services/studentEnrollmentService.js";
import { readProcurement } from "../../services/procurementStore.js";
import { getAcademicScope } from "../../utils/academicScope.js";
import {
  classKey,
  gradeByValue,
  sectionByValue,
  sectionMatches,
} from "../../utils/academicClass.js";
import { getActiveLeavesOnDate } from "../../controllers/leaveController.js";
import {
  createAttendance,
  extractRecordCounts,
  formatStatusLabel,
  getAttendanceById,
  getAttendanceRecords,
  getAttendanceStats as getAttendanceStatsController,
  getAttendanceStatusOverview,
  getMyAttendance,
  getStudentAttendance as getStudentAttendanceController,
  normalizeAttendanceStatus,
  parseCalendarInput,
  parseDateRange,
  recordDayKey,
  resolveSchoolClock,
  updateAttendance,
} from "../../controllers/attendanceController.js";
import { isValidObjectId, escapeRegex } from "../../utils/commonUtil.js";

const idStr = (val) => String(val?._id || val?.id || val || "").trim();

async function invokeController(controllerFn, context, { params = {}, query = {}, body = {} } = {}) {
  const out = { statusCode: 200, body: null };
  const req = {
    user: context?.user,
    schoolId: context?.schoolId || context?.user?.schoolId,
    academicSessionId: context?.academicSessionId,
    ip: context?.ip || "AI",
    headers: { "user-agent": "RGES-AI-Mode" },
    params,
    query,
    body,
  };
  const res = {
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(payload) {
      out.body = payload;
      return this;
    },
  };
  await controllerFn(req, res);
  const bodyObj = out.body || {};
  const payload = bodyObj.data !== undefined ? bodyObj.data : bodyObj;
  return {
    statusCode: out.statusCode,
    ok: out.statusCode < 400 && bodyObj.success !== false,
    message: bodyObj.message,
    body: bodyObj,
    payload,
  };
}

function getContextReq(context) {
  return {
    user: context?.user,
    schoolId: context?.schoolId || context?.user?.schoolId,
    academicSessionId: context?.academicSessionId,
    headers: {},
    query: {},
  };
}

async function fetchAllAttendanceRecords(context, query = {}, maxPages = 10) {
  const all = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages && page <= maxPages) {
    const res = await invokeController(getAttendanceRecords, context, {
      query: { ...query, page, limit: 100 },
    });
    if (!res.ok) break;
    const batch = res.payload?.records || [];
    all.push(...batch);
    totalPages = Number(res.payload?.pagination?.pages || 1);
    if (batch.length === 0) break;
    page += 1;
  }
  return all;
}

async function resolveStudentForAi(args, context) {
  const role = String(context?.user?.role || "").toLowerCase();
  const isPersonalRole = role === "student" || role === "parent";
  const scope = getAcademicScope();
  const req = getContextReq(context);

  const termRaw = args.studentId || args.admissionNumber || args.studentName || args.search || "";
  const term = String(termRaw).trim();

  if (isPersonalRole) {
    const rawRoster = scope
      ? await scopedStudentRoster(req, { personal: true })
      : checkFallback()
        ? FallbackDb.find("students") || []
        : [];
    const uid = idStr(context?.user?._id || context?.user?.id);
    const pid = idStr(context?.user?.profileId || context?.user?.studentId);
    const userEmail = String(context?.user?.email || "").trim().toLowerCase();
    const ownRoster = (rawRoster || []).filter((s) => {
      const sid = idStr(s);
      if (pid && sid === pid) return true;
      if (uid && (sid === uid || String(s.user || "") === uid || String(s.parentUser || "") === uid)) return true;
      if (role === "parent" && userEmail && String(s.parentEmail || "").trim().toLowerCase() === userEmail) return true;
      return false;
    });
    const userId = pid || uid;

    if (ownRoster.length > 0) {
      if (term) {
        const q = term.toLowerCase();
        const ownMatch = ownRoster.find((s) =>
          [s._id, s.id, s.admissionNumber, s.rollNumber, s.name].some(
            (v) => v != null && String(v).toLowerCase() === q
          )
        );
        if (!ownMatch) {
          return { error: "As a student/parent account, you can only inspect your own attendance records." };
        }
        return { student: ownMatch };
      }
      return { student: ownRoster[0] };
    }

    if (!userId) {
      return { error: "Could not identify the signed-in student profile." };
    }
    if (
      term &&
      term.toLowerCase() !== userId.toLowerCase() &&
      term.toLowerCase() !== String(context?.user?.name || "").trim().toLowerCase()
    ) {
      return { error: "As a student/parent account, you can only inspect your own attendance records." };
    }
    return {
      student: {
        _id: userId,
        id: userId,
        name: context?.user?.name || "Student",
        className: context?.user?.className || context?.user?.class || "",
        sectionName: context?.user?.sectionName || context?.user?.section || "",
      },
    };
  }

  if (!term) {
    return { error: "Provide a studentId, admissionNumber, or studentName." };
  }

  if (scope) {
    const roster = await scopedStudentRoster(req, { personal: false });
    const grade = args.class ? gradeByValue(scope.grades, args.class) : null;
    const resolvedSec = args.section ? sectionByValue(args.section) : null;
    const pool = roster.filter((s) => {
      if (grade && String(s.classId) !== grade.id && classKey(s.className) !== classKey(grade.name)) return false;
      if (resolvedSec && !sectionMatches(resolvedSec, s)) return false;
      return true;
    });
    const q = term.toLowerCase();
    const exactId = pool.find((s) =>
      [s._id, s.id, s.admissionNumber].some((v) => v != null && String(v).toLowerCase() === q)
    );
    if (exactId) return { student: exactId };

    if (args.rollNumber != null || /^\d+$/.test(term)) {
      const rollTarget = String(args.rollNumber ?? term).toLowerCase();
      const rollMatches = pool.filter((s) => s.rollNumber != null && String(s.rollNumber).toLowerCase() === rollTarget);
      if (rollMatches.length === 1) return { student: rollMatches[0] };
      if (rollMatches.length > 1) {
        return {
          error: `Multiple students have roll number ${rollTarget}. Please specify the class or student name.`,
          matches: rollMatches.slice(0, 8).map((m) => ({
            studentId: idStr(m),
            name: m.name,
            rollNumber: m.rollNumber,
            classSection: `${m.className || ""} - ${m.sectionName || ""}`,
          })),
        };
      }
    }

    const nameMatches = pool.filter((s) => String(s.name || "").toLowerCase().includes(q));
    if (nameMatches.length === 1) return { student: nameMatches[0] };
    if (nameMatches.length > 1) {
      const exactName = nameMatches.filter((s) => String(s.name || "").toLowerCase() === q);
      if (exactName.length === 1) return { student: exactName[0] };
      return {
        error: `Found ${nameMatches.length} students matching "${term}". Please specify which one (by class or full name).`,
        matches: nameMatches.slice(0, 8).map((m) => ({
          studentId: idStr(m),
          name: m.name,
          admissionNumber: m.admissionNumber,
          rollNumber: m.rollNumber,
          classSection: `${m.className || ""} - ${m.sectionName || ""}`,
        })),
      };
    }
    return { error: `No student found matching "${term}" in the current session.` };
  }

  if (checkFallback()) {
    const list = FallbackDb.find("students") || [];
    const q = term.toLowerCase();
    const match =
      list.find((s) =>
        [s.id, s._id, s.admissionNumber].some((v) => v != null && String(v).toLowerCase() === q)
      ) ||
      list.find((s) => String(s.name || "").toLowerCase() === q) ||
      list.find((s) => String(s.name || "").toLowerCase().includes(q));
    if (!match) return { error: `No student found matching "${term}".` };
    return { student: match };
  }

  if (isValidObjectId(term)) {
    const byId = await Student.findById(term).lean();
    if (byId) return { student: byId };
  }
  const byAdmission = await Student.findOne({ admissionNumber: new RegExp(`^${escapeRegex(term)}$`, "i") }).lean();
  if (byAdmission) return { student: byAdmission };

  const matches = await Student.find({ name: new RegExp(escapeRegex(term), "i") })
    .limit(10)
    .lean();
  if (matches.length === 1) return { student: matches[0] };
  if (matches.length > 1) {
    const exact = matches.find((s) => String(s.name || "").toLowerCase() === term.toLowerCase());
    if (exact) return { student: exact };
    return {
      error: `Found multiple students matching "${term}". Please specify class/section or admission number.`,
      matches: matches.slice(0, 8).map((m) => ({
        studentId: idStr(m),
        name: m.name,
        admissionNumber: m.admissionNumber,
        classSection: `${m.className || m.class || ""} - ${m.sectionName || m.section || ""}`,
      })),
    };
  }
  return { error: `No student found matching "${term}".` };
}

function computeStreaks(logsDesc = []) {
  // Logs sorted newest -> oldest
  const ordered = [...logsDesc].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let currentPresentStreak = 0;
  let longestPresentStreak = 0;
  let runningPresent = 0;
  let maxConsecutiveAbsent = 0;
  let currentAbsentStreak = 0;

  for (const log of ordered) {
    const st = normalizeAttendanceStatus(log.status) || String(log.status || "").toLowerCase();
    if (st === "present" || st === "late" || st === "half day") {
      runningPresent += 1;
      if (runningPresent > longestPresentStreak) longestPresentStreak = runningPresent;
      currentAbsentStreak = 0;
    } else if (st === "absent") {
      runningPresent = 0;
      currentAbsentStreak += 1;
      if (currentAbsentStreak > maxConsecutiveAbsent) maxConsecutiveAbsent = currentAbsentStreak;
    } else {
      // Leave is excused: does not count as absent streak, resets present run only if you count strictly; leave shouldn't break excused attendance
    }
  }
  currentPresentStreak = runningPresent;
  return {
    currentPresentStreak,
    longestPresentStreak,
    currentAbsentStreak,
    maxConsecutiveAbsent,
  };
}

function matchOverrideMember(members, override) {
  const sid = override.studentId || override.memberId || override.teacherId;
  if (sid) {
    const exact = members.filter((m) => String(m.studentId) === String(sid));
    if (exact.length === 1) return { member: exact[0] };
  }
  const roll = override.rollNo ?? override.rollNumber ?? override.employeeId;
  if (roll != null && String(roll).trim() !== "") {
    const rMatches = members.filter(
      (m) => m.rollNo != null && String(m.rollNo).trim().toLowerCase() === String(roll).trim().toLowerCase()
    );
    if (rMatches.length === 1) return { member: rMatches[0] };
    if (rMatches.length > 1) {
      return { error: `Multiple members matched roll/ID "${roll}". Please include student name.` };
    }
  }
  const name = String(override.name || override.studentName || "").trim().toLowerCase();
  if (!name) {
    return { error: "Each override item must specify studentId, rollNo, or name." };
  }
  const exactName = members.filter((m) => String(m.name || "").trim().toLowerCase() === name);
  if (exactName.length === 1) return { member: exactName[0] };
  const partialName = members.filter((m) => String(m.name || "").trim().toLowerCase().includes(name));
  if (partialName.length === 1) return { member: partialName[0] };
  if (partialName.length > 1) {
    return {
      error: `Ambiguous member name "${override.name || override.studentName}" matched ${partialName.length} people (${partialName.map((p) => p.name).join(", ")}).`,
    };
  }
  return { error: `Member "${override.name || override.studentName || sid || roll}" was not found in this roster.` };
}

function summarizeFormattedList(list = []) {
  let present = 0;
  let absent = 0;
  let late = 0;
  let halfDay = 0;
  let leave = 0;
  for (const s of list) {
    const st = normalizeAttendanceStatus(s.status);
    if (st === "present") present += 1;
    else if (st === "absent") absent += 1;
    else if (st === "late") late += 1;
    else if (st === "half day") halfDay += 1;
    else if (st === "leave") leave += 1;
  }
  const total = list.length;
  const effective = present + halfDay * 0.5;
  const denom = Math.max(1, total - leave);
  const percentage = total > 0 ? Math.min(100, Math.round((effective / denom) * 100)) : 0;
  return { total, present, absent, late, halfDay, leave, percentage };
}

export const attendanceToolDefinitions = [
  {
    name: "getAttendanceStatus",
    description:
      'Check daily attendance completion overview: which class-sections or staff departments have been marked and which are still pending for a given date, plus whether the date is a future date, Sunday, or outside the active session.',
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format. Defaults to today in the school timezone.",
        },
        type: {
          type: "string",
          description: '"student" or "teacher". Defaults to "student".',
        },
        class: {
          type: "string",
          description: 'Optional class name/ID filter (e.g. "Class 1").',
        },
        section: {
          type: "string",
          description: 'Optional section filter (e.g. "Section A", "A").',
        },
        department: {
          type: "string",
          description: "Optional department filter when type is teacher.",
        },
      },
    },
  },
  {
    name: "getAttendanceByDate",
    description:
      'Get attendance sheets and member-level present/absent/late/half-day/leave breakdown for a date (defaults to today). Supports both students (by class/section) and teachers/staff (by department). Use for "attendance today", "attendance yesterday", "who was absent today?", "teacher attendance today".',
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Date in YYYY-MM-DD format. Defaults to today in school timezone.",
        },
        type: {
          type: "string",
          description: '"student", "teacher", or "all". Defaults to "student".',
        },
        class: {
          type: "string",
          description: 'Optional class name or ID (e.g. "Class 1", "Class 10").',
        },
        section: {
          type: "string",
          description: 'Optional section name or ID (e.g. "Section A", "A", "sec-a").',
        },
        department: {
          type: "string",
          description: 'Optional department when querying teacher attendance.',
        },
        includeStudents: {
          type: "boolean",
          description: "If true, returns member rows for matched attendance sheets.",
        },
      },
    },
  },
  {
    name: "getAttendanceStats",
    description:
      'Get dynamic attendance KPIs and trends for a date range, month, year, class/section, or staff department. Supports comparisons across class-sections.',
    parameters: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: '"student" or "teacher". Defaults to "student".',
        },
        month: {
          type: "string",
          description: 'Month number (1-12) or name (e.g. "November", "November 2026").',
        },
        year: {
          type: "number",
          description: "Year (e.g. 2026).",
        },
        date: {
          type: "string",
          description: "Specific date in YYYY-MM-DD format.",
        },
        startDate: {
          type: "string",
          description: "Range start YYYY-MM-DD.",
        },
        endDate: {
          type: "string",
          description: "Range end YYYY-MM-DD.",
        },
        class: {
          type: "string",
          description: 'Optional class filter (e.g. "Class 1").',
        },
        section: {
          type: "string",
          description: 'Optional section filter (e.g. "Section A").',
        },
      },
    },
  },
  {
    name: "getStudentAttendance",
    description:
      "Get real attendance history, counts (present, absent, late, half day, leave), rate %, and streaks for a specific student. Supports filtering by month, year, date range, or status.",
    parameters: {
      type: "object",
      properties: {
        studentId: { type: "string", description: "Student ID or admission number." },
        studentName: { type: "string", description: "Student name." },
        admissionNumber: { type: "string", description: "Student admission number." },
        rollNumber: { type: "string", description: "Roll number (combine with class/section if needed)." },
        class: { type: "string", description: "Optional class name to narrow name/roll lookup." },
        section: { type: "string", description: "Optional section name to narrow name/roll lookup." },
        month: { type: "string", description: "Optional month filter (1-12 or month name)." },
        year: { type: "number", description: "Optional year filter." },
        startDate: { type: "string", description: "Optional range start YYYY-MM-DD." },
        endDate: { type: "string", description: "Optional range end YYYY-MM-DD." },
        status: { type: "string", description: 'Optional status filter: "present", "absent", "late", "half day", "leave".' },
      },
    },
  },
  {
    name: "getMyAttendanceSummary",
    description:
      "Get the currently signed-in user's own personal attendance logs and summary (works for students, parents, teachers, and staff).",
    parameters: {
      type: "object",
      properties: {
        month: { type: "string", description: "Optional month filter (1-12 or month name)." },
        year: { type: "number", description: "Optional year filter." },
        status: { type: "string", description: 'Optional status filter: "present", "absent", "late", "half day", "leave".' },
      },
    },
  },
  {
    name: "getLowAttendanceStudents",
    description:
      'Find active students whose attendance rate is below a threshold % or who have consecutive absences. Use for attendance alerts and defaulters.',
    parameters: {
      type: "object",
      properties: {
        threshold: {
          type: "number",
          description: "Minimum percentage threshold (default 75 -> returns students below 75%).",
        },
        class: {
          type: "string",
          description: 'Optional class filter (e.g. "Class 1").',
        },
        section: {
          type: "string",
          description: 'Optional section filter (e.g. "Section A").',
        },
        month: {
          type: "string",
          description: "Optional month number or name.",
        },
        year: {
          type: "number",
          description: "Optional year.",
        },
        minDays: {
          type: "number",
          description: "Minimum recorded school days required (default 1).",
        },
        consecutiveAbsentDays: {
          type: "number",
          description: "Optional minimum consecutive absence days streak filter.",
        },
      },
    },
  },
  {
    name: "markAttendance",
    description:
      'Mark daily attendance for a student class & section OR teacher/staff department. Enforces real-world rules: blocks future dates, checks active session window, auto-loads enrolled students or active teachers, respects approved leaves, and strictly blocks marking the same class-section or department twice on the same date. Call with confirm=false first to preview counts/approved leaves and get confirmation, then call with confirm=true once confirmed.',
    parameters: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Attendance date in YYYY-MM-DD format. Defaults to today in school timezone.",
        },
        type: {
          type: "string",
          description: '"student" or "teacher". Defaults to "student".',
        },
        class: {
          type: "string",
          description: 'Required when type="student" (e.g. "Class 1", "Class 10").',
        },
        section: {
          type: "string",
          description: 'Required when type="student" (e.g. "Section A", "A").',
        },
        department: {
          type: "string",
          description: 'Optional department when type="teacher" (defaults to "All Departments").',
        },
        defaultStatus: {
          type: "string",
          description: 'Default status for members without overrides or approved leave: "present" (default), "absent", "late", "half day", "leave".',
        },
        protectApprovedLeaves: {
          type: "boolean",
          description: "Keep approved leaves pre-marked as leave/half day unless explicitly overridden (default true).",
        },
        statusOverrides: {
          type: "array",
          description: "Specific member exceptions, e.g. [{ name: 'Neha Rathi', status: 'late', remarks: 'Traffic' }].",
          items: {
            type: "object",
            properties: {
              studentId: { type: "string" },
              name: { type: "string" },
              rollNo: { type: "string" },
              employeeId: { type: "string" },
              status: { type: "string" },
              remarks: { type: "string" },
            },
            required: ["status"],
          },
        },
        confirm: {
          type: "boolean",
          description: "Set true only after confirming preview counts or when user explicitly confirmed submission.",
        },
      },
    },
  },
  {
    name: "updateAttendanceRecord",
    description:
      'Modify/correct an existing attendance record by attendanceId or (date + class + section / department). Updates specified students/staff members without creating a duplicate sheet.',
    parameters: {
      type: "object",
      properties: {
        attendanceId: { type: "string", description: "Existing attendance record ID (optional if date + class/section provided)." },
        date: { type: "string", description: "Date in YYYY-MM-DD format." },
        type: { type: "string", description: '"student" or "teacher". Defaults to "student".' },
        class: { type: "string", description: "Class name if updating student attendance." },
        section: { type: "string", description: "Section name if updating student attendance." },
        department: { type: "string", description: "Department if updating teacher attendance." },
        updates: {
          type: "array",
          description: "List of student/staff status updates to apply.",
          items: {
            type: "object",
            properties: {
              studentId: { type: "string" },
              name: { type: "string" },
              rollNo: { type: "string" },
              employeeId: { type: "string" },
              status: { type: "string" },
              remarks: { type: "string" },
            },
            required: ["status"],
          },
        },
        confirm: {
          type: "boolean",
          description: "Set true to execute update after confirming preview.",
        },
      },
      required: ["updates"],
    },
  },
];

export const attendanceToolExecutors = {
  async getAttendanceStatus(args = {}, context) {
    const type = String(args.type || "student").toLowerCase() === "teacher" ? "teacher" : "student";
    const { ok, message, payload } = await invokeController(getAttendanceStatusOverview, context, {
      query: {
        date: args.date,
        type,
        class: args.class,
        section: args.section,
        department: args.department,
      },
    });
    if (!ok) return { success: false, error: message || "Could not load attendance status overview." };

    const scope = getAcademicScope();
    let sections = payload.classSections || [];
    if (type === "student") {
      if (args.class) {
        const grade = scope?.grades?.length ? gradeByValue(scope.grades, args.class) : null;
        sections = sections.filter((s) =>
          grade
            ? String(s.classId) === grade.id || classKey(s.className) === classKey(grade.name)
            : classKey(s.className) === classKey(args.class)
        );
      }
      if (args.section) {
        sections = sections.filter((s) => sectionMatches(args.section, s));
      }
    }

    const takenSections = sections.filter((s) => s.taken);
    const pendingSections = sections.filter((s) => !s.taken);
    const departments = payload.departments || [];
    const totalConfigured = type === "teacher" ? Math.max(0, departments.length - 1) || departments.length : sections.length;
    const markedCount =
      type === "teacher"
        ? departments.filter((d) => d.department !== "All Departments" && d.taken).length ||
          (departments[0]?.taken ? 1 : 0)
        : takenSections.length;
    const pendingCount = type === "teacher" ? Math.max(0, totalConfigured - markedCount) : pendingSections.length;

    return {
      success: true,
      date: payload.date,
      today: payload.today,
      type,
      isFuture: payload.isFuture,
      isSunday: payload.isSunday,
      outsideSession: payload.outsideSession,
      readOnly: payload.readOnly,
      sessionName: payload.sessionName,
      summary: {
        totalConfigured,
        markedCount,
        pendingCount,
        completionPercentage: totalConfigured > 0 ? Math.min(100, Math.round((markedCount / totalConfigured) * 100)) : 0,
      },
      takenSections,
      pendingSections,
      departments: type === "teacher" ? departments : [],
      existingRecord: payload.existingRecord || null,
    };
  },

  async getAttendanceByDate(args = {}, context) {
    const req = getContextReq(context);
    const { timeZone, todayDay } = await resolveSchoolClock(req);
    const targetDate = args.date || todayDay;
    const parsed = parseCalendarInput(targetDate, timeZone);
    if (!parsed) {
      return { success: false, error: `Invalid date format "${args.date}". Use YYYY-MM-DD.` };
    }
    const dayKey = parsed.dayKey;
    const type = args.type ? String(args.type).toLowerCase() : "student";

    const query = {
      date: dayKey,
      type: type === "all" ? "all" : type === "teacher" ? "teacher" : "student",
      limit: 200,
    };
    if (args.class || args.classId) query.class = args.class || args.classId;
    if (args.section || args.sectionId) query.section = args.section || args.sectionId;
    if (type === "teacher" && args.department) query.section = args.department;

    const [recResult, statusResult] = await Promise.all([
      invokeController(getAttendanceRecords, context, { query }),
      invokeController(getAttendanceStatusOverview, context, {
        query: {
          date: dayKey,
          type: query.type === "teacher" ? "teacher" : "student",
          ...(query.class ? { class: query.class } : {}),
          ...(query.section ? { section: query.section } : {}),
        },
      }),
    ]);

    if (!recResult.ok) {
      return { success: false, error: recResult.message || "Failed to fetch daily attendance." };
    }

    const records = recResult.payload?.records || [];
    const statusData = statusResult.ok ? statusResult.payload : {};

    if (records.length === 0) {
      return {
        success: true,
        date: dayKey,
        today: todayDay,
        isFuture: Boolean(statusData.isFuture),
        isSunday: Boolean(statusData.isSunday),
        outsideSession: Boolean(statusData.outsideSession),
        type: query.type,
        summary: {
          totalStudents: 0,
          present: 0,
          absent: 0,
          late: 0,
          halfDay: 0,
          leave: 0,
          attendanceRate: "0%",
        },
        absentStudents: [],
        lateStudents: [],
        leaveStudents: [],
        halfDayStudents: [],
        pendingSections: (statusData.classSections || []).filter((s) => !s.taken),
        records: [],
        recordCount: 0,
        message: statusData.isFuture
          ? `${dayKey} is a future date — attendance has not been taken yet.`
          : `No attendance records found for ${dayKey}${query.class ? ` (${query.class}${query.section ? ` - ${query.section}` : ""})` : ""}.`,
      };
    }

    let present = 0;
    let absent = 0;
    let late = 0;
    let halfDay = 0;
    let leave = 0;
    let totalStudents = 0;
    const absentStudents = [];
    const lateStudents = [];
    const leaveStudents = [];
    const halfDayStudents = [];
    const formattedRecords = [];

    for (const rec of records) {
      const c = extractRecordCounts(rec);
      present += c.present;
      absent += c.absent;
      late += c.late;
      halfDay += c.halfDay;
      leave += c.leave;
      totalStudents += c.total;

      const label = rec.classSection || [rec.className, rec.sectionName].filter(Boolean).join(" - ") || "—";
      const list = rec.students || rec.records || rec.attendance || [];
      for (const s of list) {
        const st = normalizeAttendanceStatus(s.status || "present");
        const entry = {
          studentId: String(s.studentId || s.memberId || s.id || ""),
          name: s.name || "Unknown",
          rollNo: s.rollNo ?? s.roll ?? "",
          className: label,
          status: formatStatusLabel(st || s.status),
          remarks: s.remarks || "",
        };
        if (st === "absent") absentStudents.push(entry);
        else if (st === "late") lateStudents.push(entry);
        else if (st === "leave") leaveStudents.push(entry);
        else if (st === "half day") halfDayStudents.push(entry);
      }

      const sheetDenom = Math.max(1, c.total - c.leave);
      formattedRecords.push({
        id: idStr(rec),
        date: dayKey,
        type: rec.type || "student",
        className: rec.className,
        sectionName: rec.sectionName,
        classSection: label,
        takenBy: typeof rec.takenBy === "object" ? rec.takenBy?.name : rec.takenBy || "Staff",
        attendanceTakenDate: rec.attendanceTakenDate || rec.createdAt,
        total: c.total,
        present: c.present,
        absent: c.absent,
        late: c.late,
        halfDay: c.halfDay,
        leave: c.leave,
        attendanceRate: c.total > 0 ? `${Math.min(100, Math.round(((c.present + c.halfDay * 0.5) / sheetDenom) * 100))}%` : "0%",
        ...(args.includeStudents || records.length === 1
          ? {
              students: list.slice(0, 80).map((s) => ({
                studentId: String(s.studentId || s.memberId || s.id || ""),
                name: s.name || "Unknown",
                rollNo: s.rollNo ?? s.roll ?? "",
                status: formatStatusLabel(s.status),
                remarks: s.remarks || "",
              })),
            }
          : {}),
      });
    }

    const denom = Math.max(1, totalStudents - leave);
    const rate = totalStudents > 0 ? Math.min(100, Math.round(((present + halfDay * 0.5) / denom) * 100)) : 0;

    return {
      success: true,
      date: dayKey,
      today: todayDay,
      isSunday: Boolean(statusData.isSunday),
      type: query.type,
      summary: {
        totalStudents,
        present,
        absent,
        late,
        halfDay,
        leave,
        attendanceRate: `${rate}%`,
      },
      absentStudents: absentStudents.slice(0, 40),
      lateStudents: lateStudents.slice(0, 30),
      halfDayStudents: halfDayStudents.slice(0, 30),
      leaveStudents: leaveStudents.slice(0, 30),
      pendingSections: (statusData.classSections || []).filter((s) => !s.taken),
      records: formattedRecords,
      recordCount: formattedRecords.length,
    };
  },

  async getAttendanceStats(args = {}, context) {
    const req = getContextReq(context);
    const { timeZone } = await resolveSchoolClock(req);
    const type = String(args.type || "student").toLowerCase() === "teacher" ? "teacher" : "student";

    const query = {
      type,
      ...(args.date ? { date: args.date } : {}),
      ...(args.startDate ? { startDate: args.startDate } : {}),
      ...(args.endDate ? { endDate: args.endDate } : {}),
      ...(args.month ? { month: String(args.month) } : {}),
      ...(args.year ? { year: String(args.year) } : {}),
      ...(args.class || args.classId ? { class: args.class || args.classId } : {}),
      ...(args.section ? { section: args.section } : {}),
      ...(type === "teacher" && args.department ? { section: args.department } : {}),
    };

    const [statsRes, records] = await Promise.all([
      invokeController(getAttendanceStatsController, context, { query }),
      fetchAllAttendanceRecords(context, query),
    ]);

    if (!statsRes.ok) {
      return { success: false, error: statsRes.message || "Could not load attendance statistics." };
    }

    const stats = statsRes.payload?.stats || {};

    // Dynamic per-class/section breakdown over matched sheets
    const breakdownMap = new Map();
    for (const rec of records) {
      const key = rec.classSection || [rec.className, rec.sectionName].filter(Boolean).join(" - ") || "Unknown";
      const c = extractRecordCounts(rec);
      const prev = breakdownMap.get(key) || {
        classSection: key,
        sheets: 0,
        total: 0,
        present: 0,
        absent: 0,
        late: 0,
        halfDay: 0,
        leave: 0,
      };
      prev.sheets += 1;
      prev.total += c.total;
      prev.present += c.present;
      prev.absent += c.absent;
      prev.late += c.late;
      prev.halfDay += c.halfDay;
      prev.leave += c.leave;
      breakdownMap.set(key, prev);
    }

    const breakdown = Array.from(breakdownMap.values())
      .map((b) => {
        const denom = Math.max(1, b.total - b.leave);
        return {
          ...b,
          attendanceRate: b.total > 0 ? `${Math.min(100, Math.round(((b.present + b.halfDay * 0.5) / denom) * 100))}%` : "0%",
        };
      })
      .sort((a, b) => a.classSection.localeCompare(b.classSection));

    return {
      success: true,
      type,
      period: {
        date: args.date || null,
        startDate: args.startDate || null,
        endDate: args.endDate || null,
        month: args.month || null,
        year: args.year || null,
        timeZone,
      },
      stats,
      summary: {
        totalStudents: stats.totalStudents ?? 0,
        present: stats.present ?? 0,
        absent: stats.absent ?? 0,
        late: stats.late ?? 0,
        halfDay: stats.halfDay ?? 0,
        leave: stats.leave ?? 0,
        attendanceRate: stats.overallAttendance || `${stats.percentage ?? 0}%`,
        recordsCount: stats.recordsCount ?? records.length,
        todayPresent: stats.todayPresent ?? 0,
        todayAbsent: stats.todayAbsent ?? 0,
        notTaken: stats.notTaken ?? "0 Pending",
      },
      classBreakdown: breakdown,
    };
  },

  async getStudentAttendance(args = {}, context) {
    const resolved = await resolveStudentForAi(args, context);
    if (resolved.error) {
      return { success: false, error: resolved.error, ...(resolved.matches ? { matches: resolved.matches } : {}) };
    }
    const student = resolved.student;
    const studentId = idStr(student);

    const { ok, message, payload } = await invokeController(getStudentAttendanceController, context, {
      params: { studentId },
      query: {
        date: args.date,
        startDate: args.startDate,
        endDate: args.endDate,
        month: args.month,
        year: args.year,
        status: args.status,
      },
    });
    if (!ok) return { success: false, error: message || "Could not load student attendance." };

    const logs = payload.logs || [];
    const streak = computeStreaks(logs);

    return {
      success: true,
      studentId,
      student: {
        id: studentId,
        name: student.name,
        admissionNumber: student.admissionNumber || "—",
        rollNumber: student.rollNumber ?? "—",
        className: student.className || student.class || "—",
        sectionName: student.sectionName || student.section || "—",
      },
      summary: payload.summary,
      streak,
      recordsCount: logs.length,
      recentLogs: logs.slice(0, 60),
    };
  },

  async getMyAttendanceSummary(args = {}, context) {
    const { ok, message, payload } = await invokeController(getMyAttendance, context, {});
    if (!ok) return { success: false, error: message || "Could not load your attendance." };

    let logs = payload.logs || [];
    const hasFilter = args.month || args.year || (args.status && args.status !== "all");
    const dateRange =
      args.month || args.year
        ? parseDateRange({ month: args.month, year: args.year })
        : null;

    if (hasFilter) {
      logs = logs.filter((l) => {
        if (dateRange) {
          if (dateRange.startKey && l.date < dateRange.startKey) return false;
          if (dateRange.endKey && l.date > dateRange.endKey) return false;
        }
        if (args.status && args.status !== "all") {
          const target = normalizeAttendanceStatus(args.status) || String(args.status).toLowerCase();
          const entry = normalizeAttendanceStatus(l.status) || String(l.status).toLowerCase();
          if (entry !== target) return false;
        }
        return true;
      });
    }

    const presentCount = logs.filter((l) => l.status === "Present").length;
    const absentCount = logs.filter((l) => l.status === "Absent").length;
    const lateCount = logs.filter((l) => l.status === "Late").length;
    const halfDayCount = logs.filter((l) => l.status === "Half Day").length;
    const leaveCount = logs.filter((l) => l.status === "Leave").length;
    const totalDays = logs.length;
    const denom = Math.max(1, totalDays - leaveCount);
    const percentage = totalDays
      ? `${Math.min(100, Math.round(((presentCount + halfDayCount * 0.5) / denom) * 100))}%`
      : "0%";

    return {
      success: true,
      userRole: payload.userRole || context?.user?.role,
      summary: hasFilter
        ? { totalDays, presentCount, absentCount, halfDayCount, lateCount, leaveCount, percentage }
        : {
            ...payload.summary,
            percentage: payload.summary?.percentage === "N/A" ? "0%" : payload.summary?.percentage || "0%",
          },
      streak: computeStreaks(logs),
      logs: logs.slice(0, 60),
    };
  },

  async getLowAttendanceStudents(args = {}, context) {
    const threshold = Number(args.threshold ?? 75);
    const minDays = Math.max(1, Number(args.minDays ?? 1));
    const minConsecAbsent = args.consecutiveAbsentDays ? Number(args.consecutiveAbsentDays) : 0;

    const req = getContextReq(context);
    const scope = getAcademicScope();
    const { timeZone } = await resolveSchoolClock(req);

    // Load active scoped roster
    let roster = [];
    if (scope) {
      const rawRoster = await scopedStudentRoster(req, { personal: false });
      const grade = args.class ? gradeByValue(scope.grades, args.class) : null;
      const sec = args.section ? sectionByValue(args.section) : null;
      roster = rawRoster.filter((s) => {
        if (s.status === "inactive" || s.status === "Passout") return false;
        if (args.class) {
          if (grade) {
            if (String(s.classId) !== grade.id && classKey(s.className) !== classKey(grade.name)) return false;
          } else if (classKey(s.className || s.class) !== classKey(args.class)) {
            return false;
          }
        }
        if (sec && !sectionMatches(sec, s)) return false;
        return true;
      });
    } else if (checkFallback()) {
      roster = (FallbackDb.find("students") || []).filter(
        (s) => s.status !== "inactive" && s.status !== "Passout"
      );
    } else {
      roster = await Student.find({ status: { $nin: ["inactive", "Passout"] } })
        .select("_id name admissionNumber rollNumber className class sectionName section")
        .lean();
    }

    const rosterMap = new Map(roster.map((s) => [idStr(s), s]));
    const records = await fetchAllAttendanceRecords(context, {
      type: "student",
      ...(args.class ? { class: args.class } : {}),
      ...(args.section ? { section: args.section } : {}),
      ...(args.month ? { month: String(args.month) } : {}),
      ...(args.year ? { year: String(args.year) } : {}),
    });

    // Sort chronologically so consecutive absence streaks compute accurately
    const chronoRecords = [...records].sort((a, b) =>
      recordDayKey(a, timeZone).localeCompare(recordDayKey(b, timeZone))
    );

    const perStudent = new Map();
    for (const att of chronoRecords) {
      const list = att.students || att.records || att.attendance || [];
      for (const entry of list) {
        const sid = String(entry.studentId || entry.memberId || entry.id || "");
        if (!sid) continue;
        if (rosterMap.size > 0 && !rosterMap.has(sid)) continue;

        const studentMeta = rosterMap.get(sid);
        let st = perStudent.get(sid);
        if (!st) {
          st = {
            studentId: sid,
            name: studentMeta?.name || entry.name || "Unknown",
            admissionNumber: studentMeta?.admissionNumber || "—",
            rollNumber: studentMeta?.rollNumber ?? entry.rollNo ?? "—",
            classSection:
              att.classSection ||
              [studentMeta?.className || studentMeta?.class, studentMeta?.sectionName || studentMeta?.section]
                .filter(Boolean)
                .join(" - ") ||
              "—",
            total: 0,
            present: 0,
            absent: 0,
            late: 0,
            halfDay: 0,
            leave: 0,
            currentAbsentStreak: 0,
            maxConsecutiveAbsent: 0,
          };
          perStudent.set(sid, st);
        }

        const norm = normalizeAttendanceStatus(entry.status || "present");
        st.total += 1;
        if (norm === "present") {
          st.present += 1;
          st.currentAbsentStreak = 0;
        } else if (norm === "late") {
          st.late += 1;
          st.currentAbsentStreak = 0;
        } else if (norm === "half day") {
          st.halfDay += 1;
          st.currentAbsentStreak = 0;
        } else if (norm === "leave") {
          st.leave += 1;
        } else if (norm === "absent") {
          st.absent += 1;
          st.currentAbsentStreak += 1;
          if (st.currentAbsentStreak > st.maxConsecutiveAbsent) {
            st.maxConsecutiveAbsent = st.currentAbsentStreak;
          }
        }
      }
    }

    const students = Array.from(perStudent.values())
      .filter((s) => s.total >= minDays)
      .map((s) => {
        const denom = Math.max(1, s.total - s.leave);
        const percentage = Math.min(100, Math.round(((s.present + s.halfDay * 0.5) / denom) * 100));
        return { ...s, percentage };
      })
      .filter((s) => {
        if (minConsecAbsent > 0) {
          return s.maxConsecutiveAbsent >= minConsecAbsent || s.percentage < threshold;
        }
        return s.percentage < threshold;
      })
      .sort((a, b) => a.percentage - b.percentage || b.absent - a.absent);

    return {
      success: true,
      threshold: `${threshold}%`,
      consecutiveAbsentFilter: minConsecAbsent || null,
      count: students.length,
      students: students.slice(0, 35),
    };
  },

  async markAttendance(args = {}, context) {
    const req = getContextReq(context);
    const scope = getAcademicScope();
    if (scope?.readOnly) {
      return { success: false, error: "This academic session is read-only. Switch to the active session to mark attendance." };
    }

    const { timeZone, todayDay } = await resolveSchoolClock(req);
    const type = String(args.type || "student").toLowerCase() === "teacher" ? "teacher" : "student";
    const parsedDate = parseCalendarInput(args.date || todayDay, timeZone);
    if (!parsedDate) {
      return { success: false, error: `Invalid date "${args.date}". Use YYYY-MM-DD format.` };
    }
    const dayKey = parsedDate.dayKey;

    if (dayKey > todayDay) {
      return { success: false, error: `Attendance cannot be marked for future date ${dayKey}. School today is ${todayDay}.` };
    }

    const defaultNorm = normalizeAttendanceStatus(args.defaultStatus || "present");
    if (!defaultNorm) {
      return { success: false, error: `Invalid defaultStatus "${args.defaultStatus}". Use present, absent, late, half day, or leave.` };
    }

    if (type === "student" && (!args.class || !args.section)) {
      return { success: false, error: "Both class and section are required to mark student attendance." };
    }

    const departmentName = String(args.department || "All Departments").trim() || "All Departments";

    // Check status overview (validates session bounds, Sunday, and duplicate same-day attendance!)
    const statusRes = await invokeController(getAttendanceStatusOverview, context, {
      query: {
        date: dayKey,
        type,
        ...(type === "student" ? { class: args.class, section: args.section } : { department: departmentName }),
      },
    });
    if (!statusRes.ok) {
      return { success: false, error: statusRes.message || "Could not validate attendance availability." };
    }
    const statusData = statusRes.payload || {};
    if (statusData.outsideSession) {
      return {
        success: false,
        error: `Date ${dayKey} is outside the active academic session (${statusData.sessionStartDate} to ${statusData.sessionEndDate}).`,
      };
    }
    if (statusData.exists && statusData.existingRecord) {
      const ex = statusData.existingRecord;
      return {
        success: false,
        isDuplicate: true,
        existingRecordId: idStr(ex),
        existingSummary: extractRecordCounts(ex),
        error: `Attendance for ${type === "teacher" ? departmentName : `${args.class} - ${args.section}`} on ${dayKey} is already recorded (by ${ex.takenBy?.name || "Staff"}). Same-day duplicates are blocked — ask to update the existing record instead.`,
      };
    }

    // Load active roster + approved leaves
    let resolvedClassId = args.class;
    let resolvedClassName = args.class;
    let resolvedSectionId = args.section;
    let resolvedSectionName = args.section;
    let rosterMembers = [];

    if (type === "student") {
      const grade = scope?.grades?.length ? gradeByValue(scope.grades, args.class) : null;
      if (scope && !grade) {
        return { success: false, error: `Class "${args.class}" does not match any grade in the current academic session.` };
      }
      if (grade) {
        resolvedClassId = grade.id;
        resolvedClassName = grade.name;
      }
      const secDesc = sectionByValue(args.section);
      if (!secDesc) {
        return { success: false, error: `Section "${args.section}" is not valid.` };
      }
      resolvedSectionId = secDesc.id;
      resolvedSectionName = secDesc.name;

      let studentsList = [];
      if (scope) {
        studentsList = (await scopedStudentRoster(req, { personal: false })).filter((s) => {
          if (s.status === "inactive" || s.status === "Passout") return false;
          if (grade && String(s.classId) !== grade.id && classKey(s.className) !== classKey(grade.name)) return false;
          if (!sectionMatches(secDesc, s)) return false;
          return true;
        });
      } else if (checkFallback()) {
        studentsList = (FallbackDb.find("students") || []).filter(
          (s) =>
            s.status !== "inactive" &&
            s.status !== "Passout" &&
            classKey(s.className || s.class) === classKey(resolvedClassName) &&
            sectionMatches(secDesc, s)
        );
      } else {
        studentsList = await Student.find({ status: { $nin: ["inactive", "Passout"] } }).lean();
        studentsList = studentsList.filter(
          (s) =>
            classKey(s.className || s.class) === classKey(resolvedClassName) &&
            sectionMatches(secDesc, s)
        );
      }

      if (studentsList.length === 0) {
        return {
          success: false,
          error: `No active students found in ${resolvedClassName} - ${resolvedSectionName}.`,
        };
      }

      const leaveRes = await invokeController(getActiveLeavesOnDate, context, {
        query: {
          date: dayKey,
          className: resolvedClassName,
          sectionName: resolvedSectionName,
          type: "student",
        },
      });
      const activeLeaves = leaveRes.ok ? leaveRes.payload?.leaves || [] : [];
      const protectLeaves = args.protectApprovedLeaves !== false;

      rosterMembers = studentsList
        .map((s) => {
          const sid = idStr(s);
          const adm = String(s.admissionNumber || "");
          const rollStr = String(s.rollNumber ?? "");
          const matchedLeave = activeLeaves.find(
            (l) =>
              (l.applicantId && String(l.applicantId) === sid) ||
              (adm && l.admissionNumber && String(l.admissionNumber) === adm) ||
              (rollStr && l.rollNumber && String(l.rollNumber) === rollStr)
          );
          const leaveProtected = protectLeaves && matchedLeave;
          return {
            studentId: sid,
            name: `${s.firstName || ""} ${s.lastName || ""}`.trim() || s.name || "Unknown",
            rollNo: s.rollNumber ?? adm ?? "",
            status: leaveProtected
              ? matchedLeave.isHalfDay
                ? "half day"
                : "leave"
              : defaultNorm,
            remarks: leaveProtected
              ? `Approved Leave: ${matchedLeave.category || "Leave"}${matchedLeave.reason ? ` — ${matchedLeave.reason}` : ""}`
              : "",
            _onApprovedLeave: Boolean(matchedLeave),
          };
        })
        .sort((a, b) => (Number(a.rollNo) || 9999) - (Number(b.rollNo) || 9999) || a.name.localeCompare(b.name));
    } else {
      const schoolId = context?.schoolId || context?.user?.schoolId;
      let teachersList = checkFallback()
        ? await readProcurement(req).find("teachers")
        : await Teacher.find({ schoolId, status: { $ne: "inactive" } }).lean();
      teachersList = teachersList.filter((t) => t.status !== "inactive");
      if (classKey(departmentName) !== "all departments") {
        teachersList = teachersList.filter((t) => classKey(t.department) === classKey(departmentName));
      }
      if (teachersList.length === 0) {
        return { success: false, error: `No active teachers/staff found for ${departmentName}.` };
      }

      const leaveRes = await invokeController(getActiveLeavesOnDate, context, {
        query: { date: dayKey, type: "teacher" },
      });
      const activeLeaves = leaveRes.ok ? leaveRes.payload?.leaves || [] : [];
      const protectLeaves = args.protectApprovedLeaves !== false;

      rosterMembers = teachersList
        .map((t) => {
          const tid = idStr(t);
          const empId = String(t.employeeId || "");
          const matchedLeave = activeLeaves.find(
            (l) =>
              (l.applicantId && String(l.applicantId) === tid) ||
              (empId && l.employeeId && String(l.employeeId) === empId)
          );
          const leaveProtected = protectLeaves && matchedLeave;
          return {
            studentId: tid,
            name: t.name || `${t.firstName || ""} ${t.lastName || ""}`.trim() || "Staff Member",
            rollNo: empId || tid,
            status: leaveProtected ? (matchedLeave.isHalfDay ? "half day" : "leave") : defaultNorm,
            remarks: leaveProtected
              ? `Approved Leave: ${matchedLeave.category || "Leave"}${matchedLeave.reason ? ` — ${matchedLeave.reason}` : ""}`
              : "",
            _onApprovedLeave: Boolean(matchedLeave),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    // Apply overrides cleanly
    const overrides = Array.isArray(args.statusOverrides) ? args.statusOverrides : [];
    const appliedOverrides = [];
    for (const ov of overrides) {
      const norm = normalizeAttendanceStatus(ov.status);
      if (!norm) {
        return { success: false, error: `Invalid override status "${ov.status}". Allowed: present, absent, late, half day, leave.` };
      }
      const matched = matchOverrideMember(rosterMembers, ov);
      if (matched.error) return { success: false, error: matched.error };
      matched.member.status = norm;
      if (ov.remarks !== undefined) matched.member.remarks = String(ov.remarks).trim();
      appliedOverrides.push({ name: matched.member.name, rollNo: matched.member.rollNo, status: formatStatusLabel(norm) });
    }

    const counts = summarizeFormattedList(rosterMembers);
    const approvedLeavesDetected = rosterMembers.filter((m) => m._onApprovedLeave).length;
    const cleanStudents = rosterMembers.map(({ _onApprovedLeave, ...rest }) => rest);
    const targetLabel =
      type === "teacher"
        ? `Staff - ${departmentName}`
        : `${resolvedClassName} - ${resolvedSectionName}`;

    if (args.confirm !== true) {
      return {
        success: true,
        requiresConfirmation: true,
        action: "markAttendance",
        title: `Confirm ${type === "teacher" ? "Staff" : "Class"} Attendance`,
        message: `Ready to record ${targetLabel} attendance for ${dayKey}${statusData.isSunday ? " (Sunday)" : ""}: ${counts.present} Present, ${counts.absent} Absent, ${counts.late} Late, ${counts.halfDay} Half Day, ${counts.leave} Leave (${counts.total} total, ${counts.percentage}%).`,
        confirmationDetails: {
          Date: `${dayKey}${statusData.isSunday ? " (Sunday)" : ""}`,
          Target: targetLabel,
          Total: counts.total,
          Breakdown: `${counts.present}P · ${counts.absent}A · ${counts.late}L · ${counts.halfDay}HD · ${counts.leave}LV`,
          ApprovedLeavesAutoMarked: approvedLeavesDetected,
          Rate: `${counts.percentage}%`,
        },
        preview: {
          date: dayKey,
          type,
          targetLabel,
          isSunday: Boolean(statusData.isSunday),
          counts,
          approvedLeavesDetected,
          appliedOverrides,
        },
      };
    }

    const createPayload = {
      date: dayKey,
      attendanceDate: dayKey,
      attendanceTakenDate: new Date().toISOString(),
      type,
      ...(type === "student"
        ? {
            classId: resolvedClassId,
            sectionId: resolvedSectionId,
            className: resolvedClassName,
            sectionName: resolvedSectionName,
          }
        : {
            department: departmentName,
            sectionName: departmentName,
          }),
      classSection: targetLabel,
      takenBy: {
        userId: idStr(context?.user),
        name: context?.user?.name || context?.user?.username || "Administrator",
      },
      students: cleanStudents,
    };

    const savedRes = await invokeController(createAttendance, context, { body: createPayload });
    if (!savedRes.ok) {
      return {
        success: false,
        statusCode: savedRes.statusCode,
        error: savedRes.message || "Could not submit attendance.",
      };
    }

    const rec = savedRes.payload?.record;
    return {
      success: true,
      message: savedRes.message || `Attendance recorded for ${targetLabel} on ${dayKey}.`,
      summary: {
        totalStudents: counts.total,
        present: counts.present,
        absent: counts.absent,
        late: counts.late,
        halfDay: counts.halfDay,
        leave: counts.leave,
        attendanceRate: `${counts.percentage}%`,
      },
      record: {
        id: idStr(rec),
        date: dayKey,
        type,
        classSection: targetLabel,
        takenBy: createPayload.takenBy.name,
        ...counts,
      },
    };
  },

  async updateAttendanceRecord(args = {}, context) {
    const scope = getAcademicScope();
    if (scope?.readOnly) {
      return { success: false, error: "This academic session is read-only. Switch to the active session to update attendance." };
    }

    const req = getContextReq(context);
    const { timeZone, todayDay } = await resolveSchoolClock(req);
    const updates = Array.isArray(args.updates) ? args.updates : [];
    if (updates.length === 0) {
      return { success: false, error: "Provide at least one student or staff status update in `updates`." };
    }

    let existing = null;
    if (args.attendanceId) {
      const byIdRes = await invokeController(getAttendanceById, context, {
        params: { id: args.attendanceId },
      });
      if (byIdRes.ok && byIdRes.payload?.record) {
        existing = byIdRes.payload.record;
      }
    } else {
      const type = String(args.type || "student").toLowerCase() === "teacher" ? "teacher" : "student";
      const parsedDate = parseCalendarInput(args.date || todayDay, timeZone);
      if (!parsedDate) {
        return { success: false, error: `Invalid date "${args.date}". Use YYYY-MM-DD.` };
      }
      if (type === "student" && (!args.class || !args.section)) {
        return { success: false, error: "Provide attendanceId, or provide date with both class and section." };
      }
      const statusRes = await invokeController(getAttendanceStatusOverview, context, {
        query: {
          date: parsedDate.dayKey,
          type,
          ...(type === "student" ? { class: args.class, section: args.section } : { department: args.department || "All Departments" }),
        },
      });
      existing = statusRes.ok ? statusRes.payload?.existingRecord || null : null;
    }

    if (!existing) {
      return { success: false, error: "No matching attendance record was found to update." };
    }

    const recordId = idStr(existing);
    const rawList = existing.students || existing.records || existing.attendance || [];
    const workingList = rawList.map((item) => ({
      studentId: String(item.studentId || item.memberId || item.id || ""),
      name: item.name || "",
      rollNo: item.rollNo ?? item.roll ?? "",
      status: normalizeAttendanceStatus(item.status) || "present",
      remarks: item.remarks || "",
    }));

    const changes = [];
    for (const upd of updates) {
      const norm = normalizeAttendanceStatus(upd.status);
      if (!norm) {
        return { success: false, error: `Invalid status "${upd.status}". Allowed: present, absent, late, half day, leave.` };
      }
      const matched = matchOverrideMember(workingList, upd);
      if (matched.error) return { success: false, error: matched.error };
      const oldStatus = formatStatusLabel(matched.member.status);
      matched.member.status = norm;
      if (upd.remarks !== undefined) matched.member.remarks = String(upd.remarks).trim();
      changes.push({
        name: matched.member.name,
        from: oldStatus,
        to: formatStatusLabel(norm),
      });
    }

    const counts = summarizeFormattedList(workingList);
    const dayKey = existing.attendanceDateKey || recordDayKey(existing, timeZone);
    const targetLabel =
      existing.classSection ||
      [existing.className, existing.sectionName].filter(Boolean).join(" - ") ||
      "Attendance Record";

    if (args.confirm !== true) {
      return {
        success: true,
        requiresConfirmation: true,
        action: "updateAttendanceRecord",
        title: `Confirm Attendance Update`,
        message: `Update ${targetLabel} (${dayKey}): ${changes.map((c) => `${c.name}: ${c.from} → ${c.to}`).join(", ")}. New summary: ${counts.present}P · ${counts.absent}A · ${counts.late}L · ${counts.halfDay}HD · ${counts.leave}LV (${counts.percentage}%).`,
        confirmationDetails: {
          RecordId: recordId,
          Date: dayKey,
          Target: targetLabel,
          Changes: changes.map((c) => `${c.name} (${c.from} -> ${c.to})`).join("; "),
          UpdatedSummary: `${counts.present}P · ${counts.absent}A · ${counts.late}L · ${counts.halfDay}HD · ${counts.leave}LV (${counts.percentage}%)`,
        },
        preview: { recordId, date: dayKey, targetLabel, changes, counts },
      };
    }

    const updRes = await invokeController(updateAttendance, context, {
      params: { id: recordId },
      body: {
        attendanceTakenDate: new Date().toISOString(),
        takenBy: {
          userId: idStr(context?.user),
          name: context?.user?.name || context?.user?.username || "Administrator",
        },
        students: workingList,
      },
    });

    if (!updRes.ok) {
      return {
        success: false,
        statusCode: updRes.statusCode,
        error: updRes.message || "Could not update attendance record.",
      };
    }

    return {
      success: true,
      message: updRes.message || `Updated attendance for ${targetLabel} (${dayKey}).`,
      changes,
      summary: {
        totalStudents: counts.total,
        present: counts.present,
        absent: counts.absent,
        late: counts.late,
        halfDay: counts.halfDay,
        leave: counts.leave,
        attendanceRate: `${counts.percentage}%`,
      },
      record: {
        id: recordId,
        date: dayKey,
        classSection: targetLabel,
        ...counts,
      },
    };
  },
};
