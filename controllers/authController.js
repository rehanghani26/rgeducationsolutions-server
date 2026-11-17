// 3. Configuration
import { checkFallback } from '../config/db.js';
import { resolveFileUrl } from '../config/s3.js';

// 4. Models
import Otp from '../models/Otp.js';
import Setting from '../models/Setting.js';
import Student from '../models/Student.js';
import User from '../models/User.js';
import School from '../models/School.js';

// 5. Middleware
import { generateTokens } from '../middleware/auth.js';

// 6. Services
import { FallbackDb } from '../services/dbFallback.js';
import { sendOtpEmail } from '../services/emailService.js';

// 7. Utilities
import { logActivity } from '../utils/activityLogger.js';
import { normalizeEmail } from '../utils/commonUtil.js';
import {
  sendBadRequest,
  sendCreated,
  sendError,
  sendForbidden,
  sendSuccess,
  sendUnauthorized,
} from '../utils/responseUtil.js';

/**
 * @file authController.js
 * @description Authentication controller for login, signup, token rotation, and super admin OTP onboarding.
 */

// Configurable brute force / account lockout security settings (adjustable)
export const MAX_LOGIN_ATTEMPTS = 3;
export const LOCKOUT_DURATION_MS = 60 * 60 * 1000; // 1 hour

