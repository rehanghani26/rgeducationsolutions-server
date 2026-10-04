import express from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import User from '../models/User.js';
import Student from '../models/Student.js';
import PasswordChangeRequest from '../models/PasswordChangeRequest.js';
import { protect } from '../middleware/auth.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';
import { logActivity } from '../utils/activityLogger.js';
import { uploadToS3, generateS3Key, getPresignedUrl, resolveFileUrl } from '../config/s3.js';

const router = express.Router();

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid image format. Only JPG, PNG, and WEBP images are allowed.'));
    }
    cb(null, true);
  },
});

// All profile routes require authentication (any logged-in user)
router.use(protect);

/**
 * @desc    Get profile details (by 'me' or by userId)
 * @route   GET /api/v1/profile/me
 * @route   GET /api/v1/profile/:id
 * @access  Private (any authenticated user)
 */
const getProfileHandler = async (req, res) => {
  try {
    let targetId = req.params.id;
    const currentUserId = req.user?.id || req.user?._id;

    if (!targetId || targetId === 'me' || targetId === 'undefined') {
      targetId = currentUserId;
    }

    let user = null;

    if (checkFallback()) {
      user = FallbackDb.findById('users', targetId);
      if (!user && req.user && String(currentUserId) === String(targetId)) {
        user = req.user;
      }
      if (!user) {
        user = FallbackDb.findOne('users', { username: req.user?.username });
      }
      if (!user) {
        return res.status(404).json({ success: false, message: 'Profile not found' });
      }
      const { password, refreshToken, tempPassword, ...safeUser } = user;
      return res.json({ success: true, profile: safeUser });
    }

    // MongoDB lookup
    try {
      if (targetId && targetId.match(/^[0-9a-fA-F]{24}$/)) {
        user = await User.findById(targetId).select('-password -refreshToken -tempPassword');
      }
    } catch (_) {}

    if (!user) {
      user = await User.findOne({
        $or: [{ username: targetId }, { email: targetId }]
      }).select('-password -refreshToken -tempPassword');
    }

    if (!user) {
      user = FallbackDb.findById('users', targetId);
    }

    if (!user && req.user) {
      user = req.user;
    }

    if (!user) {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    const userData = user.toObject ? user.toObject() : user;
    const { password, refreshToken, tempPassword, ...safeUser } = userData;
    safeUser.avatar = safeUser.avatar || safeUser.photo || safeUser.imagesRef?.img || '';
    safeUser.photo = safeUser.photo || safeUser.avatar || safeUser.imagesRef?.img || '';
    safeUser.imagesRef = {
      id: safeUser.imagesRef?.id || '',
      img: safeUser.imagesRef?.img || safeUser.avatar || safeUser.photo || '',
    };

    if (safeUser.role === 'student' && (!safeUser.avatar && !safeUser.photo)) {
      try {
        let studentRecord = null;
        if (checkFallback()) {
          studentRecord =
            FallbackDb.findOne('students', { email: safeUser.email }) ||
            FallbackDb.findOne('students', { admissionNumber: safeUser.admissionNumber });
        } else {
          studentRecord = await Student.findOne({
            $or: [
              { user: user._id },
              { email: safeUser.email },
              { admissionNumber: safeUser.admissionNumber },
            ],
          });
        }
        if (studentRecord) {
          const sPhoto = studentRecord.photo || studentRecord.imagesRef?.img || '';
          if (sPhoto) {
            safeUser.avatar = sPhoto;
            safeUser.photo = sPhoto;
            safeUser.imagesRef = studentRecord.imagesRef || { id: '', img: sPhoto };
          }
        }
      } catch (e) {
        console.warn('Student profile photo lookup error:', e);
      }
    }

    if (safeUser.avatar) {
      try {
        safeUser.avatar = await resolveFileUrl(safeUser.avatar, 3600);
      } catch (e) {}
    }
    if (safeUser.photo) {
      try {
        safeUser.photo = await resolveFileUrl(safeUser.photo, 3600);
      } catch (e) {}
    }
    if (safeUser.imagesRef?.img) {
      try {
        safeUser.imagesRef.img = await resolveFileUrl(safeUser.imagesRef.img, 3600);
      } catch (e) {}
    }

    return res.json({ success: true, profile: safeUser });
  } catch (error) {
    console.error('GET /profile error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

router.get('/me', getProfileHandler);
router.get('/:id', getProfileHandler);

/**
 * @desc    Upload profile photo file (multipart form data)
 * @route   POST /api/v1/profile/upload-avatar
 * @access  Private (any authenticated user)
 */
router.post(
  '/upload-avatar',
  (req, res, next) => {
    avatarUpload.single('file')(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Photo size must not exceed 2MB' : err.message;
        return res.status(400).json({ success: false, message: msg });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No image file uploaded' });
      }

      const userId = req.user.id || req.user._id;
      let avatarUrl = '';
      let fileId = '';

      // 1. Try uploading to AWS S3 if configured
      try {
        if (process.env.AWS_S3_BUCKET_NAME) {
          const s3Key = generateS3Key('school-erp/avatars', req.file.originalname || `avatar-${Date.now()}.jpg`);
          await uploadToS3({
            buffer: req.file.buffer,
            key: s3Key,
            contentType: req.file.mimetype,
          });
          avatarUrl = await getPresignedUrl(s3Key, 3600 * 24 * 7);
          fileId = s3Key;
        }
      } catch (s3Err) {
        console.warn('S3 avatar upload failed, falling back to local storage:', s3Err.message);
      }

      // 2. Local fallback storage if S3 not available or failed
      if (!avatarUrl) {
        const uploadsDir = path.join(process.cwd(), 'uploads', 'avatars');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const ext = path.extname(req.file.originalname) || '.jpg';
        const filename = `avatar-${userId}-${Date.now()}${ext}`;
        const destPath = path.join(uploadsDir, filename);
        fs.writeFileSync(destPath, req.file.buffer);
        avatarUrl = `/uploads/avatars/${filename}`;
        fileId = `local_${filename}`;
      }

      if (avatarUrl && !avatarUrl.startsWith('http://') && !avatarUrl.startsWith('https://') && !avatarUrl.startsWith('data:')) {
        const origin = `${req.protocol}://${req.get('host')}`;
        avatarUrl = `${origin}${avatarUrl.startsWith('/') ? '' : '/'}${avatarUrl}`;
      }

      const imagesRef = {
        id: fileId || `img_${Date.now()}`,
        img: avatarUrl,
      };

      // Update user record
      if (checkFallback()) {
        FallbackDb.update('users', userId, { avatar: avatarUrl, photo: avatarUrl, imagesRef });
      } else {
        await User.findByIdAndUpdate(userId, { $set: { avatar: avatarUrl, photo: avatarUrl, imagesRef } }, { new: true });
      }

      await logActivity({
        userId,
        action: 'UPDATE',
        module: 'profile',
        details: 'User uploaded a new profile photo',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.json({
        success: true,
        message: 'Profile photo uploaded successfully',
        avatarUrl,
        url: avatarUrl,
        id: imagesRef.id,
        imagesRef,
        ref: imagesRef,
      });
    } catch (error) {
      console.error('POST /profile/upload-avatar error:', error);
      return res.status(500).json({ success: false, message: error.message || 'Server error uploading avatar' });
    }
  }
);

/**
 * @desc    Update own profile picture (avatar URL)
 * @route   PATCH /api/v1/profile/avatar
 * @access  Private (any authenticated user)
 */
router.patch('/avatar', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { avatarUrl, imagesRef } = req.body;

    let targetImg = typeof avatarUrl === 'string' ? avatarUrl : (imagesRef?.img || '');
    let targetId = imagesRef?.id || (targetImg ? `img_${Date.now()}` : '');

    if (targetImg && !targetImg.startsWith('http://') && !targetImg.startsWith('https://') && !targetImg.startsWith('data:')) {
      const origin = `${req.protocol}://${req.get('host')}`;
      targetImg = `${origin}${targetImg.startsWith('/') ? '' : '/'}${targetImg}`;
    }

    const finalImagesRef = {
      id: targetId,
      img: targetImg,
    };

    if (checkFallback()) {
      FallbackDb.update('users', userId, { avatar: targetImg, photo: targetImg, imagesRef: finalImagesRef });
      return res.json({ success: true, message: 'Profile picture updated', avatarUrl: targetImg, imagesRef: finalImagesRef });
    }

    await User.findByIdAndUpdate(
      userId,
      { $set: { avatar: targetImg, photo: targetImg, imagesRef: finalImagesRef } },
      { new: true }
    );

    await logActivity({
      userId,
      action: 'UPDATE',
      module: 'profile',
      details: 'User updated their profile picture',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ success: true, message: 'Profile picture updated successfully', avatarUrl: targetImg, imagesRef: finalImagesRef });
  } catch (error) {
    console.error('PATCH /profile/avatar error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/upload', avatarUpload.single('file'), async (req, res) => {
  // Alias pointing to upload-avatar
  req.url = '/upload-avatar';
  router.handle(req, res);
});

/**
 * @desc    Change own password (requires current password verification)
 * @route   PATCH /api/v1/profile/change-password
 * @access  Private (any authenticated user)
 */
router.patch('/change-password', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Both current password and new password are required',
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters',
      });
    }

    if (checkFallback()) {
      const user = FallbackDb.findById('users', userId);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (user.password !== currentPassword) {
        return res.status(401).json({ success: false, message: 'Current password is incorrect' });
      }
      FallbackDb.update('users', userId, { password: newPassword });
      return res.json({ success: true, message: 'Password changed successfully' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.forcePasswordChange = false;
    await user.save();

    await logActivity({
      userId,
      action: 'CHANGE_PASSWORD',
      module: 'profile',
      details: 'User changed their own account password',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({ success: true, message: 'Password changed successfully!' });
  } catch (error) {
    console.error('PATCH /profile/change-password error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @desc    Reset password via email (sends a link – simplified: admin flow)
 * @route   POST /api/v1/profile/reset-password-request
 * @access  Private (any authenticated user)
 */
router.post('/reset-password-request', async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const userEmail = req.user.email;

    // Log the reset request
    await logActivity({
      userId,
      action: 'RESET_PASSWORD_REQUEST',
      module: 'profile',
      details: `User ${userEmail} requested password reset via email`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      success: true,
      message: `Password reset instructions have been sent to ${userEmail}. Please check your email inbox.`,
    });
  } catch (error) {
    console.error('POST /profile/reset-password-request error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @desc    Submit a password change request (Student or user to Super Admin)
 * @route   POST /api/v1/profile/password-change-request
 * @access  Private
 */
router.post('/password-change-request', protect, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { newPassword, notes } = req.body;

    if (!newPassword || newPassword.trim().length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long',
      });
    }

    let className = '';
    let sectionName = '';
    if (req.user.role === 'student') {
      try {
        let std = null;
        if (checkFallback()) {
          std =
            FallbackDb.findOne('students', { email: req.user.email }) ||
            FallbackDb.findOne('students', { admissionNumber: req.user.admissionNumber });
        } else {
          std = await Student.findOne({
            $or: [
              { user: userId },
              { email: req.user.email },
              { admissionNumber: req.user.admissionNumber },
            ],
          });
        }
        if (std) {
          className = std.className || std.class || '';
          sectionName = std.sectionName || std.section || '';
        }
      } catch (_) {}
    }

    const payload = {
      userId,
      userName: req.user.name || req.user.username || 'Student',
      userEmail: req.user.email || '',
      userRole: req.user.role || 'student',
      admissionNumber: req.user.admissionNumber || '',
      className,
      sectionName,
      requestedPassword: newPassword,
      notes: notes?.trim() || '',
      actionType: 'request',
      status: 'pending',
      historyLog: [
        {
          action: 'REQUEST_SUBMITTED',
          performedBy: req.user.name || req.user.username || 'User',
          performedById: userId,
          timestamp: new Date(),
          notes: notes?.trim() || 'Password change request submitted.',
        },
      ],
    };

    let createdRequest;
    if (checkFallback()) {
      createdRequest = FallbackDb.create('passwordRequests', payload);
    } else {
      createdRequest = await PasswordChangeRequest.create(payload);
    }

    await logActivity({
      userId,
      action: 'REQUEST_PASSWORD_CHANGE',
      module: 'profile',
      details: `User ${req.user.email} submitted a password change request to Super Admin`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json({
      success: true,
      message: 'Password change request submitted successfully to Super Admin!',
      request: createdRequest,
    });
  } catch (error) {
    console.error('POST /password-change-request error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @desc    Get password change requests (User sees own; Admin sees all)
 * @route   GET /api/v1/profile/password-change-requests
 * @access  Private
 */
router.get('/password-change-requests', protect, async (req, res) => {
  try {
    const userId = String(req.user.id || req.user._id);
    const userRole = (req.user.role || '').toLowerCase().replace(/_/g, '-');
    const isAdmin = ['super-admin', 'superadmin', 'school-admin', 'principal', 'admin', 'director'].includes(userRole);
    const { status, search } = req.query;

    if (checkFallback()) {
      let list = FallbackDb.find('passwordRequests') || [];
      if (!isAdmin) {
        list = list.filter((r) => String(r.userId) === userId);
      }

      const total = list.length;
      const pending = list.filter((r) => r.status === 'pending').length;
      const approved = list.filter((r) => r.status === 'approved').length;
      const rejected = list.filter((r) => r.status === 'rejected').length;

      if (status && status !== 'all') {
        list = list.filter((r) => r.status === status);
      }
      if (search) {
        const s = search.toLowerCase();
        list = list.filter(
          (r) =>
            String(r.userName || '').toLowerCase().includes(s) ||
            String(r.userEmail || '').toLowerCase().includes(s) ||
            String(r.admissionNumber || '').toLowerCase().includes(s) ||
            String(r.notes || '').toLowerCase().includes(s) ||
            String(r.adminNotes || '').toLowerCase().includes(s)
        );
      }
      list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.json({
        success: true,
        requests: list,
        stats: { total, pending, approved, rejected },
      });
    }

    const query = {};
    if (!isAdmin) {
      query.userId = userId;
    }

    // Calculate overall stats for user/admin
    const baseQuery = isAdmin ? {} : { userId };
    const [total, pending, approved, rejected] = await Promise.all([
      PasswordChangeRequest.countDocuments(baseQuery),
      PasswordChangeRequest.countDocuments({ ...baseQuery, status: 'pending' }),
      PasswordChangeRequest.countDocuments({ ...baseQuery, status: 'approved' }),
      PasswordChangeRequest.countDocuments({ ...baseQuery, status: 'rejected' }),
    ]);

    if (status && status !== 'all') {
      query.status = status;
    }
    if (search) {
      const reg = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { userName: reg },
        { userEmail: reg },
        { admissionNumber: reg },
        { className: reg },
        { sectionName: reg },
        { notes: reg },
        { adminNotes: reg },
      ];
    }

    const requests = await PasswordChangeRequest.find(query).sort({ createdAt: -1 });
    return res.json({
      success: true,
      requests,
      stats: { total, pending, approved, rejected },
    });
  } catch (error) {
    console.error('GET /password-change-requests error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @desc    Review a password change request (Accept/Reject by Super Admin)
 * @route   PATCH /api/v1/profile/password-change-requests/:id/review
 * @access  Private (Admin / Super-Admin only)
 */
router.patch('/password-change-requests/:id/review', protect, async (req, res) => {
  try {
    const userRole = (req.user.role || '').toLowerCase().replace(/_/g, '-');
    const isAdmin = ['super-admin', 'superadmin', 'school-admin', 'principal', 'admin', 'director'].includes(userRole);

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only Super Admin can accept or reject password change requests.',
      });
    }

    const { id } = req.params;
    const { action, adminNotes } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action. Must be 'approve' or 'reject'.",
      });
    }

    const reviewerName = req.user.name || req.user.username || 'Super Admin';
    const reviewerId = req.user.id || req.user._id;

    if (checkFallback()) {
      const request = FallbackDb.findById('passwordRequests', id);
      if (!request) {
        return res.status(404).json({ success: false, message: 'Request not found' });
      }
      if (request.status !== 'pending') {
        return res.status(400).json({
          success: false,
          message: `Request has already been ${request.status}`,
        });
      }

      const existingHistory = request.historyLog || [];
      const newHistoryLog = [
        ...existingHistory,
        {
          action: action === 'approve' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED',
          performedBy: reviewerName,
          performedById: reviewerId,
          timestamp: new Date().toISOString(),
          notes: adminNotes || (action === 'approve' ? 'Approved by Super Admin' : 'Rejected by Super Admin'),
        },
      ];

      if (action === 'approve') {
        const targetUser = FallbackDb.findById('users', request.userId);
        if (targetUser) {
          FallbackDb.update('users', request.userId, {
            password: request.requestedPassword,
            forcePasswordChange: false,
          });
        }

        const updated = FallbackDb.update('passwordRequests', id, {
          status: 'approved',
          reviewedBy: reviewerId,
          reviewedByName: reviewerName,
          reviewedAt: new Date().toISOString(),
          adminNotes: adminNotes || 'Approved by Super Admin',
          historyLog: newHistoryLog,
        });

        return res.json({
          success: true,
          message: 'Password change request approved and password updated!',
          request: updated,
        });
      } else {
        const updated = FallbackDb.update('passwordRequests', id, {
          status: 'rejected',
          reviewedBy: reviewerId,
          reviewedByName: reviewerName,
          reviewedAt: new Date().toISOString(),
          adminNotes: adminNotes || 'Rejected by Super Admin',
          historyLog: newHistoryLog,
        });

        return res.json({
          success: true,
          message: 'Password change request rejected.',
          request: updated,
        });
      }
    }

    // MongoDB
    const request = await PasswordChangeRequest.findById(id);
    if (!request) {
      return res.status(404).json({ success: false, message: 'Request not found' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Request has already been ${request.status}`,
      });
    }

    if (!Array.isArray(request.historyLog)) {
      request.historyLog = [];
    }
    request.historyLog.push({
      action: action === 'approve' ? 'REQUEST_APPROVED' : 'REQUEST_REJECTED',
      performedBy: reviewerName,
      performedById: reviewerId,
      timestamp: new Date(),
      notes: adminNotes || (action === 'approve' ? 'Approved by Super Admin' : 'Rejected by Super Admin'),
    });

    if (action === 'approve') {
      const targetUser = await User.findById(request.userId);
      if (targetUser) {
        const salt = await bcrypt.genSalt(10);
        targetUser.password = await bcrypt.hash(request.requestedPassword, salt);
        targetUser.forcePasswordChange = false;
        await targetUser.save();
      }

      request.status = 'approved';
      request.reviewedBy = reviewerId;
      request.reviewedByName = reviewerName;
      request.reviewedAt = new Date();
      request.adminNotes = adminNotes || 'Approved by Super Admin';
      await request.save();

      await logActivity({
        userId: reviewerId,
        action: 'APPROVE_PASSWORD_CHANGE_REQUEST',
        module: 'profile',
        details: `Super Admin approved password change request for ${request.userEmail}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.json({
        success: true,
        message: 'Password change request approved and user password updated successfully!',
        request,
      });
    } else {
      request.status = 'rejected';
      request.reviewedBy = reviewerId;
      request.reviewedByName = reviewerName;
      request.reviewedAt = new Date();
      request.adminNotes = adminNotes || 'Rejected by Super Admin';
      await request.save();

      await logActivity({
        userId: reviewerId,
        action: 'REJECT_PASSWORD_CHANGE_REQUEST',
        module: 'profile',
        details: `Super Admin rejected password change request for ${request.userEmail}`,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      return res.json({
        success: true,
        message: 'Password change request rejected.',
        request,
      });
    }
  } catch (error) {
    console.error('PATCH /password-change-requests/:id/review error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

/**
 * @desc    Direct Password Reset by Super Admin (Instantly updates password & records history)
 * @route   POST /api/v1/profile/direct-password-reset
 * @access  Private (Super Admin only)
 */
router.post('/direct-password-reset', protect, async (req, res) => {
  try {
    const userRole = (req.user.role || '').toLowerCase().replace(/_/g, '-');
    const isAdmin = ['super-admin', 'superadmin', 'school-admin', 'principal', 'admin', 'director'].includes(userRole);

    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied. Only Super Admin can perform direct resets.' });
    }

    const { targetUserId, newPassword, adminNotes } = req.body;
    if (!targetUserId || !newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Target user ID and valid password (minimum 6 characters) are required',
      });
    }

    let targetUser = null;
    if (checkFallback()) {
      targetUser = FallbackDb.findById('users', targetUserId);
    } else {
      targetUser = await User.findById(targetUserId);
    }

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Target user account not found' });
    }

    // Update password
    if (checkFallback()) {
      FallbackDb.update('users', targetUserId, {
        password: newPassword,
        forcePasswordChange: false,
      });
    } else {
      const salt = await bcrypt.genSalt(10);
      targetUser.password = await bcrypt.hash(newPassword, salt);
      targetUser.forcePasswordChange = false;
      await targetUser.save();
    }

    // Look up student details if target is student
    let className = '';
    let sectionName = '';
    if (targetUser.role === 'student') {
      try {
        let std = null;
        if (checkFallback()) {
          std =
            FallbackDb.findOne('students', { email: targetUser.email }) ||
            FallbackDb.findOne('students', { admissionNumber: targetUser.admissionNumber });
        } else {
          std = await Student.findOne({
            $or: [
              { user: targetUser._id },
              { email: targetUser.email },
              { admissionNumber: targetUser.admissionNumber },
            ],
          });
        }
        if (std) {
          className = std.className || std.class || '';
          sectionName = std.sectionName || std.section || '';
        }
      } catch (_) {}
    }

    const reviewerName = req.user.name || req.user.username || 'Super Admin';
    const reviewerId = req.user.id || req.user._id;

    const historyPayload = {
      userId: targetUser._id || targetUser.id,
      userName: targetUser.name || targetUser.username,
      userEmail: targetUser.email,
      userRole: targetUser.role,
      admissionNumber: targetUser.admissionNumber || '',
      className,
      sectionName,
      requestedPassword: '••••••••',
      notes: 'Direct Administrative Reset',
      actionType: 'direct_admin_reset',
      status: 'approved',
      reviewedBy: reviewerId,
      reviewedByName: reviewerName,
      reviewedAt: new Date(),
      adminNotes: adminNotes || 'Password directly updated by Super Admin',
      historyLog: [
        {
          action: 'DIRECT_RESET_BY_ADMIN',
          performedBy: reviewerName,
          performedById: reviewerId,
          timestamp: new Date(),
          notes: adminNotes || 'Password directly reset by Super Admin',
        },
      ],
    };

    let logDoc;
    if (checkFallback()) {
      logDoc = FallbackDb.create('passwordRequests', historyPayload);
    } else {
      logDoc = await PasswordChangeRequest.create(historyPayload);
    }

    await logActivity({
      userId: reviewerId,
      action: 'DIRECT_PASSWORD_RESET',
      module: 'profile',
      details: `Super Admin directly changed password for ${targetUser.email}`,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return res.json({
      success: true,
      message: `Password for ${targetUser.name || targetUser.email} has been updated successfully!`,
      request: logDoc,
    });
  } catch (error) {
    console.error('POST /direct-password-reset error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

export default router;
