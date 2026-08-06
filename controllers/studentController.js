import mongoose from "mongoose";
import Student from "../models/Student.js";
import User from "../models/User.js";
import Parent from "../models/Parent.js";
import { checkFallback } from "../config/db.js";
import { FallbackDb } from "../services/dbFallback.js";
import {
  parsePagination,
  buildSearchFilter,
  paginateResult,
  paginateArray,
} from "../utils/paginateQuery.js";
import { logActivity, getRecordActivity } from "../utils/activityLogger.js";

const DEFAULT_STUDENT_PERMISSIONS = [
  "dashboard",
  "academics",
  "timetable",
  "reports",
  "communication",
];
const DEFAULT_PARENT_PERMISSIONS = [
  "dashboard",
  "student-management",
  "fee",
  "communication",
];

const normalizeEmail = (email = "") => email.trim().toLowerCase();
const normalizeAdmissionNumber = (admissionNumber = "") =>
  admissionNumber.trim().toUpperCase();
const fullName = (data) =>
  data.name || `${data.firstName || ""} ${data.lastName || ""}`.trim();
const generateRandomPassword = () =>
  `Std@${Math.random().toString(36).slice(2, 8)}${Math.floor(100 + Math.random() * 900)}`;
const generateParentPassword = () =>
  `Par@${Math.random().toString(36).slice(2, 8)}${Math.floor(100 + Math.random() * 900)}`;

/**
 * Generate globally unique admission number: STD-2026-0001
 * Checks both MongoDB and FallbackDb.
 */
const getNextAdmissionNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `STD-${year}-`;
  const pattern = new RegExp(`^STD-${year}-\\d{4}$`);

  let lastNum = 0;

  if (checkFallback()) {
    const nums = FallbackDb.find("students")
      .map((s) => s.admissionNumber)
      .filter((id) => pattern.test(id || ""))
      .map((id) => Number(id.replace(prefix, "")))
      .filter((n) => !isNaN(n));
    lastNum = nums.length ? Math.max(...nums) : 0;
  } else {
    const last = await Student.findOne({ admissionNumber: pattern })
      .sort({ admissionNumber: -1 })
      .select("admissionNumber");
    if (last?.admissionNumber) {
      lastNum = Number(last.admissionNumber.replace(prefix, "")) || 0;
    }
  }

  return `${prefix}${String(lastNum + 1).padStart(4, "0")}`;
};

/**
 * Get the next roll number for a given classId + sectionId.
 * Roll numbers restart from 1 per section per academic year.
 * Finds the max existing roll number in that class+section, returns max+1.
 */
const getNextRollNumber = async (classId, sectionId) => {
  if (!classId || !sectionId) {
    return Math.floor(1000 + Math.random() * 9000);
  }

  const year = new Date().getFullYear();
  const month = new Date().getMonth(); // 0-indexed
  const academicYear = month >= 3
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;

  if (checkFallback()) {
    const existing = FallbackDb.find("students").filter(
      (s) =>
        String(s.classId) === String(classId) &&
        String(s.sectionId) === String(sectionId) &&
        s.rollNumber != null
    );
    const maxRoll = existing.length
      ? Math.max(...existing.map((s) => Number(s.rollNumber) || 0))
      : 0;
    return maxRoll + 1;
  } else {
    const last = await Student.findOne({
      classId: String(classId),
      sectionId: String(sectionId),
      academicYear,
      rollNumber: { $ne: null },
    })
      .sort({ rollNumber: -1 })
      .select("rollNumber");
    return (Number(last?.rollNumber) || 0) + 1;
  }
};

const BACKEND_CLASS_OPTIONS = [
  { id: "cls-nur", name: "Nursery" },
  { id: "cls-lkg", name: "LKG" },
  { id: "cls-ukg", name: "UKG" },
  { id: "cls-1",   name: "Class 1" },
  { id: "cls-2",   name: "Class 2" },
  { id: "cls-3",   name: "Class 3" },
  { id: "cls-4",   name: "Class 4" },
  { id: "cls-5",   name: "Class 5" },
  { id: "cls-6",   name: "Class 6" },
  { id: "cls-7",   name: "Class 7" },
  { id: "cls-8",   name: "Class 8" },
  { id: "cls-9",   name: "Class 9" },
  { id: "cls-10",  name: "Class 10" },
  { id: "cls-11",  name: "Class 11" },
  { id: "cls-12",  name: "Class 12" },
];

