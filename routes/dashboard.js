const express = require('express');
const router = express.Router();
const { auth, checkPermission } = require('../middleware/auth');
const Product = require('../models/Product');
const User = require('../models/User');

// @route   GET /api/dashboard/stats
// @desc    Get dashboard statistics
// @access  Private
router.get('/stats', auth, async (req, res) => {
  try {
    // Basic counts
    const totalProducts = await Product.countDocuments({ status: 'active' });
    const totalUsers = await User.countDocuments({ isActive: true });

    // Calculate total inventory value
    const products = await Product.find({ status: 'active' });
    const totalValue = products.reduce((sum, product) => {
      return sum + (product.stock.quantity * product.price.selling);
    }, 0);

    res.json({
      totalProducts,
      totalUsers,
      totalValue: Math.round(totalValue * 100) / 100
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});



// @route   GET /api/dashboard/recent-activity
// @desc    Get recent activity across the system
// @access  Private
router.get('/recent-activity', auth, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const HandOver = require('../models/HandOver');

    // Get activities from last 30 days for better coverage
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Recent products (last 30 days)
    const recentProducts = await Product.find({
      createdAt: { $gte: thirtyDaysAgo }
    })
      .populate('createdBy', 'firstName lastName')
      .select('name createdAt createdBy')
      .sort({ createdAt: -1 })
      .limit(Math.ceil(parseInt(limit) / 4));

    // Recent users (last 30 days)
    const recentUsers = await User.find({
      createdAt: { $gte: thirtyDaysAgo }
    })
      .select('firstName lastName email role createdAt')
      .sort({ createdAt: -1 })
      .limit(Math.ceil(parseInt(limit) / 4));

    // Recent handovers (last 30 days)
    let handoverFilter = { createdAt: { $gte: thirtyDaysAgo } };
    
    // If user is employee, only show their own handovers
    if (req.user.role === 'employee') {
      handoverFilter.employee = req.user.id;
    }
    
    const recentHandovers = await HandOver.find(handoverFilter)
      .populate('product', 'name productId')
      .populate('employee', 'firstName lastName')
      .populate('handedOverBy', 'firstName lastName')
      .populate('returnedBy', 'firstName lastName')
      .select('product employee handedOverBy returnedBy quantity purpose status createdAt updatedAt')
      .sort({ createdAt: -1 })
      .limit(Math.ceil(parseInt(limit) / 2));

    // Recent stock updates (last 30 days)
    const recentStockUpdates = await Product.find({
      'stock.lastRestocked': { $gte: thirtyDaysAgo }
    })
      .populate('createdBy', 'firstName lastName')
      .select('name stock.lastRestocked stock.quantity createdBy')
      .sort({ 'stock.lastRestocked': -1 })
      .limit(Math.ceil(parseInt(limit) / 4));

    const activities = [];

    // Add product creation activities
    recentProducts.forEach(product => {
      if (product && product.name && product.createdAt) {
        activities.push({
          type: 'product',
          action: 'created',
          title: `Product ${product.name}`,
          description: `New product added to inventory`,
          date: product.createdAt,
          user: product.createdBy || null,
          icon: 'fas fa-box',
          color: 'primary',
          metadata: {
            name: product.name
          }
        });
      }
    });

    // Add user registration activities
    recentUsers.forEach(user => {
      if (user && user.firstName && user.lastName && user.createdAt) {
        activities.push({
          type: 'user',
          action: 'created',
          title: `User ${user.firstName} ${user.lastName}`,
          description: `New ${user.role || 'user'} registered`,
          date: user.createdAt,
          user: user,
          icon: 'fas fa-user-plus',
          color: 'success',
          metadata: {
            email: user.email,
            role: user.role
          }
        });
      }
    });

    // Add handover activities
    recentHandovers.forEach(handover => {
      if (!handover || !handover.product || !handover.employee) return;
      
      if (handover.status === 'handed_over') {
        activities.push({
          type: 'handover',
          action: 'handed_over',
          title: `${handover.quantity || 0} ${handover.product.name || 'Product'}`,
          description: `Handed over to ${handover.employee.firstName || ''} ${handover.employee.lastName || ''}`,
          date: handover.createdAt,
          user: handover.handedOverBy || null,
          icon: 'fas fa-hand-holding',
          color: 'warning',
          metadata: {
            productName: handover.product.name,
            employeeName: `${handover.employee.firstName || ''} ${handover.employee.lastName || ''}`,
            quantity: handover.quantity,
            purpose: handover.purpose
          }
        });
      } else if (handover.status === 'returned') {
        activities.push({
          type: 'handover',
          action: 'returned',
          title: `${handover.quantity || 0} ${handover.product.name || 'Product'}`,
          description: `Returned by ${handover.employee.firstName || ''} ${handover.employee.lastName || ''}`,
          date: handover.updatedAt || handover.createdAt,
          user: handover.returnedBy || null,
          icon: 'fas fa-undo',
          color: 'info',
          metadata: {
            productName: handover.product.name,
            employeeName: `${handover.employee.firstName || ''} ${handover.employee.lastName || ''}`,
            quantity: handover.quantity
          }
        });
      }
    });

    // Add stock update activities
    recentStockUpdates.forEach(product => {
      if (product && product.name && product.stock && product.stock.lastRestocked) {
        activities.push({
          type: 'stock',
          action: 'updated',
          title: `${product.name} stock`,
          description: `Stock updated to ${product.stock.quantity || 0} units`,
          date: product.stock.lastRestocked,
          user: product.createdBy || null,
          icon: 'fas fa-warehouse',
          color: 'secondary',
          metadata: {
            name: product.name,
            quantity: product.stock.quantity
          }
        });
      }
    });

    // Sort by date (newest first)
    activities.sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      activities: activities.slice(0, parseInt(limit))
    });
  } catch (error) {
    console.error('Get recent activity error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;