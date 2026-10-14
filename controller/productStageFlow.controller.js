import { pool } from "../DB/config/mysql.config.js";

// machine_code lives on `stages` (created in Stage configuration, shared by
// every product that uses the stage). This controller only READS it via
// `s.machine_code` — it never generates or changes it.

const FLOW_WITH_JOINS_SQL = `
  SELECT
    psf.id,
    psf.product_id,
    p.name AS product_name,
    psf.line_id,
    pl.name AS line_name,
    psf.stage_id,
    s.name AS stage_name,
    s.line_id AS stage_line_id,
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
  JOIN products p
    ON p.id = psf.product_id
  JOIN production_lines pl
    ON pl.id = psf.line_id
  JOIN stages s
    ON s.id = psf.stage_id
   AND s.line_id = psf.line_id
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
      line_id,
      stage_id,
      sequence_no,
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

    if (!product_id || !line_id || !stage_id) {
      throw httpError(
        400,
        "product_id, line_id, and stage_id are required"
      );
    }

    await connection.beginTransaction();

    const [stageRows] = await connection.query(
      `SELECT id
       FROM stages
       WHERE id = ? AND line_id = ? AND is_active = 1`,
      [stage_id, line_id]
    );

    if (!stageRows.length) {
      throw httpError(
        400,
        "The selected stage does not belong to the selected line or is inactive"
      );
    }

    if (Number(is_external_dependency)) {
      await assertStageHasMachineCode(connection, stage_id);
    }

    let finalSequenceNo = Number(sequence_no);

    if (!Number.isInteger(finalSequenceNo) || finalSequenceNo < 1) {
      const [maxRows] = await connection.query(
        `SELECT COALESCE(MAX(sequence_no), 0) AS maxSeq
         FROM product_stage_flow
         WHERE product_id = ? AND line_id = ?`,
        [product_id, line_id]
      );

      finalSequenceNo = maxRows[0].maxSeq + 1;
    }

    const [result] = await connection.query(
      `INSERT INTO product_stage_flow
        (
          product_id,
          line_id,
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
          external_api_config
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product_id,
        line_id,
        stage_id,
        finalSequenceNo,
        scan_mode,
        is_external_dependency,
        external_source,
        external_source_type,
        external_machine_type,
        external_folder_path,
        external_poll_interval_minutes,
        external_file_extensions,
        external_api_config,
      ]
    );

    await connection.commit();

    const [rows] = await pool.query(FLOW_WITH_JOINS_SQL, [
      result.insertId,
    ]);

    return res.status(201).json({
      message: "Stage flow created successfully",
      data: rows[0],
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    console.log("ERR IN CREATE PRODUCT STAGE FLOW:", error);

    return res.status(error.status || 500).json({
      message: error.message,
    });
  } finally {
    connection.release();
  }
};