const BACKEND_SECTION_OPTIONS = [
  { id: "sec-a", name: "Section A" },
  { id: "sec-b", name: "Section B" },
  { id: "sec-c", name: "Section C" },
  { id: "sec-d", name: "Section D" },
  { id: "sec-e", name: "Section E" },
  { id: "sec-f", name: "Section F" },
  { id: "sec-g", name: "Section G" },
];

const resolveClass = (val) => {
  if (!val) return null;
  if (typeof val === "object") {
    val = val.name || val.id || "";
  }
  if (!val || val === "N/A" || val === "null" || val === "undefined") return null;
  const str = String(val).trim().toLowerCase();

  // 1. Direct match with id or name
  let found = BACKEND_CLASS_OPTIONS.find(
    (c) => c.id.toLowerCase() === str || c.name.toLowerCase() === str
  );
  if (found) return found;

  // 2. Normalized match e.g. "cls-10", "class 10", "grade 10", "10" -> "10"
  const norm = str.replace(/^(cls-|class\s*|grade\s*)/i, "").trim();
  found = BACKEND_CLASS_OPTIONS.find((c) => {
    const cIdNum = c.id.replace("cls-", "");
    const cNameNum = c.name.toLowerCase().replace("class ", "");
    return (
      cIdNum === norm ||
      cNameNum === norm ||
      c.id.toLowerCase() === norm ||
      c.name.toLowerCase() === norm
    );
  });

  return found || null;
};

const resolveSection = (val) => {
  if (!val) return null;
  if (typeof val === "object") {
    val = val.name || val.id || "";
  }
  if (!val || val === "N/A" || val === "null" || val === "undefined") return null;
  const str = String(val).trim().toLowerCase();

  // 1. Direct match with id or name
  let found = BACKEND_SECTION_OPTIONS.find(
    (s) => s.id.toLowerCase() === str || s.name.toLowerCase() === str
  );
  if (found) return found;

  // 2. Normalized match e.g. "sec-a", "section a", "a" -> "a"
  const norm = str.replace(/^(sec-|section\s*)/i, "").trim();
  found = BACKEND_SECTION_OPTIONS.find((s) => {
    const sIdCode = s.id.replace("sec-", "");
    const sNameCode = s.name.toLowerCase().replace("section ", "");
    return (
      sIdCode === norm ||
      sNameCode === norm ||
      s.id.toLowerCase() === norm ||
      s.name.toLowerCase() === norm
    );
  });

  return found || null;
};

