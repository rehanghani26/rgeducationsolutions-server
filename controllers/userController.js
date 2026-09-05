import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';
import { logActivity } from '../utils/activityLogger.js';

// Standard System Company/Staff Roles Definition (Excludes students and parents)
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
 * @desc Get all company roles with live user counts (excludes students/parents)
 * @route GET /api/v1/users/roles
 * @access Private (Admin only)
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

    return res.json({
      success: true,
      roles: rolesWithCounts
    });
  } catch (error) {
    console.error('getRoles error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve roles' });
  }
};

/**
 * @desc Get company users (strictly excludes students)
 * @route GET /api/v1/users
 * @access Private (Admin only)
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
      const startIndex = (parseInt(page) - 1) * parseInt(limit);
      const paginatedUsers = users.slice(startIndex, startIndex + parseInt(limit)).map((u) => {
        const { password, ...userWithoutPassword } = u;
        return userWithoutPassword;
      });

      // Role summary breakdown
      const roleStats = {};
      users.forEach((u) => {
        const r = (u.role || 'other').toLowerCase();
        roleStats[r] = (roleStats[r] || 0) + 1;
      });

      return res.json({
        success: true,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
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

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [users, total, roleCounts] = await Promise.all([
      User.find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
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

    return res.json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      users,
      roleStats
    });
  } catch (error) {
    console.error('getUsers error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve users' });
  }
};

/**
 * @desc Get user details by ID including personal details and academic assignments
 * @route GET /api/v1/users/:id
 * @access Private (Admin only)
 */
