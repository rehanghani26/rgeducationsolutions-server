import bcrypt from 'bcryptjs';
import School from '../models/School.js';
import CommonProduct from '../models/CommonProduct.js';
import CommonCategory from '../models/CommonCategory.js';
import RGESAdmin from '../models/RGESAdmin.js';
import User from '../models/User.js';
import Setting from '../models/Setting.js';
import AcademicSession from '../models/AcademicSession.js';
import Student from '../models/Student.js';
import Teacher from '../models/Teacher.js';
import { generateTokens } from '../middleware/auth.js';
import { invalidateSchoolsCache } from '../middleware/tenant.js';
import {
  sendBadRequest,
  sendCreated,
  sendError,
  sendNotFound,
  sendSuccess,
  sendUnauthorized,
} from '../utils/responseUtil.js';

/**
 * Super Admin Login for RGES Admin UI
 *
 * @route POST /api/v1/admin/login
 */
export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendBadRequest(res, 'Please provide email and password');
    }

    const cleanEmail = email.toLowerCase().trim();

    // Check RGESAdmin collection
    let admin = await RGESAdmin.findOne({ email: cleanEmail });

    // Seed initial super-admin if collection is empty
    if (!admin && cleanEmail === 'admin@rges.com') {
      admin = new RGESAdmin({
        name: 'RGES Super Admin',
        email: 'admin@rges.com',
        password: password || 'Admin@1234',
        role: 'super-admin',
        permissions: ['all'],
      });
      await admin.save();
    }

    if (!admin) {
      return sendUnauthorized(res, 'Invalid credentials');
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return sendUnauthorized(res, 'Invalid credentials');
    }

    if (!admin.isActive) {
      return sendUnauthorized(res, 'Admin account is deactivated');
    }

    admin.lastLogin = new Date();
    await admin.save();

    const { accessToken, refreshToken } = generateTokens({
      id: admin._id,
      _id: admin._id,
      role: admin.role,
      permissions: admin.permissions || ['all'],
      name: admin.name,
    });

    return sendSuccess(
      res,
      'Super Admin login successful',
      {
        accessToken,
        user: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
        },
      },
      200,
      {
        accessToken,
        user: {
          id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
        },
      }
    );
  } catch (err) {
    return sendError(res, 'Super Admin login failed', 500, err);
  }
};

/**
 * Validates collection name against strict multi-tenant slug rules
 */
const isValidCollectionName = (name) => {
  return typeof name === 'string' && /^[a-z0-9_]{3,30}$/.test(name);
};

/**
 * Onboard a new school with a centrally assigned schoolId.
 * Provisions school record, primary admin, settings, and academic session in shared collections.
 *
 * @route POST /api/v1/admin/schools
 */