const buildStudentPayload = async (data) => {
  // Always auto-generate admission number - ignore any provided value
  const admissionNumber = await getNextAdmissionNumber();

  const matchedClass = resolveClass(data.class || data.classId || data.className);
  const matchedSection = resolveSection(data.section || data.sectionId || data.sectionName);

  const resolvedClassId = matchedClass ? matchedClass.id : (data.classId || null);
  const resolvedSectionId = matchedSection ? matchedSection.id : (data.sectionId || null);

  // Auto-assign roll number: unique per classId + sectionId, sequential from 1
  const rollNumber = await getNextRollNumber(resolvedClassId, resolvedSectionId);

  const name = fullName(data) || `Student ${admissionNumber}`;
  const email = normalizeEmail(
    data.email || `${admissionNumber.toLowerCase().replace(/-/g, ".")}@school.local`
  );

  const year = new Date().getFullYear();
  const month = new Date().getMonth();
  const academicYear = month >= 3
    ? `${year}-${String(year + 1).slice(-2)}`
    : `${year - 1}-${String(year).slice(-2)}`;

  return {
    ...data,
    firstName: data.firstName || name.split(" ")[0] || "Student",
    lastName: data.lastName || name.split(" ").slice(1).join(" ") || "",
    name,
    email,
    admissionNumber,          // Always auto-generated, globally unique
    rollNumber,               // Auto-assigned per class+section, starts at 1
    academicYear,
    gender: data.gender || "Male",
    dob: data.dob || data.dateOfBirth || undefined,
    bloodGroup: data.bloodGroup || undefined,
    classId: resolvedClassId,
    sectionId: resolvedSectionId,
    class: matchedClass ? matchedClass.name : (data.class || null),
    section: matchedSection ? matchedSection.name : (data.section || null),
    className: matchedClass ? matchedClass.name : (data.className || null),
    sectionName: matchedSection ? matchedSection.name : (data.sectionName || null),
    contactNumber: data.contactNumber || data.phone || data.parentContact || "",
    alternatePhone: data.alternatePhone || "",
    address: data.address || "",
    parentName: data.parentName || `Guardian of ${name}`,
    parentContact: data.parentContact || data.contactNumber || "",
    parentEmail: data.parentEmail || "",
    aadhaarNumber: data.aadhaarNumber || "",
    joiningDate: data.joiningDate || new Date(),
    permissions:
      Array.isArray(data.permissions) && data.permissions.length
        ? data.permissions
        : DEFAULT_STUDENT_PERMISSIONS,
    status: data.status || "active",
    role: "student",
    forcePasswordChange: Boolean(data.forcePasswordChange),
    twoFactorEnabled: Boolean(data.twoFactorEnabled),
    loginRestriction: data.loginRestriction || "none",
    documents: data.documents || [],
    academicHistory: data.academicHistory || [],
  };
};

const syncUserFromStudent = async ({ student, password, existingUser }) => {
  const userData = {
    username: student.admissionNumber.toLowerCase(),
    admissionNumber: student.admissionNumber,
    email: student.email,
    password,
    tempPassword: password,
    role: "student",
    permissions: student.permissions || DEFAULT_STUDENT_PERMISSIONS,
    name: student.name,
    profileId: student._id,
    isActive: student.status === "active",
    forcePasswordChange: Boolean(student.forcePasswordChange),
    accountExpiryDate: student.accountExpiryDate,
    loginRestriction: student.loginRestriction || "none",
    twoFactorEnabled: Boolean(student.twoFactorEnabled),
  };

  if (existingUser) {
    Object.assign(existingUser, {
      ...userData,
      password: existingUser.password,
    });
    if (password) {
      existingUser.password = password;
      existingUser.tempPassword = password;
    }
    return existingUser.save();
  }

  return User.create(userData);
};

