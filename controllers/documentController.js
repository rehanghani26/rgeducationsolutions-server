import crypto from "crypto";
import IssuedCertificate from "../models/IssuedCertificate.js";
import CustomDocumentTemplate from "../models/CustomDocumentTemplate.js";
import Student from "../models/Student.js";
import Teacher from "../models/Teacher.js";
import User from "../models/User.js";
import Setting from "../models/Setting.js";
import { checkFallback } from "../config/db.js";
import { FallbackDb } from "../services/dbFallback.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Ensure FallbackDb has an issuedCertificates collection initialized with demo records
 */
const ensureFallbackCertificates = () => {
  const existing = FallbackDb.find("issuedCertificates");
  if (!existing || existing.length === 0) {
    const demo1 = {
      id: "cert-fb-001",
      _id: "cert-fb-001",
      certificateNumber: "CERT-2026-000001",
      certificateType: "BONAFIDE",
      templateId: "certificate-classic",
      templateVersion: "v1",
      recipientType: "student",
      recipientId: "s1",
      recipientNameSnapshot: "Harry Potter",
      recipientIdSnapshot: "STD-2026-001",
      additionalSnapshot: {
        class: "Class 10",
        section: "Section A",
        rollNumber: "01",
        academicYear: "2025-2026",
        bloodGroup: "O+",
        dob: "2010-07-31",
        parentName: "James Potter",
      },
      academicSession: "2025-2026",
      issuedBy: { name: "Albus Dumbledore", role: "super-admin" },
      issuedAt: new Date(Date.now() - 86400000 * 5).toISOString(),
      status: "VALID",
      verificationToken:
        "a1b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef0",
      purposeNote:
        "Issued for passport verification and higher education admission.",
    };

    const demo2 = {
      id: "cert-fb-002",
      _id: "cert-fb-002",
      certificateNumber: "CERT-2026-000002",
      certificateType: "CHARACTER",
      templateId: "certificate-academic",
      templateVersion: "v1",
      recipientType: "student",
      recipientId: "s2",
      recipientNameSnapshot: "Hermione Granger",
      recipientIdSnapshot: "STD-2026-002",
      additionalSnapshot: {
        class: "Class 10",
        section: "Section A",
        rollNumber: "02",
        academicYear: "2025-2026",
        bloodGroup: "A+",
        dob: "2010-09-19",
        parentName: "Mr. Granger",
      },
      academicSession: "2025-2026",
      issuedBy: { name: "Minerva McGonagall", role: "principal" },
      issuedAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      status: "VALID",
      verificationToken:
        "b2c3d4e5f60718293a4b5c6d7e8f90123456789abcdef0123456789abcdef01",
      purposeNote: "Awarded for exemplary academic and behavioral conduct.",
    };

    FallbackDb.create("issuedCertificates", demo1);
    FallbackDb.create("issuedCertificates", demo2);
  }
};

/**
 * Generates a unique certificate number for the current year.
 * Format: CERT-{YEAR}-{000001} (6-digit zero-padded sequence)
 */
const generateCertificateNumber = async () => {
  const year = new Date().getFullYear();

  if (checkFallback()) {
    ensureFallbackCertificates();
    const list = FallbackDb.find("issuedCertificates") || [];
    const sequence = String(list.length + 1).padStart(6, "0");
    return `CERT-${year}-${sequence}`;
  }

  const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
  const count = await IssuedCertificate.countDocuments({
    issuedAt: { $gte: startOfYear },
  });
  const sequence = String(count + 1).padStart(6, "0");
  return `CERT-${year}-${sequence}`;
};

/**
 * Generates a secure, opaque verification token.
 * Used in QR code URLs: /verify/certificate/{token}
 */
const generateVerificationToken = () => crypto.randomBytes(32).toString("hex");

/**
 * Resolves recipient data from the database by type and ID.
 * Returns a normalized snapshot object regardless of recipient type.
 * @param {'student'|'teacher'|'staff'} recipientType
 * @param {string} recipientId
 */
