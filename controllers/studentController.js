import Student from "../models/Student.js";
import User from "../models/User.js";
import Parent from "../models/Parent.js";
import { checkFallback } from "../config/db.js";
import { FallbackDb } from "../services/dbFallback.js";
import { parsePagination, buildSearchFilter, paginateResult, paginateArray } from "../utils/paginateQuery.js";
import { logActivity, getRecordActivity } from "../utils/activityLogger.js";

const DEFAULT_STUDENT_PERMISSIONS = ["dashboard", "academics", "timetable", "reports", "communication"];
const DEFAULT_PARENT_PERMISSIONS = ["dashboard", "student-management", "fee", "communication"];

const normalizeEmail = (email = "") => email.trim().toLowerCase();
const normalizeAdmissionNumber = (admissionNumber = "") => admissionNumber.trim().toUpperCase();
const fullName = (data) => data.name || `${data.firstName || ""} ${data.lastName || ""}`.trim();
const generateRandomPassword = () =>
  `Std@${Math.random().toString(36).slice(2, 8)}${Math.floor(100 + Math.random() * 900)}`;
const generateParentPassword = () =>
  `Par@${Math.random().toString(36).slice(2, 8)}${Math.floor(100 + Math.random() * 900)}`;

const getNextAdmissionNumber = async () => {
  const prefix = "STD-";
  let lastId = "STD-0000";

  if (checkFallback()) {
    lastId = FallbackDb.find("students")
      .map((student) => student.admissionNumber)
      .filter((id) => /^STD-\d{4}$/.test(id || ""))
      .sort()
      .pop() || lastId;
  } else {
    const lastStudent = await Student.findOne({ admissionNumber: /^STD-\d{4}$/ })
      .sort({ admissionNumber: -1 })
      .select("admissionNumber");
    lastId = lastStudent?.admissionNumber || lastId;
  }

  const next = Number(lastId.replace(prefix, "")) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
};

const buildStudentPayload = async (data) => {
  const admissionNumber = normalizeAdmissionNumber(data.admissionNumber) || (await getNextAdmissionNumber());
  const name = fullName(data);
  const email = normalizeEmail(data.email || `${admissionNumber.toLowerCase()}@school.local`);

  return {
    ...data,
    firstName: data.firstName || name.split(" ")[0],
    lastName: data.lastName || name.split(" ").slice(1).join(" "),
    name,
    email,
    admissionNumber,
    rollNumber: data.rollNumber || admissionNumber.replace(/\D/g, ""),
    classId: data.classId && data.classId !== "" ? data.classId : null,
    sectionId: data.sectionId && data.sectionId !== "" ? data.sectionId : null,
    contactNumber: data.contactNumber || data.phone || "",
    permissions: Array.isArray(data.permissions) && data.permissions.length ? data.permissions : DEFAULT_STUDENT_PERMISSIONS,
    status: data.status || "active",
    role: "student",
    forcePasswordChange: Boolean(data.forcePasswordChange),
    twoFactorEnabled: Boolean(data.twoFactorEnabled),
    loginRestriction: data.loginRestriction || "none",
    documents: data.documents || [],
    academicHistory: data.academicHistory || [],
  };
};

