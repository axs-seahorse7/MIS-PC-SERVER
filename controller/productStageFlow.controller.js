import { pool } from "../DB/config/mysql.config.js";

// machine_code lives on `stages` (created in Stage configuration, shared by
// every product that uses the stage). This controller only READS it via
// `s.machine_code` — it never generates or changes it.
const FLOW_WITH_JOINS_SQL = `
  SELECT
    psf.id,
    psf.product_id,
    p.name AS product_name,
    psf.stage_id,
    s.name AS stage_name,
    s.line_id,
    psf.sequence_no,
    psf.scan_mode,
    psf.is_external_dependency,
    psf.external_source,
    psf.external_source_type,
    psf.external_machine_type,
    psf.external_folder_path,
    psf.external_poll_interval_minutes,
    psf.external_file_extensions,
    psf.external_api_config,
    s.machine_code,
    psf.created_at
  FROM product_stage_flow psf
  JOIN products p ON p.id = psf.product_id
  JOIN stages s ON s.id = psf.stage_id
  WHERE psf.id = ?
`;

const httpError = (status, message) =>
  Object.assign(new Error(message), { status });

/**
 * machine_code is created in Stage configuration (stages controller), NOT here.
 * A flow row can only be marked external if its stage already owns a machine
 * code — the row then simply inherits that code through the stages join.
 */
const assertStageHasMachineCode = async (conn, stageId) => {
  const [rows] = await conn.query(
    `SELECT machine_code FROM stages WHERE id = ?`,
    [stageId]
  );
  if (!rows.length) throw httpError(404, "Stage not found");
  if (!rows[0].machine_code) {
    throw httpError(
      400,
      "This stage has no machine code. Set it up as a machine in Stage configuration first."
    );
  }
};

