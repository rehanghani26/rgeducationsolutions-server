import mongoose from 'mongoose';
import RGESAdmin from '../models/RGESAdmin.js';
import { verifyAccessToken } from './auth.js';
import { sendError, sendUnauthorized } from '../utils/responseUtil.js';

export async function requirePlatformAdmin(req, res, next) {
  let claims;
  try {
    const [scheme, token] = (req.get('authorization') || '').split(' ');
    if (scheme === 'Bearer' && token) claims = verifyAccessToken(token);
  } catch {
    return sendUnauthorized(res, 'Sign in to RGES Admin to continue.');
  }
  if (!claims || claims.schoolId || !mongoose.isObjectIdOrHexString(claims.userId)) {
    return sendUnauthorized(res, 'Sign in to RGES Admin to continue.');
  }
  try {
    const admin = await RGESAdmin.findOne({ _id: claims.userId, isActive: true }).select('name role').lean();
    if (!admin) return sendUnauthorized(res, 'Sign in to RGES Admin to continue.');
    req.user = admin;
    return next();
  } catch {
    return sendError(res, 'Unable to verify platform administrator.', 503);
  }
}
