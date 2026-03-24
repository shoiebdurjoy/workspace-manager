const express = require('express');
const cors = require('cors');
require('dotenv').config();

const pool = require('./db/db');
const taskRoutes = require('./routes/taskRoutes');

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api', taskRoutes);

// Root route
app.get('/', (req, res) => {
  res.send('API running');
});

// TEMP test route (for browser)
app.get('/test-insert', async (req, res) => {
  try {
    const result = await pool.query(
      `INSERT INTO tasks 
      (title, description, status, assigned_to, video_link, client_name, priority, due_date, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
      RETURNING *`,
      [
        "Browser Test Task",
        "Inserted from browser",
        "IN_EDIT",
        "Durjoy",
        "https://example.com",
        "Client A",
        "HIGH",
        "2026-03-30",
      ]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Insert error:", err.message);
    res.status(500).send("Error inserting task");
  }
});

// Start server
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});