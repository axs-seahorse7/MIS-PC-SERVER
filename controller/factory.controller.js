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
  const connection = await pool.getConnection();

  try {
    const {name, address, description, is_active = true} = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        message: "Factory name is required",
      });
    }

    // First 3 alphabetic characters of factory name
    const prefix = name
      .replace(/[^a-zA-Z]/g, "")
      .substring(0, 3)
      .toUpperCase();

    if (prefix.length < 3) {
      return res.status(400).json({
        message: "Factory name must contain at least 3 letters",
      });
    }

    await connection.beginTransaction();

    // Find the latest factory code for this prefix
    const [rows] = await connection.query(
      `
      SELECT code
      FROM factories
      WHERE code LIKE ?
      ORDER BY CAST(SUBSTRING(code, 4) AS UNSIGNED) DESC
      LIMIT 1
      FOR UPDATE
      `,
      [`${prefix}%`]
    );

    let nextNumber = 1;

    if (rows.length > 0) {
      const lastNumber = parseInt(rows[0].code.substring(3), 10);
      nextNumber = lastNumber + 1;
    }

    // 0001, 0002, 0003...
    const code = `${prefix}${String(nextNumber).padStart(4, "0")}`;

    const [result] = await connection.query(
      `
      INSERT INTO factories
      (name, code, address, description, is_active)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        name.trim(),
        code,
        address || null,
        description || null,
        is_active,
      ]
    );

    await connection.commit();

    return res.status(201).json({
      message: "Factory created successfully",
      id: result.insertId,
      code,
    });

  } catch (error) {
    await connection.rollback();

    console.error("Create factory error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Factory code already exists",
      });
    }

    return res.status(500).json({
      message: error.message,
    });

  } finally {
    connection.release();
  }
};

// Update
export const updateFactory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, description, is_active } = req.body;

    await pool.query(
      `UPDATE factories
       SET name = ?,
           address = ?,
           description = ?,
           is_active = ?
       WHERE id = ?`,
      [
        name,
        address || null,
        description || null,
        is_active,
        id,
      ]
    );

    res.json({
      message: "Factory updated successfully",
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: error.message,
    });
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