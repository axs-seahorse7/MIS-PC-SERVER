import {pool} from "../DB/config/mysql.config.js";

export const createScanHistory = async (req, res) => {
  try {
    const {
      item_id,
      stage_id,
      user_id,
      status = "SUCCESS",
      remarks = null,
    } = req.body;

    const [result] = await pool.query(
      `
      INSERT INTO scan_history
      (
        item_id,
        stage_id,
        user_id,
        status,
        remarks
      )
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        item_id,
        stage_id,
        user_id,
        status,
        remarks,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Scan history created successfully",
      id: result.insertId,
    });
  } catch (error) {
    console.log(
      "ERR IN CREATE SCAN HISTORY:",
      error
    );

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getScanHistory = async (req, res) => {
  try {
    const [result] = await pool.query(`
      SELECT
        sh.id,
        sh.item_id,
        p.name AS product_name,
        sh.stage_id,
        s.name AS stage_name,
        sh.user_id,
        u.name AS user_name,
        sh.status,
        sh.remarks,
        sh.scanned_at
      FROM scan_history sh
      JOIN items i
        ON i.id = sh.item_id
      JOIN products p
        ON p.id = i.product_id
      JOIN stages s
        ON s.id = sh.stage_id
      JOIN users u
        ON u.id = sh.user_id
      ORDER BY sh.scanned_at DESC
    `);

    return res.status(200).json(result);
  } catch (error) {
    console.log(
      "ERR IN GET SCAN HISTORY:",
      error
    );

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getItemScanHistory = async (
  req,
  res
) => {
  try {
    const { itemId } = req.params;

    const [result] = await pool.query(
      `
      SELECT
        sh.id,
        s.name AS stage_name,
        u.name AS user_name,
        sh.status,
        sh.remarks,
        sh.scanned_at
      FROM scan_history sh
      JOIN stages s
        ON s.id = sh.stage_id
      JOIN users u
        ON u.id = sh.user_id
      WHERE sh.item_id = ?
      ORDER BY sh.scanned_at
      `,
      [itemId]
    );

    return res.status(200).json(result);
  } catch (error) {
    console.log(
      "ERR IN GET ITEM HISTORY:",
      error
    );

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getStageScanHistory = async (
  req,
  res
) => {
  try {
    const { stageId } = req.params;

    const [result] = await pool.query(
      `
      SELECT
        sh.*,
        u.name AS user_name
      FROM scan_history sh
      JOIN users u
        ON u.id = sh.user_id
      WHERE sh.stage_id = ?
      ORDER BY sh.scanned_at DESC
      `,
      [stageId]
    );

    return res.status(200).json(result);
  } catch (error) {
    console.log(
      "ERR IN GET STAGE HISTORY:",
      error
    );

    return res.status(500).json({
      message: error.message,
    });
  }
};