export const onboardSchool = async (req, res) => {
  try {
    const {
      schoolName,
      collectionName,
      schoolCode,
      contactEmail,
      schoolPhone,
      alternatePhone,
      address,
      affiliationNumber,
      board,
      subscriptionPlan,
      adminName,
      adminEmail,
      adminPassword,
    } = req.body;

    if (!schoolName || !schoolName.trim()) {
      return sendBadRequest(res, 'School name is required');
    }

    if (!contactEmail || !contactEmail.trim()) {
      return sendBadRequest(res, 'Official contact email is required');
    }

    // Generate unique schoolCode and schoolId
    const baseCode = (schoolCode || (collectionName || schoolName).replace(/[^a-zA-Z0-9]/g, '').slice(0, 5))
      .trim()
      .toUpperCase();

    let resolvedCode = baseCode;
    let resolvedSchoolId = (req.body.schoolId || '').trim().toUpperCase();

    if (!resolvedSchoolId) {
      let seq = 1;
      resolvedSchoolId = `${resolvedCode}${String(seq).padStart(3, '0')}`;
      while (
        await School.findOne({
          $or: [{ _id: resolvedSchoolId }, { schoolId: resolvedSchoolId }],
        })
      ) {
        seq++;
        resolvedSchoolId = `${resolvedCode}${String(seq).padStart(3, '0')}`;
      }
    }

    // Check if schoolId or schoolCode is already in use
    const existingSchool = await School.findOne({
      $or: [
        { _id: resolvedSchoolId },
        { schoolId: resolvedSchoolId },
        { schoolCode: resolvedCode },
      ],
    });

    if (existingSchool) {
      return sendBadRequest(
        res,
        `School with code '${resolvedCode}' or ID '${resolvedSchoolId}' is already registered.`
      );
    }

    const cleanCollection = collectionName
      ? String(collectionName).toLowerCase().trim()
      : resolvedCode.toLowerCase();

    // 1. Create School record in master registry
    const school = new School({
      _id: resolvedSchoolId,
      schoolId: resolvedSchoolId,
      schoolName: schoolName.trim(),
      collectionName: cleanCollection,
      schoolCode: resolvedCode,
      contactEmail: contactEmail.toLowerCase().trim(),
      schoolPhone: schoolPhone || '',
      alternatePhone: alternatePhone || '',
      address: address || {},
      affiliationNumber: affiliationNumber || '',
      board: board || 'CBSE',
      subscriptionPlan: subscriptionPlan || 'standard',
      status: 'active',
      primaryAdmin: {
        name: adminName || `${schoolName.trim()} Admin`,
        email: (adminEmail || contactEmail).toLowerCase().trim(),
        phone: schoolPhone || '',
      },
    });

    await school.save();

    // 2. Provision Tenant in Shared Collections (Zero new databases or collections created)
    try {
      // 2a. Provision Primary School Admin in shared 'users' collection
      const defaultPassword = adminPassword || 'Admin@1234';
      const initialAdmin = new User({
        schoolId: resolvedSchoolId,
        name: adminName || `${schoolName.trim()} Admin`,
        email: (adminEmail || contactEmail).toLowerCase().trim(),
        username: (adminEmail || contactEmail).toLowerCase().trim(),
        password: defaultPassword,
        role: 'super-admin',
        permissions: ['all'],
        isActive: true,
        isEmailVerified: true,
      });
      await initialAdmin.save();

      school.primaryAdmin.userId = String(initialAdmin._id);
      await school.save();

      // 2b. Provision Initial Settings in shared 'settings' collection
      await Setting.create({
        schoolId: resolvedSchoolId,
        schoolName: schoolName.trim(),
        schoolCode: resolvedCode,
        contactEmail: contactEmail.toLowerCase().trim(),
        schoolPhone: schoolPhone || '',
        addressLine1: address?.addressLine1 || '',
        city: address?.city || '',
        state: address?.state || '',
        country: address?.country || 'India',
        postalCode: address?.postalCode || '',
        affiliationNumber: affiliationNumber || '',
      });

      // 2c. Provision Default Current Academic Session in shared 'academicsessions' collection
      const currentYear = new Date().getFullYear();
      await AcademicSession.create({
        schoolId: resolvedSchoolId,
        sessionName: `${currentYear}-${currentYear + 1}`,
        startDate: new Date(Date.UTC(currentYear, 3, 1)), // April 1st
        endDate: new Date(Date.UTC(currentYear + 1, 2, 31)), // March 31st
        isCurrent: true,
        status: 'active',
        notes: 'Auto-provisioned initial academic session',
      });
    } catch (provisionErr) {
      console.error(
        `⚠️ Warning during initial provisioning for ${resolvedSchoolId}:`,
        provisionErr.message
      );
    }

    // Refresh memory cache
    invalidateSchoolsCache();

    return sendCreated(res, 'School onboarded and provisioned successfully!', {
      school,
      tenantDetails: {
        schoolId: resolvedSchoolId,
        schoolCode: resolvedCode,
        adminLogin: (adminEmail || contactEmail).toLowerCase().trim(),
        sharedCollectionsUsed: ['users', 'settings', 'academicsessions'],
      },
    });
  } catch (err) {
    return sendError(res, 'Failed to onboard school', 500, err);
  }
};

/**
 * Real-time collection name availability check
 *
 * @route GET /api/v1/admin/schools/check-slug?slug=myschool
 */
export const checkSlugAvailability = async (req, res) => {
  try {
    const slug = String(req.query.slug || '')
      .toLowerCase()
      .trim();

    if (!isValidCollectionName(slug)) {
      return sendSuccess(res, undefined, null, 200, {
        available: false,
        validFormat: false,
        message:
          'Slug must be 3-30 characters with only lowercase letters, numbers, and underscores.',
      });
    }

    const count = await School.countDocuments({ collectionName: slug });
    const available = count === 0;

    return sendSuccess(
      res,
      available ? 'Collection name is available!' : 'Collection name is already taken.',
      {
        available,
        validFormat: true,
        slug,
        message: available ? 'Collection name is available!' : 'Collection name is already taken.',
      },
      200,
      {
        available,
        validFormat: true,
        slug,
        message: available ? 'Collection name is available!' : 'Collection name is already taken.',
      }
    );
  } catch (err) {
    return sendError(res, 'Error checking collection slug', 500, err);
  }
};

/**
 * Retrieve all registered schools
 *
 * @route GET /api/v1/admin/schools
 */
