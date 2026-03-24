const pool = require("../db/db");

const ALLOWED_STATUSES = [
  "ASSIGNED",
  "TO_BE_EDITED",
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

const ALLOWED_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

// CREATE TASK
const createTask = async (req, res) => {
  try {
    const {
      title,
      assigned_to_user_id,
      assigned_to: requestedAssignedTo,
      status: requestedStatus,
      client_name,
      priority,
      due_date,
    } = req.body;
    const status = requestedStatus || "ASSIGNED";

    if (!title || !title.trim()) {
      return res.status(400).json({ error: "Title is required" });
    }

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status value" });
    }

    if (priority !== undefined && priority !== null && priority !== "" && !ALLOWED_PRIORITIES.includes(priority)) {
      return res.status(400).json({ error: "Invalid priority value" });
    }

    // get user name
    let assigned_to = requestedAssignedTo ? String(requestedAssignedTo).trim() : null;

    if (!assigned_to && assigned_to_user_id) {
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
      (title, status, assigned_to_user_id, assigned_to, client_name, priority, due_date, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *`,
      [
        title.trim(),
        status,
        assigned_to_user_id || null,
        assigned_to,
        client_name ? String(client_name).trim() : null,
        priority || null,
        due_date || null,
      ]
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

// UPDATE TASK FIELDS (title, client_name, assigned_to, priority, due_date)
const updateTask = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      client_name,
      assigned_to,
      priority,
      due_date,
    } = req.body;

    const updates = [];
    const values = [];
    let index = 1;

    if (priority !== undefined) {
      if (priority !== null && priority !== "" && !ALLOWED_PRIORITIES.includes(priority)) {
        return res.status(400).json({ error: "Invalid priority value" });
      }
      updates.push(`priority = $${index++}`);
      values.push(priority || null);
    }

    if (title !== undefined) {
      updates.push(`title = $${index++}`);
      values.push(title ? String(title).trim() : null);
    }

    if (client_name !== undefined) {
      updates.push(`client_name = $${index++}`);
      values.push(client_name ? String(client_name).trim() : null);
    }

    if (assigned_to !== undefined) {
      updates.push(`assigned_to = $${index++}`);
      values.push(assigned_to ? String(assigned_to).trim() : null);
    }

    if (due_date !== undefined) {
      updates.push(`due_date = $${index++}`);
      values.push(due_date || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No updatable fields provided" });
    }

    values.push(id);

    const result = await pool.query(
      `UPDATE tasks
       SET ${updates.join(", ")}, updated_at = NOW()
       WHERE id = $${index}
       RETURNING *`,
      values
    );

    res.json({ task: result.rows[0] });
  } catch (error) {
    console.error("updateTask error:", error);
    res.status(500).json({ error: "Task update failed" });
  }
};

module.exports = {
  createTask,
  updateTaskStatus,
  updateVideoLink,
  updateTask,
};