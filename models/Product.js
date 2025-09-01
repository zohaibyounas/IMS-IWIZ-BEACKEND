const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});

const Counter = mongoose.model('Counter', counterSchema);

const productSchema = new mongoose.Schema({
  productId: {
    type: Number,
    unique: true,
    required: false,
    sparse: true // Allow multiple null values
  },
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: [100, 'Product name cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  price: {
    cost: {
      type: Number,
      required: [true, 'Cost price is required'],
      min: [0, 'Cost price cannot be negative']
    },
    selling: {
      type: Number,
      required: [true, 'Selling price is required'],
      min: [0, 'Selling price cannot be negative']
    },
    currency: {
      type: String,
      default: 'PKR',
      enum: ['PKR']
    }
  },
  stock: {
    quantity: {
      type: Number,
      required: [true, 'Stock quantity is required'],
      min: [0, 'Stock quantity cannot be negative'],
      default: 0
    },
    minStock: {
      type: Number,
      default: 0,
      min: [0, 'Minimum stock cannot be negative']
    },
    maxStock: {
      type: Number,
      default: 1000,
      min: [0, 'Maximum stock cannot be negative']
    },
    unit: {
      type: String,
      default: 'pcs',
      enum: ['pcs', 'kg', 'lbs', 'liters', 'meters', 'boxes']
    },
    location: {
      type: String,
      trim: true
    },
    lastRestocked: {
      type: Date,
      default: Date.now
    }
  },
  images: {
    type: [{
      url: String,
      alt: String,
      isPrimary: { type: Boolean, default: false }
    }],
    validate: {
      validator: function(images) {
        return images.length >= 1 && images.length <= 20;
      },
      message: 'Product must have between 1 and 20 images'
    }
  },
  tags: [String],
  status: {
    type: String,
    enum: ['active', 'inactive', 'discontinued'],
    default: 'active'
  },
  expiryDate: Date,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Auto-increment function
productSchema.pre('save', async function(next) {
  if (this.isNew && !this.productId) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        'productId',
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      this.productId = counter.seq;
    } catch (error) {
      console.error('Error generating product ID:', error);
      // If counter fails, use timestamp as fallback
      this.productId = Date.now();
    }
  }
  
  if (this.isModified('stock.quantity')) {
    this.stock.lastRestocked = new Date();
  }
  next();
});

// Simple indexes for better performance
productSchema.index({ name: 1 });
productSchema.index({ productId: 1 });
productSchema.index({ status: 1 });
productSchema.index({ 'stock.quantity': 1 });
productSchema.index({ createdAt: -1 });
productSchema.index({ name: 1, status: 1 });
productSchema.index({ 'stock.quantity': 1, status: 1 });

productSchema.virtual('isOutOfStock').get(function() {
  return this.stock.quantity === 0;
});

productSchema.virtual('profitMargin').get(function() {
  if (this.price.cost > 0) {
    return ((this.price.selling - this.price.cost) / this.price.cost) * 100;
  }
  return 0;
});

module.exports = mongoose.model('Product', productSchema);