// controllers/productionLine.controller.js
import { pool } from "../DB/config/mysql.config.js";

// Get All
export const getAllProductionLines = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        pl.id,
        pl.factory_id,
        f.name AS factory_name,
        pl.name,
        pl.code,
        pl.description,
        pl.is_active,
        pl.created_at
      FROM production_lines pl
      INNER JOIN factories f ON f.id = pl.factory_id
      ORDER BY pl.id DESC
    `);

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Get By ID
export const getProductionLineById = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      `SELECT * FROM production_lines WHERE id = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Production line not found" });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Create
export const createProductionLine = async (req, res) => {
  try {
    const { factory_id, name, code, description, is_active = true } = req.body;

    const [result] = await pool.query(
      `INSERT INTO production_lines
        (factory_id, name, code, description, is_active)
      VALUES (?, ?, ?, ?, ?)`,
      [factory_id, name, code, description || null, is_active]
    );

    res.status(201).json({
      message: "Production line created successfully",
      id: result.insertId,
    });
  } catch (error) {
    console.error(error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Line code already exists" });
    }
    res.status(500).json({ message: error.message });
  }
};

// Update
export const updateProductionLine = async (req, res) => {
  try {
    const { id } = req.params;
    const { factory_id, name, code, description, is_active } = req.body;

    await pool.query(
      `UPDATE production_lines
        SET factory_id = ?, name = ?, code = ?, description = ?, is_active = ?
      WHERE id = ?`,
      [factory_id, name, code, description || null, is_active, id]
    );

    res.json({ message: "Production line updated successfully" });
  } catch (error) {
    console.error(error);
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Line code already exists" });
    }
    res.status(500).json({ message: error.message });
  }
};

// Delete
export const deleteProductionLine = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(`DELETE FROM production_lines WHERE id = ?`, [id]);

    res.json({ message: "Production line deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};