const createOrLinkParent = async (payload, studentId, studentPassword) => {
  const parentEmail = normalizeEmail(
    payload.parentEmail || `${payload.parentContact}@parent.school.local`
  );
  const parentPassword = payload.parentPassword || generateParentPassword();
  let parentAccount = null;

  if (checkFallback()) {
    let parent =
      FallbackDb.findOne("parents", { phone: payload.parentContact }) ||
      (payload.parentEmail
        ? FallbackDb.findOne("parents", { email: parentEmail })
        : null);

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
      parentAccount = {
        email: parentEmail,
        temporaryPassword: parentPassword,
        created: true,
      };
    } else {
      const children = [...new Set([...(parent.children || []), studentId])];
      FallbackDb.update("parents", parent.id, { children });
      parentAccount = { email: parent.email, created: false };
    }
    FallbackDb.update("students", studentId, { parentId: parent.id });
    return { parentId: parent.id, parentAccount };
  }

  let parent = await Parent.findOne({
    $or: [
      { phone: payload.parentContact },
      ...(payload.parentEmail ? [{ email: parentEmail }] : []),
    ],
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
    parentAccount = {
      email: parentEmail,
      temporaryPassword: parentPassword,
      created: true,
    };
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
  if (!stud) return null;
  const s = stud.toObject ? stud.toObject() : stud;

  const matchedClass = resolveClass(s.class || s.classId || s.className);
  const matchedSection = resolveSection(s.section || s.sectionId || s.sectionName);

  const className = matchedClass
    ? matchedClass.name
    : (s.class && s.class !== "null" && s.class !== "undefined" ? s.class : (s.className || "N/A"));
  const sectionName = matchedSection
    ? matchedSection.name
    : (s.section && s.section !== "null" && s.section !== "undefined" ? s.section : (s.sectionName || "N/A"));

  const classId = s.classId || (matchedClass ? matchedClass.id : null);
  const sectionId = s.sectionId || (matchedSection ? matchedSection.id : null);

  return {
    ...s,
    class: className,
    section: sectionName,
    className,
    sectionName,
    classId,
    sectionId,
    classDetails: { id: classId, name: className },
    sectionDetails: { id: sectionId, name: sectionName },
    parentDetails: s.parentId
      ? (typeof s.parentId === "object" ? s.parentId : FallbackDb.findById("parents", s.parentId))
      : null,
  };
};

export const getStudents = async (req, res) => {
  try {
    const { page, limit, skip, sort, search, status } = parsePagination(
      req.query
    );
    const searchFields = [
      "name",
      "admissionNumber",
      "rollNumber",
      "email",
      "parentName",
      "contactNumber",
    ];

    if (checkFallback()) {
      let list = FallbackDb.find("students").map(enrichStudent);
      const result = paginateArray(list, {
        page,
        limit,
        search,
        status,
        searchFields,
      });
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

    return res.json({
      success: true,
      students: students.map(enrichStudent),
      ...paginateResult(students, total, { page, limit }),
    });
  } catch (error) {
    console.error("getStudents error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getStudentById = async (req, res) => {
  try {
    const { id } = req.params;
    let student = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      student =
        FallbackDb.findById("students", id) ||
        FallbackDb.findOne("students", { admissionNumber: id });
      if (student) student = enrichStudent(student);
      if (student?.user) {
        student.userDetails = FallbackDb.findById("users", student.user);
      }
    } else {
      student = await Student.findById(id)
        .populate("classId")
        .populate("sectionId")
        .populate(
          "user",
          "username email role permissions isActive lastLogin loginHistory forcePasswordChange"
        )
        .populate("parentId");
    }

    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
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

    const student =
      checkFallback() || !mongoose.Types.ObjectId.isValid(id)
        ? FallbackDb.findById("students", id) ||
          FallbackDb.findOne("students", { admissionNumber: id })
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
    let password = req.body.password;
    if (!password || password.length < 6) {
      password = generateRandomPassword();
    }

    if (!payload.name) payload.name = `Student ${payload.admissionNumber}`;
    if (!payload.contactNumber) payload.contactNumber = "+919876543210";
    if (!payload.parentName) payload.parentName = `Guardian of ${payload.name}`;
    if (!payload.parentContact) payload.parentContact = payload.contactNumber;

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
        FallbackDb.findOne("students", {
          admissionNumber: payload.admissionNumber,
        }) || FallbackDb.findOne("users", { email: payload.email });
      if (duplicate) {
        return res
          .status(409)
          .json({
            success: false,
            message: "Student admission number or email already exists",
          });
      }

      const parentEmail = normalizeEmail(
        payload.parentEmail || `${payload.parentContact}@parent.school.local`
      );
      let parent =
        FallbackDb.findOne("parents", { phone: payload.parentContact }) ||
        (payload.parentEmail
          ? FallbackDb.findOne("parents", { email: parentEmail })
          : null);

      if (!parent) {
        const existingParentUser =
          FallbackDb.findOne("users", { email: parentEmail }) ||
          FallbackDb.findOne("users", {
            username: `par_${payload.parentContact}`,
          });
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
      const studentRecord = FallbackDb.create("students", {
        ...payload,
        user: userRecord.id,
      });
      FallbackDb.update("users", userRecord.id, {
        profileId: studentRecord.id,
      });

      const { parentAccount } = await createOrLinkParent(
        payload,
        studentRecord.id,
        password
      );

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
        message:
          "Student, login credentials, and parent account processed successfully",
        student: enrichStudent(studentRecord),
        accountCreated: {
          admissionNumber: payload.admissionNumber,
          email: payload.email,
          temporaryPassword: password,
        },
        parentAccount,
      });
    }

    // Check if a real student record already exists with this admission number
    const existingStudent = await Student.findOne({
      admissionNumber: payload.admissionNumber,
    });
    if (existingStudent) {
      return res.status(409).json({
        success: false,
        message: `Admission number ${payload.admissionNumber} is already in use.`,
      });
    }

    // Check if email is taken by another fully registered student
    const emailConflict = await Student.findOne({ email: payload.email });
    if (emailConflict) {
      return res.status(409).json({
        success: false,
        message: `Email ${payload.email} is already registered to another student.`,
      });
    }

    // Clean up any orphaned User record left from a previous failed attempt
    // (e.g. User created but Student.create failed) so it doesn't block new registrations
    const orphanedUser = await User.findOne({
      $or: [
        { username: payload.admissionNumber.toLowerCase() },
        { admissionNumber: payload.admissionNumber },
      ],
      profileId: { $exists: false },  // no linked student = orphaned
    });
    if (orphanedUser) {
      await User.findByIdAndDelete(orphanedUser._id);
    }

    const parentEmail = normalizeEmail(
      payload.parentEmail || `${payload.parentContact}@parent.school.local`
    );
    let parent = await Parent.findOne({
      $or: [
        { phone: payload.parentContact },
        ...(payload.parentEmail ? [{ email: parentEmail }] : []),
      ],
    });
    if (!parent) {
      const existingParentUser = await User.findOne({
        $or: [
          { username: `par_${payload.parentContact}` },
          { email: parentEmail },
        ],
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

    const { parentAccount } = await createOrLinkParent(
      payload,
      studentRecord._id,
      password
    );

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
      message:
        "Student, login credentials, and parent account processed successfully",
      student: studentRecord,
      accountCreated: {
        admissionNumber: payload.admissionNumber,
        email: payload.email,
        temporaryPassword: password,
      },
      parentAccount,
    });
  } catch (error) {
    console.error("createStudent error:", error);
    return res
      .status(500)
      .json({ success: false, message: error.message || "Server error" });
  }
};

export const updateStudent = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };
    delete updateData.password;
    delete updateData.confirmPassword;
    if (updateData.email) updateData.email = normalizeEmail(updateData.email);
    if (updateData.admissionNumber)
      updateData.admissionNumber = normalizeAdmissionNumber(
        updateData.admissionNumber
      );

    const matchedClass = resolveClass(updateData.class || updateData.classId || updateData.className);
    const matchedSection = resolveSection(updateData.section || updateData.sectionId || updateData.sectionName);

    if (matchedClass) {
      updateData.class = matchedClass.name;
      updateData.className = matchedClass.label;
      updateData.classId = updateData.classId || matchedClass.id;
    }
    if (matchedSection) {
      updateData.section = matchedSection.name;
      updateData.sectionName = matchedSection.label;
      updateData.sectionId = updateData.sectionId || matchedSection.id;
    }

    if (updateData.firstName || updateData.lastName) {
      updateData.name =
        `${updateData.firstName || ""} ${updateData.lastName || ""}`.trim();
    }

    let updatedRecord = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      updatedRecord =
        FallbackDb.update("students", id, updateData) ||
        FallbackDb.findOne("students", { admissionNumber: id });
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
      updatedRecord = await Student.findByIdAndUpdate(id, updateData, {
        new: true,
      });
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
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
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

    return res.json({
      success: true,
      message: "Student updated successfully",
      student: enrichStudent(updatedRecord),
    });
  } catch (error) {
    console.error("updateStudent error:", error);
    return res
      .status(500)
      .json({ success: false, message: error.message || "Server error" });
  }
};