export const createProductStageFlow = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      product_id,
      stage_id,
      sequence_no, // optional — auto-assigned as next-in-line if omitted
      scan_mode,
      is_external_dependency = 0,
      external_source = null,
      external_source_type = null,
      external_machine_type = null,
      external_folder_path = null,
      external_poll_interval_minutes = null,
      external_file_extensions = null,
      external_api_config = null,
    } = req.body;

    await connection.beginTransaction();

    if (is_external_dependency) {
      await assertStageHasMachineCode(connection, stage_id);
    }

    let finalSequenceNo = sequence_no;
    if (!finalSequenceNo) {
      const [maxRows] = await connection.query(
        `SELECT COALESCE(MAX(sequence_no), 0) AS maxSeq FROM product_stage_flow WHERE product_id = ?`,
        [product_id]
      );
      finalSequenceNo = maxRows[0].maxSeq + 1;
    }

    const [result] = await connection.query(
      `INSERT INTO product_stage_flow
      (product_id, stage_id, sequence_no, scan_mode, is_external_dependency,
       external_source, external_source_type, external_machine_type, external_folder_path,
       external_poll_interval_minutes, external_file_extensions, external_api_config)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product_id, stage_id, finalSequenceNo, scan_mode, is_external_dependency,
        external_source, external_source_type, external_machine_type, external_folder_path,
        external_poll_interval_minutes, external_file_extensions, external_api_config,
      ]
    );

    await connection.commit();

    const [rows] = await pool.query(FLOW_WITH_JOINS_SQL, [result.insertId]);
    connection.release();
    return res.status(201).json({ message: "Stage flow created successfully", data: rows[0] });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.log("ERR IN CREATE PRODUCT STAGE FLOW:", error);
    return res.status(error.status || 500).json({ message: error.message });
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
        s.line_id,
        psf.sequence_no,
        psf.scan_mode,
        psf.is_external_dependency,
        psf.external_source,
        psf.external_source_type,
        psf.external_machine_type,
        psf.external_folder_path,
        psf.external_poll_interval_minutes,
        psf.external_file_extensions,
        psf.external_api_config,
        s.machine_code
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
        psf.scan_mode,
        s.machine_code
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
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const {
      product_id,
      stage_id,
      scan_mode,
      is_external_dependency,
      external_source,
      external_source_type,
      external_machine_type = null,
      external_folder_path,
      external_poll_interval_minutes,
      external_file_extensions,
      external_api_config,
    } = req.body;

    await connection.beginTransaction();

    const [existingRows] = await connection.query(
      `SELECT product_id, sequence_no FROM product_stage_flow WHERE id = ? FOR UPDATE`,
      [id]
    );

    if (!existingRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: "Stage flow not found" });
    }

    const existing = existingRows[0];

    if (is_external_dependency) {
      await assertStageHasMachineCode(connection, stage_id);
    }

    // sequence_no is never accepted from the client — drag reorder
    // (/reorder endpoint) is the only thing allowed to change it. Keep the
    // existing value, UNLESS the product itself is being changed, in which
    // case re-append to the new product's flow.
    let sequence_no = existing.sequence_no;
    if (product_id && product_id !== existing.product_id) {
      const [maxRows] = await connection.query(
        `SELECT COALESCE(MAX(sequence_no), 0) AS maxSeq FROM product_stage_flow WHERE product_id = ?`,
        [product_id]
      );
      sequence_no = maxRows[0].maxSeq + 1;
    }

    const [result] = await connection.query(
      `
      UPDATE product_stage_flow
      SET
        product_id = ?,
        stage_id = ?,
        sequence_no = ?,
        scan_mode = ?,
        is_external_dependency = ?,
        external_source = ?,
        external_source_type = ?,
        external_machine_type = ?,
        external_folder_path = ?,
        external_poll_interval_minutes = ?,
        external_file_extensions = ?,
        external_api_config = ?
      WHERE id = ?
      `,
      [
        product_id,
        stage_id,
        sequence_no,
        scan_mode,
        is_external_dependency,
        external_source,
        external_source_type,
        external_machine_type,
        external_folder_path,
        external_poll_interval_minutes,
        external_file_extensions,
        external_api_config,
        id,
      ]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: "Stage flow not found" });
    }

    await connection.commit();

    const [rows] = await pool.query(FLOW_WITH_JOINS_SQL, [id]);
    connection.release();

    return res.status(200).json({
      message: "Stage flow updated successfully",
      data: rows[0],
    });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.log("ERR IN UPDATE PRODUCT STAGE FLOW:", error);
    return res.status(error.status || 500).json({ message: error.message });
  }
};

export const deleteProductStageFlow = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    await connection.beginTransaction();

    const [rows] = await connection.query(
      `SELECT product_id, sequence_no FROM product_stage_flow WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: "Stage flow not found" });
    }
    const { product_id, sequence_no } = rows[0];

    // NOTE: the stage's machine_code is intentionally NOT touched — it belongs
    // to the stage/line, not to this product's flow row.
    await connection.query(`DELETE FROM product_stage_flow WHERE id = ?`, [id]);

    // Shift every later stage in THIS product's flow down by one — no gaps left behind.
    await connection.query(
      `UPDATE product_stage_flow SET sequence_no = sequence_no - 1
       WHERE product_id = ? AND sequence_no > ?`,
      [product_id, sequence_no]
    );

    await connection.commit();
    connection.release();
    return res.status(200).json({ message: "Stage flow deleted successfully" });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.log("ERR IN DELETE PRODUCT STAGE FLOW:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const reorderProductStageFlow = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { productId, orderedIds } = req.body;

    if (!productId || !Array.isArray(orderedIds) || !orderedIds.length) {
      connection.release();
      return res.status(400).json({ message: "productId and orderedIds[] are required" });
    }

    await connection.beginTransaction();

    await connection.query(
      `UPDATE product_stage_flow SET sequence_no = sequence_no + 100000 WHERE product_id = ?`,
      [productId]
    );

    for (let i = 0; i < orderedIds.length; i++) {
      await connection.query(
        `UPDATE product_stage_flow SET sequence_no = ? WHERE id = ? AND product_id = ?`,
        [i + 1, orderedIds[i], productId]
      );
    }

    await connection.commit();

    const [rows] = await connection.query(
      `SELECT psf.id, psf.stage_id, s.name AS stage_name, psf.sequence_no,
              psf.scan_mode, psf.is_external_dependency, psf.external_source,
              psf.external_machine_type, s.machine_code
       FROM product_stage_flow psf
       JOIN stages s ON s.id = psf.stage_id
       WHERE psf.product_id = ?
       ORDER BY psf.sequence_no`,
      [productId]
    );
    connection.release();
    return res.status(200).json({ message: "Sequence updated", data: rows });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.log("ERR IN REORDER PRODUCT STAGE FLOW:", error);
    return res.status(500).json({ message: error.message });
  }
};