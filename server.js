const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Import upload configurations
const { uploadConfigs, handleMulterError } = require('./middleware/upload');



const app = express();

const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';



// CORS configuration
const allowedOrigins = process.env.NODE_ENV === 'production' 
  ? [
      // Vercel domains (existing)
      'https://iwiz-inventory.vercel.app', 
      'https://iwiz-inventory-git-main.vercel.app',
      'https://ims-iwiz-solutions.vercel.app',
      'https://ims-iwiz-solutions-git-main.vercel.app',
      'https://iwiz-inventory.vercel.app',
      'https://iwiz-inventory-git-main.vercel.app',
      // Add any vercel.app domain for flexibility
      /^https:\/\/.*\.vercel\.app$/,
      // Allow any localhost for development
      /^https?:\/\/localhost:\d+$/,
      /^https?:\/\/127\.0\.0\.1:\d+$/
    ]
  : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is in allowed list
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return allowedOrigin === origin;
      } else if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return false;
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));



// Handle preflight requests
app.options('*', cors());



mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 10000, // 10 seconds timeout
  socketTimeoutMS: 45000, // 45 seconds timeout
  connectTimeoutMS: 10000 // 10 seconds timeout
});

const db = mongoose.connection;

db.on('error', (err) => {
  console.error('MongoDB connection error:', err);
  console.error('Error details:', err.message);
});

db.on('connected', () => {
  // MongoDB connected successfully
});

db.on('disconnected', () => {
  // MongoDB disconnected
});

db.once('open', () => {
  // MongoDB connection opened
});

if (NODE_ENV === 'development') {
  
}

// Lightweight health check for uptime monitoring
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: NODE_ENV,
    allowedOrigins: allowedOrigins
  });
});

// Ultra-lightweight uptime monitoring endpoint for UptimeRobot
app.get('/api/uptime', (req, res) => {
  // Minimal response for faster monitoring
  res.status(200).json({
    status: 'UP',
    uptime: process.uptime(),
    timestamp: Date.now()
  });
});

// Super lightweight ping endpoint for UptimeRobot
app.get('/api/ping', (req, res) => {
  // Minimal response - just "pong"
  res.status(200).send('pong');
});

// Text-based health check for simple monitoring
app.get('/api/status', (req, res) => {
  res.status(200).send('OK');
});

// Comprehensive monitoring endpoint
app.get('/api/monitor', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // Check database connection
    const dbState = mongoose.connection.readyState;
    const isDbConnected = dbState === 1;
    
    // Check memory usage
    const memUsage = process.memoryUsage();
    
    // Calculate response time
    const responseTime = Date.now() - startTime;
    
    res.json({
      status: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: NODE_ENV,
      database: {
        status: isDbConnected ? 'connected' : 'disconnected',
        state: dbState
      },
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB',
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB'
      },
      responseTime: responseTime + 'ms'
    });
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Database health check endpoint
app.get('/api/health/db', async (req, res) => {
  try {
    // Quick database connectivity test
    const dbState = mongoose.connection.readyState;
    const isConnected = dbState === 1; // 1 = connected
    
    if (isConnected) {
      res.json({
        status: 'OK',
        database: 'connected',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'ERROR',
        database: 'disconnected',
        state: dbState,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(500).json({
      status: 'ERROR',
      database: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// CORS test endpoint
app.get('/api/cors-test', (req, res) => {
  res.json({
    message: 'CORS is working!',
    origin: req.headers.origin,
    timestamp: new Date().toISOString()
  });
});

// Configuration test endpoint
app.get('/api/config-test', (req, res) => {
  res.json({
    environment: process.env.NODE_ENV,
    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME || 'Not Set',
      apiKey: process.env.CLOUDINARY_API_KEY ? 'Set' : 'Not Set',
      apiSecret: process.env.CLOUDINARY_API_SECRET ? 'Set' : 'Not Set'
    },
    mongodb: process.env.MONGODB_URI ? 'Set' : 'Not Set',
    timestamp: new Date().toISOString()
  });
});

// Avatar upload test endpoint
app.post('/api/test-avatar-upload', uploadConfigs.avatar, handleMulterError, (req, res) => {
  try {
    
    if (req.file) {
      res.json({
        success: true,
        message: 'Avatar upload test successful',
        file: {
          path: req.file.path,
          filename: req.file.filename,
          originalname: req.file.originalname
        }
      });
    } else {
      res.json({
        success: false,
        message: 'No file uploaded'
      });
    }
  } catch (error) {
    console.error('Test avatar upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Test upload failed',
      error: error.message
    });
  }
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/products', require('./routes/products'));
app.use('/api/users', require('./routes/users'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/handovers', require('./routes/handovers'));

app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

// Add startup timeout to prevent infinite hanging
const startupTimeout = setTimeout(() => {
  console.error('Startup timeout reached. Server failed to start within 30 seconds.');
  process.exit(1);
}, 30000);

const server = app.listen(PORT, () => {
  clearTimeout(startupTimeout);
  console.log(`Server running on port ${PORT}`);
  console.log('IWIZ Solutions Inventory Management System');
});

// Add error handling for server
server.on('error', (error) => {
  console.error('Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error('Port is already in use');
  }
});

// Add graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    process.exit(0);
  });
});