/**
 * Authenticates user credentials and generates access/refresh JWT tokens.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return sendBadRequest(res, 'Please provide email/username and password');
  }

  try {
    let user = null;
    let schoolInfo = null;

    const cleanInput = username.toLowerCase().trim();
    const cleanUpper = username.trim().toUpperCase();

    // 1. Explicitly block parent logins (parents cannot log in to the system)
    if (cleanInput.startsWith('par_') || cleanInput.includes('@parent.') || req.body.role === 'parent') {
      return sendForbidden(res, 'Parent login is not enabled in this system.');
    }

    if (checkFallback()) {
      // Authenticate directly against Student collection for student logins
      let student =
        FallbackDb.findOne('students', { email: cleanInput }) ||
        FallbackDb.findOne('students', { admissionNumber: cleanUpper }) ||
        FallbackDb.findOne('students', { admissionNumber: cleanInput });

      if (student) {
        user = student;
        user.role = 'student';
        user.username = (user.admissionNumber || cleanInput).toLowerCase();
      } else {
        // Staff/Admin/Teacher user lookup
        user =
          FallbackDb.findOne('users', { username: cleanInput }) ||
          FallbackDb.findOne('users', { email: cleanInput }) ||
          FallbackDb.findOne('users', { employeeId: cleanUpper });

        if (user && (user.role === 'student' || user.role === 'parent')) {
          if (user.role === 'parent') {
            return sendForbidden(res, 'Parent login is not enabled in this system.');
          }
          FallbackDb.delete('users', user.id || user._id);
          user = null;
        }
      }

      if (!user) {
        return sendUnauthorized(res, 'Invalid credentials');
      }

      // Check if account is temporarily locked (1 hour window)
      if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
        const remainingMinutes = Math.max(
          1,
          Math.ceil((new Date(user.lockUntil).getTime() - Date.now()) / (60 * 1000))
        );
        return res.status(429).json({
          success: false,
          isLocked: true,
          remainingMinutes,
          message: `Account is temporarily locked due to ${MAX_LOGIN_ATTEMPTS} failed login attempts. Please try again in ${remainingMinutes} minute(s).`,
        });
      }

      // Reset expired lockout
      if (user.lockUntil && new Date(user.lockUntil) <= new Date()) {
        user.failedLoginAttempts = 0;
        user.lockUntil = null;
      }

      // Strict credential comparison (no hardcoded credentials)
      const isMatch =
        password === user.password ||
        (user.tempPassword && password === user.tempPassword);

      const targetCollection = user.role === 'student' ? 'students' : 'users';

      if (!isMatch) {
        const attempts = (Number(user.failedLoginAttempts) || 0) + 1;
        user.failedLoginAttempts = attempts;

        if (attempts >= MAX_LOGIN_ATTEMPTS) {
          user.lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
          FallbackDb.update(targetCollection, user.id || user._id, {
            failedLoginAttempts: attempts,
            lockUntil: user.lockUntil,
          });

          return res.status(429).json({
            success: false,
            isLocked: true,
            remainingMinutes: 60,
            message: `Account has been locked for 1 hour due to ${MAX_LOGIN_ATTEMPTS} consecutive failed login attempts.`,
          });
        }

        FallbackDb.update(targetCollection, user.id || user._id, {
          failedLoginAttempts: attempts,
        });
        const remainingAttempts = MAX_LOGIN_ATTEMPTS - attempts;

        return res.status(401).json({
          success: false,
          remainingAttempts,
          message: `Invalid credentials. You have ${remainingAttempts} attempt(s) remaining before account lockout.`,
        });
      }

      // Successful password match: reset failed attempts
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      FallbackDb.update(targetCollection, user.id || user._id, {
        failedLoginAttempts: 0,
        lockUntil: null,
      });

      if (user.role === 'student') {
        const legacyUser = FallbackDb.findOne('users', { email: cleanInput });
        if (legacyUser && (legacyUser.role === 'student' || legacyUser.role === 'parent')) {
          FallbackDb.delete('users', legacyUser.id || legacyUser._id);
        }
      }
    } else {
      // MongoDB Mode

      // Check if legacy User record exists with role 'parent' and reject/purge
      const parentUser = await User.findOne({
        role: 'parent',
        $or: [
          { username: cleanInput },
          { email: cleanInput },
        ],
      }).setOptions({ skipTenantFilter: true });

      if (parentUser) {
        await User.deleteOne({ _id: parentUser._id }).catch(() => null);
        return sendForbidden(res, 'Parent login is not enabled in this system.');
      }

      // 1. Authenticate directly from Student collection for students
      let student = await Student.findOne({
        $or: [
          { admissionNumber: cleanUpper },
          { admissionNumber: cleanInput },
          { email: cleanInput },
          { contactNumber: cleanInput },
        ],
      }).setOptions({ skipTenantFilter: true });

      if (student) {
        user = student;
        user.role = 'student';
        user.username = (user.admissionNumber || cleanInput).toLowerCase();
      } else {
        // 2. Staff/Admin/Teacher user lookup (strictly excluding student & parent roles)
        user = await User.findOne({
          role: { $nin: ['student', 'parent'] },
          $or: [
            { username: cleanInput },
            { email: cleanInput },
            { employeeId: cleanUpper },
          ],
        }).setOptions({ skipTenantFilter: true });
      }

      if (!user) {
        return sendUnauthorized(res, 'Invalid credentials');
      }

      // Check if account is temporarily locked (1 hour window)
      if (user.lockUntil && new Date(user.lockUntil) > new Date()) {
        const remainingMinutes = Math.max(
          1,
          Math.ceil((new Date(user.lockUntil).getTime() - Date.now()) / (60 * 1000))
        );
        return res.status(429).json({
          success: false,
          isLocked: true,
          remainingMinutes,
          message: `Account is temporarily locked due to ${MAX_LOGIN_ATTEMPTS} failed login attempts. Please try again in ${remainingMinutes} minute(s).`,
        });
      }

      // Reset expired lockout
      if (user.lockUntil && new Date(user.lockUntil) <= new Date()) {
        user.failedLoginAttempts = 0;
        user.lockUntil = null;
      }

      // Strict credential comparison (no backdoor or hardcoded credentials)
      const isMatch = await user.comparePassword(password);

      if (!isMatch) {
        const attempts = (Number(user.failedLoginAttempts) || 0) + 1;
        user.failedLoginAttempts = attempts;

        if (attempts >= MAX_LOGIN_ATTEMPTS) {
          user.lockUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
          await user.save().catch(() => null);

          return res.status(429).json({
            success: false,
            isLocked: true,
            remainingMinutes: 60,
            message: `Account has been locked for 1 hour due to ${MAX_LOGIN_ATTEMPTS} consecutive failed login attempts.`,
          });
        }

        await user.save().catch(() => null);
        const remainingAttempts = MAX_LOGIN_ATTEMPTS - attempts;

        return res.status(401).json({
          success: false,
          remainingAttempts,
          message: `Invalid credentials. You have ${remainingAttempts} attempt(s) remaining before account lockout.`,
        });
      }

      // Successful password match: reset failed attempts
      user.failedLoginAttempts = 0;
      user.lockUntil = null;

      // Clean up any legacy student or parent user records from User collection to prevent conflicts
      if (user.role === 'student') {
        await User.deleteMany({
          $or: [
            { email: cleanInput },
            { admissionNumber: cleanUpper },
            { role: { $in: ['student', 'parent'] } },
            { profileId: user._id },
          ],
        }).catch(() => null);
      }
    }

    if (user.isActive === false || user.status === 'inactive') {
      return sendForbidden(
        res,
        'Your account has been deactivated by the administrator. You cannot log in or access the system.'
      );
    }

    // Load user's school metadata
    if (user.schoolId) {
      req.schoolId = user.schoolId;
      const school = await School.findOne({
        $or: [{ _id: user.schoolId }, { schoolId: user.schoolId }],
      }).lean();

      if (school) {
        // Enforce school suspension check on login
        if (school.status === 'suspended' || school.status === 'SUSPENDED') {
          return res.status(403).json({
            success: false,
            status: 'suspended',
            schoolStatus: 'suspended',
            schoolId: school.schoolId || school._id,
            schoolName: school.schoolName,
            message: `Access to '${school.schoolName}' has been suspended. Please contact RGES Support.`,
          });
        }

        schoolInfo = {
          schoolId: school.schoolId || school._id,
          schoolName: school.schoolName,
          schoolCode: school.schoolCode,
          schoolLogo: school.schoolLogo || '',
          schoolMotto: school.schoolMotto || '',
          status: school.status || 'active',
        };
      }
    }

    if (user.accountExpiryDate && new Date(user.accountExpiryDate) < new Date()) {
      if (user.role === 'student') {
        user.accountExpiryDate = null;
        if (!checkFallback() && user.save) {
          user.save().catch(() => null);
        }
      } else {
        return sendForbidden(res, 'Account has expired');
      }
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user, schoolInfo);

    const loginEntry = {
      ip: req.ip || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent'],
      timestamp: new Date(),
    };

    // Save refresh token and login history
    if (checkFallback()) {
      const history = [...(user.loginHistory || []), loginEntry].slice(-20);
      if (user.role === 'student') {
        FallbackDb.update('students', user.id || user._id, {
          refreshToken,
          lastLogin: loginEntry.timestamp,
          loginHistory: history,
        });
      } else {
        FallbackDb.update('users', user.id || user._id, {
          refreshToken,
          lastLogin: loginEntry.timestamp,
          loginHistory: history,
        });
      }
    } else {
      user.refreshToken = refreshToken;
      user.lastLogin = loginEntry.timestamp;
      user.loginHistory = [...(user.loginHistory || []), loginEntry].slice(-20);
      await user.save();
    }

    await logActivity({
      schoolId: user.schoolId,
      userId: user.id || user._id,
      action: 'LOGIN',
      module: 'auth',
      details: `User ${user.name} logged in`,
      ipAddress: loginEntry.ip,
      userAgent: loginEntry.userAgent,
    });

    // Set secure HTTP-only refresh cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    let resolvedAvatar = user.avatar || user.photo || user.imagesRef?.img || '';
    let resolvedImagesRef = user.imagesRef || { id: '', img: resolvedAvatar };

    if (!resolvedAvatar && user.role === 'student') {
      try {
        let studentRecord = null;
        if (checkFallback()) {
          studentRecord =
            FallbackDb.findOne('students', { email: user.email }) ||
            FallbackDb.findOne('students', { admissionNumber: user.admissionNumber });
        } else {
          studentRecord = await Student.findOne({
            $or: [
              { user: user._id },
              { email: user.email },
              { admissionNumber: user.admissionNumber },
            ],
          });
        }
        if (studentRecord) {
          resolvedAvatar = studentRecord.photo || studentRecord.imagesRef?.img || '';
          resolvedImagesRef = studentRecord.imagesRef || { id: '', img: resolvedAvatar };
        }
      } catch (e) {
        console.warn('Student photo lookup error during login:', e);
      }
    }

    if (resolvedAvatar) {
      try {
        resolvedAvatar = await resolveFileUrl(resolvedAvatar, 3600);
      } catch (err) {
        console.warn('resolveFileUrl failed for avatar:', err);
      }
    }
    if (resolvedImagesRef?.img) {
      try {
        resolvedImagesRef.img = await resolveFileUrl(resolvedImagesRef.img, 3600);
      } catch (err) {
        console.warn('resolveFileUrl failed for imagesRef.img:', err);
      }
    }

    return sendSuccess(res, 'Login successful', null, 200, {
      schoolId: user.schoolId || schoolInfo?.schoolId,
      accessToken,
      school: schoolInfo,
      user: {
        id: user.id || user._id,
        username: user.username || (user.admissionNumber ? String(user.admissionNumber).toLowerCase() : undefined),
        employeeId: user.employeeId,
        admissionNumber: user.admissionNumber,
        email: user.email,
        role: user.role || 'student',
        name: user.name,
        avatar: resolvedAvatar,
        photo: resolvedAvatar,
        imagesRef: resolvedImagesRef,
        profileId: user.profileId || (user.role === 'student' ? (user._id || user.id) : undefined),
        forcePasswordChange: user.forcePasswordChange || false,
        twoFactorEnabled: user.twoFactorEnabled || false,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return sendError(res, 'Server error during login', 500);
  }
};

/**
 * Logs out the user by clearing the refreshToken cookie and database record.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const logout = async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (refreshToken) {
    if (checkFallback()) {
      const user =
        FallbackDb.findOne('users', { refreshToken }) ||
        FallbackDb.findOne('students', { refreshToken });
      if (user) {
        if (user.role === 'student') {
          FallbackDb.update('students', user.id, { refreshToken: null });
        } else {
          FallbackDb.update('users', user.id, { refreshToken: null });
        }
      }
    } else {
      try {
        let user = await User.findOne({ refreshToken });
        if (!user) {
          user = await Student.findOne({ refreshToken });
        }
        if (user) {
          user.refreshToken = null;
          await user.save();
        }
      } catch (error) {
        console.error('Error clearing refresh token:', error);
      }
    }
  }

  res.clearCookie('refreshToken');
  return sendSuccess(res, 'Logged out successfully');
};

/**
 * Rotates access token using a valid refreshToken.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const refresh = async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    return sendUnauthorized(res, 'Refresh token missing');
  }

  try {
    let user = null;

    if (checkFallback()) {
      user =
        FallbackDb.findOne('users', { refreshToken }) ||
        FallbackDb.findOne('students', { refreshToken });
      if (!user) {
        return sendUnauthorized(res, 'Invalid refresh token');
      }
    } else {
      user = await User.findOne({ refreshToken });
      if (!user) {
        user = await Student.findOne({ refreshToken });
        if (user) {
          user.role = 'student';
          user.username = user.admissionNumber?.toLowerCase();
        }
      }
      if (!user) {
        return sendUnauthorized(res, 'Invalid refresh token');
      }
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    if (checkFallback()) {
      if (user.role === 'student') {
        FallbackDb.update('students', user.id, { refreshToken: newRefreshToken });
      } else {
        FallbackDb.update('users', user.id, { refreshToken: newRefreshToken });
      }
    } else {
      user.refreshToken = newRefreshToken;
      await user.save();
    }

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      success: true,
      accessToken,
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    return sendUnauthorized(res, 'Session expired, please login again');
  }
};

/**
 * Returns currently authenticated user context.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getMe = async (req, res) => {
  if (!req.user) {
    return sendUnauthorized(res, 'User context missing');
  }

  let schoolInfo = null;
  const schoolId = req.user?.schoolId || req.schoolId;

  if (schoolId) {
    try {
      const school = await School.findOne({
        $or: [{ _id: schoolId }, { schoolId }],
      }).lean();

      if (school) {
        schoolInfo = {
          schoolId: school.schoolId || school._id,
          schoolName: school.schoolName,
          schoolCode: school.schoolCode,
          schoolLogo: school.schoolLogo || '',
          schoolMotto: school.schoolMotto || '',
          contactEmail: school.contactEmail || '',
          schoolPhone: school.schoolPhone || '',
          address: school.address || {},
          board: school.board || 'CBSE',
          status: school.status || 'active',
        };
      }
    } catch (_err) {
      // ignore
    }
  }

  return sendSuccess(res, undefined, null, 200, {
    user: {
      id: req.user.id || req.user._id,
      username: req.user.username,
      employeeId: req.user.employeeId,
      admissionNumber: req.user.admissionNumber,
      email: req.user.email,
      role: req.user.role || 'student',
      name: req.user.name,
      avatar: req.user.avatar || req.user.photo || req.user.imagesRef?.img || '',
      photo: req.user.photo || req.user.avatar || req.user.imagesRef?.img || '',
      imagesRef: req.user.imagesRef || {
        id: '',
        img: req.user.avatar || req.user.photo || '',
      },
      profileId: req.user.profileId || (req.user.role === 'student' ? (req.user.id || req.user._id) : undefined),
      forcePasswordChange: req.user.forcePasswordChange || false,
      twoFactorEnabled: req.user.twoFactorEnabled || false,
    },
    school: schoolInfo,
  });
};

/**
 * Super Admin registration and initial institution profile setup.
 * Disabled for public access: institutional onboarding is exclusively via RGES Admin Portal.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const signup = async (req, res) => {
  return sendForbidden(
    res,
    'Public registration is disabled. Institutional onboarding is managed exclusively via the RGES Super Admin Portal.'
  );
};

/**
 * Checks whether the platform requires initial Super Admin onboarding.
 * In multi-tenant RGES, onboarding is strictly managed via Admin Portal.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const getSetupStatus = async (req, res) => {
  return sendSuccess(res, undefined, null, 200, {
    hasUsers: true,
    exists: true,
    isSetupRequired: false,
    registrationMode: 'admin-portal',
    message: 'Institutional onboarding is managed exclusively via RGES Super Admin Portal.',
  });
};

/**
 * Setup OTP endpoint is disabled.
 * Institutional onboarding is managed via Admin Portal.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const sendSetupOtp = async (req, res) => {
  return sendForbidden(
    res,
    'Public registration is disabled. Institutional onboarding is managed exclusively via the RGES Super Admin Portal.'
  );
};

/**
 * OTP Verification endpoint is disabled.
 * Institutional onboarding is managed via Admin Portal.
 *
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 */
export const verifySetupOtp = async (req, res) => {
  return sendForbidden(
    res,
    'Public registration is disabled. Institutional onboarding is managed exclusively via the RGES Super Admin Portal.'
  );
};

