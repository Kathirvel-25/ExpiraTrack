require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { initializeDatabase } = require('./config/database');
const authRoutes = require('./routes/auth');

const app = express();
const PORT = process.env.PORT || 5000;
const DB_PORT = process.env.DB_PORT || 3306;

// Create MySQL connection pool
const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'AKkathirvel0725',
    database: process.env.DB_NAME || 'expiratrack',
    port: DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Middleware
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:5000', 'http://localhost:8080', 'http://127.0.0.1:5500'],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// ============= UPLOAD DIRECTORY SETUP =============
const uploadDir = 'C:/temp/expiratrack-uploads/profiles';
console.log('📁 Upload directory:', uploadDir);

try {
    if (!fs.existsSync('C:/temp')) {
        fs.mkdirSync('C:/temp', { recursive: true });
    }
    if (!fs.existsSync('C:/temp/expiratrack-uploads')) {
        fs.mkdirSync('C:/temp/expiratrack-uploads', { recursive: true });
    }
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log('✅ Created upload directory');
    }
    
    const testFile = path.join(uploadDir, 'test.txt');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log('✅ Upload directory is writable');
} catch (err) {
    console.error('❌ Failed to create upload directory:', err);
    process.exit(1);
}

app.use('/uploads', express.static(uploadDir));

// Multer setup
const storage = multer.memoryStorage();
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
        return cb(null, true);
    } else {
        cb(new Error('Only image files are allowed'));
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 }
});

// ============= AUTHENTICATION MIDDLEWARE =============
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// ============= ALL API ROUTES GO HERE =============

// Auth routes (OTP removed - now only traditional register/login)
app.use('/api', authRoutes);

// ============= USER PROFILE ENDPOINTS =============
app.get('/api/user/profile', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const userId = req.user.userId;
        const [users] = await connection.execute(
            `SELECT name as full_name, phone, email, COALESCE(place, 'Not set') as place, shop_name, COALESCE(profile_photo, 'default-avatar.png') as profile_photo FROM users WHERE id = ?`,
            [userId]
        );
        if (users.length === 0) return res.status(404).json({ message: 'User not found' });
        const user = users[0];
        if (user.profile_photo && user.profile_photo !== 'default-avatar.png') {
            if (!user.profile_photo.startsWith('/uploads/')) {
                user.profile_photo = `/uploads/${path.basename(user.profile_photo)}`;
            }
            user.profile_photo = `http://localhost:${PORT}${user.profile_photo}`;
        }
        res.json({ success: true, data: user });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching profile' });
    } finally {
        connection.release();
    }
});

app.put('/api/user/update-profile', authenticateToken, async (req, res) => {
    const { full_name, shop_name, email, phone, place } = req.body;
    const userId = req.user.userId;
    if (!full_name || !shop_name || !email || !phone || !place) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    const connection = await pool.getConnection();
    try {
        const [emailCheck] = await connection.execute('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]);
        if (emailCheck.length > 0) return res.status(409).json({ success: false, message: 'Email already in use' });
        const [phoneCheck] = await connection.execute('SELECT id FROM users WHERE phone = ? AND id != ?', [phone, userId]);
        if (phoneCheck.length > 0) return res.status(409).json({ success: false, message: 'Phone number already in use' });
        
        await connection.execute(`UPDATE users SET name = ?, shop_name = ?, email = ?, phone = ?, place = ? WHERE id = ?`,
            [full_name, shop_name, email, phone, place, userId]);
        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ success: false, message: 'Server error while updating profile' });
    } finally {
        connection.release();
    }
});

app.put('/api/user/upload-avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const connection = await pool.getConnection();
    try {
        const userId = req.user.userId;
        const timestamp = Date.now();
        const filename = `avatar_${userId}_${timestamp}.jpg`;
        const filepath = path.join(uploadDir, filename);
        const publicPath = `/uploads/${filename}`;
        
        await sharp(req.file.buffer).resize(300, 300, { fit: 'cover' }).jpeg({ quality: 90 }).toFile(filepath);
        
        const [user] = await connection.execute('SELECT profile_photo FROM users WHERE id = ?', [userId]);
        if (user.length > 0 && user[0].profile_photo && user[0].profile_photo !== 'default-avatar.png') {
            const oldFilename = path.basename(user[0].profile_photo);
            const oldPhotoPath = path.join(uploadDir, oldFilename);
            if (fs.existsSync(oldPhotoPath)) fs.unlinkSync(oldPhotoPath);
        }
        
        await connection.execute('UPDATE users SET profile_photo = ?, photo_updated_at = NOW() WHERE id = ?', [publicPath, userId]);
        const photoUrl = `http://localhost:${PORT}${publicPath}`;
        res.json({ success: true, message: 'Avatar uploaded successfully', photoUrl });
    } catch (error) {
        console.error('Avatar upload error:', error);
        res.status(500).json({ success: false, message: 'Error uploading avatar' });
    } finally {
        connection.release();
    }
});

