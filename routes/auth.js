const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const { uploadConfigs, handleMulterError } = require('../middleware/upload');
const rateLimit = require('express-rate-limit');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Increased from 5 to 20 attempts
  message: { 
    message: 'Too many login attempts. Please wait 15 minutes before trying again, or contact an administrator if you need immediate access.' 
  },
  skipSuccessfulRequests: true, // Don't count successful logins
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      message: 'Too many login attempts. Please wait 15 minutes before trying again, or contact an administrator if you need immediate access.',
      retryAfter: Math.ceil(15 * 60 / 1000) // 15 minutes in seconds
    });
  }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: { message: 'Too many registration attempts, please try again later.' }
});

const FAILSAFE_EMAIL = 'irtazamadadnaqvi@iwiz.com';

// Endpoint to check login rate limit status
router.get('/login-status', (req, res) => {
  res.json({
    message: 'Login endpoint is available',
    rateLimit: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxAttempts: 20,
      description: '20 attempts per 15 minutes'
    }
  });
});

router.post('/register', registerLimiter, uploadConfigs.avatar, handleMulterError, [
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

    const { firstName, lastName, email, password, role } = req.body;
    
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

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        permissions: user.permissions
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Custom middleware to bypass rate limit for failsafe admin
const loginWithFailsafeBypass = (req, res, next) => {
  const email = req.body.email;
  if (email === FAILSAFE_EMAIL) {
    // Skip rate limiting for failsafe admin
    return next();
  }
  // Apply rate limiting for all other users
  return loginLimiter(req, res, next);
};

router.post('/login', loginWithFailsafeBypass, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {

    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {

      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const emailVariations = [
      email,
      email.toLowerCase(),
      email.trim(),
      email.toLowerCase().trim()
    ];



    let user = null;
    for (const variation of emailVariations) {
      user = await User.findOne({ email: variation });
      if (user) {

        break;
      }
    }

    if (!user) {

      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.isActive) {

      return res.status(401).json({ message: 'Account is deactivated' });
    }


    const isMatch = user.comparePassword(password);
    if (!isMatch) {

      return res.status(401).json({ message: 'Invalid credentials' });
    }
    


    user.lastLogin = new Date();
    await user.save();

    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE }
    );



    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        avatar: user.avatar,
        permissions: user.permissions,
        lastLogin: user.lastLogin
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    res.json({
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        phone: user.phone,
        avatar: user.avatar,
        permissions: user.permissions,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/profile', auth, uploadConfigs.avatar, handleMulterError, [
  body('firstName').optional().trim().notEmpty().withMessage('First name cannot be empty'),
  body('lastName').optional().trim().notEmpty().withMessage('Last name cannot be empty'),
  body('phone').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { firstName, lastName, phone } = req.body;
    const user = await User.findById(req.user.id);

    if (user.email === FAILSAFE_EMAIL) {
      return res.status(403).json({ message: 'Cannot modify failsafe admin profile' });
    }

    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone) user.phone = phone;

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
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/change-password', auth, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);

    if (user.email === FAILSAFE_EMAIL) {
      return res.status(403).json({ message: 'Cannot change failsafe admin password' });
    }

    const isMatch = user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;