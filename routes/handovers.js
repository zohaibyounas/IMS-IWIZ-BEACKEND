const express = require('express');
const { body, validationResult } = require('express-validator');
const HandOver = require('../models/HandOver');
const Product = require('../models/Product');
const User = require('../models/User');
const { auth, checkPermission } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/handovers
// @desc    Get all handovers
// @access  Private
router.get('/', auth, checkPermission('canViewProducts'), async (req, res) => {
  try {
    const { page = 1, limit = 50, status, employee, product } = req.query;
    
    const filter = {};
    if (status) filter.status = status;
    if (employee) filter.employee = employee;
    if (product) filter.product = product;

    const handovers = await HandOver.find(filter)
      .populate('product', 'name')
      .populate('employee', 'firstName lastName department')
      .populate('handedOverBy', 'firstName lastName')
      .populate('returnedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await HandOver.countDocuments(filter);

    res.json({
      handovers,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Get handovers error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



// @route   POST /api/handovers
// @desc    Create new handover (direct handover by admin/manager - no approval needed)
// @access  Private
router.post('/', auth, checkPermission('canManageProducts'), [
  body('productId').notEmpty().withMessage('Product is required'),
  body('employeeId').notEmpty().withMessage('Employee is required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('purpose').optional().isLength({ max: 200 }).withMessage('Purpose cannot exceed 200 characters'),
  body('notes').optional().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { productId, employeeId, quantity, purpose, notes, expectedReturnDate, handedOverBy } = req.body;

    // Check if product exists and has sufficient stock
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (product.stock.quantity < quantity) {
      return res.status(400).json({ message: 'Insufficient stock available' });
    }

    // Check if employee exists
    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }

    // Create handover record
    const handover = new HandOver({
      product: productId,
      employee: employeeId,
      handedOverBy: handedOverBy || req.user.id,
      quantity,
      purpose,
      notes,
      status: 'handed_over', // Direct handover by admin/manager
      expectedReturnDate: expectedReturnDate ? new Date(expectedReturnDate) : undefined
    });

    await handover.save();

    // Update product stock
    product.stock.quantity -= quantity;
    await product.save();

    // Populate the handover for response
    await handover.populate([
      { path: 'product', select: 'name' },
      { path: 'employee', select: 'firstName lastName role' },
      { path: 'handedOverBy', select: 'firstName lastName' }
    ]);

    res.status(201).json({
      message: 'Item handed over successfully',
      handover
    });
  } catch (error) {
    console.error('Create handover error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PUT /api/handovers/:id/return
// @desc    Mark handover as returned
// @access  Private
router.put('/:id/return', auth, checkPermission('canManageProducts'), [
  body('returnNotes').optional().isLength({ max: 500 }).withMessage('Return notes cannot exceed 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { returnNotes } = req.body;
    
    const handover = await HandOver.findById(req.params.id).populate('product');
    if (!handover) {
      return res.status(404).json({ message: 'Handover not found' });
    }

    if (handover.status === 'returned') {
      return res.status(400).json({ message: 'Item already returned' });
    }

    // Update handover status
    handover.status = 'returned';
    handover.actualReturnDate = new Date();
    handover.returnedBy = req.user.id;
    handover.returnNotes = returnNotes;
    await handover.save();

    // Update product stock
    const product = await Product.findById(handover.product._id);
    if (product) {
      product.stock.quantity += handover.quantity;
      await product.save();
    }

    // Populate for response
    await handover.populate([
      { path: 'product', select: 'name' },
      { path: 'employee', select: 'firstName lastName role' },
      { path: 'handedOverBy', select: 'firstName lastName' },
      { path: 'returnedBy', select: 'firstName lastName' }
    ]);

    res.json({
      message: 'Item returned successfully',
      handover
    });
  } catch (error) {
    console.error('Return handover error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/handovers/stats
// @desc    Get handover statistics
// @access  Private
router.get('/stats', auth, checkPermission('canViewProducts'), async (req, res) => {
  try {
    const [totalHandovers, activeHandovers, returnedHandovers, overdueHandovers] = await Promise.all([
      HandOver.countDocuments(),
      HandOver.countDocuments({ status: 'handed_over' }),
      HandOver.countDocuments({ status: 'returned' }),
      HandOver.countDocuments({
        status: 'handed_over',
        expectedReturnDate: { $lt: new Date() }
      })
    ]);

    // Get recent handovers
    const recentHandovers = await HandOver.find()
      .populate('product', 'name')
      .populate('employee', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      stats: {
        total: totalHandovers,
        active: activeHandovers,
        returned: returnedHandovers,
        overdue: overdueHandovers
      },
      recentHandovers
    });
  } catch (error) {
    console.error('Get handover stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/handovers/my-handovers
// @desc    Get handovers for the current user (employee)
// @access  Private
router.get('/my-handovers', auth, checkPermission('canReturnHandover'), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = { employee: req.user.id };
    
    if (status) {
      filter.status = status;
    }

    const handovers = await HandOver.find(filter)
      .populate('product', 'name stock')
      .populate('handedOverBy', 'firstName lastName')
      .populate('returnedBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.json({ handovers });
  } catch (error) {
    console.error('Get my handovers error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/handovers/request
// @desc    Request a handover (employee - requires approval)
// @access  Private
router.post('/request', auth, checkPermission('canRequestHandover'), [
  body('productId').notEmpty().withMessage('Product is required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('reason').notEmpty().withMessage('Reason is required').isLength({ max: 500 }).withMessage('Reason cannot exceed 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { productId, quantity, reason } = req.body;

    // Check if product exists
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Create handover request (pending approval)
    const handover = new HandOver({
      product: productId,
      employee: req.user.id,
      // handedOverBy will be set when approved
      quantity,
      purpose: reason,
      status: 'pending',
      notes: `Requested by employee: ${reason}`
    });

    await handover.save();

    // Populate the handover for response
    await handover.populate([
      { path: 'product', select: 'name stock' },
      { path: 'employee', select: 'firstName lastName' }
    ]);

    res.status(201).json({
      message: 'Handover request created successfully',
      handover
    });
  } catch (error) {
    console.error('Create handover request error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/handovers/:id/return
// @desc    Return a handover (employee)
// @access  Private
router.post('/:id/return', auth, checkPermission('canReturnHandover'), [
  body('returnQuantity').isInt({ min: 1 }).withMessage('Return quantity must be at least 1'),
  body('returnNotes').optional().isLength({ max: 500 }).withMessage('Return notes cannot exceed 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { returnQuantity, returnNotes } = req.body;
    const handoverId = req.params.id;

    // Find the handover
    const handover = await HandOver.findById(handoverId);
    if (!handover) {
      return res.status(404).json({ message: 'Handover not found' });
    }

    // Check if the handover belongs to the current user
    if (handover.employee.toString() !== req.user.id) {
      return res.status(403).json({ message: 'You can only return your own handovers' });
    }

    // Check if handover is active
    if (handover.status !== 'handed_over') {
      return res.status(400).json({ message: 'Handover is not active' });
    }

    // Check return quantity
    if (returnQuantity > handover.quantity) {
      return res.status(400).json({ message: 'Return quantity cannot exceed borrowed quantity' });
    }

    // Update handover
    handover.returnedQuantity = (handover.returnedQuantity || 0) + returnQuantity;
    handover.returnedBy = req.user.id;
    handover.returnDate = new Date();
    handover.returnNotes = returnNotes;

    // If all items are returned, mark as returned
    if (handover.returnedQuantity >= handover.quantity) {
      handover.status = 'returned';
    }

    await handover.save();

    // Update product stock
    const product = await Product.findById(handover.product);
    if (product) {
      product.stock.quantity += returnQuantity;
      await product.save();
    }

    // Populate the handover for response
    await handover.populate([
      { path: 'product', select: 'name stock' },
      { path: 'employee', select: 'firstName lastName' },
      { path: 'returnedBy', select: 'firstName lastName' }
    ]);

    res.json({
      message: 'Handover returned successfully',
      handover
    });
  } catch (error) {
    console.error('Return handover error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/handovers/pending
// @desc    Get pending handover requests (for managers/admins)
// @access  Private
router.get('/pending', auth, checkPermission('canManageProducts'), async (req, res) => {
  try {
    const handovers = await HandOver.find({ status: 'pending' })
      .populate('product', 'name stock')
      .populate('employee', 'firstName lastName email')
      .sort({ createdAt: -1 });

    res.json({ handovers });
  } catch (error) {
    console.error('Get pending handovers error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/handovers/:id/approve
// @desc    Approve a handover request (manager/admin)
// @access  Private
router.post('/:id/approve', auth, checkPermission('canManageProducts'), [
  body('approvalNotes').optional().isLength({ max: 500 }).withMessage('Approval notes cannot exceed 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { approvalNotes } = req.body;
    const handoverId = req.params.id;

    // Find the handover
    const handover = await HandOver.findById(handoverId).populate('product');
    if (!handover) {
      return res.status(404).json({ message: 'Handover request not found' });
    }

    if (handover.status !== 'pending') {
      return res.status(400).json({ message: 'Handover request is not pending' });
    }

    // Check if product has sufficient stock
    if (handover.product.stock.quantity < handover.quantity) {
      return res.status(400).json({ message: 'Insufficient stock available' });
    }

    // Update handover status
    handover.status = 'handed_over';
    handover.handedOverBy = req.user.id;
    handover.handOverDate = new Date();
    handover.approvalNotes = approvalNotes;
    handover.notes = `${handover.notes}\nApproved by ${req.user.firstName} ${req.user.lastName}: ${approvalNotes || 'No notes'}`;
    await handover.save();

    // Update product stock
    handover.product.stock.quantity -= handover.quantity;
    await handover.product.save();

    // Populate the handover for response
    await handover.populate([
      { path: 'product', select: 'name stock' },
      { path: 'employee', select: 'firstName lastName' },
      { path: 'handedOverBy', select: 'firstName lastName' }
    ]);

    res.json({
      message: 'Handover request approved successfully',
      handover
    });
  } catch (error) {
    console.error('Approve handover error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/handovers/:id/reject
// @desc    Reject a handover request (manager/admin)
// @access  Private
router.post('/:id/reject', auth, checkPermission('canManageProducts'), [
  body('rejectionReason').notEmpty().withMessage('Rejection reason is required').isLength({ max: 500 }).withMessage('Rejection reason cannot exceed 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { rejectionReason } = req.body;
    const handoverId = req.params.id;

    // Find the handover
    const handover = await HandOver.findById(handoverId);
    if (!handover) {
      return res.status(404).json({ message: 'Handover request not found' });
    }

    if (handover.status !== 'pending') {
      return res.status(400).json({ message: 'Handover request is not pending' });
    }

    // Update handover status
    handover.status = 'rejected';
    handover.rejectedBy = req.user.id;
    handover.rejectionReason = rejectionReason;
    handover.notes = `${handover.notes}\nRejected by ${req.user.firstName} ${req.user.lastName}: ${rejectionReason}`;
    await handover.save();

    // Populate the handover for response
    await handover.populate([
      { path: 'product', select: 'name stock' },
      { path: 'employee', select: 'firstName lastName' }
    ]);

    res.json({
      message: 'Handover request rejected successfully',
      handover
    });
  } catch (error) {
    console.error('Reject handover error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/handovers/:id
// @desc    Delete a handover (manager/admin)
// @access  Private
router.delete('/:id', auth, checkPermission('canManageProducts'), async (req, res) => {
  try {
    const handoverId = req.params.id;

    // Find the handover
    const handover = await HandOver.findById(handoverId).populate('product');
    if (!handover) {
      return res.status(404).json({ message: 'Handover not found' });
    }

    // Only restore stock for handed_over handovers (stock was deducted when handed over)
    // For pending/rejected handovers, no stock was ever deducted, so no restoration needed
    // For returned handovers, stock was already restored when returned, so no action needed
    if (handover.status === 'handed_over' && handover.product) {
      handover.product.stock.quantity += handover.quantity;
      await handover.product.save();
    }

    // Delete the handover
    await HandOver.findByIdAndDelete(handoverId);

    res.json({
      message: 'Handover deleted successfully'
    });
  } catch (error) {
    console.error('Delete handover error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/handovers/:id
// @desc    Get single handover by ID
// @access  Private
router.get('/:id', auth, checkPermission('canViewProducts'), async (req, res) => {
  try {
    const handover = await HandOver.findById(req.params.id)
      .populate('product', 'name productId category price stock')
      .populate('employee', 'firstName lastName email role department')
      .populate('handedOverBy', 'firstName lastName email role')
      .populate('returnedBy', 'firstName lastName email role')
      .populate('rejectedBy', 'firstName lastName email role');

    if (!handover) {
      return res.status(404).json({ message: 'Handover not found' });
    }

    res.json(handover);
  } catch (error) {
    console.error('Get handover by ID error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;