const resolveRecipient = async (recipientType, recipientId) => {
  if (checkFallback()) {
    if (recipientType === "student") {
      const list = FallbackDb.find("students") || [];
      const student =
        list.find(
          (s) =>
            s.id === recipientId ||
            s._id === recipientId ||
            s.admissionNumber === recipientId
        ) || list[0];
      if (!student) throw new Error(`Student not found: ${recipientId}`);
      return {
        model: student,
        nameSnapshot:
          student.name ||
          `${student.firstName || ""} ${student.lastName || ""}`.trim(),
        idSnapshot: student.admissionNumber || student.id || student._id,
        additionalSnapshot: {
          class: student.class || student.className || "",
          className: student.className || student.class || "",
          section: student.section || student.sectionName || "",
          rollNumber: student.rollNumber || "",
          academicYear: student.academicYear || "2025-2026",
          bloodGroup: student.bloodGroup || "",
          dob: student.dob || "",
          parentName: student.parentName || "",
        },
      };
    }

    if (recipientType === "teacher") {
      const list = FallbackDb.find("teachers") || [];
      const teacher =
        list.find(
          (t) =>
            t.id === recipientId ||
            t._id === recipientId ||
            t.employeeId === recipientId
        ) || list[0];
      if (!teacher) throw new Error(`Teacher not found: ${recipientId}`);
      return {
        model: teacher,
        nameSnapshot:
          teacher.name ||
          `${teacher.firstName || ""} ${teacher.lastName || ""}`.trim(),
        idSnapshot: teacher.employeeId || teacher.id || teacher._id,
        additionalSnapshot: {
          designation: teacher.designation || "Faculty Member",
          department: teacher.department || "Academics",
          joiningDate: teacher.joiningDate || "",
          subjectsAssigned: teacher.subjectsAssigned || [],
        },
      };
    }

    if (recipientType === "staff") {
      const list = FallbackDb.find("users") || [];
      const staff =
        list.find((u) => u.id === recipientId || u._id === recipientId) ||
        list[0];
      if (!staff) throw new Error(`Staff user not found: ${recipientId}`);
      return {
        model: staff,
        nameSnapshot: staff.name,
        idSnapshot: staff.employeeId || staff.username || staff.id,
        additionalSnapshot: {
          designation: staff.designation || "Staff Member",
          department: staff.department || "Administration",
          role: staff.role,
        },
      };
    }
  }

  // MongoDB mode
  if (recipientType === "student") {
    const student = await Student.findById(recipientId);
    if (!student) throw new Error(`Student not found: ${recipientId}`);
    return {
      model: student,
      nameSnapshot: student.name,
      idSnapshot: student.admissionNumber,
      additionalSnapshot: {
        class: student.class,
        className: student.className,
        section: student.section,
        rollNumber: student.rollNumber,
        academicYear: student.academicYear,
        bloodGroup: student.bloodGroup,
        dob: student.dob,
        parentName: student.parentName,
      },
    };
  }

  if (recipientType === "teacher") {
    const teacher = await Teacher.findById(recipientId);
    if (!teacher) throw new Error(`Teacher not found: ${recipientId}`);
    return {
      model: teacher,
      nameSnapshot: teacher.name || `${teacher.firstName} ${teacher.lastName}`,
      idSnapshot: teacher.employeeId,
      additionalSnapshot: {
        designation: teacher.designation,
        department: teacher.department,
        joiningDate: teacher.joiningDate,
        subjectsAssigned: teacher.subjectsAssigned,
      },
    };
  }

  if (recipientType === "staff") {
    const staff = await User.findById(recipientId).select("-password");
    if (!staff) throw new Error(`Staff user not found: ${recipientId}`);
    return {
      model: staff,
      nameSnapshot: staff.name,
      idSnapshot: staff.employeeId || staff.username,
      additionalSnapshot: {
        designation: staff.designation,
        department: staff.department,
        role: staff.role,
      },
    };
  }

  throw new Error(`Invalid recipientType: ${recipientType}`);
};

// ─── Certificate Controllers ───────────────────────────────────────────────────

/**
 * @route  POST /api/v1/documents/certificates/issue
 * @access Admin, Principal, Director
 */
