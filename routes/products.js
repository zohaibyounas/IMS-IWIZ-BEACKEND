const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const { auth, checkPermission, managerAndAbove } = require('../middleware/auth');
const { uploadConfigs, handleMulterError } = require('../middleware/upload');
const { body, validationResult } = require('express-validator');
const { validateProduct } = require('../middleware/validation');
const { uploadLimiter } = require('../middleware/rateLimit');



// GET /api/products - Get all products with search and pagination
router.get('/', async (req, res) => {
  try {
    const { search, page = 1, limit = 10, status } = req.query;
    
    let query = {};
    if (search) {
      const isNumeric = /^\d+$/.test(search);
      
      if (isNumeric) {
        query = {
          $or: [
            { productId: parseInt(search) },
            { name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
          ]
        };
      } else {
        query = {
          $or: [
            { name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
          ]
        };
      }
    }
    
    // Add status filter
    if (status && status !== '') {
      query.status = status;
    }
    
    const skip = (page - 1) * limit;
    
    const products = await Product.find(query)
      .populate('createdBy', 'firstName lastName')
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });
    
    const total = await Product.countDocuments(query);
    

    
    res.json({
      products,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /api/products/all - Get all products without pagination (for dropdowns)
router.get('/all', async (req, res) => {
  try {
    const products = await Product.find({ status: 'active' })
      .select('name productId stock price status')
      .sort({ name: 1 });
    

    
    res.json({
      products,
      total: products.length
    });
  } catch (error) {
    console.error('Get all products error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// GET /api/products/:id - Get single product
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('createdBy', 'firstName lastName')
      .select('-__v')
      .lean();
    
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }
    res.json(product);
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// POST /api/products - Create new product
router.post('/', auth, checkPermission('canAddProducts'), uploadLimiter, uploadConfigs.productImages, handleMulterError, validateProduct, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array() 
      });
    }

    // Validate required fields
    if (!req.body.name || !req.body.costPrice || !req.body.sellingPrice) {
      return res.status(400).json({ 
        message: 'Missing required fields: name, costPrice, sellingPrice' 
      });
    }

    // Transform flat data to nested structure expected by the model
    const productData = {
      name: req.body.name.trim(),
      description: req.body.description ? req.body.description.trim() : '',
      price: {
        cost: parseFloat(req.body.costPrice),
        selling: parseFloat(req.body.sellingPrice),
        currency: req.body.currency || 'PKR'
      },
      stock: {
        quantity: parseInt(req.body.stockQuantity) || 0,
        minStock: parseInt(req.body.minStock) || 0,
        maxStock: parseInt(req.body.maxStock) || 1000,
        unit: req.body.unit || 'pcs',
        location: req.body.location || ''
      },
      tags: req.body.tags ? req.body.tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [],
      status: req.body.status || 'active',
      expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : null,
      createdBy: req.user.id
    };

    // Validate price values
    if (productData.price.cost < 0 || productData.price.selling < 0) {
      return res.status(400).json({ 
        message: 'Prices cannot be negative' 
      });
    }

    // Handle image upload
    if (req.files && req.files.length > 0) {
      const primaryImageIndex = parseInt(req.body.primaryImageIndex) || 0;
      
      // Validate primary image index
      if (primaryImageIndex < 0 || primaryImageIndex >= req.files.length) {
        return res.status(400).json({ 
          message: 'Invalid primary image index' 
        });
      }
      
      productData.images = req.files.map((file, index) => ({
        url: file.path, // Cloudinary returns the full URL in file.path
        alt: `${req.body.name} image ${index + 1}`,
        isPrimary: index === primaryImageIndex
      }));
    } else {
      return res.status(400).json({ 
        message: 'At least one product image is required' 
      });
    }

    const product = new Product(productData);
    await product.save();
    
    res.status(201).json({
      message: 'Product created successfully',
      product: product
    });
  } catch (error) {
    console.error('Product creation error:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      const validationErrors = Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message
      }));
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: validationErrors
      });
    }
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(400).json({ 
        message: 'Product with this ID already exists'
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to create product',
      error: error.message
    });
  }
});

