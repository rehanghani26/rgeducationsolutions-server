export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const userRole = String(req.user.role || '').toLowerCase();
    const allowedRoles = roles.flatMap((r) => {
      const lower = String(r).toLowerCase();
      if (lower === 'super-admin' || lower === 'superadmin') return ['super-admin', 'superadmin'];
      if (lower === 'school-admin' || lower === 'admin') return ['school-admin', 'admin'];
      return [lower];
    });

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user.role}' is not authorized to access this resource`
      });
    }

    next();
  };
};

export const requirePermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const userPermissions = req.user.permissions || [];
    const hasPermission = permissions.some((permission) => userPermissions.includes(permission));

    if (!hasPermission) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this resource'
      });
    }

    next();
  };
};
