const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');

// Configure Cloudinary


cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Create Cloudinary storage for avatars
const avatarStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'iwiz-inventory/avatars',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [{ width: 300, height: 300, crop: 'fill' }]
  }
});

// Create Cloudinary storage for product images
const productStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'iwiz-inventory/products',
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [{ width: 800, height: 600, crop: 'limit' }]
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'), false);
  }
};

// Create multer instances for different upload types
const avatarUpload = multer({
  storage: avatarStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

const productUpload = multer({
  storage: productStorage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

const uploadConfigs = {
  avatar: avatarUpload.single('avatar'),
  productImages: productUpload.array('productImages', 20)
};

const handleMulterError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'File too large. Maximum size is 10MB.' });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ message: 'Too many files. Maximum is 20 files.' });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ message: 'Unexpected file field.' });
    }
    return res.status(400).json({ message: 'File upload error.' });
  }
  
  if (error) {
    return res.status(400).json({ message: error.message });
  }
  
  next();
};

const getFileUrl = (filename, type = 'product') => {
  if (!filename) return null;
  
  // If filename is already a Cloudinary URL, return it as is
  if (filename.startsWith('http')) {
    return filename;
  }
  
  // For backward compatibility with old local filenames
  // Return a placeholder or default image
  return 'https://via.placeholder.com/300x300?text=Image+Not+Found';
};

const validateFileExists = (filePath) => {
  // For Cloudinary, we assume the file exists if it's a valid URL
  if (filePath && filePath.startsWith('http')) {
    return true;
  }
  return false;
};

// Function to delete file from Cloudinary
const deleteFile = async (publicId) => {
  try {
    if (publicId && publicId.startsWith('http')) {
      // Extract public ID from URL
      const urlParts = publicId.split('/');
      const filename = urlParts[urlParts.length - 1];
      const folder = urlParts[urlParts.length - 2];
      const publicIdToDelete = `iwiz-inventory/${folder}/${filename.split('.')[0]}`;
      
      await cloudinary.uploader.destroy(publicIdToDelete);
    }
  } catch (error) {
    console.error('Error deleting file from Cloudinary:', error);
  }
};

module.exports = {
  upload: multer,
  uploadConfigs,
  handleMulterError,
  getFileUrl,
  validateFileExists,
  deleteFile,
  cloudinary
};