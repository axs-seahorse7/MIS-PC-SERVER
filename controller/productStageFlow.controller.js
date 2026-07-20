import {pool} from "../DB/config/mysql.config.js"

export const createProductStageFlow = async (req, res) => {
  try {
    const {
      product_id,
      stage_id,
      sequence_no,
      scan_mode,
      group_required,
      is_mandatory = 1,
    } = req.body;

    const [result] = await pool.query(
      `INSERT INTO product_stage_flow
      (product_id, stage_id, sequence_no, scan_mode, group_required, is_mandatory)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [product_id, stage_id, sequence_no, scan_mode, group_required, is_mandatory]
    );

    return res.status(201).json({
      message: "Stage flow created successfully",
      id: result.insertId,
    });
  } catch (error) {
    console.log("ERR IN CREATE PRODUCT STAGE FLOW:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getProductStageFlows = async (req, res) => {
  try {
    const [result] = await pool.query(`
      SELECT
        psf.id,
        psf.product_id,
        p.name AS product_name,
        psf.stage_id,
        s.name AS stage_name,
        psf.sequence_no,
        psf.is_mandatory,
        psf.scan_mode,
        psf.group_required
      FROM product_stage_flow psf
      JOIN products p ON p.id = psf.product_id
      JOIN stages s ON s.id = psf.stage_id
      ORDER BY p.id, psf.sequence_no
    `);

    return res.status(200).json(result);
  } catch (error) {
    console.log("ERR IN GET PRODUCT STAGE FLOWS:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};  

export const getProductFlowByProductId = async (req, res) => {
  try {
    const { productId } = req.params;

    const [result] = await pool.query(
      `
      SELECT
        psf.id,
        psf.stage_id,
        s.name AS stage_name,
        psf.sequence_no,
        psf.is_mandatory
      FROM product_stage_flow psf
      JOIN stages s ON s.id = psf.stage_id
      WHERE psf.product_id = ?
      ORDER BY psf.sequence_no
      `,
      [productId]
    );

    return res.status(200).json(result);
  } catch (error) {
    console.log("ERR IN GET PRODUCT FLOW:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const updateProductStageFlow = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      product_id,
      stage_id,
      sequence_no,
      scan_mode,
      group_required,
      is_mandatory,
    } = req.body;

    console.log("Updating product stage flow :",req.body);

    const [result] = await pool.query(
      `
      UPDATE product_stage_flow
      SET
        product_id = ?,
        stage_id = ?,
        sequence_no = ?,
        scan_mode = ?,
        group_required = ?,
        is_mandatory = ?
      WHERE id = ?
      `,
      [
        product_id,
        stage_id,
        sequence_no,
        scan_mode,
        group_required,
        is_mandatory,
        id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Stage flow not found",
      });
    }

    return res.status(200).json({
      message: "Stage flow updated successfully",
    });
  } catch (error) {
    console.log("ERR IN UPDATE PRODUCT STAGE FLOW:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};

export const deleteProductStageFlow = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `DELETE FROM product_stage_flow WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Stage flow not found",
      });
    }

    return res.status(200).json({
      message: "Stage flow deleted successfully",
    });
  } catch (error) {
    console.log("ERR IN DELETE PRODUCT STAGE FLOW:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};