export const issueCertificate = async (req, res) => {
  try {
    const {
      recipientType,
      recipientId,
      certificateType,
      templateId,
      templateVersion = "v1",
      academicSession,
      purposeNote,
    } = req.body;

    if (!recipientType || !recipientId || !certificateType || !templateId) {
      return res.status(400).json({
        success: false,
        message:
          "recipientType, recipientId, certificateType, and templateId are required",
      });
    }

    const recipient = await resolveRecipient(recipientType, recipientId);
    const certificateNumber = await generateCertificateNumber();
    const verificationToken = generateVerificationToken();
    const issuedByData = req.user
      ? {
          _id: req.user._id || req.user.id,
          name: req.user.name,
          role: req.user.role,
        }
      : { name: "Authorized Signatory", role: "admin" };

    const newRecordData = {
      certificateNumber,
      certificateType: certificateType.toUpperCase(),
      templateId,
      templateVersion,
      recipientType,
      recipientId,
      recipientNameSnapshot: recipient.nameSnapshot,
      recipientIdSnapshot: recipient.idSnapshot,
      additionalSnapshot: recipient.additionalSnapshot,
      academicSession: academicSession || "2025-2026",
      issuedBy: issuedByData,
      issuedAt: new Date().toISOString(),
      status: "VALID",
      verificationToken,
      purposeNote,
    };

    if (checkFallback()) {
      ensureFallbackCertificates();
      const created = FallbackDb.create("issuedCertificates", newRecordData);
      return res.status(201).json({
        success: true,
        message: "Certificate issued successfully",
        certificate: created,
      });
    }

    const issuedCert = await IssuedCertificate.create({
      ...newRecordData,
      issuedBy: req.user._id || req.user.id,
      issuedAt: new Date(),
    });

    await issuedCert.populate("issuedBy", "name role");

    return res.status(201).json({
      success: true,
      message: "Certificate issued successfully",
      certificate: issuedCert,
    });
  } catch (error) {
    console.error("issueCertificate error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to issue certificate",
    });
  }
};

/**
 * @route  POST /api/v1/documents/certificates/bulk-issue
 * @access Admin, Principal, Director
 */
