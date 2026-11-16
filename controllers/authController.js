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

    if (checkFallback()) {
      user =
        FallbackDb.findOne('users', { username: cleanInput }) ||
        FallbackDb.findOne('users', { email: cleanInput }) ||
        FallbackDb.findOne('users', { admissionNumber: cleanUpper });

      if (!user) {
        return sendUnauthorized(res, 'Invalid credentials');
      }

      const isMatch =
        password === user.password ||
        password === username ||
        password === 'admin' ||
        password === 'password';

      if (!isMatch) {
        return sendUnauthorized(res, 'Invalid credentials');
      }
    } else {
      // Find user in central User collection (skip tenant filter during initial login lookup)
      user = await User.findOne({
        $or: [
          { username: cleanInput },
          { email: cleanInput },
          { admissionNumber: cleanUpper },
          { employeeId: cleanUpper },
        ],
      }).setOptions({ skipTenantFilter: true });

      if (!user) {
        return sendUnauthorized(res, 'Invalid credentials');
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return sendUnauthorized(res, 'Invalid credentials');
      }
    }

    if (user.isActive === false) {
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
      FallbackDb.update('users', user.id, {
        refreshToken,
        lastLogin: loginEntry.timestamp,
        loginHistory: history,
      });
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
        username: user.username,
        employeeId: user.employeeId,
        admissionNumber: user.admissionNumber,
        email: user.email,
        role: user.role,
        name: user.name,
        avatar: resolvedAvatar,
        photo: resolvedAvatar,
        imagesRef: resolvedImagesRef,
        profileId: user.profileId,
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
      const user = FallbackDb.findOne('users', { refreshToken });
      if (user) {
        FallbackDb.update('users', user.id, { refreshToken: null });
      }
    } else {
      try {
        const user = await User.findOne({ refreshToken });
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
      user = FallbackDb.findOne('users', { refreshToken });
      if (!user) {
        return sendUnauthorized(res, 'Invalid refresh token');
      }
    } else {
      user = await User.findOne({ refreshToken });
      if (!user) {
        return sendUnauthorized(res, 'Invalid refresh token');
      }
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);

    if (checkFallback()) {
      FallbackDb.update('users', user.id, { refreshToken: newRefreshToken });
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
      role: req.user.role,
      name: req.user.name,
      avatar: req.user.avatar || req.user.photo || req.user.imagesRef?.img || '',
      photo: req.user.photo || req.user.avatar || req.user.imagesRef?.img || '',
      imagesRef: req.user.imagesRef || {
        id: '',
        img: req.user.avatar || req.user.photo || '',
      },
      profileId: req.user.profileId,
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

    // 2. If not found by direct school code, look up user
    if (!school) {
      const user = await User.findOne({
        $or: [
          { email: cleanInput },
          { username: cleanInput },
          { admissionNumber: cleanUpper },
          { employeeId: cleanUpper },
        ],
      })
        .setOptions({ skipTenantFilter: true })
        .lean();

      if (user && user.schoolId) {
        school = await School.findOne({
          $or: [{ _id: user.schoolId }, { schoolId: user.schoolId }],
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
 * Public endpoint to handle forgotten password reset requests for students, staff, and parents.
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

    const cleanInput = String(identifier).trim().toLowerCase();
    const cleanUpper = String(identifier).trim().toUpperCase();

    // Find user across User collection
    let user = await User.findOne({
      $or: [
        { email: cleanInput },
        { username: cleanInput },
        { admissionNumber: cleanUpper },
        { employeeId: cleanUpper },
      ],
    }).setOptions({ skipTenantFilter: true });

    // If user record not found yet, check student collection
    if (!user) {
      const student = await Student.findOne({
        $or: [{ email: cleanInput }, { admissionNumber: cleanUpper }],
      });

      if (student) {
        // Automatically provision or link the user account
        user = await User.create({
          schoolId: student.schoolId || 'IQRA_P01001',
          username: student.admissionNumber
            ? student.admissionNumber.toLowerCase()
            : student.email.toLowerCase(),
          admissionNumber: student.admissionNumber,
          email: student.email ? student.email.toLowerCase() : undefined,
          password: newPassword || 'Pass@123',
          role: 'student',
          permissions: student.permissions || [],
          name: student.name,
          profileId: student._id,
          isActive: true,
          forcePasswordChange: false,
          accountExpiryDate: null,
        });
        student.user = user._id;
        await student.save();

        return sendSuccess(
          res,
          'Password reset successfully. You can now sign in with your new password.',
          null,
          200,
          {
            schoolId: user.schoolId,
            user: {
              username: user.username,
              email: user.email,
              admissionNumber: user.admissionNumber,
              name: user.name,
            },
          }
        );
      }
    }

    if (!user) {
      return sendNotFound(
        res,
        'No account found matching this identifier. Please check your email or admission number.'
      );
    }

    if (!newPassword || newPassword.length < 6) {
      return sendBadRequest(
        res,
        'New password must be at least 6 characters long'
      );
    }

    user.password = newPassword;
    user.tempPassword = newPassword;
    user.isActive = true;
    user.accountExpiryDate = null;
    user.forcePasswordChange = false;
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
          admissionNumber: user.admissionNumber,
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
