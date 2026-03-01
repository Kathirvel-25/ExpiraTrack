const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'AKkathirvel0725',
    database: process.env.DB_NAME || 'expiratrack',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Traditional Registration (without OTP)
router.post('/register', async (req, res) => {
    console.log('📝 Registration request received');
    const { full_name, shop_name, email, phone, place, password } = req.body;

    if (!full_name || !shop_name || !email || !phone || !place || !password) {
        return res.status(400).json({ success: false, message: 'All fields are required' });
    }

    const connection = await pool.getConnection();
    try {
        // Check if email already exists
        const [existingEmail] = await connection.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existingEmail.length > 0) {
            return res.status(409).json({ success: false, message: 'Email already registered' });
        }

        // Check if phone already exists
        const [existingPhone] = await connection.execute('SELECT id FROM users WHERE phone = ?', [phone]);
        if (existingPhone.length > 0) {
            return res.status(409).json({ success: false, message: 'Phone number already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Insert user
        const [result] = await connection.execute(
            `INSERT INTO users (name, shop_name, email, phone, place, password) VALUES (?, ?, ?, ?, ?, ?)`,
            [full_name, shop_name, email, phone, place, hashedPassword]
        );

        // Generate JWT token
        const token = jwt.sign(
            { userId: result.insertId, email: email },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );

        res.status(201).json({
            success: true,
            message: 'Registration successful',
            token,
            user: {
                id: result.insertId,
                name: full_name,
                email,
                phone
            }
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ success: false, message: 'Server error during registration' });
    } finally {
        connection.release();
    }
});

// Login (unchanged)
router.post('/login', async (req, res) => {
    console.log('🔐 Login attempt for:', req.body.email || req.body.phone);
    const { email, phone, password } = req.body;

    if ((!email && !phone) || !password) {
        return res.status(400).json({ success: false, message: 'Email/phone and password are required' });
    }

    const connection = await pool.getConnection();
    try {
        let query, params;
        if (email) {
            query = 'SELECT * FROM users WHERE email = ?';
            params = [email];
        } else {
            query = 'SELECT * FROM users WHERE phone = ?';
            params = [phone];
        }

        const [users] = await connection.execute(query, params);
        
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password);
        
        if (!validPassword) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                shop_name: user.shop_name
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error during login' });
    } finally {
        connection.release();
    }
});

module.exports = router;