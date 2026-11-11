// 1. Node.js built-in modules
import crypto from 'crypto';

// 3. Configuration
import { checkFallback } from '../config/db.js';

// 4. Models
import CustomDocumentTemplate from '../models/CustomDocumentTemplate.js';
import IssuedCertificate from '../models/IssuedCertificate.js';
import Parent from '../models/Parent.js';
import Setting from '../models/Setting.js';
import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import User from '../models/User.js';

// 6. Services
import { FallbackDb } from '../services/dbFallback.js';

// 7. Utilities
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendError
} from '../utils/responseUtil.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Ensure FallbackDb has an issuedCertificates collection initialized.
 */
const ensureFallbackCertificates = () => {
  // Empty default - no hardcoded/seed certificates
};

/**
 * Generates a unique certificate number for the current year.
 * Format: CERT-{YEAR}-{000001} (6-digit zero-padded sequence)
 *
 * @returns {Promise<string>} Generated unique certificate identifier.
 */
const generateCertificateNumber = async () => {
  const year = new Date().getFullYear();

  if (checkFallback()) {
    ensureFallbackCertificates();
    const list = FallbackDb.find('issuedCertificates') || [];
    const sequence = String(list.length + 1).padStart(6, '0');
    return `CERT-${year}-${sequence}`;
  }

  const startOfYear = new Date(`${year}-01-01T00:00:00.000Z`);
  const count = await IssuedCertificate.countDocuments({
    issuedAt: { $gte: startOfYear }
  });
  const sequence = String(count + 1).padStart(6, '0');
  return `CERT-${year}-${sequence}`;
};

/**
 * Generates a secure, opaque verification token.
 * Used in QR code URLs: /verify/certificate/{token}
 *
 * @returns {string} 64-character hexadecimal token.
 */
const generateVerificationToken = () => crypto.randomBytes(32).toString('hex');

/**
 * Resolves recipient data from the database by type and ID.
 * Returns a normalized snapshot object regardless of recipient type.
 *
 * @param {'student'|'teacher'|'staff'} recipientType - Recipient type classifier.
 * @param {string} recipientId - Database identifier of recipient.
 * @returns {Promise<Object>} Resolved entity and normalized snapshot.
 */
const resolveRecipient = async (recipientType, recipientId) => {
  if (checkFallback()) {
    if (recipientType === 'student') {
      const list = FallbackDb.find('students') || [];
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
          `${student.firstName || ''} ${student.lastName || ''}`.trim(),
        idSnapshot: student.admissionNumber || student.id || student._id,
        additionalSnapshot: {
          class: student.class || student.className || '',
          className: student.className || student.class || '',
          section: student.section || student.sectionName || '',
          rollNumber: student.rollNumber || '',
          academicYear: student.academicYear || '2025-2026',
          bloodGroup: student.bloodGroup || '',
          dob: student.dob || '',
          parentName: student.parentName || ''
        }
      };
    }

    if (recipientType === 'teacher') {
      const list = FallbackDb.find('teachers') || [];
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
          `${teacher.firstName || ''} ${teacher.lastName || ''}`.trim(),
        idSnapshot: teacher.employeeId || teacher.id || teacher._id,
        additionalSnapshot: {
          designation: teacher.designation || 'Faculty Member',
          department: teacher.department || 'Academics',
          joiningDate: teacher.joiningDate || '',
          subjectsAssigned: teacher.subjectsAssigned || []
        }
      };
    }

    if (recipientType === 'staff') {
      const list = FallbackDb.find('users') || [];
      const staff =
        list.find((u) => u.id === recipientId || u._id === recipientId) ||
        list[0];
      if (!staff) throw new Error(`Staff user not found: ${recipientId}`);
      return {
        model: staff,
        nameSnapshot: staff.name,
        idSnapshot: staff.employeeId || staff.username || staff.id,
        additionalSnapshot: {
          designation: staff.designation || 'Staff Member',
          department: staff.department || 'Administration',
          role: staff.role
        }
      };
    }
  }

  // MongoDB mode
  if (recipientType === 'student') {
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
        parentName: student.parentName
      }
    };
  }

  if (recipientType === 'teacher') {
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
        subjectsAssigned: teacher.subjectsAssigned
      }
    };
  }

  if (recipientType === 'staff') {
    const staff = await User.findById(recipientId).select('-password');
    if (!staff) throw new Error(`Staff user not found: ${recipientId}`);
    return {
      model: staff,
      nameSnapshot: staff.name,
      idSnapshot: staff.employeeId || staff.username,
      additionalSnapshot: {
        designation: staff.designation,
        department: staff.department,
        role: staff.role
      }
    };
  }

  throw new Error(`Invalid recipientType: ${recipientType}`);
};

