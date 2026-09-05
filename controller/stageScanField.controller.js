import {pool} from "../DB/config/mysql.config.js";


export const createStageScanField = async (req, res) => {
  try {
    const {
      product_stage_flow_id,
      product_field_id,
      is_required = 1,
    } = req.body;

    const [result] = await pool.query(
      `
      INSERT INTO stage_scan_fields
      (
        product_stage_flow_id,
        product_field_id,
        is_required
      )
      VALUES (?, ?, ?)
      `,
      [
        product_stage_flow_id,
        product_field_id,
        is_required,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Stage scan field created successfully",
      id: result.insertId,
    });
  } catch (error) {
    console.log("ERR IN CREATE STAGE SCAN FIELD:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        message:
          "This field is already assigned to this stage.",
      });
    }

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getStageScanFields = async (req, res) => {
  try {
    const [result] = await pool.query(`
      SELECT
        ssf.id,
        ssf.product_stage_flow_id,
        p.name AS product_name,
        s.name AS stage_name,
        pf.id AS product_field_id,
        pf.field_name,
        ssf.is_required,
        ssf.created_at
      FROM stage_scan_fields ssf
      JOIN product_stage_flow psf
        ON psf.id = ssf.product_stage_flow_id
      JOIN products p
        ON p.id = psf.product_id
      JOIN stages s
        ON s.id = psf.stage_id
      JOIN product_fields pf
        ON pf.id = ssf.product_field_id
      ORDER BY p.name, psf.sequence_no
    `);

    return res.status(200).json(result);
  } catch (error) {
    console.log("ERR IN GET STAGE SCAN FIELDS:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const getStageScanFieldsByFlowId = async (req, res ) => {
  try {
    const { flowId } = req.params;

    const [result] = await pool.query(
      `SELECT ssf.id, ssf.product_field_id, pf.field_name, pf.field_type, ssf.is_required FROM stage_scan_fields ssf JOIN product_fields pf ON pf.id = ssf.product_field_id WHERE ssf.product_stage_flow_id = ?`,
      [flowId]
    );

    return res.status(200).json(result);
  } catch (error) {
    console.log("ERR IN GET STAGE FIELDS:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const updateStageScanField = async (req, res) => {
  try {
    const { id } = req.params;
    const { product_field_id, is_required } = req.body;

    const [result] = await pool.query(
      `UPDATE stage_scan_fields SET product_field_id = ?, is_required = ? WHERE id = ?`,
      [product_field_id, is_required, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Stage scan field not found",
      });
    }

    return res.status(200).json({
      message: "Stage scan field updated successfully",
    });
  }

    catch (error) {
    console.log("ERR IN UPDATE STAGE SCAN FIELD:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        message:
          "This field is already assigned to this stage.",
      });
    }

    return res.status(500).json({
      message: error.message,
    });
  }

};

export const deleteStageScanField = async (req, res) => {
  try {
    const { id } = req.params;

    const [result] = await pool.query(
      `DELETE FROM stage_scan_fields WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Stage scan field not found",
      });
    }

    return res.status(200).json({
      message: "Stage scan field deleted successfully",
    });
  } catch (error) {
    console.log("ERR IN DELETE STAGE SCAN FIELD:", error);
    return res.status(500).json({
      message: error.message,
    });
  }
};
