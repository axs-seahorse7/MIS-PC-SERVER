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


// create
export const createProductionLine = async (req, res) => {
  const connection = await pool.getConnection();

  try {
    const {factory_id, name,description, is_active = true,} = req.body;

    if (!factory_id) {
      return res.status(400).json({
        message: "Factory ID is required",
      });
    }

    if (!name?.trim()) {
      return res.status(400).json({
        message: "Production line name is required",
      });
    }

    const cleanName = name.replace(/[^a-zA-Z]/g, "");

    if (cleanName.length < 3) {
      return res.status(400).json({
        message: "Production line name must contain at least 3 letters",
      });
    }

    const prefix = cleanName.substring(0, 3).toUpperCase();

    await connection.beginTransaction();

    // Get the latest code for this factory + prefix
    const [rows] = await connection.query(
      `
      SELECT code
      FROM production_lines
      WHERE factory_id = ?
        AND code LIKE ?
      ORDER BY CAST(SUBSTRING(code, 4) AS UNSIGNED) DESC
      LIMIT 1
      FOR UPDATE
      `,
      [factory_id, `${prefix}%`]
    );

    let nextNumber = 1;

    if (rows.length > 0) {
      const lastNumber = parseInt(rows[0].code.substring(3), 10);
      nextNumber = lastNumber + 1;
    }

    const code = `${prefix}${String(nextNumber).padStart(4, "0")}`;

    const [result] = await connection.query(
      `
      INSERT INTO production_lines
        (factory_id, name, code, description, is_active)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        factory_id,
        name.trim(),
        code,
        description || null,
        is_active,
      ]
    );

    await connection.commit();

    return res.status(201).json({
      message: "Production line created successfully",
      id: result.insertId,
      code,
    });

  } catch (error) {
    await connection.rollback();

    console.error("Create production line error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Production line code already exists",
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
export const updateProductionLine = async (req, res) => {
  try {
    const { id } = req.params;
    const { factory_id, name, description, is_active } = req.body;

    await pool.query(
      `UPDATE production_lines
       SET factory_id = ?,
           name = ?,
           description = ?,
           is_active = ?
       WHERE id = ?`,
      [
        factory_id,
        name,
        description || null,
        is_active,
        id,
      ]
    );

    res.json({
      message: "Production line updated successfully",
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      message: error.message,
    });
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

export const getLinesByFactoryId = async (req, res) => {
  try {
    const { factoryId } = req.params;

    if(!factoryId || isNaN(factoryId)) {
      return res.status(400).json({ message: "Invalid factory ID" });
    }

    const [rows] = await pool.query(
      `SELECT * FROM production_lines WHERE factory_id = ?`,
      [factoryId]
    );

    if(!rows.length) {
      return res.status(404).json({ message: "No production lines found for this factory" });
    }

   return res.json(rows);
  } catch (error) {
    console.error(error);
   return res.status(500).json({ message: error.message });
  }
}