// PUT /api/products/:id - Update product
router.put('/:id', auth, checkPermission('canEditProducts'), uploadConfigs.productImages, handleMulterError, validateProduct, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: errors.array() 
      });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Transform flat data to nested structure
    const updateData = {
      name: req.body.name.trim(),
      description: req.body.description ? req.body.description.trim() : product.description,
      price: {
        cost: parseFloat(req.body.costPrice),
        selling: parseFloat(req.body.sellingPrice),
        currency: req.body.currency || product.price.currency
      },
      stock: {
        ...product.stock.toObject(),
        quantity: parseInt(req.body.stockQuantity) || product.stock.quantity,
        minStock: parseInt(req.body.minStock) || product.stock.minStock,
        maxStock: parseInt(req.body.maxStock) || product.stock.maxStock,
        unit: req.body.unit || product.stock.unit,
        location: req.body.location || product.stock.location
      },
      tags: req.body.tags ? req.body.tags.split(',').map(tag => tag.trim()).filter(tag => tag) : product.tags,
      status: req.body.status || product.status,
      expiryDate: req.body.expiryDate ? new Date(req.body.expiryDate) : product.expiryDate
    };

    // Handle image upload
    if (req.files && req.files.length > 0) {
      const primaryImageIndex = parseInt(req.body.primaryImageIndex);
      
      updateData.images = req.files.map((file, index) => ({
        url: file.path, // Cloudinary returns the full URL in file.path
        alt: `${req.body.name} image ${index + 1}`,
        isPrimary: false // Don't set as primary for updates by default
      }));
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      message: 'Product updated successfully',
      product: updatedProduct
    });
  } catch (error) {
    console.error('Product update error:', error);
    
    if (error.name === 'ValidationError') {
      const validationErrors = Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message
      }));
      return res.status(400).json({ 
        message: 'Validation failed',
        errors: validationErrors
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to update product',
      error: error.message
    });
  }
});

// DELETE /api/products/:id - Delete product
router.delete('/:id', auth, checkPermission('canDeleteProducts'), async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Reset product counter and reorder IDs
    await resetProductCounter();

    res.json({ 
      message: 'Product deleted successfully',
      deletedProduct: { id: product._id, name: product.name }
    });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

// Function to reset product counter and reorder IDs
async function resetProductCounter() {
  try {
    // Get all products sorted by creation date
    const products = await Product.find().sort({ createdAt: 1 });
    
    // Update each product with a new sequential ID
    for (let i = 0; i < products.length; i++) {
      const product = products[i];
      const newId = i + 1;
      
      if (product.productId !== newId) {
        await Product.findByIdAndUpdate(product._id, { productId: newId });
      }
    }

    // Reset the counter to the number of products
    const Counter = mongoose.model('Counter');
    await Counter.findByIdAndUpdate('productId', { seq: products.length }, { upsert: true });

    console.log(`✅ Product counter reset. Total products: ${products.length}`);
  } catch (error) {
    console.error('❌ Error resetting product counter:', error);
    throw error;
  }
}

// PUT /api/products/:id/stock - Update stock
router.put('/:id/stock', auth, checkPermission('canManageProducts'), async (req, res) => {
  try {
    const { operation, quantity } = req.body;
    
    if (!['add', 'subtract'].includes(operation)) {
      return res.status(400).json({ 
        message: 'Operation must be "add" or "subtract"' 
      });
    }
    
    if (!quantity || quantity <= 0) {
      return res.status(400).json({ 
        message: 'Quantity must be a positive number' 
      });
    }

    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const quantityChange = parseInt(quantity);
    
    if (operation === 'add') {
      product.stock.quantity += quantityChange;
    } else {
      const newQuantity = product.stock.quantity - quantityChange;
      if (newQuantity < 0) {
        return res.status(400).json({ 
          message: `Insufficient stock. Current: ${product.stock.quantity}, Requested: ${quantityChange}` 
        });
      }
      product.stock.quantity = newQuantity;
    }

    await product.save();
    
    res.json({
      message: `Stock ${operation}ed successfully`,
      product: product,
      stockChange: {
        operation,
        quantity: quantityChange,
        newStock: product.stock.quantity
      }
    });
  } catch (error) {
    console.error('Stock update error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
});

module.exports = router;