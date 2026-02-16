// index.js
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Setup SQLite database
const db = new sqlite3.Database('./juslearn.db', (err) => {
  if (err) console.error(err.message);
  else console.log('Connected to SQLite database.');
});

// ==========================
// DATABASE INITIALIZATION & SEEDING
// ==========================
db.serialize(() => {
  // Drop tables in the correct order to respect foreign key constraints
  db.run(`DROP TABLE IF EXISTS assignments`);
  db.run(`DROP TABLE IF EXISTS topics`);
  db.run(`DROP TABLE IF EXISTS users`); 

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      email TEXT UNIQUE,
      password TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY, 
      module_name TEXT,
      topic_name TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      topic_id INTEGER,
      file_path TEXT,
      marks INTEGER DEFAULT 0,
      completed INTEGER DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `);

  // SEEDING TOPICS DATA
  const topicsToInsert = [
    // OS Topics (IDs 1-6)
    [1, 'Operating Systems', 'Process Scheduling'],
    [2, 'Operating Systems', 'Inter-process Communication'],
    [3, 'Operating Systems', 'Paging & Segmentation'],
    [4, 'Operating Systems', 'Virtual Memory'],
    [5, 'Operating Systems', 'File Allocation'],
    [6, 'Operating Systems', 'Directory Structures'],
    
    // DBMS Topics (IDs 7-10)
    [7, 'DBMS', 'ER Diagrams'],
    [8, 'DBMS', 'Normalization'],
    [9, 'DBMS', 'Select Queries'],
    [10, 'DBMS', 'Joins & Subqueries'],
    
    // Computer Networks Topics (IDs 11-14)
    [11, 'Computer Networks', 'OSI Model'],
    [12, 'Computer Networks', 'TCP/IP Model'],
    [13, 'Computer Networks', 'IP Addressing'],
    [14, 'Computer Networks', 'Routing']
  ];

  const insertStmt = db.prepare(`INSERT INTO topics(id, module_name, topic_name) VALUES (?, ?, ?)`);
  
  db.run(`DELETE FROM topics`, [], function() {
      topicsToInsert.forEach(topic => {
          insertStmt.run(topic);
      });
      insertStmt.finalize();
      console.log(`Seeded ${topicsToInsert.length} topics into the database.`);
  });
});

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// ==========================
// AUTH ROUTES
// ==========================

// Signup
app.post('/api/signup', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
      const hashedPassword = await bcrypt.hash(password, 10);

      db.run(
          `INSERT INTO users(username, email, password) VALUES(?,?,?)`,
          [username, email, hashedPassword],
          function(err) {
              if (err) {
                  return res.status(409).json({ message: 'Email or username already in use.' });
              }
              res.json({ message: 'User registered successfully', userId: this.lastID });
          }
      );
  } catch (error) {
      res.status(500).json({ message: 'Internal server error during hashing.' });
  }
});

// Login
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const invalidMessage = { message: 'Invalid credentials' };

  db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
    if (err) return res.status(500).json({ message: err.message });
    if (!user) return res.status(401).json(invalidMessage); 

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json(invalidMessage); 

    res.json({ message: 'Login successful', userId: user.id, username: user.username });
  });
});

// ==========================
// COURSE & TOPIC ROUTES
// ==========================

// Get all modules & topics
app.get('/api/modules', (req, res) => {
  db.all(`SELECT * FROM topics`, (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});

// Upload assignment
app.post('/api/upload/:userId/:topicId', upload.single('assignment'), (req, res) => {
  const { userId, topicId } = req.params;
  
  if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded.' });
  }
  const filePath = req.file.path;

  // Use REPLACE INTO to handle both first-time upload and re-upload
  db.run(
    `REPLACE INTO assignments(user_id, topic_id, file_path, completed) VALUES(?,?,?,1)`,
    [userId, topicId, filePath],
    function(err) {
      if (err) {
          fs.unlink(filePath, () => {}); 
          return res.status(500).json({ message: err.message });
      }
      res.json({ message: 'Assignment uploaded successfully', assignmentId: this.lastID });
    }
  );
});

// Get user progress
app.get('/api/progress/:userId', (req, res) => {
  const { userId } = req.params;

  db.all(
    `SELECT t.id AS topicId, t.module_name, t.topic_name, 
            IFNULL(a.completed,0) AS completed, IFNULL(a.marks,0) AS marks
     FROM topics t
     LEFT JOIN assignments a
     ON t.id = a.topic_id AND a.user_id = ?
    `,
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });
      res.json(rows);
    }
  );
});

// ==========================
// START SERVER
// ==========================
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});