app.delete('/api/user/profile-photo', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const userId = req.user.userId;
        const [user] = await connection.execute('SELECT profile_photo FROM users WHERE id = ?', [userId]);
        if (user.length > 0 && user[0].profile_photo && user[0].profile_photo !== 'default-avatar.png') {
            const filename = path.basename(user[0].profile_photo);
            const photoPath = path.join(uploadDir, filename);
            if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
        }
        await connection.execute('UPDATE users SET profile_photo = "default-avatar.png", photo_updated_at = NULL WHERE id = ?', [userId]);
        res.json({ success: true, message: 'Profile photo removed' });
    } catch (error) {
        console.error('Photo delete error:', error);
        res.status(500).json({ success: false, message: 'Error removing photo' });
    } finally {
        connection.release();
    }
});

// ============= PRODUCT ENDPOINTS =============
app.get('/api/products', authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const userId = req.user.userId;
        const [products] = await connection.execute(
            `SELECT id, product_name, batch_number, quantity, DATE_FORMAT(manufacture_date, '%d %b %Y') as manufacture_date, DATE_FORMAT(expiry_date, '%d %b %Y') as expiry_date, supplier_name, status FROM products WHERE user_id = ? ORDER BY created_at DESC`,
            [userId]
        );
        res.json({ success: true, data: products });
    } catch (error) {
        console.error('Products fetch error:', error);
        res.status(500).json({ success: false, message: 'Server error while fetching products' });
    } finally {
        connection.release();
    }
});

app.post('/api/products', authenticateToken, async (req, res) => {
    console.log('📦 Add product request received:', req.body);
    console.log('👤 User from token:', req.user);
    
    const { product_name, batch_number, quantity, manufacture_date, expiry_date, supplier_name } = req.body;
    const userId = req.user?.userId;
    
    console.log('📊 User ID:', userId);
    
    if (!userId) {
        return res.status(401).json({ success: false, message: 'Invalid user token' });
    }
    
    if (!product_name || !batch_number || !quantity || !manufacture_date || !expiry_date || !supplier_name) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }
    
    const connection = await pool.getConnection();
    try {
        const today = new Date();
        const expiry = new Date(expiry_date);
        const diffTime = expiry - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        let status = 'fresh';
        if (diffDays < 0) status = 'expired';
        else if (diffDays <= 3) status = 'urgent';
        else if (diffDays <= 7) status = 'expiring';
        
        console.log('📅 Status calculated:', status);
        
        const [result] = await connection.execute(
            `INSERT INTO products (user_id, product_name, batch_number, quantity, manufacture_date, expiry_date, supplier_name, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, product_name, batch_number, quantity, manufacture_date, expiry_date, supplier_name, status]
        );

        console.log('✅ Product added. ID:', result.insertId);

        const [newProduct] = await connection.execute(
            `SELECT id, product_name, batch_number, quantity, DATE_FORMAT(manufacture_date, '%d %b %Y') as manufacture_date, DATE_FORMAT(expiry_date, '%d %b %Y') as expiry_date, supplier_name, status FROM products WHERE id = ?`,
            [result.insertId]
        );

        res.json({ success: true, message: 'Product added successfully', data: newProduct[0] });
    } catch (error) {
        console.error('❌ Add product error:', error);
        res.status(500).json({ success: false, message: 'Server error: ' + error.message });
    } finally {
        connection.release();
    }
});

app.delete('/api/products/:id', authenticateToken, async (req, res) => {
    const productId = req.params.id;
    const userId = req.user.userId;
    const connection = await pool.getConnection();
    try {
        const [result] = await connection.execute('DELETE FROM products WHERE id = ? AND user_id = ?', [productId, userId]);
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Product not found' });
        res.json({ success: true, message: 'Product deleted successfully' });
    } catch (error) {
        console.error('Delete product error:', error);
        res.status(500).json({ success: false, message: 'Server error while deleting product' });
    } finally {
        connection.release();
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString(), server_port: PORT });
});

// ============= START SERVER =============
const startServer = async () => {
    try {
        await initializeDatabase();
        
        app.listen(PORT, () => {
            console.log('\n' + '='.repeat(50));
            console.log(`🚀 Server running on http://localhost:${PORT}`);
            console.log('='.repeat(50));
            console.log(`📝 API endpoints:`);
            console.log(`   POST  /api/register (traditional registration)`);
            console.log(`   POST  /api/login`);
            console.log(`   GET   /api/user/profile`);
            console.log(`   PUT   /api/user/update-profile`);
            console.log(`   PUT   /api/user/upload-avatar`);
            console.log(`   DELETE /api/user/profile-photo`);
            console.log(`   GET   /api/products`);
            console.log(`   POST  /api/products`);
            console.log(`   DELETE /api/products/:id`);
            console.log('='.repeat(50));
            console.log(`📸 Upload directory: ${uploadDir}`);
            console.log('='.repeat(50));
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();