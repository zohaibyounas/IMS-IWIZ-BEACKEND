const mongoose = require('mongoose');

const FAILSAFE_EMAIL = 'irtazamadadnaqvi@iwiz.com';

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters']
  },
  role: {
    type: String,
    enum: ['admin', 'manager', 'employee'],
    default: 'employee'
  },
  phone: {
    type: String,
    trim: true,
    maxlength: [20, 'Phone number cannot exceed 20 characters']
  },
  avatar: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  },
  permissions: {
    canViewProducts: {
      type: Boolean,
      default: true
    },
    canAddProducts: {
      type: Boolean,
      default: false
    },
    canEditProducts: {
      type: Boolean,
      default: false
    },
    canDeleteProducts: {
      type: Boolean,
      default: false
    },
    canManageProducts: {
      type: Boolean,
      default: false
    },
    canViewOrders: {
      type: Boolean,
      default: true
    },
    canManageOrders: {
      type: Boolean,
      default: false
    },
    canManageUsers: {
      type: Boolean,
      default: false
    },
    canRequestHandover: {
      type: Boolean,
      default: false
    },
    canReturnHandover: {
      type: Boolean,
      default: false
    }
  },
  lastLogin: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

userSchema.methods.comparePassword = function(candidatePassword) {
  return candidatePassword === this.password;
};

userSchema.methods.hasPermission = function(permission) {
  return this.permissions[permission] === true;
};

userSchema.methods.isAdmin = function() {
  return this.role === 'admin';
};

userSchema.methods.isManagerOrAbove = function() {
  return this.role === 'admin' || this.role === 'manager';
};

userSchema.methods.isFailsafeAdmin = function() {
  return this.email === FAILSAFE_EMAIL;
};

userSchema.pre('save', function(next) {
  if (this.email === FAILSAFE_EMAIL) {
    this.isActive = true;
    this.role = 'admin';
    this.permissions = {
      canViewProducts: true,
      canAddProducts: true,
      canEditProducts: true,
      canDeleteProducts: true,
      canManageProducts: true,
      canViewOrders: true,
      canManageOrders: true,
      canManageUsers: true,
      canRequestHandover: false,
      canReturnHandover: false,
    };
  } else {
    // Auto-sync permissions with role for all other users
    this.permissions = {
      canViewProducts: true,
      canAddProducts: this.role === 'admin' || this.role === 'manager',
      canEditProducts: this.role === 'admin' || this.role === 'manager',
      canDeleteProducts: this.role === 'admin',
      canManageProducts: this.role === 'admin' || this.role === 'manager',
      canViewOrders: true,
      canManageOrders: this.role === 'admin' || this.role === 'manager',
      canManageUsers: this.role === 'admin',
      canRequestHandover: this.role === 'employee',
      canReturnHandover: this.role === 'employee',
    };
  }
  next();
});

userSchema.pre('remove', function(next) {
  if (this.email === FAILSAFE_EMAIL) {
    return next(new Error('Cannot delete failsafe admin account'));
  }
  next();
});

userSchema.pre('findOneAndDelete', function(next) {
  const email = this.getQuery().email;
  if (email === FAILSAFE_EMAIL) {
    return next(new Error('Cannot delete failsafe admin account'));
  }
  next();
});

userSchema.pre('findByIdAndDelete', function(next) {
  if (this._conditions && this._conditions._id) {
    User.findById(this._conditions._id).then(user => {
      if (user && user.email === FAILSAFE_EMAIL) {
        return next(new Error('Cannot delete failsafe admin account'));
      }
      next();
    }).catch(next);
  } else {
    next();
  }
});

module.exports = mongoose.model('User', userSchema);