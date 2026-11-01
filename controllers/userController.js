// 2. External packages
import mongoose from 'mongoose';

// 3. Configuration
import { checkFallback } from '../config/db.js';

// 4. Models
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';

// 6. Services
import { FallbackDb } from '../services/dbFallback.js';

// 7. Utilities
import { logActivity } from '../utils/activityLogger.js';
import { normalizeEmail, isValidObjectId } from '../utils/commonUtil.js';
import {
  sendSuccess,
  sendCreated,
  sendBadRequest,
  sendNotFound,
  sendForbidden,
  sendError
} from '../utils/responseUtil.js';

/**
 * Standard System Company/Staff Roles Definition.
 * Excludes student and parent accounts which are managed via student admissions.
 */
export const SYSTEM_ROLES = [
  {
    id: 'super-admin',
    name: 'Super Admin (Director)',
    description: 'Master institutional governor & Director (strictly 1 account; permanent role, cannot be changed or demoted).',
    category: 'Executive & Governance',
    color: 'purple',
    badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border-purple-300 dark:border-purple-800',
    icon: 'ShieldAlert',
    canCreate: false, // Strictly 1 account, immutable
    maxCount: 1,
    immutable: true,
  },
  {
    id: 'school-admin',
    name: 'Admin',
    description: 'School administration, staff assignments, operational records, and daily module oversight.',
    category: 'Administration',
    color: 'indigo',
    badgeClass: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800',
    icon: 'ShieldCheck',
    canCreate: true,
    maxCount: 'multiple',
  },
  {
    id: 'principal',
    name: 'Principal',
    description: 'Institutional head and academic dean (strictly 1 Principal permitted for the entire school).',
    category: 'Institutional Leadership',
    color: 'blue',
    badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300 dark:border-blue-800',
    icon: 'GraduationCap',
    canCreate: true,
    maxCount: 1,
  },
  {
    id: 'teacher',
    name: 'Teacher',
    description: 'Faculty instructor, subject teacher, classroom management, and Class Teacher assignments.',
    category: 'Academic Faculty',
    color: 'emerald',
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
    icon: 'BookOpen',
    canCreate: true,
    maxCount: 'multiple',
  },
  {
    id: 'accountant',
    name: 'Accountant',
    description: 'Fee processing, ledger audits, balance sheets, invoice verification, and staff payroll.',
    category: 'Finance',
    color: 'amber',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-800',
    icon: 'Wallet',
    canCreate: true,
    maxCount: 'multiple',
  },
  {
    id: 'librarian',
    name: 'Librarian',
    description: 'Book cataloging, student lending records, physical inventory, and library management.',
    category: 'Operations',
    color: 'rose',
    badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300 dark:border-rose-800',
    icon: 'Library',
    canCreate: true,
    maxCount: 'multiple',
  },
  {
    id: 'peon',
    name: 'Peon / Support Staff',
    description: 'Campus maintenance, facility logistics, messenger assistance, and classroom upkeep.',
    category: 'Support Staff',
    color: 'orange',
    badgeClass: 'bg-orange-100 text-orange-800 dark:bg-orange-950/60 dark:text-orange-300 border-orange-300 dark:border-orange-800',
    icon: 'UserCheck',
    canCreate: true,
    maxCount: 'multiple',
  },
];

// Explicitly exclude student and parent accounts from company user management
const EXCLUDED_ROLES = ['student', 'parent'];

