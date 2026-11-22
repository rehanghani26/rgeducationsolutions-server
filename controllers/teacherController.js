// 3. Configuration
import { checkFallback } from "../config/db.js";

// 4. Models
import Teacher from "../models/Teacher.js";
import User from "../models/User.js";

// 6. Services
import { FallbackDb } from "../services/dbFallback.js";
import { getSchool, readProcurement } from "../services/procurementStore.js";
import {
  canViewPrivateTeacherDetails, findTeacherProfile, registerTeacher, saveTeacherProfile, teacherProfileResponse,
} from "../services/teacherProfileService.js";
import { readTeacherPeriods, summarizeTeacherPeriods } from "../services/teacherTimetableService.js";

// 7. Utilities
import { getRecordActivity, logActivity } from "../utils/activityLogger.js";
import { getAcademicScope } from "../utils/academicScope.js";
import {
  generateSecurePassword,
  isValidObjectId,
} from "../utils/commonUtil.js";
import { recordId, sendProcurementError } from "../utils/procurementValues.js";
import {
  buildSearchFilter,
  paginateArray,
  paginateResult,
  parsePagination,
} from "../utils/paginateQuery.js";
import {
  sendBadRequest,
  sendCreated,
  sendError,
  sendNotFound,
  sendSuccess,
} from "../utils/responseUtil.js";

/**
 * @file teacherController.js
 * @description Controller for faculty teacher operations, credentials sync, and bulk actions.
 */

async function teacherDirectoryProfiles(req, records) {
  const schedules = await readTeacherPeriods(req, records);
  return records.map((teacher) => ({
    ...teacherProfileResponse(teacher),
    ...summarizeTeacherPeriods(schedules.get(String(recordId(teacher)))),
  }));
}