export const bulkIssueCertificates = async (req, res) => {
  try {
    const {
      recipients,
      certificateType,
      templateId,
      templateVersion = "v1",
      academicSession,
    } = req.body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: "recipients array is required and must not be empty",
      });
    }

    if (!certificateType || !templateId) {
      return res.status(400).json({
        success: false,
        message: "certificateType and templateId are required",
      });
    }

    const issuedByData = req.user
      ? {
          _id: req.user._id || req.user.id,
          name: req.user.name,
          role: req.user.role,
        }
      : { name: "Admin", role: "admin" };

    const results = [];
    const errors = [];

    for (const { recipientType, recipientId, purposeNote } of recipients) {
      try {
        const recipient = await resolveRecipient(recipientType, recipientId);
        const certificateNumber = await generateCertificateNumber();
        const verificationToken = generateVerificationToken();

        results.push({
          certificateNumber,
          certificateType: certificateType.toUpperCase(),
          templateId,
          templateVersion,
          recipientType,
          recipientId,
          recipientNameSnapshot: recipient.nameSnapshot,
          recipientIdSnapshot: recipient.idSnapshot,
          additionalSnapshot: recipient.additionalSnapshot,
          academicSession: academicSession || "2025-2026",
          issuedBy: issuedByData,
          issuedAt: new Date().toISOString(),
          status: "VALID",
          verificationToken,
          purposeNote,
        });
      } catch (err) {
        errors.push({ recipientId, error: err.message });
      }
    }

    if (checkFallback()) {
      ensureFallbackCertificates();
      const inserted = results.map((r) =>
        FallbackDb.create("issuedCertificates", r)
      );
      return res.status(201).json({
        success: true,
        message: `Issued ${inserted.length} certificate(s)`,
        count: inserted.length,
        certificates: inserted,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    let inserted = [];
    if (results.length > 0) {
      const recordsToInsert = results.map((r) => ({
        ...r,
        issuedBy: req.user._id || req.user.id,
        issuedAt: new Date(),
      }));
      inserted = await IssuedCertificate.insertMany(recordsToInsert, {
        ordered: false,
      });
    }

    return res.status(201).json({
      success: true,
      message: `Issued ${inserted.length} certificate(s)`,
      count: inserted.length,
      certificates: inserted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("bulkIssueCertificates error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Bulk issue failed",
    });
  }
};

/**
 * @route  GET /api/v1/documents/certificates
 * @access Authenticated
 */
export const getIssuedCertificates = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      status,
      certificateType,
      recipientType,
      search,
    } = req.query;

    const userRole = (req.user?.role || "").toLowerCase();
    const isAdmin = [
      "super-admin",
      "school-admin",
      "admin",
      "superadmin",
      "principal",
      "director",
    ].includes(userRole);

    if (checkFallback()) {
      ensureFallbackCertificates();
      let list = FallbackDb.find("issuedCertificates") || [];

      if (userRole === "student") {
        const studentId = String(
          req.user.profileId || req.user._id || req.user.id || ""
        );
        list = list.filter(
          (c) =>
            c.recipientType === "student" &&
            (String(c.recipientId) === studentId ||
              String(c.recipientIdSnapshot) ===
                String(req.user.admissionNumber))
        );
      }

      if (status && status !== "ALL") {
        list = list.filter((c) => c.status === status.toUpperCase());
      }
      if (certificateType && certificateType !== "ALL") {
        list = list.filter(
          (c) => c.certificateType === certificateType.toUpperCase()
        );
      }
      if (recipientType && isAdmin && recipientType !== "ALL") {
        list = list.filter((c) => c.recipientType === recipientType);
      }

      if (search) {
        const q = search.toLowerCase();
        list = list.filter(
          (c) =>
            (c.certificateNumber || "").toLowerCase().includes(q) ||
            (c.recipientNameSnapshot || "").toLowerCase().includes(q) ||
            (c.recipientIdSnapshot || "").toLowerCase().includes(q)
        );
      }

      list.sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));

      const total = list.length;
      const startIndex = (Number(page) - 1) * Number(limit);
      const paginated = list.slice(startIndex, startIndex + Number(limit));

      return res.json({
        success: true,
        certificates: paginated,
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)) || 1,
      });
    }

    // MongoDB mode
    const filter = {};

    if (userRole === "student") {
      const studentId = req.user.profileId || req.user._id || req.user.id;
      filter.recipientId = studentId;
      filter.recipientType = "student";
    } else if (!isAdmin) {
      filter.recipientId = req.user._id || req.user.id;
    }

    if (status && status !== "ALL") filter.status = status.toUpperCase();
    if (certificateType && certificateType !== "ALL")
      filter.certificateType = certificateType.toUpperCase();
    if (recipientType && isAdmin && recipientType !== "ALL")
      filter.recipientType = recipientType;

    if (search) {
      filter.$or = [
        { certificateNumber: { $regex: search, $options: "i" } },
        { recipientNameSnapshot: { $regex: search, $options: "i" } },
        { recipientIdSnapshot: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await IssuedCertificate.countDocuments(filter);
    const certificates = await IssuedCertificate.find(filter)
      .populate("issuedBy", "name role")
      .populate("revokedBy", "name role")
      .sort({ issuedAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    return res.json({
      success: true,
      certificates,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    console.error("getIssuedCertificates error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @route  GET /api/v1/documents/certificates/:id
 * @access Authenticated
 */
export const getIssuedCertificateById = async (req, res) => {
  try {
    if (checkFallback()) {
      ensureFallbackCertificates();
      const list = FallbackDb.find("issuedCertificates") || [];
      const cert = list.find(
        (c) => c.id === req.params.id || c._id === req.params.id
      );
      if (!cert) {
        return res
          .status(404)
          .json({ success: false, message: "Certificate not found" });
      }
      return res.json({ success: true, certificate: cert });
    }

    const cert = await IssuedCertificate.findById(req.params.id)
      .populate("issuedBy", "name role")
      .populate("revokedBy", "name role");

    if (!cert) {
      return res
        .status(404)
        .json({ success: false, message: "Certificate not found" });
    }

    return res.json({ success: true, certificate: cert });
  } catch (error) {
    console.error("getIssuedCertificateById error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @route  PATCH /api/v1/documents/certificates/:id/revoke
 * @access Admin, Principal, Director
 */
export const revokeCertificate = async (req, res) => {
  try {
    const { revocationReason } = req.body;

    if (checkFallback()) {
      ensureFallbackCertificates();
      const list = FallbackDb.find("issuedCertificates") || [];
      const cert = list.find(
        (c) => c.id === req.params.id || c._id === req.params.id
      );
      if (!cert) {
        return res
          .status(404)
          .json({ success: false, message: "Certificate not found" });
      }

      if (cert.status === "REVOKED") {
        return res
          .status(400)
          .json({ success: false, message: "Certificate is already revoked" });
      }

      const updated = FallbackDb.update(
        "issuedCertificates",
        cert.id || cert._id,
        {
          status: "REVOKED",
          revokedAt: new Date().toISOString(),
          revokedBy: req.user
            ? { name: req.user.name, role: req.user.role }
            : { name: "Admin" },
          revocationReason: revocationReason || "No reason provided",
        }
      );

      return res.json({
        success: true,
        message: "Certificate revoked successfully",
        certificate: updated,
      });
    }

    const cert = await IssuedCertificate.findById(req.params.id);
    if (!cert) {
      return res
        .status(404)
        .json({ success: false, message: "Certificate not found" });
    }

    if (cert.status === "REVOKED") {
      return res
        .status(400)
        .json({ success: false, message: "Certificate is already revoked" });
    }

    cert.status = "REVOKED";
    cert.revokedAt = new Date();
    cert.revokedBy = req.user._id || req.user.id;
    cert.revocationReason = revocationReason || "No reason provided";
    await cert.save();
    await cert.populate("issuedBy revokedBy", "name role");

    return res.json({
      success: true,
      message: "Certificate revoked successfully",
      certificate: cert,
    });
  } catch (error) {
    console.error("revokeCertificate error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @route  GET /api/v1/documents/verify/:token
 * @access PUBLIC
 */
export const verifyCertificate = async (req, res) => {
  try {
    const token = req.params.token;

    if (checkFallback()) {
      ensureFallbackCertificates();
      const list = FallbackDb.find("issuedCertificates") || [];
      const cert = list.find(
        (c) => c.verificationToken === token || c.certificateNumber === token
      );

      if (!cert) {
        return res.status(404).json({
          success: false,
          verified: false,
          message:
            "Certificate not found. This QR code may be invalid or expired.",
        });
      }

      const settings = FallbackDb.getSettings?.() || {};
      const schoolName = settings.schoolName || "RGES International Academy";

      return res.json({
        success: true,
        verified: cert.status === "VALID",
        certificate: {
          certificateNumber: cert.certificateNumber,
          certificateType: cert.certificateType,
          recipientName: cert.recipientNameSnapshot,
          academicSession: cert.academicSession,
          issuedAt: cert.issuedAt,
          status: cert.status,
          schoolName,
          revokedAt: cert.status === "REVOKED" ? cert.revokedAt : undefined,
          revocationReason:
            cert.status === "REVOKED" ? cert.revocationReason : undefined,
        },
      });
    }

    const cert = await IssuedCertificate.findOne({
      $or: [{ verificationToken: token }, { certificateNumber: token }],
    }).populate("issuedBy", "name");

    if (!cert) {
      return res.status(404).json({
        success: false,
        verified: false,
        message:
          "Certificate not found. This QR code may be invalid or expired.",
      });
    }

    let schoolName = "School";
    try {
      const settings = await Setting.findOne({}).select("schoolName");
      schoolName = settings?.schoolName || schoolName;
    } catch (_) {
      /* ignore */
    }

    return res.json({
      success: true,
      verified: cert.status === "VALID",
      certificate: {
        certificateNumber: cert.certificateNumber,
        certificateType: cert.certificateType,
        recipientName: cert.recipientNameSnapshot,
        academicSession: cert.academicSession,
        issuedAt: cert.issuedAt,
        status: cert.status,
        schoolName,
        revokedAt: cert.status === "REVOKED" ? cert.revokedAt : undefined,
        revocationReason:
          cert.status === "REVOKED" ? cert.revocationReason : undefined,
      },
    });
  } catch (error) {
    console.error("verifyCertificate error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Verification failed" });
  }
};

// ─── Custom Template Controllers ───────────────────────────────────────────────

/**
 * @route  GET /api/v1/documents/templates/custom
 * @access Authenticated
 */
export const getCustomTemplates = async (req, res) => {
  try {
    const { category } = req.query;

    if (checkFallback()) {
      let list = FallbackDb.find("customDocumentTemplates") || [];
      list = list.filter((t) => t.isActive !== false);
      if (category) list = list.filter((t) => t.category === category);
      return res.json({ success: true, templates: list });
    }

    const filter = { isActive: true };
    if (category) filter.category = category;

    const templates = await CustomDocumentTemplate.find(filter)
      .populate("createdBy", "name role")
      .sort({ createdAt: -1 });

    return res.json({ success: true, templates });
  } catch (error) {
    console.error("getCustomTemplates error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @route  POST /api/v1/documents/templates/custom
 * @access Admin, Principal, Director
 */
export const createCustomTemplate = async (req, res) => {
  try {
    const { name, baseTemplateId, category, configuration } = req.body;

    if (!name || !baseTemplateId || !category) {
      return res.status(400).json({
        success: false,
        message: "name, baseTemplateId, and category are required",
      });
    }

    const templateData = {
      name,
      baseTemplateId,
      category,
      configuration: configuration || {},
      createdBy: req.user
        ? { _id: req.user._id || req.user.id, name: req.user.name }
        : null,
      isActive: true,
    };

    if (checkFallback()) {
      const created = FallbackDb.create(
        "customDocumentTemplates",
        templateData
      );
      return res.status(201).json({
        success: true,
        message: "Custom template created",
        template: created,
      });
    }

    const template = await CustomDocumentTemplate.create({
      ...templateData,
      createdBy: req.user._id || req.user.id,
    });

    return res.status(201).json({
      success: true,
      message: "Custom template created",
      template,
    });
  } catch (error) {
    console.error("createCustomTemplate error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @route  PUT /api/v1/documents/templates/custom/:id
 * @access Admin, Principal, Director
 */
export const updateCustomTemplate = async (req, res) => {
  try {
    const { name, configuration } = req.body;

    if (checkFallback()) {
      const updated = FallbackDb.update(
        "customDocumentTemplates",
        req.params.id,
        {
          ...(name ? { name } : {}),
          ...(configuration ? { configuration } : {}),
        }
      );
      if (!updated) {
        return res
          .status(404)
          .json({ success: false, message: "Template not found" });
      }
      return res.json({
        success: true,
        message: "Template updated",
        template: updated,
      });
    }

    const template = await CustomDocumentTemplate.findById(req.params.id);
    if (!template) {
      return res
        .status(404)
        .json({ success: false, message: "Template not found" });
    }

    if (name) template.name = name;
    if (configuration)
      template.configuration = { ...template.configuration, ...configuration };
    await template.save();

    return res.json({ success: true, message: "Template updated", template });
  } catch (error) {
    console.error("updateCustomTemplate error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

/**
 * @route  DELETE /api/v1/documents/templates/custom/:id
 * @access Admin, Principal, Director
 */
export const deleteCustomTemplate = async (req, res) => {
  try {
    if (checkFallback()) {
      const updated = FallbackDb.update(
        "customDocumentTemplates",
        req.params.id,
        {
          isActive: false,
        }
      );
      if (!updated) {
        return res
          .status(404)
          .json({ success: false, message: "Template not found" });
      }
      return res.json({
        success: true,
        message: "Template deactivated successfully",
      });
    }

    const template = await CustomDocumentTemplate.findById(req.params.id);
    if (!template) {
      return res
        .status(404)
        .json({ success: false, message: "Template not found" });
    }

    template.isActive = false;
    await template.save();

    return res.json({
      success: true,
      message: "Template deactivated successfully",
    });
  } catch (error) {
    console.error("deleteCustomTemplate error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};
