const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify JWT token
const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(401).json({ message: 'Token is not valid' });
    }

    if (!user.isActive) {
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(401).json({ message: 'Token is not valid' });
  }
};

// Check if user has specific permission
const checkPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    if (!req.user.permissions[permission]) {
      return res.status(403).json({ 
        message: 'Access denied. Insufficient permissions.',
        required: permission
      });
    }

    next();
  };
};

// Check if user has specific role
const checkRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const userRoles = Array.isArray(roles) ? roles : [roles];
    
    if (!userRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: 'Access denied. Insufficient role privileges.',
        required: userRoles,
        current: req.user.role
      });
    }

    next();
  };
};

// Admin only access
const adminOnly = checkRole('admin');

// Manager and above access
const managerAndAbove = checkRole(['admin', 'manager']);

// Employee and above access (excludes viewer)
const employeeAndAbove = checkRole(['admin', 'manager', 'employee']);

module.exports = {
  auth,
  checkPermission,
  checkRole,
  adminOnly,
  managerAndAbove,
  employeeAndAbove
};