import User from '../models/User.js';
import { generateTokens, protect } from '../middleware/auth.js';
import { checkFallback } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';
import { logActivity } from '../utils/activityLogger.js';

export const login = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Please provide email/username and password' });
  }

  try {
    let user = null;

    if (checkFallback()) {
      // Look up in fallback memory DB
      user = FallbackDb.findOne('users', { username: username.toLowerCase() }) ||
             FallbackDb.findOne('users', { email: username.toLowerCase() });
      
      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
      
      // In fallback mode, accept simple plaintext passwords matching the username for debugging simplicity
      const isMatch = password === username || password === 'admin' || password === 'password';
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
    } else {
      // Look up in real MongoDB
      user = await User.findOne({
        $or: [
          { username: username.toLowerCase() },
          { email: username.toLowerCase() }
        ]
      });

      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }

      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ success: false, message: 'Invalid credentials' });
      }
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is deactivated' });
    }

    if (user.accountExpiryDate && new Date(user.accountExpiryDate) < new Date()) {
      return res.status(403).json({ success: false, message: 'Account has expired' });
    }

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    const loginEntry = {
      ip: req.ip || req.headers['x-forwarded-for'],
      userAgent: req.headers['user-agent'],
      timestamp: new Date(),
    };

    // Save refresh token and login history
    if (checkFallback()) {
      const history = [...(user.loginHistory || []), loginEntry].slice(-20);
      FallbackDb.update('users', user.id, { refreshToken, lastLogin: loginEntry.timestamp, loginHistory: history });
    } else {
      user.refreshToken = refreshToken;
      user.lastLogin = loginEntry.timestamp;
      user.loginHistory = [...(user.loginHistory || []), loginEntry].slice(-20);
      await user.save();
    }

    await logActivity({
      userId: user.id || user._id,
      action: 'LOGIN',
      module: 'auth',
      details: `User ${user.name} logged in`,
      ipAddress: loginEntry.ip,
      userAgent: loginEntry.userAgent,
    });

    // Set cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    return res.json({
      success: true,
      message: 'Login successful',
      accessToken,
      user: {
        id: user.id || user._id,
        username: user.username,
        employeeId: user.employeeId,
        admissionNumber: user.admissionNumber,
        email: user.email,
        role: user.role,
        permissions: user.permissions || [],
        name: user.name,
        profileId: user.profileId,
        forcePasswordChange: user.forcePasswordChange || false,
        twoFactorEnabled: user.twoFactorEnabled || false
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Server error during login' });
  }
};

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
  return res.json({ success: true, message: 'Logged out successfully' });
};

export const refresh = async (req, res) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ success: false, message: 'Refresh token missing' });
  }

  try {
    let user = null;

    if (checkFallback()) {
      user = FallbackDb.findOne('users', { refreshToken });
      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid refresh token' });
      }
    } else {
      user = await User.findOne({ refreshToken });
      if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid refresh token' });
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
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    return res.json({
      success: true,
      accessToken
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    return res.status(401).json({ success: false, message: 'Session expired, please login again' });
  }
};

export const getMe = async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'User context missing' });
  }

  return res.json({
    success: true,
    user: {
      id: req.user.id || req.user._id,
      username: req.user.username,
      employeeId: req.user.employeeId,
      admissionNumber: req.user.admissionNumber,
      email: req.user.email,
      role: req.user.role,
      permissions: req.user.permissions || [],
      name: req.user.name,
      profileId: req.user.profileId,
      forcePasswordChange: req.user.forcePasswordChange || false,
      twoFactorEnabled: req.user.twoFactorEnabled || false
    }
  });
};
