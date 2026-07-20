import { pool } from "../DB/config/mysql.config.js";

const createScanHistory = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { scanned_value } = req.body;
    const userId = req.user.id; // never trust frontend for identity

    if (!scanned_value) {
      return res.status(400).json({ success: false, message: "scanned_value is required" });
    }

    // 1. Get factory_id, line_id, stage_id from the logged-in user (DB, not JWT/body)
    const [userRows] = await conn.query(
      `SELECT id, factory_id, line_id, stage_id FROM users WHERE id = ?`,
      [userId]
    );

    if (!userRows.length) {
      return res.status(401).json({ success: false, message: "User not found" });
    }

    const { factory_id, line_id, stage_id } = userRows[0];

    if (!stage_id) {
      return res.status(400).json({ success: false, message: "User is not assigned to a stage" });
    }

    // 2. Resolve item from scanned_value
    const [itemRows] = await conn.query(
      `SELECT id, product_id FROM items WHERE qr_value = ?`,
      [scanned_value]
    );

    if (!itemRows.length) {
      return res.status(404).json({ success: false, message: "Invalid or unrecognized scan value" });
    }

    const item = itemRows[0];

    // 3. Get the product's stage sequence
    const [flowRows] = await conn.query(
      `SELECT stage_id, sequence_order
       FROM product_stage_flow
       WHERE product_id = ?
       ORDER BY sequence_order ASC`,
      [item.product_id]
    );

    if (!flowRows.length) {
      return res.status(400).json({ success: false, message: "No stage flow configured for this product" });
    }

    const currentFlowEntry = flowRows.find((f) => f.stage_id === stage_id);

    if (!currentFlowEntry) {
      return res.status(400).json({
        success: false,
        message: "Your stage is not part of this product's flow",
      });
    }

    const expectedSequence = currentFlowEntry.sequence_order;

    // 4. Find last successful scan for this item
    const [lastScanRows] = await conn.query(
      `SELECT sh.stage_id, psf.sequence_order
       FROM scan_history sh
       JOIN product_stage_flow psf
         ON psf.stage_id = sh.stage_id AND psf.product_id = ?
       WHERE sh.item_id = ? AND sh.status = 'SUCCESS'
       ORDER BY sh.scanned_at DESC
       LIMIT 1`,
      [item.product_id, item.id]
    );

    const lastSequence = lastScanRows.length ? lastScanRows[0].sequence_order : 0;

    let status = "SUCCESS";
    let remarks = null;

    // 5. Validate sequence
    if (expectedSequence === lastSequence) {
      // same stage scanned again
      status = "REJECTED";
      remarks = `Duplicate scan. Stage already recorded for this item.`;
    } else if (expectedSequence < lastSequence) {
      status = "REJECTED";
      remarks = `Backward scan not allowed. Item already past this stage.`;
    } else if (expectedSequence > lastSequence + 1) {
      const missingStage = flowRows.find((f) => f.sequence_order === lastSequence + 1);
      status = "REJECTED";
      remarks = `Stage ${lastSequence + 1} must be completed before stage ${expectedSequence}.`;
    }

    // 6. Insert scan_history record (success or rejected, both logged)
    const [result] = await conn.query(
      `INSERT INTO scan_history
        (item_id, factory_id, line_id, stage_id, user_id, scanned_value, status, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.id, factory_id, line_id, stage_id, userId, scanned_value, status, remarks]
    );

    return res.status(status === "SUCCESS" ? 201 : 400).json({
      success: status === "SUCCESS",
      message: status === "SUCCESS" ? "Scan recorded successfully" : remarks,
      id: result.insertId,
      status,
    });
  } catch (error) {
    console.log("ERR IN CREATE SCAN HISTORY:", error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    conn.release();
  }
};


export const submitScan = async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { scanned_value, product_id } = req.body;
    const userId = req.user.id; 

    if (!scanned_value) {
      return res.status(400).json({ success: false, message: "scanned_value is required" });
    }
    if (!product_id) {
      return res.status(400).json({ success: false, message: "product_id is required" });
    }

    // 1. Never trust factory/line/stage from frontend — fetch fresh from DB via user id
    const [userRows] = await conn.query(
      `SELECT id, factory_id, line_id, stage_id FROM users WHERE id = ?`,
      [userId]
    );

    if (!userRows.length) {
      return res.status(401).json({ success: false, message: "User not found" });
    }

    const { factory_id, line_id, stage_id } = userRows[0];

    if (!stage_id) {
      return res.status(400).json({ success: false, message: "User is not assigned to a stage" });
    }

    // 2. Resolve item from scanned_value
    const [itemRows] = await conn.query(
      `SELECT id, product_id FROM items WHERE qr_value = ?`,
      [scanned_value]
    );

    if (!itemRows.length) {
      return res.status(404).json({ success: false, message: "Invalid or unrecognized scan value" });
    }

    const item = itemRows[0];

    if (item.product_id !== Number(product_id)) {
      return res.status(400).json({
        success: false,
        message: "Scanned item does not belong to the selected product",
      });
    }

    // 3. Get this stage's position + rules in the product's flow
    const [flowRows] = await conn.query(
      `SELECT id, sequence_no, is_mandatory, scan_mode, group_required
       FROM product_stage_flow
       WHERE product_id = ? AND stage_id = ?`,
      [item.product_id, stage_id]
    );

    if (!flowRows.length) {
      return res.status(400).json({
        success: false,
        message: "This stage is not part of the product's flow",
      });
    }

    const { sequence_no: currentSeq, scan_mode, group_required } = flowRows[0];

    // 4. Last successful sequence for this item — no join needed, sequence_no is denormalized
    const [lastScanRows] = await conn.query(
      `SELECT MAX(sequence_no) AS lastSeq
       FROM scan_history
       WHERE item_id = ? AND status = 'SUCCESS'`,
      [item.id]
    );

    const lastSeq = lastScanRows[0].lastSeq || 0;

    // 5. Validate sequence
    if (currentSeq === lastSeq) {
      return res.status(400).json({
        success: false,
        message: "Duplicate scan: this stage is already completed for this item.",
      });
    }

    if (currentSeq < lastSeq) {
      return res.status(400).json({
        success: false,
        message: "Backward scan not allowed: item has already progressed past this stage.",
      });
    }

    if (currentSeq > lastSeq + 1) {
      const [missingFlow] = await conn.query(
        `SELECT psf.sequence_no, s.name AS stage_name
         FROM product_stage_flow psf
         JOIN stages s ON s.id = psf.stage_id
         WHERE psf.product_id = ? AND psf.sequence_no BETWEEN ? AND ?
         ORDER BY psf.sequence_no ASC`,
        [item.product_id, lastSeq + 1, currentSeq - 1]
      );

      const missingNames = missingFlow.map((f) => f.stage_name).join(", ");

      return res.status(400).json({
        success: false,
        message: `This stage is missing: ${missingNames || `sequence ${lastSeq + 1}`} must be scanned before this stage.`,
      });
    }

    // 6. Sequence is valid — insert scan_history
    //    SINGLE: real-time, immediately treated as done.
    //    GROUP_CREATE: still inserted now (so duplicate/backward checks
    //    keep working), but stays ungrouped (group_id NULL) until a
    //    separate "create group" action assigns a group_id later.
    const [result] = await conn.query(
      `INSERT INTO scan_history
        (item_id, factory_id, line_id, stage_id, user_id, scanned_value, status, sequence_no, group_id)
       VALUES (?, ?, ?, ?, ?, ?, 'SUCCESS', ?, NULL)`,
      [item.id, factory_id, line_id, stage_id, userId, scanned_value, currentSeq]
    );

    return res.status(201).json({
      success: true,
      message:
        scan_mode === "GROUP_CREATE"
          ? "Scan recorded, pending group save."
          : "Scan recorded successfully.",
      data: {
        id: result.insertId,
        sequence_no: currentSeq,
        scan_mode,
        group_required,
        pending_group: scan_mode === "GROUP_CREATE",
      },
    });
  } catch (error) {
    console.log("ERR IN SUBMIT SCAN:", error);
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    conn.release();
  }
};



export { createScanHistory };