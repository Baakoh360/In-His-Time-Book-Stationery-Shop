// server.js
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Check for required environment variables
const requiredEnvVars = [
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'MONGODB_URI'
];

for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
        console.error(`Missing required environment variable: ${envVar}`);
        console.error('Please check your .env file and ensure all required variables are set.');
        process.exit(1);
    }
}

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Test Cloudinary connection
cloudinary.api.ping()
    .then(() => console.log('Cloudinary connected successfully'))
    .catch(err => {
        console.error('Cloudinary connection failed:', err);
        console.error('Please check your Cloudinary credentials in the .env file');
    });

// Configure Cloudinary storage for multer
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'product-images',
        allowed_formats: ['jpeg', 'jpg', 'png', 'gif']
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function(req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'));
        }
    }
});

// Connect to MongoDB Atlas
const MONGODB_URI = process.env.MONGODB_URI;
mongoose.connect(MONGODB_URI, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    })
    .then(() => console.log('MongoDB Atlas connected'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

// Product Schema and Model
const productSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true },
    category: { type: String, required: true },
    description: { type: String },
    imageUrl: { type: String },
    publicId: { type: String }, // To store Cloudinary public_id for deletions
    inStock: { type: Boolean, default: true },
    createdAt: { type: Date, default: Date.now }
});

const Product = mongoose.model('Product', productSchema);

// API Routes

// Get all products
app.get('/api/products', async(req, res) => {
    try {
        const products = await Product.find().sort({ createdAt: -1 });
        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ message: 'Failed to fetch products' });
    }
});

// Get products by category
app.get('/api/products/category/:category', async(req, res) => {
    try {
        const { category } = req.params;
        const products = await Product.find({ category }).sort({ createdAt: -1 });
        res.json(products);
    } catch (error) {
        console.error('Error fetching products by category:', error);
        res.status(500).json({ message: 'Failed to fetch products by category' });
    }
});

// Get a single product
app.get('/api/products/:id', async(req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }
        res.json(product);
    } catch (error) {
        console.error('Error fetching product:', error);
        res.status(500).json({ message: 'Failed to fetch product' });
    }
});

// Create a new product
app.post('/api/products', upload.single('image'), async(req, res) => {
    try {
        const { name, price, category, description, inStock } = req.body;

        // Validate required fields
        if (!name || !price || !category) {
            return res.status(400).json({ message: 'Name, price, and category are required' });
        }

        // Default image URL in case no image is uploaded
        let imageUrl = `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/v1/product-images/default-product.jpg`;
        let publicId = null;

        // If file was uploaded, use its URL
        if (req.file) {
            imageUrl = req.file.path;
            publicId = req.file.filename;
        }

        const newProduct = new Product({
            name,
            price: parseFloat(price),
            category,
            description: description || '',
            inStock: inStock === 'true',
            imageUrl,
            publicId
        });

        const savedProduct = await newProduct.save();
        res.status(201).json(savedProduct);
    } catch (error) {
        console.error('Error creating product:', error);

        // Handle Cloudinary specific errors
        if (error.message && error.message.includes('Must supply api_key')) {
            return res.status(500).json({
                message: 'Image upload configuration error. Please check server settings.'
            });
        }

        res.status(500).json({ message: 'Failed to create product: ' + error.message });
    }
});

// Update a product
app.put('/api/products/:id', upload.single('image'), async(req, res) => {
    try {
        const { name, price, category, description, inStock } = req.body;
        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const updateData = {
            name,
            price: parseFloat(price),
            category,
            description: description || '',
            inStock: inStock === 'true'
        };

        // Only update image if a new one is uploaded
        if (req.file) {
            updateData.imageUrl = req.file.path;
            updateData.publicId = req.file.filename;

            // Delete old image from Cloudinary if it exists and is not the default
            if (product.publicId) {
                try {
                    await cloudinary.uploader.destroy(product.publicId);
                } catch (deleteError) {
                    console.error('Error deleting old image:', deleteError);
                }
            }
        }

        const updatedProduct = await Product.findByIdAndUpdate(
            req.params.id,
            updateData, { new: true }
        );

        res.json(updatedProduct);
    } catch (error) {
        console.error('Error updating product:', error);

        // Handle Cloudinary specific errors
        if (error.message && error.message.includes('Must supply api_key')) {
            return res.status(500).json({
                message: 'Image upload configuration error. Please check server settings.'
            });
        }

        res.status(500).json({ message: 'Failed to update product: ' + error.message });
    }
});

// Delete a product
app.delete('/api/products/:id', async(req, res) => {
    try {
        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        // Delete product image from Cloudinary if it exists and is not the default
        if (product.publicId) {
            try {
                await cloudinary.uploader.destroy(product.publicId);
            } catch (deleteError) {
                console.error('Error deleting image from Cloudinary:', deleteError);
            }
        }

        await Product.findByIdAndDelete(req.params.id);
        res.json({ message: 'Product deleted successfully' });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ message: 'Failed to delete product' });
    }
});

// Serve HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Handle 404
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);

    // Handle multer errors
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: 'File too large. Maximum size is 5MB.' });
        }
    }

    // Handle Cloudinary errors
    if (err.message && err.message.includes('Must supply api_key')) {
        return res.status(500).json({
            message: 'Image upload service configuration error. Please contact administrator.'
        });
    }

    res.status(500).json({ message: err.message || 'Something went wrong!' });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
    console.log(`Website: http://localhost:${PORT}`);
});