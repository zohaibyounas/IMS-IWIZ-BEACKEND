const express = require('express');
const { body, validationResult, query } = require('express-validator');
const User = require('../models/User');
const { auth, checkPermission, checkRole } = require('../middleware/auth');
const { uploadConfigs, handleMulterError } = require('../middleware/upload');

const router = express.Router();

const FAILSAFE_EMAIL = 'irtazamadadnaqvi@iwiz.com';

router.get('/', auth, checkPermission('canManageUsers'), [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
  query('sortBy').optional().isIn(['firstName', 'lastName', 'email', 'role', 'createdAt', 'lastLogin']).withMessage('Invalid sort field'),
  query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      page = 1,
      limit = 10,
      search,
      role,
      department,
      isActive,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};
    
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (role) filter.role = role;
    if (department) filter.department = department;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .sort(sort)
        .skip(skip)
        .limit(parseInt(limit)),
      User.countDocuments(filter)
    ]);

    res.json({
      users,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/for-handover', auth, checkPermission('canManageProducts'), async (req, res) => {
  try {
    const users = await User.find({ isActive: true })
      .select('firstName lastName role')
      .sort({ firstName: 1, lastName: 1 });

    res.json({ users });
  } catch (error) {
    console.error('Get users for handover error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', auth, checkRole('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', auth, checkRole('admin'), uploadConfigs.avatar, handleMulterError, [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('role').isIn(['admin', 'manager', 'employee']).withMessage('Invalid role')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { firstName, lastName, email, password, role, phone } = req.body;
    
    if (email === FAILSAFE_EMAIL) {
      return res.status(403).json({ message: 'Cannot create user with failsafe admin email' });
    }
    
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    let avatarUrl = '';
    if (req.file) {
      
      avatarUrl = req.file.path; // Cloudinary returns the full URL in file.path
    }

    const user = new User({
      firstName,
      lastName,
      email,
      password,
      role,
      phone,
      avatar: avatarUrl,
      permissions: {
        canViewProducts: true,
        canAddProducts: role === 'admin' || role === 'manager',
        canEditProducts: role === 'admin' || role === 'manager',
        canDeleteProducts: role === 'admin',
        canManageProducts: role === 'admin' || role === 'manager',
        canViewOrders: true,
        canManageOrders: role === 'admin' || role === 'manager',
        canManageUsers: role === 'admin',
        canRequestHandover: role === 'employee',
        canReturnHandover: role === 'employee',
      }
    });

    await user.save();

    res.status(201).json({
      success: true,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        phone: user.phone,
        avatar: user.avatar,
        permissions: user.permissions
      }
    });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', auth, checkRole('admin'), uploadConfigs.avatar, handleMulterError, [
  body('firstName').optional().trim().notEmpty().withMessage('First name cannot be empty'),
  body('lastName').optional().trim().notEmpty().withMessage('Last name cannot be empty'),
  body('email').optional().isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('role').optional().isIn(['admin', 'manager', 'employee']).withMessage('Invalid role')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.email === FAILSAFE_EMAIL) {
      return res.status(403).json({ message: 'Cannot modify failsafe admin account' });
    }

    const { firstName, lastName, email, role, phone } = req.body;

    if (email && email !== user.email) {
      if (email === FAILSAFE_EMAIL) {
        return res.status(403).json({ message: 'Cannot use failsafe admin email' });
      }
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'Email already in use' });
      }
      user.email = email;
    }

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone) user.phone = phone;
    
    // If role is being changed, update permissions to match the new role
    if (role && role !== user.role) {
  
      user.role = role;
      
      // Update permissions based on the new role
      user.permissions = {
        canViewProducts: true,
        canAddProducts: role === 'admin' || role === 'manager',
        canEditProducts: role === 'admin' || role === 'manager',
        canDeleteProducts: role === 'admin',
        canManageProducts: role === 'admin' || role === 'manager',
        canViewOrders: true,
        canManageOrders: role === 'admin' || role === 'manager',
        canManageUsers: role === 'admin',
        canRequestHandover: role === 'employee',
        canReturnHandover: role === 'employee',
      };
      
  
    } else if (role) {
      user.role = role;
    }

    if (req.file) {
      
      user.avatar = req.file.path; // Cloudinary returns the full URL in file.path
    }

    await user.save();

    res.json({
      success: true,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        phone: user.phone,
        avatar: user.avatar,
        permissions: user.permissions
      }
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Endpoint to fix specific user permissions
router.post('/fix-permissions/:email', auth, checkRole('admin'), async (req, res) => {
  try {
    const { email } = req.params;
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Update permissions based on current role
    user.permissions = {
      canViewProducts: true,
      canAddProducts: user.role === 'admin' || user.role === 'manager',
      canEditProducts: user.role === 'admin' || user.role === 'manager',
      canDeleteProducts: user.role === 'admin',
      canManageProducts: user.role === 'admin' || user.role === 'manager',
      canViewOrders: true,
      canManageOrders: user.role === 'admin' || user.role === 'manager',
      canManageUsers: user.role === 'admin',
      canRequestHandover: user.role === 'employee',
      canReturnHandover: user.role === 'employee',
    };

    await user.save();

    res.json({
      success: true,
      message: `Permissions fixed for ${email}`,
      user: {
        email: user.email,
        role: user.role,
        permissions: user.permissions
      }
    });
  } catch (error) {
    console.error('Fix permissions error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', auth, checkRole('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.email === FAILSAFE_EMAIL) {
      return res.status(403).json({ message: 'Cannot delete failsafe admin account' });
    }

    await User.findByIdAndDelete(req.params.id);

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id/toggle-status', auth, checkRole('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.email === FAILSAFE_EMAIL) {
      return res.status(403).json({ message: 'Cannot deactivate failsafe admin account' });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.json({
      success: true,
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      isActive: user.isActive
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;