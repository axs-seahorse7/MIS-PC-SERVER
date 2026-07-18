import {pool} from "../DB/config/mysql.config.js"

export const createStage = async (req, res) => {
  try {
    const { name, categoryId, factoryId, lineId, description } = req.body;

    const [result] = await pool.query(
      `INSERT INTO stages (name, category_id, factory_id, line_id, description)
       VALUES (?, ?, ?, ?, ?)`,
      [name, categoryId, factoryId || null, lineId || null, description || null]
    );

    return res.status(201).json({
      message: "Stage created successfully",
      id: result.insertId,
    });
  } catch (error) {
    console.log("ERR IN CREATE STAGE:", error);
    return res.status(500).json({ message: error.message });
  }
};


export const getStages = async (req, res) => { 
  try {
    const [stages] = await pool.query(`
      SELECT
        s.id,
        s.category_id,
        c.name AS category_name,
        s.factory_id,
        f.name AS factory_name,
        s.line_id,
        pl.name AS line_name,
        s.name,
        s.description,
        s.is_active,
        s.created_at
      FROM stages s
      LEFT JOIN categories c ON c.id = s.category_id
      LEFT JOIN factories f ON f.id = s.factory_id
      LEFT JOIN production_lines pl ON pl.id = s.line_id
      ORDER BY s.id DESC
    `);

    return res.status(200).json(stages);
  } catch (error) {
    console.log("ERR IN GET STAGES:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const getStageById = async (req, res) => {
  try {
    const { id } = req.params;

    const [stage] = await pool.query(`SELECT * FROM stages WHERE id = ?`, [id]);

    if (stage.length === 0) {
      return res.status(404).json({ message: "Stage not found" });
    }

    return res.status(200).json(stage[0]);
  } catch (error) {
    console.log("ERR IN GET STAGE:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const updateStage = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, categoryId, factoryId, lineId, description, is_active } = req.body;

    const [result] = await pool.query(
      `UPDATE stages
       SET name = ?, category_id = ?, factory_id = ?, line_id = ?, description = ?, is_active = ?
       WHERE id = ?`,
      [
        name,
        categoryId,
        factoryId || null,
        lineId || null,
        description || null,
        is_active === undefined ? 1 : is_active,
        id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Stage not found" });
    }

    return res.status(200).json({ message: "Stage updated successfully" });
  } catch (error) {
    console.log("ERR IN UPDATE STAGE:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const deleteStage = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(`DELETE FROM stages WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Stage not found" });
    }

    return res.status(200).json({ message: "Stage deleted successfully" });
  } catch (error) {
    console.log("ERR IN DELETE STAGE:", error);
    if (error.code === "ER_ROW_IS_REFERENCED_2" || error.code === "ER_ROW_IS_REFERENCED") {
      return res.status(409).json({ message: "Cannot delete: stage is in use" });
    }
    return res.status(500).json({ message: error.message });
  }
};