
import pool from "../DB/config/mysql.config.js";
import bcrypt from "bcrypt";
import { asyncHandler, AppError } from "../utils/AppError.js";

export const closePartialBox = asyncHandler(async (req, res) => {
  const boxId = Number(req.body.box_id);
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const reason = String(req.body.reason || "").trim();

  if (!Number.isSafeInteger(boxId) || boxId <= 0) {
    throw new AppError("A valid box_id is required", 400);
  }

  if (!username || !password) {
    throw new AppError("Worker username and password are required", 400);
  }

  if (!reason || reason.length > 500) {
    throw new AppError(
      "Closure reason is required and cannot exceed 500 characters",
      400
    );
  }

  const conn = await pool.getConnection();
  let transactionStarted = false;

  try {
    await conn.beginTransaction();
    transactionStarted = true;

    // Lock the box to prevent simultaneous closure or scanning.
    const [boxRows] = await conn.query(
      `SELECT
         id, box_code, barcode_data, product_id,
         packaging_stage_id, box_size, actual_quantity, status
       FROM boxes
       WHERE id = ?
       FOR UPDATE`,
      [boxId]
    );

    if (!boxRows.length) {
      throw new AppError("Box not found", 404);
    }

    const box = boxRows[0];
    const quantity = Number(box.actual_quantity);
    const capacity = Number(box.box_size);

    if (!["OPEN", "PACKING"].includes(box.status)) {
      throw new AppError(
        `Box cannot be partially closed because its status is ${box.status}`,
        409
      );
    }

    if (
      !Number.isInteger(quantity) ||
      !Number.isInteger(capacity) ||
      quantity <= 0 ||
      quantity >= capacity
    ) {
      throw new AppError(
        "Only a non-empty box with fewer PCBs than its capacity can be partially closed",
        409
      );
    }

    if (!box.barcode_data) {
      throw new AppError("Box barcode is missing", 409);
    }

    // Find the active packaging rule for this box.
    const [configRows] = await conn.query(
      `SELECT id, printer_id, allow_partial_close
       FROM packaging_config
       WHERE product_id = ?
         AND stage_id = ?
         AND is_active = 1
       LIMIT 1
       FOR UPDATE`,
      [box.product_id, box.packaging_stage_id]
    );

    if (!configRows.length) {
      throw new AppError(
        "No active packaging rule exists for this box",
        409
      );
    }

    const config = configRows[0];

    if (Number(config.allow_partial_close) !== 1) {
      throw new AppError(
        "Partial closure is disabled for this packaging rule",
        409
      );
    }

    // Verify credentials only against workers for this packaging rule.
    const [workerRows] = await conn.query(
      `SELECT id, password_hash
       FROM partial_box_closure_workers
       WHERE packaging_config_id = ?
         AND username = ?
         AND is_active = 1
       LIMIT 1`,
      [config.id, username]
    );

    if (
      !workerRows.length ||
      !(await bcrypt.compare(password, workerRows[0].password_hash))
    ) {
      throw new AppError("Invalid worker credentials", 401);
    }

    const worker = workerRows[0];

    // Close the box and queue its existing label-print workflow.
    await conn.query(
      `UPDATE boxes
       SET status = 'PACKED',
           packed_at = NOW(),
           closed_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [box.id]
    );

    const [printJobResult] = await conn.query(
      `INSERT INTO box_print_jobs
         (box_id, printer_id, barcode_data, status)
       VALUES (?, ?, ?, 'PENDING')`,
      [box.id, config.printer_id, box.barcode_data]
    );

    // Record who closed the box, its quantity, and the reason.
    await conn.query(
      `INSERT INTO partial_box_closure_audit
         (box_id, packaging_config_id, worker_id,
          product_id, actual_quantity, configured_box_size, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        box.id,
        config.id,
        worker.id,
        box.product_id,
        quantity,
        capacity,
        reason,
      ]
    );

    await conn.commit();
    transactionStarted = false;

    return res.status(200).json({
      success: true,
      message: "Partial box closed successfully",
      data: {
        box_id: box.id,
        box_code: box.box_code,
        barcode_data: box.barcode_data,
        quantity,
        box_size: capacity,
        status: "PACKED",
        closed_by: username,
        reason,
        print_job_id: printJobResult.insertId,
        print_job_status: "PENDING",
      },
    });
  } catch (error) {
    if (transactionStarted) {
      await conn.rollback();
    }
    throw error;
  } finally {
    conn.release();
  }
});