/**
 * Public endpoint to verify school status and metadata prior to user login.
 * Resolves school by identifier (email, username, admissionNumber, employeeId, or direct schoolId/code).
 *
 * @route GET /api/v1/auth/school-check
 * @route POST /api/v1/auth/school-check
 */
export const checkSchoolStatus = async (req, res) => {
  try {
    const rawIdentifier =
      req.query.identifier ||
      req.body?.identifier ||
      req.query.schoolId ||
      req.body?.schoolId ||
      '';

    if (!rawIdentifier || !String(rawIdentifier).trim()) {
      return sendBadRequest(res, 'Identifier is required to verify school status');
    }

    const cleanInput = String(rawIdentifier).trim().toLowerCase();
    const cleanUpper = String(rawIdentifier).trim().toUpperCase();

    // 1. Direct school lookup (by schoolId, _id, schoolCode, or collectionName)
    let school = await School.findOne({
      $or: [
        { schoolId: cleanUpper },
        { _id: cleanUpper },
        { schoolCode: cleanUpper },
        { collectionName: cleanInput },
        { schoolId: cleanInput },
      ],
    }).lean();

    // 2. If not found by direct school code, look up student or staff user
    if (!school) {
      let schoolId = null;

      // Check Student collection first
      const student = await Student.findOne({
        $or: [
          { email: cleanInput },
          { admissionNumber: cleanUpper },
          { admissionNumber: cleanInput },
          { contactNumber: cleanInput },
        ],
      })
        .setOptions({ skipTenantFilter: true })
        .lean();

      if (student && student.schoolId) {
        schoolId = student.schoolId;
      } else {
        const user = await User.findOne({
          role: { $nin: ['student', 'parent'] },
          $or: [
            { email: cleanInput },
            { username: cleanInput },
            { employeeId: cleanUpper },
          ],
        })
          .setOptions({ skipTenantFilter: true })
          .lean();

        if (user && user.schoolId) {
          schoolId = user.schoolId;
        }
      }

      if (schoolId) {
        school = await School.findOne({
          $or: [{ _id: schoolId }, { schoolId }],
        }).lean();
      }
    }

    if (!school) {
      return res.status(200).json({
        success: true,
        status: 'unknown',
        schoolStatus: 'unknown',
        message: 'No school associated with this identifier yet.',
      });
    }

    const schoolId = school.schoolId || school._id;
    const isSuspended =
      school.status === 'suspended' || school.status === 'SUSPENDED';

    if (isSuspended) {
      return res.status(403).json({
        success: false,
        status: 'suspended',
        schoolStatus: 'suspended',
        schoolId,
        schoolName: school.schoolName,
        schoolCode: school.schoolCode,
        schoolLogo: school.schoolLogo || '',
        message: `Access to '${school.schoolName}' has been suspended. Please contact RGES Support.`,
      });
    }

    return res.status(200).json({
      success: true,
      status: 'active',
      schoolStatus: 'active',
      schoolId,
      school: {
        schoolId,
        schoolName: school.schoolName,
        schoolCode: school.schoolCode,
        schoolLogo: school.schoolLogo || '',
        schoolMotto: school.schoolMotto || '',
        contactEmail: school.contactEmail || '',
        schoolPhone: school.schoolPhone || '',
        status: 'active',
      },
    });
  } catch (error) {
    console.error('checkSchoolStatus error:', error);
    return sendError(res, 'Failed to verify school status', 500);
  }
};

