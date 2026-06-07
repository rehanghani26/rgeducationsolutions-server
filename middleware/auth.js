import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { checkFallback, getDbState } from '../config/db.js';
import { FallbackDb } from '../services/dbFallback.js';

const JWT_SECRET = process.env.JWT_SECRET || 'aegis_super_secret_access_key';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'aegis_super_secret_refresh_key';

export const generateTokens = (user) => {
  const payload = {
    id: user.id || user._id,
    role: user.role,
    permissions: user.permissions || [],
  };
  
  const accessToken = jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, JWT_REFRESH_SECRET, { expiresIn: '7d' });
  
  return { accessToken, refreshToken };
};

export const protect = async (req, res, next) => {
  let token = null;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  } else if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  }

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized, token missing' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    if (checkFallback()) {
      // Fallback Database User lookup
      const user = FallbackDb.findById('users', decoded.id);
      if (!user) {
        return res.status(401).json({ success: false, message: 'User not found in fallback database' });
      }
      req.user = user;
    } else {
      // Real MongoDB User lookup
      const user = await User.findById(decoded.id).select('-password');
      if (!user) {
        return res.status(401).json({ success: false, message: 'User not found' });
      }
      req.user = user;
    }
    
    next();
  } catch (error) {
    console.error('JWT Verification Error:', error.message);
    return res.status(401).json({ success: false, message: 'Not authorized, token invalid or expired' });
  }
};
