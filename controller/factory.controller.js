// controllers/factory.controller.js
import { pool } from "../DB/config/mysql.config.js";

// Get All
export const getAllFactories = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, name, code, address, description, is_active, created_at
      FROM factories
      ORDER BY id DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Get By ID
export const getFactoryById = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(`SELECT * FROM factories WHERE id = ?`, [id]);

    if (!rows.length) {
      return res.status(404).json({ message: "Factory not found" });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Create
export const createFactory = async (req, res) => {
  try {
    const { name, code, address, description, is_active = true } = req.body;

    const [result] = await pool.query(
      `INSERT INTO factories
        (name, code, address, description, is_active)
      VALUES (?, ?, ?, ?, ?)`,
      [name, code, address || null, description || null, is_active]
    );

    res.status(201).json({
      message: "Factory created successfully",
      id: result.insertId,
    });
  } catch (error) {
    console.error(error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Factory code already exists" });
    }
    res.status(500).json({ message: error.message });
  }
};

// Update
export const updateFactory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, address, description, is_active } = req.body;

    await pool.query(
      `UPDATE factories
        SET name = ?, code = ?, address = ?, description = ?, is_active = ?
      WHERE id = ?`,
      [name, code, address || null, description || null, is_active, id]
    );

    res.json({ message: "Factory updated successfully" });
  } catch (error) {
    console.error(error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Factory code already exists" });
    }
    res.status(500).json({ message: error.message });
  }
};

// Delete
export const deleteFactory = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(`DELETE FROM factories WHERE id = ?`, [id]);

    res.json({ message: "Factory deleted successfully" });
  } catch (error) {
    console.error(error);
    // production_lines.factory_id likely FKs here — surface that instead of a generic 500
    if (error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_ROW_IS_REFERENCED") {
      return res.status(409).json({ message: "Cannot delete: factory is in use by production lines" });
    }
    res.status(500).json({ message: error.message });
  }
};