/**
 * Public endpoint to handle forgotten password reset requests for students and staff.
 * (Parents cannot log in; parent accounts are disabled).
 *
 * @route POST /api/v1/auth/forgot-password
 * @access Public
 */
export const forgotPassword = async (req, res) => {
  try {
    const { identifier, newPassword } = req.body;
    if (!identifier || !String(identifier).trim()) {
      return sendBadRequest(
        res,
        'Please provide your registered Email, Username, or Admission Number'
      );
    }

    if (!newPassword || newPassword.length < 6) {
      return sendBadRequest(
        res,
        'New password must be at least 6 characters long'
      );
    }

    const cleanInput = String(identifier).trim().toLowerCase();
    const cleanUpper = String(identifier).trim().toUpperCase();

    // Check student collection first
    const student = await Student.findOne({
      $or: [
        { email: cleanInput },
        { admissionNumber: cleanUpper },
        { admissionNumber: cleanInput },
      ],
    }).setOptions({ skipTenantFilter: true });

    if (student) {
      student.password = newPassword;
      student.tempPassword = newPassword;
      student.forcePasswordChange = false;
      student.failedLoginAttempts = 0;
      student.lockUntil = null;
      await student.save();

      // Purge any legacy User record with this student email/admission number so users collection remains clean
      await User.deleteMany({
        $or: [
          { email: cleanInput },
          { admissionNumber: cleanUpper },
          { role: { $in: ['student', 'parent'] } },
          { profileId: student._id },
        ],
      }).catch(() => null);

      return sendSuccess(
        res,
        'Password reset successfully. You can now sign in with your new password.',
        null,
        200,
        {
          schoolId: student.schoolId,
          user: {
            username: (student.admissionNumber || cleanInput).toLowerCase(),
            email: student.email,
            admissionNumber: student.admissionNumber,
            name: student.name,
          },
        }
      );
    }

    // Check staff user collection (strictly excluding student & parent)
    const user = await User.findOne({
      role: { $nin: ['student', 'parent'] },
      $or: [
        { email: cleanInput },
        { username: cleanInput },
        { employeeId: cleanUpper },
      ],
    }).setOptions({ skipTenantFilter: true });

    if (!user) {
      return sendNotFound(
        res,
        'No account found matching this identifier. Please check your email or admission number.'
      );
    }

    user.password = newPassword;
    user.tempPassword = newPassword;
    user.isActive = true;
    user.accountExpiryDate = null;
    user.forcePasswordChange = false;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    return sendSuccess(
      res,
      'Password reset successfully. You can now log in with your new password.',
      null,
      200,
      {
        schoolId: user.schoolId,
        user: {
          username: user.username,
          email: user.email,
          employeeId: user.employeeId,
          name: user.name,
        },
      }
    );
  } catch (error) {
    console.error('forgotPassword error:', error);
    return sendError(res, 'Failed to reset password', 500, error);
  }
};
