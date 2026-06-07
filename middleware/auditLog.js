import { logActivity } from '../utils/activityLogger.js';

const SENSITIVE_KEYS = ['password', 'confirmPassword', 'refreshToken', 'token'];

const sanitizeBody = (body = {}) => {
  const clean = { ...body };
  SENSITIVE_KEYS.forEach((key) => delete clean[key]);
  return clean;
};

const methodToAction = (method) => {
  const map = { GET: 'READ', POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' };
  return map[method] || 'READ';
};

const extractModule = (path = '') => {
  const match = path.match(/\/api\/v1\/([^/?]+)/);
  return match ? match[1] : 'system';
};

export const auditMiddleware = (req, res, next) => {
  const start = Date.now();
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (req.user && !req.path.includes('/auth/login')) {
      const action = req.path.includes('/auth/logout') ? 'LOGOUT' : methodToAction(req.method);
      logActivity({
        userId: req.user._id || req.user.id,
        action,
        module: extractModule(req.originalUrl || req.path),
        recordId: req.params?.id,
        details: `${req.method} ${req.originalUrl || req.path}`,
        ipAddress: req.ip || req.headers['x-forwarded-for'],
        userAgent: req.headers['user-agent'],
        metadata: {
          statusCode: res.statusCode,
          durationMs: Date.now() - start,
          body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? sanitizeBody(req.body) : undefined,
        },
      });
    }
    return originalJson(body);
  };

  next();
};