const createOrLinkParent = async (payload, studentId, studentPassword) => {
  const parentEmail = normalizeEmail(payload.parentEmail || `${payload.parentContact}@parent.school.local`);
  const parentPassword = payload.parentPassword || generateParentPassword();
  let parentAccount = null;

  if (checkFallback()) {
    let parent = FallbackDb.findOne("parents", { phone: payload.parentContact }) ||
      (payload.parentEmail ? FallbackDb.findOne("parents", { email: parentEmail }) : null);

    if (!parent) {
      const parentUser = FallbackDb.create("users", {
        username: `par_${payload.parentContact}`,
        email: parentEmail,
        password: parentPassword,
        role: "parent",
        permissions: DEFAULT_PARENT_PERMISSIONS,
        name: payload.parentName,
        isActive: true,
        forcePasswordChange: true,
      });
      parent = FallbackDb.create("parents", {
        user: parentUser.id,
        name: payload.parentName,
        phone: payload.parentContact,
        email: parentEmail,
        children: [studentId],
        status: "active",
      });
      FallbackDb.update("users", parentUser.id, { profileId: parent.id });
      parentAccount = { email: parentEmail, temporaryPassword: parentPassword, created: true };
    } else {
      const children = [...new Set([...(parent.children || []), studentId])];
      FallbackDb.update("parents", parent.id, { children });
      parentAccount = { email: parent.email, created: false };
    }
    FallbackDb.update("students", studentId, { parentId: parent.id });
    return { parentId: parent.id, parentAccount };
  }

  let parent = await Parent.findOne({
    $or: [{ phone: payload.parentContact }, ...(payload.parentEmail ? [{ email: parentEmail }] : [])],
  });

  if (!parent) {
    const parentUser = await User.create({
      username: `par_${payload.parentContact}`,
      email: parentEmail,
      password: parentPassword,
      role: "parent",
      permissions: DEFAULT_PARENT_PERMISSIONS,
      name: payload.parentName,
      isActive: true,
      forcePasswordChange: true,
    });
    parent = await Parent.create({
      user: parentUser._id,
      name: payload.parentName,
      phone: payload.parentContact,
      email: parentEmail,
      children: [studentId],
      status: "active",
    });
    parentUser.profileId = parent._id;
    await parentUser.save();
    parentAccount = { email: parentEmail, temporaryPassword: parentPassword, created: true };
  } else {
    if (!parent.children.includes(studentId)) {
      parent.children.push(studentId);
      await parent.save();
    }
    parentAccount = { email: parent.email, created: false };
  }

  await Student.findByIdAndUpdate(studentId, { parentId: parent._id });
  return { parentId: parent._id, parentAccount };
};

const enrichStudent = (stud) => {
  if (checkFallback()) {
    return {
      ...stud,
      classDetails: FallbackDb.findById("classes", stud.classId),
      sectionDetails: FallbackDb.findById("sections", stud.sectionId),
      parentDetails: stud.parentId ? FallbackDb.findById("parents", stud.parentId) : null,
    };
  }
  return stud;
};

