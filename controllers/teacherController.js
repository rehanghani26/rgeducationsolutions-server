// 2. External packages
import mongoose from "mongoose";

// 3. Configuration
import { checkFallback } from "../config/db.js";

// 4. Models
import Teacher from "../models/Teacher.js";
import User from "../models/User.js";

// 6. Services
import { FallbackDb } from "../services/dbFallback.js";

// 7. Utilities
import { getRecordActivity, logActivity } from "../utils/activityLogger.js";
import {
  formatFullName,
  generateSecurePassword,
  isValidObjectId,
  normalizeEmail,
} from "../utils/commonUtil.js";
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

const DEFAULT_TEACHER_PERMISSIONS = [
  "dashboard",
  "attendance",
  "exam",
  "marks",
  "homework",
  "timetable",
  "leave",
  "communication",
];

const normalizeEmployeeId = (employeeId = "") =>
  employeeId.trim().toUpperCase();

/**
 * Auto-generates sequential employee ID: TCH-0001
 *
 * @returns {Promise<string>} Next employee ID.
 */
const getNextEmployeeId = async () => {
  const prefix = "TCH-";
  let lastId = "TCH-0000";

  if (checkFallback()) {
    const teachers = FallbackDb.find("teachers");
    lastId =
      teachers
        .map((teacher) => teacher.employeeId)
        .filter((id) => /^TCH-\d{4}$/.test(id || ""))
        .sort()
        .pop() || lastId;
  } else {
    const lastTeacher = await Teacher.findOne({ employeeId: /^TCH-\d{4}$/ })
      .sort({ employeeId: -1 })
      .select("employeeId");
    lastId = lastTeacher?.employeeId || lastId;
  }

  const next = Number(lastId.replace(prefix, "")) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
};

/**
 * Normalizes input payload for Teacher creation/update.
 *
 * @param {Record<string, any>} data - Raw input body.
 * @returns {Promise<Record<string, any>>}
 */
const buildTeacherPayload = async (data) => {
  const employeeId =
    normalizeEmployeeId(data.employeeId) || (await getNextEmployeeId());
  const name = formatFullName(data);
  const firstName = data.firstName || name.split(" ")[0];
  const lastName = data.lastName || name.split(" ").slice(1).join(" ") || "-";
  const email = normalizeEmail(
    data.email || `${employeeId.toLowerCase()}@school.local`
  );
  const role = data.role || "teacher";
  const permissions =
    Array.isArray(data.permissions) && data.permissions.length
      ? data.permissions
      : DEFAULT_TEACHER_PERMISSIONS;

  return {
    ...data,
    firstName,
    lastName,
    name,
    email,
    employeeId,
    role,
    permissions,
    phone: data.phone || data.contactNumber || "",
    classesAssigned: data.classesAssigned || data.assignedClasses || [],
    sectionsAssigned: data.sectionsAssigned || data.assignedSections || [],
    subjectsAssigned: data.subjectsAssigned || data.assignedSubjects || [],
    isClassTeacher: Boolean(data.isClassTeacher || data.classTeacher),
    salary: Number(data.salary) || 0,
    status: data.status || "active",
    forcePasswordChange: Boolean(data.forcePasswordChange),
    twoFactorEnabled: Boolean(data.twoFactorEnabled),
    loginRestriction: data.loginRestriction || "none",
  };
};

/**
 * Synchronizes user authentication account with teacher profile.
 */
