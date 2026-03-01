const mysql = require('mysql2');

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

const promisePool = pool.promise();

const initializeDatabase = async () => {
  try {
    // Create database if not exists
    await promisePool.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'expiratrack'}`);
    await promisePool.query(`USE ${process.env.DB_NAME || 'expiratrack'}`);
    
    // Create users table
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        shop_name VARCHAR(255) NOT NULL,
        place VARCHAR(100) DEFAULT 'Not set',
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        profile_photo VARCHAR(255) DEFAULT 'default-avatar.png',
        photo_updated_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_phone (phone)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    
    // Create products table with user_id column
    await promisePool.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        batch_number VARCHAR(100) NOT NULL,
        quantity VARCHAR(50) NOT NULL,
        manufacture_date DATE NOT NULL,
        expiry_date DATE NOT NULL,
        supplier_name VARCHAR(255) NOT NULL,
        status ENUM('fresh', 'expiring', 'urgent', 'expired') DEFAULT 'fresh',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_expiry (expiry_date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    
    console.log('✅ Database initialized successfully with products table');
    
    // Verify the table was created
    const [tables] = await promisePool.query("SHOW TABLES LIKE 'products'");
    if (tables.length > 0) {
      console.log('✅ Products table exists');
      
      // Check the structure
      const [columns] = await promisePool.query("DESCRIBE products");
      console.log('📊 Products table columns:', columns.map(c => c.Field).join(', '));
    }
    
  } catch (error) {
    console.error('❌ Database initialization error:', error);
    throw error;
  }
};

module.exports = { promisePool, initializeDatabase };