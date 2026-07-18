import {pool} from "../DB/config/mysql.config.js";

// Get All
export const getAllExternalSources = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM external_sources ORDER BY id DESC"
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Get By ID
export const getExternalSourceById = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM external_sources WHERE id = ?",
      [req.params.id]
    );

    if (!rows.length)
      return res.status(404).json({ message: "Source not found" });

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Create
export const createExternalSource = async (req, res) => {
  try {
    const { code, name, description, is_active = true } = req.body;

    const [result] = await pool.query(
      `INSERT INTO external_sources
      (code,name,description,is_active)
      VALUES (?,?,?,?)`,
      [code, name, description, is_active]
    );

    res.status(201).json({
      message: "External Source Created",
      id: result.insertId,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Update
export const updateExternalSource = async (req, res) => {
  try {
    const { code, name, description, is_active } = req.body;

    await pool.query(
      `UPDATE external_sources
      SET code=?,name=?,description=?,is_active=?
      WHERE id=?`,
      [code, name, description, is_active, req.params.id]
    );

    res.json({ message: "Updated Successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Delete
export const deleteExternalSource = async (req, res) => {
  try {
    await pool.query(
      "DELETE FROM external_sources WHERE id=?",
      [req.params.id]
    );

    res.json({ message: "Deleted Successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};