const syncUserFromTeacher = async ({ teacher, password, existingUser }) => {
  const userData = {
    username: teacher.employeeId.toLowerCase(),
    employeeId: teacher.employeeId,
    email: teacher.email,
    password,
    role: teacher.role,
    permissions: teacher.permissions,
    name: teacher.name,
    profileId: teacher._id,
    isActive: teacher.status === "active",
    forcePasswordChange: teacher.forcePasswordChange,
    accountExpiryDate: teacher.accountExpiryDate,
    loginRestriction: teacher.loginRestriction,
    twoFactorEnabled: teacher.twoFactorEnabled,
  };

  if (existingUser) {
    Object.assign(existingUser, {
      ...userData,
      password: existingUser.password,
    });
    if (password) existingUser.password = password;
    return existingUser.save();
  }

  return User.create(userData);
};

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
      const list = FallbackDb.find("teachers");
      const result = paginateArray(list, {
        page,
        limit,
        search,
        status,
        searchFields,
      });
      return sendSuccess(res, undefined, null, 200, {
        teachers: result.data,
        ...result,
      });
    }

    const filter = { ...buildSearchFilter(search, searchFields) };
    if (status) filter.status = status;

    const sortObj = {};
    const sortField = sort.startsWith("-") ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith("-") ? -1 : 1;

    const [teachers, total] = await Promise.all([
      Teacher.find(filter)
        .populate("user", "username email role permissions isActive lastLogin")
        .sort(sortObj)
        .skip(skip)
        .limit(limit),
      Teacher.countDocuments(filter),
    ]);

    return sendSuccess(res, undefined, null, 200, {
      teachers,
      ...paginateResult(teachers, total, { page, limit }),
    });
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
    const { id } = req.params;
    let teacher = null;

    if (checkFallback() || !isValidObjectId(id)) {
      teacher =
        FallbackDb.findById("teachers", id) ||
        FallbackDb.findOne("teachers", { employeeId: id });
      if (teacher?.user) {
        teacher.userDetails = FallbackDb.findById("users", teacher.user);
      }
    } else {
      teacher = await Teacher.findById(id).populate(
        "user",
        "username email role permissions isActive lastLogin loginHistory forcePasswordChange"
      );
    }

    if (!teacher) {
      return sendNotFound(res, "Teacher record not found");
    }

    return sendSuccess(res, undefined, null, 200, { teacher });
  } catch (error) {
    console.error("getTeacherById error:", error);
    return sendError(res, "Server error", 500);
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
    const { id } = req.params;
    let logs = [];
    try {
      logs = await getRecordActivity("teachers", id);
    } catch (_e) {
      logs = [];
    }
    let loginHistory = [];
    let teacher = null;

    if (checkFallback() || !isValidObjectId(id)) {
      teacher =
        FallbackDb.findById("teachers", id) ||
        FallbackDb.findOne("teachers", { employeeId: id });
      if (teacher?.user) {
        const userObj = FallbackDb.findById("users", teacher.user);
        loginHistory = userObj?.loginHistory || [];
      }
    } else {
      teacher = await Teacher.findById(id).populate(
        "user",
        "loginHistory lastLogin"
      );
      if (teacher?.user && typeof teacher.user === "object") {
        loginHistory = teacher.user.loginHistory || [];
      }
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
    const payload = await buildTeacherPayload(req.body);
    const password = req.body.generateRandomPassword
      ? generateSecurePassword("Tch@")
      : req.body.password;

    if (
      !payload.firstName ||
      !payload.lastName ||
      !payload.email ||
      !payload.phone ||
      !payload.designation
    ) {
      return sendBadRequest(
        res,
        "First name, last name, email, phone, and designation are required"
      );
    }

    if (!password || password.length < 6) {
      return sendBadRequest(
        res,
        "Password must be at least 6 characters"
      );
    }

    if (
      req.body.confirmPassword !== undefined &&
      password !== req.body.confirmPassword
    ) {
      return sendBadRequest(
        res,
        "Password and confirm password do not match"
      );
    }

    if (checkFallback()) {
      const duplicate =
        FallbackDb.findOne("teachers", { employeeId: payload.employeeId }) ||
        FallbackDb.findOne("users", { email: payload.email });
      if (duplicate) {
        return sendError(
          res,
          "Teacher employee ID or email already exists",
          409
        );
      }

      const userRecord = FallbackDb.create("users", {
        username: payload.employeeId.toLowerCase(),
        employeeId: payload.employeeId,
        email: payload.email,
        password,
        role: payload.role,
        permissions: payload.permissions,
        name: payload.name,
        isActive: payload.status === "active",
        forcePasswordChange: payload.forcePasswordChange,
        accountExpiryDate: payload.accountExpiryDate,
        loginRestriction: payload.loginRestriction,
        twoFactorEnabled: payload.twoFactorEnabled,
      });
      const teacherRecord = FallbackDb.create("teachers", {
        ...payload,
        user: userRecord.id,
      });
      FallbackDb.update("users", userRecord.id, {
        profileId: teacherRecord.id,
      });

      await logActivity({
        userId: req.user?._id || req.user?.id,
        action: "CREATE",
        module: "teachers",
        recordId: teacherRecord.id,
        details: `Created teacher ${payload.name}`,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      return sendCreated(
        res,
        "Teacher and login credentials created successfully",
        null,
        {
          teacher: teacherRecord,
          accountCreated: {
            employeeId: payload.employeeId,
            email: payload.email,
            temporaryPassword: password,
          },
        }
      );
    }

    const existingUser = await User.findOne({
      $or: [
        { username: payload.employeeId.toLowerCase() },
        { employeeId: payload.employeeId },
        { email: payload.email },
      ],
    });
    const existingTeacher = await Teacher.findOne({
      employeeId: payload.employeeId,
    });
    if (existingUser || existingTeacher) {
      return sendError(
        res,
        "Teacher employee ID or email already exists",
        409
      );
    }

    const teacherRecord = await Teacher.create(payload);
    const userRecord = await syncUserFromTeacher({
      teacher: teacherRecord,
      password,
    });
    teacherRecord.user = userRecord._id;
    await teacherRecord.save();

    await logActivity({
      userId: req.user?._id,
      action: "CREATE",
      module: "teachers",
      recordId: teacherRecord._id,
      details: `Created teacher ${payload.name}`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return sendCreated(
      res,
      "Teacher and login credentials created successfully",
      null,
      {
        teacher: teacherRecord,
        accountCreated: {
          employeeId: payload.employeeId,
          email: payload.email,
          temporaryPassword: password,
        },
      }
    );
  } catch (error) {
    console.error("createTeacher error:", error);
    return sendError(res, error.message || "Server error", 500);
  }
};

/**
 * Updates an existing teacher record and propagates details to companion User account.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const updateTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    delete updateData.password;
    delete updateData.confirmPassword;
    if (updateData.email) updateData.email = normalizeEmail(updateData.email);
    if (updateData.employeeId) {
      updateData.employeeId = normalizeEmployeeId(updateData.employeeId);
    }
    if (updateData.firstName || updateData.lastName) {
      updateData.name =
        `${updateData.firstName || ""} ${updateData.lastName || ""}`.trim();
    }

    let updatedRecord = null;

    if (checkFallback() || !isValidObjectId(id)) {
      updatedRecord =
        FallbackDb.update("teachers", id, updateData) ||
        FallbackDb.findOne("teachers", { employeeId: id });
      if (updatedRecord?.user) {
        FallbackDb.update("users", updatedRecord.user, {
          username: updatedRecord.employeeId.toLowerCase(),
          employeeId: updatedRecord.employeeId,
          email: updatedRecord.email,
          role: updatedRecord.role,
          permissions: updatedRecord.permissions,
          name: updatedRecord.name,
          isActive: updatedRecord.status === "active",
        });
      }
    } else {
      updatedRecord = await Teacher.findByIdAndUpdate(id, updateData, {
        new: true,
      });
      if (updatedRecord?.user) {
        await User.findByIdAndUpdate(updatedRecord.user, {
          username: updatedRecord.employeeId.toLowerCase(),
          employeeId: updatedRecord.employeeId,
          email: updatedRecord.email,
          role: updatedRecord.role,
          permissions: updatedRecord.permissions,
          name: updatedRecord.name,
          isActive: updatedRecord.status === "active",
          forcePasswordChange: updatedRecord.forcePasswordChange,
          accountExpiryDate: updatedRecord.accountExpiryDate,
          loginRestriction: updatedRecord.loginRestriction,
          twoFactorEnabled: updatedRecord.twoFactorEnabled,
        });
      }
    }

    if (!updatedRecord) {
      return sendNotFound(res, "Teacher record not found");
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: "UPDATE",
      module: "teachers",
      recordId: id,
      details: `Updated teacher ${updatedRecord.name}`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return sendSuccess(res, "Teacher updated successfully", null, 200, {
      teacher: updatedRecord,
    });
  } catch (error) {
    console.error("updateTeacher error:", error);
    return sendError(res, error.message || "Server error", 500);
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

    if (!password || password.length < 6) {
      return sendBadRequest(res, "Password must be at least 6 characters");
    }

    const teacher =
      checkFallback() || !isValidObjectId(id)
        ? FallbackDb.findById("teachers", id) ||
          FallbackDb.findOne("teachers", { employeeId: id })
        : await Teacher.findById(id);

    if (!teacher) {
      return sendNotFound(res, "Teacher record not found");
    }

    if (checkFallback() || !isValidObjectId(teacher.user)) {
      FallbackDb.update("users", teacher.user, {
        password,
        forcePasswordChange: Boolean(req.body.forcePasswordChange),
      });
    } else {
      const user = await User.findById(teacher.user);
      if (user) {
        user.password = password;
        user.forcePasswordChange = Boolean(req.body.forcePasswordChange);
        await user.save();
      }
    }

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
    let teachers = [];
    if (checkFallback()) {
      teachers = FallbackDb.find("teachers");
    } else {
      teachers = await Teacher.find().select(
        "name employeeId designation department classesAssigned status createdAt"
      );
    }

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
    const { id } = req.params;
    let teacher = null;
    let userRecord = null;

    if (checkFallback() || !isValidObjectId(id)) {
      teacher =
        FallbackDb.findById("teachers", id) ||
        FallbackDb.findOne("teachers", { employeeId: id });
      if (teacher?.user) {
        userRecord = FallbackDb.findById("users", teacher.user);
      }
    } else {
      teacher = await Teacher.findById(id);
      if (teacher?.user) {
        userRecord = await User.findById(teacher.user);
      }
    }

    const username = userRecord?.username || teacher?.employeeId || id;
    const email =
      userRecord?.email ||
      teacher?.email ||
      `${String(username).toLowerCase()}@school.local`;

    let password =
      userRecord?.tempPassword ||
      userRecord?.password ||
      teacher?.tempPassword ||
      teacher?.password ||
      "admin";

    if (password.startsWith("$2a$") || password.startsWith("$2b$")) {
      password = userRecord?.tempPassword || teacher?.tempPassword || "admin";
    }

    return sendSuccess(res, undefined, null, 200, {
      credentials: {
        username,
        email,
        password,
        name: teacher?.name || username,
        employeeId: teacher?.employeeId || username,
      },
    });
  } catch (error) {
    console.error("getTeacherCredentials error:", error);
    return sendError(res, "Server error", 500);
  }
};

/**
 * Bulk imports teacher records from an array payload.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const bulkImportTeachers = async (req, res) => {
  try {
    const { teachers } = req.body;
    if (!Array.isArray(teachers) || teachers.length === 0) {
      return sendBadRequest(res, "No teacher data provided for import");
    }

    let successCount = 0;
    const errors = [];

    for (let i = 0; i < teachers.length; i++) {
      const raw = teachers[i];
      try {
        const payload = await buildTeacherPayload(raw);
        let password = raw.password;
        if (!password || password.length < 6) {
          password = generateSecurePassword("Tch@");
        }

        if (!payload.name) payload.name = `Teacher ${payload.employeeId}`;
        if (!payload.phone) payload.phone = "+919876543210";

        let createdTeacher = null;
        if (checkFallback()) {
          const user = FallbackDb.create("users", {
            username: payload.employeeId.toLowerCase(),
            employeeId: payload.employeeId,
            email: payload.email,
            password,
            tempPassword: password,
            role: payload.role || "teacher",
            permissions: payload.permissions,
            name: payload.name,
            isActive: true,
          });
          createdTeacher = FallbackDb.create("teachers", {
            ...payload,
            user: user.id,
            tempPassword: password,
          });
          FallbackDb.update("users", user.id, { profileId: createdTeacher.id });
        } else {
          const existing = await Teacher.findOne({
            employeeId: payload.employeeId,
          });
          if (!existing) {
            const user = await syncUserFromTeacher({
              teacher: { ...payload, _id: new mongoose.Types.ObjectId() },
              password,
            });
            createdTeacher = await Teacher.create({
              ...payload,
              user: user._id,
              tempPassword: password,
            });
            await syncUserFromTeacher({
              teacher: createdTeacher,
              password,
              existingUser: user,
            });
          }
        }
        successCount++;
      } catch (err) {
        errors.push({
          index: i,
          name: raw.firstName || raw.name,
          error: err.message,
        });
      }
    }

    return sendSuccess(
      res,
      `Successfully imported ${successCount} out of ${teachers.length} teachers.`,
      null,
      200,
      {
        count: successCount,
        total: teachers.length,
        errors,
      }
    );
  } catch (error) {
    console.error("bulkImportTeachers error:", error);
    return sendError(res, "Bulk import failed", 500);
  }
};