/**
 * Retrieves all company roles with active user counts.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getRoles = async (req, res) => {
  try {
    let userCounts = {};

    if (checkFallback()) {
      const users = FallbackDb.find('users') || [];
      users.forEach((u) => {
        const role = (u.role || '').toLowerCase();
        if (!EXCLUDED_ROLES.includes(role)) {
          userCounts[role] = (userCounts[role] || 0) + 1;
        }
      });
    } else {
      const counts = await User.aggregate([
        { $match: { role: { $nin: EXCLUDED_ROLES } } },
        { $group: { _id: { $toLower: '$role' }, count: { $sum: 1 } } }
      ]);
      counts.forEach((item) => {
        if (item._id) userCounts[item._id] = item.count;
      });
    }

    const rolesWithCounts = SYSTEM_ROLES.map((role) => ({
      ...role,
      userCount: userCounts[role.id] || 0
    }));

    return sendSuccess(res, undefined, { roles: rolesWithCounts });
  } catch (error) {
    return sendError(res, 'Failed to retrieve roles', 500, error);
  }
};

/**
 * Retrieves company staff users with filtering and pagination.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getUsers = async (req, res) => {
  try {
    const { search, role, status, page = 1, limit = 100 } = req.query;

    if (checkFallback()) {
      let users = FallbackDb.find('users') || [];

      // Exclude student and parent accounts entirely
      users = users.filter((u) => !EXCLUDED_ROLES.includes((u.role || '').toLowerCase()));

      // Filter by search query
      if (search && search.trim()) {
        const term = search.toLowerCase().trim();
        users = users.filter((u) =>
          (u.name && u.name.toLowerCase().includes(term)) ||
          (u.username && u.username.toLowerCase().includes(term)) ||
          (u.email && u.email.toLowerCase().includes(term)) ||
          (u.phone && u.phone.toLowerCase().includes(term)) ||
          (u.designation && u.designation.toLowerCase().includes(term)) ||
          (u.department && u.department.toLowerCase().includes(term)) ||
          (u.employeeId && u.employeeId.toLowerCase().includes(term))
        );
      }

      // Filter by role
      if (role && role !== 'all') {
        const normRole = role.toLowerCase();
        users = users.filter((u) => (u.role || '').toLowerCase() === normRole);
      }

      // Filter by active status
      if (status !== undefined && status !== 'all') {
        const isActive = status === 'true' || status === true || status === 'active';
        users = users.filter((u) => Boolean(u.isActive) === isActive);
      }

      const total = users.length;
      const startIndex = (parseInt(page, 10) - 1) * parseInt(limit, 10);
      const paginatedUsers = users.slice(startIndex, startIndex + parseInt(limit, 10)).map((u) => {
        const { password, ...userWithoutPassword } = u;
        return userWithoutPassword;
      });

      // Role summary breakdown
      const roleStats = {};
      users.forEach((u) => {
        const r = (u.role || 'other').toLowerCase();
        roleStats[r] = (roleStats[r] || 0) + 1;
      });

      return sendSuccess(res, undefined, {
        total,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        users: paginatedUsers,
        roleStats
      });
    }

    // MongoDB path
    const query = {
      role: { $nin: EXCLUDED_ROLES }
    };

    if (search && search.trim()) {
      const term = search.trim();
      query.$or = [
        { name: { $regex: term, $options: 'i' } },
        { username: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
        { phone: { $regex: term, $options: 'i' } },
        { designation: { $regex: term, $options: 'i' } },
        { department: { $regex: term, $options: 'i' } },
        { employeeId: { $regex: term, $options: 'i' } }
      ];
    }

    if (role && role !== 'all') {
      query.role = role.toLowerCase();
    }

    if (status !== undefined && status !== 'all') {
      query.isActive = status === 'true' || status === true || status === 'active';
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [users, total, roleCounts] = await Promise.all([
      User.find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10)),
      User.countDocuments(query),
      User.aggregate([
        { $match: { role: { $nin: EXCLUDED_ROLES } } },
        { $group: { _id: { $toLower: '$role' }, count: { $sum: 1 } } }
      ])
    ]);

    const roleStats = {};
    roleCounts.forEach((rc) => {
      if (rc._id) roleStats[rc._id] = rc.count;
    });

    return sendSuccess(res, undefined, {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      users,
      roleStats
    });
  } catch (error) {
    return sendError(res, 'Failed to retrieve users', 500, error);
  }
};

/**
 * Retrieves user details by ID or username/employee ID, including linked teacher profile.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const getUserById = async (req, res) => {
  const { id } = req.params;

  try {
    let user = null;

    if (checkFallback()) {
      user = FallbackDb.findById('users', id);
      if (!user) {
        return sendNotFound(res, 'User not found');
      }

      // Check if linked to teacher
      const teacher = FallbackDb.find('teachers')?.find(t => t.user === id || t.id === user.profileId);
      const { password, ...userWithoutPassword } = user;

      return sendSuccess(res, undefined, {
        user: {
          ...userWithoutPassword,
          teacherProfile: teacher || null
        }
      });
    }

    if (isValidObjectId(id)) {
      user = await User.findById(id).select('-password');
    }
    if (!user) {
      user = await User.findOne({ $or: [{ username: id }, { employeeId: id }] }).select('-password');
    }

    if (!user) {
      return sendNotFound(res, 'User not found');
    }

    // Try to find teacher profile if applicable
    let teacherProfile = null;
    try {
      teacherProfile = await Teacher.findOne({
        $or: [
          { user: user._id },
          ...(user.employeeId ? [{ employeeId: user.employeeId }] : [])
        ]
      });
    } catch {
      // Non-blocking query failure
    }

    return sendSuccess(res, undefined, {
      user: {
        ...user.toObject(),
        teacherProfile
      }
    });
  } catch (error) {
    return sendError(res, 'Failed to retrieve user', 500, error);
  }
};

/**
 * Creates a new company staff user.
 * Super Admin (Director) creation is forbidden; only one account permitted.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const createUser = async (req, res) => {
  const {
    username,
    name,
    email,
    password,
    role,
    employeeId,
    phone,
    alternatePhone,
    gender,
    dob,
    address,
    qualification,
    designation,
    department,
    joiningDate,
    salary,
    isClassTeacher = false,
    classTeacherOf = '',
    classesAssigned = [],
    sectionsAssigned = [],
    subjectsAssigned = [],
    isActive = true,
    permissions = [],
    twoFactorEnabled = false,
    forcePasswordChange = false
  } = req.body;

  if (!username || !email || !password || !name || !role) {
    return sendBadRequest(res, 'Name, username, email, password, and role are required');
  }

  const cleanRole = role.toLowerCase().trim();

  // RULE: Cannot create Super Admin from User Management
  if (cleanRole === 'super-admin' || cleanRole === 'superadmin' || cleanRole === 'director') {
    return sendForbidden(res, 'Creation of Super Admin (Director) accounts is not permitted. Only 1 Super Admin (Director) exists in the institution.');
  }

  // RULE: Cannot create student or parent from User Management
  if (EXCLUDED_ROLES.includes(cleanRole)) {
    return sendBadRequest(res, 'Student and Parent accounts cannot be created in User Management. Please use Student Admissions.');
  }

  const allowedRoles = SYSTEM_ROLES.filter(r => r.canCreate).map(r => r.id);
  if (!allowedRoles.includes(cleanRole)) {
    return sendBadRequest(res, `Invalid role '${role}'. Allowed roles are: ${allowedRoles.join(', ')}`);
  }

  // RULE: Strictly 1 Principal allowed in the institution
  if (cleanRole === 'principal') {
    let existingPrincipal = null;
    if (checkFallback()) {
      const allUsers = FallbackDb.find('users') || [];
      existingPrincipal = allUsers.find(u => (u.role || '').toLowerCase() === 'principal' && u.isActive !== false);
    } else {
      existingPrincipal = await User.findOne({ role: 'principal', isActive: true });
    }
    if (existingPrincipal) {
      return sendBadRequest(
        res,
        `Only 1 Principal is permitted for the institution. ${existingPrincipal.name} is currently assigned as Principal. Please reassign the current Principal first.`
      );
    }
  }

  try {
    const normalizedUserEmail = normalizeEmail(email);

    if (checkFallback()) {
      const existingUser = FallbackDb.findOne('users', { username: username.toLowerCase().trim() }) ||
                           FallbackDb.findOne('users', { email: normalizedUserEmail });
      if (existingUser) {
        return sendBadRequest(res, 'A user with this username or email already exists');
      }

      const newUser = FallbackDb.create('users', {
        name: name.trim(),
        username: username.toLowerCase().trim(),
        email: normalizedUserEmail,
        password,
        role: cleanRole,
        employeeId: employeeId ? employeeId.trim().toUpperCase() : undefined,
        phone: phone ? phone.trim() : undefined,
        alternatePhone: alternatePhone ? alternatePhone.trim() : undefined,
        gender: gender || '',
        dob: dob || undefined,
        address: address ? address.trim() : undefined,
        qualification: qualification ? qualification.trim() : undefined,
        designation: designation ? designation.trim() : undefined,
        department: department ? department.trim() : undefined,
        joiningDate: joiningDate || new Date().toISOString(),
        salary: Number(salary) || 0,
        isClassTeacher: Boolean(isClassTeacher),
        classTeacherOf: classTeacherOf ? classTeacherOf.trim() : '',
        classesAssigned: Array.isArray(classesAssigned) ? classesAssigned : [],
        sectionsAssigned: Array.isArray(sectionsAssigned) ? sectionsAssigned : [],
        subjectsAssigned: Array.isArray(subjectsAssigned) ? subjectsAssigned : [],
        isActive: Boolean(isActive),
        permissions: permissions || [],
        twoFactorEnabled: Boolean(twoFactorEnabled),
        forcePasswordChange: Boolean(forcePasswordChange),
        lastLogin: null,
        loginHistory: []
      });

      await logActivity({
        userId: req.user.id || req.user._id,
        action: 'CREATE_USER',
        module: 'user-management',
        details: `Created new ${cleanRole} user ${name} (${username})`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      const { password: _, ...userWithoutPassword } = newUser;
      return sendCreated(res, `User created successfully as ${cleanRole}`, {
        user: userWithoutPassword
      });
    }

    // MongoDB path
    const existing = await User.findOne({
      $or: [
        { username: username.toLowerCase().trim() },
        { email: normalizedUserEmail },
        ...(employeeId ? [{ employeeId: employeeId.trim().toUpperCase() }] : [])
      ]
    });

    if (existing) {
      return sendBadRequest(res, 'A user with this username, email, or employee ID already exists');
    }

    const userPayload = {
      name: name.trim(),
      username: username.toLowerCase().trim(),
      email: normalizedUserEmail,
      password,
      role: cleanRole,
      phone: phone ? phone.trim() : undefined,
      alternatePhone: alternatePhone ? alternatePhone.trim() : undefined,
      gender: gender || '',
      dob: dob || undefined,
      address: address ? address.trim() : undefined,
      qualification: qualification ? qualification.trim() : undefined,
      designation: designation ? designation.trim() : undefined,
      department: department ? department.trim() : undefined,
      joiningDate: joiningDate || new Date(),
      salary: Number(salary) || 0,
      isClassTeacher: Boolean(isClassTeacher),
      classTeacherOf: classTeacherOf ? classTeacherOf.trim() : '',
      classesAssigned: Array.isArray(classesAssigned) ? classesAssigned : [],
      sectionsAssigned: Array.isArray(sectionsAssigned) ? sectionsAssigned : [],
      subjectsAssigned: Array.isArray(subjectsAssigned) ? subjectsAssigned : [],
      isActive: Boolean(isActive),
      permissions: permissions || [],
      twoFactorEnabled: Boolean(twoFactorEnabled),
      forcePasswordChange: Boolean(forcePasswordChange)
    };

    if (employeeId && employeeId.trim()) {
      userPayload.employeeId = employeeId.trim().toUpperCase();
    }

    const created = await User.create(userPayload);

    // If teacher role, also register/sync in Teacher collection if applicable
    if (['teacher', 'head-teacher', 'hod', 'coordinator'].includes(cleanRole)) {
      try {
        const [firstName, ...restName] = name.trim().split(' ');
        await Teacher.create({
          user: created._id,
          firstName: firstName || name,
          lastName: restName.join(' ') || '.',
          name: name.trim(),
          employeeId: created.employeeId || `EMP-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
          gender: gender || '',
          dob: dob || undefined,
          phone: phone || '000-000-0000',
          alternatePhone: alternatePhone || '',
          email: normalizedUserEmail,
          address: address || '',
          joiningDate: joiningDate || new Date(),
          qualification: qualification || 'B.Ed',
          designation: designation || 'Teacher',
          department: department || 'Academics',
          salary: Number(salary) || 0,
          isClassTeacher: Boolean(isClassTeacher),
          classesAssigned: Array.isArray(classesAssigned) ? classesAssigned : [],
          sectionsAssigned: Array.isArray(sectionsAssigned) ? sectionsAssigned : [],
          subjectsAssigned: Array.isArray(subjectsAssigned) ? subjectsAssigned : [],
          role: cleanRole,
          status: isActive ? 'active' : 'inactive'
        });
      } catch (err) {
        console.warn('Teacher secondary model sync note:', err.message);
      }
    }

    await logActivity({
      userId: req.user.id || req.user._id,
      action: 'CREATE_USER',
      module: 'user-management',
      details: `Created new ${cleanRole} user ${name} (${username})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    const userObj = created.toObject();
    delete userObj.password;

    return sendCreated(res, `User created successfully as ${cleanRole}`, {
      user: userObj
    });
  } catch (error) {
    return sendError(res, error.message || 'Failed to create user', 500, error);
  }
};

/**
 * Updates staff user profile, academic duties, or role assignment.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const updateUser = async (req, res) => {
  const { id } = req.params;
  const {
    name,
    email,
    role,
    employeeId,
    phone,
    alternatePhone,
    gender,
    dob,
    address,
    qualification,
    designation,
    department,
    joiningDate,
    salary,
    isClassTeacher,
    classTeacherOf,
    classesAssigned,
    sectionsAssigned,
    subjectsAssigned,
    isActive,
    permissions,
    forcePasswordChange,
    twoFactorEnabled
  } = req.body;

  try {
    const updateData = {};
    const unsetFields = [];
    if (name !== undefined) updateData.name = name.trim();
    if (email !== undefined) updateData.email = normalizeEmail(email);
    if (employeeId !== undefined) {
      if (employeeId && employeeId.trim()) {
        updateData.employeeId = employeeId.trim().toUpperCase();
      } else {
        unsetFields.push('employeeId');
      }
    }
    if (phone !== undefined) updateData.phone = phone ? phone.trim() : '';
    if (alternatePhone !== undefined) updateData.alternatePhone = alternatePhone ? alternatePhone.trim() : '';
    if (gender !== undefined) updateData.gender = gender;
    if (dob !== undefined) updateData.dob = dob;
    if (address !== undefined) updateData.address = address ? address.trim() : '';
    if (qualification !== undefined) updateData.qualification = qualification ? qualification.trim() : '';
    if (designation !== undefined) updateData.designation = designation ? designation.trim() : '';
    if (department !== undefined) updateData.department = department ? department.trim() : '';
    if (joiningDate !== undefined) updateData.joiningDate = joiningDate;
    if (salary !== undefined) updateData.salary = Number(salary) || 0;
    if (isClassTeacher !== undefined) updateData.isClassTeacher = Boolean(isClassTeacher);
    if (classTeacherOf !== undefined) updateData.classTeacherOf = classTeacherOf ? classTeacherOf.trim() : '';
    if (classesAssigned !== undefined) updateData.classesAssigned = Array.isArray(classesAssigned) ? classesAssigned : [];
    if (sectionsAssigned !== undefined) updateData.sectionsAssigned = Array.isArray(sectionsAssigned) ? sectionsAssigned : [];
    if (subjectsAssigned !== undefined) updateData.subjectsAssigned = Array.isArray(subjectsAssigned) ? subjectsAssigned : [];
    if (isActive !== undefined) updateData.isActive = Boolean(isActive);
    if (permissions !== undefined) updateData.permissions = permissions;
    if (forcePasswordChange !== undefined) updateData.forcePasswordChange = Boolean(forcePasswordChange);
    if (twoFactorEnabled !== undefined) updateData.twoFactorEnabled = Boolean(twoFactorEnabled);

    // Fetch existing target user to check current role
    let existingTargetUser = null;
    if (checkFallback()) {
      existingTargetUser = FallbackDb.findById('users', id);
    } else {
      existingTargetUser = await User.findById(id);
    }

    if (!existingTargetUser) {
      return sendNotFound(res, 'User not found');
    }

    const currentRole = (existingTargetUser.role || '').toLowerCase();

    // RULE: Super Admin (Director) role is permanent and cannot be changed or demoted
    if (currentRole === 'super-admin') {
      if (role !== undefined && role.toLowerCase().trim() !== 'super-admin') {
        return sendForbidden(res, 'The Super Admin (Director) role is permanent and cannot be changed or demoted.');
      }
      if (isActive !== undefined && !Boolean(isActive)) {
        return sendForbidden(res, 'The Super Admin (Director) account cannot be deactivated.');
      }
    }

    // Validate role change
    if (role !== undefined) {
      const cleanRole = role.toLowerCase().trim();

      // Disallow promoting any user to Super Admin (Director)
      if (cleanRole === 'super-admin' || cleanRole === 'superadmin' || cleanRole === 'director') {
        if (currentRole !== 'super-admin') {
          return sendForbidden(res, 'Cannot promote a user to Super Admin (Director). Only 1 Super Admin (Director) is permitted in the institution.');
        }
      }

      if (EXCLUDED_ROLES.includes(cleanRole)) {
        return sendBadRequest(res, 'Cannot assign student or parent role in staff user management');
      }

      // RULE: Strictly 1 Principal allowed in the institution
      if (cleanRole === 'principal' && currentRole !== 'principal') {
        let existingPrincipal = null;
        if (checkFallback()) {
          const allUsers = FallbackDb.find('users') || [];
          existingPrincipal = allUsers.find(
            (u) =>
              (u.role || '').toLowerCase() === 'principal' &&
              String(u.id || u._id) !== String(id) &&
              u.isActive !== false
          );
        } else {
          existingPrincipal = await User.findOne({
            role: 'principal',
            _id: { $ne: id },
            isActive: true
          });
        }

        if (existingPrincipal) {
          return sendBadRequest(
            res,
            `Only 1 Principal is permitted for the institution. ${existingPrincipal.name} is currently assigned as Principal. Please reassign the current Principal first before designating a new one.`
          );
        }
      }

      updateData.role = cleanRole;
    }

    if (checkFallback()) {
      const updated = FallbackDb.update('users', id, updateData);
      if (!updated) {
        return sendNotFound(res, 'User not found');
      }

      unsetFields.forEach((field) => {
        delete updated[field];
      });

      await logActivity({
        userId: req.user.id || req.user._id,
        action: 'UPDATE_USER',
        module: 'user-management',
        details: `Updated user profile/role for ${updated.name || id} (${updated.role})`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      const { password, ...userWithoutPassword } = updated;
      return sendSuccess(res, 'User updated successfully', {
        user: userWithoutPassword
      });
    }

    // MongoDB path
    const user = await User.findById(id);
    if (!user) {
      return sendNotFound(res, 'User not found');
    }

    Object.assign(user, updateData);
    unsetFields.forEach((field) => {
      user[field] = undefined;
    });
    await user.save();

    // Also sync teacher record if one exists
    try {
      await Teacher.findOneAndUpdate(
        { $or: [{ user: user._id }, ...(user.employeeId ? [{ employeeId: user.employeeId }] : [])] },
        {
          name: user.name,
          email: user.email,
          phone: user.phone || '000-000-0000',
          qualification: user.qualification,
          designation: user.designation,
          department: user.department,
          salary: user.salary,
          isClassTeacher: user.isClassTeacher,
          classesAssigned: user.classesAssigned,
          sectionsAssigned: user.sectionsAssigned,
          subjectsAssigned: user.subjectsAssigned,
          status: user.isActive ? 'active' : 'inactive'
        }
      );
    } catch {
      // Non-blocking sync failure
    }

    await logActivity({
      userId: req.user.id || req.user._id,
      action: 'UPDATE_USER',
      module: 'user-management',
      details: `Updated user ${user.name} (${user.username}) with role ${user.role}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    const userObj = user.toObject();
    delete userObj.password;

    return sendSuccess(res, 'User updated successfully', {
      user: userObj
    });
  } catch (error) {
    return sendError(res, error.message || 'Failed to update user', 500, error);
  }
};

/**
 * Toggles a user's active/inactive status.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const toggleUserStatus = async (req, res) => {
  const { id } = req.params;
  const currentUserId = req.user.id || req.user._id;

  // Prevent self-deactivation
  if (String(id) === String(currentUserId) || id === req.user.username) {
    return sendBadRequest(res, 'You cannot deactivate your own administrative account');
  }

  try {
    if (checkFallback()) {
      const user = FallbackDb.findById('users', id);
      if (!user) {
        return sendNotFound(res, 'User not found');
      }

      if ((user.role || '').toLowerCase() === 'super-admin') {
        return sendForbidden(res, 'The Super Admin (Director) account cannot be deactivated.');
      }

      const newStatus = !user.isActive;
      FallbackDb.update('users', id, { isActive: newStatus });

      await logActivity({
        userId: currentUserId,
        action: newStatus ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
        module: 'user-management',
        details: `${newStatus ? 'Activated' : 'Deactivated'} user ${user.name} (${user.username})`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      return sendSuccess(res, `User ${newStatus ? 'activated' : 'deactivated'} successfully`, {
        isActive: newStatus
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return sendNotFound(res, 'User not found');
    }

    if ((user.role || '').toLowerCase() === 'super-admin') {
      return sendForbidden(res, 'The Super Admin (Director) account cannot be deactivated.');
    }

    user.isActive = !user.isActive;
    await user.save();

    await logActivity({
      userId: currentUserId,
      action: user.isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
      module: 'user-management',
      details: `${user.isActive ? 'Activated' : 'Deactivated'} user ${user.name} (${user.username})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    return sendSuccess(res, `User ${user.isActive ? 'activated' : 'deactivated'} successfully`, {
      isActive: user.isActive
    });
  } catch (error) {
    return sendError(res, 'Failed to update user status', 500, error);
  }
};

/**
 * Resets a user's password and optionally forces password change on next login.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const resetUserPassword = async (req, res) => {
  const { id } = req.params;
  const { newPassword, forcePasswordChange = true } = req.body;

  if (!newPassword || newPassword.length < 4) {
    return sendBadRequest(res, 'Password must be at least 4 characters long');
  }

  try {
    if (checkFallback()) {
      const user = FallbackDb.findById('users', id);
      if (!user) {
        return sendNotFound(res, 'User not found');
      }

      FallbackDb.update('users', id, {
        password: newPassword,
        tempPassword: newPassword,
        forcePasswordChange: Boolean(forcePasswordChange)
      });

      await logActivity({
        userId: req.user.id || req.user._id,
        action: 'RESET_PASSWORD',
        module: 'user-management',
        details: `Reset password for user ${user.name} (${user.username})`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      return sendSuccess(res, `Password reset successfully for ${user.name}`);
    }

    const user = await User.findById(id);
    if (!user) {
      return sendNotFound(res, 'User not found');
    }

    user.password = newPassword;
    user.forcePasswordChange = Boolean(forcePasswordChange);
    await user.save();

    await logActivity({
      userId: req.user.id || req.user._id,
      action: 'RESET_PASSWORD',
      module: 'user-management',
      details: `Reset password for user ${user.name} (${user.username})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    return sendSuccess(res, `Password reset successfully for ${user.name}`);
  } catch (error) {
    return sendError(res, 'Failed to reset password', 500, error);
  }
};

/**
 * Deletes a user account.
 * Super Admin account cannot be deleted; users cannot delete themselves.
 *
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @returns {Promise<void>}
 */
