import {pool} from "../DB/config/mysql.config.js";

export const createItem = async (req, res) => {
  try {
    const {
      product_id,
      current_stage_id,
      status = "IN_PROGRESS",
    } = req.body;

    const [result] = await pool.query(
      `
      INSERT INTO items
      (
        product_id,
        current_stage_id,
        status
      )
      VALUES (?, ?, ?)
      `,
      [
        product_id,
        current_stage_id,
        status,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Item created successfully",
      id: result.insertId,
    });
  } catch (error) {
    console.log("ERR IN CREATE ITEM:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getItems = async (req, res) => {
  try {
    const [result] = await pool.query(`
      SELECT
        i.id,
        i.product_id,
        p.name AS product_name,
        i.current_stage_id,
        s.name AS current_stage_name,
        i.status,
        i.created_at
      FROM items i
      JOIN products p
        ON p.id = i.product_id
      LEFT JOIN stages s
        ON s.id = i.current_stage_id
      ORDER BY i.id DESC
    `);

    return res.status(200).json(result);
  } catch (error) {
    console.log("ERR IN GET ITEMS:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getItemById = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `
      SELECT
        i.id,
        i.product_id,
        p.name AS product_name,
        i.current_stage_id,
        s.name AS current_stage_name,
        i.status,
        i.created_at
      FROM items i
      JOIN products p
        ON p.id = i.product_id
      LEFT JOIN stages s
        ON s.id = i.current_stage_id
      WHERE i.id = ?
      `,
      [id]
    );

    if (!result.length) {
      return res.status(404).json({
        message: "Item not found",
      });
    }

    return res.status(200).json(result[0]);
  } catch (error) {
    console.log("ERR IN GET ITEM:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const updateItem = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      product_id,
      current_stage_id,
      status,
    } = req.body;

    const [result] = await pool.query(
      `
      UPDATE items
      SET
        product_id = ?,
        current_stage_id = ?,
        status = ?
      WHERE id = ?
      `,
      [
        product_id,
        current_stage_id,
        status,
        id,
      ]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        message: "Item not found",
      });
    }

    return res.status(200).json({
      message: "Item updated successfully",
    });
  } catch (error) {
    console.log("ERR IN UPDATE ITEM:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const deleteItem = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `
      DELETE FROM items
      WHERE id = ?
      `,
      [id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        message: "Item not found",
      });
    }

    return res.status(200).json({
      message: "Item deleted successfully",
    });
  } catch (error) {
    console.log("ERR IN DELETE ITEM:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};