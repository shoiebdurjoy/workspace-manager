const pool = require("../db/db");

const ALLOWED_STATUSES = [
  "ASSIGNED",
  "IN_EDIT",
  "QC_FIRST_APPROVAL",
  "QC_REVISION_NEEDED",
  "QC_FINAL_APPROVAL",
  "APPROVED",
  "SENT_TO_CLIENT",
  "CLIENT_REVISION_NEEDED",
  "COMPLETE",
  "CANCELLED",
];

// CREATE TASK
const createTask = async (req, res) => {
  try {
    const { title, assigned_to_user_id, status: requestedStatus } = req.body;
    const status = requestedStatus || "ASSIGNED";

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    // get user name
    let assigned_to = null;

    if (assigned_to_user_id) {
      const userResult = await pool.query(
        "SELECT name FROM users WHERE id = $1",
        [assigned_to_user_id]
      );

      if (userResult.rows.length > 0) {
        assigned_to = userResult.rows[0].name;
      }
    }

    const result = await pool.query(
      `INSERT INTO tasks 
      (title, status, assigned_to_user_id, assigned_to, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING *`,
      [title, status, assigned_to_user_id, assigned_to]
    );

    res.status(201).json({ task: result.rows[0] });
  } catch (error) {
    console.error("createTask error:", error);
    res.status(500).json({ error: "Create failed" });
  }
};

// UPDATE STATUS
const updateTaskStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    const result = await pool.query(
      `UPDATE tasks 
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );

    res.json({ task: result.rows[0] });
  } catch (error) {
    console.error("updateTaskStatus error:", error);
    res.status(500).json({ error: "Status update failed" });
  }
};

// UPDATE VIDEO LINK
const updateVideoLink = async (req, res) => {
  try {
    const { id } = req.params;
    const { video_link } = req.body;

    const result = await pool.query(
      `UPDATE tasks 
       SET video_link = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [video_link, id]
    );

    res.json({ task: result.rows[0] });
  } catch (error) {
    console.error("updateVideoLink error:", error);
    res.status(500).json({ error: "Video update failed" });
  }
};

module.exports = {
  createTask,
  updateTaskStatus,
  updateVideoLink,
};