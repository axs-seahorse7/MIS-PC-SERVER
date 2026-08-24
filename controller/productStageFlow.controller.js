import { pool } from "../DB/config/mysql.config.js";


const FLOW_WITH_JOINS_SQL = `
  SELECT
    psf.id,
    psf.product_id,
    p.name AS product_name,
    psf.stage_id,
    s.name AS stage_name,
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
    psf.machine_code,
    psf.created_at
  FROM product_stage_flow psf
  JOIN products p ON p.id = psf.product_id
  JOIN stages s ON s.id = psf.stage_id
  WHERE psf.id = ?
`;

const generateMachineCode = async (machineType) => {
  if (!machineType) return null;

  const [rows] = await pool.query(
    `SELECT machine_code FROM product_stage_flow
     WHERE external_machine_type = ? AND machine_code IS NOT NULL
     ORDER BY id DESC LIMIT 1`,
    [machineType]
  );

  let nextNum = 1;
  if (rows.length && rows[0].machine_code) {
    const match = String(rows[0].machine_code).match(/(\d+)$/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }

  return `${machineType}-${String(nextNum).padStart(4, "0")}`;
};

export const createProductStageFlow = async (req, res) => {
  try {
    const {
      product_id,
      stage_id,
      sequence_no, // optional now — auto-assigned as next-in-line if omitted
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

    let finalSequenceNo = sequence_no;
    if (!finalSequenceNo) {
      const [maxRows] = await pool.query(
        `SELECT COALESCE(MAX(sequence_no), 0) AS maxSeq FROM product_stage_flow WHERE product_id = ?`,
        [product_id]
      );
      finalSequenceNo = maxRows[0].maxSeq + 1;
    }

    const machine_code =
      is_external_dependency && external_machine_type
        ? await generateMachineCode(external_machine_type)
        : null;

    const [result] = await pool.query(
      `INSERT INTO product_stage_flow
      (product_id, stage_id, sequence_no, scan_mode, is_external_dependency,
       external_source, external_source_type, external_machine_type, external_folder_path,
       external_poll_interval_minutes, external_file_extensions, external_api_config, machine_code)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product_id, stage_id, finalSequenceNo, scan_mode, is_external_dependency,
        external_source, external_source_type, external_machine_type, external_folder_path,
        external_poll_interval_minutes, external_file_extensions, external_api_config, machine_code,
      ]
    );

    const [rows] = await pool.query(FLOW_WITH_JOINS_SQL, [result.insertId]);
    return res.status(201).json({ message: "Stage flow created successfully", data: rows[0] });
  } catch (error) {
    console.log("ERR IN CREATE PRODUCT STAGE FLOW:", error);
    return res.status(500).json({ message: error.message });
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
        psf.scan_mode,
        psf.is_external_dependency,
        psf.external_source,
        psf.external_source_type,
        psf.external_machine_type,
        psf.external_folder_path,
        psf.external_poll_interval_minutes,
        psf.external_file_extensions,
        psf.external_api_config,
        psf.machine_code
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
        psf.machine_code
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
      `SELECT machine_code, product_id, sequence_no FROM product_stage_flow WHERE id = ? FOR UPDATE`,
      [id]
    );

    if (!existingRows.length) {
      await connection.rollback();
      connection.release();
      return res.status(404).json({ message: "Stage flow not found" });
    }

    const existing = existingRows[0];

    // sequence_no is never accepted from the client anymore — drag reorder
    // (/reorder endpoint) is the only thing allowed to change it. Keep the
    // existing value, UNLESS the product itself is being changed, in which
    // case the old position is meaningless — re-append to the new product's
    // flow instead of carrying over a stale/colliding number.
    let sequence_no = existing.sequence_no;
    if (product_id && product_id !== existing.product_id) {
      const [maxRows] = await connection.query(
        `SELECT COALESCE(MAX(sequence_no), 0) AS maxSeq FROM product_stage_flow WHERE product_id = ?`,
        [product_id]
      );
      sequence_no = maxRows[0].maxSeq + 1;
    }

    // machine_code is generated once and then kept forever — editing other
    // fields never regenerates it. The only exception: a row that was
    // created as a non-external stage and only later gets marked external
    // (with a machine type) gets its first code assigned here.
    let machine_code = existing.machine_code;
    if (!machine_code && is_external_dependency && external_machine_type) {
      machine_code = await generateMachineCode(external_machine_type);
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
        external_api_config = ?,
        machine_code = ?
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
        machine_code,
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
    return res.status(500).json({ message: error.message });
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
              psf.external_machine_type, psf.machine_code
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


