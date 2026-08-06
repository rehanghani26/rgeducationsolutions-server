import mongoose from "mongoose";
import Teacher from "../models/Teacher.js";
import User from "../models/User.js";
import { checkFallback } from "../config/db.js";
import { FallbackDb } from "../services/dbFallback.js";
import {
  parsePagination,
  buildSearchFilter,
  paginateResult,
  paginateArray,
} from "../utils/paginateQuery.js";
import { logActivity, getRecordActivity } from "../utils/activityLogger.js";

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

const normalizeEmail = (email = "") => email.trim().toLowerCase();
const normalizeEmployeeId = (employeeId = "") =>
  employeeId.trim().toUpperCase();
const fullName = (data) =>
  data.name || `${data.firstName || ""} ${data.lastName || ""}`.trim();

const generateRandomPassword = () =>
  `Tch@${Math.random().toString(36).slice(2, 8)}${Math.floor(100 + Math.random() * 900)}`;

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

const buildTeacherPayload = async (data) => {
  const employeeId =
    normalizeEmployeeId(data.employeeId) || (await getNextEmployeeId());
  const name = fullName(data);
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
      return res.json({ success: true, teachers: result.data, ...result });
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

    return res.json({
      success: true,
      teachers,
      ...paginateResult(teachers, total, { page, limit }),
    });
  } catch (error) {
    console.error("getTeachers error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getTeacherById = async (req, res) => {
  try {
    const { id } = req.params;
    let teacher = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
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
      return res
        .status(404)
        .json({ success: false, message: "Teacher record not found" });
    }

    return res.json({ success: true, teacher });
  } catch (error) {
    console.error("getTeacherById error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getTeacherActivity = async (req, res) => {
  try {
    const { id } = req.params;
    let logs = [];
    try {
      logs = await getRecordActivity("teachers", id);
    } catch (e) {
      logs = [];
    }
    let loginHistory = [];
    let teacher = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
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

    return res.json({ success: true, logs, loginHistory });
  } catch (error) {
    console.error("getTeacherActivity error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const createTeacher = async (req, res) => {
  try {
    const payload = await buildTeacherPayload(req.body);
    const password = req.body.generateRandomPassword
      ? generateRandomPassword()
      : req.body.password;

    if (
      !payload.firstName ||
      !payload.lastName ||
      !payload.email ||
      !payload.phone ||
      !payload.designation
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message:
            "First name, last name, email, phone, and designation are required",
        });
    }

    if (!password || password.length < 6) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Password must be at least 6 characters",
        });
    }

    if (
      req.body.confirmPassword !== undefined &&
      password !== req.body.confirmPassword
    ) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Password and confirm password do not match",
        });
    }

    if (checkFallback()) {
      const duplicate =
        FallbackDb.findOne("teachers", { employeeId: payload.employeeId }) ||
        FallbackDb.findOne("users", { email: payload.email });
      if (duplicate) {
        return res
          .status(409)
          .json({
            success: false,
            message: "Teacher employee ID or email already exists",
          });
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

      return res.status(201).json({
        success: true,
        message: "Teacher and login credentials created successfully",
        teacher: teacherRecord,
        accountCreated: {
          employeeId: payload.employeeId,
          email: payload.email,
          temporaryPassword: password,
        },
      });
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
      return res
        .status(409)
        .json({
          success: false,
          message: "Teacher employee ID or email already exists",
        });
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

    return res.status(201).json({
      success: true,
      message: "Teacher and login credentials created successfully",
      teacher: teacherRecord,
      accountCreated: {
        employeeId: payload.employeeId,
        email: payload.email,
        temporaryPassword: password,
      },
    });
  } catch (error) {
    console.error("createTeacher error:", error);
    return res
      .status(500)
      .json({ success: false, message: error.message || "Server error" });
  }
};

export const updateTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    delete updateData.password;
    delete updateData.confirmPassword;
    if (updateData.email) updateData.email = normalizeEmail(updateData.email);
    if (updateData.employeeId)
      updateData.employeeId = normalizeEmployeeId(updateData.employeeId);
    if (updateData.firstName || updateData.lastName) {
      updateData.name =
        `${updateData.firstName || ""} ${updateData.lastName || ""}`.trim();
    }

    let updatedRecord = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
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
      return res
        .status(404)
        .json({ success: false, message: "Teacher record not found" });
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

    return res.json({
      success: true,
      message: "Teacher updated successfully",
      teacher: updatedRecord,
    });
  } catch (error) {
    console.error("updateTeacher error:", error);
    return res
      .status(500)
      .json({ success: false, message: error.message || "Server error" });
  }
};