export const getUserById = async (req, res) => {
  const { id } = req.params;

  try {
    let user = null;

    if (checkFallback()) {
      user = FallbackDb.findById('users', id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // Check if linked to teacher
      const teacher = FallbackDb.find('teachers')?.find(t => t.user === id || t.id === user.profileId);
      const { password, ...userWithoutPassword } = user;

      return res.json({
        success: true,
        user: {
          ...userWithoutPassword,
          teacherProfile: teacher || null
        }
      });
    }

    if (mongoose.Types.ObjectId.isValid(id)) {
      user = await User.findById(id).select('-password');
    }
    if (!user) {
      user = await User.findOne({ $or: [{ username: id }, { employeeId: id }] }).select('-password');
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
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
    } catch (e) {
      // ignore
    }

    return res.json({
      success: true,
      user: {
        ...user.toObject(),
        teacherProfile
      }
    });
  } catch (error) {
    console.error('getUserById error:', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve user' });
  }
};

/**
 * @desc Create new user (Super Admin creation is forbidden; only admin, director, principal, teacher, peon, etc.)
 * @route POST /api/v1/users
 * @access Private (Admin only)
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
    return res.status(400).json({
      success: false,
      message: 'Name, username, email, password, and role are required'
    });
  }

  const cleanRole = role.toLowerCase().trim();

  // RULE: Cannot create Super Admin from User Management
  if (cleanRole === 'super-admin' || cleanRole === 'superadmin' || cleanRole === 'director') {
    return res.status(403).json({
      success: false,
      message: 'Creation of Super Admin (Director) accounts is not permitted. Only 1 Super Admin (Director) exists in the institution.'
    });
  }

  // RULE: Cannot create student or parent from User Management
  if (EXCLUDED_ROLES.includes(cleanRole)) {
    return res.status(400).json({
      success: false,
      message: 'Student and Parent accounts cannot be created in User Management. Please use Student Admissions.'
    });
  }

  const allowedRoles = SYSTEM_ROLES.filter(r => r.canCreate).map(r => r.id);
  if (!allowedRoles.includes(cleanRole)) {
    return res.status(400).json({
      success: false,
      message: `Invalid role '${role}'. Allowed roles are: ${allowedRoles.join(', ')}`
    });
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
      return res.status(400).json({
        success: false,
        message: `Only 1 Principal is permitted for the institution. ${existingPrincipal.name} is currently assigned as Principal. Please reassign the current Principal first.`
      });
    }
  }

  try {
    if (checkFallback()) {
      const existingUser = FallbackDb.findOne('users', { username: username.toLowerCase().trim() }) ||
                           FallbackDb.findOne('users', { email: email.toLowerCase().trim() });
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'A user with this username or email already exists'
        });
      }

      const newUser = FallbackDb.create('users', {
        name: name.trim(),
        username: username.toLowerCase().trim(),
        email: email.toLowerCase().trim(),
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
      return res.status(201).json({
        success: true,
        message: `User created successfully as ${cleanRole}`,
        user: userWithoutPassword
      });
    }

    // MongoDB path
    const existing = await User.findOne({
      $or: [
        { username: username.toLowerCase().trim() },
        { email: email.toLowerCase().trim() },
        ...(employeeId ? [{ employeeId: employeeId.trim().toUpperCase() }] : [])
      ]
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'A user with this username, email, or employee ID already exists'
      });
    }

    const userPayload = {
      name: name.trim(),
      username: username.toLowerCase().trim(),
      email: email.toLowerCase().trim(),
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
          email: email.toLowerCase().trim(),
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

    return res.status(201).json({
      success: true,
      message: `User created successfully as ${cleanRole}`,
      user: userObj
    });
  } catch (error) {
    console.error('createUser error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to create user' });
  }
};

/**
 * @desc Update user details, role (promote to Director, Principal, Teacher, Peon, etc.), and manage class teacher duties
 * @route PUT /api/v1/users/:id
 * @access Private (Admin only)
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
    if (email !== undefined) updateData.email = email.toLowerCase().trim();
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
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const currentRole = (existingTargetUser.role || '').toLowerCase();

    // RULE: Super Admin (Director) role is permanent and cannot be changed or demoted
    if (currentRole === 'super-admin') {
      if (role !== undefined && role.toLowerCase().trim() !== 'super-admin') {
        return res.status(403).json({
          success: false,
          message: 'The Super Admin (Director) role is permanent and cannot be changed or demoted.'
        });
      }
      if (isActive !== undefined && !Boolean(isActive)) {
        return res.status(403).json({
          success: false,
          message: 'The Super Admin (Director) account cannot be deactivated.'
        });
      }
    }

    // Validate role change
    if (role !== undefined) {
      const cleanRole = role.toLowerCase().trim();

      // Disallow promoting any user to Super Admin (Director)
      if (cleanRole === 'super-admin' || cleanRole === 'superadmin' || cleanRole === 'director') {
        if (currentRole !== 'super-admin') {
          return res.status(403).json({
            success: false,
            message: 'Cannot promote a user to Super Admin (Director). Only 1 Super Admin (Director) is permitted in the institution.'
          });
        }
      }

      if (EXCLUDED_ROLES.includes(cleanRole)) {
        return res.status(400).json({
          success: false,
          message: 'Cannot assign student or parent role in staff user management'
        });
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
          return res.status(400).json({
            success: false,
            message: `Only 1 Principal is permitted for the institution. ${existingPrincipal.name} is currently assigned as Principal. Please reassign the current Principal first before designating a new one.`
          });
        }
      }

      updateData.role = cleanRole;
    }

    if (checkFallback()) {
      const updated = FallbackDb.update('users', id, updateData);
      if (!updated) {
        return res.status(404).json({ success: false, message: 'User not found' });
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
      return res.json({
        success: true,
        message: 'User updated successfully',
        user: userWithoutPassword
      });
    }

    // MongoDB path
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
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
    } catch (e) {
      // non-blocking
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

    return res.json({
      success: true,
      message: 'User updated successfully',
      user: userObj
    });
  } catch (error) {
    console.error('updateUser error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to update user' });
  }
};

/**
 * @desc Toggle user active/inactive status
 * @route PATCH /api/v1/users/:id/status
 * @access Private (Admin only)
 */
export const toggleUserStatus = async (req, res) => {
  const { id } = req.params;
  const currentUserId = req.user.id || req.user._id;

  // Prevent self-deactivation
  if (String(id) === String(currentUserId) || id === req.user.username) {
    return res.status(400).json({
      success: false,
      message: 'You cannot deactivate your own administrative account'
    });
  }

  try {
    if (checkFallback()) {
      const user = FallbackDb.findById('users', id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      if ((user.role || '').toLowerCase() === 'super-admin') {
        return res.status(403).json({
          success: false,
          message: 'The Super Admin (Director) account cannot be deactivated.'
        });
      }

      const newStatus = !user.isActive;
      const updated = FallbackDb.update('users', id, { isActive: newStatus });

      await logActivity({
        userId: currentUserId,
        action: newStatus ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
        module: 'user-management',
        details: `${newStatus ? 'Activated' : 'Deactivated'} user ${user.name} (${user.username})`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });

      return res.json({
        success: true,
        message: `User ${newStatus ? 'activated' : 'deactivated'} successfully`,
        isActive: newStatus
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if ((user.role || '').toLowerCase() === 'super-admin') {
      return res.status(403).json({
        success: false,
        message: 'The Super Admin (Director) account cannot be deactivated.'
      });
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

    return res.json({
      success: true,
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      isActive: user.isActive
    });
  } catch (error) {
    console.error('toggleUserStatus error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update user status' });
  }
};

/**
 * @desc Reset user password
 * @route PATCH /api/v1/users/:id/reset-password
 * @access Private (Admin only)
 */
export const resetUserPassword = async (req, res) => {
  const { id } = req.params;
  const { newPassword, forcePasswordChange = true } = req.body;

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({
      success: false,
      message: 'Password must be at least 4 characters long'
    });
  }

  try {
    if (checkFallback()) {
      const user = FallbackDb.findById('users', id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
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

      return res.json({
        success: true,
        message: `Password reset successfully for ${user.name}`
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
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

    return res.json({
      success: true,
      message: `Password reset successfully for ${user.name}`
    });
  } catch (error) {
    console.error('resetUserPassword error:', error);
    return res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
};

/**
 * @desc Delete user
 * @route DELETE /api/v1/users/:id
 * @access Private (Admin only)
 */
export const deleteUser = async (req, res) => {
  const { id } = req.params;
  const currentUserId = req.user.id || req.user._id;

  // Prevent self-deletion
  if (String(id) === String(currentUserId) || id === req.user.username) {
    return res.status(400).json({
      success: false,
      message: 'You cannot delete your own administrative account'
    });
  }

  try {
    if (checkFallback()) {
      const user = FallbackDb.findById('users', id);
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      if ((user.role || '').toLowerCase() === 'super-admin') {
        return res.status(403).json({
          success: false,
          message: 'The Super Admin (Director) account is permanent and cannot be deleted.'
        });
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

      return res.json({
        success: true,
        message: `User ${user.name} deleted successfully`
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if ((user.role || '').toLowerCase() === 'super-admin') {
      return res.status(403).json({
        success: false,
        message: 'The Super Admin (Director) account is permanent and cannot be deleted.'
      });
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

    return res.json({
      success: true,
      message: `User ${user.name} deleted successfully`
    });
  } catch (error) {
    console.error('deleteUser error:', error);
    return res.status(500).json({ success: false, message: 'Failed to delete user' });
  }
};