export const getProductStageFlows = async (req, res) => {
  try {
    const [result] = await pool.query(`
      SELECT
        psf.id,
        psf.product_id,
        p.name AS product_name,
        psf.line_id,
        pl.name AS line_name,
        psf.stage_id,
        s.name AS stage_name,
        s.line_id AS stage_line_id,
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
      JOIN products p
        ON p.id = psf.product_id
      JOIN production_lines pl
        ON pl.id = psf.line_id
      JOIN stages s
        ON s.id = psf.stage_id
      ORDER BY
        p.id,
        psf.line_id,
        psf.sequence_no
    `);

    return res.status(200).json(result);
  } catch (error) {
    console.error("ERR IN GET PRODUCT STAGE FLOWS:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};


export const getProductFlowByProductId = async (req, res) => {
  try {
    const { productId, lineId } = req.params;

    if (!Number.isInteger(Number(productId)) || Number(productId) < 1) {
      return res.status(400).json({
        message: "A valid productId is required",
      });
    }

    if (!Number.isInteger(Number(lineId)) || Number(lineId) < 1) {
      return res.status(400).json({
        message: "A valid lineId is required",
      });
    }

    const [result] = await pool.query(
      `
      SELECT
        psf.id,
        psf.product_id,
        psf.line_id,
        psf.stage_id,
        s.name AS stage_name,
        psf.sequence_no,
        psf.scan_mode,
        s.machine_code
      FROM product_stage_flow psf
      JOIN stages s
        ON s.id = psf.stage_id
       AND s.line_id = psf.line_id
      WHERE psf.product_id = ?
        AND psf.line_id = ?
      ORDER BY psf.sequence_no
      `,
      [Number(productId), Number(lineId)]
    );

    return res.status(200).json(result);
  } catch (error) {
    console.error("ERR IN GET PRODUCT FLOW:", error);

    return res.status(500).json({
      message: error.message,
    });
  }
};


export const updateProductStageFlow = async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    const { id } = req.params;
    const {
      product_id,
      stage_id,
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
    transactionStarted = true;

    const [existingRows] = await connection.query(
      `SELECT id, product_id, line_id, sequence_no
       FROM product_stage_flow
       WHERE id = ?
       FOR UPDATE`,
      [id]
    );

    if (!existingRows.length) {
      throw httpError(404, "Stage flow not found");
    }

    const existing = existingRows[0];
    const finalProductId = Number(product_id ?? existing.product_id);

    if (!Number.isInteger(finalProductId) || finalProductId < 1) {
      throw httpError(400, "A valid product_id is required");
    }

    if (!stage_id || !Number.isInteger(Number(stage_id))) {
      throw httpError(400, "A valid stage_id is required");
    }

    // The stage determines its assigned production line.
    const [stageRows] = await connection.query(
      `SELECT id, line_id
       FROM stages
       WHERE id = ? AND is_active = 1`,
      [stage_id]
    );

    if (!stageRows.length) {
      throw httpError(400, "The selected stage does not exist or is inactive");
    }

    const finalLineId = Number(stageRows[0].line_id);
    const groupChanged =
      finalProductId !== Number(existing.product_id) ||
      finalLineId !== Number(existing.line_id);

    if (Number(is_external_dependency)) {
      await assertStageHasMachineCode(connection, stage_id);
    }

    let sequenceNo = Number(existing.sequence_no);

    // Moving a flow to another product or line appends it to that flow.
    if (groupChanged) {
      const [maxRows] = await connection.query(
        `SELECT COALESCE(MAX(sequence_no), 0) AS maxSeq
         FROM product_stage_flow
         WHERE product_id = ? AND line_id = ? AND id <> ?`,
        [finalProductId, finalLineId, id]
      );

      sequenceNo = Number(maxRows[0].maxSeq) + 1;
    }

    await connection.query(
      `UPDATE product_stage_flow
       SET product_id = ?,
           line_id = ?,
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
       WHERE id = ?`,
      [
        finalProductId,
        finalLineId,
        stage_id,
        sequenceNo,
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

    await connection.commit();
    transactionStarted = false;

    const [rows] = await pool.query(FLOW_WITH_JOINS_SQL, [id]);

    return res.status(200).json({
      message: "Stage flow updated successfully",
      data: rows[0],
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }

    console.error("ERR IN UPDATE PRODUCT STAGE FLOW:", error);

    return res.status(error.status || 500).json({
      message: error.message,
    });
  } finally {
    connection.release();
  }
};

export const deleteProductStageFlow = async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    const { id } = req.params;

    await connection.beginTransaction();
    transactionStarted = true;

    const [rows] = await connection.query(
      `SELECT id, product_id, line_id, sequence_no
       FROM product_stage_flow
       WHERE id = ?
       FOR UPDATE`,
      [id]
    );

    if (!rows.length) {
      throw httpError(404, "Stage flow not found");
    }

    const { product_id, line_id, sequence_no } = rows[0];

    // Delete only this product's stage-flow entry.
    // The stage and its machine_code remain unchanged.
    await connection.query(
      `DELETE FROM product_stage_flow WHERE id = ?`,
      [id]
    );

    // Compact only this product + line sequence.
    await connection.query(
      `UPDATE product_stage_flow
       SET sequence_no = sequence_no - 1
       WHERE product_id = ?
         AND line_id = ?
         AND sequence_no > ?`,
      [product_id, line_id, sequence_no]
    );

    await connection.commit();
    transactionStarted = false;

    return res.status(200).json({
      message: "Stage flow deleted successfully",
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }

    console.error("ERR IN DELETE PRODUCT STAGE FLOW:", error);

    return res.status(error.status || 500).json({
      message: error.message,
    });
  } finally {
    connection.release();
  }
};

export const reorderProductStageFlow = async (req, res) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    const { productId, lineId, orderedIds } = req.body;

    const product = Number(productId);
    const line = Number(lineId);

    if (
      !Number.isInteger(product) ||
      product < 1 ||
      !Number.isInteger(line) ||
      line < 1 ||
      !Array.isArray(orderedIds) ||
      orderedIds.length === 0
    ) {
      throw httpError(
        400,
        "Valid productId, lineId, and orderedIds[] are required"
      );
    }

    const ids = orderedIds.map(Number);

    if (
      ids.some((id) => !Number.isInteger(id) || id < 1) ||
      new Set(ids).size !== ids.length
    ) {
      throw httpError(
        400,
        "orderedIds must contain unique, valid stage-flow IDs"
      );
    }

    await connection.beginTransaction();
    transactionStarted = true;

    // Lock and fetch every row belonging to this product + line.
    const [flowRows] = await connection.query(
      `SELECT id
       FROM product_stage_flow
       WHERE product_id = ? AND line_id = ?
       ORDER BY sequence_no
       FOR UPDATE`,
      [product, line]
    );

    const existingIds = flowRows.map((row) => Number(row.id));

    // Require a complete reorder: no missing, foreign, or extra IDs.
    if (
      existingIds.length !== ids.length ||
      existingIds.some((id) => !ids.includes(id))
    ) {
      throw httpError(
        400,
        "orderedIds must contain every stage-flow ID for this product and line exactly once"
      );
    }

    // Move current values out of the target range to avoid unique-index
    // collisions while assigning the new sequence numbers.
    await connection.query(
      `UPDATE product_stage_flow
       SET sequence_no = sequence_no + 100000
       WHERE product_id = ? AND line_id = ?`,
      [product, line]
    );

    for (let i = 0; i < ids.length; i++) {
      await connection.query(
        `UPDATE product_stage_flow
         SET sequence_no = ?
         WHERE id = ? AND product_id = ? AND line_id = ?`,
        [i + 1, ids[i], product, line]
      );
    }

    await connection.commit();
    transactionStarted = false;

    const [rows] = await connection.query(
      `SELECT
         psf.id,
         psf.product_id,
         psf.line_id,
         psf.stage_id,
         s.name AS stage_name,
         psf.sequence_no,
         psf.scan_mode,
         psf.is_external_dependency,
         psf.external_source,
         psf.external_machine_type,
         s.machine_code
       FROM product_stage_flow psf
       JOIN stages s
         ON s.id = psf.stage_id
        AND s.line_id = psf.line_id
       WHERE psf.product_id = ? AND psf.line_id = ?
       ORDER BY psf.sequence_no`,
      [product, line]
    );

    return res.status(200).json({
      message: "Sequence updated",
      data: rows,
    });
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }

    console.error("ERR IN REORDER PRODUCT STAGE FLOW:", error);

    return res.status(error.status || 500).json({
      message: error.message,
    });
  } finally {
    connection.release();
  }
};