export const getSchools = async (req, res) => {
  try {
    const { search, status } = req.query;
    const filter = {};

    if (status && ['active', 'suspended', 'provisioning'].includes(status)) {
      filter.status = status;
    }

    if (search && search.trim()) {
      filter.$or = [
        { schoolName: { $regex: search.trim(), $options: 'i' } },
        { collectionName: { $regex: search.trim(), $options: 'i' } },
        { schoolCode: { $regex: search.trim(), $options: 'i' } },
        { contactEmail: { $regex: search.trim(), $options: 'i' } },
      ];
    }

    const schools = await School.find(filter).sort({ createdAt: -1 }).lean();

    return sendSuccess(
      res,
      'Schools fetched successfully',
      {
        count: schools.length,
        schools,
      },
      200,
      {
        count: schools.length,
        schools,
      }
    );
  } catch (err) {
    return sendError(res, 'Failed to fetch schools', 500, err);
  }
};

/**
 * Retrieve a specific school with tenant statistics
 *
 * @route GET /api/v1/admin/schools/:id
 */
export const getSchoolById = async (req, res) => {
  try {
    const { id } = req.params;
    const school = await School.findById(id).lean();

    if (!school) {
      return sendNotFound(res, 'School not found');
    }

    const sId = school.schoolId || school._id;

    let stats = {
      studentsCount: 0,
      teachersCount: 0,
      usersCount: 0,
    };

    try {
      const [sCount, tCount, uCount] = await Promise.all([
        Student.countDocuments({ schoolId: sId }).setOptions({ skipTenantFilter: true }).catch(() => 0),
        Teacher.countDocuments({ schoolId: sId }).setOptions({ skipTenantFilter: true }).catch(() => 0),
        User.countDocuments({ schoolId: sId }).setOptions({ skipTenantFilter: true }).catch(() => 0),
      ]);

      stats = {
        studentsCount: sCount,
        teachersCount: tCount,
        usersCount: uCount,
      };
    } catch (_statErr) {
      // stats optional
    }

    return sendSuccess(
      res,
      'School details fetched',
      {
        school,
        stats,
      },
      200,
      {
        school,
        stats,
      }
    );
  } catch (err) {
    return sendError(res, 'Failed to fetch school details', 500, err);
  }
};

/**
 * Update school profile (excluding immutable collectionName)
 *
 * @route PUT /api/v1/admin/schools/:id
 */
export const updateSchool = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    // Explicitly prohibit changing collectionName
    delete updates.collectionName;
    delete updates._id;

    const school = await School.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!school) {
      return sendNotFound(res, 'School not found');
    }

    invalidateSchoolsCache();

    return sendSuccess(res, 'School profile updated successfully', null, 200, {
      school,
    });
  } catch (err) {
    return sendError(res, 'Failed to update school', 500, err);
  }
};

/**
 * Toggle school active/suspended status
 *
 * @route PATCH /api/v1/admin/schools/:id/status
 */
export const toggleSchoolStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['active', 'suspended'].includes(status)) {
      return sendBadRequest(res, "Status must be 'active' or 'suspended'");
    }

    const school = await School.findByIdAndUpdate(id, { status }, { new: true });

    if (!school) {
      return sendNotFound(res, 'School not found');
    }

    invalidateSchoolsCache();

    return sendSuccess(res, `School status changed to ${status}`, null, 200, { school });
  } catch (err) {
    return sendError(res, 'Failed to change school status', 500, err);
  }
};

// ─── Common Catalog Controllers ──────────────────────────────────────────────

export const getCommonProducts = async (req, res) => {
  try {
    const products = await CommonProduct.find().sort({ createdAt: -1 }).lean();
    return sendSuccess(res, 'Products fetched', { products }, 200, { products });
  } catch (err) {
    return sendError(res, 'Failed to fetch common products', 500, err);
  }
};

export const createCommonProduct = async (req, res) => {
  try {
    const product = new CommonProduct(req.body);
    await product.save();
    return sendCreated(res, 'Common product created', { product });
  } catch (err) {
    return sendError(res, 'Failed to create common product', 500, err);
  }
};

export const getCommonCategories = async (req, res) => {
  try {
    const categories = await CommonCategory.find().sort({ name: 1 }).lean();
    return sendSuccess(res, 'Categories fetched', { categories }, 200, { categories });
  } catch (err) {
    return sendError(res, 'Failed to fetch common categories', 500, err);
  }
};

export const createCommonCategory = async (req, res) => {
  try {
    const category = new CommonCategory(req.body);
    await category.save();
    return sendCreated(res, 'Common category created', { category });
  } catch (err) {
    return sendError(res, 'Failed to create common category', 500, err);
  }
};