export const deactivateStudent = async (req, res) => {
  req.body.status = "inactive";
  return updateStudent(req, res);
};

export const resetStudentPassword = async (req, res) => {
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

    const student =
      checkFallback() || !mongoose.Types.ObjectId.isValid(id)
        ? FallbackDb.findById("students", id) ||
          FallbackDb.findOne("students", { admissionNumber: id })
        : await Student.findById(id);
    if (!student) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
    }

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(student.user)) {
      FallbackDb.update("users", student.user, {
        password,
        forcePasswordChange: Boolean(req.body.forcePasswordChange),
      });
    } else {
      const user = await User.findById(student.user);
      if (user) {
        user.password = password;
        user.forcePasswordChange = Boolean(req.body.forcePasswordChange);
        await user.save();
      }
    }

    return res.json({
      success: true,
      message: "Student password reset successfully",
      account: {
        admissionNumber: student.admissionNumber,
        email: student.email,
        temporaryPassword: password,
      },
    });
  } catch (error) {
    console.error("resetStudentPassword error:", error);
    return res
      .status(500)
      .json({ success: false, message: error.message || "Server error" });
  }
};

export const deleteStudent = async (req, res) => {
  try {
    const { id } = req.params;
    let success = false;
    let studentName = "";

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      const student =
        FallbackDb.findById("students", id) ||
        FallbackDb.findOne("students", { admissionNumber: id });
      if (student) {
        studentName = student.name;
        if (student.user) FallbackDb.delete("users", student.user);
        success = FallbackDb.delete("students", student.id || id);
      }
    } else {
      const student = await Student.findById(id);
      if (student) {
        studentName = student.name;
        if (student.user && mongoose.Types.ObjectId.isValid(student.user))
          await User.findByIdAndDelete(student.user);
        await Student.findByIdAndDelete(id);
        success = true;
      }
    }

    if (!success) {
      return res
        .status(404)
        .json({ success: false, message: "Student not found" });
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

    return res.json({
      success: true,
      message: "Student and linked user account deleted successfully",
    });
  } catch (error) {
    console.error("deleteStudent error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const bulkDeleteStudents = async (req, res) => {
  try {
    const { ids = [] } = req.body;
    if (!ids.length)
      return res
        .status(400)
        .json({ success: false, message: "No student IDs provided" });

    let deleted = 0;
    for (const id of ids) {
      if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
        const student =
          FallbackDb.findById("students", id) ||
          FallbackDb.findOne("students", { admissionNumber: id });
        if (student) {
          if (student.user) FallbackDb.delete("users", student.user);
          if (FallbackDb.delete("students", student.id || id)) deleted++;
        }
      } else {
        const student = await Student.findById(id);
        if (student) {
          if (student.user && mongoose.Types.ObjectId.isValid(student.user))
            await User.findByIdAndDelete(student.user);
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

    return res.json({
      success: true,
      message: `${deleted} students deleted`,
      deleted,
    });
  } catch (error) {
    console.error("bulkDeleteStudents error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const bulkPromoteStudents = async (req, res) => {
  try {
    const { ids = [], classId, sectionId } = req.body;
    if (!ids.length || !classId) {
      return res
        .status(400)
        .json({
          success: false,
          message: "Student IDs and target class are required",
        });
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

    return res.json({
      success: true,
      message: `${promoted} students promoted`,
      promoted,
    });
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
      students = await Student.find().select(
        "name admissionNumber rollNumber classId sectionId parentName contactNumber status createdAt"
      );
    }

    const headers = [
      "Name",
      "Admission Number",
      "Roll Number",
      "Class",
      "Section",
      "Parent",
      "Phone",
      "Status",
      "Created",
    ];
    const rows = students.map((s) =>
      [
        s.name,
        s.admissionNumber,
        s.rollNumber,
        s.classId,
        s.sectionId,
        s.parentName,
        s.contactNumber,
        s.status,
        s.createdAt,
      ]
        .map((v) => `"${String(v || "").replace(/"/g, '""')}"`)
        .join(",")
    );

    const csv = [headers.join(","), ...rows].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=students.csv");
    return res.send(csv);
  } catch (error) {
    console.error("exportStudents error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getStudentCredentials = async (req, res) => {
  try {
    const { id } = req.params;
    let student = null;
    let userRecord = null;

    if (checkFallback() || !mongoose.Types.ObjectId.isValid(id)) {
      student =
        FallbackDb.findById("students", id) ||
        FallbackDb.findOne("students", { admissionNumber: id });
      if (student?.user) {
        userRecord = FallbackDb.findById("users", student.user);
      }
    } else {
      student = await Student.findById(id);
      if (student?.user) {
        userRecord = await User.findById(student.user);
      }
    }

    const username = userRecord?.username || student?.admissionNumber || id;
    const email =
      userRecord?.email ||
      student?.email ||
      `${String(username).toLowerCase()}@school.local`;

    let password =
      userRecord?.tempPassword ||
      userRecord?.password ||
      student?.tempPassword ||
      student?.password ||
      "admin";

    if (password.startsWith("$2a$") || password.startsWith("$2b$")) {
      password = userRecord?.tempPassword || student?.tempPassword || "admin";
    }

    return res.json({
      success: true,
      credentials: {
        username,
        email,
        password,
        name: student?.name || username,
        admissionNumber: student?.admissionNumber || username,
      },
    });
  } catch (error) {
    console.error("getStudentCredentials error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

export const bulkImportStudents = async (req, res) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ success: false, message: "No student data provided for import" });
    }

    let successCount = 0;
    const errors = [];

    for (let i = 0; i < students.length; i++) {
      const raw = students[i];
      try {
        // buildStudentPayload auto-generates admissionNumber + rollNumber
        const payload = await buildStudentPayload(raw);
        let password = raw.password;
        if (!password || password.length < 6) {
          password = generateRandomPassword();
        }

        if (!payload.name) payload.name = `Student ${payload.admissionNumber}`;
        if (!payload.contactNumber) payload.contactNumber = "";
        if (!payload.parentName) payload.parentName = `Guardian of ${payload.name}`;
        if (!payload.parentContact) payload.parentContact = payload.contactNumber;

        if (checkFallback()) {
          const user = FallbackDb.create("users", {
            username: payload.admissionNumber.toLowerCase(),
            admissionNumber: payload.admissionNumber,
            email: payload.email,
            password,
            tempPassword: password,
            role: "student",
            permissions: payload.permissions,
            name: payload.name,
            isActive: true,
          });
          const createdStudent = FallbackDb.create("students", {
            ...payload,
            user: user.id,
            tempPassword: password,
          });
          FallbackDb.update("users", user.id, { profileId: createdStudent.id });
          await createOrLinkParent(payload, createdStudent.id, password);
        } else {
          // Clean up any orphaned user from a previous failed attempt
          const orphaned = await User.findOne({
            $or: [
              { username: payload.admissionNumber.toLowerCase() },
              { admissionNumber: payload.admissionNumber },
            ],
            profileId: { $exists: false },
          });
          if (orphaned) await User.findByIdAndDelete(orphaned._id);

          // Create student record first, then user
          const studentRecord = await Student.create({
            ...payload,
            tempPassword: password,
          });

          const userRecord = await User.create({
            username: payload.admissionNumber.toLowerCase(),
            admissionNumber: payload.admissionNumber,
            email: payload.email,
            password,
            tempPassword: password,
            role: "student",
            permissions: payload.permissions,
            name: payload.name,
            profileId: studentRecord._id,
            isActive: payload.status === "active",
            forcePasswordChange: Boolean(payload.forcePasswordChange),
            loginRestriction: payload.loginRestriction || "none",
            twoFactorEnabled: Boolean(payload.twoFactorEnabled),
          });

          studentRecord.user = userRecord._id;
          await studentRecord.save();

          await createOrLinkParent(payload, studentRecord._id, password);
        }
        successCount++;
      } catch (err) {
        errors.push({ index: i, name: raw.firstName || raw.name || `Row ${i + 1}`, error: err.message });
      }
    }

    await logActivity({
      userId: req.user?._id || req.user?.id,
      action: "BULK",
      module: "students",
      details: `Bulk imported ${successCount} students`,
      ipAddress: req.ip,
      metadata: { total: students.length, successCount, errorCount: errors.length },
    });

    return res.json({
      success: true,
      count: successCount,
      total: students.length,
      errors,
      message: `Successfully imported ${successCount} out of ${students.length} students.${errors.length ? ` (${errors.length} failed)` : ""}`,
    });
  } catch (error) {
    console.error("bulkImportStudents error:", error);
    return res.status(500).json({ success: false, message: "Bulk import failed" });
  }
};