/**
 * Retrieves paginated list of teachers.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getTeachers = async (req, res) => {
  try {
    const { page, limit, skip, sort, search, status } = parsePagination(
      req.query
    );
    const searchFields = [
      "name",
      "employeeId",
      "email",
      "designation",
      "department",
      "phone",
    ];

    if (checkFallback()) {
      const list = await readProcurement(req).find("teachers");
      const result = paginateArray(list, {
        page,
        limit,
        search,
        status,
        searchFields,
      });
      const teachers = await teacherDirectoryProfiles(req, result.data);
      return sendSuccess(res, undefined, null, 200, { ...result, data: teachers, teachers });
    }

    const filter = { ...buildSearchFilter(search, searchFields), schoolId: getSchool(req) };
    if (status) filter.status = status;

    const sortObj = {};
    const sortField = sort.startsWith("-") ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith("-") ? -1 : 1;

    const [teachers, total] = await Promise.all([
      Teacher.find(filter)
        .populate("user", "username email role isActive lastLogin")
        .sort(sortObj)
        .skip(skip)
        .limit(limit),
      Teacher.countDocuments(filter),
    ]);

    const profiles = await teacherDirectoryProfiles(req, teachers);
    return sendSuccess(res, undefined, null, 200, { teachers: profiles, ...paginateResult(profiles, total, { page, limit }) });
  } catch (error) {
    console.error("getTeachers error:", error);
    return sendError(res, "Server error", 500);
  }
};

/**
 * Retrieves a single teacher by ID or employeeId.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getTeacherById = async (req, res) => {
  try {
    const teacher = await findTeacherProfile(req, req.params.id);
    if (!teacher) return sendNotFound(res, "Teacher record not found");
    const schedules = await readTeacherPeriods(req, [teacher]);
    const periods = schedules.get(String(recordId(teacher)));
    const scope = getAcademicScope();
    const showPrivate = canViewPrivateTeacherDetails(req, teacher);
    if (showPrivate) res.set('Cache-Control', 'private, no-store');
    return sendSuccess(res, undefined, null, 200, {
      teacher: { ...teacherProfileResponse(teacher, showPrivate), ...summarizeTeacherPeriods(periods) },
      timetable: {
        sessionId: scope?.legacy ? 'legacy' : scope?.sessionId || null,
        sessionName: scope?.session?.sessionName || '',
        periods,
      },
    });
  } catch (error) {
    return sendProcurementError(res, error);
  }
};

export const getTeacherFile = async (req, res) => {
  try {
    const { id, kind } = req.params;
    const field = { photo: 'photoFile', aadhaar: 'aadhaarFile' }[kind];
    if (!['photo', 'aadhaar'].includes(kind)) return sendNotFound(res, 'Teacher file not found');
    const teacher = await findTeacherProfile(req, id, field);
    if (!teacher || !teacher[field] || (kind === 'aadhaar' && !canViewPrivateTeacherDetails(req, teacher))) {
      return sendNotFound(res, 'Teacher file not found');
    }
    const file = teacher[field];
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (kind === 'aadhaar') res.attachment(file.name);
    res.type(file.mimeType);
    return res.send(Buffer.from(file.data, 'base64'));
  } catch (error) {
    return sendProcurementError(res, error);
  }
};

/**
 * Retrieves audit activity and login history for a teacher.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getTeacherActivity = async (req, res) => {
  try {
    const teacher = await findTeacherProfile(req, req.params.id);
    if (!teacher) return sendNotFound(res, 'Teacher record not found');
    let logs = [];
    try {
      logs = await getRecordActivity("teachers", recordId(teacher));
    } catch {
      logs = [];
    }
    let loginHistory = [];
    if (teacher.user && canViewPrivateTeacherDetails(req, teacher)) {
      const user = checkFallback()
        ? await readProcurement(req).get('users', teacher.user)
        : await User.findOne({ _id: teacher.user, schoolId: getSchool(req) }).select('loginHistory').lean();
      loginHistory = user?.loginHistory || [];
    }

    return sendSuccess(res, undefined, null, 200, { logs, loginHistory });
  } catch (error) {
    console.error("getTeacherActivity error:", error);
    return sendError(res, "Server error", 500);
  }
};

/**
 * Creates a new teacher record and companion user authentication account.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const createTeacher = async (req, res) => {
  try {
    const { teacher, password } = await registerTeacher(req, req.body, { files: req.files });
    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: "CREATE", module: "teachers", recordId: recordId(teacher),
      details: "Created teacher " + teacher.name, ipAddress: req.ip,
    });
    res.set('Cache-Control', 'private, no-store');
    return sendCreated(res, "Teacher and login credentials created", null, {
      teacher: teacherProfileResponse(teacher, true),
      accountCreated: { employeeId: teacher.employeeId, email: teacher.email, temporaryPassword: password },
    });
  } catch (error) {
    return sendProcurementError(res, error);
  }
};

export const updateTeacher = async (req, res) => {
  try {
    const teacher = await saveTeacherProfile(req, req.params.id, req.body, req.files);
    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: "UPDATE", module: "teachers", recordId: recordId(teacher),
      details: "Updated teacher " + teacher.name, ipAddress: req.ip,
    });
    return sendSuccess(res, "Teacher updated", null, 200, { teacher: teacherProfileResponse(teacher, true) });
  } catch (error) {
    return sendProcurementError(res, error);
  }
};

export const deactivateTeacher = async (req, res) => {
  req.body.status = "inactive";
  return updateTeacher(req, res);
};

/**
 * Resets teacher credentials.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const resetTeacherPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const password = req.body.generateRandomPassword
      ? generateSecurePassword("Tch@")
      : req.body.password;

    if (typeof password !== 'string' || password.trim().length < 6) {
      return sendBadRequest(res, "Password must be at least 6 characters");
    }

    const teacher = await findTeacherProfile(req, id);

    if (!teacher) {
      return sendNotFound(res, "Teacher record not found");
    }

    const forcePasswordChange = Boolean(req.body.forcePasswordChange);
    if (checkFallback()) {
      const user = await readProcurement(req).get('users', teacher.user);
      if (!user) return sendNotFound(res, "Teacher login account not found");
      FallbackDb.update("users", teacher.user, {
        password, tempPassword: password, forcePasswordChange,
      });
    } else {
      const user = await User.findOne({ _id: teacher.user, schoolId: getSchool(req) });
      if (!user) return sendNotFound(res, "Teacher login account not found");
      user.password = password;
      user.forcePasswordChange = forcePasswordChange;
      await user.save();
    }

    res.set('Cache-Control', 'private, no-store');
    return sendSuccess(res, "Teacher password reset successfully", null, 200, {
      account: {
        employeeId: teacher.employeeId,
        email: teacher.email,
        temporaryPassword: password,
      },
    });
  } catch (error) {
    console.error("resetTeacherPassword error:", error);
    return sendError(res, error.message || "Server error", 500);
  }
};

/**
 * Deletes a teacher and companion User record.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const deleteTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    let success = false;
    let teacherName = "";

    if (checkFallback() || !isValidObjectId(id)) {
      const teacher =
        FallbackDb.findById("teachers", id) ||
        FallbackDb.findOne("teachers", { employeeId: id });
      if (teacher) {
        teacherName = teacher.name;
        if (teacher.user) FallbackDb.delete("users", teacher.user);
        success = FallbackDb.delete("teachers", teacher.id || id);
      }
    } else {
      const teacher = await Teacher.findById(id);
      if (teacher) {
        teacherName = teacher.name;
        if (teacher.user && isValidObjectId(teacher.user)) {
          await User.findByIdAndDelete(teacher.user);
        }
        await Teacher.findByIdAndDelete(id);
        success = true;
      }
    }

    if (!success) {
      return sendNotFound(res, "Teacher record not found");
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: "DELETE",
      module: "teachers",
      recordId: id,
      details: `Deleted teacher ${teacherName}`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return sendSuccess(res, "Teacher and user account deleted successfully");
  } catch (error) {
    console.error("deleteTeacher error:", error);
    return sendError(res, "Server error", 500);
  }
};

/**
 * Bulk deletes multiple teachers.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const bulkDeleteTeachers = async (req, res) => {
  try {
    const { ids = [] } = req.body;
    if (!ids.length) {
      return sendBadRequest(res, "No teacher IDs provided");
    }

    let deleted = 0;
    for (const id of ids) {
      if (checkFallback() || !isValidObjectId(id)) {
        const teacher =
          FallbackDb.findById("teachers", id) ||
          FallbackDb.findOne("teachers", { employeeId: id });
        if (teacher) {
          if (teacher.user) FallbackDb.delete("users", teacher.user);
          if (FallbackDb.delete("teachers", teacher.id || id)) deleted++;
        }
      } else {
        const teacher = await Teacher.findById(id);
        if (teacher) {
          if (teacher.user && isValidObjectId(teacher.user)) {
            await User.findByIdAndDelete(teacher.user);
          }
          await Teacher.findByIdAndDelete(id);
          deleted++;
        }
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: "BULK",
      module: "teachers",
      details: `Bulk deleted ${deleted} teachers`,
      ipAddress: req.ip,
      metadata: { ids },
    });

    return sendSuccess(res, `${deleted} teachers deleted`, null, 200, {
      deleted,
    });
  } catch (error) {
    console.error("bulkDeleteTeachers error:", error);
    return sendError(res, "Server error", 500);
  }
};

/**
 * Exports teacher records in CSV format.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const exportTeachers = async (req, res) => {
  try {
    const records = checkFallback()
      ? await readProcurement(req).find("teachers")
      : await Teacher.find({ schoolId: getSchool(req) }).select("name firstName lastName employeeId user designation department status createdAt");
    const teachers = await teacherDirectoryProfiles(req, records);

    const headers = [
      "Name",
      "Employee ID",
      "Designation",
      "Department",
      "Classes",
      "Status",
      "Created",
    ];
    const rows = teachers.map((t) =>
      [
        t.name,
        t.employeeId,
        t.designation,
        t.department,
        (t.classesAssigned || []).join("; "),
        t.status,
        t.createdAt,
      ]
        .map((v) => `"${String(v || "").replace(/"/g, '""')}"`)
        .join(",")
    );

    const csv = [headers.join(","), ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=teachers.csv");
    return res.send(csv);
  } catch (error) {
    console.error("exportTeachers error:", error);
    return sendError(res, "Server error", 500);
  }
};

/**
 * Retrieves teacher login credentials.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getTeacherCredentials = async (req, res) => {
  try {
    const teacher = await findTeacherProfile(req, req.params.id);
    if (!teacher) return sendNotFound(res, "Teacher record not found");
    const userRecord = await readProcurement(req).get('users', teacher.user);
    if (!userRecord) return sendNotFound(res, "Teacher login account not found");
    const saved = userRecord.password || '';
    const password = userRecord.tempPassword || (/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(saved) ? '' : saved);
    res.set('Cache-Control', 'private, no-store');
    return sendSuccess(res, undefined, null, 200, {
      credentials: {
        username: userRecord.username || teacher.employeeId, email: userRecord.email || teacher.email,
        password, name: teacher.name, employeeId: teacher.employeeId,
      },
    });
  } catch (error) {
    return sendProcurementError(res, error);
  }
};

export const bulkImportTeachers = async (req, res) => {
  const { teachers } = req.body || {};
  if (!Array.isArray(teachers) || !teachers.length) return sendBadRequest(res, "No teacher data provided for import");

  let count = 0;
  const errors = [];
  for (const [index, teacher] of teachers.entries()) {
    try {
      await registerTeacher(req, teacher, { allowGeneratedPassword: true });
      count += 1;
    } catch (error) {
      let message = 'Could not import this teacher. Check the supplied fields.';
      if (error.code === 11000) message = 'Teacher employee ID or email already exists.';
      else if (error.statusCode) message = error.message;
      errors.push({ index, error: message });
    }
  }
  await logActivity({
    userId: req.user?._id || req.user?.id, action: 'BULK', module: 'teachers',
    details: 'Imported ' + count + ' teachers', metadata: { total: teachers.length, count, errors: errors.length },
    ipAddress: req.ip,
  });
  const report = { count, total: teachers.length, errors };
  if (!count) {
    return res.json({
      success: false, schoolId: getSchool(req),
      message: "No teachers were imported. Review the row errors.",
      ...report,
    });
  }
  return sendSuccess(res, "Teacher import completed", null, 200, report);
};