export const deactivateTeacher = async (req, res) => {
  req.body.status = "inactive";
  return updateTeacher(req, res);
};

export const resetTeacherPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const password = req.body.generateRandomPassword
      ? generateRandomPassword()
      : req.body.password;
    if (!password || password.length < 6) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Password must be at least 6 characters",
        });
    }

    const teacher =
      checkFallback() || !mongoose.Types.ObjectId.isValid(id)
        ? FallbackDb.findById("teachers", id) ||
          FallbackDb.findOne("teachers", { employeeId: id })
        : await Teacher.findById(id);
    if (!teacher) {
      return res
        .status(404)
        .json({ success: false, message: "Teacher record not found" });
    }

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(teacher.user)) {
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

    return res.json({
      success: true,
      message: "Teacher password reset successfully",
      account: {
        employeeId: teacher.employeeId,
        email: teacher.email,
        temporaryPassword: password,
      },
    });
  } catch (error) {
    console.error("resetTeacherPassword error:", error);
    return res
      .status(500)
      .json({ success: false, message: error.message || "Server error" });
  }
};

export const deleteTeacher = async (req, res) => {
  try {
    const { id } = req.params;
    let success = false;
    let teacherName = "";

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
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
        if (teacher.user && mongoose.Types.ObjectId.isValid(teacher.user))
          await User.findByIdAndDelete(teacher.user);
        await Teacher.findByIdAndDelete(id);
        success = true;
      }
    }

    if (!success) {
      return res
        .status(404)
        .json({ success: false, message: "Teacher record not found" });
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

    return res.json({
      success: true,
      message: "Teacher and user account deleted successfully",
    });
  } catch (error) {
    console.error("deleteTeacher error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const bulkDeleteTeachers = async (req, res) => {
  try {
    const { ids = [] } = req.body;
    if (!ids.length)
      return res
        .status(400)
        .json({ success: false, message: "No teacher IDs provided" });

    let deleted = 0;
    for (const id of ids) {
      if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
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
          if (teacher.user && mongoose.Types.ObjectId.isValid(teacher.user))
            await User.findByIdAndDelete(teacher.user);
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

    return res.json({
      success: true,
      message: `${deleted} teachers deleted`,
      deleted,
    });
  } catch (error) {
    console.error("bulkDeleteTeachers error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

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
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getAllLeaves = async (req, res) => {
  try {
    let leavesList = [];
    if (checkFallback()) {
      const teachers = FallbackDb.find("teachers") || [];
      teachers.forEach((t) => {
        (t.leaves || []).forEach((l) => {
          leavesList.push({
            ...l,
            teacherId: t.id,
            teacherName: t.name,
            employeeId: t.employeeId,
            designation: t.designation,
            department: t.department,
          });
        });
      });
    } else {
      const teachers = await Teacher.find();
      teachers.forEach((t) => {
        (t.leaves || []).forEach((l) => {
          leavesList.push({
            _id: l._id,
            id: l._id,
            date: l.date,
            reason: l.reason,
            status: l.status,
            teacherId: t._id,
            teacherName: t.name,
            employeeId: t.employeeId,
            designation: t.designation,
            department: t.department,
          });
        });
      });
    }
    leavesList.sort((a, b) => new Date(b.date) - new Date(a.date));
    return res.json({ success: true, leaves: leavesList });
  } catch (error) {
    console.error("getAllLeaves error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const requestLeave = async (req, res) => {
  try {
    const { date, reason } = req.body;
    if (!date || !reason) {
      return res
        .status(400)
        .json({ success: false, message: "Date and reason are required" });
    }

    if (checkFallback()) {
      const teacher =
        FallbackDb.findOne("teachers", { user: req.user.id }) ||
        FallbackDb.findById("teachers", req.user.profileId);
      if (!teacher) {
        return res
          .status(404)
          .json({ success: false, message: "Teacher record not found" });
      }
      const newLeave = {
        id: Math.random().toString(36).substring(2, 9),
        _id: Math.random().toString(36).substring(2, 9),
        date: new Date(date).toISOString(),
        reason,
        status: "pending",
      };
      const leaves = [...(teacher.leaves || []), newLeave];
      FallbackDb.update("teachers", teacher.id, { leaves });
      return res
        .status(201)
        .json({
          success: true,
          message: "Leave requested successfully",
          leaves,
        });
    } else {
      let teacher = await Teacher.findOne({ user: req.user._id });
      if (!teacher && req.user.profileId) {
        teacher = await Teacher.findById(req.user.profileId);
      }
      if (!teacher) {
        return res
          .status(404)
          .json({ success: false, message: "Teacher record not found" });
      }
      teacher.leaves.push({ date: new Date(date), reason, status: "pending" });
      await teacher.save();
      return res
        .status(201)
        .json({
          success: true,
          message: "Leave requested successfully",
          leaves: teacher.leaves,
        });
    }
  } catch (error) {
    console.error("requestLeave error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const reviewLeave = async (req, res) => {
  try {
    const { teacherId, leaveId } = req.params;
    const { status } = req.body;

    if (!["approved", "rejected"].includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(teacherId)) {
      const teacher =
        FallbackDb.findById("teachers", teacherId) ||
        FallbackDb.findOne("teachers", { employeeId: teacherId });
      if (!teacher) {
        return res
          .status(404)
          .json({ success: false, message: "Teacher record not found" });
      }
      const leaves = (teacher.leaves || []).map((l) => {
        if (l.id === leaveId || l._id === leaveId) {
          return { ...l, status };
        }
        return l;
      });
      FallbackDb.update("teachers", teacher.id || teacherId, { leaves });
      return res.json({
        success: true,
        message: `Leave ${status} successfully`,
        leaves,
      });
    } else {
      const teacher = await Teacher.findById(teacherId);
      if (!teacher) {
        return res
          .status(404)
          .json({ success: false, message: "Teacher record not found" });
      }
      const leave = teacher.leaves.id(leaveId);
      if (!leave) {
        return res
          .status(404)
          .json({ success: false, message: "Leave record not found" });
      }
      leave.status = status;
      await teacher.save();
      return res.json({
        success: true,
        message: `Leave ${status} successfully`,
        leaves: teacher.leaves,
      });
    }
  } catch (error) {
    console.error("reviewLeave error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getMyLeaves = async (req, res) => {
  try {
    let teacher = null;
    if (
      checkFallback() ||
      !mongoose.Types.ObjectId.isValid(req.user?.profileId || "")
    ) {
      teacher =
        FallbackDb.findOne("teachers", { user: req.user?.id }) ||
        FallbackDb.findById("teachers", req.user?.profileId);
    } else {
      teacher = await Teacher.findOne({ user: req.user._id });
      if (
        !teacher &&
        req.user.profileId &&
        mongoose.Types.ObjectId.isValid(req.user.profileId)
      ) {
        teacher = await Teacher.findById(req.user.profileId);
      }
    }
    if (!teacher) {
      teacher =
        FallbackDb.findOne("teachers", { user: req.user?.id }) ||
        FallbackDb.findById("teachers", req.user?.profileId);
    }
    return res.json({ success: true, leaves: teacher?.leaves || [] });
  } catch (error) {
    console.error("getMyLeaves error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getTeacherCredentials = async (req, res) => {
  try {
    const { id } = req.params;
    let teacher = null;
    let userRecord = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
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

    return res.json({
      success: true,
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
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const bulkImportTeachers = async (req, res) => {
  try {
    const { teachers } = req.body;
    if (!Array.isArray(teachers) || teachers.length === 0) {
      return res.status(400).json({ success: false, message: "No teacher data provided for import" });
    }

    let successCount = 0;
    const errors = [];

    for (let i = 0; i < teachers.length; i++) {
      const raw = teachers[i];
      try {
        const payload = await buildTeacherPayload(raw);
        let password = raw.password;
        if (!password || password.length < 6) {
          password = generateRandomPassword();
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
          const existing = await Teacher.findOne({ employeeId: payload.employeeId });
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
        errors.push({ index: i, name: raw.firstName || raw.name, error: err.message });
      }
    }

    return res.json({
      success: true,
      count: successCount,
      total: teachers.length,
      errors,
      message: `Successfully imported ${successCount} out of ${teachers.length} teachers.`,
    });
  } catch (error) {
    console.error("bulkImportTeachers error:", error);
    return res.status(500).json({ success: false, message: "Bulk import failed" });
  }
};
