const Product = require('../models/Product');
const { validationResult } = require('express-validator');

class ProductController {
  async getAllProducts(req, res) {
    try {
      const { page = 1, limit = 10, search, status } = req.query;
      const query = {};
      
      if (search) {
        query.$or = [
          { name: { $regex: search, $options: 'i' } },
          { description: { $regex: search, $options: 'i' } },
          { productId: isNaN(search) ? null : parseInt(search) }
        ].filter(condition => condition !== null);
      }
      
      if (status) {
        query.status = status;
      }
      
      const products = await Product.find(query)
        .select('productId name description price stock status images tags createdAt createdBy updatedBy updatedAt')
        .populate('createdBy', 'firstName lastName')
        .populate('updatedBy', 'firstName lastName')
        .lean()
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit))
        .sort({ createdAt: -1 });

      const total = await Product.countDocuments(query);

      res.json({
        products,
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page),
        total
      });
    } catch (error) {
      console.error('Get all products error:', error);
      res.status(500).json({ message: error.message });
    }
  }

  async createProduct(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      // Transform frontend data to match Product model structure
      const {
        name,
        description,
        costPrice,
        sellingPrice,
        stockQuantity,
        minStockLevel,
        unit,
        location,
        tags,
        status
      } = req.body;

      // Process uploaded images
      const images = [];
      const primaryImageIndex = parseInt(req.body.primaryImageIndex) || 0;
      
      if (req.files && req.files.length > 0) {
        req.files.forEach((file, index) => {
          images.push({
            url: file.path, // Cloudinary returns the full URL in file.path
            alt: `${name} image ${index + 1}`,
            isPrimary: index === primaryImageIndex
          });
        });
      }

      // Validate that at least one image is provided
      if (images.length === 0) {
        return res.status(400).json({ 
          message: 'At least one product image is required' 
        });
      }

      // Create product with correct data structure
      const product = new Product({
        name,
        description,
        price: {
          cost: parseFloat(costPrice) || 0,
          selling: parseFloat(sellingPrice) || 0,
          currency: 'PKR'
        },
        stock: {
          quantity: parseInt(stockQuantity) || 0,
          minStock: parseInt(minStockLevel) || 0,
          unit: unit || 'pcs',
          location: location || ''
        },
        images,
        tags: tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [],
        status: status || 'active',
        createdBy: req.user.id
      });

      await product.save();
      
      res.status(201).json({
        message: 'Product created successfully',
        data: product
      });
    } catch (error) {
      console.error('Create product error:', error);
      res.status(400).json({ 
        message: error.message || 'Failed to create product',
        error: error.name === 'ValidationError' ? error.errors : undefined
      });
    }
  }

  async updateProduct(req, res) {
    try {
      const { id } = req.params;
      
      // Transform frontend data to match Product model structure
      const {
        name,
        description,
        costPrice,
        sellingPrice,
        stockQuantity,
        minStockLevel,
        unit,
        location,
        tags,
        status
      } = req.body;

      // Get existing product to check current images
      const existingProduct = await Product.findById(id);
      if (!existingProduct) {
        return res.status(404).json({ message: 'Product not found' });
      }

      // Process uploaded images
      const newImages = [];
      const primaryImageIndex = parseInt(req.body.primaryImageIndex);
      
      if (req.files && req.files.length > 0) {
        req.files.forEach((file, index) => {
          newImages.push({
            url: file.path, // Cloudinary returns the full URL in file.path
            alt: `${name} image ${index + 1}`,
            isPrimary: false // Don't set as primary for updates by default
          });
        });
      }

      // Combine existing images with new ones
      const allImages = [...(existingProduct.images || []), ...newImages];
      
      // Validate total image count
      if (allImages.length > 20) {
        return res.status(400).json({ 
          message: 'Maximum 20 images allowed per product' 
        });
      }

      const updateData = {
        name,
        description,
        price: {
          cost: parseFloat(costPrice) || 0,
          selling: parseFloat(sellingPrice) || 0,
          currency: 'PKR'
        },
        stock: {
          quantity: parseInt(stockQuantity) || 0,
          minStock: parseInt(minStockLevel) || 0,
          unit: unit || 'pcs',
          location: location || ''
        },
        tags: tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [],
        status: status || 'active',
        updatedBy: req.user.id
      };

      if (newImages.length > 0) {
        updateData.images = allImages;
      }

      const product = await Product.findByIdAndUpdate(
        id,
        updateData,
        { new: true, runValidators: true }
      );

      if (!product) {
        return res.status(404).json({ message: 'Product not found' });
      }

      res.json({
        message: 'Product updated successfully',
        data: product
      });
    } catch (error) {
      console.error('Update product error:', error);
      res.status(400).json({ 
        message: error.message || 'Failed to update product',
        error: error.name === 'ValidationError' ? error.errors : undefined
      });
    }
  }

  async deleteProduct(req, res) {
    try {
      const { id } = req.params;
      const product = await Product.findByIdAndDelete(id);

      if (!product) {
        return res.status(404).json({ message: 'Product not found' });
      }

      res.json({ message: 'Product deleted successfully' });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }

  async getProductById(req, res) {
    try {
      const product = await Product.findById(req.params.id)
        .populate('createdBy', 'firstName lastName')
        .populate('updatedBy', 'firstName lastName')
        .select('-__v')
        .lean();
      
      if (!product) {
        return res.status(404).json({ message: 'Product not found' });
      }
      res.json(product);
    } catch (error) {
      console.error('Get product by ID error:', error);
      res.status(500).json({ message: error.message });
    }
  }
}

module.exports = new ProductController();