// ─── Certificate Controllers ───────────────────────────────────────────────────

/**
 * Issue a new individual institutional certificate.
 *
 * @route POST /api/v1/documents/certificates/issue
 */
export const issueCertificate = async (req, res) => {
  try {
    const {
      recipientType,
      recipientId,
      certificateType,
      templateId,
      templateVersion = 'v1',
      academicSession,
      purposeNote
    } = req.body;

    if (!recipientType || !recipientId || !certificateType || !templateId) {
      return sendBadRequest(res, 'recipientType, recipientId, certificateType, and templateId are required');
    }

    const recipient = await resolveRecipient(recipientType, recipientId);
    const certificateNumber = await generateCertificateNumber();
    const verificationToken = generateVerificationToken();
    const issuedByData = req.user
      ? {
          _id: req.user._id || req.user.id,
          name: req.user.name,
          role: req.user.role
        }
      : { name: 'Authorized Signatory', role: 'admin' };

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
      academicSession: academicSession || '2025-2026',
      issuedBy: issuedByData,
      issuedAt: new Date().toISOString(),
      status: 'VALID',
      verificationToken,
      purposeNote
    };

    if (checkFallback()) {
      ensureFallbackCertificates();
      const created = FallbackDb.create('issuedCertificates', newRecordData);
      return res.status(201).json({
        success: true,
        message: 'Certificate issued successfully',
        certificate: created
      });
    }

    const issuedCert = await IssuedCertificate.create({
      ...newRecordData,
      issuedBy: req.user._id || req.user.id,
      issuedAt: new Date()
    });

    await issuedCert.populate('issuedBy', 'name role');

    return res.status(201).json({
      success: true,
      message: 'Certificate issued successfully',
      certificate: issuedCert
    });
  } catch (error) {
    return sendError(res, error.message || 'Failed to issue certificate', 500, error);
  }
};

/**
 * Issue institutional certificates in bulk to multiple recipients.
 *
 * @route POST /api/v1/documents/certificates/bulk-issue
 */
export const bulkIssueCertificates = async (req, res) => {
  try {
    const {
      recipients,
      certificateType,
      templateId,
      templateVersion = 'v1',
      academicSession
    } = req.body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return sendBadRequest(res, 'recipients array is required and must not be empty');
    }

    if (!certificateType || !templateId) {
      return sendBadRequest(res, 'certificateType and templateId are required');
    }

    const issuedByData = req.user
      ? {
          _id: req.user._id || req.user.id,
          name: req.user.name,
          role: req.user.role
        }
      : { name: 'Admin', role: 'admin' };

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
          academicSession: academicSession || '2025-2026',
          issuedBy: issuedByData,
          issuedAt: new Date().toISOString(),
          status: 'VALID',
          verificationToken,
          purposeNote
        });
      } catch (err) {
        errors.push({ recipientId, error: err.message });
      }
    }

    if (checkFallback()) {
      ensureFallbackCertificates();
      const inserted = results.map((r) =>
        FallbackDb.create('issuedCertificates', r)
      );
      return res.status(201).json({
        success: true,
        message: `Issued ${inserted.length} certificate(s)`,
        count: inserted.length,
        certificates: inserted,
        errors: errors.length > 0 ? errors : undefined
      });
    }

    let inserted = [];
    if (results.length > 0) {
      const recordsToInsert = results.map((r) => ({
        ...r,
        issuedBy: req.user._id || req.user.id,
        issuedAt: new Date()
      }));
      inserted = await IssuedCertificate.insertMany(recordsToInsert, {
        ordered: false
      });
    }

    return res.status(201).json({
      success: true,
      message: `Issued ${inserted.length} certificate(s)`,
      count: inserted.length,
      certificates: inserted,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    return sendError(res, error.message || 'Bulk issue failed', 500, error);
  }
};