export const getStudents = async (req, res) => {
  try {
    const { page, limit, skip, sort, search, status } = parsePagination(req.query);
    const searchFields = ["name", "admissionNumber", "rollNumber", "email", "parentName", "contactNumber"];

    if (checkFallback()) {
      let list = FallbackDb.find("students").map(enrichStudent);
      const result = paginateArray(list, { page, limit, search, status, searchFields });
      return res.json({ success: true, students: result.data, ...result });
    }

    const filter = { ...buildSearchFilter(search, searchFields) };
    if (status) filter.status = status;

    const sortObj = {};
    const sortField = sort.startsWith("-") ? sort.slice(1) : sort;
    sortObj[sortField] = sort.startsWith("-") ? -1 : 1;

    const [students, total] = await Promise.all([
      Student.find(filter)
        .populate("classId", "name code")
        .populate("sectionId", "name")
        .populate("user", "username email role permissions isActive lastLogin")
        .populate("parentId", "name phone email")
        .sort(sortObj)
        .skip(skip)
        .limit(limit),
      Student.countDocuments(filter),
    ]);

    return res.json({ success: true, students, ...paginateResult(students, total, { page, limit }) });
  } catch (error) {
    console.error("getStudents error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getStudentById = async (req, res) => {
  try {
    const { id } = req.params;
    let student = null;

    if (checkFallback()) {
      student = FallbackDb.findById("students", id);
      if (student) student = enrichStudent(student);
      if (student?.user) {
        student.userDetails = FallbackDb.findById("users", student.user);
      }
    } else {
      student = await Student.findById(id)
        .populate("classId")
        .populate("sectionId")
        .populate("user", "username email role permissions isActive lastLogin loginHistory forcePasswordChange")
        .populate("parentId");
    }

    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    return res.json({ success: true, student });
  } catch (error) {
    console.error("getStudentById error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getStudentActivity = async (req, res) => {
  try {
    const { id } = req.params;
    const logs = await getRecordActivity("students", id);
    let loginHistory = [];

    const student = checkFallback()
      ? FallbackDb.findById("students", id)
      : await Student.findById(id).populate("user", "loginHistory lastLogin");

    if (student?.user) {
      const user = checkFallback()
        ? FallbackDb.findById("users", student.user)
        : student.user;
      loginHistory = user?.loginHistory || [];
    }

    return res.json({ success: true, logs, loginHistory });
  } catch (error) {
    console.error("getStudentActivity error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const createStudent = async (req, res) => {
  try {
    const payload = await buildStudentPayload(req.body);
    const password = req.body.generateRandomPassword ? generateRandomPassword() : req.body.password;

    if (!payload.name || !payload.contactNumber || !payload.parentName || !payload.parentContact) {
      return res.status(400).json({ success: false, message: "Name, contact, parent name, and parent contact are required" });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    if (req.body.confirmPassword !== undefined && password !== req.body.confirmPassword) {
      return res.status(400).json({ success: false, message: "Password and confirm password do not match" });
    }

    if (checkFallback()) {
      const duplicate = FallbackDb.findOne("students", { admissionNumber: payload.admissionNumber }) ||
        FallbackDb.findOne("users", { email: payload.email });
      if (duplicate) {
        return res.status(409).json({ success: false, message: "Student admission number or email already exists" });
      }

      const parentEmail = normalizeEmail(payload.parentEmail || `${payload.parentContact}@parent.school.local`);
      let parent = FallbackDb.findOne("parents", { phone: payload.parentContact }) ||
        (payload.parentEmail ? FallbackDb.findOne("parents", { email: parentEmail }) : null);

      if (!parent) {
        const existingParentUser = FallbackDb.findOne("users", { email: parentEmail }) ||
          FallbackDb.findOne("users", { username: `par_${payload.parentContact}` });
        if (existingParentUser) {
          return res.status(409).json({
            success: false,
            message: `Parent email (${parentEmail}) or contact username is already registered to another user account.`,
          });
        }
      }

      const userRecord = FallbackDb.create("users", {
        username: payload.admissionNumber.toLowerCase(),
        admissionNumber: payload.admissionNumber,
        email: payload.email,
        password,
        role: "student",
        permissions: payload.permissions,
        name: payload.name,
        isActive: payload.status === "active",
        forcePasswordChange: payload.forcePasswordChange,
        accountExpiryDate: payload.accountExpiryDate,
        loginRestriction: payload.loginRestriction,
        twoFactorEnabled: payload.twoFactorEnabled,
      });
      const studentRecord = FallbackDb.create("students", { ...payload, user: userRecord.id });
      FallbackDb.update("users", userRecord.id, { profileId: studentRecord.id });

      const { parentAccount } = await createOrLinkParent(payload, studentRecord.id, password);

      await logActivity({
        userId: req.user?._id || req.user?.id,
        action: "CREATE",
        module: "students",
        recordId: studentRecord.id,
        details: `Created student ${payload.name}`,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });

      return res.status(201).json({
        success: true,
        message: "Student, login credentials, and parent account processed successfully",
        student: enrichStudent(studentRecord),
        accountCreated: { admissionNumber: payload.admissionNumber, email: payload.email, temporaryPassword: password },
        parentAccount,
      });
    }

    const existingUser = await User.findOne({
      $or: [{ username: payload.admissionNumber.toLowerCase() }, { admissionNumber: payload.admissionNumber }, { email: payload.email }],
    });
    const existingStudent = await Student.findOne({ admissionNumber: payload.admissionNumber });
    if (existingUser || existingStudent) {
      return res.status(409).json({ success: false, message: "Student admission number or email already exists" });
    }

    const parentEmail = normalizeEmail(payload.parentEmail || `${payload.parentContact}@parent.school.local`);
    let parent = await Parent.findOne({
      $or: [{ phone: payload.parentContact }, ...(payload.parentEmail ? [{ email: parentEmail }] : [])],
    });
    if (!parent) {
      const existingParentUser = await User.findOne({
        $or: [{ username: `par_${payload.parentContact}` }, { email: parentEmail }],
      });
      if (existingParentUser) {
        return res.status(409).json({
          success: false,
          message: `Parent email (${parentEmail}) or contact username is already registered to another user account.`,
        });
      }
    }

    const studentRecord = await Student.create(payload);
    const userRecord = await User.create({
      username: payload.admissionNumber.toLowerCase(),
      admissionNumber: payload.admissionNumber,
      email: payload.email,
      password,
      role: "student",
      permissions: payload.permissions,
      name: payload.name,
      profileId: studentRecord._id,
      isActive: payload.status === "active",
      forcePasswordChange: payload.forcePasswordChange,
      accountExpiryDate: payload.accountExpiryDate,
      loginRestriction: payload.loginRestriction,
      twoFactorEnabled: payload.twoFactorEnabled,
    });
    studentRecord.user = userRecord._id;
    await studentRecord.save();

    const { parentAccount } = await createOrLinkParent(payload, studentRecord._id, password);

    await logActivity({
      userId: req.user?._id,
      action: "CREATE",
      module: "students",
      recordId: studentRecord._id,
      details: `Created student ${payload.name}`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.status(201).json({
      success: true,
      message: "Student, login credentials, and parent account processed successfully",
      student: studentRecord,
      accountCreated: { admissionNumber: payload.admissionNumber, email: payload.email, temporaryPassword: password },
      parentAccount,
    });
  } catch (error) {
    console.error("createStudent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

export const updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    delete updateData.password;
    delete updateData.confirmPassword;
    if (updateData.email) updateData.email = normalizeEmail(updateData.email);
    if (updateData.admissionNumber) updateData.admissionNumber = normalizeAdmissionNumber(updateData.admissionNumber);
    if (updateData.classId === "") updateData.classId = null;
    if (updateData.sectionId === "") updateData.sectionId = null;
    if (updateData.firstName || updateData.lastName) {
      updateData.name = `${updateData.firstName || ""} ${updateData.lastName || ""}`.trim();
    }

    let updatedRecord = null;

    if (checkFallback()) {
      updatedRecord = FallbackDb.update("students", id, updateData);
      if (updatedRecord?.user) {
        FallbackDb.update("users", updatedRecord.user, {
          username: updatedRecord.admissionNumber.toLowerCase(),
          admissionNumber: updatedRecord.admissionNumber,
          email: updatedRecord.email,
          permissions: updatedRecord.permissions,
          name: updatedRecord.name,
          isActive: updatedRecord.status === "active",
        });
      }
    } else {
      updatedRecord = await Student.findByIdAndUpdate(id, updateData, { new: true });
      if (updatedRecord?.user) {
        await User.findByIdAndUpdate(updatedRecord.user, {
          username: updatedRecord.admissionNumber.toLowerCase(),
          admissionNumber: updatedRecord.admissionNumber,
          email: updatedRecord.email,
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
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: "UPDATE",
      module: "students",
      recordId: id,
      details: `Updated student ${updatedRecord.name}`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.json({ success: true, message: "Student updated successfully", student: updatedRecord });
  } catch (error) {
    console.error("updateStudent error:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

export const deactivateStudent = async (req, res) => {
  req.body.status = "inactive";
  return updateStudent(req, res);
};

export const resetStudentPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const password = req.body.generateRandomPassword ? generateRandomPassword() : req.body.password;
    if (!password || password.length < 6) {
      return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
    }

    const student = checkFallback() ? FallbackDb.findById("students", id) : await Student.findById(id);
    if (!student) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    if (checkFallback()) {
      FallbackDb.update("users", student.user, {
        password,
        forcePasswordChange: Boolean(req.body.forcePasswordChange),
      });
    } else {
      const user = await User.findById(student.user);
      user.password = password;
      user.forcePasswordChange = Boolean(req.body.forcePasswordChange);
      await user.save();
    }

    return res.json({
      success: true,
      message: "Student password reset successfully",
      account: { admissionNumber: student.admissionNumber, email: student.email, temporaryPassword: password },
    });
  } catch (error) {
    console.error("resetStudentPassword error:", error);
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

export const deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;
    let success = false;
    let studentName = "";

    if (checkFallback()) {
      const student = FallbackDb.findById("students", id);
      if (student) {
        studentName = student.name;
        if (student.user) FallbackDb.delete("users", student.user);
        success = FallbackDb.delete("students", id);
      }
    } else {
      const student = await Student.findById(id);
      if (student) {
        studentName = student.name;
        if (student.user) await User.findByIdAndDelete(student.user);
        await Student.findByIdAndDelete(id);
        success = true;
      }
    }

    if (!success) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: "DELETE",
      module: "students",
      recordId: id,
      details: `Deleted student ${studentName}`,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return res.json({ success: true, message: "Student and linked user account deleted successfully" });
  } catch (error) {
    console.error("deleteStudent error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const bulkDeleteStudents = async (req, res) => {
  try {
    const { ids = [] } = req.body;
    if (!ids.length) return res.status(400).json({ success: false, message: "No student IDs provided" });

    let deleted = 0;
    for (const id of ids) {
      if (checkFallback()) {
        const student = FallbackDb.findById("students", id);
        if (student) {
          if (student.user) FallbackDb.delete("users", student.user);
          if (FallbackDb.delete("students", id)) deleted++;
        }
      } else {
        const student = await Student.findById(id);
        if (student) {
          if (student.user) await User.findByIdAndDelete(student.user);
          await Student.findByIdAndDelete(id);
          deleted++;
        }
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: "BULK",
      module: "students",
      details: `Bulk deleted ${deleted} students`,
      ipAddress: req.ip,
      metadata: { ids },
    });

    return res.json({ success: true, message: `${deleted} students deleted`, deleted });
  } catch (error) {
    console.error("bulkDeleteStudents error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const bulkPromoteStudents = async (req, res) => {
  try {
    const { ids = [], classId, sectionId } = req.body;
    if (!ids.length || !classId) {
      return res.status(400).json({ success: false, message: "Student IDs and target class are required" });
    }

    let promoted = 0;
    const update = { classId, ...(sectionId ? { sectionId } : {}) };

    for (const id of ids) {
      if (checkFallback()) {
        if (FallbackDb.update("students", id, update)) promoted++;
      } else {
        const result = await Student.findByIdAndUpdate(id, update);
        if (result) promoted++;
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: "BULK",
      module: "students",
      details: `Promoted ${promoted} students to class ${classId}`,
      ipAddress: req.ip,
      metadata: { ids, classId, sectionId },
    });

    return res.json({ success: true, message: `${promoted} students promoted`, promoted });
  } catch (error) {
    console.error("bulkPromoteStudents error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const exportStudents = async (req, res) => {
  try {
    let students = [];
    if (checkFallback()) {
      students = FallbackDb.find("students");
    } else {
      students = await Student.find().select("name admissionNumber rollNumber classId sectionId parentName contactNumber status createdAt");
    }

    const headers = ["Name", "Admission Number", "Roll Number", "Class", "Section", "Parent", "Phone", "Status", "Created"];
    const rows = students.map((s) => [
      s.name, s.admissionNumber, s.rollNumber, s.classId, s.sectionId,
      s.parentName, s.contactNumber, s.status, s.createdAt,
    ].map((v) => `"${String(v || "").replace(/"/g, '""')}"`).join(","));

    const csv = [headers.join(","), ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=students.csv");
    return res.send(csv);
  } catch (error) {
    console.error("exportStudents error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