export const deleteUser = async (req, res) => {
  const { id } = req.params;
  const currentUserId = req.user.id || req.user._id;

  // Prevent self-deletion
  if (String(id) === String(currentUserId) || id === req.user.username) {
    return sendBadRequest(res, 'You cannot delete your own administrative account');
  }

  try {
    if (checkFallback()) {
      const user = FallbackDb.findById('users', id);
      if (!user) {
        return sendNotFound(res, 'User not found');
      }

      if ((user.role || '').toLowerCase() === 'super-admin') {
        return sendForbidden(res, 'The Super Admin (Director) account is permanent and cannot be deleted.');
      }

      FallbackDb.delete('users', id);

      await logActivity({
        userId: currentUserId,
        action: 'DELETE_USER',
        module: 'user-management',
        details: `Deleted user ${user.name} (${user.username})`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      return sendSuccess(res, `User ${user.name} deleted successfully`);
    }

    const user = await User.findById(id);
    if (!user) {
      return sendNotFound(res, 'User not found');
    }

    if ((user.role || '').toLowerCase() === 'super-admin') {
      return sendForbidden(res, 'The Super Admin (Director) account is permanent and cannot be deleted.');
    }

    await User.findByIdAndDelete(id);

    await logActivity({
      userId: currentUserId,
      action: 'DELETE_USER',
      module: 'user-management',
      details: `Deleted user ${user.name} (${user.username})`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    return sendSuccess(res, `User ${user.name} deleted successfully`);
  } catch (error) {
    return sendError(res, 'Failed to delete user', 500, error);
  }
};
