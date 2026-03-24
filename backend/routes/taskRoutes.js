const express = require("express");
const router = express.Router();

const {
  createTask,
  updateTaskStatus,
  updateVideoLink,
} = require("../controllers/taskController");

const pool = require("../db/db");

// ✅ ADD THIS (GET ALL TASKS)
router.get("/tasks", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM tasks ORDER BY created_at DESC"
    );
    res.json({ tasks: result.rows });
  } catch (err) {
    console.error("fetch tasks error:", err);
    res.status(500).json({ error: "Fetch failed" });
  }
});

// CREATE
router.post("/tasks", createTask);

// UPDATE STATUS
router.patch("/tasks/:id/status", updateTaskStatus);

// UPDATE VIDEO
router.patch("/tasks/:id/video", updateVideoLink);

module.exports = router;