/**
 * Retrieve paginated list of issued certificates with role-based filtering.
 *
 * @route GET /api/v1/documents/certificates
 */
export const getIssuedCertificates = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      status,
      certificateType,
      recipientType,
      search
    } = req.query;

    const userRole = (req.user?.role || '').toLowerCase();
    const isAdmin = [
      'super-admin',
      'school-admin',
      'admin',
      'superadmin',
      'principal',
      'director'
    ].includes(userRole);

    if (checkFallback()) {
      ensureFallbackCertificates();
      let list = FallbackDb.find('issuedCertificates') || [];

      if (userRole === 'student') {
        const studentId = String(
          req.user.profileId || req.user._id || req.user.id || ''
        );
        const adm = String(req.user.admissionNumber || '').toLowerCase();
        const userName = (req.user.name || '').toLowerCase();
        list = list.filter(
          (c) =>
            c.recipientType === 'student' &&
            (String(c.recipientId) === studentId ||
              (adm && String(c.recipientIdSnapshot || '').toLowerCase() === adm) ||
              (userName && (c.recipientNameSnapshot || '').toLowerCase() === userName))
        );
      } else if (userRole === 'parent') {
        const parentId = String(req.user.profileId || req.user._id || req.user.id || '');
        const parent = FallbackDb.findById('parents', parentId) || FallbackDb.findOne('parents', { user: req.user._id });
        const childIds = (parent?.children || []).map(String);
        list = list.filter((c) => c.recipientType === 'student' && childIds.includes(String(c.recipientId)));
      } else if (!isAdmin) {
        const isTeacherOrStaff = [
          'teacher',
          'head-teacher',
          'hod',
          'coordinator',
          'accountant',
          'librarian'
        ].includes(userRole);
        if (!isTeacherOrStaff) {
          list = list.filter((c) => String(c.recipientId) === String(req.user._id || req.user.id));
        }
      }

      if (status && status !== 'ALL') {
        list = list.filter((c) => c.status === status.toUpperCase());
      }
      if (certificateType && certificateType !== 'ALL') {
        list = list.filter(
          (c) => c.certificateType === certificateType.toUpperCase()
        );
      }
      if (recipientType && isAdmin && recipientType !== 'ALL') {
        list = list.filter((c) => c.recipientType === recipientType);
      }

      if (search) {
        const q = search.toLowerCase();
        list = list.filter(
          (c) =>
            (c.certificateNumber || '').toLowerCase().includes(q) ||
            (c.recipientNameSnapshot || '').toLowerCase().includes(q) ||
            (c.recipientIdSnapshot || '').toLowerCase().includes(q)
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
        pages: Math.ceil(total / Number(limit)) || 1
      });
    }

    // MongoDB mode
    const filter = {};

    if (userRole === 'student') {
      const studentId = req.user.profileId || req.user._id || req.user.id;
      const orConditions = [
        { recipientId: studentId },
        { recipientId: req.user._id }
      ];
      if (req.user.admissionNumber) {
        orConditions.push({ recipientIdSnapshot: req.user.admissionNumber });
      }
      if (req.user.name) {
        orConditions.push({ recipientNameSnapshot: req.user.name });
      }
      filter.$and = [
        { recipientType: 'student' },
        { $or: orConditions }
      ];
    } else if (userRole === 'parent') {
      let childIds = [];
      try {
        const parent = await Parent.findOne({
          $or: [{ _id: req.user.profileId }, { user: req.user._id }]
        });
        if (parent?.children?.length) {
          childIds = parent.children;
        }
      } catch (e) {
        // Ignored fallback
      }
      filter.recipientId = { $in: childIds };
      filter.recipientType = 'student';
    } else if (!isAdmin) {
      const isTeacherOrStaff = [
        'teacher',
        'head-teacher',
        'hod',
        'coordinator',
        'accountant',
        'librarian'
      ].includes(userRole);
      if (isTeacherOrStaff) {
        if (recipientType && recipientType !== 'ALL') {
          filter.recipientType = recipientType;
        }
      } else {
        filter.recipientId = req.user._id || req.user.id;
      }
    }

    if (status && status !== 'ALL') filter.status = status.toUpperCase();
    if (certificateType && certificateType !== 'ALL')
      filter.certificateType = certificateType.toUpperCase();
    if (recipientType && isAdmin && recipientType !== 'ALL')
      filter.recipientType = recipientType;

    if (search) {
      filter.$or = [
        { certificateNumber: { $regex: search, $options: 'i' } },
        { recipientNameSnapshot: { $regex: search, $options: 'i' } },
        { recipientIdSnapshot: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await IssuedCertificate.countDocuments(filter);
    const certificates = await IssuedCertificate.find(filter)
      .populate('issuedBy', 'name role')
      .populate('revokedBy', 'name role')
      .sort({ issuedAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    return res.json({
      success: true,
      certificates,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit))
    });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Retrieve a specific issued certificate record by ID.
 *
 * @route GET /api/v1/documents/certificates/:id
 */
export const getIssuedCertificateById = async (req, res) => {
  try {
    if (checkFallback()) {
      ensureFallbackCertificates();
      const list = FallbackDb.find('issuedCertificates') || [];
      const cert = list.find(
        (c) => c.id === req.params.id || c._id === req.params.id
      );
      if (!cert) {
        return sendNotFound(res, 'Certificate not found');
      }
      return res.json({ success: true, certificate: cert });
    }

    const cert = await IssuedCertificate.findById(req.params.id)
      .populate('issuedBy', 'name role')
      .populate('revokedBy', 'name role');

    if (!cert) {
      return sendNotFound(res, 'Certificate not found');
    }

    return res.json({ success: true, certificate: cert });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Revoke an active issued certificate.
 *
 * @route PATCH /api/v1/documents/certificates/:id/revoke
 */
export const revokeCertificate = async (req, res) => {
  try {
    const { revocationReason } = req.body;

    if (checkFallback()) {
      ensureFallbackCertificates();
      const list = FallbackDb.find('issuedCertificates') || [];
      const cert = list.find(
        (c) => c.id === req.params.id || c._id === req.params.id
      );
      if (!cert) {
        return sendNotFound(res, 'Certificate not found');
      }

      if (cert.status === 'REVOKED') {
        return sendBadRequest(res, 'Certificate is already revoked');
      }

      const updated = FallbackDb.update(
        'issuedCertificates',
        cert.id || cert._id,
        {
          status: 'REVOKED',
          revokedAt: new Date().toISOString(),
          revokedBy: req.user
            ? { name: req.user.name, role: req.user.role }
            : { name: 'Admin' },
          revocationReason: revocationReason || 'No reason provided'
        }
      );

      return res.json({
        success: true,
        message: 'Certificate revoked successfully',
        certificate: updated
      });
    }

    const cert = await IssuedCertificate.findById(req.params.id);
    if (!cert) {
      return sendNotFound(res, 'Certificate not found');
    }

    if (cert.status === 'REVOKED') {
      return sendBadRequest(res, 'Certificate is already revoked');
    }

    cert.status = 'REVOKED';
    cert.revokedAt = new Date();
    cert.revokedBy = req.user._id || req.user.id;
    cert.revocationReason = revocationReason || 'No reason provided';
    await cert.save();
    await cert.populate('issuedBy revokedBy', 'name role');

    return res.json({
      success: true,
      message: 'Certificate revoked successfully',
      certificate: cert
    });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Verify a certificate public verification token or certificate number.
 *
 * @route GET /api/v1/documents/verify/:token
 */
export const verifyCertificate = async (req, res) => {
  try {
    const token = req.params.token;

    if (checkFallback()) {
      ensureFallbackCertificates();
      const list = FallbackDb.find('issuedCertificates') || [];
      const cert = list.find(
        (c) => c.verificationToken === token || c.certificateNumber === token
      );

      if (!cert) {
        return res.status(404).json({
          success: false,
          verified: false,
          message: 'Certificate not found. This QR code may be invalid or expired.'
        });
      }

      const settings = FallbackDb.getSettings?.() || {};
      const schoolName = settings.schoolName || 'RGES International Academy';

      return res.json({
        success: true,
        verified: cert.status === 'VALID',
        certificate: {
          certificateNumber: cert.certificateNumber,
          certificateType: cert.certificateType,
          recipientName: cert.recipientNameSnapshot,
          academicSession: cert.academicSession,
          issuedAt: cert.issuedAt,
          status: cert.status,
          schoolName,
          revokedAt: cert.status === 'REVOKED' ? cert.revokedAt : undefined,
          revocationReason:
            cert.status === 'REVOKED' ? cert.revocationReason : undefined
        }
      });
    }

    const cert = await IssuedCertificate.findOne({
      $or: [{ verificationToken: token }, { certificateNumber: token }]
    }).populate('issuedBy', 'name');

    if (!cert) {
      return res.status(404).json({
        success: false,
        verified: false,
        message: 'Certificate not found. This QR code may be invalid or expired.'
      });
    }

    let schoolName = 'School';
    try {
      const settings = await Setting.findOne({}).select('schoolName');
      schoolName = settings?.schoolName || schoolName;
    } catch (_) {
      // Ignore setting query error
    }

    return res.json({
      success: true,
      verified: cert.status === 'VALID',
      certificate: {
        certificateNumber: cert.certificateNumber,
        certificateType: cert.certificateType,
        recipientName: cert.recipientNameSnapshot,
        academicSession: cert.academicSession,
        issuedAt: cert.issuedAt,
        status: cert.status,
        schoolName,
        revokedAt: cert.status === 'REVOKED' ? cert.revokedAt : undefined,
        revocationReason:
          cert.status === 'REVOKED' ? cert.revocationReason : undefined
      }
    });
  } catch (error) {
    return sendError(res, 'Verification failed', 500, error);
  }
};

// ─── Custom Template Controllers ───────────────────────────────────────────────

/**
 * Retrieve active custom document templates.
 *
 * @route GET /api/v1/documents/templates/custom
 */
export const getCustomTemplates = async (req, res) => {
  try {
    const { category } = req.query;

    if (checkFallback()) {
      let list = FallbackDb.find('customDocumentTemplates') || [];
      list = list.filter((t) => t.isActive !== false);
      if (category) list = list.filter((t) => t.category === category);
      return res.json({ success: true, templates: list });
    }

    const filter = { isActive: true };
    if (category) filter.category = category;

    const templates = await CustomDocumentTemplate.find(filter)
      .populate('createdBy', 'name role')
      .sort({ createdAt: -1 });

    return res.json({ success: true, templates });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Create a new custom document layout template.
 *
 * @route POST /api/v1/documents/templates/custom
 */
export const createCustomTemplate = async (req, res) => {
  try {
    const { name, baseTemplateId, category, configuration } = req.body;

    if (!name || !baseTemplateId || !category) {
      return sendBadRequest(res, 'name, baseTemplateId, and category are required');
    }

    const templateData = {
      name,
      baseTemplateId,
      category,
      configuration: configuration || {},
      createdBy: req.user
        ? { _id: req.user._id || req.user.id, name: req.user.name }
        : null,
      isActive: true
    };

    if (checkFallback()) {
      const created = FallbackDb.create(
        'customDocumentTemplates',
        templateData
      );
      return res.status(201).json({
        success: true,
        message: 'Custom template created',
        template: created
      });
    }

    const template = await CustomDocumentTemplate.create({
      ...templateData,
      createdBy: req.user._id || req.user.id
    });

    return res.status(201).json({
      success: true,
      message: 'Custom template created',
      template
    });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Update an existing custom document template.
 *
 * @route PUT /api/v1/documents/templates/custom/:id
 */
export const updateCustomTemplate = async (req, res) => {
  try {
    const { name, configuration } = req.body;

    if (checkFallback()) {
      const updated = FallbackDb.update(
        'customDocumentTemplates',
        req.params.id,
        {
          ...(name ? { name } : {}),
          ...(configuration ? { configuration } : {})
        }
      );
      if (!updated) {
        return sendNotFound(res, 'Template not found');
      }
      return res.json({
        success: true,
        message: 'Template updated',
        template: updated
      });
    }

    const template = await CustomDocumentTemplate.findById(req.params.id);
    if (!template) {
      return sendNotFound(res, 'Template not found');
    }

    if (name) template.name = name;
    if (configuration) {
      template.configuration = { ...template.configuration, ...configuration };
    }
    await template.save();

    return res.json({ success: true, message: 'Template updated', template });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Soft delete (deactivate) a custom document template.
 *
 * @route DELETE /api/v1/documents/templates/custom/:id
 */
export const deleteCustomTemplate = async (req, res) => {
  try {
    if (checkFallback()) {
      const updated = FallbackDb.update(
        'customDocumentTemplates',
        req.params.id,
        {
          isActive: false
        }
      );
      if (!updated) {
        return sendNotFound(res, 'Template not found');
      }
      return sendSuccess(res, 'Template deactivated successfully');
    }

    const template = await CustomDocumentTemplate.findById(req.params.id);
    if (!template) {
      return sendNotFound(res, 'Template not found');
    }

    template.isActive = false;
    await template.save();

    return sendSuccess(res, 'Template deactivated successfully');
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

// ─── Default Institution Template Controllers ─────────────────────────────────

const CATEGORY_MAP = {
  'student-id-card': 'studentIdCard',
  'teacher-id-card': 'teacherIdCard',
  'staff-id-card': 'staffIdCard',
  certificate: 'certificate'
};

const DEFAULT_BUILTIN_TEMPLATES = {
  'student-id-card': {
    templateId: 'student-id-classic',
    name: 'Classic Student Card',
    category: 'student-id-card',
    configuration: {},
    isDefault: true
  },
  'teacher-id-card': {
    templateId: 'teacher-id-professional',
    name: 'Professional Faculty Card',
    category: 'teacher-id-card',
    configuration: {},
    isDefault: true
  },
  'staff-id-card': {
    templateId: 'staff-id-corporate',
    name: 'Corporate Staff Card',
    category: 'staff-id-card',
    configuration: {},
    isDefault: true
  },
  certificate: {
    templateId: 'certificate-classic',
    name: 'Classic Institutional Certificate',
    category: 'certificate',
    configuration: {},
    isDefault: true
  }
};

/**
 * Retrieve the active default document template configuration for a category.
 *
 * @route GET /api/v1/documents/templates/default/:category
 */
export const getDefaultTemplate = async (req, res) => {
  try {
    const category = req.params.category || 'student-id-card';
    const key = CATEGORY_MAP[category] || 'studentIdCard';
    const fallbackTemplate =
      DEFAULT_BUILTIN_TEMPLATES[category] ||
      DEFAULT_BUILTIN_TEMPLATES['student-id-card'];

    if (checkFallback()) {
      const settings = FallbackDb.getSettings?.() || {};
      const saved = settings.defaultDocumentTemplates?.[category];
      if (saved) {
        return res.json({
          success: true,
          defaultTemplate: { ...saved, category }
        });
      }

      const customTemplates = FallbackDb.find('customDocumentTemplates') || [];
      const defaultCustom = customTemplates.find(
        (ct) => ct.category === category && ct.isDefault && ct.isActive !== false
      );
      if (defaultCustom) {
        return res.json({
          success: true,
          defaultTemplate: {
            templateId: defaultCustom.baseTemplateId,
            customTemplateId: defaultCustom._id || defaultCustom.id,
            name: defaultCustom.name,
            category: defaultCustom.category,
            configuration: defaultCustom.configuration || {},
            isDefault: true
          }
        });
      }

      return res.json({
        success: true,
        defaultTemplate: fallbackTemplate
      });
    }

    // MongoDB mode
    const setting = await Setting.findOne();
    const savedConfig = setting?.defaultDocumentTemplates?.[key];

    if (savedConfig && savedConfig.templateId) {
      let finalConfig = {
        templateId: savedConfig.templateId,
        customTemplateId: savedConfig.customTemplateId || null,
        configuration: savedConfig.configuration || {},
        name: savedConfig.name || fallbackTemplate.name,
        category,
        finalizedAt: savedConfig.finalizedAt,
        finalizedBy: savedConfig.finalizedBy,
        isDefault: true
      };

      if (savedConfig.customTemplateId) {
        const customDoc = await CustomDocumentTemplate.findById(
          savedConfig.customTemplateId
        );
        if (customDoc && customDoc.isActive) {
          finalConfig.configuration = {
            ...customDoc.configuration,
            ...finalConfig.configuration
          };
          finalConfig.name = customDoc.name;
        }
      }

      return res.json({
        success: true,
        defaultTemplate: finalConfig
      });
    }

    const customDefault = await CustomDocumentTemplate.findOne({
      category,
      isDefault: true,
      isActive: true
    });

    if (customDefault) {
      return res.json({
        success: true,
        defaultTemplate: {
          templateId: customDefault.baseTemplateId,
          customTemplateId: customDefault._id,
          name: customDefault.name,
          category: customDefault.category,
          configuration: customDefault.configuration || {},
          isDefault: true
        }
      });
    }

    return res.json({
      success: true,
      defaultTemplate: fallbackTemplate
    });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};

/**
 * Configure and designate an active institution-wide default template.
 *
 * @route POST /api/v1/documents/templates/default
 */
export const setDefaultTemplate = async (req, res) => {
  try {
    const { category, templateId, configuration, customTemplateId, name } = req.body;

    if (!category || !templateId) {
      return sendBadRequest(res, 'category and templateId are required');
    }

    const key = CATEGORY_MAP[category] || 'studentIdCard';
    const templateName = name || templateId;
    const finalData = {
      templateId,
      customTemplateId: customTemplateId || null,
      configuration: configuration || {},
      name: templateName,
      category,
      finalizedAt: new Date(),
      finalizedBy: req.user?.name || 'Admin',
      isDefault: true
    };

    if (checkFallback()) {
      const customTemplates = FallbackDb.find('customDocumentTemplates') || [];
      customTemplates.forEach((ct) => {
        if (ct.category === category) {
          const isTarget =
            customTemplateId &&
            (ct.id === customTemplateId || ct._id === customTemplateId);
          FallbackDb.update('customDocumentTemplates', ct.id || ct._id, {
            isDefault: Boolean(isTarget)
          });
        }
      });

      const currentSettings = FallbackDb.getSettings?.() || {};
      const updatedDefaults = {
        ...(currentSettings.defaultDocumentTemplates || {}),
        [category]: finalData
      };
      FallbackDb.updateSettings({
        defaultDocumentTemplates: updatedDefaults
      });

      return res.json({
        success: true,
        message: 'Template finalized as school default format',
        defaultTemplate: finalData
      });
    }

    // MongoDB mode
    if (customTemplateId) {
      await CustomDocumentTemplate.updateMany(
        { category },
        { $set: { isDefault: false } }
      );
      await CustomDocumentTemplate.findByIdAndUpdate(customTemplateId, {
        $set: { isDefault: true }
      });
    } else {
      await CustomDocumentTemplate.updateMany(
        { category },
        { $set: { isDefault: false } }
      );
    }

    let setting = await Setting.findOne();
    if (!setting) {
      setting = new Setting();
    }

    if (!setting.defaultDocumentTemplates) {
      setting.defaultDocumentTemplates = {};
    }

    setting.defaultDocumentTemplates[key] = {
      templateId,
      customTemplateId: customTemplateId || null,
      configuration: configuration || {},
      name: templateName,
      finalizedAt: new Date(),
      finalizedBy: req.user?.name || 'Admin'
    };

    setting.markModified('defaultDocumentTemplates');
    await setting.save();

    return res.json({
      success: true,
      message: 'Template finalized as school default format',
      defaultTemplate: finalData
    });
  } catch (error) {
    return sendError(res, 'Server error', 500, error);
  }
};
